#!/usr/bin/env node
/**
 * ci-main-tree-proof — on a push to `main`, decide which heavy CI jobs were already proven
 * green on the IDENTICAL tree by the merged pull request's own CI run, so the push run can
 * skip re-running them.
 *
 * Why this is sound. The `Protections` ruleset requires branches to be up to date
 * (`strict_required_status_checks_policy: true`) and blocks non-fast-forward pushes to main.
 * A PR can therefore only merge when its head H contains the current main tip, and that
 * merge (merge commit or squash) produces a main commit whose tree equals H's tree. The PR's
 * `pull_request` CI run tested `refs/pull/N/merge` = merge(main-at-the-time, H); every earlier
 * main tip is an ancestor of the pre-merge tip (fast-forward only), which this script proves
 * is an ancestor of H, so that tested tree is H's tree too. Same tree, same workflow file,
 * same tests: re-running the job on main repeats a verdict it already has.
 *
 * Nothing is assumed that is not checked. Every condition below must hold, or EVERY output
 * is `false` and the push run does the full job set exactly as before (fail closed):
 *   1. the event is a push to refs/heads/main and the push added exactly one commit
 *      (HEAD^1 == github.event.before);
 *   2. GitHub associates exactly one merged PR into main with that commit as its merge commit;
 *   3. the PR head H contains the pre-merge main tip (it was up to date);
 *   4. tree(HEAD) == tree(H) — byte-identical repository, workflows included;
 *   5. a completed, successful `pull_request` run of THIS workflow file exists for H, finished
 *      no more than MAX_PROOF_AGE_HOURS ago (default 24; bounds date/external drift);
 *   6. that run RECORDED the tree it actually tested (the `CI tested tree` notice its own Change
 *      scope job writes via --record-tested-tree from the checked-out GITHUB_SHA), and that
 *      recorded tree equals tree(HEAD). The API's `head_sha` is the PR head, not the checkout the
 *      run tested (refs/pull/N/merge), so the proof is the run's own record, not a derivation;
 *   7. the PR comes from this repository, not a fork;
 *   8. in that run, every leg of the job being skipped concluded `success`. A job that was
 *      skipped on the PR (out of PR scope, draft, label) proves nothing and is NOT skipped on
 *      main — e.g. a lockfile-only merge still runs Lighthouse on main, as it does today.
 *
 * Only jobs whose result depends solely on the tree are eligible: unit coverage, the Chromium
 * production UI suite and the Lighthouse budget. Everything with main-only behaviour keeps
 * running on every push: static checks, safety, Build (its deployment boot smoke uses
 * production secrets and runs only on main), the Playwright build, visual baselines, the
 * Firefox/WebKit release-browser-matrix (it never runs on a PR, so nothing proved it) and
 * main-failure routing. The weekly scheduled run and every dispatch never take this path.
 *
 * Outputs (GITHUB_OUTPUT): coverage, ui, lighthouse ("true"/"false"), proof_run_url, reason.
 * Uses only the job's GITHUB_TOKEN (actions: read, pull-requests: read) — about four REST
 * calls per main push. Every proved job checks out the run's GITHUB_SHA (no `ref:` override,
 * pinned by tests/ci-main-tree-proof.test.ts), so the Change scope record covers every leg.
 *
 * Run:  node scripts/ci-main-tree-proof.mjs              (in CI)
 *       node scripts/ci-main-tree-proof.mjs --self-test  (offline unit checks)
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
export const TESTED_TREE_TITLE = "CI tested tree";
const TESTED_TREE_MESSAGE = /^event=(\S+) sha=([0-9a-f]{40}) tree=([0-9a-f]{40})$/;
export const DEFAULT_MAX_PROOF_AGE_HOURS = 24;

/**
 * Proof groups: every job a group skips on main, matched by exact job name or matrix-leg
 * pattern. Each pattern must match at least one job, and every matching job must be
 * `success`, for the group to count as proven.
 */
