import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { listLedgerRecordPaths } from "../scripts/branch-review-ledger.mjs";
import {
  OUTCOME_LIMIT,
  SCOPE_LIMIT,
  balanceBackticks,
  collectRecords,
  renderBranchReviewIndex,
  sortRecords,
  supersessionKey,
  trimUnsafeTail,
  truncateCell,
} from "../scripts/generate-branch-review-index.mjs";

/**
 * These tests pin GENERATOR BEHAVIOUR, never committed bytes. A byte-equality
 * assertion against docs/branch-review-index.md would be a drift gate on an
 * append-mostly corpus (~27 records a day), which is precisely what
 * scripts/check-repo-awareness-snapshot.ts already refuses to do for
 * `review_state`. The index is allowed to lag `main`.
 */

const hash = (seed: string) => seed.repeat(64).slice(0, 64);

type RecordFixture = {
  date: string;
  ref: string;
  head: string;
  scope: string;
  outcome: string;
  checks: string;
  hash: string;
};

function record(overrides: Partial<RecordFixture> = {}) {
  const merged: RecordFixture = {
    date: "2026-08-20",
    ref: "codex/example-branch",
    head: hash("a"),
    scope: "example scope",
    outcome: "approved",
    checks: "tests passed",
    hash: hash("f"),
    ...overrides,
  };
  return { ...merged, path: `docs/archive/branch-review-records/${merged.hash}.record.md` };
}

const LINK_RE = /branch-review-records\/[0-9a-f]{64}\.record\.md/;

