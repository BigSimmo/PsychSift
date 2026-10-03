#!/usr/bin/env node
/**
 * Fail closed unless the pinned Chromium revision (from the installed
 * playwright-core package) has a launchable binary actually present on disk —
 * not merely a same-named directory, and not merely "no path is forced" (#312).
 *
 * Earlier versions of this check only inspected directory *names* under a
 * forced `/opt/pw-browsers` container root, and skipped the disk entirely
 * whenever no such root was forced — silently reporting `ok: true` even when
 * the managed cache (or an explicit `PLAYWRIGHT_BROWSERS_PATH`) had no
 * matching Chromium binary at all. That produced a false "OK" that was read
 * as a green light for `verify:ui` before two Playwright runs died at
 * preflight (docs/outstanding-issues.md #312, session 2026-08-12).
 *
 * This check now always resolves the effective browsers root — an explicit
 * `PLAYWRIGHT_BROWSERS_PATH` override if set, otherwise Playwright's own
 * default managed-cache directory — and verifies a real executable exists
 * for the pinned revision inside it, using the same executable layout table
 * Playwright itself ships (mirrored below; keep in sync with
 * `playwright-core`'s `EXECUTABLE_PATHS`).
 *
 * Local managed caches (`~/.cache/ms-playwright`) are fine. The trap is
 * PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
 * where a newer lock expects chromium-1234 but the image only ships 1194 —
 * pointing PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH at the stale shell is forbidden.
 */
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const DEFAULT_CONTAINER_ROOT = "/opt/pw-browsers";

// Mirrors playwright-core's `EXECUTABLE_PATHS["chromium-headless-shell"]`
// (installed under a `chromium_headless_shell-<revision>` directory — the
// binary the default headless chromium/chromium-mockups projects launch).
const CHROMIUM_HEADLESS_SHELL_EXECUTABLE_LAYOUTS = Object.freeze({
  linux: {
    x64: [["chrome-headless-shell-linux64", "chrome-headless-shell"]],
    arm64: [["chrome-linux", "headless_shell"]],
  },
  darwin: {
    x64: [["chrome-headless-shell-mac-x64", "chrome-headless-shell"]],
    arm64: [["chrome-headless-shell-mac-arm64", "chrome-headless-shell"]],
  },
  win32: [["chrome-headless-shell-win64", "chrome-headless-shell.exe"]],
});

function layoutsForPlatform(table, platform, architecture) {
  if (platform === "linux" || platform === "darwin") return table[platform]?.[architecture] ?? [];
  return table[platform] ?? [];
}

export function readExpectedChromiumRevision(projectRoot = process.cwd()) {
  const browsersJsonPath = path.join(projectRoot, "node_modules", "playwright-core", "browsers.json");
  if (!existsSync(browsersJsonPath)) {
    return { ok: false, reason: `playwright-core browsers.json missing at ${browsersJsonPath}` };
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(browsersJsonPath, "utf8"));
  } catch {
    return { ok: false, reason: `playwright-core browsers.json is malformed at ${browsersJsonPath}` };
  }
  const chromium = (payload.browsers ?? []).find((entry) => entry.name === "chromium");
  if (!chromium?.revision) {
    return { ok: false, reason: "playwright-core browsers.json has no chromium.revision" };
  }
  return { ok: true, revision: String(chromium.revision), browsersJsonPath };
}

/**
 * @param {string} [projectRoot]
 * @returns {{ ok: true, revisions: Record<string, string>, browsersJsonPath: string } | { ok: false, reason: string }}
 */
