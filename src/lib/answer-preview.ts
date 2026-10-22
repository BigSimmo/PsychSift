// #100 Phase 1 — verified evidence preview (server-only).
// Builds the single retrieval-complete verified unit defined in
// docs/verified-answer-incremental-delivery-design.md. The unit must reuse the
// production gates, never approximate them: the same danger-level
// source-governance decision that governs the final response, and the exact
// route-boundary source trim the final payload goes through. If the gates
// cannot permit disclosure the preview is simply absent — there is no weaker
// "stream-safe" variant.

import { projectClientSearchResult, type ClientSearchResult } from "@/lib/answer-client-payload";
import { env } from "@/lib/env";
import { hasDangerSourceGovernanceWarning, sourceGovernanceWarnings } from "@/lib/source-governance";
import {
  isDeliverableVerifiedUnit,
  type VerifiedEvidencePreviewUnit,
  type VerifiedUnit,
} from "@/lib/answer-stream-contract";
import type { EvidenceRelevance, SearchResult } from "@/lib/types";

export type { VerifiedUnit };

const evidencePreviewMaxSources = 12;

/** Why a wait did or did not show its sources.
 *
 * The preview was discarded silently at five separate points and recorded nothing, so a
 * clinician reporting "the sources never appear" could not be answered without guessing:
 * a flag, a cache hit, an empty intersection, a governance refusal and a malformed unit all
 * looked identical from outside. `docs/verified-answer-incremental-delivery-design.md`
 * asked for "rejection-reason enums" in its acceptance section and they were never built.
 *
 * An enum, deliberately — never a message. It names a decision, never a document, a query,
 * an owner or any clinical text, so it can cross the route boundary and sit in a diagnostic
 * endpoint without carrying anything that needed governing in the first place.
 *
 * `contract_rejected` is not raised here. It belongs to the route boundary, where a unit
 * that fails the stream contract's structural validation is dropped — see
 * `toPublicAnswerProgressEvent`. */
export const evidencePreviewReasons = [
  "ok",
  "disabled",
  "no_candidates",
  "empty_intersection_relaxed",
  "answer_level_danger",
  "all_sources_danger",
  "undeliverable",
  "contract_rejected",
] as const;

export type EvidencePreviewReason = (typeof evidencePreviewReasons)[number];

export type EvidencePreviewOutcome = {
  unit: VerifiedEvidencePreviewUnit | null;
  reason: EvidencePreviewReason;
};

export type EvidencePreviewProgressFields = {
  verifiedUnit?: VerifiedEvidencePreviewUnit;
  previewReason: EvidencePreviewReason;
};

function withheld(reason: EvidencePreviewReason): EvidencePreviewOutcome {
  return { unit: null, reason };
}

/** The most recent decision this server process made, for the diagnostic surface in
 *  `/api/setup-status`. One enum and a timestamp: no query, no owner, no document, nothing
 *  that identifies whose answer it was. Deliberately in memory rather than persisted — this
 *  answers "is the rail working right now", not "what happened last Tuesday", and a
 *  diagnostic is not a reason to start storing anything about clinical questions. */
let lastEvidencePreviewReason: { reason: EvidencePreviewReason; at: string } | null = null;

function recordEvidencePreviewReason(reason: EvidencePreviewReason) {
  lastEvidencePreviewReason = { reason, at: new Date().toISOString() };
}

export function readLastEvidencePreviewReason() {
  return lastEvidencePreviewReason;
}

/** Exported for the route boundary, which is the only other place a preview is discarded. */
export function recordEvidencePreviewContractRejection() {
  recordEvidencePreviewReason("contract_rejected");
}

