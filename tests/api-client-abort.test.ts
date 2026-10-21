import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A reader who navigates away mid-typeahead cancels an in-flight request. That is not a server
 * fault, and three registry routes were reporting it as one: their catch blocks fell through to
 * `jsonError(error)`, which answers HTTP 500 and writes an `error`-level "API request failed" log.
 * `/api/search` already answered 499 from its catch; these three now use its exact predicate and
 * its ordering.
 *
 * THE PREDICATE IS NARROW ON PURPOSE, and these tests are what keep it narrow. The shared
 * `isAbortError` helper also matches `TimeoutError`, which is right for its own callers and wrong
 * here: a server-side deadline is a real failure, and answering 499 for one would send an empty
 * body, skip the error log, and hide it from the error rate. Nothing on these paths produces a
 * `TimeoutError` with the client still connected today — the catalogue budget and the per-domain
 * search budget each absorb their own expiry — but that containment lives in other modules, so the
 * "still a 500" cases below are the thing that fails if someone widens the predicate later.
 *
 * Scope note: this removes false 500s and spurious error logs. It is NOT established to close any
 * Sentry issue — measured 2026-09-17, 853 of 857 error events carried no `route_path`, meaning they
 * did not reach Sentry through a route handler's return path at all.
 */
const loggerError = vi.fn();

function mockRuntime() {
  vi.resetModules();
  loggerError.mockClear();
  vi.doMock("@/lib/env", () => ({
    env: {},
    isDemoMode: () => false,
    isLocalNoAuthMode: () => false,
  }));
  vi.doMock("@/lib/logger", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
      // #3728: these routes need sign-in, so the request below is a signed-in one.
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "11111111-1111-4111-8111-111111111111", email: "reader@example.org" } },
          error: null,
        })),
      },
      rpc: vi.fn(async () => ({
        data: [{ limited: false, limit_value: 120, remaining: 119, retry_after_seconds: 60 }],
        error: null,
      })),
    }),
  }));
}

/** Make the layer the route awaits reject with `error`, exactly as a real failure would. */
function mockSeamThrows(seam: "catalogue" | "universalSearch", error: () => unknown) {
  const specifier = seam === "catalogue" ? "@/lib/site-content/catalogue-seed-fallback" : "@/lib/universal-search";
  const exportName = seam === "catalogue" ? "readCatalogueWithSeedFallback" : "runUniversalSearch";
  vi.doMock(specifier, async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    [exportName]: vi.fn(async () => {
      throw error();
    }),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const cases = [
  {
    name: "/api/differentials",
    path: "/api/differentials?kind=diagnosis",
    modulePath: "../src/app/api/differentials/route",
    seam: "catalogue",
  },
  {
    name: "/api/medications",
    path: "/api/medications",
    modulePath: "../src/app/api/medications/route",
    seam: "catalogue",
  },
  {
    name: "/api/search/universal",
    path: "/api/search/universal?q=lithium",
    modulePath: "../src/app/api/search/universal/route",
    seam: "universalSearch",
  },
] as const;

describe("a cancelled request is answered 499, not reported as a server fault", () => {
  for (const item of cases) {
    async function callRoute(error: () => unknown, options: { abortSignal?: boolean } = {}) {
      mockRuntime();
      mockSeamThrows(item.seam, error);
      const { GET } = await import(item.modulePath);
      let signal: AbortSignal | undefined;
      if (options.abortSignal) {
        const controller = new AbortController();
        controller.abort();
        signal = controller.signal;
      }
      const headers = { Authorization: "Bearer synthetic-signed-in-token" };
      return (await GET(
        new Request(`http://localhost${item.path}`, signal ? { signal, headers } : { headers }),
      )) as Response;
    }

    it(`${item.name} answers 499 with an empty body when the read aborts`, async () => {
      const response = await callRoute(() => new DOMException("The operation was aborted.", "AbortError"));

      expect(response.status).toBe(499);
      expect(await response.text()).toBe("");
    });

    it(`${item.name} does not log a cancelled request at error level`, async () => {
      await callRoute(() => new DOMException("The operation was aborted.", "AbortError"));

      expect(loggerError).not.toHaveBeenCalledWith("API request failed", expect.anything());
    });

    it(`${item.name} still answers 499 when the signal aborted and the error is not an AbortError`, async () => {
      const response = await callRoute(() => new Error("socket hang up"), { abortSignal: true });

      expect(response.status).toBe(499);
    });

    it(`${item.name} reports a server-side TimeoutError on a live connection as a 500`, async () => {
      const response = await callRoute(() => new DOMException("Canonical read exceeded 6000ms.", "TimeoutError"));

      expect(response.status).toBe(500);
      expect(loggerError).toHaveBeenCalled();
    });

    it(`${item.name} reports a genuine failure on a live connection as a 500`, async () => {
      const response = await callRoute(() => new Error("relation does not exist"));

      expect(response.status).toBe(500);
      expect(loggerError).toHaveBeenCalled();
    });
  }
});
