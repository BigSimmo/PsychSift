"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import {
  CircleAlert,
  Copy,
  ExternalLink,
  GraduationCap,
  Loader2,
  Quote,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { Sheet } from "@/components/ui/sheet";
import { type AnswerFeedbackType, type SubmitAnswerFeedback } from "@/lib/answer-feedback";
import { AnswerFeedbackPanel, answerFeedbackQuestion } from "@/components/clinical-dashboard/answer-feedback-panel";
import { CopyButton } from "@/components/clinical-dashboard/answer-status";
import { StrengthBadge } from "@/components/clinical-dashboard/badges";
import { SectionHeading } from "@/components/clinical-dashboard/dashboard-shell";
import { cleanDisplayTitle } from "@/components/clinical-dashboard/display-text";
import { SourceActionRow, logCitationOpen } from "@/components/clinical-dashboard/source-actions";
import {
  clinicalDivider,
  chatActionRow,
  chatMicroAction,
  cn,
  controlDisabled,
  codeText,
  EmptyState,
  iconTilePremium,
  proseMeasure,
  sourceCard,
  subtleStatusPill,
  toneWarning,
} from "@/components/ui-primitives";
import { type AnswerRenderModel } from "@/lib/answer-render-policy";
import { documentCitationHref, formatCompactCitationLabel } from "@/lib/citations";
import {
  formatSafetyFindingLabel,
  safetyFindingTone,
  sortSafetyFindingsBySeverity,
  type SafetyFinding,
  type SafetyFindingKind,
  type SafetyFindingTone,
} from "@/lib/clinical-safety";
import { normalizeSourceMetadata, sourceStatusLabel, validationStatusLabel } from "@/lib/source-metadata";
import { sourceTextForVerbatimQuote } from "@/lib/source-text-sanitizer";
import type { ClientQuoteCard, ClientRagAnswerPayload, ClientSearchResult } from "@/lib/answer-client-payload";
import type { EvidenceSummary, VisualEvidenceCard } from "@/lib/types";
import { emptyStates } from "@/lib/ui-copy";
import { type AnswerEvidenceMapRow } from "@/lib/ward-output";

export {
  AnswerViewModeControl,
  clinicalDetailContentCount,
  clinicalDetailMeta,
  clinicalDetailSummaryItems,
  displayItemsForClinicalDetailSection,
  EvidenceMapTable,
  simpleClinicalTableProps,
  sortClinicalDetailSections,
} from "@/components/clinical-dashboard/clinical-output-helpers";

/**
 * Quiet answer-level utilities under the source rail.
 *
 * Evidence gaps and feedback belong to the answer rather than one document, but
 * they are utilities rather than safety findings. Keeping them beside Copy with
 * sources stops the safety panel's warning chrome from colouring neutral actions.
 */
