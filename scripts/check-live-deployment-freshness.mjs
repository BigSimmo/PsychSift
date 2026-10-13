#!/usr/bin/env node
/**
 * check-live-deployment-freshness.mjs — is the live site still shipping what `main` says it should?
 *
 * Between 2026-09-11 and 2026-09-14, 24 consecutive production deploys were rejected at Railway's
 * healthcheck and rolled back. `live-domain-monitor.yml` stayed green for all three days, and every
 * probe in it was telling the truth: the domain served the app shell, `/api/health` answered "ok",
 * live mode was intact. The site was simply serving three-day-old code, and nothing compared what
 * was DEPLOYED against what had been MERGED. It was found by someone noticing an expected UI change
 * was missing.
 *
 * THE MEASUREMENT IS THE AGE OF THE OLDEST UNSHIPPED COMMIT, and that is the whole check.
 *
 * Two wrong metrics look reasonable and both fail silently in the exact case this exists for:
 *
 *   1. Distance between the live commit and main's head. During the incident those two were 56
 *      minutes apart in authored time while the site stayed stranded for three days, so this reads
 *      ~0h and says nothing.
 *   2. Age of main's head (`now - head_committed_at`). Every new merge resets it. Main moved every
 *      0-57 minutes throughout the outage — never a gap above one hour — so against any threshold
 *      of hours this is permanently green while nothing ships. A busy repository is exactly when
 *      deploys matter most, so this metric is not merely weak, it is inverted.
 *
 * The oldest unshipped commit has neither failure: it is pinned at the moment deploys stopped
 * landing and ages from there, no matter how much lands on main afterwards, and it resets to
 * nothing the moment a deploy succeeds.
 *
 * Needs no secret. `/api/health` reports `deploymentCommitSha` to any anonymous caller, in keeping
 * with the calling workflow's no-secrets contract, and the compare API read is a public repository
 * read. It shares nothing with the Railway deploy webhook on purpose: that path has its own failure
 * modes, and a detector depending on the thing it watches is not a detector.
 */

const MS_PER_HOUR = 3_600_000;

/**
 * @param {object} input
 * @param {string|null|undefined} input.liveSha    `deploymentCommitSha` from /api/health
 * @param {object|null} input.compare              GitHub `compare/{liveSha}...{branch}` payload
 * @param {number} input.nowMs
 * @param {number} input.maxLagHours
 */
export function assessDeploymentFreshness({ liveSha, compare, nowMs, maxLagHours }) {
  if (!liveSha) {
    return {
      ok: false,
      code: "no_deployment_sha",
      message: "/api/health reported no deploymentCommitSha, so a stranded deployment can no longer be detected here.",
    };
  }
  if (!compare || typeof compare.status !== "string") {
    return { ok: false, code: "compare_unavailable", message: `Could not compare ${liveSha} against the branch.` };
  }

  if (compare.status === "identical") {
    return { ok: true, code: "current", message: `Live deployment is at the branch head (${liveSha}).` };
  }

  // "behind" means the branch is behind the live commit, "diverged" means neither contains the
  // other. Either way what production is running is not on the branch, which is its own alarm:
  // nobody can say what is serving the site.
  if (compare.status !== "ahead") {
    return {
      ok: false,
      code: "not_on_branch",
      message: `Live deployment ${liveSha} is ${compare.status} relative to the branch, so what is serving production is not branch history.`,
    };
  }

  // `compare` returns the commits present on the branch and absent from the live commit, oldest
  // first, so [0] is the first commit that failed to ship. Its age is how long deploys have been
  // failing to land — which is the number that does not reset when more work lands on top.
  const oldest = compare.commits?.[0];
  const oldestAt = oldest?.commit?.committer?.date ?? oldest?.commit?.author?.date;
  if (!oldestAt) {
    return {
      ok: false,
      code: "compare_unavailable",
      message: `The branch is ahead of ${liveSha} but the comparison listed no dated commits.`,
    };
  }

  const lagHours = (nowMs - Date.parse(oldestAt)) / MS_PER_HOUR;
  const behindBy = compare.ahead_by ?? compare.commits.length;
  const detail = `Oldest unshipped commit ${oldest.sha?.slice(0, 9)} (${oldestAt}) is ${lagHours.toFixed(1)}h old; ${behindBy} commit(s) have not reached production.`;

  if (lagHours > maxLagHours) {
    return { ok: false, code: "stranded", lagHours, behindBy, message: detail };
  }
  return { ok: true, code: "shipping", lagHours, behindBy, message: detail };
}

async function main() {
  const domain = process.env.LIVE_DOMAIN_URL;
  const repo = process.env.REPO;
  const branch = process.env.BRANCH || "main";
  const maxLagHours = Number(process.env.MAX_LAG_HOURS || 12);
  if (!domain || !repo) throw new Error("LIVE_DOMAIN_URL and REPO are required.");

  const headers = { accept: "application/vnd.github+json" };
  if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`;

  const health = await fetch(new URL("/api/health", domain), { cache: "no-store" });
  if (!health.ok) throw new Error(`GET /api/health returned ${health.status}`);
  const liveSha = (await health.json())?.deploymentCommitSha ?? null;

  let compare = null;
  if (liveSha) {
    const response = await fetch(`https://api.github.com/repos/${repo}/compare/${liveSha}...${branch}`, { headers });
    // A 404 here means the live commit is not in this repository at all, which
    // `assessDeploymentFreshness` reports as `not_on_branch` rather than a crash.
    compare = response.ok ? await response.json() : { status: "unknown" };
  }

  const result = assessDeploymentFreshness({ liveSha, compare, nowMs: Date.now(), maxLagHours });
  if (result.ok) {
    console.log(result.message);
    return;
  }
  console.log(`::error::${result.message}`);
  if (result.code === "stranded") {
    console.log(
      "::error::Deploys are not landing. A deployment that builds and starts but fails its healthcheck is discarded and rolled back, leaving the site up on older code.",
    );
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.log(`::error::Deployment freshness check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
