/**
 * The two answer lines in the daily health summary (scripts/lib/daily-health-summary.mjs):
 * quality from the eval canary's trend (answer-quality-line.mjs), speed from the answer SLO
 * snapshot (answer-speed-line.mjs). Each returns null when it cannot measure, and the summary
 * prints "Not measured yet".
 *
 * Each function runs inside actions/github-script in .github/workflows/daily-health-summary.yml
 * and receives `{ github, owner, repo, env, now }`, where `env` carries GITHUB_TOKEN,
 * PROD_HEALTH_URL and HEALTH_DEEP_PROBE_SECRET and `now` is an ISO string. Return one line of
 * numbers and case ids only, never query or answer text: the summary is a public GitHub issue.
 */

import { answerQualityLine as canaryQualityLine } from "./answer-quality-line.mjs";
import { answerSpeedLine as sloSpeedLine } from "./answer-speed-line.mjs";

/**
 * @param {{ owner?: string, repo?: string, env?: Record<string, string | undefined>, now?: string | Date, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} [options]
 * @returns {Promise<string | null>}
 */
export async function answerQualityLine({ owner, repo, env = process.env, now, fetchImpl } = {}) {
  const repository = owner && repo ? `${owner}/${repo}` : env.GITHUB_REPOSITORY;
  return canaryQualityLine({
    env: { ...env, GITHUB_REPOSITORY: repository },
    now: now ? new Date(now) : new Date(),
    fetchImpl,
  });
}

/**
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} [options]
 * @returns {Promise<string | null>}
 */
export async function answerSpeedLine({ env = process.env, fetchImpl } = {}) {
  return sloSpeedLine({ env, fetchImpl });
}