export function AnswerUtilityActions({
  copied,
  onCopy,
  pendingFeedback = null,
  onSubmitFeedback,
  cpdHref = null,
  reportOnly = false,
}: {
  copied: boolean;
  onCopy: () => void;
  pendingFeedback?: AnswerFeedbackType | null;
  onSubmitFeedback?: SubmitAnswerFeedback;
  /** A new CME entry with the lead cited source filled in; absent when nothing was cited. */
  cpdHref?: string | null;
  /**
   * "Not in your sources" (audit D03): there is no answer to copy, log as CPD or call
   * supported, so only "Report a problem" stays, for a reader who knows the library does
   * cover the question.
   */
  reportOnly?: boolean;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedbackTriggerRef = useRef<HTMLButtonElement>(null);
  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);
  /**
   * Submitting closes the sheet, because the sheet is where the outcome is NOT.
   *
   * `ClinicalDashboard.submitAnswerFeedback` reports every outcome — success,
   * network failure, an expired feedback token, and synthetic demo answers —
   * through the page-level `actionNotice` alone, which renders outside this
   * portaled modal. While the sheet is open that notice is behind the backdrop
   * and the page under it is inert, so the reader sees a tap that did nothing.
   * The demo and expired-token paths are the worst of it: both return before
   * `pendingFeedback` is ever set, so there is not even a spinner to explain the
   * silence.
   *
   * This did not arise until the list became a modal (2026-09-02). As an in-flow
   * disclosure the notice was simply visible above it, so nothing had to close.
   *
   * Closing unmounts the panel, so the typed note lives here and is cleared only
   * once the host reports the save succeeded: a refused or failed note reopens
   * intact for the reader to edit and resend.
   */
  const [draftNote, setDraftNote] = useState("");
  const submitFeedbackAndClose = useCallback(
    (feedbackType: AnswerFeedbackType, note?: string) => {
      const result = note ? onSubmitFeedback?.(feedbackType, note) : onSubmitFeedback?.(feedbackType);
      setFeedbackOpen(false);
      void Promise.resolve(result).then((saved) => {
        if (saved === true) setDraftNote("");
      });
    },
    [onSubmitFeedback],
  );
  return (
    <section className="max-w-[68ch]" aria-label="Answer utilities">
      {/* Copy sits left; the two verdict controls sit right, as the approved
          specimen draws them. The verdicts are icon-only because their meaning
          is the icon — a thumb — and a word beside each one would take the whole
          390px row on its own. Each carries a full sentence as its accessible
          name rather than "Thumbs up". Evidence gaps are NOT here: they are a
          statement about the answer's evidence and belong with the safety chip
          in the header, which is also what keeps this row to one line. */}
      {/* One line. At 320px with large text the row pushed "Report a problem" off the right
          edge (audit D17, 2026-10-13), so the Copy label now gives way (`min-w-0`, truncated)
          instead. Wrapping was tried and added a second 48px row under short answers. */}
      <div className={cn(chatActionRow, "flex-nowrap")} aria-label="Answer actions">
        {reportOnly ? null : (
          <button
            type="button"
            onClick={onCopy}
            className={cn(chatMicroAction, "min-w-0")}
            aria-label={`${copied ? "Copied" : "Copy"} with sources: answer and source status`}
          >
            <Copy aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {/* Below 360px (small phones) the full label truncated to "Copy …".
              The short word keeps the action legible; the accessible name is
              unchanged. */}
            <span className="truncate max-[359px]:hidden">{copied ? "Copied with sources" : "Copy with sources"}</span>
            <span className="hidden max-[359px]:inline">{copied ? "Copied" : "Copy"}</span>
          </button>
        )}
        {cpdHref && !reportOnly ? (
          <Link
            href={cpdHref}
            data-testid="answer-log-cpd"
            className={cn(chatMicroAction, "shrink-0")}
            aria-label="Log as CPD: learning from this answer's source"
          >
            <GraduationCap aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Log as CPD
          </Link>
        ) : null}
        {onSubmitFeedback ? (
          <span className="ms-auto flex shrink-0 items-center gap-1">
            {/* One tap records the product's existing positive verdict rather
                than opening a panel to choose the only affirmative option in
                it. `verified` is that option, and the panel's own question —
                "Is the answer supported?" — is what a thumb up answers. */}
            {reportOnly ? null : (
              <button
                data-testid="answer-feedback-useful"
                type="button"
                disabled={Boolean(pendingFeedback)}
                onClick={() => onSubmitFeedback("verified")}
                className={cn(chatMicroAction, controlDisabled, "min-w-12 justify-center px-2")}
                aria-label="This answer is supported by its sources"
              >
                {pendingFeedback === "verified" ? (
                  <Loader2 aria-hidden="true" className="size-icon-sm shrink-0 animate-spin" />
                ) : (
                  <ThumbsUp aria-hidden="true" className="size-icon-sm shrink-0" />
                )}
              </button>
            )}
            {/* The thumb down IS the way in to "report a problem": it opens the
                list of problem types rather than recording an unlabelled
                negative, because an unlabelled negative tells a reviewer
                nothing about which claim failed. */}
            <button
              ref={feedbackTriggerRef}
              id="answer-feedback-trigger"
              data-testid="answer-feedback-trigger"
              type="button"
              onClick={() => setFeedbackOpen((current) => !current)}
              className={cn(chatMicroAction, "min-w-12 justify-center px-2")}
              aria-haspopup="dialog"
              aria-expanded={feedbackOpen}
              aria-controls={feedbackOpen ? "answer-feedback-detail" : undefined}
              aria-label="Report a problem with this answer"
            >
              <ThumbsDown aria-hidden="true" className="size-icon-sm shrink-0" />
            </button>
          </span>
        ) : null}
      </div>
      {/* A Sheet, not an in-flow disclosure. As a disclosure this opened partly
          behind the fixed phone composer, and it could not scroll itself clear:
          every scripted scroll that would do it is a DOWNWARD scroll, downward
          scroll is what hides the phone chrome, and closing the panel then
          shrank the page back to the top without the upward travel that reveals
          the chrome again — so the composer stayed gone. `ui-smoke`'s critical
          answer journey caught exactly that, twice. The options were reachable
          by scrolling (measured 390x844: the last one cleared the composer by
          180px at full scroll), so the defect was never reachability — it was
          that the list LOOKED complete when it was not.

          A sheet answers both at once: it owns its own scrollport above the
          composer, so nothing is clipped and no page scroll is needed, and it is
          the same overlay the safety-findings control beside it already opens.
          `mobilePlacement` defaults to "bottom", so this rises from the bottom
          on a phone and is a centred dialog from `sm:` up. */}
      {onSubmitFeedback ? (
        <Sheet
          id="answer-feedback-detail"
          open={feedbackOpen}
          onClose={closeFeedback}
          returnFocusRef={feedbackTriggerRef}
          title={answerFeedbackQuestion.problems.title}
          description={answerFeedbackQuestion.problems.description}
          closeLabel="Close report a problem"
          testId="answer-feedback-sheet"
          headerLeading={
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-wash)] text-[color:var(--text-muted)]">
              <ThumbsDown aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          }
          headerClassName="gap-2 p-2.5 sm:p-3"
          titleClassName="text-base-minus leading-5"
          contentClassName="max-h-[88dvh] bg-[color:var(--surface-raised)] sm:max-h-[min(80dvh,36rem)] sm:max-w-lg"
        >
          {/* The sheet header already asks the question, so the panel does not
              ask it again. */}
          <AnswerFeedbackPanel
            pending={pendingFeedback}
            onSubmit={submitFeedbackAndClose}
            tone="problems"
            chrome="bare"
            note={draftNote}
            onNoteChange={setDraftNote}
          />
        </Sheet>
      ) : null}
    </section>
  );
}

