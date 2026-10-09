import { describe, expect, it } from "vitest";

import { exampleBookings } from "@/lib/example-data/datasets/admin-bookings";
import { EXAMPLE_SELF } from "@/lib/example-data/people";
import {
  BLANK_COURSE_DRAFT,
  bookedFor,
  bookingCalendarEvents,
  bookingCalendarId,
  bookingWorkCalendarEntries,
  bookingWorkCalendarId,
  bookPlace,
  cancelCourse,
  cancelMyBooking,
  courseAvailability,
  courseById,
  courseDateTile,
  coursesForRenewals,
  daysAway,
  draftFromCourse,
  editCourse,
  formatCourseDay,
  formatCourseLength,
  hasDraftErrors,
  MAX_COURSE_PLACES,
  myBooking,
  myBookings,
  ordinal,
  placesLeft,
  placesWords,
  validateCourseDraft,
  waitlistFor,
  type BookingCourse,
  type BookingsState,
  type BookingStatus,
  type CourseBooking,
  type CourseDraft,
} from "@/lib/work-screens/admin/bookings";
import { zonedToday } from "@/lib/work-time/format";
import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";

const ZONE = "Australia/Perth";
// 10:00 in Perth on Thursday 8 October 2026.
const NOW = new Date("2026-10-08T02:00:00.000Z");
const TODAY = "2026-10-08";

function course(id: string, overrides: Partial<BookingCourse> = {}): BookingCourse {
  return {
    id,
    kind: "course",
    title: `Course ${id}`,
    about: "Hands-on practice with assessment.",
    date: "2026-10-22",
    startTime: "13:00",
    endTime: "16:30",
    location: "Room A",
    capacity: 2,
    closesOn: null,
    organiser: "Medical Education",
    renewal: null,
    waitlist: true,
    status: "posted",
    updatedAt: "2026-09-01T00:00:00.000Z",
    change: null,
    ...overrides,
  };
}

function booking(
  id: string,
  courseId: string,
  status: BookingStatus,
  at: string,
  options: { self?: boolean; person?: string } = {},
): CourseBooking {
  const self = options.self ?? false;
  return {
    id,
    courseId,
    person: options.person ?? (self ? "Me" : `Person ${id}`),
    self,
    status,
    at,
  };
}

function state(courses: BookingCourse[], bookings: CourseBooking[] = []): BookingsState {
  return { courses, bookings };
}

const bookOptions = { today: TODAY, at: "2026-10-08T02:00:00.000Z", id: "new-booking", person: "Me" };

function draft(overrides: Partial<CourseDraft> = {}): CourseDraft {
  return {
    ...BLANK_COURSE_DRAFT,
    title: "Basic life support",
    about: "Hands-on adult basic life support with assessment.",
    date: "2026-10-22",
    startTime: "13:00",
    endTime: "16:30",
    location: "Education Centre",
    capacity: "12",
    closesOn: "",
    ...overrides,
  };
}

describe("placesLeft", () => {
  it("counts booked and attended places, not waitlisted or cancelled ones", () => {
    const c = course("c", { capacity: 4 });
    const s = state(
      [c],
      [
        booking("b1", "c", "booked", "2026-10-01T00:00:00Z"),
        booking("b2", "c", "attended", "2026-10-01T01:00:00Z"),
        booking("b3", "c", "waitlisted", "2026-10-01T02:00:00Z"),
        booking("b4", "c", "cancelled", "2026-10-01T03:00:00Z"),
      ],
    );
    expect(placesLeft(s, c)).toBe(2);
  });

  it("never goes below zero when over-booked", () => {
    const c = course("c", { capacity: 1 });
    const s = state(
      [c],
      [booking("b1", "c", "booked", "2026-10-01T00:00:00Z"), booking("b2", "c", "booked", "2026-10-01T01:00:00Z")],
    );
    expect(placesLeft(s, c)).toBe(0);
  });

  it("only counts bookings on that course", () => {
    const a = course("a", { capacity: 2 });
    const b = course("b", { capacity: 2 });
    const s = state([a, b], [booking("b1", "b", "booked", "2026-10-01T00:00:00Z")]);
    expect(placesLeft(s, a)).toBe(2);
    expect(placesLeft(s, b)).toBe(1);
  });
});

