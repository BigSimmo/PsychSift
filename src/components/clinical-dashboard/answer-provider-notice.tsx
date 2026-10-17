import { Globe, TriangleAlert } from "lucide-react";

import { cn, textMuted } from "@/components/ui-primitives";
import { answerUsesDegradedMode, type AnswerStateInput } from "@/components/ui/answer-state";
import { isProviderGenerationFallbackCode, publicFallbackReason } from "@/lib/rag/rag-fallback-reason";

/**
 * The overseas-processing line under an answer (audit S3, 2026-10-13). Shortened to one phone line by the
 * owner, 17 Oct 2026 (docs/decisions/2026-10-17-answer-page-tidy-up.md). It still names the service, says
 * it is overseas and asks for no patient details.
 */
export const ANSWER_PROVIDER_NOTICE_TEXT = "Sent to OpenAI overseas. Don't include patient details.";

/** The visible words when the model could not write the answer and the source text is shown instead. */
export const ANSWER_SUMMARY_UNAVAILABLE_TEXT = "AI summary unavailable";

/**
 * One quiet line under the latest answer. It was also on the Answer home before the first question
 * (owner decision, 13 Oct 2026) until the owner removed it from the home pages on 17 Oct 2026.
 *
 * It says where a clinical question goes, which the composer's privacy line ("Do not enter
 * patient-identifiable information.") does not. It sits below the answer rather than beside
 * the composer on purpose: the composer's height is measured and reserved exactly, so a longer
 * line there would move the search box and add the layout shift audit D16 is about. Below the
 * content, it moves nothing above it.
 *
 * Not shown in demo mode, where no question leaves the device, so the line is never untrue.
 */
export function AnswerProviderNotice({ className }: { className?: string }) {
  return (
    <p
      role="note"
      data-testid="answer-provider-notice"
      className={cn("flex min-w-0 items-start gap-1.5 text-2xs leading-4", textMuted, className)}
    >
      <Globe aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
      <span className="min-w-0">{ANSWER_PROVIDER_NOTICE_TEXT}</span>
    </p>
  );
}

/**
 * The public reason when this answer is degraded only because the model could not write it, else null.
 * One test for both places, so the sentence is never shown above the answer and below it at once.
 */
export function answerSummaryUnavailableReason(answer: AnswerStateInput): string | null {
  const code = answer.fallbackReasonCode;
  if (!answerUsesDegradedMode(answer) || !code || !isProviderGenerationFallbackCode(code)) return null;
  // A retrieval deadline also reports provider_timeout, but no evidence was confirmed. The client
  // payload drops routingReason, so the empty source list is the guard that holds in the browser:
  // with nothing confirmed, the warning stays above the answer.
  if (answer.routingReason === "retrieval_deadline_exceeded" || !answer.sources?.length) return null;
  return publicFallbackReason(code);
}

export const ANSWER_NO_CONFIRMED_SOURCES_TEXT =
  "Source evidence could not be confirmed, so no verified passages are shown. Please try again.";

/**
 * The sentence above a degraded answer. A provider code's own wording promises a verified
 * source-backed portion, which is false when no source came back (a retrieval deadline, for one).
 */
export function answerDegradationNoteText(answer: AnswerStateInput): string {
  const code = answer.fallbackReasonCode ?? "unknown";
  if (isProviderGenerationFallbackCode(code) && !answer.sources?.length) return ANSWER_NO_CONFIRMED_SOURCES_TEXT;
  return publicFallbackReason(code);
}

/**
 * Amber line directly under the overseas notice when the model could not write the answer
 * (owner decision, 17 Oct 2026). It replaced the grey sentence above the question, which pushed the
 * question and the answer down. Only the provider failures land here: every other degraded reason
 * says something about the evidence and keeps its full sentence above the answer.
 *
 * The visible words are short. The full public reason stays as screen-reader text, so a screen
 * reader still hears why and that the verified source-backed portion is what is shown.
 */
export function AnswerSummaryUnavailableNotice({
  answer,
  className,
}: {
  answer: AnswerStateInput;
  className?: string;
}) {
  const reason = answerSummaryUnavailableReason(answer);
  if (!reason) return null;
  return (
    <p
      role="note"
      data-testid="current-answer-degradation"
      className={cn(
        "flex min-w-0 items-start justify-center gap-1.5 text-center text-2xs leading-4 font-medium text-[color:var(--warning)]",
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
      <span>
        {ANSWER_SUMMARY_UNAVAILABLE_TEXT}
        <span className="sr-only">. {reason}</span>
      </span>
    </p>
  );
}