function SafetyFindingRowIcon({ kind }: { kind: SafetyFindingKind }) {
  // Sized to the eyebrow beside it rather than to the old icon cell: at h-5 the
  // glyph outweighed the label it now sits next to.
  if (safetyFindingTone(kind) === "stop") {
    return <ShieldAlert aria-hidden="true" className="size-icon-xs shrink-0" />;
  }
  return <CircleAlert aria-hidden="true" className="size-icon-xs shrink-0" />;
}

/**
 * The accent for a finding's tone.
 *
 * `know` is deliberately the muted text colour rather than a status colour:
 * `docs/design-system/TOKENS.md` reserves `--danger` and `--warning` for
 * sanctioned urgency, and an answer where routine monitoring is painted amber
 * is one where the amber has stopped meaning anything.
 */
const safetyToneAccent: Record<SafetyFindingTone, string> = {
  stop: "text-[color:var(--danger)]",
  act: "text-[color:var(--warning)]",
  know: "text-[color:var(--text-muted)]",
};

// Issue 9: governance provenance retained on safety-finding citations lets the safety
// panel badge sources that are outdated, due for review, or not locally validated —
// the same currency/validation signals shown for ordinary source citations. Current
// and unknown-status sources add no badge (they carry no actionable caveat here).
function safetyFindingGovernanceLabels(citation: SafetyFinding["citation"]): string[] {
  const metadata = citation.source_metadata ? normalizeSourceMetadata(citation.source_metadata) : null;
  if (!metadata) return [];
  const labels: string[] = [];
  if (metadata.document_status === "outdated" || metadata.document_status === "review_due") {
    labels.push(sourceStatusLabel(metadata));
  }
  if (metadata.clinical_validation_status === "unverified") {
    labels.push(validationStatusLabel(metadata));
  }
  return labels;
}

