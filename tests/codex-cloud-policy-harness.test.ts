import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bashCommand =
  process.platform === "win32"
    ? path.join(process.env.ProgramFiles || "C:\\Program Files", "Git/bin/bash.exe")
    : "/bin/bash";
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
      "export CODEX_CLOUD_ACCESS_PROFILE=connected\nexport RAG_PROVIDER_MODE=offline\n",
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
      `export CODEX_CLOUD_ACCESS_PROFILE=${cached}\nexport RAG_PROVIDER_MODE=offline\n`,
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
      `export CODEX_CLOUD_ACCESS_PROFILE=${cached}\nexport RAG_PROVIDER_MODE=offline\n`,
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
      `export CODEX_CLOUD_ACCESS_PROFILE="${profile}"\nexport RAG_PROVIDER_MODE="${rag}"\n`,
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
    expect(readFileSync(path.join(test.home, ".local/bin/node"), "utf8")).toContain('.clinical-kb-codex-cloud.sh"');
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
      "export CODEX_CLOUD_ACCESS_PROFILE=offline RAG_PROVIDER_MODE=offline\n",
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

  it.each(["unmanaged-policy", "atomic-write"] as const)(
    "preserves configuration and failure status without runtime diagnostics after %s failure",
    (failure) => {
      const test = fixture("mismatched");
      const config = failure === "unmanaged-policy" ? '[shell_environment_policy]\ninherit = "all"\n' : test.config;
      writeFileSync(test.configPath, config);
      const profilePath = path.join(test.home, ".clinical-kb-codex-cloud.sh");
      const originalProfile = "# existing selected profile\nexport CODEX_CLOUD_ACCESS_PROFILE=connected\n";
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
      const cache = path.join(test.home, ".cache/clinical-kb-codex");
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
});
