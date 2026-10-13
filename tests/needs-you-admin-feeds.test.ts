import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminNotificationRead } from "@/components/needs-you/use-admin-notification-sources";
import { readCourseChanges } from "@/components/needs-you/course-change-feed";
import { watchHospitalSickNeedsYou } from "@/components/needs-you/hospital-sick-feed";

const H1 = "11111111-1111-4111-8111-111111111111";
const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-10-09T00:00:00Z");
const ZONE = "Australia/Perth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(routes: Record<string, () => Response>) {
  const fetcher = vi.fn(async (input: string) => {
    const path = input.split("?")[0]!;
    const route = routes[path];
    if (!route) throw new Error(`unexpected ${input}`);
    return route();
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const SICK_VIEW = {
  hospital: { id: H1, name: "Fiona Stanley" },
  teams: [{ serviceId: TEAM, name: "Ward A psychiatry" }],
  calls: [
    {
      id: "c1",
      serviceId: TEAM,
      teamName: "Ward A psychiatry",
      name: "Dr Sam Lee",
      kind: "night",
      shiftCode: "N",
      startsAt: "2026-10-10T14:00:00Z",
      endsAt: "2026-10-11T00:30:00Z",
      reportedAt: "2026-10-09T00:00:00Z",
      status: "needs-cover",
    },
  ],
};

let account = 0;

/** Watch until the read settles (anything but loading), then stop. */
function settle(): Promise<AdminNotificationRead> {
  account += 1;
  return new Promise((resolve) => {
    let stop: (() => void) | null = null;
    let done: AdminNotificationRead | null = null;
    stop = watchHospitalSickNeedsYou({ userId: `user-${account}`, now: NOW, zone: ZONE }, (read) => {
      if (read.status === "loading" || done) return;
      done = read;
      queueMicrotask(() => stop?.());
      resolve(read);
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sick calls read", () => {
  it("reads Medical Workforce's hospital and gives its item", async () => {
    const fetcher = stubFetch({
      "/api/work/roles": () =>
        json({ grants: [{ role: "workforce", hospitalId: H1, hospitalName: "Fiona Stanley", serviceIds: [TEAM] }] }),
      "/api/work/hospital/sick": () => json(SICK_VIEW),
    });
    const read = await settle();
    expect(read.status).toBe("ready");
    expect(read.items.map((item) => [item.title, item.detail])).toEqual([
      ["Sick calls at Fiona Stanley", "1 needs cover this week"],
    ]);
    expect(fetcher).toHaveBeenCalledWith(`/api/work/hospital/sick?hospitalId=${H1}`, expect.anything());
  });

  it("reads no sick calls for a reader without the role", async () => {
    const fetcher = stubFetch({ "/api/work/roles": () => json({ grants: [{ role: "manager", serviceId: TEAM }] }) });
    expect(await settle()).toEqual({ status: "ready", items: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("says the check failed when the sick calls do not load", async () => {
    stubFetch({
      "/api/work/roles": () => json({ grants: [{ role: "workforce", hospitalId: H1, serviceIds: [] }] }),
      "/api/work/hospital/sick": () => json({ error: "Down" }, 500),
    });
    expect((await settle()).status).toBe("failed");
  });

  it("is unavailable while the role tables are not built", async () => {
    stubFetch({
      "/api/work/roles": () => json({ grants: [{ role: "workforce", hospitalId: H1, serviceIds: [] }] }),
      "/api/work/hospital/sick": () => json({ code: "work_roles_not_ready" }, 503),
    });
    expect((await settle()).status).toBe("unavailable");
  });
});

describe("Course changes read", () => {
  const course = {
    id: "c1",
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
    status: "cancelled",
    updatedAt: "2026-10-06T02:00:00Z",
    change: { summary: "Cancelled by the organiser", at: "2026-10-06T02:00:00Z" },
  };
  const booking = { id: "b1", courseId: "c1", person: "You", self: true, status: "booked", at: "2026-10-01T00:00:00Z" };
  const answer = (courses: unknown[], bookings: unknown[]) =>
    json({
      status: "ready",
      state: { courses, bookings },
      managed: [],
      organiser: { administrator: false, teams: [] },
    });

  it("lists a cancelled course the reader is booked on", async () => {
    stubFetch({ "/api/work/bookings": () => answer([course], [booking]) });
    const read = await readCourseChanges({ headers: {}, today: "2026-10-09" }, new AbortController().signal);
    expect(read?.items.map((item) => item.title)).toEqual(["Course cancelled: Basic life support"]);
  });

  it("never lists an example course", async () => {
    stubFetch({
      "/api/work/bookings": () =>
        answer([{ ...course, id: "example:c1" }], [{ ...booking, id: "example:b1", courseId: "example:c1" }]),
    });
    const read = await readCourseChanges({ headers: {}, today: "2026-10-09" }, new AbortController().signal);
    expect(read).toEqual({ status: "ready", items: [] });
  });

  it("maps not set up, signed out and failures", async () => {
    const signal = new AbortController().signal;
    stubFetch({ "/api/work/bookings": () => json({ status: "not-set-up" }) });
    expect((await readCourseChanges({ headers: {}, today: "2026-10-09" }, signal))?.status).toBe("unavailable");
    stubFetch({ "/api/work/bookings": () => json({}, 401) });
    expect((await readCourseChanges({ headers: {}, today: "2026-10-09" }, signal))?.status).toBe("signed-out");
    stubFetch({ "/api/work/bookings": () => json({}, 500) });
    expect((await readCourseChanges({ headers: {}, today: "2026-10-09" }, signal))?.status).toBe("failed");
  });
});
