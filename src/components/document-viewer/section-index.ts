import { Compass, FileImage, FileSearch, FileText, Quote, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";

/**
 * The document page's navigable sections, derived from the loaded detail payload.
 *
 * Two rules the design depends on:
 * - A section the document does not have is omitted, never rendered disabled. A
 *   greyed row advertises something that is not there.
 * - A section whose data is still indexing reports `pending` so the list can show
 *   a spinner instead of a count of 0, which reads as empty rather than unknown.
 */
export type DocumentSection = {
  /** Matches the section's DOM anchor id in DocumentViewer. */
  id: string;
  label: string;
  icon: LucideIcon;
  detail: string;
  /**
   * Share of the document this section holds, already normalised across the
   * present sections. The track draws proportions, not equal slices: the PDF of
   * an 84-page guideline is not the same size as its indexing footnote.
   */
  weight: number;
  /** Renders as `<details name="document-viewer-section">` — an exclusive accordion. */
  collapsible: boolean;
  pending?: boolean;
};

export const documentOverviewSectionId = "document-overview";
export const documentIndexingSectionId = "source-indexing";

export type DocumentSectionIndexInput = {
  /** False while the viewer is still resolving the document (error/loading shells). */
  hasDocument: boolean;
  hasStoredSummary: boolean;
  pageCount: number;
  chunkCount: number;
  visualCount: number;
  hasIndexHealth: boolean;
  /** Page of the currently pinned evidence chunk, when one is selected. */
  pinnedPage: number | null;
  loading: boolean;
};

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Raw weights before normalisation. Each is anchored to a real magnitude so a
 * long PDF or a heavily chunked source visibly dominates the track, but every
 * section keeps a floor so a one-page document still shows seven readable
 * segments.
 */
function rawWeight(id: string, input: DocumentSectionIndexInput): number {
  switch (id) {
    case documentOverviewSectionId:
      return 1;
    case "source-summary":
      return 1.5;
    case "pdf-preview-section":
      return Math.max(2, Math.min(8, input.pageCount / 12));
    case "source-evidence":
      return 1.5;
    case "source-text":
      return Math.max(2, Math.min(6, input.chunkCount / 60));
    case "source-images":
      return Math.max(1, Math.min(4, input.visualCount / 3));
    case documentIndexingSectionId:
      return 0.5;
    default:
      return 1;
  }
}

export function buildDocumentSectionIndex(input: DocumentSectionIndexInput): DocumentSection[] {
  if (!input.hasDocument) return [];

  // Match DocumentViewer DOM / scroll order: main column (overview → PDF →
  // evidence → clinical summary card → text) then the aside rail (visuals →
  // indexing). The rail's source-summary is max-sm:hidden, so phones spy the
  // in-flow card. Putting summary after text makes the phone position track
  // jump backward when the reader reaches indexed text after the card.
  const present: Array<Omit<DocumentSection, "weight">> = [
    {
      id: documentOverviewSectionId,
      label: "Overview",
      icon: Compass,
      detail: input.pageCount > 0 ? plural(input.pageCount, "page") : "Document",
      collapsible: false,
    },
  ];

  // The matching passage sits above the page and only exists when one is pinned.
  if (input.pinnedPage) {
    present.push({
      id: "source-evidence",
      label: "Matching passage",
      icon: Quote,
      detail: `Page ${input.pinnedPage}`,
      collapsible: false,
    });
  }

  present.push({
    id: "pdf-preview-section",
    label: "PDF preview",
    icon: FileText,
    detail: input.pageCount > 0 ? plural(input.pageCount, "page") : "Preview",
    collapsible: false,
  });

  if (input.hasStoredSummary) {
    present.push({
      id: "source-summary",
      label: "High-yield summary",
      icon: Sparkles,
      detail: "Clinical profile",
      collapsible: true,
    });
  }

  present.push({
    id: "source-text",
    label: "Page text",
    icon: FileSearch,
    detail: input.loading ? "Indexing" : plural(input.chunkCount, "chunk"),
    // Condensed view renders IndexedTextPanel as a disclosure; full view keeps
    // it open, while the same navigation row remains valid in both states.
    collapsible: true,
    pending: input.loading,
  });

  // Omitted entirely when the document has no indexed visuals: there is nothing
  // to navigate to, and a disabled row would claim otherwise.
  if (input.loading || input.visualCount > 0) {
    present.push({
      id: "source-images",
      label: "Tables and diagrams",
      icon: FileImage,
      detail: input.loading ? "Indexing" : plural(input.visualCount, "visual"),
      collapsible: true,
      pending: input.loading,
    });
  }

  if (input.hasIndexHealth) {
    present.push({
      id: documentIndexingSectionId,
      label: "About this file",
      icon: ShieldCheck,
      detail: "Provenance",
      collapsible: true,
    });
  }

  const weights = present.map((section) => rawWeight(section.id, input));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  return present.map((section, index) => ({ ...section, weight: weights[index] / total }));
}