export const PROOF_GROUPS = {
  coverage: [/^Unit coverage partition \(\d+\)$/, /^Unit coverage$/],
  // The PR run splits production Chromium into the @critical subset plus the shards that
  // exclude it; together they are the complete project that the main run executes unsplit.
  ui: [/^Playwright Next build$/, /^Production UI critical$/, /^Production UI \(\d+\)$/],
  lighthouse: [/^Lighthouse budget$/],
};

const NONE = Object.freeze({ coverage: false, ui: false, lighthouse: false });

/** Which proof groups a PR run's job list establishes. Pure. */
export function classifyProof(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const result = {};
  for (const [group, patterns] of Object.entries(PROOF_GROUPS)) {
    result[group] = patterns.every((pattern) => {
      const legs = list.filter((job) => pattern.test(String(job?.name ?? "")));
      return legs.length > 0 && legs.every((job) => job?.status === "completed" && job?.conclusion === "success");
    });
  }
  return result;
}

/** The `CI tested tree` record a run's Change scope job wrote, or null unless exactly one. Pure. */
export function parseTestedTree(annotations) {
  const records = (Array.isArray(annotations) ? annotations : [])
    .filter((annotation) => annotation?.title === TESTED_TREE_TITLE)
    .map((annotation) =>
      String(annotation?.message ?? "")
        .trim()
        .match(TESTED_TREE_MESSAGE),
    )
    .filter(Boolean);
  if (records.length !== 1) return null;
  const [, event, sha, tree] = records[0];
  return { event, sha, tree };
}

/** The one merged-into-main PR whose merge commit is `sha`, or null. Pure. */
export function pickMergedPull(pulls, sha) {
  const matches = (Array.isArray(pulls) ? pulls : []).filter(
    (pr) => pr?.merged_at && pr?.merge_commit_sha === sha && pr?.base?.ref === "main" && pr?.head?.sha,
  );
  return matches.length === 1 ? matches[0] : null;
}

/** The newest successful, fresh pull_request run of ci.yml for `headSha`, or null. Pure. */
export function selectProvingRun(runs, { headSha, now = new Date(), maxAgeHours = DEFAULT_MAX_PROOF_AGE_HOURS }) {
  const maxAgeMs = maxAgeHours * 3_600_000;
  const candidates = (Array.isArray(runs) ? runs : [])
    .filter(
      (run) =>
        run?.event === "pull_request" &&
        run?.head_sha === headSha &&
        run?.path === CI_WORKFLOW_PATH &&
        run?.status === "completed" &&
        run?.conclusion === "success" &&
        Number.isFinite(Date.parse(run?.updated_at)) &&
        now.getTime() - Date.parse(run.updated_at) <= maxAgeMs &&
        Date.parse(run.updated_at) <= now.getTime() + 60_000,
    )
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return candidates[0] ?? null;
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || "").trim()}`);
  return result.stdout.trim();
}

function gitOk(args) {
  return spawnSync("git", args, { encoding: "utf8" }).status === 0;
}

async function api(path) {
  const base = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${base}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GET ${path} -> HTTP ${response.status}`);
  return response.json();
}

