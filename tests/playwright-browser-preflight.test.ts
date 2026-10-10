import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultChromiumHeadlessShellPath,
  newestPreinstalledChromiumHeadlessShell,
  playwrightBrowserPreflight,
  playwrightProjectNames,
  requestedPlaywrightBrowserProjects,
  resolvePlaywrightBrowserExecutable,
} from "../scripts/playwright-browser-preflight.mjs";

describe("playwright browser preflight", () => {
  it("defaults to every configured project when no project is requested", () => {
    const configuredProjects = [
      playwrightProjectNames.chromium,
      playwrightProjectNames.chromiumMockups,
      playwrightProjectNames.firefox,
      playwrightProjectNames.webkit,
      playwrightProjectNames.mobileWebkit,
      playwrightProjectNames.mobilePwaStandalone,
      playwrightProjectNames.tablet,
    ];
    expect(requestedPlaywrightBrowserProjects([])).toEqual(configuredProjects);
    expect(requestedPlaywrightBrowserProjects(["tests/ui-smoke.spec.ts"])).toEqual(configuredProjects);
  });

  it("uses the selected config's projects when no project flag is present", () => {
    expect(requestedPlaywrightBrowserProjects(["--config=playwright.visual.config.ts"])).toEqual([
      playwrightProjectNames.chromiumArtifacts,
    ]);
    expect(requestedPlaywrightBrowserProjects(["--config", "playwright.visual.config.ts"])).toEqual([
      playwrightProjectNames.chromiumArtifacts,
    ]);
  });

  it("fails closed for an unmapped config without explicit projects", () => {
    const result = playwrightBrowserPreflight(["--config=future.config.ts"]);
    expect(result.ok).toBe(false);
    expect(result.missing?.[0]?.source).toContain("unmapped Playwright project config:future.config.ts");
  });

  it("collects explicit --project flags", () => {
    expect(requestedPlaywrightBrowserProjects(["--project=firefox", "--project", "webkit"])).toEqual([
      "firefox",
      "webkit",
    ]);
  });

  it("maps the mobile Safari projects to the shared WebKit browser", () => {
    const result = playwrightBrowserPreflight(["--project=mobile-webkit", "--project=mobile-pwa-standalone"]);

    expect(result.projects).toEqual([playwrightProjectNames.mobileWebkit, playwrightProjectNames.mobilePwaStandalone]);
    expect(result.checked).toHaveLength(1);
    expect(result.checked[0]?.family).toBe("webkit");
    expect(
      result.missing?.some((entry: { source: string }) => entry.source.startsWith("unmapped Playwright project")),
    ).not.toBe(true);
  });

  it("derives the headless-shell binary Playwright launches by default", () => {
    expect(
      defaultChromiumHeadlessShellPath(
        "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
      )?.replaceAll("\\", "/"),
    ).toBe(
      "/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
    );
    expect(
      defaultChromiumHeadlessShellPath(
        "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux/chrome",
      )?.replaceAll("\\", "/"),
    ).toBe("/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1234/chrome-linux/headless_shell");
    expect(
      defaultChromiumHeadlessShellPath(
        "/Users/test/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
      )?.replaceAll("\\", "/"),
    ).toBe(
      "/Users/test/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    );
    expect(
      defaultChromiumHeadlessShellPath(
        "C:/Users/test/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
      )?.replaceAll("\\", "/"),
    ).toBe(
      "C:/Users/test/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
    );
    expect(defaultChromiumHeadlessShellPath("/opt/custom/chrome")).toBeNull();
  });

  it("honours PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH for Chromium projects", () => {
    const resolved = resolvePlaywrightBrowserExecutable("chromium", {
      NODE_ENV: "test",
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/tmp/custom-chrome",
    });
    expect(resolved).toEqual({
      family: "chromium",
      path: "/tmp/custom-chrome",
      source: "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
    });
  });

  it("selects the newest shell only for the designated download-disabled container root", () => {
    const root = mkdtempSync(join(tmpdir(), "pw-container-browsers-"));
    const older = join(root, "chromium_headless_shell-1194", "chrome-linux", "headless_shell");
    const newer = join(root, "chromium_headless_shell-1200", "chrome-linux", "headless_shell");
    try {
      mkdirSync(join(older, ".."), { recursive: true });
      mkdirSync(join(newer, ".."), { recursive: true });
      writeFileSync(older, "");
      writeFileSync(newer, "");

      expect(newestPreinstalledChromiumHeadlessShell(root, { platform: "linux", architecture: "x64" })).toBe(newer);

      const managedPath = join(root, "chromium_headless_shell-1234", "missing");
      expect(
        resolvePlaywrightBrowserExecutable(
          "chromium",
          {
            NODE_ENV: "test",
            PLAYWRIGHT_BROWSERS_PATH: root,
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
          },
          {
            managedChromiumPath: managedPath,
            platform: "linux",
            architecture: "x64",
            containerBrowsersRoot: root,
            revisionCheck: () => ({
              ok: true,
              status: "container-aligned",
              message: "aligned",
              expectedRevision: "1234",
              installedRevisions: ["1234"],
            }),
          },
        ),
      ).toMatchObject({
        family: "chromium",
        path: newer,
        source: "preinstalled container Chromium (PLAYWRIGHT_BROWSERS_PATH)",
        managedPath,
      });
      expect(
        resolvePlaywrightBrowserExecutable(
          "chromium",
          {
            NODE_ENV: "test",
            PLAYWRIGHT_BROWSERS_PATH: root,
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
          },
          { managedChromiumPath: managedPath, platform: "linux", architecture: "x64" },
        ),
      ).toEqual({
        family: "chromium",
        path: managedPath,
        source: "playwright chromium-headless-shell",
      });
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed on designated-container revision drift before accepting an override (#255)", () => {
    const root = mkdtempSync(join(tmpdir(), "pw-container-drift-"));
    const stale = join(root, "chromium_headless_shell-1194", "chrome-linux", "headless_shell");
    const driftMessage =
      "Playwright browser revision drift (#255): lock expects chromium-1234, but the container only has chromium-1194.";
    try {
      mkdirSync(join(stale, ".."), { recursive: true });
      writeFileSync(stale, "");
      const env = {
        NODE_ENV: "test" as const,
        PLAYWRIGHT_BROWSERS_PATH: root,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
        PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: stale,
      };
      const resolveOptions = {
        managedChromiumPath: join(root, "chromium_headless_shell-1234", "missing"),
        platform: "linux" as const,
        architecture: "x64" as const,
        containerBrowsersRoot: root,
        revisionCheck: () => ({
          ok: false,
          status: "container-revision-drift",
          message: driftMessage,
          expectedRevision: "1234",
          installedRevisions: ["1194"],
        }),
      };

      expect(resolvePlaywrightBrowserExecutable("chromium", env, resolveOptions)).toMatchObject({
        path: "",
        revisionDrift: true,
        source: "container Chromium revision drift (#255)",
        message: driftMessage,
      });

      const preflight = playwrightBrowserPreflight(["--project=chromium"], env, resolveOptions);
      expect(preflight.ok).toBe(false);
      expect(preflight.message).toBe(driftMessage);
      expect(preflight.missing?.[0]?.path).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not select an x64-only container shell on Linux arm64", () => {
    const root = mkdtempSync(join(tmpdir(), "pw-container-architectures-"));
    const x64Only = join(
      root,
      "chromium_headless_shell-1300",
      "chrome-headless-shell-linux64",
      "chrome-headless-shell",
    );
    const arm64Compatible = join(root, "chromium_headless_shell-1200", "chrome-linux", "headless_shell");
    try {
      mkdirSync(join(x64Only, ".."), { recursive: true });
      mkdirSync(join(arm64Compatible, ".."), { recursive: true });
      writeFileSync(x64Only, "");
      writeFileSync(arm64Compatible, "");

      expect(newestPreinstalledChromiumHeadlessShell(root, { platform: "linux", architecture: "x64" })).toBe(x64Only);
      expect(newestPreinstalledChromiumHeadlessShell(root, { platform: "linux", architecture: "arm64" })).toBe(
        arm64Compatible,
      );
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed when the required Chromium binary is missing", () => {
    const result = playwrightBrowserPreflight(["--project=chromium"], {
      NODE_ENV: "test",
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: `/tmp/missing-chrome-${Date.now()}`,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Playwright browser preflight failed before the production build");
    expect(result.message).toContain("Missing executable");
    expect(result.missing?.[0]?.family).toBe("chromium");
  });

  it("fails closed for a project missing from the shared project map", () => {
    const result = playwrightBrowserPreflight(["--project=future-browser"]);
    expect(result.ok).toBe(false);
    expect(result.missing?.[0]?.source).toContain("unmapped Playwright project future-browser");
  });

  it("passes when an override path exists", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = mkdtempSync(join(tmpdir(), "pw-preflight-"));
    const binary = join(directory, "chrome");
    try {
      writeFileSync(binary, "");
      const result = playwrightBrowserPreflight(["--project=chromium-mockups"], {
        NODE_ENV: "test",
        PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: binary,
      });
      expect(result.ok).toBe(true);
      expect(result.checked?.[0]?.path).toBe(binary);
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
