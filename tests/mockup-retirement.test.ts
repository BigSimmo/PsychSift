import { describe, expect, it } from "vitest";
import {
  auditDeletions,
  isRetirableRoutePath,
  auditIndex,
  deletedMockupFiles,
  deletedRouteSlugs,
  inlineCodeSpans,
  listRouteSlugs,
  main,
  mentionedSlugs,
  moduleSpecifiersFor,
  referencePattern,
  resolveDiffBase,
  parseArguments,
  readDeveloperGatedPrefixes,
  retiredSection,
  retiredSlugs,
  MOCKUP_ROUTE_ROOT,
  RETIRED_SECTION_HEADING,
} from "../scripts/check-mockup-retirement.mjs";

/**
 * A synthetic repository. Every case below is a real would-be deletion the 2026-09-02 survey
 * found, reduced to its smallest reproduction — see docs/mockup-retirement-policy.md.
 */
function fakeRepo(files: Record<string, string>, directories: Record<string, string[]>) {
  const normalize = (p: string) => p.replaceAll("\\", "/").replace(/^\/+/, "");
  return {
    readFileSync: (p: string) => {
      const key = normalize(p);
      const hit = Object.entries(files).find(([name]) => key.endsWith(name));
      if (!hit) throw new Error(`ENOENT: ${key}`);
      return hit[1];
    },
    readdirSync: (p: string) => {
      const key = normalize(p);
      const hit = Object.entries(directories).find(([name]) => key.endsWith(name));
      // A route directory with no explicit contents is assumed runnable: listRouteSlugs now
      // requires a surviving page.tsx, and most cases here are about the index, not liveness.
      if (!hit) return [{ name: "page.tsx", isDirectory: () => false }] as never;
      return hit[1].map((name) => ({ name, isDirectory: () => !name.includes(".") })) as never;
    },
    existsSync: (p: string) => Object.keys(directories).some((name) => normalize(p).endsWith(name)),
  } as never;
}

const GATE_SOURCE = `export const DEVELOPER_GATED_PATH_PREFIXES = [
  "/mockups/development",
  "/mockups/example-gated",
] as const;`;

describe("mockup index parsing", () => {
  const markdown = [
    "# Project Mockups",
    "",
    "`example-study` — Active study.",
    "`document-search/source` — nested route rolls up.",
    "",
    RETIRED_SECTION_HEADING,
    "",
    "| Retired | Route | Superseded by | Evidence |",
    "| --- | --- | --- | --- |",
    "| 2026-09-02 | `example-retired-study` | `example-winner` | Exact code match. |",
    "",
    "## Design tokens",
    "",
    "`some-other-token`",
  ].join("\n");

  it("unwraps inline code spans", () => {
    expect(inlineCodeSpans("a `b` and `c`")).toEqual(["b", "c"]);
  });

  it("stops the retired section at the next heading", () => {
    expect(retiredSection(markdown)).not.toContain("some-other-token");
    expect(retiredSection(markdown)).toContain("example-retired-study");
  });

  it("treats only the retired section as a retirement record", () => {
    expect(retiredSlugs(markdown).has("example-retired-study")).toBe(true);
    expect(retiredSlugs(markdown).has("example-study")).toBe(false);
  });

  /**
   * The "Superseded by" column names the LIVE winner. Reading every code span in the section
   * marked that winner retired — a real bug this check found against its own first record.
   */
  it("never reads the successor column as a retirement", () => {
    expect(retiredSlugs(markdown).has("example-winner")).toBe(false);
  });

  it("rolls a nested route up to its top-level slug", () => {
    expect(mentionedSlugs(markdown).has("document-search")).toBe(true);
  });

  it("returns an empty record when the section is absent", () => {
    expect(retiredSlugs("# No section here").size).toBe(0);
  });

  /**
   * Evidence bar item 1 is a written successor. A row naming a route but leaving the successor
   * or evidence cell blank says nothing, and must not license a deletion.
   */
  it.each([
    ["a blank successor", "| 2026-09-02 | `gone` |  | Evidence. |"],
    ["blank evidence", "| 2026-09-02 | `gone` | `winner` |  |"],
    ["both blank", "| 2026-09-02 | `gone` |  |  |"],
  ])("refuses to record a retirement with %s", (_label, row) => {
    const markdown = [
      RETIRED_SECTION_HEADING,
      "",
      "| Retired | Route | Superseded by | Evidence |",
      "| --- | --- | --- | --- |",
      row,
    ].join("\n");
    expect(retiredSlugs(markdown).has("gone")).toBe(false);
  });
});