/**
 * The safety findings list, as read on a phone.
 *
 * The row used to lead with three stacked pills — a kind pill, the source link,
 * then a governance pill — which at 390px wrapped to three lines and put ~110px
 * of chrome above the first word of the finding. The clinician is here for the
 * finding, so the order is now: what kind of finding, then the finding, then
 * where it came from.
 *
 * The kind is drawn as an eyebrow beside its icon rather than as a pill: the
 * icon and the pill were saying the same thing twice, and one line of them fits
 * the governance chip alongside instead of below.
 */
export function SafetyFindingsListContent({ findings, query }: { findings: SafetyFinding[]; query?: string }) {
  if (findings.length === 0) return null;

  const sortedFindings = sortSafetyFindingsBySeverity(findings);

  return (
    <div
      data-testid="safety-findings-panel"
      // shrink-0: this card clips its own overflow, so if a flex parent ever
      // compresses it the findings past the fold vanish with no way to reach
      // them. Inert outside a flex container.
      className="shrink-0 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]"
    >
      {sortedFindings.map((finding, index) => {
        const tone = safetyFindingTone(finding.kind);
        const accent = safetyToneAccent[tone];
        return (
          <article
            key={`${finding.id}:${finding.href}:${index}`}
            data-testid="safety-finding-row"
            data-tone={tone}
            // A 2px rule in the finding's own tone, so the list reads as a
            // gradient from stop to know while sorted by severity. The rule is
            // never the only carrier of that state — the eyebrow beside it names
            // the kind in words.
            className={cn(
              "grid gap-1.5 border-b border-l-2 border-[color:var(--border)] px-3 py-3 last:border-b-0",
              tone === "stop"
                ? "border-l-[color:var(--danger)]"
                : tone === "act"
                  ? "border-l-[color:var(--warning)]"
                  : "border-l-[color:var(--border-strong)]",
            )}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cn("inline-flex min-w-0 items-center gap-1.5", accent)}>
                <SafetyFindingRowIcon kind={finding.kind} />
                <span className="truncate text-3xs font-semibold uppercase tracking-eyebrow">{finding.label}</span>
              </span>
              {/* One `ms-auto` on the group, not on each chip. A citation can
                  carry two governance labels — a currency label and "not locally
                  validated" — and an auto margin on both splits the free space
                  between them, so neither ends up flush right. */}
              <span className="ms-auto flex items-center gap-2">
                {safetyFindingGovernanceLabels(finding.citation).map((label) => (
                  <span
                    key={label}
                    data-testid="safety-finding-governance"
                    // Scaled to the severity eyebrow beside it rather than above
                    // it: at text-2xs the governance chip was the largest thing
                    // in the row, so "Not locally validated" read as louder than
                    // "Red flag".
                    className={cn(subtleStatusPill, "min-h-6 px-2 text-3xs", toneWarning)}
                  >
                    {label}
                  </span>
                ))}
              </span>
            </div>
            <p className="text-sm leading-5 text-[color:var(--text-heading)]">{finding.text}</p>
            <Link
              href={finding.href}
              onClick={() => query && logCitationOpen(query, finding.citation)}
              // `-mb-1.5` trims the row's own bottom padding back, so a full tap
              // target does not read as a gap under the last finding.
              className="-mb-1.5 inline-flex min-h-tap min-w-0 items-center gap-1 text-xs font-semibold text-[color:var(--primary)] transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] lg:min-h-compact-meta"
              aria-label={`Open source ${formatSafetyFindingLabel(finding)}`}
            >
              <span className="truncate">{formatCompactCitationLabel(finding.citation)}</span>
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            </Link>
          </article>
        );
      })}
    </div>
  );
}