/** The rail's state, worded for whoever is asking.
 *
 * `/api/setup-status` replaces every check's `detail` with a generic phrase for unauthenticated
 * callers, and rightly so: those strings can carry raw Supabase error text and project posture.
 * But that blanking made this diagnostic useless to the one person it was built for. The
 * clinician reporting "the sources never appear" read `Ready.` no matter what had happened —
 * worse than no diagnostic, because it reads as a healthy answer to the question actually being
 * asked, and it is the reading that sends the next investigation down the wrong path.
 *
 * So this one check's detail survives the blanking, and the exemption is made safe by
 * construction rather than by trust: the string is assembled HERE, from a member of
 * `evidencePreviewReasons` and a coarse recency bucket, and from nothing else. No query,
 * document, owner, clinical text or provider error can reach it.
 *
 * **What the anonymous form deliberately withholds, after two independent reviews said so.**
 * `lastEvidencePreviewReason` is process-global with no user or interaction correlation, so an
 * exact ISO timestamp on a public endpoint is a pollable record of when this tool is being used
 * clinically, and — the day a second clinician exists — one person's outcome answering another
 * person's question. Neither is patient-identifiable and neither is query content, which is why
 * this stays public at all rather than going back behind the operator token and being useless
 * again. The timestamp is bucketed instead: recency is all the diagnostic question needs ("did
 * my answer just now show its sources?"), and the exact second is the part that builds a
 * timeline. Operators keep the precise form.
 *
 * **It also says "this server" on purpose.** Nothing correlates the reading to the reader's own
 * answer, and more than one instance may serve the same domain, so a reader can be told about an
 * answer that is not theirs. Stating the scope is the difference between a diagnostic that is
 * narrow and one that is quietly wrong.
 */
export function describeEvidencePreviewForAnyCaller(): string {
  return describeEvidencePreview({ precise: false });
}

/** The operator form: exact timestamp, same decision word. Behind the deep-probe token. */
export function describeEvidencePreviewForOperator(): string {
  return describeEvidencePreview({ precise: true });
}

/** Coarse enough to answer "was that mine, just now?" without recording when anyone works. */
function recencyBucket(at: string): string {
  const elapsedMs = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "recently";
  if (elapsedMs < 5 * 60_000) return "in the last few minutes";
  if (elapsedMs < 60 * 60_000) return "in the last hour";
  return "more than an hour ago";
}

function describeEvidencePreview({ precise }: { precise: boolean }): string {
  if (!env.RAG_INCREMENTAL_EVIDENCE_PREVIEW) {
    return "Switched off, so the answer wait will never show source cards.";
  }
  const last = lastEvidencePreviewReason;
  if (!last) return "On. This server has not served an answer yet, so there is nothing to report.";
  const when = precise ? `at ${last.at}` : recencyBucket(last.at);
  // Re-checked rather than trusted. The exemption above rests on this value being one of a fixed
  // set of words, so anything outside that set is reported as unrecognised instead of echoed.
  if (!(evidencePreviewReasons as readonly string[]).includes(last.reason)) {
    return `On. The last answer this server handled recorded an unrecognised outcome, ${when}.`;
  }
  return deliveredEvidencePreviewReason(last.reason)
    ? `On. The last answer this server handled showed its sources (${last.reason}), ${when}.`
    : `On. The last answer this server handled withheld its sources: ${last.reason}, ${when}.`;
}

/** Two reasons mean the rail was drawn, not withheld: the ordinary path, and the fallback that
 *  rescues an emptied retry intersection. Reading anything but `ok` as a withholding would
 *  report a failure at exactly the moment the fallback worked. */
export function deliveredEvidencePreviewReason(reason: EvidencePreviewReason): boolean {
  return reason === "ok" || reason === "empty_intersection_relaxed";
}

/** Is this one source danger-level on its own account?
 *
 * Asked one source at a time, and deliberately so. `sourceGovernanceWarnings` ends with
 * `.slice(0, limit ?? 8)` — a cap for a warnings BANNER, where eight lines is already more
 * than a reader will take in. Passing the whole candidate set and reading the danger entries
 * back out of that list would make the cap a gate: with nine or more danger warnings (five
 * documents that are both outdated and poorly extracted is enough, at two warnings each) the
 * ones past the eighth are dropped, their documents never reach the exclusion set, and they
 * are disclosed as preview cards. Worse, `sourceStatusShortLabel` keys only on
 * `document_status`, so a document escaping the cap on `extraction_quality` alone would be
 * badged "Current" on its card.
 *
 * One source per call cannot hit the cap — a single result yields at most a handful of
 * warnings — and it still runs the canonical helper rather than reimplementing its rules.
 */
function isDangerLevelSource(source: SearchResult) {
  return hasDangerSourceGovernanceWarning(sourceGovernanceWarnings({ results: [source] }));
}

/** The answer-level verdict, asked with no sources at all so only the relevance-derived
 *  warning can be raised. `WEAK_EVIDENCE` says the retrieved evidence does not back the
 *  question — not a property of any one document, so no subset of the rail is safe to show. */
