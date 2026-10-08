import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  classifyProof,
  evaluate,
  evaluatePullRequestUpdate,
  isUnrelatedInput,
  PROOF_GROUPS,
  reconstructTestedTree,
  selectPullRequestCandidates,
  UNRELATED_INPUT_RULES,
} from "../scripts/ci-main-tree-proof.mjs";

/**
 * Main tree proof: a push to `main` skips only the jobs the merged PR's own CI run already passed
 * on a byte-identical tree. Everything here pins the fail-closed shape — an absent or partial proof
 * must leave the push doing the full job set it did before, and the jobs with main-only behaviour
 * (Build + deployment boot smoke, the Firefox/WebKit release matrix) must never become skippable.
 */
const workflowText = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const workflow = createRequire(import.meta.url)("js-yaml").load(workflowText);
const jobs = workflow.jobs;
const ifOf = (job: string) => String(jobs[job].if ?? "");

type Step = {
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

describe("main tree proof script", () => {
  it("passes its offline self-test (every guard fails closed, the happy path proves)", () => {
    const result = spawnSync(process.execPath, ["scripts/ci-main-tree-proof.mjs", "--self-test"], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ci-main-tree-proof self-test passed.");
  });

  it("names exactly the PR-run jobs each group skips, matching ci.yml job names", () => {
    const names = Object.values(jobs).map((job) => String((job as { name?: string }).name ?? ""));
    for (const name of [
      "Unit coverage partition",
      "Unit coverage",
      "Playwright Next build",
      "Production UI critical",
      "Production UI",
      "Lighthouse budget",
    ]) {
      expect(names).toContain(name);
    }
    expect(Object.keys(PROOF_GROUPS).sort()).toEqual(["coverage", "lighthouse", "ui"]);
  });

  it("treats an unexpanded (skipped) matrix job as no proof", () => {
    // A matrix job skipped on the PR is reported under its bare name, without the `(N)` leg suffix.
    const skippedMatrix = [
      { name: "Unit coverage partition", status: "completed", conclusion: "skipped" },
      { name: "Unit coverage", status: "completed", conclusion: "success" },
      { name: "Playwright Next build", status: "completed", conclusion: "success" },
      { name: "Production UI critical", status: "completed", conclusion: "success" },
      { name: "Production UI", status: "completed", conclusion: "skipped" },
    ];
    expect(classifyProof(skippedMatrix)).toEqual({ coverage: false, ui: false, lighthouse: false });
  });

  it("proves every group in-process when a squash merge's PR head has the identical tree", async () => {
    const sha = "a".repeat(40);
    const before = "b".repeat(40);
    const head = "c".repeat(40);
    const tree = "d".repeat(40);
    const now = new Date("2026-10-06T02:00:00Z");
    const env = {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_SHA: sha,
      BEFORE_SHA: before,
    };
    const gitTable: Record<string, string> = {
      "rev-parse HEAD": sha,
      "rev-parse HEAD^1": before,
      [`rev-parse ${head}^{tree}`]: tree,
      "rev-parse HEAD^{tree}": tree,
    };
    const fetched: string[] = [];
    let headLocal = false;
    const runGit = (args: string[]) => {
      if (args[0] === "fetch") {
        fetched.push(args.at(-1) ?? "");
        headLocal = true;
        return "";
      }
      const value = gitTable[args.join(" ")];
      if (value === undefined) throw new Error(`unexpected git ${args.join(" ")}`);
      return value;
    };
    const runGitOk = (args: string[]) => (args[0] === "cat-file" ? headLocal : true);
    const ok = (name: string) => ({ name, status: "completed", conclusion: "success" });
    const prJobs = [
      "Change scope",
      "Unit coverage partition (1)",
      "Unit coverage partition (2)",
      "Unit coverage",
      "Playwright Next build",
      "Production UI critical",
      "Production UI (1)",
      "Production UI (2)",
      "Production UI (3)",
      "Lighthouse budget",
    ].map((name, index) => ({ ...ok(name), id: 700 + index }));
    const request = async (path: string) => {
      if (path.includes("/commits/")) {
        return [
          {
            number: 42,
            merged_at: "2026-10-06T01:59:00Z",
            merge_commit_sha: sha,
            base: { ref: "main" },
            head: { sha: head, repo: { full_name: "o/r" } },
          },
        ];
      }
      if (path.includes("/workflows/")) {
        return {
          workflow_runs: [
            {
              id: 9,
              event: "pull_request",
              head_sha: head,
              path: ".github/workflows/ci.yml",
              status: "completed",
              conclusion: "success",
              updated_at: "2026-10-06T01:30:00Z",
              html_url: "https://example.test/run/9",
            },
          ],
        };
      }
      // The proving run's own record of the merge-ref checkout it tested (not the PR head SHA).
      if (path.includes("/check-runs/700/annotations")) {
        return [{ title: "CI tested tree", message: `event=pull_request sha=${"f".repeat(40)} tree=${tree}` }];
      }
      if (path.includes("/jobs")) return { total_count: prJobs.length, jobs: prJobs };
      throw new Error(`unexpected ${path}`);
    };
    const result = await evaluate({ env: env as unknown as NodeJS.ProcessEnv, now, request, runGit, runGitOk });
    expect(fetched).toEqual(["+refs/pull/42/head:refs/remotes/tree-proof/42"]);
    expect(result.proof).toEqual({ coverage: true, ui: true, lighthouse: true });
    expect(result.runUrl).toBe("https://example.test/run/9");

    // Same evidence, one byte of tree drift: nothing is proven.
    gitTable["rev-parse HEAD^{tree}"] = "e".repeat(40);
    const drifted = await evaluate({ env: env as unknown as NodeJS.ProcessEnv, now, request, runGit, runGitOk });
    expect(drifted.proof).toEqual({ coverage: false, ui: false, lighthouse: false });
  });

  it("propagates API errors so the step's catch turns them into a full run", async () => {
    const sha = "a".repeat(40);
    const env = {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_SHA: sha,
      BEFORE_SHA: "b".repeat(40),
    };
    const runGit = (args: string[]) => (args.join(" ") === "rev-parse HEAD" ? sha : "b".repeat(40));
    await expect(
      evaluate({
        env: env as unknown as NodeJS.ProcessEnv,
        runGit,
        runGitOk: () => true,
        request: async () => {
          throw new Error("HTTP 403");
        },
      }),
    ).rejects.toThrow("HTTP 403");
  });

  it("never fails the job: an unusable environment still writes all-false outputs", () => {
    const result = spawnSync(process.execPath, ["scripts/ci-main-tree-proof.mjs"], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
        GITHUB_OUTPUT: "",
        GITHUB_STEP_SUMMARY: "",
        BEFORE_SHA: "",
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("coverage=false");
    expect(result.stdout).toContain("ui=false");
    expect(result.stdout).toContain("lighthouse=false");
  });
});

describe("main tree proof workflow wiring", () => {
  const steps = jobs.changes.steps as Step[];
  const proofStep = steps.find((step) => step.id === "tree-proof");

  it("runs only on pushes to main, with read-only scopes, and exports per-group outputs", () => {
    expect(proofStep).toBeDefined();
    expect(String(proofStep?.if).replace(/\s+/g, " ").trim()).toBe(
      "(github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'pull_request' && github.event.action == 'synchronize')",
    );
    expect(proofStep?.env?.PR_HEAD_REPO).toBe("${{ github.event.pull_request.head.repo.full_name }}");
    expect(proofStep?.env?.PR_HEAD_SHA).toBe("${{ github.event.pull_request.head.sha }}");
    expect(proofStep?.run).toBe("node scripts/ci-main-tree-proof.mjs");
    expect(proofStep?.env?.BEFORE_SHA).toBe("${{ github.event.before }}");
    expect(jobs.changes.permissions).toEqual({ contents: "read", actions: "read", "pull-requests": "read" });
    expect(jobs.changes.outputs.tree_proven_coverage).toBe("${{ steps.tree-proof.outputs.coverage }}");
    expect(jobs.changes.outputs.tree_proven_ui).toBe("${{ steps.tree-proof.outputs.ui }}");
    expect(jobs.changes.outputs.tree_proven_lighthouse).toBe("${{ steps.tree-proof.outputs.lighthouse }}");
    // The changes job checks out full history, which HEAD^1 and the ancestry check rely on.
    const checkout = steps.find((step) => String(step.uses ?? "").startsWith("actions/checkout@"));
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  it("records the tested tree on every event, and every proved job tests that same checkout", () => {
    const record = steps.find((step) => step.name === "Record tested tree");
    expect(record?.run).toBe("node scripts/ci-main-tree-proof.mjs --record-tested-tree");
    expect(record?.if).toBeUndefined();
    for (const job of [
      "changes",
      "coverage-shards",
      "coverage",
      "ui-playwright-build",
      "ui-critical-fast",
      "ui-critical",
      "lighthouse-budget",
    ]) {
      const checkouts = (jobs[job].steps as Step[]).filter((step) =>
        String(step.uses ?? "").startsWith("actions/checkout@"),
      );
      expect(checkouts.length, job).toBeGreaterThan(0);
      // No `ref:` override: each job tests the run's GITHUB_SHA, the commit Change scope records.
      for (const checkout of checkouts) expect(checkout.with?.ref, job).toBeUndefined();
    }
  });

  it("gates exactly the tree-determined jobs on their own group", () => {
    expect(ifOf("coverage-shards")).toContain("needs.changes.outputs.tree_proven_coverage != 'true'");
    expect(ifOf("coverage")).toContain("needs.changes.outputs.tree_proven_coverage != 'true'");
    expect(ifOf("ui-critical")).toContain("needs.changes.outputs.tree_proven_ui != 'true'");
    expect(ifOf("lighthouse-budget")).toContain("needs.changes.outputs.tree_proven_lighthouse != 'true'");

    const gated = Object.keys(jobs).filter((job) => /tree_proven_/.test(ifOf(job)));
    expect(gated.sort()).toEqual([
      "coverage",
      "coverage-shards",
      "lighthouse-budget",
      "ui-critical",
      "ui-critical-fast",
    ]);
    expect(ifOf("ui-critical-fast")).toContain("needs.changes.outputs.tree_proven_ui != 'true'");
  });

  it("keeps Build (deployment boot smoke) and the release browser matrix running on proven pushes", () => {
    for (const job of [
      "build",
      "release-browser-matrix",
      "static-pr",
      "safety",
      "ui-playwright-build",
      "visual-baseline",
    ]) {
      expect(ifOf(job)).not.toContain("tree_proven");
    }
    // The matrix tolerates the proof-skipped Production UI and still runs on main...
    expect(ifOf("release-browser-matrix")).toContain("needs.ui-critical.result == 'skipped'");
    expect(ifOf("release-browser-matrix")).toContain("github.ref == 'refs/heads/main'");
    // ...and takes its primary (mockups-only Chromium) path when the PR proved production Chromium,
    // instead of re-running production Chromium unsharded on the fail-safe path.
    const matrixStep = (jobs["release-browser-matrix"].steps as Step[]).find(
      (step) => step.name === "Full browser UI matrix",
    );
    expect(matrixStep?.env?.UI_PROVEN_BY_PR).toBe("${{ needs.changes.outputs.tree_proven_ui }}");
    expect(matrixStep?.run).toContain('[ "$UI_PROVEN_BY_PR" = "true" ]');
  });

  it("keeps the scheduled full run and the push-run concurrency unchanged", () => {
    expect(workflow.on.schedule).toEqual([{ cron: "0 18 * * 0" }]);
    expect(workflow.concurrency["cancel-in-progress"]).toBe("${{ github.event_name != 'push' }}");
  });

  it("binds the proof outputs into PR required so only a proven skip is accepted", () => {
    const aggregate = (jobs["pr-required"].steps as Step[]).find((step) =>
      String(step.run ?? "").includes("Required in-scope PR checks passed."),
    );
    expect(aggregate?.env?.TREE_PROVEN_COVERAGE).toBe("${{ needs.changes.outputs.tree_proven_coverage }}");
    expect(aggregate?.env?.TREE_PROVEN_UI).toBe("${{ needs.changes.outputs.tree_proven_ui }}");
    expect(aggregate?.env?.TREE_PROVEN_LIGHTHOUSE).toBe("${{ needs.changes.outputs.tree_proven_lighthouse }}");
  });
});

describe("PR branch update reuse", () => {
  const sha = "a".repeat(40);
  const prHead = "b".repeat(40);
  const mainTip = "c".repeat(40);
  const oldHead = "d".repeat(40);
  const oldTree = "e".repeat(40);
  const newTree = "f".repeat(40);
  const now = new Date("2026-10-06T03:00:00Z");
  const env = {
    GITHUB_EVENT_NAME: "pull_request",
    PR_ACTION: "synchronize",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_SHA: sha,
    PR_HEAD_SHA: prHead,
    PR_NUMBER: "77",
    PR_HEAD_REF: "feature/x",
    PR_HEAD_REPO: "o/r",
  } as unknown as NodeJS.ProcessEnv;
  const ok = (name: string, id = 0) => ({ name, id, status: "completed", conclusion: "success" });
  const allLegs = [
    ok("Change scope", 900),
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
  const run = {
    id: 5,
    event: "pull_request",
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "success",
    head_sha: oldHead,
    pull_requests: [{ number: 77 }],
    updated_at: "2026-10-06T02:00:00Z",
    html_url: "https://example.test/run/5",
  };
  const setup = ({
    changed = [] as string[],
    jobs = allLegs,
    record = oldTree,
    runs = [run],
    ancestor = true,
  } = {}) => {
    const runGit = (args: string[]) => {
      const key = args.join(" ");
      const table: Record<string, string> = {
        "rev-parse HEAD": sha,
        "rev-parse HEAD^2": prHead,
        "rev-parse HEAD^1": mainTip,
        "rev-parse HEAD^{tree}": newTree,
        [`rev-parse ${oldHead}^{tree}`]: oldTree,
        [`diff --name-only --no-renames ${oldTree} ${newTree}`]: changed.join("\n"),
      };
      if (key in table) return table[key];
      if (args[0] === "rev-list") return "";
      throw new Error(`unexpected git ${key}`);
    };
    const runGitOk = (args: string[]) => (args[0] === "merge-base" ? ancestor : args[0] === "cat-file" ? false : true);
    const request = async (url: string) => {
      if (url.includes("/workflows/ci.yml/runs")) return { workflow_runs: runs };
      if (url.includes("/check-runs/900/annotations")) {
        return [{ title: "CI tested tree", message: `event=pull_request sha=${"9".repeat(40)} tree=${record}` }];
      }
      if (url.includes("/jobs")) return { total_count: jobs.length, jobs };
      throw new Error(`unexpected ${url}`);
    };
    return { env, now, runGit, runGitOk, request };
  };

  it("carries every group when the newly tested tree is identical to a recorded green one", async () => {
    const result = await evaluatePullRequestUpdate(setup());
    expect(result.proof).toEqual({ coverage: true, ui: true, lighthouse: true });
    expect(result.runUrl).toBe("https://example.test/run/5");
  });

  it("carries only browser and Lighthouse when the delta is entirely outside their inputs", async () => {
    const result = await evaluatePullRequestUpdate(
      setup({ changed: ["README.md", "worker/requirements.txt", "eval/docling/pyproject.toml"] }),
    );
    expect(result.proof).toEqual({ coverage: false, ui: true, lighthouse: true });
  });

  it("runs everything when any changed path could be an input", async () => {
    for (const input of [
      "src/app/page.tsx",
      "docs/outstanding-issues.md",
      "docs/governance/privacy-readiness.v1.json",
      "tests/foo.test.ts",
      "worker/index.ts",
      "package-lock.json",
      ".github/workflows/ci.yml",
      "playwright.config.ts",
      "scripts/ci-main-tree-proof.mjs",
    ]) {
      const result = await evaluatePullRequestUpdate(setup({ changed: ["README.md", input] }));
      expect(result.proof, input).toEqual({ coverage: false, ui: false, lighthouse: false });
    }
  });

  it("fails open to the full run on every doubt", async () => {
    const none = { coverage: false, ui: false, lighthouse: false };
    expect((await evaluatePullRequestUpdate({ ...setup(), env: { ...env, PR_ACTION: "opened" } })).proof).toEqual(none);
    expect((await evaluatePullRequestUpdate({ ...setup(), env: { ...env, PR_HEAD_REPO: "fork/r" } })).proof).toEqual(
      none,
    );
    expect((await evaluatePullRequestUpdate(setup({ ancestor: false }))).proof).toEqual(none);
    expect((await evaluatePullRequestUpdate(setup({ record: "1".repeat(40) }))).proof).toEqual(none);
    expect((await evaluatePullRequestUpdate(setup({ runs: [{ ...run, conclusion: "cancelled" }] }))).proof).toEqual(
      none,
    );
    expect(
      (await evaluatePullRequestUpdate(setup({ runs: [{ ...run, updated_at: "2026-10-05T01:00:00Z" }] }))).proof,
    ).toEqual(none);
    expect(
      (await evaluatePullRequestUpdate(setup({ runs: [{ ...run, pull_requests: [{ number: 78 }] }] }))).proof,
    ).toEqual(none);
    expect((await evaluatePullRequestUpdate(setup({ jobs: allLegs.slice(1) }))).proof).toEqual(none);
    const wrongCheckout = setup();
    const runGit = (args: string[]) =>
      args.join(" ") === "rev-parse HEAD^2" ? "2".repeat(40) : wrongCheckout.runGit(args);
    expect((await evaluatePullRequestUpdate({ ...wrongCheckout, runGit })).proof).toEqual(none);
  });

  it("never treats a carried (skipped) leg as proof for the next update", async () => {
    const carried = allLegs.map((job) => (/^Production UI/.test(job.name) ? { ...job, conclusion: "skipped" } : job));
    const result = await evaluatePullRequestUpdate(setup({ jobs: carried }));
    expect(result.proof.ui).toBe(false);
    expect(result.proof.coverage).toBe(true);
  });

  it("keeps only same-PR, fresh, green ci.yml runs as candidates, newest first, at most three", () => {
    const runs = [1, 2, 3, 4].map((index) => ({ ...run, id: index, updated_at: `2026-10-06T0${index - 1}:30:00Z` }));
    expect(selectPullRequestCandidates(runs, { prNumber: 77, now }).map((candidate) => candidate.id)).toEqual([
      3, 2, 1,
    ]);
  });
});

describe("tested-tree reconstruction against a real repository", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tree-proof-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const git = (args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const gitOk = (args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }).status === 0;
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.test"]);
  git(["config", "user.name", "t"]);
  const commit = (file: string, text: string) => {
    writeFileSync(path.join(dir, file), text);
    git(["add", file]);
    git(["commit", "-q", "-m", file]);
    return git(["rev-parse", "HEAD"]);
  };
  commit("a.txt", "a");
  const branchBase = git(["rev-parse", "HEAD"]);
  git(["checkout", "-q", "-b", "feature"]);
  const oldHead = commit("feature.txt", "f");
  git(["checkout", "-q", "main"]);
  const mainLater = commit("main.txt", "m");
  // What GitHub's refs/pull/N/merge would have tested: the feature head merged onto main.
  const testedTree = git(["merge-tree", "--write-tree", mainLater, oldHead]).split("\n")[0];

  it("rebuilds a recorded merge-ref tree by its exact hash", () => {
    git(["gc", "-q", "--prune=now"]);
    expect(
      reconstructTestedTree({ recordedTree: testedTree, oldHead, mainTip: mainLater, runGit: git, runGitOk: gitOk }),
    ).toBe(testedTree);
  });

  it("returns null when no local tree has the recorded hash", () => {
    expect(
      reconstructTestedTree({
        recordedTree: "1".repeat(40),
        oldHead,
        mainTip: branchBase,
        runGit: git,
        runGitOk: gitOk,
      }),
    ).toBeNull();
  });
});

/**
 * Risk 2 (complete transitive input coverage): the unrelated-input allowlist is only sound if no
 * code that the build, browser or Lighthouse jobs execute can read those paths. Data files cannot
 * read anything, so every CODE input is scanned with comments stripped: src, public, the Playwright
 * specs/helpers/fixtures/setup, configs, package.json scripts, the setup actions, and the transitive
 * relative-import closure of every script those jobs and the build lifecycle run.
 */
describe("unrelated-input allowlist", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const rel = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const at = (file: string) => path.join(root, file);
  const walk = (directory: string, out: string[] = []) => {
    if (!existsSync(at(directory))) return out;
    for (const entry of readdirSync(at(directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(file, out);
      else out.push(file);
    }
    return out;
  };

  it("only lists non-code paths and rejects everything else", () => {
    for (const unrelated of [
      "README.md",
      "AGENTS.md",

      ".github/pull_request_template.md",
      "worker/requirements.txt",
      "worker/py/extract.py",
      "eval/docling/pyproject.toml",
      "eval/notes.md",
    ]) {
      expect(isUnrelatedInput(unrelated), unrelated).toBe(true);
    }
    for (const input of [
      "docs/outstanding-issues.md",
      "docs/a.md",
      "docs/governance/privacy-readiness.v1.json",
      "worker/index.ts",
      "eval/run.mjs",
      "tests/a.test.ts",
      "tests/ui-smoke.spec.ts",
      "src/x.md",
      "package.json",
      "package-lock.json",
      ".nvmrc",
      ".github/workflows/ci.yml",
      ".github/actions/setup-ui-e2e/action.yml",
      "public/sw.js",
      "data/x.json",
      "lighthouse-budget.json",
      "scripts/x.mjs",
    ]) {
      expect(isUnrelatedInput(input), input).toBe(false);
    }
    expect(UNRELATED_INPUT_RULES.length).toBe(4);
    expect(isUnrelatedInput(".github/ISSUE_TEMPLATE/bug.yml")).toBe(false);
  });

  it("is never read by any code the build, Playwright or Lighthouse jobs run", () => {
    const pkg = JSON.parse(readFileSync(at("package.json"), "utf8")) as { scripts: Record<string, string> };
    const scriptRef = /(?:node|tsx)\s+((?:scripts|tests)\/[\w./-]+\.(?:mjs|js|ts|cjs|mts))/g;
    const entries = new Set(["playwright.config.ts", "next.config.ts", "postcss.config.mjs"]);
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (!/^(build|prebuild|postbuild|start|test:e2e|verify:lighthouse)/.test(name)) continue;
      for (const match of command.matchAll(scriptRef)) entries.add(match[1]);
    }
    for (const job of ["ui-playwright-build", "ui-critical-fast", "ui-critical", "lighthouse-budget"]) {
      for (const step of jobs[job].steps as Step[]) {
        for (const match of String(step.run ?? "").matchAll(/npm run ([\w:.-]+)/g)) {
          for (const inner of String(pkg.scripts[match[1]] ?? "").matchAll(scriptRef)) entries.add(inner[1]);
        }
        for (const match of String(step.run ?? "").matchAll(scriptRef)) entries.add(match[1]);
      }
    }
    for (const match of readFileSync(at("playwright.config.ts"), "utf8").matchAll(scriptRef)) entries.add(match[1]);
    expect(entries.size).toBeGreaterThan(6);

    const closure = new Set<string>();
    const queue = [...entries];
    const suffixes = ["", ".mjs", ".js", ".ts", ".mts", ".cjs", ".tsx", "/index.ts", "/index.mjs", "/index.js"];
    while (queue.length) {
      const file = queue.shift() as string;
      if (closure.has(file) || !existsSync(at(file))) continue;
      closure.add(file);
      const text = readFileSync(at(file), "utf8");
      for (const match of text.matchAll(
        /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g,
      )) {
        const base = rel(path.resolve(path.dirname(at(file)), match[1]));
        const found = suffixes
          .map((suffix) => base + suffix)
          .find((candidate) => existsSync(at(candidate)) && statSync(at(candidate)).isFile());
        if (found && !found.startsWith("src/")) queue.push(found);
      }
      for (const match of text.matchAll(scriptRef)) queue.push(match[1]);
    }
    expect(closure.has("scripts/run-playwright.mjs") || closure.has("scripts/playwright-pr-shards.mjs")).toBe(true);
    expect(closure.has("scripts/run-lighthouse-budget.mjs")).toBe(true);
    expect(closure.has("scripts/generate-outstanding-issues-snapshot.mjs")).toBe(true);

    const codeInputs = new Set<string>([
      ...closure,
      "package.json",
      ...walk("src"),
      ...walk("public"),
      ...walk("tests/helpers"),
      ...walk("tests/fixtures"),
      ...walk("tests/e2e"),
      ...walk("tests/setup"),
      ...readdirSync(at("tests"))
        .filter((file) => file.endsWith(".spec.ts"))
        .map((file) => `tests/${file}`),
      ...walk(".github/actions/setup-ui-e2e"),
      ...walk(".github/actions/setup-node-cached"),
      ...walk(".github/actions/setup-lighthouse-chromium"),
    ]);
    const rootMarkdown = readdirSync(root).filter((file) => file.endsWith(".md"));
    expect(rootMarkdown).toContain("README.md");
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const references: Array<[string, RegExp]> = [
      [
        "worker non-code",
        /(?<![\w.-])worker\/(?:[\w.*-]+\/)*[\w.*-]*\.(?:py|txt|toml|cfg|ini|lock)\b|(?<![\w.-])worker\/["'`*]/,
      ],
      [
        "eval non-code",
        /(?<![\w.-])eval\/(?:[\w.*-]+\/)*[\w.*-]*\.(?:py|txt|toml|cfg|ini|lock|md)\b|(?<![\w.-])eval\/["'`*]/,
      ],
      ["pull_request_template", /pull_request_template/],
      ...rootMarkdown.map((file): [string, RegExp] => [file, new RegExp(`(?<![\\w/.-])${escape(file)}`)]),
    ];
    const stripComments = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of codeInputs) {
      if (!/\.(?:[cm]?[jt]sx?|css|ya?ml)$/.test(file) && file !== "package.json") continue;
      if (!existsSync(at(file))) continue;
      scanned += 1;
      const text = stripComments(readFileSync(at(file), "utf8"));
      for (const [label, pattern] of references) if (pattern.test(text)) offenders.push(`${file} -> ${label}`);
    }
    expect(scanned).toBeGreaterThan(500);
    expect(offenders).toEqual([]);
  });
});
