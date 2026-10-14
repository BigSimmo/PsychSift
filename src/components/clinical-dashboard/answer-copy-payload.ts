import { demoAnswerDisclosure } from "@/lib/answer-client-payload";
// Building the clipboard payload for an answer, in one place.
//
// Three surfaces copy an answer — the live one in `ClinicalDashboard`, a prior
// thread turn, and the inline answer surface — and each was assembling the same
// `answerStateFromRetrieval()` input by hand from the same nine payload fields.
// Three hand-assembled copies of a projection input is how the copy paths drift
// apart, and #208 exists precisely because one of them once claimed
// "AI-generated" over passages no model wrote.
//
// It lives in the clinical-dashboard layer rather than `src/lib` because it
// reaches into `@/components/ui/answer-state`, and `tests/lib-layering.test.ts`
// forbids `src/lib` importing components. It stays out of the design system for
// the mirror-image reason recorded on `AnswerStateInput`: the DS projection
// takes a structural shape so the design-system bundle never pulls the
// retrieval layer in, and `RagAnswer` is the retrieval layer.

import {
  answerStateFromRetrieval,
  answerUsesDegradedMode,
  answerUsesSourceOnlyProvenance,
  type AnswerState,
} from "@/components/ui/answer-state";
import { isPreformattedGroundedAnswer, primaryAnswerDisplayText } from "@/components/clinical-dashboard/answer-content";
import { projectAnswerForMainSurface } from "@/components/clinical-dashboard/answer-section-projector";
import { composeAnswerClipboardText } from "@/lib/answer-clipboard";
import { publicFallbackReason } from "@/lib/rag/rag-fallback-reason";
import type { AnswerPayload } from "@/components/clinical-dashboard/search-utils";
import type { ClientRagAnswerPayload, ClientSearchResult } from "@/lib/answer-client-payload";
import { ragAdaptiveAnswerPromptVersion } from "@/lib/rag/rag-versioning";

export type AnswerCopyInput = {
  answer: AnswerPayload;
  /**
   * Search-result fallback for paths that do not populate `answer.sources`.
   * An empty array is treated as unpopulated — `??` alone would keep `[]` and
   * drop overdue-source warnings that only the fallback still carries.
   */
  sources?: ClientSearchResult[];
  /** Render trust, passed through rather than re-derived. */
  weakEvidence?: boolean;
};

/**
 * Derives clipboard text from the same finalized answer projection as the
 * primary screen surface. This deliberately avoids copying rendered DOM.
 */
export function answerTextForClipboard(answer: ClientRagAnswerPayload): string {
  const preformatted = isPreformattedGroundedAnswer(answer);
  const lead = primaryAnswerDisplayText(answer.answer, { preformatted });
  if (answer.answerContractVersion !== ragAdaptiveAnswerPromptVersion) return lead;

  const projection = projectAnswerForMainSurface({ answer, sources: answer.sources, preformatted });
  return [projection.leadText, ...projection.sections.flatMap((section) => [section.heading, section.body])]
    .filter(Boolean)
    .join("\n\n")
    .replace(/\*\*/g, "");
}

function renderCopyTextWithCanonicalAnswer(renderCopyText: string, answer: ClientRagAnswerPayload): string {
  const rawAnswerText = answer.answer.trim().replace(/\*\*/g, "");
  const canonicalAnswerText = answerTextForClipboard(answer);
  const answerMarker = "Answer\n";
  const answerStart = renderCopyText.indexOf(answerMarker);
  const rawAnswerStart = answerStart === -1 ? -1 : answerStart + answerMarker.length;
  const hasDelimitedCanonicalBlock = (() => {
    if (answer.answerContractVersion !== ragAdaptiveAnswerPromptVersion || !canonicalAnswerText) return false;
    let index = renderCopyText.indexOf(canonicalAnswerText);
    while (index >= 0) {
      const end = index + canonicalAnswerText.length;
      const startsAtBlockBoundary = index === 0 || renderCopyText.slice(index - 2, index) === "\n\n";
      const endsAtBlockBoundary = end === renderCopyText.length || renderCopyText.slice(end, end + 2) === "\n\n";
      if (startsAtBlockBoundary && endsAtBlockBoundary) return true;
      index = renderCopyText.indexOf(canonicalAnswerText, index + 1);
    }
    return false;
  })();

  if (
    !canonicalAnswerText ||
    hasDelimitedCanonicalBlock ||
    (rawAnswerStart >= 0 && renderCopyText.startsWith(canonicalAnswerText, rawAnswerStart))
  ) {
    return renderCopyText;
  }
  if (rawAnswerText) {
    const exactAnswerIndex =
      rawAnswerStart >= 0 && renderCopyText.indexOf(rawAnswerText, rawAnswerStart) === rawAnswerStart
        ? rawAnswerStart
        : renderCopyText.indexOf(rawAnswerText);
    if (exactAnswerIndex >= 0) {
      return `${renderCopyText.slice(0, exactAnswerIndex)}${canonicalAnswerText}${renderCopyText.slice(
        exactAnswerIndex + rawAnswerText.length,
      )}`;
    }
  }

  return answer.answerContractVersion === ragAdaptiveAnswerPromptVersion
    ? [canonicalAnswerText, renderCopyText].filter(Boolean).join("\n\n")
    : renderCopyText;
}

