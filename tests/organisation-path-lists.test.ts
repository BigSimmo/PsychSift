// tests/organisation-path-lists.test.ts
//
// Safety-list coverage checks (organisation framework suggestions 2 and 7): a rename or copy that
// moves a file off a safety list is flagged loudly, judged against the lists as they were BEFORE
// the change; a deleted safety-listed file gets a plain warning, or a loud one when a same-named
// unprotected file appears; and names on a list that match no tracked file are reported as dead.
// Cases inject a small classifier, a small pattern list, or a small stand-in pr-policy committed
// into a temporary repository, so they never depend on the real repository's lists.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  coverageLossFindings,
  deadEntryFindings,
  literalAlternatives,
  parseNameStatus,
} from "../scripts/organisation/path-lists.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

function repo(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "organisation-path-lists-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  write(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

function commit(root: string, message = "change") {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

function move(root: string, from: string, to: string) {
  fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  git(root, "mv", from, to);
}

// Enough distinct text that git's similarity check pairs a moved file with its old path.
const BODY = Array.from({ length: 40 }, (_, line) => `export const line${line} = ${line};`).join("\n") + "\n";

// A small stand-in for pr-policy: two lists, one folder rule each plus one exact name.
const LISTS: Record<string, RegExp[]> = {
  ranking: [/^lib\/rank\//, /^lib\/scoring\.ts$/],
  clinical: [/^lib\/rank\//, /^lib\/clinical\//],
};
const classify = (file: string) =>
  Object.entries(LISTS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(file)))
    .map(([name]) => name);

// A stand-in scripts/pr-policy.mjs, committed into a temp repo, whose ranking list is `patterns`.
function policy(patterns: string[]) {
  return [
    `const ranking = [${patterns.join(", ")}];`,
    "export function classifyPullRequestFiles(files) {",
    "  return { ragRanking: files.some((file) => ranking.some((pattern) => pattern.test(file))), clinicalRisk: false, migration: false };",
    "}",
    "",
  ].join("\n");
}

describe("coverageLossFindings: renames", () => {
  it("flags loudly a rename that moves a file off a safety list", () => {
    const root = repo({ "lib/scoring.ts": BODY });
    move(root, "lib/scoring.ts", "lib/util/scoring.ts");
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warning",
      level: "warning",
      loud: true,
      key: "coverage-lost:lib/util/scoring.ts",
      subject: "lib/util/scoring.ts",
      about: "lib/scoring.ts",
    });
    expect(findings[0].message).toContain("renamed from `lib/scoring.ts`");
    expect(findings[0].message).toContain("the ranking list");
    expect(findings[0].message).toContain("add `lib/util/scoring.ts` to ranking in scripts/pr-policy.mjs");
  });

  it("stays quiet when the new path keeps every list", () => {
    const root = repo({ "lib/rank/order.ts": BODY });
    move(root, "lib/rank/order.ts", "lib/rank/ordering.ts");
    commit(root);

    expect(coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify })).toEqual([]);
  });

  it("names only the lists the new path lost", () => {
    const root = repo({ "lib/rank/order.ts": BODY });
    move(root, "lib/rank/order.ts", "lib/clinical/order.ts");
    commit(root);

    const [finding] = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify });
    expect(finding.key).toBe("coverage-lost:lib/clinical/order.ts");
    expect(finding.message).toContain("the ranking list");
    expect(finding.message).not.toContain("the clinical list");
  });

  it("follows a rename that also edits the file", () => {
    const root = repo({ "lib/scoring.ts": BODY });
    move(root, "lib/scoring.ts", "lib/util/scoring.ts");
    fs.appendFileSync(path.join(root, "lib/util/scoring.ts"), "export const extra = true;\n");
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify });
    expect(findings.map((finding) => finding.key)).toEqual(["coverage-lost:lib/util/scoring.ts"]);
  });

  it("ignores renames of files that were on no list", () => {
    const root = repo({ "lib/misc.ts": BODY });
    move(root, "lib/misc.ts", "lib/other.ts");
    commit(root);

    expect(coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify })).toEqual([]);
  });

  it("asks the real pr-policy when the repository has no copy of its own", () => {
    const root = repo({ "src/lib/rag/probe-module.ts": BODY });
    move(root, "src/lib/rag/probe-module.ts", "src/lib/probe-module.ts");
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD" });
    expect(findings.map((finding) => finding.key)).toEqual(["coverage-lost:src/lib/probe-module.ts"]);
    expect(findings[0].message).toContain("ragRankingPatterns");
  });
});

