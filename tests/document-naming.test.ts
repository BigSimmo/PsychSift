import { describe, expect, it } from "vitest";
import { documentTitleKey, planDocumentName, smartDocumentTitle } from "../src/lib/document-naming";

function supabaseWithDocuments(documents: unknown[]) {
  // Minimal stub of the query chain planDocumentName uses, paged like PostgREST.
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            range: async (from: number, to: number) => ({ data: documents.slice(from, to + 1), error: null }),
          }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof planDocumentName>[0]["supabase"];
}

describe("document naming", () => {
  it("creates readable titles from compact clinical filenames", () => {
    expect(smartDocumentTitle("MHSP.AgitationArousalPharmaMgt.pdf")).toBe(
      "MHSP - Agitation Arousal Pharmacological Management",
    );
    expect(smartDocumentTitle("clozapine_pres_admin_monitor_v5.0.pdf")).toBe(
      "Clozapine Prescribing Administering Monitoring V5.0",
    );
  });

  it("uses stable duplicate keys for equivalent names", () => {
    expect(documentTitleKey("Guideline (Copy 2)")).toBe(documentTitleKey("Guideline"));
  });

  it("keeps first upload title clean when no same-name document exists", async () => {
    const plan = await planDocumentName({
      supabase: supabaseWithDocuments([]),
      ownerId: "owner",
      fileName: "guideline.pdf",
      contentHash: "hash-1",
    });

    expect(plan).toMatchObject({
      title: "Guideline",
      baseTitle: "Guideline",
      duplicateIndex: 1,
      duplicateReason: "none",
    });
  });

  it("adds a clear suffix when a different document has the same title or filename", async () => {
    const plan = await planDocumentName({
      supabase: supabaseWithDocuments([
        { id: "doc-1", title: "Guideline", file_name: "guideline.pdf", content_hash: "hash-1" },
      ]),
      ownerId: "owner",
      fileName: "guideline.pdf",
      contentHash: "hash-2",
    });

    expect(plan).toMatchObject({
      title: "Guideline (Copy 2)",
      baseTitle: "Guideline",
      duplicateIndex: 2,
      duplicateReason: "same_title_or_filename",
    });
  });

  it("finds a same-title document beyond the first page of owner documents", async () => {
    const others = Array.from({ length: 1500 }, (_, index) => ({
      id: `doc-${String(index).padStart(4, "0")}`,
      title: `Unrelated Policy ${index}`,
      file_name: `unrelated-${index}.pdf`,
      content_hash: `hash-other-${index}`,
    }));
    others[1200] = { id: "doc-1200", title: "Guideline", file_name: "guideline.pdf", content_hash: "hash-1" };
    const plan = await planDocumentName({
      supabase: supabaseWithDocuments(others),
      ownerId: "owner",
      fileName: "guideline.pdf",
      contentHash: "hash-2",
    });

    expect(plan).toMatchObject({ title: "Guideline (Copy 2)", duplicateReason: "same_title_or_filename" });
  });

  it("matches a renamed document by its current title when the stored group key is stale", async () => {
    // Renames update title but preserve metadata, so smart_title_group_key can lag.
    const plan = await planDocumentName({
      supabase: supabaseWithDocuments([
        {
          id: "doc-1",
          title: "Clozapine Prescribing",
          file_name: "source.pdf",
          content_hash: "hash-1",
          metadata: { smart_title_group_key: "source" },
        },
      ]),
      ownerId: "owner",
      fileName: "clozapine_prescribing.pdf",
      requestedTitle: "Clozapine Prescribing",
      contentHash: "hash-2",
    });

    expect(plan).toMatchObject({
      title: "Clozapine Prescribing (Copy 2)",
      duplicateReason: "same_title_or_filename",
    });
  });

  it("prefers a version/date suffix from the uploaded filename when available", async () => {
    const plan = await planDocumentName({
      supabase: supabaseWithDocuments([
        { id: "doc-1", title: "Clozapine Prescribing", file_name: "clozapine_prescribing.pdf", content_hash: "hash-1" },
      ]),
      ownerId: "owner",
      fileName: "clozapine_prescribing_v5.0.pdf",
      requestedTitle: "Clozapine Prescribing",
      contentHash: "hash-2",
    });

    expect(plan.title).toBe("Clozapine Prescribing (v5.0)");
  });
});
