#!/usr/bin/env node
/**
 * Local design-sync prep: install gitignored `.ds-sync` toolchain deps, then
 * compile Tailwind into `.design-sync/.cache/compiled.css` via config.buildCmd.
 *
 * Full remote upload to claude.ai/design (`resync.mjs --remote`) lives outside
 * this repo (session skill). This script covers the friction that burned
 * ledger #110/#141 triage time: missing `.ds-sync` packages and a stale CSS
 * bundle. See `.design-sync/NOTES.md`.
 *
 * Supply-chain shape, stated plainly because nothing else in the repo pins it:
 *   - the registry install is opt-in (`--install`); without it the script only
 *     reuses an already-populated `.ds-sync` and prints the exact install command;
 *   - every package is installed at an exact version from DS_SYNC_PACKAGES. A
 *     package whose pin is still `null` is refused unless `--allow-unpinned` is
 *     passed, so "whatever the registry serves today" is never the silent default;
 *   - `config.buildCmd` is never handed to a shell. It is parsed into argv steps
 *     (see planBuildSteps) and the only redirection accepted is `cat <file> >> <file>`,
 *     performed by Node.
 *
 * Usage: node scripts/design-sync.mjs --install      # registry call, pinned versions
 *        node scripts/design-sync.mjs                # reuse .ds-sync, compile only
 *        node scripts/design-sync.mjs --dry-run
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dsSyncDir = path.join(projectRoot, ".ds-sync");
const cacheDir = path.join(projectRoot, ".design-sync", ".cache");
const configPath = path.join(projectRoot, ".design-sync", "config.json");

/**
 * Exact versions for the `.ds-sync` toolchain. esbuild and @types/react match the
 * repository lockfile; @tailwindcss/cli is released in lockstep with the `tailwindcss`
 * the repository already pins. `null` means "not yet pinned by an operator": the
 * install refuses that package unless `--allow-unpinned` is passed explicitly.
 */
export const DS_SYNC_PACKAGES = Object.freeze({
  esbuild: "0.28.2",
  "ts-morph": null,
  "@types/react": "19.3.0",
  "@tailwindcss/cli": "4.3.3",
  geist: null,
});

/**
 * `npm install` specifiers for the toolchain, or the reason the install must be refused.
 *
 * @param {Readonly<Record<string, string | null>>} [packages]
 * @param {{ allowUnpinned?: boolean }} [options]
 * @returns {{ error: string, specifiers?: undefined } | { error?: undefined, specifiers: string[] }}
 */
export function dsSyncInstallSpecifiers(packages = DS_SYNC_PACKAGES, { allowUnpinned = false } = {}) {
  const unpinned = Object.entries(packages)
    .filter(([, version]) => version === null)
    .map(([name]) => name);
  if (unpinned.length > 0 && !allowUnpinned) {
    return {
      error:
        `[design-sync] refusing to install unpinned package(s): ${unpinned.join(", ")}. ` +
        "Pin an exact version in DS_SYNC_PACKAGES (scripts/design-sync.mjs), or pass --allow-unpinned " +
        "to accept whatever the registry serves today.",
    };
  }
  return {
    specifiers: Object.entries(packages).map(([name, version]) => (version === null ? name : `${name}@${version}`)),
  };
}

export function dsSyncInstallCommand(specifiers) {
  return ["npm", "install", "--prefix", ".ds-sync", "--no-save", "--package-lock=false", ...specifiers];
}