function hasAnswerLevelDanger(relevance: EvidenceRelevance | null) {
  return hasDangerSourceGovernanceWarning(sourceGovernanceWarnings({ results: [], relevance }));
}

/**
 * Build the retrieval-complete evidence preview, or null when nothing may be disclosed.
 *
 * **The governance decision is per document, not per answer.** An earlier cut ran the
 * canonical danger check over the whole retrieval set and returned null on any hit, which
 * made one outdated or badly-OCR'd chunk anywhere in twelve-to-twenty-four retrieved
 * passages blank the entire rail — the feature read as broken rather than conservative, and
 * the sources it hid were the clean ones. Excluding the flagged documents instead is
 * strictly safer per card: a danger-level source can no longer appear as a preview card at
 * all, where the wide check merely delayed its appearance until the answer's own rail.
 *
 * What stays all-or-nothing is the answer-level verdict. `relevance.verdict === "none"`
 * says the retrieved evidence is unbacked, which is not a property of any one document, so
 * there is no subset that is safe to show.
 *
 * Still deliberately stricter than the final response's refusal in one respect: the final
 * gate only refuses grounded, supported answers, because unsupported/evidence-gap responses
 * withhold content anyway. At preview time the answer's support level is not yet known, so
 * the danger decision is applied unconditionally.
 */
export function evaluateEvidencePreview(args: {
  results: SearchResult[];
  relevance?: EvidenceRelevance | null;
}): EvidencePreviewOutcome {
  if (!args.results.length) return withheld("no_candidates");
  if (hasAnswerLevelDanger(args.relevance ?? null)) return withheld("answer_level_danger");

  // Governance is a property of the document, so every chunk of a flagged document goes with
  // it. A clean-looking second chunk of a badly extracted PDF is the same PDF.
  const dangerDocumentIds = new Set(args.results.filter(isDangerLevelSource).map((result) => result.document_id));
  const survivors = args.results.filter((result) => !dangerDocumentIds.has(result.document_id));
  if (!survivors.length) return withheld("all_sources_danger");
  const unit = buildUnit(survivors);
  return unit ? { unit, reason: "ok" } : withheld("undeliverable");
}

/** The unit alone, for callers that do not need to explain an absence. */
export function buildEvidencePreviewUnit(args: {
  results: SearchResult[];
  relevance?: EvidenceRelevance | null;
}): VerifiedEvidencePreviewUnit | null {
  return evaluateEvidencePreview(args).unit;
}

/**
 * Build the unit so that it is guaranteed to pass the stream contract it is about to meet.
 *
 * **The builder used to size the unit by source count alone, while the contract bounds it by
 * JSON size — and nothing checked one against the other.** `isDeliverableVerifiedUnit` caps a
 * unit at 64,000 characters, sized on the assumption that "≤900 chars/source, ≤12 sources"
 * leaves headroom. A real trimmed source is ~7,000 characters, not 900: the snippet is carried
 * twice (`content` and `retrieval_synopsis`), and the score explanation, six generated labels,
 * the indexing-quality record and the relevance chips all ride along by policy. Twelve of them
 * is ~83,000 characters. Fast routine answers select four passages and stayed well under the
 * cap, which is why the browser proof kept passing; every other route selects all of its
 * candidates, so on precisely the long strong-route waits the rail exists for, the unit was
 * built, sent to the boundary, and thrown away there as `contract_rejected`. The wait then
 * showed no sources at all.
 *
 * The contract stays where it is — the boundary is the last line, not the only one — and the
 * builder now shrinks to fit it: the same validator, applied here, on the exact unit that will
 * be sent. Sources are dropped from the tail so what remains is the top of retrieval in
 * retrieval order, which is what the rail draws. A source the contract would reject on its own
 * (a malformed field, say) is excluded individually rather than taking the rail down with it.
 * `selectedContextCount` keeps naming what governance let through, so the count never claims
 * the shipped subset was the whole selection.
 *
 * Returns null only when not even one source can be delivered.
 */
