// A completed Q&A exchange kept on screen after a newer answer arrives (the
// answer-thread turn) and its collapsible read-only surface. Extracted from
// ClinicalDashboard.tsx (maturity X3) as a pure move.
import { memo, useMemo } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { buildAnswerRenderModel } from "@/lib/answer-render-policy";
import {
  isPreformattedGroundedAnswer,
  NaturalLanguageAnswer,
  UserQuestionBubble,
} from "@/components/clinical-dashboard/answer-content";
import { answerSurface, cn, textMuted } from "@/components/ui-primitives";
import {
  answerIsRefusal,
  answerStateForAnswer,
  buildAnswerClipboardText,
} from "@/components/clinical-dashboard/answer-copy-payload";
import { AnswerInlineSections } from "@/components/clinical-dashboard/answer-inline-sections";
import {
  buildAnswerSourceRows,
  citedSourceIdsForAnswerProjection,
} from "@/components/clinical-dashboard/answer-source-rows";
import {
  answerUsesAdaptiveMainSurface,
  projectAnswerForMainSurface,
} from "@/components/clinical-dashboard/answer-section-projector";
import { answerUsesDegradedMode, answerUsesSourceOnlyProvenance } from "@/components/ui/answer-state";
import type { AnswerPayload } from "@/components/clinical-dashboard/search-utils";
import { demoAnswerDisclosure } from "@/lib/answer-client-payload";
import type { ClientSearchResult } from "@/lib/answer-client-payload";

/**
 * A completed Q&A exchange kept on screen after a newer answer arrives, so
 * Answer mode reads as a conversation thread instead of replacing each result.
 */
export type AnswerTurn = {
  id: string;
  query: string;
  resolvedQuery?: string;
  answer: AnswerPayload;
  sources: ClientSearchResult[];
};

export const maxVisiblePriorTurns = 10;

/**
 * Renders a collapsible, read-only view of a previous answer-thread turn with its question, answer, sources, and source-review notice.
 *
 * @param turn - The previous question and answer turn to display
 * @param copied - Whether the turn's answer has been copied
 * @param collapsed - Whether the answer content is collapsed
 * @param onToggleCollapsed - Called when the answer visibility is toggled
 * @param onCopy - Called with the answer text when copying is requested
 */
