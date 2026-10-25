import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("skill:create scaffolding", () => {
  it("writes the interface openai.yaml shape used by existing skills", () => {
    const source = readFileSync(path.join(repositoryRoot, "scripts/skill-create.mjs"), "utf8");
    expect(source).toContain("interface:");
    expect(source).toContain("display_name:");
    expect(source).toContain("short_description:");
    expect(source).toContain("default_prompt:");
    expect(source).toContain("Usage: npm run skill:create -- <skill-name>");
    expect(source).toContain("Use $${skillName}");
    expect(source).not.toContain('short_description: "Short description');
    expect(source).not.toMatch(/openaiYamlContent = `name: \$\{skillName\}/);
  });
});

describe("branch:cleanup dry-run default", () => {
  it("defaults to dry-run and deletes with argv-safe git calls", () => {
    const source = readFileSync(path.join(repositoryRoot, "scripts/sweep-merged-branches.mjs"), "utf8");
    expect(source).toContain("Dry-run by default");
    expect(source).toContain("--apply");
    expect(source).toContain('runGit(["branch", "-d", branch])');
    expect(source).not.toContain("`git branch -d ${branch}`");
    expect(source).not.toContain("execSync");
  });
});

describe("run-heavy lock holders stay async", () => {
  it("uses spawn instead of spawnSync so lock heartbeats can fire", () => {
    const source = readFileSync(path.join(repositoryRoot, "scripts/run-heavy.mjs"), "utf8");
    expect(source).toContain('import { spawn } from "node:child_process"');
    expect(source).not.toContain("spawnSync");
    expect(source).toContain("forceLockRelease");
    expect(source).toContain("typescriptBuildInfoPath");
    expect(source).toContain('"typecheck:source:internal"');
    expect(source).toContain('"--tsBuildInfoFile"');
    expect(source).toContain("await runNpmScript()");
    expect(source).toContain('sharedTypecheckScripts.has(script) ? "shared"');
    // Pre-push invokes via plain node (no npm_execpath); both spawn paths must
    // forward effectiveForwarded so --tsBuildInfoFile is not dropped.
    expect(source).toContain("const npmArgs = effectiveForwarded.length");
    expect(source).not.toMatch(/\["run", script, \.\.\.\(forwarded\.length/);
  });

  it("routes guard-push static checks through the run coordinator", () => {
    const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
    const source = readFileSync(path.join(repositoryRoot, "scripts/guard-push.mjs"), "utf8");

    expect(packageJson.scripts["lint:changed:internal"]).toContain("eslint");
    expect(source).toContain('"lint:changed:internal"');
    expect(source).toContain('"typecheck:source:internal"');
    expect(source).toContain("run-heavy.mjs");
    expect(source).toContain('runStaticCheck(PROJECT_ROOT, "typecheck:source:internal", [], "typecheck")');
  });

  it("keeps Vitest async so shared-lease heartbeats can fire", () => {
    const source = readFileSync(path.join(repositoryRoot, "scripts/run-vitest.mjs"), "utf8");
    expect(source).toContain('import { spawn } from "node:child_process"');
    expect(source).not.toContain("spawnSync");
    expect(source).toContain("await runVitest()");
  });

  it("keeps the Playwright build and test children async so lease heartbeats can fire", () => {
    const source = readFileSync(path.join(repositoryRoot, "scripts/run-playwright.mjs"), "utf8");
    // Only the short Windows taskkill in cleanup may stay synchronous.
    expect(source).not.toContain("spawnSync(process.execPath");
    expect(source.match(/spawnSync\(/g) ?? []).toHaveLength(1);
    expect(source).toContain('spawnSync("taskkill"');
    expect(source).toContain('await runChild(["--max-old-space-size=8192", nextBin, "build", "--webpack"]');
    expect(source).toContain('await runChild([playwrightBin, "test", ...playwrightArgs]');
  });
});

describe("eval-retrieval parallelization", () => {
  it("keeps a single results binding after parallel map", () => {
    const source = readFileSync(path.join(repositoryRoot, "scripts/eval-retrieval.ts"), "utf8");
    const resultsBindings = source.match(/const results\b/g) ?? [];
    expect(resultsBindings).toHaveLength(1);
    expect(source).toContain("const results: GoldenRetrievalResult[] = await Promise.all(");
    expect(source).toContain('args.mode === "latency" ? 1 : 5');
  });
});
