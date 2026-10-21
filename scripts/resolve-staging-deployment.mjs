#!/usr/bin/env node
/**
 * scripts/resolve-staging-deployment.mjs
 *
 * Decides which commit the staging tenancy harness may prove, before the harness creates any
 * client or fixture. Read-only: one `GET /api/health` per poll against the staging app, plus
 * local `git` reads. It never deploys, writes or calls a provider.
 *
 * WHY. The harness compares the staging app's self-reported commit with the commit it checked
 * out. Railway redeploys staging only when a push changes a file in `railway.app.json`
 * watchPatterns, so after any documentation-only merge staging runs an older commit than main
 * HEAD and an exact comparison can never pass on a schedule. Every nightly run from at least
 * 2026-09-14 to 2026-10-20 stopped there, so the On Call and Roster probes never ran (#3113).
 *
 * RELATIONS
 *   exact       — staging reports the checkout commit.
 *   equivalent  — staging reports an ancestor of the checkout and nothing between them changes a
 *                 file the app service watches, so the deployed app is built from the same inputs.
 *                 Only allowed with `--allow-equivalent` (the nightly and the main-push gate).
 *   stale       — an app-affecting change is waiting and staging has not deployed it. Polled
 *                 until `--wait-seconds` runs out, then reported as its own clear failure.
 *   superseded  — staging already runs a NEWER commit whose app files differ from the checkout's.
 *                 Not a failure on the nightly or the gate: the run for that newer commit proves it.
 *                 (A newer commit with the same app files is `equivalent`.) A strict proof fails.
 *   unrelated   — staging reports a commit on neither side of the checkout's history.
 *
 * A dispatched release proof stays strict (exact only), as docs/staging-tenancy-release-evidence.md
 * requires.
 *
 * Env: CROSS_TENANT_STAGING_APP_URL (https origin, never psychiatry.tools),
 *      CROSS_TENANT_CHECKOUT_COMMIT_SHA (full SHA). Writes `deployed_sha` and `relation` to
 *      $GITHUB_OUTPUT when set. Exit 0 on exact/equivalent (and superseded with --allow-equivalent), 1 otherwise.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { deployTriggeringFiles } from "./lib/railway-watch-patterns.mjs";

const PRODUCTION_APP_HOST = "psychiatry.tools";
const SHA = /^[a-f0-9]{40}$/;

/**
 * @param {{
 *   deployedSha: string;
 *   checkoutSha: string;
 *   deployedIsAncestor: boolean;
 *   deployedIsDescendant?: boolean;
 *   changedFiles: readonly string[];
 *   watchPatterns: readonly string[];
 *   allowEquivalent: boolean;
 * }} input
 * @returns {{ relation: "exact" | "equivalent" | "stale" | "superseded" | "unrelated"; waitingFiles: string[] }}
 */
export function classifyStagingDeployment(input) {
  if (input.deployedSha === input.checkoutSha) return { relation: "exact", waitingFiles: [] };
  // changedFiles is the diff between the two commits, whichever is older.
  const appFiles = deployTriggeringFiles(input.watchPatterns, input.changedFiles);
  if (input.deployedIsAncestor) {
    if (appFiles.length === 0 && input.allowEquivalent) return { relation: "equivalent", waitingFiles: [] };
    return { relation: "stale", waitingFiles: appFiles };
  }
  if (input.deployedIsDescendant) {
    if (appFiles.length === 0 && input.allowEquivalent) return { relation: "equivalent", waitingFiles: [] };
    return { relation: "superseded", waitingFiles: [] };
  }
  return { relation: "unrelated", waitingFiles: [] };
}

/** @param {string} value */
export function parseStagingAppOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("CROSS_TENANT_STAGING_APP_URL must use https.");
  const host = url.hostname.toLowerCase();
  if (host === PRODUCTION_APP_HOST || host.endsWith(`.${PRODUCTION_APP_HOST}`)) {
    throw new Error("Refusing to read the production application host as staging.");
  }
  return url.origin;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function ensureCommit(sha) {
  try {
    git(["cat-file", "-e", `${sha}^{commit}`]);
  } catch {
    // A shallow checkout may not hold the deployed commit yet; fetch just that object.
    git(["fetch", "--quiet", "--no-tags", "origin", sha]);
  }
}

