import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assessAggregate,
  assessTestFile,
  changedPaths,
  countTestCases,
  evaluate,
  isTestFile,
  parseArguments,
  parseConfig,
  resolveBase,
  selfTest,
  truncationArtefacts,
  truncationMarkers,
  untrackedTestFiles,
} from "../scripts/check-diff-integrity.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-diff-integrity.mjs", import.meta.url));
const REPOSITORY_ROOT = dirname(dirname(SCRIPT));
const CONFIG_PATH = resolve(REPOSITORY_ROOT, "diff-integrity.json");

const config = parseConfig(readFileSync(CONFIG_PATH, "utf8"));

/** The commit that motivated this gate. Not an ancestor of main; fetched into the clone. */
const INCIDENT = "d1485d6e8";

const gitAvailable = (ref: string): boolean => {
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: REPOSITORY_ROOT });
    return true;
  } catch {
    return false;
  }
};

describe("countTestCases", () => {
  it("counts Playwright and Vitest declarations but not suites or hooks", () => {
    const source = [
      'test.describe("suite", () => {',
      "  test.beforeEach(async () => {});",
      '  test("alpha", async () => {});',
      '  test.skip("beta", async () => {});',
      '  test.fixme("gamma", async () => {});',
      '  test.only("delta", async () => {});',
      "});",
      'it("epsilon", () => {});',
      'describe("vitest suite", () => { it("zeta", () => {}); });',
    ].join("\n");
    expect(countTestCases(source)).toBe(6);
  });

  it("ignores commented-out tests, which is why this is an AST count and not a grep", () => {
    const source = [
      'test("live", () => {});',
      '// test("commented", () => {});',
      '/* test("blockCommented", () => {}); */',
      'const doc = `test("inTemplate", () => {});`;',
    ].join("\n");
    expect(countTestCases(source)).toBe(1);
  });

  it("does not count the RegExp.prototype.test method", () => {
    expect(countTestCases("const matched = /brand names?/i.test(row.key);")).toBe(0);
  });

  it("counts a parameterised table once on each side of the comparison", () => {
    expect(countTestCases('test.each([1, 2, 3])("case %i", () => {});')).toBe(1);
    expect(countTestCases('it.each([["a"], ["b"]])("case %s", () => {});')).toBe(1);
  });

  it("ignores in-body annotations and sub-steps that take no title", () => {
    const source = [
      'test("outer", async () => {',
      "  test.skip();",
      "  test.slow();",
      '  await test.step("inner step", async () => {});',
      "});",
    ].join("\n");
    expect(countTestCases(source)).toBe(1);
  });

  it("counts curried conditional modifiers, whose callee is itself a call", () => {
    // `it.runIf(cond)("title", fn)` is the ONLY test in tests/guard-push-no-merge-base.test.ts.
    // Counting it as zero would let that whole file be regenerated away with no signal.
    expect(countTestCases('it.runIf(process.platform !== "win32")("a", () => {});')).toBe(1);
    expect(countTestCases('test.skipIf(isCI)("b", () => {});')).toBe(1);
    expect(countTestCases('test.for([1, 2])("c %i", () => {});')).toBe(1);
  });

  it("agrees with the real repository files that use those modifiers", () => {
    const counts: Record<string, number> = {
      "tests/guard-push-no-merge-base.test.ts": 1,
      "tests/pdf-extractor.test.ts": 6,
      "tests/claude-cloud-profile.test.ts": 26,
    };
    for (const [path, expected] of Object.entries(counts)) {
      const source = readFileSync(resolve(REPOSITORY_ROOT, path), "utf8");
      expect(countTestCases(source, path), path).toBe(expected);
    }
  });

  it("parses TSX specs", () => {
    expect(countTestCases('it("renders", () => { render(<A />); });', "a.dom.test.tsx")).toBe(1);
  });
});

