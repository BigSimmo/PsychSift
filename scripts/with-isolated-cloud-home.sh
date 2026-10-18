#!/usr/bin/env bash
# Explicit subprocess scope only; this does not select/provision a legacy profile or scrub credentials.
set -Eeuo pipefail
if [[ $# -lt 4 || "$1" != --root || "$3" != -- || -z "$2" ]]; then
  printf 'Usage: bash scripts/with-isolated-cloud-home.sh --root NEW_OR_OWNED_DIRECTORY -- COMMAND [ARGS...]\n' >&2
  exit 2
fi
scope_root="$2"
shift 3
checkout="$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)"
# Python performs bounded path/ownership checks and replaces itself with the selected command.
# No shell startup, authentication file or parent config is read/copied.
exec python3 /dev/fd/3 "$scope_root" "$checkout" "$@" 3<<'PY'
import json
import os
from pathlib import Path
import stat
import sys


def refuse(message):
    print("[cloud-isolated-home] " + message, file=sys.stderr)
    sys.exit(2)


def info(path):
    try:
        return path.lstat()
    except FileNotFoundError:
        return None


def safe_components(path):
    for component in [path, *path.parents]:
        details = info(component)
        if details and (stat.S_ISLNK(details.st_mode) or not stat.S_ISDIR(details.st_mode)):
            refuse("scope path components must be real directories")


def owned_directory(path):
    details = info(path)
    if not details or not stat.S_ISDIR(details.st_mode) or details.st_uid != os.getuid() or details.st_mode & 0o077:
        refuse("scope directories must be owned by this user with private permissions")


try:
    root = Path(os.path.abspath(sys.argv[1]))
    checkout = str(Path(sys.argv[2]).resolve(strict=True))
    safe_components(root)
    marker = root / ".psychsift-cloud-scope.json"
    expected = {"version": 1, "checkout": checkout, "uid": os.getuid()}
    if info(root):
        owned_directory(root)
        details = info(marker)
        if not details or not stat.S_ISREG(details.st_mode) or details.st_uid != os.getuid() or details.st_size > 8192 or details.st_mode & 0o077:
            refuse("existing scope is unowned or has an unsafe ownership record")
        with marker.open(encoding="utf-8") as stream:
            if json.load(stream) != expected:
                refuse("scope belongs to another checkout or user")
    else:
        # Require an existing parent; never create an unchecked ancestor chain.
        if not root.parent.is_dir():
            refuse("scope parent must already exist")
        root.mkdir(mode=0o700)
        with marker.open("x", encoding="utf-8") as stream:
            os.chmod(marker, 0o600)
            json.dump(expected, stream, sort_keys=True)
    homes = {"HOME": root / "home", "CODEX_HOME": root / "codex", "CLAUDE_CONFIG_DIR": root / "claude"}
    # Validate all destinations before creating any missing home.
    for home in homes.values():
        safe_components(home)
        if info(home):
            owned_directory(home)
    for home in homes.values():
        home.mkdir(mode=0o700, exist_ok=True)
    environment = os.environ.copy()
    environment.update({name: str(home) for name, home in homes.items()})
    os.execvpe(sys.argv[3], sys.argv[3:], environment)
except (OSError, ValueError, TypeError):
    refuse("could not safely prepare scope or execute command; inspect local ownership and arguments")
PY
