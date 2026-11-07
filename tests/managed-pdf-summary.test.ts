import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prepareManagedPdfSummaryContext, expectedManagedPdfSummaryBody } from "../worker/managed-pdf-summary";
const documentId = "78000000-0000-4000-8000-000000000001";
const generationId = "78000000-0000-4000-8000-000000000002";
const chunkId = "78000000-0000-4000-8000-000000000003";
const original = Buffer.from("%PDF-synthetic source");
const sourceSha256 = `sha256:${createHash("sha256").update(original).digest("hex")}`;
function fixture() {
  const inspection = {
    sourceSha256,
    pages: [{ pageNumber: 1, text: "Synthetic source: retain the final qualification." }],
  };
  return {
    document: { id: documentId, title: "Synthetic source", file_name: "synthetic.pdf", source_path: null },
    packet: {
      identity: { documentId, generationId, sourceSha256 },
      inspection,
      rows: {
        chunks: [
          {
            id: chunkId,
            document_id: documentId,
            index_generation_id: generationId,
            page_number: 1,
            chunk_index: 0,
            content: inspection.pages[0].text,
            section_heading: null,
            metadata: { index_generation_id: generationId },
          },
        ],
        images: [],
      },
    },
  };
}
describe("managed candidate summary source binding", () => {
  it("independently rebuilds the exact request from captured admitted rows", () => {
    const input = fixture();
    const context = prepareManagedPdfSummaryContext(input);
    const body = expectedManagedPdfSummaryBody(context, input.packet.inspection, original);
    expect(body).toBe(context.plan.requestBody);
    input.packet.rows.chunks[0].content = "Changed after capture";
    expect(expectedManagedPdfSummaryBody(context, context.inspection, original)).toBe(body);
  });
  it("refuses raw chunks that do not exactly cover inspected page text", () => {
    const input = fixture();
    input.packet.rows.chunks[0].content = "Unreviewed hidden material";
    expect(() => prepareManagedPdfSummaryContext(input)).toThrow("managed_pdf_summary_source_coverage");
  });
  it("refuses changed original bytes, current inspection or a JSON-cloned context", () => {
    const input = fixture();
    const context = prepareManagedPdfSummaryContext(input);
    expect(() => expectedManagedPdfSummaryBody(context, context.inspection, Buffer.from("%PDF-changed"))).toThrow(
      "managed_pdf_summary_current_source",
    );
    expect(() => expectedManagedPdfSummaryBody(context, { ...context.inspection, pages: [] }, original)).toThrow(
      "managed_pdf_summary_current_source",
    );
    expect(() =>
      expectedManagedPdfSummaryBody(JSON.parse(JSON.stringify(context)), context.inspection, original),
    ).toThrow("managed_pdf_summary_context_required");
  });
  it("refuses mixed generation or cross-document anchors", () => {
    const input = fixture();
    input.packet.rows.chunks[0].index_generation_id = documentId;
    expect(() => prepareManagedPdfSummaryContext(input)).toThrow("managed_pdf_summary_row_identity");
  });
  it("retains document policy metadata in the captured source input", () => {
    const input = fixture();
    const metadata = { public_corpus: true, source_policy_checked: false };
    const context = prepareManagedPdfSummaryContext({ ...input, document: { ...input.document, metadata } });
    expect(context.sourceInput.document.metadata).toEqual(metadata);
  });
  it("refuses source policy violations before preparing a summary request", () => {
    const input = fixture();
    expect(() =>
      prepareManagedPdfSummaryContext({
        ...input,
        document: {
          ...input.document,
          metadata: { corpus_scope: "australian_public", forbidden_source_identity: "synthetic-prohibited-source" },
        },
      }),
    ).toThrow("protected_source_identity");
  });
});
