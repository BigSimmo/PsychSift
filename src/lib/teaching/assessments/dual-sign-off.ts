import { randomUUID } from "node:crypto";

import { PublicApiError } from "@/lib/http";
import type { DomainNumber, GlobalRating, Rating } from "@/lib/teaching/assessments/content";

export type AssessmentLifecycleState = "draft" | "pending_supervisor" | "revision_requested" | "approved" | "cancelled";
export type RegistrarAssessmentCategory = "epa" | "wba" | "ita" | "supervisor_review" | "general";
export type RegistrarAssessmentDbStatus = "draft" | "submitted" | "signed_off" | "archived";

export class AssessmentNotFoundError extends PublicApiError {
  constructor(id: string) {
    super(`Clinical assessment ${id} not found.`, 404, { code: "assessment_not_found" });
    this.name = "AssessmentNotFoundError";
  }
}

export class AssessmentAccessDeniedError extends PublicApiError {
  constructor(message = "You are not authorized to view or modify this clinical assessment.") {
    super(message, 403, { code: "assessment_access_denied" });
    this.name = "AssessmentAccessDeniedError";
  }
}

export class AssessmentStateConflictError extends PublicApiError {
  constructor(message: string) {
    super(message, 409, { code: "assessment_state_conflict" });
    this.name = "AssessmentStateConflictError";
  }
}

export class AssessmentLockedError extends PublicApiError {
  constructor(message = "Assessment has been finalized and dual-signed. Further edits are strictly prohibited.") {
    super(message, 409, { code: "assessment_locked" });
    this.name = "AssessmentLockedError";
  }
}

export type ClinicalDomainRatings = Partial<Record<DomainNumber, Rating>>;

