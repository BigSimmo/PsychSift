import { sourceCurrencyWarningForAnswer } from "@/lib/answer-client-payload";
import type { RagAnswer } from "@/lib/types";
import { citationIdentity, documentCitationHref, formatCitationLabel } from "@/lib/citations";
import { normalizeAccessibleTable } from "@/lib/accessible-table-normalization";
import type {
  ClientBestSourceRecommendation,
  ClientCitation,
  ClientQuoteCard,
  ClientRagAnswerPayload,
  ClientSearchResult,
  ClientRelatedDocument,
} from "@/lib/answer-client-payload";
import type { EvidenceRelevance, SourceStrength, VisualEvidenceCard } from "@/lib/types";
import { formatDisplayedVisualEvidenceForClipboard } from "@/lib/ward-output";

export type AnswerRenderTrust = "unsupported" | "low" | "medium" | "high";

export type AnswerRenderBlock =
  | "sourceStatus"
  | "reviewSources"
  | "evidenceMap"
  | "quoteCards"
  | "visualEvidence"
  | "relatedDocuments"
  | "warnings"
  | "diagnostics";

export type SourceLink = {
  id: string;
  chunk_id: string;
  document_id: string;
  title: string;
  file_name: string;
  page_number: number | null;
  href: string;
  label: string;
  sourceStrength: SourceStrength | "none";
  reason: string;
  sourceMetadata?: ClientCitation["source_metadata"] | null;
  snippet?: string;
  score?: number;
  provenance?: ClientCitation["provenance"];
};

export type EvidenceRow = {
  id: string;
  source: SourceLink;
  channels: AnswerRenderBlock[];
  section?: string;
  supportLevel?: string;
  quote?: string;
  triggerFields: string[];
};

export type CanonicalAnswerTableRecord = {
  id: string;
  title?: string;
  headers: Array<string | null>;
  rows: Array<Array<string | null>>;
  lowConfidence: boolean;
  caveat?: string;
  source?: {
    label: string;
    href: string;
    chunkId?: string;
  };
};

export type AnswerRenderDecision = {
  shown: boolean;
  reason: string;
  triggerField?: string;
};

export type AnswerRenderModel = {
  answerText: string;
  trust: AnswerRenderTrust;
  /**
   * Trust level for the displayed support WORD only ("Strong support", "Supported", ...).
   * Equal to `trust`, except a high-trust answer whose payload carries the label-only
   * `strongSupportLabelCapped` flag reads as "medium" (#WGMB4Z, owner decision 17). Never
   * use it for render caps, tone or which blocks show; those follow `trust`.
   */
  supportLabelTrust: AnswerRenderTrust;
  allowedBlocks: AnswerRenderBlock[];
  primarySources: SourceLink[];
  reviewSources: ClientSearchResult[];
  evidenceRows: EvidenceRow[];
  quoteCards: ClientQuoteCard[];
  visualEvidence: VisualEvidenceCard[];
  relatedDocuments: ClientRelatedDocument[];
  bestSource: ClientBestSourceRecommendation | null;
  warnings: string[];
  tables: CanonicalAnswerTableRecord[];
  copyText: string;
  debugReasons?: Record<AnswerRenderBlock, AnswerRenderDecision>;
};

type SourceCandidate = {
  citation: ClientCitation;
  reason: string;
  triggerField: string;
  href?: string;
  sourceMetadata?: ClientCitation["source_metadata"] | null;
  snippet?: string;
  score?: number;
  sourceStrength?: SourceStrength | "none";
};

type BuildAnswerRenderModelOptions = {
  sources?: ClientSearchResult[];
  includeDebugReasons?: boolean;
};

const blockOrder: AnswerRenderBlock[] = [
  "sourceStatus",
  "reviewSources",
  "evidenceMap",
  "quoteCards",
  "visualEvidence",
  "relatedDocuments",
  "warnings",
  "diagnostics",
];

