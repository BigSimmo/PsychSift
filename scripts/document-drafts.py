"""Copy-first text document drafts. Never writes to the source tree.

prepare SOURCE WORKSPACE --task NAME --file relative.md [--file ...]
status WORKSPACE --source SOURCE
reconcile WORKSPACE --source SOURCE [--resolved relative.md]
export WORKSPACE --source SOURCE
Export prints the reviewed-files JSON array. Authority/claims and application remain
the responsibility of the existing native writer and repository gates.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tempfile
from contextlib import contextmanager

MAX_FILES = 100
MAX_BYTES = 10 * 1024 * 1024
EXTENSIONS = {'.md', '.txt', '.rst', '.adoc'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(root, name):
    if not isinstance(name, str) or '\\' in name or ':' in name:
        raise ValueError('invalid relative path')
    parts = PurePosixPath(name).parts
    if not parts or name != '/'.join(parts) or any(p in ('.', '..') or p.startswith('.') for p in parts):
        raise ValueError('hidden, absolute or traversing path rejected')
    if PurePosixPath(name).is_absolute() or PurePosixPath(name).suffix.lower() not in EXTENSIONS:
        raise ValueError('only allowlisted text document extensions are supported')
    forbidden = {'env', 'secret', 'secrets', 'credentials', 'password', 'passwords', 'config', 'configuration', 'settings', 'token', 'tokens'}
    if any(set(p.lower().replace('-', '.').replace('_', '.').split('.')) & forbidden for p in parts):
        raise ValueError('sensitive/configuration path rejected')
    current = Path(root)
    ancestor = current
    while not ancestor.exists() and not ancestor.is_symlink():
        ancestor = ancestor.parent
    check_root(ancestor)
    for part in parts:
        current = current / part
        if current.exists() or current.is_symlink():
            info = current.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                raise ValueError('symlink/reparse path rejected')
    return current


def check_root(path):
    path = Path(os.path.abspath(path))
    for part in [path, *path.parents]:
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('symlink/reparse root rejected')
    return path


def read_text(path):
    data = path.read_bytes()
    if len(data) > MAX_BYTES or b'\0' in data:
        raise ValueError('oversized or binary document')
    data.decode('utf-8')
    return data


def write_json(path, value):
    metadata_path(path.parent, path.name)
    temporary = path.with_suffix('.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2)
    os.replace(temporary, path)


def metadata_path(workspace, name):
    check_root(workspace)
    path = workspace / name
    if path.exists() or path.is_symlink():
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('metadata symlink/reparse path rejected')
    return path


def disjoint(source, workspace):
    if source == workspace or source in workspace.parents or workspace in source.parents:
        raise ValueError('workspace must be outside source checkout')


@contextmanager
def locked(workspace):
    lock = workspace / '.draft-lock'
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        yield
    finally:
        lock.unlink()


def load(workspace, expected_source=None):
    manifest = json.loads(metadata_path(workspace, 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != 1 or manifest['workspace'] != str(workspace):
        raise ValueError('workspace identity mismatch')
    names = [item['path'] for item in manifest['files']]
    if not names or len(names) > MAX_FILES or len({p.casefold() for p in names}) != len(names):
        raise ValueError('invalid manifest file list')
    source = check_root(manifest['source'])
    if expected_source is not None and source != check_root(expected_source):
        raise ValueError('explicit source root differs from manifest')
    disjoint(source, workspace)
    total = 0
    draft_total = 0
    for item in manifest['files']:
        safe_path(Path(manifest['source']), item['path'])
        base = read_text(safe_path(workspace / 'base', item['path']))
        total += len(base)
        draft_total += len(read_text(safe_path(workspace / 'draft', item['path'])))
        if digest(base) != item['original_sha256']:
            raise ValueError('immutable baseline modified')
    if total > MAX_BYTES or draft_total > MAX_BYTES:
        raise ValueError('total byte limit exceeded')
    return manifest


def prepare(source, workspace, task, names):
    source = check_root(source)
    # Reject nesting in either direction, including through pre-existing links.
    destination = Path(os.path.abspath(workspace))
    ancestor = destination
    while not ancestor.exists():
        ancestor = ancestor.parent
    check_root(ancestor)
    disjoint(source, destination)
    if not names or len(names) > MAX_FILES or len({n.casefold() for n in names}) != len(names):
        raise ValueError('empty, duplicate, case-colliding or excessive file list')
    contents = [(name, read_text(safe_path(source, name))) for name in names]
    if sum(len(data) for _, data in contents) > MAX_BYTES:
        raise ValueError('total byte limit exceeded')
    destination.mkdir(parents=True, exist_ok=True)
    with locked(destination):
        if (destination / 'manifest.json').exists():
            existing = load(destination, source)
            if existing['source'] != str(source) or existing['task'] != task or [f['path'] for f in existing['files']] != names:
                raise ValueError('resume identity differs')
            return existing
        if any(p.name != '.draft-lock' for p in destination.iterdir()):
            raise ValueError('new workspace must be empty')
        entries = []
        for name, data in contents:
            for folder in ('base', 'draft'):
                target = safe_path(destination / folder, name)
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as stream:
                    stream.write(data)
            entries.append({'path': name, 'original_sha256': digest(data)})
        manifest = dict(version=1, source=str(source), workspace=str(destination), task=task, files=entries)
        write_json(destination / 'manifest.json', manifest)
        return manifest


def merge_bytes(workspace, proposed, base, latest):
    if latest == base or latest == proposed:
        return proposed, False
    if proposed == base:
        return latest, False
    with tempfile.TemporaryDirectory(dir=workspace) as temporary:
        paths = [Path(temporary) / n for n in ('draft', 'base', 'source')]
        for path, data in zip(paths, (proposed, base, latest)):
            path.write_bytes(data)
        result = subprocess.run(['git', 'merge-file', '-p', '-L', 'draft', '-L', 'base', '-L', 'latest', *map(str, paths)], capture_output=True, timeout=30)
        if result.returncode < 0 or result.returncode > 127:
            raise ValueError('git merge-file failed')
        return result.stdout, result.returncode > 0


def reconcile(workspace, manifest, resolved):
    manifest = load(workspace, manifest['source'])
    previous_path = metadata_path(workspace, 'reconciliation.json')
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else {'files': []}
    prior = {item['path']: item for item in previous['files']}
    if set(resolved) - set(prior):
        raise ValueError('resolution has no previous candidate')
    output = []
    generation = tempfile.mkdtemp(prefix='merge-', dir=workspace)
    generation = Path(generation)
    source_total = 0
    for item in manifest['files']:
        name = item['path']
        try:
            source = read_text(safe_path(Path(manifest['source']), name))
            source_total += len(source)
            if source_total > MAX_BYTES:
                raise ValueError('source total byte limit exceeded')
            base = read_text(safe_path(workspace / 'base', name))
            draft = read_text(safe_path(workspace / 'draft', name))
            old = prior.get(name)
            conflict = False
            review_reason = None
            if old and 'candidate' in old:
                previous_candidate = read_text(safe_path(workspace, old['candidate']))
                source_changed = old.get('before_sha256') != digest(source)
                draft_changed = old.get('draft_sha256') != digest(draft)
                edited = digest(previous_candidate) != old['candidate_sha256']
                if not source_changed and not draft_changed:
                    merged, conflict = previous_candidate, old['conflict']
                    review_reason = old.get('review_reason')
                    if not conflict and edited and name not in resolved:
                        raise ValueError('clean candidate edited; explicitly review with --resolved')
                    if name in resolved:
                        if any(line.startswith((b'<<<<<<< ', b'>>>>>>> ', b'||||||| ')) for line in merged.splitlines()):
                            raise ValueError('conflict markers remain')
                        conflict = False
                        review_reason = None
                else:
                    if name in resolved:
                        raise ValueError('resolution inputs changed; inspect new merge')
                    if not old.get('source_snapshot') or not old.get('draft_snapshot'):
                        raise ValueError('previous input snapshots unavailable; preserve candidate and reconcile in a fresh task-owned workspace')
                    old_source = read_text(safe_path(workspace, old['source_snapshot']))
                    old_draft = read_text(safe_path(workspace, old['draft_snapshot']))
                    if digest(old_source) != old['before_sha256'] or digest(old_draft) != old['draft_sha256']:
                        raise ValueError('previous input snapshot changed')
                    merged, source_conflict = merge_bytes(workspace, previous_candidate, old_source, source)
                    merged, draft_conflict = merge_bytes(workspace, merged, old_draft, draft)
                    # Both inputs moving can make rebasing order-dependent. Keep
                    # all versions and require review before this proposal exports.
                    conflict = old['conflict'] or edited or source_conflict or draft_conflict or (source_changed and draft_changed)
                    if source_changed and draft_changed:
                        review_reason = 'both source and draft changed; inspect retained inputs and candidate before --resolved'
                    elif conflict:
                        review_reason = old.get('review_reason')
            elif name in resolved:
                raise ValueError('resolution inputs changed; inspect new merge')
            else:
                merged, conflict = merge_bytes(workspace, draft, base, source)
            snapshots = {}
            for folder, data in [('candidate', merged), ('source-input', source), ('draft-input', draft)]:
                target = safe_path(generation / folder, name)
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as stream:
                    stream.write(data)
                snapshots[folder] = target.relative_to(workspace).as_posix()
            output.append(dict(path=name, before_sha256=digest(source), draft_sha256=digest(draft), candidate=snapshots['candidate'], candidate_sha256=digest(merged), source_snapshot=snapshots['source-input'], draft_snapshot=snapshots['draft-input'], conflict=conflict, review_reason=review_reason))
        except (OSError, ValueError, UnicodeError, subprocess.SubprocessError) as error:
            failed = dict(prior.get(name, {}))
            failed.update(path=name, error=str(error), conflict=True)
            output.append(failed)
    result = {'files': output}
    write_json(previous_path, result)
    return result


def export(workspace, manifest):
    manifest = load(workspace, manifest['source'])
    reconciliation = json.loads(metadata_path(workspace, 'reconciliation.json').read_text())
    if [i['path'] for i in reconciliation['files']] != [i['path'] for i in manifest['files']]:
        raise ValueError('reconciliation file list mismatch')
    output = []
    for item in reconciliation['files']:
        if item.get('error') or item['conflict']:
            raise ValueError('unresolved conflicts or source errors block export')
        name = item['path']
        source = read_text(safe_path(Path(manifest['source']), name))
        draft = read_text(safe_path(workspace / 'draft', name))
        if digest(source) != item['before_sha256'] or digest(draft) != item['draft_sha256']:
            raise ValueError('stale reconciliation: source or draft changed')
        candidate = read_text(safe_path(workspace, item['candidate']))
        if digest(candidate) != item['candidate_sha256']:
            raise ValueError('candidate edited; explicitly review with reconcile --resolved')
        if candidate != source:
            output.append(dict(path=str(safe_path(Path(manifest['source']), name)), before_sha256=digest(source), after_base64=base64.b64encode(candidate).decode('ascii')))
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('source'); p.add_argument('workspace'); p.add_argument('--task', required=True)
    p.add_argument('--file', action='append', required=True)
    for command in ('status', 'reconcile', 'export'):
        p = sub.add_parser(command); p.add_argument('workspace')
        p.add_argument('--source', required=True, help='explicit verified source checkout root')
        if command == 'reconcile':
            p.add_argument('--resolved', action='append', default=[])
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            result = prepare(args.source, args.workspace, args.task, args.file)
        else:
            workspace = check_root(args.workspace)
            explicit_source = check_root(args.source)
            disjoint(explicit_source, workspace)
            with locked(workspace):
                manifest = load(workspace, explicit_source)
                if args.command == 'status':
                    reconciliation_path = metadata_path(workspace, 'reconciliation.json')
                    result = {'manifest': manifest, 'reconciliation': json.loads(reconciliation_path.read_text()) if reconciliation_path.exists() else None}
                elif args.command == 'reconcile':
                    result = reconcile(workspace, manifest, args.resolved)
                else:
                    result = export(workspace, manifest)
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, UnicodeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
