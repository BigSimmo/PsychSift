import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  user: { id: "" },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));
vi.mock("@/lib/supabase/auth", () => {
  class AuthenticationError extends Error {}
  return {
    requireAuthenticatedUser: mocks.auth,
    AuthenticationError,
    unauthorizedResponse: () =>
      new Response(JSON.stringify({ error: "Authentication required." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
  };
});
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET, POST } from "@/app/api/teaching/assessments/dual-sign-off/route";
import { defaultAssessmentRepository, type AssessmentRecord } from "@/lib/teaching/assessments/dual-sign-off";

const SERVICE_ID = "55555555-5555-4555-8555-555555555555";
const DR_SAM_LEE_TRAINEE = "11111111-1111-4111-8111-111111111111"; // Actor A
const DR_PRIYA_NAIR_SUPERVISOR = "22222222-2222-4222-8222-222222222222"; // Actor B
const DR_EVE_UNAUTHORIZED = "99999999-9999-4999-8999-999999999999"; // Adversary / Third Party

function makeGetRequest(query: string) {
  return new Request(`https://psychiatry.example/api/teaching/assessments/dual-sign-off?${query}`, {
    method: "GET",
  });
}

function makePostRequest(body: unknown) {
  return new Request(`https://psychiatry.example/api/teaching/assessments/dual-sign-off`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Clinical Assessment Dual Sign-off Workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultAssessmentRepository.clear();
    // Default logged in user
    mocks.user = { id: DR_SAM_LEE_TRAINEE };
    mocks.auth.mockImplementation(async () => mocks.user);
  });

  describe("Step 3: Multi-Actor Automated Test", () => {
    it("simulates the full lifecycle across Actor A and Actor B with anti-leakage verification", async () => {
      // ----------------------------------------------------------------------------------
      // 1. Actor A (Trainee) initiates the action: creates draft & submits for review
      // ----------------------------------------------------------------------------------
      mocks.user = { id: DR_SAM_LEE_TRAINEE };

      const createRes = await POST(
        makePostRequest({
          action: "create_draft",
          serviceId: SERVICE_ID,
          supervisorId: DR_PRIYA_NAIR_SUPERVISOR,
          title: "End-of-Term Psychiatric Formulation & Risk Assessment",
          clinicalSetting: "Inpatient Acute Ward 4",
          traineeReflection:
            "Conducted comprehensive clinical formulation and risk assessment for a patient presenting with first-episode psychosis. Identified risk drivers and collaborated with family.",
          traineeSelfRatings: { 1: 4, 2: 4, 3: 3, 4: 4 },
        }),
      );

      expect(createRes.status).toBe(201);
      const createData = await createRes.json();
      const assessmentId = createData.assessment.id;
      expect(createData.assessment.state).toBe("draft");
      expect(createData.assessment.allowedActions).toContain("submit_for_review");

      // Trainee submits for review
      const submitRes = await POST(
        makePostRequest({
          action: "submit_for_review",
          assessmentId,
        }),
      );
      expect(submitRes.status).toBe(200);
      const submitData = await submitRes.json();
      expect(submitData.assessment.state).toBe("pending_supervisor");

      // Verify Actor A sees pending state, and sensitive data remains strictly restricted
      const traineeGetRes = await GET(makeGetRequest(`id=${assessmentId}`));
      expect(traineeGetRes.status).toBe(200);
      const traineeView = (await traineeGetRes.json()).assessment;

      expect(traineeView.state).toBe("pending_supervisor");
      expect(traineeView.isUnlocked).toBe(false);
      // Strictly forbidden data check for Actor A:
      expect(traineeView.supervisorFeedback).toBeNull();
      expect(traineeView.supervisorRatings).toBeNull();
      expect(traineeView.globalRecommendation).toBeNull();
      expect(traineeView.supervisorSignedAt).toBeNull();

      // ----------------------------------------------------------------------------------
      // 2. Actor B (Supervisor) logs in -> verify pending notification, perform approval
      // ----------------------------------------------------------------------------------
      mocks.user = { id: DR_PRIYA_NAIR_SUPERVISOR };

      // Supervisor checks their inbox / notification feed
      const supervisorListRes = await GET(makeGetRequest("role=supervisor"));
      expect(supervisorListRes.status).toBe(200);
      const supervisorList = (await supervisorListRes.json()).pendingAssessments;
      expect(supervisorList).toHaveLength(1);
      expect(supervisorList[0].id).toBe(assessmentId);
      expect(supervisorList[0].traineeId).toBe(DR_SAM_LEE_TRAINEE);
      expect(supervisorList[0].allowedActions).toContain("supervisor_sign_off");

      // Supervisor signs off the assessment
      const signOffRes = await POST(
        makePostRequest({
          action: "supervisor_sign_off",
          assessmentId,
          supervisorFeedback:
            "Excellent formulation. Clear integration of biological, psychological and systemic factors. Risk management plan was nuanced and collaborative.",
          supervisorRatings: { 1: 5, 2: 4, 3: 4, 4: 5 },
          globalRecommendation: "sat",
        }),
      );
      expect(signOffRes.status).toBe(200);
      const signOffData = await signOffRes.json();
      expect(signOffData.assessment.state).toBe("approved");

      // ----------------------------------------------------------------------------------
      // 3. Both actors log in -> verify state transitions to complete and data unlocks
      // ----------------------------------------------------------------------------------
      // Supervisor view
      const supervisorGetRes = await GET(makeGetRequest(`id=${assessmentId}`));
      const supervisorFinalView = (await supervisorGetRes.json()).assessment;
      expect(supervisorFinalView.state).toBe("approved");
      expect(supervisorFinalView.isUnlocked).toBe(true);
      expect(supervisorFinalView.supervisorFeedback).toContain("Excellent formulation");
      expect(supervisorFinalView.supervisorRatings[1]).toBe(5);
      expect(supervisorFinalView.globalRecommendation).toBe("sat");
      expect(supervisorFinalView.allowedActions).toHaveLength(0); // Immutable

      // Trainee logs in
      mocks.user = { id: DR_SAM_LEE_TRAINEE };
      const traineeFinalGetRes = await GET(makeGetRequest(`id=${assessmentId}`));
      const traineeFinalView = (await traineeFinalGetRes.json()).assessment;
      expect(traineeFinalView.state).toBe("approved");
      expect(traineeFinalView.isUnlocked).toBe(true);
      // Data is now completely unlocked for Trainee:
      expect(traineeFinalView.supervisorFeedback).toBe(
        "Excellent formulation. Clear integration of biological, psychological and systemic factors. Risk management plan was nuanced and collaborative.",
      );
      expect(traineeFinalView.supervisorRatings[1]).toBe(5);
      expect(traineeFinalView.globalRecommendation).toBe("sat");
      expect(traineeFinalView.supervisorSignedAt).not.toBeNull();
      expect(traineeFinalView.allowedActions).toHaveLength(0); // Immutable
    });

    it("Negative test: strictly fails access to final data before supervisor approval and denies third parties", async () => {
      // Create and submit
      mocks.user = { id: DR_SAM_LEE_TRAINEE };
      const createRes = await POST(
        makePostRequest({
          action: "create_draft",
          serviceId: SERVICE_ID,
          supervisorId: DR_PRIYA_NAIR_SUPERVISOR,
          title: "Psychiatry Consultation-Liaison Assessment",
          clinicalSetting: "Emergency Department",
          traineeReflection: "Initial draft reflection",
        }),
      );
      const assessmentId = (await createRes.json()).assessment.id;
      await POST(makePostRequest({ action: "submit_for_review", assessmentId }));

      // Simulate preliminary supervisor notes being inserted in backend directly
      const rawRecord = defaultAssessmentRepository.getRecord(assessmentId);
      (rawRecord as AssessmentRecord).supervisorFeedback = "Confidential preliminary supervisor thoughts";
      (rawRecord as AssessmentRecord).supervisorRatings = { 1: 3 };
      (rawRecord as AssessmentRecord).globalRecommendation = "cond";

      // 4a. Attempt to access supervisor feedback using Actor A's credentials BEFORE approval
      mocks.user = { id: DR_SAM_LEE_TRAINEE };
      const traineeAttemptRes = await GET(makeGetRequest(`id=${assessmentId}`));
      expect(traineeAttemptRes.status).toBe(200);
      const traineeView = (await traineeAttemptRes.json()).assessment;
      // Proving strictly that sensitive data is redacted and cannot leak over API:
      expect(traineeView.supervisorFeedback).toBeNull();
      expect(traineeView.supervisorRatings).toBeNull();
      expect(traineeView.globalRecommendation).toBeNull();
      expect(traineeView.isUnlocked).toBe(false);

      // 4b. Third-party (unauthorized clinician) attempts to query the assessment
      mocks.user = { id: DR_EVE_UNAUTHORIZED };
      const unauthorizedRes = await GET(makeGetRequest(`id=${assessmentId}`));
      expect(unauthorizedRes.status).toBe(403);
      const err = await unauthorizedRes.json();
      expect(err.code).toBe("assessment_access_denied");
    });
  });

  describe("Step 4: Adversarial & Edge Case Review", () => {
    it("fails when Actor A tries to edit after Actor B already signed (tamper protection)", async () => {
      // 1. Create, submit, approve
      mocks.user = { id: DR_SAM_LEE_TRAINEE };
      const createRes = await POST(
        makePostRequest({
          action: "create_draft",
          serviceId: SERVICE_ID,
          supervisorId: DR_PRIYA_NAIR_SUPERVISOR,
          title: "Forensic Psychiatry Assessment",
          clinicalSetting: "Secure Unit",
          traineeReflection: "Original reflection text.",
        }),
      );
      const assessmentId = (await createRes.json()).assessment.id;
      await POST(makePostRequest({ action: "submit_for_review", assessmentId }));

      mocks.user = { id: DR_PRIYA_NAIR_SUPERVISOR };
      await POST(
        makePostRequest({
          action: "supervisor_sign_off",
          assessmentId,
          supervisorFeedback: "Sign off feedback complete.",
          supervisorRatings: { 1: 5 },
          globalRecommendation: "sat",
        }),
      );

      // 2. Actor A tries to edit after sign-off
      mocks.user = { id: DR_SAM_LEE_TRAINEE };
      const tamperRes = await POST(
        makePostRequest({
          action: "update_draft",
          assessmentId,
          traineeReflection: "Altered retroactive text attempt.",
        }),
      );

      expect(tamperRes.status).toBe(409);
      const tamperData = await tamperRes.json();
      expect(tamperData.code).toBe("assessment_locked");
      expect(tamperData.message).toContain("finalized and dual-signed");

      // Verify that database content was unchanged
      const checkRes = await GET(makeGetRequest(`id=${assessmentId}`));
      const current = (await checkRes.json()).assessment;
      expect(current.traineeReflection).toBe("Original reflection text.");
    });

    it("handles Actor A cancelling the request while Actor B is reviewing", async () => {
      // 1. Create and submit
      mocks.user = { id: DR_SAM_LEE_TRAINEE };
      const createRes = await POST(
        makePostRequest({
          action: "create_draft",
          serviceId: SERVICE_ID,
          supervisorId: DR_PRIYA_NAIR_SUPERVISOR,
          title: "Electroconvulsive Therapy Pre-assessment",
          clinicalSetting: "ECT Suite",
          traineeReflection: "Initial case review.",
        }),
      );
      const assessmentId = (await createRes.json()).assessment.id;
      await POST(makePostRequest({ action: "submit_for_review", assessmentId }));

      // 2. Trainee cancels before supervisor signs off
      const cancelRes = await POST(
        makePostRequest({
          action: "cancel",
          assessmentId,
          reason: "Patient discharged early before assessment encounter completed.",
        }),
      );
      expect(cancelRes.status).toBe(200);
      const cancelData = await cancelRes.json();
      expect(cancelData.assessment.state).toBe("cancelled");
      expect(cancelData.assessment.cancelReason).toContain("Patient discharged early");

      // 3. Supervisor attempts in-flight sign-off on the cancelled record -> fails gracefully
      mocks.user = { id: DR_PRIYA_NAIR_SUPERVISOR };
      const staleSignOffRes = await POST(
        makePostRequest({
          action: "supervisor_sign_off",
          assessmentId,
          supervisorFeedback: "Attempted feedback after cancellation.",
          supervisorRatings: { 1: 4 },
          globalRecommendation: "sat",
        }),
      );

      expect(staleSignOffRes.status).toBe(409);
      const err = await staleSignOffRes.json();
      expect(err.code).toBe("assessment_state_conflict");
      expect(err.message).toContain("cancelled or withdrawn");
    });

    it("verifies clear recovery paths for both rejection and cancellation (no dead ends)", async () => {
      // -------------------------------------------------------------------------
      // Recovery Path 1: Rejection / Revision Request Recovery
      // -------------------------------------------------------------------------
      mocks.user = { id: DR_SAM_LEE_TRAINEE };
      const createRes = await POST(
        makePostRequest({
          action: "create_draft",
          serviceId: SERVICE_ID,
          supervisorId: DR_PRIYA_NAIR_SUPERVISOR,
          title: "Neurodevelopmental (ADHD/Autism) Assessment",
          clinicalSetting: "Outpatient Clinic",
          traineeReflection: "Brief developmental history taken.",
        }),
      );
      const assessmentId = (await createRes.json()).assessment.id;
      await POST(makePostRequest({ action: "submit_for_review", assessmentId }));

      // Supervisor reviews and requests revisions
      mocks.user = { id: DR_PRIYA_NAIR_SUPERVISOR };
      const revisionRes = await POST(
        makePostRequest({
          action: "request_revision",
          assessmentId,
          revisionReason:
            "Please obtain collateral history from school reports and include differential diagnosis for mood dysregulation.",
        }),
      );
      expect(revisionRes.status).toBe(200);
      expect((await revisionRes.json()).assessment.state).toBe("revision_requested");

      // Trainee logs in, inspects revision reason, updates reflection, and resubmits (Recovery Path 1)
      mocks.user = { id: DR_SAM_LEE_TRAINEE };
      const viewRevision = await GET(makeGetRequest(`id=${assessmentId}`));
      const revData = (await viewRevision.json()).assessment;
      expect(revData.state).toBe("revision_requested");
      expect(revData.revisionReason).toContain("collateral history");
      expect(revData.allowedActions).toContain("resubmit");

      const resubmitRes = await POST(
        makePostRequest({
          action: "resubmit",
          assessmentId,
          updatedReflection:
            "Brief developmental history taken. Collateral school reports reviewed confirming attention symptoms since grade 1. Differential of mood dysregulation ruled out.",
        }),
      );
      expect(resubmitRes.status).toBe(200);
      const resubmittedData = await resubmitRes.json();
      expect(resubmittedData.assessment.state).toBe("pending_supervisor");
      expect(resubmittedData.assessment.traineeReflection).toContain("Collateral school reports reviewed");

      // -------------------------------------------------------------------------
      // Recovery Path 2: Cancelled Draft Restart Recovery
      // -------------------------------------------------------------------------
      const cancelRes = await POST(
        makePostRequest({
          action: "cancel",
          assessmentId,
          reason: "Encounter rescheduled to next week",
        }),
      );
      expect(cancelRes.status).toBe(200);

      // Trainee uses 'restart_draft' to cleanly spawn a fresh active draft without starting from scratch
      const restartRes = await POST(
        makePostRequest({
          action: "restart_draft",
          cancelledId: assessmentId,
        }),
      );
      expect(restartRes.status).toBe(201);
      const restarted = (await restartRes.json()).assessment;
      expect(restarted.state).toBe("draft");
      expect(restarted.title).toContain("(Recovered)");
      expect(restarted.traineeReflection).toContain("Collateral school reports reviewed");
      expect(restarted.allowedActions).toContain("submit_for_review");
    });
  });
});