export function compactEvidenceSummary(
  answer: ClientRagAnswerPayload,
  sources: ClientSearchResult[],
  sourceSummary?: EvidenceSummary,
  renderModel?: AnswerRenderModel,
) {
  // Label-only cap (#WGMB4Z decision 17): the word follows supportLabelTrust, not trust.
  const support =
    renderModel?.supportLabelTrust === "high"
      ? "Strong support"
      : renderModel?.supportLabelTrust === "medium"
        ? "Supported"
        : renderModel?.supportLabelTrust === "low"
          ? "Limited support"
          : "Review support";
  const claimCount = renderModel?.evidenceRows.length || answer.answerSections?.length || answer.citations.length;
  const quoteCount = renderModel?.quoteCards.length ?? answer.quoteCards?.length ?? sourceSummary?.quote_count ?? 0;
  const tableCount = (renderModel?.visualEvidence ?? answer.visualEvidence ?? []).filter(
    (item) => item.accessibleTableMarkdown || item.tableRows?.length,
  ).length;
  const sourceCount = renderModel?.primarySources.length || sourceSummary?.total_sources || sources.length;
  const countParts = [
    claimCount > 0 ? `${claimCount} claim${claimCount === 1 ? "" : "s"}` : null,
    quoteCount > 0 ? `${quoteCount} quote${quoteCount === 1 ? "" : "s"}` : null,
    tableCount > 0 ? `${tableCount} table${tableCount === 1 ? "" : "s"}` : null,
  ].filter((part): part is string => Boolean(part));

  if (countParts.length === 0 && sourceCount > 0) {
    countParts.push(`${sourceCount} source${sourceCount === 1 ? "" : "s"}`);
  }

  return [support, ...countParts].join(" · ");
}

export type EvidenceTabName = "Claims" | "Quotes" | "Tables" | "Images" | "Gaps";

function renderModelAllows(renderModel: AnswerRenderModel, block: AnswerRenderModel["allowedBlocks"][number]) {
  return renderModel.allowedBlocks.includes(block);
}

export function evidenceTabOrder(_answer: ClientRagAnswerPayload, renderModel: AnswerRenderModel): EvidenceTabName[] {
  const order: EvidenceTabName[] = ["Claims", "Quotes", "Tables", "Images", "Gaps"];
  return order.filter((tab) => {
    if (tab === "Tables") {
      return (
        renderModelAllows(renderModel, "visualEvidence") &&
        renderModel.visualEvidence.some((item) => item.accessibleTableMarkdown || item.tableRows?.length)
      );
    }
    if (tab === "Images") return renderModelAllows(renderModel, "visualEvidence");
    if (tab === "Quotes") return renderModelAllows(renderModel, "quoteCards");
    if (tab === "Gaps") return renderModel.warnings.length > 0;
    return renderModelAllows(renderModel, "evidenceMap") || renderModelAllows(renderModel, "reviewSources");
  });
}

export function evidenceTabCount({
  tab,
  sources,
  visualEvidence,
  answerEvidenceMapRows,
  renderModel,
}: {
  tab: EvidenceTabName;
  sources: ClientSearchResult[];
  visualEvidence: VisualEvidenceCard[];
  answerEvidenceMapRows: AnswerEvidenceMapRow[];
  renderModel: AnswerRenderModel;
}) {
  if (tab === "Tables") {
    return visualEvidence.filter((item) => item.accessibleTableMarkdown || item.tableRows?.length).length;
  }
  if (tab === "Claims")
    return (
      answerEvidenceMapRows.length ||
      renderModel.evidenceRows.length ||
      sources.length ||
      renderModel.primarySources.length
    );
  if (tab === "Images") return visualEvidence.length;
  if (tab === "Quotes") return renderModel.quoteCards.length;
  return renderModel.warnings.length;
}

// Moved to a light module so the medication and therapy record pages can reuse the report panel
// without pulling this heavy component tree; re-exported to keep evidence-panels' public API stable.
export { AnswerFeedbackPanel, answerFeedbackQuestion } from "@/components/clinical-dashboard/answer-feedback-panel";

// Moved to a light module so the dashboard can import it without pulling this heavy component
// tree into the initial bundle; re-exported here to keep evidence-panels' public API stable.
export { evidenceMapRowsFromRenderModel } from "@/components/clinical-dashboard/evidence-map-model";

