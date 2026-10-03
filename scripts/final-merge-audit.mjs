#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const blockingMergeLabels = new Set(["hold", "do-not-merge"]);
export const requiredMergeChecks = new Map([["pr-required", new Set(["pr-required", "ci-pr-required"])]]);
const successfulCheckStates = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

function normalizeCheckName(check) {
  return String(check.name ?? check.context ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function run(executable, args, { json = false } = {}) {
  const stdout = execFileSync(executable, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  return json ? JSON.parse(stdout) : stdout;
}

function git(args) {
  return run("git", args);
}

function gh(args, options) {
  return run("gh", args, options);
}

/**
 * @param {Record<string, any>} snapshot
 * @param {{ expectedHead?: string, postMerge?: boolean }} [options]
 */
export function validatePullRequestSnapshot(snapshot, { expectedHead, postMerge = false } = {}) {
  const failures = [];
  const labels = (snapshot.labels ?? []).map((label) => String(label.name ?? label).toLowerCase());
  const blockingLabels = labels.filter((label) => blockingMergeLabels.has(label));
  const checks = snapshot.statusCheckRollup ?? [];
  const requiredChecks = checks.filter((check) =>
    [...requiredMergeChecks.values()].some((aliases) => aliases.has(normalizeCheckName(check))),
  );
  const missingRequiredChecks = [...requiredMergeChecks].flatMap(([requiredName, aliases]) =>
    checks.some((check) => aliases.has(normalizeCheckName(check))) ? [] : [requiredName],
  );
  const unsettledChecks = requiredChecks.filter((check) => {
    const state = String(check.conclusion ?? check.state ?? check.status ?? "").toUpperCase();
    return !successfulCheckStates.has(state);
  });

  if (postMerge) {
    if (snapshot.state !== "MERGED") failures.push(`PR state is ${snapshot.state ?? "unknown"}, expected MERGED`);
  } else {
    if (snapshot.state !== "OPEN") failures.push(`PR state is ${snapshot.state ?? "unknown"}, expected OPEN`);
    if (snapshot.isDraft) failures.push("PR is still a draft");
    if (/^\s*wip\b|do\s+not\s+merge/i.test(snapshot.title ?? "")) failures.push("PR title marks the change as WIP");
    if (snapshot.mergeable !== "MERGEABLE") {
      failures.push(`GitHub mergeability is ${snapshot.mergeable ?? "unknown"}, expected MERGEABLE`);
    }
    if (snapshot.mergeStateStatus !== "CLEAN") {
      failures.push(`GitHub merge state is ${snapshot.mergeStateStatus ?? "unknown"}, expected CLEAN`);
    }
    if (missingRequiredChecks.length > 0) {
      failures.push(`required check(s) missing: ${missingRequiredChecks.join(", ")}`);
    }
    if (unsettledChecks.length > 0) failures.push(`${unsettledChecks.length} check(s) are not settled successfully`);
    if (blockingLabels.length > 0) failures.push(`blocking label(s): ${blockingLabels.join(", ")}`);
  }
  if (expectedHead && snapshot.headRefOid !== expectedHead) {
    failures.push(`PR head ${snapshot.headRefOid ?? "unknown"} does not match expected head ${expectedHead}`);
  }

  return { failures, blockingLabels, missingRequiredChecks, requiredChecks, unsettledChecks };
}

function parseArgs(args) {
  const options = {
    baseRef: "origin/main",
    headRef: "HEAD",
    dryRun: false,
    providers: false,
    postMerge: false,
    pr: undefined,
    repo: undefined,
    expectedHead: undefined,
    expectedTree: undefined,
    healthUrl: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--dry-run") options.dryRun = true;
    else if (token === "--providers") options.providers = true;
    else if (token === "--post-merge") options.postMerge = true;
    else if (
      ["--base-ref", "--head-ref", "--pr", "--repo", "--expected-head", "--expected-tree", "--health-url"].includes(
        token,
      )
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
      const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = token === "--pr" ? Number(value) : value;
      index += 1;
    } else if (token === "--help" || token === "-h") {
      console.log(
        "Usage: npm run audit:final-merge -- [--dry-run] [--base-ref ref] [--head-ref ref] [--expected-head sha]\n" +
          "       [--providers --pr number --repo owner/name] [--post-merge --expected-tree tree --health-url url]\n" +
          "Provider reads require ALLOW_PROVIDER_READS=true. The audit never merges, pushes, reruns CI, or deploys.",
      );
      process.exit(0);
    } else throw new Error(`Unknown option: ${token}`);
  }

  if (options.postMerge) options.providers = true;
  if (options.providers && (!Number.isInteger(options.pr) || options.pr <= 0)) {
    throw new Error("--providers requires a positive --pr number.");
  }
  if (options.postMerge && !options.expectedTree) throw new Error("--post-merge requires --expected-tree.");
  return options;
}

function repositoryFromOrigin() {
  const remote = git(["remote", "get-url", "origin"]);
  const match = remote.match(/(?:github\.com[/:])([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (!match) throw new Error("Could not infer a GitHub owner/name from origin; pass --repo owner/name.");
  return `${match[1]}/${match[2]}`;
}

function localAudit(options) {
  const failures = [];
  const baseSha = git(["rev-parse", `${options.baseRef}^{commit}`]);
  const headSha = git(["rev-parse", `${options.headRef}^{commit}`]);
  const mergeBase = git(["merge-base", baseSha, headSha]);
  let mergeTree = null;
  try {
    mergeTree = git(["merge-tree", "--write-tree", baseSha, headSha]).split(/\r?\n/)[0];
  } catch {
    failures.push("local merge-tree could not be produced cleanly");
  }
  if (!options.postMerge && mergeBase !== baseSha)
    failures.push(`${options.headRef} does not contain ${options.baseRef}`);
  if (options.expectedHead && headSha !== options.expectedHead) {
    failures.push(`local head ${headSha} does not match expected head ${options.expectedHead}`);
  }
  if (!options.postMerge && git(["status", "--porcelain"])) failures.push("worktree has uncommitted changes");
  return { baseSha, headSha, mergeBase, mergeTree, failures };
}

async function providerAudit(options, local) {
  if (process.env.ALLOW_PROVIDER_READS !== "true") {
    throw new Error("Provider audit requires explicit ALLOW_PROVIDER_READS=true confirmation.");
  }

  const repo = options.repo ?? repositoryFromOrigin();
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("--repo must use owner/name format.");
  const snapshot = gh(
    [
      "pr",
      "view",
      String(options.pr),
      "--repo",
      repo,
      "--json",
      "number,state,isDraft,title,baseRefName,headRefName,headRefOid,mergeStateStatus,mergeable,labels,statusCheckRollup,mergeCommit,url",
    ],
    { json: true },
  );
  const expectedHead = options.expectedHead ?? local.headSha;
  const validation = validatePullRequestSnapshot(snapshot, { expectedHead, postMerge: options.postMerge });
  const failures = [...validation.failures];
  const expectedBaseName = options.baseRef.replaceAll("\\", "/").split("/").at(-1);
  if (snapshot.baseRefName !== expectedBaseName) {
    failures.push(`PR base ${snapshot.baseRefName ?? "unknown"} does not match expected base ${expectedBaseName}`);
  }

  const remoteBase = gh(["api", `repos/${repo}/git/ref/heads/${snapshot.baseRefName}`], { json: true }).object?.sha;
  if (!remoteBase) failures.push("remote base SHA was unavailable");
  else if (!options.postMerge && remoteBase !== local.baseSha) {
    failures.push(`local ${options.baseRef} ${local.baseSha} is stale; remote base is ${remoteBase}`);
  }

  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}pageInfo{hasNextPage}}}}}`;
  const threadPayload = gh(
    [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${options.pr}`,
    ],
    { json: true },
  );
  const unresolvedThreads =
    threadPayload.data?.repository?.pullRequest?.reviewThreads?.nodes?.filter((thread) => !thread.isResolved).length ??
    0;
  if (threadPayload.data?.repository?.pullRequest?.reviewThreads?.pageInfo?.hasNextPage) {
    failures.push("review-thread audit exceeded 100 threads; paginate before merging");
  }
  if (!options.postMerge && unresolvedThreads > 0) failures.push(`${unresolvedThreads} unresolved review thread(s)`);

  let remoteTree = null;
  if (options.postMerge && remoteBase) {
    remoteTree = gh(["api", `repos/${repo}/git/commits/${remoteBase}`], { json: true }).tree?.sha ?? null;
    if (remoteTree !== options.expectedTree) {
      failures.push(`remote main tree ${remoteTree ?? "unknown"} does not match expected tree ${options.expectedTree}`);
    }
  }

  let health = null;
  if (options.healthUrl) {
    const response = await fetch(options.healthUrl, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => null);
    health = { status: response.status, ok: response.ok, appStatus: payload?.status ?? null };
    if (!response.ok) failures.push(`deployment health returned HTTP ${response.status}`);
    else if (payload?.status !== "ok") failures.push(`deployment health status is ${payload?.status ?? "unavailable"}`);
  } else if (options.postMerge) failures.push("post-merge audit requires --health-url for deployment proof");

  return { repo, snapshot, remoteBase, remoteTree, unresolvedThreads, health, failures };
}

