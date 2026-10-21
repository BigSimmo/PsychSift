import type {
  EvidenceRelevance,
  ClinicalSourceMetadata,
  SearchResult,
  SourceGovernanceWarning,
  SourceGovernanceCode,
  SourceGovernanceUiToken,
} from "@/lib/types";
import { hasWaDocumentControlEndorsement } from "@/lib/clinical-validation-basis";
import { documentCautionFor } from "@/lib/document-cautions";
import { SOURCE_GOVERNANCE_CODES } from "@/lib/types";
import { normalizeSourceMetadata } from "@/lib/source-metadata";

export type { SourceGovernanceWarning } from "@/lib/types";

export type GroupedSourceGovernanceWarning = {
  code: SourceGovernanceWarning["code"];
  severity: SourceGovernanceWarning["severity"];
  message: string;
  count: number;
  uiToken?: SourceGovernanceUiToken;
  documentIds: string[];
  titles: string[];
};

export const GOVERNANCE_SEVERITY_MATRIX: Record<SourceGovernanceCode, SourceGovernanceWarning["severity"] | "dynamic"> =
  {
    [SOURCE_GOVERNANCE_CODES.OUTDATED]: "danger",
    [SOURCE_GOVERNANCE_CODES.POOR_EXTRACTION]: "danger",
    [SOURCE_GOVERNANCE_CODES.REVIEW_DUE]: "warning",
    [SOURCE_GOVERNANCE_CODES.UNVERIFIED]: "warning",
    [SOURCE_GOVERNANCE_CODES.PARTIAL_EXTRACTION]: "warning",
    [SOURCE_GOVERNANCE_CODES.LOW_INDEX_QUALITY]: "warning",
    [SOURCE_GOVERNANCE_CODES.WEAK_TABLE_EXTRACTION]: "warning",
    [SOURCE_GOVERNANCE_CODES.NON_LOCAL]: "info",
    [SOURCE_GOVERNANCE_CODES.REGISTRY_RECORD]: "info",
    [SOURCE_GOVERNANCE_CODES.WEAK_EVIDENCE]: "dynamic",
    // "warning", not "danger": a danger warning refuses the whole answer, and one known error in
    // one document must not suppress everything else that document and its neighbours support.
    [SOURCE_GOVERNANCE_CODES.DOCUMENT_CAUTION]: "warning",
  } as const;

export const GOVERNANCE_UI_TOKEN_MATRIX: Record<SourceGovernanceCode, SourceGovernanceUiToken | "dynamic"> = {
  [SOURCE_GOVERNANCE_CODES.OUTDATED]: "destructive",
  [SOURCE_GOVERNANCE_CODES.POOR_EXTRACTION]: "destructive",
  [SOURCE_GOVERNANCE_CODES.REVIEW_DUE]: "warning",
  [SOURCE_GOVERNANCE_CODES.UNVERIFIED]: "warning",
  [SOURCE_GOVERNANCE_CODES.PARTIAL_EXTRACTION]: "caution",
  [SOURCE_GOVERNANCE_CODES.LOW_INDEX_QUALITY]: "caution",
  [SOURCE_GOVERNANCE_CODES.WEAK_TABLE_EXTRACTION]: "caution",
  [SOURCE_GOVERNANCE_CODES.NON_LOCAL]: "neutral",
  [SOURCE_GOVERNANCE_CODES.REGISTRY_RECORD]: "muted",
  [SOURCE_GOVERNANCE_CODES.WEAK_EVIDENCE]: "dynamic",
  [SOURCE_GOVERNANCE_CODES.DOCUMENT_CAUTION]: "destructive",
} as const;

export const sourceGovernanceRefusalAnswer =
  "I cannot provide a clinical answer because one or more matched documents are not suitable for clinical use yet. Try a narrower clinical term or scope the search to a current approved document.";

// Canonical per-source danger-severity warning messages. These are the exact
// strings emitted by sourceGovernanceWarnings below AND the strings persisted by
// UI captures (ClinicalDashboard submits warning.message to /api/eval-cases,
// which drops the severity), so a consumer can recover danger severity from a
// persisted message via isDangerSourceGovernanceMessage.
export const OUTDATED_SOURCE_WARNING_MESSAGE = "One or more supporting sources are marked outdated.";
export const POOR_EXTRACTION_WARNING_MESSAGE = "One or more supporting sources have poor extraction quality.";
export const WEAK_EVIDENCE_DANGER_MESSAGE = "The retrieved evidence is completely unbacked by the source.";
export const UNVERIFIED_SOURCE_WARNING_MESSAGE = "One or more supporting sources have not been locally validated.";
// Same code, severity and visibility as the unverified caveat above, worded for what is actually
// known: the issuing WA service endorsed the document, and nobody has reviewed it here (#JYH1FH).
export const WA_ENDORSED_UNREVIEWED_SOURCE_WARNING_MESSAGE =
  "One or more supporting sources are endorsed by the issuing WA service but have not been reviewed here.";

