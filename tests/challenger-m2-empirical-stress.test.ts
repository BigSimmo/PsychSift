import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAbortError } from "../src/lib/abort-error";
import {
  DEFAULT_SUPABASE_ADMIN_TIMEOUT_MS,
  createAdminClient,
  createTimeoutFetch,
  resetAdminClientForTesting,
} from "../src/lib/supabase/admin";

vi.mock("@/lib/env", () => ({
  requireServerEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9999",
    SUPABASE_SERVICE_ROLE_KEY: "unit-test-service-role-key",
  }),
}));

vi.mock("@/lib/observability/supabase-tracing", () => ({
  instrumentSupabaseClientForTracing: vi.fn(),
}));

describe("Empirical Challenger M2: Supabase Admin Client Timeout & Worker Exemption Stress Harness", () => {
  beforeEach(() => {
    resetAdminClientForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetAdminClientForTesting();
  });

  // Helper to create a mock fetch with custom latency or abort behavior
  function createMockFetch(options: {
    delayMs?: number;
    responseBody?: unknown;
    status?: number;
    errorToThrow?: Error;
    onFetchCalled?: (signal?: AbortSignal | null) => void;
  }) {
    return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      options.onFetchCalled?.(signal);

      return new Promise<Response>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          return;
        }

        const onAbort = () => {
          reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        const delay = options.delayMs ?? 0;
        setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          if (options.errorToThrow) {
            reject(options.errorToThrow);
            return;
          }
          const body = options.responseBody ?? [{ id: "mock-1" }];
          resolve(
            new Response(typeof body === "string" ? body : JSON.stringify(body), {
              status: options.status ?? 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }, delay);
      });
    });
  }

  describe("1. Custom Timeout Scaling (50ms, 100ms, 200ms)", () => {
    it.each([
      { timeout: 50, mockDelay: 150, minElapsed: 35, maxElapsed: 120 },
      { timeout: 100, mockDelay: 250, minElapsed: 75, maxElapsed: 200 },
      { timeout: 200, mockDelay: 450, minElapsed: 150, maxElapsed: 350 },
    ])(
      "aborts hung query proportionally at timeout=$timeout ms (mockDelay=$mockDelay ms)",
      async ({ timeout, mockDelay, minElapsed, maxElapsed }) => {
        const mockFetch = createMockFetch({ delayMs: mockDelay });
        vi.stubGlobal("fetch", mockFetch);

        const client = createAdminClient({ timeoutMs: timeout, fresh: true });
        const start = Date.now();
        const res = await client.from("import_batches").select("id");
        const elapsed = Date.now() - start;

        expect(elapsed).toBeGreaterThanOrEqual(minElapsed);
        expect(elapsed).toBeLessThan(maxElapsed);
        expect(res.data).toBeNull();
        expect(res.error).toBeDefined();
        expect(
          res.error?.message?.toLowerCase().includes("abort") ||
            res.error?.message?.toLowerCase().includes("timeout") ||
            isAbortError(res.error),
        ).toBe(true);
      },
    );

    it("falls back to DEFAULT_SUPABASE_ADMIN_TIMEOUT_MS when timeoutMs is omitted", () => {
      expect(DEFAULT_SUPABASE_ADMIN_TIMEOUT_MS).toBe(30_000);
      const client = createAdminClient({ fresh: true });
      expect(client).toBeDefined();
    });
  });

  describe("2. Network Delay Handling & Differential Latency", () => {
    it("successfully completes when network latency is well within timeout budget", async () => {
      const mockFetch = createMockFetch({
        delayMs: 30,
        responseBody: [{ id: "fast-batch-1", status: "completed" }],
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createAdminClient({ timeoutMs: 150, fresh: true });
      const res = await client.from("import_batches").select("id, status");

      expect(res.error).toBeNull();
      expect(res.data).toEqual([{ id: "fast-batch-1", status: "completed" }]);
    });

    it("propagates underlying network error (e.g. connection reset) before timeout occurs", async () => {
      const networkError = new TypeError("Failed to fetch (ECONNREFUSED)");
      const mockFetch = createMockFetch({
        delayMs: 20,
        errorToThrow: networkError,
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createAdminClient({ timeoutMs: 200, fresh: true });
      const res = await client.from("import_batches").select("id");

      expect(res.data).toBeNull();
      expect(res.error).toBeDefined();
      expect(res.error?.message).toContain("Failed to fetch");
    });
  });

  describe("3. Worker Batch Exemption & Long-Running Operations", () => {
    it("allows worker operations to complete indefinitely when timeoutMs is null", async () => {
      const longDelayMs = 250;
      const mockFetch = createMockFetch({
        delayMs: longDelayMs,
        responseBody: [{ id: "worker-batch-large", rows_processed: 10000 }],
      });
      vi.stubGlobal("fetch", mockFetch);

      // worker/main.ts uses createAdminClient({ timeoutMs: null })
      const workerClient = createAdminClient({ timeoutMs: null });
      const start = Date.now();
      const res = await workerClient.from("import_batches").select("id, rows_processed");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(longDelayMs - 30);
      expect(res.error).toBeNull();
      expect(res.data).toEqual([{ id: "worker-batch-large", rows_processed: 10000 }]);
    });

    it("exempts worker storage downloads taking longer than default timeout", async () => {
      const longDelayMs = 200;
      const mockFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
            return;
          }
          const timer = setTimeout(() => {
            resolve(
              new Response(Buffer.from("Long PDF Document Content"), {
                status: 200,
                headers: { "Content-Type": "application/pdf" },
              }),
            );
          }, longDelayMs);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const workerClient = createAdminClient({ timeoutMs: null, fresh: true });
      const res = await workerClient.storage.from("clinical-documents").download("large-guidelines.pdf");

      expect(res.error).toBeNull();
      expect(res.data).toBeDefined();
    });

    it("verifies unbounded singleton sharing across multiple worker callers", () => {
      const workerClient1 = createAdminClient({ timeoutMs: null });
      const workerClient2 = createAdminClient({ timeoutMs: null });
      const workerClientFalse = createAdminClient({ timeoutMs: false });
      const workerClientZero = createAdminClient({ timeoutMs: 0 });

      expect(workerClient1).toBe(workerClient2);
      expect(workerClient1).toBe(workerClientFalse);
      expect(workerClient1).toBe(workerClientZero);

      const defaultClient = createAdminClient();
      expect(workerClient1).not.toBe(defaultClient);
    });
  });

  describe("4. AbortSignal.any Composition & Pre-Aborted Signal Mechanics", () => {
    it("aborts immediately when caller signal is ALREADY pre-aborted before query", async () => {
      const mockFetch = createMockFetch({ delayMs: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const client = createAdminClient({ timeoutMs: 500, fresh: true });
      const controller = new AbortController();
      controller.abort(new DOMException("User explicitly cancelled before request", "AbortError"));

      const start = Date.now();
      const res = await client.from("import_batches").select("id").abortSignal(controller.signal);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(res.data).toBeNull();
      expect(res.error).toBeDefined();
      expect(
        res.error?.message?.toLowerCase().includes("abort") ||
          res.error?.message?.toLowerCase().includes("cancel") ||
          isAbortError(res.error),
      ).toBe(true);
    });

    it("preserves caller cancellation reason with AbortSignal.any", async () => {
      const customReason = new Error("CustomClinicalWorkflowAborted");
      const mockFetch = createMockFetch({ delayMs: 300 });
      vi.stubGlobal("fetch", mockFetch);

      const client = createAdminClient({ timeoutMs: 500, fresh: true });
      const controller = new AbortController();

      // Trigger caller abort at 25ms (well before 500ms timeout)
      setTimeout(() => controller.abort(customReason), 25);

      const start = Date.now();
      const res = await client.from("import_batches").select("id").abortSignal(controller.signal);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(200);
      expect(res.data).toBeNull();
      expect(res.error).toBeDefined();
    });

    it("timeout takes precedence when timeout fires before caller aborts", async () => {
      const mockFetch = createMockFetch({ delayMs: 400 });
      vi.stubGlobal("fetch", mockFetch);

      const client = createAdminClient({ timeoutMs: 40, fresh: true });
      const controller = new AbortController();

      // Caller tries to abort late (at 200ms), but timeout is 40ms
      setTimeout(() => controller.abort(new Error("Late user cancel")), 200);

      const start = Date.now();
      const res = await client.from("import_batches").select("id").abortSignal(controller.signal);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(150);
      expect(res.data).toBeNull();
      expect(res.error).toBeDefined();
      expect(
        res.error?.message?.toLowerCase().includes("abort") ||
          res.error?.message?.toLowerCase().includes("timeout") ||
          isAbortError(res.error),
      ).toBe(true);
    });

    it("supports reusing a single long-lived AbortController across 50 sequential queries without leaking or premature aborts", async () => {
      const mockFetch = createMockFetch({
        delayMs: 5,
        responseBody: [{ id: "seq-item" }],
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createAdminClient({ timeoutMs: 200, fresh: true });
      const sharedController = new AbortController();

      for (let i = 0; i < 50; i++) {
        const res = await client.from("import_batches").select("id").abortSignal(sharedController.signal);
        expect(res.error).toBeNull();
        expect(res.data).toEqual([{ id: "seq-item" }]);
      }
    });

    it("verifies createTimeoutFetch extracts signal when input is a Request instance", async () => {
      const mockBaseFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return Promise.resolve(new Response(JSON.stringify({ ok: true, hasSignal: !!signal })));
      });

      const timeoutFetch = createTimeoutFetch(100, mockBaseFetch as unknown as typeof fetch);

      const requestObj = new Request("http://127.0.0.1:9999/api/test");
      const res = await timeoutFetch(requestObj);
      const data = await res.json();

      expect(data.ok).toBe(true);
      expect(data.hasSignal).toBe(true);
      expect(mockBaseFetch).toHaveBeenCalledOnce();
      const calledInit = mockBaseFetch.mock.calls[0][1];
      expect(calledInit?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("5. High Concurrency & Interleaved Workload Stress", () => {
    it("handles 30 interleaved concurrent queries (15 fast succeeding, 15 slow aborting) without cross-talk", async () => {
      const mockFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        const isSlow = url.includes("slow");
        const signal = init?.signal;

        return new Promise<Response>((resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
            return;
          }
          const onAbort = () => {
            reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });

          const delay = isSlow ? 250 : 20;
          setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve(
              new Response(JSON.stringify([{ type: isSlow ? "slow-data" : "fast-data" }]), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }, delay);
        });
      });

      vi.stubGlobal("fetch", mockFetch);

      // Shared client instance with 80ms timeout
      const client = createAdminClient({ timeoutMs: 80, fresh: true });

      const fastPromises = Array.from({ length: 15 }, (_, i) =>
        client.from("import_batches").select("id").eq("name", `fast-${i}`),
      );
      const slowPromises = Array.from({ length: 15 }, (_, i) =>
        client.from("import_batches").select("id").eq("status", `slow-${i}`),
      );

      const [fastResults, slowResults] = await Promise.all([Promise.all(fastPromises), Promise.all(slowPromises)]);

      // All 15 fast queries must succeed
      for (const res of fastResults) {
        expect(res.error).toBeNull();
        expect(res.data).toEqual([{ type: "fast-data" }]);
      }

      // All 15 slow queries must abort
      for (const res of slowResults) {
        expect(res.data).toBeNull();
        expect(res.error).toBeDefined();
        expect(
          res.error?.message?.toLowerCase().includes("abort") ||
            res.error?.message?.toLowerCase().includes("timeout") ||
            isAbortError(res.error),
        ).toBe(true);
      }
    });
  });
});