describe("assessTestFile — the per-file ceiling", () => {
  it("fails the #Y30AXB shape: a surviving suite gutted of most of its cases", () => {
    const verdict = assessTestFile({ path: "tests/ui-smoke.spec.ts", before: 89, after: 9, config });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("lost 80 of 89");
    expect(verdict.message).toContain("diff-integrity.json");
  });

  it("stays quiet for small trims and ordinary edits", () => {
    expect(assessTestFile({ path: "tests/a.spec.ts", before: 4, after: 3, config }).ok).toBe(true);
    expect(assessTestFile({ path: "tests/a.spec.ts", before: 100, after: 80, config }).ok).toBe(true);
    expect(assessTestFile({ path: "tests/a.spec.ts", before: 40, after: 40, config }).ok).toBe(true);
  });

  it("does not exempt a high-percentage cut merely because the file was small", () => {
    // A 10 -> 1 file is 90% gutted. An absolute floor of 10 would wave it through, and an
    // unrelated new spec in the same diff absorbs it in the aggregate, so the per-file rule
    // is the only thing standing between that file and silence.
    const verdict = assessTestFile({ path: "tests/critical-safety.spec.ts", before: 10, after: 1, config });
    expect(verdict.ok).toBe(false);
    expect(
      assessAggregate({
        verdicts: [
          { path: "tests/critical-safety.spec.ts", before: 10, after: 1 },
          { path: "tests/unrelated-new.spec.ts", before: 0, after: 50 },
        ],
        config,
      }).ok,
    ).toBe(true);
  });

  it("exempts a deleted file, which answers to the aggregate instead", () => {
    expect(assessTestFile({ path: "tests/a.spec.ts", before: 40, after: 0, exists: false, config }).ok).toBe(true);
    expect(assessTestFile({ path: "tests/a.spec.ts", before: 40, after: 0, exists: true, config }).ok).toBe(false);
  });

  it("accepts an approval pinned to the exact before/after pair", () => {
    const approved = {
      ...config,
      approvedReductions: [
        {
          path: "tests/a.spec.ts",
          before: 40,
          after: 2,
          reason: "feature retired in this PR",
          approvedOn: "2026-09-02",
        },
      ],
    };
    expect(assessTestFile({ path: "tests/a.spec.ts", before: 40, after: 2, config: approved }).ok).toBe(true);
    // A later, larger cut is a different reduction and is not covered by the old approval.
    expect(assessTestFile({ path: "tests/a.spec.ts", before: 40, after: 0, config: approved }).ok).toBe(false);
    // Nor does an approval for one path license another.
    expect(assessTestFile({ path: "tests/b.spec.ts", before: 40, after: 2, config: approved }).ok).toBe(false);
  });
});

describe("assessAggregate — the diff as a whole", () => {
  it("fails a bare mass deletion with no replacement", () => {
    const aggregate = assessAggregate({ verdicts: [{ path: "tests/a.spec.ts", before: 89, after: 9 }], config });
    expect(aggregate.ok).toBe(false);
    expect(aggregate.removed).toBe(80);
  });

  it("passes a spec replaced by its successor in the same commit", () => {
    // The real shape of 4be6d1181 and 7e7bfb2cd: one spec deleted, its replacement added.
    const aggregate = assessAggregate({
      verdicts: [
        { path: "tests/settings-search.dom.test.tsx", before: 17, after: 0 },
        { path: "tests/settings-surface.dom.test.tsx", before: 0, after: 19 },
      ],
      config,
    });
    expect(aggregate.ok).toBe(true);
  });

  it("excuses an aggregate drop only when every shrunk file is individually approved", () => {
    const verdicts = [{ path: "tests/a.spec.ts", before: 40, after: 0 }];
    expect(assessAggregate({ verdicts, config }).ok).toBe(false);
    const approved = {
      ...config,
      approvedReductions: [
        {
          path: "tests/a.spec.ts",
          before: 40,
          after: 0,
          reason: "feature retired in this PR",
          approvedOn: "2026-09-02",
        },
      ],
    };
    expect(assessAggregate({ verdicts, config: approved }).ok).toBe(true);
  });
});

