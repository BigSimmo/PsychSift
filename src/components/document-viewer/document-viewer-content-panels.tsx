"use client";

import type { ClinicalDocument } from "@/lib/types";
import type {
  ChunkRow,
  DocumentSearchResult,
  ImageRow,
  PageRow,
  TableFactRow,
} from "@/components/document-viewer/types";
import { IndexedTextPanel, PinnedSourceEvidence } from "@/components/document-viewer/source-panels";
import { DocumentVisualsPanel } from "@/components/document-viewer/document-visuals-panel";
import { DocumentClinicalSummary } from "@/components/document-viewer/document-clinical-summary";

export type DocumentViewerContentPanelsProps = {
  effectiveLoadingDocument: boolean;
  selectedChunk?: ChunkRow | null;
  inspectIndexedTextSection: () => void;
  readyDocument: ClinicalDocument | null;
  usefulPageHref: (pageNumber: number) => string;
  navigateToPage: (pageNumber: number) => void;
  compactView: boolean;
  selectedPage?: PageRow;
  chunks: ChunkRow[];
  sourceSearch: string;
  currentDocumentSearchResults: DocumentSearchResult[];
  documentSearchPending: boolean;
  currentDocumentSearchError: string | null;
  activeChunkId?: string | null;
  setSourceSearch: (value: string) => void;
  inspectIndexedText: boolean;
  normalizedSourceSearch: string;
  document: ClinicalDocument | null;
  canUseAdministrativeApis: boolean;
  clinicalImages: ImageRow[];
  auditImages: ImageRow[];
  tableFacts: TableFactRow[];
  reviewingTableFactId: string | null;
  reviewTableFact: (fact: TableFactRow, reviewClass: string) => Promise<void> | void;
  activePage: number;
};

export function DocumentViewerContentPanels({
  effectiveLoadingDocument,
  selectedChunk,
  inspectIndexedTextSection,
  readyDocument,
  usefulPageHref,
  navigateToPage,
  compactView,
  selectedPage,
  chunks,
  sourceSearch,
  currentDocumentSearchResults,
  documentSearchPending,
  currentDocumentSearchError,
  activeChunkId,
  setSourceSearch,
  inspectIndexedText,
  normalizedSourceSearch,
  document,
  canUseAdministrativeApis,
  clinicalImages,
  auditImages,
  tableFacts,
  reviewingTableFactId,
  reviewTableFact,
  activePage,
}: DocumentViewerContentPanelsProps) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-5">
      <PinnedSourceEvidence
        loading={effectiveLoadingDocument}
        chunk={selectedChunk ?? undefined}
        compact
        sectionId="source-evidence"
        onInspectIndexedText={inspectIndexedTextSection}
      />
      {readyDocument ? (
        <div id="source-summary-card" className="min-w-0 scroll-mt-[var(--document-anchor-offset,6rem)]">
          <DocumentClinicalSummary
            document={readyDocument}
            pageHref={usefulPageHref}
            onPageChange={navigateToPage}
            compact={compactView}
          />
        </div>
      ) : null}
      <IndexedTextPanel
        loading={effectiveLoadingDocument}
        selectedPage={selectedPage}
        chunks={chunks}
        search={sourceSearch}
        documentSearchResults={currentDocumentSearchResults}
        searchingDocument={documentSearchPending}
        documentSearchError={currentDocumentSearchError}
        idPrefix="source-chunk"
        sectionId="source-text"
        selectedChunkId={activeChunkId ?? undefined}
        onSearchChange={setSourceSearch}
        compact={compactView}
        revealRequest={inspectIndexedText || normalizedSourceSearch.length >= 2}
      />
      <DocumentVisualsPanel
        loading={effectiveLoadingDocument}
        document={document}
        canUseAdministrativeApis={canUseAdministrativeApis}
        clinicalImages={clinicalImages}
        auditImages={auditImages}
        tableFacts={tableFacts}
        reviewingTableFactId={reviewingTableFactId}
        onReviewTableFact={reviewTableFact}
        activePage={activePage}
        onSelectPage={navigateToPage}
      />
    </div>
  );
}
