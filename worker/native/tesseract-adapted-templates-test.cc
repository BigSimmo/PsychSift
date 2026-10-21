// Synthetic legacy-template ownership controls against the actual built parser.
#include "adaptive.h"
#include "classify.h"
#include "serialis.h"

#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace tesseract;
using Bytes = std::vector<char>;

template <typename T> void Append(Bytes &bytes, const T &value) {
  const auto *p = reinterpret_cast<const char *>(&value);
  bytes.insert(bytes.end(), p, p + sizeof(value));
}

void Poison(Bytes &bytes, size_t offset) {
  const uintptr_t invalid = 1;
  std::memcpy(bytes.data() + offset, &invalid, sizeof(invalid));
}

Bytes ClassHeader() {
  ADAPT_CLASS_STRUCT header;
  Bytes bytes;
  Append(bytes, header);
  Poison(bytes, offsetof(ADAPT_CLASS_STRUCT, PermProtos));
  Poison(bytes, offsetof(ADAPT_CLASS_STRUCT, PermConfigs));
  Poison(bytes, offsetof(ADAPT_CLASS_STRUCT, TempProtos));
  for (int i = 0; i < MAX_NUM_CONFIGS; ++i) {
    Poison(bytes, offsetof(ADAPT_CLASS_STRUCT, Config) + i * sizeof(ADAPTED_CONFIG));
  }
  return bytes;
}

Bytes ClassData(int protos, int configs, bool permanent = false) {
  Bytes bytes = ClassHeader();
  for (int i = 0; i < WordsInVectorOfSize(MAX_NUM_PROTOS); ++i) Append(bytes, uint32_t{0});
  for (int i = 0; i < WordsInVectorOfSize(MAX_NUM_CONFIGS); ++i) {
    Append(bytes, uint32_t{permanent && i == 0 ? 1u : 0u});
  }
  Append(bytes, protos);
  for (int i = 0; i < protos && i <= MAX_NUM_PROTOS; ++i) {
    TEMP_PROTO_STRUCT proto{};
    Append(bytes, proto);
  }
  Append(bytes, configs);
  return bytes;
}

ADAPT_CLASS_STRUCT *ReadClass(const Bytes &bytes) {
  TFile file;
  assert(file.Open(bytes.data(), bytes.size()));
  return ReadAdaptedClass(&file);
}

void RejectClass(const Bytes &bytes) {
  auto *result = ReadClass(bytes);
  assert(result == nullptr);
}

Bytes TempConfig() {
  TEMP_CONFIG_STRUCT config(0, 7);
  Bytes bytes;
  Append(bytes, config);
  Poison(bytes, offsetof(TEMP_CONFIG_STRUCT, Protos));
  Append(bytes, uint32_t{1});
  return bytes;
}