describe("courseAvailability", () => {
  const fullBookings = (courseId: string) => [
    booking("o1", courseId, "booked", "2026-10-01T00:00:00Z"),
    booking("o2", courseId, "booked", "2026-10-01T01:00:00Z"),
  ];

  it("is book when there are places", () => {
    const c = course("c");
    expect(courseAvailability(state([c]), c, TODAY)).toBe("book");
  });

  it("is waitlist when full and the course keeps a waitlist", () => {
    const c = course("c", { waitlist: true });
    expect(courseAvailability(state([c], fullBookings("c")), c, TODAY)).toBe("waitlist");
  });

  it("is full when full and the waitlist is off", () => {
    const c = course("c", { waitlist: false });
    expect(courseAvailability(state([c], fullBookings("c")), c, TODAY)).toBe("full");
  });

  it("is closed after the closing day, but still open on it", () => {
    const closed = course("c", { closesOn: "2026-10-07" });
    expect(courseAvailability(state([closed]), closed, TODAY)).toBe("closed");
    const lastDay = course("c", { closesOn: TODAY });
    expect(courseAvailability(state([lastDay]), lastDay, TODAY)).toBe("book");
  });

  it("is started on the day and after it", () => {
    const onDay = course("c", { date: TODAY });
    expect(courseAvailability(state([onDay]), onDay, TODAY)).toBe("started");
    const past = course("c", { date: "2026-09-30" });
    expect(courseAvailability(state([past]), past, TODAY)).toBe("started");
  });

  it("is cancelled when the organiser cancelled, even if the reader is booked", () => {
    const c = course("c", { status: "cancelled" });
    const s = state([c], [booking("me", "c", "booked", "2026-10-01T00:00:00Z", { self: true })]);
    expect(courseAvailability(s, c, TODAY)).toBe("cancelled");
  });

  it("reports the reader's own booked, waitlisted and attended places first", () => {
    const c = course("c");
    expect(
      courseAvailability(state([c], [booking("me", "c", "booked", "2026-10-01T00:00:00Z", { self: true })]), c, TODAY),
    ).toBe("booked");
    expect(
      courseAvailability(
        state([c], [booking("me", "c", "waitlisted", "2026-10-01T00:00:00Z", { self: true })]),
        c,
        TODAY,
      ),
    ).toBe("waitlisted");
    const past = course("c", { date: "2026-09-01" });
    expect(
      courseAvailability(
        state([past], [booking("me", "c", "attended", "2026-08-01T00:00:00Z", { self: true })]),
        past,
        TODAY,
      ),
    ).toBe("attended");
  });

  it("ignores a booking the reader cancelled", () => {
    const c = course("c");
    const s = state([c], [booking("me", "c", "cancelled", "2026-10-01T00:00:00Z", { self: true })]);
    expect(myBooking(s, "c")).toBeNull();
    expect(courseAvailability(s, c, TODAY)).toBe("book");
  });
});

