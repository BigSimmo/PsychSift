import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
    run(extraEnvironment: Record<string, string> = {}) {
      // A minimal environment keeps inherited provider credentials and user
      // setup flags out of this isolated shell. Runtime shims precede system
      // utilities and log every invocation, including failure diagnostics.
      return spawnSync(bashCommand, ["scripts/setup-codex-cloud.sh"], {
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
    for (const profile of [".bashrc", ".profile", ".bash_profile"]) {
      expect(existsSync(path.join(test.home, profile))).toBe(false);
    }
  });

  it.each(["unmanaged-policy", "atomic-write"] as const)(
    "preserves configuration and failure status without runtime diagnostics after %s failure",
    (failure) => {
      const test = fixture("mismatched");
      const config = failure === "unmanaged-policy" ? '[shell_environment_policy]\ninherit = "all"\n' : test.config;
      writeFileSync(test.configPath, config);
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
      expect(readdirSync(path.dirname(test.configPath)).filter((name) => name.startsWith(".config.toml."))).toEqual([]);
    },
  );
});