export function AnswerSafetyNotice({
  demoMode,
  weakEvidence = false,
  retrievalGateBlocked = false,
}: {
  demoMode: boolean;
  weakEvidence?: boolean;
  retrievalGateBlocked?: boolean;
}) {
  return (
    <div
      data-testid="answer-safety-notice"
      className={cn(
        "rounded-md border border-[color:var(--warning)]/20 border-l-2 border-l-[color:var(--warning)] px-2.5 py-2 text-xs leading-5",
        weakEvidence ? "bg-[color:var(--warning-soft)]/30" : "border-[color:var(--border)] bg-[color:var(--surface)]",
      )}
    >
      <p className="font-semibold text-[color:var(--text-heading)]">
        {weakEvidence
          ? "Weak source support; verify the linked source before relying on this answer."
          : "Draft only; verify source first before pasting into the medical record."}
      </p>
      {retrievalGateBlocked ? (
        <p className="mt-1 text-2xs text-[color:var(--warning)]">
          Retrieval confidence gate was triggered. Expand evidence details before using this result.
        </p>
      ) : null}
      {demoMode ? (
        <p className="mt-1 text-2xs font-semibold text-[color:var(--warning)]">
          Synthetic demo only: this is not clinical guidance.
        </p>
      ) : null}
    </div>
  );
}

export function QuoteCards({
  quotes,
  copiedQuotes,
  onCopyQuotes,
  onFollowUp,
  onScopeDocument,
  query,
}: {
  quotes: ClientQuoteCard[];
  copiedQuotes: boolean;
  onCopyQuotes: () => void;
  onFollowUp?: (quote: ClientQuoteCard) => void;
  onScopeDocument: (documentId: string) => void;
  query?: string;
}) {
  return (
    <section id="quotes" className="space-y-3 scroll-mt-4 sm:scroll-mt-6">
      <SectionHeading
        icon={Quote}
        title="Source quotes"
        description="Verbatim excerpts linked to the source PDF and page."
        hideDescriptionOnMobile
        compactMobile
        action={
          quotes.length > 0 ? (
            <CopyButton label="Copy exact quotes" shortLabel="Quotes" copied={copiedQuotes} onClick={onCopyQuotes} />
          ) : null
        }
      />
      {quotes.length === 0 ? (
        <EmptyState
          icon={Quote}
          title={emptyStates.exactQuotes.title}
          body={emptyStates.exactQuotes.body}
          live="polite"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {quotes.map((quote, index) => {
            const quoteText = sourceTextForVerbatimQuote(quote.quote);
            const quoteTitle = cleanDisplayTitle(quote.title);
            return (
              <article key={`${quote.chunk_id}:${quote.quote}`} className={cn(sourceCard, "p-3 sm:p-4")}>
                <div className="mb-2 flex items-center justify-between gap-3 sm:mb-3">
                  <span className={cn(iconTilePremium, codeText, "h-7 w-7 text-xs font-bold sm:h-8 sm:w-8")}>
                    {index + 1}
                  </span>
                  <StrengthBadge strength={quote.source_strength} />
                </div>
                <blockquote
                  className={cn(proseMeasure, "text-base-minus font-medium leading-6 text-[color:var(--text)]")}
                >
                  &ldquo;{quoteText}&rdquo;
                </blockquote>
                {quote.isTruncated ? (
                  <p className={cn("mt-1.5 text-xs", textMuted)}>
                    Quote shortened. Open the source for the full passage.
                  </p>
                ) : null}
                <div
                  className={cn(
                    "mt-3 flex flex-wrap items-center justify-between gap-2 pt-3 sm:mt-4 sm:gap-3",
                    clinicalDivider,
                  )}
                >
                  <span className="max-w-full text-base-minus font-semibold leading-6 text-[color:var(--primary)] sm:hidden">
                    {formatCompactCitationLabel(quote)}
                  </span>
                  <span className="hidden max-w-full text-xs font-semibold leading-5 text-[color:var(--primary)] sm:inline">
                    {quoteTitle}, page {quote.page_number ?? "n/a"}
                  </span>
                  <div className="w-full sm:w-auto">
                    <SourceActionRow
                      viewerHref={documentCitationHref(quote)}
                      sourceTitle={`quote ${index + 1} from ${quoteTitle}`}
                      documentId={quote.document_id}
                      onScopeDocument={onScopeDocument}
                      onFollowUp={onFollowUp ? () => onFollowUp(quote) : undefined}
                      onOpenSource={() => query && logCitationOpen(query, quote, quote.source_strength)}
                      divider={false}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
