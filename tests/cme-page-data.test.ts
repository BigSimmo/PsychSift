import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  demo: vi.fn(),
  server: vi.fn(),
  admin: vi.fn(),
  year: vi.fn(),
  entries: vi.fn(),
  entry: vi.fn(),
  routines: vi.fn(),
  evidenceCounts: vi.fn(),
  certificateEntryIds: vi.fn(),
  planGoals: vi.fn(),
  entryGoals: vi.fn(),
  trainingPeriods: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.server }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/cme/evidence-repository", () => ({
  fetchCmeEvidenceCounts: mocks.evidenceCounts,
  fetchCmeCertificateEntryIds: mocks.certificateEntryIds,
}));
vi.mock("@/lib/cme/training-repository", () => ({ fetchOwnerTrainingPeriods: mocks.trainingPeriods }));
// Plan goals are read beside the entries; an empty plan leaves every assertion below unchanged.
vi.mock("@/lib/cme/plan-goals-repository", () => ({
  fetchOwnerCmePlanGoals: mocks.planGoals,
  fetchOwnerCmeEntryGoals: mocks.entryGoals,
}));
vi.mock("@/lib/cme/repository", () => ({
  fetchOwnerCmeYear: mocks.year,
  fetchOwnerCmeEntries: mocks.entries,
  fetchOwnerCmeEntry: mocks.entry,
  fetchOwnerCmeRoutines: mocks.routines,
}));
import { cmeDemoCarryPreview, loadCmePageData, loadCmeEntryPageData } from "@/lib/cme/load-cme-page-data";
import { createAustralianRanzcpPreset } from "@/lib/cme/presets";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.admin.mockReturnValue({});
  mocks.server.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner" } }, error: null }) },
  });
  mocks.year.mockResolvedValue(null);
  mocks.entries.mockResolvedValue([]);
  mocks.routines.mockResolvedValue([]);
  mocks.entry.mockResolvedValue(null);
  mocks.evidenceCounts.mockResolvedValue({});
  mocks.certificateEntryIds.mockResolvedValue(new Set());
  mocks.planGoals.mockResolvedValue([]);
  mocks.entryGoals.mockResolvedValue({});
  mocks.trainingPeriods.mockResolvedValue([]);
});
describe("CME page state is honest and owner-scoped", () => {
  it("distinguishes signed-out from unconfigured", async () => {
    mocks.server.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    });
    expect((await loadCmePageData(2025)).state).toBe("signed-out");
    expect(mocks.year).not.toHaveBeenCalled();
  });
  it("distinguishes unavailable configuration from missing year", async () => {
    mocks.server.mockResolvedValue(null);
    expect((await loadCmePageData(2025)).state).toBe("unavailable");
    expect(mocks.year).not.toHaveBeenCalled();
  });
  it("does not invite setup after database/auth failures", async () => {
    mocks.year.mockRejectedValue(new Error("private connection details"));
    const data = await loadCmePageData(2025);
    expect(data.state).toBe("unavailable");
    expect(JSON.stringify(data)).not.toContain("private connection");
    mocks.server.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError" } }),
      },
    });
    expect((await loadCmePageData()).state).toBe("unavailable");
  });
  it("returns routines alongside an unconfigured year without using demo records", async () => {
    mocks.routines.mockResolvedValue([{ id: "routine" }]);
    const data = await loadCmePageData(2025);
    expect(data.state).toBe("unconfigured");
    expect(data.demoMode).toBe(false);
    expect(data.entries).toEqual([]);
    expect(data.routines).toEqual([{ id: "routine" }]);
    expect(mocks.year).toHaveBeenCalledWith({}, "owner", 2025);
  });
  it("resolves an entry from its own year rather than assuming the current year", async () => {
    mocks.entry.mockResolvedValue({ id: "entry", date: "2024-02-29" });
    mocks.year.mockResolvedValue({ id: "year-2024", ...createAustralianRanzcpPreset(2024, "2024-01-02") });
    const data = await loadCmeEntryPageData("entry");
    expect(data.state).toBe("ready");
    expect(data.year).toBe(2024);
    expect(data.entry?.id).toBe("entry");
    expect(mocks.entry).toHaveBeenCalledWith({}, "owner", "entry");
    expect(mocks.year).toHaveBeenCalledWith({}, "owner", 2024);
    expect(mocks.entries).toHaveBeenCalledWith({}, "owner", "year-2024", {});
  });
  it("preserves historical entries and settings when a legacy year has no requirements", async () => {
    const legacy = { id: "legacy-year", ...createAustralianRanzcpPreset(2024, "2024-01-02"), requirements: [] };
    const historicalEntry = { id: "old-entry", date: "2024-02-29" };
    mocks.year.mockResolvedValue(legacy);
    mocks.entry.mockResolvedValue(historicalEntry);
    mocks.entries.mockResolvedValue([historicalEntry]);
    mocks.routines.mockResolvedValue([{ id: "routine" }]);
    const data = await loadCmeEntryPageData("old-entry");
    expect(data.state).toBe("unconfigured");
    expect(data.set).toEqual(legacy);
    expect(data.entries).toEqual([{ ...historicalEntry, evidenceCount: 0, certificateCount: 0 }]);
    expect(data.entry).toEqual({ ...historicalEntry, evidenceCount: 0, certificateCount: 0 });
    expect(data.routines).toEqual([{ id: "routine" }]);
    expect(data.year).toBe(2024);
  });
  it.each([{ confirmedSource: "  " }, { confirmedOn: "2026-02-30" }, { confirmedOn: "" }])(
    "requires explicit reconfirmation for incomplete provenance %j",
    async (invalidProvenance) => {
      const stored = { id: "year", ...createAustralianRanzcpPreset(2026, "2026-01-02"), ...invalidProvenance };
      mocks.year.mockResolvedValue(stored);
      mocks.entries.mockResolvedValue([{ id: "existing-entry" }]);
      const data = await loadCmePageData(2026);
      expect(data.state).toBe("unconfigured");
      expect(data.set).toEqual(stored);
      expect(data.entries).toEqual([{ id: "existing-entry", evidenceCount: 0, certificateCount: 0 }]);
    },
  );
  it("does not present corrupted requirement data as a clean setup opportunity", async () => {
    mocks.year.mockResolvedValue({
      id: "year",
      ...createAustralianRanzcpPreset(2026, "2026-01-02"),
      requirements: [
        { id: "broken", label: "Saved target", source: "college", completedOn: null, spec: { shape: "unknown" } },
      ],
    });
    const data = await loadCmePageData(2026);
    expect(data.state).toBe("unavailable");
    expect(data.set).toBeNull();
  });
  it("keeps a failed history read unavailable even when the year itself needs setup repair", async () => {
    mocks.year.mockResolvedValue({
      id: "legacy-year",
      ...createAustralianRanzcpPreset(2026, "2026-01-02"),
      requirements: [],
    });
    mocks.entries.mockRejectedValue(new Error("History read failed"));
    expect((await loadCmePageData(2026)).state).toBe("unavailable");
  });
  it("returns missing owner-scoped entry as null", async () => {
    expect((await loadCmeEntryPageData("other-owner-entry")).entry).toBeNull();
    expect(mocks.entry).toHaveBeenCalledWith({}, "owner", "other-owner-entry");
  });
  it("counts uploaded evidence separately from source links and fails honestly if counts are unavailable", async () => {
    mocks.year.mockResolvedValue({ id: "year", ...createAustralianRanzcpPreset(2026, "2026-01-02") });
    mocks.entries.mockResolvedValue([
      { id: "reading", sourceUrl: "https://example.com/source" },
      { id: "certificate" },
    ]);
    mocks.evidenceCounts.mockResolvedValue({ certificate: 2 });
    const data = await loadCmePageData(2026);
    expect(data.entries.map((entry) => entry.evidenceCount)).toEqual([0, 2]);
    expect(mocks.evidenceCounts).toHaveBeenCalledWith({}, "owner", 2026);
    mocks.certificateEntryIds.mockResolvedValue(new Set(["certificate"]));
    expect((await loadCmePageData(2026)).entries.map((entry) => entry.certificateCount)).toEqual([0, 1]);
    mocks.evidenceCounts.mockRejectedValue(new Error("Unavailable"));
    expect((await loadCmePageData(2026)).state).toBe("unavailable");
  });
  it("reads the year's entries, evidence counts and plan goals side by side, not one after another", async () => {
    mocks.year.mockResolvedValue({ id: "year", ...createAustralianRanzcpPreset(2026, "2026-01-02") });
    const entriesRead: { release?: () => void } = {};
    mocks.entries.mockImplementation(
      () =>
        new Promise((resolve) => {
          entriesRead.release = () => resolve([{ id: "entry" }]);
        }),
    );
    const loading = loadCmePageData(2026);
    await vi.waitFor(() => expect(mocks.entries).toHaveBeenCalled());
    // Each read crosses Singapore -> Sydney; these must not wait for the entry list.
    expect(mocks.evidenceCounts).toHaveBeenCalled();
    expect(mocks.planGoals).toHaveBeenCalled();
    expect(mocks.entryGoals).not.toHaveBeenCalled();
    entriesRead.release?.();
    const data = await loading;
    expect(data.state).toBe("ready");
    expect(mocks.entryGoals).toHaveBeenCalledWith({}, "owner", ["entry"]);
  });
  it("loads optional training and next-year context only for the verified owner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-28T02:00:00Z"));
    try {
      const current = { id: "year-2026", ...createAustralianRanzcpPreset(2026, "2026-01-02") };
      const next = { id: "year-2027", ...createAustralianRanzcpPreset(2027, "2027-01-02") };
      mocks.year.mockImplementation(async (_admin: unknown, _owner: string, year: number) =>
        year === 2026 ? current : next,
      );
      mocks.planGoals.mockImplementation(async (_admin: unknown, _owner: string, id: string) =>
        id === "year-2027" ? [{ id: "next-goal", goal: "Continue learning" }] : [],
      );
      mocks.trainingPeriods.mockResolvedValue([
        { id: "stage", kind: "stage", label: "Stage 2", startsOn: "2026-01-01", endsOn: "2026-12-31" },
      ]);
      const data = await loadCmePageData(2026, { trainingPosition: true, nextYear: true });
      expect(data.state).toBe("ready");
      expect(data.trainingPosition?.stage?.label).toBe("Stage 2");
      expect(data.nextYearConfirmed).toBe(true);
      expect(data.nextYearGoals?.map((goal) => goal.id)).toEqual(["next-goal"]);
      expect(mocks.trainingPeriods).toHaveBeenCalledWith({}, "owner");
      expect(mocks.year).toHaveBeenCalledWith({}, "owner", 2027);
      expect(mocks.planGoals).toHaveBeenCalledWith({}, "owner", "year-2027");
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps optional read failures distinct from missing next-year records", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-28T02:00:00Z"));
    try {
      const current = { id: "year-2026", ...createAustralianRanzcpPreset(2026, "2026-01-02") };
      mocks.year.mockImplementation(async (_admin: unknown, _owner: string, year: number) => {
        if (year === 2026) return current;
        throw new Error("next year unavailable");
      });
      mocks.trainingPeriods.mockRejectedValue(new Error("training unavailable"));
      const data = await loadCmePageData(2026, { trainingPosition: true, nextYear: true });
      expect(data.state).toBe("ready");
      expect(data.trainingPosition).toBeNull();
      expect(data.nextYearConfirmed).toBeNull();
      expect(data.nextYearGoals).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("local demo carry preview", () => {
  it("shows the demo plan in its December carry window, only when asked", async () => {
    mocks.demo.mockReturnValue(true);
    const plain = await loadCmePageData(undefined, { nextYear: true });
    expect(plain.nextYearConfirmed).toBeNull();
    const confirm = await loadCmePageData(undefined, { nextYear: true, demoCarryPreview: "confirm" });
    expect(confirm.now.toISOString()).toBe(`${confirm.year}-12-20T02:00:00.000Z`);
    expect(confirm.nextYearConfirmed).toBe(false);
    expect(confirm.nextYearGoals).toBeUndefined();
    const resume = await loadCmePageData(undefined, { nextYear: true, demoCarryPreview: "resume" });
    expect(resume.nextYearConfirmed).toBe(true);
    expect(resume.nextYearGoals).toEqual([]);
    expect(mocks.year).not.toHaveBeenCalled();
  });

  it("is ignored for a signed-in account", async () => {
    const data = await loadCmePageData(undefined, { nextYear: true, demoCarryPreview: "confirm" });
    expect(data.demoMode).toBe(false);
    expect(data.nextYearConfirmed).toBeNull();
  });

  it("reads only the two known values from the address bar", () => {
    expect(cmeDemoCarryPreview("confirm")).toBe("confirm");
    expect(cmeDemoCarryPreview("resume")).toBe("resume");
    expect(cmeDemoCarryPreview("approve")).toBeNull();
    expect(cmeDemoCarryPreview(["confirm"])).toBeNull();
  });
});
