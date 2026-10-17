import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const temporary: string[] = [];
function sandbox() {
  const path = mkdtempSync(join(tmpdir(), "claude-lifecycle-"));
  temporary.push(path);
  return path;
}
function put(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function executable(path: string, body: string) {
  put(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}
function snapshot(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readdirSync(path, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const full = join(entry.parentPath, entry.name);
        return [full, readFileSync(full, "utf8")];
      }),
  );
}
afterEach(() => {
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function profileFixture(home = sandbox()) {
  const source = sandbox();
  const profile = join(source, ".claude", "cloud-profile");
  const script = join(source, "scripts", "apply-claude-cloud-profile.mjs");
  mkdirSync(dirname(script), { recursive: true });
  cpSync(join(root, "scripts", "apply-claude-cloud-profile.mjs"), script);
  put(join(profile, "CLAUDE.md"), "Synthetic profile instructions\n");
  put(join(profile, "skills", "retired", "SKILL.md"), "Synthetic retired skill\n");
  put(join(profile, "skills", "edited", "SKILL.md"), "Synthetic editable skill\n");
  put(
    join(profile, "settings.json"),
    JSON.stringify({ enabledPlugins: { retired: true, edited: true }, profileFlag: true }),
  );
  put(join(profile, "memory", "seed-manifest.json"), JSON.stringify({ version: 1, files: ["MEMORY.md"] }));
  put(join(profile, "memory", "MEMORY.md"), "Synthetic reusable seed\n");
  return {
    source,
    profile,
    home,
    run: (args: string[] = []) =>
      spawnSync(process.execPath, [script, ...args], {
        encoding: "utf8",
        env: { ...process.env, CLAUDE_CODE_REMOTE: "true", CLAUDE_CONFIG_DIR: home, CLAUDE_PROJECT_DIR: source },
      }),
  };
}

describe("Claude profile ownership lifecycle", () => {
  it("retires unchanged owned resources and retains host edits, extra files and all memory", () => {
    const fixture = profileFixture();
    expect(fixture.run().status).toBe(0);
    const edited = join(fixture.home, "skills", "edited", "SKILL.md");
    put(edited, "Host edit\n");
    put(join(fixture.home, "skills", "retired", "personal.txt"), "Host extra\n");
    put(
      join(fixture.home, "settings.json"),
      JSON.stringify({ enabledPlugins: { retired: true, edited: false }, profileFlag: true, hostFlag: true }),
    );
    rmSync(join(fixture.profile, "skills"), { recursive: true, maxRetries: 5, retryDelay: 100 });
    mkdirSync(join(fixture.profile, "skills"));
    put(join(fixture.profile, "settings.json"), "{}");
    const memory = join(fixture.home, "projects", fixture.source.replace(/[/\\:]/g, "-"), "memory", "MEMORY.md");
    put(memory, "Host memory must survive every lifecycle action\n");
    expect(fixture.run().status).toBe(0);
    expect(existsSync(join(fixture.home, "skills", "retired", "SKILL.md"))).toBe(false);
    expect(readFileSync(join(fixture.home, "skills", "retired", "personal.txt"), "utf8")).toBe("Host extra\n");
    expect(readFileSync(edited, "utf8")).toBe("Host edit\n");
    const settings = JSON.parse(readFileSync(join(fixture.home, "settings.json"), "utf8"));
    expect(settings).toEqual({ enabledPlugins: { edited: false }, hostFlag: true });
    const before = snapshot(fixture.home);
    const preview = fixture.run(["--uninstall", "--dry-run"]);
    expect(preview.status).toBe(0);
    expect(preview.stdout).toContain("would remove: CLAUDE.md");
    expect(snapshot(fixture.home)).toEqual(before);
    expect(fixture.run(["--uninstall"]).status).toBe(0);
    expect(existsSync(join(fixture.home, "CLAUDE.md"))).toBe(false);
    expect(readFileSync(edited, "utf8")).toBe("Host edit\n");
    expect(readFileSync(memory, "utf8")).toBe("Host memory must survive every lifecycle action\n");
    expect(existsSync(join(fixture.home, ".cloud-profile-install.json"))).toBe(true);
  });

  it("updates owned content, uninstalls after source removal and permits an intentional fresh install", () => {
    const fixture = profileFixture();
    expect(fixture.run().status).toBe(0);
    put(join(fixture.profile, "CLAUDE.md"), "Synthetic new instructions\n");
    expect(fixture.run().status).toBe(0);
    expect(readFileSync(join(fixture.home, "CLAUDE.md"), "utf8")).toBe("Synthetic new instructions\n");
    rmSync(fixture.profile, { recursive: true, maxRetries: 5, retryDelay: 100 });
    expect(fixture.run(["--uninstall"]).status).toBe(0);
    expect(existsSync(join(fixture.home, ".cloud-profile-install.json"))).toBe(false);
    const other = profileFixture(fixture.home);
    expect(other.run().status).toBe(0);
  });

  it("refuses a second checkout sharing a home even when adoption is requested", () => {
    const first = profileFixture();
    expect(first.run().status).toBe(0);
    const before = snapshot(first.home);
    const second = profileFixture(first.home);
    const result = second.run(["--adopt"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("owned by another source checkout");
    expect(result.stderr).toContain("separate CLAUDE_CONFIG_DIR");
    expect(snapshot(first.home)).toEqual(before);
  });

  it("requires explicit byte-identical adoption and never overwrites an unmanaged collision", () => {
    const fixture = profileFixture();
    put(join(fixture.home, "CLAUDE.md"), "Host instructions\n");
    const before = snapshot(fixture.home);
    expect(fixture.run().status).toBe(1);
    expect(fixture.run(["--adopt"]).status).toBe(1);
    expect(snapshot(fixture.home)).toEqual(before);
    cpSync(join(fixture.profile, "CLAUDE.md"), join(fixture.home, "CLAUDE.md"));
    expect(fixture.run().status).toBe(1);
    expect(fixture.run(["--adopt"]).status).toBe(0);
    expect(fixture.run(["--uninstall"]).status).toBe(0);
    expect(existsSync(join(fixture.home, "CLAUDE.md"))).toBe(false);
  });

  it("refuses conflicting unmanaged settings before installing any file", () => {
    const fixture = profileFixture();
    put(join(fixture.home, "settings.json"), '{"profileFlag":false,"hostFlag":true}');
    const before = snapshot(fixture.home);
    expect(fixture.run(["--adopt"]).status).toBe(1);
    expect(snapshot(fixture.home)).toEqual(before);
  });

  it("does not inspect malformed settings when only other profile parts are selected", () => {
    const fixture = profileFixture();
    const settings = join(fixture.home, "settings.json");
    put(settings, "Malformed unselected host settings");
    put(join(fixture.profile, "settings.json"), "Malformed unselected profile settings");
    const result = fixture.run(["--skip=settings,skills,memory"]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(settings, "utf8")).toBe("Malformed unselected host settings");
    expect(readFileSync(join(fixture.home, "CLAUDE.md"), "utf8")).toBe("Synthetic profile instructions\n");
  });

  it("preserves settings ownership records when malformed host settings are explicitly skipped", () => {
    const fixture = profileFixture();
    expect(fixture.run().status).toBe(0);
    const manifest = join(fixture.home, ".cloud-profile-install.json");
    const ownedSettings = JSON.parse(readFileSync(manifest, "utf8")).settings;
    const settings = join(fixture.home, "settings.json");
    put(settings, "Malformed host settings retained for manual repair");
    put(join(fixture.profile, "CLAUDE.md"), "Updated selected instructions\n");
    expect(fixture.run(["--skip=settings"]).status).toBe(0);
    expect(readFileSync(join(fixture.home, "CLAUDE.md"), "utf8")).toBe("Updated selected instructions\n");
    expect(JSON.parse(readFileSync(manifest, "utf8")).settings).toEqual(ownedSettings);
    expect(fixture.run(["--uninstall", "--skip=settings"]).status).toBe(0);
    expect(JSON.parse(readFileSync(manifest, "utf8")).settings).toEqual(ownedSettings);
    expect(readFileSync(settings, "utf8")).toBe("Malformed host settings retained for manual repair");
  });

  it("leaves preexisting equal settings unowned unless explicitly adopted", () => {
    const fixture = profileFixture();
    put(join(fixture.home, "settings.json"), '{"profileFlag":true,"hostFlag":true}');
    expect(fixture.run().status).toBe(0);
    expect(fixture.run(["--uninstall"]).status).toBe(0);
    const settings = JSON.parse(readFileSync(join(fixture.home, "settings.json"), "utf8"));
    expect(settings.profileFlag).toBe(true);
    expect(settings.hostFlag).toBe(true);
  });

  it("refuses an incomplete skills source instead of retiring installed skills", () => {
    const fixture = profileFixture();
    expect(fixture.run().status).toBe(0);
    rmSync(join(fixture.profile, "skills"), { recursive: true, maxRetries: 5, retryDelay: 100 });
    const before = snapshot(fixture.home);
    const result = fixture.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("source skills directory is missing");
    expect(snapshot(fixture.home)).toEqual(before);
    expect(fixture.run(["--skip=skills"]).status).toBe(0);
    expect(existsSync(join(fixture.home, "skills", "retired", "SKILL.md"))).toBe(true);
  });

  it("keeps a first-install dry run read only and rejects malformed ownership metadata", () => {
    const fixture = profileFixture();
    expect(fixture.run(["--dry-run"]).status).toBe(0);
    expect(snapshot(fixture.home)).toEqual({});
    put(join(fixture.home, ".cloud-profile-install.json"), '{"version":999}');
    const before = snapshot(fixture.home);
    expect(fixture.run().status).toBe(1);
    expect(snapshot(fixture.home)).toEqual(before);
  });

  it.skipIf(process.platform === "win32")("refuses a symlinked skill parent without touching its target", () => {
    const fixture = profileFixture();
    const outside = sandbox();
    put(join(outside, "SKILL.md"), "Host external skill\n");
    mkdirSync(join(fixture.home, "skills"));
    symlinkSync(outside, join(fixture.home, "skills", "edited"));
    const before = snapshot(outside);
    expect(fixture.run(["--adopt"]).status).toBe(1);
    expect(snapshot(outside)).toEqual(before);
    expect(existsSync(join(fixture.home, "CLAUDE.md"))).toBe(false);
  });
});

function setupFixture() {
  const source = sandbox();
  const home = join(sandbox(), "home with 'quotes$ and spaces");
  const bins = join(source, "bin");
  const config = join(source, "selected-config");
  const markers = join(home, ".cache", "clinical-kb-claude-cloud");
  const script = join(source, "scripts", "setup-claude-cloud.sh");
  mkdirSync(dirname(script), { recursive: true });
  cpSync(join(root, "scripts", "setup-claude-cloud.sh"), script);
  cpSync(
    join(root, "scripts", "apply-claude-cloud-profile.mjs"),
    join(source, "scripts", "apply-claude-cloud-profile.mjs"),
  );
  put(join(source, ".claude", "settings.json"), "{}");
  put(join(source, "worker", "python", "requirements-cloud.txt"), "synthetic lock\n");
  executable(join(bins, "claude"), "exit 0");
  executable(join(bins, "tesseract"), "exit 0");
  executable(join(bins, "npm"), 'pwd >> "$FIXTURE_TRACE"; mkdir -p node_modules');
  const env = {
    ...process.env,
    HOME: home,
    CLAUDE_CODE_REMOTE: "true",
    CLAUDE_PROJECT_DIR: source,
    CLAUDE_CONFIG_DIR: config,
    CLAUDE_CLOUD_SKIP_TIERS: "",
    CLAUDE_CLOUD_SESSION_TIERS: "",
    CLAUDE_CLOUD_BACKGROUND_TIERS: "",
    PATH: `${bins}:${process.env.PATH}`,
    FIXTURE_TRACE: join(source, "trace"),
  };
  return {
    source,
    home,
    bins,
    config,
    markers,
    env,
    run: (args: string[], extra: Record<string, string> = {}) =>
      spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...env, ...extra } }),
  };
}

describe.skipIf(process.platform === "win32")("Claude cached setup uses active resources", () => {
  it("reactivates cached Python into every fresh session env file with safe shell quoting", () => {
    const fixture = setupFixture();
    const interpreter = join(fixture.markers, "ocr-venv-3.12", "bin", "python");
    executable(interpreter, 'printf "%s\\n" "$*" >> "$FIXTURE_TRACE"; exit 0');
    put(join(fixture.markers, "python.marker"), `${createHash("sha256").update("synthetic lock\n").digest("hex")}\n`);
    for (const name of ["first.env", "second.env"]) {
      const envFile = join(fixture.source, name);
      const result = fixture.run(["--session"], { CLAUDE_ENV_FILE: envFile, CLAUDE_CLOUD_BACKGROUND_TIERS: "python" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain("provisioning in the background");
      expect(readFileSync(envFile, "utf8")).toContain("export PYTHON_BIN=");
      const activation = spawnSync(
        "bash",
        [
          "-c",
          'source "$1"; test "$PYTHON_BIN" = "$2"; test "${PATH%%:*}" = "$3"',
          "_",
          envFile,
          interpreter,
          dirname(interpreter),
        ],
        { env: fixture.env },
      );
      expect(activation.status).toBe(0);
    }
    const probes = readFileSync(fixture.env.FIXTURE_TRACE, "utf8");
    expect(probes).toContain("sys.version_info[:2] == (3, 12)");
    expect(probes).toContain("import fitz, PIL, pytesseract, medspacy, spacy");
  });

  it.each(["missing interpreter", "failing imports"])("rejects a Python receipt with %s", (failure) => {
    const fixture = setupFixture();
    mkdirSync(join(fixture.markers, "python.lock"), { recursive: true });
    put(join(fixture.markers, "python.marker"), `${createHash("sha256").update("synthetic lock\n").digest("hex")}\n`);
    if (failure === "failing imports") executable(join(fixture.markers, "ocr-venv-3.12", "bin", "python"), "exit 1");
    const result = fixture.run(["python"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("still being provisioned by another run: python");
    expect(result.stdout).not.toContain("already provisioned");
    expect(result.stdout).not.toContain("all selected tiers complete");
  });

  it.each([["profile", "plugins"], ["plugins"], ["--session"]])(
    "refuses another source's config ownership before selected setup %j mutates anything",
    (...args) => {
      const fixture = setupFixture();
      put(join(fixture.source, ".claude", "settings.json"), '{"enabledPlugins":{"fixture@market":true}}');
      put(
        join(fixture.config, ".cloud-profile-install.json"),
        JSON.stringify({ version: 1, source: "/another-source", files: {}, settings: [] }),
      );
      put(
        join(fixture.config, "plugins", "cache", "market", "fixture", "1", "package.json"),
        '{"dependencies":{"synthetic":"1"}}',
      );
      executable(join(fixture.bins, "claude"), 'printf "claude invoked\\n" >> "$FIXTURE_TRACE"');
      const before = snapshot(fixture.config);
      const result = fixture.run(args, { CLAUDE_CLOUD_SESSION_TIERS: "profile plugins" });
      expect(result.status).toBe(args.includes("--session") ? 0 : 1);
      expect(result.stderr).toContain("configuration ownership refused");
      expect(snapshot(fixture.config)).toEqual(before);
      expect(existsSync(fixture.env.FIXTURE_TRACE)).toBe(false);
      expect(existsSync(fixture.markers)).toBe(false);
    },
  );

  it("blocks later plugin mutation after an unmanaged profile-file refusal", () => {
    const fixture = setupFixture();
    put(join(fixture.source, ".claude", "cloud-profile", "CLAUDE.md"), "Synthetic source instructions\n");
    put(join(fixture.config, "CLAUDE.md"), "Unmanaged host instructions\n");
    put(join(fixture.source, ".claude", "settings.json"), '{"enabledPlugins":{"fixture@market":true}}');
    executable(join(fixture.bins, "claude"), 'printf "claude invoked\\n" >> "$FIXTURE_TRACE"');
    const result = fixture.run(["profile", "plugins"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tier plugins: not run after profile refusal");
    expect(existsSync(fixture.env.FIXTURE_TRACE)).toBe(false);
    expect(readFileSync(join(fixture.config, "CLAUDE.md"), "utf8")).toBe("Unmanaged host instructions\n");
  });

  it("repairs only the selected config cache and invalidates receipts when that identity changes", () => {
    const fixture = setupFixture();
    const defaultPlugin = join(fixture.home, ".claude", "plugins", "cache", "market", "plugin", "1");
    const selectedPlugin = join(fixture.config, "plugins", "cache", "market", "plugin", "1");
    for (const path of [defaultPlugin, selectedPlugin])
      put(join(path, "package.json"), '{"dependencies":{"synthetic":"1"}}');
    expect(fixture.run(["plugins"]).status).toBe(0);
    expect(readFileSync(fixture.env.FIXTURE_TRACE, "utf8").trim()).toBe(selectedPlugin);
    expect(existsSync(join(defaultPlugin, "node_modules"))).toBe(false);
    const secondConfig = join(fixture.source, "second-config");
    const secondPlugin = join(secondConfig, "plugins", "cache", "market", "plugin", "1");
    put(join(secondPlugin, "package.json"), '{"dependencies":{"synthetic":"1"}}');
    const second = fixture.run(["plugins"], { CLAUDE_CONFIG_DIR: secondConfig });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("tier plugins: provisioning");
    expect(readFileSync(fixture.env.FIXTURE_TRACE, "utf8").trim().split("\n")).toEqual([selectedPlugin, secondPlugin]);
    rmSync(join(secondPlugin, "node_modules"), { recursive: true, maxRetries: 5, retryDelay: 100 });
    expect(fixture.run(["plugins"], { CLAUDE_CONFIG_DIR: secondConfig }).status).toBe(0);
    expect(readFileSync(fixture.env.FIXTURE_TRACE, "utf8").trim().split("\n")).toEqual([
      selectedPlugin,
      secondPlugin,
      secondPlugin,
    ]);
  });
});

describe.skipIf(process.platform === "win32")("sequential Claude SessionStart", () => {
  function fixture(failBootstrap = false) {
    const source = sandbox();
    const home = sandbox();
    const trace = join(source, "trace");
    for (const file of ["claude-session-start.sh", "claude-session-start.mjs"]) {
      mkdirSync(join(source, "scripts"), { recursive: true });
      cpSync(join(root, "scripts", file), join(source, "scripts", file));
    }
    put(
      join(source, ".claude", "hooks", "session-start.sh"),
      `set -euo pipefail\ncat >/dev/null\nprintf 'bootstrap\\n' >> "$FIXTURE_TRACE"\n${failBootstrap ? "exit 7" : "export BOOTSTRAP_READY=yes"}\n`,
    );
    for (const [path, label, isNode] of [
      ["scripts/setup-claude-cloud.sh", "setup", false],
      ["scripts/check-base-freshness.mjs", "freshness", true],
      [".claude/hooks/issues-surface.sh", "issues", false],
      [".claude/hooks/testing-policy.sh", "policy", false],
      [".claude/hooks/organisation-session-line.sh", "organisation", false],
    ] as const) {
      const context = JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: label },
      });
      put(
        join(source, path),
        isNode
          ? `import { appendFileSync } from 'node:fs'; if(process.env.BOOTSTRAP_READY !== 'yes') process.exit(9); appendFileSync(process.env.FIXTURE_TRACE, '${label}\\n'); console.log(${JSON.stringify(context)});`
          : `test "$BOOTSTRAP_READY" = yes || exit 9\nprintf '${label}\\n' >> "$FIXTURE_TRACE"\nprintf '%s\\n' '${context}'\n`,
      );
    }
    const result = spawnSync("bash", [join(source, "scripts", "claude-session-start.sh")], {
      encoding: "utf8",
      input: '{"hook_event_name":"SessionStart"}',
      env: { ...process.env, HOME: home, CLAUDE_CODE_REMOTE: "true", CLAUDE_PROJECT_DIR: source, FIXTURE_TRACE: trace },
    });
    return { result, trace };
  }
  it("passes the bootstrap environment to dependents, runs them in order and emits one JSON envelope", () => {
    const { result, trace } = fixture();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(trace, "utf8").trim().split("\n")).toEqual([
      "bootstrap",
      "setup",
      "freshness",
      "issues",
      "policy",
      "organisation",
    ]);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    expect(context).toBe("setup\n\nfreshness\n\nissues\n\npolicy\n\norganisation");
  });
  it("keeps bootstrap failure nonfatal while skipping dependent setup", () => {
    const { result, trace } = fixture(true);
    expect(result.status).toBe(0);
    expect(readFileSync(trace, "utf8")).toBe("bootstrap\n");
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain("dependent setup was skipped");
  });
});