describe("index audit", () => {
  it("fails a route with no entry in the index", () => {
    const fs = fakeRepo(
      { "mockups/README.md": "# Project Mockups\n\n`indexed-route`\n" },
      {
        [MOCKUP_ROUTE_ROOT]: ["indexed-route", "undocumented-route"],
      },
    );
    const result = auditIndex("/repo", fs);
    expect(result.violations.join()).toContain("/mockups/undocumented-route has no entry");
    expect(result.violations.join()).not.toContain("indexed-route has no entry");
  });

  it("fails a route recorded as retired that still exists on disk", () => {
    const fs = fakeRepo(
      {
        "mockups/README.md": `# M\n\n${RETIRED_SECTION_HEADING}\n\n| Retired | Route | Superseded by | Evidence |\n| --- | --- | --- | --- |\n| 2026-09-02 | \`still-here\` | \`winner\` | Evidence. |\n`,
      },
      { [MOCKUP_ROUTE_ROOT]: ["still-here"] },
    );
    expect(auditIndex("/repo", fs).violations.join()).toContain("still exists on disk");
  });

  /**
   * A leftover stylesheet or asset must not keep a slug "live" — that silently suppressed the
   * retirement-record check for a route nobody could load.
   */
  it("counts a route as live only while a page.tsx survives under it", () => {
    const fs = fakeRepo(
      { "mockups/README.md": "# M\n\n`with-page`\n" },
      {
        [MOCKUP_ROUTE_ROOT]: ["with-page", "leftover-assets"],
        "with-page": ["page.tsx"],
        "leftover-assets": ["styles.css"],
      },
    );
    expect(listRouteSlugs("/repo", fs)).toEqual(["with-page"]);
  });

  it("ignores the shared shell files, which are not routes", () => {
    const fs = fakeRepo(
      { "mockups/README.md": "# M\n" },
      {
        [MOCKUP_ROUTE_ROOT]: ["layout.tsx", "mockups.css", "mockups-layout-client.tsx"],
      },
    );
    expect(auditIndex("/repo", fs).violations).toHaveLength(0);
  });

  /** Returning [] here would pass with "0 routes indexed", indistinguishable from a healthy repo. */
  it("fails closed when the mockup route root is missing entirely", () => {
    const fs = fakeRepo({ "mockups/README.md": "# M\n" }, {});
    expect(() => auditIndex("/repo", fs)).toThrow(/does not exist/);
  });

  it("refuses a Retired table whose columns have been reordered", () => {
    const markdown = [
      "# M",
      "",
      RETIRED_SECTION_HEADING,
      "",
      "| Route | Retired | Superseded by | Evidence |",
      "| --- | --- | --- | --- |",
      "| `gone` | 2026-09-02 | `winner` | Evidence. |",
    ].join("\n");
    expect(() => retiredSlugs(markdown)).toThrow(/table header must be/);
  });

  it("fails closed when the index cannot be read", () => {
    const fs = fakeRepo({}, { [MOCKUP_ROUTE_ROOT]: ["a-route"] });
    expect(auditIndex("/repo", fs).violations.join()).toContain("unreadable");
  });
});