const trustCaps: Record<
  AnswerRenderTrust,
  { sources: number; rows: number; quotes: number; visual: number; related: number }
> = {
  unsupported: { sources: 3, rows: 0, quotes: 0, visual: 0, related: 0 },
  low: { sources: 4, rows: 4, quotes: 0, visual: 1, related: 0 },
  medium: { sources: 5, rows: 6, quotes: 0, visual: 1, related: 0 },
  high: { sources: 6, rows: 8, quotes: 3, visual: 3, related: 4 },
};

function trustRank(trust: AnswerRenderTrust) {
  if (trust === "high") return 3;
  if (trust === "medium") return 2;
  if (trust === "low") return 1;
  return 0;
}

function answerRelevance(answer: ClientRagAnswerPayload): EvidenceRelevance | undefined {
  return answer.relevance;
}

export function isAnswerSourceBacked(answer: ClientRagAnswerPayload): boolean {
  return answerRelevance(answer)?.isSourceBacked === true;
}

/** The one trust derivation: the render policy and the support-label recalculation script share it. */
export function deriveTrust(answer: ClientRagAnswerPayload): AnswerRenderTrust {
  const retrievalBlocked = answer.retrievalGateBlocked === true;
  const sourceBacked = isAnswerSourceBacked(answer);
  const hasFaithfulnessWarning = Boolean(answer.faithfulnessWarning || answer.unverifiedNumericTokens?.length);
  const evidenceGap = answer.responseMode === "evidence_gap";

  if (
    evidenceGap ||
    answer.routingMode === "unsupported" ||
    answer.confidence === "unsupported" ||
    answer.grounded !== true
  ) {
    return "unsupported";
  }

  if (retrievalBlocked || !sourceBacked || hasFaithfulnessWarning || answer.confidence === "low") return "low";
  if (answer.authorityTrustCapRequired === true) return "medium";
  if (answer.confidence === "high") return "high";
  return "medium";
}

// Label-only (#WGMB4Z decision 17). A payload stored before the flag existed has no field
// and keeps the old label; saved-answer labels are tracked as a separate issue.
function deriveSupportLabelTrust(answer: ClientRagAnswerPayload, trust: AnswerRenderTrust): AnswerRenderTrust {
  return trust === "high" && answer.strongSupportLabelCapped === true ? "medium" : trust;
}

function sourceStrengthFor(candidate: SourceCandidate) {
  if (candidate.sourceStrength) return candidate.sourceStrength;
  return "none";
}

function sourceLinkFromCandidate(candidate: SourceCandidate): SourceLink {
  const citation = candidate.citation;
  return {
    id: citationIdentity(citation),
    chunk_id: citation.chunk_id,
    document_id: citation.document_id,
    title: citation.title || citation.file_name || "Source",
    file_name: citation.file_name,
    page_number: citation.page_number,
    href: candidate.href ?? documentCitationHref(citation),
    label: formatCitationLabel(citation),
    sourceStrength: sourceStrengthFor(candidate),
    reason: candidate.reason,
    sourceMetadata: candidate.sourceMetadata ?? citation.source_metadata ?? null,
    snippet: candidate.snippet,
    score: candidate.score,
    provenance: citation.provenance,
  };
}

function candidateFromBestSource(source: ClientBestSourceRecommendation, triggerField: string): SourceCandidate {
  return {
    citation: source,
    reason: "Pinned by backend as the best source.",
    triggerField,
    snippet: source.quote || source.snippet,
    score: source.score,
    sourceStrength: source.source_strength,
    sourceMetadata: source.source_metadata,
  };
}

function citationFromClientResult(
  source: ClientSearchResult,
  provenance: NonNullable<ClientCitation["provenance"]> = "retrieval_only",
): ClientCitation {
  return {
    chunk_id: source.id,
    document_id: source.document_id,
    title: source.title,
    file_name: source.file_name,
    page_number: source.page_number,
    chunk_index: source.chunk_index,
    similarity: source.similarity,
    source_metadata: source.source_metadata,
    provenance,
  };
}

