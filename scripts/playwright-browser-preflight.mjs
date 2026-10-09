#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { playwrightBrowserRevisionCheck } from "./check-playwright-browser-revision.mjs";

const BROWSER_TYPES = {
  chromium,
  firefox,
  webkit,
};

export const playwrightProjectNames = Object.freeze({
  chromium: "chromium",
  chromiumMockups: "chromium-mockups",
  chromiumArtifacts: "chromium-artifacts",
  firefox: "firefox",
  webkit: "webkit",
  mobileWebkit: "mobile-webkit",
  mobilePwaStandalone: "mobile-pwa-standalone",
  tablet: "tablet",
});

const DEFAULT_CONFIG_PROJECTS = Object.freeze({
  "playwright.config.ts": [
    playwrightProjectNames.chromium,
    playwrightProjectNames.chromiumMockups,
    playwrightProjectNames.firefox,
    playwrightProjectNames.webkit,
    playwrightProjectNames.mobileWebkit,
    playwrightProjectNames.mobilePwaStandalone,
    playwrightProjectNames.tablet,
  ],
  "playwright.visual.config.ts": [playwrightProjectNames.chromiumArtifacts],
});

const PROJECT_BROWSER_FAMILIES = Object.freeze({
  [playwrightProjectNames.chromium]: "chromium",
  [playwrightProjectNames.chromiumMockups]: "chromium",
  [playwrightProjectNames.chromiumArtifacts]: "chromium",
  [playwrightProjectNames.firefox]: "firefox",
  [playwrightProjectNames.webkit]: "webkit",
  [playwrightProjectNames.mobileWebkit]: "webkit",
  [playwrightProjectNames.mobilePwaStandalone]: "webkit",
  [playwrightProjectNames.tablet]: "webkit",
});

// Mirrors Playwright's chromium-headless-shell executable table for the
// platform directory exposed by chromium.executablePath(). Keep this explicit:
// Linux arm64 intentionally uses chrome-linux/headless_shell, unlike x64.
const CHROMIUM_HEADLESS_SHELL_LAYOUTS = Object.freeze({
  "chrome-linux64": ["chrome-headless-shell-linux64", "chrome-headless-shell"],
  "chrome-linux": ["chrome-linux", "headless_shell"],
  "chrome-mac-x64": ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
  "chrome-mac-arm64": ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
  "chrome-win64": ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
});

const PREINSTALLED_CHROMIUM_LAYOUTS = Object.freeze({
  linux: {
    x64: [
      ["chrome-headless-shell-linux64", "chrome-headless-shell"],
      ["chrome-linux", "headless_shell"],
    ],
    arm64: [["chrome-linux", "headless_shell"]],
  },
  darwin: {
    x64: [["chrome-headless-shell-mac-x64", "chrome-headless-shell"]],
    arm64: [["chrome-headless-shell-mac-arm64", "chrome-headless-shell"]],
  },
  win32: [["chrome-headless-shell-win64", "chrome-headless-shell.exe"]],
});

function preinstalledChromiumLayouts(platform = process.platform, architecture = process.arch) {
  if (platform === "linux" || platform === "darwin") {
    return PREINSTALLED_CHROMIUM_LAYOUTS[platform][architecture] ?? [];
  }
  return PREINSTALLED_CHROMIUM_LAYOUTS[platform] ?? [];
}

/**
 * Find the newest headless shell supplied by a download-disabled container.
 *
 * This is intentionally narrower than scanning every Playwright cache: a stale
 * developer cache must still fail closed. The caller separately validates the
 * designated immutable-container root before invoking this search.
 */
