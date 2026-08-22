import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const bashCommand =
  process.platform === "win32"
    ? ([
        "C:\\Program Files\\Git\\bin\\bash.exe",
        join(process.env.ProgramFiles || "C:\\Program Files", "Git/bin/bash.exe"),
      ].find((candidate) => existsSync(candidate)) ?? "bash")
    : "bash";

function bashPathEntry(entry: string): string {
  if (process.platform !== "win32") return entry;
  return entry.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/");
}

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
function runApplier(configDir: string, env: Record<string, string> = {}, extraArgs: string[] = ["--skip=skills"]) {
  return spawnSync(process.execPath, [applier, ...extraArgs], {
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
    expect(readdirSync(memoryDir).length).toBe(readdirSync(join(profileDir, "memory")).length);
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
  function runProvisioner(args: string[], env: Record<string, string> = {}) {
    const sandboxHome = env.HOME ?? makeSandboxHome();
    return spawnSync(bashCommand, [bashPathEntry(provisioner), ...args], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CODE_REMOTE: "", ...env, HOME: bashPathEntry(sandboxHome) },
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
      /"additionalContext":"claude-cloud provisioning incomplete:[^"]*definitely-not-a-tier/,
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

  it("resolves its marker directory from the sandbox HOME it was given", () => {
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
    // `--list` is enough because the script creates its marker directory before it parses arguments,
    // so this observes the HOME resolution itself and nothing downstream of it.
    const sandboxHome = makeSandboxHome();
    expect(existsSync(markerDirFor(sandboxHome))).toBe(false);

    const result = runProvisioner(["--list"], { HOME: sandboxHome });

    expect(result.status).toBe(0);
    expect(existsSync(markerDirFor(sandboxHome))).toBe(true);
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
