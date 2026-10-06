import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), demo: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/auth", () => {
  class AuthenticationError extends Error {}
  return {
    requireAuthenticatedUser: mocks.auth,
    resolveOptionalAuthentication: vi.fn(),
    AuthenticationError,
    unauthorizedResponse: () => Response.json({ message: "Sign in" }, { status: 401 }),
  };
});
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
  rateLimitJsonResponse: () => Response.json({ code: "rate_limited" }, { status: 429 }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { POST as logToCpd } from "@/app/api/teaching/cpd/route";
import { AuthenticationError } from "@/lib/supabase/auth";
import { teachingCpdEntryHref } from "@/lib/teaching/model";
import { TEACHING_CPD_NOT_ENDED_MESSAGE, teachingErrors } from "@/lib/teaching/repository";

const actor = "11111111-1111-4111-8111-111111111111";
const occurrenceId = "33333333-3333-4333-8333-333333333333";
const requestId = "55555555-5555-4555-8555-555555555555";
const entryId = "66666666-6666-4666-8666-666666666666";

function post(body: unknown) {
  return new Request("https://psychiatry.example/api/teaching/cpd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Fails closed when the migration is absent. `TEACHING_MIGRATION_SQL` points a local run at the
 * migration file before the database PR has merged; it is never needed once it has.
 */
function teachingMigration(): string {
  const file = readdirSync("supabase/migrations").find((name) => name.endsWith("_teaching_mode.sql"));
  if (file) return readFileSync(`supabase/migrations/${file}`, "utf8");
  const local = process.env.TEACHING_MIGRATION_SQL;
  if (local) return readFileSync(local, "utf8");
  throw new Error("The Teaching migration (<stamp>_teaching_mode.sql) must be on this branch before PR A.");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demo.mockReturnValue(false);
  mocks.auth.mockResolvedValue({ id: actor });
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.rpc.mockResolvedValue({ data: { entryId, created: true }, error: null });
});

describe("POST /api/teaching/cpd", () => {
  it("saves through the CPD function only, for the signed-in doctor, and answers with the entry alone", async () => {
    mocks.rpc.mockResolvedValue({ data: { entryId, created: true, title: "Invented journal club" }, error: null });
    const response = await logToCpd(post({ occurrenceId, hours: 1.25, requestId }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ entryId, created: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("cme_save_teaching_entry", {
      p_owner_id: actor,
      p_occurrence_id: occurrenceId,
      p_hours: 1.25,
      p_request_id: requestId,
    });
  });

  it("answers a retried tap with the same entry, not a new one", async () => {
    mocks.rpc.mockResolvedValue({ data: { entryId, created: false }, error: null });
    const response = await logToCpd(post({ occurrenceId, hours: 1, requestId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ entryId, created: false });
  });

  it("links the reflection to the CPD entry it made", () => {
    expect(teachingCpdEntryHref(entryId)).toBe(`/cme/log/${entryId}`);
  });

  // Master plan R20: the 8-hour cap matches cme_save_teaching_entry.
  it.each([0, 0.3, 8.25, 24.25, -1])("refuses %s hours before the database", async (hours) => {
    const response = await logToCpd(post({ occurrenceId, hours, requestId }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("accepts the full 8 hours", async () => {
    expect((await logToCpd(post({ occurrenceId, hours: 8, requestId }))).status).toBe(200);
  });

  it("says to use quarter hours in words", async () => {
    const response = await logToCpd(post({ occurrenceId, hours: 1.1, requestId }));
    expect(await response.json()).toMatchObject({ message: "Use quarter hours." });
  });

  it("refuses a body that names its owner", async () => {
    const response = await logToCpd(post({ occurrenceId, hours: 1, requestId, ownerId: occurrenceId }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["cme_year_missing", "cme_year_closed", "teaching_not_attended", "cme_retry_conflict"])(
    "explains %s in plain words",
    async (code) => {
      mocks.rpc.mockResolvedValue({ data: null, error: { message: code } });
      const response = await logToCpd(post({ occurrenceId, hours: 1, requestId }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code, message: teachingErrors[code].message });
    },
  );

  // The SQL raises teaching_window_closed while the session has not ended; the shared message
  // talks about check-in, which would mislead someone logging CPD.
  it("says the session has not ended yet, not that check-in is closed", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "teaching_window_closed" } });
    const response = await logToCpd(post({ occurrenceId, hours: 1, requestId }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ code: "teaching_window_closed", message: TEACHING_CPD_NOT_ENDED_MESSAGE });
    expect(body.message).not.toMatch(/check-in/i);
  });

  it("never uses the word verified or CME in what a doctor reads", () => {
    const messages = [
      TEACHING_CPD_NOT_ENDED_MESSAGE,
      ...["cme_year_missing", "cme_year_closed", "teaching_not_attended", "cme_retry_conflict"].map(
        (code) => teachingErrors[code].message,
      ),
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/verified/i);
      expect(message).not.toMatch(/\bCME\b/);
    }
  });

  it("says Teaching is being set up when the CPD function is not live yet", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Could not find the function", code: "PGRST202" } });
    const response = await logToCpd(post({ occurrenceId, hours: 1, requestId }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "teaching_setup_pending" });
  });

  it("fails closed when the database answers without an entry id", async () => {
    mocks.rpc.mockResolvedValue({ data: { created: true }, error: null });
    const response = await logToCpd(post({ occurrenceId, hours: 1, requestId }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "teaching_unavailable" });
  });

  it("refuses a signed-out caller before the database", async () => {
    mocks.auth.mockRejectedValue(new AuthenticationError());
    expect((await logToCpd(post({ occurrenceId, hours: 1, requestId }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never saves in demo mode", async () => {
    mocks.demo.mockReturnValue(true);
    expect((await logToCpd(post({ occurrenceId, hours: 1, requestId }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("links run one way, into CPD (plan-contracts §10)", () => {
  it("never saves through CPD's generic entries API or writes a Teaching audit row", () => {
    const route = readFileSync("src/app/api/teaching/cpd/route.ts", "utf8");
    const repository = readFileSync("src/lib/teaching/repository.ts", "utf8");
    expect(route).not.toMatch(/\/api\/cme\/entries|@\/lib\/cme\//);
    expect(repository).not.toMatch(/@\/lib\/cme\//);
    const save = repository.slice(repository.indexOf("export async function saveTeachingCpdEntry"));
    expect(save).not.toContain("teachingCommand(");
  });

  it("opens Teaching from CPD's Teaching sessions card", () => {
    const dashboard = readFileSync("src/components/cme/cme-dashboard.tsx", "utf8");
    // The Year page's "Teaching you gave" row: Teaching's review list when it has a count, Teaching itself otherwise.
    expect(dashboard).toMatch(
      /testId="cme-teaching-link"\s+href=\{teachingCount !== null \? "\/teaching\/review" : "\/teaching"\}/,
    );
    expect(dashboard).not.toContain('href="/on-call/education"');
  });
});

describe("the CPD save matches its database function", () => {
  it("calls cme_save_teaching_entry with the migration's exact argument names", () => {
    const sql = teachingMigration();
    expect(sql).toContain(
      "function public.cme_save_teaching_entry(p_owner_id uuid, p_occurrence_id uuid, p_hours numeric, p_request_id uuid) returns jsonb",
    );
    // R20: the same 8-hour ceiling as the request schema.
    expect(sql).toMatch(/v_hours < 0\.25 or v_hours > 8 then raise exception 'teaching_invalid_request'/);
    expect(sql).toContain("jsonb_build_object('entryId', v_entry.id, 'created', true)");
  });
});
