import { describe, expect, it, vi } from "vitest";

import {
  BLANK_COURSE_DRAFT,
  courseAvailability,
  myBookings,
  myWaitlistPosition,
  placesLeft,
  type CourseDraft,
} from "@/lib/work-screens/admin/bookings";
import {
  OTHER_DOCTOR_LABEL,
  bookSavedCourse,
  bookingsApiError,
  cancelSavedBooking,
  cancelSavedCourse,
  courseRpcArgs,
  isBookingsNotSetUp,
  mapBookingsRead,
  readSavedBookings,
  saveSavedCourse,
} from "@/lib/work-screens/admin/bookings-repository";

vi.mock("server-only", () => ({}));

type Client = Parameters<typeof readSavedBookings>[0];

const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COURSE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEAM = "11111111-1111-4111-8111-111111111111";

function course(overrides: Record<string, unknown> = {}) {
  return {
    id: COURSE,
    kind: "course",
    title: "Basic life support",
    about: "Bring your ID badge.",
    date: "2026-10-22",
    startTime: "13:00",
    endTime: "16:30",
    location: "Education Centre, Room 2",
    capacity: 2,
    closesOn: null,
    organiser: "Medical Education",
    renewal: "basic life support",
    waitlist: true,
    status: "posted",
    updatedAt: "2026-10-01T02:00:00.000+00:00",
    change: null,
    serviceId: TEAM,
    manage: false,
    ...overrides,
  };
}

function readRows(overrides: { courses?: unknown[]; bookings?: unknown[] } = {}) {
  return {
    courses: overrides.courses ?? [course()],
    bookings: overrides.bookings ?? [
      { id: "other-1", courseId: COURSE, person: null, self: false, status: "booked", at: "2026-10-02T00:00:00Z" },
      { id: "b-me", courseId: COURSE, person: "Dr Lee", self: true, status: "booked", at: "2026-10-03T00:00:00Z" },
      { id: "other-2", courseId: COURSE, person: null, self: false, status: "waitlisted", at: "2026-10-04T00:00:00Z" },
    ],
    organiser: { administrator: false, teams: [] },
  };
}

function rpcClient(answer: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null }));
  return { client: { rpc } as unknown as Client, rpc };
}

