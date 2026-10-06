import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { classifyProof, evaluate, PROOF_GROUPS } from "../scripts/ci-main-tree-proof.mjs";

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
      "Unit coverage partition (1)",
      "Unit coverage partition (2)",
      "Unit coverage",
      "Playwright Next build",
      "Production UI critical",
      "Production UI (1)",
      "Production UI (2)",
      "Production UI (3)",
      "Lighthouse budget",
    ].map(ok);
    const request = async (path: string) => {
      if (path.includes("/commits/")) {
        return [
          {
            number: 42,
            merged_at: "2026-10-06T01:59:00Z",
            merge_commit_sha: sha,
            base: { ref: "main" },
            head: { sha: head },
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
    expect(proofStep?.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
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

  it("gates exactly the tree-determined jobs on their own group", () => {
    expect(ifOf("coverage-shards")).toContain("needs.changes.outputs.tree_proven_coverage != 'true'");
    expect(ifOf("coverage")).toContain("needs.changes.outputs.tree_proven_coverage != 'true'");
    expect(ifOf("ui-critical")).toContain("needs.changes.outputs.tree_proven_ui != 'true'");
    expect(ifOf("lighthouse-budget")).toContain("needs.changes.outputs.tree_proven_lighthouse != 'true'");

    const gated = Object.keys(jobs).filter((job) => /tree_proven_/.test(ifOf(job)));
    expect(gated.sort()).toEqual(["coverage", "coverage-shards", "lighthouse-budget", "ui-critical"]);
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
