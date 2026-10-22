import { ragAdaptiveAnswerPromptVersion } from "@/lib/rag/rag-versioning";
import * as z from "zod/mini";
import { SOURCE_GOVERNANCE_CODES } from "@/lib/types";

// Use the tree-shakable Mini API because these validators also ship to the browser.
// Public structured fields have a fixed depth and bounded collections. Objects
// strip unknown keys; malformed known fields fail the entire answer boundary.
const text = z.string().check(z.maxLength(16_000));
const label = z.string().check(z.maxLength(1_000));
const id = z.string().check(z.minLength(1), z.maxLength(500));
const count = z.int().check(z.minimum(0), z.maximum(1_000_000));
// Zod 4 numbers reject NaN and infinities without an additional finite check.
const score = z.number();
const ids = z.array(id).check(z.maxLength(100));
const texts = z.array(text).check(z.maxLength(100));
const pages = z.array(count).check(z.maxLength(200));
const strength = z.enum(["strong", "moderate", "limited"]);

export const clientDocumentLabelSchema = z.object({
  label: z.string().check(z.minLength(1), z.maxLength(500)),
  label_type: z.enum([
    "site",
    "topic",
    "document_type",
    "medication",
    "risk",
    "setting",
    "workflow",
    "population",
    "service",
    "clinical_action",
    "care_phase",
    "document_intent",
    "content_feature",
    "custom",
  ]),
  source: z.enum(["generated", "manual"]),
  confidence: z.number().check(z.minimum(0), z.maximum(1)),
});

export const clientAnswerSectionSchema = z.object({
  heading: label,
  body: text,
  citation_chunk_ids: ids,
  kind: z.optional(
    z.enum([
      "bottom_line",
      "required_actions",
      "monitoring_timing",
      "medication_dose",
      "thresholds",
      "escalation_risk",
      "contraindications_cautions",
      "comparison",
      "documentation",
      "source_gap",
      "source_conflict",
      "visual_evidence",
      "quotes",
      "verification",
    ]),
  ),
  supportLevel: z.optional(z.enum(["direct", "partial", "nearby", "unsupported"])),
});

const relevance = z.object({
  verdict: z.enum(["direct", "partial", "nearby", "none"]),
  label,
  matchedTerms: texts,
  missingTerms: texts,
  directSourceCount: count,
  weakSourceCount: count,
  score,
  supportReason: text,
  isSourceBacked: z.boolean(),
});

const relatedDocument = z.object({
  document_id: id,
  title: label,
  file_name: label,
  labels: z.array(clientDocumentLabelSchema).check(z.maxLength(100)),
  summary: z.nullable(text),
  best_pages: pages,
  best_chunk_ids: ids,
  image_count: count,
  table_count: z.optional(count),
  cover_image_id: z.optional(z.nullable(id)),
  match_reason: text,
  score,
});

const documentBreakdown = z.object({
  document_id: id,
  title: label,
  file_name: label,
  top_similarity: score,
  source_strength: strength,
  source_count: count,
  quote_count: count,
  pages,
  best_quote: z.optional(text),
});

const visualEvidence = z.object({
  id,
  image_id: id,
  signed_url_endpoint: z.string().check(z.maxLength(2_000)),
  caption: text,
  document_id: id,
  title: label,
  file_name: label,
  page_number: z.nullable(count),
  source_chunk_id: id,
  chunk_index: count,
  viewer_href: z.string().check(z.maxLength(2_000)),
  image_type: z.optional(
    z.enum([
      "clinical_table",
      "flowchart_algorithm",
      "form_checklist",
      "risk_matrix",
      "medication_chart",
      "graph",
      "screenshot_ui",
      "cover_page",
      "photo",
      "logo_decorative",
      "unclear",
    ]),
  ),
  clinical_relevance_score: z.optional(score),
  source_kind: z.optional(z.nullable(label)),
  tableLabel: z.optional(z.nullable(label)),
  tableTitle: z.optional(z.nullable(label)),
  tableRole: z.optional(z.nullable(label)),
  tableTextSnippet: z.optional(z.nullable(text)),
  clinicalUseClass: z.optional(
    z.nullable(z.enum(["clinical_evidence", "administrative", "reference", "decorative_or_empty", "ambiguous"])),
  ),
  clinicalUseReason: z.optional(z.nullable(text)),
  accessibleTableMarkdown: z.optional(z.nullable(text)),
  tableRows: z.optional(z.nullable(z.array(z.array(label).check(z.maxLength(50))).check(z.maxLength(200)))),
  tableColumns: z.optional(z.nullable(z.array(label).check(z.maxLength(50)))),
  labels: z.optional(texts),
});

