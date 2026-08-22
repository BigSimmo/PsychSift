import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pull a named regex literal out of playwright.config.ts and rebuild it.
 *
 * The config cannot be imported here: it calls getPlaywrightBaseUrl at module
 * scope, which refuses to resolve without a runner-owned local server. Reading
 * the source is the only way a unit test can see these patterns, so the
 * extraction fails CLOSED — a renamed or restructured constant is reported
 * rather than quietly turning the assertions below into no-ops.
 */
function configPattern(source: string, name: string): RegExp {
  const match = source.match(new RegExp(`const ${name} =\\s*(/.*/);`));
  if (!match) {
    throw new Error(
      `playwright.config.ts: could not read the \`${name}\` regex literal. If it moved or changed shape, ` +
        "update this helper — do not delete the assertions that depend on it.",
    );
  }
  return new RegExp(match[1].slice(1, -1));
}

describe("Playwright production-project isolation", () => {
  it("excludes advisory mockup cases from every required browser project", () => {
    const source = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");

    for (const project of ["chromium", "firefox", "webkit"]) {
      expect(source).toMatch(
        new RegExp(`name: ["']${project}["'],\\s+testMatch: productionSpecPattern,\\s+grepInvert: mockupTag,`, "m"),
      );
    }

    expect(source).toMatch(/name: ["']chromium-mockups["'],\s+testMatch: mockupSpecPattern,\s+grep: mockupTag,/m);
  });

  it("collects the linked caring-contact prototype only in the advisory mockup project", () => {
    const source = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    const productionSpecPattern = configPattern(source, "productionSpecPattern");
    const mockupSpecPattern = configPattern(source, "mockupSpecPattern");
    const testMatch = source.match(/testMatch:\s*(\/.*\/),/);
    expect(testMatch, "playwright.config.ts: could not read the top-level testMatch regex").not.toBeNull();
    const testMatchPattern = new RegExp(testMatch![1].slice(1, -1));
    const spec = "tests/ui-caring-contact-mockup.spec.ts";

    expect(existsSync(resolve(process.cwd(), spec)), `${spec} is missing`).toBe(true);
    expect(testMatchPattern.test(spec), `${spec} is not collected by top-level testMatch`).toBe(true);
    expect(mockupSpecPattern.test(spec), `${spec} is not collected by chromium-mockups`).toBe(true);
    expect(productionSpecPattern.test(spec), `${spec} leaked into required production projects`).toBe(false);

    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["test:e2e:caring-contact-mockup"]).toBe(
      "node scripts/run-playwright.mjs --project=chromium-mockups tests/ui-caring-contact-mockup.spec.ts",
    );
  });

  /**
   * The production Caring Contacts workspace spec is the surface's only browser
   * proof, and it is what `docs/design-system/adoption-contract.json` cites for
   * all five proof categories. A spec listed in only one of the two
   * hand-maintained regexes does not fail — it silently never runs, and the
   * adoption declaration it backs becomes a claim nothing checks. Pin both, and
   * pin that it stays out of the advisory mockup project.
   */
  it("collects the production caring-contacts workspace spec in the chromium project only", () => {
    const source = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    const productionSpecPattern = configPattern(source, "productionSpecPattern");
    const mockupSpecPattern = configPattern(source, "mockupSpecPattern");
    const testMatch = source.match(/testMatch:\s*(\/.*\/),/);
    expect(testMatch, "playwright.config.ts: could not read the top-level testMatch regex").not.toBeNull();
    const testMatchPattern = new RegExp(testMatch![1].slice(1, -1));

    const spec = "tests/ui-caring-contacts-workspace.spec.ts";
    expect(existsSync(resolve(process.cwd(), spec)), `${spec} is missing`).toBe(true);
    expect(testMatchPattern.test(spec), `${spec} is not collected by top-level testMatch`).toBe(true);
    expect(
      productionSpecPattern.test(spec),
      `${spec} is not collected by productionSpecPattern, so the workspace has no browser gate at all`,
    ).toBe(true);
    expect(mockupSpecPattern.test(spec), `${spec} leaked into the advisory mockup project`).toBe(false);
  });

  /**
   * The phone-scroll coverage is split across sibling spec files so no single
   * file can dominate one `--shard`. That split only holds if every sibling is
   * actually collected: `productionSpecPattern` and `testMatch` are two more
   * hand-maintained lists of spec basenames, and a file they miss does not fail
   * — it silently never runs, on a green pull request. Assert against the files
   * on disk rather than against a third copy of the list.
   */
  it("collects every phone-scroll spec sibling into the required browser projects", () => {
    const source = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    const productionSpecPattern = configPattern(source, "productionSpecPattern");
    const testMatch = source.match(/testMatch:\s*(\/.*\/),/);
    expect(testMatch, "playwright.config.ts: could not read the top-level testMatch regex").not.toBeNull();
    const testMatchPattern = new RegExp(testMatch![1].slice(1, -1));

    const siblings = readdirSync(resolve(process.cwd(), "tests")).filter(
      (file) => file.startsWith("ui-phone-scroll") && file.endsWith(".spec.ts"),
    );

    // The split is the point; one file means it was undone without updating this.
    expect(siblings.length, "expected the phone-scroll coverage to stay split across sibling specs").toBeGreaterThan(1);

    for (const file of siblings) {
      expect(testMatchPattern.test(`tests/${file}`), `${file} is not collected by testMatch`).toBe(true);
      expect(
        productionSpecPattern.test(`tests/${file}`),
        `${file} is not collected by productionSpecPattern, so it never runs in a required browser project`,
      ).toBe(true);
    }
  });

  /**
   * The viewer-canvas gate is the only browser proof that a clinical source page
   * actually paints, and it is the single spec most likely to be dropped by a
   * future edit to those two hand-maintained regexes: it skips on any browser
   * without pdf.js 6's engine requirement, so "it did not run" and "it ran and
   * skipped" look identical in a log. Assert its collection directly.
   */
  it("collects the viewer-canvas gate into the required browser projects", () => {
    const source = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    const productionSpecPattern = configPattern(source, "productionSpecPattern");
    const testMatch = source.match(/testMatch:\s*(\/.*\/),/);
    expect(testMatch, "playwright.config.ts: could not read the top-level testMatch regex").not.toBeNull();
    const testMatchPattern = new RegExp(testMatch![1].slice(1, -1));

    const spec = "tests/ui-document-canvas.spec.ts";
    expect(existsSync(resolve(process.cwd(), spec)), `${spec} is missing`).toBe(true);
    expect(testMatchPattern.test(spec), `${spec} is not collected by testMatch`).toBe(true);
    expect(
      productionSpecPattern.test(spec),
      `${spec} is not collected by productionSpecPattern, so the viewer canvas has no browser gate at all`,
    ).toBe(true);
  });

  it("blocks service workers for mocked journeys but allows the dedicated PWA suite", () => {
    const config = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    const pwaSpec = readFileSync(resolve(process.cwd(), "tests/ui-pwa.spec.ts"), "utf8");

    expect(config).toContain('serviceWorkers: "block"');
    expect(pwaSpec).toContain('test.use({ serviceWorkers: "allow" })');
  });
});