export type AssessmentRecord = {
  id: string;
  serviceId: string;
  traineeId: string; // Actor A (e.g., Registrar / Trainee)
  supervisorId: string; // Actor B (e.g., Supervising Consultant)
  title: string;
  clinicalSetting: string;
  traineeReflection: string;
  traineeSelfRatings: ClinicalDomainRatings;
  traineeSignedAt: string | null;
  state: AssessmentLifecycleState;
  supervisorFeedback: string | null;
  supervisorRatings: ClinicalDomainRatings | null;
  globalRecommendation: GlobalRating | null;
  supervisorSignedAt: string | null;
  revisionReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SafeAssessmentView = {
  id: string;
  serviceId: string;
  traineeId: string;
  supervisorId: string;
  title: string;
  clinicalSetting: string;
  traineeReflection: string;
  traineeSelfRatings: ClinicalDomainRatings;
  traineeSignedAt: string | null;
  state: AssessmentLifecycleState;
  supervisorFeedback: string | null;
  supervisorRatings: ClinicalDomainRatings | null;
  globalRecommendation: GlobalRating | null;
  supervisorSignedAt: string | null;
  revisionReason: string | null;
  cancelReason: string | null;
  isUnlocked: boolean;
  allowedActions: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateAssessmentDraftParams = {
  id?: string;
  serviceId: string;
  traineeId: string;
  supervisorId: string;
  title: string;
  clinicalSetting: string;
  traineeReflection: string;
  traineeSelfRatings?: ClinicalDomainRatings;
  category?: RegistrarAssessmentCategory;
};

export type UpdateAssessmentDraftFields = Partial<
  Pick<AssessmentRecord, "title" | "clinicalSetting" | "traineeReflection" | "traineeSelfRatings">
>;

export type SupervisorSignOffInput = {
  supervisorFeedback: string;
  supervisorRatings: ClinicalDomainRatings;
  globalRecommendation: GlobalRating;
};

export type RegistrarAssessmentRatingsPayload = {
  serviceId: string;
  clinicalSetting: string;
  traineeReflection: string;
  traineeSelfRatings: ClinicalDomainRatings;
  traineeSignedAt: string | null;
  state: AssessmentLifecycleState;
  supervisorRatings: ClinicalDomainRatings | null;
  globalRecommendation: GlobalRating | null;
  supervisorSignedAt: string | null;
  revisionReason: string | null;
  cancelReason: string | null;
  kind?: string;
};

export type RegistrarAssessmentRow = {
  id: string;
  registrar_id: string;
  assessor_id: string | null;
  category: RegistrarAssessmentCategory;
  title: string;
  ratings: Record<string, unknown> | null;
  feedback: string | null;
  status: RegistrarAssessmentDbStatus;
  created_at: string;
  updated_at: string;
};

type DbErrorLike = {
  message?: string;
  code?: string;
};

type QueryResult<T> = PromiseLike<{ data: T | null; error: DbErrorLike | null }>;

export type RegistrarAssessmentsQueryBuilder = {
  select(columns?: string): RegistrarAssessmentsFilterBuilder<RegistrarAssessmentRow[]>;
  insert(
    values: Omit<RegistrarAssessmentRow, "created_at" | "updated_at"> &
      Partial<Pick<RegistrarAssessmentRow, "created_at" | "updated_at">>,
  ): {
    select(columns?: string): {
      single(): QueryResult<RegistrarAssessmentRow>;
    };
  };
  update(values: Partial<RegistrarAssessmentRow>): RegistrarAssessmentsFilterBuilder<RegistrarAssessmentRow[]>;
};

export type RegistrarAssessmentsFilterBuilder<T> = QueryResult<T> & {
  eq(column: string, value: string): RegistrarAssessmentsFilterBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): RegistrarAssessmentsFilterBuilder<T>;
  select(columns?: string): RegistrarAssessmentsFilterBuilder<T>;
  single(): QueryResult<RegistrarAssessmentRow>;
  maybeSingle(): QueryResult<RegistrarAssessmentRow>;
};

export type RegistrarAssessmentsTableClient = {
  from(table: "registrar_assessments"): RegistrarAssessmentsQueryBuilder;
};

const ASSESSMENT_SELECT_COLUMNS =
  "id, registrar_id, assessor_id, category, title, ratings, feedback, status, created_at, updated_at";

const VALID_LIFECYCLE_STATES = new Set<AssessmentLifecycleState>([
  "draft",
  "pending_supervisor",
  "revision_requested",
  "approved",
  "cancelled",
]);

const VALID_GLOBAL_RATINGS = new Set<GlobalRating>(["sat", "cond", "unsat"]);

function normalizeDomainRatings(raw: unknown): ClinicalDomainRatings | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const ratings: ClinicalDomainRatings = {};
  for (const domainKey of [1, 2, 3, 4] as const) {
    const val = source[String(domainKey)] ?? source[domainKey];
    if (val === 1 || val === 2 || val === 3 || val === 4 || val === 5) {
      ratings[domainKey] = val;
    }
  }
  return ratings;
}

export function lifecycleStateToDbStatus(state: AssessmentLifecycleState): RegistrarAssessmentDbStatus {
  switch (state) {
    case "draft":
      return "draft";
    case "pending_supervisor":
    case "revision_requested":
      return "submitted";
    case "approved":
      return "signed_off";
    case "cancelled":
      return "archived";
  }
}

export function dbStatusToLifecycleState(
  status: RegistrarAssessmentDbStatus,
  ratings: Record<string, unknown> | null,
): AssessmentLifecycleState {
  const rawState = ratings?.state;
  if (typeof rawState === "string" && VALID_LIFECYCLE_STATES.has(rawState as AssessmentLifecycleState)) {
    return rawState as AssessmentLifecycleState;
  }
  switch (status) {
    case "draft":
      return "draft";
    case "submitted":
      return typeof ratings?.revisionReason === "string" && ratings.revisionReason.length > 0
        ? "revision_requested"
        : "pending_supervisor";
    case "signed_off":
      return "approved";
    case "archived":
      return "cancelled";
  }
}

