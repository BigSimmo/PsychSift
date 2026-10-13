import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The Lighthouse baseline is graded only by the browser that measured it.
 * `check-lighthouse-budget.mjs` fails closed on any chromeVersion drift, and the CI job installs
 * whichever Chromium the locked `playwright-core` ships (`.github/actions/setup-lighthouse-chromium`).
 * So a Playwright bump that changes Chromium turns `main` red after it merges: the gate runs on
 * pushes, and a dependency PR's changed paths need not reach it. That happened on 2026-10-14, when
 * #3473 (playwright 1.63 -> 1.64, Chromium 153 -> 156) failed the Lighthouse budget on 3405aaa.
 *
 * This check moves that failure to the PR. A Playwright bump that changes the Chromium major must
 * come with a baseline refreshed by the CI "Refresh Lighthouse baseline" dispatch, reviewed by a
 * human, in the same change.
 */
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const budget = read("../lighthouse-budget.json") as {
  baseline: Record<string, { chromeVersion: string }>;
};
const browsers = read("../node_modules/playwright-core/browsers.json") as {
  browsers: { name: string; browserVersion: string }[];
};
const pkg = read("../package.json") as { devDependencies: Record<string, string> };
const lock = read("../package-lock.json") as { packages: Record<string, { version?: string }> };

const chromeMajor = (text: string) => text.match(/(?:HeadlessChrome\/|^)(\d+)\./)?.[1];

describe("Lighthouse baseline browser pin", () => {
  it("measures with the same Chromium major the committed baseline was recorded on", () => {
    const chromium = browsers.browsers.find((browser) => browser.name === "chromium");
    expect(chromium, "playwright-core ships no chromium entry").toBeDefined();
    const installed = chromeMajor(chromium!.browserVersion);
    const rows = Object.entries(budget.baseline);
    expect(rows.length).toBeGreaterThan(0);
    for (const [run, row] of rows) {
      expect(chromeMajor(row.chromeVersion), `${run} baseline vs Playwright's Chromium ${installed}`).toBe(installed);
    }
  });

  it("pins playwright and playwright-core exactly and together", () => {
    const declared = [pkg.devDependencies.playwright, pkg.devDependencies["playwright-core"]];
    for (const range of declared) expect(range).toMatch(/^\d+\.\d+\.\d+$/);
    expect(declared[0]).toBe(declared[1]);
    expect(lock.packages["node_modules/playwright"]?.version).toBe(declared[0]);
    expect(lock.packages["node_modules/playwright-core"]?.version).toBe(declared[0]);
  });
});
