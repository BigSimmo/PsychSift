import { describe, expect, it } from "vitest";

import {
  hospitalStartersOutcome,
  saveStarterSharing,
  starterSharingOutcome,
} from "@/lib/work-roles/hospital-starters-client";
import {
  groupHospitalStarters,
  hospitalStartersHref,
  parseHospitalStartersView,
  starterProgressLine,
  starterStartLine,
  type HospitalStarter,
} from "@/lib/work-roles/hospital-starters-model";
import { loadExampleDataset } from "@/lib/example-data/registry";

const TODAY = "2026-10-10";

function starter(id: string, startsOn: string | null): HospitalStarter {
  return { id, name: `Dr ${id}`, teams: ["Ward A"], startsOn, done: 1, total: 3, toDo: ["Pager", "Email"] };
}

describe("groupHospitalStarters", () => {
  it("puts the nearest start date first and folds away starters from more than four weeks ago", () => {
    const groups = groupHospitalStarters(
      [
        starter("far", "2026-12-01"),
        starter("past", "2026-08-01"),
        starter("soon", "2026-10-11"),
        starter("today", "2026-10-10"),
        starter("recent-old", "2026-09-13"),
        starter("recent", "2026-10-05"),
        starter("undated", null),
        starter("older", "2026-07-01"),
      ],
      TODAY,
    );
    expect(groups.upcoming.map((row) => row.id)).toEqual(["today", "soon", "far"]);
    expect(groups.recent.map((row) => row.id)).toEqual(["recent", "recent-old"]);
    expect(groups.undated.map((row) => row.id)).toEqual(["undated"]);
    expect(groups.past.map((row) => row.id)).toEqual(["past", "older"]);
  });

  it("says the start in words, and progress without counting what is not shared", () => {
    expect(starterStartLine({ startsOn: "2026-11-02" }, TODAY)).toBe("Starts Mon 2 Nov");
    expect(starterStartLine({ startsOn: "2026-10-05" }, TODAY)).toBe("Started Mon 5 Oct");
    expect(starterStartLine({ startsOn: null }, TODAY)).toBe("No start date set");
    expect(starterProgressLine({ done: 2, total: 5 })).toBe("2 of 5 done");
    expect(starterProgressLine({ done: 0, total: 0 })).toBe("No shared items yet");
  });
});

describe("parseHospitalStartersView", () => {
  it("drops a row it cannot read rather than showing it half right", () => {
    const view = parseHospitalStartersView({
      hospital: { id: "h1", name: "Example Hospital" },
      teams: [{ serviceId: "t1", name: "Ward A" }],
      starters: [
        { id: "a", name: "Dr A", teams: ["Ward A"], startsOn: "2026-11-02", done: 1, total: 2, toDo: ["Pager"] },
        { id: "b", name: "Dr B", done: 3, total: 2 },
        { name: "No id", done: 0, total: 0 },
      ],
    });
    expect(view?.starters.map((row) => row.id)).toEqual(["a"]);
    expect(parseHospitalStartersView({ starters: [] })).toBeNull();
  });

  it("links to one hospital's starters", () => {
    expect(hospitalStartersHref("h1")).toBe("/admin/hospital/starters?hospitalId=h1");
    expect(hospitalStartersHref(null)).toBe("/admin/hospital/starters");
  });
});

describe("New starters clients", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("turns each Workforce answer into an outcome", async () => {
    expect((await hospitalStartersOutcome(json(401, {}))).status).toBe("signed-out");
    expect((await hospitalStartersOutcome(json(403, {}))).status).toBe("forbidden");
    expect((await hospitalStartersOutcome(json(503, { code: "work_roles_not_ready" }))).status).toBe("not-ready");
    expect(await hospitalStartersOutcome(json(503, { error: "New starters could not be loaded." }))).toEqual({
      status: "error",
      message: "New starters could not be loaded.",
    });
    const ok = await hospitalStartersOutcome(json(200, { hospital: { id: "h1" }, teams: [], starters: [] }));
    expect(ok.status).toBe("ok");
  });

  it("never reads a malformed sharing answer as off", async () => {
    expect(await starterSharingOutcome(json(200, { share: true }))).toEqual({ status: "ok", share: true });
    expect(await starterSharingOutcome(json(200, { share: false }))).toEqual({ status: "ok", share: false });
    expect((await starterSharingOutcome(json(200, {}))).status).toBe("error");
    expect((await starterSharingOutcome(json(500, {}))).status).toBe("error");
  });

  it("saves only the one choice", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const outcome = await saveStarterSharing(false, {
      fetcher: async (input, init) => {
        calls.push([input, init]);
        return json(200, { share: false });
      },
    });
    expect(outcome).toEqual({ status: "ok", share: false });
    expect(calls[0]![0]).toBe("/api/work/starters/sharing");
    expect(calls[0]![1]).toMatchObject({ method: "PUT", body: JSON.stringify({ share: false }) });
  });
});

describe("New starters example data", () => {
  it("uses example ids only", async () => {
    const data = await loadExampleDataset("admin.hospitalStarters", new Date("2026-10-10T02:00:00Z"));
    const ids = data.hospitals.flatMap((view) => [view.hospital.id, ...view.starters.map((row) => row.id)]);
    expect(ids.length).toBeGreaterThan(2);
    expect(ids.every((id) => id.startsWith("example:"))).toBe(true);
  });
});