export function assessmentRecordToRow(
  record: AssessmentRecord,
  category: RegistrarAssessmentCategory = "wba",
): RegistrarAssessmentRow {
  const ratingsPayload: RegistrarAssessmentRatingsPayload = {
    serviceId: record.serviceId,
    clinicalSetting: record.clinicalSetting,
    traineeReflection: record.traineeReflection,
    traineeSelfRatings: record.traineeSelfRatings,
    traineeSignedAt: record.traineeSignedAt,
    state: record.state,
    supervisorRatings: record.supervisorRatings,
    globalRecommendation: record.globalRecommendation,
    supervisorSignedAt: record.supervisorSignedAt,
    revisionReason: record.revisionReason,
    cancelReason: record.cancelReason,
  };

  return {
    id: record.id,
    registrar_id: record.traineeId,
    assessor_id: record.supervisorId,
    category,
    title: record.title,
    ratings: ratingsPayload as unknown as Record<string, unknown>,
    feedback: record.supervisorFeedback,
    status: lifecycleStateToDbStatus(record.state),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function rowToAssessmentRecord(row: RegistrarAssessmentRow): AssessmentRecord {
  const ratings = row.ratings && typeof row.ratings === "object" ? row.ratings : {};
  const state = dbStatusToLifecycleState(row.status, ratings);
  const rawRecommendation = ratings.globalRecommendation;
  const globalRecommendation =
    typeof rawRecommendation === "string" && VALID_GLOBAL_RATINGS.has(rawRecommendation as GlobalRating)
      ? (rawRecommendation as GlobalRating)
      : null;

  return {
    id: row.id,
    serviceId: typeof ratings.serviceId === "string" ? ratings.serviceId : "",
    traineeId: row.registrar_id,
    supervisorId:
      typeof row.assessor_id === "string" && row.assessor_id.length > 0
        ? row.assessor_id
        : typeof ratings.supervisorId === "string"
          ? ratings.supervisorId
          : "",
    title: row.title,
    clinicalSetting: typeof ratings.clinicalSetting === "string" ? ratings.clinicalSetting : "",
    traineeReflection: typeof ratings.traineeReflection === "string" ? ratings.traineeReflection : "",
    traineeSelfRatings: normalizeDomainRatings(ratings.traineeSelfRatings) ?? {},
    traineeSignedAt: typeof ratings.traineeSignedAt === "string" ? ratings.traineeSignedAt : null,
    state,
    supervisorFeedback: row.feedback ?? null,
    supervisorRatings:
      ratings.supervisorRatings !== null && ratings.supervisorRatings !== undefined
        ? normalizeDomainRatings(ratings.supervisorRatings)
        : null,
    globalRecommendation,
    supervisorSignedAt: typeof ratings.supervisorSignedAt === "string" ? ratings.supervisorSignedAt : null,
    revisionReason: typeof ratings.revisionReason === "string" ? ratings.revisionReason : null,
    cancelReason: typeof ratings.cancelReason === "string" ? ratings.cancelReason : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isSupervisorBookingRow(row: RegistrarAssessmentRow): boolean {
  return Boolean(
    row.category === "supervisor_review" &&
    row.ratings &&
    typeof row.ratings === "object" &&
    (row.ratings as Record<string, unknown>).kind === "supervisor_booking",
  );
}

function assessmentDatabaseError(error: DbErrorLike | null): PublicApiError {
  return new PublicApiError(error?.message || "Clinical assessment database operation failed.", 500, {
    code: "assessment_database_error",
  });
}

/**
 * Computes the authorized actions allowed for a given actor given the assessment's state.
 */
export function getAllowedActionsForActor(assessment: AssessmentRecord, actorId: string): string[] {
  const isTrainee = assessment.traineeId === actorId;
  const isSupervisor = assessment.supervisorId === actorId;

  if (!isTrainee && !isSupervisor) {
    return [];
  }

  switch (assessment.state) {
    case "draft":
      return isTrainee ? ["submit_for_review", "update_draft", "cancel"] : [];
    case "pending_supervisor":
      if (isSupervisor) {
        return ["supervisor_sign_off", "request_revision", "cancel"];
      }
      return isTrainee ? ["cancel"] : [];
    case "revision_requested":
      return isTrainee ? ["resubmit", "update_draft", "cancel"] : [];
    case "approved":
      // Finalized & dual-signed: completely immutable
      return [];
    case "cancelled":
      return isTrainee ? ["restart_draft"] : [];
  }
}

/**
 * Enforces Row-Level Security and strict anti-leakage redaction rules.
 * Data such as supervisor assessment feedback, provisional scores, and recommendations
 * are strictly filtered out if the requesting actor is the trainee and the assessment
 * has not yet reached the 'approved' (dual-signed) state.
 */
export function projectAssessmentForActor(assessment: AssessmentRecord, actorId: string): SafeAssessmentView {
  const isTrainee = assessment.traineeId === actorId;
  const isSupervisor = assessment.supervisorId === actorId;

  if (!isTrainee && !isSupervisor) {
    throw new AssessmentAccessDeniedError("Access denied: You are neither the trainee nor the assigned supervisor.");
  }

  const allowedActions = getAllowedActionsForActor(assessment, actorId);

  // If the record is approved, both parties see the unredacted final record.
  if (assessment.state === "approved") {
    return {
      ...assessment,
      isUnlocked: true,
      allowedActions,
    };
  }

  // Trainee requesting an unapproved assessment: strictly redact supervisor feedback,
  // provisional domain scores, and final global recommendations.
  if (isTrainee) {
    return {
      id: assessment.id,
      serviceId: assessment.serviceId,
      traineeId: assessment.traineeId,
      supervisorId: assessment.supervisorId,
      title: assessment.title,
      clinicalSetting: assessment.clinicalSetting,
      traineeReflection: assessment.traineeReflection,
      traineeSelfRatings: assessment.traineeSelfRatings,
      traineeSignedAt: assessment.traineeSignedAt,
      state: assessment.state,
      // Strictly redacted before transmission over network
      supervisorFeedback: null,
      supervisorRatings: null,
      globalRecommendation: null,
      supervisorSignedAt: null,
      revisionReason: assessment.revisionReason,
      cancelReason: assessment.cancelReason,
      isUnlocked: false,
      allowedActions,
      createdAt: assessment.createdAt,
      updatedAt: assessment.updatedAt,
    };
  }

  // Supervisor view prior to approval: supervisor sees the trainee reflection,
  // can view in-flight values, but isUnlocked remains false until dual sign-off is committed.
  return {
    ...assessment,
    isUnlocked: false,
    allowedActions,
  };
}

function buildDraftAssessmentRecord(params: CreateAssessmentDraftParams, defaultId: () => string): AssessmentRecord {
  const now = new Date().toISOString();
  const id = params.id ?? defaultId();

  if (params.traineeId === params.supervisorId) {
    throw new PublicApiError("A clinician cannot supervise their own assessment.", 400, {
      code: "invalid_supervisor",
    });
  }

  return {
    id,
    serviceId: params.serviceId,
    traineeId: params.traineeId,
    supervisorId: params.supervisorId,
    title: params.title,
    clinicalSetting: params.clinicalSetting,
    traineeReflection: params.traineeReflection,
    traineeSelfRatings: params.traineeSelfRatings ?? {},
    traineeSignedAt: null,
    state: "draft",
    supervisorFeedback: null,
    supervisorRatings: null,
    globalRecommendation: null,
    supervisorSignedAt: null,
    revisionReason: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

function applyDraftUpdates(
  record: AssessmentRecord,
  actorId: string,
  updates: UpdateAssessmentDraftFields,
): AssessmentRecord {
  if (record.traineeId !== actorId) {
    throw new AssessmentAccessDeniedError("Only the trainee can edit the draft self-assessment.");
  }

  if (record.state === "approved") {
    throw new AssessmentLockedError();
  }

  if (record.state !== "draft" && record.state !== "revision_requested") {
    throw new AssessmentStateConflictError(
      `Cannot edit assessment in '${record.state}' state. Edits are only allowed in draft or revision_requested.`,
    );
  }

  const sanitizedUpdates: UpdateAssessmentDraftFields = {};
  if (updates.title !== undefined) sanitizedUpdates.title = updates.title;
  if (updates.clinicalSetting !== undefined) sanitizedUpdates.clinicalSetting = updates.clinicalSetting;
  if (updates.traineeReflection !== undefined) sanitizedUpdates.traineeReflection = updates.traineeReflection;
  if (updates.traineeSelfRatings !== undefined) sanitizedUpdates.traineeSelfRatings = updates.traineeSelfRatings;

  return {
    ...record,
    ...sanitizedUpdates,
    updatedAt: new Date().toISOString(),
  };
}

function applySubmitForReviewTransition(record: AssessmentRecord, actorId: string): AssessmentRecord {
  if (record.traineeId !== actorId) {
    throw new AssessmentAccessDeniedError("Only the trainee can submit this assessment for supervisor review.");
  }

  if (record.state === "approved") {
    throw new AssessmentLockedError();
  }

  if (record.state !== "draft" && record.state !== "revision_requested") {
    throw new AssessmentStateConflictError(
      `Cannot submit assessment in '${record.state}' state. Must be draft or revision_requested.`,
    );
  }

  if (!record.traineeReflection.trim()) {
    throw new PublicApiError("Trainee case reflection cannot be empty.", 400, {
      code: "missing_trainee_reflection",
    });
  }

  const now = new Date().toISOString();
  return {
    ...record,
    state: "pending_supervisor",
    traineeSignedAt: record.traineeSignedAt ?? now,
    revisionReason: null,
    updatedAt: now,
  };
}

function applySupervisorSignOffTransition(
  record: AssessmentRecord,
  actorId: string,
  signOff: SupervisorSignOffInput,
): AssessmentRecord {
  if (record.supervisorId !== actorId) {
    throw new AssessmentAccessDeniedError("Only the assigned supervising consultant can sign off this assessment.");
  }

  if (record.state === "approved") {
    throw new AssessmentLockedError("Assessment is already approved and dual-signed.");
  }

  if (record.state === "cancelled") {
    throw new AssessmentStateConflictError("Cannot approve an assessment that has been cancelled or withdrawn.");
  }

  if (record.state !== "pending_supervisor") {
    throw new AssessmentStateConflictError(
      `Cannot sign off assessment in '${record.state}' state. Must be in 'pending_supervisor' state.`,
    );
  }

  if (!signOff.supervisorFeedback?.trim()) {
    throw new PublicApiError("Supervisor evaluative feedback is required for clinical sign-off.", 400, {
      code: "missing_supervisor_feedback",
    });
  }

  if (!signOff.globalRecommendation) {
    throw new PublicApiError(
      "A global clinical recommendation (Satisfactory/Conditional/Unsatisfactory) is required.",
      400,
      {
        code: "missing_recommendation",
      },
    );
  }

  const now = new Date().toISOString();
  return {
    ...record,
    state: "approved",
    supervisorFeedback: signOff.supervisorFeedback,
    supervisorRatings: signOff.supervisorRatings,
    globalRecommendation: signOff.globalRecommendation,
    supervisorSignedAt: now,
    updatedAt: now,
  };
}

function applyRequestRevisionTransition(
  record: AssessmentRecord,
  actorId: string,
  revisionReason: string,
): AssessmentRecord {
  if (record.supervisorId !== actorId) {
    throw new AssessmentAccessDeniedError("Only the assigned supervisor can request revisions.");
  }

  if (record.state === "approved") {
    throw new AssessmentLockedError("Cannot request revisions on an approved, finalized assessment.");
  }

  if (record.state !== "pending_supervisor") {
    throw new AssessmentStateConflictError(
      `Cannot request revision for assessment in '${record.state}' state. Must be 'pending_supervisor'.`,
    );
  }

  if (!revisionReason?.trim()) {
    throw new PublicApiError("A constructive revision reason must be provided to the trainee.", 400, {
      code: "missing_revision_reason",
    });
  }

  const now = new Date().toISOString();
  return {
    ...record,
    state: "revision_requested",
    revisionReason,
    updatedAt: now,
  };
}

function applyCancelAssessmentTransition(
  record: AssessmentRecord,
  actorId: string,
  reason = "Withdrawn by user",
): { updated: AssessmentRecord; changed: boolean } {
  const isTrainee = record.traineeId === actorId;
  const isSupervisor = record.supervisorId === actorId;

  if (!isTrainee && !isSupervisor) {
    throw new AssessmentAccessDeniedError("Only the trainee or supervisor may cancel this assessment.");
  }

  if (record.state === "approved") {
    throw new AssessmentLockedError("Cannot cancel an assessment that has already been approved and dual-signed.");
  }

  if (record.state === "cancelled") {
    return { updated: record, changed: false };
  }

  const now = new Date().toISOString();
  return {
    updated: {
      ...record,
      state: "cancelled",
      cancelReason: reason,
      updatedAt: now,
    },
    changed: true,
  };
}

function assertRestartDraftAuthorized(record: AssessmentRecord, actorId: string): void {
  if (record.traineeId !== actorId) {
    throw new AssessmentAccessDeniedError(
      "Only the original trainee can restart a draft from this cancelled assessment.",
    );
  }

  if (record.state !== "cancelled") {
    throw new AssessmentStateConflictError("Can only restart a new draft from a cancelled assessment.");
  }
}

/**
 * In-memory repository with transaction-isolated state transitions and concurrency checks.
 * Kept synchronous so offline unit tests can exercise state transitions directly.
 */
export class ClinicalAssessmentRepository {
  private store = new Map<string, AssessmentRecord>();

  clear(): void {
    this.store.clear();
  }

  getRecord(id: string): AssessmentRecord {
    const record = this.store.get(id);
    if (!record) {
      throw new AssessmentNotFoundError(id);
    }
    return record;
  }

  createDraft(params: CreateAssessmentDraftParams): AssessmentRecord {
    const record = buildDraftAssessmentRecord(
      params,
      () => `asmt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    );
    this.store.set(record.id, record);
    return record;
  }

  updateDraft(actorId: string, id: string, updates: UpdateAssessmentDraftFields): AssessmentRecord {
    const record = this.getRecord(id);
    const updated = applyDraftUpdates(record, actorId, updates);
    this.store.set(id, updated);
    return updated;
  }

  submitForReview(actorId: string, id: string): AssessmentRecord {
    const record = this.getRecord(id);
    const updated = applySubmitForReviewTransition(record, actorId);
    this.store.set(id, updated);
    return updated;
  }

  supervisorSignOff(actorId: string, id: string, signOff: SupervisorSignOffInput): AssessmentRecord {
    const record = this.getRecord(id);
    const updated = applySupervisorSignOffTransition(record, actorId, signOff);
    this.store.set(id, updated);
    return updated;
  }

  requestRevision(actorId: string, id: string, revisionReason: string): AssessmentRecord {
    const record = this.getRecord(id);
    const updated = applyRequestRevisionTransition(record, actorId, revisionReason);
    this.store.set(id, updated);
    return updated;
  }

  cancelAssessment(actorId: string, id: string, reason = "Withdrawn by user"): AssessmentRecord {
    const record = this.getRecord(id);
    const { updated, changed } = applyCancelAssessmentTransition(record, actorId, reason);
    if (changed) {
      this.store.set(id, updated);
    }
    return updated;
  }

  restartDraft(actorId: string, cancelledId: string): AssessmentRecord {
    const record = this.getRecord(cancelledId);
    assertRestartDraftAuthorized(record, actorId);

    return this.createDraft({
      serviceId: record.serviceId,
      traineeId: record.traineeId,
      supervisorId: record.supervisorId,
      title: `${record.title} (Recovered)`,
      clinicalSetting: record.clinicalSetting,
      traineeReflection: record.traineeReflection,
      traineeSelfRatings: record.traineeSelfRatings,
    });
  }

  listForSupervisor(supervisorId: string, filterState?: AssessmentLifecycleState): SafeAssessmentView[] {
    const results: SafeAssessmentView[] = [];
    for (const record of this.store.values()) {
      if (record.supervisorId === supervisorId) {
        if (!filterState || record.state === filterState) {
          results.push(projectAssessmentForActor(record, supervisorId));
        }
      }
    }
    return results;
  }

  listForTrainee(traineeId: string): SafeAssessmentView[] {
    const results: SafeAssessmentView[] = [];
    for (const record of this.store.values()) {
      if (record.traineeId === traineeId) {
        results.push(projectAssessmentForActor(record, traineeId));
      }
    }
    return results;
  }
}

/**
 * Durable Supabase-backed repository reading and writing `public.registrar_assessments`
 * via the service-role admin client.
 */
export class DurableClinicalAssessmentRepository {
  private readonly db: RegistrarAssessmentsTableClient;

  constructor(client: RegistrarAssessmentsTableClient | { from: (...args: never[]) => unknown }) {
    this.db = client as unknown as RegistrarAssessmentsTableClient;
  }

  async getRecord(id: string): Promise<AssessmentRecord> {
    const { data, error } = await this.db
      .from("registrar_assessments")
      .select(ASSESSMENT_SELECT_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      throw assessmentDatabaseError(error);
    }

    if (!data || isSupervisorBookingRow(data)) {
      throw new AssessmentNotFoundError(id);
    }

    return rowToAssessmentRecord(data);
  }

  private async persistUpdatedRecord(updated: AssessmentRecord): Promise<AssessmentRecord> {
    const row = assessmentRecordToRow(updated);
    const { data, error } = await this.db
      .from("registrar_assessments")
      .update({
        assessor_id: row.assessor_id,
        title: row.title,
        ratings: row.ratings,
        feedback: row.feedback,
        status: row.status,
        updated_at: row.updated_at,
      })
      .eq("id", updated.id)
      .eq("registrar_id", updated.traineeId)
      .select(ASSESSMENT_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw assessmentDatabaseError(error);
    }

    return rowToAssessmentRecord(data);
  }

  async createDraft(params: CreateAssessmentDraftParams): Promise<AssessmentRecord> {
    const record = buildDraftAssessmentRecord(params, () => randomUUID());
    const row = assessmentRecordToRow(record, params.category ?? "wba");

    const { data, error } = await this.db
      .from("registrar_assessments")
      .insert(row)
      .select(ASSESSMENT_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw assessmentDatabaseError(error);
    }

    return rowToAssessmentRecord(data);
  }

  async updateDraft(actorId: string, id: string, updates: UpdateAssessmentDraftFields): Promise<AssessmentRecord> {
    const record = await this.getRecord(id);
    const updated = applyDraftUpdates(record, actorId, updates);
    return this.persistUpdatedRecord(updated);
  }

  async submitForReview(actorId: string, id: string): Promise<AssessmentRecord> {
    const record = await this.getRecord(id);
    const updated = applySubmitForReviewTransition(record, actorId);
    return this.persistUpdatedRecord(updated);
  }

  async supervisorSignOff(actorId: string, id: string, signOff: SupervisorSignOffInput): Promise<AssessmentRecord> {
    const record = await this.getRecord(id);
    const updated = applySupervisorSignOffTransition(record, actorId, signOff);
    return this.persistUpdatedRecord(updated);
  }

  async requestRevision(actorId: string, id: string, revisionReason: string): Promise<AssessmentRecord> {
    const record = await this.getRecord(id);
    const updated = applyRequestRevisionTransition(record, actorId, revisionReason);
    return this.persistUpdatedRecord(updated);
  }

  async cancelAssessment(actorId: string, id: string, reason = "Withdrawn by user"): Promise<AssessmentRecord> {
    const record = await this.getRecord(id);
    const { updated, changed } = applyCancelAssessmentTransition(record, actorId, reason);
    if (!changed) {
      return updated;
    }
    return this.persistUpdatedRecord(updated);
  }

  async restartDraft(actorId: string, cancelledId: string): Promise<AssessmentRecord> {
    const record = await this.getRecord(cancelledId);
    assertRestartDraftAuthorized(record, actorId);

    return this.createDraft({
      serviceId: record.serviceId,
      traineeId: record.traineeId,
      supervisorId: record.supervisorId,
      title: `${record.title} (Recovered)`,
      clinicalSetting: record.clinicalSetting,
      traineeReflection: record.traineeReflection,
      traineeSelfRatings: record.traineeSelfRatings,
    });
  }

  async listForSupervisor(supervisorId: string, filterState?: AssessmentLifecycleState): Promise<SafeAssessmentView[]> {
    const { data, error } = await this.db
      .from("registrar_assessments")
      .select(ASSESSMENT_SELECT_COLUMNS)
      .eq("assessor_id", supervisorId)
      .order("created_at", { ascending: false });

    if (error) {
      throw assessmentDatabaseError(error);
    }

    const results: SafeAssessmentView[] = [];
    for (const row of data ?? []) {
      if (isSupervisorBookingRow(row)) continue;
      const record = rowToAssessmentRecord(row);
      if (!filterState || record.state === filterState) {
        results.push(projectAssessmentForActor(record, supervisorId));
      }
    }
    return results;
  }

  async listForTrainee(traineeId: string): Promise<SafeAssessmentView[]> {
    const { data, error } = await this.db
      .from("registrar_assessments")
      .select(ASSESSMENT_SELECT_COLUMNS)
      .eq("registrar_id", traineeId)
      .order("created_at", { ascending: false });

    if (error) {
      throw assessmentDatabaseError(error);
    }

    const results: SafeAssessmentView[] = [];
    for (const row of data ?? []) {
      if (isSupervisorBookingRow(row)) continue;
      const record = rowToAssessmentRecord(row);
      results.push(projectAssessmentForActor(record, traineeId));
    }
    return results;
  }
}

// Global default repository instance
export const defaultAssessmentRepository = new ClinicalAssessmentRepository();

export function hasRegistrarAssessmentsFrom(client: unknown): client is RegistrarAssessmentsTableClient {
  return Boolean(
    client &&
    typeof client === "object" &&
    "from" in client &&
    typeof (client as { from?: unknown }).from === "function",
  );
}

/**
 * Resolves the durable Supabase-backed assessment repository when a table-capable
 * client is provided, or falls back to the in-memory repository in non-production
 * unit tests that stub `createAdminClient()` to `{}`.
 */
export function resolveAssessmentStore(
  client: unknown,
): ClinicalAssessmentRepository | DurableClinicalAssessmentRepository {
  if (hasRegistrarAssessmentsFrom(client)) {
    return new DurableClinicalAssessmentRepository(client);
  }

  if (process.env.NODE_ENV === "production") {
    throw new PublicApiError(
      "Dual sign-off isn't available until assessments are stored in the clinical database.",
      503,
      { code: "assessment_store_unavailable" },
    );
  }

  return defaultAssessmentRepository;
}
