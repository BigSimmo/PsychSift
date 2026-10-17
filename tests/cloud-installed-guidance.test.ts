import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
let fixtureRoot: string;
let installedRoot: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "cloud-guidance-"));
  const sourceRoot = join(fixtureRoot, "source");
  const profileRoot = join(sourceRoot, ".claude", "cloud-profile");
  installedRoot = join(fixtureRoot, "installed");
  mkdirSync(join(sourceRoot, "scripts"), { recursive: true });
  mkdirSync(join(profileRoot, "skills"), { recursive: true });
  cpSync(
    join(repoRoot, "scripts", "apply-claude-cloud-profile.mjs"),
    join(sourceRoot, "scripts", "apply-claude-cloud-profile.mjs"),
  );
  cpSync(join(repoRoot, ".claude", "cloud-profile", "CLAUDE.md"), join(profileRoot, "CLAUDE.md"));
  for (const name of ["choose-model", "prompt", "code-review"]) {
    cpSync(join(repoRoot, ".claude", "cloud-profile", "skills", name), join(profileRoot, "skills", name), {
      recursive: true,
    });
  }
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", CLAUDE_CONFIG_DIR: installedRoot };
  for (const name of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  const result = spawnSync(
    process.execPath,
    [join(sourceRoot, "scripts", "apply-claude-cloud-profile.mjs"), "--force", "--skip=settings,memory"],
    { env, encoding: "utf8", timeout: 10_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});

afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("guidance actually installed into a Cloud profile", () => {
  it("preserves current project authority and treats copied skills as capability claims to verify", () => {
    const text = readFileSync(join(installedRoot, "CLAUDE.md"), "utf8");
    expect(text).toContain("current system, developer and user");
    expect(text).toContain("applicable project safeguards");
    expect(text).toContain("copied descriptions do not establish model, command, plugin or connector");
    expect(text).toContain("old workstation state or startup ceremony");
  });

  it("does not install fictional model lineups or require unavailable routing controls", () => {
    const text = readFileSync(join(installedRoot, "skills", "choose-model", "SKILL.md"), "utf8");
    expect(text).not.toMatch(/Opus 4\.8|Sonnet 5|Fable/);
    expect(text).toContain("current host's exposed model inventory and tool schema");
    expect(text).toContain("Use only the effort controls exposed by the relevant interface");
    expect(text).toContain("no special marker or resubmission");
  });

  it("ships the same continuation and provider boundaries in native and Cloud prompt references", () => {
    const relative = join("prompt", "references", "coding-workflow.md");
    const installed = readFileSync(join(installedRoot, "skills", relative), "utf8");
    expect(installed).toBe(readFileSync(join(repoRoot, ".claude", "skills", relative), "utf8"));
    expect(installed).toContain("Continue verified same-task work");
    expect(installed).toContain(
      "Remote freshness checks such as `git fetch` require applicable provider/network authority",
    );
    expect(installed).toContain("Commit or push only with applicable task authority");
    expect(installed).not.toContain("Create a fresh branch and worktree");
  });

  it("includes uncommitted and untracked work when the installed review skill selects its evidence", () => {
    const text = readFileSync(join(installedRoot, "skills", "code-review", "SKILL.md"), "utf8");
    expect(text).toContain("Check `git status --short` and task ownership");
    expect(text).toContain("include owned staged changes, unstaged changes and untracked files");
    expect(text).toContain("read untracked file contents explicitly because `git diff` omits them");
    expect(text).toContain("record the reviewed HEAD and verified base commit");
    expect(text).toContain("A request for review does not by itself authorise paid review or external comments");
    expect(text).not.toContain("prefer `git diff main...HEAD`");
  });
});