describe("module specifiers", () => {
  it("builds the @/ alias a survivor would import by", () => {
    expect(moduleSpecifiersFor("src/components/example-study-mockups.tsx")).toContain(
      "@/components/example-study-mockups",
    );
  });

  it("also matches a barrel imported without its /index", () => {
    expect(moduleSpecifiersFor("src/components/tools-page-mockups/index.ts")).toContain(
      "@/components/tools-page-mockups",
    );
  });

  it("never matches on a bare page or index basename", () => {
    expect(moduleSpecifiersFor("src/app/mockups/foo/page.tsx")).not.toContain("page");
    expect(moduleSpecifiersFor("src/components/bar/index.ts")).not.toContain("index");
  });

  it("covers a deleted route by its URL, not just by module path", () => {
    expect(moduleSpecifiersFor(`${MOCKUP_ROUTE_ROOT}/gone/page.tsx`)).toContain("/mockups/gone");
  });

  /**
   * The first version of this gate matched only a quote immediately before the specifier, so a
   * relative prefix hid the reference. 59 files in this surface import relatively, and the sweep
   * that introduced this gate left four dead `pathname === "/mockups/<slug>"` branches behind.
   */
  it.each([
    ["alias import", 'import X from "@/components/example-study-mockups";'],
    ["relative sibling", 'import X from "./example-study-mockups";'],
    ["relative parent", 'import X from "../../components/example-study-mockups";'],
    ["dynamic import", 'dynamic(() => import("./example-study-mockups"))'],
  ])("catches a reference by %s", (_label, body) => {
    const specifiers = moduleSpecifiersFor("src/components/example-study-mockups.tsx");
    expect(specifiers.some((specifier) => referencePattern(specifier).test(body))).toBe(true);
  });

  it("does not match an unrelated module with a similar path", () => {
    const specifiers = moduleSpecifiersFor("src/components/example-study-mockups.tsx");
    expect(specifiers.some((s) => referencePattern(s).test('import Y from "@/components/other";'))).toBe(false);
  });

  it("catches a CSS module reached only through composes", () => {
    const specifiers = moduleSpecifiersFor("src/components/example-shell.module.css");
    const body = 'composes: base from "./example-shell.module.css";';
    expect(specifiers.some((specifier) => referencePattern(specifier).test(body))).toBe(true);
  });
});

/** `ProcessEnv` requires NODE_ENV, so build fixtures from it rather than casting the type away. */
const fakeEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...extra });

describe("diff base resolution", () => {
  it("passes an explicit ref through untouched", () => {
    expect(resolveDiffBase("origin/main", { runGit: () => "" })).toBe("origin/main");
  });

  it("prefers MOCKUP_RETIREMENT_BASE when resolving auto", () => {
    expect(resolveDiffBase("auto", { runGit: () => "", env: fakeEnv({ MOCKUP_RETIREMENT_BASE: "abc123" }) })).toBe(
      "abc123",
    );
  });

  it("falls back to the merge base with origin/main", () => {
    expect(resolveDiffBase("auto", { runGit: () => "deadbeef\n", env: fakeEnv() })).toBe("deadbeef");
  });

  it("fails closed when no base can be resolved", () => {
    expect(() => resolveDiffBase("auto", { runGit: () => "", env: fakeEnv() })).toThrow(
      /could not resolve a diff base/,
    );
  });
});

describe("deleted route slugs", () => {
  it("reports a route whose last page is removed", () => {
    expect(deletedRouteSlugs([`${MOCKUP_ROUTE_ROOT}/gone/page.tsx`], ["stays"])).toEqual(["gone"]);
  });

  it("stays quiet when a sibling page under the same route survives", () => {
    expect(deletedRouteSlugs([`${MOCKUP_ROUTE_ROOT}/stays/nested/page.tsx`], ["stays"])).toEqual([]);
  });
});

