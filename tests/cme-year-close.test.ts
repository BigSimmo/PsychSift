import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  auth: vi.fn(),
  demo: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: mocks.auth,
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));

import { POST as closeYear } from "@/app/api/cme/year/close/route";
import { PATCH as patchEntry } from "@/app/api/cme/entries/[id]/route";
import { DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import { amendClosedCmeEntry, closeCmeYear, cmeRepositoryError, fetchOwnerCmeYearClose } from "@/lib/cme/repository";
import { cmeEntryAmendSchema, cmeYearCloseSchema } from "@/lib/cme/schemas";
import type { CmeEntry } from "@/lib/cme/types";
import { cmeEntryVersion } from "@/lib/cme/entry-version";
import {
  buildCmeCloseEvaluation,
  canCloseCmeYear,
  closedRequirementSummaryText,
  cmeYearClosableFromLabel,
  rowsToCmeYearClose,
} from "@/lib/cme/year-close";

const OWNER = "11111111-1111-4111-8111-111111111111";
const YEAR_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_ID = "33333333-3333-4333-8333-333333333333";

const entry: CmeEntry = {
  id: ENTRY_ID,
  date: "2025-03-01",
  title: "Journal club",
  allocations: [{ category: "educational", hours: 2 }],
  reflection: "",
  costCents: null,
  transcribed: false,
  routineId: null,
  documentId: null,
  sourceUrl: null,
  buckets: [],
  formalPeerReviewHours: 0,
};

/** A thenable query chain resolving to one queued response per `.from()` call. */
function chain(response: { data: unknown; error: { message: string } | null; count?: number }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle", "single", "update", "insert"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve);
  return builder as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
}

describe("when a CPD year can be closed", () => {
  it("opens in the last fortnight (Perth), not before", () => {
    expect(canCloseCmeYear(new Date("2026-12-15T15:00:00Z"), 2026)).toBe(false); // 15 Dec 23:00 Perth
    expect(canCloseCmeYear(new Date("2026-12-16T16:30:00Z"), 2026)).toBe(true); // 17 Dec 00:30 Perth
    expect(canCloseCmeYear(new Date("2026-09-19T02:00:00Z"), 2026)).toBe(false);
  });
  it("stays open for any past year and never opens for a future one", () => {
    expect(canCloseCmeYear(new Date("2027-03-01T02:00:00Z"), 2026)).toBe(true);
    expect(canCloseCmeYear(new Date("2026-12-28T02:00:00Z"), 2027)).toBe(false);
  });
  it("names the first closable date", () => {
    expect(cmeYearClosableFromLabel(2026)).toBe("17 December 2026");
  });
});

describe("the evaluation recorded at closing", () => {
  it("counts only active activities, matching what the database checks", () => {
    const set = { ...DEMO_CME_YEAR, year: 2025 };
    const evaluation = buildCmeCloseEvaluation(set, [
      entry,
      { ...entry, id: "archived", archivedAt: "2025-04-01T00:00:00Z" },
    ]);
    expect(evaluation.entryCount).toBe(1);
    expect(evaluation.totalHours).toBe(2);
    expect(evaluation.requirements).toHaveLength(set.requirements.length);
    expect(evaluation.requirements[0]).toEqual(
      expect.objectContaining({ requirementId: set.requirements[0]!.id, label: set.requirements[0]!.label }),
    );
  });
  it("binds every evaluation input even when hours and entry count are unchanged", () => {
    const set = { ...DEMO_CME_YEAR, year: 2025 };
    const original = buildCmeCloseEvaluation(set, [entry]);
    const changes = [
      buildCmeCloseEvaluation(set, [{ ...entry, allocations: [{ category: "reviewing", hours: 2 }] }]),
      buildCmeCloseEvaluation(set, [{ ...entry, formalPeerReviewHours: 1 }]),
      buildCmeCloseEvaluation(set, [{ ...entry, buckets: ["Changed practice domain"] }]),
      buildCmeCloseEvaluation({ ...set, totalHours: set.totalHours + 1 }, [entry]),
      buildCmeCloseEvaluation(
        {
          ...set,
          requirements: set.requirements.map((requirement, index) =>
            index === 0 ? { ...requirement, completedOn: "2025-03-02" } : requirement,
          ),
        },
        [entry],
      ),
      buildCmeCloseEvaluation(
        {
          ...set,
          requirements: set.requirements.map((requirement, index) =>
            index === 0 ? { ...requirement, spec: { shape: "task" as const } } : requirement,
          ),
        },
        [entry],
      ),
    ];
    expect(original).toHaveProperty("inputs");
    for (const changed of changes) {
      expect(changed.totalHours).toBe(original.totalHours);
      expect(changed.entryCount).toBe(original.entryCount);
      expect(changed.inputs).not.toEqual(original.inputs);
    }
  });

  it("canonicalizes row ordering without treating archived entries as evaluation inputs", () => {
    const set = { ...DEMO_CME_YEAR, year: 2025 };
    const first = {
      ...entry,
      allocations: [
        { category: "reviewing" as const, hours: 1 },
        { category: "educational" as const, hours: 1 },
      ],
    };
    const second = { ...entry, id: "44444444-4444-4444-8444-444444444444" };
    expect(buildCmeCloseEvaluation(set, [first, second]).inputs).toEqual(
      buildCmeCloseEvaluation({ ...set, requirements: [...set.requirements].reverse() }, [
        second,
        { ...first, allocations: [...first.allocations].reverse() },
        { ...entry, id: "archived", archivedAt: "2025-04-01T00:00:00Z" },
      ]).inputs,
    );
  });

  it("maps stored snapshot and amendment rows back into the record shown on the summary", () => {
    const close = rowsToCmeYearClose(
      {
        closed_at: "2025-12-20T01:00:00Z",
        shortfall_note: "Parental leave",
        total_hours: 45,
        target_hours: 50,
        record: { entries: [{}, {}] },
        evaluation: { requirements: [{ requirementId: "r1", label: "Total", met: false, summary: "5 hours short" }] },
      },
      [
        {
          id: "a1",
          entry_id: ENTRY_ID,
          amended_at: "2026-01-10T01:00:00Z",
          reason: "Certificate shows 4 hours",
          before: { date: "2025-03-01", title: "Journal club", allocations: [{ category: "educational", hours: 2 }] },
          after: { date: "2025-03-01", title: "Journal club", allocations: [{ category: "educational", hours: 4 }] },
        },
      ],
    );
    expect(close).toMatchObject({ shortfallNote: "Parental leave", totalHours: 45, targetHours: 50, entryCount: 2 });
    expect(close.requirements).toEqual([{ requirementId: "r1", label: "Total", met: false, summary: "5 hours short" }]);
    expect(close.amendments[0]!.after.allocations).toEqual([{ category: "educational", hours: 4 }]);
  });
});

describe("a closed year's stored summaries, as shown", () => {
  it("shows the old stored words in today's plain status, without changing what was stored", () => {
    expect(closedRequirementSummaryText("Met")).toBe("Reached");
    expect(closedRequirementSummaryText("5 hours short")).toBe("5 h to go");
    expect(closedRequirementSummaryText("1 hour short")).toBe("1 h to go");
    expect(closedRequirementSummaryText("2.5 hours short in measuring outcomes")).toBe(
      "2.5 h to go in measuring outcomes",
    );
  });

  it("passes every other summary through unchanged", () => {
    for (const summary of [
      "Reached",
      "3 h to go",
      "Ethical practice has nothing against it yet",
      "2 of 4 have nothing against them yet",
      "Done 12 January 2026",
      "Not started",
      "Metacognition workshop",
    ]) {
      expect(closedRequirementSummaryText(summary)).toBe(summary);
    }
  });
});

describe("year-close request schemas", () => {
  it("accepts a year with or without a note, and nothing else", () => {
    expect(cmeYearCloseSchema.safeParse({ year: 2025 }).success).toBe(true);
    expect(cmeYearCloseSchema.safeParse({ year: 2025, shortfallNote: "Leave" }).success).toBe(true);
    expect(cmeYearCloseSchema.safeParse({ year: 2025, closedAt: "2025-01-01" }).success).toBe(false);
    expect(cmeYearCloseSchema.safeParse({ year: 2025, shortfallNote: "x".repeat(2001) }).success).toBe(false);
  });
  it("requires a reason and a complete record for an amendment", () => {
    expect(cmeEntryAmendSchema.safeParse({ ...entry, amendmentReason: "Certificate says 4 h" }).success).toBe(true);
    expect(cmeEntryAmendSchema.safeParse({ ...entry, amendmentReason: "  " }).success).toBe(false);
    expect(cmeEntryAmendSchema.safeParse({ ...entry }).success).toBe(false);
    const { sourceUrl: _omitted, ...withoutSource } = entry;
    expect(_omitted).toBeNull();
    expect(cmeEntryAmendSchema.safeParse({ ...withoutSource, amendmentReason: "Reason" }).success).toBe(false);
  });
});

describe("year-close repository calls", () => {
  it("closes through one owner-scoped transaction and maps a stale evaluation to 409", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: {}, error: null }) };
    const evaluation = buildCmeCloseEvaluation({ ...DEMO_CME_YEAR, year: 2025 }, [entry]);
    await closeCmeYear(client as never, OWNER, YEAR_ID, evaluation, "Leave");
    expect(client.rpc).toHaveBeenCalledWith("cme_close_year_v2", {
      p_owner_id: OWNER,
      p_year_id: YEAR_ID,
      p_evaluation: evaluation,
      p_shortfall_note: "Leave",
    });
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: "cme_close_conflict" } });
    await expect(closeCmeYear(client as never, OWNER, YEAR_ID, evaluation, null)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("fails before writing when the complete-input RPC is unavailable, without a legacy fallback", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "PGRST202", message: "cme_close_year_v2 was not found" } });
    await expect(
      closeCmeYear(
        { rpc } as never,
        OWNER,
        YEAR_ID,
        buildCmeCloseEvaluation({ ...DEMO_CME_YEAR, year: 2025 }, [entry]),
        null,
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("cme_close_year_v2");
  });
  it("refuses to close without an owner", async () => {
    const client = { rpc: vi.fn() };
    await expect(
      closeCmeYear(client as never, "", YEAR_ID, buildCmeCloseEvaluation(DEMO_CME_YEAR, []), null),
    ).rejects.toThrow(/owner/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("sends an amendment with its reason and maps the database refusals", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          id: ENTRY_ID,
          activity_date: "2025-03-01",
          title: "Journal club",
          cme_allocations: [{ category: "educational", hours: 4 }],
        },
        error: null,
      }),
    };
    const amended = await amendClosedCmeEntry(
      client as never,
      OWNER,
      { ...entry, version: cmeEntryVersion(entry), allocations: [{ category: "educational", hours: 4 }] },
      "Certificate shows 4 hours",
    );
    expect(client.rpc).toHaveBeenCalledWith(
      "cme_amend_closed_entry_v2",
      expect.objectContaining({ p_owner_id: OWNER, p_entry_id: ENTRY_ID, p_reason: "Certificate shows 4 hours" }),
    );
    expect(amended.allocations).toEqual([{ category: "educational", hours: 4 }]);
    expect(cmeRepositoryError({ message: "cme_year_open" })).toMatchObject({ status: 409 });
    expect(cmeRepositoryError({ message: "cme_amendment_reason_invalid" })).toMatchObject({ status: 400 });
  });
  it("reads the snapshot and amendments with the owner on every query", async () => {
    const snapshot = chain({
      data: {
        closed_at: "2025-12-20T01:00:00Z",
        shortfall_note: null,
        total_hours: 2,
        target_hours: 50,
        record: { entries: [{}] },
        evaluation: {},
      },
      error: null,
    });
    const amendments = chain({ data: [], error: null });
    const from = vi.fn().mockReturnValueOnce(snapshot).mockReturnValueOnce(amendments);
    const close = await fetchOwnerCmeYearClose({ from } as never, OWNER, YEAR_ID);
    expect(from.mock.calls.map((call) => call[0])).toEqual(["cme_year_snapshots", "cme_year_amendments"]);
    expect(snapshot.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(amendments.eq).toHaveBeenCalledWith("owner_id", OWNER);
    expect(close?.entryCount).toBe(1);
  });
  it("returns null when a year has no snapshot", async () => {
    const from = vi.fn().mockReturnValueOnce(chain({ data: null, error: null }));
    await expect(fetchOwnerCmeYearClose({ from } as never, OWNER, YEAR_ID)).resolves.toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });
});

