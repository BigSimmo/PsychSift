import { randomUUID } from "node:crypto";

import { PublicApiError } from "@/lib/http";
import {
  hasRegistrarAssessmentsFrom,
  type RegistrarAssessmentDbStatus,
  type RegistrarAssessmentRow,
  type RegistrarAssessmentsTableClient,
} from "@/lib/teaching/assessments/dual-sign-off";

export type BookingAssessmentType = "epa" | "wba" | "ita" | "general";
export type SupervisorBookingState = "open" | "booked" | "completed" | "cancelled";

export type SupervisorBookingRecord = {
  id: string;
  serviceId: string;
  supervisorId: string;
  traineeId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  locationOrLink: string;
  assessmentType: BookingAssessmentType;
  bookingState: SupervisorBookingState;
  notes: string | null;
  bookedAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAvailabilitySlotInput = {
  id?: string;
  serviceId: string;
  supervisorId: string;
  traineeId?: string | null;
  title?: string;
  startsAt: string;
  endsAt: string;
  locationOrLink?: string;
  assessmentType?: BookingAssessmentType;
  notes?: string | null;
};

export type BookSupervisorSlotInput = {
  slotId: string;
  traineeId: string;
  notes?: string | null;
  assessmentType?: BookingAssessmentType;
};

export type CancelBookingInput = {
  slotId: string;
  actorId: string;
  reason?: string;
};

export type ListBookingsFilter = {
  actorId: string;
  role?: "supervisor" | "trainee" | "open";
  serviceId?: string;
  bookingState?: SupervisorBookingState;
};

export class BookingSlotNotFoundError extends PublicApiError {
  constructor(id: string) {
    super(`Supervision booking slot ${id} not found.`, 404, { code: "booking_slot_not_found" });
    this.name = "BookingSlotNotFoundError";
  }
}

export class BookingAccessDeniedError extends PublicApiError {
  constructor(message = "You are not authorized to access or modify this supervision booking.") {
    super(message, 403, { code: "booking_access_denied" });
    this.name = "BookingAccessDeniedError";
  }
}

export class BookingSlotConflictError extends PublicApiError {
  constructor(message = "This supervision slot is already booked or unavailable.") {
    super(message, 409, { code: "booking_slot_conflict" });
    this.name = "BookingSlotConflictError";
  }
}

const BOOKING_SELECT_COLUMNS =
  "id, registrar_id, assessor_id, category, title, ratings, feedback, status, created_at, updated_at";

const VALID_ASSESSMENT_TYPES = new Set<BookingAssessmentType>(["epa", "wba", "ita", "general"]);
const VALID_BOOKING_STATES = new Set<SupervisorBookingState>(["open", "booked", "completed", "cancelled"]);

function assertValidBookingWindow(startsAt: string, endsAt: string): void {
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new PublicApiError("Booking slot end time must be a valid timestamp after the start time.", 400, {
      code: "invalid_booking_window",
    });
  }
}

function assertNotSelfBooking(traineeId: string, supervisorId: string): void {
  if (traineeId === supervisorId) {
    throw new PublicApiError("A clinician cannot book a supervision assessment slot with themselves.", 400, {
      code: "self_booking_prohibited",
    });
  }
}

function windowsOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const a0 = Date.parse(startA);
  const a1 = Date.parse(endA);
  const b0 = Date.parse(startB);
  const b1 = Date.parse(endB);
  if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(b0) || !Number.isFinite(b1)) {
    return false;
  }
  return a0 < b1 && b0 < a1;
}

export function bookingStateToDbStatus(state: SupervisorBookingState): RegistrarAssessmentDbStatus {
  switch (state) {
    case "open":
      return "draft";
    case "booked":
      return "submitted";
    case "completed":
      return "signed_off";
    case "cancelled":
      return "archived";
  }
}

export function dbStatusToBookingState(
  status: RegistrarAssessmentDbStatus,
  ratings: Record<string, unknown> | null,
): SupervisorBookingState {
  const rawState = ratings?.bookingState;
  if (typeof rawState === "string" && VALID_BOOKING_STATES.has(rawState as SupervisorBookingState)) {
    return rawState as SupervisorBookingState;
  }
  switch (status) {
    case "draft":
      return "open";
    case "submitted":
      return "booked";
    case "signed_off":
      return "completed";
    case "archived":
      return "cancelled";
  }
}