describe("deletion scope", () => {
  const runGit = (out: string) => () => out;

  /**
   * 82 modules in this surface are reachable only from mockup routes and have no "mockup" in
   * their path, so a filename filter drops exactly the support files a retirement strands.
   */
  it("scans a support file with no mockup in its name once a retirement is in the diff", () => {
    const deleted = deletedMockupFiles("base", {
      runGit: runGit(`${MOCKUP_ROUTE_ROOT}/gone/page.tsx\nsrc/lib/some-support-module.ts\n`),
    });
    expect(deleted).toContain("src/lib/some-support-module.ts");
  });

  it("stays out of the way of a diff that retires no mockup", () => {
    expect(deletedMockupFiles("base", { runGit: runGit("src/lib/unrelated.ts\n") })).toEqual([]);
  });
});

describe("Route-column shape", () => {
  /*
   * ⚠️ THE FIRST VERSION OF THIS PREDICATE REFUSED LEGITIMATE ROUTES, and my own six cases
   * missed it because every one of them was either an obvious file or an obvious route. The
   * separator was written unescaped, so `.` matched ANY character and the alternation then
   * matched the tail: a `.../reports` route was read as a file (the dot taking
   * `r`, then `ts`), and so was `charts`. A FALSE REFUSAL — the opposite of the hole this
   * predicate exists to close, and it would have blocked an owner-approved retirement.
   *
   * So the cases below are chosen for the boundary rather than the middle: routes whose last
   * segment merely ENDS in an extension-like suffix must stay retirable, and a segment that IS
   * an extension with no dot must stay retirable too.
   */
  const cases: Array<[string, boolean]> = [
    ["/mockups/example-gated/reports", true],
    ["/mockups/example-gated/charts", true],
    ["/mockups/x/mjs", true],
    ["/mockups/example-gated/panel/[id]", true],
    ["/mockups/x/widget.tsx", false],
    ["/mockups/x/a.json", false],
    ["/mockups/x/s.module.css", false],
    ["/src/components/x", false],
  ];
  for (const [route, retirable] of cases) {
    it(`${retirable ? "accepts" : "refuses"} ${route}`, () => {
      expect(isRetirableRoutePath(route)).toBe(retirable);
    });
  }
});

