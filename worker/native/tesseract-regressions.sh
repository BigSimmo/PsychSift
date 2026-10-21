#!/bin/sh
# Invoked in the normally configured/built Debian source directory.
set -eu

# Use builder-installed, version-recorded GoogleTest sources; no network fetch.
gtest=unittest/third_party/googletest
if [ ! -f "$gtest/googletest/src/gtest-all.cc" ]; then
  test -f /usr/src/googletest/googletest/src/gtest-all.cc
  # Debian 5.5.0 ships a non-empty stub (no sources) here; replace it.
  rm -rf "$gtest"
  ln -s /usr/src/googletest "$gtest"
fi

# These five upstream tests and the separate cleanup suite generate their own malformed/valid input bytes.
# Upstream attaches all model/font prerequisites to every test. Override only
# those coarse prerequisites to prevent unrelated model/font downloads.
make unicharset_load_test intproto_test fullyconnected_test normproto_test genericvector_test genericvector_rejected_cleanup_test \
  LANGDATA_DIR=. TESSDATA_DIR=. TESSDATA_BEST_DIR=. TESSDATA_FAST_DIR=. fonts=
mkdir -p tmp
regression_evidence_dir=$(mktemp -d)
trap 'rm -rf "$regression_evidence_dir"' EXIT HUP INT TERM
unset GTEST_SHARD_INDEX GTEST_TOTAL_SHARDS GTEST_FILTER GTEST_REPEAT GTEST_OUTPUT GTEST_SHARD_STATUS_FILE
for suite in unicharset_load_test:3 intproto_test:4 fullyconnected_test:2 normproto_test:3 genericvector_test:3 genericvector_rejected_cleanup_test:2; do
  executable=${suite%:*}
  expected=${suite#*:}
  "./$executable" --gtest_list_tests > "$regression_evidence_dir/$executable.list"
  python3 - "$regression_evidence_dir/$executable.list" "$expected" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text()
cases = re.findall(r'^  (\w+)', text, re.M)
assert len(cases) == int(sys.argv[2]), (sys.argv[1], cases)
assert not any('DISABLED_' in case for case in cases), cases
PY
  if ! "./$executable" --gtest_color=no --gtest_filter='*' --gtest_repeat=1 > "$regression_evidence_dir/$executable.log" 2>&1; then
    cat "$regression_evidence_dir/$executable.log"
    exit 1
  fi
  cat "$regression_evidence_dir/$executable.log"
  python3 - "$regression_evidence_dir/$executable.log" "$expected" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text()
passed = re.findall(r'\[  PASSED  \]\s+(\d+) tests?\.', text)
assert passed == [sys.argv[2]], (sys.argv[1], passed)
PY
done

# Upstream's CVE-2026-73066 patch has no regression test. Check rejection at
# Network::CreateFromFile using matching positive controls, without attempting
# the unsafe forward pass. This is focused deserializer proof, not OCR parity.
cat > "$regression_evidence_dir/convolve-reconfig-boundaries.cc" <<'CPP'
#include "network.h"
#include "serialis.h"
#include <climits>
#include <cstdint>
#include <cstdio>
#include <vector>

namespace {
void Put32(std::vector<char>& out, int32_t value) {
  uint32_t bits = static_cast<uint32_t>(value);
  for (int i = 0; i != 4; ++i) out.push_back(static_cast<char>((bits >> (8 * i)) & 255));
}
bool Check(tesseract::NetworkType type, int32_t ni, int32_t first,
           int32_t second, bool accept, int expected_outputs) {
  std::vector<char> bytes{static_cast<char>(type), 0, 0};
  Put32(bytes, 0);  // network flags
  Put32(bytes, ni);
  Put32(bytes, 0);  // output count recomputed by the deserializer
  Put32(bytes, 0);  // weight count
  Put32(bytes, 0);  // empty layer name
  Put32(bytes, first);
  Put32(bytes, second);
  tesseract::TFile file;
  if (!file.Open(bytes.data(), bytes.size())) return false;
  tesseract::Network* network = tesseract::Network::CreateFromFile(&file);
  bool ok = accept ? network != nullptr && network->NumOutputs() == expected_outputs
                   : network == nullptr;
  delete network;
  if (!ok) std::fprintf(stderr, "Unexpected deserializer result: type=%d ni=%d a=%d b=%d\n",
                        static_cast<int>(type), ni, first, second);
  return ok;
}
}
int main() {
  using namespace tesseract;
  struct Case { NetworkType type; int32_t ni, a, b; bool accept; int outputs; };
  const Case cases[] = {
    {NT_CONVOLVE, 2, 1, 1, true, 18},
    {NT_CONVOLVE, 1, -1, 0, false, 0},
    {NT_CONVOLVE, 0, 0, 0, false, 0},
    {NT_CONVOLVE, 1, INT_MAX, INT_MAX, false, 0},
    {NT_CONVOLVE, INT_MAX, 1, 1, false, 0},
    {NT_RECONFIG, 2, 2, 3, true, 12},
    {NT_RECONFIG, 1, 0, 1, false, 0},
    {NT_RECONFIG, 1, -1, 1, false, 0},
    {NT_RECONFIG, 0, 1, 1, false, 0},
    {NT_RECONFIG, INT_MAX, 2, 2, false, 0},
    {NT_CONVOLVE, -1, 0, 0, false, 0},
  };
  for (const auto& test : cases) {
    if (!Check(test.type, test.ni, test.a, test.b, test.accept, test.outputs)) return 1;
  }
  std::puts("CVE-2026-73066: 11 deserializer boundary cases passed (including 2 valid controls)");
  return 0;
}
CPP
set -- -I. -Iinclude -Isrc -I/usr/include/leptonica
for include_dir in src/*; do
  if [ -d "$include_dir" ]; then set -- "$@" "-I$include_dir"; fi
done
./libtool --tag=CXX --mode=link "${CXX:-c++}" -std=c++17 -DHAVE_CONFIG_H "$@" \
  "$regression_evidence_dir/convolve-reconfig-boundaries.cc" libtesseract.la \
  -o "$regression_evidence_dir/convolve-reconfig-boundaries"
"$regression_evidence_dir/convolve-reconfig-boundaries"

# Exercise the raw adapted-template ownership boundary in the actual built
# library. Assertions must remain active even when package flags define NDEBUG.
native_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
./libtool --tag=CXX --mode=link "${CXX:-c++}" -std=c++17 -DHAVE_CONFIG_H -UNDEBUG "$@" \
  "$native_dir/tesseract-adapted-templates-test.cc" libtesseract.la \
  -o "$regression_evidence_dir/adapted-template-ownership"
timeout 30 "$regression_evidence_dir/adapted-template-ownership"