/** Every check in the module docblock, in order. Throws (→ full run) on any failure. */
export async function evaluate({
  env = process.env,
  now = new Date(),
  request = api,
  runGit = git,
  runGitOk = gitOk,
} = {}) {
  if (env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_REF !== "refs/heads/main") {
    return { proof: NONE, reason: "not a push to main" };
  }
  const repo = env.GITHUB_REPOSITORY;
  const sha = env.GITHUB_SHA;
  const before = env.BEFORE_SHA;
  if (!repo || !/^[0-9a-f]{40}$/.test(sha ?? "") || !/^[0-9a-f]{40}$/.test(before ?? "") || /^0+$/.test(before)) {
    return { proof: NONE, reason: "missing or unusable push SHAs" };
  }
  if (runGit(["rev-parse", "HEAD"]) !== sha) return { proof: NONE, reason: "checkout is not the pushed commit" };
  if (runGit(["rev-parse", "HEAD^1"]) !== before) {
    return { proof: NONE, reason: "push did not add exactly one commit on top of the previous main tip" };
  }

  const pull = pickMergedPull(await request(`/repos/${repo}/commits/${sha}/pulls?per_page=100`), sha);
  if (!pull) return { proof: NONE, reason: "no single merged PR has this commit as its merge commit" };
  const head = pull.head.sha;
  if (!/^[0-9a-f]{40}$/.test(head)) return { proof: NONE, reason: "PR head SHA is malformed" };
  if (pull.head?.repo?.full_name !== repo) {
    return { proof: NONE, reason: `PR #${pull.number} comes from a fork; its run's record is not trusted` };
  }

  if (!runGitOk(["cat-file", "-e", `${head}^{commit}`])) {
    // Squash merges leave the head outside main's history; the PR ref survives branch deletion.
    runGit([
      "fetch",
      "--no-tags",
      "--quiet",
      "origin",
      `+refs/pull/${pull.number}/head:refs/remotes/tree-proof/${pull.number}`,
    ]);
    if (!runGitOk(["cat-file", "-e", `${head}^{commit}`])) return { proof: NONE, reason: "PR head commit unavailable" };
  }
  if (!runGitOk(["merge-base", "--is-ancestor", before, head])) {
    return { proof: NONE, reason: `PR #${pull.number} head did not contain the previous main tip` };
  }
  const headTree = runGit(["rev-parse", `${head}^{tree}`]);
  const mainTree = runGit(["rev-parse", "HEAD^{tree}"]);
  if (headTree !== mainTree) return { proof: NONE, reason: `main tree differs from PR #${pull.number} head tree` };

  const maxAgeHours = Number(env.MAX_PROOF_AGE_HOURS || DEFAULT_MAX_PROOF_AGE_HOURS);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return { proof: NONE, reason: "invalid MAX_PROOF_AGE_HOURS" };
  const runs = await request(
    `/repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&status=completed&per_page=30`,
  );
  const run = selectProvingRun(runs?.workflow_runs, { headSha: head, now, maxAgeHours });
  if (!run) {
    return {
      proof: NONE,
      reason: `no successful pull_request CI run for PR #${pull.number} head within ${maxAgeHours}h`,
    };
  }
  const jobs = await request(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  if (!Array.isArray(jobs?.jobs) || jobs.total_count > jobs.jobs.length) {
    return { proof: NONE, reason: "could not read the proving run's complete job list" };
  }
  const scopeJobs = jobs.jobs.filter((job) => job?.name === "Change scope");
  if (scopeJobs.length !== 1 || scopeJobs[0].conclusion !== "success") {
    return { proof: NONE, reason: "the proving run has no single successful Change scope job" };
  }
  const tested = parseTestedTree(await request(`/repos/${repo}/check-runs/${scopeJobs[0].id}/annotations?per_page=50`));
  if (!tested || tested.event !== "pull_request") {
    return { proof: NONE, reason: `run ${run.id} did not record the tree it tested` };
  }
  if (tested.tree !== mainTree) {
    return { proof: NONE, reason: `run ${run.id} tested tree ${tested.tree.slice(0, 12)}, not this main tree` };
  }
  return {
    proof: classifyProof(jobs.jobs),
    reason: `run ${run.id} (PR #${pull.number}) recorded testing ${tested.sha.slice(0, 12)} whose tree equals this main tree`,
    runUrl: run.html_url ?? "",
  };
}

function writeOutputs({ proof, reason, runUrl = "" }) {
  const lines = [
    `coverage=${proof.coverage === true}`,
    `ui=${proof.ui === true}`,
    `lighthouse=${proof.lighthouse === true}`,
    `proof_run_url=${runUrl}`,
    `reason=${String(reason).replace(/[\r\n]+/g, " ")}`,
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const skipped = Object.entries(proof)
      .filter(([, value]) => value === true)
      .map(([group]) => group);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "### Main tree proof",
        "",
        `- Result: ${reason}`,
        runUrl ? `- Proving PR run: ${runUrl}` : "- Proving PR run: none",
        `- Skipped on this push (already green on the identical tree): ${skipped.length ? skipped.join(", ") : "nothing — full run"}`,
        "",
      ].join("\n"),
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`self-test: ${message}`);
}

