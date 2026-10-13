"use client";

import { useRouter } from "next/navigation";
import { memo, useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { CircleAlert, ShieldAlert, TriangleAlert } from "lucide-react";

import { RetrievalStateBanner } from "@/components/ui/retrieval-state-banner";

import { type AnswerFeedbackType } from "@/lib/answer-feedback";
import { AnswerFollowUpSuggestions } from "@/components/clinical-dashboard/answer-follow-up-suggestions";
import { CrossModeLinksSection } from "@/components/clinical-dashboard/cross-mode-links";
import {
  answerIsNotInSources,
  answerIsRefusal,
  answerStateForAnswer,
} from "@/components/clinical-dashboard/answer-copy-payload";
import { AnswerNotInSources } from "@/components/clinical-dashboard/answer-not-in-sources";
import { AnswerInlineSections } from "@/components/clinical-dashboard/answer-inline-sections";
import {
  answerUsesAdaptiveMainSurface,
  projectAnswerForMainSurface,
  type ProjectedAnswerSection,
} from "@/components/clinical-dashboard/answer-section-projector";
import {
  isPreformattedGroundedAnswer,
  NaturalLanguageAnswer,
  UserQuestionBubble,
} from "@/components/clinical-dashboard/answer-content";
import { AnswerUtilityActions, SafetyFindingsListContent } from "@/components/clinical-dashboard/evidence-panels";
import { AnswerSourceDrawer } from "@/components/clinical-dashboard/answer-source-drawer";
import { useAnswerSourceSelection } from "@/components/clinical-dashboard/use-answer-source-selection";
import { CanonicalAnswerTables } from "@/components/clinical-dashboard/visual-evidence";
import {
  annotateSourceAttachments,
  buildAnswerSourceRows,
  citedSourceIdsForAnswerProjection,
} from "@/components/clinical-dashboard/answer-source-rows";
import { citedDocumentHref } from "@/components/clinical-dashboard/source-actions";
import { AnswerCard, type AnswerSupportStrength } from "@/components/ui/answer-card";
import { answerUsesDegradedMode, answerUsesSourceOnlyProvenance } from "@/components/ui/answer-state";
import { Sheet } from "@/components/ui/sheet";
import { answerSurface, cn } from "@/components/ui-primitives";
import { isCurrencyReviewWarning, type AnswerRenderModel } from "@/lib/answer-render-policy";
import { demoAnswerDisclosure } from "@/lib/answer-client-payload";
import { publicFallbackReason } from "@/lib/rag/rag-fallback-reason";
import type {
  ClientBestSourceRecommendation,
  ClientQuoteCard,
  ClientRagAnswerPayload,
  ClientSearchResult,
} from "@/lib/answer-client-payload";
import { type AppModeId } from "@/lib/app-modes";
import { cmeLearningFromRailHref } from "@/lib/cme/learning-source";
import { extractSafetyFindings, groupSafetyFindingsByKind } from "@/lib/clinical-safety";
import type { EvidenceSummary } from "@/lib/types";
import { type AnswerEvidenceMapRow, type AnswerViewMode } from "@/lib/ward-output";
import { compactVerificationWordingFor, VerificationNotice } from "@/components/ui/verification-notice";

/**
 * Renders a staged answer with inline content and optional clinical notes, evidence, safety findings, and follow-up interfaces.
 *
 * @returns The staged answer surface.
 */
/** The header status chips share one shape so they read as one status line.
 *
 * Sentence case at `--text-xs`, replacing uppercase at `--text-3xs`. **Owner preference, not a
 * spec violation being corrected** — `docs/design-system/sweep-2026-08-29-unenforced-rules.md`
 * row 9 counts `uppercase tracking-eyebrow` sites among the 75 SANCTIONED ones, so the previous
 * setting was allowed and SPEC §11 carries no gate either way. Recorded as preference so a later
 * reader does not take it for a rule.
 *
 * The size change is not cosmetic and must not be reverted with the capitalisation. At 10px,
 * `uppercase` + `tracking-eyebrow` was carrying real legibility: every glyph sat at cap height
 * with 0.08em of air. Sentence case at 10px drops most glyphs to x-height and takes the spacing
 * away, which would have left the single most load-bearing string on this screen quieter than
 * before rather than calmer. `--text-xs` is also what SPEC §"Type scale" assigns to chips; 10px
 * is the micro floor for count bubbles and legends.
 *
 * Nothing about what these state has changed: same words, same amber tokens, same icons. */
const chipShape = "inline-flex min-h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold";
/**
 * An interactive chip is a small pill inside a full-size button, not a small
 * button. `before:-inset-y-*` hit expansion draws the same 48px region and is
 * what DocumentTagCloud uses, but it is invisible to `boundingBox()` and so to
 * every tap-target check in the suite — and the safety chip is the only route to
 * the safety-critical findings sheet, which is the last control on this surface
 * that should rest on a target no gate can see. The button carries the height,
 * the inner pill carries the look.
 */
const chipButton =
  // Negative vertical margin is forbidden here. `-my-3` keeps `boundingBox()`
  // honest while moving the hit region outside the element's own layout box, so
  // the chip silently sits on top of its neighbours. Measured in Chromium at
  // 390px before that was removed: the safety chip covered a 133x9px band of the
  // support chip beside it and a 133x2px band of the answer prose below, and a
  // tap in either band opened the chip instead of doing nothing. Keep the full
  // 48px hitbox in layout; `AnswerCard` puts these chips in a centre-aligned
  // status row that takes its height from the tallest child, so the honest 48px
  // costs nothing even while they share the line with the static support pill.
  "inline-flex min-h-12 shrink-0 items-center focus-visible:outline-none";
const chipFocus =
  "group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[color:var(--focus)]";

function StagedAnswerResultSurfaceImpl({
  answer,
  query,
  bestSource,
  sourceSummary,
  renderModel,
  weakEvidence,
  sources,
  demoMode,
  safetyFindings,
  copiedAnswer,
  pendingFeedback,
  onCopyAnswer,
  onSubmitFeedback,
  onFollowUpQuote,
  crossModeQueries,
  onCrossModeSearch,
  followUpSuggestions,
  onPickFollowUpSuggestion,
  followUpSuggestionsDisabled = false,
  generating = false,
  onScopeDocument,
}: {
  answer: ClientRagAnswerPayload & { interactionId?: string };
  query: string;
  bestSource: ClientBestSourceRecommendation | null;
  sourceSummary?: EvidenceSummary;
  renderModel: AnswerRenderModel;
  weakEvidence: boolean;
  answerViewMode?: AnswerViewMode;
  answerEvidenceMapRows?: AnswerEvidenceMapRow[];
  answerGrounded?: boolean;
  sources: ClientSearchResult[];
  demoMode: boolean;
  /** Kept as an optional compatibility prop for extracted surface callers. */
  safeAnswerSections?: ProjectedAnswerSection[];
  safetyFindings: ReturnType<typeof extractSafetyFindings>;
  copiedAnswer: boolean;
  pendingFeedback: AnswerFeedbackType | null;
  onCopyAnswer: () => void;
  onSubmitFeedback: (feedbackType: AnswerFeedbackType) => void;
  onFollowUpQuote?: (quote: ClientQuoteCard) => void;
  crossModeQueries?: Array<string | null | undefined>;
  onCrossModeSearch?: (mode: AppModeId, query: string) => void;
  followUpSuggestions?: string[];
  onPickFollowUpSuggestion?: (suggestion: string) => void;
  followUpSuggestionsDisabled?: boolean;
  /** A generation is in flight — true for a follow-up, while the prior answer is still on screen. */
  generating?: boolean;
  /** Narrows the search to one document, from the source drawer's overflow menu. */
  onScopeDocument?: (documentId: string) => void;
}) {
  const router = useRouter();
  const isDemoAnswer = demoMode || answer.demoMode === true || answer.fallbackMode === "non_production_demo";
  const degradedAnswer = answerUsesDegradedMode({
    answerQualityTier: answer.answerQualityTier,
    fallbackReasonCode: answer.fallbackReasonCode,
    degradedMode: answer.degradedMode,
  });
  const sourceOnlyAnswer = answerUsesSourceOnlyProvenance({
    answerQualityTier: answer.answerQualityTier,
    routingMode: answer.routingMode,
  });
  const preformatted = isPreformattedGroundedAnswer(answer);
  const projectedAnswer = useMemo(
    () =>
      projectAnswerForMainSurface({
        answer,
        sources: answer.sources.length > 0 ? answer.sources : sources,
        preformatted,
      }),
    [answer, preformatted, sources],
  );
  const renderAdaptiveAnswer = answerUsesAdaptiveMainSurface(answer);
  const citedSourceIds = useMemo(
    () => (renderAdaptiveAnswer ? citedSourceIdsForAnswerProjection(projectedAnswer) : undefined),
    [projectedAnswer, renderAdaptiveAnswer],
  );
  const legacySourceCount =
    renderModel.primarySources.length ||
    sourceSummary?.total_sources ||
    sources.length ||
    answer.sources?.length ||
    answer.citations.length;
  // Adaptive source rows already carry their exact final citation order. Let
  // NaturalLanguageAnswer apply its existing four-row presentation cap to that
  // complete set rather than feeding it a trust-capped/recommended subset first.
  const leadSourceLinks = renderAdaptiveAnswer ? [] : renderModel.primarySources;
  const leadBestSource = renderAdaptiveAnswer ? null : bestSource;
  const leadSourceCount = renderAdaptiveAnswer ? projectedAnswer.leadCitationSources.length : legacySourceCount;
  const centralTables = renderModel.tables;
  /**
   * The one cited-source list. The rail under the answer lists these rows and the
   * drawer pages through them, so both are built from the same derivation rather
   * than each re-deriving from `primarySources` and drifting apart.
   */
  const railSources = useMemo(
    () =>
      annotateSourceAttachments(
        buildAnswerSourceRows(bestSource, sources, renderModel.primarySources, citedSourceIds),
        {
          tables: renderModel.tables,
          visualEvidence: renderModel.visualEvidence,
        },
      ),
    [bestSource, citedSourceIds, sources, renderModel.primarySources, renderModel.tables, renderModel.visualEvidence],
  );
  // The first cited source, never the question: see `cmeLearningFromRailHref`.
  const cpdHref = cmeLearningFromRailHref(railSources);
  // `trust` already distinguishes these; until now only a conditionally-rendered
  // side card ever showed the difference, so a "medium" answer - which includes
  // the case of a high-risk claim resting on unreviewed-authority evidence - read
  // exactly like a fully verified one. Wording lives in AnswerCard.
  // The word follows `supportLabelTrust`, which differs from `trust` only when a high-trust
  // answer has claims not all direct on approved or locally reviewed sources, or none at all
  // (#WGMB4Z decision 17): it then reads "Supported". Strong and supported share one tone.
  const answerSupport: AnswerSupportStrength =
    renderModel.supportLabelTrust === "high"
      ? "strong"
      : renderModel.supportLabelTrust === "medium"
        ? "supported"
        : renderModel.supportLabelTrust === "low"
          ? "limited"
          : "unassessed";
  const [safetyFindingsOpen, setSafetyFindingsOpen] = useState(false);
  const [evidenceGapsOpen, setEvidenceGapsOpen] = useState(false);
  /**
   * Which source the drawer is showing, whether a claim put it there, and that
   * claim's own support status — reset whenever the answer beneath them changes,
   * because all three are indices into one answer. See the hook for why that
   * reset is structural rather than left to the drawer's close handlers.
   */
  const {
    openIndex: openSourceIndex,
    claimIndex: claimSourceIndex,
    claimSupport,
    openFromRail: openSourceFromRail,
    openFromClaim: openSourceFromClaim,
    close: closeSourceDrawer,
  } = useAnswerSourceSelection(answer.interactionId ?? answer.answer);
  /**
   * "This page doesn't support the claim", from the drawer's overflow menu.
   *
   * It rides the answer feedback channel that already exists rather than a new
   * one: `wrong_source` is exactly this report in the shipped taxonomy
   * (`src/lib/answer-feedback.ts`), and reusing it means the report lands in the
   * same place a clinician's other answer feedback does.
   */
  const reportSourceMismatch = useCallback(() => {
    onSubmitFeedback("wrong_source");
  }, [onSubmitFeedback]);
  const safetyTriggerRef = useRef<HTMLButtonElement>(null);
  /**
   * Which pill opened the sheet, so closing returns focus there rather than to
   * the first pill in the rail.
   *
   * `safetyTriggerRef` alone cannot do this: the rail has one button per finding
   * kind, so a ref bound to the first would drag focus back to the left edge
   * after opening from any other pill — and because the rail scrolls
   * horizontally, that also scrolls the row out from under the reader. `Sheet`
   * consults this resolver before `returnFocusRef`, so the ref stays as the
   * fallback for the case where the opener has since unmounted.
   */
  const safetyOpenerRef = useRef<HTMLButtonElement | null>(null);
  // One trigger, so a plain ref is enough — unlike the safety rail, which has a button per
  // finding and needs `resolveSafetyReturnFocus` to send focus back to the one that was tapped.
  const limitationsTriggerRef = useRef<HTMLButtonElement>(null);
  function openSafetyFindings(event: MouseEvent<HTMLButtonElement>) {
    safetyOpenerRef.current = event.currentTarget;
    setSafetyFindingsOpen(true);
  }
  const resolveSafetyReturnFocus = useCallback(() => {
    const opener = safetyOpenerRef.current;
    // Only if it is still in the document — a re-rendered answer replaces these
    // buttons, and focusing a detached node silently drops focus to <body>.
    return opener?.isConnected ? opener : null;
  }, []);

  function closeSafetyFindingsReview() {
    setSafetyFindingsOpen(false);
  }
  /**
   * PR 13 answer adoption. The design system's projection of the same payload,
   * built here so the live support-priority caution and the DS
   * `RetrievalStateBanner` are two renderings of one state rather than two
   * independent readings of the same fields.
   *
   * Goes through `answerStateForAnswer` so empty `answer.sources` still falls
   * back to the search-result set — the same resolution the clipboard path uses.
   * `weakEvidence` is passed through rather than re-derived — render trust is
   * the render policy's decision, not this layer's.
   */
  const answerState = useMemo(
    () => answerStateForAnswer({ answer, sources, weakEvidence }),
    [answer, sources, weakEvidence],
  );
  const refusalAnswer = answerIsRefusal({ answer, answerState });
  const notInSources = answerIsNotInSources(answer, { demo: isDemoAnswer });

  // Built once so both arms of the `ready` / degraded split below stay identical.
  // The split exists only because `AnswerCardProps` discriminates on `state` to make
  // `onOpenSource` required for a degraded card (DECISIONS §Q1), and a union-typed
  // `state` cannot narrow that at the call site.
  const answerVerification = {
    state: answerState.kind,
    // Chat framing: one quiet governed line above the prose at every width, with
    // the complete wording still printed. Clinical owner approved 2026-08-25 —
    // see the `inline` docstring in verification-notice.tsx.
    presentation: "inline" as const,
    // From the quality tier, never from the state kind: #207 precedence lets
    // stale/partial/ungrounded outrank source_only, so keying on the kind announced
    // "AI-generated" directly above the Source-only disclosure saying no model wrote
    // it (#228).
    attribution: (sourceOnlyAnswer ? "extractive" : "model") as "extractive" | "model",
    sourceCount: "sourceCount" in answerState ? answerState.sourceCount : leadSourceCount,
    className: sourceOnlyAnswer ? "hidden print:flex" : undefined,
  };
  /**
   * The header status line the approved specimen draws: the support chip (owned
   * by AnswerCard) and the safety-notes control.
   *
   * The cited count is deliberately NOT here. It was, and at 390px it rendered
   * "2 cited" twice within one screen — once beside the support chip and again
   * on the source rail's own heading 160px below, which already reads
   * "2 cited · 1 also found" and is the only place that explains why an uncited
   * card carries a dash instead of a number. Two spellings of one number in one
   * glance invite the reader to look for a difference between them.
   *
   * The safety findings themselves are NOT here any more (owner decision,
   * 2026-09-03). They render as the Key points rail below the prose, at the
   * seam where the answer ends and its evidence begins, because a finding is
   * extracted content rather than a statement about the answer's status. This
   * row is now the support chip plus the limitations control alone.
   */
  const answerMetaChips = null;
  /**
   * The Key points rail: one pill per finding kind, in severity order,
   * every pill opening the same sheet.
   *
   * Grouped by kind because `SafetyFinding` carries no short title — only
   * `label` ("Contraindication") and `text`, the whole passage — so a pill per
   * finding would either repeat "Monitoring" twice or put a full passage in a
   * pill. The count carries the repetition instead.
   *
   * Each pill is a small pill inside a full-size button, exactly as the header
   * chips are, and for the same recorded reason: `before:-inset-y-*` hit
   * expansion draws a 48px region that `boundingBox()` cannot see, so every
   * tap-target gate passes while the control silently covers its neighbours.
   * The button carries the height, the pill carries the look.
   */
  const clinicalPointGroups = useMemo(() => groupSafetyFindingsByKind(safetyFindings), [safetyFindings]);
  const clinicalPointsRail =
    safetyFindings.length > 0 ? (
      <section
        data-testid="answer-clinical-points"
        aria-label={`Key points — ${safetyFindings.length} ${safetyFindings.length === 1 ? "point" : "points"}`}
        // Wraps rather than scrolling sideways: with large text at 320px a hidden-scrollbar
        // strip pushed "Open key points" past the right edge (audit D17, 2026-10-13).
        className="flex min-w-0 flex-wrap items-center gap-x-2"
      >
        <span className="shrink-0 text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
          Key points
        </span>
        {clinicalPointGroups.map((group, index) => (
          <button
            key={group.kind}
            // The first pill is the sheet's return-focus target, so a tap
            // anywhere on the rail returns focus somewhere predictable.
            ref={index === 0 ? safetyTriggerRef : undefined}
            id={index === 0 ? "answer-safety-findings-drawer-trigger" : undefined}
            data-testid={index === 0 ? "answer-safety-findings-trigger" : "answer-clinical-point"}
            data-tone={group.tone}
            type="button"
            onClick={openSafetyFindings}
            className={cn("group shrink-0", chipButton)}
            aria-label={`Open key points — ${group.label}${group.count > 1 ? `, ${group.count}` : ""}`}
          >
            <span
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-2xs font-medium transition",
                group.tone === "stop"
                  ? "border-[color:var(--danger)]/35 bg-[color:var(--danger)]/8 text-[color:var(--text-heading)] group-hover:bg-[color:var(--danger)]/12"
                  : group.tone === "act"
                    ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]/60 text-[color:var(--text-heading)] group-hover:bg-[color:var(--warning-soft)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface-wash)] text-[color:var(--text)] group-hover:bg-[color:var(--surface-subtle)]",
                chipFocus,
              )}
            >
              {group.tone === "stop" ? (
                <ShieldAlert aria-hidden="true" className="size-icon-xs shrink-0 text-[color:var(--danger)]" />
              ) : group.tone === "act" ? (
                <TriangleAlert aria-hidden="true" className="size-icon-xs shrink-0 text-[color:var(--warning)]" />
              ) : (
                <CircleAlert aria-hidden="true" className="size-icon-xs shrink-0 text-[color:var(--text-muted)]" />
              )}
              {group.label}
              {/* Neutral, never a status-coloured numeral. */}
              {group.count > 1 ? <span className="nums text-[color:var(--text-muted)]">{group.count}</span> : null}
            </span>
          </button>
        ))}
      </section>
    ) : null;
  /**
   * Evidence gaps sit with the other status chips rather than in the action row.
   * They are a statement about the answer's evidence, like the safety notes
   * beside them — and the action row the specimen draws is Copy plus the two
   * verdicts, which at 390px is already the full width of the row.
   */
  const answerReviewDue = answerState.kind === "stale_evidence";
  /**
   * "A supporting source is due for review." is a currency warning, not a gap in
   * the evidence, so it is never counted as one — it is the same fact the
   * `Review due` half of the label already carries.
   */
  const answerGapWarningCount = renderModel.warnings.filter((warning) => !isCurrencyReviewWarning(warning)).length;
  /**
   * The chip is the ONLY place the default view states that a cited source is
   * overdue on a source-only answer, and since the Source-only pill was folded
   * into this disclosure it is also the only place the default view states that
   * no model wrote the answer. `VerificationNotice` is `hidden print:flex`
   * there, so if the label drops either fact, nothing on screen carries it.
   *
   * That is why `Source-only` and `Review due` are prefixes rather than
   * alternatives to the count: dropping `Review due` for a warning count was a
   * genuine regression in an earlier cut, and the combination that exposes it
   * (source-only + stale + warnings) is the common one, because the same overdue
   * assessment that sets the stale state also adds a warning.
   */
  const answerLimitationsChipLabel = [
    sourceOnlyAnswer ? "Source-only" : null,
    answerReviewDue || (answerGapWarningCount === 0 && renderModel.warnings.length > 0) ? "Review due" : null,
    answerGapWarningCount > 0 ? `${answerGapWarningCount} limitation${answerGapWarningCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const answerMetaChipsWithGaps =
    renderModel.warnings.length > 0 || answerReviewDue || sourceOnlyAnswer ? (
      <>
        {answerMetaChips}
        <button
          id="answer-limitations-trigger"
          data-testid="answer-limitations-trigger"
          type="button"
          ref={limitationsTriggerRef}
          onClick={() => setEvidenceGapsOpen(true)}
          className={cn("group", chipButton)}
          aria-label={`Answer limitations — ${answerLimitationsChipLabel}`}
          // `aria-haspopup`, not `aria-expanded`/`aria-controls`. This opens a dialog now, and
          // the two announcements are not interchangeable: `aria-expanded` promises a region
          // revealed in place, which is exactly the behaviour that has gone. The dialog is not
          // in the tree while closed, so a persistent `aria-controls` would dangle.
          aria-haspopup="dialog"
        >
          <span
            className={cn(
              chipShape,
              evidenceGapsOpen
                ? "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] text-[color:var(--text-heading)]"
                : // `--text`, not `--text-muted`. On a source-only answer `VerificationNotice` is
                  // `hidden print:flex`, so this label is the ONLY on-screen carrier of "no model
                  // wrote this answer" and "a cited source is overdue". Muted grey made the
                  // one string that must be read the quietest thing in the row.
                  "border-[color:var(--border)] bg-[color:var(--surface-wash)] text-[color:var(--text)] group-hover:bg-[color:var(--surface-subtle)]",
              "transition",
              chipFocus,
            )}
          >
            <CircleAlert aria-hidden="true" className="size-icon-xs shrink-0 text-[color:var(--warning)]" />
            {answerLimitationsChipLabel}
            {/* No chevron. A chevron promises an expansion in place; this opens a sheet, and
                the sheet's own arrival is the state change a reader sees. The earlier note
                here — that the chip looked identical open and closed, so on a phone the only
                way to tell was to find the panel — no longer applies for the same reason. */}
          </span>
        </button>
      </>
    ) : (
      answerMetaChips
    );

  /**
   * The overdue-sources control, which names WHICH cited sources are past their
   * review date and links to each.
   *
   * It used to sit in the answer body, below the prose. Owner decision
   * (2026-09-01): it belongs inside the evidence-gaps disclosure, with the other
   * statements about what qualifies this answer's evidence, rather than above
   * it. Only the per-source detail — WHICH sources, and the route into each — is
   * behind the tap; that a source is overdue at all is still stated on the
   * default view, by `VerificationNotice` on a model-written answer and by the
   * chip's `Review due` label on every answer including source-only ones, where
   * that notice is `hidden print:flex`.
   */
  const overdueSourcesBanner =
    answerState.kind === "stale_evidence" ? (
      <RetrievalStateBanner
        state={answerState}
        onOpenSource={openAnswerStateSource}
        className="w-fit min-w-0 max-w-full flex-none self-start"
      />
    ) : null;
  /**
   * The limitations content, now the body of a sheet rather than a panel that expanded in place.
   *
   * The move is not cosmetic. `evidence-panels.tsx` already records what an in-flow disclosure
   * does on this surface: it opens partly behind the fixed phone composer and cannot scroll
   * clear of it, so the reader is shown a panel they cannot finish reading. A `Sheet` owns its
   * own scrollport above that composer. It also settles the layout argument that put the chip on
   * its own row — a panel that is no longer in the flow cannot push the governed caution below
   * it down the page, which is what the previous placement note here was guarding against.
   *
   * It exists for an overdue-sources banner alone, not only for warnings —
   * otherwise moving the banner in here would delete it outright on an answer
   * whose only evidence qualification is that a source is overdue. It exists for
   * `sourceOnly` alone for the same reason: that is the answer with the most to
   * disclose and the one most likely to carry no other warning.
   *
   * Order is severity, not source: provenance first, then which sources are
   * overdue, then the rest.
   */
  const answerEvidenceGapsDetail =
    renderModel.warnings.length > 0 || overdueSourcesBanner || sourceOnlyAnswer ? (
      <div id="answer-limitations-detail" className="grid gap-2">
        {/* The governed extractive wording, verbatim from the same lookup the
            Source-only pill used before it was folded in here. Never reworded at
            this call site. */}
        {sourceOnlyAnswer ? (
          <p
            data-testid="answer-limitation-source-only"
            className="rounded-md border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]/70 px-2.5 py-2 text-xs leading-5 text-[color:var(--text)]"
          >
            <span className="mb-0.5 block text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--warning)]">
              Source-only
            </span>
            {compactVerificationWordingFor(answerState.kind, "extractive")}
          </p>
        ) : null}
        {overdueSourcesBanner}
        {renderModel.warnings.map((warning, index) => (
          <p
            key={`${warning}:${index}`}
            className="rounded-md border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]/45 px-2.5 py-2 text-xs leading-5 text-[color:var(--text)]"
          >
            {warning}
          </p>
        ))}
      </div>
    ) : null;

  function openAnswerStateSource(sourceId: string, locator?: string) {
    const href = citedDocumentHref(sourceId, locator, [...sources, ...(answer.sources ?? [])]);
    if (href) router.push(href);
  }

  const answerProse = (
    <>
      <NaturalLanguageAnswer
        text={projectedAnswer.leadText}
        query={query}
        preformatted={preformatted}
        sourceCount={leadSourceCount}
        sourceOnly={sourceOnlyAnswer}
        bestSource={leadBestSource}
        sources={projectedAnswer.leadCitationSources}
        sourceLinks={leadSourceLinks}
        clinicalPoints={clinicalPointsRail}
        claims={answer.claimMarks}
        railRows={railSources}
        onOpenSource={openSourceFromClaim}
        onOpenRailSource={openSourceFromRail}
        openSourceIndex={openSourceIndex}
        showCopyAction={false}
        isRefusal={refusalAnswer}
        copied={copiedAnswer}
        onCopy={onCopyAnswer}
      />
      {renderAdaptiveAnswer ? <AnswerInlineSections sections={projectedAnswer.sections} /> : null}
    </>
  );

  return (
    <div className="min-w-0 space-y-4 motion-safe:animate-fade-up sm:space-y-5" data-dashboard-stage="answer-surface">
      {/* No outer p-2.5: AnswerCard is the raised surface (#216). Nesting panel
          padding here stacked on the card's own pad and blew the phone short-answer
          scroll budget (#227) by ~60px. */}
      <div className={cn(answerSurface, "space-y-3")}>
        {/* Decision 2 (2026-08-24): tables fold into the source drawer, so there is
            no longer a wide-screen aside for the echo to align against and the card
            owns the query echo in every layout. */}
        <div data-testid="table-specific-answer-layout" data-desktop-table-aside="false" className="space-y-3">
          <div className="min-w-0 space-y-3">
            {/* PR 13 answer adoption. System-owned verification wording sits above
                ordinary prose. A source-only answer folds the compact wording into
                its disclosure on screen, while print keeps the complete notice in
                document order. The call site chooses the state, never the words.
                The degraded banner carries the one-click route back to the cited
                page, so a caution is never raised with nowhere to go. */}
            {/* One count, not two. The notice and the banner are the two
                governance statements on this surface and they sit adjacent, so
                reading "Based on 3 cited sources." directly above "2 of 7
                sources for this answer are past their review date" leaves a
                clinician unable to tell how much of the evidence base is
                overdue. Both now come from the projection. `source_only` is the
                one kind that carries no count, hence the `in` guard.

                The card owns the notice, the banner, the query echo, and their
                order now. The banner it raises is scoped to
                `stale_evidence`/`partial_retrieval` — the two kinds that say
                something the notice cannot (#227 over #207; see answer-card.tsx).
                This surface no longer decides that. */}
            {isDemoAnswer ? (
              <p role="note" className="text-sm text-[color:var(--warning)]">
                {demoAnswerDisclosure}
              </p>
            ) : null}
            {degradedAnswer ? (
              <p
                role="note"
                data-testid="current-answer-degradation"
                className="text-sm text-[color:var(--text-muted)]"
              >
                {publicFallbackReason(answer.fallbackReasonCode ?? "unknown")}
              </p>
            ) : null}
            {/* The question is a chat bubble on the current turn, exactly as it is
                on every prior turn. It used to be a muted echo inside the card
                header, which made the newest exchange read as a document with a
                subtitle while the ones above it read as a conversation.
                `AnswerCardQueryEcho`'s sr-only "Question: " prefix travels with
                it (see UserQuestionBubble) so the framing change costs a screen
                reader nothing. */}
            <UserQuestionBubble query={query} />
            {notInSources ? (
              // Its own layout, not an answer card: no support chip, limitations count,
              // source cards, Copy, CPD or dose caution around a refusal (audit D03).
              <AnswerNotInSources
                text={projectedAnswer.leadText}
                query={query}
                preformatted={preformatted}
                searchedCount={sourceSummary?.total_sources ?? (sources.length || answer.sources.length)}
              />
            ) : answerState.kind === "ready" ? (
              <AnswerCard
                state={answerState}
                verification={answerVerification}
                support={answerSupport}
                frame="bare"
                retrievalStatePlacement="content"
                verificationPlacement="content"
                metaChips={answerMetaChipsWithGaps}
              >
                {answerProse}
              </AnswerCard>
            ) : (
              <AnswerCard
                state={answerState}
                verification={answerVerification}
                support={answerSupport}
                frame="bare"
                retrievalStatePlacement={answerState.kind === "stale_evidence" ? "content" : "header"}
                verificationPlacement="content"
                metaChips={answerMetaChipsWithGaps}
                // Navigate to the cited page — do not reuse onScopeDocument. That
                // handler only replaces selectedDocumentIds and leaves the clinician
                // on the answer screen with a silent filter change while the button
                // is labelled "Open <source>, p. N".
                onOpenSource={openAnswerStateSource}
              >
                {answerProse}
              </AnswerCard>
            )}

            {notInSources ? null : (
              <AnswerUtilityActions
                copied={copiedAnswer}
                onCopy={onCopyAnswer}
                cpdHref={cpdHref}
                pendingFeedback={pendingFeedback}
                onSubmitFeedback={onSubmitFeedback}
              />
            )}

            {/* The governed caution, placed here rather than above the prose
                (owner decision, 2026-08-31, matching the approved specimen).
                `verificationPlacement="content"` on both AnswerCard arms is the
                other half of this: the card still owns the wording and still
                refuses to render an answer without it, and this is the surface
                honouring the obligation that prop documents. The words are
                unchanged. */}
            {/* A "Not in your sources" answer states no clinical content, so it carries no
                caution about checking doses and numbers (audit D03). */}
            {notInSources ? null : <VerificationNotice {...answerVerification} />}

            {/* Kept, though the approved specimen does not draw it: that specimen
                is one answer with no library matches to show, and this collapsed
                line is the only route from an answer to the Medication and
                Differentials records behind it. Removing chrome a picture omits
                is one thing; removing a navigation route on the same evidence is
                another. Still collapsed, still below the caution. */}
            {crossModeQueries?.length && onCrossModeSearch ? (
              // `universalMode` is what lets this line reach DSM, Formulation,
              // Specifiers, Therapy, Dictionary and Tools, which no catalogue in
              // the browser can resolve. Answer is the only surface that may pass
              // it: every other mode mounts `UniversalSearchAlsoMatches`, and a
              // second lookup there would print the same records twice.
              //
              // Withdrawn while generating, matching the rule the sibling tray
              // follows on this mode (`answer && !loading` in ClinicalDashboard),
              // so the lookup never races the answer stream and the open tray
              // never holds matches for the question being replaced.
              <CrossModeLinksSection
                queries={crossModeQueries}
                onModeSearch={onCrossModeSearch}
                variant="line"
                universalMode={generating ? undefined : "answer"}
              />
            ) : null}

            {followUpSuggestions?.length && onPickFollowUpSuggestion ? (
              <AnswerFollowUpSuggestions
                suggestions={followUpSuggestions}
                onPick={onPickFollowUpSuggestion}
                disabled={followUpSuggestionsDisabled}
                layout="rows"
              />
            ) : null}

            {/* Report a problem stays, for a reader who knows the library does cover this. */}
            {notInSources ? (
              <AnswerUtilityActions
                reportOnly
                copied={copiedAnswer}
                onCopy={onCopyAnswer}
                pendingFeedback={pendingFeedback}
                onSubmitFeedback={onSubmitFeedback}
              />
            ) : null}
          </div>
        </div>

        {/* Tables live in the drawer, and the drawer is reached through a rail row.
            `dedupeVisualEvidence` only filters visual evidence against the primary
            sources when there are some, so an answer can carry a table with no
            cited source to hang it off — and that table would then have no route at
            all. Render those in place rather than lose them. */}
        {!notInSources && centralTables.length > 0 && railSources.length === 0 ? (
          <div data-testid="answer-uncited-tables" className="min-w-0">
            <CanonicalAnswerTables tables={centralTables} />
          </div>
        ) : null}

        <AnswerSourceDrawer
          sources={railSources}
          openIndex={openSourceIndex}
          activeSupportIndex={claimSourceIndex}
          activeClaimSupport={claimSupport}
          // Paging past the source a claim pointed at drops the claim, so the
          // support sentence stops describing a page the reader is no longer on.
          onOpenIndexChange={openSourceFromRail}
          onClose={closeSourceDrawer}
          query={query}
          tables={centralTables}
          visualEvidence={renderModel.visualEvidence}
          quoteCards={renderModel.quoteCards}
          onFollowUpQuote={onFollowUpQuote}
          onScopeDocument={onScopeDocument}
          onReportSource={reportSourceMismatch}
        />

        {safetyFindings.length > 0 ? (
          <Sheet
            open={safetyFindingsOpen}
            onClose={closeSafetyFindingsReview}
            title="Key points"
            description="Drawn from the cited source text. Verify before clinical use."
            closeLabel="Close key points"
            // The warning tones are written out rather than layered onto
            // `iconTilePremium`: that recipe carries the clinical-accent border and
            // background, so appending `text-…` recoloured only the glyph — the sheet
            // opened with an amber shield sitting in a blue tile while the card that
            // opens it drew an amber one. This matched the retired answer support
            // card's tile exactly (#51975R), so the colour the design assigns to the
            // icon tile is the same on both sides of the tap.
            headerLeading={
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]">
                <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
            }
            // Neutral for the same reason as the trigger row's count: the header's
            // icon tile and title carry the state, so the number itself must not be a
            // status-coloured numeral.
            titleAccessory={
              <span className="nums grid h-5 min-w-5 place-items-center rounded border border-[color:var(--border)] bg-[color:var(--surface-wash)] px-1 text-2xs font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]">
                {safetyFindings.length}
              </span>
            }
            headerClassName="gap-2 p-2.5 sm:p-3"
            titleClassName="text-base-minus leading-5"
            closeButtonClassName="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            contentClassName="max-h-[88dvh] bg-[color:var(--surface-raised)] sm:max-h-[min(80dvh,36rem)] sm:max-w-lg"
            // No `flex flex-col` here. The Sheet body is the scrollport, and as a flex
            // column its single child (the findings card) became a shrinkable flex
            // item: it was compressed from its natural height to whatever was left,
            // and because that card is `overflow-hidden` the findings below the fold
            // were clipped rather than scrolled. The body then had nothing to scroll,
            // so the gesture went to the page behind the sheet. A plain block
            // scrollport keeps the list at its natural height and scrolls it.
            bodyClassName="bg-[color:var(--surface-raised)] px-3 pb-0 pt-2 sm:p-3"
            resolveReturnFocusTarget={resolveSafetyReturnFocus}
            returnFocusRef={safetyTriggerRef}
          >
            <SafetyFindingsListContent findings={safetyFindings} />
          </Sheet>
        ) : null}

        {/* The limitations sheet. Same shape as the key-points sheet above deliberately: two chips
            sitting on one status line should not open two different kinds of thing. */}
        {answerEvidenceGapsDetail ? (
          <Sheet
            open={evidenceGapsOpen}
            onClose={() => setEvidenceGapsOpen(false)}
            title="Answer limitations"
            description="What qualifies the evidence behind this answer."
            closeLabel="Close answer limitations"
            headerLeading={
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]">
                <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
            }
            headerClassName="gap-2 p-2.5 sm:p-3"
            titleClassName="text-base-minus leading-5"
            closeButtonClassName="inline-flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            contentClassName="max-h-[88dvh] bg-[color:var(--surface-raised)] sm:max-h-[min(80dvh,36rem)] sm:max-w-lg"
            // Plain block scrollport, not `flex flex-col`, for the reason recorded on the sheet
            // above: as a flex column the single child is shrunk to the space left rather than
            // kept at its natural height, and the overflow is clipped instead of scrolled.
            bodyClassName="bg-[color:var(--surface-raised)] px-3 pb-3 pt-2 sm:p-3"
            returnFocusRef={limitationsTriggerRef}
          >
            {answerEvidenceGapsDetail}
          </Sheet>
        ) : null}
      </div>
    </div>
  );
}

// Memoized so keystrokes in the follow-up composer (which live in the parent
// ClinicalDashboard's `query` state) no longer re-render this 385-line answer +
// evidence subtree. All props are stable across keystrokes: the parent
// stabilizes its handlers with useCallback/useMemo and the `query` prop it
// passes is `latestAnswerQuery ?? query`, which is non-null and stable once an
// answer exists.
export const StagedAnswerResultSurface = memo(StagedAnswerResultSurfaceImpl);
