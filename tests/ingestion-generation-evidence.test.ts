import { describe, expect, it } from "vitest";
import {
  generationEvidenceDigest,
  parseSourceExpectation,
  pageStorageSnapshot,
  visiblePageGeneration,
  assertPageStorageSnapshot,
} from "@/lib/ingestion-generation-evidence";

const documentId = "00000000-0000-4000-8000-000000000001";
const generation = "00000000-0000-4000-8000-000000000002";
const digest = `sha256:${"a".repeat(64)}`;
describe("retained generation prerequisite refusal", () => {
  it("keeps ordinary old-pointer/null-page display legacy and refuses exact v1 lookup", () => {
    const legacy = pageStorageSnapshot({
      id: documentId,
      page_storage_mode: "legacy_unqualified",
      metadata: { index_generation_id: generation },
    });
    expect(visiblePageGeneration(legacy)).toBeNull();
    expect(() => visiblePageGeneration(legacy, generation)).toThrow("unqualified_legacy_pages");
    expect(() => visiblePageGeneration(legacy, null)).toThrow("unqualified_legacy_pages");
  });
  it("selects only the captured typed generation and refuses a changed pointer or mode", () => {
    const typed = pageStorageSnapshot({
      id: documentId,
      page_storage_mode: "typed_exact",
      metadata: { index_generation_id: generation },
    });
    expect(visiblePageGeneration(typed)).toBe(generation);
    expect(() => visiblePageGeneration(typed, documentId)).toThrow("page_generation_mismatch");
    expect(() =>
      assertPageStorageSnapshot(typed, {
        id: documentId,
        page_storage_mode: "legacy_unqualified",
        metadata: { index_generation_id: generation },
      }),
    ).toThrow("page_storage_changed");
    expect(() => pageStorageSnapshot({ id: documentId, page_storage_mode: "typed_exact", metadata: {} })).toThrow();
  });
  it("accepts a null-key legacy pointer while typed storage still requires a valid pointer", () => {
    const legacy = pageStorageSnapshot({ id: documentId, metadata: { index_generation_id: null } });
    expect(visiblePageGeneration(legacy)).toBeNull();
    expect(() => visiblePageGeneration(legacy, null)).toThrow("unqualified_legacy_pages");
    expect(() =>
      pageStorageSnapshot({
        id: documentId,
        page_storage_mode: "typed_exact",
        metadata: { index_generation_id: null },
      }),
    ).toThrow("typed_page_pointer_mismatch");
  });
  it("keeps a required unknown original expectation unavailable without accepting completeness flags", () => {
    const unknown = {
      version: 1,
      sourceSha256: digest,
      tag: "unknown",
      units: null,
      witness: null,
      limitation: "independent_original_expectation_not_available",
    };
    expect(parseSourceExpectation(unknown).tag).toBe("unknown");
    expect(() => parseSourceExpectation({ ...unknown, complete: true })).toThrow();
    expect(() => parseSourceExpectation({ ...unknown, tag: "known", units: [], limitation: null })).toThrow();
  });
  it("refuses caller accessors before reading or hashing them", () => {
    let reads = 0;
    const value = Object.defineProperty({}, "version", {
      enumerable: true,
      get() {
        reads++;
        return 1;
      },
    });
    expect(() => parseSourceExpectation(value)).toThrow();
    expect(() => generationEvidenceDigest(value)).toThrow();
    expect(reads).toBe(0);
  });
  it("rejects an inherited array map and holes disguised by extra own keys", () => {
    let calls = 0;
    const inheritedMap = [1];
    Object.setPrototypeOf(inheritedMap, {
      map() {
        calls++;
        return [];
      },
    });
    expect(() => generationEvidenceDigest(inheritedMap)).toThrow("generation_evidence_requires_plain_data");
    expect(calls).toBe(0);
    const sparse = new Array(1);
    Object.defineProperty(sparse, "foo", { enumerable: true, value: 1 });
    expect(() => generationEvidenceDigest(sparse)).toThrow("generation_evidence_array_hole");
  });
});
