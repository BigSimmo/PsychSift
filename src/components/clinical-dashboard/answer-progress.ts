import type { PublicAnswerProgressEvent, PublicAnswerProgressStage } from "@/lib/answer-progress-public";
import { isDeliverableVerifiedUnit } from "@/lib/answer-stream-contract";

export type AnswerProgressUpdate = PublicAnswerProgressEvent;
export type TimedAnswerProgressUpdate = AnswerProgressUpdate & { receivedAt: number };

const answerProgressStages = new Set<PublicAnswerProgressStage>([
  "scoping",
  "retrieving",
  "retrieved",
  "ranking",
  "generating",
  "retrying",
  "fallback",
  "verifying",
  "cached",
  "complete",
]);

function inferLegacyStage(message: string): PublicAnswerProgressStage {
  if (/\b(?:scope|prepar)/i.test(message)) return "scoping";
  if (/\b(?:search|retriev|indexed documents?)/i.test(message)) return "retrieving";
  if (/\b(?:rank|select|australian|evidence)/i.test(message)) return "ranking";
  if (/\b(?:fallback|source-backed|source based)/i.test(message)) return "fallback";
  if (/\b(?:retry|revis)/i.test(message)) return "retrying";
  if (/\b(?:draft|generat|answer route)/i.test(message)) return "generating";
  if (/\b(?:check|verif|citation|finaliz)/i.test(message)) return "verifying";
  if (/\bcach/i.test(message)) return "cached";
  if (/\bready|complete/i.test(message)) return "complete";
  return "retrieving";
}

function finiteCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function normalizeAnswerProgressEvent(
  data: unknown,
  lastVerifiedUnitSequence: number | null = null,
): AnswerProgressUpdate | null {
  if (typeof data === "string" && data.trim()) {
    const message = data.trim();
    return { stage: inferLegacyStage(message), message };
  }
  if (!data || typeof data !== "object") return null;

  const value = data as Record<string, unknown>;
  const message = typeof value.message === "string" && value.message.trim() ? value.message.trim() : "";
  if (!message) return null;
  const stage =
    typeof value.stage === "string" && answerProgressStages.has(value.stage as PublicAnswerProgressStage)
      ? (value.stage as PublicAnswerProgressStage)
      : inferLegacyStage(message);
  const verifiedUnit = isDeliverableVerifiedUnit(value.verifiedUnit, lastVerifiedUnitSequence)
    ? value.verifiedUnit
    : undefined;

  return {
    stage,
    message,
    ...(verifiedUnit === undefined ? {} : { verifiedUnit }),
    resultCount: finiteCount(value.resultCount),
    selectedContextCount: finiteCount(value.selectedContextCount),
    australianSourceCount: finiteCount(value.australianSourceCount),
    waSourceCount: finiteCount(value.waSourceCount),
    elapsedMs: finiteCount(value.elapsedMs),
  };
}

export function answerProgressStepIndex(stage: PublicAnswerProgressStage) {
  if (stage === "scoping") return 0;
  if (stage === "retrieving" || stage === "retrieved") return 1;
  if (stage === "ranking") return 2;
  if (stage === "generating" || stage === "retrying" || stage === "fallback") return 3;
  return 4;
}

/** UI copy is derived from the public stage and never from an incoming message.
 *
 * One rule holds this whole set together, taken from the pending screens in
 * the answer-chat-perfected-v2 design study (retired 2026-10-21; see git history):
 *
 *   **The wait shows no number the reader cannot reconcile with something on
 *   screen.**
 *
 * That rules out every raw count the stream offers. `resultCount` is candidate
 * chunks — commonly 24 where the answer will cite three — and a reader who takes
 * "24" away from this screen has been told the wrong thing about how much
 * evidence is behind their answer, whether or not the word beside it was
 * "passages". `australianSourceCount` fails the same test: it is real and it is
 * useful, but 4 of 6 is a ratio nothing on screen can confirm, so the fact
 * survives here as a fact ("Prioritising Australian sources") and the per-source
 * origin stays where it can be checked — on the sources themselves.
 *
 * The one count that IS shown lives in `answerProgressPreviewMessage` below,
 * because it counts exactly the cards visible beneath the line.
 *
 * Accrual does not depend on numbers. A healthy wait moves through four
 * distinct clauses in roughly seven seconds, which is what tells a reader the
 * search is working rather than stuck.
 */
export function answerProgressDisplayMessage(progress: AnswerProgressUpdate) {
  if (progress.stage === "scoping") return "Reading your question…";
  if (progress.stage === "retrieving" || progress.stage === "retrieved") return "Searching your documents…";
  if (progress.stage === "ranking") {
    // The fact, not the ratio. A Perth reader cares that local guidance is being
    // favoured; "4 of 6" is the part nothing on screen can confirm.
    return progress.australianSourceCount
      ? "Prioritising Australian sources…"
      : "Selecting the most relevant passages…";
  }
  if (progress.stage === "retrying") return "Revising the draft against the evidence…";
  if (progress.stage === "fallback") return "Assembling the answer from the sources directly…";
  if (progress.stage === "generating") return "Writing the answer…";
  if (progress.stage === "verifying") return "Checking citations and clinical numbers…";
  if (progress.stage === "cached") return "Loading a recent cited answer…";
  return "Answer ready.";
}

/**
 * The line once the evidence preview is on screen.
 *
 * This is the only place the wait prints a number, and it prints the number of
 * cards the reader can count directly beneath it. The mockup's wording
 * ("3 sources found · writing the answer…") is kept because it names both halves
 * of what is true at that moment: retrieval finished, generation has not.
 *
 * Returns null before generation starts, so the caller falls back to the stage
 * clause rather than claiming the answer is being written while ranking is still
 * running.
 */
export function answerProgressPreviewMessage(sourceCount: number, stage: PublicAnswerProgressStage) {
  if (sourceCount <= 0) return null;
  const sources = `${sourceCount} source${sourceCount === 1 ? "" : "s"} found`;
  if (stage === "generating" || stage === "retrying") return `${sources} · writing the answer…`;
  if (stage === "fallback") return `${sources} · assembling the answer from them…`;
  if (stage === "verifying") return `${sources} · checking the citations…`;
  return sources;
}

/** The stages worth disclosing after the fact.
 *
 * A routine answer has nothing to explain — scope, search, select, write, check,
 * in that order, every time — which is why the old Processing details disclosure
 * held the same five lines for every question and nobody opened it. These three
 * stages mean the answer did NOT take the ordinary route, and that is worth a
 * reader being able to read back. */
const disclosableStages = new Set<PublicAnswerProgressStage>(["retrying", "fallback", "cached"]);

export function answerProgressTookUnusualRoute(events: readonly AnswerProgressUpdate[]) {
  return events.some((event) => disclosableStages.has(event.stage));
}
