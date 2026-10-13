import { describe, expect, it } from "vitest";

import { exampleHospitalHub } from "@/lib/example-data/datasets/admin-hospital";
import { isExampleRecord } from "@/lib/example-data/guards";
import { hospitalSickOutcome } from "@/lib/work-roles/hospital-client";
import {
  filterSickCalls,
  groupSickCallsByDay,
  HOSPITAL_EXTRA_LINKS,
  HOSPITAL_SICK_STATUS_TONE,
  HOSPITAL_SICK_STATUS_WORDS,
  hospitalCardRows,
  hospitalSections,
  hospitalsCovered,
  maySeeHospitalSick,
  parseHospitalSickView,
  pickHospital,
  sickCallHref,
  sickCallLine,
  sickCallsPerTeam,
  sickDayLabel,
  sickHospitals,
  sickNeedsCoverThisWeek,
  sickSummaryLine,
  supervisorCoverLine,
  type HospitalSickCall,
  type HospitalSickStatus,
} from "@/lib/work-roles/hospital-hub";
import type { WorkRoleGrant } from "@/lib/work-roles/model";

const ZONE = "Australia/Perth";
const TODAY = "2026-10-09";
const H1 = "11111111-1111-4111-8111-111111111111";
const H2 = "22222222-2222-4222-8222-222222222222";