describe("truncationArtefacts", () => {
  it("catches every banner line the incident committed", () => {
    const diff = [
      "--- a/tests/ui-smoke.spec.ts",
      "+++ b/tests/ui-smoke.spec.ts",
      "@@ -0,0 +1,3 @@",
      `+Warning: ${"truncated"} output (original ${"token"} count: 77866)`,
      "+Total output lines: 6009",
      "+",
      "@@ -604,4924 +607 @@",
      `+        confidence: …65866 ${"tokens"} ${"truncated"}…getByRole("heading")`,
    ].join("\n");
    expect(truncationArtefacts(diff).map((found) => found.path)).toEqual([
      "tests/ui-smoke.spec.ts",
      "tests/ui-smoke.spec.ts",
      "tests/ui-smoke.spec.ts",
    ]);
  });

  it("only inspects added lines, so a removed banner is not re-reported", () => {
    const diff = ["+++ b/src/a.ts", "@@ -1 +1 @@", "-Total output lines: 10", "+const answer = 1;"].join("\n");
    expect(truncationArtefacts(diff)).toEqual([]);
  });

  it("leaves ordinary source alone", () => {
    const diff = ["+++ b/src/a.ts", "+// truncate the list to ten entries", "+const rows = all.slice(0, 10);"].join(
      "\n",
    );
    expect(truncationArtefacts(diff)).toEqual([]);
  });

  it("exempts this gate's own files, which necessarily contain the marker text", () => {
    const diff = ["+++ b/scripts/check-diff-integrity.mjs", "+Total output lines: 6009"].join("\n");
    expect(truncationArtefacts(diff)).toEqual([]);
  });

  it("builds its markers without embedding a whole literal in the source", () => {
    expect(truncationMarkers().length).toBeGreaterThan(0);
    const ownSource = readFileSync(SCRIPT, "utf8");
    expect(ownSource).not.toContain(`Warning: ${"truncated"} output (original ${"token"} count`);
  });
});

describe("parseConfig", () => {
  it("accepts the committed configuration", () => {
    expect(config.maxRemovedFraction).toBeGreaterThan(0);
    expect(config.perFileMaxRemovedFraction).toBeGreaterThan(config.maxRemovedFraction);
    expect(Array.isArray(config.approvedReductions)).toBe(true);
  });

  it("rejects thresholds outside (0, 1) and non-positive minimums", () => {
    const base = {
      maxRemovedFraction: 0.25,
      minRemovedCases: 3,
      perFileMaxRemovedFraction: 0.5,
      perFileMinRemovedCases: 10,
      approvedReductions: [],
    };
    for (const override of [
      { maxRemovedFraction: 0 },
      { maxRemovedFraction: 1 },
      { perFileMaxRemovedFraction: 2 },
      { minRemovedCases: 0 },
      { perFileMinRemovedCases: 1.5 },
    ]) {
      expect(() => parseConfig(JSON.stringify({ ...base, ...override }))).toThrow();
    }
  });

  it("requires every approval to carry a substantive reason", () => {
    const base = {
      maxRemovedFraction: 0.25,
      minRemovedCases: 3,
      perFileMaxRemovedFraction: 0.5,
      perFileMinRemovedCases: 10,
    };
    expect(() =>
      parseConfig(
        JSON.stringify({
          ...base,
          approvedReductions: [{ path: "a", before: 1, after: 0, reason: "why", approvedOn: "x" }],
        }),
      ),
    ).toThrow(/at least 12 characters/);
    expect(() =>
      parseConfig(
        JSON.stringify({
          ...base,
          approvedReductions: [{ path: "a", before: 1, reason: "a sufficiently long reason", approvedOn: "x" }],
        }),
      ),
    ).toThrow();
  });
});