export const clientAnswerFieldsSchema = z.object({
  claimMarks: z.optional(
    z
      .array(
        z.object({
          claimId: id,
          text,
          supportStatus: z.enum(["direct", "partial"]),
          supportingChunkIds: ids,
        }),
      )
      .check(z.maxLength(100)),
  ),
  sourceCurrencyWarning: z.optional(z.enum(["supporting", "retrieved"])),
  // Owner-signed WA versus national difference (src/lib/rag/guidance-difference-note.ts).
  guidanceDifference: z.optional(
    z.object({
      differenceId: id,
      title: z.string().check(z.minLength(1), z.maxLength(300)),
      year: z.int().check(z.minimum(1900), z.maximum(2100)),
      page: z.nullable(z.int().check(z.minimum(1), z.maximum(10_000))),
      documentId: id,
      chunkId: id,
    }),
  ),
  answerContractVersion: z.optional(z.literal(ragAdaptiveAnswerPromptVersion)),
  renderAdaptiveAnswer: z.optional(z.boolean()),
  // Disclosure persists with the answer; feedback credentials deliberately do not.
  demoMode: z.optional(z.boolean()),
  fallbackMode: z.optional(z.literal("non_production_demo")),
  routingMode: z.optional(z.enum(["unsupported", "extractive", "fast", "strong"])),
  providerMode: z.optional(z.enum(["auto", "openai", "offline"])),
  answerQualityTier: z.optional(z.enum(["model_synthesis", "source_only", "cached"])),
  queryClass: z.optional(
    z.enum([
      "document_lookup",
      "table_threshold",
      "medication_dose_risk",
      "comparison",
      "broad_summary",
      "unsupported_or_general",
    ]),
  ),
  responseMode: z.optional(
    z.enum([
      "checklist",
      "comparison_matrix",
      "threshold_table",
      "clinical_pathway",
      "document_lookup",
      "evidence_gap",
    ]),
  ),
  comparisonMatrix: z.optional(
    z.object({
      documents: z.array(z.object({ documentId: id, title: label, fileName: label })).check(z.maxLength(100)),
      rows: z
        .array(
          z.object({
            parameter: label,
            status: z.enum(["agreement", "conflict", "missing"]),
            entries: z
              .array(z.object({ documentId: id, chunkIds: ids, value: z.nullable(text), qualifiers: texts }))
              .check(z.maxLength(100)),
          }),
        )
        .check(z.maxLength(100)),
    }),
  ),
  comparisonEvaluationState: z.optional(z.enum(["evaluated", "not_evaluated"])),
  preformatted: z.optional(z.boolean()),
  answerSections: z.optional(z.array(clientAnswerSectionSchema).check(z.maxLength(100))),
  evidenceSummary: z.optional(
    z.object({
      document_count: count,
      total_sources: count,
      quote_count: count,
      image_count: count,
      source_strength: z.enum(["strong", "moderate", "limited", "none"]),
      summary: text,
    }),
  ),
  conflictsOrGaps: z.optional(
    z
      .array(z.object({ type: z.enum(["gap", "conflict"]), message: text, source_chunk_ids: z.optional(ids) }))
      .check(z.maxLength(100)),
  ),
  sourceCoverage: z.optional(
    z.object({ documents_used: count, pages, strongest_similarity: score, has_images: z.boolean() }),
  ),
  visualEvidence: z.optional(z.array(visualEvidence).check(z.maxLength(100))),
  documentBreakdown: z.optional(z.array(documentBreakdown).check(z.maxLength(100))),
  relatedDocuments: z.optional(z.array(relatedDocument).check(z.maxLength(100))),
  relevance: z.optional(relevance),
  sourceGovernanceWarnings: z.optional(
    z
      .array(
        z.object({
          code: z.enum(SOURCE_GOVERNANCE_CODES),
          severity: z.enum(["info", "warning", "danger"]),
          message: text,
          uiToken: z.optional(z.enum(["destructive", "warning", "caution", "neutral", "muted"])),
          document_id: z.optional(id),
          title: z.optional(label),
        }),
      )
      .check(z.maxLength(100)),
  ),
  truncated: z.optional(z.boolean()),
  truncationReason: z.optional(text),
  unverifiedNumericTokens: z.optional(texts),
  faithfulnessWarning: z.optional(text),
});

export type ClientAnswerFields = z.infer<typeof clientAnswerFieldsSchema>;
export type ClientRelatedDocument = z.infer<typeof relatedDocument>;
