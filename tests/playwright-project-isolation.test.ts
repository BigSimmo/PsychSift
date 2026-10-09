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

  /**
   * The Care Plan prototype's only browser proof. Ten tasks of structural
   * checking ran under `css: false` in jsdom, so this spec is the first and
   * only thing that can see the prototype paint: the pinned safety boundary,
   * the three print surfaces, and whether a link looks like a link. A regex
   * edit that dropped it would not fail — it would silently leave the whole
   * route family with no rendered evidence at all, on a green pull request.
   */
  it("collects the Care Plan prototype only in the advisory mockup project", () => {
    const source = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    const productionSpecPattern = configPattern(source, "productionSpecPattern");
    const mockupSpecPattern = configPattern(source, "mockupSpecPattern");
    const testMatch = source.match(/testMatch:\s*(\/.*\/),/);
    expect(testMatch, "playwright.config.ts: could not read the top-level testMatch regex").not.toBeNull();
    const testMatchPattern = new RegExp(testMatch![1].slice(1, -1));
    const spec = "tests/ui-care-plan-mockup.spec.ts";

    expect(existsSync(resolve(process.cwd(), spec)), `${spec} is missing`).toBe(true);
    expect(testMatchPattern.test(spec), `${spec} is not collected by top-level testMatch`).toBe(true);
    expect(mockupSpecPattern.test(spec), `${spec} is not collected by chromium-mockups`).toBe(true);
    expect(
      productionSpecPattern.test(spec),
      `${spec} leaked into the required production projects, where a red prototype would block a release`,
    ).toBe(false);

    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["test:e2e:care-plan-mockup"]).toBe(
      "node scripts/run-playwright.mjs --project=chromium-mockups tests/ui-care-plan-mockup.spec.ts",
    );
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

  it("collects the adaptive answer journey into every required browser project", () => {
    const source = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    const productionSpecPattern = configPattern(source, "productionSpecPattern");
    const testMatch = source.match(/testMatch:\s*(\/.*\/),/);
    expect(testMatch, "playwright.config.ts: could not read the top-level testMatch regex").not.toBeNull();
    const testMatchPattern = new RegExp(testMatch![1].slice(1, -1));
    const spec = "tests/adaptive-answer-ui.spec.ts";

    expect(existsSync(resolve(process.cwd(), spec)), `${spec} is missing`).toBe(true);
    expect(testMatchPattern.test(spec), `${spec} is not collected by top-level testMatch`).toBe(true);
    expect(
      productionSpecPattern.test(spec),
      `${spec} is not collected by productionSpecPattern, so the adaptive renderer has no browser gate`,
    ).toBe(true);
  });

  /**
   * ⚠️ THE UNIVERSAL NET — ADDED 2026-09-02, AND IT IS AN ADDITION, NOT A REPLACEMENT.
   *
   * Every test above answers "is THIS family routed correctly": collected at all, collected by the
   * right project, and NOT leaked into the wrong one. **None of them can answer "is there a spec on
   * disk that no project collects at all", because each one starts from a family it already knows
   * about.** A file nobody thought to write a test for is invisible to all of them.
   *
   * ⚠️ THAT GAP WAS NOT HYPOTHETICAL. `tests/ui-tools-show-all.spec.ts` landed on 2026-08-16 (PR
   * #2008) carrying a launcher regression this repository had just paid for, was never added to any
   * config, and so never ran once — while being edited twice more (2026-08-22, 2026-08-23) by people
   * who reasonably believed it was protecting something. Seventeen days. `git log -S "tools-show-all"
   * -- playwright.config.ts` returns nothing: the token was never there to be removed.
   *
   * ⚠️ THIS MUST NOT BE USED TO DELETE THE PER-FAMILY TESTS ABOVE, and consolidating them into it
   * would LOSE coverage rather than tidy it. This checks only that a spec is collected SOMEWHERE. It
   * cannot see a mockup leaking into a required browser project — which is the property those tests
   * exist for and the only one that can block a release on a red prototype.
   *
   * Measured argument, from a mutation run on 2026-09-02: a cross-check between two DERIVED counts
   * stayed silent under mutation because both sides collapsed together, and only a separate pin
   * against a hand-written literal caught it. **Two guards that fail differently are worth more than
   * one that fails once.**
   */
  it("every ui-*.spec.ts on disk is collected by some Playwright config, so a spec cannot sit unrun", () => {
    const readTestMatch = (file: string) => {
      const path = resolve(process.cwd(), file);
      if (!existsSync(path)) return null;
      const matched = readFileSync(path, "utf8").match(/testMatch:\s*(\/[^\n]*\/)\s*,/);
      return matched ? new RegExp(matched[1].slice(1, -1)) : null;
    };

    const mainMatch = readTestMatch("playwright.config.ts");
    expect(mainMatch, "playwright.config.ts: could not read the top-level testMatch regex").not.toBeNull();

    // The visual-baseline suite runs from its own config with its own CI job, so a spec collected
    // only there is collected, not orphaned. Absent file = matches nothing, which fails CLOSED:
    // specs it would have covered are then reported as orphans rather than silently excused.
    const visualMatch = readTestMatch("playwright.visual.config.ts");

    const specs = readdirSync(resolve(process.cwd(), "tests")).filter(
      (file) => file.startsWith("ui-") && file.endsWith(".spec.ts"),
    );
    // Anti-vacuity: an empty or collapsed listing would satisfy the loop below for free.
    expect(specs.length, "expected the repository to carry browser specs at all").toBeGreaterThan(20);

    const orphans = specs.filter((file) => {
      const spec = `tests/${file}`;
      return !mainMatch!.test(spec) && !(visualMatch?.test(spec) ?? false);
    });

    expect(
      orphans,
      "These spec files exist on disk and are collected by NO Playwright config, so they never run " +
        "and the suite reports green having run fewer tests than it appears to. Add each one's token " +
        "to the pattern for the project it belongs in — production or mockup — and run it once before " +
        "trusting it. Do NOT silence this by narrowing the disk scan.",
    ).toEqual([]);
  });

  it("blocks service workers for mocked journeys but allows the dedicated PWA suite", () => {
    const config = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    const pwaSpec = readFileSync(resolve(process.cwd(), "tests/ui-pwa.spec.ts"), "utf8");

    expect(config).toContain('serviceWorkers: "block"');
    expect(pwaSpec).toContain('test.use({ serviceWorkers: "allow" })');
  });
});

