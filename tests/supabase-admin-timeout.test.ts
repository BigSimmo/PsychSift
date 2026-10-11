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
    SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M",
  }),
}));

vi.mock("@/lib/observability/supabase-tracing", () => ({
  instrumentSupabaseClientForTracing: vi.fn(),
}));

describe("Supabase admin client timeout (#1DYJJQ)", () => {
  beforeEach(() => {
    resetAdminClientForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetAdminClientForTesting();
  });

  it("aborts hung PostgREST query when deadline expires", async () => {
    const slowFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        const onAbort = () => {
          reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(
            new Response(JSON.stringify([{ id: "batch-1" }]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }, 300);
      });
    });

    vi.stubGlobal("fetch", slowFetch);

    const client = createAdminClient({ timeoutMs: 50, fresh: true });
    const start = Date.now();
    const res = await client.from("import_batches").select("id");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(250);
    expect(res.data).toBeNull();
    expect(res.error).toBeDefined();
    expect(
      res.error?.message?.toLowerCase().includes("abort") ||
        res.error?.message?.toLowerCase().includes("timeout") ||
        isAbortError(res.error),
    ).toBe(true);
  });

  it("aborts hung Storage operation when deadline expires", async () => {
    const slowFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        const onAbort = () => {
          reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(
            new Response(Buffer.from("PDF data"), {
              status: 200,
              headers: { "Content-Type": "application/pdf" },
            }),
          );
        }, 300);
      });
    });

    vi.stubGlobal("fetch", slowFetch);

    const client = createAdminClient({ timeoutMs: 50, fresh: true });
    const start = Date.now();
    const res = await client.storage.from("clinical-documents").download("test.pdf");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(250);
    expect(res.data).toBeNull();
    expect(res.error).toBeDefined();
    expect(
      res.error?.message?.toLowerCase().includes("abort") ||
        res.error?.message?.toLowerCase().includes("timeout") ||
        isAbortError(res.error),
    ).toBe(true);
  });

  it("exempts worker batch operations when timeoutMs is null or false", async () => {
    const delayedFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        const onAbort = () => {
          reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(
            new Response(JSON.stringify([{ id: "batch-exempt-1" }]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }, 80);
      });
    });

    vi.stubGlobal("fetch", delayedFetch);

    // Test with timeoutMs: null (as worker/main.ts uses)
    const clientNull = createAdminClient({ timeoutMs: null, fresh: true });
    const resNull = await clientNull.from("import_batches").select("id");
    expect(resNull.error).toBeNull();
    expect(resNull.data).toEqual([{ id: "batch-exempt-1" }]);

    // Test with timeoutMs: false
    const clientFalse = createAdminClient({ timeoutMs: false, fresh: true });
    const resFalse = await clientFalse.from("import_batches").select("id");
    expect(resFalse.error).toBeNull();
    expect(resFalse.data).toEqual([{ id: "batch-exempt-1" }]);
  });

  it("respects caller-provided AbortSignal when it aborts before the deadline", async () => {
    const slowFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        const onAbort = () => {
          reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(
            new Response(JSON.stringify([{ id: "batch-1" }]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }, 300);
      });
    });

    vi.stubGlobal("fetch", slowFetch);

    const client = createAdminClient({ timeoutMs: 500, fresh: true });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);

    const start = Date.now();
    const res = await client.from("import_batches").select("id").abortSignal(controller.signal);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(200);
    expect(res.data).toBeNull();
    expect(res.error).toBeDefined();
    expect(
      res.error?.message?.toLowerCase().includes("abort") ||
        res.error?.message?.toLowerCase().includes("timeout") ||
        isAbortError(res.error),
    ).toBe(true);
  });

  it("manages singletons for default and unbounded clients", () => {
    expect(DEFAULT_SUPABASE_ADMIN_TIMEOUT_MS).toBe(30_000);

    const default1 = createAdminClient();
    const default2 = createAdminClient();
    expect(default1).toBe(default2);

    const unbounded1 = createAdminClient({ timeoutMs: null });
    const unbounded2 = createAdminClient({ timeoutMs: null });
    expect(unbounded1).toBe(unbounded2);

    expect(default1).not.toBe(unbounded1);

    const freshInstance = createAdminClient({ fresh: true });
    expect(freshInstance).not.toBe(default1);
    expect(freshInstance).not.toBe(unbounded1);
  });

  it("handles non-finite, zero, and negative timeout values safely in createTimeoutFetch", () => {
    const mockBaseFetch = vi.fn() as unknown as typeof fetch;

    expect(createTimeoutFetch(null, mockBaseFetch)).toBe(mockBaseFetch);
    expect(createTimeoutFetch(false, mockBaseFetch)).toBe(mockBaseFetch);
    expect(createTimeoutFetch(0, mockBaseFetch)).toBe(mockBaseFetch);
    expect(createTimeoutFetch(-100, mockBaseFetch)).toBe(mockBaseFetch);
    expect(createTimeoutFetch(NaN, mockBaseFetch)).toBe(mockBaseFetch);
    expect(createTimeoutFetch(Infinity, mockBaseFetch)).toBe(mockBaseFetch);
  });
});