function candidateFromSearchResult(source: ClientSearchResult, triggerField: string): SourceCandidate {
  return {
    citation: citationFromClientResult(source),
    reason: "Retrieved source passage.",
    triggerField,
    snippet: source.retrieval_synopsis ?? source.content,
    score: source.hybrid_score ?? source.similarity,
    sourceStrength: source.source_strength,
    sourceMetadata: source.source_metadata,
  };
}

function candidateFromCitation(citation: ClientCitation, triggerField: string): SourceCandidate {
  const reason =
    citation.provenance === "review_only"
      ? "Added for source review; not accepted as claim support."
      : citation.provenance === "retrieval_only"
        ? "Retrieved source passage; not selected as claim support."
        : citation.provenance === "exact_quote"
          ? "Verified exact quote support."
          : citation.provenance === "deterministic_support"
            ? "Deterministically matched claim support."
            : citation.provenance === "section_selected"
              ? "Selected for an answer section."
              : "Cited by the generated answer.";
  return {
    citation,
    reason,
    triggerField,
    score: citation.similarity,
    sourceMetadata: citation.source_metadata,
  };
}

/**
 * Ledger #ZK460W. `review_only` is the strongest statement a citation makes about itself — the
 * answer it belongs to failed its own quality gate, so this passage is provenance to read, never
 * accepted claim support. Any earlier candidate for the same identity (bestSource, quote card,
 * retrieved source row) must not re-promote it with a strong sourceStrength / plan reason.
 * Clear strength to `none` so sourceSupportLabel / copy payload stay conservative.
 *
 * `smartApiPlan.coreSourceLinks` are server-only and stripped by `toClientAnswerPayload`, so they
 * no longer reach this renderer; the override still covers bestSource / quotes / retrieved rows.
 */
function applyReviewOnlyProvenance(candidate: SourceCandidate, reviewOnlyIdentities: Set<string>): SourceCandidate {
  const alreadyReviewOnly = candidate.citation.provenance === "review_only";
  const matchesReviewOnly = reviewOnlyIdentities.has(citationIdentity(candidate.citation));
  if (!alreadyReviewOnly && !matchesReviewOnly) return candidate;
  const citation = alreadyReviewOnly
    ? candidate.citation
    : { ...candidate.citation, provenance: "review_only" as const };
  return {
    ...candidate,
    citation,
    reason: candidateFromCitation(citation, candidate.triggerField).reason,
    sourceStrength: "none",
  };
}

function collectSourceCandidates(answer: ClientRagAnswerPayload, sources: ClientSearchResult[]) {
  const candidates: SourceCandidate[] = [];
  const supportingChunkIds = new Set([
    ...(answer.citations ?? []).map((citation) => citation.chunk_id),
    ...(answer.quoteCards ?? []).map((quote) => quote.chunk_id),
    ...(answer.answerSections ?? []).flatMap((section) => section.citation_chunk_ids ?? []),
  ]);
  const reviewOnlyIdentities = new Set(
    (answer.citations ?? [])
      .filter((citation) => citation.provenance === "review_only")
      .map((citation) => citationIdentity(citation)),
  );
  const push = (candidate: SourceCandidate) => {
    candidates.push(applyReviewOnlyProvenance(candidate, reviewOnlyIdentities));
  };
  const bestSource = answer.bestSource ?? null;
  if (bestSource && supportingChunkIds.has(bestSource.chunk_id)) {
    push(candidateFromBestSource(bestSource, "bestSource"));
  }
  for (const citation of answer.citations ?? []) push(candidateFromCitation(citation, "citations"));
  for (const quote of answer.quoteCards ?? []) {
    push({
      ...candidateFromCitation(quote, "quoteCards"),
      reason: "Exact quote card source.",
      snippet: quote.quote,
      sourceStrength: quote.source_strength,
    });
  }
  for (const source of sources) {
    if (supportingChunkIds.has(source.id)) push(candidateFromSearchResult(source, "sources"));
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const section of answer.answerSections ?? []) {
    for (const chunkId of section.citation_chunk_ids ?? []) {
      const source = sourceById.get(chunkId);
      if (source) {
        push({
          ...candidateFromSearchResult(source, "answerSections"),
          citation: citationFromClientResult(source, "section_selected"),
          reason: `Supports answer section: ${section.heading}`,
        });
      }
    }
  }

  return candidates;
}