export function newestPreinstalledChromiumHeadlessShell(
  browsersRoot,
  {
    fileExists = existsSync,
    readDirectory = readdirSync,
    platform = process.platform,
    architecture = process.arch,
  } = {},
) {
  if (!browsersRoot) return null;
  let directories;
  try {
    directories = readDirectory(browsersRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const revisions = directories
    .filter((entry) => entry.isDirectory() && /^chromium_headless_shell-\d+$/.test(entry.name))
    .map((entry) => ({ name: entry.name, revision: Number(entry.name.slice("chromium_headless_shell-".length)) }))
    .sort((left, right) => right.revision - left.revision);
  const layouts = preinstalledChromiumLayouts(platform, architecture);
  for (const directory of revisions) {
    for (const layout of layouts) {
      const executable = path.join(browsersRoot, directory.name, ...layout);
      if (fileExists(executable)) return executable;
    }
  }
  return null;
}

/**
 * Derive the default headless-shell binary Playwright launches for Chromium
 * tests. `chromium.executablePath()` points at full Chrome for Testing; the
 * default headless project uses chrome-headless-shell instead.
 */
export function defaultChromiumHeadlessShellPath(chromeExecutablePath = chromium.executablePath()) {
  const normalized = chromeExecutablePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const chromiumIndex = segments.findLastIndex((segment) => /^chromium-\d+$/.test(segment));
  const chromiumDirectory = segments[chromiumIndex];
  const platformDirectory = segments[chromiumIndex + 1];
  const shellLayout = CHROMIUM_HEADLESS_SHELL_LAYOUTS[platformDirectory];
  if (chromiumIndex < 0 || !chromiumDirectory || !shellLayout) return null;
  const revision = chromiumDirectory.slice("chromium-".length);
  const browsersRoot = segments.slice(0, chromiumIndex).join("/");
  return path.join(browsersRoot, `chromium_headless_shell-${revision}`, ...shellLayout);
}

export function requestedPlaywrightBrowserProjects(args = []) {
  const projects = new Set();
  let configPath = "playwright.config.ts";
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--config" && args[index + 1]) {
      configPath = args[index + 1];
      index += 1;
      continue;
    }
    if (token.startsWith("--config=")) {
      configPath = token.slice("--config=".length);
      continue;
    }
    if (token === "--project" && args[index + 1]) {
      projects.add(args[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--project=")) projects.add(token.slice("--project=".length));
  }
  if (projects.size === 0) {
    const configName = path.basename(configPath);
    return DEFAULT_CONFIG_PROJECTS[configName] ?? [`config:${configPath}`];
  }
  return [...projects];
}

function browserFamilyForProject(project) {
  return PROJECT_BROWSER_FAMILIES[project] ?? null;
}

export function resolvePlaywrightBrowserExecutable(
  family,
  env = process.env,
  {
    managedChromiumPath = defaultChromiumHeadlessShellPath(),
    fileExists = existsSync,
    platform = process.platform,
    architecture = process.arch,
    containerBrowsersRoot = platform === "linux" ? "/opt/pw-browsers" : null,
    projectRoot = process.cwd(),
    revisionCheck = playwrightBrowserRevisionCheck,
  } = {},
) {
  if (family === "chromium") {
    const downloadsDisabled = /^(?:1|true)$/i.test(env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD?.trim() ?? "");
    const exposedBrowsersRoot = env.PLAYWRIGHT_BROWSERS_PATH?.trim();
    const normalizedExposedRoot = exposedBrowsersRoot?.replaceAll("\\", "/").replace(/\/+$/, "");
    const normalizedContainerRoot = containerBrowsersRoot?.replaceAll("\\", "/").replace(/\/+$/, "");
    const designatedContainerRoot =
      normalizedExposedRoot && normalizedContainerRoot && normalizedExposedRoot === normalizedContainerRoot;
    if (downloadsDisabled && designatedContainerRoot) {
      const revision = revisionCheck({ projectRoot, env, containerBrowsersRoot });
      if (!revision.ok) {
        return {
          family,
          path: "",
          source: "container Chromium revision drift (#255)",
          revisionDrift: true,
          message: revision.message,
          managedPath: managedChromiumPath,
        };
      }
    }

    const override = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
    if (override) {
      return {
        family,
        path: override,
        source: "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
      };
    }
    if (managedChromiumPath && fileExists(managedChromiumPath)) {
      return {
        family,
        path: managedChromiumPath,
        source: "playwright chromium-headless-shell",
      };
    }
    if (downloadsDisabled && designatedContainerRoot) {
      const preinstalled = newestPreinstalledChromiumHeadlessShell(exposedBrowsersRoot, {
        fileExists,
        platform,
        architecture,
      });
      if (preinstalled) {
        return {
          family,
          path: preinstalled,
          source: "preinstalled container Chromium (PLAYWRIGHT_BROWSERS_PATH)",
          managedPath: managedChromiumPath,
        };
      }
    }
    return {
      family,
      path: managedChromiumPath,
      source: "playwright chromium-headless-shell",
    };
  }
  return {
    family,
    path: BROWSER_TYPES[family].executablePath(),
    source: `playwright ${family}`,
  };
}

export function playwrightBrowserPreflight(args = [], env = process.env, resolveOptions = {}) {
  const projects = requestedPlaywrightBrowserProjects(args);
  const unsupportedProjects = projects.filter((project) => !browserFamilyForProject(project));
  const families = [...new Set(projects.map(browserFamilyForProject).filter(Boolean))];
  const missing = unsupportedProjects.map((project) => ({
    family: "unknown",
    path: "",
    source: `unmapped Playwright project ${project}`,
  }));
  const checked = [];
  for (const family of families) {
    const resolved = resolvePlaywrightBrowserExecutable(family, env, resolveOptions);
    checked.push(resolved);
    if (!resolved.path || !existsSync(resolved.path)) missing.push(resolved);
  }
  if (missing.length === 0) {
    return { ok: true, projects, checked };
  }
  const revisionDrift = missing.find((entry) => entry.revisionDrift);
  if (revisionDrift?.message) {
    return {
      ok: false,
      projects,
      missing,
      checked,
      message: revisionDrift.message,
    };
  }
  const details = missing.map((entry) => `- ${entry.family} (${entry.source}): ${entry.path}`).join("\n");
  return {
    ok: false,
    projects,
    missing,
    checked,
    message:
      `Playwright browser preflight failed before the production build.\n` +
      `Missing executable(s):\n${details}\n` +
      `Install matching browsers with \`npx playwright install\`, or set ` +
      `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a launchable Chromium binary. ` +
      `Do not treat a later "N failed" summary as a product regression when the browser binary is absent.`,
  };
}

export function assertPlaywrightBrowsersReady(args = [], env = process.env, { stderr = console.error } = {}) {
  const result = playwrightBrowserPreflight(args, env);
  if (result.ok) return result;
  stderr(result.message);
  process.exit(1);
}
