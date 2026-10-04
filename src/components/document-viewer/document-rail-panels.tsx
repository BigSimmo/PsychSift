"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { DocumentTagCloud } from "@/components/DocumentTagCloud";
import { SafeBoldText } from "@/components/SafeBoldText";
import { DocumentManualTagEditor } from "@/components/document-viewer/manual-tag-editor";
import { DocumentSectionIndexCard } from "@/components/document-viewer/section-nav";
import { documentIndexingSectionId } from "@/components/document-viewer/section-index";
import {
  ClinicalSummaryProfile,
  DocumentSectionSummary,
  FormattedHighYieldSummary,
} from "@/components/document-viewer/source-panels";
import type { DocumentIndexHealth } from "@/components/document-viewer/types";
import type { DocumentSection } from "@/components/document-viewer/section-index";
import { BadgeCluster } from "@/components/clinical-dashboard/clinical-badge";
import {
  clinicalDivider,
  cn,
  codeText,
  eyebrowText,
  InlineNotice,
  panel,
  proseMeasure,
  sourceCard,
} from "@/components/ui-primitives";
import type { ClinicalDocument, DocumentLabel } from "@/lib/types";
import type { FormattedDocumentSummary } from "@/lib/document-summary-formatting";
import type { DocumentSummaryBadge } from "@/lib/document-summary-badges";

