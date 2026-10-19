import { z } from "zod";

import {
  ANSWER_FEEDBACK_NOTE_MAX_LENGTH,
  answerFeedbackTypes,
  feedbackRecordIdPattern,
  feedbackRecordTypes,
} from "@/lib/answer-feedback";

export const clinicalQualitySnapshotVersion = "1" as const;

export const evidenceStateSchema = z.enum(["complete", "partial", "unknown"]);
export const clinicalQualityAreaSchema = z.enum([
  "dictionary",
  "services",
  "forms",
  "therapies",
  "differentials",
  "specifiers",
]);
export const triageStatusSchema = z.enum(["untriaged", "in_review", "awaiting_retest", "resolved", "dismissed"]);
export const triageDisplayStatusSchema = z.union([triageStatusSchema, z.literal("unknown")]);
export const triageOwnerRoleSchema = z.enum([
  "clinical_governance",
  "content_owner",
  "engineering",
  "privacy",
  "unassigned",
]);
export const triageResolutionCodeSchema = z.enum([
  "content_corrected",
  "source_updated",
  "retrieval_retested",
  "not_reproducible",
  "expected_behaviour",
  "duplicate",
  "not_applicable",
]);
export const qualitySignalTypeSchema = z.enum([
  "answer_feedback",
  "unsupported_claim",
  "source_conflict",
  "retrieval_failure",
  "evaluation_failure",
]);