describe("isTestFile", () => {
  it("recognises spec and test files across the extensions the repo uses", () => {
    for (const path of ["tests/ui-smoke.spec.ts", "tests/a.dom.test.tsx", "tests/b.test.ts", "scripts/c.test.mjs"]) {
      expect(isTestFile(path)).toBe(true);
    }
    for (const path of ["src/app/page.tsx", "tests/playwright-settlement.ts", "docs/testing.md"]) {
      expect(isTestFile(path)).toBe(false);
    }
  });
});

describe("parseArguments", () => {
  it("accepts the supported forms", () => {
    expect(parseArguments([])).toEqual({ mode: "check", base: "", json: false });
    expect(parseArguments(["--json"])).toEqual({ mode: "check", base: "", json: true });
    expect(parseArguments(["--base", "abc123"])).toEqual({ mode: "check", base: "abc123", json: false });
    expect(parseArguments(["--self-test"]).mode).toBe("self-test");
  });

  it("rejects misuse rather than guessing", () => {
    expect(() => parseArguments(["--self-test", "--json"])).toThrow();
    expect(() => parseArguments(["--base"])).toThrow();
    expect(() => parseArguments(["--base", "--json"])).toThrow();
    expect(() => parseArguments(["--base", "a", "--base", "b"])).toThrow();
    expect(() => parseArguments(["--unknown"])).toThrow();
  });
});

describe("resolveBase", () => {
  it("uses local main only when the remote-tracking ref is absent, preserving failure boundaries", () => {
    const cwd = mkdtempSync(join(tmpdir(), "diff-integrity-base-"));
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git(["init", "-b", "main"]);
      git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "base",
      ]);
      const base = git(["rev-parse", "HEAD"]);
      git(["checkout", "-b", "feature"]);
      git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "feature",
      ]);
      expect(resolveBase({ env: {}, git })).toBe(base);
      expect(() => resolveBase({ requested: "missing", env: {}, git })).toThrow(/cannot resolve --base/);
      git(["update-ref", "-d", "refs/heads/main"]);
      expect(() => resolveBase({ env: {}, git })).toThrow(/cannot resolve a comparison base/);
      git(["update-ref", "refs/heads/main", base]);
      const tree = git(["rev-parse", "HEAD^{tree}"]);
      const unrelated = git([
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit-tree",
        tree,
        "-m",
        "unrelated",
      ]);
      git(["update-ref", "refs/remotes/origin/main", unrelated]);
      expect(() => resolveBase({ env: {}, git })).toThrow(/cannot resolve a comparison base/);
      git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      expect(resolveBase({ env: {}, git })).toBe(git(["rev-parse", "HEAD"]));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fails closed when no base can be resolved, naming the shallow-clone remedy", () => {
    const git = () => {
      throw new Error("no merge base");
    };
    expect(() => resolveBase({ env: {}, git })).toThrow(/git fetch --deepen=2000/);
  });

  it("treats a push event's all-zero SHA as no base, not as a base to resolve", () => {
    const calls: string[][] = [];
    const git = (args: string[]) => {
      calls.push(args);
      return "a".repeat(40);
    };
    resolveBase({ env: { DIFF_INTEGRITY_BASE_SHA: "0".repeat(40) }, git });
    expect(calls.at(-1)).toEqual(["merge-base", "HEAD", "refs/remotes/origin/main"]);
  });

  it("prefers an explicit base, then the environment, then the merge base", () => {
    const calls: string[][] = [];
    const git = (args: string[]) => {
      calls.push(args);
      return "a".repeat(40);
    };
    resolveBase({ requested: "feature", env: {}, git });
    expect(calls[0]).toContain("rev-parse");
    calls.length = 0;
    resolveBase({ env: { DIFF_INTEGRITY_BASE_SHA: "envsha" }, git });
    expect(calls[0].join(" ")).toContain("envsha");
    calls.length = 0;
    resolveBase({ env: {}, git });
    expect(calls.at(-1)).toEqual(["merge-base", "HEAD", "refs/remotes/origin/main"]);
  });
});