function dedupeSourceLinks(candidates: SourceCandidate[], limit: number) {
  const seen = new Set<string>();
  const links: SourceLink[] = [];
  for (const candidate of candidates) {
    const key = citationIdentity(candidate.citation);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(sourceLinkFromCandidate(candidate));
    if (links.length >= limit) break;
  }
  return links;
}

function sourceKeyForSearchResult(source: ClientSearchResult) {
  return [source.document_id, source.page_number ?? "n/a", source.id].join(":");
}

function prioritizedReviewSources(sources: ClientSearchResult[], primarySources: SourceLink[], limit: number) {
  const primaryKeys = new Map(
    primarySources.map((source, index) => [
      `${source.document_id}:${source.page_number ?? "n/a"}:${source.chunk_id}`,
      index,
    ]),
  );
  return [...sources]
    .sort((left, right) => {
      const leftRank = primaryKeys.get(sourceKeyForSearchResult(left)) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = primaryKeys.get(sourceKeyForSearchResult(right)) ?? Number.MAX_SAFE_INTEGER;
      return (
        leftRank - rightRank ||
        (right.hybrid_score ?? right.similarity ?? 0) - (left.hybrid_score ?? left.similarity ?? 0) ||
        left.id.localeCompare(right.id)
      );
    })
    .filter(
      (source, index, all) =>
        all.findIndex((candidate) => sourceKeyForSearchResult(candidate) === sourceKeyForSearchResult(source)) ===
        index,
    )
    .slice(0, limit);
}

function hasDirectVisualNeed(answer: ClientRagAnswerPayload) {
  return (
    answer.queryClass === "table_threshold" ||
    answer.responseMode === "threshold_table" ||
    Boolean((answer.visualEvidence ?? []).some((item) => item.accessibleTableMarkdown || item.tableRows?.length))
  );
}