export const evidenceBandSchema = z
  .object({
    state: evidenceStateSchema,
    asOf: z.iso.datetime({ offset: true }).nullable(),
    source: z.string().trim().min(1).max(160),
    note: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

const nullableCountSchema = z.number().int().nonnegative().nullable();

export const contentMaturityInputSchema = z
  .object({
    area: clinicalQualityAreaSchema,
    total: z.number().int().nonnegative(),
    implemented: nullableCountSchema,
    clinicalReviewed: nullableCountSchema,
    clinicalOverdue: nullableCountSchema,
    sourceSupported: nullableCountSchema,
    sourcePartiallySupported: nullableCountSchema,
    sourceCurrent: nullableCountSchema,
    sourceReviewDue: nullableCountSchema,
    sourceOverdue: nullableCountSchema,
    asOf: z.iso.datetime({ offset: true }).nullable(),
    evidenceSource: z.string().trim().min(1).max(160),
  })
  .strict();

export const contentMaturityBandSchema = z
  .object({
    area: clinicalQualityAreaSchema,
    label: z.string().trim().min(1),
    total: z.number().int().nonnegative(),
    implementation: z.object({ available: nullableCountSchema }).strict(),
    clinicalReview: z
      .object({
        reviewed: nullableCountSchema,
        pending: nullableCountSchema,
        overdue: nullableCountSchema,
        unknown: nullableCountSchema,
      })
      .strict(),
    sourceSupport: z
      .object({ supported: nullableCountSchema, partial: nullableCountSchema, unknown: nullableCountSchema })
      .strict(),
    sourceCurrency: z
      .object({
        current: nullableCountSchema,
        reviewDue: nullableCountSchema,
        overdue: nullableCountSchema,
        unknown: nullableCountSchema,
      })
      .strict(),
    evidence: evidenceBandSchema,
  })
  .strict();

export const ragAnswerFeedbackRowSchema = z
  .object({
    id: z.string().uuid(),
    interaction_id: z.string().uuid(),
    answer_hash: z.string().trim().min(1).max(256),
    feedback_category: z.enum(answerFeedbackTypes),
    source_ids: z.array(z.string().trim().min(1).max(160)).max(80),
    cited_source_ids: z.array(z.string().trim().min(1).max(160)).max(80),
    created_at: z.iso.datetime({ offset: true }),
    // Which page the report came from, and the reader's optional note (administrators only;
    // the note is cleared after 30 days and never enters the weekly summary).
    record_type: z.enum(feedbackRecordTypes).default("answer"),
    record_id: z.string().regex(feedbackRecordIdPattern).nullable().default(null),
    note: z.string().max(ANSWER_FEEDBACK_NOTE_MAX_LENGTH).nullable().default(null),
  })
  .strict();

export const clinicalQualityTriageRowSchema = z
  .object({
    signal_type: qualitySignalTypeSchema,
    signal_id: z.string().uuid(),
    status: triageStatusSchema,
    owner_role: triageOwnerRoleSchema,
    owner_user_id: z.string().uuid().nullable(),
    resolution_code: triageResolutionCodeSchema.nullable(),
    retest_reference: z.string().max(120),
    updated_by: z.string().uuid(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
    resolved_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const sourceReviewEventRowSchema = z
  .object({
    id: z.string().uuid(),
    document_id: z.string().uuid(),
    decision: z.string().trim().min(1).max(80),
    new_document_status: z.string().trim().min(1).max(80),
    new_validation_status: z.string().trim().min(1).max(80),
    replacement_document_id: z.string().uuid().nullable(),
    review_date: z.string().date().nullable(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const clinicalRegistryLinkRowSchema = z
  .object({ document_id: z.string().uuid(), record_id: z.string().uuid() })
  .strict();

export const clinicalRegistryRecordAreaRowSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.string().trim().min(1).max(80),
    route: z.string().trim().max(300).nullable(),
  })
  .strict();

export const retrievalReachRowSchema = z
  .object({
    id: z.string().uuid(),
    created_at: z.iso.datetime({ offset: true }),
    selected_document_ids: z.array(z.string().uuid()).max(80),
    is_miss: z.boolean(),
    miss_reason: z.string().trim().max(120).nullable(),
  })
  .strict();

export const visualEvalFailureRowSchema = z
  .object({
    id: z.string().uuid(),
    case_id: z.string().uuid(),
    document_id: z.string().uuid().nullable(),
    passed: z.boolean(),
    top_hit: z.boolean(),
    matched_count: z.number().int().nonnegative(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const documentChunkMapRowSchema = z
  .object({
    id: z.string().uuid(),
    document_id: z.string().uuid(),
  })
  .strict();

export const qualityQueueItemSchema = z
  .object({
    signalType: qualitySignalTypeSchema,
    signalId: z.string().uuid(),
    category: z.string(),
    feedbackId: z.string().uuid().nullable(),
    interactionId: z.string().uuid().nullable(),
    answerHash: z.string().nullable(),
    recordType: z.enum(feedbackRecordTypes).nullable().default(null),
    recordId: z.string().nullable().default(null),
    note: z.string().max(ANSWER_FEEDBACK_NOTE_MAX_LENGTH).nullable().default(null),
    documentIds: z.array(z.string().uuid()),
    createdAt: z.iso.datetime({ offset: true }),
    priority: z.enum(["high", "medium", "routine"]),
    triage: z
      .object({
        status: triageDisplayStatusSchema,
        ownerRole: triageOwnerRoleSchema,
        ownerUserId: z.string().uuid().nullable(),
        resolutionCode: triageResolutionCodeSchema.nullable(),
        retestReference: z.string().max(120),
        updatedBy: z.string().uuid().nullable(),
        updatedAt: z.iso.datetime({ offset: true }).nullable(),
      })
      .strict(),
  })
  .strict();

export const sourceImpactItemSchema = z
  .object({
    documentId: z.string().uuid(),
    decision: z.string(),
    documentStatus: z.string(),
    validationStatus: z.string(),
    replacementDocumentId: z.string().uuid().nullable(),
    reviewDate: z.string().date().nullable(),
    registryLinkCount: z.number().int().nonnegative(),
    retrievalReach: z.number().int().nonnegative(),
    feedbackReach: z.number().int().nonnegative(),
    affectedAreas: z.array(clinicalQualityAreaSchema),
    priority: z.enum(["critical", "high", "medium", "low", "sampled"]),
  })
  .strict();

export const clinicalQualitySnapshotSchema = z
  .object({
    version: z.literal(clinicalQualitySnapshotVersion),
    generatedAt: z.iso.datetime({ offset: true }),
    state: evidenceStateSchema,
    qualityQueue: z.object({ evidence: evidenceBandSchema, items: z.array(qualityQueueItemSchema) }).strict(),
    sourceImpact: z.object({ evidence: evidenceBandSchema, items: z.array(sourceImpactItemSchema) }).strict(),
    contentMaturity: z
      .object({ evidence: evidenceBandSchema, bands: z.array(contentMaturityBandSchema).length(6) })
      .strict(),
  })
  .strict();

export const clinicalQualityTriageResponseSchema = z
  .object({ version: z.literal(clinicalQualitySnapshotVersion), triage: clinicalQualityTriageRowSchema })
  .strict();

export const clinicalQualityTriageMutationSchema = z
  .object({
    signalType: qualitySignalTypeSchema,
    signalId: z.string().uuid(),
    status: triageStatusSchema,
    ownerRole: triageOwnerRoleSchema,
    ownerUserId: z.string().uuid().nullable().default(null),
    resolutionCode: triageResolutionCodeSchema.nullable().default(null),
    retestReference: z.string().trim().max(120).default(""),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "resolved" && !value.resolutionCode) {
      context.addIssue({
        code: "custom",
        path: ["resolutionCode"],
        message: "Resolved feedback needs a resolution code.",
      });
    }
    if (value.status === "awaiting_retest" && !value.retestReference) {
      context.addIssue({
        code: "custom",
        path: ["retestReference"],
        message: "Awaiting retest needs a retest reference.",
      });
    }
  });

export type ClinicalQualitySnapshot = z.infer<typeof clinicalQualitySnapshotSchema>;
export type ContentMaturityInput = z.infer<typeof contentMaturityInputSchema>;

const areaLabels: Record<z.infer<typeof clinicalQualityAreaSchema>, string> = {
  dictionary: "Dictionary",
  services: "Services",
  forms: "Forms",
  therapies: "Therapies",
  differentials: "Differential Diagnosis",
  specifiers: "Specifiers",
};

function remainder(total: number, values: Array<number | null>) {
  if (values.some((value) => value === null)) return null;
  return Math.max(0, total - values.reduce<number>((sum, value) => sum + (value ?? 0), 0));
}

export function projectContentMaturity(input: readonly ContentMaturityInput[]) {
  const parsed = z.array(contentMaturityInputSchema).length(6).parse(input);
  const byArea = new Map(parsed.map((entry) => [entry.area, entry]));
  return clinicalQualityAreaSchema.options.map((area) => {
    const entry = byArea.get(area);
    if (!entry) throw new Error(`Missing content maturity area: ${area}`);
    const clinicalPending = remainder(entry.total, [entry.clinicalReviewed, entry.clinicalOverdue]);
    const sourceUnknown = remainder(entry.total, [entry.sourceSupported, entry.sourcePartiallySupported]);
    const currencyUnknown = remainder(entry.total, [entry.sourceCurrent, entry.sourceReviewDue, entry.sourceOverdue]);
    const hasUnknown = [
      entry.implemented,
      entry.clinicalReviewed,
      entry.clinicalOverdue,
      entry.sourceSupported,
      entry.sourcePartiallySupported,
      entry.sourceCurrent,
      entry.sourceReviewDue,
      entry.sourceOverdue,
    ].some((value) => value === null);
    return contentMaturityBandSchema.parse({
      area,
      label: areaLabels[area],
      total: entry.total,
      implementation: { available: entry.implemented },
      clinicalReview: {
        reviewed: entry.clinicalReviewed,
        pending: clinicalPending,
        overdue: entry.clinicalOverdue,
        unknown: clinicalPending === null ? entry.total : 0,
      },
      sourceSupport: {
        supported: entry.sourceSupported,
        partial: entry.sourcePartiallySupported,
        unknown: sourceUnknown === null ? entry.total : sourceUnknown,
      },
      sourceCurrency: {
        current: entry.sourceCurrent,
        reviewDue: entry.sourceReviewDue,
        overdue: entry.sourceOverdue,
        unknown: currencyUnknown === null ? entry.total : currencyUnknown,
      },
      evidence: {
        state: hasUnknown ? "partial" : "complete",
        asOf: entry.asOf,
        source: entry.evidenceSource,
        ...(hasUnknown
          ? { note: "At least one maturity dimension is unavailable; unknown is not treated as zero." }
          : {}),
      },
    });
  });
}

function qualityPriority(category: string): "high" | "medium" | "routine" {
  if (/unsupported|numeric|outdated|wrong_source|missing_source/i.test(category)) return "high";
  if (/correction|insufficient|needs_fixing|miss|conflict/i.test(category)) return "medium";
  return "routine";
}

export function qualitySignalTypeForFeedback(category: string): z.infer<typeof qualitySignalTypeSchema> {
  if (/wrong_source|source_conflict|conflict/i.test(category)) return "source_conflict";
  if (/unsupported|source_insufficient|numeric_error|outdated_guidance|missing_source/i.test(category))
    return "unsupported_claim";
  return "answer_feedback";
}

export function projectQualityQueue(args: {
  feedbackRows: readonly z.infer<typeof ragAnswerFeedbackRowSchema>[];
  retrievalRows: readonly z.infer<typeof retrievalReachRowSchema>[];
  evaluationRows: readonly z.infer<typeof visualEvalFailureRowSchema>[];
  triageRows: readonly z.infer<typeof clinicalQualityTriageRowSchema>[];
  chunkDocumentRows?: readonly z.infer<typeof documentChunkMapRowSchema>[];
  triageState: z.infer<typeof evidenceStateSchema>;
}) {
  const feedback = z.array(ragAnswerFeedbackRowSchema).parse(args.feedbackRows);
  const retrieval = z.array(retrievalReachRowSchema).parse(args.retrievalRows);
  const evaluations = z.array(visualEvalFailureRowSchema).parse(args.evaluationRows);
  const triage = z.array(clinicalQualityTriageRowSchema).parse(args.triageRows);
  const chunkDocuments = z.array(documentChunkMapRowSchema).parse(args.chunkDocumentRows ?? []);
  const documentByChunkId = new Map(chunkDocuments.map((row) => [row.id, row.document_id]));
  const resolveDocumentIds = (sourceIds: readonly string[]) =>
    Array.from(
      new Set(
        sourceIds.map((sourceId) => documentByChunkId.get(sourceId)).filter((value): value is string => Boolean(value)),
      ),
    );
  const triageBySignal = new Map(triage.map((row) => [`${row.signal_type}:${row.signal_id}`, row]));
  const withTriage = (signalType: z.infer<typeof qualitySignalTypeSchema>, signalId: string) => {
    const workflow = triageBySignal.get(`${signalType}:${signalId}`);
    return workflow
      ? {
          status: workflow.status,
          ownerRole: workflow.owner_role,
          ownerUserId: workflow.owner_user_id,
          resolutionCode: workflow.resolution_code,
          retestReference: workflow.retest_reference,
          updatedBy: workflow.updated_by,
          updatedAt: workflow.updated_at,
        }
      : {
          status: args.triageState === "complete" ? ("untriaged" as const) : ("unknown" as const),
          ownerRole: "unassigned" as const,
          ownerUserId: null,
          resolutionCode: null,
          retestReference: "",
          updatedBy: null,
          updatedAt: null,
        };
  };
  const feedbackItems = feedback.map((row) => {
    const signalType = qualitySignalTypeForFeedback(row.feedback_category);
    return qualityQueueItemSchema.parse({
      signalType,
      signalId: row.id,
      category: row.feedback_category,
      feedbackId: row.id,
      interactionId: row.interaction_id,
      answerHash: row.answer_hash,
      recordType: row.record_type,
      recordId: row.record_id,
      note: row.note,
      documentIds: resolveDocumentIds([...row.source_ids, ...row.cited_source_ids]),
      createdAt: row.created_at,
      priority: qualityPriority(row.feedback_category),
      triage: withTriage(signalType, row.id),
    });
  });
  const retrievalItems = retrieval
    .filter((row) => row.is_miss)
    .map((row) =>
      qualityQueueItemSchema.parse({
        signalType: "retrieval_failure",
        signalId: row.id,
        category: row.miss_reason || "retrieval_miss",
        feedbackId: null,
        interactionId: null,
        answerHash: null,
        documentIds: row.selected_document_ids,
        createdAt: row.created_at,
        priority: /error|failed|timeout|unavailable/i.test(row.miss_reason ?? "") ? "high" : "medium",
        triage: withTriage("retrieval_failure", row.id),
      }),
    );
  const evaluationItems = evaluations
    .filter((row) => !row.passed)
    .map((row) =>
      qualityQueueItemSchema.parse({
        signalType: "evaluation_failure",
        signalId: row.id,
        category: row.top_hit ? "visual_eval_match_failure" : "visual_eval_top_hit_failure",
        feedbackId: null,
        interactionId: null,
        answerHash: null,
        documentIds: row.document_id ? [row.document_id] : [],
        createdAt: row.created_at,
        priority: row.top_hit ? "medium" : "high",
        triage: withTriage("evaluation_failure", row.id),
      }),
    );
  const projectedItems = [...feedbackItems, ...retrievalItems, ...evaluationItems];
  const projectedSignals = new Set(projectedItems.map((item) => `${item.signalType}:${item.signalId}`));
  const orphanedActiveTriageItems = triage
    .filter((row) => !["resolved", "dismissed"].includes(row.status))
    .filter((row) => !projectedSignals.has(`${row.signal_type}:${row.signal_id}`))
    .map((row) =>
      qualityQueueItemSchema.parse({
        signalType: row.signal_type,
        signalId: row.signal_id,
        category: "source_signal_unavailable",
        feedbackId: null,
        interactionId: null,
        answerHash: null,
        documentIds: [],
        createdAt: row.created_at,
        priority: "high",
        triage: withTriage(row.signal_type, row.signal_id),
      }),
    );
  return [...projectedItems, ...orphanedActiveTriageItems].sort((left, right) => {
    const weight = { high: 0, medium: 1, routine: 2 } as const;
    return weight[left.priority] - weight[right.priority] || right.createdAt.localeCompare(left.createdAt);
  });
}

function areaFromRegistryRecord(row: z.infer<typeof clinicalRegistryRecordAreaRowSchema>) {
  const value = `${row.kind} ${row.route ?? ""}`.toLowerCase();
  const aliases: Record<z.infer<typeof clinicalQualityAreaSchema>, readonly string[]> = {
    dictionary: ["dictionary"],
    services: ["service", "services"],
    forms: ["form", "forms"],
    therapies: ["therapy", "therapies"],
    differentials: ["differential", "differentials"],
    specifiers: ["specifier", "specifiers"],
  };
  return clinicalQualityAreaSchema.options.find((area) => aliases[area].some((alias) => value.includes(alias))) ?? null;
}

function sourcePriority(args: {
  decision: string;
  status: string;
  validation: string;
  retrieval: number;
  feedback: number;
}) {
  const highClinicalImpact = /supersed|reject|withdraw|invalid|outdated/i.test(
    `${args.decision} ${args.status} ${args.validation}`,
  );
  const reviewNeeded = /pending|review|due|unverified/i.test(`${args.decision} ${args.status} ${args.validation}`);
  if (highClinicalImpact && (args.retrieval > 0 || args.feedback > 0)) return "critical" as const;
  if (highClinicalImpact || args.feedback >= 3 || args.retrieval >= 25) return "high" as const;
  if (reviewNeeded || args.feedback > 0 || args.retrieval > 0) return "medium" as const;
  return "low" as const;
}

export function projectSourceImpact(args: {
  sourceReviews: readonly z.infer<typeof sourceReviewEventRowSchema>[];
  registryLinks: readonly z.infer<typeof clinicalRegistryLinkRowSchema>[];
  registryRecords: readonly z.infer<typeof clinicalRegistryRecordAreaRowSchema>[];
  retrievalLogs: readonly z.infer<typeof retrievalReachRowSchema>[];
  feedbackRows: readonly z.infer<typeof ragAnswerFeedbackRowSchema>[];
  chunkDocumentRows?: readonly z.infer<typeof documentChunkMapRowSchema>[];
  sampled?: boolean;
}) {
  const reviews = z.array(sourceReviewEventRowSchema).parse(args.sourceReviews);
  const links = z.array(clinicalRegistryLinkRowSchema).parse(args.registryLinks);
  const records = z.array(clinicalRegistryRecordAreaRowSchema).parse(args.registryRecords);
  const retrieval = z.array(retrievalReachRowSchema).parse(args.retrievalLogs);
  const feedback = z.array(ragAnswerFeedbackRowSchema).parse(args.feedbackRows);
  const chunkDocuments = z.array(documentChunkMapRowSchema).parse(args.chunkDocumentRows ?? []);
  const documentByChunkId = new Map(chunkDocuments.map((row) => [row.id, row.document_id]));
  const recordById = new Map(records.map((row) => [row.id, row]));
  const latestByDocument = new Map<string, z.infer<typeof sourceReviewEventRowSchema>>();
  for (const review of reviews) {
    const current = latestByDocument.get(review.document_id);
    if (!current || Date.parse(review.created_at) > Date.parse(current.created_at)) {
      latestByDocument.set(review.document_id, review);
    }
  }
  return [...latestByDocument.values()]
    .map((review) => {
      const documentLinks = links.filter((link) => link.document_id === review.document_id);
      const retrievalReach = retrieval.filter((row) => row.selected_document_ids.includes(review.document_id)).length;
      const feedbackReach = feedback.filter((row) =>
        [...row.source_ids, ...row.cited_source_ids].some(
          (sourceId) => documentByChunkId.get(sourceId) === review.document_id,
        ),
      ).length;
      const affectedAreas = Array.from(
        new Set(
          documentLinks
            .map((link) => recordById.get(link.record_id))
            .filter((row): row is z.infer<typeof clinicalRegistryRecordAreaRowSchema> => Boolean(row))
            .map(areaFromRegistryRecord)
            .filter((area): area is z.infer<typeof clinicalQualityAreaSchema> => Boolean(area)),
        ),
      );
      return sourceImpactItemSchema.parse({
        documentId: review.document_id,
        decision: review.decision,
        documentStatus: review.new_document_status,
        validationStatus: review.new_validation_status,
        replacementDocumentId: review.replacement_document_id,
        reviewDate: review.review_date,
        registryLinkCount: documentLinks.length,
        retrievalReach,
        feedbackReach,
        affectedAreas,
        priority: args.sampled
          ? "sampled"
          : sourcePriority({
              decision: review.decision,
              status: review.new_document_status,
              validation: review.new_validation_status,
              retrieval: retrievalReach,
              feedback: feedbackReach,
            }),
      });
    })
    .sort((left, right) => {
      const weight = { critical: 0, high: 1, medium: 2, low: 3, sampled: 4 } as const;
      return (
        weight[left.priority] - weight[right.priority] ||
        right.feedbackReach - left.feedbackReach ||
        right.retrievalReach - left.retrievalReach
      );
    });
}