describe("bookPlace", () => {
  it("books a free place without changing the state it was given", () => {
    const c = course("c");
    const before = state([c]);
    const result = bookPlace(before, "c", bookOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("booked");
    expect(result.position).toBeNull();
    expect(result.state.bookings).toEqual([
      { id: "new-booking", courseId: "c", person: "Me", self: true, status: "booked", at: bookOptions.at },
    ]);
    expect(before.bookings).toEqual([]);
  });

  it("joins the waitlist at the back when the course is full", () => {
    const c = course("c", { capacity: 1 });
    const s = state(
      [c],
      [
        booking("o1", "c", "booked", "2026-10-01T00:00:00Z"),
        booking("w1", "c", "waitlisted", "2026-10-02T00:00:00Z"),
        booking("w2", "c", "waitlisted", "2026-10-03T00:00:00Z"),
      ],
    );
    const result = bookPlace(s, "c", bookOptions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("waitlisted");
    expect(result.position).toBe(3);
    expect(waitlistFor(result.state, "c").map((b) => b.id)).toEqual(["w1", "w2", "new-booking"]);
  });

  it("refuses a second booking", () => {
    const c = course("c");
    const s = state([c], [booking("me", "c", "booked", "2026-10-01T00:00:00Z", { self: true })]);
    expect(bookPlace(s, "c", bookOptions)).toEqual({ ok: false, error: "already" });
    const waiting = state([c], [booking("me", "c", "waitlisted", "2026-10-01T00:00:00Z", { self: true })]);
    expect(bookPlace(waiting, "c", bookOptions)).toEqual({ ok: false, error: "already" });
  });

  it("refuses when booking has closed", () => {
    const c = course("c", { closesOn: "2026-10-01" });
    expect(bookPlace(state([c]), "c", bookOptions)).toEqual({ ok: false, error: "closed" });
  });

  it("refuses when full with no waitlist", () => {
    const c = course("c", { capacity: 1, waitlist: false });
    const s = state([c], [booking("o1", "c", "booked", "2026-10-01T00:00:00Z")]);
    expect(bookPlace(s, "c", bookOptions)).toEqual({ ok: false, error: "full" });
  });

  it("refuses a started or cancelled course", () => {
    const started = course("c", { date: TODAY });
    expect(bookPlace(state([started]), "c", bookOptions)).toEqual({ ok: false, error: "started" });
    const cancelled = course("c", { status: "cancelled" });
    expect(bookPlace(state([cancelled]), "c", bookOptions)).toEqual({ ok: false, error: "cancelled" });
  });

  it("treats a draft or a missing course as not found", () => {
    const c = course("c", { status: "draft" });
    expect(bookPlace(state([c]), "c", bookOptions)).toEqual({ ok: false, error: "not-found" });
    expect(bookPlace(state([c]), "nope", bookOptions)).toEqual({ ok: false, error: "not-found" });
  });

  it("lets the reader book again after cancelling", () => {
    const c = course("c");
    const s = state([c], [booking("me-old", "c", "cancelled", "2026-10-01T00:00:00Z", { self: true })]);
    const result = bookPlace(s, "c", bookOptions);
    expect(result.ok && result.outcome).toBe("booked");
  });
});

describe("cancelMyBooking", () => {
  it("frees the place for the first person waiting by time joined, not list order", () => {
    const c = course("c", { capacity: 2 });
    const s = state(
      [c],
      [
        booking("me", "c", "booked", "2026-10-01T00:00:00Z", { self: true }),
        booking("o1", "c", "booked", "2026-10-01T01:00:00Z"),
        booking("late", "c", "waitlisted", "2026-10-05T00:00:00Z"),
        booking("early", "c", "waitlisted", "2026-10-03T00:00:00Z"),
      ],
    );
    const result = cancelMyBooking(s, "c");
    expect(result).not.toBeNull();
    expect(result?.promoted?.id).toBe("early");
    expect(result?.promoted?.status).toBe("booked");
    const byId = new Map(result?.state.bookings.map((b) => [b.id, b.status]));
    expect(byId.get("me")).toBe("cancelled");
    expect(byId.get("early")).toBe("booked");
    expect(byId.get("late")).toBe("waitlisted");
  });

  it("promotes nobody when the reader leaves the waitlist", () => {
    const c = course("c", { capacity: 1 });
    const s = state(
      [c],
      [
        booking("o1", "c", "booked", "2026-10-01T00:00:00Z"),
        booking("me", "c", "waitlisted", "2026-10-02T00:00:00Z", { self: true }),
        booking("w2", "c", "waitlisted", "2026-10-03T00:00:00Z"),
      ],
    );
    const result = cancelMyBooking(s, "c");
    expect(result?.promoted).toBeNull();
    const byId = new Map(result?.state.bookings.map((b) => [b.id, b.status]));
    expect(byId.has("me")).toBe(false);
    expect(byId.get("w2")).toBe("waitlisted");
    expect(bookingCalendarEvents(result!.state, (id) => id)).toEqual([]);
  });

  it("promotes nobody when no one is waiting", () => {
    const c = course("c");
    const s = state([c], [booking("me", "c", "booked", "2026-10-01T00:00:00Z", { self: true })]);
    const result = cancelMyBooking(s, "c");
    expect(result?.promoted).toBeNull();
    expect(placesLeft(result!.state, c)).toBe(2);
  });

  it("does nothing without a live booking, or for an attended one", () => {
    const c = course("c");
    expect(cancelMyBooking(state([c]), "c")).toBeNull();
    const attended = state([c], [booking("me", "c", "attended", "2026-10-01T00:00:00Z", { self: true })]);
    expect(cancelMyBooking(attended, "c")).toBeNull();
  });
});

describe("editCourse", () => {
  const booked = (courseId: string) => [
    booking("b1", courseId, "booked", "2026-10-01T00:00:00Z"),
    booking("b2", courseId, "booked", "2026-10-01T01:00:00Z"),
  ];

  it("lists day, time and place changes and moves every booked calendar", () => {
    const c = course("c", { capacity: 4, location: "Room A" });
    const s = state([c], booked("c"));
    const result = editCourse(
      s,
      "c",
      { ...draftFromCourse(c), date: "2026-10-23", startTime: "14:00", endTime: "17:30", location: "Room B" },
      { at: "2026-10-08T03:00:00.000Z" },
    );
    expect(result?.changes).toEqual([
      "Day: Thu 22 Oct now Fri 23 Oct",
      "Time: 13:00 to 16:30 now 14:00 to 17:30",
      "Place: Room A now Room B",
    ]);
    expect(result?.calendarsUpdated).toBe(2);
    expect(result?.promoted).toBe(0);
    const updated = courseById(result!.state, "c");
    expect(updated?.date).toBe("2026-10-23");
    expect(updated?.updatedAt).toBe("2026-10-08T03:00:00.000Z");
    expect(updated?.change).toEqual({
      summary: result!.changes.join(". "),
      at: "2026-10-08T03:00:00.000Z",
    });
  });

  it("updates no calendars when nothing that matters to them moved", () => {
    const c = course("c", { capacity: 4 });
    const result = editCourse(
      state([c], booked("c")),
      "c",
      { ...draftFromCourse(c), about: "New description" },
      { at: "2026-10-08T03:00:00.000Z" },
    );
    expect(result?.changes).toEqual([]);
    expect(result?.calendarsUpdated).toBe(0);
    expect(courseById(result!.state, "c")?.change).toBeNull();
  });

  it("updates no calendars when a draft is moved", () => {
    const c = course("c", { status: "draft" });
    const result = editCourse(
      state([c]),
      "c",
      { ...draftFromCourse(c), date: "2026-10-30" },
      { at: "2026-10-08T03:00:00.000Z" },
    );
    expect(result?.changes).toHaveLength(1);
    expect(result?.calendarsUpdated).toBe(0);
    expect(courseById(result!.state, "c")?.change).toBeNull();
    expect(courseById(result!.state, "c")?.status).toBe("draft");
  });

  it("posts a draft when asked", () => {
    const c = course("c", { status: "draft" });
    const result = editCourse(state([c]), "c", draftFromCourse(c), { at: "2026-10-08T03:00:00.000Z", post: true });
    expect(courseById(result!.state, "c")?.status).toBe("posted");
  });

  it("gives extra places to the waitlist in order", () => {
    const c = course("c", { capacity: 2 });
    const s = state(
      [c],
      [
        ...booked("c"),
        booking("w-late", "c", "waitlisted", "2026-10-04T00:00:00Z"),
        booking("w-early", "c", "waitlisted", "2026-10-02T00:00:00Z"),
      ],
    );
    const result = editCourse(s, "c", { ...draftFromCourse(c), capacity: "3" }, { at: "2026-10-08T03:00:00.000Z" });
    expect(result?.promoted).toBe(1);
    expect(result?.changes).toEqual([]);
    expect(result?.calendarsUpdated).toBe(0);
    expect(bookedFor(result!.state, "c").map((b) => b.id)).toEqual(["b1", "b2", "w-early"]);
    expect(waitlistFor(result!.state, "c").map((b) => b.id)).toEqual(["w-late"]);
  });

  it("refuses a cancelled or missing course", () => {
    const c = course("c", { status: "cancelled" });
    expect(editCourse(state([c]), "c", draftFromCourse(c), { at: "x" })).toBeNull();
    expect(editCourse(state([c]), "nope", draftFromCourse(c), { at: "x" })).toBeNull();
  });

  it("is backed by validation that will not drop capacity below the people booked", () => {
    const errors = validateCourseDraft(draft({ capacity: "2" }), { today: TODAY, booked: 3 });
    expect(errors.capacity).toMatch(/3 already booked/);
    expect(validateCourseDraft(draft({ capacity: "3" }), { today: TODAY, booked: 3 }).capacity).toBeUndefined();
  });
});

describe("cancelCourse", () => {
  it("marks a posted course cancelled and counts the booked calendars", () => {
    const c = course("c", { capacity: 2 });
    const s = state(
      [c],
      [
        booking("b1", "c", "booked", "2026-10-01T00:00:00Z"),
        booking("b2", "c", "booked", "2026-10-01T01:00:00Z"),
        booking("w1", "c", "waitlisted", "2026-10-02T00:00:00Z"),
      ],
    );
    const result = cancelCourse(s, "c", { at: "2026-10-08T03:00:00.000Z" });
    expect(result?.calendarsUpdated).toBe(2);
    const cancelled = courseById(result!.state, "c");
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.change).toEqual({ summary: "Cancelled by the organiser", at: "2026-10-08T03:00:00.000Z" });
  });

  it("counts no calendars for a draft, and refuses one already cancelled", () => {
    const d = course("d", { status: "draft" });
    const result = cancelCourse(state([d]), "d", { at: "2026-10-08T03:00:00.000Z" });
    expect(result?.calendarsUpdated).toBe(0);
    expect(courseById(result!.state, "d")?.change).toBeNull();
    expect(cancelCourse(result!.state, "d", { at: "2026-10-08T04:00:00.000Z" })).toBeNull();
    expect(cancelCourse(state([d]), "nope", { at: "x" })).toBeNull();
  });
});

describe("validateCourseDraft", () => {
  const today = { today: TODAY };

  it("accepts a complete draft", () => {
    const errors = validateCourseDraft(draft(), today);
    expect(errors).toEqual({});
    expect(hasDraftErrors(errors)).toBe(false);
  });

  it("needs a title", () => {
    expect(validateCourseDraft(draft({ title: "   " }), today).title).toBe("Add a title.");
    expect(validateCourseDraft(draft({ title: "x".repeat(81) }), today).title).toMatch(/under 80/);
  });

  it("needs a real date after today", () => {
    expect(validateCourseDraft(draft({ date: TODAY }), today).date).toBe("Choose a date after today.");
    expect(validateCourseDraft(draft({ date: "2026-10-01" }), today).date).toBe("Choose a date after today.");
    expect(validateCourseDraft(draft({ date: "2026-02-30" }), today).date).toBe("Choose a date.");
    expect(validateCourseDraft(draft({ date: "" }), today).date).toBe("Choose a date.");
  });

  it("needs an end after the start", () => {
    expect(validateCourseDraft(draft({ startTime: "14:00", endTime: "13:00" }), today).endTime).toBe(
      "End after it starts.",
    );
    expect(validateCourseDraft(draft({ startTime: "14:00", endTime: "14:00" }), today).endTime).toBe(
      "End after it starts.",
    );
    expect(validateCourseDraft(draft({ startTime: "25:00" }), today).startTime).toBe("Add a start time.");
  });

  it("closes booking on or before the day", () => {
    expect(validateCourseDraft(draft({ closesOn: "2026-10-23" }), today).closesOn).toBe(
      "Close booking on or before the day.",
    );
    expect(validateCourseDraft(draft({ closesOn: "2026-10-22" }), today).closesOn).toBeUndefined();
    expect(validateCourseDraft(draft({ closesOn: "2026-13-01" }), today).closesOn).toBe("Choose a date.");
  });

  it("refuses a closing day already past, unless the course already had it", () => {
    expect(validateCourseDraft(draft({ closesOn: "2026-10-07" }), today).closesOn).toBe("Choose today or a later day.");
    expect(validateCourseDraft(draft({ closesOn: TODAY }), today).closesOn).toBeUndefined();
    expect(
      validateCourseDraft(draft({ closesOn: "2026-10-07" }), { today: TODAY, savedClosesOn: "2026-10-07" }).closesOn,
    ).toBeUndefined();
  });

  it("keeps capacity between 1 and the maximum, as a whole number", () => {
    expect(validateCourseDraft(draft({ capacity: "0" }), today).capacity).toBe("Add how many places.");
    expect(validateCourseDraft(draft({ capacity: "" }), today).capacity).toBe("Add how many places.");
    expect(validateCourseDraft(draft({ capacity: "1.5" }), today).capacity).toBe("Add how many places.");
    expect(validateCourseDraft(draft({ capacity: "-3" }), today).capacity).toBe("Add how many places.");
    expect(validateCourseDraft(draft({ capacity: String(MAX_COURSE_PLACES + 1) }), today).capacity).toBe(
      `Up to ${MAX_COURSE_PLACES} places.`,
    );
    expect(validateCourseDraft(draft({ capacity: String(MAX_COURSE_PLACES) }), today).capacity).toBeUndefined();
    expect(validateCourseDraft(draft({ capacity: "1" }), today).capacity).toBeUndefined();
  });

  it("needs a place", () => {
    expect(validateCourseDraft(draft({ location: " " }), today).location).toBe("Add where it is.");
  });

  it("refuses text that looks like patient details", () => {
    const message = "This looks like patient details. Remove them before posting.";
    expect(validateCourseDraft(draft({ about: "Pt John Smith UMRN A1234567" }), today).about).toBe(message);
    expect(validateCourseDraft(draft({ title: "Pt John Smith UMRN A1234567" }), today).title).toBe(message);
    expect(validateCourseDraft(draft({ about: "UMRN A1234567" }), today).about).toBe(message);
    expect(validateCourseDraft(draft({ about: "Review the patient in bed 12 first" }), today).about).toBe(message);
    expect(validateCourseDraft(draft({ location: "Ward 4, bed 12" }), today).location).toBe(message);
  });

  it("lets capitalised course titles through", () => {
    for (const title of ["Basic Life Support (BLS)", "ECT Credentialing Session", "Mental Health Act Forms"]) {
      expect(validateCourseDraft(draft({ title }), today).title, title).toBeUndefined();
    }
  });
});

describe("bookingCalendarEvents", () => {
  const href = (id: string) => `/admin/bookings?course=${encodeURIComponent(id)}`;

  it("puts only the reader's booked and attended courses in the calendar", () => {
    const s = state(
      [
        course("example:course-bls", { title: "Basic life support", date: "2026-10-22" }),
        course("attended", { kind: "requirement", date: "2026-09-01", startTime: "09:00", endTime: "10:00" }),
        course("waiting", { date: "2026-10-25" }),
        course("others", { date: "2026-10-26" }),
        course("draft", { status: "draft", date: "2026-10-27" }),
      ],
      [
        booking("me1", "example:course-bls", "booked", "2026-10-01T00:00:00Z", { self: true }),
        booking("me2", "attended", "attended", "2026-08-01T00:00:00Z", { self: true }),
        booking("me3", "waiting", "waitlisted", "2026-10-01T00:00:00Z", { self: true }),
        booking("o1", "others", "booked", "2026-10-01T00:00:00Z"),
        booking("me4", "draft", "booked", "2026-10-01T00:00:00Z", { self: true }),
      ],
    );
    const events = bookingCalendarEvents(s, href);
    expect(events.map((e) => e.id)).toEqual(["booking-attended", "booking-example-course-bls"]);
    const bls = events[1];
    expect(bls).toMatchObject({
      title: "Basic life support",
      date: "2026-10-22",
      startTime: "13:00",
      durationMinutes: 210,
      kind: "teaching",
      location: "Room A",
      href: href("example:course-bls"),
    });
    expect(bls?.notes).toContain("Medical Education");
    expect(bls).not.toHaveProperty("status");
    expect(events[0]?.kind).toBe("other");
    expect(events[0]?.durationMinutes).toBe(60);
    expect(events[0]).not.toHaveProperty("status");
  });

  it("keeps a cancelled entry when the reader cancelled or the course was cancelled", () => {
    const s = state(
      [course("mine-cancelled"), course("course-cancelled", { status: "cancelled", date: "2026-10-23" })],
      [
        booking("me1", "mine-cancelled", "cancelled", "2026-10-01T00:00:00Z", { self: true }),
        booking("me2", "course-cancelled", "booked", "2026-10-01T00:00:00Z", { self: true }),
      ],
    );
    const events = bookingCalendarEvents(s, href);
    expect(events.map((e) => [e.id, e.status])).toEqual([
      ["booking-mine-cancelled", "cancelled"],
      ["booking-course-cancelled", "cancelled"],
    ]);
  });

  it("is live again when the reader rebooks after cancelling", () => {
    const s = state(
      [course("c")],
      [
        booking("old", "c", "cancelled", "2026-10-01T00:00:00Z", { self: true }),
        booking("new", "c", "booked", "2026-10-02T00:00:00Z", { self: true }),
      ],
    );
    const events = bookingCalendarEvents(s, href);
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty("status");
  });

  it("keeps the same id after an edit so calendars update in place", () => {
    const c = course("example:course-bls", { capacity: 4 });
    const s = state([c], [booking("me", c.id, "booked", "2026-10-01T00:00:00Z", { self: true })]);
    const edited = editCourse(s, c.id, { ...draftFromCourse(c), date: "2026-10-29" }, { at: "2026-10-08T03:00:00Z" });
    const [event] = bookingCalendarEvents(edited!.state, href);
    expect(event?.id).toBe("booking-example-course-bls");
    expect(event?.date).toBe("2026-10-29");
    expect(bookingCalendarId("plain")).toBe("booking-plain");
  });
});

describe("bookingWorkCalendarEntries", () => {
  const href = (id: string) => `/admin/bookings?course=${encodeURIComponent(id)}`;

  it("maps the reader's courses to shared work calendar entries", () => {
    const s = state(
      [course("example:course-bls"), course("plain", { status: "cancelled", kind: "requirement", date: "2026-10-23" })],
      [
        booking("me1", "example:course-bls", "booked", "2026-10-01T00:00:00Z", { self: true }),
        booking("me2", "plain", "booked", "2026-10-01T00:00:00Z", { self: true }),
      ],
    );
    const entries = bookingWorkCalendarEntries(s, href);
    expect(entries.map((e) => [e.id, e.status, e.isExample])).toEqual([
      ["example:booking:course-bls", "confirmed", true],
      ["booking:plain", "cancelled", false],
    ]);
    expect(entries[0]).toMatchObject({
      kind: "course",
      start: "2026-10-22",
      end: "2026-10-22",
      startTime: "13:00",
      endTime: "16:30",
      detail: "Course · Medical Education",
      href: href("example:course-bls"),
    });
    expect(bookingWorkCalendarId("x")).toBe("booking:x");
  });
});

describe("myBookings", () => {
  it("groups the reader's courses", () => {
    const s = state(
      [
        course("later", { date: "2026-11-05" }),
        course("sooner", { date: "2026-10-15" }),
        course("moved", { date: "2026-10-20", change: { summary: "Day moved", at: "2026-10-05T00:00:00Z" } }),
        course("waiting", { date: "2026-10-18" }),
        course("dropped", { date: "2026-10-19" }),
        course("course-cancelled", {
          status: "cancelled",
          date: "2026-10-21",
          change: { summary: "Cancelled by the organiser", at: "2026-10-06T00:00:00Z" },
        }),
        course("past", { date: "2026-09-01" }),
        course("past-waiting", { date: "2026-09-02" }),
        course("not-mine", { date: "2026-10-16" }),
      ],
      [
        booking("1", "later", "booked", "2026-10-01T00:00:00Z", { self: true }),
        booking("2", "sooner", "booked", "2026-10-01T00:00:00Z", { self: true }),
        booking("3", "moved", "booked", "2026-10-01T00:00:00Z", { self: true }),
        booking("4", "waiting", "waitlisted", "2026-10-01T00:00:00Z", { self: true }),
        booking("5", "dropped", "cancelled", "2026-10-01T00:00:00Z", { self: true }),
        booking("6", "course-cancelled", "booked", "2026-10-01T00:00:00Z", { self: true }),
        booking("7", "past", "attended", "2026-08-01T00:00:00Z", { self: true }),
        booking("8", "past-waiting", "waitlisted", "2026-08-01T00:00:00Z", { self: true }),
        booking("9", "not-mine", "booked", "2026-10-01T00:00:00Z"),
      ],
    );
    const mine = myBookings(s, TODAY);
    expect(mine.booked.map((c) => c.id)).toEqual(["sooner", "moved", "later"]);
    expect(mine.waitlisted.map((c) => c.id)).toEqual(["waiting"]);
    expect(mine.changed.map((c) => c.id)).toEqual(["course-cancelled", "moved"]);
    expect(mine.earlier.map((e) => [e.course.id, e.status])).toEqual([
      ["course-cancelled", "course-cancelled"],
      ["dropped", "cancelled"],
      ["past", "attended"],
    ]);
  });
});

describe("coursesForRenewals", () => {
  const s = state([
    course("bls", { renewal: "basic life support", date: "2026-10-22" }),
    course("bls-later", { renewal: "basic life support", date: "2026-11-22" }),
    course("bls-draft", { renewal: "basic life support", status: "draft" }),
    course("bls-past", { renewal: "basic life support", date: "2026-09-01" }),
    course("fit", { renewal: "respirator fit test", date: "2026-10-14" }),
    course("none", { renewal: null }),
  ]);

  it("matches open courses to renewal titles regardless of case and punctuation, soonest first", () => {
    expect(coursesForRenewals(s, TODAY, ["Basic Life Support (BLS)"]).map((c) => c.id)).toEqual(["bls", "bls-later"]);
    expect(coursesForRenewals(s, TODAY, ["Fit test"]).map((c) => c.id)).toEqual(["fit"]);
    expect(coursesForRenewals(s, TODAY, ["Respirator fit test", "basic life support"]).map((c) => c.id)).toEqual([
      "fit",
      "bls",
      "bls-later",
    ]);
  });

  it("matches nothing without titles or with unrelated ones", () => {
    expect(coursesForRenewals(s, TODAY, [])).toEqual([]);
    expect(coursesForRenewals(s, TODAY, ["", "  "])).toEqual([]);
    expect(coursesForRenewals(s, TODAY, ["Manual handling"])).toEqual([]);
  });
});

describe("words", () => {
  it("formats a course day as a plain date", () => {
    expect(formatCourseDay("2026-10-22")).toBe("Thu 22 Oct");
    expect(formatCourseDay("2027-01-01")).toBe("Fri 1 Jan");
    expect(formatCourseDay("soon")).toBe("soon");
  });

  it("builds the date tile", () => {
    expect(courseDateTile("2026-10-05")).toEqual({ month: "Oct", day: "05" });
    expect(courseDateTile("bad")).toEqual({ month: "", day: "" });
  });

  it("formats the length", () => {
    expect(formatCourseLength({ startTime: "10:00", endTime: "10:20" })).toBe("20 min");
    expect(formatCourseLength({ startTime: "13:00", endTime: "16:30" })).toBe("3 h 30 min");
    expect(formatCourseLength({ startTime: "09:00", endTime: "11:00" })).toBe("2 h");
    expect(formatCourseLength({ startTime: "11:00", endTime: "11:00" })).toBe("");
  });

  it("counts days away", () => {
    expect(daysAway(TODAY, TODAY)).toBe("Today");
    expect(daysAway("2026-10-09", TODAY)).toBe("Tomorrow");
    expect(daysAway("2026-10-22", TODAY)).toBe("In 14 days");
    expect(daysAway("2026-11-01", TODAY)).toBe("In 24 days");
    expect(daysAway("2026-10-07", TODAY)).toBe("Yesterday");
    expect(daysAway("2026-10-05", TODAY)).toBe("3 days ago");
    expect(daysAway("later", TODAY)).toBe("");
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
      "111th",
      "112th",
    ]);
  });

  it("describes places", () => {
    const c = course("c", { capacity: 2 });
    expect(placesWords(state([c]), c)).toBe("2 of 2 left");
    const full = state(
      [c],
      [booking("b1", "c", "booked", "2026-10-01T00:00:00Z"), booking("b2", "c", "booked", "2026-10-01T01:00:00Z")],
    );
    expect(placesWords(full, c)).toBe("Full");
    const waiting = { ...full, bookings: [...full.bookings, booking("w", "c", "waitlisted", "2026-10-02T00:00:00Z")] };
    expect(placesWords(waiting, c)).toBe("Full, 1 waiting");
  });
});

