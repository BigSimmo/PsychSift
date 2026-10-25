"use client";

import { FileImage } from "lucide-react";
import { DocumentImageFilmstrip } from "@/components/document-viewer/document-image-filmstrip";
import {
  DocumentImageList,
  DocumentSectionSummary,
  TableReviewPanel,
} from "@/components/document-viewer/source-panels";
import type { ImageRow, TableFactRow } from "@/components/document-viewer/types";
import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { clinicalDivider, cn, EmptyState, LoadingPanel, panel, sourceCard } from "@/components/ui-primitives";
import type { ClinicalDocument } from "@/lib/types";

/**
 * Tables, diagrams and image captions for the open document.
 *
 * This lives in the main reading column directly under `IndexedTextPanel`, not
 * in the right rail: a table crop is reading material at the same weight as the
 * extracted text it was lifted from, and the rail's narrow track forced every
 * wide crop into a thumbnail nobody could read without opening the viewer. The
 * section-index order (`source-text` then `source-images`) already assumed this
 * sequence, so the DOM now matches the navigation.
 */
export function DocumentVisualsPanel({
  className,
  loading,
  document,
  canUseAdministrativeApis,
  clinicalImages,
  auditImages,
  tableFacts,
  reviewingTableFactId,
  tableReviewError,
  onReviewTableFact,
  activePage,
  onSelectPage,
}: {
  className?: string;
  loading: boolean;
  document: ClinicalDocument | null;
  canUseAdministrativeApis: boolean;
  clinicalImages: ImageRow[];
  auditImages: ImageRow[];
  tableFacts: TableFactRow[];
  reviewingTableFactId: string | null;
  /** A failed review, shown here so the page being read stays on screen. */
  tableReviewError?: string | null;
  onReviewTableFact: (fact: TableFactRow, reviewClass: string) => void;
  activePage: number;
  onSelectPage: (page: number) => void;
}) {
  return (
    <details
      id="source-images"
      name="document-viewer-section"
      className={cn(panel, "group min-w-0 scroll-mt-[var(--document-anchor-offset,6rem)]", className)}
    >
      <DocumentSectionSummary
        icon={FileImage}
        title="Tables and diagrams"
        description={
          loading
            ? "Indexed tables, diagrams, and image captions."
            : clinicalImages.length === 1
              ? "1 indexed table, diagram, or image caption."
              : `${clinicalImages.length} indexed tables, diagrams, and image captions.`
        }
      />
      <div className={cn(clinicalDivider, "space-y-3 p-4 pt-3")}>
        {canUseAdministrativeApis && tableFacts.length ? (
          <details className={cn(sourceCard, "p-3")}>
            <summary className="cursor-pointer text-sm font-semibold text-[color:var(--text)]">Table tools</summary>
            <div className="mt-3">
              <TableReviewPanel
                tableFacts={tableFacts}
                canReview={canUseAdministrativeApis}
                busyFactId={reviewingTableFactId}
                onReview={onReviewTableFact}
              />
              {tableReviewError ? (
                <InlineNotice tone="warning" className="mt-2">
                  {tableReviewError}
                </InlineNotice>
              ) : null}
            </div>
          </details>
        ) : null}
        {loading ? (
          <LoadingPanel label="Loading extracted tables" />
        ) : clinicalImages.length === 0 ? (
          <EmptyState
            title="No clinically useful tables or diagrams"
            body="No indexed clinically useful tables or diagrams."
            tone="neutral"
            live="polite"
          />
        ) : (
          <>
            {/* The filmstrip stays whole: it is one button per figure with no
                image behind it, so it is the cheap way to reach any page. The
                detailed cards below it are what get windowed. */}
            <DocumentImageFilmstrip images={clinicalImages} activePage={activePage} onSelectPage={onSelectPage} />
            <DocumentImageList
              key={`${document?.id ?? "none"}:clinical`}
              images={clinicalImages}
              activePage={activePage}
              onSelectPage={onSelectPage}
              revealLabel="Tables and diagrams"
            />
          </>
        )}
        {!loading && auditImages.length > 0 ? (
          <details className={cn(sourceCard, "p-3")}>
            <summary className="cursor-pointer text-sm font-semibold text-[color:var(--text)]">
              Administrative/reference tables retained for audit ({auditImages.length})
            </summary>
            <div className="mt-3 grid gap-3">
              <DocumentImageList
                key={`${document?.id ?? "none"}:audit`}
                images={auditImages}
                activePage={activePage}
                onSelectPage={onSelectPage}
                revealLabel="Administrative and reference tables"
              />
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}
