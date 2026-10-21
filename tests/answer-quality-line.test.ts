import { describe, expect, it } from "vitest";

import {
  answerQualityLine,
  fetchTrendRows,
  parseTrendRow,
  summariseAnswerQuality,
} from "../scripts/lib/answer-quality-line.mjs";
import { TREND_ROW_MARKER, TREND_TITLE, renderCanaryTrendComment } from "../scripts/lib/eval-canary-trend.mjs";

// Master plan section 4: the trend rows already exist on the rolling issue; this turns them into
// one line for the daily health summary, which is a public issue, so only counts and case ids.
function row(date: string, answerFailed: string[] | null, retrievalFailed: string[] = []) {
  return {
    v: 1,
    date,
    run: "1",
    attempt: "1",
    trigger: "schedule",
    sha: "abcdef123456",
    job: answerFailed && answerFailed.length === 0 ? "success" : "failure",
    steps: { golden: "success", answer: answerFailed ? "success" : "cancelled" },
    retrieval: {
      cases: 36,
      failed: retrievalFailed,
      doc_recall_at_5: 1,
      content_recall_at_5: 0.9722,
      mrr_at_10: 0.9,
      content_mrr_at_10: 0.9,
      irrelevant_at_10: 0.07,
      p90_ms: 50000,
    },
    answer: answerFailed
      ? {
          cases: 44,
          failed: answerFailed,
          grounded_supported_rate: 1,
          unsupported_correct_rate: 1,
          expected_hit_rate: 0.66,
          citation_failure_rate: 0,
          estimated_cost_usd: 0.12,
        }
      : null,
  };
}

const now = new Date("2026-10-22T00:00:00Z");

describe("parseTrendRow", () => {
  it("reads back exactly the row the canary rendered", () => {
    const original = row("2026-10-21T06:32:13.761Z", ["admission-discharge-coverage-paraphrase"]);
    const body = renderCanaryTrendComment(original, "https://github.com/x/y/actions/runs/1");
    expect(parseTrendRow(body)).toEqual(original);
  });

  it("ignores comments that are not trend rows", () => {
    expect(parseTrendRow("a person's note")).toBeNull();
    expect(parseTrendRow(`${TREND_ROW_MARKER}\nreadable\n\`{not json}\``)).toBeNull();
    expect(parseTrendRow(`${TREND_ROW_MARKER}\nreadable\n\`{"v":2,"date":"2026-10-21"}\``)).toBeNull();
  });
});

describe("summariseAnswerQuality", () => {
  it("states the latest result, its direction, the recent history and failing case ids", () => {
    const line = summariseAnswerQuality(
      [
        row("2026-10-21T09:42:39Z", ["a-case", "b-case", "c-case"]),
        row("2026-10-21T06:32:13Z", ["a-case", "b-case"]),
        row("2026-10-18T18:12:00Z", ["a-case"]),
      ],
      { now },
    );
    expect(line).toBe(
      "Answer quality: 41 of 44 test answers passing on 21 Oct, down 1 on the run before. " +
        "Search 36 of 36, recall 97%. Last 3 runs passing: 43, 42, 41. Failing now: a-case, b-case, c-case.",
    );
  });

  it("keeps an unfinished run in view instead of skipping it", () => {
    const line = summariseAnswerQuality([row("2026-10-20T00:00:00Z", []), row("2026-10-21T00:00:00Z", null)], {
      now,
    });
    expect(line).toContain("the last test run (21 Oct) did not finish.");
    expect(line).toContain("Last 2 runs passing: 44, unfinished.");
  });

  it("says when the weekly run has gone quiet", () => {
    expect(summariseAnswerQuality([row("2026-10-10T00:00:00Z", [])], { now })).toContain("No test run for 12 days.");
  });

  it("keeps only the newest eight runs", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row(`2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`, []),
    );
    expect(summariseAnswerQuality(rows, { now })).toContain("Last 8 runs passing: 44, 44, 44, 44, 44, 44, 44, 44.");
  });

  it("returns null when there is nothing to report", () => {
    expect(summariseAnswerQuality([], { now })).toBeNull();
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchTrendRows and answerQualityLine", () => {
  const comment = (date: string) => ({
    body: renderCanaryTrendComment(row(date, []), "https://github.com/x/y/actions/runs/1"),
  });

  it("reads every page of the trend issue, not just the oldest", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.includes("/issues?")) return jsonResponse([{ number: 7, title: TREND_TITLE }]);
      if (url.endsWith("&page=1"))
        return jsonResponse(Array.from({ length: 100 }, () => comment("2026-10-01T00:00:00Z")));
      return jsonResponse([comment("2026-10-21T00:00:00Z"), { body: "not a row" }]);
    };
    const rows = await fetchTrendRows({ token: "t", repository: "o/r", fetchImpl, now });
    expect(rows).toHaveLength(101);
    expect(urls.filter((url) => url.includes("/issues/7/comments"))).toHaveLength(2);
  });

  it("returns null rather than throwing when the API refuses or nothing is configured", async () => {
    const refused = async () => jsonResponse({ message: "nope" }, 403);
    expect(
      await answerQualityLine({ env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r" }, fetchImpl: refused, now }),
    ).toBeNull();
    expect(await answerQualityLine({ env: {}, fetchImpl: refused, now })).toBeNull();
  });

  it("builds the line from the live issue shape", async () => {
    const fetchImpl = async (url: string) =>
      url.includes("/issues?")
        ? jsonResponse([{ number: 7, title: TREND_TITLE }])
        : jsonResponse([comment("2026-10-21T00:00:00Z")]);
    const line = await answerQualityLine({ env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "o/r" }, fetchImpl, now });
    expect(line).toBe("Answer quality: 44 of 44 test answers passing on 21 Oct. Search 36 of 36, recall 97%.");
  });
});
