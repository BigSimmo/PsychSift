#!/usr/bin/env python3
"""Build authentic Debian sources with hash-pinned local security backports."""
import argparse
from datetime import datetime, timezone
from email.parser import Parser
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def run(argv, cwd=None, env=None, capture=False):
    return subprocess.run(argv, cwd=cwd, env=env, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def checked_path(root, relative):
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise ValueError("expected a relative native input path")
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("native input escapes root or is missing")
    return path


def verify_hash(path, expected):
    if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
        raise ValueError("invalid SHA256")
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError(f"SHA256 mismatch: {path.name}")
    return actual


def load_component(root, component):
    if not re.fullmatch(r"[a-z0-9][a-z0-9+.-]*", component):
        raise ValueError("invalid component")
    data = json.loads(checked_path(root, f"components/{component}.json").read_text())
    if data.get("schema_version") != 1:
        raise ValueError("unsupported descriptor schema")
    for field in ("source", "source_version", "backport_version", "change_summary"):
        if not isinstance(data.get(field), str) or not data[field] or "\n" in data[field]:
            raise ValueError(f"invalid descriptor field: {field}")
    if not re.fullmatch(r"[a-z0-9][a-z0-9+.-]*", data["source"]):
        raise ValueError("invalid source package")
    if not re.fullmatch(r"[0-9][A-Za-z0-9.+:~\-]*", data["source_version"]):
        raise ValueError("invalid source version")
    if not re.fullmatch(re.escape(data["source_version"]) + r"\+[A-Za-z0-9.+~]+",
                        data["backport_version"]):
        raise ValueError("backport must retain the original upstream/source revision")
    if not re.fullmatch(r"[a-f0-9]{64}", data.get("dsc_sha256", "")):
        raise ValueError("invalid DSC hash")
    if type(data.get("source_date_epoch")) is not int or data["source_date_epoch"] <= 0:
        raise ValueError("invalid source_date_epoch")
    for field in ("runtime_packages", "extra_build_packages"):
        values = data.get(field)
        if not isinstance(values, list) or any(
                not isinstance(x, str) or not re.fullmatch(r"[a-z0-9][a-z0-9+.-]*", x)
                for x in values) or len(values) != len(set(values)):
            raise ValueError(f"invalid package list: {field}")
    if not data["runtime_packages"] or not isinstance(data.get("patches"), list) or not data["patches"]:
        raise ValueError("runtime packages and patches are required")
    paths = set()
    for patch in data["patches"]:
        path = checked_path(root, patch["file"])
        if path in paths or not re.fullmatch(r"[a-f0-9]{40}", patch["upstream_commit"]):
            raise ValueError("duplicate patch or invalid upstream commit")
        paths.add(path)
        verify_hash(path, patch["sha256"])
    commands = data.get("test_commands")
    if not isinstance(commands, list) or any(
            not isinstance(command, list) or not command or any(
                not isinstance(arg, str) or not arg or "\0" in arg for arg in command)
            for command in commands):
        raise ValueError("test_commands must contain argv arrays")
    return data


def select_packages(paths, data, inspect=None):
    inspect = inspect or (lambda path: Parser().parsestr(run(
        ["dpkg-deb", "--field", str(path)], capture=True)))
    selected = {}
    for path in paths:
        control = inspect(path)
        name, version = control.get("Package"), control.get("Version")
        if name not in data["runtime_packages"]:
            continue
        match = re.fullmatch(r"([a-z0-9][a-z0-9+.-]*)(?: \(([^()]+)\))?",
                             control.get("Source", name))
        if (not match or match[1] != data["source"] or
                (match[2] or version) != data["backport_version"] or
                not version or not control.get("Architecture") or name in selected):
            raise ValueError(f"duplicate or unexpected package provenance: {name}")
        selected[name] = (path, dict(control.items()))
    if set(selected) != set(data["runtime_packages"]):
        raise ValueError("missing required runtime packages")
    return selected


def build(root, component, output):
    data = load_component(root, component)  # Validate all local inputs before apt.
    run(["apt-get", "update"])
    target = f"{data['source']}={data['source_version']}"
    run(["apt-get", "build-dep", "-y", "--no-install-recommends", target])
    if data["extra_build_packages"]:
        run(["apt-get", "install", "-y", "--no-install-recommends", *data["extra_build_packages"]])
    environment = dict(os.environ, SOURCE_DATE_EPOCH=str(data["source_date_epoch"]),
                       LC_ALL="C.UTF-8", QUILT_PATCHES="debian/patches",
                       # The python:*-slim base puts its own interpreter in
                       # /usr/local/bin first. Debian build tools such as
                       # asciidoc (`#!/usr/bin/env python3`) must run under the
                       # distro python3 that has their modules installed.
                       PATH="/usr/sbin:/usr/bin:/sbin:/bin")
    # Never inherit test/doc-skipping or dependency-bypass build options.
    for key in ("DEB_BUILD_OPTIONS", "DEB_BUILD_PROFILES", "DPKG_BUILDPACKAGE_OPTIONS"):
        environment.pop(key, None)
    with tempfile.TemporaryDirectory(prefix=f"worker-native-{component}-") as work:
        work = Path(work)
        run(["apt-get", "source", "--download-only", "--only-source", target], cwd=work)
        descriptors = list(work.glob("*.dsc"))
        if len(descriptors) != 1:
            raise ValueError("expected exactly one downloaded source descriptor")
        verify_hash(descriptors[0], data["dsc_sha256"])
        source = work / "source"
        run(["dpkg-source", "--extract", str(descriptors[0]), str(source)])
        series = source / "debian/patches/series"
        series.parent.mkdir(parents=True, exist_ok=True)
        previous = series.read_text() if series.exists() else ""
        additions = []
        for index, patch in enumerate(data["patches"]):
            original = checked_path(root, patch["file"])
            verify_hash(original, patch["sha256"])
            name = f"psychsift-{index:02d}-{patch['upstream_commit']}.patch"
            destination = series.parent / name
            if destination.exists():
                raise ValueError("backport patch collides with Debian source")
            shutil.copyfile(original, destination)
            additions.append(name)
        series.write_text(previous.rstrip() + "\n" + "\n".join(additions) + "\n")
        run(["quilt", "push", "--fuzz=0", "-a"], cwd=source, env=environment)
        changelog = source / "debian/changelog"
        date = datetime.fromtimestamp(data["source_date_epoch"], timezone.utc).strftime(
            "%a, %d %b %Y %H:%M:%S +0000")
        changelog.write_text(f"{data['source']} ({data['backport_version']}) trixie-security; urgency=high\n\n"
                             f"  * Local security backport: {data['change_summary']}\n\n"
                             f" -- PsychSift Security Backport <noreply@psychsift.invalid>  {date}\n\n"
                             + changelog.read_text())
        run(["dpkg-buildpackage", "-b", "-us", "-uc", "-j2"], cwd=source, env=environment)
        for command in data["test_commands"]:
            run(command, cwd=source, env=environment)
        selected = select_packages(sorted(work.glob("*.deb")), data)
        output.mkdir(parents=True, exist_ok=True)
        evidence = {"schema_version": 1, "source": data["source"],
                    "source_version": data["source_version"], "backport_version": data["backport_version"],
                    "patches": data["patches"], "test_commands": data["test_commands"], "runtime_packages": []}
        for name, (path, control) in selected.items():
            destination = output / path.name
            if destination.exists():
                raise ValueError("refusing to overwrite package output")
            shutil.copyfile(path, destination)
            evidence["runtime_packages"].append({"name": name, "version": control["Version"],
                "source": data["source"], "source_version": data["backport_version"],
                "file": path.name, "control": control,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        (output / f"security-build-{data['source']}.json").write_text(json.dumps(evidence, indent=2) + "\n")


def verify_installed(directory):
    manifests = sorted(directory.glob("security-build-*.json"))
    if not manifests:
        raise ValueError("no installed security build evidence")
    seen = set()
    for path in manifests:
        evidence = json.loads(path.read_text())
        if evidence.get("schema_version") != 1 or not evidence.get("runtime_packages"):
            raise ValueError("invalid installed security build evidence")
        for package in evidence["runtime_packages"]:
            name = package["name"]
            if not re.fullmatch(r"[a-z0-9][a-z0-9+.-]*", name) or name in seen:
                raise ValueError("invalid or duplicate installed package")
            seen.add(name)
            expected = [name, package["version"], evidence["source"], evidence["backport_version"]]
            if package["source"] != expected[2] or package["source_version"] != expected[3]:
                raise ValueError("inconsistent installed source evidence")
            actual = run(["dpkg-query", "--show", "--showformat=${Package}\t${Version}\t${source:Package}\t${source:Version}\n",
                          name], capture=True).strip().split("\t")
            if actual != expected:
                raise ValueError(f"installed package provenance mismatch: {name}")
    print(f"Verified installed native security package provenance: {len(seen)} packages")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", nargs="?")
    parser.add_argument("--verify-installed", type=Path, nargs="?",
                        const=Path("/usr/share/psychsift/native-security"))
    parser.add_argument("--native-root", type=Path, default=Path("/tmp/worker-native"))
    parser.add_argument("--output", type=Path, default=Path("/out"))
    args = parser.parse_args()
    if args.verify_installed is not None:
        if args.component:
            parser.error("component cannot be combined with --verify-installed")
        verify_installed(args.verify_installed)
    elif args.component:
        build(args.native_root.resolve(), args.component, args.output)
    else:
        parser.error("component or --verify-installed is required")