describe("branch review index rendering", () => {
  it("renders deterministically, so regenerating without a corpus change is a no-op diff", () => {
    const records = [
      record({ hash: hash("1"), date: "2026-08-20" }),
      record({ hash: hash("2"), date: "2026-08-22", ref: "claude/other" }),
    ];
    expect(renderBranchReviewIndex(records)).toBe(renderBranchReviewIndex(records));
  });

  it("emits no wall-clock, hostname or git-SHA freshness stamp", () => {
    const markdown = renderBranchReviewIndex([record()]);
    // A generation timestamp would make every regeneration a diff and every
    // concurrent PR a conflict.
    expect(markdown).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(markdown).not.toMatch(/[Gg]enerated (?:at|on)\b/);
    expect(markdown).toContain("Date range: `2026-08-20` to `2026-08-20`");
  });

  it("keeps an escaped pipe escaped, so a re-emitted cell cannot open a phantom column", () => {
    const raw = "| 2026-08-20 | codex/x | " + hash("a") + " | Tests 7274 passed \\| 4 skipped (7278) | ok | fine |";
    const [parsed] = collectRecords({
      paths: ["docs/archive/branch-review-records/" + hash("b") + ".record.md"],
      read: () => raw,
    });

    // parseLedgerRows splits on CELL_SPLIT, not on a naive "|": six cells, and
    // the escape survives into the cell rather than becoming a boundary.
    expect(parsed.cells).toHaveLength(6);
    expect(parsed.scope).toBe("Tests 7274 passed \\| 4 skipped (7278)");

    const markdown = renderBranchReviewIndex([parsed]);
    expect(markdown).toContain("Tests 7274 passed \\| 4 skipped (7278)");
    // No bare pipe was introduced inside the scope cell.
    expect(markdown).not.toContain("Tests 7274 passed | 4 skipped");
  });

  it("never truncates between a backslash and the pipe it escapes", () => {
    // Cut lands exactly on the backslash of `\|`.
    const text = "abcdefgh\\| tail";
    expect(truncateCell(text, 9)).toBe("abcdefgh…");
    expect(truncateCell(text, 10)).toBe("abcdefgh\\|…");
  });

  it("never leaves a dangling lone backslash, including behind trailing whitespace", () => {
    expect(truncateCell("abcdefgh\\ zzzz", 10)).toBe("abcdefgh…");
    expect(trimUnsafeTail("abc\\ ")).toBe("abc");
    // An escaped backslash is even and legitimately survives.
    expect(trimUnsafeTail("abc\\\\")).toBe("abc\\\\");
  });

  it("drops an unmatched backtick opened by truncation", () => {
    expect(balanceBackticks("a `b` c")).toBe("a `b` c");
    expect(balanceBackticks("a `b` c `d")).toBe("a `b` c");
    expect(truncateCell("outcome `verify:pr-local ran clean and then some more", 14)).toBe("outcome…");
  });

  it("leaves a cell shorter than the limit untouched", () => {
    expect(truncateCell("short", 90)).toBe("short");
    expect(truncateCell("  padded  ", 90)).toBe("padded");
  });

  it("renders hostile ref shapes verbatim instead of throwing or inventing a key", () => {
    // Measured shapes in the real corpus: a bare PR number, the placeholder
    // "work", and one ref cell holding a whole 72-character sentence.
    const sentence = "PR #1889 post-merge verification (supersedes inaccurate PR #1921 record)";
    const records = [
      record({ hash: hash("1"), ref: "2317" }),
      record({ hash: hash("2"), ref: "work" }),
      record({ hash: hash("3"), ref: sentence }),
      record({ hash: hash("4"), ref: "https://github.com/BigSimmo/PsychSift/pull/2023" }),
    ];
    const markdown = renderBranchReviewIndex(records);
    for (const value of ["2317", "work", sentence, "https://github.com/BigSimmo/PsychSift/pull/2023"]) {
      expect(markdown).toContain(`| ${value} |`);
    }
    // Every hostile ref still yields a usable grouping key rather than "undefined".
    for (const entry of records) expect(supersessionKey(entry)).not.toContain("undefined");
  });

  it("lists a repeated ref/head pair as a chain and leaves singletons out of that section", () => {
    const repeated = [
      record({ hash: hash("1"), date: "2026-08-14", ref: "codex/repeat", head: hash("d") }),
      record({ hash: hash("2"), date: "2026-08-15", ref: "codex/repeat", head: hash("d") }),
    ];
    const singleton = record({ hash: hash("3"), ref: "codex/only-once", head: hash("e") });
    const chains = renderBranchReviewIndex([...repeated, singleton]).split("## Refs reviewed more than once")[1];

    expect(chains).toContain("codex/repeat");
    expect(chains).not.toContain("codex/only-once");
    // The chain reads oldest -> newest, the order it was written in.
    expect(chains.indexOf("2026-08-14")).toBeLessThan(chains.indexOf("2026-08-15"));
  });

  it("does not group a repeated ref reviewed at two different heads", () => {
    const chains = renderBranchReviewIndex([
      record({ hash: hash("1"), ref: "codex/repeat", head: hash("d") }),
      record({ hash: hash("2"), ref: "codex/repeat", head: hash("e") }),
    ]).split("## Refs reviewed more than once")[1];
    expect(chains).toContain("_No ref/head pair carries more than one record._");
  });

  it("orders by date descending with a record-path tiebreak, not by sort stability", () => {
    const older = record({ hash: hash("1"), date: "2026-08-01" });
    const sameDayA = record({ hash: hash("2"), date: "2026-08-20" });
    const sameDayB = record({ hash: hash("3"), date: "2026-08-20" });

    for (const input of [
      [older, sameDayB, sameDayA],
      [sameDayA, older, sameDayB],
      [sameDayB, sameDayA, older],
    ]) {
      expect(sortRecords(input).map((entry) => entry.hash)).toEqual([hash("2"), hash("3"), hash("1")]);
    }
  });

  it("links every input record exactly once in the flat table", () => {
    const records = ["1", "2", "3", "4"].map((seed, index) =>
      record({ hash: hash(seed), date: `2026-08-1${index}`, ref: `codex/branch-${index}` }),
    );
    const table = renderBranchReviewIndex(records).split("## All records, newest first")[1].split("## Refs")[0];
    for (const entry of records) {
      const link = `(archive/branch-review-records/${entry.hash}.record.md)`;
      expect(table.split(link)).toHaveLength(2);
      expect(link).toMatch(LINK_RE);
    }
  });

  it("fails closed on a record file that does not hold exactly one review row", () => {
    expect(() =>
      collectRecords({ paths: ["docs/archive/branch-review-records/x.record.md"], read: () => "# not a table\n" }),
    ).toThrow(/expected exactly one review row/);
  });
});

