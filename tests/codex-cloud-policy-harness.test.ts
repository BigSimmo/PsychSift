import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
// Git's bin/bash.exe launcher prepends system tools ahead of fixture shims.
// Invoke the shell itself so the isolated PATH retains its requested order.
const bashCommand =
  process.platform === "win32"
    ? path.join(process.env.ProgramFiles || "C:\\Program Files", "Git/usr/bin/bash.exe")
    : "/bin/bash";
const shellToolsPath = process.platform === "win32" ? "/mingw64/bin:/usr/bin:/bin" : "/usr/bin:/bin";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function bashPath(value: string) {
  if (process.platform !== "win32") return value;
  return value.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/");
}

function currentDirectoryCacheKey(directory: string) {
  // This fixture's git returns $PWD. Query that physical shell identity
  // independently: Git Bash may mount the native temp directory at /tmp.
  const physical = spawnSync(bashCommand, ["--noprofile", "--norc", "-c", "pwd -P"], {
    cwd: directory,
    encoding: "utf8",
    env: { NODE_ENV: "test", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: shellToolsPath },
  });
  expect(physical.status, physical.stderr).toBe(0);
  expect(physical.stdout.trim()).not.toBe("");
  return createHash("sha256").update(physical.stdout.trim()).digest("hex");
}

function scopedProfile(contents: string) {
  return `# PsychSift checkout: ${bashPath(repoRoot)}\n${contents}`;
}

function fixture(runtime: "missing" | "mismatched") {
  const home = mkdtempSync(path.join(os.tmpdir(), "cloud-policy-harness-"));
  temporaryDirectories.push(home);
  const bin = path.join(home, "bin");
  const nvmDirectory = path.join(home, ".nvm");
  mkdirSync(bin);
  mkdirSync(nvmDirectory);
  mkdirSync(path.join(home, ".codex"));
  const runtimeCalls = path.join(home, "runtime-calls.log");
  for (const command of ["node", "npm"]) {
    const executable = path.join(bin, command);
    writeFileSync(
      executable,
      [
        "#!/bin/bash",
        `printf '%s\\n' '${command}' >> "$CLOUD_POLICY_RUNTIME_CALLS"`,
        runtime === "missing" ? "exit 127" : `printf '%s\\n' '${command === "node" ? "20.0.0" : "1.0.0"}'`,
        "",
      ].join("\n"),
    );
    chmodSync(executable, 0o755);
  }
  writeFileSync(
    path.join(nvmDirectory, "nvm.sh"),
    'printf "%s\\n" nvm >> "$CLOUD_POLICY_RUNTIME_CALLS"\nnvm() { return 97; }\n',
  );

  const configPath = path.join(home, ".codex/config.toml");
  const config = '[mcp_servers.preserved]\ncommand = "echo"\n';
  writeFileSync(configPath, config);
  return {
    home,
    config,
    configPath,
    runtimeCalls,
    run(
      extraEnvironment: Record<string, string | undefined> = {},
      explicitHarness = true,
      script = "scripts/setup-codex-cloud.sh",
    ) {
      // A minimal environment keeps inherited provider credentials and user
      // setup flags out of this isolated shell. Runtime shims precede system
      // utilities and log every invocation, including failure diagnostics.
      return spawnSync(bashCommand, [script, ...(explicitHarness ? ["--policy-only-test-harness"] : [])], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
          HOME: bashPath(home),
          NVM_DIR: bashPath(nvmDirectory),
          PATH: `${bashPath(bin)}:${process.platform === "win32" ? "/mingw64/bin:" : ""}/usr/bin:/bin`,
          CLOUD_POLICY_RUNTIME_CALLS: bashPath(runtimeCalls),
          CODEX_CLOUD_ACCESS_PROFILE: "offline",
          CODEX_CLOUD_SETUP_STOP_AFTER_POLICY: "1",
          ...extraEnvironment,
        },
      });
    },
  };
}

function legacyMaintenanceFixture() {
  const test = fixture("missing");
  const checkout = path.join(test.home, "legacy-checkout");
  const scripts = path.join(checkout, "scripts");
  mkdirSync(scripts, { recursive: true });
  for (const script of ["maintain-codex-cloud.sh", "check-codex-cloud-raw-env.sh"]) {
    copyFileSync(path.join(repoRoot, "scripts", script), path.join(scripts, script));
  }
  const migrationCalls = path.join(test.home, "migration-calls.log");
  writeFileSync(
    path.join(scripts, "setup-codex-cloud.sh"),
    'printf "%s|%s|%s|%s" "$CODEX_CLOUD_ACCESS_PROFILE" "${CODEX_CLOUD_EXPECTED_BASE_SHA+x}" "${CODEX_CLOUD_EXPECTED_BASE_SHA-}" "$RAG_PROVIDER_MODE" > "$CLOUD_POLICY_MIGRATION_CALLS"\n',
  );
  const fakeGit = path.join(test.home, "bin/git");
  writeFileSync(fakeGit, '#!/bin/bash\nprintf "%s\\n" "$CLOUD_POLICY_FIXTURE_CHECKOUT"\n');
  chmodSync(fakeGit, 0o755);
  const profilePath = path.join(test.home, ".clinical-kb-codex-cloud.sh");
  const legacyProfile = [
    "# Generated by scripts/setup-codex-cloud.sh. Re-running setup replaces this file.",
    'printf "%s\\n" legacy-profile-executed >> "$CLOUD_POLICY_RUNTIME_CALLS"',
    'export CODEX_CLOUD_ACCESS_PROFILE="connected"',
    "export RAG_PROVIDER_MODE=offline",
    "",
  ].join("\n");
  writeFileSync(profilePath, legacyProfile);
  return {
    ...test,
    scripts,
    profilePath,
    legacyProfile,
    migrationCalls,
    maintain(extraEnvironment: Record<string, string | undefined> = {}) {
      return test.run(
        {
          CLOUD_POLICY_FIXTURE_CHECKOUT: bashPath(checkout),
          CLOUD_POLICY_MIGRATION_CALLS: bashPath(migrationCalls),
          CODEX_CLOUD_ACCESS_PROFILE: undefined,
          CODEX_CLOUD_SETUP_STOP_AFTER_POLICY: "0",
          ...extraEnvironment,
        },
        false,
        path.join(scripts, "maintain-codex-cloud.sh"),
      );
    },
  };
}

