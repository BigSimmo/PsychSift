/**
 * answer-quality-line — one plain line on how answer quality is trending, for the daily health
 * summary (master plan section 4, "show the answer quality trend at a glance").
 *
 * The data already exists. Every eval-canary run posts a trend row to the rolling "Eval canary
 * trend" issue (`scripts/lib/eval-canary-trend.mjs`, audit EVAL-06). Nothing read those rows
 * back, so seeing the trend meant opening the issue and comparing JSON by eye. This reads the
 * newest rows and turns them into one sentence.
 *
 * The summary is a public GitHub issue, so the line carries only what the rows carry: counts,
 * rates and eval case ids, never question, answer or source text. Read-only: one issue search
 * and one comment read through the GitHub API with the workflow's own token; no provider calls.
 */
import { TREND_LABEL, TREND_ROW_MARKER, TREND_TITLE } from "./eval-canary-trend.mjs";

const DEFAULT_RUNS = 8;
const STALE_AFTER_DAYS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
// 2,000 comments: the canary posts a few rows a day, so even the 365-day read fits.
const MAX_COMMENT_PAGES = 20;

/** The JSON row from one trend comment, or null when the comment is not a v1 trend row. */
export function parseTrendRow(body) {
  const lines = String(body ?? "").split("\n");
  if (lines[0]?.trim() !== TREND_ROW_MARKER) return null;
  const json = lines.find((line) => line.startsWith("`{") && line.endsWith("}`"));
  if (!json) return null;
  try {
    const row = JSON.parse(json.slice(1, -1));
    return row?.v === 1 && Number.isFinite(Date.parse(row.date ?? "")) ? row : null;
  } catch {
    return null;
  }
}

function passing(half) {
  if (!half || !Number.isFinite(half.cases)) return null;
  return half.cases - (Array.isArray(half.failed) ? half.failed.length : 0);
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Perth" });
}

function percent(rate) {
  return Number.isFinite(rate) ? `${Math.round(rate * 100)}%` : "unknown";
}

function direction(latest, previous) {
  if (latest === null || previous === null) return "";
  if (latest > previous) return `, up ${latest - previous} on the run before`;
  if (latest < previous) return `, down ${previous - latest} on the run before`;
  return ", same as the run before";
}

/**
 * One line from trend rows (any order). Runs that never reached an answer verdict are kept in
 * view rather than skipped, because a silent gap is the failure this repository fears most.
 */
export function summariseAnswerQuality(rows, { now = new Date(), runs = DEFAULT_RUNS } = {}) {
  const ordered = rows
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(-runs);
  if (ordered.length === 0) return null;

  const latest = ordered.at(-1);
  const parts = [];
  const ageDays = Math.floor((now.getTime() - Date.parse(latest.date)) / DAY_MS);
  const staleNote = ageDays >= STALE_AFTER_DAYS ? ` No test run for ${ageDays} days.` : "";

  const latestPassing = passing(latest.answer);
  if (latestPassing === null) {
    parts.push(`Answer quality: the last test run (${shortDate(latest.date)}) did not finish.`);
  } else {
    const previous = ordered
      .slice(0, -1)
      .map((row) => passing(row.answer))
      .filter((value) => value !== null)
      .at(-1);
    parts.push(
      `Answer quality: ${latestPassing} of ${latest.answer.cases} test answers passing on ${shortDate(latest.date)}${direction(latestPassing, previous ?? null)}.`,
    );
  }

  const retrievalPassing = passing(latest.retrieval);
  if (retrievalPassing !== null) {
    parts.push(
      `Search ${retrievalPassing} of ${latest.retrieval.cases}, recall ${percent(latest.retrieval.content_recall_at_5)}.`,
    );
  }

  const history = ordered.map((row) => passing(row.answer) ?? "unfinished");
  if (history.length > 1) parts.push(`Last ${history.length} runs passing: ${history.join(", ")}.`);

  const failing = latest.answer?.failed ?? [];
  if (failing.length > 0) parts.push(`Failing now: ${failing.join(", ")}.`);

  return `${parts.join(" ")}${staleNote}`;
}

const TREND_ROW_AUTHOR = "github-actions[bot]";

async function getJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${new URL(url).pathname}`);
  return response.json();
}

/**
 * Trend rows from the newest comments on the rolling trend issue (read-only).
 * @param {{ token: string, repository: string, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>, now?: Date, lookbackDays?: number }} options
 */
export async function fetchTrendRows({ token, repository, fetchImpl = fetch, now = new Date(), lookbackDays = 30 }) {
  const api = `https://api.github.com/repos/${repository}`;
  const issues = await getJson(
    fetchImpl,
    `${api}/issues?state=open&labels=${encodeURIComponent(TREND_LABEL)}&per_page=10`,
    token,
  );
  const issue = Array.isArray(issues) ? issues.find((item) => item.title === TREND_TITLE) : null;
  if (!issue) return [];
  // Comments come back oldest first, and dispatched runs can add several a day, so read every
  // page in the window (bounded) rather than trusting the first page to hold the newest rows.
  const since = new Date(now.getTime() - lookbackDays * DAY_MS).toISOString();
  const rows = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const comments = await getJson(
      fetchImpl,
      `${api}/issues/${issue.number}/comments?since=${encodeURIComponent(since)}&per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(comments)) break;
    // The issue is public, so anyone can post a marked comment. Only the canary workflow's own
    // identity writes real rows.
    rows.push(
      ...comments
        .filter((comment) => comment?.user?.login === TREND_ROW_AUTHOR)
        .map((comment) => parseTrendRow(comment.body))
        .filter(Boolean),
    );
    if (comments.length < 100) break;
  }
  return rows;
}

/**
 * The daily-summary line, or null when it cannot be measured (no token, no rows, or the API
 * refused). Null renders as "Not measured yet" in the summary, which is honest; a thrown error
 * would cost the whole summary.
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>, now?: Date }} [options]
 */
export async function answerQualityLine({ env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  const token = env.GITHUB_TOKEN;
  const repository = env.GITHUB_REPOSITORY;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) return null;
  try {
    // An empty month is itself the finding: widen once so the line can still say how long the
    // canary has been silent, rather than reading "Not measured yet" like a missing token.
    let rows = await fetchTrendRows({ token, repository, fetchImpl, now });
    if (rows.length === 0) rows = await fetchTrendRows({ token, repository, fetchImpl, now, lookbackDays: 365 });
    return summariseAnswerQuality(rows, { now });
  } catch {
    return null;
  }
}