export function DocumentViewerRail({
  className,
  headerHidden,
  documentSections,
  activeSectionId,
  onSelectSection,
  compact,
  onCompactChange,
  indexWarnings,
  document,
  summaryBadges,
  formattedStoredSummary,
  canUseAdministrativeApis,
  clientDemoMode,
  authorizationHeader,
  onLabelsUpdated,
  onUnauthorized,
  onSearchByTag,
  indexHealth,
}: {
  className?: string;
  headerHidden: boolean;
  documentSections: DocumentSection[];
  activeSectionId: string | null;
  onSelectSection: (id: string) => void;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  indexWarnings: string[];
  document: ClinicalDocument | null;
  summaryBadges: DocumentSummaryBadge[];
  formattedStoredSummary: FormattedDocumentSummary;
  canUseAdministrativeApis: boolean;
  clientDemoMode: boolean;
  authorizationHeader: Record<string, string>;
  onLabelsUpdated: (labels: DocumentLabel[]) => void;
  onUnauthorized: () => void;
  onSearchByTag: (tag: { searchText: string; label: string }) => void;
  indexHealth: DocumentIndexHealth | null;
}) {
  return (
    <aside
      className={cn(
        // `grid-cols-1` at the base breakpoint is load-bearing, not decoration.
        // Without it the phone rail falls back to an implicit `grid-auto-columns:
        // auto` track whose minimum is the min-content of its items, so one wide
        // descendant (a wide table crop's aspect-ratio frame) stretched the single
        // track and EVERY card inherited the blown-out width — measured 560px
        // inside a 393px viewport, with `html { overflow-x: clip }` amputating the
        // remainder instead of making it scrollable. `md:`/`lg:` never showed it
        // because Tailwind emits `repeat(n, minmax(0,1fr))` for those.
        "min-w-0 grid grid-cols-1 content-start gap-4 sm:gap-5 md:grid-cols-2 md:items-start lg:sticky lg:grid-cols-1 lg:self-start lg:pr-1",
        className,
        // The rail clears the top bar while it is there, and reclaims that
        // space the moment it hides — otherwise a dead band the height of the
        // bar sits above the rail for as long as chrome stays away. When the
        // universal bar is hidden, the page-owned sticky document header still
        // owns the top edge on sm+.
        headerHidden
          ? "lg:top-[var(--document-sticky-header-height,0px)]"
          : "lg:top-[var(--document-collapse-height,69px)]",
      )}
    >
      <DocumentSectionIndexCard
        sections={documentSections}
        activeId={activeSectionId}
        onSelect={onSelectSection}
        compact={compact}
        onCompactChange={onCompactChange}
        className="hidden min-w-0 md:col-span-2 lg:col-span-1 lg:block"
      />

      {indexWarnings.length ? (
        <InlineNotice tone="warning" className="min-w-0 text-xs md:col-span-2 lg:col-span-1">
          <span className="font-bold">Extraction warnings</span>
          {indexWarnings.slice(0, 4).map((warning) => (
            <span key={warning} className="mt-1 block font-semibold">
              {warning}
            </span>
          ))}
        </InlineNotice>
      ) : null}

      {document ? (
        <details
          id="source-summary"
          name="document-viewer-section"
          data-testid="high-yield-summary"
          className={cn(
            panel,
            "group min-w-0 max-sm:hidden print:block scroll-mt-[var(--document-anchor-offset,6rem)] source-print md:col-span-2 lg:col-span-1",
          )}
        >
          <DocumentSectionSummary
            icon={Sparkles}
            title={document.summary?.clinical_specifics?.profile ? "Clinical document profile" : "High-yield summary"}
            description="What this document covers, from its indexed evidence."
          />
          <div className={cn(clinicalDivider, "p-4 pt-3")}>
            <BadgeCluster items={summaryBadges} limit={8} showOverflowCount />
            {document.summary?.clinical_specifics?.profile ? (
              <ClinicalSummaryProfile profile={document.summary.clinical_specifics.profile} />
            ) : (
              <FormattedHighYieldSummary
                formatted={formattedStoredSummary}
                showLead={formattedStoredSummary.sections.length === 0}
              />
            )}
            {!document.summary?.clinical_specifics?.profile && document.summary?.clinical_specifics && (
              <div className="mt-4 space-y-4">
                {Object.entries(document.summary.clinical_specifics)
                  .filter(([key, items]) => key !== "profile" && Array.isArray(items) && items.length > 0)
                  .slice(0, 6)
                  .map(([key, items]) => (
                    <section key={key} className="border-t border-[color:var(--border)] pt-3">
                      <h3 className="text-xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                        {key.replaceAll("_", " ")}
                      </h3>
                      <ul
                        className={cn(
                          proseMeasure,
                          "mt-2 space-y-1.5 text-base-minus leading-6 text-[color:var(--text-muted)]",
                        )}
                      >
                        {(items as string[]).slice(0, 5).map((item, index) => (
                          <li key={`${key}:${index}:${item}`} className="flex gap-2">
                            <span
                              aria-hidden="true"
                              className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--clinical-accent)]"
                            />
                            <span>
                              <SafeBoldText text={item} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
              </div>
            )}
            {document.labels?.length ? (
              <div className="mt-4 border-t border-[color:var(--border)] pt-3">
                <p className={eyebrowText}>Browse by tag</p>
                <DocumentTagCloud
                  labels={document.labels}
                  limit={18}
                  className="mt-2"
                  onTagClick={onSearchByTag}
                  grouped
                />
              </div>
            ) : null}
            {canUseAdministrativeApis ? (
              <details className={cn(sourceCard, "mt-4 p-3")}>
                <summary className="cursor-pointer text-sm font-semibold text-[color:var(--text)]">
                  Document tools
                </summary>
                <DocumentManualTagEditor
                  document={document}
                  canManage={canUseAdministrativeApis}
                  clientDemoMode={clientDemoMode}
                  authorizationHeader={authorizationHeader}
                  onLabelsUpdated={onLabelsUpdated}
                  onUnauthorized={onUnauthorized}
                />
              </details>
            ) : null}
          </div>
        </details>
      ) : null}

      {indexHealth ? (
        <details
          id={documentIndexingSectionId}
          name="document-viewer-section"
          data-testid="indexing-details"
          className={cn(
            panel,
            "group min-w-0 scroll-mt-[var(--document-anchor-offset,6rem)] md:col-span-2 lg:col-span-1",
          )}
        >
          <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
            <span className={eyebrowText}>About this file</span>
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[color:var(--text-muted)] transition group-open:rotate-180"
            />
          </summary>
          <dl
            className={cn(
              clinicalDivider,
              "grid gap-2 p-4 text-xs font-semibold text-[color:var(--text-muted)] sm:grid-cols-2",
            )}
          >
            <div>
              <dt>Extraction</dt>
              <dd className="mt-0.5 text-[color:var(--text)]">{indexHealth.extractionQuality ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Index version</dt>
              <dd className={cn("mt-0.5 truncate text-[color:var(--text)]", codeText)}>
                {indexHealth.indexVersion ?? "unknown"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt>Indexed</dt>
              <dd className="mt-0.5 text-[color:var(--text)]">{indexHealth.indexedAt ?? "not recorded"}</dd>
            </div>
          </dl>
        </details>
      ) : null}
    </aside>
  );
}