export const PriorAnswerTurnSurface = memo(function PriorAnswerTurnSurface({
  turn,
  copied,
  collapsed,
  onToggleCollapsed,
  onCopy,
}: {
  turn: AnswerTurn;
  copied: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCopy: (text: string) => void;
}) {
  const renderModel = useMemo(
    () => buildAnswerRenderModel(turn.answer, { sources: turn.sources }),
    [turn.answer, turn.sources],
  );
  const turnPreformatted = isPreformattedGroundedAnswer(turn.answer);
  const projectedAnswer = useMemo(
    () =>
      projectAnswerForMainSurface({
        answer: turn.answer,
        sources: turn.answer.sources.length > 0 ? turn.answer.sources : turn.sources,
        preformatted: turnPreformatted,
      }),
    [turn.answer, turn.sources, turnPreformatted],
  );
  const renderAdaptiveAnswer = answerUsesAdaptiveMainSurface(turn.answer);
  const citedSourceIds = useMemo(
    () => (renderAdaptiveAnswer ? citedSourceIdsForAnswerProjection(projectedAnswer) : undefined),
    [projectedAnswer, renderAdaptiveAnswer],
  );
  const railSources = useMemo(
    () => buildAnswerSourceRows(renderModel.bestSource, turn.sources, renderModel.primarySources, citedSourceIds),
    [citedSourceIds, renderModel.bestSource, renderModel.primarySources, turn.sources],
  );
  const legacySourceCount =
    renderModel.primarySources.length ||
    turn.sources.length ||
    turn.answer.sources?.length ||
    turn.answer.citations.length;
  const leadSourceLinks = renderAdaptiveAnswer ? [] : renderModel.primarySources;
  const leadBestSource = renderAdaptiveAnswer ? null : renderModel.bestSource;
  const leadSourceCount = renderAdaptiveAnswer ? projectedAnswer.leadCitationSources.length : legacySourceCount;
  const previewText = projectedAnswer.leadText || turn.answer.answer;
  const degradedAnswer = answerUsesDegradedMode({
    answerQualityTier: turn.answer.answerQualityTier,
    fallbackReasonCode: turn.answer.fallbackReasonCode,
    degradedMode: turn.answer.degradedMode,
  });
  const sourceOnlyAnswer = answerUsesSourceOnlyProvenance({
    answerQualityTier: turn.answer.answerQualityTier,
    routingMode: turn.answer.routingMode,
  });
  // Same refusal definition as the live answer surface, so a turn does not
  // relabel its sources as cited once it scrolls into history.
  const refusalAnswer = answerIsRefusal({
    answer: turn.answer,
    answerState: answerStateForAnswer({
      answer: turn.answer,
      sources: turn.sources,
      weakEvidence: renderModel.trust === "low" || renderModel.trust === "unsupported",
    }),
  });
  const needsSourceReview =
    degradedAnswer ||
    turn.answer.grounded === false ||
    renderModel.trust === "low" ||
    renderModel.trust === "unsupported";

  return (
    <div
      // Historical conversation turns grow unbounded and most are collapsed and
      // scrolled off-screen; content-auto skips their layout/paint until near the
      // viewport. Safe here — the surface has no overflowing popovers, and the
      // expand toggle is only reachable once the turn is scrolled into view.
      className="content-auto min-w-0 space-y-4 sm:space-y-5"
      data-dashboard-stage="answer-thread-turn"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className={cn(answerSurface, "space-y-3 p-2.5 sm:p-3")}>
        <UserQuestionBubble query={turn.query} />
        {turn.answer.demoMode === true || turn.answer.fallbackMode === "non_production_demo" ? (
          <p role="note" className="text-sm text-[color:var(--warning)]">
            {demoAnswerDisclosure}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-md px-1 text-xs font-semibold text-[color:var(--text-muted)] transition hover:text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", !collapsed && "rotate-180")} aria-hidden="true" />
          {collapsed ? "Show previous answer" : "Hide previous answer"}
        </button>
        {collapsed ? (
          <p className={cn("line-clamp-2 text-sm leading-6", textMuted)}>{previewText}</p>
        ) : (
          <>
            <NaturalLanguageAnswer
              text={projectedAnswer.leadText}
              query={turn.query}
              preformatted={turnPreformatted}
              sourceCount={leadSourceCount}
              sourceOnly={sourceOnlyAnswer}
              bestSource={leadBestSource}
              sources={projectedAnswer.leadCitationSources}
              sourceLinks={leadSourceLinks}
              railRows={railSources}
              isRefusal={refusalAnswer}
              copied={copied}
              onCopy={() =>
                onCopy(
                  buildAnswerClipboardText({
                    answer: turn.answer,
                    sources: turn.sources,
                    weakEvidence: renderModel.trust === "low" || renderModel.trust === "unsupported",
                    renderCopyText: renderModel.copyText || previewText,
                  }),
                )
              }
            />
            {renderAdaptiveAnswer ? <AnswerInlineSections sections={projectedAnswer.sections} /> : null}
            {needsSourceReview ? (
              <div
                role="note"
                data-testid="prior-answer-source-review"
                className="mt-2 flex items-start gap-2 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--text-muted)]"
              >
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--warning)]" aria-hidden />
                <span>
                  <strong className="text-[color:var(--text-heading)]">Review source match.</strong>{" "}
                  {degradedAnswer && turn.answer.degradedMode?.reason
                    ? turn.answer.degradedMode.reason
                    : "Verify cited passages before relying on this previous answer."}
                </span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
});
