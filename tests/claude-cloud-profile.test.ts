import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Claude Code on the web starts from a bare container, so `.claude/cloud-profile/` carries the
 * operator's user-level configuration in-tree and `scripts/apply-claude-cloud-profile.mjs` unpacks it
 * into `~/.claude` at SessionStart. `scripts/setup-claude-cloud.sh` provisions the rest of the
 * toolchain around it. Contract in `docs/claude-cloud.md`.
 *
 * These tests pin the four properties that are destructive or silent when they regress:
 *   1. Neither script will touch a non-cloud machine. The operator's real ~/.claude is the ORIGIN of
 *      the checked-in snapshot, so a provisioner that ran locally would overwrite the source of truth
 *      with a stale copy of itself.
 *   2. Settings are deep-merged, never replaced — platform-written keys must survive.
 *   3. Memories are skip-if-present — a memory written inside the container is newer than the
 *      snapshot, and clobbering it deletes work with no error.
 *   4. A skill entry replaces whatever is in its way. On the workstation these names are symlinks, and
 *      a plain recursive copy throws ERR_FS_CP_DIR_TO_NON_DIR and aborts the whole tier.
 *
 * The applier is driven through CLAUDE_CONFIG_DIR rather than HOME: Node resolves `os.homedir()` from
 * USERPROFILE on Windows, so a HOME override does NOT sandbox it there and the test would write into
 * the developer's real profile.
 */

const repoRoot = join(import.meta.dirname, "..");
const applier = join(repoRoot, "scripts", "apply-claude-cloud-profile.mjs");
const provisioner = join(repoRoot, "scripts", "setup-claude-cloud.sh");
const profileDir = join(repoRoot, ".claude", "cloud-profile");
const skillsDir = join(profileDir, "skills");
const retiredSessionMemoryNames = [
  "dev-drive-project-location.md",
  "db-remediation-coordination-state.md",
  "rag-programme-coordination-state.md",
  "ingestion-review-remediation-state.md",
  "lighthouse-mobile-root-cls-flake.md",
  "local-test-failures-windows.md",
  "codex-chat-import-tooling.md",
];
const bashCommand =
  process.platform === "win32"
    ? ([
        "C:\\Program Files\\Git\\bin\\bash.exe",
        join(process.env.ProgramFiles || "C:\\Program Files", "Git/bin/bash.exe"),
      ].find((p) => existsSync(p)) ?? "bash")
    : "bash";

// The vendored third-party skill tree is ~90,000 lines across ~400 files that no reviewer reads, so it
// ships in its own pull request and the rest of the profile — all of it ours — lands separately. A
// checkout can therefore legitimately hold the profile without `skills/`. The assertions below that
// need the tree say so explicitly rather than failing on a valid intermediate state; they become the
// real contract again the moment it lands. Everything else here is asserted unconditionally.
const hasVendoredSkills = existsSync(skillsDir);

const temporaryDirectories: string[] = [];

function makeConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "claude-cloud-profile-"));
  temporaryDirectories.push(dir);
  return dir;
}

// A disposable HOME for the provisioner, so its marker/lock/log directory is this test's alone.
function makeSandboxHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "claude-cloud-home-"));
  temporaryDirectories.push(dir);
  return dir;
}

// The provisioner's own view of that sandbox, kept in one place so a test can plant a lock or a
// marker where the script will actually look for it.
function markerDirFor(sandboxHome: string): string {
  return join(sandboxHome, ".cache", "clinical-kb-claude-cloud");
}

// `--skip=skills` by default: the skills part is several megabytes across ~500 files and dominates the
// runtime of every spawn. Tests that actually exercise skill installation opt back in.
function runApplier(
  configDir: string,
  env: Record<string, string> = {},
  extraArgs: string[] = ["--skip=skills"],
  scriptPath = applier,
) {
  return spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CODE_REMOTE: "true",
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_PROJECT_DIR: repoRoot,
      ...env,
    },
  });
}

