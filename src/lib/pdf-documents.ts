/**
 * Owner rule (2026-10-04): only PDFs count as documents in the Documents lists.
 * Registry entries (medications, forms, services, differentials) have their own
 * pages, and Word, Excel and text files stay searchable for answers but are not
 * listed. This is a display rule only; retrieval and answers are unaffected.
 */
export function isPdfDocument(document: { file_name?: string | null; file_type?: string | null }) {
  if (document.file_type) return document.file_type === "application/pdf";
  return /\.pdf$/i.test(document.file_name ?? "");
}
