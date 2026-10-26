import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkRepoAwarenessSnapshot,
  compareSnapshots,
  isGitRepository,
} from "../scripts/check-repo-awareness-snapshot";
import { generate } from "../scripts/generate-repo-awareness-snapshot";

const regenerated = generate();

describe("compareSnapshots", () => {
  it("reports no differences for the snapshot it was generated from", () => {
    expect(compareSnapshots(structuredClone(regenerated), regenerated)).toEqual([]);
  });

  it("ignores captured_revision, which changes as a side effect of committing", () => {
    const committed = structuredClone(regenerated);
    committed.captured_revision = { committed_at: "2020-01-01" };
    expect(compareSnapshots(committed, regenerated)).toEqual([]);
  });

  it("catches a version mismatch", () => {
    const committed = structuredClone(regenerated);
    committed.version = "repo-awareness-snapshot-v0";
    expect(compareSnapshots(committed, regenerated).join(" ")).toMatch(/version/);
  });

  it("catches a content difference in compared sections", () => {
    // A small change *inside* each compared section, proving the gate looks
    // within a section rather than merely comparing the top-level key set.
    const mutations: Record<string, (snapshot: typeof regenerated) => void> = {
      // v3 removed the stored counts these two used to nudge. Adding an entry
      // to the section's own list is the same probe and a stricter one: it is
      // the content the gate exists to compare, not a total derived from it.
      routes: (snapshot) =>
        void snapshot.routes.pages.push({ path: "/gate-probe", file: "src/app/gate-probe/page.tsx", area: "product" }),
      documentation: (snapshot) =>
        void snapshot.documentation.documents.push({ path: "docs/gate-probe.md", section: "root", catalogued: false }),
      test_health: (snapshot) => void (snapshot.test_health.note = "changed"),
    };

    for (const [section, mutate] of Object.entries(mutations)) {
      const committed = structuredClone(regenerated);
      mutate(committed);
      expect(compareSnapshots(committed, regenerated).join(" ")).toMatch(section);
    }
  });

  it("ignores review_state differences to eliminate concurrent review record merge conflicts", () => {
    const committed = structuredClone(regenerated);
    committed.review_state.records = [
      {
        date: "2026-08-28",
        ref: "claude/concurrent-test",
        head: "0".repeat(40),
        scope: "test",
        outcome: "Approved",
        checks: "passed",
      },
      ...committed.review_state.records,
    ];
    expect(compareSnapshots(committed, regenerated)).toEqual([]);
  });

  it("catches a missing snapshot rather than treating it as in step", () => {
    expect(compareSnapshots(null, regenerated).join(" ")).toMatch(/missing|version/);
  });

  it("reports a scalar committed snapshot as stale instead of throwing", () => {
    expect(compareSnapshots("not-a-snapshot", regenerated).join(" ")).toMatch(/version|missing/);
  });

  it("catches a key the generator no longer emits", () => {
    const committed = { ...structuredClone(regenerated), legacy_section: {} };
    expect(compareSnapshots(committed, regenerated).join(" ")).toMatch(/legacy_section/);
  });
});

describe("checkRepoAwarenessSnapshot", () => {
  it("skips gracefully with exit 0 when git is missing or fails in the environment", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | null = null;

    const code = checkRepoAwarenessSnapshot({
      generateImpl: () => {
        throw new Error("spawnSync git ENOENT");
      },
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
      exit: (c) => {
        exitCode = c;
      },
    });

    expect(code).toBe(0);
    expect(exitCode).toBeNull();
    expect(logs.join(" ")).toContain("git is not available");
    expect(errors).toHaveLength(0);
  });

  it("fails, not skips, when a generator input file is missing", () => {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | null = null;

    const code = checkRepoAwarenessSnapshot({
      isGitRepoImpl: () => true,
      generateImpl: () => {
        throw new Error("ENOENT: no such file or directory, open 'docs/README.md'");
      },
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
      exit: (c) => {
        exitCode = c;
      },
    });

    expect(code).toBe(1);
    expect(exitCode).toBe(1);
    expect(logs.join(" ")).not.toContain("skipped");
    expect(errors.join(" ")).toContain("generation failed");
  });

  it("skips without generating at all when no git repository is rooted here", () => {
    // The branch that actually fires in a `git archive` export, and the one the
    // existing coverage above misses: it drives the message-sniffing catch by
    // throwing from `generateImpl`, which is a different path. Here generation
    // must never be reached, because in a git-less checkout the generator would
    // silently fall back to a filesystem scan and compare a plausible-looking
    // wrong answer.
    const logs: string[] = [];
    const errors: string[] = [];
    let generated = false;
    let exitCode: number | null = null;

    const code = checkRepoAwarenessSnapshot({
      isGitRepoImpl: () => false,
      generateImpl: () => {
        generated = true;
        return regenerated;
      },
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
      exit: (c) => {
        exitCode = c;
      },
    });

    expect(code).toBe(0);
    expect(exitCode).toBeNull();
    expect(generated).toBe(false);
    expect(errors).toHaveLength(0);
    // The skip shares its exit code with a pass, so the message is the only
    // thing that distinguishes them — it has to say both what was skipped and
    // that CI still covers it.
    expect(logs.join(" ")).toMatch(/Skipped: no git repository rooted here/);
    expect(logs.join(" ")).toMatch(/CI runs it against a real checkout/);
  });

  it("rejects a repository that is merely an ancestor, not this checkout", () => {
    // The exact shape that produced the unexplained red: a `git archive` export
    // extracted INSIDE another checkout. `--is-inside-work-tree` answered the
    // OUTER repository's `true`, the generator then read that repository, found
    // every document untracked, and threw a six-hundred-path error the skip
    // could not recognise — exit 1 with no explanation (`#JFRCZ4`).
    const outer = mkdtempSync(join(tmpdir(), "repo-awareness-outer-"));
    try {
      execFileSync("git", ["init", "--quiet", "."], { cwd: outer, stdio: "ignore" });
      const nested = join(outer, "nested-export");
      mkdirSync(nested);

      // A directory that is inside a work tree but is not its root: git answers
      // happily here, and answers about the wrong repository.
      expect(
        execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: nested, encoding: "utf8" }).trim(),
      ).toBe("true");
      expect(isGitRepository(nested)).toBe(false);

      // The outer repository's own root still answers true, so the check
      // distinguishes "not this checkout" from "no git at all".
      expect(isGitRepository(outer)).toBe(true);
    } finally {
      // Bounded retries, per the repo convention: on Windows a recursive delete
      // races the locks git still holds over the objects it just wrote.
      rmSync(outer, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("still recognises this checkout, so the tightened check has not disabled the gate", () => {
    expect(isGitRepository(process.cwd())).toBe(true);
  });

  it("passes with exit 0 when committed snapshot matches generated snapshot", () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const code = checkRepoAwarenessSnapshot({
      generateImpl: () => regenerated,
      readCommittedImpl: () => structuredClone(regenerated),
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
    });

    expect(code).toBe(0);
    expect(logs.join(" ")).toContain("in step with");
    expect(errors).toHaveLength(0);
  });
});
