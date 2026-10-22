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
 * TWO REFINEMENTS, BOTH FROM 2026-10-21 (#3685).
 *
 *   1. "Oldest" means the first change to LAND ON MAIN after the live commit, dated by when it
 *      landed. A merged pull request carries its branch commits with their own authored dates, so
 *      a branch started yesterday and merged a minute ago used to read as a day-old outage. The
 *      age now comes from the first-parent chain of `main` (merge and squash commits, which are
 *      dated when they landed), falling back to the oldest listed commit when the chain cannot be
 *      rebuilt from the comparison.
 *   2. A comparison that touches nothing the app service watches (`railway.app.json`
 *      `build.watchPatterns`) has nothing to ship. Railway answers those pushes "No deployment
 *      needed", so the live commit legitimately stays behind `main`. For the same reason the age
 *      runs from the first landed change that touches a watched file: docs-only merges sitting
 *      unshipped before it are not an outage, and dating from them raised a false alarm the moment
 *      an app change landed on top of them.
 *
 * Needs no secret. `/api/health` reports `deploymentCommitSha` to any anonymous caller, in keeping
 * with the calling workflow's no-secrets contract, and the compare API read is a public repository
 * read. It shares nothing with the Railway deploy webhook on purpose: that path has its own failure
 * modes, and a detector depending on the thing it watches is not a detector.
 */

import { readFileSync } from "node:fs";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const MS_PER_HOUR = 3_600_000;
// GitHub's compare API lists at most 300 changed files; a list that long may be cut short.
const COMPARE_FILE_LIMIT = 300;
// Per-commit file lookups the CLI makes while looking for the first watched change. Past this,
// the age falls back to the first landed change, which can only over-report.
const COMMIT_FILE_LOOKUPS = 40;

function patternToRegExp(pattern) {
  const body = pattern
    .replace(/^\//, "")
    .split("**")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

/**
 * Railway-style watch patterns: a leading `/` anchors at the repository root, `**` crosses
 * directories, `*` does not, and a `!` pattern excludes. The last matching pattern wins.
 */
export function matchesWatchPatterns(file, patterns) {
  let watched = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    if (patternToRegExp(negated ? pattern.slice(1) : pattern).test(file)) watched = !negated;
  }
  return watched;
}

/**
 * The commits that landed on the branch after the live commit, oldest first, rebuilt by walking
 * first parents back from the branch head. Returns null when the comparison cannot support the
 * walk (truncated list, or no parent data), so the caller falls back to the listed order.
 */
export function firstParentChain(compare) {
  const commits = Array.isArray(compare.commits) ? compare.commits : [];
  if (commits.length === 0) return null;
  if (typeof compare.ahead_by === "number" && compare.ahead_by > commits.length) return null;
  const bySha = new Map(commits.map((entry) => [entry.sha, entry]));
  const referenced = new Set();
  for (const entry of commits) {
    if (!Array.isArray(entry.parents)) return null;
    for (const parent of entry.parents) referenced.add(parent.sha);
  }
  const heads = commits.filter((entry) => !referenced.has(entry.sha));
  if (heads.length !== 1) return null;
  const chain = [];
  for (let entry = heads[0]; entry; entry = bySha.get(entry.parents[0]?.sha)) chain.push(entry);
  return chain.reverse();
}

const commitDate = (entry) => entry?.commit?.committer?.date ?? entry?.commit?.author?.date;

/** A commit whose file list is unknown or may be cut short counts as watched, so the check fails closed. */
export function touchesWatchedFile(files, patterns) {
  if (!Array.isArray(files) || files.length >= COMPARE_FILE_LIMIT) return true;
  return files.some((file) => matchesWatchPatterns(file, patterns));
}

/**
 * @param {object} input
 * @param {string|null|undefined} input.liveSha    `deploymentCommitSha` from /api/health
 * @param {object|null} input.compare              GitHub `compare/{liveSha}...{branch}` payload
 * @param {number} input.nowMs
 * @param {number} input.maxLagHours
 * @param {string[]} [input.watchPatterns]   the app service's Railway watch patterns, if known
 * @param {Map<string, string[]>} [input.commitFiles]  files each landed commit changed, by sha
 */
export function assessDeploymentFreshness({ liveSha, compare, nowMs, maxLagHours, watchPatterns, commitFiles }) {
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

  // Only changes the app service watches are ever deployed. When the comparison's complete file
  // list touches none of them, every unshipped commit is one Railway rightly declined to deploy.
  if (
    Array.isArray(watchPatterns) &&
    watchPatterns.length > 0 &&
    Array.isArray(compare.files) &&
    compare.files.length > 0 &&
    compare.files.length < COMPARE_FILE_LIMIT &&
    !compare.files.some((file) => matchesWatchPatterns(file.filename, watchPatterns))
  ) {
    return {
      ok: true,
      code: "nothing_to_ship",
      message: `Live deployment ${liveSha} is behind the branch only by changes the app service does not deploy.`,
    };
  }

  // The first change to land on the branch after the live commit, dated by when it landed. Its age
  // is how long deploys have been failing to land — the number that does not reset when more work
  // lands on top. When the files each landed commit changed are known, start from the first one
  // that touches a watched file. Without a usable first-parent chain, fall back to the oldest
  // listed commit (`compare` lists the branch-only commits oldest first).
  const chain = firstParentChain(compare);
  const firstWatched =
    chain && commitFiles instanceof Map && Array.isArray(watchPatterns) && watchPatterns.length > 0
      ? chain.find((entry) => touchesWatchedFile(commitFiles.get(entry.sha), watchPatterns))
      : undefined;
  const oldest = firstWatched ?? (chain ? chain[0] : compare.commits?.[0]);
  const oldestAt = commitDate(oldest);
  if (!oldestAt) {
    return {
      ok: false,
      code: "compare_unavailable",
      message: `The branch is ahead of ${liveSha} but the comparison listed no dated commits.`,
    };
  }

  const lagHours = (nowMs - Date.parse(oldestAt)) / MS_PER_HOUR;
  const behindBy = compare.ahead_by ?? compare.commits.length;
  const detail = `Oldest unshipped change ${oldest.sha?.slice(0, 9)} (landed ${oldestAt}) is ${lagHours.toFixed(1)}h old; ${behindBy} commit(s) have not reached production.`;

  if (lagHours > maxLagHours) {
    return { ok: false, code: "stranded", lagHours, behindBy, message: detail };
  }
  return { ok: true, code: "shipping", lagHours, behindBy, message: detail };
}

/** Missing or unreadable config means no watch-path filtering, never a crash: the check fails closed. */
function readWatchPatterns(path) {
  try {
    const patterns = JSON.parse(readFileSync(path, "utf8"))?.build?.watchPatterns;
    return Array.isArray(patterns) ? patterns.filter((pattern) => typeof pattern === "string") : [];
  } catch {
    return [];
  }
}

async function main() {
  const domain = process.env.LIVE_DOMAIN_URL;
  const repo = process.env.REPO;
  const branch = process.env.BRANCH || "main";
  const maxLagHours = Number(process.env.MAX_LAG_HOURS || 12);
  if (!domain || !repo) throw new Error("LIVE_DOMAIN_URL and REPO are required.");
  const watchPatterns = readWatchPatterns(process.env.RAILWAY_APP_CONFIG || "railway.app.json");

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

  // The files each landed commit changed, oldest first, until the first one the app service
  // watches. A failed lookup stops the walk, and the assessment then treats that commit as watched.
  const commitFiles = new Map();
  const chain = compare?.status === "ahead" && watchPatterns.length > 0 ? firstParentChain(compare) : null;
  for (const entry of (chain ?? []).slice(0, COMMIT_FILE_LOOKUPS)) {
    const response = await fetch(`https://api.github.com/repos/${repo}/commits/${entry.sha}`, { headers });
    if (!response.ok) break;
    const files = ((await response.json())?.files ?? []).map((file) => file.filename);
    commitFiles.set(entry.sha, files);
    if (touchesWatchedFile(files, watchPatterns)) break;
  }

  const result = assessDeploymentFreshness({
    liveSha,
    compare,
    nowMs: Date.now(),
    maxLagHours,
    watchPatterns,
    commitFiles,
  });
  if (result.ok) {
    console.log(result.message);
    return;
  }
  console.log(`::error::${result.message}`);
  if (result.code === "stranded") {
    console.log(
      "::error::Deploys are not landing. Two known causes: Railway's Wait for CI skips the deploy of any commit with a failed workflow run (scheduled runs on that commit count, and Railway still labels the skip 'Success'), and a deployment that fails its healthcheck is discarded and rolled back. Either way the site stays up on older code.",
    );
  }
  process.exitCode = 1;
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.log(`::error::Deployment freshness check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
