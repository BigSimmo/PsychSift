import type { AnswerState, OverdueSource, UngroundedReason } from "@/lib/answer-state-types";
import type { ClinicalSourceMetadata } from "@/lib/types";
import { createBoundedDiagnosticRecorder } from "@/components/ui/design-system-diagnostics";

/**
 * COMPONENTS §2. Degraded, partial and fallback answers are structurally
 * identical to confident ones unless the state is a value the type system sees.
 * `AnswerCard` takes one of these as a required prop, so "we forgot the caveat"
 * stops being representable.
 */

export type {
  AnswerState,
  DegradedAnswerState,
  NoAnswer,
  OverdueSource,
  OverdueStatus,
  SourceRef,
  UngroundedReason,
} from "@/lib/answer-state-types";

/**
 * The subset of a retrieval answer that the state projection reads. Structural
 * rather than a direct `RagAnswer` import so the design-system bundle does not
 * pull the retrieval layer in, while `tests/answer-state-contract.test.ts` pins
 * that a real `RagAnswer` still satisfies it.
 */
export type AnswerStateSource = {
  id?: string | null;
  document_id?: string | null;
  title?: string | null;
  page_number?: number | null;
  source_metadata?: Partial<Pick<ClinicalSourceMetadata, "document_status" | "review_date">> | null;
};

/**
 * The cited/supporting subset of a retrieval answer. `RagAnswer.sources` retains
 * every retrieval candidate; `citations` (and claim support IDs) name the chunks
 * that actually support the prose. Staleness must be derived from that supporting
 * set — an outdated uncited candidate must not label a current cited answer stale.
 */
export type AnswerStateCitation = {
  chunk_id?: string | null;
  document_id?: string | null;
};

export type AnswerStateInput = {
  sources?: readonly AnswerStateSource[] | null;
  /**
   * When present and non-empty, only sources that match a citation chunk or
   * document (or an explicit supporting chunk id) participate in the projection.
   * Absent/empty leaves the prior "all sources" behaviour for paths that have not
   * yet populated citations.
   */
  citations?: readonly AnswerStateCitation[] | null;
  /** Claim-level supporting chunk ids — same filter as citations when present. */
  supportingChunkIds?: readonly string[] | null;
  answerQualityTier?: "model_synthesis" | "source_only" | "cached" | null;
  fallbackReason?: string | null;
  routingReason?: string | null;
  /**
   * The pipeline's own grounding verdict. `false` means the prose is not
   * supported by the cited evidence — see the `ungrounded` kind.
   */
  grounded?: boolean | null;
  /**
   * The pipeline's confidence enum. Structurally typed rather than imported from
   * `RagAnswer` so the design-system bundle does not pull the retrieval layer in;
   * `tests/answer-state-contract.test.ts` pins that the real payload still fits.
   */
  confidence?: "high" | "medium" | "low" | "unsupported" | null;
  /**
   * Numeric/dose/threshold tokens asserted in the prose that post-generation
   * faithfulness verification could not find verbatim in any cited chunk. A
   * non-empty list is exactly the case where a clinician must read the passages
   * rather than the numbers.
   */
  unverifiedNumericTokens?: readonly string[] | null;
  /**
   * Caller-derived weak-evidence flag, for adoption sites that already compute
   * one from render trust (`ClinicalDashboard`). Optional: the projection never
   * derives it, because trust policy does not live in this layer.
   */
  weakEvidence?: boolean | null;
};

/**
 * `generation_failed` means the model call itself fell over and the pipeline
 * assembled the answer from sources locally; everything else that produces a
 * source-only answer (retrieval confidence gates, governance refusal, low
 * signal) is a `quality_gate`. The discriminator reads the routing marker the
 * retrieval layer already stamps onto the client payload — it does not
 * re-derive the decision.
 */
const generationFallbackMarker = /generation_fallback|generation_failed/i;

const recordStateDefect = createBoundedDiagnosticRecorder({
  emit: (message) => {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") return;
    console.warn(message);
  },
});

function noteOnce(key: string, message: string, detail: Record<string, string | number>) {
  recordStateDefect(key, JSON.stringify({ level: "warn", message, ...detail }));
}

/**
 * A retrieval source is a CHUNK; several chunks of one document is the normal
 * case. Every count and every banner row in this module is keyed on the
 * document, because "3 of 8 sources are past their review date" is read by a
 * clinician as three documents — and chunk-level counting is wrong in both
 * directions, including the direction that under-warns.
 */
function documentKeyFor(source: AnswerStateSource, index: number): string {
  const key = source.document_id?.trim() || source.id?.trim();
  if (key) return key;
  // Unidentifiable source: it still exists, so it still counts. The synthetic
  // key cannot drive `onOpenSource`, but overdue status must still raise
  // `stale_evidence` — dropping governance here would under-warn to `ready`.
  noteOnce("source-without-identifier", "answer-state: cited source has no document_id or id", {
    field: "document_id",
  });
  return `__unidentified_${index}__`;
}

