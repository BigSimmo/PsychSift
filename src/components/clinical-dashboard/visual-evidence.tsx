"use client";

import Link from "next/link";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import {
  CircleAlert,
  BookOpen,
  CircleCheck,
  CircleDashed,
  ChevronDown,
  Copy,
  ExternalLink,
  FileImage,
  Layers,
  ListChecks,
  Plus,
  Quote,
} from "lucide-react";

import { AccessibleTable } from "@/components/AccessibleTable";
import { type AnswerFeedbackType } from "@/lib/answer-feedback";
import { SourceImage } from "@/components/clinical-dashboard/answer-content";
import { SectionHeading, UtilityDrawer } from "@/components/clinical-dashboard/dashboard-shell";
import { cleanDisplayTitle } from "@/components/clinical-dashboard/display-text";
import {
  AnswerFeedbackPanel,
  AnswerSafetyNotice,
  type EvidenceTabName,
  evidenceTabCount,
  evidenceTabOrder,
  QuoteCards,
  simpleClinicalTableProps,
} from "@/components/clinical-dashboard/evidence-panels";
import { QueryCoverageChips } from "@/components/clinical-dashboard/relevance";
import {
  chatMicroAction,
  clinicalDivider,
  cn,
  EmptyState,
  floatingControl,
  iconTilePremium,
  ignoreUnavailableActivation,
  metadataPillDensity,
  sourceCard,
  tableCard,
  tableCardHeader,
  tableMicroActionRow,
  textMuted,
} from "@/components/ui-primitives";
import { type AnswerRenderModel, type CanonicalAnswerTableRecord } from "@/lib/answer-render-policy";
import { formatCompactCitationLabel } from "@/lib/citations";
import { smartEvidenceTags } from "@/lib/evidence-tags";
import { sourceTextForCompactDisplay } from "@/lib/source-text-sanitizer";
import type { ClientQuoteCard, ClientRagAnswerPayload, ClientSearchResult } from "@/lib/answer-client-payload";
import type { VisualEvidenceCard } from "@/lib/types";
import { emptyStates } from "@/lib/ui-copy";
import { type AnswerEvidenceMapRow } from "@/lib/ward-output";

