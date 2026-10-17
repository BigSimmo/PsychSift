import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RegistrarAssessmentRow } from "@/lib/teaching/assessments/dual-sign-off";

function createMockRegistrarAssessmentsDb(initialRows: RegistrarAssessmentRow[] = []) {
  const rows = new Map<string, RegistrarAssessmentRow>(initialRows.map((row) => [row.id, { ...row }]));

  const createFilterChain = (operation: "select" | "update", updatePatch?: Partial<RegistrarAssessmentRow>) => {
    const predicates: Array<(row: RegistrarAssessmentRow) => boolean> = [];
    let orderColumn: keyof RegistrarAssessmentRow | null = null;
    let orderAscending = true;

    const execute = (): { data: RegistrarAssessmentRow[]; error: null } => {
      let matched = [...rows.values()].filter((row) => predicates.every((fn) => fn(row)));

      if (operation === "update" && updatePatch) {
        matched = matched.map((existing) => {
          const next: RegistrarAssessmentRow = {
            ...existing,
            ...updatePatch,
            ratings:
              updatePatch.ratings !== undefined
                ? structuredClone(updatePatch.ratings)
                : structuredClone(existing.ratings),
            updated_at: updatePatch.updated_at ?? new Date().toISOString(),
          };
          rows.set(next.id, next);
          return structuredClone(next);
        });
      } else {
        matched = matched.map((row) => structuredClone(row));
      }

      if (orderColumn) {
        const col = orderColumn;
        matched.sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return orderAscending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }

      return { data: matched, error: null };
    };

    const builder = {
      eq(column: string, value: string) {
        predicates.push((row) => String(row[column as keyof RegistrarAssessmentRow] ?? "") === value);
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderColumn = column as keyof RegistrarAssessmentRow;
        orderAscending = options?.ascending ?? true;
        return builder;
      },
      select() {
        return builder;
      },
      async single() {
        const { data } = execute();
        if (data.length !== 1) {
          return {
            data: null,
            error: { code: "PGRST116", message: `Expected 1 row, found ${data.length}` },
          };
        }
        return { data: data[0]!, error: null };
      },
      async maybeSingle() {
        const { data } = execute();
        if (data.length === 0) {
          return { data: null, error: null };
        }
        return { data: data[0]!, error: null };
      },
      then<TResult1 = { data: RegistrarAssessmentRow[]; error: null }, TResult2 = never>(
        onfulfilled?:
          ((value: { data: RegistrarAssessmentRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve(execute()).then(onfulfilled, onrejected);
      },
    };

    return builder;
  };

  const client = {
    rows,
    from: vi.fn((table: string) => {
      if (table !== "registrar_assessments") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select: () => createFilterChain("select"),
        insert: (
          values: Omit<RegistrarAssessmentRow, "created_at" | "updated_at"> &
            Partial<Pick<RegistrarAssessmentRow, "created_at" | "updated_at">>,
        ) => ({
          select: () => ({
            single: async () => {
              const now = new Date().toISOString();
              const inserted: RegistrarAssessmentRow = {
                ...values,
                ratings: structuredClone(values.ratings),
                created_at: values.created_at ?? now,
                updated_at: values.updated_at ?? now,
              };
              rows.set(inserted.id, inserted);
              return { data: structuredClone(inserted), error: null };
            },
          }),
        }),
        update: (patch: Partial<RegistrarAssessmentRow>) => createFilterChain("update", patch),
      };
    }),
  };

  return client;
}

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  user: { id: "" },
  adminClient: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mocks.adminClient,
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

import { GET as getBookings, POST as postBookings } from "@/app/api/teaching/assessments/bookings/route";
import { GET as getDualSignOff, POST as postDualSignOff } from "@/app/api/teaching/assessments/dual-sign-off/route";
import { defaultAssessmentRepository } from "@/lib/teaching/assessments/dual-sign-off";
import { defaultSupervisorBookingRepository } from "@/lib/teaching/assessments/supervisor-bookings";

const SERVICE_ID = "55555555-5555-4555-8555-555555555555";
const TRAINEE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_TRAINEE_ID = "33333333-3333-4333-8333-333333333333";
const SUPERVISOR_ID = "22222222-2222-4222-8222-222222222222";
const OUTSIDER_ID = "99999999-9999-4999-8999-999999999999";

function makeDualSignOffGet(query: string) {
  return new Request(`https://psychiatry.example/api/teaching/assessments/dual-sign-off?${query}`, {
    method: "GET",
  });
}

function makeDualSignOffPost(body: unknown) {
  return new Request("https://psychiatry.example/api/teaching/assessments/dual-sign-off", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeBookingsGet(query = "") {
  const suffix = query ? `?${query}` : "";
  return new Request(`https://psychiatry.example/api/teaching/assessments/bookings${suffix}`, {
    method: "GET",
  });
}

function makeBookingsPost(body: unknown) {
  return new Request("https://psychiatry.example/api/teaching/assessments/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Durable Teaching Assessments & Supervisor Bookings (registrar_assessments)", () => {
  let mockDb: ReturnType<typeof createMockRegistrarAssessmentsDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    defaultAssessmentRepository.clear();
    defaultSupervisorBookingRepository.clear();
    mockDb = createMockRegistrarAssessmentsDb();
    mocks.adminClient = mockDb;
    mocks.user = { id: TRAINEE_ID };
    mocks.auth.mockImplementation(async () => mocks.user);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("Durable Dual Sign-off (/api/teaching/assessments/dual-sign-off)", () => {
    it("persists assessments in registrar_assessments in production mode without 503 refusal and enforces trainee redaction", async () => {
      vi.stubEnv("NODE_ENV", "production");

      // 1. Trainee creates a draft in production mode
      mocks.user = { id: TRAINEE_ID };
      const createRes = await postDualSignOff(
        makeDualSignOffPost({
          action: "create_draft",
          serviceId: SERVICE_ID,
          supervisorId: SUPERVISOR_ID,
          title: "Acute Inpatient WBA Case Formulation",
          clinicalSetting: "Adult Acute Inpatient Unit",
          traineeReflection: "Assessed acute manic presentation and formulated safe rapid-tranquillisation plan.",
          traineeSelfRatings: { 1: 4, 2: 4, 3: 3, 4: 4 },
        }),
      );

      expect(createRes.status).toBe(201);
      const created = (await createRes.json()).assessment;
      const assessmentId: string = created.id;
      expect(created.state).toBe("draft");
      expect(mockDb.rows.has(assessmentId)).toBe(true);
      expect(mockDb.rows.get(assessmentId)?.status).toBe("draft");
      expect(mockDb.rows.get(assessmentId)?.registrar_id).toBe(TRAINEE_ID);
      expect(mockDb.rows.get(assessmentId)?.assessor_id).toBe(SUPERVISOR_ID);

      // Clear in-memory repository to prove all subsequent calls read from durable Supabase storage
      defaultAssessmentRepository.clear();

      // 2. Trainee updates draft and submits for supervisor review
      const updateRes = await postDualSignOff(
        makeDualSignOffPost({
          action: "update_draft",
          assessmentId,
          clinicalSetting: "Adult Acute Inpatient Unit - PICU",
        }),
      );
      expect(updateRes.status).toBe(200);
      expect((await updateRes.json()).assessment.clinicalSetting).toBe("Adult Acute Inpatient Unit - PICU");

      const submitRes = await postDualSignOff(
        makeDualSignOffPost({
          action: "submit_for_review",
          assessmentId,
        }),
      );
      expect(submitRes.status).toBe(200);
      expect((await submitRes.json()).assessment.state).toBe("pending_supervisor");
      expect(mockDb.rows.get(assessmentId)?.status).toBe("submitted");

      // Simulate preliminary supervisor notes stored on the row prior to sign-off
      const storedRow = mockDb.rows.get(assessmentId)!;
      storedRow.feedback = "Preliminary confidential supervisor notes before sign-off";
      storedRow.ratings = {
        ...storedRow.ratings,
        supervisorRatings: { 1: 3, 2: 3 },
        globalRecommendation: "cond",
      };

      // Verify trainee GET strictly redacts preliminary supervisor feedback and ratings before approval
      const traineePendingGet = await getDualSignOff(makeDualSignOffGet(`id=${assessmentId}`));
      expect(traineePendingGet.status).toBe(200);
      const traineePendingView = (await traineePendingGet.json()).assessment;
      expect(traineePendingView.state).toBe("pending_supervisor");
      expect(traineePendingView.isUnlocked).toBe(false);
      expect(traineePendingView.supervisorFeedback).toBeNull();
      expect(traineePendingView.supervisorRatings).toBeNull();
      expect(traineePendingView.globalRecommendation).toBeNull();

      // 3. Supervisor lists pending assessments, requests revision, trainee resubmits, supervisor signs off
      mocks.user = { id: SUPERVISOR_ID };
      const pendingListRes = await getDualSignOff(makeDualSignOffGet("role=supervisor"));
      expect(pendingListRes.status).toBe(200);
      const pendingList = (await pendingListRes.json()).pendingAssessments;
      expect(pendingList).toHaveLength(1);
      expect(pendingList[0].id).toBe(assessmentId);

      const revRes = await postDualSignOff(
        makeDualSignOffPost({
          action: "request_revision",
          assessmentId,
          revisionReason: "Please include metabolic monitoring and lithium baseline investigations.",
        }),
      );
      expect(revRes.status).toBe(200);
      expect((await revRes.json()).assessment.state).toBe("revision_requested");

      mocks.user = { id: TRAINEE_ID };
      const resubmitRes = await postDualSignOff(
        makeDualSignOffPost({
          action: "resubmit",
          assessmentId,
          updatedReflection:
            "Assessed acute manic presentation, ordered ECG/UEC/TFT/calcium baseline prior to lithium initiation.",
        }),
      );
      expect(resubmitRes.status).toBe(200);
      expect((await resubmitRes.json()).assessment.state).toBe("pending_supervisor");

      mocks.user = { id: SUPERVISOR_ID };
      const signOffRes = await postDualSignOff(
        makeDualSignOffPost({
          action: "supervisor_sign_off",
          assessmentId,
          supervisorFeedback: "Thorough medical workup and clear collaborative risk plan.",
          supervisorRatings: { 1: 5, 2: 4, 3: 4, 4: 5 },
          globalRecommendation: "sat",
        }),
      );
      expect(signOffRes.status).toBe(200);
      const approved = (await signOffRes.json()).assessment;
      expect(approved.state).toBe("approved");
      expect(approved.isUnlocked).toBe(true);
      expect(mockDb.rows.get(assessmentId)?.status).toBe("signed_off");

      // 4. Trainee now sees unlocked supervisor ratings and feedback, and cannot mutate finalized record
      mocks.user = { id: TRAINEE_ID };
      const traineeFinalRes = await getDualSignOff(makeDualSignOffGet(`id=${assessmentId}`));
      expect(traineeFinalRes.status).toBe(200);
      const traineeFinal = (await traineeFinalRes.json()).assessment;
      expect(traineeFinal.isUnlocked).toBe(true);
      expect(traineeFinal.supervisorFeedback).toBe("Thorough medical workup and clear collaborative risk plan.");
      expect(traineeFinal.supervisorRatings).toEqual({ 1: 5, 2: 4, 3: 4, 4: 5 });
      expect(traineeFinal.globalRecommendation).toBe("sat");

      const lockedEditRes = await postDualSignOff(
        makeDualSignOffPost({
          action: "update_draft",
          assessmentId,
          title: "Attempted Retroactive Change",
        }),
      );
      expect(lockedEditRes.status).toBe(409);
      expect((await lockedEditRes.json()).code).toBe("assessment_locked");
    });

    it("fails closed with 503 assessment_store_unavailable in production when admin client lacks durable table access", async () => {
      vi.stubEnv("NODE_ENV", "production");
      mocks.adminClient = {};

      const res = await getDualSignOff(makeDualSignOffGet("role=trainee"));
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("assessment_store_unavailable");
    });
  });

  describe("Supervisor Bookings (/api/teaching/assessments/bookings)", () => {
    it("supports create_slot, book_slot, double-booking 409 conflict, self-booking 400 refusal, and cancel_booking", async () => {
      vi.stubEnv("NODE_ENV", "production");

      // 1. Supervisor creates an open availability slot
      mocks.user = { id: SUPERVISOR_ID };
      const createSlotRes = await postBookings(
        makeBookingsPost({
          action: "create_slot",
          serviceId: SERVICE_ID,
          title: "Observed WBA Case Discussion",
          startsAt: "2026-10-20T09:00:00.000Z",
          endsAt: "2026-10-20T09:45:00.000Z",
          locationOrLink: "Consult Room 3",
          assessmentType: "wba",
          notes: "Bring de-identified case formulation notes.",
        }),
      );

      expect(createSlotRes.status).toBe(201);
      const slot = (await createSlotRes.json()).booking;
      const slotId: string = slot.id;
      expect(slot.bookingState).toBe("open");
      expect(slot.supervisorId).toBe(SUPERVISOR_ID);
      expect(slot.traineeId).toBeNull();
      expect(mockDb.rows.get(slotId)?.category).toBe("supervisor_review");

      // 2. Self-booking refusal (400): supervisor attempts to book their own slot
      const selfBookRes = await postBookings(
        makeBookingsPost({
          action: "book_slot",
          slotId,
        }),
      );
      expect(selfBookRes.status).toBe(400);
      expect((await selfBookRes.json()).code).toBe("self_booking_prohibited");

      // Also refuse self-booking when creating a slot directly assigned to oneself
      const selfCreateRes = await postBookings(
        makeBookingsPost({
          action: "create_slot",
          serviceId: SERVICE_ID,
          traineeId: SUPERVISOR_ID,
          startsAt: "2026-10-21T09:00:00.000Z",
          endsAt: "2026-10-21T09:45:00.000Z",
        }),
      );
      expect(selfCreateRes.status).toBe(400);
      expect((await selfCreateRes.json()).code).toBe("self_booking_prohibited");

      // 3. Trainee books the open slot
      mocks.user = { id: TRAINEE_ID };
      const bookRes = await postBookings(
        makeBookingsPost({
          action: "book_slot",
          slotId,
          notes: "Will present first-episode psychosis admission.",
        }),
      );
      expect(bookRes.status).toBe(200);
      const bookedSlot = (await bookRes.json()).booking;
      expect(bookedSlot.bookingState).toBe("booked");
      expect(bookedSlot.traineeId).toBe(TRAINEE_ID);
      expect(bookedSlot.bookedAt).toBeTruthy();

      // 4. Double-booking refusal (409): second trainee attempts to claim the already-booked slot
      mocks.user = { id: SECOND_TRAINEE_ID };
      const doubleBookRes = await postBookings(
        makeBookingsPost({
          action: "book_slot",
          slotId,
        }),
      );
      expect(doubleBookRes.status).toBe(409);
      expect((await doubleBookRes.json()).code).toBe("booking_slot_conflict");

      // Third-party outsider cannot view a private booked slot
      mocks.user = { id: OUTSIDER_ID };
      const outsiderGetRes = await getBookings(makeBookingsGet(`id=${slotId}`));
      expect(outsiderGetRes.status).toBe(403);
      expect((await outsiderGetRes.json()).code).toBe("booking_access_denied");

      // 5. Trainee lists their booked slots
      mocks.user = { id: TRAINEE_ID };
      const traineeListRes = await getBookings(makeBookingsGet(`role=trainee&serviceId=${SERVICE_ID}`));
      expect(traineeListRes.status).toBe(200);
      const traineeBookings = (await traineeListRes.json()).bookings;
      expect(traineeBookings).toHaveLength(1);
      expect(traineeBookings[0].id).toBe(slotId);

      // 6. Trainee cancels the booking
      const cancelRes = await postBookings(
        makeBookingsPost({
          action: "cancel_booking",
          slotId,
          reason: "Registrar rostered to night cover.",
        }),
      );
      expect(cancelRes.status).toBe(200);
      const cancelledSlot = (await cancelRes.json()).booking;
      expect(cancelledSlot.bookingState).toBe("cancelled");
      expect(cancelledSlot.cancelledReason).toBe("Registrar rostered to night cover.");
      expect(mockDb.rows.get(slotId)?.status).toBe("archived");
    });
  });
});
