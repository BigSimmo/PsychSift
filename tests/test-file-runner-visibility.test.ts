import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A file under `tests/` is only actually tested if SOME runner's include/testMatch pattern
 * collects it. `vitest.config.mts` runs two projects on disjoint globs (`tests/**\/*.test.ts` for
 * node, `tests/**\/*.dom.test.tsx` for jsdom) plus one conditionally-instantiated third project;
 * two Playwright configs add three more patterns. A file whose name satisfies none of them runs
 * nothing, reports nothing, and — because `vitest run` walks its include globs rather than
 * enumerating `tests/` and complaining about leftovers — a whole-suite run is simply silent about
 * it. `tests/foo.test.tsx` (missing the `.dom.` infix the jsdom project requires) is the shape
 * that keeps recurring, because it is the most natural name to give a React component test.
 *
 * This file computes the real pattern set from the configs themselves (not from a copy of the
 * two globs someone remembers), and checks every file on disk against it — both files named like
 * a test that no pattern admits, and files that read like a test (a top-level `describe`/`it`/
 * `test` call) despite carrying no test-shaped extension at all.
 *
 * What this cannot see: an environment-variable branch changes which project a file belongs to
 * (`ALLOW_PROVIDER_TESTS=true` swaps the node project onto `*.live.test.ts`) rather than which
 * files exist at all, so both branches are unioned in below as "visible" — a file reachable by
 * either branch is not orphaned, even though a bare `npm run test` does not collect live files. A
 * CI matrix step that filters the file list after config resolution, or a config this repo does
 * not have yet, would also be outside what a static read of these four files can prove.
 */

function readConfigSource(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8");
}

/**
 * Minimal glob-to-regex conversion for the exact vocabulary vitest.config.mts uses:
 * a literal prefix, `**\/` (zero or more path segments), and `*` (zero or more non-slash
 * characters). Neither `?`, `[...]`, nor `{...}` appears anywhere in that file's include globs,
 * so a full glob engine would only add surface area this file cannot itself verify is correct.
 */
function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  let i = 0;
  while (i < glob.length) {
    if (glob.startsWith("**/", i)) {
      pattern += "(?:.*/)?";
      i += 3;
    } else if (glob[i] === "*") {
      pattern += "[^/]*";
      i += 1;
    } else {
      pattern += glob[i]!.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  pattern += "$";
  return new RegExp(pattern);
}

/**
 * Pull a named regex literal (`const NAME = /.../;`, possibly split across two lines) out of a
 * Playwright config. The config cannot be imported here — it calls `getPlaywrightBaseUrl` at
 * module scope, which refuses to resolve without a runner-owned local server — so reading the
 * source is the only way a unit test can see these patterns. Mirrors the identically-named helper
 * in tests/playwright-project-isolation.test.ts; duplicated rather than imported so this file's
 * extraction stands on its own and a change to that file's internals cannot silently affect this
 * one's verdicts.
 */
function configRegexConst(source: string, name: string): RegExp {
  const match = source.match(new RegExp(`const ${name} =\\s*(/.*/);`));
  if (!match) {
    throw new Error(
      `could not read the \`${name}\` regex literal from its config. If it moved or changed shape, ` +
        "update this extraction — do not delete the assertions that depend on it.",
    );
  }
  return new RegExp(match[1]!.slice(1, -1));
}

function walk(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, root, out);
    } else {
      out.push(`tests/${full.slice(root.length + 1).replace(/\\/g, "/")}`);
    }
  }
}