describe("coverageLossFindings: copies", () => {
  it("flags loudly a copy whose new path lacks the source's lists", () => {
    // git pairs a copy with its source only when the source also changed in the same diff.
    const root = repo({ "lib/scoring.ts": BODY });
    write(root, { "lib/util/scoring-copy.ts": BODY });
    fs.appendFileSync(path.join(root, "lib/scoring.ts"), "export const touched = true;\n");
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      loud: true,
      key: "coverage-lost:lib/util/scoring-copy.ts",
      about: "lib/scoring.ts",
    });
    expect(findings[0].message).toContain("copied from `lib/scoring.ts`");
  });

  it("flags loudly an exact copy when the source file itself did not change", () => {
    const root = repo({ "lib/scoring.ts": BODY });
    write(root, { "lib/util/scoring-copy.ts": BODY });
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      loud: true,
      key: "coverage-lost:lib/util/scoring-copy.ts",
      about: "lib/scoring.ts",
    });
    expect(findings[0].message).toContain("copied from `lib/scoring.ts`");
  });

  it("stays quiet when an exact copy keeps every list", () => {
    const root = repo({ "lib/rank/order.ts": BODY });
    write(root, { "lib/rank/order-copy.ts": BODY });
    commit(root);

    expect(coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify })).toEqual([]);
  });
});

describe("coverageLossFindings: judged against the base lists", () => {
  it("still flags a rename when the same change deletes the old name from the list", () => {
    const root = repo({
      "scripts/pr-policy.mjs": policy(["/^lib\\/scoring\\.ts$/", "/^lib\\/rank\\//"]),
      "lib/scoring.ts": BODY,
    });
    write(root, { "scripts/pr-policy.mjs": policy(["/^lib\\/rank\\//"]) });
    move(root, "lib/scoring.ts", "lib/util/scoring.ts");
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD" });
    expect(findings.map((finding) => finding.key)).toEqual(["coverage-lost:lib/util/scoring.ts"]);
    expect(findings[0].loud).toBe(true);
  });

  it("still warns about a deletion when the same change deletes the name from the list", () => {
    const root = repo({
      "scripts/pr-policy.mjs": policy(["/^lib\\/scoring\\.ts$/"]),
      "lib/scoring.ts": BODY,
      "lib/keep.ts": "keep\n",
    });
    write(root, { "scripts/pr-policy.mjs": policy([]) });
    fs.rmSync(path.join(root, "lib/scoring.ts"));
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD" });
    expect(findings.map((finding) => finding.key)).toEqual(["coverage-deleted:lib/scoring.ts"]);
  });

  it("judges new paths against the head lists", () => {
    const root = repo({ "scripts/pr-policy.mjs": policy(["/^lib\\/rank\\//"]), "lib/rank/order.ts": BODY });
    write(root, { "scripts/pr-policy.mjs": policy(["/^lib\\/rank\\//", "/^lib\\/moved\\//"]) });
    move(root, "lib/rank/order.ts", "lib/moved/order.ts");
    commit(root);

    expect(coverageLossFindings({ root, base: "HEAD~1", head: "HEAD" })).toEqual([]);
  });

  it("flags loudly a file edited in place while its entry is taken off a list", () => {
    const root = repo({
      "scripts/pr-policy.mjs": policy(["/^lib\\/scoring\\.ts$/"]),
      "lib/scoring.ts": BODY,
    });
    write(root, { "scripts/pr-policy.mjs": policy([]), "lib/scoring.ts": `${BODY}export const extra = 1;\n` });
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD" });
    expect(findings.map((finding) => [finding.key, finding.loud])).toEqual([["coverage-dropped:lib/scoring.ts", true]]);
  });

  it("flags loudly a file that stays put but is taken off a list in the same change", () => {
    const root = repo({
      "scripts/pr-policy.mjs": policy(["/^lib\\/scoring\\.ts$/", "/^lib\\/rank\\//"]),
      "lib/scoring.ts": BODY,
      "lib/rank/order.ts": BODY.replace("line0", "order0"),
    });
    write(root, { "scripts/pr-policy.mjs": policy(["/^lib\\/rank\\//"]) });
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD" });
    expect(findings.map((finding) => [finding.key, finding.loud])).toEqual([["coverage-dropped:lib/scoring.ts", true]]);
  });

  it("says loudly when the base lists cannot be loaded and the change edits them", () => {
    const root = repo({ "scripts/pr-policy.mjs": "export const = ;\n", "lib/scoring.ts": BODY });
    write(root, { "scripts/pr-policy.mjs": policy(["/^lib\\/scoring\\.ts$/"]) });
    move(root, "lib/scoring.ts", "lib/util/scoring.ts");
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD" });
    expect(findings.map((finding) => finding.key)).toContain("coverage-base-lists-unavailable");
    expect(findings.find((finding) => finding.key === "coverage-base-lists-unavailable")?.loud).toBe(true);
  });
});

