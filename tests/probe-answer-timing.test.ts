import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  parseServerTiming,
  providerAccessAuthorized,
  renderAnswerTimingReport,
  summariseAnswerTiming,
} from "../scripts/probe-answer-timing.mjs";

const SCRIPT_PATH = path.resolve(fileURLToPath(import.meta.url), "../../scripts/probe-answer-timing.mjs");

/**
 * Pins the operator probe against the ways a Server-Timing header actually arrives, and against
 * the two mistakes that would make its output worse than nothing.
 *
 * The first is arithmetic: the stages are nested. `search` already contains `rpc`, `embedding` and
 * `rerank`, and `answer`/`total` are whole-request totals. A report that presents them as an
 * additive column, or that picks the "slowest stage" across overlapping measures, tells an
 * operator to go and optimise the same seconds twice.
 *
 * The second is the provider boundary: this probe spends OpenAI credit on the live clinical site.
 * Its refusal is the only thing standing between an absent-minded run and a real request.
 *
 * If one of these fails, do not relax it.
 */

const realHeader =
  "auth;dur=181, ratelimit;dur=64, scope;dur=402, search;dur=1130, rpc;dur=880, generation;dur=18940, answer;dur=20120, total;dur=20770";

describe("parseServerTiming", () => {
  it("reads the header /api/answer actually emits", () => {
    expect(parseServerTiming(realHeader)).toEqual([
      { name: "auth", durMs: 181 },
      { name: "ratelimit", durMs: 64 },
      { name: "scope", durMs: 402 },
      { name: "search", durMs: 1130 },
      { name: "rpc", durMs: 880 },
      { name: "generation", durMs: 18940 },
      { name: "answer", durMs: 20120 },
      { name: "total", durMs: 20770 },
    ]);
  });

  it("keeps a stage that reported no duration, rather than dropping it", () => {
    // buildServerTimingHeader emits a bare name when the duration is absent or non-finite.
    // The stage having run and reported nothing is itself a finding.
    expect(parseServerTiming("clamped;dur=0, nan")).toEqual([
      { name: "clamped", durMs: 0 },
      { name: "nan", durMs: null },
    ]);
  });

  it("does not split on a comma inside a quoted description", () => {
    // sanitizeDescription strips CR, LF, quote and backslash — but not commas. A naive
    // split(", ") invents a stage here and loses a real one.
    const parsed = parseServerTiming('search;dur=100;desc="hybrid, reranked", generation;dur=200');
    expect(parsed.map((entry) => entry.name)).toEqual(["search", "generation"]);
    expect(parsed[1]).toEqual({ name: "generation", durMs: 200 });
  });

  it("returns nothing for an absent or empty header", () => {
    expect(parseServerTiming(null)).toEqual([]);
    expect(parseServerTiming(undefined)).toEqual([]);
    expect(parseServerTiming("   ")).toEqual([]);
  });
});

describe("summariseAnswerTiming", () => {
  it("names writing the answer as the slowest phase on a real generation-bound request", () => {
    const summary = summariseAnswerTiming(parseServerTiming(realHeader), 21500);
    expect(summary.dominant).toEqual({ label: "writing the answer", durMs: 18940 });
  });

  it("never picks a nested or total measure as the slowest phase", () => {
    // `answer` (20120) and `total` (20770) are both larger than `generation` (18940), and `rpc`
    // is inside `search`. Choosing across all of them would report a total as a phase.
    const summary = summariseAnswerTiming(parseServerTiming(realHeader), null);
    expect(["everything before the search starts", "searching the documents", "writing the answer"]).toContain(
      summary.dominant?.label,
    );
  });

  it("sums the preamble but leaves the nested search components out of it", () => {
    const summary = summariseAnswerTiming(parseServerTiming(realHeader), null);
    expect(summary.preambleMs).toBe(181 + 64 + 402);
  });

  it("computes share against the server total and leaves totals unshared", () => {
    const summary = summariseAnswerTiming(parseServerTiming(realHeader), null);
    const generation = summary.rows.find((row) => row.name === "generation");
    const total = summary.rows.find((row) => row.name === "total");
    expect(generation?.share).toBeCloseTo(18940 / 20770, 5);
    expect(total?.share).toBeNull();
  });

  it("reports what the caller waited for beyond the server's own total", () => {
    const summary = summariseAnswerTiming(parseServerTiming(realHeader), 21500);
    expect(summary.overheadMs).toBe(21500 - 20770);
  });

  it("does not report negative overhead when the server total exceeds the measured wall clock", () => {
    // Clock skew and rounding make this reachable; a negative "network time" is nonsense.
    const summary = summariseAnswerTiming(parseServerTiming("total;dur=5000"), 4900);
    expect(summary.overheadMs).toBe(0);
  });

  it("degrades to not-ok when no stage arrived", () => {
    expect(summariseAnswerTiming([], 1200).ok).toBe(false);
  });
});

describe("renderAnswerTimingReport", () => {
  it("says the stages are nested rather than additive", () => {
    const report = renderAnswerTimingReport(summariseAnswerTiming(parseServerTiming(realHeader), 21500));
    expect(report).toMatch(/nested, not additive/);
  });

  it("explains itself when the header is missing instead of printing an empty table", () => {
    expect(renderAnswerTimingReport(summariseAnswerTiming([], null))).toMatch(/no Server-Timing header/);
  });
});

describe("providerAccessAuthorized", () => {
  it("refuses by default", () => {
    expect(providerAccessAuthorized([], {})).toBe(false);
  });

  it("accepts the explicit flag", () => {
    expect(providerAccessAuthorized(["node", "probe", "--allow-provider"], {})).toBe(true);
  });

  it("accepts the explicit env opt-in, and only its exact value", () => {
    expect(providerAccessAuthorized([], { ALLOW_ANSWER_TIMING_PROBE: "true" })).toBe(true);
    expect(providerAccessAuthorized([], { ALLOW_ANSWER_TIMING_PROBE: "1" })).toBe(false);
    expect(providerAccessAuthorized([], { ALLOW_ANSWER_TIMING_PROBE: "yes" })).toBe(false);
  });
});

describe("direct execution", () => {
  it("exits with status 1 and provider refusal when invoked directly without --allow-provider", () => {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to probe the live site without confirmation");
  });
});