export function readExpectedBrowserRevisions(projectRoot = process.cwd()) {
  const browsersJsonPath = path.join(projectRoot, "node_modules", "playwright-core", "browsers.json");
  if (!existsSync(browsersJsonPath)) {
    return { ok: false, reason: `playwright-core browsers.json missing at ${browsersJsonPath}` };
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(browsersJsonPath, "utf8"));
  } catch {
    return { ok: false, reason: `playwright-core browsers.json is malformed at ${browsersJsonPath}` };
  }
  /** @type {Record<string, string>} */
  const revisions = {};
  const missing = [];
  for (const name of ["chromium", "firefox", "webkit"]) {
    const entry = (payload.browsers ?? []).find((b) => b.name === name);
    if (entry?.revision) {
      revisions[name] = String(entry.revision);
    } else {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `playwright-core browsers.json has no revision for: ${missing.join(", ")}`,
    };
  }
  return { ok: true, revisions, browsersJsonPath };
}

export function listInstalledChromiumRevisions(browsersRoot) {
  return listInstalledBrowserRevisions(browsersRoot, "chromium");
}

export function listInstalledBrowserRevisions(browsersRoot, browserName = "chromium") {
  if (!browsersRoot || !existsSync(browsersRoot)) return [];
  const revisions = new Set();
  const pattern =
    browserName === "chromium" ? /^(?:chromium|chromium_headless_shell)-(\d+)$/ : new RegExp(`^${browserName}-(\\d+)$`);
  for (const entry of readdirSync(browsersRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = pattern.exec(entry.name);
    if (match) revisions.add(match[1]);
  }
  return [...revisions].sort();
}

/**
 * Playwright's own default managed-cache directory when no
 * `PLAYWRIGHT_BROWSERS_PATH` override is set — mirrors
 * `playwright-core`'s `defaultRegistryDirectory` computation exactly
 * (Linux: `$XDG_CACHE_HOME || ~/.cache`; macOS: `~/Library/Caches`;
 * Windows: `%LOCALAPPDATA% || ~/AppData/Local`), each joined with
 * `ms-playwright`. Accepts `env`/`homeDirectory`/`platform` so tests never
 * depend on the real host's actual cache directory or files within it.
 */
export function resolveDefaultManagedBrowsersRoot(
  env = process.env,
  homeDirectory = os.homedir(),
  platform = process.platform,
) {
  if (platform === "linux") {
    return path.join(env.XDG_CACHE_HOME?.trim() || path.join(homeDirectory, ".cache"), "ms-playwright");
  }
  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Caches", "ms-playwright");
  }
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA?.trim() || path.join(homeDirectory, "AppData", "Local"), "ms-playwright");
  }
  return path.join(homeDirectory, ".cache", "ms-playwright");
}

/**
 * Resolve the cache root with the same special/relative-path semantics that
 * playwright-core uses. `PLAYWRIGHT_BROWSERS_PATH=0` opts into the installed
 * package's `.local-browsers`; relative overrides resolve from INIT_CWD (or
 * the invoking working directory), not from a literal directory named "0".
 */
export function resolvePlaywrightBrowsersRoot({
  env = process.env,
  defaultManagedBrowsersRoot = resolveDefaultManagedBrowsersRoot(env),
  playwrightCoreRoot,
  workingDirectory = process.cwd(),
} = {}) {
  const configured = env.PLAYWRIGHT_BROWSERS_PATH?.trim() ?? "";
  if (configured === "0") return path.join(playwrightCoreRoot, ".local-browsers");
  if (!configured) return defaultManagedBrowsersRoot;
  return path.isAbsolute(configured) ? configured : path.resolve(env.INIT_CWD?.trim() || workingDirectory, configured);
}

