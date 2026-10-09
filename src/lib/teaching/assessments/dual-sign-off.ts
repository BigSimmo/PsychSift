import { PublicApiError } from "@/lib/http";
import type { DomainNumber, GlobalRating, Rating } from "@/lib/teaching/assessments/content";

export type AssessmentLifecycleState = "draft" | "pending_supervisor" | "revision_requested" | "approved" | "cancelled";

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

/**
 * In-memory repository with transaction-isolated state transitions and concurrency checks.
 * In a database implementation, these translate directly to Postgres transactions with
 * SELECT ... FOR UPDATE row locks.
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

  createDraft(params: {
    id?: string;
    serviceId: string;
    traineeId: string;
    supervisorId: string;
    title: string;
    clinicalSetting: string;
    traineeReflection: string;
    traineeSelfRatings?: ClinicalDomainRatings;
  }): AssessmentRecord {
    const now = new Date().toISOString();
    const id = params.id ?? `asmt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (params.traineeId === params.supervisorId) {
      throw new PublicApiError("A clinician cannot supervise their own assessment.", 400, {
        code: "invalid_supervisor",
      });
    }

    const record: AssessmentRecord = {
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

    this.store.set(id, record);
    return record;
  }

  updateDraft(
    actorId: string,
    id: string,
    updates: Partial<Pick<AssessmentRecord, "title" | "clinicalSetting" | "traineeReflection" | "traineeSelfRatings">>,
  ): AssessmentRecord {
    const record = this.getRecord(id);

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

    const updated: AssessmentRecord = {
      ...record,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.store.set(id, updated);
    return updated;
  }

  submitForReview(actorId: string, id: string): AssessmentRecord {
    const record = this.getRecord(id);

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
    const updated: AssessmentRecord = {
      ...record,
      state: "pending_supervisor",
      traineeSignedAt: record.traineeSignedAt ?? now,
      revisionReason: null,
      updatedAt: now,
    };

    this.store.set(id, updated);
    return updated;
  }

  supervisorSignOff(
    actorId: string,
    id: string,
    signOff: {
      supervisorFeedback: string;
      supervisorRatings: ClinicalDomainRatings;
      globalRecommendation: GlobalRating;
    },
  ): AssessmentRecord {
    const record = this.getRecord(id);

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
    const updated: AssessmentRecord = {
      ...record,
      state: "approved",
      supervisorFeedback: signOff.supervisorFeedback,
      supervisorRatings: signOff.supervisorRatings,
      globalRecommendation: signOff.globalRecommendation,
      supervisorSignedAt: now,
      updatedAt: now,
    };

    this.store.set(id, updated);
    return updated;
  }

  requestRevision(actorId: string, id: string, revisionReason: string): AssessmentRecord {
    const record = this.getRecord(id);

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
    const updated: AssessmentRecord = {
      ...record,
      state: "revision_requested",
      revisionReason,
      updatedAt: now,
    };

    this.store.set(id, updated);
    return updated;
  }

  cancelAssessment(actorId: string, id: string, reason = "Withdrawn by user"): AssessmentRecord {
    const record = this.getRecord(id);

    const isTrainee = record.traineeId === actorId;
    const isSupervisor = record.supervisorId === actorId;

    if (!isTrainee && !isSupervisor) {
      throw new AssessmentAccessDeniedError("Only the trainee or supervisor may cancel this assessment.");
    }

    if (record.state === "approved") {
      throw new AssessmentLockedError("Cannot cancel an assessment that has already been approved and dual-signed.");
    }

    if (record.state === "cancelled") {
      return record; // Idempotent
    }

    const now = new Date().toISOString();
    const updated: AssessmentRecord = {
      ...record,
      state: "cancelled",
      cancelReason: reason,
      updatedAt: now,
    };

    this.store.set(id, updated);
    return updated;
  }

  restartDraft(actorId: string, cancelledId: string): AssessmentRecord {
    const record = this.getRecord(cancelledId);

    if (record.traineeId !== actorId) {
      throw new AssessmentAccessDeniedError(
        "Only the original trainee can restart a draft from this cancelled assessment.",
      );
    }

    if (record.state !== "cancelled") {
      throw new AssessmentStateConflictError("Can only restart a new draft from a cancelled assessment.");
    }

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

// Global default repository instance
export const defaultAssessmentRepository = new ClinicalAssessmentRepository();
