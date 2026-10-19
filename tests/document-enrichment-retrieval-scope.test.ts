import { describe, expect, it } from "vitest";
import { fetchRelatedDocumentMetadata } from "../src/lib/document-enrichment";
import { documentMetadataFixture } from "./helpers/document-metadata-fixture";

const documents = [
  { id: "owned", owner_id: "owner-a", status: "indexed", metadata: {} },
  { id: "public", owner_id: null, status: "indexed", metadata: { public_corpus: true } },
  { id: "unpublished", owner_id: null, status: "indexed", metadata: {} },
  { id: "foreign", owner_id: "owner-b", status: "indexed", metadata: {} },
  { id: "queued", owner_id: "owner-a", status: "queued", metadata: {} },
];
const ids = documents.map((doc) => doc.id);
function fixture(options: Parameters<typeof documentMetadataFixture>[1] = {}) {
  return documentMetadataFixture(
    {
      documents,
      document_labels: documents.map((doc) => ({
        id: doc.id,
        document_id: doc.id,
        owner_id: doc.owner_id,
        label: doc.id,
        metadata: {},
      })),
      document_summaries: documents.map((doc) => ({
        id: doc.id,
        document_id: doc.id,
        owner_id: doc.owner_id,
        summary: doc.id,
        metadata: {},
      })),
    },
    options,
  );
}

describe("related-document metadata source-row access", () => {
  it.each([
    [{ ownerId: "owner-a", includePublic: true }, ["owned", "public"]],
    [{ ownerId: "owner-a", includePublic: false }, ["owned"]],
    [{ includePublic: true }, ["public"]],
  ] as const)("admits only indexed parents in scope %j", async (accessScope, admitted) => {
    const supabase = fixture();
    const rows = await fetchRelatedDocumentMetadata({ supabase: supabase as never, accessScope, documentIds: ids });
    expect(rows.filter((row) => row.summary).map((row) => row.document_id)).toEqual(admitted);
    expect(rows.filter((row) => row.labels.length).map((row) => row.document_id)).toEqual(admitted);
  });

  it.each(["document_labels", "document_summaries"])(
    "propagates %s permission errors without an alternate path",
    async (failedTable) => {
      const error = Object.assign(new Error("permission denied"), { code: "42501" });
      const supabase = fixture({ failedTable, error });
      await expect(fetchRelatedDocumentMetadata({ supabase: supabase as never, documentIds: ids })).rejects.toBe(error);
      expect(supabase.from).not.toHaveBeenCalledWith("documents");
    },
  );

  it("does not start any lookup after caller cancellation", async () => {
    const controller = new AbortController();
    const reason = new DOMException("metadata cancelled", "AbortError");
    controller.abort(reason);
    const supabase = fixture();
    await expect(
      fetchRelatedDocumentMetadata({ supabase: supabase as never, documentIds: ids, signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("preserves the caller's abort reason over a returned error envelope", async () => {
    const controller = new AbortController();
    const reason = new DOMException("metadata cancelled", "AbortError");
    const supabase = fixture({ onRead: () => controller.abort(reason) });
    await expect(
      fetchRelatedDocumentMetadata({ supabase: supabase as never, documentIds: ids, signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(supabase.from).not.toHaveBeenCalledWith("documents");
  });

  it("reads beyond hidden and staged rows occupying two API pages", async () => {
    const labels = Array.from({ length: 1000 }, (_, index) => ({
      id: String(index).padStart(4, "0"),
      document_id: "owned",
      owner_id: "owner-a",
      label: `hidden-${index}`,
      metadata: index < 500 ? { hidden: true } : { index_generation_id: "staged" },
    }));
    const supabase = documentMetadataFixture({
      documents: [{ ...documents[0], metadata: { index_generation_id: "committed" } }],
      document_labels: [
        ...labels,
        {
          id: "1000",
          document_id: "owned",
          owner_id: "owner-a",
          label: "visible",
          metadata: { index_generation_id: "committed" },
        },
      ],
    });
    const rows = await fetchRelatedDocumentMetadata({
      supabase: supabase as never,
      ownerId: "owner-a",
      documentIds: ["owned"],
    });
    expect(rows[0].labels.map((label) => label.label)).toEqual(["visible"]);
    expect(supabase.queries.find((query) => query.table === "document_labels")?.ranges).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
  });
});