describe("Codex Cloud policy-only harness runtime isolation", () => {
  it.each(["", "invalid-profile", "synthetic-invalid-profile-value"])(
    "rejects invalid explicit profile %j before ordinary bootstrap runtime work",
    (profile) => {
      const test = fixture("mismatched");
      const result = test.run({ CODEX_CLOUD_ACCESS_PROFILE: profile, CODEX_CLOUD_SETUP_STOP_AFTER_POLICY: "0" }, false);

      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain("Unsupported CODEX_CLOUD_ACCESS_PROFILE; expected offline or connected.");
      if (profile) expect(result.stderr).not.toContain(profile);
      expect(result.stderr).not.toContain("Running local diagnostics");
      expect(existsSync(test.runtimeCalls)).toBe(false);
      expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
      expect(existsSync(path.join(test.home, ".clinical-kb-codex-cloud.sh"))).toBe(false);
    },
  );

  it("rejects connected live retrieval selection before ordinary bootstrap runtime work", () => {
    const test = fixture("mismatched");
    const result = test.run(
      {
        CODEX_CLOUD_ACCESS_PROFILE: "connected",
        RAG_PROVIDER_MODE: "live",
        CODEX_CLOUD_SETUP_STOP_AFTER_POLICY: "0",
      },
      false,
    );

    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toContain("must keep RAG_PROVIDER_MODE=offline");
    expect(existsSync(test.runtimeCalls)).toBe(false);
    expect(existsSync(path.join(test.home, ".clinical-kb-codex-cloud.sh"))).toBe(false);
  });

  it.each([
    { CODEX_CLOUD_ACCESS_PROFILE: "" },
    { CODEX_CLOUD_ACCESS_PROFILE: "synthetic-invalid-maintenance-profile" },
    { CODEX_CLOUD_ACCESS_PROFILE: "connected", RAG_PROVIDER_MODE: "live" },
  ])("rejects inherited maintenance selectors before a cached profile can replace them: %j", (selectors) => {
    const test = fixture("missing");
    const profilePath = path.join(test.home, ".clinical-kb-codex-cloud.sh");
    const profile = [
      'printf "%s\\n" profile >> "$CLOUD_POLICY_RUNTIME_CALLS"',
      "export CODEX_CLOUD_ACCESS_PROFILE=offline",
      "export RAG_PROVIDER_MODE=offline",
      "",
    ].join("\n");
    writeFileSync(profilePath, profile);

    const result = test.run(selectors, false, "scripts/maintain-codex-cloud.sh");

    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toContain(
      selectors.RAG_PROVIDER_MODE !== undefined
        ? "RAG_PROVIDER_MODE=offline"
        : "Unsupported CODEX_CLOUD_ACCESS_PROFILE",
    );
    expect(result.stderr).not.toContain("synthetic-invalid-maintenance-profile");
    expect(existsSync(test.runtimeCalls)).toBe(false);
    expect(readFileSync(profilePath, "utf8")).toBe(profile);
    expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
  });

  it.each([
    { requested: "offline", cached: "offline", mode: "auto" },
    { requested: undefined, cached: "offline", mode: "auto" },
    { requested: undefined, cached: "offline", mode: "live" },
    { requested: "connected", cached: "connected", mode: "" },
    { requested: undefined, cached: "connected", mode: "" },
  ])("pins maintenance RAG mode offline before profile and runtime work: %j", ({ requested, cached, mode }) => {
    const test = fixture("missing");
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      [
        `# PsychSift checkout: ${bashPath(repoRoot)}`,
        '[[ "$RAG_PROVIDER_MODE" = offline ]] || exit 94',
        `export CODEX_CLOUD_ACCESS_PROFILE=${cached}`,
        "export RAG_PROVIDER_MODE=offline",
        "",
      ].join("\n"),
    );
    const node = path.join(test.home, "bin/node");
    writeFileSync(
      node,
      '#!/bin/bash\n[[ "$RAG_PROVIDER_MODE" = offline ]] || exit 93\nprintf "%s\\n" node >> "$CLOUD_POLICY_RUNTIME_CALLS"\nexit 127\n',
    );

    const result = test.run(
      { CODEX_CLOUD_ACCESS_PROFILE: requested, RAG_PROVIDER_MODE: mode },
      false,
      "scripts/maintain-codex-cloud.sh",
    );

    // Stop inside the synthetic Node stub before any repository helper executes.
    expect(result.status, result.stderr || result.stdout).toBe(127);
    expect(result.stderr).not.toContain("ERROR");
    expect(readFileSync(test.runtimeCalls, "utf8").trim()).toBe("node");
  });

  it("rejects inherited live RAG mode when the cached profile selects connected", () => {
    const test = fixture("missing");
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      scopedProfile("export CODEX_CLOUD_ACCESS_PROFILE=connected\nexport RAG_PROVIDER_MODE=offline\n"),
    );

    const result = test.run(
      { CODEX_CLOUD_ACCESS_PROFILE: undefined, RAG_PROVIDER_MODE: "live" },
      false,
      "scripts/maintain-codex-cloud.sh",
    );

    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toContain("must keep RAG_PROVIDER_MODE=offline");
    expect(existsSync(test.runtimeCalls)).toBe(false);
  });

  it.each(["offline", "connected"])("rejects a cached profile that replaces an explicit %s selection", (requested) => {
    const test = fixture("missing");
    const cached = requested === "offline" ? "connected" : "offline";
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      scopedProfile(`export CODEX_CLOUD_ACCESS_PROFILE=${cached}\nexport RAG_PROVIDER_MODE=offline\n`),
    );

    const result = test.run({ CODEX_CLOUD_ACCESS_PROFILE: requested }, false, "scripts/maintain-codex-cloud.sh");

    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toContain("differs from the requested profile");
    expect(existsSync(test.runtimeCalls)).toBe(false);
  });

  it.each(["offline", "connected"])("reuses a valid cached %s profile when no profile was inherited", (cached) => {
    const test = fixture("missing");
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      scopedProfile(`export CODEX_CLOUD_ACCESS_PROFILE=${cached}\nexport RAG_PROVIDER_MODE=offline\n`),
    );

    const result = test.run({ CODEX_CLOUD_ACCESS_PROFILE: undefined }, false, "scripts/maintain-codex-cloud.sh");

    // The isolated Node stub fails before any repository helper can execute.
    expect(result.status, result.stderr || result.stdout).toBe(127);
    expect(result.stderr).not.toContain("ERROR");
    expect(readFileSync(test.runtimeCalls, "utf8").trim()).toBe("node");
  });

  it.each([
    { profile: "", rag: "offline" },
    { profile: "invalid", rag: "offline" },
    { profile: "connected", rag: "live" },
  ])("rejects invalid cached maintenance selection %j before repository helpers", ({ profile, rag }) => {
    const test = fixture("missing");
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      scopedProfile(`export CODEX_CLOUD_ACCESS_PROFILE="${profile}"\nexport RAG_PROVIDER_MODE="${rag}"\n`),
    );

    const result = test.run({ CODEX_CLOUD_ACCESS_PROFILE: undefined }, false, "scripts/maintain-codex-cloud.sh");

    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toContain(
      profile === "connected" ? "RAG_PROVIDER_MODE=offline" : "Cached CODEX_CLOUD_ACCESS_PROFILE is invalid",
    );
    expect(existsSync(test.runtimeCalls)).toBe(false);
  });

  it.each(["scripts/setup-codex-cloud.sh", "scripts/maintain-codex-cloud.sh"])(
    "%s preserves raw-boundary failures before runtime/profile execution",
    (script) => {
      for (const [variable, status] of [
        ["SUPABASE_SERVICE_ROLE_KEY", 1],
        ["OPENAI_BASE_URL", 2],
      ] as const) {
        const test = fixture("missing");
        const profilePath = path.join(test.home, ".clinical-kb-codex-cloud.sh");
        const profile = 'printf "%s\\n" profile >> "$CLOUD_POLICY_RUNTIME_CALLS"\n';
        writeFileSync(profilePath, profile);
        const value = "synthetic-boundary-value-never-print";
        const result = test.run({ [variable]: value }, true, script);

        expect(result.status, result.stderr || result.stdout).toBe(status);
        expect(result.stderr).toContain(variable);
        expect(result.stdout + result.stderr).not.toContain(value);
        expect(result.stderr).not.toContain("Running local diagnostics");
        expect(existsSync(test.runtimeCalls)).toBe(false);
        expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
        expect(readFileSync(profilePath, "utf8")).toBe(profile);
      }
    },
  );

  it("blocks unexpected names before the direct shim installer can scrub them", () => {
    const test = fixture("missing");
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      'printf "%s\\n" profile >> "$CLOUD_POLICY_RUNTIME_CALLS"\nunset SUPABASE_SERVICE_ROLE_KEY\n',
    );

    const result = test.run(
      { SUPABASE_SERVICE_ROLE_KEY: "synthetic-shim-boundary-value" },
      false,
      "scripts/install-codex-cloud-command-shims.sh",
    );

    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(result.stderr).not.toContain("synthetic-shim-boundary-value");
    expect(existsSync(test.runtimeCalls)).toBe(false);
    expect(existsSync(path.join(test.home, ".local/bin/node"))).toBe(false);
  });

  it("retains the documented restricted shim path for the known launcher name", () => {
    const test = fixture("missing");
    const nodeBin = path.join(test.home, ".nvm/versions/node/v24.15.0/bin");
    mkdirSync(nodeBin, { recursive: true });
    for (const command of ["node", "npm", "npx"]) {
      const executable = path.join(nodeBin, command);
      writeFileSync(
        executable,
        command === "node" ? "#!/bin/bash\nprintf '%s\\n' '24.15.0'\n" : "#!/bin/bash\nprintf '%s\\n' '11.17.0'\n",
      );
      chmodSync(executable, 0o755);
    }
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      'export NVM_DIR="$HOME/.nvm"\nunset OPENAI_BASE_URL\nnvm() { printf "%s\\n" v24.15.0; }\n',
    );

    const result = test.run(
      { OPENAI_BASE_URL: "synthetic-known-launcher-value" },
      false,
      "scripts/install-codex-cloud-command-shims.sh",
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stderr).toContain("FAIL-KNOWN");
    expect(result.stderr).toContain("raw boundary remains failed");
    expect(result.stdout + result.stderr).not.toContain("synthetic-known-launcher-value");
    expect(existsSync(test.runtimeCalls)).toBe(false);
    expect(readFileSync(path.join(test.home, ".local/bin/node"), "utf8")).toContain(".clinical-kb-codex-cloud.sh'");
  });

  it("restores a missing maintenance profile before repository or runtime work", () => {
    const test = fixture("missing");
    const checkout = path.join(test.home, "checkout");
    const scripts = path.join(checkout, "scripts");
    mkdirSync(scripts, { recursive: true });
    for (const script of ["maintain-codex-cloud.sh", "check-codex-cloud-raw-env.sh"]) {
      copyFileSync(path.join(repoRoot, "scripts", script), path.join(scripts, script));
    }
    writeFileSync(path.join(scripts, "setup-codex-cloud.sh"), 'printf "%s\\n" fixture-setup\n');
    const git = path.join(test.home, "bin/git");
    writeFileSync(git, '#!/bin/bash\nprintf "%s\\n" "$CLOUD_POLICY_FIXTURE_CHECKOUT"\n');
    chmodSync(git, 0o755);

    const result = test.run(
      { CLOUD_POLICY_FIXTURE_CHECKOUT: bashPath(checkout) },
      false,
      path.join(scripts, "maintain-codex-cloud.sh"),
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("Generated runtime profile unavailable; rerunning full setup.");
    expect(result.stdout).toContain("fixture-setup");
    expect(existsSync(test.runtimeCalls)).toBe(false);
  });

  it("requires an explicit selection before migrating an unscoped legacy profile", () => {
    const test = legacyMaintenanceFixture();
    const result = test.maintain();
    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toContain("migration requires an explicit CODEX_CLOUD_ACCESS_PROFILE=offline or connected");
    expect(existsSync(test.migrationCalls)).toBe(false);
    expect(existsSync(test.runtimeCalls)).toBe(false);
    expect(readFileSync(test.profilePath, "utf8")).toBe(test.legacyProfile);
    expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
  });

  it.each([
    { profile: "offline", pin: "b".repeat(40) },
    { profile: "connected", pin: "" },
    { profile: "connected", pin: "invalid-explicit-pin" },
    { profile: "offline", pin: undefined },
  ])("migrates a selected legacy profile without loading it or replacing inherited pin %j", ({ profile, pin }) => {
    const test = legacyMaintenanceFixture();
    const result = test.maintain({ CODEX_CLOUD_ACCESS_PROFILE: profile, CODEX_CLOUD_EXPECTED_BASE_SHA: pin });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("Legacy runtime profile format; regenerating it.");
    expect(readFileSync(test.migrationCalls, "utf8")).toBe(
      `${profile}|${pin === undefined ? "" : "x"}|${pin ?? ""}|offline`,
    );
    expect(existsSync(test.runtimeCalls)).toBe(false);
    expect(readFileSync(test.profilePath, "utf8")).toBe(test.legacyProfile);
  });

  it.skipIf(process.platform === "win32").each(["symlink", "unmanaged"])(
    "refuses a %s legacy profile during migration without executing or overwriting it",
    (kind) => {
      const test = legacyMaintenanceFixture();
      const target = path.join(test.home, "host-profile.sh");
      if (kind === "symlink") {
        copyFileSync(test.profilePath, target);
        rmSync(test.profilePath);
        symlinkSync(target, test.profilePath);
      } else writeFileSync(test.profilePath, 'printf host-profile >> "$CLOUD_POLICY_RUNTIME_CALLS"\n');
      const before = readFileSync(test.profilePath, "utf8");
      copyFileSync(
        path.join(repoRoot, "scripts/setup-codex-cloud.sh"),
        path.join(test.scripts, "setup-codex-cloud.sh"),
      );
      const result = test.maintain({
        CODEX_CLOUD_ACCESS_PROFILE: "connected",
        CODEX_CLOUD_EXPECTED_BASE_SHA: "b".repeat(40),
      });
      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain(kind === "symlink" ? "regular managed file" : "runtime profile is unmanaged");
      expect(existsSync(test.runtimeCalls)).toBe(false);
      expect(readFileSync(test.profilePath, "utf8")).toBe(before);
      if (kind === "symlink") expect(readFileSync(target, "utf8")).toBe(before);
      expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
    },
  );

  it("repairs the toolchain when shim validation fails during maintenance", () => {
    const test = fixture("mismatched");
    const checkout = path.join(test.home, "checkout");
    const scripts = path.join(checkout, "scripts");
    mkdirSync(scripts, { recursive: true });
    for (const name of ["maintain-codex-cloud.sh", "check-codex-cloud-raw-env.sh"]) {
      copyFileSync(path.join(repoRoot, "scripts", name), path.join(scripts, name));
    }
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      `# PsychSift checkout: ${bashPath(checkout)}\nexport CODEX_CLOUD_ACCESS_PROFILE=offline RAG_PROVIDER_MODE=offline\n`,
    );
    writeFileSync(path.join(scripts, "refresh-codex-cloud-base.sh"), "exit 0\n");
    writeFileSync(path.join(scripts, "install-codex-cloud-command-shims.sh"), "exit 42\n");
    writeFileSync(path.join(scripts, "setup-codex-cloud.sh"), 'printf "%s\\n" fixture-setup\n');
    const git = path.join(test.home, "bin/git");
    writeFileSync(git, '#!/bin/bash\nprintf "%s\\n" "$CLOUD_POLICY_FIXTURE_CHECKOUT"\n');
    chmodSync(git, 0o755);

    const result = test.run(
      { CLOUD_POLICY_FIXTURE_CHECKOUT: bashPath(checkout) },
      false,
      path.join(scripts, "maintain-codex-cloud.sh"),
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("Shim validation failed; rerunning full setup.");
    expect(result.stdout).toContain("fixture-setup");
    expect(result.stdout).not.toContain("PASS: Cloud runtime");
    expect(readFileSync(test.runtimeCalls, "utf8").trim()).toBe("node");
  });

  it("reads a single-quoted generated shim target and proceeds past the shim-target check", () => {
    const test = fixture("mismatched");
    const checkout = path.join(test.home, "checkout");
    const scripts = path.join(checkout, "scripts");
    mkdirSync(scripts, { recursive: true });
    for (const name of ["maintain-codex-cloud.sh", "check-codex-cloud-raw-env.sh"]) {
      copyFileSync(path.join(repoRoot, "scripts", name), path.join(scripts, name));
    }
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      `# PsychSift checkout: ${bashPath(checkout)}\nexport CODEX_CLOUD_ACCESS_PROFILE=offline RAG_PROVIDER_MODE=offline\n`,
    );
    // The installer quotes the target with codex_cloud_shell_quote, including its '\\'' escape.
    const targetDirectory = path.join(test.home, "it's runtime");
    mkdirSync(targetDirectory);
    const target = path.join(targetDirectory, "node");
    writeFileSync(target, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(target, 0o755);
    const shimDirectory = path.join(test.home, ".local/bin");
    mkdirSync(shimDirectory, { recursive: true });
    writeFileSync(
      path.join(shimDirectory, "node"),
      [
        "#!/usr/bin/env bash",
        "# Generated by scripts/install-codex-cloud-command-shims.sh. Re-running setup",
        'exec "$fallback_command" "$@"',
        `exec '${bashPath(target).replaceAll("'", "'\\''")}' "$@"`,
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(scripts, "refresh-codex-cloud-base.sh"), "exit 0\n");
    writeFileSync(path.join(scripts, "install-codex-cloud-command-shims.sh"), "exit 42\n");
    writeFileSync(path.join(scripts, "setup-codex-cloud.sh"), 'printf "%s\\n" fixture-setup\n');
    const git = path.join(test.home, "bin/git");
    writeFileSync(git, '#!/bin/bash\nprintf "%s\\n" "$CLOUD_POLICY_FIXTURE_CHECKOUT"\n');
    chmodSync(git, 0o755);

    const result = test.run(
      { CLOUD_POLICY_FIXTURE_CHECKOUT: bashPath(checkout) },
      false,
      path.join(scripts, "maintain-codex-cloud.sh"),
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).not.toContain("Node/npm unavailable");
    expect(result.stdout).toContain("Shim validation failed; rerunning full setup.");
  });

  it("reads a legacy double-quoted shim target verbatim, without the single-quote unescape", () => {
    const test = fixture("mismatched");
    const checkout = path.join(test.home, "checkout");
    const scripts = path.join(checkout, "scripts");
    mkdirSync(scripts, { recursive: true });
    for (const name of ["maintain-codex-cloud.sh", "check-codex-cloud-raw-env.sh"]) {
      copyFileSync(path.join(repoRoot, "scripts", name), path.join(scripts, name));
    }
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      `# PsychSift checkout: ${bashPath(checkout)}\nexport CODEX_CLOUD_ACCESS_PROFILE=offline RAG_PROVIDER_MODE=offline\n`,
    );
    // Preserve the literal '\\'' sequence in the shim on every host. Windows
    // treats its backslash as a separator, so create that nested directory too.
    const targetSegment = "legacy'\\''runtime";
    const targetDirectory = path.join(test.home, targetSegment);
    mkdirSync(targetDirectory, { recursive: true });
    const target = path.join(targetDirectory, "node");
    const shellTarget = `${bashPath(test.home)}/${targetSegment}/node`;
    writeFileSync(target, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(target, 0o755);
    const shimDirectory = path.join(test.home, ".local/bin");
    mkdirSync(shimDirectory, { recursive: true });
    writeFileSync(
      path.join(shimDirectory, "node"),
      [
        "#!/usr/bin/env bash",
        "# Generated by scripts/install-codex-cloud-command-shims.sh. Re-running setup",
        `exec "${shellTarget}" "$@"`,
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(scripts, "refresh-codex-cloud-base.sh"), "exit 0\n");
    writeFileSync(path.join(scripts, "install-codex-cloud-command-shims.sh"), "exit 42\n");
    writeFileSync(path.join(scripts, "setup-codex-cloud.sh"), 'printf "%s\\n" fixture-setup\n');
    const git = path.join(test.home, "bin/git");
    writeFileSync(git, '#!/bin/bash\nprintf "%s\\n" "$CLOUD_POLICY_FIXTURE_CHECKOUT"\n');
    chmodSync(git, 0o755);

    const result = test.run(
      { CLOUD_POLICY_FIXTURE_CHECKOUT: bashPath(checkout) },
      false,
      path.join(scripts, "maintain-codex-cloud.sh"),
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).not.toContain("Node/npm unavailable");
    expect(result.stdout).toContain("Shim validation failed; rerunning full setup.");
  });

  it("reruns setup before any Node call when a generated shim target is missing", () => {
    const test = fixture("mismatched");
    const checkout = path.join(test.home, "checkout");
    const scripts = path.join(checkout, "scripts");
    mkdirSync(scripts, { recursive: true });
    for (const name of ["maintain-codex-cloud.sh", "check-codex-cloud-raw-env.sh"]) {
      copyFileSync(path.join(repoRoot, "scripts", name), path.join(scripts, name));
    }
    const shimDirectory = path.join(test.home, ".local/bin");
    mkdirSync(shimDirectory, { recursive: true });
    const nodeShim = path.join(shimDirectory, "node");
    writeFileSync(
      nodeShim,
      [
        "#!/usr/bin/env bash",
        "# Generated by scripts/install-codex-cloud-command-shims.sh. Re-running setup",
        "# or maintenance replaces this wrapper through the same idempotent command.",
        `exec "${bashPath(path.join(test.home, "removed-node/bin/node"))}" "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(nodeShim, 0o755);
    writeFileSync(
      path.join(test.home, ".clinical-kb-codex-cloud.sh"),
      `# PsychSift checkout: ${bashPath(checkout)}\nexport CODEX_CLOUD_ACCESS_PROFILE=offline RAG_PROVIDER_MODE=offline\nexport PATH="$HOME/.local/bin:$PATH"\n`,
    );
    writeFileSync(path.join(scripts, "setup-codex-cloud.sh"), 'printf "%s\\n" fixture-setup\n');
    const git = path.join(test.home, "bin/git");
    writeFileSync(git, '#!/bin/bash\nprintf "%s\\n" "$CLOUD_POLICY_FIXTURE_CHECKOUT"\n');
    chmodSync(git, 0o755);

    const result = test.run(
      { CLOUD_POLICY_FIXTURE_CHECKOUT: bashPath(checkout) },
      false,
      path.join(scripts, "maintain-codex-cloud.sh"),
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("Node/npm unavailable; rerunning full setup.");
    expect(result.stdout).toContain("fixture-setup");
    expect(result.stdout).not.toContain("PASS: Cloud runtime");
    expect(existsSync(test.runtimeCalls)).toBe(false);
  });

  it.each(["inherited-flag", "ordinary-runtime"] as const)("rejects a policy-only shortcut in %s setup", (scenario) => {
    const test = fixture("missing");
    const result = scenario === "inherited-flag" ? test.run({}, false) : test.run({ NODE_ENV: "production" });
    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toContain("requires --policy-only-test-harness in NODE_ENV=test");
    expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
    expect(existsSync(test.runtimeCalls)).toBe(false);
    expect(existsSync(path.join(test.home, ".clinical-kb-codex-cloud.sh"))).toBe(false);
  });

  it.each(["missing", "mismatched"] as const)("writes policy without probing or installing a %s runtime", (runtime) => {
    const test = fixture(runtime);
    const result = test.run();

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("Stopping after shell-policy write (test harness).");
    expect(existsSync(test.runtimeCalls)).toBe(false);
    const config = readFileSync(test.configPath, "utf8");
    expect(config).toContain(test.config);
    expect(config).toContain("[shell_environment_policy]");
    expect(existsSync(path.join(test.home, ".clinical-kb-codex-cloud.sh"))).toBe(true);
    // Setup now puts the Cloud profile at the top of each shell profile before the harness stops,
    // so a non-interactive early return cannot skip it. That is shell configuration only: the
    // runtime-call log above still proves no runtime was probed or installed.
    for (const profile of [".bashrc", ".profile", ".bash_profile"]) {
      const contents = readFileSync(path.join(test.home, profile), "utf8");
      expect(contents.startsWith("# PsychSift Codex Cloud runtime\n")).toBe(true);
      expect(contents).toContain('. "$HOME/.clinical-kb-codex-cloud.sh"');
    }
  });

  it("writes and repairs only the active CODEX_HOME configuration", () => {
    const test = fixture("missing");
    const configHome = path.join(test.home, "chosen-codex-home");
    mkdirSync(configHome);
    const activeConfig = path.join(configHome, "config.toml");
    writeFileSync(activeConfig, '[mcp_servers.active]\ncommand = "echo"\n');

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = test.run({ CODEX_HOME: bashPath(configHome) });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const contents = readFileSync(activeConfig, "utf8");
      expect(contents).toContain("[mcp_servers.active]");
      expect(contents.match(/^\[shell_environment_policy\]$/gm)).toHaveLength(1);
      expect(contents).toContain('"SUPABASE_URL"');
      expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
    }
    expect(existsSync(test.runtimeCalls)).toBe(false);
  });

  it.skipIf(process.platform === "win32").each(["directory", "symlink-to-directory"])(
    "rejects active config %s before runtime or profile writes",
    (destination) => {
      const test = fixture("missing");
      const configHome = path.join(test.home, "chosen-codex-home");
      const configPath = path.join(configHome, "config.toml");
      const externalDirectory = path.join(test.home, "external-directory");
      mkdirSync(configHome);
      mkdirSync(externalDirectory);
      if (destination === "directory") mkdirSync(configPath);
      else symlinkSync(externalDirectory, configPath);
      const result = test.run({ CODEX_HOME: bashPath(configHome) });
      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain("active Codex config destination");
      expect(readdirSync(configPath)).toEqual([]);
      expect(readdirSync(externalDirectory)).toEqual([]);
      expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
      expect(existsSync(path.join(test.home, ".clinical-kb-codex-cloud.sh"))).toBe(false);
      expect(existsSync(test.runtimeCalls)).toBe(false);
    },
  );

  it("leaves a fresh unrelated checkout shell unchanged and rejects retargeting its profile", () => {
    const test = fixture("missing");
    const result = test.run();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const otherCheckout = path.join(test.home, "other-checkout");
    mkdirSync(otherCheckout);
    expect(spawnSync("git", ["init", "--quiet", otherCheckout]).status).toBe(0);
    const loaded = spawnSync(
      bashCommand,
      [
        "--noprofile",
        "--norc",
        "-c",
        '. "$HOME/.profile"; printf "%s|%s|%s|%s" "$PATH" "${CODEX_CLOUD-unset}" "$SUPABASE_URL" "$HTTPS_PROXY"',
      ],
      {
        cwd: otherCheckout,
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          HOME: bashPath(test.home),
          PATH: shellToolsPath,
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          SUPABASE_URL: "synthetic-unrelated-environment",
          HTTPS_PROXY: "synthetic-proxy",
          CLOUD_POLICY_RUNTIME_CALLS: test.runtimeCalls,
        },
      },
    );
    expect(loaded.status, loaded.stderr).toBe(0);
    expect(loaded.stdout).toBe(`${shellToolsPath}|unset|synthetic-unrelated-environment|synthetic-proxy`);
    expect(existsSync(test.runtimeCalls)).toBe(false);

    const profilePath = path.join(test.home, ".clinical-kb-codex-cloud.sh");
    const profile = readFileSync(profilePath, "utf8");
    writeFileSync(
      profilePath,
      profile.replace(`# PsychSift checkout: ${bashPath(repoRoot)}`, "# PsychSift checkout: /another-checkout"),
    );
    for (const script of [
      "scripts/setup-codex-cloud.sh",
      "scripts/maintain-codex-cloud.sh",
      "scripts/install-codex-cloud-command-shims.sh",
    ]) {
      const rejected = test.run({}, script === "scripts/setup-codex-cloud.sh", script);
      expect(rejected.status, rejected.stderr || rejected.stdout).toBe(1);
      expect(rejected.stderr).toContain("another checkout");
      expect(existsSync(test.runtimeCalls)).toBe(false);
    }
  });

  it.each(["unmanaged-policy", "atomic-write"] as const)(
    "preserves configuration and failure status without runtime diagnostics after %s failure",
    (failure) => {
      const test = fixture("mismatched");
      const config = failure === "unmanaged-policy" ? '[shell_environment_policy]\ninherit = "all"\n' : test.config;
      writeFileSync(test.configPath, config);
      const profilePath = path.join(test.home, ".clinical-kb-codex-cloud.sh");
      // A managed profile: setup refuses to replace an unmanaged host-written one.
      const originalProfile =
        "# Generated by scripts/setup-codex-cloud.sh. Re-running setup replaces this file.\n# existing selected profile\nexport CODEX_CLOUD_ACCESS_PROFILE=connected\n";
      writeFileSync(profilePath, originalProfile);
      const result = test.run(failure === "atomic-write" ? { CODEX_CLOUD_SETUP_TEST_FAIL_ATOMIC_WRITE: "1" } : {});

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain("exit 1; policy-only test harness");
      expect(result.stderr).toContain("review the first error above");
      expect(result.stderr).not.toContain("Running local diagnostics");
      if (failure === "unmanaged-policy") {
        expect(result.stderr).toContain("Unmanaged [shell_environment_policy] table found");
      } else {
        expect(result.stdout).toContain("Forcing failure after writing the atomic candidate");
      }
      expect(existsSync(test.runtimeCalls)).toBe(false);
      expect(readFileSync(test.configPath, "utf8")).toBe(config);
      expect(readFileSync(profilePath, "utf8")).toBe(originalProfile);
      expect(readdirSync(test.home).filter((name) => name.startsWith(".clinical-kb-codex-cloud.sh."))).toEqual([]);
      expect(readdirSync(path.dirname(test.configPath)).filter((name) => name.startsWith(".config.toml."))).toEqual([]);
    },
  );

  it("writes exclusions to the selected CODEX_HOME without changing the default configuration", () => {
    const test = fixture("missing");
    const codexHome = path.join(test.home, "selected codex home");
    mkdirSync(codexHome);
    const selectedConfig = path.join(codexHome, "config.toml");
    writeFileSync(selectedConfig, test.config);

    const result = test.run({ CODEX_HOME: bashPath(codexHome) });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const contents = readFileSync(selectedConfig, "utf8");
    expect(contents).toContain(test.config);
    expect(contents).toContain("[shell_environment_policy]");
    expect(contents).toContain('"GH_TOKEN"');
    expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
    expect(existsSync(test.runtimeCalls)).toBe(false);
    const repeated = test.run({ CODEX_HOME: bashPath(codexHome) });
    expect(repeated.status, repeated.stderr || repeated.stdout).toBe(0);
    expect(readFileSync(selectedConfig, "utf8")).toBe(contents);
  });

  it.each(["config.toml", ".clinical-kb-codex-cloud.sh", ".bashrc"])(
    "rejects a directory at the %s file target before setup writes",
    (name) => {
      const test = fixture("missing");
      const target = name === "config.toml" ? test.configPath : path.join(test.home, name);
      rmSync(target, { force: true });
      mkdirSync(target);
      const result = test.run();

      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain("must be a regular file");
      expect(readdirSync(target)).toEqual([]);
      expect(existsSync(test.runtimeCalls)).toBe(false);
      if (name !== ".clinical-kb-codex-cloud.sh") {
        expect(existsSync(path.join(test.home, ".clinical-kb-codex-cloud.sh"))).toBe(false);
      }
    },
  );

  it.each(["", "relative-codex-home"])(
    "rejects an invalid CODEX_HOME before setup writes or runtime work: %j",
    (value) => {
      const test = fixture("missing");
      const result = test.run({ CODEX_CLOUD_SETUP_STOP_AFTER_POLICY: "0", CODEX_HOME: value }, false);

      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain("CODEX_HOME must be a nonempty absolute directory path");
      expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
      expect(existsSync(path.join(test.home, ".clinical-kb-codex-cloud.sh"))).toBe(false);
      expect(existsSync(test.runtimeCalls)).toBe(false);
    },
  );

  it("rejects a dangling CODEX_HOME symlink before setup writes or runtime work", () => {
    const test = fixture("missing");
    const danglingCodexHome = path.join(test.home, "dangling-codex-home");
    symlinkSync(path.join(test.home, "missing-codex-home"), danglingCodexHome);
    const result = test.run(
      { CODEX_CLOUD_SETUP_STOP_AFTER_POLICY: "0", CODEX_HOME: bashPath(danglingCodexHome) },
      false,
    );

    expect(result.status, result.stderr || result.stdout).toBe(1);
    expect(result.stderr).toContain("CODEX_HOME must identify a directory.");
    expect(readFileSync(test.configPath, "utf8")).toBe(test.config);
    expect(existsSync(path.join(test.home, ".clinical-kb-codex-cloud.sh"))).toBe(false);
    expect(existsSync(test.runtimeCalls)).toBe(false);
  });

  it.each(["reversed", "duplicate", "orphan-end"] as const)(
    "preserves unrelated configuration when managed policy markers are %s",
    (scenario) => {
      const test = fixture("missing");
      const begin = "# BEGIN clinical-kb-codex-cloud shell policy (managed by setup-codex-cloud.sh)";
      const end = "# END clinical-kb-codex-cloud shell policy (managed by setup-codex-cloud.sh)";
      const markers =
        scenario === "reversed" ? [end, begin] : scenario === "duplicate" ? [begin, end, begin, end] : [end];
      const config = `${markers.join("\n")}\n[mcp_servers.preserved]\ncommand = "echo"\n`;
      writeFileSync(test.configPath, config);

      const result = test.run();

      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain("invalid marker order");
      expect(readFileSync(test.configPath, "utf8")).toBe(config);
      expect(existsSync(test.runtimeCalls)).toBe(false);
    },
  );

  it.each(["a".repeat(40), "a".repeat(39), "G".repeat(40)])(
    "loads generated login profile with a POSIX shell and validates base %s",
    (base) => {
      const test = fixture("missing");
      const result = test.run();
      expect(result.status, result.stderr || result.stdout).toBe(0);
      rmSync(path.join(test.home, ".nvm/nvm.sh"));
      const checkoutKey = createHash("sha256").update(bashPath(repoRoot)).digest("hex");
      const cache = path.join(test.home, ".cache/clinical-kb-codex/checkouts", checkoutKey);
      mkdirSync(cache, { recursive: true });
      writeFileSync(path.join(cache, "cloud-expected-base-sha"), `${base}\n`);

      const loaded = spawnSync(
        bashCommand,
        [
          "--noprofile",
          "--norc",
          "-c",
          'exec sh -eu -c \'. "$HOME/.clinical-kb-codex-cloud.sh"; printf "%s" "${CODEX_CLOUD_EXPECTED_BASE_SHA:-unset}"\'',
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            NODE_ENV: "test",
            HOME: bashPath(test.home),
            PATH: process.platform === "win32" ? "/mingw64/bin:/usr/bin:/bin" : "/usr/bin:/bin",
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
          },
        },
      );

      expect(loaded.status, loaded.stderr).toBe(0);
      expect(loaded.stderr).toBe("");
      expect(loaded.stdout).toBe(base === "a".repeat(40) ? base : "unset");
    },
  );

  it.each(["b".repeat(40), "invalid-explicit-pin", ""])(
    "keeps explicit base pin %j instead of cached or old global state",
    (pin) => {
      const test = fixture("missing");
      expect(test.run().status).toBe(0);
      rmSync(path.join(test.home, ".nvm/nvm.sh"));
      const cache = path.join(test.home, ".cache/clinical-kb-codex");
      const checkoutKey = createHash("sha256").update(bashPath(repoRoot)).digest("hex");
      mkdirSync(path.join(cache, "checkouts", checkoutKey), { recursive: true });
      writeFileSync(path.join(cache, "checkouts", checkoutKey, "cloud-expected-base-sha"), `${"a".repeat(40)}\n`);
      writeFileSync(path.join(cache, "cloud-expected-base-sha"), `${"c".repeat(40)}\n`);
      const loaded = spawnSync(
        bashCommand,
        [
          "--noprofile",
          "--norc",
          "-c",
          '. "$HOME/.clinical-kb-codex-cloud.sh"; printf "%s" "$CODEX_CLOUD_EXPECTED_BASE_SHA"',
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            NODE_ENV: "test",
            HOME: bashPath(test.home),
            PATH: shellToolsPath,
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            CODEX_CLOUD_EXPECTED_BASE_SHA: pin,
          },
        },
      );
      expect(loaded.status, loaded.stderr).toBe(0);
      expect(loaded.stdout).toBe(pin);
    },
  );

  it("refreshes independent checkout base caches in one home without changing the historical global cache", () => {
    const test = fixture("missing");
    const cache = path.join(test.home, ".cache/clinical-kb-codex");
    mkdirSync(cache, { recursive: true });
    writeFileSync(path.join(cache, "cloud-expected-base-sha"), `${"c".repeat(40)}\n`);
    const fakeGit = path.join(test.home, "bin/git");
    writeFileSync(
      fakeGit,
      [
        "#!/bin/bash",
        'case "$1" in',
        'rev-parse) printf "%s\\n" "$PWD" ;;',
        "fetch) exit 0 ;;", // This synthetic fixture never contacts a remote.
        'merge-base) printf "%s\\n" "$CLOUD_POLICY_BASE" ;;',
        "*) exit 91 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(fakeGit, 0o755);
    for (const [index, base] of ["a".repeat(40), "b".repeat(40)].entries()) {
      const checkout = path.join(test.home, `checkout-${index}`);
      mkdirSync(path.join(checkout, "scripts/lib"), { recursive: true });
      copyFileSync(
        path.join(repoRoot, "scripts/refresh-codex-cloud-base.sh"),
        path.join(checkout, "scripts/refresh-codex-cloud-base.sh"),
      );
      copyFileSync(
        path.join(repoRoot, "scripts/lib/codex-cloud-paths.sh"),
        path.join(checkout, "scripts/lib/codex-cloud-paths.sh"),
      );
      const result = spawnSync(bashCommand, ["scripts/refresh-codex-cloud-base.sh"], {
        cwd: checkout,
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          HOME: bashPath(test.home),
          PATH: `${bashPath(path.join(test.home, "bin"))}:${shellToolsPath}`,
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          CLOUD_POLICY_BASE: base,
        },
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const key = currentDirectoryCacheKey(checkout);
      expect(readFileSync(path.join(cache, "checkouts", key, "cloud-expected-base-sha"), "utf8")).toBe(`${base}\n`);
    }
    expect(readdirSync(path.join(cache, "checkouts"))).toHaveLength(2);
    expect(readFileSync(path.join(cache, "cloud-expected-base-sha"), "utf8")).toBe(`${"c".repeat(40)}\n`);
    expect(existsSync(test.runtimeCalls)).toBe(false);
  });

  it("audits bounded managed artifacts without changing files or running a runtime", () => {
    const test = fixture("missing");
    expect(test.run().status).toBe(0);
    const artifacts = [".clinical-kb-codex-cloud.sh", ".bashrc", ".profile", ".bash_profile", ".codex/config.toml"];
    const before = artifacts.map((artifact) => readFileSync(path.join(test.home, artifact), "utf8"));
    const result = test.run(
      { SUPABASE_SERVICE_ROLE_KEY: "synthetic-must-not-print" },
      false,
      "scripts/audit-codex-cloud-artifacts.sh",
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("DRY-RUN only");
    expect(result.stdout).toContain("managed-marker-review sha256=");
    expect(result.stdout).toContain("No files changed");
    expect(result.stdout).not.toContain("synthetic-must-not-print");
    expect(artifacts.map((artifact) => readFileSync(path.join(test.home, artifact), "utf8"))).toEqual(before);
    expect(existsSync(test.runtimeCalls)).toBe(false);
  });

  it.each([undefined, "c".repeat(40)])(
    "maintenance reloads its own refreshed cache while preserving inherited pin %j",
    (pin) => {
      const test = fixture("missing");
      const checkout = path.join(test.home, "selected-checkout");
      mkdirSync(path.join(checkout, "scripts/lib"), { recursive: true });
      for (const file of [
        ".node-version",
        "package.json",
        "scripts/setup-codex-cloud.sh",
        "scripts/maintain-codex-cloud.sh",
        "scripts/check-codex-cloud-raw-env.sh",
        "scripts/lib/codex-cloud-paths.sh",
      ]) {
        copyFileSync(path.join(repoRoot, file), path.join(checkout, file));
      }
      const fakeGit = path.join(test.home, "bin/git");
      writeFileSync(fakeGit, '#!/bin/bash\nprintf "%s\\n" "$CLOUD_POLICY_FIXTURE_CHECKOUT"\n');
      chmodSync(fakeGit, 0o755);
      const environment = { CLOUD_POLICY_FIXTURE_CHECKOUT: bashPath(checkout), CODEX_CLOUD_EXPECTED_BASE_SHA: pin };
      const setup = test.run(environment, true, path.join(checkout, "scripts/setup-codex-cloud.sh"));
      expect(setup.status, setup.stderr || setup.stdout).toBe(0);
      rmSync(path.join(test.home, ".nvm/nvm.sh"));
      const key = createHash("sha256").update(bashPath(checkout)).digest("hex");
      const cache = path.join(test.home, ".cache/clinical-kb-codex/checkouts", key, "cloud-expected-base-sha");
      mkdirSync(path.dirname(cache), { recursive: true });
      writeFileSync(cache, `${"a".repeat(40)}\n`);
      writeFileSync(
        path.join(checkout, "scripts/refresh-codex-cloud-base.sh"),
        `printf '%s\\n' '${"b".repeat(40)}' > '${bashPath(cache)}'\n`,
      );
      writeFileSync(path.join(checkout, "scripts/install-codex-cloud-command-shims.sh"), "exit 0\n");
      for (const command of ["node", "npm"]) {
        const executable = path.join(test.home, "bin", command);
        writeFileSync(
          executable,
          `#!/bin/bash\nprintf '${command}:%s\\n' "$CODEX_CLOUD_EXPECTED_BASE_SHA" >> "$CLOUD_POLICY_RUNTIME_CALLS"\n`,
        );
        chmodSync(executable, 0o755);
      }
      const maintained = test.run(environment, false, path.join(checkout, "scripts/maintain-codex-cloud.sh"));
      expect(maintained.status, maintained.stderr || maintained.stdout).toBe(0);
      expect(readFileSync(test.runtimeCalls, "utf8").trim().split("\n")).toEqual([
        `node:${pin ?? "a".repeat(40)}`,
        `npm:${pin ?? "b".repeat(40)}`,
        `npm:${pin ?? "b".repeat(40)}`,
      ]);
    },
  );
  it.each([undefined, "c".repeat(40)])(
    "full setup refreshes a warm base cache and preserves inherited pin %j",
    (pin) => {
      const test = fixture("missing");
      const checkout = path.join(test.home, "setup-checkout");
      mkdirSync(path.join(checkout, "scripts/lib"), { recursive: true });
      for (const file of [
        ".node-version",
        "package.json",
        "scripts/check-codex-cloud-raw-env.sh",
        "scripts/lib/codex-cloud-paths.sh",
      ]) {
        copyFileSync(path.join(repoRoot, file), path.join(checkout, file));
      }
      // Exercise actual setup through its second profile load, stopping before
      // Deno/system/Python provisioning. Every executable dependency is synthetic.
      const setupSource = readFileSync(path.join(repoRoot, "scripts/setup-codex-cloud.sh"), "utf8");
      writeFileSync(
        path.join(checkout, "scripts/setup-codex-cloud.sh"),
        setupSource.replace(
          'setup_step="deno-runtime"',
          'printf "[setup-base-fixture] %s\\n" "$CODEX_CLOUD_EXPECTED_BASE_SHA"\nexit 0\nsetup_step="deno-runtime"',
        ),
      );
      const key = createHash("sha256").update(bashPath(checkout)).digest("hex");
      const cache = path.join(test.home, ".cache/clinical-kb-codex/checkouts", key, "cloud-expected-base-sha");
      mkdirSync(path.dirname(cache), { recursive: true });
      writeFileSync(cache, `${"a".repeat(40)}\n`);
      writeFileSync(
        path.join(checkout, "scripts/refresh-codex-cloud-base.sh"),
        `printf '%s\\n' '${"b".repeat(40)}' > '${bashPath(cache)}'\n`,
      );
      writeFileSync(path.join(checkout, "scripts/install-codex-cloud-command-shims.sh"), "exit 0\n");
      rmSync(path.join(test.home, ".nvm/nvm.sh"));
      const stubs: Record<string, string> = {
        git: 'printf "%s\\n" "$CLOUD_POLICY_FIXTURE_CHECKOUT"',
        node: 'if [[ "${1:-}" = -p ]]; then printf "%s\\n" 24.19.0; fi',
        codex: 'printf "%s\\n" 0.147.0',
        npx: 'if [[ "${1:-}" = --version ]]; then printf "%s\\n" 11.17.0; fi',
        npm: [
          'case "$1" in',
          '--version) printf "%s\\n" 11.17.0 ;;',
          'config) if [[ "$3" = package-lock ]]; then printf "%s\\n" true; else printf "%s\\n" false; fi ;;',
          'ci) printf "npm-ci:%s\\n" "$CODEX_CLOUD_EXPECTED_BASE_SHA" >> "$CLOUD_POLICY_RUNTIME_CALLS" ;;',
          "*) exit 92 ;;",
          "esac",
        ].join("\n"),
      };
      for (const [command, body] of Object.entries(stubs)) {
        const executable = path.join(test.home, "bin", command);
        writeFileSync(executable, `#!/bin/bash\n${body}\n`);
        chmodSync(executable, 0o755);
      }
      const result = test.run(
        {
          CLOUD_POLICY_FIXTURE_CHECKOUT: bashPath(checkout),
          CODEX_CLOUD_EXPECTED_BASE_SHA: pin,
          CODEX_CLOUD_SETUP_STOP_AFTER_POLICY: "0",
        },
        false,
        path.join(checkout, "scripts/setup-codex-cloud.sh"),
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(`[setup-base-fixture] ${pin ?? "b".repeat(40)}`);
      expect(readFileSync(test.runtimeCalls, "utf8").trim()).toBe(`npm-ci:${pin ?? "a".repeat(40)}`);
    },
  );
});