void Check(const std::string &name) {
  if (name == "short-template-pointer" || name == "partial-template-pointer" ||
      name == "near-full-template-header") {
    ADAPT_TEMPLATES_STRUCT header;
    Bytes bytes;
    Append(bytes, header);
    Poison(bytes, offsetof(ADAPT_TEMPLATES_STRUCT, Templates));
    size_t size = name == "partial-template-pointer" ? 1 : sizeof(uintptr_t);
    if (name == "near-full-template-header") size = sizeof(header) - 1;
    bytes.resize(size);
    TFile file;
    assert(file.Open(bytes.data(), bytes.size()));
    Classify classifier;
    auto *result = classifier.ReadAdaptedTemplates(&file);
    assert(result == nullptr);
  } else if (name == "negative-prototype-count") {
    RejectClass(ClassData(-1, 0));
  } else if (name == "oversized-prototype-count") {
    RejectClass(ClassData(MAX_NUM_PROTOS + 1, 0));
  } else if (name == "short-class-header") {
    auto bytes = ClassHeader();
    bytes.resize(sizeof(ADAPT_CLASS_STRUCT) - 1);
    RejectClass(bytes);
  } else if (name == "short-bitvectors") {
    RejectClass(ClassHeader());
  } else if (name == "short-prototype-count") {
    auto bytes = ClassData(0, 0);
    bytes.resize(sizeof(ADAPT_CLASS_STRUCT) +
                 sizeof(uint32_t) * (WordsInVectorOfSize(MAX_NUM_PROTOS) +
                                     WordsInVectorOfSize(MAX_NUM_CONFIGS)) + 1);
    RejectClass(bytes);
  } else if (name == "short-prototype") {
    auto bytes = ClassData(1, 0);
    bytes.resize(bytes.size() - sizeof(int) - 1);
    RejectClass(bytes);
  } else if (name == "owned-list-invalid-config-count") {
    RejectClass(ClassData(1, -1));
  } else if (name == "owned-list-oversized-config-count") {
    RejectClass(ClassData(1, MAX_NUM_CONFIGS + 1));
  } else if (name == "short-config-count") {
    auto bytes = ClassData(1, 0);
    bytes.resize(bytes.size() - 1);
    RejectClass(bytes);
  } else if (name == "short-temp-config") {
    auto bytes = ClassData(1, 1);
    auto config = TempConfig();
    bytes.insert(bytes.end(), config.begin(), config.end() - 1);
    RejectClass(bytes);
  } else if (name == "short-permanent-config") {
    auto bytes = ClassData(1, 1, true);
    Append(bytes, uint8_t{2});
    Append(bytes, UNICHAR_ID{5});
    RejectClass(bytes);
  } else if (name == "empty-class-control" || name == "owned-list-control") {
    auto *result = ReadClass(ClassData(name == "empty-class-control" ? 0 : 1, 0));
    assert(result != nullptr);
    assert((result->TempProtos != NIL_LIST) == (name == "owned-list-control"));
    for (const auto &config : result->Config) assert(config.Temp == nullptr);
    delete result;
  } else if (name == "temporary-config-control") {
    auto bytes = ClassData(1, 1);
    auto config = TempConfig();
    bytes.insert(bytes.end(), config.begin(), config.end());
    auto *result = ReadClass(bytes);
    assert(result != nullptr);
    assert(result->Config[0].Temp->FontinfoId == 7);
    assert(result->Config[0].Temp->Protos[0] == 1);
    delete result;
  } else if (name == "permanent-config-control") {
    auto bytes = ClassData(1, 1, true);
    Append(bytes, uint8_t{1});
    Append(bytes, UNICHAR_ID{5});
    Append(bytes, int{9});
    auto *result = ReadClass(bytes);
    assert(result != nullptr);
    assert(result->Config[0].Perm->Ambigs[0] == 5);
    assert(result->Config[0].Perm->Ambigs[1] == -1);
    assert(result->Config[0].Perm->FontinfoId == 9);
    delete result;
  } else if (name == "empty-template-roundtrip") {
    Classify classifier;
    ADAPT_TEMPLATES_STRUCT templates;
    templates.Templates = new INT_TEMPLATES_STRUCT;
    FILE *out = std::tmpfile();
    assert(out != nullptr);
    classifier.WriteAdaptedTemplates(out, &templates);
    assert(std::fseek(out, 0, SEEK_END) == 0);
    const long size = std::ftell(out);
    assert(size > 0);
    Bytes bytes(static_cast<size_t>(size));
    std::rewind(out);
    assert(std::fread(bytes.data(), 1, bytes.size(), out) == bytes.size());
    std::fclose(out);
    TFile file;
    assert(file.Open(bytes.data(), bytes.size()));
    auto *result = classifier.ReadAdaptedTemplates(&file);
    assert(result != nullptr && result->Templates->NumClasses == 0);
    delete result;
  } else {
    assert(false && "unknown test case");
  }
  std::printf("PASS %s\n", name.c_str());
}

int main(int argc, char **argv) {
  const char *cases[] = {
      "short-template-pointer", "partial-template-pointer", "near-full-template-header",
      "negative-prototype-count", "oversized-prototype-count", "short-class-header",
      "short-bitvectors", "short-prototype-count", "short-prototype", "short-config-count",
      "owned-list-invalid-config-count", "owned-list-oversized-config-count",
      "short-temp-config", "short-permanent-config", "empty-class-control",
      "owned-list-control", "temporary-config-control", "permanent-config-control",
      "empty-template-roundtrip"};
  if (argc == 2) {
    Check(argv[1]);
    return 0;
  }
  assert(argc == 1);
  for (const char *name : cases) Check(name);
  std::puts("Adapted template ownership: 19 controls passed");
  return 0;
}
