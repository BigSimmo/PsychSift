import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSoakAuthenticationMode,
  assertTargetIsNotProduction,
  evaluateSoakResults,
  issueSoakRequest,
  parseSoakArgs,
  parseSoakTargetOrigin,
  soakStagingFetch,
  soakThresholds,
  type RequestSample,
  type SoakArgs,
} from "../scripts/soak-test";

const baseArgs: SoakArgs = {
  target: "https://staging.tests.invalid",
  confirmStaging: true,
  users: 1,
  durationS: 0,
  rampS: 0,
  thinkMs: 1,
  answerShare: 0.5,
  timeoutMs: 1_000,
  bearer: "staging-token",
  forbidHosts: [],
};

function sample(endpoint: "search" | "answer", status = 200, latencyMs = 100): RequestSample {
  return { endpoint, status, latencyMs, timedOut: false };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("staging soak safety", () => {
  it("pins release acceptance thresholds", () => {
    expect(soakThresholds).toEqual({
      searchP95Ms: 3_000,
      answerP95Ms: 25_000,
      maxNonRateLimitedFailureRate: 0.01,
      maxRateLimitedRate: 0.05,
    });
  });

  it("accepts and normalizes only a plain HTTPS origin", () => {
    expect(parseSoakTargetOrigin("https://staging.tests.invalid/")).toBe("https://staging.tests.invalid");
    expect(() => parseSoakTargetOrigin("http://staging.tests.invalid")).toThrow(/HTTPS/);
    expect(() => parseSoakTargetOrigin("https://staging.tests.invalid/path")).toThrow(/plain HTTPS origin/);
    expect(() => parseSoakTargetOrigin("https://user:secret@staging.tests.invalid")).toThrow(/plain HTTPS origin/);
  });

  it("refuses the production application and database markers", () => {
    expect(() => assertTargetIsNotProduction({ target: "https://psychiatry.tools", forbidHosts: [] })).toThrow(
      /Refusing target/,
    );
    expect(() =>
      assertTargetIsNotProduction({
        target: "https://sjrfecxgysukkwxsowpy.supabase.co",
        forbidHosts: [],
      }),
    ).toThrow(/Refusing target/);
    expect(() =>
      assertTargetIsNotProduction({
        target: "https://database-production-c1c0.up.railway.app",
        forbidHosts: [],
      }),
    ).toThrow(/Refusing target/);
    expect(() =>
      assertTargetIsNotProduction({ target: "https://app-staging-6a78.up.railway.app", forbidHosts: [] }),
    ).not.toThrow();
  });

  it("refuses bearer tokens in argv and reads them from the environment", () => {
    expect(() => parseSoakArgs(["--target", baseArgs.target, "--confirm-staging", "--bearer", "secret"])).toThrow(
      /SOAK_BEARER_TOKEN/,
    );
    expect(() => parseSoakArgs(["--target", baseArgs.target, "--confirm-staging", "--bearer=secret"])).toThrow(
      /SOAK_BEARER_TOKEN/,
    );

    vi.stubEnv("SOAK_BEARER_TOKEN", "environment-token");
    expect(parseSoakArgs(["--target", baseArgs.target, "--confirm-staging"]).bearer).toBe("environment-token");
  });

  it("requires authenticated evidence", () => {
    expect(() => assertSoakAuthenticationMode({ bearer: undefined })).toThrow(/Authenticated release evidence/);
    expect(() => assertSoakAuthenticationMode({ bearer: "token" })).not.toThrow();
  });

  it("forces redirect refusal even when the caller requests follow", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await soakStagingFetch(baseArgs.target, { redirect: "follow" });
    expect(fetchSpy).toHaveBeenCalledWith(baseArgs.target, expect.objectContaining({ redirect: "error" }));
  });

  it("treats an unreadable or truncated successful body as a hard failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 200,
      arrayBuffer: () => Promise.reject(new Error("truncated")),
    } as Response);
    await expect(issueSoakRequest(baseArgs, "search", "synthetic query")).resolves.toMatchObject({ status: 0 });
  });
});

describe("staging soak acceptance", () => {
  it("requires successful search and answer requests", () => {
    expect(evaluateSoakResults([sample("search")]).failures).toContain("/api/answer had no successful responses");
  });

  it("passes representative results within all budgets", () => {
    const result = evaluateSoakResults([sample("search", 200, 2_900), sample("answer", 200, 24_900)]);
    expect(result.passed).toBe(true);
  });

  it("enforces search and answer p95 budgets", () => {
    const result = evaluateSoakResults([sample("search", 200, 3_001), sample("answer", 200, 25_001)]);
    expect(result.failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/search p95/), expect.stringMatching(/answer p95/)]),
    );
  });

  it("requires the non-429 failure rate to remain strictly below 1%", () => {
    const samples = [sample("search", 500), sample("answer"), ...Array.from({ length: 98 }, () => sample("search"))];
    expect(evaluateSoakResults(samples).failures).toEqual(expect.arrayContaining([expect.stringMatching(/below 1%/)]));
  });

  it("permits at most 5% rate limiting", () => {
    const atLimit = [
      ...Array.from({ length: 5 }, () => sample("search", 429)),
      sample("answer"),
      ...Array.from({ length: 94 }, () => sample("search")),
    ];
    expect(evaluateSoakResults(atLimit).passed).toBe(true);
    expect(evaluateSoakResults([...atLimit, sample("answer", 429)]).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/429 rate/)]),
    );
  });

  it("allows no authentication failures", () => {
    const result = evaluateSoakResults([sample("search", 401), sample("answer")]);
    expect(result.failures).toEqual(expect.arrayContaining([expect.stringMatching(/authentication failure/)]));
  });
});
