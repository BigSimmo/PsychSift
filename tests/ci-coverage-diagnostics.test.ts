import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

type Step = {
  name: string;
  id?: string;
  if?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
};
const workflow = createRequire(import.meta.url)("js-yaml").load(
  readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
);
const steps: Step[] = workflow.jobs["coverage-shards"].steps;
const step = (name: string) => {
  const found = steps.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing coverage step: ${name}`);
  return found;
};

function executeTimingStep(name: string, cwd: string, outcome?: string) {
  const source = /^node -e '([\s\S]+)'$/.exec(step(name).run!.trim())?.[1];
  if (!source) throw new Error(`unrecognized timing command: ${name}`);
  const result = spawnSync(process.execPath, ["-e", source], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, TEST_OUTCOME: outcome ?? "" },
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(readFileSync(path.join(cwd, ".vitest-diagnostics/timing.json"), "utf8"));
}

describe("coverage partition diagnostics", () => {
  it("keeps attempt-specific always-uploaded diagnostics separate from successful strict merge blobs", () => {
    const test = step("Unit tests with partial coverage");
    expect(test.run).toContain("--reporter=json");
    expect(test.run).toContain("--outputFile.json=.vitest-diagnostics/coverage-${{ matrix.shard }}.json");
    expect(test.run).toContain("--outputFile.blob=.vitest-ci/coverage-${{ matrix.shard }}.json");
    expect(test["id"]).toBe("coverage-tests");
    const diagnostic = step("Preserve coverage failure diagnostics and timings");
    expect(diagnostic.if).toBe("always()");
    expect(diagnostic.with?.name).toContain("${{ github.run_attempt }}");
    expect(diagnostic.with?.path).toBe(".vitest-diagnostics/*.json");
    const blob = step("Preserve test and coverage results");
    expect(blob.if).toBeUndefined();
    expect(blob.with?.name).toBe("unit-coverage-${{ github.run_id }}-${{ matrix.shard }}");
    expect(blob.with?.["if-no-files-found"]).toBe("error");
    expect(blob.with?.path).toBe(".vitest-ci/coverage-${{ matrix.shard }}.json");
    const download = workflow.jobs.coverage.steps.find(
      (entry: Step) => entry.name === "Download both coverage partitions from this run",
    );
    expect(download.with.pattern).toBe("unit-coverage-${{ github.run_id }}-*");
  });

  it.each(["failure", "cancelled"])("records usable %s timing even when Vitest emits no report", (outcome) => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ci-coverage-diagnostics-"));
    try {
      const start = executeTimingStep("Start coverage diagnostic timing", cwd);
      const end = executeTimingStep("Record coverage diagnostic outcome", cwd, outcome);
      expect(end.startedAt).toBe(start.startedAt);
      expect(end.endedAt).toBeGreaterThanOrEqual(start.startedAt);
      expect(end.durationMs).toBe(end.endedAt - start.startedAt);
      expect(end.outcome).toBe(outcome);
      expect(step("Record coverage diagnostic outcome").if).toBe("always()");
      expect(step("Record coverage diagnostic outcome").env?.TEST_OUTCOME).toBe("${{ steps.coverage-tests.outcome }}");
    } finally {
      rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("records unavailable timing explicitly if setup failed before tests started", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ci-coverage-diagnostics-"));
    try {
      const end = executeTimingStep("Record coverage diagnostic outcome", cwd);
      expect(end.durationMs).toBeNull();
      expect(end.outcome).toBe("not-started");
    } finally {
      rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("quarantine CI preflight", () => {
  it("runs collected registration validation after dependencies and before browser exclusions", () => {
    const staticSteps: Step[] = workflow.jobs["static-pr"].steps;
    const index = staticSteps.findIndex((entry) => entry.run === "node scripts/flake-ledger.mjs --validate-collected");
    expect(index).toBeGreaterThan(staticSteps.findIndex((entry) => entry.name === "Setup Node and dependencies"));
    expect(staticSteps[index].if).toBeUndefined();
    for (const job of ["ui-critical-fast", "ui-critical", "release-browser-matrix"]) {
      expect(workflow.jobs[job].needs).toContain("static-pr");
    }
  });
});
