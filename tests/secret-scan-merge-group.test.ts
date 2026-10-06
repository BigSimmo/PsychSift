import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { assertMergeGroupBaseAvailable, resolveGitleaksScanRange } from "../scripts/run-gitleaks-pinned.mjs";

/**
 * Merge-queue candidates get a real secret scan. The queue builds a commit (main tip + the queued
 * PRs) that no pull_request scan saw, so `Gitleaks` on merge_group scans the full immutable
 * merge_group.base_sha..head_sha range and fails closed when that base is unusable.
 */
type Step = { name?: string; if?: string; with?: Record<string, string>; env?: Record<string, string> };
const workflow = createRequire(import.meta.url)("js-yaml").load(
  readFileSync(new URL("../.github/workflows/secret-scan.yml", import.meta.url), "utf8"),
) as { on: Record<string, unknown>; jobs: { gitleaks: { name: string; steps: Step[] } } };
const steps = workflow.jobs.gitleaks.steps;

describe("Secret Scan on merge_group", () => {
  it("runs every Gitleaks step for merge_group under the same check name", () => {
    expect(Object.keys(workflow.on)).toContain("merge_group");
    expect(workflow.jobs.gitleaks.name).toBe("Gitleaks");
    for (const step of steps) expect(String(step.if ?? ""), String(step.name)).not.toContain("merge_group");
  });

  it("pins checkout and scan range to the immutable merge_group payload", () => {
    const checkout = steps.find((step) => step.name === "Checkout pinned head");
    expect(checkout?.with?.ref).toBe(
      "${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha }}",
    );
    expect(String(checkout?.with?.["fetch-depth"])).toBe("0");
    const scan = steps.find((step) => step.name === "Scan for secrets (pinned event SHAs)");
    expect(scan?.env?.GITLEAKS_PINNED_BASE).toBe(
      "${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before }}",
    );
    expect(scan?.env?.GITLEAKS_PINNED_HEAD).toBe(
      "${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha }}",
    );
  });

  it("scans base..head for merge_group and refuses a missing or zero base", () => {
    const head = "a".repeat(40);
    const base = "b".repeat(40);
    expect(
      resolveGitleaksScanRange({ eventName: "merge_group", pinnedBase: base, pinnedHead: head, checkedOutHead: head }),
    ).toEqual({
      mode: "range",
      base,
      head,
      logOpts: `${base}..${head}`,
    });
    for (const pinnedBase of ["", "0".repeat(40), "main"]) {
      expect(() =>
        resolveGitleaksScanRange({ eventName: "merge_group", pinnedBase, pinnedHead: head, checkedOutHead: head }),
      ).toThrow(/merge_group needs merge_group\.base_sha/);
    }
    // Other events keep their existing behaviour (tip scan without a usable base).
    expect(
      resolveGitleaksScanRange({
        eventName: "push",
        pinnedBase: "0".repeat(40),
        pinnedHead: head,
        checkedOutHead: head,
      }).mode,
    ).toBe("tip");
  });

  describe("against a real repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitleaks-mg-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
    const git = (...args: string[]) => {
      const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    const gitOk = (args: string[]) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }).status === 0;
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.test");
    git("config", "user.name", "t");
    const commit = (file: string) => {
      writeFileSync(join(dir, file), file);
      git("add", file);
      git("commit", "-q", "-m", file);
      return git("rev-parse", "HEAD");
    };
    const base = commit("base.txt");
    const head = commit("queued.txt");
    git("checkout", "-q", "-b", "side", base);
    const unrelated = commit("side.txt");

    it("accepts a base that is present and an ancestor of the head", () => {
      expect(() => assertMergeGroupBaseAvailable({ base, head, gitOk })).not.toThrow();
    });

    it("fails closed when the base is absent from the checkout", () => {
      expect(() => assertMergeGroupBaseAvailable({ base: "c".repeat(40), head, gitOk })).toThrow(/not in the checkout/);
    });

    it("fails closed when the base is not an ancestor of the head", () => {
      expect(() => assertMergeGroupBaseAvailable({ base: unrelated, head, gitOk })).toThrow(/not an ancestor/);
    });
  });
});

// Folded in from the 2026-10-06 CI-efficiency handover: enabling merge_group scans must not touch
// either workflow's concurrency. PR supersession stays within one workflow and PR ref; every
// main/release push keeps its own per-run group and is never cancelled.
describe("Secret Scan and CI concurrency boundaries", () => {
  type Concurrency = { name: string; concurrency: { group: string; "cancel-in-progress": string } };
  const load = (file: string) =>
    createRequire(import.meta.url)("js-yaml").load(
      readFileSync(new URL(`../.github/workflows/${file}.yml`, import.meta.url), "utf8"),
    ) as Concurrency;
  const render = (workflow: Concurrency, event: string, ref: string, id: number) => {
    const github = { workflow: workflow.name, event_name: event, ref, run_id: id };
    const evaluate = (expression: string) => Function("github", `return (${expression});`)(github);
    return {
      group: workflow.concurrency.group.replace(/\$\{\{([\s\S]*?)\}\}/g, (_: string, expression: string) =>
        String(evaluate(expression)),
      ),
      cancel: evaluate(workflow.concurrency["cancel-in-progress"].replace(/^\$\{\{|\}\}$/g, "")),
    };
  };
  const ci = load("ci");
  const secret = load("secret-scan");

  it("supersedes only the same PR, and never cancels or shares a main/release push group", () => {
    for (const workflow of [ci, secret]) {
      const first = render(workflow, "pull_request", "refs/pull/10/merge", 1);
      expect(first.cancel).toBe(true);
      expect(first.group).toBe(render(workflow, "pull_request", "refs/pull/10/merge", 2).group);
      expect(first.group).not.toBe(render(workflow, "pull_request", "refs/pull/11/merge", 2).group);
      for (const ref of ["refs/heads/main", "refs/heads/release/v1"]) {
        expect(render(workflow, "push", ref, 1).cancel).toBe(false);
        expect(render(workflow, "push", ref, 1).group).not.toBe(render(workflow, "push", ref, 2).group);
        expect(render(workflow, "push", ref, 1).group).not.toBe(first.group);
      }
    }
    expect(render(ci, "pull_request", "refs/pull/10/merge", 1).group).not.toBe(
      render(secret, "pull_request", "refs/pull/10/merge", 1).group,
    );
  });
});