const dangerSourceGovernanceMessages = new Set<string>([
  OUTDATED_SOURCE_WARNING_MESSAGE,
  POOR_EXTRACTION_WARNING_MESSAGE,
  WEAK_EVIDENCE_DANGER_MESSAGE,
]);

export function isDangerSourceGovernanceMessage(message: string) {
  return dangerSourceGovernanceMessages.has(message.trim());
}

const frontendVisibleWarningCodes = new Set<SourceGovernanceWarning["code"]>([
  SOURCE_GOVERNANCE_CODES.OUTDATED,
  SOURCE_GOVERNANCE_CODES.POOR_EXTRACTION,
  SOURCE_GOVERNANCE_CODES.WEAK_EVIDENCE,
  // Since the public-corpus promotion (all indexed documents are anonymously
  // searchable regardless of clinical_validation_status), "not locally
  // validated" is a clinically material caveat, not routine review metadata.
  SOURCE_GOVERNANCE_CODES.UNVERIFIED,
  SOURCE_GOVERNANCE_CODES.REGISTRY_RECORD,
  // A source past its review date is a material currency caveat: guidance may have
  // moved on. Surfacing the badge keeps the governance notice consistent with the
  // review-due language already emitted in the render-policy copy text
  // (answer-render-policy.buildWarnings), which the badge list previously suppressed.
  SOURCE_GOVERNANCE_CODES.REVIEW_DUE,
  // A known error in the cited document itself (src/lib/document-cautions.ts).
  SOURCE_GOVERNANCE_CODES.DOCUMENT_CAUTION,
]);

function isLocalMetadataText(value: string) {
  return /\b(?:wa|western australia|perth|north metropolitan|east metropolitan|south metropolitan|health service)\b/i.test(
    value,
  );
}

function pushUnique(warnings: SourceGovernanceWarning[], warning: SourceGovernanceWarning) {
  const key = `${warning.code}:${warning.document_id ?? ""}:${warning.message}`;
  if (warnings.some((item) => `${item.code}:${item.document_id ?? ""}:${item.message}` === key)) return;
  warnings.push(warning);
}

export function resolveEvidenceWarningSeverity(relevance: EvidenceRelevance): {
  severity: SourceGovernanceWarning["severity"];
  uiToken: SourceGovernanceUiToken;
  isDanger: boolean;
} {
  const isDanger = relevance.verdict === "none";
  return {
    severity: isDanger ? "danger" : "warning",
    uiToken: isDanger ? "destructive" : "warning",
    isDanger,
  };
}