function compactClinicalTableCaption(item: VisualEvidenceCard) {
  const raw = item.tableTitle || item.tableLabel || item.caption || "Clinical table";
  const cleaned = sourceTextForCompactDisplay(raw)
    .replace(/\btable\s+\d+\s*[:.-]?\s*/i, "")
    .replace(/\b(?:page|p\.)\s*\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const caption = cleaned || "Clinical table";
  return caption.length <= 72 ? caption : `${caption.slice(0, 69).trim()}…`;
}

function visualEvidenceHeader(item: VisualEvidenceCard) {
  const titleSource = [item.tableLabel, item.tableTitle].filter(Boolean).join(" · ");
  const titleText = sourceTextForCompactDisplay(titleSource).trim();
  const captionText = sourceTextForCompactDisplay(item.caption ?? "").trim();
  const normalizedTitle = titleText.toLowerCase();
  const normalizedCaption = captionText.toLowerCase();
  const isDuplicateCaption =
    Boolean(normalizedCaption) &&
    (normalizedCaption.startsWith(normalizedTitle) || normalizedCaption === normalizedTitle);
  return {
    title: titleText || captionText || "Visual evidence",
    caption: isDuplicateCaption ? null : captionText,
  };
}

function VisualEvidenceStrip({
  evidence,
  collapsed = false,
  embedded = false,
}: {
  evidence: VisualEvidenceCard[];
  collapsed?: boolean;
  embedded?: boolean;
}) {
  function looksLikeTableText(value?: string | null) {
    return Boolean(value?.includes("|") && value.split("|").filter((cell) => cell.trim()).length >= 3);
  }

  if (collapsed) {
    return (
      <section className="space-y-3 scroll-mt-4 sm:scroll-mt-6">
        <UtilityDrawer
          icon={FileImage}
          title="Nearby visual evidence"
          summary="Nearby source support only."
          mobileSummary={`${evidence.length} visuals`}
        >
          <VisualEvidenceStrip evidence={evidence} embedded />
        </UtilityDrawer>
      </section>
    );
  }

  const content = (
    <>
      <SectionHeading
        icon={FileImage}
        title="Tables and diagrams"
        description="Clinical tables, diagrams, and images from indexed documents."
        hideDescriptionOnMobile
        compactMobile
      />
      {evidence.length === 0 ? (
        <EmptyState
          icon={FileImage}
          title={emptyStates.indexedVisuals.title}
          body={emptyStates.indexedVisuals.body}
          live="polite"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {evidence.map((item) => {
            const tableMarkdown = item.accessibleTableMarkdown?.trim()
              ? item.accessibleTableMarkdown
              : looksLikeTableText(item.tableTextSnippet)
                ? item.tableTextSnippet
                : null;
            const hasStructuredTable = Boolean(tableMarkdown || item.tableRows?.length || item.tableColumns?.length);
            const tableCaption = compactClinicalTableCaption(item);
            const sourceHeader = visualEvidenceHeader(item);
            const displayLabels = smartEvidenceTags(
              item.labels,
              [[item.tableLabel, item.tableTitle].filter(Boolean).join(": "), item.caption, item.tableTextSnippet]
                .filter(Boolean)
                .join(" "),
            );
            return (
              <figure key={item.id} className={cn(sourceCard, "overflow-hidden p-2.5 sm:p-3")}>
                <div className="rounded-lg bg-[color:var(--surface-inset)] p-2.5 sm:p-3">
                  <SourceImage
                    endpoint={item.signed_url_endpoint}
                    caption={sourceHeader.caption || sourceHeader.title}
                  />
                </div>
                <figcaption className="mt-2 space-y-1.5 text-base-minus leading-6 text-[color:var(--text)] sm:mt-3">
                  {!hasStructuredTable ? <p className="font-semibold">{sourceHeader.title}</p> : null}
                  {!hasStructuredTable && sourceHeader.caption ? <p>{sourceHeader.caption}</p> : null}
                  <AccessibleTable
                    caption={tableCaption}
                    markdown={tableMarkdown}
                    rows={item.tableRows}
                    columns={item.tableColumns}
                    {...simpleClinicalTableProps}
                    clinicalOnly
                    dialogTitle={tableCaption || "Clinical table"}
                  />
                  {!hasStructuredTable && item.tableTextSnippet ? (
                    <p className={cn("line-clamp-3 text-sm leading-6", textMuted)}>
                      {sourceTextForCompactDisplay(item.tableTextSnippet)}
                    </p>
                  ) : null}
                  {displayLabels.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {displayLabels.map((label) => (
                        <span key={`${item.id}:${label}`} className={metadataPillDensity.compact}>
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </figcaption>
                <div
                  className={cn(
                    "mt-2 flex flex-wrap items-center justify-between gap-2 pt-3 text-xs sm:mt-3 sm:gap-3",
                    clinicalDivider,
                  )}
                >
                  <span className={cn("text-base-minus font-semibold leading-6 sm:hidden", textMuted)}>
                    {formatCompactCitationLabel(item)}
                  </span>
                  <span className={cn("hidden text-xs font-semibold leading-5 sm:inline", textMuted)}>
                    {cleanDisplayTitle(item.title)}, page {item.page_number ?? "n/a"}
                  </span>
                  {item.image_type && (
                    <span className={metadataPillDensity.dense}>{item.image_type.replaceAll("_", " ")}</span>
                  )}
                  {!hasStructuredTable ? <QueryCoverageChips relevance={item.relevance} limit={2} /> : null}
                  <Link href={item.viewer_href} className={cn(floatingControl, "min-h-tap px-4 text-xs")}>
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    Open source
                  </Link>
                </div>
              </figure>
            );
          })}
        </div>
      )}
    </>
  );

  if (embedded) return <div className="space-y-3">{content}</div>;

  return <section className="space-y-3 scroll-mt-4 sm:scroll-mt-6">{content}</section>;
}

export function CanonicalAnswerTable({ table }: { table: CanonicalAnswerTableRecord }) {
  const normalizedTable = {
    header: table.headers.map((header) => header ?? ""),
    body: table.rows.map((row) => table.headers.map((_, index) => row[index] ?? "")),
    lowConfidence: table.lowConfidence,
    lowConfidenceReason: table.caveat,
  };
  return (
    <section className={cn(tableCard, "max-w-lg")} aria-label="Inline table preview">
      {table.title || table.source ? (
        <div className={cn(tableCardHeader, "flex min-h-10 items-center justify-between gap-2 py-2 text-sm")}>
          <span aria-hidden="true" className="min-w-0 truncate">
            {table.title || "Clinical table"}
          </span>
          {table.source ? (
            <Link
              href={table.source.href}
              className={cn(chatMicroAction, "min-h-tap min-w-tap shrink-0 justify-center px-0 sm:hidden")}
              aria-label="Open table source"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
      {table.caveat ? (
        <p data-testid="canonical-table-caveat" className={cn("px-3 pt-2 text-xs leading-5", textMuted)}>
          {table.caveat}
        </p>
      ) : null}
      <div className="p-1.5 sm:p-2">
        <AccessibleTable
          caption={table.title?.trim() || "Clinical table"}
          normalizedTable={normalizedTable}
          compact
          expandOnMobile
          previewRows={3}
          hidePreviewCaption
          hidePreviewRowCount
          densePreview
          dialogTitle={table.title || "Clinical table"}
        />
      </div>
      {table.source ? (
        <div className={cn(tableMicroActionRow, "hidden sm:flex")}>
          <Link href={table.source.href} className={chatMicroAction}>
            Expand
          </Link>
          <Link href={table.source.href} className={chatMicroAction}>
            Source
          </Link>
        </div>
      ) : null}
    </section>
  );
}

export function CanonicalAnswerTables({ tables }: { tables: CanonicalAnswerTableRecord[] }) {
  if (!tables.length) return null;
  return (
    <section className="space-y-3" aria-label="Clinical tables">
      {tables.map((table) => (
        <CanonicalAnswerTable
          key={`${table.id}:${table.source?.chunkId ?? table.source?.href ?? "unlinked"}`}
          table={table}
        />
      ))}
    </section>
  );
}

const evidenceTabIconMap: Record<EvidenceTabName, typeof Layers> = {
  Claims: CircleCheck,
  Quotes: Quote,
  Tables: ListChecks,
  Images: FileImage,
  Gaps: CircleAlert,
};

function supportLabel(supportLevel: string) {
  const normalized = supportLevel.toLowerCase();
  if (normalized.includes("unsupported") || normalized.includes("not classified") || normalized.includes("none")) {
    return "Unsupported";
  }
  if (normalized.includes("partial") || normalized.includes("limited") || normalized.includes("nearby"))
    return "Partial";
  return "Direct";
}

function SupportStatusIcon({ supportLevel }: { supportLevel: string }) {
  const label = supportLabel(supportLevel);
  const Icon = label === "Direct" ? CircleCheck : label === "Partial" ? CircleDashed : CircleAlert;

  return (
    <span
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full border",
        label === "Direct"
          ? "border-[color:var(--clinical-accent)]/25 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
          : label === "Partial"
            ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
            : "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
      )}
      role="img"
      aria-label={`${label} support`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </span>
  );
}

function claimRowsForEvidencePanel(rows: AnswerEvidenceMapRow[], renderModel: AnswerRenderModel) {
  if (rows.length) return rows.slice(0, 6);
  return renderModel.primarySources.slice(0, 6).map((source, index) => ({
    id: source.id,
    section: source.label || cleanDisplayTitle(source.title || source.file_name) || `Source ${index + 1}`,
    detail: source.snippet || source.reason || "Open source passage to review the cited evidence.",
    supportLevel: supportLabel(source.sourceStrength ?? "not classified"),
    citationCount: 1,
    sourceStatus: source.sourceStrength ? `${source.sourceStrength} source support` : "Source requires review",
    bestSourceLabel: source.label,
    bestLinkedPassage: source.snippet || source.reason,
    href: source.href,
  }));
}

function EvidenceClaimsList({ rows, renderModel }: { rows: AnswerEvidenceMapRow[]; renderModel: AnswerRenderModel }) {
  const claimRows = claimRowsForEvidencePanel(rows, renderModel);
  const directCount = claimRows.filter((row) => supportLabel(row.supportLevel) === "Direct").length;
  const partialCount = claimRows.filter((row) => supportLabel(row.supportLevel) === "Partial").length;
  const claimRowClassName =
    "grid min-h-18 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[color:var(--border)] px-3 py-2.5 text-left last:border-b-0";

  if (!claimRows.length) {
    return (
      <EmptyState
        icon={BookOpen}
        title={emptyStates.evidenceMap.title}
        body={emptyStates.evidenceMap.body}
        live="polite"
      />
    );
  }

  return (
    <div data-testid="evidence-claims-panel" className="space-y-3">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div>
          <p className="text-sm font-semibold text-[color:var(--text-heading)]">Claims checked</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-[color:var(--text-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--clinical-accent)]" />
              Direct
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--warning)]" />
              Partial
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--danger)]" />
              Unsupported
            </span>
          </div>
        </div>
        <p className="shrink-0 text-xs font-semibold text-[color:var(--text-muted)]">
          {directCount} direct <span className="mx-1">·</span> {partialCount} partial
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]">
        {claimRows.map((row, index) => {
          const content = (
            <>
              <SupportStatusIcon supportLevel={row.supportLevel} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[color:var(--text-heading)]">{row.section}</span>
                <span className={cn("mt-1 line-clamp-2 block text-xs leading-5", textMuted)}>
                  {row.detail || row.bestLinkedPassage || row.bestSourceLabel}
                </span>
              </span>
              {row.href ? (
                <ChevronDown aria-hidden="true" className="h-4 w-4 -rotate-90 text-[color:var(--text-muted)]" />
              ) : (
                <span className="text-2xs font-semibold text-[color:var(--text-muted)]">Source unavailable</span>
              )}
            </>
          );

          if (!row.href) {
            return (
              <div
                key={`${row.id}:${index}`}
                data-testid="evidence-map-source-unavailable"
                className={claimRowClassName}
              >
                {content}
              </div>
            );
          }

          return (
            <Link
              key={`${row.id}:${index}`}
              href={row.href}
              data-testid="evidence-map-open-source"
              className={cn(
                claimRowClassName,
                "transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)]",
              )}
              aria-label={`${supportLabel(row.supportLevel)} support. Open source for ${row.section}`}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceGapsPanel({ warnings }: { warnings: string[] }) {
  if (!warnings.length) {
    return (
      <EmptyState
        icon={CircleCheck}
        title="No evidence gaps"
        body="No source gaps were attached to this answer."
        live="polite"
      />
    );
  }

  return (
    <div className="grid gap-2">
      {warnings.map((warning, index) => (
        <article
          key={`${warning}:${index}`}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]/45 px-2.5 py-2"
        >
          <span className="nums grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[color:var(--surface-raised)] text-2xs font-bold text-[color:var(--text-heading)] shadow-[var(--shadow-inset)]">
            {index + 1}
          </span>
          <p className="line-clamp-2 text-xs leading-5 text-[color:var(--text)]">{warning}</p>
        </article>
      ))}
    </div>
  );
}

export function MobileEvidenceSheetContent({
  answer,
  sources,
  renderModel,
  visualEvidence,
  answerEvidenceMapRows,
  demoMode,
  initialTab,
  pendingFeedback,
  copiedQuotes,
  onCopyQuotes,
  onSubmitFeedback,
  onFollowUpQuote,
  onScopeDocument,
}: {
  answer: ClientRagAnswerPayload;
  sources: ClientSearchResult[];
  renderModel: AnswerRenderModel;
  visualEvidence: VisualEvidenceCard[];
  answerEvidenceMapRows: AnswerEvidenceMapRow[];
  demoMode: boolean;
  initialTab?: EvidenceTabName | null;
  pendingFeedback: AnswerFeedbackType | null;
  copiedQuotes: boolean;
  onCopyQuotes: () => void;
  onSubmitFeedback: (feedbackType: AnswerFeedbackType) => void;
  onFollowUpQuote?: (quote: ClientQuoteCard) => void;
  onScopeDocument: (documentId: string) => void;
}) {
  const order = evidenceTabOrder(answer, renderModel);
  const [selectedTab, setSelectedTab] = useState<EvidenceTabName | null>(() => initialTab ?? null);
  const activeTab = selectedTab && order.includes(selectedTab) ? selectedTab : order[0];
  const tabSetId = useId();
  const tabRefs = useRef<Partial<Record<EvidenceTabName, HTMLButtonElement | null>>>({});
  const tabIdFor = (tab: EvidenceTabName) => `${tabSetId}-mobile-evidence-tab-${tab.toLowerCase()}`;
  const panelIdFor = (tab: EvidenceTabName) => `${tabSetId}-mobile-evidence-panel-${tab.toLowerCase()}`;
  const primarySourceHref = renderModel.primarySources[0]?.href;

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: EvidenceTabName) {
    const currentIndex = order.indexOf(tab);
    let nextIndex: number;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % order.length;
        break;
      case "ArrowLeft":
        nextIndex = (currentIndex - 1 + order.length) % order.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = order.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextTab = order[nextIndex];
    setSelectedTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  async function copyEvidence() {
    if (renderModel.quoteCards.length) {
      onCopyQuotes();
      return;
    }
    try {
      await navigator.clipboard.writeText(renderModel.copyText);
    } catch {
      // Clipboard writes can fail in locked-down browsers; keep the panel usable.
    }
  }

  return (
    <div data-testid="mobile-evidence-sheet" className="min-w-0 space-y-3 overflow-hidden">
      <p className={cn("text-sm leading-5", textMuted)}>
        Check which claims are backed by the retrieved sources, open the supporting passages, and flag evidence problems
        before relying on the answer.
      </p>
      <div className="-mx-1 overflow-x-auto pb-1 polished-scroll" role="presentation">
        <div
          data-testid="mobile-evidence-tabs"
          role="tablist"
          aria-label="Evidence sections"
          className="flex min-w-max gap-1 px-1"
        >
          {order.map((tab) => {
            const selected = tab === activeTab;
            const Icon = evidenceTabIconMap[tab];
            const count = evidenceTabCount({
              tab,
              sources,
              visualEvidence,
              answerEvidenceMapRows,
              renderModel,
            });
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                ref={(node) => {
                  tabRefs.current[tab] = node;
                }}
                aria-selected={selected}
                aria-controls={panelIdFor(tab)}
                id={tabIdFor(tab)}
                tabIndex={selected ? 0 : -1}
                data-testid={`mobile-evidence-tab-${tab.toLowerCase()}`}
                onClick={() => setSelectedTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
                className={cn(
                  "inline-flex min-h-tap items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition",
                  selected
                    ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
                )}
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                {tab}
                {count ? <span className="nums text-2xs opacity-80">{count}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {order.map((tab) => {
          const selected = tab === activeTab;
          return (
            <div
              key={tab}
              id={panelIdFor(tab)}
              role="tabpanel"
              aria-labelledby={tabIdFor(tab)}
              data-testid={`mobile-evidence-panel-${tab.toLowerCase()}`}
              hidden={!selected}
            >
              {selected ? (
                <MobileEvidenceTabPanel
                  tab={tab}
                  renderModel={renderModel}
                  visualEvidence={visualEvidence}
                  answerEvidenceMapRows={answerEvidenceMapRows}
                  copiedQuotes={copiedQuotes}
                  onCopyQuotes={onCopyQuotes}
                  onFollowUpQuote={onFollowUpQuote}
                  onScopeDocument={onScopeDocument}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <AnswerSafetyNotice
        demoMode={demoMode}
        weakEvidence={renderModel.trust !== "high"}
        retrievalGateBlocked={answer.retrievalGateBlocked}
      />
      <AnswerFeedbackPanel pending={pendingFeedback} onSubmit={onSubmitFeedback} />
      <div className="sticky bottom-0 -mx-3 mt-auto border-t border-[color:var(--border)] bg-[color:var(--surface-raised)]/98 px-2.5 py-1.5 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-2">
        <div className="grid grid-cols-3 divide-x divide-[color:var(--border)] bg-[color:var(--surface)]">
          {primarySourceHref ? (
            <Link
              href={primarySourceHref}
              className="inline-flex min-h-12 items-center justify-center gap-1.5 px-2 text-xs font-semibold text-[color:var(--clinical-accent)]"
            >
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              Source
            </Link>
          ) : (
            <span className="inline-flex min-h-12 items-center justify-center gap-1.5 px-2 text-xs font-semibold text-[color:var(--text-muted)]">
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--decoration-soft)]" />
              Source
            </span>
          )}
          <button
            type="button"
            onClick={() => void copyEvidence()}
            className="inline-flex min-h-12 items-center justify-center gap-1.5 px-2 text-xs font-semibold text-[color:var(--text)]"
          >
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
            {copiedQuotes ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            aria-disabled="true"
            onClick={ignoreUnavailableActivation}
            aria-describedby="visual-evidence-add-unavailable"
            title="Add to favourites — coming soon"
            className="inline-flex min-h-12 cursor-not-allowed items-center justify-center gap-1.5 px-2 text-xs font-semibold text-[color:var(--clinical-accent)] opacity-60"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            Add
          </button>
          <span id="visual-evidence-add-unavailable" className="sr-only">
            Adding evidence to favourites is coming soon.
          </span>
        </div>
      </div>
    </div>
  );
}

function MobileEvidenceTabPanel({
  tab,
  renderModel,
  visualEvidence,
  answerEvidenceMapRows,
  copiedQuotes,
  onCopyQuotes,
  onFollowUpQuote,
  onScopeDocument,
}: {
  tab: EvidenceTabName;
  renderModel: AnswerRenderModel;
  visualEvidence: VisualEvidenceCard[];
  answerEvidenceMapRows: AnswerEvidenceMapRow[];
  copiedQuotes: boolean;
  onCopyQuotes: () => void;
  onFollowUpQuote?: (quote: ClientQuoteCard) => void;
  onScopeDocument: (documentId: string) => void;
}) {
  if (tab === "Claims") {
    return <EvidenceClaimsList rows={answerEvidenceMapRows} renderModel={renderModel} />;
  }

  if (tab === "Tables") {
    const tableEvidence = visualEvidence.filter((item) => item.accessibleTableMarkdown || item.tableRows?.length);
    return tableEvidence.length ? (
      <div className="grid gap-2">
        {tableEvidence.slice(0, 4).map((item, index) => (
          <article key={item.id} className={cn(sourceCard, "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 p-3")}>
            <span className={iconTilePremium}>
              <ListChecks aria-hidden="true" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-semibold text-[color:var(--text-heading)]">
                {compactClinicalTableCaption(item)}
              </p>
              <p className={cn("mt-1 text-xs", textMuted)}>
                Table {index + 1} · p.{item.page_number ?? "n/a"}
              </p>
            </div>
            <Link href={item.viewer_href} className={chatMicroAction} aria-label={`Open table source ${index + 1}`}>
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </article>
        ))}
      </div>
    ) : (
      <EmptyState
        icon={ListChecks}
        title={emptyStates.tablesUsed.title}
        body={emptyStates.tablesUsed.body}
        live="polite"
      />
    );
  }

  if (tab === "Images") {
    return visualEvidence.length ? (
      <VisualEvidenceStrip evidence={visualEvidence} embedded />
    ) : (
      <EmptyState
        icon={FileImage}
        title={emptyStates.imagesUsed.title}
        body={emptyStates.imagesUsed.body}
        live="polite"
      />
    );
  }

  if (tab === "Quotes") {
    return (
      <QuoteCards
        quotes={renderModel.quoteCards}
        copiedQuotes={copiedQuotes}
        onCopyQuotes={onCopyQuotes}
        onFollowUp={onFollowUpQuote}
        onScopeDocument={onScopeDocument}
      />
    );
  }

  return <EvidenceGapsPanel warnings={renderModel.warnings} />;
}

// UnifiedEvidenceDrawerContent was removed as it was defined but never used.