/** A Perth wall time as an instant (Perth is UTC+8 all year). */
const perth = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00Z`) - 8 * 3_600_000).toISOString();

function call(
  id: string,
  date: string,
  time: string,
  status: HospitalSickStatus,
  serviceId = "team-a",
): HospitalSickCall {
  return {
    id,
    serviceId,
    teamName: serviceId === "team-a" ? "Ward A psychiatry" : "Ward B psychiatry",
    name: `Dr ${id}`,
    kind: "day",
    shiftCode: "D",
    startsAt: perth(date, time),
    endsAt: perth(date, "16:30"),
    reportedAt: perth(date, "06:00"),
    status,
  };
}

const workforce = (hospitalId: string, hospitalName: string | null = "Example Hospital"): WorkRoleGrant => ({
  role: "workforce",
  hospitalId,
  hospitalName,
  serviceIds: ["team-a"],
});
const dct = (hospitalId: string): WorkRoleGrant => ({
  role: "dct",
  hospitalId,
  hospitalName: "Example Hospital",
  serviceIds: [],
});

describe("sick call status words", () => {
  it("uses the exact words and tones", () => {
    expect(HOSPITAL_SICK_STATUS_WORDS).toEqual({
      "needs-cover": "Needs cover",
      offered: "Offered to team",
      asked: "Someone asked to take it",
      covered: "Covered",
    });
    expect(HOSPITAL_SICK_STATUS_TONE).toEqual({
      "needs-cover": "red",
      offered: "amber",
      asked: "amber",
      covered: "green",
    });
  });
});

describe("groupSickCallsByDay", () => {
  it("groups by Perth day, today and ahead first, earlier days last, needs cover first within a day", () => {
    const calls = [
      call("covered-early", TODAY, "07:00", "covered"),
      call("yesterday", "2026-10-08", "08:00", "needs-cover"),
      call("needs-late", TODAY, "13:00", "needs-cover"),
      call("tomorrow", "2026-10-10", "08:00", "offered"),
      call("needs-early", TODAY, "08:00", "needs-cover"),
      call("asked", TODAY, "06:00", "asked"),
      // 23:30 Perth on the 9th is 15:30 UTC: still the 9th in Perth.
      call("late-night", TODAY, "23:30", "offered"),
    ];
    const days = groupSickCallsByDay(calls, TODAY, ZONE);
    expect(days.map((day) => day.label)).toEqual(["Today", "Tomorrow", "Yesterday"]);
    expect(days[0]!.calls.map((entry) => entry.id)).toEqual([
      "needs-early",
      "needs-late",
      "late-night",
      "asked",
      "covered-early",
    ]);
    expect(days[0]!.needsCover).toBe(2);
    expect(days[2]!.past).toBe(true);
  });

  it("puts a 07:00 Perth shift on its Perth day, not the UTC one", () => {
    // 07:00 Perth on the 10th is 23:00 UTC on the 9th.
    const days = groupSickCallsByDay([call("early", "2026-10-10", "07:00", "needs-cover")], TODAY, ZONE);
    expect(days[0]!.date).toBe("2026-10-10");
  });

  it("orders several earlier days most recent first", () => {
    const days = groupSickCallsByDay(
      [call("a", "2026-10-06", "08:00", "covered"), call("b", "2026-10-08", "08:00", "covered")],
      TODAY,
      ZONE,
    );
    expect(days.map((day) => day.date)).toEqual(["2026-10-08", "2026-10-06"]);
  });

  it("returns nothing for no calls", () => {
    expect(groupSickCallsByDay([], TODAY, ZONE)).toEqual([]);
  });
});

describe("sick summary counts", () => {
  const calls = [
    call("today", TODAY, "08:00", "needs-cover"),
    call("in-six", "2026-10-15", "08:00", "needs-cover"),
    call("in-seven", "2026-10-16", "08:00", "needs-cover"),
    call("yesterday", "2026-10-08", "08:00", "needs-cover"),
    call("offered", TODAY, "09:00", "offered"),
  ];

  it("counts calls needing cover from today through the next six days", () => {
    expect(sickNeedsCoverThisWeek(calls, TODAY, ZONE)).toBe(2);
  });

  it("says it in plain words", () => {
    expect(sickSummaryLine(calls, TODAY, ZONE)).toBe("2 need cover this week");
    expect(sickSummaryLine(calls.slice(0, 1), TODAY, ZONE)).toBe("1 needs cover this week");
    expect(sickSummaryLine([], TODAY, ZONE)).toBe("None need cover this week");
  });

  it("filters and counts by team", () => {
    const mixed = [...calls, call("b", TODAY, "10:00", "covered", "team-b")];
    expect(filterSickCalls(mixed, "team-b").map((entry) => entry.id)).toEqual(["b"]);
    expect(filterSickCalls(mixed, null)).toHaveLength(6);
    expect(sickCallsPerTeam(mixed).get("team-a")).toBe(5);
    expect(sickCallsPerTeam(mixed).get("team-b")).toBe(1);
  });
});

describe("sick call rows", () => {
  it("labels days and lines, with no semicolons or arrows", () => {
    expect(sickDayLabel("2026-10-12", TODAY)).toBe("Mon 12 Oct");
    const line = sickCallLine(call("x", TODAY, "08:00", "covered"), ZONE);
    expect(line).toBe("Ward A psychiatry · Day 08:00 to 16:30");
    expect(line).not.toMatch(/[;→]/);
  });

  it("opens the team's own Manage team", () => {
    expect(sickCallHref({ serviceId: "team a" })).toBe("/roster/manage?team=team+a");
  });
});

describe("parseHospitalSickView", () => {
  it("reads the API shape and drops rows it cannot read", () => {
    const view = parseHospitalSickView({
      hospital: { id: H1, name: "Example Hospital" },
      teams: [{ serviceId: "team-a", name: "Ward A psychiatry" }, { name: "no id" }],
      calls: [
        call("ok", TODAY, "08:00", "offered"),
        { ...call("bad-status", TODAY, "08:00", "offered"), status: "reported" },
        { ...call("bad-date", TODAY, "08:00", "offered"), startsAt: "soon" },
        { ...call("odd-kind", TODAY, "08:00", "offered"), kind: "weird" },
      ],
    });
    expect(view?.teams).toHaveLength(1);
    expect(view?.calls.map((entry) => entry.id)).toEqual(["ok", "odd-kind"]);
    expect(view?.calls[1]!.kind).toBe("other");
  });

  it("refuses an answer with no hospital", () => {
    expect(parseHospitalSickView({ calls: [] })).toBeNull();
    expect(parseHospitalSickView(null)).toBeNull();
  });
});

describe("hospitalSickOutcome", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("turns each answer into an outcome", async () => {
    expect((await hospitalSickOutcome(json(401, {}))).status).toBe("signed-out");
    expect((await hospitalSickOutcome(json(403, { code: "work_role_required" }))).status).toBe("forbidden");
    expect((await hospitalSickOutcome(json(503, { code: "work_roles_not_ready" }))).status).toBe("not-ready");
    expect(await hospitalSickOutcome(json(503, { error: "Sick calls could not be loaded." }))).toEqual({
      status: "error",
      message: "Sick calls could not be loaded.",
    });
    const ok = await hospitalSickOutcome(
      json(200, { hospital: { id: H1, name: "Example Hospital" }, teams: [], calls: [] }),
    );
    expect(ok.status).toBe("ok");
  });
});

describe("hospitalSections", () => {
  it("shows every role in order: Workforce, DCT, supervisor, roster manager", () => {
    const grants: WorkRoleGrant[] = [
      { role: "manager", serviceId: "team-a" },
      { role: "supervisor", subjectUserId: "trainee-1" },
      dct(H1),
      workforce(H1),
    ];
    const sections = hospitalSections(grants, H1, { sickSummary: "2 need cover this week" });
    expect(sections.map((section) => section.id)).toEqual(["workforce", "dct", "supervisor", "manager"]);
    const [work, director, supervisor, manager] = sections;
    expect(work!.title).toBe("Medical Workforce");
    expect(work!.links.map((link) => [link.label, link.href])).toEqual([
      ["Sick calls", `/admin/hospital/sick?hospitalId=${H1}`],
      ["Short-staffed days", `/admin/hospital/short-staffed?hospitalId=${H1}`],
      ["New starters", `/admin/hospital/starters?hospitalId=${H1}`],
      ["People and roles", `/admin/people?hospitalId=${H1}`],
    ]);
    expect(work!.links[0]!.sub).toBe("2 need cover this week");
    expect(director!.links.map((link) => link.href)).toEqual([
      "/teaching/assessments?view=overview&as=dct",
      `/admin/people?hospitalId=${H1}`,
    ]);
    expect(supervisor!.links.map((link) => link.href)).toEqual([
      "/teaching/supervision",
      "/teaching/assessments?view=inbox&as=supervisor",
      "/teaching/assessments?view=times&as=supervisor",
    ]);
    expect(manager!.links.map((link) => link.href)).toEqual([
      "/roster/manage?team=team-a",
      "/roster/manage?view=cover&team=team-a",
    ]);
  });

  it("gives the site administrator the Workforce section under their own title", () => {
    const sections = hospitalSections([{ role: "administrator" }], H2);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.title).toBe("Site administrator");
    expect(sections[0]!.links[0]!.href).toBe(`/admin/hospital/sick?hospitalId=${H2}`);
  });

  it("shows the New starters row only to Medical Workforce and the site administrator", () => {
    const startersRow = (grants: WorkRoleGrant[]) =>
      hospitalSections(grants, H1)
        .flatMap((section) => section.links)
        .find((link) => link.id === "starters");
    expect(startersRow([workforce(H1)])?.href).toBe(`/admin/hospital/starters?hospitalId=${H1}`);
    expect(startersRow([{ role: "administrator" }])?.href).toBe(`/admin/hospital/starters?hospitalId=${H1}`);
    expect(startersRow([dct(H1)])).toBeUndefined();
    expect(startersRow([{ role: "supervisor", subjectUserId: "trainee-1" }])).toBeUndefined();
    expect(startersRow([{ role: "manager", serviceId: "team-a" }])).toBeUndefined();
    expect(startersRow([])).toBeUndefined();
  });

  it("keeps hospital-wide sections to the picked hospital", () => {
    const grants = [workforce(H1), dct(H2)];
    expect(hospitalSections(grants, H1).map((section) => section.id)).toEqual(["workforce"]);
    expect(hospitalSections(grants, H2).map((section) => section.id)).toEqual(["dct"]);
  });

  it("gives a roster manager of two teams a section each, with the team's name", () => {
    const sections = hospitalSections(
      [
        { role: "manager", serviceId: "team-a" },
        { role: "manager", serviceId: "team-b" },
      ],
      null,
      { teamNames: new Map([["team-a", "Ward A psychiatry"]]) },
    );
    expect(sections.map((section) => [section.key, section.note])).toEqual([
      ["manager:team-a", "Ward A psychiatry"],
      ["manager:team-b", null],
    ]);
  });

  it("shows nothing to someone with no role", () => {
    expect(hospitalSections([], H1)).toEqual([]);
  });

  it("leaves typed slots for Rotation rounds and Courses, empty for now, and adds them when filled", () => {
    expect(Object.values(HOSPITAL_EXTRA_LINKS).every((links) => links.length === 0)).toBe(true);
    const sections = hospitalSections([workforce(H1), { role: "manager", serviceId: "team-a" }], H1, {
      extraLinks: {
        ...HOSPITAL_EXTRA_LINKS,
        workforce: [
          {
            id: "rotation-rounds",
            label: "Rotation rounds",
            sub: "Preferences and offers",
            icon: "rotation",
            href: ({ hospitalId }) => `/rotations?hospitalId=${hospitalId}`,
          },
        ],
        manager: [
          {
            id: "courses",
            label: "Courses",
            sub: "Bookings for your team",
            icon: "course",
            href: ({ serviceId }) => `/courses?team=${serviceId}`,
          },
        ],
      },
    });
    expect(sections[0]!.links.at(-1)!.href).toBe(`/rotations?hospitalId=${H1}`);
    expect(sections[1]!.links.at(-1)!.href).toBe("/courses?team=team-a");
  });

  it("says what a supervisor covers", () => {
    expect(
      supervisorCoverLine([
        { role: "supervisor", subjectUserId: "a" },
        { role: "supervisor", subjectUserId: "b" },
        { role: "supervisor", serviceId: "team-a" },
      ]),
    ).toBe("2 trainees and 1 team");
    expect(supervisorCoverLine([{ role: "supervisor" }])).toBe("Your trainees");
  });
});

describe("hospitals", () => {
  it("lists hospitals from Workforce and DCT roles and the administrator's list, without repeats", () => {
    const hospitals = hospitalsCovered(
      [workforce(H1, "Old name"), dct(H2), { role: "supervisor", hospitalId: "33333333-3333-4333-8333-333333333333" }],
      [{ id: H1, name: "Example Hospital" }],
    );
    expect(hospitals).toEqual([
      { id: H1, name: "Example Hospital" },
      { id: H2, name: "Example Hospital" },
    ]);
    expect(hospitalsCovered([workforce(H1, null)])).toEqual([{ id: H1, name: "Your hospital" }]);
  });

  it("lets only Workforce and the administrator read sick calls, for their hospitals", () => {
    expect(maySeeHospitalSick([dct(H1)])).toBe(false);
    expect(maySeeHospitalSick([workforce(H1)])).toBe(true);
    expect(maySeeHospitalSick([{ role: "administrator" }])).toBe(true);
    expect(sickHospitals([workforce(H1), dct(H2)]).map((entry) => entry.id)).toEqual([H1]);
    expect(sickHospitals([dct(H2)], [{ id: H2, name: "Example Health Campus" }])).toEqual([]);
    expect(sickHospitals([{ role: "administrator" }], [{ id: H2, name: "Example Health Campus" }])).toHaveLength(1);
  });

  it("picks the asked-for hospital when covered, else the first", () => {
    const list = [
      { id: H1, name: "A" },
      { id: H2, name: "B" },
    ];
    expect(pickHospital(list, H2)?.id).toBe(H2);
    expect(pickHospital(list, "elsewhere")?.id).toBe(H1);
    expect(pickHospital([], H1)).toBeNull();
  });
});

describe("hospitalCardRows", () => {
  it("gives one row per role held, opening its main screen", () => {
    const rows = hospitalCardRows(
      [workforce(H1), dct(H1), { role: "supervisor", serviceId: "team-a" }, { role: "manager", serviceId: "team-a" }],
      H1,
    );
    expect(rows.map((row) => [row.id, row.title, row.href])).toEqual([
      ["workforce", "Medical Workforce", `/admin/hospital/sick?hospitalId=${H1}`],
      ["dct", "Director of Clinical Training", "/teaching/assessments?view=overview&as=dct"],
      ["supervisor", "Supervisor or assessor", "/teaching/supervision"],
      ["manager", "Roster manager", "/roster/manage?team=team-a"],
    ]);
    expect(rows[0]!.sub).toBe("Sick calls, short-staffed days, new starters, people and roles");
  });

  it("sends a manager of several teams to Hospital to pick one", () => {
    const rows = hospitalCardRows(
      [
        { role: "manager", serviceId: "team-a" },
        { role: "manager", serviceId: "team-b" },
      ],
      null,
    );
    expect(rows).toEqual([
      { id: "manager", key: "manager", title: "Roster manager", sub: "2 teams", href: "/admin/hospital" },
    ]);
  });

  it("is empty with no role", () => {
    expect(hospitalCardRows([], null)).toEqual([]);
  });
});

describe("admin.hospital example data", () => {
  const example = exampleHospitalHub(new Date("2026-10-09T01:00:00Z"), ZONE);

  it("holds every role, so every section shows", () => {
    const hospital = hospitalsCovered(example.grants)[0]!;
    expect(hospitalSections(example.grants, hospital.id).map((section) => section.id)).toEqual([
      "workforce",
      "dct",
      "supervisor",
      "manager",
    ]);
  });

  it("marks every id as an example and dates calls around today", () => {
    for (const view of example.hospitals) {
      expect(isExampleRecord(view.hospital.id)).toBe(true);
      for (const team of view.teams) expect(isExampleRecord(team.serviceId)).toBe(true);
      for (const entry of view.calls) expect(isExampleRecord(entry.id)).toBe(true);
    }
    const days = groupSickCallsByDay(example.hospitals[0]!.calls, TODAY, ZONE);
    expect(days[0]!.label).toBe("Today");
    expect(days.at(-1)!.label).toBe("Yesterday");
    expect(sickSummaryLine(example.hospitals[0]!.calls, TODAY, ZONE)).toBe("3 need cover this week");
    expect(example.hospitals[0]!.teams.some((team) => team.name === "Ward A psychiatry")).toBe(true);
  });
});

describe("preview rows: Rotation rounds and Courses", () => {
  const both = { rotationRounds: true, courses: true };
  const hrefs = (sections: ReturnType<typeof hospitalSections>) =>
    sections.map((section) => [section.id, section.links.map((link) => link.href)] as const);

  it("adds each once, to the first section whose role may use it", () => {
    const sections = hospitalSections([workforce(H1), dct(H1), { role: "manager", serviceId: "team-a" }], H1, {
      previews: both,
    });
    // Both go to Medical Workforce, the first section that may run them.
    const workforceSection = sections.find((section) => section.id === "workforce")!;
    expect(workforceSection.links.slice(-3).map((link) => [link.label, link.href])).toEqual([
      ["Rotation rounds", "/roster/manage/rotations"],
      ["Courses", "/admin/courses"],
      ["Post a course", "/admin/courses?new=1"],
    ]);
    const manager = sections.find((section) => section.id === "manager")!;
    expect(manager.links.map((link) => link.id)).not.toContain("rotation-rounds");
    const all = sections.flatMap((section) => section.links.map((link) => link.id));
    expect(all.filter((id) => id === "rotation-rounds")).toHaveLength(1);
    expect(all.filter((id) => id === "courses")).toHaveLength(1);
  });

  it("shows nothing while the previews are off", () => {
    const sections = hospitalSections([workforce(H1)], H1, { previews: { rotationRounds: false, courses: false } });
    expect(sections[0]!.links.map((link) => link.id)).toEqual(["sick", "short-staffed", "starters", "people"]);
  });

  it("gives the DCT Courses but not Rotation rounds", () => {
    expect(hrefs(hospitalSections([dct(H1)], H1, { previews: both }))).toEqual([
      [
        "dct",
        [
          "/teaching/assessments?view=overview&as=dct",
          `/admin/people?hospitalId=${H1}`,
          "/admin/courses",
          "/admin/courses?new=1",
        ],
      ],
    ]);
  });

  it("gives a roster manager both, on their team's section", () => {
    const [manager] = hospitalSections([{ role: "manager", serviceId: "team-a" }], null, { previews: both });
    expect(manager!.links.map((link) => link.id)).toEqual([
      "team:team-a",
      "cover:team-a",
      "rotation-rounds",
      "courses",
      "post-course",
    ]);
  });

  it("gives Medical Workforce both Rotation rounds and Courses", () => {
    const ids = hospitalSections([workforce(H1)], H1, { previews: both }).flatMap((section) =>
      section.links.map((link) => link.id),
    );
    expect(ids).toContain("rotation-rounds");
    expect(ids).toContain("courses");
    expect(ids).toContain("post-course");
  });

  it("gives a supervisor neither", () => {
    const [supervisor] = hospitalSections([{ role: "supervisor", subjectUserId: "a" }], null, { previews: both });
    expect(supervisor!.links).toHaveLength(3);
  });

  it("gives the site administrator both, even before a hospital exists", () => {
    const [admin] = hospitalSections([{ role: "administrator" }], null, { previews: both });
    expect(admin!.links.map((link) => link.id)).toContain("rotation-rounds");
    expect(admin!.links.map((link) => link.id)).toContain("post-course");
  });
});
