import { describe, expect, it } from "vitest";

import { expandEvents } from "@/lib/calendar/calendar-event";
import { cmeCalendarEvents, cmeReportingCloseDate } from "@/lib/cme/calendar-events";
import { createAustralianRanzcpPreset } from "@/lib/cme/presets";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeEntry } from "@/lib/cme/types";
import { buildCmeYearCheck } from "@/lib/cme/year-check";

function entry(overrides: Partial<CmeEntry> & Pick<CmeEntry, "id">): CmeEntry {
  return {
    date: "2026-03-01",
    title: `Activity ${overrides.id}`,
    allocations: [{ category: "educational", hours: 1 }],
    reflection: "Changed how I review lithium levels.",
    costCents: null,
    transcribed: true,
    routineId: null,
    documentId: null,
    buckets: [],
    evidenceCount: 1,
    ...overrides,
  };
}

const SET = createAustralianRanzcpPreset(2026, "2026-01-05");

describe("year check", () => {
  it("lists every confirmed target plus the three per-activity records", () => {
    const check = buildCmeYearCheck(SET, []);
    expect(check.rows.map((row) => row.id)).toEqual([
      "total",
      "requirement-educational",
      "requirement-combined",
      "requirement-domains",
      "requirement-plan",
      "requirement-self-evaluation",
      "requirement-peer-review",
      "evidence",
      "reflection",
      "copied",
    ]);
    // With nothing logged the per-activity records have nothing outstanding.
    expect(check.rows.filter((row) => row.group === "records").every((row) => row.ready)).toBe(true);
  });

  it("names the activities that prove a target, and ignores archived ones", () => {
    const check = buildCmeYearCheck(SET, [
      entry({ id: "a", allocations: [{ category: "educational", hours: 13 }] }),
      entry({ id: "b", allocations: [{ category: "reviewing", hours: 2 }] }),
      entry({ id: "old", archivedAt: "2026-04-01", allocations: [{ category: "educational", hours: 40 }] }),
    ]);
    const educational = check.rows.find((row) => row.id === "requirement-educational")!;
    expect(educational.ready).toBe(true);
    expect(educational.entryIds).toEqual(["a"]);
    const total = check.rows.find((row) => row.id === "total")!;
    expect(total.ready).toBe(false);
    expect(total.summary).toBe("15 h logged, 35 h to go");
    expect(total.action?.href).toBe("/cme/new?year=2026");
  });

  it("words each target as the mock-up does: a figure, the empty domain, a task's day without its year", () => {
    const set = {
      ...SET,
      requirements: SET.requirements.map((r) =>
        r.id === "plan"
          ? { ...r, completedOn: "2026-02-03" }
          : r.id === "self-evaluation"
            ? { ...r, completedOn: "2025-12-20" }
            : r,
      ),
    };
    const check = buildCmeYearCheck(set, [
      entry({ id: "a", allocations: [{ category: "reviewing", hours: 3 }], buckets: ["Professionalism"] }),
    ]);
    const row = (id: string) => check.rows.find((item) => item.id === `requirement-${id}`)!;
    expect(row("combined")).toMatchObject({ summary: "3 of 25 h", condition: "at least 5 h in each" });
    expect(row("domains").summary).toBe("3 of 4 have nothing yet");
    expect(row("plan").summary).toBe("Done 3 February");
    expect(row("self-evaluation").summary).toBe("Done 20 December 2025");
  });

  it("says Reached, with the hours logged, once the total is reached", () => {
    const check = buildCmeYearCheck(SET, [entry({ id: "a", allocations: [{ category: "educational", hours: 52.5 }] })]);
    const total = check.rows.find((row) => row.id === "total")!;
    expect(total.ready).toBe(true);
    expect(total.summary).toBe("Reached · 52.5 h logged");
    expect(total.action).toBeNull();
    expect(check.rows.find((row) => row.id === "requirement-educational")!.summary).toBe("52.5 of 12.5 h · reached");
  });

  it("flags missing evidence, reflections and copies, and links to the filtered log", () => {
    const check = buildCmeYearCheck(SET, [
      entry({ id: "a", evidenceCount: 0, reflection: "  ", transcribed: false }),
      entry({ id: "b" }),
    ]);
    const evidence = check.rows.find((row) => row.id === "evidence")!;
    expect(evidence).toMatchObject({ ready: false, entryIds: ["a"], summary: "1 activity with no evidence attached" });
    expect(evidence.action?.href).toBe("/cme/log?year=2026&fix=evidence");
    expect(check.rows.find((row) => row.id === "reflection")!.action?.href).toBe("/cme/log?year=2026&fix=reflection");
    expect(check.rows.find((row) => row.id === "copied")!.action?.href).toBe("/cme/log?year=2026&copy=todo");
  });

  it("says Not checked, never ready and never missing, when counts were never loaded", () => {
    const check = buildCmeYearCheck(SET, [
      entry({ id: "a", evidenceCount: undefined }),
      entry({ id: "b", evidenceCount: 0 }),
    ]);
    const evidence = check.rows.find((row) => row.id === "evidence")!;
    expect(evidence).toEqual({
      id: "evidence",
      group: "records",
      label: "Evidence kept for each activity",
      ready: false,
      notChecked: true,
      summary: "Not checked",
      entryIds: [],
      action: null,
    });
    // Not counted as done.
    expect(check.readyCount).toBe(check.rows.filter((row) => row.ready).length);
    expect(check.rows.filter((row) => row.ready)).not.toContain(evidence);
  });

  it("says No activities yet, never that every activity has evidence, when nothing is logged", () => {
    const evidence = buildCmeYearCheck(SET, []).rows.find((row) => row.id === "evidence")!;
    // Still nothing outstanding (the first test in this file pins that for every record row).
    expect(evidence).toMatchObject({ ready: true, summary: "No activities yet", entryIds: [], action: null });
    expect(evidence.notChecked).toBeUndefined();
  });

  it("counts evidence normally once every activity has a count", () => {
    const check = buildCmeYearCheck(SET, [entry({ id: "a", evidenceCount: 2 })]);
    const evidence = check.rows.find((row) => row.id === "evidence")!;
    expect(evidence.notChecked).toBeUndefined();
    expect(evidence).toMatchObject({
      ready: true,
      summary: "Every activity has a certificate or other evidence attached",
    });
  });

  it("sends a missing plan to the plan page and a missing domain to the log", () => {
    const check = buildCmeYearCheck(SET, []);
    expect(check.rows.find((row) => row.id === "requirement-plan")!.action?.href).toBe("/cme/plan");
    expect(check.rows.find((row) => row.id === "requirement-domains")!.action?.href).toBe("/cme/log?year=2026");
  });
});

