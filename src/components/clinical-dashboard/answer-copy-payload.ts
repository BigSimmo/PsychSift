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

import { answerStateFromRetrieval, type AnswerState } from "@/components/ui/answer-state";
import {
  isPreformattedGroundedAnswer,
  primaryAnswerDisplayText,
} from "@/components/clinical-dashboard/answer-content";
import { composeAnswerClipboardText } from "@/lib/answer-clipboard";
import type { RagAnswer, SearchResult } from "@/lib/types";

export type AnswerCopyInput = {
  answer: RagAnswer;
  /**
   * Search-result fallback for paths that do not populate `answer.sources`.
   * An empty array is treated as unpopulated — `??` alone would keep `[]` and
   * drop overdue-source warnings that only the fallback still carries.
   */
  sources?: SearchResult[];
  /** Render trust, passed through rather than re-derived. */
  weakEvidence?: boolean;
};

/**
 * Prefer the answer's cited set when it has entries; otherwise use the caller's
 * fallback. `RagAnswer.sources` is typed as a required array, so "not populated"
 * arrives as `[]` rather than `undefined`, and nullish coalescing is the wrong
 * operator for that contract.
 */
export function resolveAnswerSources(
  answerSources: SearchResult[] | null | undefined,
  fallback?: SearchResult[] | null,
): SearchResult[] | undefined {
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
    fallbackReason: answer.fallbackReason,
    routingReason: answer.routingReason,
    grounded: answer.grounded,
    confidence: answer.confidence,
    unverifiedNumericTokens: answer.unverifiedNumericTokens,
    weakEvidence,
  });
}

/**
 * The answer portion of a clinical clipboard payload. It is deliberately the
 * same final-lead projection shown on screen, with bold markers removed for
 * plain-text records.
 */
export function answerTextForClipboard(answer: RagAnswer): string {
  return primaryAnswerDisplayText(answer.answer, {
    preformatted: isPreformattedGroundedAnswer(answer),
  });
}

function replaceRenderCopyAnswerText(answer: RagAnswer, renderCopyText: string): string {
  // `buildAnswerRenderModel` strips server bold markers before placing the
  // finalized answer in its policy-owned copy block. Replace that one answer
  // occurrence so warnings, source links, tables, and trust metadata remain
  // under the render policy's ownership.
  const renderedAnswerText = answer.answer.trim().replace(/\*\*/g, "");
  if (!renderedAnswerText) return renderCopyText;
  return renderCopyText.replace(renderedAnswerText, answerTextForClipboard(answer));
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
  sources: readonly SearchResult[] | null | undefined,
  citations: RagAnswer["citations"] | null | undefined,
): readonly SearchResult[] {
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
  sources: readonly SearchResult[] | null | undefined,
): SearchResult["source_metadata"] | undefined {
  if (!sources?.length) return undefined;
  const documentIds = new Set(
    sources.map((source) => source.document_id?.trim()).filter((id): id is string => Boolean(id)),
  );
  if (documentIds.size !== 1) return undefined;
  const withMetadata = sources.find((source) => source.source_metadata != null);
  return withMetadata?.source_metadata ?? undefined;
}

/**
 * The clipboard payload for an answer. `renderCopyText` stays the primary
 * product string and passes through byte-for-byte; the composer only adds what
 * leaves the app with it — attribution, the state caveat, and the provenance
 * audit line — because a copy is read in a record long after the banner is gone.
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
  return composeAnswerClipboardText({
    renderCopyText: replaceRenderCopyAnswerText(answer, renderCopyText),
    sourceOnly: answer.answerQualityTier === "source_only",
    state: answerStateForAnswer({ answer, sources, weakEvidence }),
    // Cited set, not every candidate: an uncited candidate from another document
    // would otherwise make a one-document answer look like two and suppress the
    // provenance audit line entirely.
    metadata: singleDocumentClipboardMetadata(citedSourcesOnly(resolvedSources, answer.citations)),
  });
}