describe("changedPaths", () => {
  it("decodes the NUL-separated name-status stream, including renames and deletions", () => {
    const git = () =>
      [
        "M",
        "tests/a.spec.ts",
        "A",
        "tests/b.spec.ts",
        "D",
        "tests/c.spec.ts",
        "R096",
        "tests/d.spec.ts",
        "tests/e.spec.ts",
        "",
      ].join("\0");
    expect(changedPaths("base", git)).toEqual([
      { status: "M", before: "tests/a.spec.ts", after: "tests/a.spec.ts" },
      { status: "A", before: null, after: "tests/b.spec.ts" },
      { status: "D", before: "tests/c.spec.ts", after: null },
      { status: "R096", before: "tests/d.spec.ts", after: "tests/e.spec.ts" },
    ]);
  });
});

describe("untrackedTestFiles", () => {
  it("returns only untracked test files, so a not-yet-added replacement spec still counts", () => {
    const git = () => ["tests/new.spec.ts", "docs/notes.md", "src/a.ts", "tests/b.dom.test.tsx", ""].join("\0");
    expect(untrackedTestFiles(git)).toEqual(["tests/new.spec.ts", "tests/b.dom.test.tsx"]);
  });

  it("degrades to empty rather than failing when git cannot answer", () => {
    expect(
      untrackedTestFiles(() => {
        throw new Error("not a work tree");
      }),
    ).toEqual([]);
  });
});

describe("evaluate", () => {
  it("refuses rather than passes when the before-state cannot be read", () => {
    const git = (args: string[]) => {
      if (args[0] === "diff" && args[1] === "--name-status") return ["M", "tests/a.spec.ts", ""].join("\0");
      if (args[0] === "show") throw new Error("fatal: path does not exist (shallow clone)");
      return "";
    };
    const result = evaluate({ base: "b".repeat(40), git, config, readWorkingFile: () => 'test("a", () => {});' });
    expect(result.verdicts[0].ok).toBe(false);
    expect(result.verdicts[0].message).toContain("refusing to pass without the before-state");
  });

  it("counts a rename out of a test filename as total loss, not as unchanged", () => {
    // tests/a.test.ts -> src/a.ts keeps every `test(...)` body, so counting the destination
    // reports 20 -> 20 and passes, even though the runner discovers none of them any more.
    const source = Array.from({ length: 20 }, (_, index) => `test("case ${index}", () => {});`).join("\n");
    const git = (args: string[]) =>
      args[0] === "diff" && args[1] === "--name-status"
        ? ["R100", "tests/a.test.ts", "src/a.ts", ""].join("\0")
        : args[0] === "show"
          ? source
          : "";
    const result = evaluate({ base: "d".repeat(40), git, config, readWorkingFile: () => source });
    const verdict = result.verdicts[0];
    expect(verdict.before).toBe(20);
    expect(verdict.after).toBe(0);
    expect(result.aggregate.ok).toBe(false);
  });

  it("still follows a rename that stays within test filenames", () => {
    const source = Array.from({ length: 20 }, (_, index) => `test("case ${index}", () => {});`).join("\n");
    const git = (args: string[]) =>
      args[0] === "diff" && args[1] === "--name-status"
        ? ["R100", "tests/a.test.ts", "tests/b.test.ts", ""].join("\0")
        : args[0] === "show"
          ? source
          : "";
    const result = evaluate({ base: "e".repeat(40), git, config, readWorkingFile: () => source });
    expect(result.verdicts[0].before).toBe(20);
    expect(result.verdicts[0].after).toBe(20);
    expect(result.aggregate.ok).toBe(true);
  });

  it("counts an added spec towards the aggregate so a replacement nets out", () => {
    const before = Array.from({ length: 20 }, (_, index) => `test("case ${index}", () => {});`).join("\n");
    const after = Array.from({ length: 20 }, (_, index) => `test("moved ${index}", () => {});`).join("\n");
    const git = (args: string[]) => {
      if (args[0] === "diff" && args[1] === "--name-status") {
        return ["D", "tests/old.spec.ts", "A", "tests/new.spec.ts", ""].join("\0");
      }
      if (args[0] === "show") return before;
      return "";
    };
    const result = evaluate({
      base: "c".repeat(40),
      git,
      config,
      readWorkingFile: (path) => (path === "tests/new.spec.ts" ? after : null),
    });
    expect(result.aggregate.before).toBe(20);
    expect(result.aggregate.after).toBe(20);
    expect(result.aggregate.ok).toBe(true);
    expect(result.verdicts.every((verdict) => verdict.ok)).toBe(true);
  });
});

