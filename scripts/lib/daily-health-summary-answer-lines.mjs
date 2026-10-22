/**
 * The two answer lines in the daily health summary (scripts/lib/daily-health-summary.mjs).
 *
 * Owned by the answer quality work, which fills these in: quality from the eval canary's trend,
 * speed from the answer SLO snapshot. Until then each returns null and the summary prints
 * "Not measured yet".
 *
 * Each function runs inside actions/github-script in .github/workflows/daily-health-summary.yml
 * and receives `{ github, owner, repo, env, now }`, where `env` carries GITHUB_TOKEN,
 * PROD_HEALTH_URL and HEALTH_DEEP_PROBE_SECRET. Return one line of numbers and case ids only,
 * never query or answer text: the summary is a public GitHub issue.
 */

/** @returns {Promise<string | null>} */
export async function answerQualityLine() {
  return null;
}

/** @returns {Promise<string | null>} */
export async function answerSpeedLine() {
  return null;
}