describe("coverageLossFindings: deletions", () => {
  it("gives a plain warning for a deleted safety-listed file", () => {
    const root = repo({ "lib/scoring.ts": BODY, "lib/misc.ts": BODY.replace("line0", "misc0") });
    fs.rmSync(path.join(root, "lib/scoring.ts"));
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warning",
      loud: false,
      key: "coverage-deleted:lib/scoring.ts",
      subject: "lib/scoring.ts",
    });
  });

  it("is loud when a same-named file off the list is added in the same change", () => {
    const root = repo({ "lib/scoring.ts": BODY });
    fs.rmSync(path.join(root, "lib/scoring.ts"));
    write(root, { "lib/util/scoring.ts": "export const rewritten = 1;\n" });
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      loud: true,
      key: "coverage-deleted:lib/scoring.ts",
      about: "lib/util/scoring.ts",
    });
    expect(findings[0].message).toContain("`lib/util/scoring.ts`");
  });

  it("is loud when an unlisted file is added in the same folder, as a split or heavy rewrite looks", () => {
    const root = repo({ "lib/scoring.ts": BODY });
    fs.rmSync(path.join(root, "lib/scoring.ts"));
    write(root, { "lib/score-parts.ts": "export const rewritten = 1;\n" });
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify });
    expect(findings.map((finding) => [finding.key, finding.loud, finding.about])).toEqual([
      ["coverage-deleted:lib/scoring.ts", true, "lib/score-parts.ts"],
    ]);
  });

  it("stays plain when the same-named added file keeps the lists", () => {
    const root = repo({ "lib/rank/order.ts": BODY });
    fs.rmSync(path.join(root, "lib/rank/order.ts"));
    write(root, { "lib/rank/sub/order.ts": "export const rewritten = 1;\n" });
    commit(root);

    const findings = coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify });
    expect(findings.map((finding) => [finding.key, finding.loud])).toEqual([
      ["coverage-deleted:lib/rank/order.ts", false],
    ]);
  });

  it("ignores deleted files that were on no list", () => {
    const root = repo({ "lib/misc.ts": BODY, "lib/keep.ts": "x\n" });
    fs.rmSync(path.join(root, "lib/misc.ts"));
    commit(root);

    expect(coverageLossFindings({ root, base: "HEAD~1", head: "HEAD", classify })).toEqual([]);
  });
});

describe("coverageLossFindings: refuses what it cannot check", () => {
  it("throws when the base cannot be read", () => {
    const root = repo({ "lib/misc.ts": BODY });
    expect(() => coverageLossFindings({ root, base: "no-such-ref", head: "HEAD", classify })).toThrow(
      /git diff failed/,
    );
  });

  it("throws on a revision that looks like an option", () => {
    const root = repo({ "lib/misc.ts": BODY });
    expect(() => coverageLossFindings({ root, base: "--output=x", head: "HEAD", classify })).toThrow(/git revision/);
  });
});

describe("parseNameStatus", () => {
  it("reads renames, copies, deletions and additions from -z output", () => {
    expect(parseNameStatus("R087\0a/old.ts\0b/new.ts\0C100\0a/src.ts\0c/copy.ts\0D\0gone.ts\0A\0added.ts\0")).toEqual([
      { status: "R", from: "a/old.ts", path: "b/new.ts" },
      { status: "C", from: "a/src.ts", path: "c/copy.ts" },
      { status: "D", path: "gone.ts" },
      { status: "A", path: "added.ts" },
    ]);
  });
});