describe("deletion audit", () => {
  const index = `# M\n\n${RETIRED_SECTION_HEADING}\n\n| Retired | Route | Superseded by | Evidence |\n| --- | --- | --- | --- |\n| 2026-09-02 | \`retired-route\` | \`winner\` | Evidence. |\n`;

  function runAudit(deleted: string[], tracked: string[], sources: Record<string, string>, markdown = index) {
    const runGit = (args: string[]) => {
      if (args[0] === "diff") return deleted.join("\n");
      if (args[0] === "ls-files") return tracked.join("\n");
      throw new Error(`unexpected git ${args[0]}`);
    };
    const fs = fakeRepo(
      { "mockups/README.md": markdown, "src/lib/developer-area/headers.ts": GATE_SOURCE, ...sources },
      { [MOCKUP_ROUTE_ROOT]: ["winner"] },
    );
    return auditDeletions("origin/main", { root: "/repo", runGit, fileSystem: fs });
  }

  it("passes a recorded, unreferenced retirement", () => {
    const result = runAudit(
      [`${MOCKUP_ROUTE_ROOT}/retired-route/page.tsx`, "src/components/retired-route-mockups.tsx"],
      ["src/components/winner-mockups.tsx"],
      { "src/components/winner-mockups.tsx": "export const Winner = () => null;" },
    );
    expect(result.violations).toHaveLength(0);
  });

  it("refuses a deletion under a developer-gated prefix", () => {
    const result = runAudit([`${MOCKUP_ROUTE_ROOT}/example-gated/handover/page.tsx`], [], {});
    expect(result.violations.join()).toContain("developer-gated prefix /mockups/example-gated");
  });

  /*
   * The owner register for Tier B, driven through the real audit rather than its parser.
   *
   * ⚠️ THE THIRD CASE IS A HOLE THAT SHIPPED. Writing a FILE path into the Route column cleared
   * Tier B for that one file, and the symmetry guard could not see it: that guard probes
   * `route + "/page.tsx"`, so for `…/widget.tsx` it looked for `…/widget.tsx/page.tsx`, which
   * cannot exist, and stayed silent. A pass whose own counter-check was disabled by
   * construction. Found by an adversarial run, not by reading the code.
   */
  const ownerRegister = (route: string) =>
    `${index}\n## Retired developer-gated routes (owner decisions)\n\n` +
    `| Retired | Route | Approved by | Superseded by | Evidence |\n` +
    `| --- | --- | --- | --- | --- |\n` +
    `| 2026-09-03 | \`${route}\` | Owner | \`/mockups/x\` | Reason. |\n`;

  it("clears a gated route the owner has recorded", () => {
    const result = runAudit(
      [`${MOCKUP_ROUTE_ROOT}/development/foo/page.tsx`],
      [],
      {},
      ownerRegister("/mockups/development/foo"),
    );
    expect(result.violations.join()).not.toContain("developer-gated prefix");
  });

  it("does not clear a non-route file on a sibling route’s record", () => {
    const result = runAudit(
      [`${MOCKUP_ROUTE_ROOT}/development/foo/widget.tsx`],
      [],
      {},
      ownerRegister("/mockups/development/foo"),
    );
    expect(result.violations.join()).toContain("developer-gated prefix");
  });

  it("⚠️ refuses a FILE path in the Route column, which used to grant an unwatchable pass", () => {
    const result = runAudit(
      [`${MOCKUP_ROUTE_ROOT}/development/foo/widget.tsx`],
      [],
      {},
      ownerRegister("/mockups/development/foo/widget.tsx"),
    );
    expect(result.violations.join()).toContain("is not a route path");
  });

  it("refuses a route deleted without a written record", () => {
    const result = runAudit([`${MOCKUP_ROUTE_ROOT}/unrecorded/page.tsx`], [], {});
    expect(result.violations.join()).toContain("not recorded under");
  });

  it("refuses a file a committed test still imports", () => {
    const result = runAudit(
      ["src/components/retired-route-mockups.tsx", `${MOCKUP_ROUTE_ROOT}/retired-route/page.tsx`],
      ["tests/retired-route.test.ts"],
      { "tests/retired-route.test.ts": 'import { X } from "@/components/retired-route-mockups";' },
    );
    expect(result.violations.join()).toContain("a committed test");
  });

  it("refuses a file repository tooling still names", () => {
    const result = runAudit(
      ["src/components/retired-route-mockups.tsx", `${MOCKUP_ROUTE_ROOT}/retired-route/page.tsx`],
      ["scripts/ci-change-scope.mjs"],
      { "scripts/ci-change-scope.mjs": 'const f = "@/components/retired-route-mockups";' },
    );
    expect(result.violations.join()).toContain("repository tooling");
  });

  it("refuses a file a survivor still reads from disk by path", () => {
    const result = runAudit(
      ["src/components/retired-route-mockups.tsx", `${MOCKUP_ROUTE_ROOT}/retired-route/page.tsx`],
      ["tests/boundary.test.ts"],
      { "tests/boundary.test.ts": 'readFileSync("src/components/retired-route-mockups.tsx")' },
    );
    expect(result.violations.join()).toContain("still named as a path");
  });

  /**
   * The inversion that makes this repository dangerous: `example-round-two` imports
   * `example-round-one`, so deleting "the older generation" breaks the newer one.
   */
  it("refuses deleting a base module a newer generation still imports", () => {
    const result = runAudit(
      ["src/components/example-round-one-mockups.tsx"],
      ["src/components/example-round-two-mockups.tsx"],
      {
        "src/components/example-round-two-mockups.tsx":
          'import { Composer } from "@/components/example-round-one-mockups";',
      },
    );
    expect(result.violations.join()).toContain("a surviving module");
  });

  /**
   * The two-defect fix on 2026-09-02/03 (moduleSpecifiersFor's route specifier, and
   * referencePattern/relativeSpecifierResolvesTo's bare-tail matching) must narrow the gate's
   * false-positive rate without narrowing what it actually catches. Each case below is one of
   * the controls that fix was required to prove, run through the real auditDeletions pipeline
   * rather than against the unit functions directly.
   */
  describe("bare-tail and deep-route controls (regression guard for the 2026-09 specifier fix)", () => {
    it("still catches a deleted module a surviving file really imports by a relative path", () => {
      const result = runAudit(
        ["src/components/retired-route/widget.tsx", `${MOCKUP_ROUTE_ROOT}/retired-route/page.tsx`],
        ["src/components/retired-route/sibling.tsx"],
        { "src/components/retired-route/sibling.tsx": 'import { Widget } from "./widget";' },
      );
      expect(result.violations.join()).toContain("a surviving module");
    });

    it("still catches a deep deleted route that is still linked, by its exact route — not the still-live root", () => {
      const result = runAudit(
        [`${MOCKUP_ROUTE_ROOT}/retired-route/nested/deep/page.tsx`],
        ["src/components/still-links-deep-route.tsx", "src/components/links-only-the-root.tsx"],
        {
          "src/components/still-links-deep-route.tsx": 'const href = "/mockups/retired-route/nested/deep";',
          "src/components/links-only-the-root.tsx": 'const href = "/mockups/retired-route";',
        },
      );
      const joined = result.violations.join();
      expect(joined).toContain('still referenced as "/mockups/retired-route/nested/deep"');
      expect(joined).toContain("still-links-deep-route.tsx");
      expect(joined).not.toContain("links-only-the-root.tsx");
    });

    it("still catches a CSS module retirement reached only through composes", () => {
      const result = runAudit(
        ["src/components/retired-route/shell.module.css", `${MOCKUP_ROUTE_ROOT}/retired-route/page.tsx`],
        ["src/components/retired-route/consumer.module.css"],
        { "src/components/retired-route/consumer.module.css": 'composes: base from "./shell.module.css";' },
      );
      expect(result.violations.join()).toContain("a surviving module");
    });

    it("still catches a dynamic import() of a retired module", () => {
      const result = runAudit(
        ["src/components/retired-route/panel.tsx", `${MOCKUP_ROUTE_ROOT}/retired-route/page.tsx`],
        ["src/components/retired-route/loader.tsx"],
        { "src/components/retired-route/loader.tsx": 'const Panel = dynamic(() => import("./panel"));' },
      );
      expect(result.violations.join()).toContain("a surviving module");
    });

    /**
     * The false-positive direction. Before the fix, a bare state-value string like `"loading"`
     * matched the same way a real `"./loading"` import did — anchored on the opening quote
     * alone — and produced 54 false violations against one retired file on this branch.
     */
    it("does NOT flag an ordinary string literal that merely shares a bare tail's name", () => {
      const result = runAudit(
        [`${MOCKUP_ROUTE_ROOT}/retired-route/page.tsx`, "src/components/retired-route-mockups.tsx"],
        ["src/components/status-values.tsx"],
        { "src/components/status-values.tsx": 'const status = "retired-route-mockups";' },
      );
      expect(result.violations).toHaveLength(0);
    });

    /**
     * The subtler false positive Defect 1 alone cannot fix: many files can share one bare
     * basename (this repo has ~24 route-level `loading.tsx` files). A relative import of a
     * DIFFERENT same-named file must not be mistaken for a reference to the deleted one —
     * only `relativeSpecifierResolvesTo`'s directory-aware resolution tells them apart.
     */
    it("does NOT flag a relative import that resolves to a different same-named surviving file", () => {
      const result = runAudit(
        ["src/components/family-a/widget.tsx", `${MOCKUP_ROUTE_ROOT}/retired-route/page.tsx`],
        ["src/components/family-b/widget.tsx", "src/components/family-b/consumer.tsx"],
        {
          "src/components/family-b/widget.tsx": "export const Widget = () => null;",
          "src/components/family-b/consumer.tsx": 'import { Widget } from "./widget";',
        },
      );
      expect(result.violations).toHaveLength(0);
    });
  });

  it("fails closed when a surviving file cannot be read", () => {
    const runGit = (args: string[]) => {
      if (args[0] === "diff") return "src/components/retired-route-mockups.tsx";
      if (args[0] === "ls-files") return "src/components/unreadable.tsx";
      throw new Error(`unexpected git ${args[0]}`);
    };
    const fs = fakeRepo(
      { "mockups/README.md": index, "src/lib/developer-area/headers.ts": GATE_SOURCE },
      { [MOCKUP_ROUTE_ROOT]: ["winner"] },
    );
    const result = auditDeletions("origin/main", { root: "/repo", runGit, fileSystem: fs });
    expect(result.violations.join()).toContain("unreadable");
  });

  it("refuses when the developer-gate list can no longer be read", () => {
    const runGit = (args: string[]) => (args[0] === "diff" ? "src/components/x-mockups.tsx" : "");
    const fs = fakeRepo({ "mockups/README.md": index }, { [MOCKUP_ROUTE_ROOT]: [] });
    expect(() => auditDeletions("origin/main", { root: "/repo", runGit, fileSystem: fs })).toThrow();
  });
});

