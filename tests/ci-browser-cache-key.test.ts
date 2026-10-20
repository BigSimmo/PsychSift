import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { browserCacheKey } from "../scripts/playwright-browser-cache-key.mjs";

const options = { engine: "chromium", runnerOS: "Linux", architecture: "X64", platform: "ubuntu-24.04" };
const metadata = () => ({
  browsers: ["chromium", "chromium-headless-shell", "firefox", "webkit", "ffmpeg", "winldd"].map((name, index) => ({
    name,
    revision: String(1000 + index),
    revisionOverrides: {} as Record<string, string>,
  })),
});

describe("Playwright archive cache identity", () => {
  it("ignores unrelated browser changes while covering Chromium's shell and video dependency", () => {
    const original = metadata();
    const key = browserCacheKey(original, options);
    for (const name of ["chromium", "chromium-headless-shell", "ffmpeg"]) {
      const changed = metadata();
      changed.browsers.find((entry) => entry.name === name)!.revision = "2000";
      expect(browserCacheKey(changed, options), name).not.toBe(key);
    }
    original.browsers.find((entry) => entry.name === "firefox")!.revision = "2000";
    expect(browserCacheKey(original, options)).toBe(key);
  });

  it("isolates engines, OS, architecture, distribution and platform revision overrides", () => {
    const original = metadata();
    const key = browserCacheKey(original, options);
    for (const changed of [
      { engine: "firefox" },
      { engine: "webkit" },
      { runnerOS: "Windows" },
      { architecture: "ARM64" },
      { platform: "ubuntu-22.04" },
    ]) {
      expect(browserCacheKey(original, { ...options, ...changed })).not.toBe(key);
    }
    original.browsers[0].revisionOverrides["ubuntu24.04-x64"] = "2000";
    expect(browserCacheKey(original, options)).not.toBe(key);
  });

  it("includes winldd for Windows and canonicalizes metadata ordering", () => {
    const original = metadata();
    const windows = { ...options, runnerOS: "Windows" };
    const key = browserCacheKey(original, windows);
    original.browsers.find((entry) => entry.name === "winldd")!.revision = "2000";
    expect(browserCacheKey(original, windows)).not.toBe(key);
    original.browsers[0].revisionOverrides = { mac15: "2000", mac14: "1900" };
    const reordered = structuredClone(original);
    reordered.browsers.reverse();
    reordered.browsers.find((entry) => entry.name === "chromium")!.revisionOverrides = { mac14: "1900", mac15: "2000" };
    expect(browserCacheKey(reordered, options)).toBe(browserCacheKey(original, options));
  });

  it("fails closed on absent, duplicate or malformed required revisions", () => {
    for (const name of ["chromium", "chromium-headless-shell", "ffmpeg"]) {
      const missing = metadata();
      missing.browsers = missing.browsers.filter((entry) => entry.name !== name);
      expect(() => browserCacheKey(missing, options), name).toThrow(/valid.*revision/);
    }
    const duplicate = metadata();
    duplicate.browsers.push(duplicate.browsers[0]);
    expect(() => browserCacheKey(duplicate, options)).toThrow(/one valid chromium/);
    const malformed = metadata();
    malformed.browsers[0].revision = "unknown";
    expect(() => browserCacheKey(malformed, options)).toThrow(/valid chromium/);
    malformed.browsers[0].revision = "1000";
    malformed.browsers[0].revisionOverrides.mac14 = "unknown";
    expect(() => browserCacheKey(malformed, options)).toThrow(/revision overrides/);
    expect(() => browserCacheKey(metadata(), { ...options, engine: "unknown" })).toThrow(/Unsupported/);
  });

  it("emits the same Actions output after an unrelated lockfile change, and fails for missing metadata", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "browser-cache-key-"));
    const script = fileURLToPath(new URL("../scripts/playwright-browser-cache-key.mjs", import.meta.url));
    const run = () =>
      spawnSync(process.execPath, [script, "--engine", "chromium", "--os", "Linux", "--arch", "X64"], {
        cwd: directory,
        encoding: "utf8",
      });
    try {
      mkdirSync(path.join(directory, "node_modules/playwright-core"), { recursive: true });
      const metadataPath = path.join(directory, "node_modules/playwright-core/browsers.json");
      writeFileSync(metadataPath, JSON.stringify(metadata()));
      writeFileSync(path.join(directory, "package-lock.json"), "first npm dependency graph");
      const first = run();
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toMatch(/^key=playwright-v1-Linux-X64-chromium-[a-f0-9]{64}\r?\n$/);
      writeFileSync(path.join(directory, "package-lock.json"), "changed unrelated dependency graph");
      expect(run().stdout).toBe(first.stdout);
      rmSync(metadataPath);
      const missing = run();
      expect(missing.status).toBe(1);
      expect(missing.stdout).toBe("");
      expect(missing.stderr).toContain("Cannot resolve Playwright browser cache key");
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

type Step = { name?: string; id?: string; run?: string; with?: Record<string, unknown> };
const load = createRequire(import.meta.url)("js-yaml").load;

describe("shared browser cache workflow wiring", () => {
  it.each(["setup-ui-e2e", "setup-lighthouse-chromium"])(
    "%s uses exact revision keys and verifies dependencies on every runner",
    (action) => {
      const source = readFileSync(new URL(`../.github/actions/${action}/action.yml`, import.meta.url), "utf8");
      const steps = load(source).runs.steps as Step[];
      const resolver = steps.find((step) => step.id === "browser-cache-key")!;
      const cache = steps.find((step) => step.id === "pw-cache")!;
      expect(resolver.run).toContain("node scripts/playwright-browser-cache-key.mjs --engine chromium");
      expect(resolver.run).toContain('--os "${{ runner.os }}" --arch "${{ runner.arch }}" >> "$GITHUB_OUTPUT"');
      expect(cache.with?.key).toBe("${{ steps.browser-cache-key.outputs.key }}");
      expect(cache.with?.["restore-keys"]).toBeUndefined();
      expect(steps.indexOf(resolver)).toBeLessThan(steps.indexOf(cache));
      expect(source).toMatch(/cache-hit.*?install-deps chromium.*?install chromium/s);
      expect(source).toContain("npx playwright install --with-deps chromium");
    },
  );
});
