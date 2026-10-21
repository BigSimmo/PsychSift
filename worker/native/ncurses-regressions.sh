#!/bin/sh
# Run from the completed, normally built Debian ncurses source directory.
# Optional ASan evidence uses an independently instrumented infocmp:
# NCURSES_TEST_INFOCMP=/absolute/path/to/asan/infocmp \
# NCURSES_REQUIRE_ASAN=1 sh /tmp/worker-native/ncurses-regressions.sh
# This does not change Debian package build flags or claim ASan coverage for
# the ordinary package binary. The same full-size fixture is used in both modes.
set -eu

source_dir=$(pwd -P)
infocmp=${NCURSES_TEST_INFOCMP:-$source_dir/obj-wide/progs/infocmp}
tic=${NCURSES_TEST_TIC:-$source_dir/obj-wide/progs/tic}
test -x "$infocmp"
test -x "$tic"
command -v timeout >/dev/null
command -v python3 >/dev/null
export LC_ALL=C
LD_LIBRARY_PATH="$source_dir/obj-wide/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH

if [ "${NCURSES_REQUIRE_ASAN:-0}" = 1 ]; then
  # Require instrumentation, rather than labelling an ordinary run as ASan.
  readelf --dyn-syms --wide "$infocmp" | awk '
    $8 ~ /^__asan_init(@|$)/ { found = 1 }
    END { exit !found }
  '
  ASAN_OPTIONS="${ASAN_OPTIONS:+$ASAN_OPTIONS:}halt_on_error=1:abort_on_error=1"
  export ASAN_OPTIONS
fi

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
trap 'exit 1' HUP INT TERM
TERMINFO="$test_dir/db"
TERMINFO_DIRS="$TERMINFO"
export TERMINFO TERMINFO_DIRS
mkdir "$TERMINFO"

python3 - "$test_dir" <<'PY'
from pathlib import Path
import sys

directory = Path(sys.argv[1])
# 6402 decoded bytes: above the 4096-byte MAX_TERMINFO_LENGTH, with the
# ordinary is2 analysis forcing comparison against this unrelated long sgr.
long_sgr = "\\E[" + ";".join(["1234567"] * 800) + "m"
assert len(long_sgr.replace("\\E", "\x1b")) == 6402
entries = (
    "psychsift-ncurses-control|synthetic normal control,\n"
    "\tcols#80, lines#24, is2=\\E[0m, sgr=\\E[1m,\n\n"
    "psychsift-ncurses-long|synthetic long SGR regression,\n"
    "\tcols#80, lines#24, is2=\\E[0m, sgr=" + long_sgr + ",\n"
)
(directory / "fixtures.ti").write_text(entries, encoding="ascii")
(directory / "expected-sgr.txt").write_text("sgr=" + long_sgr + ",", encoding="ascii")
PY

# Each executable invocation is bounded. Any crash, sanitizer report, compiler
# rejection or dropped/truncated capability fails the test.
timeout 20 "$tic" -x -o "$TERMINFO" "$test_dir/fixtures.ti"
timeout 20 "$infocmp" -1 -x psychsift-ncurses-long >"$test_dir/long-dump.txt"
python3 - "$test_dir" <<'PY'
from pathlib import Path
import sys

directory = Path(sys.argv[1])
expected = (directory / "expected-sgr.txt").read_text(encoding="ascii")
actual = (directory / "long-dump.txt").read_text(encoding="ascii").splitlines()
assert expected in [line.strip() for line in actual], "long sgr was truncated or omitted"
PY
timeout 20 "$infocmp" -i psychsift-ncurses-control >"$test_dir/control.txt"
timeout 20 "$infocmp" -i psychsift-ncurses-long >"$test_dir/long.txt"
python3 - "$test_dir" <<'PY'
from pathlib import Path
import sys

directory = Path(sys.argv[1])
control = (directory / "control.txt").read_text(encoding="ascii")
actual = (directory / "long.txt").read_text(encoding="ascii")
assert control == "is2: {SGR:NORMAL}\n", repr(control)
assert actual == control, "long unrelated sgr changed ordinary init-string analysis"
PY
printf '%s\n' 'ncurses CVE-2025-69720: full-size long-SGR and ordinary-control regressions passed'
