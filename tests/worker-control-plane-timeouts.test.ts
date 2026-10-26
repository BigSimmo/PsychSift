import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKER_CONTROL_PLANE_TIMEOUT_MS,
  WORKER_SUPABASE_TIMEOUT_MS,
  controlPlaneAbortSignal,
  ensureAbortableQuery,
  resolveWorkerControlPlaneTimeoutMs,
  resolveWorkerSupabaseTimeoutMs,
  withControlPlaneAbortClient,
} from "../worker/behavior";
import {
  getWorkerHealthSnapshot,
  isWorkerClaimLoopPaused,
  resetHealthStateForTests,
  setClaimLoopPausedForTests,
} from "../worker/health";
import { runWorkerLoop } from "../worker/run-loop";
import { WorkerRuntimeControl } from "../worker/runtime-control";

describe("worker pause and finite control-plane deadlines (R01, R18, R34)", () => {
  const originalPaused = process.env.WORKER_PAUSED;
  const originalClaimEnabled = process.env.WORKER_CLAIM_LOOP_ENABLED;

  afterEach(() => {
    resetHealthStateForTests();
    if (originalPaused === undefined) delete process.env.WORKER_PAUSED;
    else process.env.WORKER_PAUSED = originalPaused;

    if (originalClaimEnabled === undefined) delete process.env.WORKER_CLAIM_LOOP_ENABLED;
    else process.env.WORKER_CLAIM_LOOP_ENABLED = originalClaimEnabled;
  });

  it("recognizes WORKER_PAUSED=true and WORKER_CLAIM_LOOP_ENABLED=false", () => {
    expect(isWorkerClaimLoopPaused({})).toBe(false);
    expect(isWorkerClaimLoopPaused({ WORKER_PAUSED: "true" })).toBe(true);
    expect(isWorkerClaimLoopPaused({ WORKER_PAUSED: "1" })).toBe(true);
    expect(isWorkerClaimLoopPaused({ WORKER_PAUSED: "false" })).toBe(false);
    expect(isWorkerClaimLoopPaused({ WORKER_CLAIM_LOOP_ENABLED: "false" })).toBe(true);
    expect(isWorkerClaimLoopPaused({ WORKER_CLAIM_LOOP_ENABLED: "0" })).toBe(true);
    expect(isWorkerClaimLoopPaused({ WORKER_CLAIM_LOOP_ENABLED: "true" })).toBe(false);
  });

  it("fails closed on unrecognised pause values (ING-S-N4)", () => {
    expect(isWorkerClaimLoopPaused({ WORKER_PAUSED: "yes" })).toBe(true);
    expect(isWorkerClaimLoopPaused({ WORKER_PAUSED: "paused" })).toBe(true);
    expect(isWorkerClaimLoopPaused({ WORKER_PAUSED: " off " })).toBe(false);
    expect(isWorkerClaimLoopPaused({ WORKER_PAUSED: "" })).toBe(false);
    expect(isWorkerClaimLoopPaused({ WORKER_CLAIM_LOOP_ENABLED: "disabled" })).toBe(true);
  });

  it("skips claiming jobs when paused while logging pause state and respecting --once / sleep", async () => {
    const controller = new WorkerRuntimeControl();
    const claim = vi.fn(async () => []);
    const processJob = vi.fn(async () => {});
    const probe = vi.fn(async () => ({ ok: true }));
    const logs: Array<{ message: string; level: string; extra?: Record<string, unknown> }> = [];

    await runWorkerLoop({
      once: true,
      pollMs: 10,
      healthBackoffMs: 20,
      maxClaimFailures: 3,
      claim,
      process: processJob,
      probe,
      backoff: () => 10,
      controller,
      isPaused: () => true,
      log: (message, level, extra) => logs.push({ message, level, extra }),
    });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(claim).not.toHaveBeenCalled();
    expect(processJob).not.toHaveBeenCalled();
    expect(logs).toContainEqual({
      message: "Worker claim loop is paused; skipping job claim",
      level: "info",
      extra: { claimLoopPaused: true },
    });
  });

  it("exposes claimLoopPaused and deploymentCommitSha on WorkerHealthSnapshot", async () => {
    setClaimLoopPausedForTests(true);
    const snapshot = await getWorkerHealthSnapshot();

    expect(snapshot.claimLoopPaused).toBe(true);
    expect(snapshot.claimScope).toMatchObject({ restricted: expect.any(Boolean), error: null });
    expect("deploymentCommitSha" in snapshot).toBe(true);
    expect(snapshot.deploymentCommitSha === null || /^[a-f0-9]{40}$/.test(snapshot.deploymentCommitSha)).toBe(true);
  });

  it("resolves finite control-plane and Supabase client timeouts with safe defaults", () => {
    expect(WORKER_CONTROL_PLANE_TIMEOUT_MS).toBe(30_000);
    expect(WORKER_SUPABASE_TIMEOUT_MS).toBe(240_000);
    expect(resolveWorkerControlPlaneTimeoutMs({})).toBe(30_000);
    expect(resolveWorkerControlPlaneTimeoutMs({ WORKER_CONTROL_PLANE_TIMEOUT_MS: "15000" })).toBe(15_000);
    expect(resolveWorkerSupabaseTimeoutMs({})).toBe(240_000);
    expect(resolveWorkerSupabaseTimeoutMs({ WORKER_DATA_PLANE_TIMEOUT_MS: "300000" })).toBe(300_000);
    expect(resolveWorkerSupabaseTimeoutMs({ WORKER_SUPABASE_TIMEOUT_MS: "90000" })).toBe(90_000);
  });

  it("combines stopSignal and timeout in controlPlaneAbortSignal and aborts hung queries", async () => {
    const stopController = new AbortController();
    const signal = controlPlaneAbortSignal(stopController.signal, 5_000);
    expect(signal.aborted).toBe(false);

    stopController.abort(new Error("worker_stopping"));
    expect(signal.aborted).toBe(true);

    // Also verify timeout-driven abort on a hung query without native .abortSignal
    const hungPromise = new Promise<{ data: null; error: null }>(() => {});
    const abortable = ensureAbortableQuery(hungPromise).abortSignal(controlPlaneAbortSignal(undefined, 25));

    await expect(abortable).rejects.toThrow();
  });

  it("attaches abortSignal to PostgREST RPC and table select builders via withControlPlaneAbortClient", async () => {
    const observedRpcSignals: AbortSignal[] = [];
    const observedSelectSignals: AbortSignal[] = [];

    const mockClient = {
      rpc: vi.fn((...args: unknown[]) => {
        void args;
        const builder = {
          abortSignal(sig: AbortSignal) {
            observedRpcSignals.push(sig);
            return builder;
          },
          then(resolve: (val: unknown) => unknown) {
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
        return builder;
      }),
      from: vi.fn((...tableArgs: unknown[]) => {
        void tableArgs;
        return {
          select: vi.fn((...selectArgs: unknown[]) => {
            void selectArgs;
            const selectBuilder = {
              abortSignal(sig: AbortSignal) {
                observedSelectSignals.push(sig);
                return selectBuilder;
              },
              eq(...eqArgs: unknown[]) {
                void eqArgs;
                return selectBuilder;
              },
              then(resolve: (val: unknown) => unknown) {
                return Promise.resolve({ data: [], error: null }).then(resolve);
              },
            };
            return selectBuilder;
          }),
        };
      }),
    };

    const wrapped = withControlPlaneAbortClient(mockClient);
    await wrapped.rpc("claim_ingestion_jobs", {});
    await wrapped.from("documents").select("id").eq("id", "doc-1");

    expect(observedRpcSignals).toHaveLength(1);
    expect(observedRpcSignals[0]).toBeInstanceOf(AbortSignal);
    expect(observedSelectSignals).toHaveLength(1);
    expect(observedSelectSignals[0]).toBeInstanceOf(AbortSignal);
  });

  it("eliminates createAdminClient({ timeoutMs: null }) and wires controlPlaneAbortSignal across worker/main.ts", () => {
    const workerMainSource = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");

    expect(workerMainSource).not.toContain("createAdminClient({ timeoutMs: null })");
    expect(workerMainSource).toContain("createAdminClient({ timeoutMs: resolveWorkerSupabaseTimeoutMs(process.env) })");
    expect(workerMainSource).toContain("probeSupabaseHealth(supabase, controlPlaneAbortSignal(controller.signal))");
    expect(workerMainSource).toContain('.rpc("claim_ingestion_jobs"');
    expect(workerMainSource).toContain('.rpc("analyze_rag_tables")');
    expect(workerMainSource).toContain("patchDocumentState");
    expect(workerMainSource).toContain(".abortSignal(controlPlaneAbortSignal(");
  });
});
