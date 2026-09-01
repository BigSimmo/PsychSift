import { describe, expect, it } from "vitest";
import { isPublicDocument, isPublicDocumentRow, publicScopedRetrievalRowIsVisible } from "@/lib/documents";

describe("isPublicDocument helper", () => {
  it("handles null, undefined, and non-object inputs safely", () => {
    expect(isPublicDocument(null)).toBe(false);
    expect(isPublicDocument(undefined)).toBe(false);
    expect(isPublicDocument("invalid" as unknown as Record<string, unknown>)).toBe(false);
    expect(isPublicDocument(42 as unknown as Record<string, unknown>)).toBe(false);
    expect(isPublicDocument({})).toBe(false);
  });

  it("requires a null owner and the publication marker together", () => {
    expect(isPublicDocument({ owner_id: null, metadata: { public_corpus: true } })).toBe(true);
    expect(isPublicDocument({ owner_id: null, public_corpus: true })).toBe(true);
    expect(isPublicDocumentRow({ id: "doc-1", owner_id: null, metadata: { public_corpus: true } })).toBe(true);
    expect(isPublicDocument({ id: "doc-2", owner_id: "user-123", metadata: { public_corpus: true } })).toBe(false);
  });

  it("does not treat an orphaned null owner as public", () => {
    expect(isPublicDocument({ owner_id: null })).toBe(false);
    expect(isPublicDocumentRow({ id: "doc-1", owner_id: null, title: "Orphaned after user delete" })).toBe(false);
  });

  it("does not grant public access from legacy metadata aliases", () => {
    expect(isPublicDocument({ public_corpus: true })).toBe(false);
    expect(isPublicDocument({ is_public: true })).toBe(false);
    expect(isPublicDocument({ public: true })).toBe(false);
    expect(isPublicDocument({ visibility: "public" })).toBe(false);
    expect(isPublicDocument({ metadata: { public_corpus: true } })).toBe(false);
    expect(isPublicDocument({ metadata: { is_public: true } })).toBe(false);
    expect(isPublicDocument({ metadata: { visibility: "public" } })).toBe(false);
    expect(isPublicDocument({ owner_id: null, metadata: { is_public: true } })).toBe(false);
    expect(isPublicDocument({ owner_id: null, metadata: { public: true } })).toBe(false);
    expect(isPublicDocument({ owner_id: null, metadata: { visibility: "public" } })).toBe(false);
  });

  it("does not treat registry-shaped metadata as a publication", () => {
    expect(isPublicDocument({ source_kind: "registry_record" })).toBe(false);
    expect(isPublicDocument({ registry_record_kind: "service" })).toBe(false);
    expect(isPublicDocument({ metadata: { source_kind: "registry_record" } })).toBe(false);
    expect(isPublicDocument({ owner_id: null, metadata: { source_kind: "registry_record" } })).toBe(false);
  });

  it("honours explicit private flags over a published public-corpus row", () => {
    expect(isPublicDocument({ owner_id: null, private: true, public_corpus: true })).toBe(false);
    expect(isPublicDocument({ owner_id: null, is_private: true, public_corpus: true })).toBe(false);
    expect(isPublicDocument({ owner_id: null, visibility: "private", public_corpus: true })).toBe(false);
    expect(isPublicDocument({ owner_id: null, metadata: { private: true, public_corpus: true } })).toBe(false);
    expect(isPublicDocument({ owner_id: null, metadata: { is_private: true, public_corpus: true } })).toBe(false);
    expect(isPublicDocument({ owner_id: null, metadata: { visibility: "private", public_corpus: true } })).toBe(false);
  });

  it("respects owned documents without public metadata", () => {
    expect(
      isPublicDocument({
        id: "doc-3",
        owner_id: "user-abc",
        metadata: { extraction_quality: "good" },
      }),
    ).toBe(false);
  });
});

describe("publicScopedRetrievalRowIsVisible — #ZBAC9D defence in depth", () => {
  it("keeps a chunk whose document carries the published marker", () => {
    expect(publicScopedRetrievalRowIsVisible({ id: "c1", source_metadata: { public_corpus: true } })).toBe(true);
  });

  it("drops a chunk whose document was never published (the orphan case)", () => {
    expect(
      publicScopedRetrievalRowIsVisible({ id: "c2", source_metadata: { title: "Orphaned after user delete" } }),
    ).toBe(false);
    expect(publicScopedRetrievalRowIsVisible({ id: "c3", source_metadata: {} })).toBe(false);
    expect(publicScopedRetrievalRowIsVisible({ id: "c4", source_metadata: null })).toBe(true);
  });

  it("honours an explicit private marker even when public_corpus is set", () => {
    expect(
      publicScopedRetrievalRowIsVisible({ id: "c5", source_metadata: { public_corpus: true, private: true } }),
    ).toBe(false);
  });

  it("parses a JSON-encoded source_metadata payload", () => {
    expect(publicScopedRetrievalRowIsVisible({ id: "c6", source_metadata: '{"public_corpus":true}' })).toBe(true);
    expect(publicScopedRetrievalRowIsVisible({ id: "c7", source_metadata: '{"title":"orphan"}' })).toBe(false);
    // Unreadable payload is not evidence of an orphan; the foreign key is the real guard.
    expect(publicScopedRetrievalRowIsVisible({ id: "c8", source_metadata: "not json" })).toBe(true);
  });

  it("applies the full owner predicate to rows that carry owner_id", () => {
    expect(publicScopedRetrievalRowIsVisible({ id: "d1", owner_id: null, metadata: { public_corpus: true } })).toBe(
      true,
    );
    expect(publicScopedRetrievalRowIsVisible({ id: "d2", owner_id: null, metadata: {} })).toBe(false);
  });

  it("retains artifact rows, which carry their OWN metadata rather than the document's", () => {
    // f.metadata / u.metadata on table-fact and index-unit rows is not the document's
    // metadata. Judging them on it would empty every public search of those surfaces.
    expect(publicScopedRetrievalRowIsVisible({ id: "t1", metadata: { threshold_value: "30" } })).toBe(true);
    expect(publicScopedRetrievalRowIsVisible({ id: "u1", metadata: {} })).toBe(true);
    expect(publicScopedRetrievalRowIsVisible({ id: "e1", text_rank: 0.4 })).toBe(true);
  });

  it("does not judge non-object rows", () => {
    expect(publicScopedRetrievalRowIsVisible(null)).toBe(true);
    expect(publicScopedRetrievalRowIsVisible("row")).toBe(true);
  });
});
