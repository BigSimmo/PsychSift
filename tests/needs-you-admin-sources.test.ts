import { describe, expect, it } from "vitest";

import { courseChangeItemId, courseChangeNotificationItems } from "@/lib/needs-you/course-change-items";
import { hospitalSickItemId, hospitalSickNotificationItems, managedTeams } from "@/lib/needs-you/hospital-sick-items";
import type { BookingCourse, BookingStatus, BookingsState, CourseBooking } from "@/lib/work-screens/admin/bookings";
import type { HospitalSickCall, HospitalSickStatus, HospitalSickView } from "@/lib/work-roles/hospital-hub";
import type { WorkRoleGrant } from "@/lib/work-roles/model";

const ZONE = "Australia/Perth";
const TODAY = "2026-10-09";
/** 9 Oct 2026, 08:00 in Perth. */
const NOW = new Date("2026-10-09T00:00:00Z");
const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";
const TEAM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A Perth wall time as an instant (Perth is UTC+8 all year). */
const perth = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00Z`) - 8 * 3_600_000).toISOString();

function call(id: string, date: string, status: HospitalSickStatus, serviceId = TEAM_A): HospitalSickCall {
  return {
    id,
    serviceId,
    teamName: serviceId === TEAM_A ? "Ward A psychiatry" : "Consult liaison",
    name: "Dr Sam Lee",
    kind: "night",
    shiftCode: "N",
    startsAt: perth(date, "22:00"),
    endsAt: perth(date, "23:30"),
    reportedAt: perth(date, "08:00"),
    status,
  };
}

function view(id: string, name: string, calls: readonly HospitalSickCall[]): HospitalSickView {
  return {
    hospital: { id, name },
    teams: [
      { serviceId: TEAM_A, name: "Ward A psychiatry" },
      { serviceId: TEAM_B, name: "Consult liaison" },
    ],
    calls,
  };
}

const WORKFORCE: WorkRoleGrant = { role: "workforce", hospitalId: H1, hospitalName: "Fiona Stanley", serviceIds: [] };

describe("hospital sick calls in the Notification centre", () => {
  it("gives one item per hospital with the screen's own count and link", () => {
    const items = hospitalSickNotificationItems(
      [
        view(H1, "Fiona Stanley", [
          call("c1", "2026-10-11", "needs-cover"),
          call("c2", "2026-10-10", "needs-cover", TEAM_B),
          call("c3", "2026-10-10", "covered"),
        ]),
      ],
      [WORKFORCE],
      NOW,
      ZONE,
    );
    expect(items).toEqual([
      {
        id: hospitalSickItemId(H1),
        title: "Sick calls at Fiona Stanley",
        detail: "2 need cover this week",
        due: "2026-10-10",
        area: "my-work",
        href: `/admin/hospital/sick?hospitalId=${H1}`,
        kind: "update",
      },
    ]);
  });

  it("says nothing when every call is covered, past or more than a week ahead", () => {
    const items = hospitalSickNotificationItems(
      [
        view(H1, "Fiona Stanley", [
          call("c1", "2026-10-08", "needs-cover"),
          call("c2", "2026-10-16", "needs-cover"),
          call("c3", "2026-10-10", "offered"),
          call("c4", "2026-10-11", "covered"),
        ]),
      ],
      [WORKFORCE],
      NOW,
      ZONE,
    );
    expect(items).toEqual([]);
  });

  it("leaves out a team the reader manages, because Roster already tells them", () => {
    const grants: WorkRoleGrant[] = [WORKFORCE, { role: "manager", serviceId: TEAM_A }];
    expect(managedTeams(grants)).toEqual(new Set([TEAM_A]));
    const onlyOwnTeam = hospitalSickNotificationItems(
      [view(H1, "Fiona Stanley", [call("c1", "2026-10-10", "needs-cover")])],
      grants,
      NOW,
      ZONE,
    );
    expect(onlyOwnTeam).toEqual([]);
    const both = hospitalSickNotificationItems(
      [
        view(H1, "Fiona Stanley", [
          call("c1", "2026-10-10", "needs-cover"),
          call("c2", "2026-10-12", "needs-cover", TEAM_B),
        ]),
      ],
      grants,
      NOW,
      ZONE,
    );
    expect(both).toHaveLength(1);
    expect(both[0]).toMatchObject({ detail: "1 needs cover this week", due: "2026-10-12" });
  });

  it("keeps its id per hospital, whatever the calls, so a snooze holds", () => {
    const first = hospitalSickNotificationItems(
      [view(H1, "Fiona Stanley", [call("c1", "2026-10-10", "needs-cover")])],
      [WORKFORCE],
      NOW,
      ZONE,
    );
    const later = hospitalSickNotificationItems(
      [view(H1, "Fiona Stanley", [call("c9", "2026-10-13", "needs-cover"), call("c1", "2026-10-10", "covered")])],
      [WORKFORCE],
      NOW,
      ZONE,
    );
    expect(first[0]?.id).toBe(later[0]?.id);
  });

  it("never carries a name, a shift or an example record", () => {
    const items = hospitalSickNotificationItems(
      [
        view(H2, "Royal Perth", [call("c1", "2026-10-10", "needs-cover")]),
        view("example:hospital", "Example hospital", [call("c2", "2026-10-10", "needs-cover")]),
        view(H1, "Fiona Stanley", [call("example:call", "2026-10-10", "needs-cover")]),
      ],
      [{ role: "administrator" }],
      NOW,
      ZONE,
    );
    expect(items.map((item) => item.id)).toEqual([hospitalSickItemId(H2)]);
    const text = JSON.stringify(items);
    expect(text).not.toContain("Sam Lee");
    expect(text).not.toContain("22:00");
  });
});

/* -------------------------------------------------------------- courses */

function course(id: string, patch: Partial<BookingCourse> = {}): BookingCourse {
  return {
    id,
    kind: "course",
    title: "Basic life support",
    about: "",
    date: "2026-10-20",
    startTime: "09:00",
    endTime: "12:00",
    location: "Education centre",
    capacity: 10,
    closesOn: null,
    organiser: "Medical Education",
    renewal: null,
    waitlist: true,
    status: "posted",
    updatedAt: "2026-10-01T00:00:00Z",
    change: null,
    ...patch,
  };
}

function booking(courseId: string, status: BookingStatus, patch: Partial<CourseBooking> = {}): CourseBooking {
  return { id: `b-${courseId}`, courseId, person: "You", self: true, status, at: "2026-10-01T00:00:00Z", ...patch };
}

const MOVED = { summary: "Time: 09:00 to 12:00 now 13:00 to 16:00", at: "2026-10-05T02:00:00Z" };
const CANCELLED = { summary: "Cancelled by the organiser", at: "2026-10-06T02:00:00Z" };

describe("course changes in the Notification centre", () => {
  it("tells a booked doctor their course moved, with what changed and the day", () => {
    const state: BookingsState = {
      courses: [course("c1", { change: MOVED })],
      bookings: [booking("c1", "booked")],
    };
    expect(courseChangeNotificationItems(state, TODAY)).toEqual([
      {
        id: courseChangeItemId("c1", MOVED.at),
        title: "Course moved: Basic life support",
        detail: MOVED.summary,
        due: "2026-10-20",
        area: "my-work",
        href: "/admin/bookings?course=c1",
        kind: "update",
      },
    ]);
  });

  it("tells booked and waitlisted doctors a course was cancelled", () => {
    const state: BookingsState = {
      courses: [
        course("c1", { status: "cancelled", change: CANCELLED, title: "Ward safety" }),
        course("c2", { status: "cancelled", change: CANCELLED, date: "2026-10-22", title: "ECT workshop" }),
      ],
      bookings: [booking("c1", "booked"), booking("c2", "waitlisted")],
    };
    const items = courseChangeNotificationItems(state, TODAY);
    expect(items.map((item) => [item.title, item.detail])).toEqual([
      ["Course cancelled: Ward safety", "It is off your calendar"],
      ["Course cancelled: ECT workshop", "You were on the waitlist"],
    ]);
  });

  it("leaves out courses that are past, unchanged, left, attended or someone else's", () => {
    const state: BookingsState = {
      courses: [
        course("past", { change: MOVED, date: TODAY }),
        course("same"),
        course("left", { change: MOVED }),
        course("attended", { change: MOVED }),
        course("other", { change: MOVED }),
        course("example:c1", { change: MOVED }),
      ],
      bookings: [
        booking("past", "booked"),
        booking("same", "booked"),
        booking("left", "cancelled"),
        booking("attended", "attended"),
        booking("other", "booked", { self: false }),
        booking("example:c1", "booked"),
      ],
    };
    expect(courseChangeNotificationItems(state, TODAY)).toEqual([]);
  });

  it("shows a later change again under a new id", () => {
    const state = (change: typeof MOVED): BookingsState => ({
      courses: [course("c1", { change })],
      bookings: [booking("c1", "booked")],
    });
    const first = courseChangeNotificationItems(state(MOVED), TODAY)[0];
    const again = courseChangeNotificationItems(state(MOVED), TODAY)[0];
    const next = courseChangeNotificationItems(state({ ...MOVED, at: "2026-10-07T01:00:00Z" }), TODAY)[0];
    expect(first?.id).toBe(again?.id);
    expect(next?.id).not.toBe(first?.id);
  });
});
