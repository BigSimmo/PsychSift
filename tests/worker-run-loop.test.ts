import { describe, expect, it, vi } from "vitest";
import { WorkerRuntimeControl } from "../worker/runtime-control";
import { runWorkerLoop } from "../worker/run-loop";
import type { JobRow } from "../worker/types";
import { runEdgeJobBatch } from "../supabase/functions/indexing-v3-agent/behavior";

function fakeJob(id = "job-1"): JobRow {
  return {
    id,
    document_id: "doc-1",
    batch_id: null,
    attempt_count: 0,
    max_attempts: 3,
    documents: {
      id: "doc-1",
      owner_id: null,
      title: "Test",
      file_name: "test.pdf",
      file_type: "application/pdf",
      storage_path: "docs/test.pdf",
      metadata: null,
    },
  };
}

describe("runWorkerLoop", () => {
  it("continues the Edge batch when processing and failure recording both throw", async () => {
    const jobs = [{ id: "edge-1" }, { id: "edge-2" }];
    const process = vi.fn().mockRejectedValueOnce(new Error("process boom")).mockResolvedValueOnce("completed");
    const recordFailure = vi.fn().mockRejectedValueOnce(new Error("failure recorder boom"));

    const outcomes = await runEdgeJobBatch(jobs, process, recordFailure);

    expect(process).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual([
      {
        job: jobs[0],
        error: "process boom",
        failureRecordingError: "failure recorder boom",
      },
      { job: jobs[1], result: "completed" },
    ]);
  });

  it("exits immediately when no jobs are available and once is set", async () => {
    const ctrl = new WorkerRuntimeControl();
    const claim = vi.fn().mockResolvedValue([]);
    const probe = vi.fn().mockResolvedValue({ ok: true });

    await runWorkerLoop({
      once: true,
      pollMs: 1000,
      healthBackoffMs: 1000,
      maxClaimFailures: 3,
      claim,
      process: vi.fn(),
      probe,
      backoff: (n) => n * 10,
      controller: ctrl,
      log: () => {},
    });

    expect(claim).toHaveBeenCalledOnce();
  });

  it("drains an active batch before exiting after stop", async () => {
    const ctrl = new WorkerRuntimeControl();
    const job = fakeJob();
    const processFn = vi.fn().mockImplementation(async () => {
      ctrl.stop();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const claim = vi.fn().mockResolvedValueOnce([job]).mockResolvedValue([]);
    const probe = vi.fn().mockResolvedValue({ ok: true });

    await runWorkerLoop({
      once: false,
      pollMs: 1000,
      healthBackoffMs: 1000,
      maxClaimFailures: 3,
      claim,
      process: processFn,
      probe,
      backoff: (n) => n * 10,
      controller: ctrl,
      log: () => {},
    });

    expect(processFn).toHaveBeenCalledWith(job);
    expect(ctrl.isStopped).toBe(true);
    expect(claim).toHaveBeenCalledOnce();
  });

  it("does not claim new jobs after stop during probe", async () => {
    const ctrl = new WorkerRuntimeControl();
    let probeCount = 0;
    const claim = vi.fn().mockResolvedValue([fakeJob()]);
    const probe = vi.fn().mockImplementation(async () => {
      probeCount += 1;
      if (probeCount === 1) {
        ctrl.stop();
      }
      return { ok: true };
    });

    await runWorkerLoop({
      once: false,
      pollMs: 1000,
      healthBackoffMs: 1000,
      maxClaimFailures: 3,
      claim,
      process: vi.fn(),
      probe,
      backoff: (n) => n * 10,
      controller: ctrl,
      log: () => {},
    });

    expect(ctrl.isStopped).toBe(true);
    expect(claim).not.toHaveBeenCalled();
  });

  it("aborts with exit code 1 in once mode when probe fails", async () => {
    const ctrl = new WorkerRuntimeControl();
    const probe = vi.fn().mockResolvedValue({ ok: false, message: "down" });

    await expect(
      runWorkerLoop({
        once: true,
        pollMs: 1000,
        healthBackoffMs: 1000,
        maxClaimFailures: 3,
        claim: vi.fn(),
        process: vi.fn(),
        probe,
        backoff: (n) => n * 10,
        controller: ctrl,
        log: () => {},
      }),
    ).rejects.toThrow("Supabase health check failed in --once mode");
  });

  it("backs off and does not throw when claim fails and failures are below threshold", async () => {
    const ctrl = new WorkerRuntimeControl();
    const claim = vi.fn().mockRejectedValue(new Error("claim error"));
    const probe = vi.fn().mockResolvedValue({ ok: true });

    setTimeout(() => ctrl.stop(), 250);

    await runWorkerLoop({
      once: false,
      pollMs: 1000,
      healthBackoffMs: 1000,
      maxClaimFailures: 3,
      claim,
      process: vi.fn(),
      probe,
      backoff: (n) => n * 10,
      controller: ctrl,
      log: () => {},
    });

    expect(claim).toHaveBeenCalled();
  });

  it("captures claim exceptions only on the threshold transition", async () => {
    const ctrl = new WorkerRuntimeControl();
    const claim = vi.fn().mockRejectedValue(new Error("claim error"));
    const probe = vi.fn().mockResolvedValue({ ok: true });
    const captureException = vi.fn();

    setTimeout(() => ctrl.stop(), 200);

    await runWorkerLoop({
      once: false,
      pollMs: 1000,
      healthBackoffMs: 20,
      maxClaimFailures: 2,
      claim,
      process: vi.fn(),
      probe,
      backoff: () => 10,
      controller: ctrl,
      log: () => {},
      captureException,
    });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toBe("claim");
  });

  it("captures process exceptions without aborting the batch", async () => {
    const ctrl = new WorkerRuntimeControl();
    const jobs = [fakeJob("job-1"), fakeJob("job-2")];
    const processFn = vi.fn().mockRejectedValueOnce(new Error("process boom")).mockResolvedValueOnce(undefined);
    const captureException = vi.fn();
    const claim = vi.fn().mockResolvedValueOnce(jobs).mockResolvedValue([]);

    await runWorkerLoop({
      once: true,
      pollMs: 1000,
      healthBackoffMs: 1000,
      maxClaimFailures: 3,
      claim,
      process: processFn,
      probe: vi.fn().mockResolvedValue({ ok: true }),
      backoff: (n) => n * 10,
      controller: ctrl,
      log: () => {},
      captureException,
    });

    expect(processFn).toHaveBeenCalledTimes(2);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toBe("process");
  });
});
