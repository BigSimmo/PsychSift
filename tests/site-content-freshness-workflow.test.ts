import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const fixturePath = resolve("tests/fixtures/site-content/release-evidence-current.json");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runFreshness(args: string[]) {
  return spawnSync(
    process.execPath,
    ["scripts/run-tsx.mjs", "scripts/check-site-content-freshness.ts", ...args],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

describe("site-content freshness workflow", () => {
  it("accepts the provider-free current release evidence through the offline default", () => {
    const result = runFreshness(["--evidence", fixturePath]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "current", staticManifestMatch: true });
  });

  it("fails promotion for a static deployment/release mismatch", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "site-content-freshness-"));
    temporaryDirectories.push(temporaryDirectory);
    const evidence = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
    evidence.deploymentSha = "9".repeat(40);
    const path = join(temporaryDirectory, "mismatch.json");
    writeFileSync(path, `${JSON.stringify(evidence)}\n`, "utf8");

    const result = runFreshness(["--evidence", path]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deployment_sha_mismatch");
  });

  it("keeps live reads explicitly unavailable in the offline checker", () => {
    const result = runFreshness(["--live"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("approval-gated");
  });

  it("routes only selected site-content changes through manifest and domain-fixture validation", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const step = workflow.match(
      /- name: Site-content manifest and domain fixture validation[\s\S]*?(?=\n\s{6}- name:|\n\s{2}[a-z-]+:)/,
    )?.[0];

    expect(step).toBeDefined();
    expect(step).toContain("needs.changes.outputs.site_content_changed == 'true'");
    expect(step).toContain("scripts/build-site-content-manifest.ts --check");
    expect(step).toContain("tests/site-content-manifest.test.ts");
    expect(step).not.toMatch(/sync-site-content-corpus|--write|supabase|provider/i);
  });

  it("keeps the manifest/domain fixture command provider-free and runnable", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/run-tsx.mjs", "scripts/build-site-content-manifest.ts", "--check"],
      { encoding: "utf8" },
    );

    expect(output).toMatch(/site-content manifest check passed:/);
  });
});