describe("developer gate source", () => {
  it("reads the prefixes from their own source of truth", () => {
    const fs = fakeRepo({ "src/lib/developer-area/headers.ts": GATE_SOURCE }, {});
    expect(readDeveloperGatedPrefixes("/repo", fs)).toEqual(["/mockups/development", "/mockups/example-gated"]);
  });

  it("throws rather than guessing when the declaration is gone", () => {
    const fs = fakeRepo({ "src/lib/developer-area/headers.ts": "export const OTHER = [];" }, {});
    expect(() => readDeveloperGatedPrefixes("/repo", fs)).toThrow(/no longer declares/);
  });
});

describe("cli", () => {
  it("accepts --diff with a base ref", () => {
    expect(parseArguments(["--diff", "origin/main"])).toMatchObject({ mode: "diff", base: "origin/main" });
  });

  it("rejects a bare --diff", () => {
    expect(() => parseArguments(["--diff"])).toThrow(/requires a base ref/);
  });

  it("rejects an unknown option", () => {
    expect(() => parseArguments(["--wat"])).toThrow(/unknown option/);
  });

  it("exits 2 on a bad invocation", () => {
    expect(main(["--wat"], { stdout: () => {}, stderr: () => {} })).toBe(2);
  });

  it("passes its own self-test", () => {
    expect(main(["--self-test"], { stdout: () => {}, stderr: () => {} })).toBe(0);
  });
});

describe("the committed repository", () => {
  it("indexes every mockup route it ships", () => {
    const result = auditIndex(process.cwd());
    expect(result.violations).toEqual([]);
    expect(result.routeCount).toBeGreaterThan(0);
  });

  it("still declares the developer-gated prefixes the policy depends on", () => {
    const prefixes = readDeveloperGatedPrefixes(process.cwd());
    expect(prefixes).toContain("/admin/developer-hub");
    expect(prefixes).toContain("/mockups/development");
    expect(prefixes).toContain("/mockups/care-plan");
  });

  it("keeps the developer-gated prototypes out of retirement scope", () => {
    const gated = readDeveloperGatedPrefixes(process.cwd())
      .filter((p) => p.startsWith("/mockups/"))
      .map((p) => p.replace("/mockups/", ""));
    const slugs = listRouteSlugs(process.cwd());
    for (const prefix of gated) expect(slugs).toContain(prefix);
  });
});
