// Overview landing for the document viewer: the compact header and quick
// actions. Extracted from DocumentViewer.tsx (maturity X3) as a pure move.
//
// The high-yield clinical summary used to live here too, which put it above the
// PDF on phones — most of the first viewport spent before any of the source.
// DocumentViewer now places it after the source, matching the order
// `buildDocumentSectionIndex` has always described.
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
import { cn, panel, floatingControl, primaryControl } from "@/components/ui-primitives";
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
}) {
  const documentType = compactDocumentType(document);

  return (
    <section className="grid gap-4">
      <article className={cn(panel, "p-3 sm:p-5")}>
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 sm:gap-4">
          <DocumentFileTile
            kind={documentType}
            tone={documentTileTone(documentType)}
            className="h-14 w-14 rounded-xl text-sm sm:h-24 sm:w-24"
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
              items={[documentType, `${document.page_count ?? (pages.length || "?")} pages`]}
            />
            {/* Search relevance badges are rendered in document search results; the viewer has no ranking context. */}
          </div>
        </div>
        {/* Phone: primary reading actions only. Download / search stay behind More
            so the first viewport reaches the PDF and clinical summary faster. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
          {signedUrl ? (
            <DocumentActionAnchor
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(primaryButton, "w-full min-h-12 px-2 text-xs")}
            >
              Open PDF
            </DocumentActionAnchor>
          ) : (
            <DocumentActionAnchor
              href="#pdf-preview-section"
              className={cn(primaryButton, "w-full min-h-12 px-2 text-xs")}
            >
              Open preview
            </DocumentActionAnchor>
          )}
          <DocumentActionButton
            onClick={onAskFromDocument}
            disabled={!canSummarizeDocument}
            icon={Sparkles}
            className={cn(secondaryButton, "w-full min-h-12 whitespace-nowrap px-2 text-xs")}
          >
            Answer from this
          </DocumentActionButton>
        </div>
        <details className="group mt-2 sm:hidden" data-testid="document-overview-more-actions">
          <summary
            className={cn(
              secondaryButton,
              "w-full min-h-12 cursor-pointer list-none justify-center gap-2 px-2 text-xs [&::-webkit-details-marker]:hidden",
            )}
          >
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            More actions
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <DocumentActionButton
              onClick={onDownload}
              disabled={downloading}
              icon={downloading ? Loader2 : Download}
              className={cn(secondaryButton, "w-full min-h-12 px-2 text-xs")}
            >
              {downloading ? "Preparing" : "Download"}
            </DocumentActionButton>
            <DocumentActionButton
              onClick={onSearchDocument}
              icon={Search}
              aria-expanded={searchOpen}
              aria-controls={searchOpen ? "document-viewer-search" : undefined}
              className={cn(secondaryButton, "w-full min-h-12 px-2 text-xs")}
            >
              Search document
            </DocumentActionButton>
          </div>
        </details>
        <div className="mt-4 hidden grid-cols-2 gap-2 sm:grid sm:grid-cols-4">
          {signedUrl ? (
            <DocumentActionAnchor
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(primaryButton, "w-full min-h-12 px-2 text-sm")}
            >
              Open PDF
            </DocumentActionAnchor>
          ) : (
            <DocumentActionAnchor
              href="#pdf-preview-section"
              className={cn(primaryButton, "w-full min-h-12 px-2 text-sm")}
            >
              Open preview
            </DocumentActionAnchor>
          )}
          <DocumentActionButton
            onClick={onDownload}
            disabled={downloading}
            icon={downloading ? Loader2 : Download}
            className={cn(secondaryButton, "w-full min-h-12 px-2 text-sm")}
          >
            {downloading ? "Preparing" : "Download"}
          </DocumentActionButton>
          <DocumentActionButton
            onClick={onSearchDocument}
            icon={Search}
            aria-expanded={searchOpen}
            aria-controls={searchOpen ? "document-viewer-search" : undefined}
            className={cn(secondaryButton, "w-full min-h-12 px-2 text-sm")}
          >
            Search document
          </DocumentActionButton>
          <DocumentActionButton
            onClick={onAskFromDocument}
            disabled={!canSummarizeDocument}
            icon={Sparkles}
            className={cn(secondaryButton, "w-full min-h-12 whitespace-nowrap px-2 text-sm")}
          >
            Answer from this
          </DocumentActionButton>
        </div>
      </article>
    </section>
  );
}