describe("saved bookings: mapping rows onto the example version's state", () => {
  it("maps courses and bookings so the pure rules count places and waitlist exactly", () => {
    const read = mapBookingsRead(readRows());
    expect(read.status).toBe("ready");
    expect(read.state.courses[0]).toEqual({
      id: COURSE,
      kind: "course",
      title: "Basic life support",
      about: "Bring your ID badge.",
      date: "2026-10-22",
      startTime: "13:00",
      endTime: "16:30",
      location: "Education Centre, Room 2",
      capacity: 2,
      closesOn: null,
      organiser: "Medical Education",
      renewal: "basic life support",
      waitlist: true,
      status: "posted",
      updatedAt: "2026-10-01T02:00:00.000+00:00",
      change: null,
    });
    const state = read.state;
    const mapped = state.courses[0];
    expect(placesLeft(state, mapped)).toBe(0);
    expect(courseAvailability(state, mapped, "2026-10-09")).toBe("booked");
    expect(myBookings(state, "2026-10-09").booked.map((item) => item.id)).toEqual([COURSE]);
  });

  it("shows other doctors without a name, and the reader's own row as theirs", () => {
    const { state } = mapBookingsRead(readRows());
    expect(state.bookings.find((booking) => booking.id === "other-1")).toMatchObject({
      person: OTHER_DOCTOR_LABEL,
      self: false,
    });
    expect(state.bookings.find((booking) => booking.id === "b-me")).toMatchObject({ person: "Dr Lee", self: true });
  });

  it("gives the reader's waitlist position from anonymised rows ahead of them", () => {
    const { state } = mapBookingsRead(
      readRows({
        bookings: [
          { id: "other-1", courseId: COURSE, person: null, self: false, status: "booked", at: "2026-10-01T00:00:00Z" },
          { id: "other-2", courseId: COURSE, person: null, self: false, status: "booked", at: "2026-10-02T00:00:00Z" },
          {
            id: "other-3",
            courseId: COURSE,
            person: null,
            self: false,
            status: "waitlisted",
            at: "2026-10-03T00:00:00Z",
          },
          {
            id: "b-me",
            courseId: COURSE,
            person: "Dr Lee",
            self: true,
            status: "waitlisted",
            at: "2026-10-04T00:00:00Z",
          },
        ],
      }),
    );
    expect(myWaitlistPosition(state, COURSE)).toBe(2);
  });

  it("lists the courses the reader manages with their team, and where they may post", () => {
    const read = mapBookingsRead({
      ...readRows({
        courses: [course({ manage: true }), course({ id: "open-1", serviceId: null, manage: false })],
      }),
      organiser: { administrator: true, teams: [{ serviceId: TEAM, name: "Inpatient team" }] },
    });
    expect(read.managed).toEqual([{ courseId: COURSE, serviceId: TEAM }]);
    expect(read.organiser).toEqual({ administrator: true, teams: [{ serviceId: TEAM, name: "Inpatient team" }] });
  });

  it("keeps the organiser's change note for booked doctors", () => {
    const read = mapBookingsRead(
      readRows({ courses: [course({ change: { summary: "Place: Room 1 now Room 2", at: "2026-10-05T00:00:00Z" } })] }),
    );
    expect(read.state.courses[0].change).toEqual({ summary: "Place: Room 1 now Room 2", at: "2026-10-05T00:00:00Z" });
  });

  it("fails closed on a shape it does not recognise", () => {
    expect(() => mapBookingsRead({ courses: [course({ status: "archived" })], bookings: [] })).toThrow(
      expect.objectContaining({ status: 503 }),
    );
    expect(() => mapBookingsRead(null)).toThrow(expect.objectContaining({ status: 503 }));
  });
});

describe("saved bookings: database errors", () => {
  it("recognises the answers that mean the tables are not there yet", () => {
    for (const code of ["PGRST202", "PGRST205", "42P01", "42883"]) expect(isBookingsNotSetUp({ code })).toBe(true);
    expect(isBookingsNotSetUp({ code: "42501" })).toBe(false);
    expect(isBookingsNotSetUp(null)).toBe(false);
  });

  it("maps each SQL refusal to a plain message and status, never the database's own text", () => {
    const cases: [string, number][] = [
      ["work_bookings_full", 409],
      ["work_bookings_already", 409],
      ["work_bookings_closed", 409],
      ["work_bookings_started", 409],
      ["work_bookings_course_cancelled", 409],
      ["work_bookings_capacity_below_booked", 409],
      ["work_bookings_role_denied", 403],
      ["work_bookings_not_found", 404],
      ["work_bookings_invalid_request", 400],
      ["work_bookings_auth_required", 401],
    ];
    for (const [message, status] of cases) {
      const error = bookingsApiError({ message, code: "P0001" });
      expect(error.status).toBe(status);
      expect(error.details?.code).toBe(message);
    }
    expect(bookingsApiError({ code: "23505", message: "duplicate key value" })).toMatchObject({
      status: 409,
      details: { code: "work_bookings_already" },
    });
    expect(bookingsApiError({ code: "23514", message: "violates check" })).toMatchObject({ status: 400 });
    expect(bookingsApiError({ code: "PGRST205", message: "no table" })).toMatchObject({
      status: 503,
      details: { code: "work_bookings_not_set_up" },
    });
    const unknown = bookingsApiError({ code: "XX000", message: "relation secret_table internal detail" });
    expect(unknown.status).toBe(503);
    expect(unknown.message).not.toContain("secret_table");
  });
});