function isAncestor(ancestor, descendant) {
  try {
    git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

async function readDeployedSha(origin) {
  const response = await fetch(`${origin}/api/health`, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GET /api/health returned ${response.status}.`);
  const body = await response.json();
  const sha = typeof body?.deploymentCommitSha === "string" ? body.deploymentCommitSha.toLowerCase() : "";
  if (!SHA.test(sha)) throw new Error("GET /api/health did not report a full deploymentCommitSha.");
  return sha;
}

function parseArgs(argv) {
  const options = { allowEquivalent: false, waitSeconds: 0, pollSeconds: 30 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-equivalent") options.allowEquivalent = true;
    else if (arg === "--wait-seconds") options.waitSeconds = Math.max(0, Number(argv[++index]) || 0);
    else if (arg === "--poll-seconds") options.pollSeconds = Math.max(5, Number(argv[++index]) || 30);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function writeOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const origin = parseStagingAppOrigin(process.env.CROSS_TENANT_STAGING_APP_URL ?? "");
  const checkoutSha = (process.env.CROSS_TENANT_CHECKOUT_COMMIT_SHA ?? "").toLowerCase();
  if (!SHA.test(checkoutSha)) throw new Error("CROSS_TENANT_CHECKOUT_COMMIT_SHA must be a full commit SHA.");
  const watchPatterns = JSON.parse(readFileSync("railway.app.json", "utf8")).build?.watchPatterns ?? [];

  const deadline = Date.now() + options.waitSeconds * 1000;
  for (;;) {
    const deployedSha = await readDeployedSha(origin);
    ensureCommit(deployedSha);
    const deployedIsAncestor = isAncestor(deployedSha, checkoutSha);
    const deployedIsDescendant = !deployedIsAncestor && isAncestor(checkoutSha, deployedSha);
    // --no-renames lists both sides of a move, so an app file moved out of a watched path still counts.
    const changedFiles =
      deployedIsAncestor || deployedIsDescendant
        ? git([
            "diff",
            "--name-only",
            "--no-renames",
            deployedIsAncestor ? `${deployedSha}..${checkoutSha}` : `${checkoutSha}..${deployedSha}`,
          ]).split("\n")
        : [];
    const result = classifyStagingDeployment({
      deployedSha,
      checkoutSha,
      deployedIsAncestor,
      deployedIsDescendant,
      changedFiles,
      watchPatterns,
      allowEquivalent: options.allowEquivalent,
    });
    if (result.relation === "exact" || result.relation === "equivalent") {
      console.log(`Staging runs ${deployedSha} (${result.relation} to checkout ${checkoutSha}).`);
      writeOutputs({ deployed_sha: deployedSha, relation: result.relation });
      return 0;
    }
    if (result.relation === "superseded" && options.allowEquivalent) {
      // Waiting cannot help: staging only moves forward. The run for the newer commit proves it.
      console.log(
        `STAGING_SUPERSEDED: staging already runs ${deployedSha}, newer than ${checkoutSha} with different app files; ` +
          "the run for that commit proves it. Separation was not tested in this run.",
      );
      writeOutputs({ deployed_sha: deployedSha, relation: result.relation });
      return 0;
    }
    if (Date.now() >= deadline) {
      writeOutputs({ deployed_sha: deployedSha, relation: result.relation });
      if (result.relation === "unrelated") {
        console.error(`STAGING_UNRELATED: staging runs ${deployedSha}, which is not on the history of ${checkoutSha}.`);
      } else if (result.relation === "superseded") {
        console.error(
          `STAGING_NOT_EXACT: staging runs ${deployedSha}, newer than the commit this run proves (${checkoutSha}). ` +
            "Redeploy staging at that commit.",
        );
      } else if (result.waitingFiles.length === 0) {
        console.error(
          `STAGING_NOT_EXACT: staging runs ${deployedSha}, an earlier commit with the same app inputs, ` +
            `but this run proves the exact commit ${checkoutSha}. Redeploy staging at that commit.`,
        );
      } else {
        const shown = result.waitingFiles.slice(0, 10).join(", ");
        console.error(
          `STAGING_STALE: staging still runs ${deployedSha}; ${result.waitingFiles.length} app file(s) changed ` +
            `since then have not been deployed (${shown}${result.waitingFiles.length > 10 ? ", ..." : ""}). ` +
            "Separation was NOT tested. Check the staging deployments in Railway.",
        );
      }
      return 1;
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollSeconds * 1000));
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
