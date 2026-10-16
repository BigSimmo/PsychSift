import { describe, expect, it } from "vitest";
import { withOriginalSectionEligibility } from "../src/lib/rag/rag-original-section-eligibility";
import { createPublishedOriginalReceiptCapture } from "../src/lib/rag/rag-source-block";
import type { SearchResult } from "../src/lib/types";

const docA = "11111111-1111-4111-8111-111111111111";
const docB = "22222222-2222-4222-8222-222222222222";

function row(id: string, documentId: string, claimsV2: boolean): SearchResult {
  return {
    id,
    document_id: documentId,
    content: `synthetic content ${id}`,
    source_metadata: claimsV2 ? { publication_manifest_version: 2 } : {},
  } as unknown as SearchResult;
}

describe("original-section projection of a mixed selection", () => {
  it("returns null when no row claims a V2 publication", () => {
    const capture = createPublishedOriginalReceiptCapture();
    expect(capture.projectSelectedResults([row("r1", docA, false), row("r2", docB, false)])).toBeNull();
  });

  it("falls back to baseline packing when a V2 row is selected beside a row that never claimed V2", () => {
    const capture = createPublishedOriginalReceiptCapture();
    expect(capture.projectSelectedResults([row("r1", docA, true), row("r2", docB, false)])).toBeNull();
  });

  it("falls back to baseline packing when V2 rows come from more than one document", () => {
    const capture = createPublishedOriginalReceiptCapture();
    expect(capture.projectSelectedResults([row("r1", docA, true), row("r2", docB, true)])).toBeNull();
  });

  it("still fails closed when a wholly V2, single-document selection has no verified receipt", () => {
    const capture = createPublishedOriginalReceiptCapture();
    expect(() => capture.projectSelectedResults([row("r1", docA, true), row("r2", docA, true)])).toThrow(
      expect.objectContaining({ name: "OriginalSectionLayoutBindingError" }),
    );
  });
});

describe("original-section eligibility before the answer caches", () => {
  const loader = async () => null;
  const base = { ownerId: docA, loadRegisteredPublishedOriginalSectionLayout: loader } as unknown as Parameters<
    typeof withOriginalSectionEligibility
  >[0];

  it("keeps caches for a signed-in question that cannot use original-section delivery", () => {
    const args = withOriginalSectionEligibility({ ...base, query: "lithium starting dose" });
    expect(args.loadRegisteredPublishedOriginalSectionLayout).toBeUndefined();
    expect(args.skipCache).toBeUndefined();
  });

  it("keeps caches for a document-scoped summary", () => {
    const args = withOriginalSectionEligibility({
      ...base,
      query: "Summarize the discharge guidance",
      documentId: docA,
    });
    expect(args.loadRegisteredPublishedOriginalSectionLayout).toBeUndefined();
    expect(args.skipCache).toBeUndefined();
  });

  it("bypasses caches only for an unscoped broad summary that can use the loader", () => {
    const args = withOriginalSectionEligibility({ ...base, query: "Summarize the discharge guidance" });
    expect(args.loadRegisteredPublishedOriginalSectionLayout).toBe(loader);
    expect(args.skipCache).toBe(true);
  });

  it("leaves requests without the loader untouched", () => {
    const plain = { query: "Summarize the discharge guidance" } as Parameters<typeof withOriginalSectionEligibility>[0];
    expect(withOriginalSectionEligibility(plain)).toBe(plain);
  });
});
