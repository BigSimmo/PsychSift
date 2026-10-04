// Compact document identity and task controls. The embedded source follows this
// card immediately; extracted summaries and text deliberately sit after it.
import { Download, Loader2, MoreHorizontal, Search, Sparkles } from "lucide-react";
import type { MouseEventHandler } from "react";
import { documentDisplayTitle, documentOrganizationProfile } from "@/components/DocumentOrganizationBadges";
import { formatDocumentLabelDisplay } from "@/lib/document-tags";
import {
  DocumentActionAnchor,
  DocumentActionButton,
  DocumentFileTile,
  DocumentMetaRow,
  documentFileKind,
  documentTileTone,
} from "@/components/clinical-dashboard/document-ui";
import { cn, panel, floatingControl, primaryControl, SourceStatusBadge } from "@/components/ui-primitives";
import type { ClinicalDocument } from "@/lib/types";
import type { PageRow } from "./types";

const primaryButton = primaryControl;
const secondaryButton = floatingControl;

function compactDocumentType(document: ClinicalDocument) {
  return documentFileKind(document.file_name, "PDF");
}

// Derive the header eyebrow from the document's real type instead of asserting
// every document is a "Clinical guideline". Prefers the organization profile's
// document_type, then a high-confidence document_type label, then a neutral fallback.
function documentTypeEyebrow(document: ClinicalDocument) {
  const profile = documentOrganizationProfile(document);
  const profileType =
    typeof profile?.document_type?.label === "string" && profile.document_type.label !== "unknown"
      ? profile.document_type.label
      : null;
  const labelType = document.labels?.find(
    (label) => label.label_type === "document_type" && (label.confidence ?? 0) >= 0.5,
  )?.label;
  const typeLabel = profileType ?? labelType;
  return typeLabel ? formatDocumentLabelDisplay(typeLabel, "document_type") : "Clinical document";
}

export function DocumentOverviewLanding({
  document,
  signedUrl,
  pages,
  onAskFromDocument,
  onSearchDocument,
  searchOpen,
  onDownload,
  downloading,
  canSummarizeDocument,
  summarizing,
}: {
  document: ClinicalDocument;
  signedUrl: string | null;
  pages: PageRow[];
  onAskFromDocument: () => void;
  onSearchDocument: MouseEventHandler<HTMLButtonElement>;
  searchOpen: boolean;
  onDownload: () => void;
  downloading: boolean;
  canSummarizeDocument: boolean;
  summarizing: boolean;
}) {
  const documentType = compactDocumentType(document);
  const answerLabel = summarizing ? "Answering…" : canSummarizeDocument ? "Answer from this" : "Sign in to answer";
  const answerTitle = summarizing
    ? "An answer is being generated from this document."
    : canSummarizeDocument
      ? "Answer from this document"
      : "Sign in before answering from this document.";

  return (
    <section>
      <article className={cn(panel, "p-3 sm:p-4")}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
          <DocumentFileTile
            kind={documentType}
            tone={documentTileTone(documentType)}
            className="h-14 w-14 rounded-xl text-sm sm:h-16 sm:w-16"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-label text-[color:var(--text-muted)]">
              {documentTypeEyebrow(document)}
            </p>
            <h2 className="line-clamp-2 text-lg font-semibold leading-6 text-[color:var(--text-heading)] sm:text-xl sm:leading-7">
              {documentDisplayTitle(document)}
            </h2>
            <DocumentMetaRow
              className="mt-1"
              items={[
                documentType,
                pageCountLabel(document.page_count ?? (pages.length || null)),
                <SourceStatusBadge key="status" metadata={document.metadata} className="min-h-6 px-1.5 text-2xs" />,
              ]}
            />
            {/* Search relevance badges are rendered in document search results; the viewer has no ranking context. */}
          </div>
        </div>
        {/* Search and grounded answering are the document-page tasks. Opening or
            downloading the raw file remains available without competing with
            the embedded reader for the first phone viewport. */}
        {/* One row on a phone: the two document tasks plus a compact ⋯ menu for
            opening or downloading the raw file. The menu used to be a full-width
            third row of its own. */}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3rem] gap-2 sm:hidden">
          <DocumentActionButton
            onClick={onSearchDocument}
            icon={Search}
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? "document-viewer-search" : undefined}
            className={cn(primaryButton, "w-full min-h-12 whitespace-nowrap px-2 text-xs")}
          >
            Search document
          </DocumentActionButton>
          <DocumentActionButton
            onClick={onAskFromDocument}
            disabled={!canSummarizeDocument}
            title={answerTitle}
            icon={Sparkles}
            className={cn(secondaryButton, "w-full min-h-12 whitespace-nowrap px-2 text-xs")}
          >
            {answerLabel}
          </DocumentActionButton>
          <details className="group relative" data-testid="document-overview-more-actions">
            <summary
              aria-label="More actions"
              title="More actions"
              className={cn(
                secondaryButton,
                "h-12 w-12 min-h-12 cursor-pointer list-none justify-center p-0 [&::-webkit-details-marker]:hidden",
              )}
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </summary>
            <div
              className={cn(panel, "absolute right-0 top-full z-20 mt-2 grid w-48 gap-1.5 p-1.5 shadow-[var(--e2)]")}
            >
              {signedUrl ? (
                <DocumentActionAnchor
                  href={signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(secondaryButton, "w-full min-h-12 justify-start px-3 text-xs")}
                >
                  Open source
                </DocumentActionAnchor>
              ) : (
                <DocumentActionAnchor
                  href="#pdf-preview-section"
                  className={cn(secondaryButton, "w-full min-h-12 justify-start px-3 text-xs")}
                >
                  Open preview
                </DocumentActionAnchor>
              )}
              <DocumentActionButton
                onClick={onDownload}
                disabled={downloading}
                icon={downloading ? Loader2 : Download}
                className={cn(secondaryButton, "w-full min-h-12 justify-start px-3 text-xs")}
              >
                {downloading ? "Preparing" : "Download"}
              </DocumentActionButton>
            </div>
          </details>
        </div>
        <div className="mt-3 hidden flex-wrap gap-2 border-t border-[color:var(--border)] pt-3 sm:flex">
          <DocumentActionButton
            onClick={onSearchDocument}
            icon={Search}
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? "document-viewer-search" : undefined}
            className={cn(primaryButton, "min-h-12 px-3 text-sm")}
          >
            Search document
          </DocumentActionButton>
          <DocumentActionButton
            onClick={onAskFromDocument}
            disabled={!canSummarizeDocument}
            title={answerTitle}
            icon={Sparkles}
            className={cn(secondaryButton, "min-h-12 whitespace-nowrap px-3 text-sm")}
          >
            {answerLabel}
          </DocumentActionButton>
          {signedUrl ? (
            <DocumentActionAnchor
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(secondaryButton, "min-h-12 px-3 text-sm")}
            >
              Open source
            </DocumentActionAnchor>
          ) : (
            <DocumentActionAnchor href="#pdf-preview-section" className={cn(secondaryButton, "min-h-12 px-3 text-sm")}>
              Open preview
            </DocumentActionAnchor>
          )}
          <DocumentActionButton
            onClick={onDownload}
            disabled={downloading}
            icon={downloading ? Loader2 : Download}
            className={cn(secondaryButton, "min-h-12 px-3 text-sm")}
          >
            {downloading ? "Preparing" : "Download"}
          </DocumentActionButton>
        </div>
      </article>
    </section>
  );
}

function pageCountLabel(count: number | null): string {
  if (count === null) return "? pages";
  return count === 1 ? "1 page" : `${count} pages`;
}