/**
 * ⚠️ COLLECTED BY *SOME* CONFIG IS NOT COLLECTED BY THE *RIGHT* ONE.
 *
 * The orphan guard above proves no `ui-*.spec.ts` sits unrun. It cannot tell a spec collected by
 * the correct project from one collected by the wrong project, and the failure that costs something
 * is the second: a mockup journey running inside a required browser project blocks a release on a
 * page no user can reach, and a production journey collected only by the advisory project stops
 * guarding the thing it was written for while still appearing in a green run.
 *
 * Fifteen of the forty-six specs had a per-family test. The other thirty-one were routed by two
 * hand-maintained regex alternations with nothing asserting where they landed.
 *
 * ⚠️ **THIS READS THE PROJECT-LEVEL `testMatch` ONLY, AND THAT IS A CORRECTION.** Several tests
 * above additionally require the config's TOP-LEVEL `testMatch` to match, as though both had to
 * pass. Playwright does not resolve it that way: `testMatch: takeFirst(projectConfig.testMatch,
 * config.testMatch, ...)` returns the FIRST DEFINED argument (`node_modules/playwright/lib/common/
 * config.js:515` and `:639`), so a project that sets its own pattern never consults the top-level
 * one — and all six here set their own. Today the top-level pattern happens to be a superset of
 * both project patterns, so the extra condition changes no verdict; it is a maintained coincidence,
 * not a structural guarantee, and a token added to a project pattern without being mirrored upward
 * would make those tests report a spec as uncollected that Playwright collects perfectly well.
 * Reported rather than rewritten — those assertions are not mine and the fix is a decision.
 */