describe("CI wiring", () => {
  const workflow = readFileSync(resolve(REPOSITORY_ROOT, ".github/workflows/ci.yml"), "utf8");

  it("runs the gate unconditionally, because any scope predicate is a hole", () => {
    // A workflow-only diff sets coverage_changed, ui_changed, static_heavy_changed and
    // docs_changed all false (node scripts/ci-change-scope.mjs --files .github/workflows/ci.yml),
    // so a predicate list would skip the gate exactly where rule 2's all-file invariant still
    // applies: a truncation banner lands in YAML as easily as in a spec.
    const step = workflow.slice(workflow.indexOf("- name: Diff integrity"));
    const body = step.slice(0, step.indexOf("- name:", 1));
    expect(body).toContain("run: npm run check:diff-integrity");
    expect(body).not.toMatch(/^\s*if:/m);
  });

  it("passes the base SHA the same way the other diff-based gates do", () => {
    const step = workflow.slice(workflow.indexOf("- name: Diff integrity"));
    const body = step.slice(0, step.indexOf("- name:", 1));
    expect(body).toContain("DIFF_INTEGRITY_BASE_SHA:");
    expect(body).toContain("github.event.pull_request.base.sha");
  });
});

describe("the gate as shipped", () => {
  it("passes its own self-test", () => {
    expect(selfTest(() => {})).toBe(true);
  });

  it("exits 2 on CLI misuse and 0 on --self-test", () => {
    const misuse = spawnSync(process.execPath, [SCRIPT, "--nonsense"], { encoding: "utf8" });
    expect(misuse.status).toBe(2);
    const ok = spawnSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8" });
    expect(ok.status).toBe(0);
  });

  it.runIf(gitAvailable(INCIDENT))("would have rejected the commit that motivated it (#Y30AXB, d1485d6e8)", () => {
    // Replay the historical commit through the same seams the CLI uses: the diff is taken
    // against the commit rather than the working tree, and "after" is read from it.
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd: REPOSITORY_ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).trim();
    const base = run(["rev-parse", `${INCIDENT}^`]);
    const git = (args: string[]) => run(args[0] === "diff" ? [...args, INCIDENT] : args);
    const readWorkingFile = (path: string) => {
      try {
        return execFileSync("git", ["show", `${INCIDENT}:${path}`], {
          cwd: REPOSITORY_ROOT,
          encoding: "utf8",
          maxBuffer: 1 << 28,
        });
      } catch {
        return null;
      }
    };

    const { verdicts, aggregate, artefacts } = evaluate({ base, git, config, readWorkingFile });

    const smoke = verdicts.find((verdict) => verdict.path === "tests/ui-smoke.spec.ts");
    expect(smoke).toBeDefined();
    expect(smoke?.before).toBe(89);
    expect(smoke?.after).toBe(9);
    expect(smoke?.ok).toBe(false);
    expect(aggregate.ok).toBe(false);
    // And independently, on the truncation banner the tool wrote into the file.
    expect(artefacts.length).toBeGreaterThanOrEqual(3);
  });
});
