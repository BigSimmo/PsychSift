#!/bin/sh
# Run only after the normal Debian source package build, from its source root.
set -eu
source_dir=$(pwd -P)
native_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
build_dir="$source_dir/builddir/main"
library="$build_dir/.libs/libxml2.so.2"
test -f "$library"
test -f "$build_dir/include/libxml/xmlversion.h"
test -f "$source_dir/include/libxml/parser.h"
command -v timeout >/dev/null
command -v cc >/dev/null
export LC_ALL=C

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
trap 'exit 1' HUP INT TERM
# Directly link the built .so.2; the harness also verifies the loaded object's
# resolved path with dladdr, so an installed baseline cannot satisfy this test.
timeout 30 cc -std=c99 -Wall -Wextra -Werror -UNDEBUG \
  -I"$build_dir/include" -I"$source_dir/include" \
  "$native_dir/libxml2-tests/xinclude-options-2.9.c" "$library" \
  -Wl,-rpath,"$build_dir/.libs" -ldl -o "$test_dir/xinclude-options"
LD_LIBRARY_PATH="$build_dir/.libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH
timeout 30 "$test_dir/xinclude-options" \
  "$native_dir/libxml2-tests/issue1120-1.xml" \
  "$native_dir/libxml2-tests/issue1120-2.xml" "$library"

# Debian builds each supported Python binding against this same main library.
# Require actual built modules; an installed baseline cannot satisfy the test.
bindings_found=0
for bindings_dir in "$build_dir"/python*; do
  [ -d "$bindings_dir" ] || continue
  interpreter=${bindings_dir##*/}
  command -v "$interpreter" >/dev/null
  test -f "$bindings_dir/.libs/libxml2mod.so"
  bindings_found=$((bindings_found + 1))
  PYTHONPATH="$bindings_dir/.libs" PYTHONMALLOC=malloc timeout 30 "$interpreter" \
    "$native_dir/libxml2-tests/python-sax-enumeration.py" "$bindings_dir/.libs"
done
test "$bindings_found" -gt 0
