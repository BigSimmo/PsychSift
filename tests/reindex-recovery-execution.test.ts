import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReindex } from "../scripts/reindex";
import { runIngestionRecovery } from "../scripts/recover-ingestion-queue";

const mocks = vi.hoisted(() => ({ client: vi.fn(), confirm: vi.fn(), spawn: vi.fn() }));
vi.mock("@next/env", () => ({ loadEnvConfig: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { WORKER_STALE_AFTER_MINUTES: 45 }, requireServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.client }));
vi.mock("@/lib/supabase/health", () => ({ assertSupabaseHealthy: vi.fn(), probeSupabaseHealth: vi.fn() }));
vi.mock("@/lib/supabase/project", () => ({
  checkSupabaseProjectConfig: () => ({ status: "ok" }),
  expectedSupabaseProject: { name: "synthetic", ref: "synthetic" },
  formatSupabaseProjectCheck: vi.fn(),
}));
vi.mock("../scripts/cli-utils", () => ({ confirm: mocks.confirm }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

type Row = Record<string, unknown>;

// In-memory PostgREST subset: filters are evaluated when awaited, just as writes
// are checked against current rows, rather than blindly returning successful mocks.
function queueFixture() {
  const document: Row = { id: "doc-a", owner_id: "owner-a", status: "processing", page_count: 3, chunk_count: 5 };
  const job: Row = {
    id: "job-a",
    document_id: "doc-a",
    status: "processing",
    locked_at: "2020-01-01T00:00:00.000Z",
    locked_by: "old-worker",
    attempt_count: 2,
  };
  let index = ["existing-chunk"];
  let beforeWrite: ((table: string, patch: Row) => { message: string } | void) | undefined;
  const writes: Array<{ table: string; patch: Row; matched: boolean }> = [];
  const rpc = vi.fn(async () => {
    index = [];
    return { error: null };
  });
  const client = {
    rpc,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Row | undefined;
      let head = false;
      const query = {
        select(_columns: string, options?: { head?: boolean }) {
          head = options?.head ?? false;
          return query;
        },
        update(value: Row) {
          patch = value;
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return query;
        },
        is(key: string, value: unknown) {
          filters.push((row) => (row[key] ?? null) === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        order() {
          return query;
        },
        or() {
          filters.push((row) => !row.locked_at || Date.parse(String(row.locked_at)) < Date.now() - 45 * 60_000);
          return query;
        },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve()
            .then(() => {
              if (patch) {
                const error = beforeWrite?.(table, patch);
                if (error) return { data: null, error };
              }
              const row = table === "documents" ? document : job;
              const matched = filters.every((filter) => filter(row));
              if (patch) {
                writes.push({ table, patch, matched });
                if (matched) Object.assign(row, patch);
              }
              if (head) return { count: matched ? 1 : 0, error: null };
              return {
                data: matched
                  ? [{ ...row, ...(table === "ingestion_jobs" ? { documents: { ...document } } : {}) }]
                  : [],
                error: null,
              };
            })
            .then(resolve, reject);
        },
      };
      return query;
    },
  };
  return {
    client,
    document,
    job,
    rpc,
    writes,
    index: () => index,
    beforeWrite: (callback: (table: string, patch: Row) => { message: string } | void) => {
      beforeWrite = callback;
    },
    complete: () => {
      job.status = "completed";
      job.locked_by = null;
      document.status = "indexed";
      index = ["fresh-chunk"];
    },
    renew: () => {
      job.locked_at = new Date().toISOString();
      job.locked_by = "fresh-worker";
    },
  };
}

describe.each([
  ["consolidated", () => runReindex(["--max-rounds", "1"])],
  ["standalone", () => runIngestionRecovery([])],
] as const)("%s guarded recovery execution", (_name, run) => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.confirm.mockResolvedValue(true);
    // Never launch a real worker; finish its synthetic process immediately.
    mocks.spawn.mockImplementation(() => ({
      on(event: string, callback: (code: number) => void) {
        if (event === "close") callback(0);
      },
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  it("preserves a fresh index when the job completes during confirmation", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    mocks.confirm.mockImplementation(async () => {
      state.complete();
      return true;
    });
    await run();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.index()).toEqual(["fresh-chunk"]);
    expect(state.job.status).toBe("completed");
    expect(state.document.status).toBe("indexed");
    expect(state.writes).toHaveLength(0);
  });

  it("preserves worker ownership when the lease renews during confirmation", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    mocks.confirm.mockImplementation(async () => {
      state.renew();
      return true;
    });
    await run();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.job.locked_by).toBe("fresh-worker");
    expect(state.job.status).toBe("processing");
    expect(state.index()).toEqual(["existing-chunk"]);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("loses the conditional claim safely when the lease changes after re-reading", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.beforeWrite((table) => {
      if (table === "ingestion_jobs") state.renew();
    });
    await run();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.job.locked_by).toBe("fresh-worker");
    expect(state.document.chunk_count).toBe(5);
  });

  it.each(["status", "owner_id"])("preserves index when document %s changes after the claim", async (field) => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.beforeWrite((table) => {
      if (table === "documents") state.document[field] = field === "status" ? "indexed" : "owner-b";
    });
    await run();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.index()).toEqual(["existing-chunk"]);
    expect(state.document.chunk_count).toBe(5);
    expect(state.job.locked_by).toBeNull();
  });

  it("claims the unchanged job before reset and releases it for retry", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.rpc.mockImplementation(async () => {
      expect(state.job.status).toBe("processing");
      expect(state.job.locked_by).toMatch(/^recovery:/);
      return { error: null };
    });
    await run();
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("reset_document_index", { p_document_id: "doc-a" });
    expect(state.job.status).toBe("pending");
    expect(state.job.locked_by).toBeNull();
    expect(state.job.attempt_count).toBe(0);
    expect(state.document.status).toBe("queued");
    expect(console.log).toHaveBeenCalledWith("Ingestion queue recovery applied (superseded 0, requeued 1).");
  });

  it("releases its claim into a retryable failure when reset throws", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.rpc.mockRejectedValue(new Error("synthetic reset failure"));
    await expect(run()).rejects.toThrow("synthetic reset failure");
    expect(state.job.status).toBe("failed");
    expect(state.job.locked_by).toBeNull();
    expect(state.job.locked_at).toBeNull();
    expect(state.job.error_message).toContain("interrupted");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("reports a lost claim without counting a requeue when ownership changes during reset", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.rpc.mockImplementation(async () => {
      state.renew();
      return { error: null };
    });
    await run();
    expect(state.job.status).toBe("processing");
    expect(state.job.locked_by).toBe("fresh-worker");
    expect(state.job.attempt_count).toBe(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("recovery claim changed before requeue"));
    expect(console.log).toHaveBeenCalledWith("Ingestion queue recovery applied (superseded 0, requeued 0).");
    expect(console.log).not.toHaveBeenCalledWith("Ingestion queue recovery applied (superseded 0, requeued 1).");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("reports a lost claim when the document changed before reset", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.beforeWrite((table, patch) => {
      if (table === "documents") state.document.status = "indexed";
      if (table === "ingestion_jobs" && patch.stage === "recovery: released, document changed state") state.renew();
    });
    await run();
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.index()).toEqual(["existing-chunk"]);
    expect(state.job.status).toBe("processing");
    expect(state.job.locked_by).toBe("fresh-worker");
    expect(state.job.attempt_count).toBe(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("recovery claim changed before release"));
    expect(console.log).toHaveBeenCalledWith("Ingestion queue recovery applied (superseded 0, requeued 0).");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("reports a lost cleanup claim while preserving the reset failure and replacement owner", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.rpc.mockImplementation(async () => {
      state.renew();
      throw new Error("synthetic reset failure");
    });
    await expect(run()).rejects.toThrow("synthetic reset failure");
    expect(state.job.status).toBe("processing");
    expect(state.job.locked_by).toBe("fresh-worker");
    expect(state.job.attempt_count).toBe(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("recovery claim changed before failure cleanup"));
    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Ingestion queue recovery applied"));
  });

  it("raises a real requeue error and releases its claim into a retryable failure", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.beforeWrite((table, patch) => {
      if (table === "ingestion_jobs" && patch.stage === "queued after recovery") {
        return { message: "synthetic requeue failure" };
      }
      return undefined;
    });
    await expect(run()).rejects.toMatchObject({
      name: "SupabaseRecoveryError",
      message: "synthetic requeue failure",
      stage: "requeue ingestion job",
    });
    expect(state.job.status).toBe("failed");
    expect(state.job.locked_by).toBeNull();
    expect(state.job.locked_at).toBeNull();
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Ingestion queue recovery applied"));
  });

  it("raises a real release error after the document changed without resetting its index", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.beforeWrite((table, patch) => {
      if (table === "documents") state.document.status = "indexed";
      if (table === "ingestion_jobs" && patch.stage === "recovery: released, document changed state") {
        return { message: "synthetic release failure" };
      }
      return undefined;
    });
    await expect(run()).rejects.toMatchObject({
      name: "SupabaseRecoveryError",
      message: "synthetic release failure",
      stage: "release recovery lock",
    });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.index()).toEqual(["existing-chunk"]);
    expect(state.job.locked_by).toBeNull();
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Ingestion queue recovery applied"));
  });

  it("logs a real cleanup error while retaining the original reset failure", async () => {
    const state = queueFixture();
    mocks.client.mockReturnValue(state.client);
    state.rpc.mockRejectedValue(new Error("synthetic reset failure"));
    state.beforeWrite((table, patch) => {
      if (table === "ingestion_jobs" && patch.stage === "recovery: interrupted after index reset") {
        return { message: "synthetic cleanup failure" };
      }
      return undefined;
    });
    await expect(run()).rejects.toThrow("synthetic reset failure");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to release the recovery lock on job job-a"),
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("attempt budget"));
    expect(state.job.locked_by).toMatch(/^recovery:/);
    expect(state.job.status).toBe("processing");
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Ingestion queue recovery applied"));
  });
});