const SHELL_METACHARACTERS = /[|;&<>$`"'\\()*?[\]{}~\n]/;

/**
 * Turn the committed `config.buildCmd` into steps that never touch a shell.
 * Accepted grammar: `<argv...>` segments joined by `&&`, where a segment of the form
 * `cat <source> >> <target>` becomes a Node append. Any other shell syntax is refused.
 *
 * @param {string} buildCmd
 * @returns {Array<{ kind: "spawn", argv: string[] } | { kind: "append", source: string, target: string }>}
 */
export function planBuildSteps(buildCmd) {
  const segments = String(buildCmd)
    .split("&&")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) throw new Error("buildCmd is empty");
  return segments.map((segment) => {
    const tokens = segment.split(/\s+/);
    if (tokens[0] === "cat" && tokens.length === 4 && tokens[2] === ">>") {
      const [, source, , target] = tokens;
      for (const token of [source, target]) {
        if (SHELL_METACHARACTERS.test(token)) throw new Error(`buildCmd path uses shell syntax: ${token}`);
      }
      return { kind: "append", source, target };
    }
    for (const token of tokens) {
      if (SHELL_METACHARACTERS.test(token)) {
        throw new Error(`buildCmd segment uses shell syntax, which is not run: ${segment}`);
      }
    }
    return { kind: "spawn", argv: tokens };
  });
}

function run(argv, options = {}) {
  const [command, ...args] = argv;
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runBuildSteps(steps) {
  for (const step of steps) {
    if (step.kind === "append") {
      const source = path.resolve(projectRoot, step.source);
      const target = path.resolve(projectRoot, step.target);
      if (!fs.existsSync(source)) {
        console.warn(`[design-sync] ${step.source} is absent; nothing appended.`);
        continue;
      }
      fs.appendFileSync(target, fs.readFileSync(source));
      continue;
    }
    run(step.argv);
  }
}

export function main(argv = process.argv.slice(2)) {
  const install = argv.includes("--install");
  const dryRun = argv.includes("--dry-run");
  const allowUnpinned = argv.includes("--allow-unpinned");

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage: node scripts/design-sync.mjs [options]

Compiles .design-sync/config.json buildCmd (Tailwind compile + font-vars append) using
the gitignored .ds-sync toolchain (${Object.keys(DS_SYNC_PACKAGES).join(", ")}).

  --install          contact the npm registry and install the toolchain at the exact
                     versions pinned in DS_SYNC_PACKAGES (off by default: no network)
  --allow-unpinned   with --install, accept packages whose pin is still null
  --dry-run          print the planned actions and exit without running them
  --help, -h         show this help and exit

Remote claude.ai/design upload (resync.mjs --remote) is a session skill outside
this repo — see .design-sync/NOTES.md.`);
    return 0;
  }

  if (!fs.existsSync(configPath)) {
    console.error(`Missing ${path.relative(projectRoot, configPath)}`);
    return 1;
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (typeof config.buildCmd !== "string" || !config.buildCmd.trim()) {
    console.error("`.design-sync/config.json` has no buildCmd");
    return 1;
  }
  const steps = planBuildSteps(config.buildCmd.trim());

  const installPlan = dsSyncInstallSpecifiers(DS_SYNC_PACKAGES, { allowUnpinned });
  if (install && installPlan.error) {
    console.error(installPlan.error);
    return 1;
  }
  const installCommand = installPlan.specifiers ? dsSyncInstallCommand(installPlan.specifiers) : null;

  if (dryRun) {
    console.log("[design-sync] --dry-run: would perform:");
    if (install) console.log(`[design-sync]   ${installCommand.join(" ")}`);
    else console.log("[design-sync]   (skip) registry install — pass --install to run it");
    for (const step of steps) {
      console.log(
        step.kind === "append"
          ? `[design-sync]   append ${step.source} >> ${step.target}`
          : `[design-sync]   ${step.argv.join(" ")}`,
      );
    }
    return 0;
  }

  fs.mkdirSync(dsSyncDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  if (install) {
    console.log("[design-sync] Installing .ds-sync toolchain (gitignored) at pinned versions…");
    // npm is a .cmd shim on Windows, which Node can only start through a shell; the
    // argument list is a constant here, so nothing operator- or config-controlled reaches it.
    run(installCommand, process.platform === "win32" ? { shell: true } : {});
  } else {
    console.log("[design-sync] Not contacting the npm registry (pass --install to populate .ds-sync).");
  }

  const twCli = path.join(dsSyncDir, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs");
  if (!fs.existsSync(twCli)) {
    const hint = installCommand ? installCommand.join(" ") : "resolve the unpinned packages first";
    console.error(`[design-sync] Missing ${path.relative(projectRoot, twCli)}. Run with --install, i.e. ${hint}`);
    return 1;
  }

  console.log("[design-sync] Compiling CSS via config.buildCmd…");
  runBuildSteps(steps);

  const compiledCss = path.join(cacheDir, "compiled.css");
  console.log(`[design-sync] Wrote ${path.relative(projectRoot, compiledCss)}`);
  console.log(
    "[design-sync] Local CSS bundle ready. Remote claude.ai/design upload still uses the session design-sync skill (`resync.mjs --remote`).",
  );
  console.log(
    "[design-sync] Accepted noise: [TOKENS_MISSING] for runtime-set tokens — see .design-sync/NOTES.md. Do not “fix” those.",
  );
  return 0;
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) process.exit(main());