function makeMemoryProfileFixture() {
  const fixtureRoot = makeConfigDir();
  const fixtureScript = join(fixtureRoot, "scripts", "apply-claude-cloud-profile.mjs");
  const memorySource = join(fixtureRoot, ".claude", "cloud-profile", "memory");
  mkdirSync(join(fixtureRoot, "scripts"));
  mkdirSync(join(fixtureRoot, ".claude", "cloud-profile"), { recursive: true });
  cpSync(applier, fixtureScript);
  cpSync(join(profileDir, "memory"), memorySource, { recursive: true });
  const configDir = makeConfigDir();
  const slug = repoRoot.replace(/[/\\:]/g, "-");
  return {
    configDir,
    fixtureRoot,
    fixtureScript,
    memorySource,
    memoryTarget: join(configDir, "projects", slug, "memory"),
    run: () => runApplier(configDir, {}, ["--skip=settings,claude-md,skills"], fixtureScript),
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    // Bounded retries are a repo-wide contract for recursive fixture cleanup
    // (tests/test-runner-safety.test.ts): on Windows a scanner or a just-closed child process can
    // still hold a handle when the test ends, and an unretried rmSync turns that into a flake.
    rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("checked-in cloud profile", () => {
  it("carries the pieces a bare container cannot otherwise obtain", () => {
    expect(existsSync(join(profileDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(profileDir, "settings.json"))).toBe(true);
    expect(readdirSync(join(profileDir, "memory")).filter((f) => f.endsWith(".md")).length).toBeGreaterThan(0);
    if (hasVendoredSkills) expect(readdirSync(skillsDir).length).toBeGreaterThan(0);
  });

  it("keeps Windows-only configuration out of the container snapshot", () => {
    // The workstation's ~/.claude/settings.json carries a Shellular notification hook that shells out
    // to a Windows node.exe path, and Desktop Commander MCP permissions for a server that does not
    // exist in a Linux container. Neither can work there, and the hook would fire on every
    // notification.
    const snapshot = readFileSync(join(profileDir, "settings.json"), "utf8");
    expect(snapshot).not.toMatch(/Desktop_Commander/);
    expect(snapshot).not.toMatch(/shellular/i);
    expect(snapshot).not.toMatch(/[A-Za-z]:\\\\/);
    expect(JSON.parse(snapshot).hooks).toBeUndefined();
  });
});

describe("apply-claude-cloud-profile", () => {
  it("refuses to touch a machine that is not a cloud container", () => {
    const configDir = makeConfigDir();
    const result = runApplier(configDir, { CLAUDE_CODE_REMOTE: "" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/not a remote container/);
    expect(existsSync(join(configDir, "settings.json"))).toBe(false);
    expect(existsSync(join(configDir, "CLAUDE.md"))).toBe(false);
  });

  it("deep-merges settings so platform-written keys survive", () => {
    const configDir = makeConfigDir();
    writeFileSync(
      join(configDir, "settings.json"),
      JSON.stringify({ installMethod: "native", permissions: { allow: ["Bash(ls)"] } }),
    );

    expect(runApplier(configDir).status).toBe(0);

    const merged = JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8"));
    expect(merged.installMethod).toBe("native");
    expect(merged.permissions.allow).toEqual(["Bash(ls)"]);
    expect(merged.permissions.defaultMode).toBe("auto");
    expect(Object.keys(merged.enabledPlugins).length).toBeGreaterThan(0);
  });

  it("rejects a misspelled applier option before writing the profile", () => {
    const configDir = makeConfigDir();
    const result = runApplier(configDir, {}, ["--dryrun", "--skip=skills,memory,claude-md"]);
    expect(result.status).toBe(2);
    expect(existsSync(join(configDir, "settings.json"))).toBe(false);
  });

  it.each(["null", '["host data"]', '"host data"'])(
    "preserves nonobject host settings %s before replacing them",
    (settings) => {
      const configDir = makeConfigDir();
      const settingsPath = join(configDir, "settings.json");
      writeFileSync(settingsPath, settings);
      const result = runApplier(configDir);
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(`${settingsPath}.unparseable`, "utf8")).toBe(settings);
      expect(JSON.parse(readFileSync(settingsPath, "utf8")).permissions.defaultMode).toBe("auto");
    },
  );

  it("does not echo malformed host settings in the JSON parse warning", () => {
    const configDir = makeConfigDir();
    const syntheticSecret = "SYNTHETIC_PRIVATE_SETTING";
    writeFileSync(join(configDir, "settings.json"), syntheticSecret);
    const result = runApplier(configDir);
    expect(result.status).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(syntheticSecret);
    expect(readFileSync(join(configDir, "settings.json.unparseable"), "utf8")).toBe(syntheticSecret);
  });

  it("rejects nonobject profile settings without replacing host settings", () => {
    const fixture = makeMemoryProfileFixture();
    writeFileSync(join(fixture.fixtureRoot, ".claude", "cloud-profile", "settings.json"), "[]");
    writeFileSync(join(fixture.configDir, "settings.json"), '{"host":"preserve"}');
    const result = runApplier(fixture.configDir, {}, ["--skip=skills,memory,claude-md"], fixture.fixtureScript);
    expect(result.status).toBe(1);
    expect(readFileSync(join(fixture.configDir, "settings.json"), "utf8")).toBe('{"host":"preserve"}');
  });

  it("validates memory seeds before changing any other profile part", () => {
    const fixture = makeMemoryProfileFixture();
    const source = join(fixture.fixtureRoot, ".claude", "cloud-profile");
    writeFileSync(join(source, "settings.json"), '{"profileSetting":true}');
    writeFileSync(join(source, "CLAUDE.md"), "profile instructions\n");
    writeFileSync(join(fixture.memorySource, "seed-manifest.json"), "invalid manifest");
    writeFileSync(join(fixture.configDir, "settings.json"), '{"hostSetting":true}');
    writeFileSync(join(fixture.configDir, "CLAUDE.md"), "host instructions\n");

    const result = runApplier(fixture.configDir, {}, ["--skip=skills"], fixture.fixtureScript);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("memory seed manifest");
    expect(readFileSync(join(fixture.configDir, "settings.json"), "utf8")).toBe('{"hostSetting":true}');
    expect(readFileSync(join(fixture.configDir, "CLAUDE.md"), "utf8")).toBe("host instructions\n");
    expect(existsSync(join(fixture.configDir, "CLAUDE.md.pre-cloud-profile"))).toBe(false);
    expect(existsSync(fixture.memoryTarget)).toBe(false);
  });

  it("preserves a newly malformed settings file when an earlier backup already exists", () => {
    const configDir = makeConfigDir();
    const settingsPath = join(configDir, "settings.json");
    const malformed = "{ this is not valid JSON";
    writeFileSync(settingsPath, malformed);
    writeFileSync(`${settingsPath}.unparseable`, "earlier malformed settings\n");

    expect(runApplier(configDir).status).toBe(0);

    expect(readFileSync(`${settingsPath}.unparseable`, "utf8")).toBe("earlier malformed settings\n");
    expect(readFileSync(`${settingsPath}.unparseable.1`, "utf8")).toBe(malformed);
    expect(() => JSON.parse(readFileSync(settingsPath, "utf8"))).not.toThrow();
  });

  it("backs up an existing CLAUDE.md exactly once rather than losing it", () => {
    const configDir = makeConfigDir();
    writeFileSync(join(configDir, "CLAUDE.md"), "container-written guidance\n");

    expect(runApplier(configDir).status).toBe(0);
    expect(readFileSync(join(configDir, "CLAUDE.md.pre-cloud-profile"), "utf8")).toBe("container-written guidance\n");

    // A second run must not overwrite the backup with the profile copy it just installed.
    expect(runApplier(configDir).status).toBe(0);
    expect(readFileSync(join(configDir, "CLAUDE.md.pre-cloud-profile"), "utf8")).toBe("container-written guidance\n");
  });

  it("never clobbers a memory the container already wrote", () => {
    const configDir = makeConfigDir();
    const slug = repoRoot.replace(/[/\\:]/g, "-");
    const memoryDir = join(configDir, "projects", slug, "memory");
    mkdirSync(memoryDir, { recursive: true });
    const [firstMemory] = readdirSync(join(profileDir, "memory")).filter((f) => f.endsWith(".md"));
    writeFileSync(join(memoryDir, firstMemory), "newer, written inside the container\n");

    expect(runApplier(configDir).status).toBe(0);

    expect(readFileSync(join(memoryDir, firstMemory), "utf8")).toBe("newer, written inside the container\n");
    const manifest = JSON.parse(readFileSync(join(profileDir, "memory", "seed-manifest.json"), "utf8"));
    expect(readdirSync(memoryDir).length).toBe(manifest.files.length);
  });

  it("seeds reusable guidance without retired workstation state or coordination tasks", () => {
    const configDir = makeConfigDir();
    const slug = repoRoot.replace(/[/\\:]/g, "-");
    const memoryDir = join(configDir, "projects", slug, "memory");

    const result = runApplier(configDir);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const seededNames = readdirSync(memoryDir);
    const index = readFileSync(join(memoryDir, "MEMORY.md"), "utf8");
    for (const name of retiredSessionMemoryNames) {
      expect(seededNames).not.toContain(name);
      expect(index).not.toContain(name);
      expect(existsSync(join(repoRoot, "docs", "archive", "cloud-session-state-2026-10-16", name))).toBe(true);
    }
    expect(index).not.toMatch(/R1-first|D4 UNRESOLVED|Phase 5 \+ reconcile left|PR A′\/C local|D:\\Repos\\Database/);
    expect(seededNames).toContain("never-print-env-values.md");
    expect(seededNames).not.toContain("seed-manifest.json");
    expect(readFileSync(join(memoryDir, "never-print-env-values.md"), "utf8")).toBe(
      readFileSync(join(profileDir, "memory", "never-print-env-values.md"), "utf8"),
    );
    // Guidance is installed outside the checkout: sibling links must still resolve there,
    // while repository references explicitly use the verified checkout root.
    for (const name of seededNames) {
      const content = readFileSync(join(memoryDir, name), "utf8");
      for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        expect(existsSync(join(memoryDir, match[1])), `${name}: ${match[1]}`).toBe(true);
      }
      for (const match of content.matchAll(/`(docs\/[^`]+\.md)`/g)) {
        expect(existsSync(join(repoRoot, match[1])), `${name}: ${match[1]}`).toBe(true);
        expect(content).toContain("Resolve repository paths against the verified current checkout root");
      }
    }
  });

  it("preserves existing host memories and indexes even when their seed names were retired", () => {
    const configDir = makeConfigDir();
    const slug = repoRoot.replace(/[/\\:]/g, "-");
    const memoryDir = join(configDir, "projects", slug, "memory");
    mkdirSync(memoryDir, { recursive: true });
    const hostIndex = "Host-authored index; retained session references are the host's records.\n";
    writeFileSync(join(memoryDir, "MEMORY.md"), hostIndex);
    for (const name of retiredSessionMemoryNames) writeFileSync(join(memoryDir, name), `Host-authored ${name}\n`);

    const result = runApplier(configDir);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    expect(readFileSync(join(memoryDir, "MEMORY.md"), "utf8")).toBe(hostIndex);
    for (const name of retiredSessionMemoryNames) {
      expect(readFileSync(join(memoryDir, name), "utf8")).toBe(`Host-authored ${name}\n`);
    }
    expect(existsSync(join(memoryDir, "never-print-env-values.md"))).toBe(true);
  });

  it.skipIf(process.platform === "win32")("preserves a host memory symlink whose target is temporarily absent", () => {
    const fixture = makeMemoryProfileFixture();
    mkdirSync(fixture.memoryTarget, { recursive: true });
    const hostTarget = join(fixture.configDir, "unmounted-host-index.md");
    const index = join(fixture.memoryTarget, "MEMORY.md");
    symlinkSync(hostTarget, index);
    const result = fixture.run();
    expect(result.status, result.stderr).toBe(0);
    expect(lstatSync(index).isSymbolicLink()).toBe(true);
    expect(existsSync(hostTarget)).toBe(false);
  });

  it("does not seed an unlisted session file added to the source directory", () => {
    const fixture = makeMemoryProfileFixture();
    writeFileSync(join(fixture.memorySource, "stale-session.md"), "Resume the obsolete task queue.\n");

    const result = fixture.run();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(fixture.memoryTarget, "stale-session.md"))).toBe(false);
    expect(existsSync(join(fixture.memoryTarget, "never-print-env-values.md"))).toBe(true);
  });

  it.each([
    ["../outside.md", "plain Markdown filenames"],
    ["nested/unsafe.md", "plain Markdown filenames"],
    ["C:\\unsafe.md", "plain Markdown filenames"],
    [17, "plain Markdown filenames"],
    ["MEMORY.md", "duplicate filenames"],
    ["memory.md", "duplicate filenames"],
    ["missing.md", "missing or is not a regular file"],
  ])("rejects invalid memory seed entry %j without seeding any memories", (entry, message) => {
    const fixture = makeMemoryProfileFixture();
    const manifestPath = join(fixture.memorySource, "seed-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files.push(entry);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(existsSync(fixture.memoryTarget)).toBe(false);
  });

  it("rejects an index that tries to restore an unlisted session record", () => {
    const fixture = makeMemoryProfileFixture();
    writeFileSync(join(fixture.memorySource, "stale-session.md"), "Resume the obsolete task queue.\n");
    const indexPath = join(fixture.memorySource, "MEMORY.md");
    writeFileSync(indexPath, `${readFileSync(indexPath, "utf8")}\n- [Old task](stale-session.md)\n`);

    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("memory seed index refers to an unlisted seed");
    expect(existsSync(fixture.memoryTarget)).toBe(false);
  });

  it.skipIf(!hasVendoredSkills)("replaces a skill entry that is not a directory", () => {
    const configDir = makeConfigDir();
    const [firstSkill] = readdirSync(skillsDir);
    mkdirSync(join(configDir, "skills"), { recursive: true });
    writeFileSync(join(configDir, "skills", firstSkill), "a plain file where a directory belongs\n");

    const result = runApplier(configDir, {}, []);

    expect(result.stderr).not.toMatch(/ERR_FS_CP_DIR_TO_NON_DIR/);
    expect(result.status).toBe(0);
    expect(readdirSync(join(configDir, "skills", firstSkill)).length).toBeGreaterThan(0);
  });

  it("is idempotent", () => {
    const configDir = makeConfigDir();
    expect(runApplier(configDir).status).toBe(0);
    const second = runApplier(configDir);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/already matches the profile/);
  });

  it("installs the rest of the profile even when the vendored skill tree is absent", () => {
    // The skill tree ships in its own pull request, so a valid checkout can hold the profile without
    // it. Copying skills therefore has to be conditional on the directory existing: an unguarded
    // readdirSync would throw ENOENT and take the settings, CLAUDE.md and memory parts down with it,
    // leaving a container with none of the profile and a SessionStart hook that swallowed the error.
    // Asserted against the source because profileDir is resolved from the script's own location and
    // cannot be pointed at a fixture.
    const source = readFileSync(applier, "utf8");
    const declaration = source.indexOf('const profileSkills = join(profileDir, "skills");');
    expect(declaration).toBeGreaterThan(-1);
    expect(source.slice(declaration)).toMatch(/^const profileSkills = [^\n]*\nif \(existsSync\(profileSkills\)/);
  });
});

describe("setup-claude-cloud", () => {
  // Every spawn gets a throwaway HOME. The provisioner derives its marker, lock and log directory
  // from `$HOME/.cache/clinical-kb-claude-cloud`, so a test that let it see the real one would read
  // whatever state the machine happened to be in: on a container the SessionStart hook has already
  // provisioned, a completed-tier marker short-circuits the tier before the code under test runs, and
  // the assertion below failed for a machine that was working perfectly. Overriding HOME is enough
  // here because the provisioner is a shell script, where `$HOME` is just an environment variable —
  // the applier needs CLAUDE_CONFIG_DIR instead, for the Windows reason recorded at the top of this
  // file.
  function runProvisioner(args: string[], env: Record<string, string> = {}, scriptPath = provisioner) {
    return spawnSync(bashCommand, [scriptPath, ...args], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CODE_REMOTE: "", HOME: makeSandboxHome(), ...env },
    });
  }

  it("refuses to provision a machine that is not a cloud container", () => {
    const result = runProvisioner([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/not a Claude Code cloud container/);
    expect(result.stdout).toMatch(/--allow-local/);
  });

  it("exposes every documented tier", () => {
    const result = runProvisioner(["--list"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual(["profile", "plugins", "gh", "deno", "browsers", "python"]);
  });

  it.each([
    { invalidTier: "definitely-not-a-tier", sessionMode: false },
    { invalidTier: "profile plugins", sessionMode: false },
    { invalidTier: "*", sessionMode: false },
    { invalidTier: "definitely-not-a-tier", sessionMode: true },
  ])(
    "validates selected tier $invalidTier before provisioning (session=$sessionMode)",
    ({ invalidTier, sessionMode }) => {
      const project = makeConfigDir();
      const home = makeSandboxHome();
      mkdirSync(join(project, "scripts"));
      const script = join(project, "scripts", "setup-claude-cloud.sh");
      cpSync(provisioner, script);
      writeFileSync(
        join(project, "scripts", "apply-claude-cloud-profile.mjs"),
        'import { writeFileSync } from "node:fs"; writeFileSync(process.env.CLAUDE_CONFIG_DIR + "/mutation", "profile applied");',
      );
      const args = sessionMode ? ["--session"] : [];
      const result = runProvisioner(
        [...args, "profile", invalidTier],
        {
          HOME: home,
          CLAUDE_CODE_REMOTE: "true",
          CLAUDE_PROJECT_DIR: project,
          CLAUDE_CONFIG_DIR: home,
          CLAUDE_CLOUD_SKIP_TIERS: "",
          CLAUDE_CLOUD_BACKGROUND_TIERS: "",
        },
        script,
      );
      expect(result.status).toBe(sessionMode ? 0 : 1);
      expect(result.stderr).toContain("unknown tier");
      expect(existsSync(join(home, "mutation"))).toBe(false);
      expect(existsSync(markerDirFor(home))).toBe(false);
    },
  );

  it.each(["CLAUDE_CLOUD_SESSION_TIERS", "CLAUDE_CLOUD_BACKGROUND_TIERS"])(
    "validates the %s override before provisioning",
    (override) => {
      const home = makeSandboxHome();
      const result = runProvisioner(["--session"], {
        HOME: home,
        CLAUDE_CODE_REMOTE: "true",
        CLAUDE_CLOUD_SESSION_TIERS: "profile",
        CLAUDE_CLOUD_BACKGROUND_TIERS: "",
        [override]: "definitely-not-a-tier",
        // If validation regresses, keep this fixture from running any real installers.
        CLAUDE_CLOUD_SKIP_TIERS: "profile,plugins,gh,deno,browsers,python",
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("unknown tier");
      expect(result.stdout).not.toMatch(/tier \w+:|provisioning in the background/);
      expect(existsSync(markerDirFor(home))).toBe(false);
    },
  );

  it("does not trust a cached deno marker when the runtime no longer works", () => {
    const home = makeSandboxHome();
    const binaries = join(home, "bin");
    mkdirSync(binaries);
    for (const [name, body] of [
      ["deno", "exit 127"],
      ["npm", "exit 97"],
    ]) {
      const path = join(binaries, name);
      writeFileSync(path, `#!/bin/bash\n${body}\n`);
      chmodSync(path, 0o755);
    }
    mkdirSync(markerDirFor(home), { recursive: true });
    writeFileSync(join(markerDirFor(home), "deno.marker"), "v2\n");
    const result = runProvisioner(["deno"], {
      HOME: home,
      CLAUDE_CODE_REMOTE: "true",
      CLAUDE_CLOUD_SKIP_TIERS: "",
      PATH: `${binaries}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("tier deno: provisioning");
    expect(result.stdout).not.toContain("already provisioned");
    expect(result.stdout).not.toContain("all selected tiers complete");
  });

  it.each([["--tier"], ["--tier="], ["--tier", "--force"], ["--nonsense"], ["deno", "--nonsense"]])(
    "rejects malformed selector arguments %j before entering any tier",
    (...args) => {
      const result = runProvisioner(["--allow-local", ...args], {
        CLAUDE_CLOUD_SKIP_TIERS: "profile,plugins,gh,deno,browsers,python",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).not.toMatch(/tier \w+:/);
    },
  );

  it("keeps a session nonfatal and reports when its project directory is unavailable", () => {
    const result = runProvisioner(["--session", "deno"], {
      CLAUDE_CODE_REMOTE: "true",
      CLAUDE_PROJECT_DIR: join(makeSandboxHome(), "missing-project"),
      CLAUDE_CLOUD_BACKGROUND_TIERS: "",
    });
    expect(result.status).toBe(0);
    const envelope = result.stdout.split(/\r?\n/).find((line) => line.startsWith('{"hookSpecificOutput"'));
    expect(envelope).toBeDefined();
    expect(JSON.parse(envelope!).hookSpecificOutput.additionalContext).toContain("project directory");
  });

  it("repairs plugin npm dependencies even when the claude CLI is absent", () => {
    // Claude Code installs the repo's declared enabledPlugins itself, but neither it nor
    // `claude plugin install` installs a plugin's npm dependencies — a plugin with runtime
    // dependencies unpacks clean and then fails at first use. That repair is the one job here nothing
    // else does, so it must not sit behind the CLI check. It did, briefly, which made the repair
    // unreachable in exactly the containers where Claude Code had already done the installing.
    const source = readFileSync(provisioner, "utf8");
    const cliGuard = source.indexOf("the claude CLI is not on PATH");
    const dependencyCall = source.indexOf("install_plugin_dependencies ||");
    expect(cliGuard).toBeGreaterThan(-1);
    expect(dependencyCall).toBeGreaterThan(cliGuard);
    expect(source.slice(cliGuard, dependencyCall)).not.toMatch(/\breturn 0\b/);
  });

  it("takes the plugin list from the settings Claude Code actually reads", () => {
    // Three hand-maintained copies of the same list (repo settings, profile snapshot, this script)
    // could only drift. The script derives its list from .claude/settings.json instead.
    const source = readFileSync(provisioner, "utf8");
    expect(source).toContain('readFileSync(".claude/settings.json"');
    for (const plugin of Object.keys(
      JSON.parse(readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8")).enabledPlugins,
    )) {
      expect(source).not.toContain(plugin);
    }
  });

  it("cannot fail a session in --session mode", () => {
    // A SessionStart hook that exits non-zero surfaces as a session-level error. Session mode has to
    // swallow every failure, including an outright unknown tier, while a direct run still reports it.
    const sessionRun = runProvisioner(["--session", "--allow-local", "definitely-not-a-tier"], {
      CLAUDE_CLOUD_BACKGROUND_TIERS: "",
    });
    expect(sessionRun.status).toBe(0);
    expect(sessionRun.stdout).not.toMatch(/provisioning in the background/);

    const directRun = runProvisioner(["--allow-local", "definitely-not-a-tier"], {
      CLAUDE_CLOUD_BACKGROUND_TIERS: "",
    });
    expect(directRun.status).toBe(1);
  });

  it("emits a stdout SessionStart context envelope when a tier fails in session mode", () => {
    // stderr is invisible to Claude; a hook must put anything worth surfacing on stdout as a
    // hookSpecificOutput envelope. cleanup() still forces exit 0 here — this proves the failure is
    // seen, not that it becomes fatal.
    const result = runProvisioner(["--session", "--allow-local", "definitely-not-a-tier"], {
      CLAUDE_CLOUD_BACKGROUND_TIERS: "",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/"hookEventName":"SessionStart"/);
    expect(result.stdout).toMatch(
      /"additionalContext":"claude-cloud provisioning incomplete:[^"]*invalid tier selection/,
    );
  });

  it("reports pending rather than false completion when another run already holds a tier's lock", () => {
    // The documented confirmation command (`bash scripts/setup-claude-cloud.sh browsers python`) used
    // to treat a held lock exactly like a skip: it logged and moved on, so the closing "all selected
    // tiers complete" printed even though the locking run was still mid-install. `deno` is used only
    // because acquiring its lock is cheap to fake — the lock check runs before tier_deno itself, so no
    // real install is ever attempted.
    const sandboxHome = makeSandboxHome();
    mkdirSync(join(markerDirFor(sandboxHome), "deno.lock"), { recursive: true });

    const result = runProvisioner(["--allow-local", "deno"], {
      CLAUDE_CLOUD_SKIP_TIERS: "",
      HOME: sandboxHome,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/still being provisioned by another run: deno/);
    expect(result.stdout).not.toMatch(/all selected tiers complete/);
  });

  it("keeps tier listing read-only even when its project directory is unavailable", () => {
    // Guards the isolation the test above depends on. This suite used to plant its lock in the REAL
    // ~/.cache/clinical-kb-claude-cloud, so it both read and wrote the machine's actual provisioning
    // state. A completed-tier marker there short-circuited the tier before the code under test ran,
    // and the assertion above failed on exactly the machines this tooling exists for — any container
    // whose SessionStart hook had already provisioned deno — while staying green on CI's clean
    // runners, which is how it reached main.
    //
    // Deliberately asserted WITHOUT reading the host's directory. Snapshotting it before and after
    // and comparing would reintroduce the same class of defect from the other side: the SessionStart
    // hook detaches the browsers and python tiers, so a marker can legitimately appear there mid-test
    // and fail the comparison while the spawn was correctly sandboxed all along.
    //
    // Listing is metadata only: it must need neither a working checkout nor a writable cache.
    const sandboxHome = makeSandboxHome();
    expect(existsSync(markerDirFor(sandboxHome))).toBe(false);

    const result = runProvisioner(["--list"], {
      HOME: sandboxHome,
      CLAUDE_PROJECT_DIR: join(sandboxHome, "missing-project"),
    });

    expect(result.status).toBe(0);
    expect(existsSync(markerDirFor(sandboxHome))).toBe(false);
  });

  it("tries the pinned Python minor before ever falling back to a different python3", () => {
    // Folding the python3 fallback into the FIRST lookup let an older interpreter that already had a
    // working venv module (e.g. system 3.11) mask the need to install python${wanted} at all, so the
    // version check further down rejected that older interpreter and the OCR tier always failed on a
    // container that already had some other Python 3.
    const source = readFileSync(provisioner, "utf8");
    const tierBody = source.slice(source.indexOf("tier_python() {"), source.indexOf("tier_signature() {"));
    const wantedLookup = tierBody.indexOf('python_bin="$(command -v "python${wanted}"');
    const installAttempt = tierBody.indexOf('apt_install "python${wanted}"');
    const genericFallback = tierBody.indexOf('python_bin="$(command -v python3 || true)"');
    expect(wantedLookup).toBeGreaterThan(-1);
    expect(installAttempt).toBeGreaterThan(wantedLookup);
    expect(genericFallback).toBeGreaterThan(installAttempt);
  });

  it("persists the gh tarball fallback onto PATH for later commands, not just this run", () => {
    // A plain `export PATH=` only reaches this script's own process tree. Without also appending to
    // CLAUDE_ENV_FILE, a later Claude command in the same session cannot find gh, and the completed
    // marker then stops any later session from repairing it.
    const source = readFileSync(provisioner, "utf8");
    const tierBody = source.slice(source.indexOf("tier_gh() {"), source.indexOf("tier_deno() {"));
    expect(tierBody).toContain("CLAUDE_ENV_FILE");
  });

  it("folds the plugin cache into the plugins marker signature, not just settings.json", () => {
    // A plugin Claude installed or updated in the cache without touching the repo's declared list left
    // the settings.json-only signature unchanged, so the marker stayed valid and the whole tier —
    // including the dependency repair — was skipped.
    const source = readFileSync(provisioner, "utf8");
    const signatureBody = source.slice(
      source.indexOf("tier_signature() {"),
      source.indexOf(
        "# --------------------------------------------------------------------------------------------\n# Run",
      ),
    );
    const pluginsCase = signatureBody.slice(signatureBody.indexOf("plugins)"), signatureBody.indexOf("gh) printf"));
    expect(pluginsCase).toContain(".claude/settings.json");
    expect(pluginsCase).toContain("$HOME/.claude/plugins/cache");
  });
});

describe("SessionStart registration", () => {
  it("injects conditional CI guidance and requires ensure before browser execution", () => {
    const result = spawnSync(bashCommand, [join(repoRoot, ".claude", "hooks", "testing-policy.sh")], {
      encoding: "utf8",
      input: "malformed hook payload is harmless",
      env: { ...process.env, CLAUDE_CODE_REMOTE: "true", CLAUDE_PROJECT_DIR: repoRoot },
    });
    expect(result.status).toBe(0);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    expect(context).toContain("npm run ensure");
    expect(context).toContain("event, draft and scope");
    expect(context).toContain("pending until");
    expect(context).not.toMatch(/646|25 min|CI re-runs the browser suite on every change/);
    expect(context).not.toContain("full suite left to CI");
  });

  it("runs the provisioner after Node and node_modules exist", () => {
    // The browsers tier shells out to ./node_modules/.bin/playwright, so ordering is load-bearing:
    // session-start.sh is what installs Node and runs npm ci.
    const settings = JSON.parse(readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8"));
    const commands: string[] = settings.hooks.SessionStart.flatMap((entry: { hooks: { command: string }[] }) =>
      entry.hooks.map((hook) => hook.command),
    );
    const nodeInstaller = commands.findIndex((command) => command.includes("session-start.sh"));
    const provisionerIndex = commands.findIndex((command) => command.includes("setup-claude-cloud.sh"));

    expect(nodeInstaller).toBeGreaterThanOrEqual(0);
    expect(provisionerIndex).toBeGreaterThan(nodeInstaller);
    expect(commands[provisionerIndex]).toContain("--session");
  });

  it("enables the checked-in MCP servers, which settings.local.json cannot carry into a container", () => {
    const settings = JSON.parse(readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8"));
    expect(settings.enabledMcpjsonServers).toEqual(["railway", "supabase"]);
  });
});

describe("setup-claude-cloud apt serialisation", () => {
  // The browsers tier shells out to `playwright install --with-deps` and the python tier calls
  // apt_install for tesseract. Both drive apt, and the per-tier lock deliberately does not serialise
  // across tiers, so on 2026-09-06 the documented confirmation command
  // (`bash scripts/setup-claude-cloud.sh browsers python`) collided with the session hook's own
  // background child: the browsers tier died with Playwright's opaque "Installation process exited
  // with code: 100" while the log carried apt's real explanation, "E: dpkg was interrupted".
  //
  // `with_apt_lock` is extracted from the real script rather than restated here, so these tests
  // cannot pass against a copy that has drifted from the code that ships.
  function aptLockHarness(home: string, body: string) {
    const source = readFileSync(provisioner, "utf8");
    const start = source.indexOf("with_apt_lock() {");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("\n}\n", start) + 3;
    const fn = source.slice(start, end);
    expect(fn).toContain('mkdir "$lock"');

    const harness = join(home, "harness.sh");
    writeFileSync(harness, ['marker_dir="$1"', "log() { :; }", "warn() { :; }", fn, body].join("\n") + "\n", "utf8");
    return harness;
  }

  it("fails the caller instead of running the command unlocked when the wait expires", () => {
    const home = makeSandboxHome();
    const markers = join(home, "markers");
    mkdirSync(join(markers, "apt.lock"), { recursive: true });
    const ran = join(home, "ran");
    const harness = aptLockHarness(home, `with_apt_lock touch "${ran.replace(/\\/g, "/")}"; echo "status=$?"`);

    const result = spawnSync(bashCommand, [harness, markers], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CLOUD_APT_LOCK_TIMEOUT: "0" },
    });

    // Falling through to an unlocked run is the whole bug: it would reproduce the concurrent dpkg
    // access precisely when the other holder is provably still working.
    expect(result.stdout).toContain("status=1");
    expect(existsSync(ran)).toBe(false);
  });

  it("serialises two concurrent callers rather than letting them overlap", () => {
    const home = makeSandboxHome();
    const markers = join(home, "markers");
    mkdirSync(markers, { recursive: true });
    const out = join(home, "out").replace(/\\/g, "/");
    const harness = aptLockHarness(
      home,
      `with_apt_lock sh -c 'echo "START $2" >> "$1"; sleep 1; echo "END $2" >> "$1"' _ "${out}" "$2"`,
    );

    const runs = ["A", "B"].map((label) =>
      spawnSync(
        bashCommand,
        ["-c", `bash "${harness.replace(/\\/g, "/")}" "${markers.replace(/\\/g, "/")}" ${label} &`],
        {
          encoding: "utf8",
          env: { ...process.env, CLAUDE_CLOUD_APT_LOCK_TIMEOUT: "60" },
        },
      ),
    );
    for (const run of runs) expect(run.status).toBe(0);

    // Give both detached callers time to finish their 1s critical sections plus the 5s poll.
    const deadline = Date.now() + 30_000;
    let lines: string[] = [];
    while (Date.now() < deadline) {
      lines = existsSync(out) ? readFileSync(out, "utf8").trim().split(/\r?\n/).filter(Boolean) : [];
      if (lines.length >= 4) break;
      spawnSync(bashCommand, ["-c", "sleep 0.5"]);
    }

    expect(lines).toHaveLength(4);
    // Whichever won, its END must precede the other's START; interleaving is the failure.
    expect(lines[0]).toMatch(/^START /);
    expect(lines[1]).toBe(lines[0].replace("START", "END"));
    expect(lines[2]).toMatch(/^START /);
    expect(lines[2]).not.toBe(lines[0]);
    expect(lines[3]).toBe(lines[2].replace("START", "END"));
  });
});

describe("profile snapshot fidelity", () => {
  it.skipIf(!hasVendoredSkills)("copies skills as real directories, not as the workstation's symlinks", () => {
    // ~/.claude/skills is mostly symlinks into ~/.agents/skills. A snapshot that preserved them would
    // be a directory of dangling links in a container.
    const skills = readdirSync(skillsDir, { withFileTypes: true });
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.isSymbolicLink()).toBe(false);
      expect(skill.isDirectory()).toBe(true);
    }
  });
});