function buildUnit(results: SearchResult[]): VerifiedEvidencePreviewUnit | null {
  const unitOf = (sources: ClientSearchResult[]): VerifiedEvidencePreviewUnit => ({
    schemaVersion: 1,
    kind: "evidence_preview",
    sequence: 0,
    sources,
    // Counts what survived governance, never the wider retrieval set: the stream contract
    // requires selectedContextCount >= sources.length, and a count drawn from passages that
    // were excluded would describe evidence the preview is deliberately not showing.
    selectedContextCount: results.length,
  });
  const deliverable = results
    .slice(0, evidencePreviewMaxSources)
    .map(projectClientSearchResult)
    .filter((source): source is ClientSearchResult => source !== null)
    .filter((source) => isDeliverableVerifiedUnit(unitOf([source])));
  for (let count = deliverable.length; count > 0; count -= 1) {
    const unit = unitOf(deliverable.slice(0, count));
    if (isDeliverableVerifiedUnit(unit)) return unit;
  }
  return null;
}

/** Keep the ranking event small and keep final-path reconciliation out of the RAG monolith.
 *
 * **The intersection is a preference, not a requirement.** Showing only sources present in
 * both the normal and the strong-retry context keeps the rail stable across a generation
 * retry, which is worth having. But the two sets apply the per-document crowding cap to
 * different input lists (`selectModelContextResults` slices the fast route to four results
 * BEFORE the Australian-preference sort, the strong route sorts the whole set), so on a
 * document-scoped fast query the intersection can come back empty while retrieval, ranking
 * and generation are all perfectly healthy. An empty intersection then withheld the entire
 * rail and said nothing about why.
 *
 * Falling back to the normal context set is safe because that is exactly the evidence
 * generation is about to read. It is never wider than the answer's own inputs.
 */
export function buildEvidencePreviewProgress(args: {
  normalResults: SearchResult[];
  fallbackResults: SearchResult[];
  relevance?: EvidenceRelevance | null;
  /** Called once when a verified preview unit is built, so the caller can time first content
   * (docs/verified-answer-incremental-delivery-design.md, "Telemetry and acceptance"). */
  onVerifiedUnit?: () => void;
}): EvidencePreviewProgressFields {
  const fields = evidencePreviewProgressFields(args);
  if (fields.verifiedUnit) args.onVerifiedUnit?.();
  return fields;
}

function evidencePreviewProgressFields(args: {
  normalResults: SearchResult[];
  fallbackResults: SearchResult[];
  relevance?: EvidenceRelevance | null;
}): EvidencePreviewProgressFields {
  if (!env.RAG_INCREMENTAL_EVIDENCE_PREVIEW) return { previewReason: "disabled" };
  const fallbackIds = new Set(args.fallbackResults.map((result) => result.id));
  const retained = args.normalResults.filter((result) => fallbackIds.has(result.id));
  const stable = evaluateEvidencePreview({ results: retained, relevance: args.relevance });
  if (stable.unit) return previewFields(stable);

  // Only "the intersection emptied it" is worth a second attempt. A governance refusal or an
  // answer-level danger verdict is the same verdict over the wider set, so retrying it would
  // just re-derive the same refusal with more sources in scope.
  if (stable.reason !== "no_candidates" || !args.normalResults.length) return previewFields(stable);
  const relaxed = evaluateEvidencePreview({ results: args.normalResults, relevance: args.relevance });
  return previewFields(relaxed, relaxed.unit ? "empty_intersection_relaxed" : relaxed.reason);
}

/** The cached-answer path, which reached the browser with no rail at all until now.
 *
 * `docs/verified-answer-incremental-delivery-design.md` sanctions this explicitly — "cache
 * hits may emit the same units from the already governed cached answer" — and it was simply
 * never built, so every repeated question showed a wait with no sources while a first-time
 * question showed them. Repeats are the common case for a clinical reference tool: the same
 * question comes up on the next patient.
 *
 * The sources come from the stored answer, so they have already passed the full governed
 * final-response path once. They still go through the same `evaluateEvidencePreview` gate
 * here rather than a shortcut, because governance can have changed since they were cached.
 */
export function buildCachedEvidencePreviewProgress(args: {
  results: SearchResult[];
  relevance?: EvidenceRelevance | null;
}): EvidencePreviewProgressFields {
  if (!env.RAG_INCREMENTAL_EVIDENCE_PREVIEW) return { previewReason: "disabled" };
  return previewFields(evaluateEvidencePreview(args));
}

function previewFields(
  outcome: EvidencePreviewOutcome,
  reason: EvidencePreviewReason = outcome.reason,
): EvidencePreviewProgressFields {
  recordEvidencePreviewReason(reason);
  return outcome.unit ? { verifiedUnit: outcome.unit, previewReason: reason } : { previewReason: reason };
}