describe("branch review index against the committed corpus", () => {
  // Coverage guarantee: the index is the only static artifact holding the
  // hash-filename -> review-row join, so every record must be reachable from it.
  // Deliberately NOT an equality assertion against the committed file — records
  // land continuously and that comparison would be a drift gate.
  const recordPaths = listLedgerRecordPaths();
  const markdown = renderBranchReviewIndex(collectRecords());

  it("links every record the ledger reader can see", () => {
    expect(recordPaths.length).toBeGreaterThan(0);
    const missing = recordPaths.filter((recordPath) => !markdown.includes(`(${recordPath.replace("docs/", "")})`));
    expect(missing).toEqual([]);
  });

  it("emits one flat-table row per record and keeps the table well-formed", () => {
    const table = markdown.split("## All records, newest first")[1].split("## Refs reviewed more than once")[0];
    const rows = table.split("\n").filter((line) => line.startsWith("| ") && !/^\| -{3}/.test(line));
    // Header row plus one row per record.
    expect(rows).toHaveLength(recordPaths.length + 1);
    for (const row of rows) {
      // Escape-aware column count: a literal `|` inside a cell is escaped.
      expect(row.split(/(?<!\\)\|/).length - 2).toBe(5);
    }
  });

  it("preserves UTF-8 punctuation rather than ASCII-folding it", () => {
    expect(markdown).toContain("—");
  });
});

describe("branch review index wiring", () => {
  const packageJson = readFileSync("package.json", "utf8");

  it("regenerates as part of docs:update and exposes an advisory check", () => {
    const scripts = JSON.parse(packageJson).scripts as Record<string, string>;
    expect(scripts["docs:update"]).toContain("ledger:index");
    expect(scripts["ledger:index"]).toBe("node scripts/generate-branch-review-index.mjs");
    expect(scripts["ledger:index:check"]).toBe("node scripts/generate-branch-review-index.mjs --check");
  });

  it("stays out of every verification gate, because the corpus grows daily", () => {
    // A drift gate here would go red on main after nearly every merge and would
    // conflict between concurrent PRs.
    const gated = [
      readFileSync(".github/workflows/ci.yml", "utf8"),
      readFileSync("scripts/verify-pr-local.mjs", "utf8"),
      readFileSync(".githooks/pre-commit", "utf8"),
      JSON.parse(packageJson).scripts["verify:cheap:internal"] as string,
      JSON.parse(packageJson).scripts["verify:full:internal"] as string,
    ];
    for (const surface of gated) expect(surface).not.toContain("ledger:index");
  });

  it("is excluded from Prettier so a one-record append stays a one-line diff", () => {
    expect(readFileSync(".prettierignore", "utf8")).toContain("docs/branch-review-index.md");
  });

  it("is registered as a generated catalog so it cannot mask a stale document", () => {
    const staleDocs = readFileSync("scripts/check-stale-docs.mjs", "utf8");
    const catalogs = staleDocs.split("const GENERATED_CATALOGS")[1].split("]);")[0];
    expect(catalogs).toContain("docs/branch-review-index.md");
  });

  it("emits table cells with single-space padding, not Prettier column padding", () => {
    const committed = readFileSync("docs/branch-review-index.md", "utf8");
    const firstRow = committed.split("\n").find((line) => /^\| \d{4}-\d{2}-\d{2} \| /.test(line));
    expect(firstRow).toBeDefined();
    expect(firstRow).not.toMatch(/ {2,}\|/);
  });

  it("keeps the limits the truncation contract is written against", () => {
    expect(SCOPE_LIMIT).toBe(90);
    expect(OUTCOME_LIMIT).toBe(70);
  });
});