export function sourceGovernanceWarnings(args: {
  results: SearchResult[];
  relevance?: EvidenceRelevance | null;
  limit?: number;
}) {
  const warnings: SourceGovernanceWarning[] = [];

  if (args.relevance && !args.relevance.isSourceBacked) {
    const { isDanger, severity, uiToken } = resolveEvidenceWarningSeverity(args.relevance);
    pushUnique(warnings, {
      code: SOURCE_GOVERNANCE_CODES.WEAK_EVIDENCE,
      severity,
      uiToken,
      message: isDanger
        ? WEAK_EVIDENCE_DANGER_MESSAGE
        : args.relevance.supportReason || "The retrieved evidence is weak or nearby-only.",
    });
  }

  for (const result of args.results) {
    const source = normalizeSourceMetadata(result.source_metadata);
    const title = result.title;
    const document_id = result.document_id;

    const caution = documentCautionFor(result);
    if (caution) {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.DOCUMENT_CAUTION,
        severity: GOVERNANCE_SEVERITY_MATRIX[
          SOURCE_GOVERNANCE_CODES.DOCUMENT_CAUTION
        ] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.DOCUMENT_CAUTION] as SourceGovernanceUiToken,
        message: caution.message,
        document_id,
        title,
      });
    }
    if (source.document_status === "outdated") {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.OUTDATED,
        severity: GOVERNANCE_SEVERITY_MATRIX[SOURCE_GOVERNANCE_CODES.OUTDATED] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.OUTDATED] as SourceGovernanceUiToken,
        message: OUTDATED_SOURCE_WARNING_MESSAGE,
        document_id,
        title,
      });
    } else if (source.document_status === "review_due") {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.REVIEW_DUE,
        severity: GOVERNANCE_SEVERITY_MATRIX[SOURCE_GOVERNANCE_CODES.REVIEW_DUE] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.REVIEW_DUE] as SourceGovernanceUiToken,
        message: "One or more supporting sources are due for review.",
        document_id,
        title,
      });
    }

    // Audit M8: docs/clinical-governance.md treats unknown source metadata as
    // unverified, not current. Comparing to the literal "unverified" alone left
    // a partially-recorded document — governance fields present but
    // clinical_validation_status absent, which normalizeOptionalSourceMetadata
    // renders as "unknown" — cited with no caveat at all. Only an explicitly
    // reviewed or approved status clears it. This is a caveat only: it must
    // never be read back as a retrieval or ordering signal
    // (docs/rag-behaviour/refuted-approaches.md, Refutation 3).
    if (source.clinical_validation_status !== "locally_reviewed" && source.clinical_validation_status !== "approved") {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.UNVERIFIED,
        severity: GOVERNANCE_SEVERITY_MATRIX[SOURCE_GOVERNANCE_CODES.UNVERIFIED] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.UNVERIFIED] as SourceGovernanceUiToken,
        message: hasWaDocumentControlEndorsement(source)
          ? WA_ENDORSED_UNREVIEWED_SOURCE_WARNING_MESSAGE
          : UNVERIFIED_SOURCE_WARNING_MESSAGE,
        document_id,
        title,
      });
    }

    if (source.extraction_quality === "poor" || result.indexing_quality?.extraction_quality === "poor") {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.POOR_EXTRACTION,
        severity: GOVERNANCE_SEVERITY_MATRIX[
          SOURCE_GOVERNANCE_CODES.POOR_EXTRACTION
        ] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.POOR_EXTRACTION] as SourceGovernanceUiToken,
        message: POOR_EXTRACTION_WARNING_MESSAGE,
        document_id,
        title,
      });
    } else if (source.extraction_quality === "partial" || result.indexing_quality?.extraction_quality === "partial") {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.PARTIAL_EXTRACTION,
        severity: GOVERNANCE_SEVERITY_MATRIX[
          SOURCE_GOVERNANCE_CODES.PARTIAL_EXTRACTION
        ] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.PARTIAL_EXTRACTION] as SourceGovernanceUiToken,
        message: "One or more supporting sources have partial extraction quality.",
        document_id,
        title,
      });
    }

    if (typeof result.indexing_quality?.quality_score === "number" && result.indexing_quality.quality_score < 0.45) {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.LOW_INDEX_QUALITY,
        severity: GOVERNANCE_SEVERITY_MATRIX[
          SOURCE_GOVERNANCE_CODES.LOW_INDEX_QUALITY
        ] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.LOW_INDEX_QUALITY] as SourceGovernanceUiToken,
        message: "One or more supporting sources have a low indexing quality score.",
        document_id,
        title,
      });
    }

    const localityText = [source.jurisdiction, source.publisher].filter(Boolean).join(" ");
    if (localityText && !isLocalMetadataText(localityText)) {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.NON_LOCAL,
        severity: GOVERNANCE_SEVERITY_MATRIX[SOURCE_GOVERNANCE_CODES.NON_LOCAL] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.NON_LOCAL] as SourceGovernanceUiToken,
        message: "One or more supporting sources do not appear to be local WA/Perth guidance.",
        document_id,
        title,
      });
    }

    if (
      result.table_facts?.some((fact) =>
        ["bad_extraction", "unrelated", "administrative"].includes(String(fact.metadata?.review_class ?? "")),
      )
    ) {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.WEAK_TABLE_EXTRACTION,
        severity: GOVERNANCE_SEVERITY_MATRIX[
          SOURCE_GOVERNANCE_CODES.WEAK_TABLE_EXTRACTION
        ] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.WEAK_TABLE_EXTRACTION] as SourceGovernanceUiToken,
        message: "Some matched table evidence has been reviewed as administrative, unrelated, or poor extraction.",
        document_id,
        title,
      });
    }

    if (source.source_kind === "registry_record") {
      pushUnique(warnings, {
        code: SOURCE_GOVERNANCE_CODES.REGISTRY_RECORD,
        severity: GOVERNANCE_SEVERITY_MATRIX[
          SOURCE_GOVERNANCE_CODES.REGISTRY_RECORD
        ] as SourceGovernanceWarning["severity"],
        uiToken: GOVERNANCE_UI_TOKEN_MATRIX[SOURCE_GOVERNANCE_CODES.REGISTRY_RECORD] as SourceGovernanceUiToken,
        message:
          "One or more supporting sources are curated registry summaries, not source documents; verify against linked source documents for clinical decisions.",
        document_id,
        title,
      });
    }
  }

  const severityRank = { danger: 0, warning: 1, info: 2 } satisfies Record<SourceGovernanceWarning["severity"], number>;
  return warnings
    .sort((left, right) => severityRank[left.severity] - severityRank[right.severity])
    .slice(0, args.limit ?? 8);
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function isWaEndorsedUnreviewedWarning(warning: SourceGovernanceWarning) {
  return (
    warning.code === SOURCE_GOVERNANCE_CODES.UNVERIFIED &&
    warning.message === WA_ENDORSED_UNREVIEWED_SOURCE_WARNING_MESSAGE
  );
}

