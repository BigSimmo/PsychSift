import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  auth: vi.fn(),
  demo: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
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
vi.mock("@/lib/cme/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cme/repository")>();
  return { ...actual, fetchOwnerCmeYear: vi.fn(async () => ({ id: YEAR_ID, year: 2026 })) };
});

import { PUT as setGoal } from "@/app/api/cme/entries/[id]/goal/route";
import { PUT as savePlan } from "@/app/api/cme/plan/route";
import { cmePlanGoalsSaveSchema, hoursByGoal } from "@/lib/cme/plan-goals";
import type { CmeEntry } from "@/lib/cme/types";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";
const GOAL = "33333333-3333-4333-8333-333333333333";
const YEAR_ID = "44444444-4444-4444-8444-444444444444";

function put(url: string, body: unknown) {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.auth.mockResolvedValue({ id: OWNER });
  mocks.rate.mockResolvedValue({ limited: false });
});

describe("plan goals API", () => {
  it("saves the year's goals through the owner-locked function, with the owner from the session", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: GOAL, goal: "Document capacity well", sortOrder: 0 }], error: null });
    const response = await savePlan(
      put("http://localhost/api/cme/plan", {
        year: 2026,
        goals: [{ goal: "  Document capacity well " }],
        expectedGoals: [],
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("cme_save_plan_goals_checked", {
      p_owner_id: OWNER,
      p_year_id: YEAR_ID,
      p_goals: [{ goal: "Document capacity well" }],
      p_expected_goals: [],
    });
    expect(await response.json()).toEqual({
      year: 2026,
      goals: [{ id: GOAL, goal: "Document capacity well", sortOrder: 0 }],
    });
  });

  it("uses an exact goal snapshot so a stale editor cannot erase or overwrite a carried goal", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: GOAL, goal: "Document capacity", sortOrder: 0 }], error: null });
    const response = await savePlan(
      put("http://localhost/api/cme/plan", {
        year: 2026,
        goals: [{ id: GOAL, goal: "Document capacity" }],
        expectedGoals: [{ id: GOAL, goal: "Document capacity" }],
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("cme_save_plan_goals_checked", {
      p_owner_id: OWNER,
      p_year_id: YEAR_ID,
      p_goals: [{ id: GOAL, goal: "Document capacity" }],
      p_expected_goals: [{ id: GOAL, goal: "Document capacity" }],
    });
  });

  it("returns a conflict when the saved goal text, order or IDs changed", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "cme_plan_conflict" } });
    const response = await savePlan(put("http://localhost/api/cme/plan", { year: 2026, goals: [], expectedGoals: [] }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("cme_plan_conflict");
  });

  it("rejects old saves without a baseline instead of risking deletion of a carried goal", async () => {
    const response = await savePlan(put("http://localhost/api/cme/plan", { year: 2026, goals: [] }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses in demo mode and never writes", async () => {
    mocks.demo.mockReturnValue(true);
    const response = await savePlan(put("http://localhost/api/cme/plan", { year: 2026, goals: [] }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a closed year to a plain 409", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "cme_year_closed" } });
    const response = await savePlan(
      put("http://localhost/api/cme/plan", { year: 2026, goals: [{ goal: "Abc" }], expectedGoals: [] }),
    );
    expect(response.status).toBe(409);
  });

  it("sets and clears an activity's goal", async () => {
    mocks.rpc.mockResolvedValue({ data: { entryId: ENTRY, goalId: GOAL }, error: null });
    const context = { params: Promise.resolve({ id: ENTRY }) };
    expect(
      (await setGoal(put(`http://localhost/api/cme/entries/${ENTRY}/goal`, { goalId: GOAL }), context)).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("cme_set_entry_goal", {
      p_owner_id: OWNER,
      p_entry_id: ENTRY,
      p_goal_id: GOAL,
    });
    await setGoal(put(`http://localhost/api/cme/entries/${ENTRY}/goal`, { goalId: null }), context);
    expect(mocks.rpc).toHaveBeenLastCalledWith("cme_set_entry_goal", {
      p_owner_id: OWNER,
      p_entry_id: ENTRY,
      p_goal_id: null,
    });
  });

  it("refuses to link a goal to an archived activity with a plain 409", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "cme_entry_archived" } });
    const response = await setGoal(put(`http://localhost/api/cme/entries/${ENTRY}/goal`, { goalId: GOAL }), {
      params: Promise.resolve({ id: ENTRY }),
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an id that is not a uuid, before touching the database", async () => {
    const response = await setGoal(put("http://localhost/api/cme/entries/nope/goal", { goalId: null }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("plan goal rules", () => {
  it("accepts up to ten goals of 3 to 300 characters", () => {
    expect(cmePlanGoalsSaveSchema.safeParse({ year: 2026, goals: [{ goal: "ab" }] }).success).toBe(false);
    expect(
      cmePlanGoalsSaveSchema.safeParse({ year: 2026, goals: Array.from({ length: 11 }, () => ({ goal: "Goal" })) })
        .success,
    ).toBe(false);
    expect(cmePlanGoalsSaveSchema.safeParse({ year: 2026, goals: [{ goal: "Abc" }], expectedGoals: [] }).success).toBe(
      true,
    );
  });

  it("adds up hours per goal, leaving archived activities out", () => {
    const base = {
      title: "x",
      reflection: "",
      costCents: null,
      transcribed: false,
      routineId: null,
      documentId: null,
      buckets: [],
    };
    const entries: CmeEntry[] = [
      { ...base, id: "a", date: "2026-02-01", allocations: [{ category: "educational", hours: 2 }], goalId: GOAL },
      { ...base, id: "b", date: "2026-02-02", allocations: [{ category: "reviewing", hours: 1.5 }], goalId: null },
      {
        ...base,
        id: "c",
        date: "2026-02-03",
        allocations: [{ category: "reviewing", hours: 9 }],
        goalId: GOAL,
        archivedAt: "2026-03-01",
      },
    ];
    expect(hoursByGoal([{ id: GOAL, goal: "G", sortOrder: 0 }], entries)).toEqual([
      { goal: { id: GOAL, goal: "G", sortOrder: 0 }, hours: 2, entryCount: 1 },
      { goal: null, hours: 1.5, entryCount: 1 },
    ]);
  });
});

describe("plan goals migration", () => {
  const sql = readFileSync("supabase/migrations/20260925102600_cme_plan_goals.sql", "utf8");

  it("keeps both tables service-role only with RLS on", () => {
    expect(sql).toContain("array['cme_plan_goals', 'cme_entry_goals']");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table public.%I from public, anon, authenticated");
  });

  it("freezes goals and links with a closed year, and ties both to the owner", () => {
    expect(sql).toMatch(/create trigger cme_plan_goal_closed_year_guard[\s\S]*on public\.cme_plan_goals/);
    expect(sql).toMatch(/create trigger cme_entry_goal_guard[\s\S]*on public\.cme_entry_goals/);
    expect(sql).toContain("foreign key (entry_id, owner_id)");
    expect(sql).toContain("foreign key (goal_id, owner_id)");
    expect(sql).toContain("foreign key (year_id, owner_id)");
  });

  it("refuses a goal link on an archived activity, in the function rather than the link trigger", () => {
    const setGoalFn = sql.slice(sql.indexOf("create function public.cme_set_entry_goal"));
    expect(setGoalFn).toMatch(/if v_archived_at is not null then raise exception 'cme_entry_archived'/);
    // Deleting a goal cascades to its links; the trigger must not block that for archived activities.
    const trigger = sql.slice(
      sql.indexOf("create function public.cme_guard_entry_goal"),
      sql.indexOf("create trigger cme_entry_goal_guard"),
    );
    expect(trigger).not.toContain("archived_at");
  });

  it("changes no existing table or function", () => {
    expect(sql).not.toMatch(/alter table public\.cme_(entries|years|requirements|allocations)/);
    expect(sql).not.toMatch(/create or replace function/);
  });

  it("grants its functions to service_role only", () => {
    for (const fn of ["cme_save_plan_goals", "cme_set_entry_goal", "cme_guard_plan_goal", "cme_guard_entry_goal"]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`),
      );
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
    }
  });
});

describe("entry goal lookup", () => {
  it("reads a large year's goal links in batches, so no request URL carries every activity id", async () => {
    const entryIds = Array.from(
      { length: 250 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const batches: string[][] = [];
    const client = {
      from: (table: string) => {
        expect(table).toBe("cme_entry_goals");
        let ids: string[] = [];
        const chain = {
          select: () => chain,
          eq: (column: string, value: string) => {
            expect([column, value]).toEqual(["owner_id", OWNER]);
            return chain;
          },
          in: (column: string, values: string[]) => {
            expect(column).toBe("entry_id");
            ids = values;
            batches.push(values);
            return chain;
          },
          limit: async () => ({ data: ids.slice(0, 1).map((id) => ({ entry_id: id, goal_id: GOAL })), error: null }),
        };
        return chain;
      },
    };
    const { fetchOwnerCmeEntryGoals } = await import("@/lib/cme/plan-goals-repository");
    const links = await fetchOwnerCmeEntryGoals(client as never, OWNER, entryIds);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(entryIds);
    expect(links).toEqual({ [entryIds[0]]: GOAL, [entryIds[100]]: GOAL, [entryIds[200]]: GOAL });
  });
});