function dedupeQuotes(quotes: ClientQuoteCard[], primarySources: SourceLink[], limit: number) {
  if (limit <= 0) return [];
  const primaryIds = new Set(primarySources.map((source) => source.chunk_id));
  const seen = new Set<string>();
  const output: ClientQuoteCard[] = [];
  for (const quote of quotes) {
    const quoteText = quote.quote.replace(/\s+/g, " ").trim();
    if (!quoteText || /^(?:n\/a|none|null|not available)$/i.test(quoteText)) continue;
    if (primaryIds.size > 0 && !primaryIds.has(quote.chunk_id)) continue;
    const key = `${citationIdentity(quote)}:${quoteText.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(quote);
    if (output.length >= limit) break;
  }
  return output;
}

function dedupeVisualEvidence(evidence: VisualEvidenceCard[], primarySources: SourceLink[], limit: number) {
  if (limit <= 0) return [];
  const primaryIds = new Set(primarySources.map((source) => source.chunk_id));
  const seen = new Set<string>();
  const output: VisualEvidenceCard[] = [];
  for (const item of evidence) {
    if (primaryIds.size > 0 && item.source_chunk_id && !primaryIds.has(item.source_chunk_id)) continue;
    const key = item.id || `${item.document_id}:${item.page_number ?? "n/a"}:${item.source_chunk_id}:${item.image_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

function dedupeRelatedDocuments(documents: ClientRelatedDocument[], primarySources: SourceLink[], limit: number) {
  if (limit <= 0) return [];
  const primaryDocumentIds = new Set(primarySources.map((source) => source.document_id));
  const seen = new Set<string>();
  const output: ClientRelatedDocument[] = [];
  for (const document of documents) {
    if (primaryDocumentIds.has(document.document_id)) continue;
    if (seen.has(document.document_id)) continue;
    seen.add(document.document_id);
    output.push(document);
    if (output.length >= limit) break;
  }
  return output;
}

/**
 * The two warnings that report a source's CURRENCY rather than a gap in the
 * evidence. They are exported because the answer surface has to be able to tell
 * them apart from the rest: a source being due for review is not a missing
 * piece of evidence, and a summary that counts it as one both overstates the
 * gaps and — since the same fact also drives the stale-evidence state — says the
 * one thing twice while naming it wrongly.
 */
export const currencyReviewWarnings = {
  supporting: "A supporting source is due for review.",
  retrieved: "A retrieved source is due for review.",
} as const;

export function isCurrencyReviewWarning(warning: string): boolean {
  return Object.values(currencyReviewWarnings).some((message) => message === warning);
}

function buildWarnings(answer: ClientRagAnswerPayload | RagAnswer, trust: AnswerRenderTrust) {
  const warnings: string[] = [];
  if (trust === "unsupported")
    warnings.push("This is a source-gap answer; recommendation-style evidence extras are hidden.");
  if (trust === "low") warnings.push("Evidence support is low; verify linked sources before relying on the answer.");
  if (answer.retrievalGateBlocked === true) {
    warnings.push("Retrieval confidence gate was blocked for low signal.");
  }
  if (answer.faithfulnessWarning) warnings.push(answer.faithfulnessWarning);
  if (answer.unverifiedNumericTokens?.length) {
    warnings.push(`Unverified numeric tokens: ${answer.unverifiedNumericTokens.slice(0, 5).join(", ")}.`);
  }
  for (const warning of answer.sourceGovernanceWarnings ?? []) {
    if (warning.message) warnings.push(warning.message);
  }
  const currencyWarning =
    "sourceCurrencyWarning" in answer
      ? answer.sourceCurrencyWarning
      : "evidenceAssessments" in answer
        ? sourceCurrencyWarningForAnswer(answer)
        : undefined;
  if (currencyWarning === "supporting") {
    warnings.push(currencyReviewWarnings.supporting);
  } else if (currencyWarning === "retrieved") {
    warnings.push(currencyReviewWarnings.retrieved);
  }
  for (const gap of answer.conflictsOrGaps ?? []) {
    if (gap.message) warnings.push(gap.message);
    if (warnings.length >= 5) break;
  }
  return [...new Set(warnings)];
}

function parseAccessibleTableMarkdown(markdown?: string | null) {
  if (!markdown?.trim()) return null;
  const rows = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|") && !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.replace(/\\\|/g, "|").trim()),
    )
    .filter((row) => row.some(Boolean));
  return rows.length > 1 ? { headers: rows[0], rows: rows.slice(1) } : null;
}

function canonicalTableFromEvidence(item: VisualEvidenceCard): CanonicalAnswerTableRecord | null {
  const markdownTable = parseAccessibleTableMarkdown(item.accessibleTableMarkdown);
  const sourceHeaders = item.tableRows?.length ? (item.tableColumns ?? []) : (markdownTable?.headers ?? []);
  const sourceRows = item.tableRows?.length ? item.tableRows : (markdownTable?.rows ?? []);
  if (!sourceRows.length) return null;

  const columnCount = Math.max(sourceHeaders.length, ...sourceRows.map((row) => row.length), 1);
  const incompleteHeaders = sourceHeaders.length < columnCount || sourceHeaders.some((header) => !header.trim());
  const paddedHeaders = Array.from({ length: columnCount }, (_, index) => sourceHeaders[index]?.trim() || null);
  const paddedRows = sourceRows
    .map((row) => Array.from({ length: columnCount }, (_, index) => row[index]?.trim() || null))
    .filter((row) => row.some(Boolean));
  if (!paddedRows.length) return null;

  const normalized = normalizeAccessibleTable(sourceRows, sourceHeaders.length ? sourceHeaders : null);
  const lowConfidence = incompleteHeaders || Boolean(normalized?.lowConfidence);
  const headers = incompleteHeaders
    ? paddedHeaders
    : (normalized?.header.map((header) => header || null) ?? paddedHeaders);
  const rows = incompleteHeaders
    ? paddedRows
    : (normalized?.body.map((row) => row.map((cell) => cell || null)) ?? paddedRows);
  const caveats: string[] = [];
  if (incompleteHeaders) caveats.push("Table headers are incomplete; blank headers and cells are preserved.");
  if (normalized?.lowConfidence) {
    caveats.push("Table structure could not be confidently reconstructed — verify values against the source.");
  }
  const title = item.tableTitle?.trim() || item.tableLabel?.trim() || item.caption?.trim() || undefined;
  const sourceLabel = `${item.title || item.file_name || "Source"}, page ${item.page_number ?? "n/a"}`;

  return {
    id: item.id,
    title,
    headers,
    rows,
    lowConfidence,
    caveat: caveats.length ? caveats.join(" ") : undefined,
    source: item.viewer_href
      ? { label: sourceLabel, href: item.viewer_href, chunkId: item.source_chunk_id || undefined }
      : undefined,
  };
}

function buildCanonicalTables(visualEvidence: VisualEvidenceCard[]) {
  return visualEvidence
    .map(canonicalTableFromEvidence)
    .filter((table): table is CanonicalAnswerTableRecord => Boolean(table));
}

function buildEvidenceRows(
  answer: ClientRagAnswerPayload,
  primarySources: SourceLink[],
  quoteCards: ClientQuoteCard[],
  visualEvidence: VisualEvidenceCard[],
  limit: number,
) {
  const quoteByChunk = new Map(quoteCards.map((quote) => [quote.chunk_id, quote]));
  const visualByChunk = new Map(visualEvidence.map((item) => [item.source_chunk_id, item]));
  const sectionByChunk = new Map<string, { heading: string; supportLevel?: string }>();
  for (const section of answer.answerSections ?? []) {
    for (const chunkId of section.citation_chunk_ids ?? []) {
      if (!sectionByChunk.has(chunkId))
        sectionByChunk.set(chunkId, { heading: section.heading, supportLevel: section.supportLevel });
    }
  }

  return primarySources.slice(0, limit).map((source) => {
    const channels: AnswerRenderBlock[] = ["reviewSources"];
    const triggerFields = ["primarySources"];
    const section = sectionByChunk.get(source.chunk_id);
    const quote = quoteByChunk.get(source.chunk_id);
    const visual = visualByChunk.get(source.chunk_id);
    if (section) {
      channels.push("evidenceMap");
      triggerFields.push("answerSections");
    }
    if (quote) {
      channels.push("quoteCards");
      triggerFields.push("quoteCards");
    }
    if (visual) {
      channels.push("visualEvidence");
      triggerFields.push("visualEvidence");
    }
    return {
      id: source.id,
      source,
      channels: [...new Set(channels)],
      section: section?.heading,
      supportLevel: section?.supportLevel,
      quote: quote?.quote,
      triggerFields: [...new Set(triggerFields)],
    };
  });
}

function decision(shown: boolean, reason: string, triggerField?: string): AnswerRenderDecision {
  return { shown, reason, triggerField };
}

function blockDecisions(args: {
  trust: AnswerRenderTrust;
  hasSources: boolean;
  hasRows: boolean;
  hasQuotes: boolean;
  hasVisual: boolean;
  hasRelated: boolean;
  hasWarnings: boolean;
}) {
  const { trust, hasSources, hasRows, hasQuotes, hasVisual, hasRelated, hasWarnings } = args;
  const atLeastMedium = trustRank(trust) >= trustRank("medium");
  const high = trust === "high";
  return {
    sourceStatus: decision(
      hasSources,
      hasSources ? "At least one policy-approved source is available." : "No source passed render policy.",
      "primarySources",
    ),
    reviewSources: decision(
      hasSources,
      hasSources ? "Show capped source review list." : "Hide source list because no policy-approved source remains.",
      "reviewSources",
    ),
    evidenceMap: decision(
      atLeastMedium && hasRows,
      atLeastMedium ? "Medium/high trust can show mapped evidence rows." : "Hidden below medium trust.",
      "answerSections",
    ),
    quoteCards: decision(
      high && hasQuotes,
      high ? "High trust can show capped exact quote cards." : "Hidden unless trust is high.",
      "quoteCards",
    ),
    visualEvidence: decision(
      (high || trust === "medium") && hasVisual,
      high
        ? "High trust can show capped visual evidence."
        : "Medium trust shows only directly relevant table/visual evidence.",
      "visualEvidence",
    ),
    relatedDocuments: decision(
      high && hasRelated,
      high ? "High trust can show capped related documents." : "Hidden unless trust is high.",
      "relatedDocuments",
    ),
    warnings: decision(
      hasWarnings,
      hasWarnings ? "Warnings are useful for the current trust/source state." : "No render warnings.",
      "warnings",
    ),
    diagnostics: decision(
      false,
      "Diagnostics are retained in payload and debugReasons, not shown by default.",
      "debugReasons",
    ),
  } satisfies Record<AnswerRenderBlock, AnswerRenderDecision>;
}

// P4b: the copy/paste block previously emitted the bare enum ("strong"/"moderate"/"limited"/"none"
// support) — which reads oddly ("none support") and gives no plain-English cue about how well the
// source matched. Gloss it into a clinician-readable phrase so pasted drafts carry interpretable
// source strength.
export function describeSourceStrengthForCopy(strength: SourceStrength | "none"): string {
  switch (strength) {
    case "strong":
      return "strong match";
    case "moderate":
      return "moderate match";
    case "limited":
      return "limited match";
    default:
      return "match strength not rated";
  }
}

export function formatAnswerRenderCopyText(args: {
  answerText: string;
  trust: AnswerRenderTrust;
  /** The on-screen support label level (#WGMB4Z decision 17); omitted means it equals `trust`. */
  supportLabelTrust?: AnswerRenderTrust;
  primarySources: SourceLink[];
  warnings: string[];
  tables?: CanonicalAnswerTableRecord[];
  visualEvidence?: VisualEvidenceCard[];
}) {
  const sourceLines = args.primarySources.length
    ? args.primarySources.map(
        (source, index) =>
          `${index + 1}. ${source.label} | ${describeSourceStrengthForCopy(source.sourceStrength)} | ${source.href}`,
      )
    : ["No policy-approved sources were attached."];
  const warningLines = args.warnings.length ? args.warnings.map((warning) => `- ${warning}`) : ["- None"];
  const tableLines = (args.tables ?? []).flatMap((table, index) => [
    index === 0 ? "Clinical tables" : "",
    table.title || `Table ${index + 1}`,
    table.headers.map((header) => header ?? "[header missing]").join(" | "),
    ...table.rows.map((row) => row.map((cell) => cell ?? "[blank]").join(" | ")),
    ...(table.caveat ? [`Caveat: ${table.caveat}`] : []),
    ...(table.source ? [`Source: ${table.source.label} | ${table.source.href}`] : []),
    "",
  ]);
  const visualEvidenceLines = args.visualEvidence?.length
    ? formatDisplayedVisualEvidenceForClipboard(args.visualEvidence)
    : [];

  return [
    "Clinical answer draft",
    "Verify against linked source documents before clinical use.",
    "",
    "Answer",
    args.answerText,
    "",
    ...tableLines,
    "Source status",
    `Render trust: ${args.trust}`,
    // The label cap only ever lowers high to medium, whose on-screen word is "Supported". Say so in
    // the copied text too, so notes pasted from it never read stronger than the screen did.
    ...(args.supportLabelTrust && args.supportLabelTrust !== args.trust
      ? ["Support label: Supported (not every claim is checked against a reviewed source)"]
      : []),
    "",
    "Sources for review",
    ...sourceLines,
    "",
    "Warnings",
    ...warningLines,
    ...(visualEvidenceLines.length ? ["", "Displayed table evidence", ...visualEvidenceLines] : []),
  ]
    .join("\n")
    .trim();
}

/**
 * Builds a trust-gated render model for a clinical answer, including sources, evidence, warnings, and copy-ready text.
 *
 * @param answer - The clinical answer and associated evidence to render
 * @param options - Optional source overrides and diagnostic decision details
 * @returns The structured answer render model
 */
export function buildAnswerRenderModel(
  answer: ClientRagAnswerPayload,
  options: BuildAnswerRenderModelOptions = {},
): AnswerRenderModel {
  const trust = deriveTrust(answer);
  const caps = trustCaps[trust];
  const rawSources = options.sources ?? answer.sources ?? [];
  const candidates = collectSourceCandidates(answer, rawSources);
  const primarySources = dedupeSourceLinks(candidates, caps.sources);
  const reviewSources = prioritizedReviewSources(rawSources, primarySources, caps.sources);
  const bestSource = trust === "unsupported" ? null : (answer.bestSource ?? null);
  const rawQuotes = answer.quoteCards ?? [];
  const rawVisualEvidence = answer.visualEvidence ?? [];
  const rawRelatedDocuments = answer.relatedDocuments ?? [];
  const visualLimit =
    isAnswerSourceBacked(answer) && (hasDirectVisualNeed(answer) || trust === "high") ? caps.visual : 0;
  const quoteCards = dedupeQuotes(rawQuotes, primarySources, caps.quotes);
  const visualEvidence = dedupeVisualEvidence(rawVisualEvidence, primarySources, visualLimit);
  const tables = buildCanonicalTables(visualEvidence);
  const relatedDocuments = dedupeRelatedDocuments(rawRelatedDocuments, primarySources, caps.related);
  const warnings = buildWarnings(answer, trust);
  const evidenceRows = buildEvidenceRows(answer, primarySources, quoteCards, visualEvidence, caps.rows);
  const decisions = blockDecisions({
    trust,
    hasSources: primarySources.length > 0 || reviewSources.length > 0,
    hasRows: evidenceRows.length > 0,
    hasQuotes: quoteCards.length > 0,
    hasVisual: visualEvidence.length > 0,
    hasRelated: relatedDocuments.length > 0,
    hasWarnings: warnings.length > 0,
  });
  const allowedBlocks = blockOrder.filter((block) => decisions[block].shown);
  const answerText = answer.answer.trim();
  // The copy/paste draft is plain text for clinical notes — strip the server's
  // high-yield bold markers so a pasted draft never contains literal "**".
  // (Preformatted answers carry no bold, so this is a no-op for them.)
  const copyAnswerText = answerText.replace(/\*\*/g, "");
  const supportLabelTrust = deriveSupportLabelTrust(answer, trust);

  return {
    answerText,
    trust,
    supportLabelTrust,
    allowedBlocks,
    primarySources,
    reviewSources,
    evidenceRows,
    quoteCards,
    visualEvidence,
    relatedDocuments,
    bestSource,
    warnings,
    tables,
    copyText: formatAnswerRenderCopyText({
      answerText: copyAnswerText,
      trust,
      supportLabelTrust,
      primarySources,
      warnings,
      tables,
      visualEvidence,
    }),
    debugReasons: options.includeDebugReasons ? decisions : undefined,
  };
}
