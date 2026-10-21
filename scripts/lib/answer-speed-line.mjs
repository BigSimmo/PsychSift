/**
 * answer-speed-line — one plain line on how long clinicians wait for something to appear, for
 * the daily health summary (master plan section 4, "measure how long answers take before
 * something appears on screen").
 *
 * The answer pipeline records `first_verified_content_ms` (when the verified source preview was
 * handed to the stream) beside `total_latency_ms` in `rag_queries.metadata`. The deep health
 * probe turns those into percentiles; with `answer_window=daily` it adds a 24-hour block,
 * `sloDaily`, so this line covers a whole day of real use rather than the last six hours.
 *
 * Display only: nothing here raises an alert. Numbers only, as the summary is public.
 */
import { resolveHealthUrl } from "../ops-digest.mjs";

const DEFAULT_TIMEOUT_MS = 20_000;

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** The line from a deep-health payload, or null when the payload has no daily block. */
export function summariseAnswerSpeed(health) {
  const daily = health?.sloDaily;
  const first = daily?.timeToFirstContent;
  if (!daily || !first || !Number.isFinite(first.samples)) return null;
  if (first.samples === 0) return "Answer speed: no answers recorded in the last 24 hours.";
  const parts = [
    `Answer speed, last 24 hours: something on screen in ${seconds(first.p50Ms)} typically and ${seconds(first.p95Ms)} at the slow end, across ${first.samples} answers.`,
    `The source preview came first in ${first.previewSamples} of them.`,
  ];
  if (daily.latencySampleTruncated) parts.push("Busy day: figures cover the newest 1,000 answers only.");
  return parts.join(" ");
}

/**
 * The daily-summary line, or null when it cannot be measured (no URL or secret, the probe
 * refused, or an older build without `sloDaily`). Null renders as "Not measured yet".
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} [options]
 */
export async function answerSpeedLine({ env = process.env, fetchImpl = fetch } = {}) {
  const base = resolveHealthUrl(env.PROD_HEALTH_URL);
  const secret = env.HEALTH_DEEP_PROBE_SECRET;
  if (!base || !secret) return null;
  const url = new URL(base);
  url.searchParams.set("deep", "1");
  url.searchParams.set("answer_window", "daily");
  try {
    const response = await fetchImpl(url.toString(), {
      headers: { "x-health-deep-token": secret },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return summariseAnswerSpeed(await response.json());
  } catch {
    return null;
  }
}