export function bookingRecordToRow(record: SupervisorBookingRecord): RegistrarAssessmentRow {
  return {
    id: record.id,
    // `registrar_id` is NOT NULL in `public.registrar_assessments`; open slots use supervisorId until claimed.
    registrar_id: record.traineeId ?? record.supervisorId,
    assessor_id: record.supervisorId,
    category: "supervisor_review",
    title: record.title,
    feedback: record.notes,
    status: bookingStateToDbStatus(record.bookingState),
    ratings: {
      kind: "supervisor_booking",
      serviceId: record.serviceId,
      supervisorId: record.supervisorId,
      traineeId: record.traineeId,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      locationOrLink: record.locationOrLink,
      assessmentType: record.assessmentType,
      bookingState: record.bookingState,
      notes: record.notes,
      bookedAt: record.bookedAt,
      cancelledReason: record.cancelledReason,
    },
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function rowToBookingRecord(row: RegistrarAssessmentRow): SupervisorBookingRecord {
  const ratings = row.ratings && typeof row.ratings === "object" ? row.ratings : {};
  const bookingState = dbStatusToBookingState(row.status, ratings);
  const rawType = ratings.assessmentType;
  const assessmentType: BookingAssessmentType =
    typeof rawType === "string" && VALID_ASSESSMENT_TYPES.has(rawType as BookingAssessmentType)
      ? (rawType as BookingAssessmentType)
      : "wba";
  const supervisorId =
    typeof row.assessor_id === "string" && row.assessor_id.length > 0
      ? row.assessor_id
      : typeof ratings.supervisorId === "string"
        ? ratings.supervisorId
        : row.registrar_id;
  const traineeId =
    typeof ratings.traineeId === "string" && ratings.traineeId.length > 0
      ? ratings.traineeId
      : bookingState !== "open" && row.registrar_id !== supervisorId
        ? row.registrar_id
        : null;

  return {
    id: row.id,
    serviceId: typeof ratings.serviceId === "string" ? ratings.serviceId : "",
    supervisorId,
    traineeId,
    title: row.title,
    startsAt: typeof ratings.startsAt === "string" ? ratings.startsAt : row.created_at,
    endsAt: typeof ratings.endsAt === "string" ? ratings.endsAt : row.updated_at,
    locationOrLink: typeof ratings.locationOrLink === "string" ? ratings.locationOrLink : "Clinical Supervision Room",
    assessmentType,
    bookingState,
    notes: typeof ratings.notes === "string" ? ratings.notes : (row.feedback ?? null),
    bookedAt: typeof ratings.bookedAt === "string" ? ratings.bookedAt : null,
    cancelledReason: typeof ratings.cancelledReason === "string" ? ratings.cancelledReason : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildBookingSlotRecord(input: CreateAvailabilitySlotInput, defaultId: () => string): SupervisorBookingRecord {
  assertValidBookingWindow(input.startsAt, input.endsAt);
  const traineeId = input.traineeId ?? null;
  if (traineeId) {
    assertNotSelfBooking(traineeId, input.supervisorId);
  }

  const now = new Date().toISOString();
  const assessmentType = input.assessmentType ?? "wba";
  const isDirectlyBooked = Boolean(traineeId);

  return {
    id: input.id ?? defaultId(),
    serviceId: input.serviceId,
    supervisorId: input.supervisorId,
    traineeId,
    title: input.title?.trim() || `${assessmentType.toUpperCase()} Supervision Slot`,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    locationOrLink: input.locationOrLink?.trim() || "Clinical Supervision Room",
    assessmentType,
    bookingState: isDirectlyBooked ? "booked" : "open",
    notes: input.notes ?? null,
    bookedAt: isDirectlyBooked ? now : null,
    cancelledReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

function applyBookSlotTransition(
  slot: SupervisorBookingRecord,
  input: BookSupervisorSlotInput,
): SupervisorBookingRecord {
  assertNotSelfBooking(input.traineeId, slot.supervisorId);

  if (slot.bookingState === "booked" || (slot.traineeId !== null && slot.bookingState !== "open")) {
    throw new BookingSlotConflictError("This supervision slot has already been booked.");
  }

  if (slot.bookingState !== "open") {
    throw new BookingSlotConflictError(`Cannot book a supervision slot in '${slot.bookingState}' state.`);
  }

  const now = new Date().toISOString();
  return {
    ...slot,
    traineeId: input.traineeId,
    assessmentType: input.assessmentType ?? slot.assessmentType,
    bookingState: "booked",
    notes: input.notes !== undefined ? input.notes : slot.notes,
    bookedAt: now,
    updatedAt: now,
  };
}

function applyCancelBookingTransition(
  slot: SupervisorBookingRecord,
  input: CancelBookingInput,
): { updated: SupervisorBookingRecord; changed: boolean } {
  const isSupervisor = slot.supervisorId === input.actorId;
  const isTrainee = slot.traineeId !== null && slot.traineeId === input.actorId;

  if (!isSupervisor && !isTrainee) {
    throw new BookingAccessDeniedError("Only the assigned supervisor or booked trainee may cancel this slot.");
  }

  if (slot.bookingState === "completed") {
    throw new BookingSlotConflictError("Cannot cancel a completed supervision booking.");
  }

  if (slot.bookingState === "cancelled") {
    return { updated: slot, changed: false };
  }

  const now = new Date().toISOString();
  return {
    updated: {
      ...slot,
      bookingState: "cancelled",
      cancelledReason: input.reason?.trim() || "Cancelled by user",
      updatedAt: now,
    },
    changed: true,
  };
}

function matchesBookingFilter(slot: SupervisorBookingRecord, filter: ListBookingsFilter): boolean {
  if (filter.serviceId && slot.serviceId !== filter.serviceId) {
    return false;
  }
  if (filter.bookingState && slot.bookingState !== filter.bookingState) {
    return false;
  }
  if (filter.role === "supervisor") {
    return slot.supervisorId === filter.actorId;
  }
  if (filter.role === "trainee") {
    return slot.traineeId === filter.actorId;
  }
  if (filter.role === "open") {
    return slot.bookingState === "open";
  }
  return (
    slot.supervisorId === filter.actorId ||
    slot.traineeId === filter.actorId ||
    (Boolean(filter.serviceId) && slot.bookingState === "open")
  );
}

/**
 * In-memory repository for offline unit tests and non-production fallback.
 */
export class SupervisorBookingRepository {
  private store = new Map<string, SupervisorBookingRecord>();

  clear(): void {
    this.store.clear();
  }

  getSlot(slotId: string): SupervisorBookingRecord {
    const slot = this.store.get(slotId);
    if (!slot) {
      throw new BookingSlotNotFoundError(slotId);
    }
    return slot;
  }

  createAvailabilitySlot(input: CreateAvailabilitySlotInput): SupervisorBookingRecord {
    const candidate = buildBookingSlotRecord(input, () => randomUUID());

    for (const existing of this.store.values()) {
      if (
        existing.supervisorId === candidate.supervisorId &&
        existing.bookingState !== "cancelled" &&
        windowsOverlap(existing.startsAt, existing.endsAt, candidate.startsAt, candidate.endsAt)
      ) {
        throw new BookingSlotConflictError("Supervisor already has an overlapping availability slot in this window.");
      }
    }

    this.store.set(candidate.id, candidate);
    return candidate;
  }

  bookSupervisorSlot(input: BookSupervisorSlotInput): SupervisorBookingRecord {
    const slot = this.getSlot(input.slotId);
    const updated = applyBookSlotTransition(slot, input);
    this.store.set(slot.id, updated);
    return updated;
  }

  cancelBooking(input: CancelBookingInput): SupervisorBookingRecord {
    const slot = this.getSlot(input.slotId);
    const { updated, changed } = applyCancelBookingTransition(slot, input);
    if (changed) {
      this.store.set(slot.id, updated);
    }
    return updated;
  }

  listBookingsForActor(filter: ListBookingsFilter): SupervisorBookingRecord[] {
    const results: SupervisorBookingRecord[] = [];
    for (const slot of this.store.values()) {
      if (matchesBookingFilter(slot, filter)) {
        results.push(slot);
      }
    }
    return results.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }
}

function bookingDatabaseError(error: { message?: string; code?: string } | null): PublicApiError {
  if (error?.code === "22P02") return new PublicApiError("Invalid booking identifier.", 400, { code: "invalid_id" });
  if (error?.code === "23503")
    return new PublicApiError("Referenced booking user was not found.", 400, { code: "invalid_reference" });
  return new PublicApiError("Supervision booking database operation failed.", 500, {
    code: "booking_database_error",
  });
}

const BOOKING_PAGE_SIZE = 500;

function compareCreation(a: SupervisorBookingRecord, b: SupervisorBookingRecord): number {
  const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (Number.isFinite(byTime) && byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isBookingRow(row: RegistrarAssessmentRow): boolean {
  return Boolean(
    row.category === "supervisor_review" &&
    row.ratings &&
    typeof row.ratings === "object" &&
    (row.ratings as Record<string, unknown>).kind === "supervisor_booking",
  );
}

/**
 * Durable Supabase-backed booking repository storing supervisor availability and bookings
 * in `public.registrar_assessments` under `category = 'supervisor_review'`.
 */
export class DurableSupervisorBookingRepository {
  private readonly db: RegistrarAssessmentsTableClient;

  constructor(client: RegistrarAssessmentsTableClient | { from: (...args: never[]) => unknown }) {
    this.db = client as unknown as RegistrarAssessmentsTableClient;
  }

  async getSlot(slotId: string): Promise<SupervisorBookingRecord> {
    const { data, error } = await this.db
      .from("registrar_assessments")
      .select(BOOKING_SELECT_COLUMNS)
      .eq("category", "supervisor_review")
      .eq("id", slotId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      throw bookingDatabaseError(error);
    }

    if (!data || !isBookingRow(data)) {
      throw new BookingSlotNotFoundError(slotId);
    }

    return rowToBookingRecord(data);
  }

  async createAvailabilitySlot(input: CreateAvailabilitySlotInput): Promise<SupervisorBookingRecord> {
    const candidate = buildBookingSlotRecord(input, () => randomUUID());

    if ((await this.overlappingActiveSlots(candidate)).length > 0) {
      throw new BookingSlotConflictError("Supervisor already has an overlapping availability slot in this window.");
    }

    const row = bookingRecordToRow(candidate);
    const { data, error } = await this.db
      .from("registrar_assessments")
      .insert(row)
      .select(BOOKING_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw bookingDatabaseError(error);
    }

    const created = rowToBookingRecord(data);
    // The check above and the insert are separate statements, so two concurrent requests can both
    // pass it. Re-check after inserting: if an overlapping slot that sorts earlier (created_at, then
    // id) exists, this one withdraws itself, so exactly one of any concurrent overlapping pair survives.
    const earlier = (await this.overlappingActiveSlots(created)).filter((other) => compareCreation(other, created) < 0);
    if (earlier.length > 0) {
      await this.withdrawConcurrentDuplicate(created);
      throw new BookingSlotConflictError("Supervisor already has an overlapping availability slot in this window.");
    }

    return created;
  }

  /** Every non-cancelled slot of the same supervisor whose window overlaps `slot`, excluding itself. */
  private async overlappingActiveSlots(slot: SupervisorBookingRecord): Promise<SupervisorBookingRecord[]> {
    const supervisorSlots = await this.listBookingsForActor({ actorId: slot.supervisorId, role: "supervisor" });
    return supervisorSlots.filter(
      (existing) =>
        existing.id !== slot.id &&
        existing.bookingState !== "cancelled" &&
        windowsOverlap(existing.startsAt, existing.endsAt, slot.startsAt, slot.endsAt),
    );
  }

  private async withdrawConcurrentDuplicate(slot: SupervisorBookingRecord): Promise<void> {
    const { updated } = applyCancelBookingTransition(slot, {
      slotId: slot.id,
      actorId: slot.supervisorId,
      reason: "Withdrawn automatically: an overlapping slot was published at the same time.",
    });
    const row = bookingRecordToRow(updated);
    const { error } = await this.db
      .from("registrar_assessments")
      .update({ feedback: row.feedback, status: row.status, ratings: row.ratings, updated_at: row.updated_at })
      .eq("category", "supervisor_review")
      .eq("id", slot.id)
      .select(BOOKING_SELECT_COLUMNS)
      .maybeSingle();
    if (error) throw bookingDatabaseError(error);
  }

  async bookSupervisorSlot(input: BookSupervisorSlotInput): Promise<SupervisorBookingRecord> {
    const slot = await this.getSlot(input.slotId);
    const updated = applyBookSlotTransition(slot, input);
    const row = bookingRecordToRow(updated);

    const { data, error } = await this.db
      .from("registrar_assessments")
      .update({
        registrar_id: row.registrar_id,
        assessor_id: row.assessor_id,
        title: row.title,
        feedback: row.feedback,
        status: row.status,
        ratings: row.ratings,
        updated_at: row.updated_at,
      })
      .eq("category", "supervisor_review")
      .eq("id", slot.id)
      .eq("status", "draft")
      .select(BOOKING_SELECT_COLUMNS)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      throw bookingDatabaseError(error);
    }

    if (!data) {
      throw new BookingSlotConflictError("This supervision slot has already been booked.");
    }

    return rowToBookingRecord(data);
  }

  async cancelBooking(input: CancelBookingInput): Promise<SupervisorBookingRecord> {
    const slot = await this.getSlot(input.slotId);
    const { updated, changed } = applyCancelBookingTransition(slot, input);
    if (!changed) {
      return updated;
    }

    const row = bookingRecordToRow(updated);
    const { data, error } = await this.db
      .from("registrar_assessments")
      .update({
        feedback: row.feedback,
        status: row.status,
        ratings: row.ratings,
        updated_at: row.updated_at,
      })
      .eq("category", "supervisor_review")
      .eq("id", slot.id)
      .eq("status", bookingStateToDbStatus(slot.bookingState))
      .eq("updated_at", slot.updatedAt)
      .select(BOOKING_SELECT_COLUMNS)
      .maybeSingle();

    if (error) throw bookingDatabaseError(error);
    if (!data) throw new BookingSlotConflictError("This booking changed before it could be cancelled.");

    return rowToBookingRecord(data);
  }

  async listBookingsForActor(filter: ListBookingsFilter): Promise<SupervisorBookingRecord[]> {
    const buildQuery = () => {
      let query = this.db
        .from("registrar_assessments")
        .select(BOOKING_SELECT_COLUMNS)
        .eq("category", "supervisor_review");
      if (filter.role === "supervisor") {
        query = query.eq("assessor_id", filter.actorId);
      } else if (filter.role === "trainee") {
        query = query.eq("registrar_id", filter.actorId);
      }
      if (filter.serviceId) query = query.eq("ratings->>serviceId", filter.serviceId);
      if (filter.bookingState) query = query.eq("status", bookingStateToDbStatus(filter.bookingState));
      if (filter.role === "open") query = query.eq("status", "draft");
      return query;
    };

    // Read every matching row in pages rather than one capped read: a cap silently drops rows,
    // which would hide bookings and blind the overlap check for busy supervisors.
    const rows: RegistrarAssessmentRow[] = [];
    for (let from = 0; ; from += BOOKING_PAGE_SIZE) {
      const { data, error } = await buildQuery()
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + BOOKING_PAGE_SIZE - 1);
      if (error) {
        throw bookingDatabaseError(error);
      }
      const page = data ?? [];
      rows.push(...page);
      if (page.length < BOOKING_PAGE_SIZE) break;
    }

    const results: SupervisorBookingRecord[] = [];
    for (const row of rows) {
      if (!isBookingRow(row)) continue;
      const slot = rowToBookingRecord(row);
      if (matchesBookingFilter(slot, filter)) {
        results.push(slot);
      }
    }

    return results.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }
}

export const defaultSupervisorBookingRepository = new SupervisorBookingRepository();

export function resolveSupervisorBookingStore(
  client: unknown,
): SupervisorBookingRepository | DurableSupervisorBookingRepository {
  if (hasRegistrarAssessmentsFrom(client)) {
    return new DurableSupervisorBookingRepository(client);
  }

  if (process.env.NODE_ENV === "production") {
    throw new PublicApiError(
      "Supervisor bookings aren't available until assessments are stored in the clinical database.",
      503,
      { code: "booking_store_unavailable" },
    );
  }

  return defaultSupervisorBookingRepository;
}

export async function createAvailabilitySlot(
  input: CreateAvailabilitySlotInput,
  client?: unknown,
): Promise<SupervisorBookingRecord> {
  const store = resolveSupervisorBookingStore(client);
  return await store.createAvailabilitySlot(input);
}

export async function bookSupervisorSlot(
  input: BookSupervisorSlotInput,
  client?: unknown,
): Promise<SupervisorBookingRecord> {
  const store = resolveSupervisorBookingStore(client);
  return await store.bookSupervisorSlot(input);
}

export async function cancelBooking(input: CancelBookingInput, client?: unknown): Promise<SupervisorBookingRecord> {
  const store = resolveSupervisorBookingStore(client);
  return await store.cancelBooking(input);
}

export async function listBookingsForActor(
  filter: ListBookingsFilter,
  client?: unknown,
): Promise<SupervisorBookingRecord[]> {
  const store = resolveSupervisorBookingStore(client);
  return await store.listBookingsForActor(filter);
}