describe("saved bookings: RPC calls", () => {
  it("reads with the session actor and answers not-set-up before the tables land", async () => {
    const ready = rpcClient({ data: readRows() });
    await expect(readSavedBookings(ready.client, ACTOR)).resolves.toMatchObject({ status: "ready" });
    expect(ready.rpc).toHaveBeenCalledWith("work_bookings_read", { p_actor_id: ACTOR });

    for (const code of ["PGRST202", "PGRST205", "42P01"]) {
      const missing = rpcClient({ error: { code, message: "missing" } });
      await expect(readSavedBookings(missing.client, ACTOR)).resolves.toEqual({ status: "not-set-up" });
    }
  });

  it("refuses to run without an actor", async () => {
    const { client, rpc } = rpcClient({ data: readRows() });
    await expect(readSavedBookings(client, "")).rejects.toMatchObject({ status: 401 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("books and cancels through the locked SQL functions", async () => {
    const booked = rpcClient({ data: { id: "b1", outcome: "waitlisted", position: 3 } });
    await expect(bookSavedCourse(booked.client, ACTOR, COURSE)).resolves.toEqual({
      id: "b1",
      outcome: "waitlisted",
      position: 3,
    });
    expect(booked.rpc).toHaveBeenCalledWith("work_book_course", {
      p_actor_id: ACTOR,
      p_course_id: COURSE,
    });

    const left = rpcClient({ data: { cancelled: "waitlisted", promoted: 0 } });
    await expect(cancelSavedBooking(left.client, ACTOR, COURSE)).resolves.toEqual({
      cancelled: "waitlisted",
      promoted: 0,
    });
    expect(left.rpc).toHaveBeenCalledWith("work_cancel_course_booking", { p_actor_id: ACTOR, p_course_id: COURSE });

    const full = rpcClient({ error: { code: "P0001", message: "work_bookings_full" } });
    await expect(bookSavedCourse(full.client, ACTOR, COURSE)).rejects.toMatchObject({ status: 409 });
  });

  it("sends a course draft trimmed the way the example version trims it", async () => {
    const draft: CourseDraft = {
      ...BLANK_COURSE_DRAFT,
      title: "  Basic life support ",
      about: " Bring your badge. ",
      date: "2026-10-22",
      startTime: "13:00",
      endTime: "16:30",
      location: " Room 2 ",
      capacity: "12",
      closesOn: "",
      renewal: " Basic Life Support ",
    };
    expect(courseRpcArgs(ACTOR, { courseId: null, serviceId: TEAM, organiser: " Med Ed ", draft, post: true })).toEqual(
      {
        p_actor_id: ACTOR,
        p_course_id: null,
        p_service_id: TEAM,
        p_organiser_label: "Med Ed",
        p_kind: "course",
        p_title: "Basic life support",
        p_about: "Bring your badge.",
        p_course_date: "2026-10-22",
        p_start_time: "13:00",
        p_end_time: "16:30",
        p_location: "Room 2",
        p_capacity: 12,
        p_closes_on: null,
        p_renewal: "basic life support",
        p_waitlist: true,
        p_post: true,
      },
    );

    const saved = rpcClient({
      data: { id: COURSE, status: "posted", changes: ["Place: Room 1 now Room 2"], calendarsUpdated: 4, promoted: 1 },
    });
    await expect(
      saveSavedCourse(saved.client, ACTOR, {
        courseId: COURSE,
        serviceId: TEAM,
        organiser: "Med Ed",
        draft,
        post: true,
      }),
    ).resolves.toMatchObject({ calendarsUpdated: 4, promoted: 1 });
    expect(saved.rpc).toHaveBeenCalledWith("work_save_course", expect.objectContaining({ p_course_id: COURSE }));

    const cancelled = rpcClient({ data: { id: COURSE, calendarsUpdated: 4 } });
    await expect(cancelSavedCourse(cancelled.client, ACTOR, COURSE)).resolves.toEqual({
      id: COURSE,
      calendarsUpdated: 4,
    });
    expect(cancelled.rpc).toHaveBeenCalledWith("work_cancel_course", { p_actor_id: ACTOR, p_course_id: COURSE });
  });
});