function groupedMessage(warning: SourceGovernanceWarning, count: number) {
  if (isWaEndorsedUnreviewedWarning(warning))
    return `${plural(count, "source")} ${count === 1 ? "is" : "are"} endorsed by the issuing WA service but not reviewed here.`;
  if (warning.code === SOURCE_GOVERNANCE_CODES.OUTDATED) return `${plural(count, "source")} marked outdated.`;
  if (warning.code === SOURCE_GOVERNANCE_CODES.REVIEW_DUE) return `${plural(count, "source")} due for review.`;
  if (warning.code === SOURCE_GOVERNANCE_CODES.NON_LOCAL)
    return `${plural(count, "source")} may not be local WA/Perth guidance.`;
  if (warning.code === SOURCE_GOVERNANCE_CODES.UNVERIFIED)
    return `${plural(count, "source")} ${count === 1 ? "has" : "have"} not been locally validated.`;
  if (warning.code === SOURCE_GOVERNANCE_CODES.POOR_EXTRACTION)
    return `${plural(count, "source")} ${count === 1 ? "has" : "have"} poor extraction quality.`;
  if (warning.code === SOURCE_GOVERNANCE_CODES.PARTIAL_EXTRACTION)
    return `${plural(count, "source")} ${count === 1 ? "has" : "have"} partial extraction quality.`;
  if (warning.code === SOURCE_GOVERNANCE_CODES.LOW_INDEX_QUALITY)
    return `${plural(count, "source")} ${count === 1 ? "has" : "have"} low indexing quality.`;
  if (warning.code === SOURCE_GOVERNANCE_CODES.WEAK_TABLE_EXTRACTION)
    return `${plural(count, "table evidence item")} reviewed as administrative, unrelated, or poor extraction.`;
  if (warning.code === SOURCE_GOVERNANCE_CODES.REGISTRY_RECORD)
    return `${plural(count, "registry summary", "registry summaries")} used as supporting evidence.`;
  return warning.message;
}

export function groupSourceGovernanceWarnings(warnings: SourceGovernanceWarning[]) {
  const grouped = new Map<string, GroupedSourceGovernanceWarning>();

  for (const warning of warnings) {
    // WA-endorsed, unreviewed sources are counted apart from sources of unknown provenance.
    const key = isWaEndorsedUnreviewedWarning(warning) ? `${warning.code}:wa_endorsed` : warning.code;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      if (warning.document_id && !existing.documentIds.includes(warning.document_id)) {
        existing.documentIds.push(warning.document_id);
      }
      if (warning.title && !existing.titles.includes(warning.title)) existing.titles.push(warning.title);
      existing.message = groupedMessage(warning, existing.count);
      continue;
    }
    grouped.set(key, {
      code: warning.code,
      severity: warning.severity,
      uiToken: warning.uiToken,
      message: groupedMessage(warning, 1),
      count: 1,
      documentIds: warning.document_id ? [warning.document_id] : [],
      titles: warning.title ? [warning.title] : [],
    });
  }

  const severityRank = { danger: 0, warning: 1, info: 2 } satisfies Record<SourceGovernanceWarning["severity"], number>;
  return Array.from(grouped.values()).sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

export function isFrontendVisibleSourceGovernanceWarning(warning: SourceGovernanceWarning) {
  return frontendVisibleWarningCodes.has(warning.code);
}

export function frontendSourceGovernanceWarnings(warnings: SourceGovernanceWarning[]) {
  return warnings.filter(isFrontendVisibleSourceGovernanceWarning);
}

export function hasDangerSourceGovernanceWarning(warnings: SourceGovernanceWarning[]) {
  return warnings.some((warning) => warning.severity === "danger");
}

/**
 * Claim evidence must be a governed source document with accepted extraction.
 * Currentness and catalogue identity are evaluated separately so callers can
 * return the canonical eligibility reason rather than collapsing every failure.
 */
export function isClaimEvidenceGovernanceEligible(
  source: Pick<
    ClinicalSourceMetadata,
    | "source_kind"
    | "content_mode"
    | "clinical_validation_status"
    | "clinical_validation_evidence"
    | "extraction_quality"
  >,
) {
  return (
    source.source_kind === "document" &&
    source.content_mode === "indexed_content" &&
    (source.clinical_validation_status === "approved" ||
      source.clinical_validation_status === "locally_reviewed" ||
      // Keeps the claim eligibility the backfill's `locally_reviewed` stamp gave (#JYH1FH).
      hasWaDocumentControlEndorsement(source)) &&
    source.extraction_quality === "good"
  );
}