describe("CME calendar events", () => {
  const routine: CmeRoutine = {
    id: "jc",
    title: "Journal club",
    cadence: "monthly",
    usualHours: 1,
    usualAllocations: [],
    nextDue: "2026-09-15",
    archivedAt: null,
  };

  it("shows the RANZCP reporting date only for a RANZCP-confirmed year", () => {
    expect(cmeReportingCloseDate(SET)).toBe("2027-03-01");
    expect(cmeReportingCloseDate({ ...SET, confirmedSource: "My own targets" })).toBeNull();
  });

  it("repeats routines, keeps logged activities out of the export, and skips archived routines", () => {
    const { shown, exported } = cmeCalendarEvents({
      set: SET,
      entries: [entry({ id: "a", date: "2026-09-02" })],
      routines: [routine, { ...routine, id: "old", archivedAt: "2026-01-01" }],
    });
    expect(shown.some((event) => event.kind === "logged")).toBe(true);
    expect(exported.some((event) => event.kind === "logged")).toBe(false);
    expect(exported.filter((event) => event.kind === "due")).toHaveLength(1);
    const october = expandEvents(shown, { start: "2026-10-01", end: "2026-10-31" });
    expect(october.find((event) => event.title === "Journal club")?.date).toBe("2026-10-15");
    expect(exported.map((event) => event.date)).toEqual(
      expect.arrayContaining(["2026-12-17", "2026-12-31", "2027-03-01"]),
    );
  });
});