describe("every ui-*.spec.ts lands in the RIGHT project, not merely in some project", () => {
  const configSource = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
  const productionSpecPattern = configPattern(configSource, "productionSpecPattern");
  const mockupSpecPattern = configPattern(configSource, "mockupSpecPattern");

  /**
   * Projects are DISCOVERED from the config, never listed here. A hand-written list is the failure
   * this guard exists to prevent, one level up: add a seventh browser project and a hardcoded list
   * keeps passing while covering six of seven.
   */
  const projects = [
    ...configSource.matchAll(/\{\s*name: "([a-z0-9-]+)",\s*testMatch: (\w+),\s*(grepInvert|grep): (\w+),/g),
  ].map((match) => ({ name: match[1]!, pattern: match[2]!, filter: match[3]! }));

  /**
   * Required vs advisory is derived from each project's OWN tag filter — `grepInvert: mockupTag`
   * excludes prototype cases (required), `grep: mockupTag` selects them (advisory). Deriving it
   * means a project that flips its filter is reclassified automatically, rather than staying in
   * whichever bucket somebody once typed it into.
   */
  const requiredProjects = projects.filter((project) => project.filter === "grepInvert");
  const advisoryProjects = projects.filter((project) => project.filter === "grep");

  const specs = readdirSync(resolve(process.cwd(), "tests"))
    .filter((file) => /^ui-.*\.spec\.ts$/.test(file))
    .sort();

  const collects = (pattern: RegExp, spec: string) => pattern.test(`tests/${spec}`);

  /**
   * The one spec deliberately claimed by BOTH patterns. `ui-tools.spec.ts` holds production and
   * prototype journeys in one file and separates them per-test with `@mockup`, which the config's
   * own comment describes as the intended arrangement. Pinned as a hand-written literal: a second
   * file joining the overlap is a decision somebody must make on purpose, and the point of this
   * guard is that it cannot happen by accident.
   */
  const DOCUMENTED_OVERLAP = ["ui-tools.spec.ts"];

  it("parses the config's projects, or every assertion below silently covers fewer than exist", () => {
    expect(projects.map((project) => project.name)).toEqual([
      "chromium",
      "chromium-mockups",
      "firefox",
      "webkit",
      "mobile-webkit",
      "mobile-pwa-standalone",
      "tablet",
    ]);
    expect(requiredProjects).toHaveLength(6);
    expect(advisoryProjects).toHaveLength(1);
    expect(specs.length, "no ui-*.spec.ts found, so the assertions below would all be vacuous").toBeGreaterThan(40);
  });

  it("routes every required project by the production pattern and every advisory one by the mockup pattern", () => {
    for (const project of requiredProjects) {
      expect(project.pattern, `required project "${project.name}" must collect production specs`).toBe(
        "productionSpecPattern",
      );
    }
    for (const project of advisoryProjects) {
      expect(project.pattern, `advisory project "${project.name}" must collect mockup specs`).toBe("mockupSpecPattern");
    }
  });

  it("claims exactly the documented specs under BOTH patterns, and no others", () => {
    const overlap = specs.filter((spec) => collects(productionSpecPattern, spec) && collects(mockupSpecPattern, spec));
    expect(
      overlap,
      "a spec claimed by both patterns runs in the required projects AND the advisory one, and only " +
        "its per-test @mockup tags keep the two apart. That is deliberate for the files listed here. " +
        "A new one arriving by accident — usually a bare alternative such as `tools` also matching a " +
        "longer sibling's name — is a mockup journey entering a required browser project.",
    ).toEqual(DOCUMENTED_OVERLAP);
  });

  it("proves the tag filter that makes the overlap safe is actually present in those files", () => {
    for (const spec of DOCUMENTED_OVERLAP) {
      const contents = readFileSync(resolve(process.cwd(), "tests", spec), "utf8");
      expect(
        /@mockup/.test(contents),
        `${spec} is claimed by both patterns, so ONLY the @mockup tag separates its prototype cases ` +
          "from its production ones. With no tag in the file, `grep: mockupTag` selects nothing for " +
          "the advisory project and `grepInvert` excludes nothing from the required ones — the " +
          "separation the overlap depends on would not exist, and nothing else here would notice.",
      ).toBe(true);
    }
  });

  /**
   * ⚠️ THIS REPLACED TWO ASSERTIONS OF MINE THAT COULD NOT FAIL, AND THE SHAPE IS WORTH NAMING.
   * They filtered the spec list to "matches the mockup pattern AND NOT the production pattern",
   * then asserted the production pattern did not match — `false === false` by construction. Four
   * mutations ran straight past them, which is the only reason they were caught at all: a tautology
   * is invisible in a green run and reads, in a test listing, exactly like coverage.
   *
   * The honest form computes each project's spec set INDEPENDENTLY, from that project's own
   * resolved pattern, and intersects them. It is written over project PAIRS rather than over the
   * two regexes so that it also fails on a config where a required project is re-pointed at the
   * mockup pattern — the routing mistake, not merely the pattern mistake.
   */
  it("shares no spec between a required project and the advisory one, beyond the documented overlap", () => {
    const patternByName: Record<string, RegExp> = { productionSpecPattern, mockupSpecPattern };
    expect(requiredProjects.length * advisoryProjects.length, "no project pair to compare").toBeGreaterThan(0);

    for (const required of requiredProjects) {
      for (const advisory of advisoryProjects) {
        const requiredPattern = patternByName[required.pattern];
        const advisoryPattern = patternByName[advisory.pattern];
        expect(
          requiredPattern,
          `project "${required.name}" routes by an unknown pattern "${required.pattern}"`,
        ).toBeDefined();
        expect(
          advisoryPattern,
          `project "${advisory.name}" routes by an unknown pattern "${advisory.pattern}"`,
        ).toBeDefined();

        const requiredSet = specs.filter((spec) => requiredPattern!.test(`tests/${spec}`));
        const advisorySet = specs.filter((spec) => advisoryPattern!.test(`tests/${spec}`));
        expect(
          requiredSet.length,
          `"${required.name}" collects no spec at all, so the comparison below is vacuous`,
        ).toBeGreaterThan(0);
        expect(
          advisorySet.length,
          `"${advisory.name}" collects no spec at all, so the comparison below is vacuous`,
        ).toBeGreaterThan(0);

        const shared = requiredSet.filter((spec) => advisorySet.includes(spec));
        expect(
          shared,
          `"${required.name}" (required) and "${advisory.name}" (advisory) both collect these specs. ` +
            "A prototype journey inside a required project blocks a release on a page no user can " +
            "reach; a production journey inside the advisory project runs only its @mockup cases and " +
            "so guards nothing while still reporting green. Only the documented overlap may appear " +
            "here, and only because its cases are separated per-test by the @mockup tag.",
        ).toEqual(DOCUMENTED_OVERLAP);
      }
    }
  });

  /**
   * ⚠️ THE FIVE TESTS ABOVE ARE CORRECT BY COINCIDENCE, AND THIS IS THE ASSERTION THAT KEEPS THEM
   * CORRECT. Ward Lead's ruling, 2026-09-03: do not rewrite them, pin the thing they rest on.
   *
   * Several tests in the first describe additionally require the config's TOP-LEVEL `testMatch` to
   * match, as though a spec had to satisfy both it and the project's own pattern. Playwright does
   * not resolve it that way — `testMatch: takeFirst(projectConfig.testMatch, config.testMatch, …)`
   * returns the FIRST DEFINED argument (`node_modules/playwright/lib/common/config.js:515` and
   * `:639`), a fallback and not a merge — and all six projects set their own pattern, so the
   * top-level one is never consulted for any of them.
   *
   * Those tests nonetheless report correctly today, for one reason only: the top-level pattern is
   * currently a superset of both project patterns, so anything a project collects it also matches.
   * Nothing checked that. Add a token to `productionSpecPattern` or `mockupSpecPattern` without
   * mirroring it upward and five unrelated tests begin reporting a spec as uncollected that
   * Playwright collects perfectly well — a confusing failure a long way from its cause.
   *
   * ⚠️ THE CORPUS IS SYNTHESISED, NOT READ FROM DISK, AND THAT IS THE WHOLE POINT. A check over the
   * spec files that exist today would go green for a token added ahead of its file — which is
   * precisely when this mistake is made, because the pattern is edited before the spec lands. Every
   * literal word in each project pattern is turned into a candidate path and kept only if that
   * project pattern actually matches it, so the corpus self-filters: a nonsense candidate is
   * discarded by the pattern itself rather than by a rule I would have to keep in step.
   */
  it("keeps the top-level testMatch a superset of every project pattern, so the five tests above stay correct", () => {
    const topLevelMatch = configSource.match(/testMatch:\s*(\/.*\/),/);
    expect(topLevelMatch, "playwright.config.ts: could not read the top-level testMatch regex").not.toBeNull();
    const topLevelPattern = new RegExp(topLevelMatch![1]!.slice(1, -1));

    const corpus = new Set<string>();
    for (const pattern of [productionSpecPattern, mockupSpecPattern]) {
      const words = new Set(pattern.source.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []);
      for (const word of words) {
        for (const candidate of [`tests/${word}.spec.ts`, `tests/ui-${word}.spec.ts`]) {
          if (pattern.test(candidate)) corpus.add(candidate);
        }
      }
    }

    expect(
      corpus.size,
      "the probe corpus is too small to be meaningful — the pattern literals could not be read, so " +
        "this assertion would pass without testing anything",
    ).toBeGreaterThan(20);

    const unmirrored = [...corpus].filter((candidate) => !topLevelPattern.test(candidate)).sort();
    expect(
      unmirrored,
      "these paths are collected by a project's own testMatch but are NOT matched by the top-level " +
        "testMatch. Playwright still collects them, so nothing is unrun — but several tests in the " +
        "first describe check the top-level pattern as though it governed collection, and they will " +
        "now report these specs as uncollected. Mirror the new token into the top-level testMatch " +
        "in playwright.config.ts. Do not silence those tests: they are correct about the config " +
        "being inconsistent, even though they are wrong about why it would matter.",
    ).toEqual([]);
  });
});