/**
 * Prefer the answer's cited set when it has entries; otherwise use the caller's
 * fallback. `RagAnswer.sources` is typed as a required array, so "not populated"
 * arrives as `[]` rather than `undefined`, and nullish coalescing is the wrong
 * operator for that contract.
 */
export function resolveAnswerSources(
  answerSources: ClientSearchResult[] | null | undefined,
  fallback?: ClientSearchResult[] | null,
): ClientSearchResult[] | undefined {
  if (answerSources != null && answerSources.length > 0) return answerSources;
  if (fallback != null && fallback.length > 0) return fallback;
  return answerSources ?? fallback ?? undefined;
}

/** The projection every answer surface reads, from the payload they all hold. */
export function answerStateForAnswer({ answer, sources, weakEvidence }: AnswerCopyInput): AnswerState {
  return answerStateFromRetrieval({
    sources: resolveAnswerSources(answer.sources, sources),
    citations: answer.citations,
    answerQualityTier: answer.answerQualityTier,
    routingMode: answer.routingMode,
    fallbackReasonCode: answer.fallbackReasonCode,
    degradedMode: answer.degradedMode,
    grounded: answer.grounded,
    confidence: answer.confidence,
    unverifiedNumericTokens: answer.unverifiedNumericTokens,
    weakEvidence,
  });
}

/**
 * The supporting set, not every retrieval candidate. `RagAnswer.sources` retains
 * every candidate the retrieval returned while `citations` name the chunks that
 * actually support the prose (`ui/answer-state.ts`), so a one-document answer
 * whose retrieval also surfaced an unrelated candidate must not be read as a
 * two-document answer. Falls back to the full set when nothing identifies the
 * citations, because an unfiltered set is better than an empty one.
 */
export function citedSourcesOnly(
  sources: readonly ClientSearchResult[] | null | undefined,
  citations: ClientRagAnswerPayload["citations"] | null | undefined,
): readonly ClientSearchResult[] {
  if (!sources?.length) return sources ?? [];
  const citedChunkIds = new Set<string>();
  const citedDocumentIds = new Set<string>();
  for (const citation of citations ?? []) {
    const chunkId = citation.chunk_id?.trim();
    const documentId = citation.document_id?.trim();
    if (chunkId) citedChunkIds.add(chunkId);
    if (documentId) citedDocumentIds.add(documentId);
  }
  if (citedChunkIds.size === 0 && citedDocumentIds.size === 0) return sources;
  const cited = sources.filter(
    (source) =>
      (source.id != null && citedChunkIds.has(source.id)) ||
      (source.document_id != null && citedDocumentIds.has(source.document_id)),
  );
  return cited.length > 0 ? cited : sources;
}

/**
 * Provenance metadata for the clipboard audit line — only when the cited set
 * collapses to one document. Multi-document pastes suppress the line in the
 * composer (it would contradict a multi-source stale caveat).
 */
export function singleDocumentClipboardMetadata(
  sources: readonly ClientSearchResult[] | null | undefined,
): ClientSearchResult["source_metadata"] | undefined {
  if (!sources?.length) return undefined;
  const documentIds = new Set(
    sources.map((source) => source.document_id?.trim()).filter((id): id is string => Boolean(id)),
  );
  if (documentIds.size !== 1) return undefined;
  const withMetadata = sources.find((source) => source.source_metadata != null);
  return withMetadata?.source_metadata ?? undefined;
}

/**
 * The clipboard payload for an answer. `renderCopyText` remains the primary
 * product string, except its finalized answer lead is replaced with the same
 * sanitized projection shown on screen. The composer then adds what leaves the
 * app with it — attribution, the state caveat, and the provenance audit line —
 * because a copy is read in a record long after the banner is gone.
 *
 * `sourceOnly` is read from the quality tier rather than from the state kind:
 * #207 precedence puts `ungrounded` above `source_only`, so an extractive answer
 * that is also weakly supported reports `ungrounded`, and keying attribution on
 * the kind would paste "AI-generated" over passages no model wrote.
 */