function closeRequest(body: unknown) {
  return new Request("http://localhost/api/cme/year/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const yearRow = (overrides: Record<string, unknown> = {}) => ({
  id: YEAR_ID,
  owner_id: OWNER,
  year: 2025,
  total_hours: 50,
  confirmed_on: "2025-01-02",
  confirmed_source: "Synthetic",
  closed_at: null,
  shortfall_note: null,
  created_at: "2025-01-02T00:00:00Z",
  updated_at: "2025-01-02T00:00:00Z",
  ...overrides,
});
const requirementRow = {
  id: "r1",
  owner_id: OWNER,
  year_id: YEAR_ID,
  label: "Professional development plan",
  source: "national",
  spec: { shape: "task" },
  completed_on: "2025-01-10",
  sort_order: 0,
  created_at: "2025-01-02T00:00:00Z",
};

describe("POST /api/cme/year/close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.demo.mockReturnValue(false);
    mocks.auth.mockResolvedValue({ id: OWNER });
    mocks.rate.mockResolvedValue({ limited: false });
  });

  it("refuses in demo mode without touching storage", async () => {
    mocks.demo.mockReturnValue(true);
    const response = await closeYear(closeRequest({ year: 2026 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "demo_mode_unavailable" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a year that is already closed", async () => {
    mocks.from
      .mockReturnValueOnce(chain({ data: yearRow({ closed_at: "2025-12-20T00:00:00Z" }), error: null }))
      .mockReturnValueOnce(chain({ data: [requirementRow], error: null }));
    const response = await closeYear(closeRequest({ year: 2025 }));
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses the current year before the last fortnight", async () => {
    const thisYear = Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth", year: "numeric" }).format(new Date()),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${thisYear}-06-01T02:00:00Z`));
    try {
      mocks.from
        .mockReturnValueOnce(chain({ data: yearRow({ year: thisYear }), error: null }))
        .mockReturnValueOnce(chain({ data: [requirementRow], error: null }));
      const response = await closeYear(closeRequest({ year: thisYear }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "cme_year_close_too_early" });
      expect(mocks.rpc).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a past year with the owner from the session and the note from the body", async () => {
    const entryRow = {
      id: ENTRY_ID,
      activity_date: "2025-03-01",
      title: "Journal club",
      reflection: "",
      cost_cents: null,
      transcribed_at: null,
      routine_id: null,
      document_id: null,
      buckets: [],
      archived_at: null,
      cme_allocations: [{ category: "educational", hours: 2 }],
    };
    mocks.from
      .mockReturnValueOnce(chain({ data: yearRow(), error: null }))
      .mockReturnValueOnce(chain({ data: [requirementRow], error: null }))
      .mockReturnValueOnce(chain({ data: [entryRow], error: null, count: 1 }))
      .mockReturnValueOnce(
        chain({
          data: {
            closed_at: "2026-01-05T00:00:00Z",
            shortfall_note: "Leave",
            total_hours: 2,
            target_hours: 50,
            record: { entries: [{}] },
            evaluation: {},
          },
          error: null,
        }),
      )
      .mockReturnValueOnce(chain({ data: [], error: null }));
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    const response = await closeYear(closeRequest({ year: 2025, shortfallNote: "  Leave  " }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "cme_close_year_v2",
      expect.objectContaining({
        p_owner_id: OWNER,
        p_year_id: YEAR_ID,
        p_shortfall_note: "Leave",
        p_evaluation: expect.objectContaining({ totalHours: 2, entryCount: 1 }),
      }),
    );
    expect((await response.json()).close).toMatchObject({ shortfallNote: "Leave", totalHours: 2 });
  });

  it("rejects an owner id or closing time smuggled in the body", async () => {
    const response = await closeYear(closeRequest({ year: 2025, ownerId: "someone-else" }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/cme/entries/[id] with an amendment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.demo.mockReturnValue(false);
    mocks.auth.mockResolvedValue({ id: OWNER });
    mocks.rate.mockResolvedValue({ limited: false });
  });
  const context = { params: Promise.resolve({ id: ENTRY_ID }) };
  const patch = (body: unknown) =>
    new Request(`http://localhost/api/cme/entries/${ENTRY_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("refuses an amendment with no usable reason before writing", async () => {
    const response = await patchEntry(patch({ ...entry, amendmentReason: " " }), context);
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records an amendment through the amendment transaction, not an ordinary save", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: ENTRY_ID,
        activity_date: "2025-03-01",
        title: "Journal club",
        cme_allocations: [{ category: "educational", hours: 4 }],
      },
      error: null,
    });
    const response = await patchEntry(
      patch({
        ...entry,
        allocations: [{ category: "educational", hours: 4 }],
        amendmentReason: "Certificate shows 4 hours",
        expectedVersion: cmeEntryVersion(entry),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0]![0]).toBe("cme_amend_closed_entry_v2");
    expect(mocks.rpc.mock.calls[0]![1].p_entry.expectedVersion).toEqual(cmeEntryVersion(entry));
    expect(mocks.rpc.mock.calls[0]![1]).toMatchObject({ p_owner_id: OWNER, p_reason: "Certificate shows 4 hours" });
  });

  it("preserves the loaded version through the full-edit route and reports a concurrent writer conflict", async () => {
    mocks.from
      .mockReturnValueOnce(chain({ data: { transcribed_at: null, source_url: null }, error: null }))
      .mockReturnValueOnce(chain({ data: yearRow(), error: null }))
      .mockReturnValueOnce(chain({ data: [requirementRow], error: null }));
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "cme_entry_conflict" } });
    const response = await patchEntry(
      patch({ ...entry, expectedVersion: cmeEntryVersion(entry), title: "Correction" }),
      context,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "cme_entry_conflict" });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "cme_save_entry_v2",
      expect.objectContaining({
        p_owner_id: OWNER,
        p_year_id: YEAR_ID,
        p_entry_id: ENTRY_ID,
        p_entry: expect.objectContaining({ expectedVersion: cmeEntryVersion(entry), title: "Correction" }),
      }),
    );
  });

  it("rejects an older amendment client without a loaded version before issuing a write", async () => {
    const response = await patchEntry(patch({ ...entry, amendmentReason: "Synthetic correction" }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "cme_entry_conflict" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("the year-close migration", () => {
  const sql = readFileSync("supabase/migrations/20260925064000_cme_year_close.sql", "utf8");
  it("keeps the new tables service-role only with RLS on, and grants no update or delete", () => {
    expect(sql).toMatch(/array\['cme_year_snapshots', 'cme_year_amendments'\]/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.%I from public, anon, authenticated/);
    expect(sql).toMatch(/grant select, insert on table public\.%I to service_role/);
    expect(sql).not.toMatch(/grant[^;]*\b(update|delete)\b[^;]*cme_year_(snapshots|amendments)/i);
  });
  it("uses invoker functions only, revoked from public, anon and authenticated", () => {
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toMatch(/revoke all on function[\s\S]*cme_close_year[\s\S]*from public, anon, authenticated/);
  });
  it("never lets closed_at be cleared, and sets it only beside a snapshot", () => {
    expect(sql).toMatch(/new\.closed_at is distinct from old\.closed_at[\s\S]*raise exception 'cme_year_closed'/);
    expect(sql).toMatch(/raise exception 'cme_year_close_requires_snapshot'/);
  });
});