async function main(args) {
  const options = parseArgs(args);
  const local = localAudit(options);
  console.log(
    JSON.stringify(
      {
        phase: options.postMerge ? "post-merge" : "pre-merge",
        local: {
          baseSha: local.baseSha,
          headSha: local.headSha,
          mergeBase: local.mergeBase,
          expectedMergeTree: local.mergeTree,
          failures: local.failures,
        },
        providerPlan: options.providers
          ? ["fresh remote base/head", "required checks", "review threads", "labels", "remote tree equality", "health"]
          : "not requested",
      },
      null,
      2,
    ),
  );

  if (options.dryRun) return local.failures.length ? 1 : 0;

  const provider = options.providers ? await providerAudit(options, local) : null;
  if (provider) {
    console.log(
      JSON.stringify(
        {
          repo: provider.repo,
          pr: provider.snapshot.number,
          url: provider.snapshot.url,
          remoteBase: provider.remoteBase,
          remoteTree: provider.remoteTree,
          unresolvedThreads: provider.unresolvedThreads,
          health: provider.health,
          failures: provider.failures,
        },
        null,
        2,
      ),
    );
  }

  const failures = [...local.failures, ...(provider?.failures ?? [])];
  if (failures.length > 0) {
    console.error("Final merge audit failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    return 1;
  }
  console.log("Final merge audit passed.");
  return 0;
}

if (isDirectEntrypoint(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