export function isLaunchableFile(filePath, platform = process.platform) {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (platform !== "win32" && process.platform !== "win32") {
      accessSync(filePath, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The real, load-bearing check this file exists for: does a launchable
 * headless-shell binary for `revision` actually exist under `browsersRoot`? A
 * same-named directory with no executable inside it (partial/corrupt
 * install) must not count — that was the residual gap even in the old
 * "container-aligned" path, which only checked directory names (#312).
 */
export function findInstalledChromiumBinary(
  browsersRoot,
  revision,
  { platform = process.platform, architecture = process.arch, fileIsLaunchable = isLaunchableFile } = {},
) {
  if (!browsersRoot || !revision) return null;
  const candidates = layoutsForPlatform(CHROMIUM_HEADLESS_SHELL_EXECUTABLE_LAYOUTS, platform, architecture).map(
    (layout) => ({
      dir: `chromium_headless_shell-${revision}`,
      layout,
    }),
  );
  for (const candidate of candidates) {
    const executable = path.join(browsersRoot, candidate.dir, ...candidate.layout);
    if (fileIsLaunchable(executable, platform)) return executable;
  }
  return null;
}

/**
 * @typedef {{
 *   expectedRevision: string,
 *   installedRevisions: string[],
 *   installed: boolean,
 * }} BrowserFamilySummary
 *
 * @typedef {{
 *   ok: boolean,
 *   status: string,
 *   message: string,
 *   expectedRevision?: string | null,
 *   installedRevisions?: string[],
 *   binaryPath?: string,
 *   allBrowsers?: Record<string, BrowserFamilySummary>,
 * }} PlaywrightRevisionCheckResult
 *
 * @param {{
 *   projectRoot?: string,
 *   env?: NodeJS.ProcessEnv,
 *   containerBrowsersRoot?: string,
 *   defaultManagedBrowsersRoot?: string,
 *   platform?: string,
 *   architecture?: string,
 *   workingDirectory?: string,
 * }} [options]
 * @returns {PlaywrightRevisionCheckResult}
 */
export function playwrightBrowserRevisionCheck(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const containerBrowsersRoot = options.containerBrowsersRoot ?? DEFAULT_CONTAINER_ROOT;
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;

  const expected = readExpectedChromiumRevision(projectRoot);
  if (!expected.ok) {
    return {
      ok: false,
      status: "missing-playwright-core",
      message: expected.reason,
      expectedRevision: null,
      installedRevisions: [],
    };
  }

  const exposedRoot = env.PLAYWRIGHT_BROWSERS_PATH?.trim().replace(/\/+$/, "") ?? "";
  const downloadsDisabled = /^(?:1|true)$/i.test(env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD?.trim() ?? "");
  const designatedContainer =
    exposedRoot.replaceAll("\\", "/") === containerBrowsersRoot.replaceAll("\\", "/") && downloadsDisabled;

  // Any PLAYWRIGHT_BROWSERS_PATH override — the designated download-disabled
  // container or any other forced path — points at the exact root Playwright
  // will actually launch from. With no override, fall back to Playwright's
  // own default managed-cache location so a plain, "unconstrained" run still
  // gets checked against real disk state instead of being trusted on version
  // metadata alone. This is the #312 fix: the previous version skipped this
  // check entirely whenever no container root was forced.
  const defaultManagedBrowsersRoot = options.defaultManagedBrowsersRoot ?? resolveDefaultManagedBrowsersRoot(env);
  const browsersRoot = resolvePlaywrightBrowsersRoot({
    env,
    defaultManagedBrowsersRoot,
    playwrightCoreRoot: path.dirname(expected.browsersJsonPath),
    workingDirectory: options.workingDirectory,
  });

  const installed = listInstalledChromiumRevisions(browsersRoot);
  const revisionDirectoryPresent = installed.includes(expected.revision);
  const binaryPath = findInstalledChromiumBinary(browsersRoot, expected.revision, {
    platform,
    architecture,
  });

  const allExpected = readExpectedBrowserRevisions(projectRoot);
  const allBrowsersSummary = {};
  if (allExpected.ok && allExpected.revisions) {
    for (const [name, rev] of Object.entries(allExpected.revisions)) {
      const inst = listInstalledBrowserRevisions(browsersRoot, name);
      allBrowsersSummary[name] = {
        expectedRevision: rev,
        installedRevisions: inst,
        installed: inst.includes(rev),
      };
    }
  }

  if (revisionDirectoryPresent && binaryPath) {
    return {
      ok: true,
      status: designatedContainer ? "container-aligned" : "installed",
      message: designatedContainer
        ? `Container browsers at ${exposedRoot} include a launchable chromium revision ${expected.revision} binary (${binaryPath}).`
        : `Chromium revision ${expected.revision} is installed and launchable at ${binaryPath}.`,
      expectedRevision: expected.revision,
      installedRevisions: installed,
      binaryPath,
      allBrowsers: allBrowsersSummary,
    };
  }

  if (designatedContainer) {
    return {
      ok: false,
      status: "container-revision-drift",
      message: [
        `Playwright browser revision drift (#255): lock/playwright-core expects chromium-${expected.revision},`,
        `but ${exposedRoot} only has: ${installed.length ? installed.map((r) => `chromium-${r}`).join(", ") : "(none)"}.`,
        "Do not set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a mismatched shell.",
        "Delegate browser proof to CI Production UI, or refresh the image / run `npx playwright install` into a matching cache,",
        "or unset PLAYWRIGHT_BROWSERS_PATH and PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD so the managed cache can be used.",
      ].join(" "),
      expectedRevision: expected.revision,
      installedRevisions: installed,
      allBrowsers: allBrowsersSummary,
    };
  }

  // Unconstrained / plain-managed-cache path: downloads are not disabled
  // here, so the actionable fix is normally `npx playwright install
  // chromium`, not a container image refresh (#312).
  const rootDescription = exposedRoot
    ? `${browsersRoot} (from PLAYWRIGHT_BROWSERS_PATH)`
    : `${browsersRoot} (Playwright's default managed cache)`;
  return {
    ok: false,
    status: revisionDirectoryPresent ? "binary-missing" : "not-installed",
    message: [
      revisionDirectoryPresent
        ? `Playwright expects chromium revision ${expected.revision}: a matching directory exists at ${rootDescription} but no launchable Chromium binary was found inside it (partial or corrupt install).`
        : `Playwright expects chromium revision ${expected.revision}, but no matching install was found at ${rootDescription}` +
          (installed.length
            ? ` (found instead: ${installed.map((r) => `chromium-${r}`).join(", ")}).`
            : " (no chromium revisions installed at all).") +
          "",
      "Run `npx playwright install chromium` to install the pinned revision, or point PLAYWRIGHT_BROWSERS_PATH at a cache that already has it.",
    ].join(" "),
    expectedRevision: expected.revision,
    installedRevisions: installed,
    allBrowsers: allBrowsersSummary,
  };
}

function parseArgs(args) {
  const options = { json: false, all: false, root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--all") {
      options.all = true;
      continue;
    }
    if (token === "--root") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--root requires a project directory.");
      options.root = path.resolve(value);
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      console.log("Usage: npm run check:playwright-browser-revision -- [--json] [--all] [--root directory]");
      process.exit(0);
    }
    throw new Error(`Unknown option: ${token}`);
  }
  return options;
}

function isDirectRun() {
  return isDirectEntrypoint(import.meta.url);
}

if (isDirectRun()) {
  const options = parseArgs(process.argv.slice(2));
  const result = playwrightBrowserRevisionCheck({ projectRoot: options.root });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`Playwright browser revision check OK (${result.status}): ${result.message}`);
    if (options.all && result.allBrowsers) {
      console.log("Browser family status:");
      for (const [name, summary] of Object.entries(result.allBrowsers)) {
        console.log(
          `  - ${name}: expected ${summary.expectedRevision}, installed: [${summary.installedRevisions.join(", ")}] (${summary.installed ? "present" : "missing"})`,
        );
      }
    }
  } else {
    console.error(`Playwright browser revision check FAILED (${result.status}): ${result.message}`);
    if (options.all && result.allBrowsers) {
      console.error("Browser family status:");
      for (const [name, summary] of Object.entries(result.allBrowsers)) {
        console.error(
          `  - ${name}: expected ${summary.expectedRevision}, installed: [${summary.installedRevisions.join(", ")}] (${summary.installed ? "present" : "missing"})`,
        );
      }
    }
  }
  process.exit(result.ok ? 0 : 1);
}