export function buildAnswerClipboardText({
  answer,
  sources,
  weakEvidence,
  renderCopyText,
}: AnswerCopyInput & { renderCopyText: string }): string {
  const resolvedSources = resolveAnswerSources(answer.sources, sources);
  const state = answerStateForAnswer({ answer, sources, weakEvidence });
  const degraded = answerUsesDegradedMode({
    answerQualityTier: answer.answerQualityTier,
    fallbackReasonCode: answer.fallbackReasonCode,
    degradedMode: answer.degradedMode,
  });
  const sourceOnly = answerUsesSourceOnlyProvenance({
    answerQualityTier: answer.answerQualityTier,
    routingMode: answer.routingMode,
  });
  const copied = composeAnswerClipboardText({
    renderCopyText: renderCopyTextWithCanonicalAnswer(renderCopyText, answer),
    sourceOnly,
    state,
    degradedReason: degraded
      ? answer.fallbackReasonCode
        ? publicFallbackReason(answer.fallbackReasonCode)
        : (answer.degradedMode?.reason ?? null)
      : null,
    // Cited set, not every candidate: an uncited candidate from another document
    // would otherwise make a one-document answer look like two and suppress the
    // provenance audit line entirely.
    metadata: singleDocumentClipboardMetadata(citedSourcesOnly(resolvedSources, answer.citations)),
  });
  return answer.demoMode === true || answer.fallbackMode === "non_production_demo"
    ? `${demoAnswerDisclosure}\n\n${copied}`
    : copied;
}

/**
 * Fallback reasons that mean retrieval found nothing that answers the question.
 * The rows still on screen were searched, not relied on.
 */
const REFUSAL_FALLBACK_REASON_CODES: ReadonlySet<string> = new Set(["coverage_gap", "no_candidates", "low_signal"]);

/**
 * Whether the answer says the user's sources do not cover the question at all — the
 * "Not in your sources" state (audit D03, 2026-10-13). Narrower than `answerIsRefusal` on
 * purpose: a weak or partly unsupported answer still has prose a clinician reads and checks,
 * so it keeps the full answer chrome.
 *
 * Deliberately narrow, because `confidence: "unsupported"` alone is not this state. The
 * pipeline also uses it for answers that DID find sources and then failed closed: clinical
 * numbers that could not be matched to the cited text ("Review the source passages
 * directly…"), conflicting numeric bands, a search timeout, a generation failure that
 * shows source snippets instead. Calling any of those "not in your sources" would be untrue
 * and would hide the passages and the dose caution the reader is told to check.
 *
 * So the state needs BOTH the unsupported confidence AND the pipeline's own reason that
 * nothing relevant was found: `no_candidates` ("No directly relevant source passage was
 * found") or `unsupported` ("The active sources do not support this request"), which is
 * what the final quality-gap answer ("No current source with … was found") carries. The
 * synthetic demo carries no reason code, so its own not-covered answer counts too.
 * `coverage_gap` ("support only part of this question") and `low_signal` can still carry a
 * partial answer and keep the full chrome.
 */
export function answerIsNotInSources(
  answer: Pick<ClientRagAnswerPayload, "confidence" | "fallbackReasonCode">,
  { demo = false }: { demo?: boolean } = {},
): boolean {
  if (answer.confidence !== "unsupported") return false;
  if (answer.fallbackReasonCode === "no_candidates" || answer.fallbackReasonCode === "unsupported") return true;
  return demo && answer.fallbackReasonCode == null;
}

/**
 * Whether an answer is a refusal, for the source rail's "Documents searched" framing
 * (#Z9NS6H). Deliberately the UNION of every candidate signal — `grounded === false`,
 * an `ungrounded` or `no_answer` answer state, or a coverage_gap/no_candidates/low_signal
 * fallback reason — because each covers different answers, and the patient-safe error
 * is to under-claim support: calling a real answer's sources "searched" costs a word,
 * while calling a refusal's sources "cited" tells a clinician the documents back an
 * answer that was never given. Owner approval 2026-09-28.
 */
export function answerIsRefusal({
  answer,
  answerState,
}: {
  answer: Pick<ClientRagAnswerPayload, "grounded" | "fallbackReasonCode">;
  /** `no_answer` is not an `AnswerState` (no card renders it), but a caller holding one is holding a refusal. */
  answerState?: { kind: AnswerState["kind"] | "no_answer" } | null;
}): boolean {
  if (answer.grounded === false) return true;
  if (answerState?.kind === "ungrounded" || answerState?.kind === "no_answer") return true;
  return answer.fallbackReasonCode != null && REFUSAL_FALLBACK_REASON_CODES.has(answer.fallbackReasonCode);
}
