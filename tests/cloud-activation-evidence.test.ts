import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "..", "scripts", "cloud-activation-evidence.mjs");
const temporary: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "activation-evidence-"));
  temporary.push(root);
  mkdirSync(join(root, "scripts"));
  cpSync(script, join(root, "scripts", "cloud-activation-evidence.mjs"));
  writeFileSync(join(root, "AGENTS.md"), "Synthetic safeguards\n");
  mkdirSync(join(root, ".claude", "cloud-profile"), { recursive: true });
  writeFileSync(join(root, ".claude", "cloud-profile", "CLAUDE.md"), "Synthetic profile\n");
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"],
  ]) {
    expect(spawnSync("git", args, { cwd: root, encoding: "utf8" }).status).toBe(0);
  }
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  return { root, revision };
}
function run(root: string, args: string[] = []) {
  return spawnSync(process.execPath, [join(root, "scripts", "cloud-activation-evidence.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, ACTIVATION_SECRET: "synthetic-secret-must-not-print" },
  });
}
afterEach(() => {
  for (const root of temporary.splice(0))
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("read-only Cloud activation evidence", () => {
  it("pins exact source bytes and revision while leaving installation and session unverified", () => {
    const { root, revision } = fixture();
    const result = run(root, ["--expected-revision", revision]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.source).toMatchObject({ checkout: root, revision, dirty: false, revisionMatches: true });
    expect(report.source.files.find((file: { path: string }) => file.path === "AGENTS.md")).toMatchObject({
      sha256: createHash("sha256").update("Synthetic safeguards\n").digest("hex"),
    });
    expect(report.installed.status).toBe("unverified");
    expect(report.activeSession.status).toBe("unverified");
    expect(result.stdout).not.toContain("synthetic-secret-must-not-print");
  });
  it("fails an exact revision mismatch and reports dirty source without claiming committed bytes", () => {
    const { root } = fixture();
    writeFileSync(join(root, "AGENTS.md"), "Changed safeguards\n");
    const result = run(root, ["--expected-revision", "0".repeat(40)]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).source).toMatchObject({ dirty: true, revisionMatches: false });
  });
  it("compares owned Claude artifacts to both manifest and current source without opening settings or credentials", () => {
    const { root } = fixture();
    const config = join(root, "installed");
    mkdirSync(config);
    const bytes = readFileSync(join(root, ".claude", "cloud-profile", "CLAUDE.md"));
    writeFileSync(join(config, "CLAUDE.md"), bytes);
    writeFileSync(join(config, "settings.json"), "synthetic-private-config-must-not-print");
    writeFileSync(
      join(config, ".cloud-profile-install.json"),
      JSON.stringify({
        version: 1,
        source: root,
        files: { "CLAUDE.md": createHash("sha256").update(bytes).digest("hex") },
        settings: [],
      }),
    );
    const good = run(root, ["--claude-config-dir", config]);
    expect(good.status, good.stderr).toBe(0);
    const report = JSON.parse(good.stdout);
    expect(report.installed.claude).toMatchObject({ ownerMatches: true });
    expect(report.installed.claude.files[0]).toMatchObject({
      path: "CLAUDE.md",
      manifestMatches: true,
      sourceMatches: true,
    });
    expect(report.activeSession.status).toBe("unverified");
    expect(good.stdout).not.toContain("synthetic-private-config-must-not-print");
    writeFileSync(join(config, "CLAUDE.md"), "modified host guidance");
    const changed = run(root, ["--claude-config-dir", config]);
    expect(changed.status).toBe(1);
    expect(JSON.parse(changed.stdout).installed.claude.files[0]).toMatchObject({
      manifestMatches: false,
      sourceMatches: false,
    });
  });
  it("rejects another checkout's ownership, path traversal and symlinked artifacts", () => {
    const { root } = fixture();
    const config = join(root, "installed");
    mkdirSync(config);
    const manifest = join(config, ".cloud-profile-install.json");
    for (const value of [
      { version: 1, source: "/another-checkout", files: {}, settings: [] },
      { version: 1, source: root, files: { "../outside": "a".repeat(64) }, settings: [] },
    ]) {
      writeFileSync(manifest, JSON.stringify(value));
      expect(run(root, ["--claude-config-dir", config]).status).toBe(1);
    }
    symlinkSync(join(root, "AGENTS.md"), join(config, "CLAUDE.md"));
    writeFileSync(
      manifest,
      JSON.stringify({ version: 1, source: root, files: { "CLAUDE.md": "a".repeat(64) }, settings: [] }),
    );
    const result = run(root, ["--claude-config-dir", config]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).installed.claude.files[0].state).toBe("symlink");
  });
  it("rejects symlinked source and installed parent directories without following them", () => {
    const { root } = fixture();
    const privateFile = join(root, "private-file");
    writeFileSync(privateFile, "synthetic-private-bytes-must-not-print");
    rmSync(join(root, "AGENTS.md"));
    symlinkSync(privateFile, join(root, "AGENTS.md"));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(
      JSON.parse(result.stdout).source.files.find((file: { path: string }) => file.path === "AGENTS.md").state,
    ).toBe("symlink");
    expect(result.stdout).not.toContain("synthetic-private-bytes-must-not-print");
    const installed = join(root, "installed");
    symlinkSync(join(root, ".claude", "cloud-profile"), installed);
    expect(run(root, ["--claude-config-dir", installed]).status).toBe(1);
  });

  it("labels legacy markerless files as unknown ownership and never treats markers as source proof", () => {
    const { root } = fixture();
    const home = join(root, "installed");
    mkdirSync(home);
    const profile = join(home, ".clinical-kb-codex-cloud.sh");
    writeFileSync(
      profile,
      "# Generated by scripts/setup-codex-cloud.sh. Re-running setup replaces this file.\nexit 99\n",
    );
    const result = run(root, ["--installed-home", home]);
    expect(result.status, result.stderr).toBe(0);
    const artifact = JSON.parse(result.stdout).installed.codex.files.find(
      (file: { path: string }) => file.path === "runtime-profile",
    );
    expect(artifact).toMatchObject({
      generatedMarker: true,
      owner: "unknown",
      contentVerification: "unverified",
    });
    expect(readFileSync(profile, "utf8")).toContain("exit 99");
  });
});