describe("example bookings dataset", () => {
  const sample = exampleBookings(NOW, ZONE);
  const today = zonedToday(ZONE, NOW);

  it("reads today in Perth", () => {
    expect(today).toBe(TODAY);
  });

  it("is the same for the same moment", () => {
    expect(exampleBookings(NOW, ZONE)).toEqual(sample);
  });

  it("marks every record as example data", () => {
    for (const c of sample.courses) expect(c.id.startsWith("example:")).toBe(true);
    for (const b of sample.bookings) {
      expect(b.id.startsWith("example:")).toBe(true);
      expect(b.courseId.startsWith("example:")).toBe(true);
    }
    const ids = [...sample.courses.map((c) => c.id), ...sample.bookings.map((b) => b.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every booking at a course in the set", () => {
    for (const b of sample.bookings) expect(courseById(sample, b.courseId)).not.toBeNull();
  });

  it("has an open course with places, a full one with a waitlist, a draft and one the reader booked", () => {
    const open = sample.courses.filter(
      (c) => c.status === "posted" && courseAvailability(sample, c, today) === "book" && placesLeft(sample, c) > 0,
    );
    expect(open.length).toBeGreaterThan(0);
    const fullWithWaitlist = sample.courses.filter(
      (c) =>
        c.status === "posted" && c.date > today && placesLeft(sample, c) === 0 && waitlistFor(sample, c.id).length > 0,
    );
    expect(fullWithWaitlist.length).toBeGreaterThan(0);
    expect(sample.courses.some((c) => c.status === "draft")).toBe(true);
    const mine = myBookings(sample, today);
    expect(mine.booked.length).toBeGreaterThan(0);
    expect(sample.bookings.filter((b) => b.self).every((b) => b.person === EXAMPLE_SELF)).toBe(true);
    expect(bookingCalendarEvents(sample, (id) => id).length).toBeGreaterThan(0);
  });

  it("never over-books a course or books one person twice", () => {
    for (const c of sample.courses) {
      expect(bookedFor(sample, c.id).length).toBeLessThanOrEqual(c.capacity);
      const live = sample.bookings.filter((b) => b.courseId === c.id && b.status !== "cancelled").map((b) => b.person);
      expect(new Set(live).size).toBe(live.length);
    }
  });

  it("only holds upcoming courses an organiser could post", () => {
    for (const c of sample.courses.filter((item) => item.date > today)) {
      expect(validateCourseDraft(draftFromCourse(c), { today, booked: bookedFor(sample, c.id).length })).toEqual({});
    }
  });

  it("holds no text that looks like patient details", () => {
    for (const c of sample.courses) {
      const texts = [c.title, c.about, c.location, c.organiser, c.renewal ?? "", c.change?.summary ?? ""];
      for (const text of texts) expect(looksLikePatientDetail(text), text).toBe(false);
    }
  });
});