describe("no file under tests/ is invisible to every runner", () => {
  // ---- 1. Vitest: read the node/jsdom shapes from vitest.config.mts itself ----

  const vitestSource = readConfigSource("vitest.config.mts");

  const nodeIncludeMatch = vitestSource.match(/include:\s*liveProviderTests\s*\?\s*(\[[^\]]+\])\s*:\s*(\[[^\]]+\])/);
  if (!nodeIncludeMatch) {
    throw new Error("vitest.config.mts: could not read the node project's include globs — update this extraction.");
  }
  // The ternary's TRUE branch (ALLOW_PROVIDER_TESTS=true) and FALSE/default branch, in source order.
  const NODE_LIVE_INCLUDE_GLOBS: string[] = JSON.parse(nodeIncludeMatch[1]!);
  const NODE_DEFAULT_INCLUDE_GLOBS: string[] = JSON.parse(nodeIncludeMatch[2]!);

  const jsdomIncludeMatch = vitestSource.match(/name: "jsdom",[\s\S]*?include: \["([^"]+)"\],/);
  if (!jsdomIncludeMatch) {
    throw new Error("vitest.config.mts: could not read the jsdom project's include glob — update this extraction.");
  }
  const JSDOM_INCLUDE_GLOB = jsdomIncludeMatch[1]!; // "tests/**/*.dom.test.tsx"

  const nodeDefaultIncludePatterns = NODE_DEFAULT_INCLUDE_GLOBS.map(globToRegExp);
  const nodeLiveIncludePatterns = NODE_LIVE_INCLUDE_GLOBS.map(globToRegExp);
  const jsdomIncludeRe = globToRegExp(JSDOM_INCLUDE_GLOB);

  // ---- 2. Playwright: discover which projects exist and which named pattern each one uses ----
  //
  // Playwright resolves a project's testMatch via `takeFirst(projectConfig.testMatch,
  // config.testMatch, ...)` (node_modules/playwright/lib/common/index.js:639) — the project's OWN
  // pattern wins outright, and the top-level one is consulted only when a project sets none.
  // Every project in playwright.config.ts sets its own; playwright.visual.config.ts's one project
  // does not, so its top-level pattern is what actually governs there. Both branches are handled
  // explicitly below rather than assumed, and each assumption is pinned so a future project that
  // breaks the pattern fails loudly instead of quietly under-covering.

  const playwrightSource = readConfigSource("playwright.config.ts");
  const mainProjectNameMatches = [...playwrightSource.matchAll(/name: "[a-z0-9-]+",/g)];
  const mainNamedTestMatchMatches = [...playwrightSource.matchAll(/testMatch: (\w+),/g)];
  if (mainNamedTestMatchMatches.length !== mainProjectNameMatches.length) {
    throw new Error(
      "playwright.config.ts: a project's count of named `testMatch: WORD,` references no longer " +
        'matches its count of `name: "...",` entries — some project now falls back to the ' +
        "top-level testMatch (Playwright's takeFirst), which this extraction does not account for. " +
        "Update the extraction before trusting it.",
    );
  }
  const mainPatternNames = [...new Set(mainNamedTestMatchMatches.map((m) => m[1]!))];
  const playwrightMainPatterns = mainPatternNames.map((name) => configRegexConst(playwrightSource, name));

  const visualSource = readConfigSource("playwright.visual.config.ts");
  const visualNamedTestMatchMatches = [...visualSource.matchAll(/testMatch: (\w+),/g)];
  if (visualNamedTestMatchMatches.length !== 0) {
    throw new Error(
      "playwright.visual.config.ts: a project now sets its own named testMatch. This extraction " +
        "assumed none did and read the top-level pattern instead — update it to resolve per project.",
    );
  }
  const visualTopLevelMatch = visualSource.match(/testMatch: (\/.*\/),/);
  if (!visualTopLevelMatch) {
    throw new Error("playwright.visual.config.ts: could not read the top-level testMatch — update this extraction.");
  }
  const playwrightVisualPattern = new RegExp(visualTopLevelMatch[1]!.slice(1, -1));

  function isVisible(relPath: string): boolean {
    const nodeLiveVisible = nodeLiveIncludePatterns.some((pattern) => pattern.test(relPath));
    const nodeDefaultVisible = nodeDefaultIncludePatterns.some((pattern) => pattern.test(relPath)) && !nodeLiveVisible;
    return (
      nodeDefaultVisible ||
      jsdomIncludeRe.test(relPath) ||
      nodeLiveVisible || // visible under ALLOW_PROVIDER_TESTS=true
      playwrightMainPatterns.some((re) => re.test(relPath)) ||
      playwrightVisualPattern.test(relPath)
    );
  }

  it("reads the real patterns from every runner's config, not a remembered copy of two globs", () => {
    expect(NODE_DEFAULT_INCLUDE_GLOBS).toEqual([
      "tests/**/*.test.ts",
      "scripts/archive/check-july8-live-batch.test.ts",
    ]);
    expect(NODE_LIVE_INCLUDE_GLOBS).toEqual(["tests/**/*.live.test.ts"]);
    expect(JSDOM_INCLUDE_GLOB).toBe("tests/**/*.dom.test.tsx");
    // Playwright: two distinct named patterns across six projects (five production browsers and
    // one advisory mockup project), plus the visual config's own top-level pattern which no
    // project there overrides.
    expect(mainPatternNames.sort()).toEqual(["mockupSpecPattern", "productionSpecPattern"]);
    expect(mainProjectNameMatches.length).toBeGreaterThan(3);
    expect(playwrightVisualPattern.source).toContain("ui-visual-");
  });

  describe("the visibility matcher itself, pinned against literal example paths", () => {
    it("classifies the reported defect shape as invisible: *.test.tsx without *.dom.", () => {
      // The exact shape reported: a React component test named *.test.tsx. Wrong extension for
      // the node project (.ts, not .tsx) and missing the jsdom project's required .dom. infix, so
      // neither vitest project collects it — and every Playwright pattern requires .spec.ts, so
      // no browser project rescues it either.
      expect(isVisible("tests/zz-example-widget.test.tsx")).toBe(false);
    });

    it("classifies the corresponding good names as visible", () => {
      expect(isVisible("tests/zz-example-widget.dom.test.tsx")).toBe(true);
      expect(isVisible("tests/zz-example.test.ts")).toBe(true);
    });

    it("classifies the neighbouring holes named in the brief as invisible too", () => {
      expect(isVisible("tests/zz-example.spec.tsx")).toBe(false); // Playwright requires .spec.ts, not .tsx
      expect(isVisible("tests/zz-example.test.mts")).toBe(false);
      expect(isVisible("tests/zz-example.test.cts")).toBe(false);
      expect(isVisible("tests/zz-example.test.jsx")).toBe(false);
    });

    it("classifies a real, currently-collected file of each visible kind as visible", () => {
      // Not vacuous: the matcher must actually say yes to something, on every path below.
      expect(isVisible("tests/gate-receipts.test.ts")).toBe(true); // node project
      expect(isVisible("tests/accessible-table.dom.test.tsx")).toBe(true); // jsdom project
      expect(isVisible("tests/ui-smoke.spec.ts")).toBe(true); // Playwright production project
      expect(isVisible("tests/ui-care-plan-mockup.spec.ts")).toBe(true); // Playwright mockup project
      expect(isVisible("tests/ui-visual-baseline.spec.ts")).toBe(true); // visual config
      expect(isVisible("tests/universal-search-owner.live.test.ts")).toBe(true); // live project gate
    });
  });

  // ---- 3. Walk every file under tests/ and check it against the computed pattern set ----

  const testsRoot = resolve(process.cwd(), "tests");
  const allFiles: string[] = [];
  walk(testsRoot, testsRoot, allFiles);

  it("walked a meaningful population of files under tests/, so the checks below are not vacuous", () => {
    // Floors the DENOMINATOR (files scanned), never the violation count: the violation count is
    // supposed to be zero, and a floor on it would fail exactly when this guard is doing its job.
    expect(allFiles.length).toBeGreaterThan(500);
  });

  const TEST_NAMED = /\.(test|spec)\.[A-Za-z0-9]+$/;
  const TEXTUAL_EXTENSION = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  const TOP_LEVEL_TEST_CALL = /^(describe|it|test)\(/m;

  const testNamedFiles = allFiles.filter((f) => TEST_NAMED.test(f));

  it("found a meaningful population of test/spec-named files, so the naming check is not vacuous", () => {
    expect(testNamedFiles.length).toBeGreaterThan(500);
  });

  const invisibleByName = testNamedFiles.filter((f) => !isVisible(f));

  // Files with no test/spec-shaped name at all cannot be matched by any include glob regardless
  // of content — every glob above requires literal ".test." or ".spec." before the extension. A
  // file that nonetheless registers a suite at module load (a top-level describe/it/test call, at
  // column 0 so a shared-contract helper's exported function — which nests its calls inside a
  // function body and is invoked from a real, correctly-named test file — is not mistaken for one)
  // is a test someone forgot to name as one.
  const unnamedButLooksLikeATest = allFiles.filter((f) => {
    if (TEST_NAMED.test(f) || !TEXTUAL_EXTENSION.test(f)) return false;
    return TOP_LEVEL_TEST_CALL.test(readFileSync(resolve(process.cwd(), f), "utf8"));
  });
  const invisibleUnnamed = unnamedButLooksLikeATest.filter((f) => !isVisible(f));

  it("names every file under tests/ that no runner would collect", () => {
    const violations = [...invisibleByName, ...invisibleUnnamed].sort();
    expect(
      violations,
      "These files under tests/ match no include/testMatch pattern in any runner (vitest node, " +
        "vitest jsdom, the live-provider gate, or Playwright's " +
        "production/mockup/visual projects) — or, for a file with no test-shaped extension " +
        "at all, register a suite at module load anyway. Each one runs nothing and reports nothing: " +
        "a whole-suite run is simply silent about it. Rename it to match a collected pattern (most " +
        "often *.dom.test.tsx for a React component test) or add it to a runner's include.",
    ).toEqual([]);
  });
});