describe("deadEntryFindings: exact names", () => {
  it("splits a grouped alternation and reports only the missing names", () => {
    const findings = deadEntryFindings({
      trackedFiles: ["src/lib/alpha.ts"],
      lists: { ragRanking: [/^src\/lib\/(?:alpha|beta)\.ts$/] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "warning",
      loud: false,
      key: "dead-entry:ragRanking:src/lib/beta.ts",
      subject: "src/lib/beta.ts",
      about: "scripts/pr-policy.mjs",
    });
    expect(findings[0].message).toContain("ragRankingPatterns");
  });

  it("splits nested groups into single names", () => {
    const findings = deadEntryFindings({
      trackedFiles: ["tests/a-one.test.ts", "tests/helpers/c.ts"],
      lists: { clinicalRisk: [/^tests\/(?:a-(?:one|two)\.test|b\.test|helpers\/c)\.ts$/] },
    });
    expect(findings.map((finding) => finding.subject)).toEqual(["tests/a-two.test.ts", "tests/b.test.ts"]);
  });

  it("reports a name with an optional part only when every variant is missing", () => {
    const lists = { ranking: [/^src\/lib\/(?:alpha|beta)\.tsx?$/] };
    const findings = deadEntryFindings({ trackedFiles: ["src/lib/alpha.tsx"], lists });
    expect(findings.map((finding) => finding.key)).toEqual(["dead-entry:ranking:src/lib/beta.ts"]);
    expect(findings[0].message).toContain("`src/lib/beta.tsx`");
  });

  it("respects a case-insensitive pattern", () => {
    expect(
      deadEntryFindings({ trackedFiles: ["src/lib/Alpha.ts"], lists: { ranking: [/^src\/lib\/alpha\.ts$/i] } }),
    ).toEqual([]);
  });

  it("reads tracked files from git, ignoring untracked ones", () => {
    const root = repo({ "src/lib/alpha.ts": "a\n" });
    write(root, { "src/lib/beta.ts": "untracked\n" });
    const findings = deadEntryFindings({ root, lists: { ranking: [/^src\/lib\/(?:alpha|beta)\.ts$/] } });
    expect(findings.map((finding) => finding.subject)).toEqual(["src/lib/beta.ts"]);
  });
});

describe("deadEntryFindings: folders and keyword patterns", () => {
  it("reports a folder prefix no tracked file sits under", () => {
    const findings = deadEntryFindings({
      trackedFiles: ["src/lib/rank/a.ts"],
      lists: { ranking: [/^src\/lib\/rank\//, /^src\/lib\/gone\//] },
    });
    expect(findings.map((finding) => finding.key)).toEqual(["dead-entry:ranking:src/lib/gone/"]);
  });

  it("treats an optional folder suffix as one entry", () => {
    const lists = { clinicalRisk: [/^src\/lib\/contacts(?:-server)?\//] };
    expect(deadEntryFindings({ trackedFiles: ["src/lib/contacts/a.ts"], lists })).toEqual([]);
    const findings = deadEntryFindings({ trackedFiles: ["src/lib/other/a.ts"], lists });
    expect(findings.map((finding) => finding.subject)).toEqual(["src/lib/contacts/"]);
  });

  it("does not split a keyword pattern, and warns only when it matches nothing", () => {
    const keyword = /^src\/lib\/.*(?:auth|privacy)/i;
    expect(deadEntryFindings({ trackedFiles: ["src/lib/auth-guard.ts"], lists: { clinicalRisk: [keyword] } })).toEqual(
      [],
    );
    const findings = deadEntryFindings({ trackedFiles: ["src/lib/other.ts"], lists: { clinicalRisk: [keyword] } });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ key: `dead-pattern:clinicalRisk:${keyword.source}`, loud: false });
  });

  it("requires tracked files or a root", () => {
    expect(() => deadEntryFindings({ lists: {} })).toThrow(/root or trackedFiles/);
  });
});

describe("literalAlternatives", () => {
  it("expands anchored literal patterns", () => {
    expect(literalAlternatives(/^src\/lib\/chunking\.ts$/)).toEqual({
      anchoredEnd: true,
      texts: ["src/lib/chunking.ts"],
      entries: [["src/lib/chunking.ts"]],
    });
    expect(literalAlternatives(/^(?:src\/data|data)\//)).toMatchObject({
      anchoredEnd: false,
      texts: ["src/data/", "data/"],
    });
    expect(literalAlternatives(/^a\$$/)).toMatchObject({ anchoredEnd: true, texts: ["a$"] });
    expect(literalAlternatives(/^a\$/)).toMatchObject({ anchoredEnd: false, texts: ["a$"] });
  });

  it("keeps alternatives apart and optional variants together", () => {
    expect(literalAlternatives(/^src\/lib\/(?:a|b)\.tsx?$/)?.entries).toEqual([
      ["src/lib/a.ts", "src/lib/a.tsx"],
      ["src/lib/b.ts", "src/lib/b.tsx"],
    ]);
  });

  it("returns null for anything that is not literal text", () => {
    for (const pattern of [
      /^src\/lib\/.*rank/,
      /^src\/lib\/differential[^/]*\.ts$/,
      /^src\/app\/(?!api\/)/,
      /^src\/\bx/,
      /^a+/,
      /^a|b$/,
      /src\/lib\//,
    ]) {
      expect(literalAlternatives(pattern), String(pattern)).toBeNull();
    }
  });
});
