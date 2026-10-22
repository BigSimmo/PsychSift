import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeReviewDateScope,
  expiredReviewDateDisposition,
  gitTouchedFiles,
  NOT_BLOCKING_NOTE,
  reportExpiredReviewDate,
  resolveReviewDateScope,
  resolveGovernanceReviewDateScope,
  STRICT_REVIEW_DATE_SCOPE,
  type ReviewDateScope,
} from "../scripts/organisation/review-date-scope.mjs";

// Organisation framework suggestion 6, "defuse the date traps": the shared rule that decides
// whether an expired governance review date blocks a run. Strict unless pull-request CI asks.

const REGISTER = "docs/register.json";
const listed = (files: string[]) => () => ({ ok: true as const, files });
const PR_ENV = { REVIEW_DATE_MODE: "pr", BASE_SHA: "abc1234", HEAD_SHA: "def5678", GITHUB_EVENT_NAME: "pull_request" };

describe("resolving the review-date scope", () => {
  it("is strict, silently, when nothing asks for pull-request mode", () => {
    for (const env of [
      {},
      { REVIEW_DATE_MODE: "" },
      { REVIEW_DATE_MODE: "strict" },
      { REVIEW_DATE_MODE: " strict " },
    ]) {
      const scope = resolveReviewDateScope({ env, root: ".", listTouched: listed(["x"]) });
      expect(scope).toMatchObject({ mode: "strict", touched: null, notes: [] });
    }
  });

  it("is pull-request mode only with an explicit request and a usable base", () => {
    const calls: string[][] = [];
    const scope = resolveReviewDateScope({
      env: PR_ENV,
      root: "/repo",
      listTouched: (root, base, head) => {
        calls.push([root, base, head]);
        return { ok: true, files: ["a.ts", "docs/b.md"] };
      },
    });
    expect(scope).toEqual({
      mode: "pr",
      touched: ["a.ts", "docs/b.md"],
      base: "abc1234",
      head: "def5678",
      mergeBase: null,
      read: expect.any(Function),
      notes: [],
    });
    expect(calls).toEqual([["/repo", "abc1234", "def5678"]]);
  });

  it("accepts a pull-request or merge-queue event and defaults the head to HEAD", () => {
    for (const event of ["pull_request", "merge_group"]) {
      const heads: string[] = [];
      const scope = resolveReviewDateScope({
        env: { ...PR_ENV, HEAD_SHA: "", GITHUB_EVENT_NAME: event },
        root: ".",
        listTouched: (_root, _base, head) => {
          heads.push(head);
          return { ok: true, files: [] };
        },
      });
      expect(scope.mode).toBe("pr");
      expect(heads).toEqual(["HEAD"]);
    }
  });

  it("judges a push to main by what the push changed, and keeps pushes to other branches strict", () => {
    const main = resolveReviewDateScope({
      env: { ...PR_ENV, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" },
      root: ".",
      listTouched: listed(["docs/a.md"]),
    });
    expect(main.mode).toBe("pr");
    expect(main.touched).toEqual(["docs/a.md"]);
    for (const GITHUB_REF of ["refs/heads/release/2026-10", "refs/heads/feature", undefined]) {
      const other = resolveReviewDateScope({
        env: { ...PR_ENV, GITHUB_EVENT_NAME: "push", GITHUB_REF },
        root: ".",
        listTouched: listed([]),
      });
      expect(other.mode).toBe("strict");
      expect(other.notes.join(" ")).toContain("not refs/heads/main");
    }
  });

  it("refuses, with a note, on any other GitHub event: pushes off main, schedules, manual runs", () => {
    for (const event of ["push", "schedule", "workflow_dispatch"]) {
      const scope = resolveReviewDateScope({
        env: { ...PR_ENV, GITHUB_EVENT_NAME: event },
        root: ".",
        listTouched: listed([]),
      });
      expect(scope.mode).toBe("strict");
      expect(scope.notes.join(" ")).toContain(`the GitHub event is ${event}`);
    }
  });

  it("refuses, with a note, when no GitHub event is named: pr mode is for pull-request CI only", () => {
    for (const GITHUB_EVENT_NAME of [undefined, "", "   "]) {
      const scope = resolveReviewDateScope({
        env: { ...PR_ENV, GITHUB_EVENT_NAME },
        root: ".",
        listTouched: listed([]),
      });
      expect(scope.mode).toBe("strict");
      expect(scope.notes.join(" ")).toContain("GITHUB_EVENT_NAME is not set");
      expect(scope.notes.join(" ")).toContain("expired review dates block as usual");
    }
  });

  it("refuses, with a note, a misspelt mode or a missing, zero or malformed revision", () => {
    const cases: [Record<string, string>, string][] = [
      [{ ...PR_ENV, REVIEW_DATE_MODE: "PR" }, 'the only other accepted value is "pr"'],
      [{ ...PR_ENV, REVIEW_DATE_MODE: "off" }, 'the only other accepted value is "pr"'],
      [{ ...PR_ENV, BASE_SHA: "" }, "BASE_SHA is not set"],
      [{ ...PR_ENV, BASE_SHA: "0".repeat(40) }, "BASE_SHA is not set"],
      [{ ...PR_ENV, BASE_SHA: "--output=/tmp/x" }, "malformed"],
      [{ ...PR_ENV, HEAD_SHA: "-p" }, "malformed"],
      [{ ...PR_ENV, BASE_SHA: "abc 123" }, "malformed"],
    ];
    for (const [env, why] of cases) {
      const scope = resolveReviewDateScope({ env, root: ".", listTouched: listed(["x"]) });
      expect(scope.mode).toBe("strict");
      expect(scope.touched).toBeNull();
      expect(scope.notes.join(" ")).toContain(why);
      expect(scope.notes.join(" ")).toContain("expired review dates block as usual");
    }
  });

  it("refuses, with a note, when the changed files cannot be listed", () => {
    const failed = resolveReviewDateScope({
      env: PR_ENV,
      root: ".",
      listTouched: () => ({ ok: false, reason: "the base abc1234 is not reachable" }),
    });
    expect(failed.mode).toBe("strict");
    expect(failed.notes.join(" ")).toContain("the base abc1234 is not reachable");

    const threw = resolveReviewDateScope({
      env: PR_ENV,
      root: ".",
      listTouched: () => {
        throw new Error("git exploded");
      },
    });
    expect(threw.mode).toBe("strict");
    expect(threw.notes.join(" ")).toContain("git exploded");
  });
});

describe("whether an expired date blocks", () => {
  const pr = (touched: string[]): ReviewDateScope => ({ mode: "pr", touched, base: "b", head: "h", notes: [] });

  it("always blocks without a well-formed pull-request scope", () => {
    const malformed = { mode: "pr", touched: null, base: null, head: null, notes: [] } as unknown as ReviewDateScope;
    for (const scope of [undefined, null, STRICT_REVIEW_DATE_SCOPE, malformed]) {
      expect(expiredReviewDateDisposition(scope, { registerPath: REGISTER, coveredPaths: ["a.ts"] })).toEqual({
        blocking: true,
        because: null,
      });
    }
  });

  it("blocks a pull request that touches the register or a covered path, and says which", () => {
    expect(expiredReviewDateDisposition(pr(["z.ts", REGISTER]), { registerPath: REGISTER, coveredPaths: [] })).toEqual({
      blocking: true,
      because: REGISTER,
    });
    // A covered reference may carry an anchor; the path is what counts.
    expect(
      expiredReviewDateDisposition(pr(["docs/pia.md"]), {
        registerPath: REGISTER,
        coveredPaths: ["src/a.ts", "docs/pia.md#section-6", 42],
      }),
    ).toEqual({ blocking: true, because: "docs/pia.md" });
  });

  it("blocks on a register touch only when this entry changed (owner decision 2026-09-26)", () => {
    const registers: Record<string, string> = {
      base: JSON.stringify({
        reviewExpiresAt: "2026-01-01",
        items: [
          { id: "H1", note: "a" },
          { id: "H2", note: "b" },
        ],
      }),
      head: JSON.stringify({
        reviewExpiresAt: "2026-01-01",
        items: [
          { id: "H1", note: "a" },
          { id: "H2", note: "c" },
        ],
      }),
    };
    const scope: ReviewDateScope = {
      ...pr([REGISTER]),
      mergeBase: "base",
      head: "head",
      read: (revision: string) => registers[revision] ?? null,
    };
    const item = (id: string) => (register: { items: { id: string }[] }) => register.items.find((i) => i.id === id);
    expect(expiredReviewDateDisposition(scope, { registerPath: REGISTER, select: item("H1") })).toEqual({
      blocking: false,
      because: null,
    });
    expect(expiredReviewDateDisposition(scope, { registerPath: REGISTER, select: item("H2") })).toEqual({
      blocking: true,
      because: `this entry in ${REGISTER}`,
    });
    // A covered path still blocks even when the entry itself is unchanged.
    expect(
      expiredReviewDateDisposition(
        { ...scope, touched: [REGISTER, "src/a.ts"] },
        {
          registerPath: REGISTER,
          coveredPaths: ["src/a.ts"],
          select: item("H1"),
        },
      ),
    ).toEqual({ blocking: true, because: "src/a.ts" });
    // Unreadable or unparseable copies, a missing merge base, or no selector: still blocks.
    for (const broken of [
      { ...scope, read: () => null },
      { ...scope, read: () => "{not json" },
      { ...scope, mergeBase: null },
    ]) {
      expect(expiredReviewDateDisposition(broken, { registerPath: REGISTER, select: item("H1") }).blocking).toBe(true);
    }
    expect(expiredReviewDateDisposition(scope, { registerPath: REGISTER }).blocking).toBe(true);
  });

  it("canonicalises covered paths before matching, and lets a folder cover the files under it", () => {
    const covers = (touched: string[], coveredPaths: unknown[]) =>
      expiredReviewDateDisposition(pr(touched), { registerPath: REGISTER, coveredPaths });
    expect(covers(["src/a.ts"], ["./src/a.ts"])).toEqual({ blocking: true, because: "src/a.ts" });
    expect(covers(["src/a.ts"], ["src//lib/../a.ts#anchor"])).toEqual({ blocking: true, because: "src/a.ts" });
    expect(covers(["src/lib/deep/b.ts"], ["src/lib/"])).toEqual({ blocking: true, because: "src/lib/deep/b.ts" });
    expect(covers(["src/lib/b.ts"], ["./src/lib"])).toEqual({ blocking: true, because: "src/lib/b.ts" });
    // A folder prefix is a whole segment: src/lib does not cover src/library.ts.
    expect(covers(["src/library.ts"], ["src/lib"]).blocking).toBe(false);
    // The repository root is not a usable reference and never covers everything.
    expect(covers(["src/a.ts"], ["./", ".", "/"]).blocking).toBe(false);
  });

  it("does not block a pull request that touches neither", () => {
    expect(
      expiredReviewDateDisposition(pr(["README.md", "docs/register.json.bak"]), {
        registerPath: REGISTER,
        coveredPaths: ["src/a.ts"],
      }),
    ).toEqual({ blocking: false, because: null });
    expect(expiredReviewDateDisposition(pr([]), { registerPath: REGISTER, coveredPaths: ["src/a.ts"] }).blocking).toBe(
      false,
    );
  });

  it("keeps the exact message when strict, names the touched path in pr mode, and never drops a warning", () => {
    const sink = () => ({ errors: [] as string[], warnings: [] as string[], registerPath: REGISTER });
    const strictSink = { ...sink(), scope: STRICT_REVIEW_DATE_SCOPE };
    expect(reportExpiredReviewDate(strictSink, "H1: review has expired", ["src/a.ts"])).toBe(true);
    expect(strictSink.errors).toEqual(["H1: review has expired"]);

    const touching = { ...sink(), scope: pr(["src/a.ts"]) };
    reportExpiredReviewDate(touching, "H1: review has expired", ["src/a.ts"]);
    expect(touching.errors).toEqual(["H1: review has expired (blocking: this change touches src/a.ts)"]);

    const unrelated = { ...sink(), scope: pr(["README.md"]) };
    expect(reportExpiredReviewDate(unrelated, "H1: review has expired", ["src/a.ts"])).toBe(false);
    expect(reportExpiredReviewDate(unrelated, "An exception has expired. Re-review it.", ["src/a.ts"])).toBe(false);
    expect(unrelated.errors).toEqual([]);
    expect(unrelated.warnings).toEqual([
      `H1: review has expired. ${NOT_BLOCKING_NOTE}`,
      `An exception has expired. Re-review it. ${NOT_BLOCKING_NOTE}`,
    ]);
  });

  it("describes the scope for a pass line", () => {
    expect(describeReviewDateScope(STRICT_REVIEW_DATE_SCOPE)).toBe("review-dates=strict");
    expect(describeReviewDateScope(undefined)).toBe("review-dates=strict");
    expect(describeReviewDateScope(pr(["a", "b"]))).toBe("review-dates=pr touched=2");
  });
});

describe("listing the files a change touched", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function git(root: string, ...args: string[]) {
    const result = spawnSync(
      "git",
      ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-C", root, ...args],
      { encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  }

  function write(root: string, file: string, text: string) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }

  function repo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-date-scope-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    write(root, REGISTER, "{}\n");
    write(root, "src/old.ts", "export const a = 1;\n");
    write(root, "src/keep.ts", "export const b = 1;\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "feature");
    git(root, "mv", "src/old.ts", "src/new.ts");
    write(root, "src/keep.ts", "export const b = 2;\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "feature");
    const head = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-q", "main");
    // main moves on after the branch point: its register edit is not the change's doing.
    write(root, REGISTER, '{ "edited": true }\n');
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "main moves on");
    const base = git(root, "rev-parse", "HEAD");
    return { root, base, head };
  }

  it("lists only the change's own files from the merge base, with a rename as both paths", () => {
    const { root, base, head } = repo();
    const listedFiles = gitTouchedFiles(root, base, head);
    expect(listedFiles).toEqual({
      ok: true,
      files: ["src/keep.ts", "src/new.ts", "src/old.ts"],
      mergeBase: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
  });

  it("feeds pull-request mode end to end, and reports an unreachable base as a refusal", () => {
    const { root, base, head } = repo();
    const scope = resolveReviewDateScope({
      env: { REVIEW_DATE_MODE: "pr", BASE_SHA: base, HEAD_SHA: head, GITHUB_EVENT_NAME: "pull_request" },
      root,
    });
    expect(scope).toMatchObject({ mode: "pr", touched: ["src/keep.ts", "src/new.ts", "src/old.ts"] });

    const missing = "1".repeat(40);
    expect(gitTouchedFiles(root, missing, head).ok).toBe(false);
    const refused = resolveReviewDateScope({
      env: { REVIEW_DATE_MODE: "pr", BASE_SHA: missing, HEAD_SHA: head, GITHUB_EVENT_NAME: "merge_group" },
      root,
    });
    expect(refused.mode).toBe("strict");
    expect(refused.notes.join(" ")).toContain("could not be listed");
  });

  function developmentRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "development-review-scope-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    write(root, REGISTER, JSON.stringify({ items: [{ id: "expired", review: "old" }, { id: "other" }] }));
    write(root, "src/covered.ts", "old\n");
    write(root, "src/renamed.ts", "old\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "base");
    const base = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "-q", "-b", "development");
    const scope = (extra: string[] = [], env = {}) =>
      resolveGovernanceReviewDateScope({ root, argv: ["--development", "--base", base, ...extra], env });
    const disposition = (value: ReviewDateScope, coveredPaths: string[] = []) =>
      expiredReviewDateDisposition(value, {
        registerPath: REGISTER,
        coveredPaths,
        select: (register: { items: { id: string; review?: string }[] }) =>
          register.items.find((entry) => entry.id === "expired"),
      });
    return { root, base, scope, disposition };
  }

  it("permits unrelated expired reviews locally with an explicit base and no release claim", () => {
    const { root, base, scope, disposition } = developmentRepo();
    write(root, "docs/unrelated.md", "synthetic\n");
    const value = scope();
    expect(value).toMatchObject({ mode: "development", base, head: "WORKTREE", touched: ["docs/unrelated.md"] });
    expect(disposition(value, ["src/covered.ts"]).blocking).toBe(false);
    expect(describeReviewDateScope(value)).toContain("release-ready=false");
  });

  it("includes committed, staged, unstaged, untracked and both renamed paths", () => {
    const { root, scope, disposition } = developmentRepo();
    write(root, "committed.txt", "synthetic\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "feature");
    write(root, "src/covered.ts", "staged\n");
    git(root, "add", "src/covered.ts");
    write(root, "src/covered.ts", "old\n");
    git(root, "mv", "src/renamed.ts", "src/new.ts");
    write(root, "new.txt", "synthetic\n");
    const value = scope();
    expect(value.touched).toEqual(["committed.txt", "new.txt", "src/covered.ts", "src/new.ts", "src/renamed.ts"]);
    for (const file of value.touched ?? []) expect(disposition(value, [file]).blocking).toBe(true);
  });

  it.each(["unstaged", "staged", "staged-restored", "malformed", "deleted"])(
    "blocks an expired register entry changed in %s state",
    (state) => {
      const { root, scope, disposition } = developmentRepo();
      const original = fs.readFileSync(path.join(root, REGISTER), "utf8");
      write(root, REGISTER, state === "malformed" ? "{" : original.replace('"old"', '"edited"'));
      if (state.startsWith("staged")) git(root, "add", REGISTER);
      if (state === "staged-restored") write(root, REGISTER, original);
      if (state === "deleted") fs.unlinkSync(path.join(root, REGISTER));
      expect(disposition(scope()).blocking).toBe(true);
    },
  );

  it("allows edits to another register entry without excusing edits to the expired one", () => {
    const { root, scope, disposition } = developmentRepo();
    const register = JSON.parse(fs.readFileSync(path.join(root, REGISTER), "utf8"));
    register.items[1].review = "new";
    write(root, REGISTER, JSON.stringify(register));
    expect(disposition(scope()).blocking).toBe(false);
  });

  it("retains strict defaults and release precedence over development or CI settings", () => {
    const { root, base, scope } = developmentRepo();
    expect(resolveGovernanceReviewDateScope({ root, argv: [], env: {} }).mode).toBe("strict");
    expect(
      scope(["--release"], { REVIEW_DATE_MODE: "pr", GITHUB_EVENT_NAME: "pull_request", BASE_SHA: base }).mode,
    ).toBe("strict");
    for (const env of [{ CI: "true" }, { GITHUB_ACTIONS: "true" }, { GITHUB_EVENT_NAME: "pull_request" }])
      expect(scope([], env).mode).toBe("strict");
    for (const argv of [
      ["--development"],
      ["--development", "--base", "HEAD"],
      ["--development", "--base", "1".repeat(40)],
    ])
      expect(resolveGovernanceReviewDateScope({ root, argv, env: {} }).mode).toBe("strict");
    git(root, "checkout", "-q", "main");
    expect(scope().mode).toBe("strict");
    git(root, "checkout", "-q", "-b", "release/test");
    expect(scope().mode).toBe("strict");
  });
});