async function selfTest() {
  const ok = (name, extra = {}) => ({ name, status: "completed", conclusion: "success", ...extra });
  const full = [
    { ...ok("Change scope"), id: 501 },
    ok("Unit coverage partition (1)"),
    ok("Unit coverage partition (2)"),
    ok("Unit coverage"),
    ok("Playwright Next build"),
    ok("Production UI critical"),
    ok("Production UI (1)"),
    ok("Production UI (2)"),
    ok("Production UI (3)"),
    ok("Lighthouse budget"),
  ];
  let proof = classifyProof(full);
  assert(proof.coverage && proof.ui && proof.lighthouse, "an all-green run proves every group");

  proof = classifyProof(
    full.map((job) => (job.name === "Production UI (2)" ? { ...job, conclusion: "skipped" } : job)),
  );
  assert(!proof.ui && proof.coverage, "one skipped shard un-proves only its group");
  proof = classifyProof(full.filter((job) => job.name !== "Lighthouse budget"));
  assert(!proof.lighthouse, "a job absent from the run proves nothing");
  proof = classifyProof(full.filter((job) => job.name !== "Production UI critical"));
  assert(!proof.ui, "the shards alone (which exclude @critical on PRs) do not prove the full suite");
  proof = classifyProof(
    full.map((job) => (job.name === "Unit coverage" ? { ...job, status: "in_progress", conclusion: null } : job)),
  );
  assert(!proof.coverage, "an unfinished job proves nothing");
  assert(
    Object.values(classifyProof([])).every((value) => value === false),
    "empty job list proves nothing",
  );

  const sha = "a".repeat(40);
  const pr = {
    number: 7,
    merged_at: "2026-10-06T00:00:00Z",
    merge_commit_sha: sha,
    base: { ref: "main" },
    head: { sha: "b".repeat(40), repo: { full_name: "o/r" } },
  };
  assert(pickMergedPull([pr], sha) === pr, "the merged PR is picked");
  assert(pickMergedPull([{ ...pr, merged_at: null }], sha) === null, "an unmerged PR is ignored");
  assert(pickMergedPull([{ ...pr, base: { ref: "release/x" } }], sha) === null, "a PR into another base is ignored");
  assert(pickMergedPull([pr, { ...pr, number: 8 }], sha) === null, "ambiguity is a full run");
  assert(
    pickMergedPull([{ ...pr, merge_commit_sha: "c".repeat(40) }], sha) === null,
    "another merge commit is ignored",
  );

  const now = new Date("2026-10-06T12:00:00Z");
  const run = {
    id: 1,
    event: "pull_request",
    head_sha: pr.head.sha,
    path: CI_WORKFLOW_PATH,
    status: "completed",
    conclusion: "success",
    updated_at: "2026-10-06T10:00:00Z",
  };
  assert(selectProvingRun([run], { headSha: pr.head.sha, now })?.id === 1, "a fresh green run proves");
  assert(
    selectProvingRun([{ ...run, updated_at: "2026-10-05T10:00:00Z" }], { headSha: pr.head.sha, now }) === null,
    "a run older than 24h is stale",
  );
  assert(
    selectProvingRun([{ ...run, conclusion: "failure" }], { headSha: pr.head.sha, now }) === null,
    "a red run proves nothing",
  );
  assert(
    selectProvingRun([{ ...run, event: "push" }], { headSha: pr.head.sha, now }) === null,
    "only pull_request runs count",
  );
  assert(
    selectProvingRun([{ ...run, path: ".github/workflows/other.yml" }], { headSha: pr.head.sha, now }) === null,
    "only this workflow counts",
  );
  assert(
    selectProvingRun([{ ...run, head_sha: "d".repeat(40) }], { headSha: pr.head.sha, now }) === null,
    "another head proves nothing",
  );
  assert(
    selectProvingRun([run, { ...run, id: 2, updated_at: "2026-10-06T11:00:00Z" }], { headSha: pr.head.sha, now })
      ?.id === 2,
    "the newest proving run wins",
  );

  // evaluate(): every guard fails closed, and the happy path proves.
  const before = "e".repeat(40);
  const tree = "f".repeat(40);
  const env = {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_SHA: sha,
    BEFORE_SHA: before,
  };
  const gitMap =
    (overrides = {}) =>
    (args) => {
      const key = args.join(" ");
      const table = {
        "rev-parse HEAD": sha,
        "rev-parse HEAD^1": before,
        [`rev-parse ${pr.head.sha}^{tree}`]: tree,
        "rev-parse HEAD^{tree}": tree,
        ...overrides,
      };
      if (key in table) return table[key];
      if (args[0] === "fetch") return "";
      throw new Error(`unexpected git ${key}`);
    };
  const record = (message, title = TESTED_TREE_TITLE) => [{ title, message, annotation_level: "notice" }];
  const testedRecord = record(`event=pull_request sha=${"9".repeat(40)} tree=${tree}`);
  const request = (runsOverride, jobsOverride, annotationsOverride) => async (path) => {
    if (path.includes("/commits/")) return [pr];
    if (path.includes("/workflows/")) return { workflow_runs: runsOverride ?? [run] };
    if (path.includes("/check-runs/501/annotations")) return annotationsOverride ?? testedRecord;
    if (path.includes("/jobs")) return jobsOverride ?? { total_count: full.length, jobs: full };
    throw new Error(`unexpected ${path}`);
  };
  const base = { env, now, request: request(), runGit: gitMap(), runGitOk: () => true };
  let result = await evaluate(base);
  assert(result.proof.coverage && result.proof.ui && result.proof.lighthouse, `happy path proves (${result.reason})`);
  result = await evaluate({ ...base, env: { ...env, GITHUB_EVENT_NAME: "schedule" } });
  assert(!result.proof.coverage, "schedule never takes the proof path");
  result = await evaluate({ ...base, env: { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" } });
  assert(!result.proof.ui, "dispatch never takes the proof path");
  result = await evaluate({ ...base, env: { ...env, GITHUB_REF: "refs/heads/release/x" } });
  assert(!result.proof.ui, "release branches never take the proof path");
  result = await evaluate({ ...base, runGit: gitMap({ "rev-parse HEAD^1": "1".repeat(40) }) });
  assert(!result.proof.ui, "a multi-commit push is a full run");
  result = await evaluate({ ...base, runGit: gitMap({ "rev-parse HEAD^{tree}": "2".repeat(40) }) });
  assert(!result.proof.ui, "a tree mismatch is a full run");
  result = await evaluate({ ...base, runGitOk: (args) => args[0] !== "merge-base" });
  assert(!result.proof.ui, "a PR head that was not up to date is a full run");
  result = await evaluate({ ...base, request: request([]) });
  assert(!result.proof.ui, "no proving run is a full run");
  result = await evaluate({ ...base, request: request(undefined, { total_count: 200, jobs: full }) });
  assert(!result.proof.ui, "a truncated job list is a full run");
  result = await evaluate({ ...base, env: { ...env, BEFORE_SHA: "0".repeat(40) } });
  assert(!result.proof.ui, "a branch-creation push is a full run");
  // Risk 1: the proof is the run's own record of the checkout it tested, never the API head_sha.
  result = await evaluate({ ...base, request: request(undefined, undefined, []) });
  assert(!result.proof.ui, "a run without a tested-tree record proves nothing");
  result = await evaluate({
    ...base,
    request: request(undefined, undefined, record(`event=pull_request sha=${"9".repeat(40)} tree=${"3".repeat(40)}`)),
  });
  assert(!result.proof.ui, "a run that tested a different tree (stale merge ref) proves nothing");
  result = await evaluate({
    ...base,
    request: request(undefined, undefined, record(`event=push sha=${"9".repeat(40)} tree=${tree}`)),
  });
  assert(!result.proof.ui, "only a pull_request run's record counts");
  result = await evaluate({ ...base, request: request(undefined, undefined, [...testedRecord, ...testedRecord]) });
  assert(!result.proof.ui, "an ambiguous double record proves nothing");
  result = await evaluate({
    ...base,
    request: request(undefined, undefined, record(`event=pull_request sha=${"9".repeat(40)} tree=${tree}`, "Other")),
  });
  assert(!result.proof.ui, "a differently titled annotation is not a record");
  result = await evaluate({
    ...base,
    request: request(undefined, { total_count: full.length - 1, jobs: full.slice(1) }),
  });
  assert(!result.proof.ui, "no Change scope job means no record");
  result = await evaluate({
    ...base,
    request: request(undefined, {
      total_count: full.length,
      jobs: full.map((job) => (job.name === "Change scope" ? { ...job, conclusion: "cancelled" } : job)),
    }),
  });
  assert(!result.proof.ui, "a cancelled Change scope job proves nothing");
  result = await evaluate({
    ...base,
    request: async (path) =>
      path.includes("/commits/") ? [{ ...pr, head: { ...pr.head, repo: { full_name: "fork/r" } } }] : request()(path),
  });
  assert(!result.proof.ui, "a fork PR's self-reported record is not trusted");
  result = await evaluate({ ...base, request: request([{ ...run, conclusion: "cancelled" }]) });
  assert(!result.proof.ui, "a cancelled run proves nothing");
  assert(parseTestedTree(testedRecord)?.tree === tree, "a well-formed record parses");
  const recorded = [];
  const originalLog = console.log;
  console.log = (line) => recorded.push(line);
  try {
    recordTestedTree({ env: { GITHUB_SHA: sha, GITHUB_EVENT_NAME: "pull_request" }, runGit: gitMap() });
    recordTestedTree({ env: { GITHUB_SHA: "4".repeat(40), GITHUB_EVENT_NAME: "pull_request" }, runGit: gitMap() });
  } finally {
    console.log = originalLog;
  }
  assert(
    recorded[0] === `::notice title=${TESTED_TREE_TITLE}::event=pull_request sha=${sha} tree=${tree}`,
    "the record names the checkout",
  );
  assert(recorded[1].startsWith("::warning::") && recorded.length === 2, "a moved checkout writes no record");
  console.log("ci-main-tree-proof self-test passed.");
}

/**
 * --record-tested-tree: run first in every CI run's Change scope job. Writes the checked-out
 * commit and tree as a check-run annotation, the reviewable record a later proof must match.
 * Writes nothing (so nothing can be proved from this run) if the checkout is not GITHUB_SHA.
 */
function recordTestedTree({ env = process.env, runGit = git } = {}) {
  const sha = runGit(["rev-parse", "HEAD"]);
  if (sha !== env.GITHUB_SHA) {
    console.log(`::warning::checkout ${sha} is not GITHUB_SHA ${env.GITHUB_SHA}; no tested-tree record written.`);
    return null;
  }
  const line = `event=${env.GITHUB_EVENT_NAME} sha=${sha} tree=${runGit(["rev-parse", "HEAD^{tree}"])}`;
  console.log(`::notice title=${TESTED_TREE_TITLE}::${line}`);
  return line;
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  if (process.argv.includes("--record-tested-tree")) {
    try {
      recordTestedTree();
    } catch (error) {
      console.log(`::warning::tested-tree record failed: ${String(error?.message ?? error)}`);
    }
    return;
  }
  let outcome;
  try {
    outcome = await evaluate();
  } catch (error) {
    console.log(
      `::warning title=Main tree proof unavailable::${String(error?.message ?? error)} — running the full job set.`,
    );
    outcome = { proof: NONE, reason: `error: ${String(error?.message ?? error)}` };
  }
  writeOutputs(outcome);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    // Never fail the `changes` job over a proof problem: an empty proof is a full run.
    console.log(`::warning::${String(error?.message ?? error)}`);
    writeOutputs({ proof: NONE, reason: "unexpected error" });
  });
}
