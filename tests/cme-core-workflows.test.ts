import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  cmeEntryCreateSchema,
  cmeEntryUpdateSchema,
  cmeRoutineCreateSchema,
  cmeRoutineUpdateSchema,
  cmeYearConfirmSchema,
} from "@/lib/cme/schemas";
import { createAustralianRanzcpPreset } from "@/lib/cme/presets";
import { cmeYearConfigurationState } from "@/lib/cme/year-configuration";
import { evaluateYear } from "@/lib/cme/evaluate";
import {
  confirmCmeYear,
  fetchOwnerCmeEntry,
  fetchOwnerCmeRoutines,
  saveCmeEntry,
  saveCmeRoutine,
} from "@/lib/cme/repository";
import type { CmeEntry } from "@/lib/cme/types";
import { cmeEntryVersion } from "@/lib/cme/entry-version";

const entry: CmeEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  date: "2026-09-22",
  title: "Synthetic peer group",
  allocations: [{ category: "reviewing", hours: 2 }],
  formalPeerReviewHours: 1.5,
  reflection: "",
  costCents: null,
  transcribed: false,
  routineId: null,
  documentId: null,
  buckets: ["Ethical practice"],
};
const routine = {
  title: "Synthetic group",
  cadence: "monthly",
  usualHours: 2,
  usualAllocations: [{ category: "reviewing", hours: 2 }],
  nextDue: "2026-09-22",
  archivedAt: null,
};
const migration = readFileSync("supabase/migrations/20260922163920_cme_core_workflows.sql", "utf8");

describe("CME coherent workflow validation", () => {
  it.each(["2026-02-29", "2026-02-30", "2026-13-01", "2026-04-31"])("rejects impossible activity date %s", (date) =>
    expect(cmeEntryCreateSchema.safeParse({ ...entry, date }).success).toBe(false),
  );
  it("accepts leap day and refuses credit outside reviewing allocations", () => {
    expect(cmeEntryCreateSchema.safeParse({ ...entry, date: "2024-02-29" }).success).toBe(true);
    expect(cmeEntryCreateSchema.safeParse({ ...entry, formalPeerReviewHours: 2.5 }).success).toBe(false);
    expect(cmeEntryCreateSchema.safeParse({ ...entry, formalPeerReviewHours: -1 }).success).toBe(false);
    expect(
      cmeEntryCreateSchema.safeParse({ ...entry, allocations: [{ category: "educational", hours: 2 }] }).success,
    ).toBe(false);
  });
  it("rejects duplicate categories, over-day hours, and duplicate domain labels", () => {
    expect(
      cmeEntryCreateSchema.safeParse({ ...entry, allocations: [...entry.allocations, ...entry.allocations] }).success,
    ).toBe(false);
    expect(
      cmeEntryCreateSchema.safeParse({
        ...entry,
        allocations: [
          { category: "educational", hours: 24 },
          { category: "reviewing", hours: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      cmeEntryCreateSchema.safeParse({ ...entry, buckets: ["Ethical practice", "Ethical practice"] }).success,
    ).toBe(false);
  });
  it("requires complete edit fields including credit so omitted values cannot erase history", () => {
    expect(cmeEntryUpdateSchema.safeParse({ title: "Correction" }).success).toBe(false);
    expect(cmeEntryUpdateSchema.safeParse({ ...entry, formalPeerReviewHours: undefined }).success).toBe(false);
    expect(cmeEntryUpdateSchema.safeParse(entry).success).toBe(true);
  });
  it("validates every requirement and completion date atomically", () => {
    const preset = createAustralianRanzcpPreset(2026, "2026-09-22");
    expect(cmeYearConfirmSchema.safeParse(preset).success).toBe(true);
    expect(
      cmeYearConfirmSchema.safeParse({
        ...preset,
        requirements: [...preset.requirements, { ...preset.requirements[0], id: "new", spec: { shape: "made-up" } }],
      }).success,
    ).toBe(false);
    expect(
      cmeYearConfirmSchema.safeParse({ ...preset, requirements: [...preset.requirements, preset.requirements[0]] })
        .success,
    ).toBe(false);
    expect(
      cmeYearConfirmSchema.safeParse({
        ...preset,
        requirements: [{ ...preset.requirements[0], completedOn: "2026-09-22" }],
      }).success,
    ).toBe(false);
  });
  it("counts explicit peer credit without inflating hours or treating all review as formal", () => {
    const result = evaluateYear({
      set: createAustralianRanzcpPreset(2026, "2026-09-22"),
      entries: [entry, { ...entry, id: "other", formalPeerReviewHours: 0 }],
    });
    expect(result.totalHours).toBe(4);
    expect(result.statuses.find((s) => s.requirementId === "peer-review")?.progress).toEqual({
      value: 1.5,
      target: 10,
    });
    expect(result.statuses.find((s) => s.requirementId === "domains")?.progress).toEqual({ value: 1, target: 4 });
  });
  it("validates complete routine edits and coherent allocation totals", () => {
    expect(cmeRoutineCreateSchema.safeParse(routine).success).toBe(true);
    expect(cmeRoutineUpdateSchema.safeParse({ archivedAt: "2026-09-22T12:00:00Z" }).success).toBe(false);
    expect(cmeRoutineCreateSchema.safeParse({ ...routine, usualHours: 3 }).success).toBe(false);
    expect(cmeRoutineCreateSchema.safeParse({ ...routine, nextDue: "2026-02-30" }).success).toBe(false);
    expect(cmeRoutineUpdateSchema.safeParse({ ...routine, archivedAt: "2026-09-22T12:00:00Z" }).success).toBe(true);
  });
});

describe("CME transaction boundaries and owner scoping", () => {
  it("does not fall back to partial writes when the year transaction fails", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "private database details" } }),
      from: vi.fn(),
    };
    await expect(
      confirmCmeYear(client as never, "owner", createAustralianRanzcpPreset(2026, "2026-09-22")),
    ).rejects.toThrow("CME storage operation failed.");
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls[0][1].p_owner_id).toBe("owner");
  });
  it("submits a complete edit without allowing client transcription state to overwrite stored state", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: { activity_date: entry.date, id: entry.id, title: entry.title, cme_allocations: entry.allocations },
        error: null,
      }),
    };
    await saveCmeEntry(client as never, "owner", "year", { ...entry, version: cmeEntryVersion(entry) });
    const args = client.rpc.mock.calls[0][1];
    expect(args.p_create).toBe(false);
    expect(args.p_entry).not.toHaveProperty("transcribed");
    expect(args.p_entry.formalPeerReviewHours).toBe(1.5);
    expect(args.p_entry.expectedVersion).toEqual(cmeEntryVersion(entry));
  });
  it("safely reports closed-year rejection from the transaction", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "cme_year_closed" } }) };
    await expect(
      saveCmeEntry(client as never, "owner", "year", { ...entry, version: cmeEntryVersion(entry) }),
    ).rejects.toMatchObject({ status: 409, details: { code: "cme_year_closed" } });
  });
  it("looks up entry IDs with an owner predicate and returns the same missing result", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) };
    expect(await fetchOwnerCmeEntry(client as never, "owner", entry.id)).toBeNull();
    expect(chain.eq).toHaveBeenCalledWith("owner_id", "owner");
    expect(chain.eq).toHaveBeenCalledWith("id", entry.id);
  });
  it("bounds routine reads and scopes archives to the authenticated owner", async () => {
    const row = {
      id: "routine",
      title: "Group",
      cadence: "monthly",
      usual_hours: 2,
      usual_allocations: [],
      next_due: null,
      archived_at: null,
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [row], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(chain) };
    expect(await fetchOwnerCmeRoutines(client as never, "owner")).toHaveLength(1);
    await saveCmeRoutine(
      client as never,
      "owner",
      { ...routine, cadence: "monthly", usualAllocations: [], archivedAt: "2026-09-22T12:00:00Z" },
      "routine",
    );
    expect(chain.eq).toHaveBeenCalledWith("owner_id", "owner");
    expect(chain.eq).toHaveBeenCalledWith("id", "routine");
  });
  it("restricts RPC execution and pins transactional concurrency/ownership safeguards", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("foreign key(year_id, owner_id)");
    expect(migration).toContain("foreign key(entry_id, owner_id)");
    expect(migration).toContain("foreign key(routine_id, owner_id)");
    expect(migration).toContain("deferrable initially deferred");
    expect(migration).not.toContain("exception when");
  });
  it("returns identical create retries before routine advancement and rejects changed payloads", () => {
    expect(migration.indexOf("if v_existing.request_payload is distinct from p_entry")).toBeLessThan(
      migration.indexOf("update public.cme_routines set next_due"),
    );
    expect(migration).toContain("owner_id=p_owner_id and request_id=p_request_id");
    expect(migration).toContain("cme_retry_conflict");
    expect(migration).toContain("if p_create and v_routine.id is not null");
    expect(migration).toContain("unique index cme_entries_owner_request");
  });
});

