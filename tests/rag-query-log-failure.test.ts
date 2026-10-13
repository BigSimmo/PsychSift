// tests/rag-query-log-failure.test.ts
//
// RAG query logging swallowed every insert failure, in BOTH of its paths.
//
// The obvious half was `void insertRagQuery(row).catch(() => undefined)` -- fire and forget with
// an empty catch. The half that mattered more was one line up: `await supabase.from("rag_queries")
// .insert(safeRow)` never destructured `error`. The Postgres client RESOLVES with `{ error }`
// rather than throwing, so a rejected insert -- a row-level-security denial, a constraint
// violation, a renamed column -- produced no rejection for that `.catch()` to see and no return
// value anyone read. Every failure looked exactly like a success.
//
// The consequence worth naming: `RAG_AWAIT_QUERY_LOGS` exists to make this logging reliable when
// it matters, and it was precisely as silent as the path it replaces. A flag that promises
// reliability and delivers none is worse than no flag.
//
// Raised by the 2026-09-17 external audit (its finding C9), which named the empty catch. The
// unread `error` was found while checking it.
//
// Scope, stated honestly: the legacy writer is reached only when no observation context is passed
// (`rag-programme-telemetry.ts` routes to `setRagQueryObservation` otherwise), and the live answer
// routes all pass one. So this is a narrow path, not the main one. The unread `error` is the
// general defect and is fixed for every caller of `insertRagQuery`.
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const mocks = vi.hoisted(() => ({ insert: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: mocks.insert }) }),
}));

let warn: MockInstance<Console["warn"]>;

beforeEach(() => {
  mocks.insert.mockReset();
  // Created per test: the global node setup restores every spy after each test.
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Reloads the module so `env` is re-parsed and the process-wide failure count starts clean. */
async function loadRag(awaitLogs: boolean) {
  vi.stubEnv("RAG_AWAIT_QUERY_LOGS", awaitLogs ? "true" : "false");
  vi.resetModules();
  const mod = await import("@/lib/rag/rag");
  mod.__resetQueryLogFailureCountForTests();
  return mod;
}

/** Flushes the microtask queue so a fire-and-forget rejection has run its handler. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("rag query log failures", () => {
  it("reports a rejected insert that the client resolved rather than threw", async () => {
    // The exact shape that used to be invisible: a resolved promise carrying an error.
    mocks.insert.mockResolvedValue({ error: { message: "new row violates row-level security policy" } });
    const { __logRagQueryForTests } = await loadRag(false);

    await __logRagQueryForTests({ query: "lithium monitoring" } as never);
    await settle();

    expect(warn).toHaveBeenCalledTimes(1);
    const [message, detail] = warn.mock.calls[0]!;
    expect(message).toBe("RAG query log insert failed");
    expect(detail).toMatchObject({ failures: 1, message: "rag_query_logging_failed" });
    expect(String((detail as { error: string }).error)).toContain("row-level security");
  });

  it("reports a failure on the awaited path too, which the reliability flag promised", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "column does not exist" } });
    const { __logRagQueryForTests } = await loadRag(true);

    // Still resolves: a failed log must never fail the clinical answer that produced it.
    await expect(__logRagQueryForTests({ query: "clozapine anc" } as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the insert succeeds", async () => {
    mocks.insert.mockResolvedValue({ error: null });
    const { __logRagQueryForTests } = await loadRag(false);

    await __logRagQueryForTests({ query: "sertraline dose" } as never);
    await settle();

    expect(warn).not.toHaveBeenCalled();
  });

  it("bounds the warnings so a broken database cannot flood the log", async () => {
    // Best-effort logging must stay observable without becoming the incident itself: the first
    // three failures, then every twenty-fifth. Same ladder as answer-telemetry.ts.
    mocks.insert.mockResolvedValue({ error: { message: "connection refused" } });
    const { __logRagQueryForTests } = await loadRag(true);

    for (let i = 0; i < 30; i += 1) await __logRagQueryForTests({ query: `q${i}` } as never);

    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls.at(-1)?.[1]).toMatchObject({ failures: 25 });
  });

  it("never puts the row in the warning", async () => {
    // The row carries the redacted query text and its metadata. A warn line is not a place for
    // either, and the redaction upstream is not a licence to log what is left.
    mocks.insert.mockResolvedValue({ error: { message: "insert failed" } });
    const { __logRagQueryForTests } = await loadRag(true);

    await __logRagQueryForTests({ query: "a very distinctive clinical question" } as never);

    expect(JSON.stringify(warn.mock.calls)).not.toContain("distinctive");
  });
});
