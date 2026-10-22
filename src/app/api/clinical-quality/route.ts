import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import {
  clinicalQualitySnapshotSchema,
  clinicalQualityTriageMutationSchema,
  clinicalQualityTriageResponseSchema,
  clinicalQualityTriageRowSchema,
  clinicalRegistryLinkRowSchema,
  clinicalRegistryRecordAreaRowSchema,
  contentMaturityInputSchema,
  documentChunkMapRowSchema,
  projectContentMaturity,
  projectQualityQueue,
  projectSourceImpact,
  qualitySignalTypeForFeedback,
  ragAnswerFeedbackRowSchema,
  retrievalReachRowSchema,
  sourceReviewEventRowSchema,
  visualEvalFailureRowSchema,
} from "@/lib/clinical-quality-dashboard";
import { dictionaryEntries } from "@/lib/dictionary-data";
import { loadDifferentialSnapshot } from "@/lib/differential-fixtures";
import { formRecords } from "@/lib/forms";
import { serviceRecords } from "@/lib/services";
import { specifierIndexItems, specifierVerifiedCount } from "@/lib/specifiers-search-index";
import { therapyRecords } from "@/lib/therapies";
import { jsonError, PublicApiError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

type QueryResult = { data: unknown; error: { message?: string } | null };

async function readRows<T>(query: PromiseLike<QueryResult>, schema: z.ZodType<T>, maximumRows?: number) {
  const result = await query;
  if (result.error) return { rows: [] as T[], state: "unknown" as const, error: result.error.message ?? "read failed" };
  const parsed = z.array(schema).safeParse(result.data ?? []);
  if (!parsed.success) return { rows: [] as T[], state: "unknown" as const, error: "invalid row shape" };
  const sampled = maximumRows !== undefined && parsed.data.length > maximumRows;
  return {
    rows: sampled ? parsed.data.slice(0, maximumRows) : parsed.data,
    state: sampled ? ("partial" as const) : ("complete" as const),
    error: sampled ? `sampled at ${maximumRows} rows` : null,
  };
}

async function readRowsByIds<T>(
  ids: readonly string[],
  queryForIds: (batchIds: string[]) => PromiseLike<QueryResult>,
  schema: z.ZodType<T>,
) {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return { rows: [] as T[], state: "complete" as const, error: null };
  const batches = Array.from({ length: Math.ceil(uniqueIds.length / 100) }, (_, index) =>
    uniqueIds.slice(index * 100, index * 100 + 100),
  );
  const results = await Promise.all(batches.map((batchIds) => readRows(queryForIds(batchIds), schema)));
  return {
    rows: results.flatMap((result) => result.rows),
    state: results.every((result) => result.state === "complete") ? ("complete" as const) : ("unknown" as const),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

function mergeRowsById<T extends { id: string }>(...rowSets: readonly T[][]) {
  return Array.from(new Map(rowSets.flat().map((row) => [row.id, row])).values());
}

const repositoryCatalogueEvidenceAsOf = "2026-08-23T00:00:00.000Z";

function staticMaturity(nowIso: string) {
  const differentialSnapshot = loadDifferentialSnapshot();
  const differentialTotal = differentialSnapshot.presentations.length + differentialSnapshot.diagnoses.length;
  const therapyReviewed = therapyRecords.filter((record) => record.reviewStatus === "reviewed").length;
  const dictionaryCurrent = dictionaryEntries.filter(
    (entry) => Date.parse(entry.review.dueOn) > Date.parse(nowIso),
  ).length;
  const sourceCounts = (records: typeof serviceRecords) => {
    const supported = records.filter((record) => Boolean(record.source?.url?.trim())).length;
    const partial = records.filter(
      (record) => !record.source?.url?.trim() && Boolean(record.source?.label?.trim() || record.source?.status?.trim()),
    ).length;
    return { supported, partial };
  };
  const serviceSources = sourceCounts(serviceRecords);
  const formSources = sourceCounts(formRecords);

  return z
    .array(contentMaturityInputSchema)
    .length(6)
    .parse([
      {
        area: "dictionary",
        total: dictionaryEntries.length,
        implemented: dictionaryEntries.length,
        clinicalReviewed: 0,
        clinicalOverdue: 0,
        sourceSupported: dictionaryEntries.length,
        sourcePartiallySupported: 0,
        sourceCurrent: dictionaryCurrent,
        sourceReviewDue: 0,
        sourceOverdue: dictionaryEntries.length - dictionaryCurrent,
        asOf: repositoryCatalogueEvidenceAsOf,
        evidenceSource: "repository:src/lib/dictionary-data.ts",
      },
      {
        area: "services",
        total: serviceRecords.length,
        implemented: serviceRecords.length,
        clinicalReviewed: null,
        clinicalOverdue: null,
        sourceSupported: serviceSources.supported,
        sourcePartiallySupported: serviceSources.partial,
        sourceCurrent: null,
        sourceReviewDue: null,
        sourceOverdue: null,
        asOf: repositoryCatalogueEvidenceAsOf,
        evidenceSource: "repository:data/services-snapshot.json",
      },
      {
        area: "forms",
        total: formRecords.length,
        implemented: formRecords.length,
        clinicalReviewed: null,
        clinicalOverdue: null,
        sourceSupported: formSources.supported,
        sourcePartiallySupported: formSources.partial,
        sourceCurrent: null,
        sourceReviewDue: null,
        sourceOverdue: null,
        asOf: repositoryCatalogueEvidenceAsOf,
        evidenceSource: "repository:data/forms-catalog.json",
      },
      {
        area: "therapies",
        total: therapyRecords.length,
        implemented: therapyRecords.length,
        clinicalReviewed: therapyReviewed,
        clinicalOverdue: null,
        sourceSupported: null,
        sourcePartiallySupported: null,
        sourceCurrent: null,
        sourceReviewDue: null,
        sourceOverdue: null,
        asOf: repositoryCatalogueEvidenceAsOf,
        evidenceSource: "repository:src/data/therapies-index.json",
      },
      {
        area: "differentials",
        total: differentialTotal,
        implemented: differentialTotal,
        clinicalReviewed: /reviewed|approved/i.test(differentialSnapshot.governance.reviewStatus)
          ? differentialTotal
          : 0,
        clinicalOverdue: null,
        sourceSupported: differentialSnapshot.governance.sourceTitle ? differentialTotal : 0,
        sourcePartiallySupported: 0,
        sourceCurrent: null,
        sourceReviewDue: null,
        sourceOverdue: null,
        asOf: repositoryCatalogueEvidenceAsOf,
        evidenceSource: "repository:data/differentials-snapshot.json",
      },
      {
        area: "specifiers",
        total: specifierIndexItems.length,
        implemented: specifierIndexItems.length,
        clinicalReviewed: 0,
        clinicalOverdue: null,
        sourceSupported: specifierVerifiedCount,
        sourcePartiallySupported: specifierIndexItems.length - specifierVerifiedCount,
        sourceCurrent: null,
        sourceReviewDue: null,
        sourceOverdue: null,
        asOf: repositoryCatalogueEvidenceAsOf,
        evidenceSource: "repository:data/specifiers-search-index.json",
      },
    ]);
}

async function loadClinicalQualitySnapshot(supabase: ReturnType<typeof createAdminClient>) {
  const generatedAt = new Date().toISOString();
  const reachSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const triage = await readRows(
    supabase
      .from("clinical_quality_feedback_triage")
      .select(
        "signal_type,signal_id,status,owner_role,owner_user_id,resolution_code,retest_reference,updated_by,created_at,updated_at,resolved_at",
      )
      .order("updated_at", { ascending: false })
      .limit(1001),
    clinicalQualityTriageRowSchema,
    1000,
  );
  const activeTriage = triage.rows.filter((row) => !["resolved", "dismissed"].includes(row.status));
  const activeFeedbackIds = activeTriage
    .filter((row) => ["answer_feedback", "unsupported_claim", "source_conflict"].includes(row.signal_type))
    .map((row) => row.signal_id);
  const activeRetrievalIds = activeTriage
    .filter((row) => row.signal_type === "retrieval_failure")
    .map((row) => row.signal_id);
  const activeEvaluationIds = activeTriage
    .filter((row) => row.signal_type === "evaluation_failure")
    .map((row) => row.signal_id);

  const recentFeedback = await readRows(
    supabase
      .from("rag_answer_feedback")
      .select(
        "id,interaction_id,answer_hash,feedback_category,source_ids,cited_source_ids,created_at,record_type,record_id,note",
      )
      .gte("created_at", reachSince)
      .order("created_at", { ascending: false })
      .limit(101),
    ragAnswerFeedbackRowSchema,
    100,
  );
  const [
    reviews,
    links,
    records,
    recentRetrieval,
    recentEvaluations,
    activeFeedback,
    activeRetrieval,
    activeEvaluations,
  ] = await Promise.all([
    readRows(
      supabase
        .from("source_review_events")
        .select(
          "id,document_id,decision,new_document_status,new_validation_status,replacement_document_id,review_date,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(201),
      sourceReviewEventRowSchema,
      200,
    ),
    readRows(
      supabase.from("clinical_registry_record_sources").select("document_id,record_id").limit(2001),
      clinicalRegistryLinkRowSchema,
      2000,
    ),
    readRows(
      supabase.from("clinical_registry_records").select("id,kind,route").limit(2001),
      clinicalRegistryRecordAreaRowSchema,
      2000,
    ),
    readRows(
      supabase
        .from("rag_retrieval_logs")
        .select("id,created_at,selected_document_ids,is_miss,miss_reason")
        .gte("created_at", reachSince)
        .order("created_at", { ascending: false })
        .limit(501),
      retrievalReachRowSchema,
      500,
    ),
    readRows(
      supabase
        .from("rag_visual_eval_runs")
        .select("id,case_id,document_id,passed,top_hit,matched_count,created_at")
        .eq("passed", false)
        .order("created_at", { ascending: false })
        .limit(201),
      visualEvalFailureRowSchema,
      200,
    ),
    readRowsByIds(
      activeFeedbackIds,
      (ids) =>
        supabase
          .from("rag_answer_feedback")
          .select(
            "id,interaction_id,answer_hash,feedback_category,source_ids,cited_source_ids,created_at,record_type,record_id,note",
          )
          .in("id", ids),
      ragAnswerFeedbackRowSchema,
    ),
    readRowsByIds(
      activeRetrievalIds,
      (ids) =>
        supabase
          .from("rag_retrieval_logs")
          .select("id,created_at,selected_document_ids,is_miss,miss_reason")
          .in("id", ids),
      retrievalReachRowSchema,
    ),
    readRowsByIds(
      activeEvaluationIds,
      (ids) =>
        supabase
          .from("rag_visual_eval_runs")
          .select("id,case_id,document_id,passed,top_hit,matched_count,created_at")
          .in("id", ids),
      visualEvalFailureRowSchema,
    ),
  ]);

  const feedbackRows = mergeRowsById(recentFeedback.rows, activeFeedback.rows);
  const retrievalRows = mergeRowsById(recentRetrieval.rows, activeRetrieval.rows);
  const evaluationRows = mergeRowsById(recentEvaluations.rows, activeEvaluations.rows);
  const chunkDocuments = await readRowsByIds(
    feedbackRows.flatMap((row) => [...row.source_ids, ...row.cited_source_ids]),
    (ids) => supabase.from("document_chunks").select("id,document_id").in("id", ids),
    documentChunkMapRowSchema,
  );
  const availableSignals = new Set([
    ...feedbackRows.map((row) => `${qualitySignalTypeForFeedback(row.feedback_category)}:${row.id}`),
    ...retrievalRows.filter((row) => row.is_miss).map((row) => `retrieval_failure:${row.id}`),
    ...evaluationRows.filter((row) => !row.passed).map((row) => `evaluation_failure:${row.id}`),
  ]);
  const hasUnhydratedActiveTriage = activeTriage.some(
    (row) => !availableSignals.has(`${row.signal_type}:${row.signal_id}`),
  );

  const recentQualitySignalStates = [recentFeedback.state, recentRetrieval.state, recentEvaluations.state];
  const qualitySignalStates = [
    ...recentQualitySignalStates,
    activeFeedback.state,
    activeRetrieval.state,
    activeEvaluations.state,
    chunkDocuments.state,
  ];
  const qualityState =
    recentQualitySignalStates.every((state) => state === "unknown") && availableSignals.size === 0
      ? "unknown"
      : triage.state === "complete" &&
          qualitySignalStates.every((state) => state === "complete") &&
          !hasUnhydratedActiveTriage
        ? "complete"
        : "partial";
  const sourceStates = [
    reviews.state,
    links.state,
    records.state,
    recentRetrieval.state,
    recentFeedback.state,
    chunkDocuments.state,
  ];
  const sourceInputSampled = sourceStates.some((state) => state === "partial");
  const sourceState = sourceStates.some((state) => state === "unknown") ? "unknown" : "partial";
  const maturityBands = projectContentMaturity(staticMaturity(generatedAt));
  const maturityState = maturityBands.some((band) => band.evidence.state !== "complete") ? "partial" : "complete";
  // Overall trust cannot be complete while affected-area mapping covers only
  // Services and Forms, even when every currently queried input succeeds.
  const snapshotState = "partial" as const;

  return clinicalQualitySnapshotSchema.parse({
    version: "1",
    generatedAt,
    state: snapshotState,
    qualityQueue: {
      evidence: {
        state: qualityState,
        asOf: qualityState === "complete" ? generatedAt : null,
        source: "Supabase feedback + retrieval misses + visual eval failures + clinical quality triage",
        ...(qualityState !== "complete"
          ? {
              note:
                qualityState === "unknown"
                  ? "Workflow metadata or every quality-signal source is unavailable; no workflow state is inferred."
                  : "At least one quality-signal source reached its sampling cap or is unavailable; visible totals are not complete.",
            }
          : {}),
      },
      items:
        qualityState === "unknown"
          ? []
          : projectQualityQueue({
              feedbackRows,
              retrievalRows,
              evaluationRows,
              triageRows: triage.rows,
              chunkDocumentRows: chunkDocuments.rows,
              triageState: triage.state,
            }),
    },
    sourceImpact: {
      evidence: {
        state: sourceState,
        asOf: null,
        source: "Supabase source reviews + registry links + 30-day retrieval/feedback reach",
        note:
          sourceState === "unknown"
            ? "At least one impact input is unavailable; no impact priority is inferred. Claim text is not persisted."
            : sourceInputSampled
              ? "At least one impact input reached its sampling cap. Affected-area mapping currently covers Services and Forms; other areas remain unknown."
              : "Affected-area mapping currently covers Services and Forms; Dictionary, Therapies, Differentials and Specifiers remain unknown.",
      },
      items:
        sourceState !== "unknown"
          ? projectSourceImpact({
              sourceReviews: reviews.rows,
              registryLinks: links.rows,
              registryRecords: records.rows,
              retrievalLogs: recentRetrieval.rows,
              feedbackRows: recentFeedback.rows,
              chunkDocumentRows: chunkDocuments.rows,
              sampled: sourceInputSampled,
            })
          : [],
    },
    contentMaturity: {
      evidence: {
        state: maturityState,
        asOf: repositoryCatalogueEvidenceAsOf,
        source: "Versioned repository catalogues",
        note: "Static catalogue counts are repository evidence, not live hosted or clinical sign-off evidence.",
      },
      bands: maturityBands,
    },
  });
}

async function authorizeAndLimit(request: Request, supabase: ReturnType<typeof createAdminClient>) {
  const administrator = await requireAuthenticatedUser(request, supabase, { administrator: true });
  const rateLimit = await consumeApiRateLimit({
    supabase,
    ownerId: administrator.id,
    bucket: "ingestion_admin",
    allowInMemoryFallbackOnUnavailable: true,
  });
  return { administrator, rateLimit };
}

async function verifyQualitySignal(
  supabase: ReturnType<typeof createAdminClient>,
  signal: z.infer<typeof clinicalQualityTriageMutationSchema>,
) {
  const feedbackSignal = ["answer_feedback", "unsupported_claim", "source_conflict"].includes(signal.signalType);
  const result = feedbackSignal
    ? await readRows(
        supabase.from("rag_answer_feedback").select("id,feedback_category").eq("id", signal.signalId).limit(1),
        z.object({ id: z.string().uuid(), feedback_category: z.string().min(1).max(80) }).strict(),
      )
    : signal.signalType === "retrieval_failure"
      ? await readRows(
          supabase.from("rag_retrieval_logs").select("id,is_miss").eq("id", signal.signalId).limit(1),
          z.object({ id: z.string().uuid(), is_miss: z.literal(true) }).strict(),
        )
      : await readRows(
          supabase.from("rag_visual_eval_runs").select("id,passed").eq("id", signal.signalId).limit(1),
          z.object({ id: z.string().uuid(), passed: z.literal(false) }).strict(),
        );
  if (result.state !== "complete")
    throw new PublicApiError("Quality signal could not be verified.", 503, {
      code: "quality_signal_verification_unavailable",
    });
  if (result.rows.length !== 1)
    throw new PublicApiError("Quality signal not found.", 404, { code: "quality_signal_not_found" });
  if (
    feedbackSignal &&
    "feedback_category" in result.rows[0] &&
    qualitySignalTypeForFeedback(result.rows[0].feedback_category) !== signal.signalType
  ) {
    throw new PublicApiError("Quality signal type does not match its source.", 422, {
      code: "quality_signal_type_mismatch",
    });
  }
}

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient();
    const { rateLimit } = await authorizeAndLimit(request, supabase);
    if (rateLimit.limited)
      return rateLimitJsonResponse("Clinical quality requests are rate limited. Retry shortly.", rateLimit);
    const snapshot = await loadClinicalQualitySnapshot(supabase);
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse(error);
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = createAdminClient();
    const { administrator, rateLimit } = await authorizeAndLimit(request, supabase);
    if (rateLimit.limited)
      return rateLimitJsonResponse("Clinical quality requests are rate limited. Retry shortly.", rateLimit);
    const body = await parseJsonBody(
      request,
      clinicalQualityTriageMutationSchema,
      "Clinical quality triage payload is invalid.",
    );

    await verifyQualitySignal(supabase, body);

    const { data, error } = await supabase.rpc("record_clinical_quality_feedback_triage", {
      p_actor_user_id: administrator.id,
      p_signal_type: body.signalType,
      p_signal_id: body.signalId,
      p_status: body.status,
      p_owner_role: body.ownerRole,
      p_owner_user_id: body.ownerUserId,
      p_resolution_code: body.resolutionCode,
      p_retest_reference: body.retestReference,
    });
    if (error)
      throw new PublicApiError("Clinical quality triage could not be saved.", 503, { code: "triage_write_failed" });
    const triage = clinicalQualityTriageRowSchema.parse(data);
    return NextResponse.json(clinicalQualityTriageResponseSchema.parse({ version: "1", triage }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse(error);
    return jsonError(error);
  }
}