function overdueSourceFrom(source: AnswerStateSource, key: string): OverdueSource | null {
  const status = source.source_metadata?.document_status;
  // Only the two governance-set overdue states. `unknown` is not overdue — it is
  // unknown, and the source badges say so in their own vocabulary.
  if (status !== "review_due" && status !== "outdated") return null;
  return {
    sourceId: key,
    title: source.title?.trim() || "Untitled source",
    locator: typeof source.page_number === "number" ? `p. ${source.page_number}` : undefined,
    reviewDueOn: source.source_metadata?.review_date?.trim() || null,
    status,
  };
}

/**
 * Narrow the retrieval candidate list to the chunks/documents that support the
 * delivered answer. `sources` alone over-warns: an outdated uncited candidate
 * would otherwise label a current cited answer `stale_evidence`.
 */
function supportingSources(input: AnswerStateInput): AnswerStateSource[] {
  const sources = input.sources ?? [];
  const citedChunkIds = new Set<string>();
  const citedDocumentIds = new Set<string>();

  for (const citation of input.citations ?? []) {
    const chunkId = citation.chunk_id?.trim();
    const documentId = citation.document_id?.trim();
    if (chunkId) citedChunkIds.add(chunkId);
    if (documentId) citedDocumentIds.add(documentId);
  }
  for (const chunkId of input.supportingChunkIds ?? []) {
    const trimmed = chunkId?.trim();
    if (trimmed) citedChunkIds.add(trimmed);
  }

  if (citedChunkIds.size === 0 && citedDocumentIds.size === 0) {
    return [...sources];
  }

  return sources.filter((source) => {
    const chunkId = source.id?.trim();
    const documentId = source.document_id?.trim();
    return Boolean((chunkId && citedChunkIds.has(chunkId)) || (documentId && citedDocumentIds.has(documentId)));
  });
}

/**
 * Read the pipeline's own grounding signals. Nothing is derived here: each
 * branch is a field the retrieval layer already set, in the order the live
 * product gates read them (`evidence-panels.tsx` checks grounding before its
 * weak-evidence flag).
 *
 * `grounded` is only ungrounding when it is explicitly `false`. Absent/null
 * means the caller has not populated the field — the pre-#207 adoption sites —
 * and inventing a caution from a missing field would fire on every answer.
 */
function ungroundedReasonFrom(input: AnswerStateInput): UngroundedReason | null {
  if (input.grounded === false) return "grounded_false";
  if (input.confidence === "unsupported") return "confidence_unsupported";
  if ((input.unverifiedNumericTokens?.length ?? 0) > 0) return "unverified_numeric";
  if (input.weakEvidence === true) return "weak_evidence";
  return null;
}

/**
 * Project the app-facing retrieval payload onto the state the answer surface
 * renders. This is a projection of fields the retrieval layer has already
 * decided — `document_status` is server-set governance, not a date comparison —
 * so the review policy stays where COMPONENTS §2 puts it.
 *
 * Precedence is by clinical consequence, highest first:
 *
 *   1. `stale_evidence`  — the cited evidence may no longer be correct.
 *   2. `partial_retrieval` — the evidence base is incomplete.
 *   3. `ungrounded`      — the evidence is current and complete, but the prose
 *                          is not supported by it.
 *   4. `source_only`     — evidence is current and complete; only the synthesis
 *                          is degraded.
 *   5. `ready`.
 *
 * A source-only answer over overdue sources therefore reports `stale_evidence`
 * here. The source-only disclosure is not lost: `AnswerCard` carries the
 * verification wording as its own required prop, so the call site states both.
 *
 * `ungrounded` outranks `source_only` for the same reason: a source-only answer
 * that is also unsupported must not read as "evidence complete, synthesis
 * weak". The clinician's act there is to verify the passages and distrust the
 * numbers, which is the ungrounded instruction, not the source-only one.
 *
 * `stale_evidence` stays the outer kind when an answer is both stale and
 * ungrounded: one banner, the one about evidence that may already be wrong.
 * Stacking two alarms on one answer degrades both.
 *
 * `partial_retrieval` is never produced today — no app-facing field names which
 * expected sources were unavailable. See `docs/design-system/COMPONENTS.md` §2.
 */
export function answerStateFromRetrieval(input: AnswerStateInput): AnswerState {
  const sources = supportingSources(input);
  const documents = new Set<string>();
  const overdueByDocument = new Map<string, OverdueSource>();

  sources.forEach((source, index) => {
    const key = documentKeyFor(source, index);
    documents.add(key);
    const entry = overdueSourceFrom(source, key);
    if (!entry) return;
    const existing = overdueByDocument.get(key);
    // Chunks of one document can disagree only through a data defect; take the
    // more severe reading so a superseded document is never softened to `review_due`.
    if (!existing || (existing.status === "review_due" && entry.status === "outdated")) {
      overdueByDocument.set(key, entry);
    }
  });

  const sourceCount = documents.size;
  const overdue = [...overdueByDocument.values()];

  if (overdue.length > 0) return { kind: "stale_evidence", overdue, sourceCount };

  const ungroundedReason = ungroundedReasonFrom(input);
  if (ungroundedReason) return { kind: "ungrounded", reason: ungroundedReason, sourceCount };

  if (input.answerQualityTier === "source_only") {
    const marker = `${input.fallbackReason ?? ""} ${input.routingReason ?? ""}`;
    return {
      kind: "source_only",
      reason: generationFallbackMarker.test(marker) ? "generation_failed" : "quality_gate",
    };
  }

  return { kind: "ready", sourceCount };
}