describe("CME joined allocation relation", () => {
  it("selects the composite owner FK explicitly when two allocation relationships exist", () => {
    const source = readFileSync("src/lib/cme/repository.ts", "utf8");
    expect(source).not.toContain('.select("*, cme_allocations(category, hours)")');
    expect(
      source.match(
        /\.select\("\*, cme_allocations!cme_allocations_entry_owner_fk\(category, hours\)"(?:, \{ count: "exact" \})?\)/g,
      )?.length,
    ).toBe(4);
  });
});

describe("complete year confirmation gates", () => {
  it("shares complete/provenance/corruption decisions between page loading and API writes", () => {
    const complete = createAustralianRanzcpPreset(2026, "2026-01-02");
    expect(cmeYearConfigurationState(complete)).toBe("ready");
    expect(cmeYearConfigurationState({ ...complete, requirements: [] })).toBe("unconfigured");
    expect(cmeYearConfigurationState({ ...complete, confirmedSource: " " })).toBe("unconfigured");
    expect(cmeYearConfigurationState({ ...complete, confirmedOn: "2026-02-30" })).toBe("unconfigured");
    expect(cmeYearConfigurationState({ ...complete, totalHours: -1 })).toBe("unavailable");
    for (const path of ["src/app/api/cme/entries/route.ts", "src/app/api/cme/entries/[id]/route.ts"]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('cmeYearConfigurationState(yearRow) !== "ready"');
      expect(source).toContain('code: "cme_year_not_confirmed"');
      expect(source).toContain('code: "cme_year_unavailable"');
    }
    const repository = readFileSync("src/lib/cme/repository.ts", "utf8");
    expect(repository).toContain('cmeYearConfigurationState(confirmedYear) !== "ready"');
  });
});
