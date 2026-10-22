#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeInstalledTreeStamp, installedTreeParity } from "./check-installed-lock-parity.mjs";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 20_000, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function gitBash() {
  if (process.platform !== "win32") return "bash";
  const candidate = path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe");
  assert.ok(existsSync(candidate), "Native Windows smoke requires Git for Windows bash.exe; WSL is unsupported");
  return candidate;
}

/** Runs existing bootstrap code against tiny offline fixtures, never the checkout's dependency tree. */
export function runBootstrapSmoke() {
  const shell = gitBash();
  const npmHome = process.env.CLOUD_PLATFORM_NPM_HOME;
  if (npmHome !== undefined) {
    assert.ok(
      npmHome &&
        path.isAbsolute(npmHome) &&
        existsSync(path.join(npmHome, "npm", "node_modules", "npm", "bin", "npm-cli.js")),
      "CLOUD_PLATFORM_NPM_HOME must name an existing absolute home containing npm/node_modules/npm/bin/npm-cli.js",
    );
  }
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "psychsift-platform-"));
  const donor = path.join(temporaryRoot, "donor checkout");
  const target = path.join(temporaryRoot, "worktree's space");
  // Drop all Git repository/config selectors before any fixture or bootstrap child.
  const isolatedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
  );
  const emptyGitConfig = path.join(temporaryRoot, "empty.gitconfig");
  writeFileSync(emptyGitConfig, "");
  Object.assign(isolatedEnvironment, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyGitConfig });
  const shellEnvironment = {
    ...isolatedEnvironment,
    ...(npmHome !== undefined ? { APPDATA: npmHome } : {}),
    SMOKE_WORKTREE: target,
    SMOKE_NODE: process.execPath,
  };
  const shellScript = `set -euo pipefail
if [ -x /usr/bin/cygpath ]; then
  cd "$(/usr/bin/cygpath -u "$SMOKE_WORKTREE")"
  smoke_node=$(/usr/bin/cygpath -u "$SMOKE_NODE")
else
  cd "$SMOKE_WORKTREE"
  smoke_node=$SMOKE_NODE
fi
"$smoke_node" scripts/setup-codex-worktree.mjs "$@"`;
  const setup = (...args) =>
    run(shell, ["-c", shellScript, "cloud-platform-smoke", ...args], { env: shellEnvironment });
  const git = (cwd, ...args) => run("git", args, { cwd, env: isolatedEnvironment });
  try {
    if (process.platform === "win32") {
      assert.match(
        run(shell, ["-c", "/usr/bin/uname -s"]),
        /^(MINGW|MSYS|UCRT|CLANG).*_NT/u,
        "Expected native Git Bash, not WSL",
      );
    }
    mkdirSync(donor, { recursive: true });
    const scripts = [
      "setup-codex-worktree.mjs",
      "check-installed-lock-parity.mjs",
      "install-git-hooks.mjs",
      "lib/is-entrypoint.mjs",
    ];
    for (const script of scripts) {
      const destination = path.join(donor, "scripts", script);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(repositoryRoot, "scripts", script), destination);
    }
    const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
    writeFileSync(
      path.join(donor, "package.json"),
      JSON.stringify({ type: "module", engines: manifest.engines, packageManager: manifest.packageManager }),
    );
    cpSync(path.join(repositoryRoot, ".node-version"), path.join(donor, ".node-version"));
    const packages = { "": { name: "offline-platform-fixture" }, "node_modules/next": { version: "1.0.0" } };
    const lock = JSON.stringify({ lockfileVersion: 3, packages });
    writeFileSync(path.join(donor, "package-lock.json"), lock);
    mkdirSync(path.join(donor, ".githooks"));
    for (const hook of ["pre-commit", "pre-push"])
      writeFileSync(path.join(donor, ".githooks", hook), "#!/bin/sh\nexit 0\n");
    git(donor, "init", "--quiet");
    git(donor, "add", ".");
    git(
      donor,
      "-c",
      "user.name=Offline fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=.unused-hooks",
      "commit",
      "--quiet",
      "-m",
      "Synthetic platform fixture",
    );
    git(donor, "worktree", "add", "--quiet", "--detach", target);

    assert.match(setup("--dry-run"), /no complete byte-identical donor/u);
    assert.equal(existsSync(path.join(target, "node_modules")), false);
    mkdirSync(path.join(donor, "node_modules", "next"), { recursive: true });
    writeFileSync(path.join(donor, "node_modules", "next", "package.json"), JSON.stringify({ version: "1.0.0" }));
    writeFileSync(path.join(donor, "node_modules", "next", "fixture's file.d.ts"), "export {};\n");
    writeFileSync(path.join(donor, "node_modules", ".package-lock.json"), lock);
    writeInstalledTreeStamp(donor);
    assert.match(setup("--dry-run"), /would reuse byte-identical dependencies/u);
    assert.match(setup(), /PASS: worktree dependencies/u);
    assert.ok(installedTreeParity(target).ok, "Copied dependencies must pass the real installed-tree validator");
    assert.equal(
      readFileSync(path.join(target, "node_modules", "next", "fixture's file.d.ts"), "utf8"),
      "export {};\n",
    );
    assert.equal(git(target, "config", "--get", "core.hooksPath"), ".githooks");
    assert.match(setup(), /PASS: existing dependencies/u);
    writeFileSync(path.join(target, "package-lock.json"), lock.replace("1.0.0", "2.0.0"));
    assert.match(setup("--dry-run"), /no complete byte-identical donor/u);
    return {
      platform: process.platform,
      missingDependencies: true,
      donorCopied: true,
      hooksInstalled: true,
      existingInstall: true,
      mismatchedDonorRejected: true,
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    assert.ok(
      args.length === 0 || (args.length === 1 && args[0] === "--windows"),
      "Usage: node scripts/check-cloud-platform-smoke.mjs [--windows]",
    );
    if (args.includes("--windows"))
      assert.equal(process.platform, "win32", "Native Windows acceptance requires an actual Windows runner");
    const result = runBootstrapSmoke();
    console.log(
      `[cloud-platform-smoke] PASS: ${result.platform} bootstrap fixture (shell, paths, donor copy, hooks, mismatch refusal).`,
    );
    console.log(
      "[cloud-platform-smoke] Real host forwarding/browser preview: unavailable; this fixture is not platform proof.",
    );
  } catch (error) {
    console.error(`[cloud-platform-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
