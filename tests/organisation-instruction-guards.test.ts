import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateBudget, loadBudget } from "../scripts/organisation/check-instruction-budget.mjs";
import {
  findRetiredRuleHits,
  isInstructionFile,
  loadRetiredRules,
  parseAddedLines,
  textLines,
} from "../scripts/organisation/check-retired-rules.mjs";

const SCRIPTS = path.resolve(__dirname, "../scripts/organisation");
const RETIRED = path.join(SCRIPTS, "check-retired-rules.mjs");
const BUDGET = path.join(SCRIPTS, "check-instruction-budget.mjs");
const COMBINED = path.join(SCRIPTS, "check-instructions.mjs");
const REPO_RULES = path.resolve(__dirname, "../docs/organisation/retired-rules.json");
const ZERO = "0".repeat(40);
const dirs: string[] = [];

type Files = Record<string, string>;

const TEST_RULES = JSON.stringify({
  version: 1,
  rules: [
    {
      id: "blue-form",
      retired: "2026-01-02",
      summary: "The blue form was retired.",
      pattern: "blue form",
      allowedContext: "no longer|retired|there is no",
    },
  ],
});

function git(root: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-C", root, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(root: string, files: Files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "instruction-guards-"));
  dirs.push(dir);
  return dir;
}

function repo(files: Files) {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  write(root, {
    "docs/organisation/retired-rules.json": TEST_RULES,
    "docs/organisation/instruction-budget.json": JSON.stringify({ version: 1, files: { "AGENTS.md": 100 } }),
    "AGENTS.md": "short\n",
    ...files,
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return { root, base: git(root, "rev-parse", "HEAD") };
}

function commit(root: string, files: Files) {
  write(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "change");
  return git(root, "rev-parse", "HEAD");
}

function run(script: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, INSTRUCTIONS_CHECK_MODE: "", BASE_SHA: "", HEAD_SHA: "", GITHUB_ACTIONS: "", ...env },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("retired rules: negation handling", () => {
  const rules = loadRetiredRules(fs.readFileSync(REPO_RULES, "utf8"));
  const hitsFor = (text: string) => findRetiredRuleHits(textLines("AGENTS.md", text), rules).map((hit) => hit.ruleId);

  it("does not fire on the sentence that records the label gate's retirement", () => {
    expect(
      hitsFor("production deploy. There is no `owner-approved` label gate and no `Owner approval` commit status;"),
    ).toEqual([]);
  });

  it("fires when the label gate is stated as current", () => {
    expect(hitsFor("- Never add the `owner-approved` label.")).toEqual(["owner-approved-label-gate"]);
    expect(hitsFor("The required `Owner approval` status stays yellow until Josh approves.")).toEqual([
      "owner-approved-label-gate",
    ]);
  });

  it("still fires when a later sentence on the same line records a different retirement", () => {
    expect(hitsFor("The `owner-approved` label gate still blocks merge. There is no longer a paper form.")).toEqual([
      "owner-approved-label-gate",
    ]);
  });

  it("leaves ordinary uses of 'owner-approved' as an adjective alone", () => {
    expect(hitsFor("shadow cohort percent (owner-approved 2), bounded to one process")).toEqual([]);
  });

  it("separates the advisory RAG impact line from the retired hard block", () => {
    expect(
      hitsFor("  **warning** — not a block — when the body has no explicit `RAG impact:` line. Still write one,"),
    ).toEqual([]);
    expect(
      hitsFor("- **PR gate.** PRs touching those surfaces fail `pr-policy` without an explicit `RAG impact:`"),
    ).toEqual(["rag-impact-line-blocks"]);
  });

  it("flags the removed gate arbiter unless the line says it was removed", () => {
    expect(hitsFor("npm run arbiter -- <gate>      # RUN / DEFER / PROVEN")).toEqual(["gate-arbiter"]);
    expect(hitsFor("The gate arbiter was removed on 2026-09-17; gate receipts remain.")).toEqual([]);
  });

  it("reports file, line, rule id and summary for each hit", () => {
    const hits = findRetiredRuleHits(
      textLines("docs/agents/x.md", "fine\nuse the blue form\n"),
      loadRetiredRules(TEST_RULES),
    );
    expect(hits).toEqual([
      expect.objectContaining({
        file: "docs/agents/x.md",
        line: 2,
        ruleId: "blue-form",
        summary: "The blue form was retired.",
      }),
    ]);
  });
});

describe("retired rules: the list itself", () => {
  const rule = { id: "a-rule", retired: "2026-01-02", summary: "s", pattern: "x y", allowedContext: "retired" };
  const load = (rules: unknown[], extra: Record<string, unknown> = {}) =>
    loadRetiredRules(JSON.stringify({ version: 1, rules, ...extra }));

  it("accepts a well-formed rule with an optional record", () => {
    expect(load([{ ...rule, record: "where" }])[0]).toMatchObject({ id: "a-rule", record: "where" });
  });

  it.each([
    ["an unknown key", [{ ...rule, extra: 1 }]],
    ["a missing allowedContext", [{ ...rule, allowedContext: undefined }]],
    ["an impossible date", [{ ...rule, retired: "2026-02-30" }]],
    ["an invalid regex", [{ ...rule, pattern: "(" }]],
    ["a pattern that matches every line", [{ ...rule, pattern: "x*" }]],
    ["an allowedContext that excuses every line", [{ ...rule, allowedContext: "|retired" }]],
    ["a duplicate id", [rule, rule]],
  ])("rejects %s", (_name, rules) => {
    expect(() => load(rules)).toThrow();
  });

  it("rejects an unknown version or top-level key", () => {
    expect(() => loadRetiredRules(JSON.stringify({ version: 2, rules: [] }))).toThrow(/version/);
    expect(() => load([], { note: "x" })).toThrow(/unknown key/);
  });

  it("keeps the scope to live instruction files", () => {
    expect(isInstructionFile("AGENTS.md")).toBe(true);
    expect(isInstructionFile("docs/agents/pull-request-workflow.md")).toBe(true);
    expect(isInstructionFile(".claude/skills/handoff/SKILL.md")).toBe(true);
    expect(isInstructionFile(".github/pull_request_template.md")).toBe(true);
    expect(isInstructionFile("docs/agents-guide.md")).toBe(true);
    expect(isInstructionFile("docs/AGENTS.md")).toBe(false);
    expect(isInstructionFile("docs/outstanding-issues.md")).toBe(false);
  });
});

describe("retired rules: reading a diff", () => {
  it("numbers added lines in the new file across several hunks", () => {
    const diff = [
      "diff --git a/docs/agents/a.md b/docs/agents/a.md",
      "--- a/docs/agents/a.md",
      "+++ b/docs/agents/a.md",
      "@@ -2 +2,2 @@",
      "-old",
      "+new two",
      "+new three",
      "@@ -9,0 +11 @@",
      "+new eleven",
      "\\ No newline at end of file",
      "diff --git a/gone.md b/gone.md",
      "--- a/gone.md",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "diff --git a/docs/agents/b.md b/docs/agents/b.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/docs/agents/b.md",
      "@@ -0,0 +1 @@",
      "++++ a line that starts with plus signs",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual([
      { file: "docs/agents/a.md", line: 2, text: "new two" },
      { file: "docs/agents/a.md", line: 3, text: "new three" },
      { file: "docs/agents/a.md", line: 11, text: "new eleven" },
      { file: "docs/agents/b.md", line: 1, text: "+++ a line that starts with plus signs" },
    ]);
  });
});

describe("retired rules: diff-only mode", () => {
  it("blames only lines the change adds, never leftovers already on the base", () => {
    const { root, base } = repo({ "docs/agents/a.md": "one\nuse the blue form\n" });
    const clean = commit(root, { "docs/agents/b.md": "a new page\n" });
    expect(run(RETIRED, ["--root", root, "--base", base, "--head", clean]).code).toBe(0);

    const dirty = commit(root, { "docs/agents/b.md": "a new page\nstill use the blue form\n" });
    const result = run(RETIRED, ["--root", root, "--base", base, "--head", dirty]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("docs/agents/b.md:2 [blue-form] The blue form was retired.");
    expect(result.out).not.toContain("docs/agents/a.md:2");
  });

  it("ignores files outside the instruction scope and accepts the retirement wording", () => {
    const { root, base } = repo({});
    const head = commit(root, {
      "docs/other.md": "use the blue form\n",
      "CLAUDE.md": "The blue form is no longer used.\n",
    });
    expect(run(RETIRED, ["--root", root, "--base", base, "--head", head]).code).toBe(0);
  });

  it("checks a rule the change itself adds across the whole head", () => {
    const { root, base } = repo({ "docs/agents/a.md": "use the green form\n" });
    const rules = JSON.parse(TEST_RULES);
    rules.rules.push({ ...rules.rules[0], id: "green-form", pattern: "green form", summary: "Green retired too." });
    const head = commit(root, { "docs/organisation/retired-rules.json": JSON.stringify(rules) });
    const result = run(RETIRED, ["--root", root, "--base", base, "--head", head]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("docs/agents/a.md:1 [green-form]");
  });

  it("exits 2 when a commit is missing or the range is half given", () => {
    const { root, base } = repo({});
    expect(run(RETIRED, ["--root", root, "--base", "deadbeef", "--head", base]).code).toBe(2);
    expect(run(RETIRED, ["--root", root, "--base", base]).code).toBe(2);
    expect(run(RETIRED, ["--root", root, "--wat"]).code).toBe(2);
  });
});

describe("retired rules: --paths and the working tree", () => {
  it("checks any given file or folder, in scope or not", () => {
    const { root } = repo({});
    const notes = tempDir();
    write(notes, { "notes.md": "fine\n", "deep/more.md": "x\nuse the blue form here\n" });
    const result = run(RETIRED, ["--root", root, "--paths", path.join(notes, "notes.md"), path.join(notes, "deep")]);
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/more\.md:2 \[blue-form\]/);
    expect(run(RETIRED, ["--root", root, "--paths", path.join(notes, "notes.md")]).code).toBe(0);
    expect(run(RETIRED, ["--root", root, "--paths", path.join(notes, "missing.md")]).code).toBe(2);
  });

  it("scans every in-scope file by default, including new untracked ones", () => {
    const { root } = repo({ "docs/agents/a.md": "fine\n" });
    expect(run(RETIRED, ["--root", root]).code).toBe(0);
    write(root, { ".claude/skills/new/SKILL.md": "---\n---\nuse the blue form\n" });
    const result = run(RETIRED, ["--root", root]);
    expect(result.code).toBe(1);
    expect(result.out).toContain(".claude/skills/new/SKILL.md:3 [blue-form]");
  });

  it("exits 2 when the rules file is missing or malformed", () => {
    const { root } = repo({});
    write(root, { "docs/organisation/retired-rules.json": "{ nope" });
    expect(run(RETIRED, ["--root", root]).code).toBe(2);
    fs.rmSync(path.join(root, "docs/organisation/retired-rules.json"));
    expect(run(RETIRED, ["--root", root]).code).toBe(2);
  });
});

describe("instruction budget", () => {
  const budget = loadBudget(JSON.stringify({ version: 1, files: { "AGENTS.md": 100 } }));
  const sizes = (n: number) => new Map([["AGENTS.md", n]]);

  it("fails a change that crosses the ceiling", () => {
    expect(evaluateBudget(budget, sizes(120), sizes(90)).exitCode).toBe(1);
  });

  it("does not blame a change for a file that was already over and did not grow", () => {
    const same = evaluateBudget(budget, sizes(120), sizes(120));
    expect(same.exitCode).toBe(0);
    expect(same.results[0]).toMatchObject({ over: true, blocking: false });
    expect(evaluateBudget(budget, sizes(110), sizes(120)).exitCode).toBe(0);
  });

  it("fails an already-over file that the change grew, and a new file born over", () => {
    expect(evaluateBudget(budget, sizes(121), sizes(120)).exitCode).toBe(1);
    expect(evaluateBudget(budget, sizes(120), new Map()).exitCode).toBe(1);
  });

  it("with no base, fails whenever a file is over", () => {
    expect(evaluateBudget(budget, sizes(101), null).exitCode).toBe(1);
    expect(evaluateBudget(budget, sizes(100), null).exitCode).toBe(0);
  });

  it("treats a missing budgeted file and a malformed budget as bad input", () => {
    expect(() => evaluateBudget(budget, new Map(), null)).toThrow(/does not exist/);
    expect(() => loadBudget(JSON.stringify({ version: 1, files: { "AGENTS.md": 0 } }))).toThrow();
    expect(() => loadBudget(JSON.stringify({ version: 1, files: {}, extra: 1 }))).toThrow(/unknown key/);
  });

  it("runs end to end against commits and explains the fix", () => {
    const { root, base } = repo({ "AGENTS.md": "x".repeat(90) });
    const over = commit(root, { "AGENTS.md": "x".repeat(130) });
    const result = run(BUDGET, ["--root", root, "--base", base, "--head", over]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("30 over its 100-byte ceiling");
    expect(result.out).toContain("docs/agents/*.md");
    expect(result.out).toContain("docs/organisation/instruction-budget.json");

    const raised = commit(root, {
      "docs/organisation/instruction-budget.json": JSON.stringify({ version: 1, files: { "AGENTS.md": 200 } }),
    });
    expect(run(BUDGET, ["--root", root, "--base", base, "--head", raised]).code).toBe(0);

    const untouched = commit(root, {
      "docs/organisation/instruction-budget.json": JSON.stringify({ version: 1, files: { "AGENTS.md": 100 } }),
    });
    const next = commit(root, { "docs/agents/a.md": "unrelated\n" });
    const inherited = run(BUDGET, ["--root", root, "--base", untouched, "--head", next]);
    expect(inherited.code).toBe(0);
    expect(inherited.out).toContain("did not grow it");

    fs.rmSync(path.join(root, "AGENTS.md"));
    expect(run(BUDGET, ["--root", root]).code).toBe(2);
  });
});

describe("combined check-instructions", () => {
  it("returns the worse of the two checks", () => {
    const { root, base } = repo({});
    const head = commit(root, { "AGENTS.md": `${"x".repeat(150)}\n`, "docs/agents/a.md": "fine\n" });
    const result = run(COMBINED, ["--root", root, "--base", base, "--head", head]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("retired-rules: pass");
    expect(result.out).toContain("instruction-budget: exit 1");
  });

  it("reads the range from the environment in CI mode", () => {
    const { root, base } = repo({ "docs/agents/a.md": "use the blue form\n" });
    const head = commit(root, { "docs/agents/b.md": "fine\n" });
    const ci = { INSTRUCTIONS_CHECK_MODE: "ci", BASE_SHA: base, HEAD_SHA: head };
    const pass = run(COMBINED, ["--root", root], ci);
    expect(pass.code).toBe(0);
    expect(pass.out).toContain(`since ${base.slice(0, 9)}`);

    const bad = commit(root, { "docs/agents/b.md": "fine\nthe blue form again\n" });
    const fail = run(COMBINED, ["--root", root], { ...ci, HEAD_SHA: bad });
    expect(fail.code).toBe(1);
    expect(fail.out).toContain("docs/agents/b.md:2 [blue-form]");
    expect(fail.out).not.toContain("docs/agents/a.md:1");
  });

  it("judges a branch that predates the lists by the checkout's copy, without sweeping old text", () => {
    const root = tempDir();
    git(root, "init", "-q", "-b", "main");
    write(root, { "AGENTS.md": "short\n", "docs/agents/a.md": "use the blue form\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "before the lists");
    git(root, "checkout", "-q", "-b", "old");
    const oldHead = commit(root, { "docs/agents/b.md": "fine\n" });
    git(root, "checkout", "-q", "main");
    const base = commit(root, {
      "docs/organisation/retired-rules.json": TEST_RULES,
      "docs/organisation/instruction-budget.json": JSON.stringify({ version: 1, files: { "AGENTS.md": 100 } }),
    });
    git(root, "merge", "-q", "--no-ff", "-m", "merge", "old");
    const result = run(COMBINED, ["--root", root], {
      INSTRUCTIONS_CHECK_MODE: "ci",
      BASE_SHA: base,
      HEAD_SHA: oldHead,
    });
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("docs/agents/a.md:1");

    git(root, "checkout", "-q", "old");
    const bad = commit(root, { "docs/agents/b.md": "fine\nthe blue form again\n" });
    git(root, "checkout", "-q", "main");
    git(root, "merge", "-q", "--no-ff", "-m", "merge again", "old");
    const fail = run(COMBINED, ["--root", root], { INSTRUCTIONS_CHECK_MODE: "ci", BASE_SHA: base, HEAD_SHA: bad });
    expect(fail.code).toBe(1);
    expect(fail.out).toContain("docs/agents/b.md:2 [blue-form]");
  });

  it("in CI mode, checks the whole head for a new branch or a run with no base, and refuses an unreachable base", () => {
    const { root, base } = repo({ "docs/agents/a.md": "use the blue form\n" });
    const firstPush = run(COMBINED, ["--root", root], {
      INSTRUCTIONS_CHECK_MODE: "ci",
      BASE_SHA: ZERO,
      HEAD_SHA: base,
    });
    expect(firstPush.code).toBe(1);
    expect(firstPush.out).toContain("docs/agents/a.md:1 [blue-form]");

    // Scheduled and manual runs pass no base: they check the head in full, like the map step.
    const noBase = run(COMBINED, ["--root", root], { INSTRUCTIONS_CHECK_MODE: "ci", HEAD_SHA: base });
    expect(noBase.code).toBe(1);
    expect(noBase.out).toContain("docs/agents/a.md:1 [blue-form]");
    const unreachable = run(COMBINED, ["--root", root], {
      INSTRUCTIONS_CHECK_MODE: "ci",
      BASE_SHA: "1".repeat(40),
      HEAD_SHA: base,
    });
    expect(unreachable.code).toBe(2);
  });

  it("with --paths checks retired rules only", () => {
    const { root } = repo({ "AGENTS.md": "x".repeat(500) });
    const notes = tempDir();
    write(notes, { "notes.md": "fine\n" });
    const result = run(COMBINED, ["--root", root, "--paths", path.join(notes, "notes.md")]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("instruction-budget: skipped");
  });
});
