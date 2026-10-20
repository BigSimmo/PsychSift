import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findUnmergedRemoteReconciliations, planAppliedArchive } from "../scripts/ledger-inbox.mjs";
import {
  appliedRecordDirectories,
  appliedRecordName,
  archivedAppliedPath,
  findAppliedRecord,
  isAppliedRecordPath,
  quarterOf,
} from "../scripts/lib/inbox-archive.mjs";

const APPLIED = "docs/outstanding-issues-inbox/applied";
const NAME = "11111111-1111-4111-8111-111111111111.json";

describe("applied inbox archive paths", () => {
  it("maps dates to calendar quarters", () => {
    expect(quarterOf("2026-08-31T23:59:59Z")).toBe("2026-Q3");
    expect(quarterOf("2026-09-30")).toBe("2026-Q3");
    expect(quarterOf("2026-10-01")).toBe("2026-Q4");
    expect(quarterOf("2027-01-15")).toBe("2027-Q1");
    expect(quarterOf("not a date")).toBeNull();
    expect(quarterOf("2026-13-01")).toBeNull();
  });

  it("recognises applied records in applied/ and in a quarter folder, and nothing else", () => {
    expect(isAppliedRecordPath(`${APPLIED}/${NAME}`)).toBe(true);
    expect(isAppliedRecordPath(`${APPLIED}/archive/2026-Q3/${NAME}`)).toBe(true);
    expect(isAppliedRecordPath(`${APPLIED}/archive/q3/${NAME}`)).toBe(false);
    expect(isAppliedRecordPath(`${APPLIED}/archive/2026-Q3/nested/${NAME}`)).toBe(false);
    expect(isAppliedRecordPath(`docs/outstanding-issues-inbox/${NAME}`)).toBe(false);
    expect(isAppliedRecordPath(`${APPLIED}/README.md`)).toBe(false);
    expect(appliedRecordName(`${APPLIED}/archive/2026-Q3/${NAME}`)).toBe(NAME);
    expect(archivedAppliedPath(NAME, "2026-08-20T01:02:03Z")).toBe(`${APPLIED}/archive/2026-Q3/${NAME}`);
    expect(() => archivedAppliedPath(NAME, "")).toThrow(/not an ISO date/);
  });

  describe("on disk", () => {
    let root: string;
    afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

    it("finds a record wherever it sits, applied/ first", () => {
      root = mkdtempSync(join(tmpdir(), "inbox-archive-"));
      mkdirSync(join(root, APPLIED, "archive", "2026-Q3"), { recursive: true });
      mkdirSync(join(root, APPLIED, "archive", "not-a-quarter"), { recursive: true });
      writeFileSync(join(root, APPLIED, "archive", "2026-Q3", NAME), "{}");
      expect(appliedRecordDirectories(root)).toEqual([APPLIED, `${APPLIED}/archive/2026-Q3`]);
      expect(findAppliedRecord(root, NAME)).toBe(`${APPLIED}/archive/2026-Q3/${NAME}`);
      writeFileSync(join(root, APPLIED, NAME), "{}");
      expect(findAppliedRecord(root, NAME)).toBe(`${APPLIED}/${NAME}`);
      expect(findAppliedRecord(root, "22222222-2222-4222-8222-222222222222.json")).toBeNull();
    });
  });
});

describe("planAppliedArchive", () => {
  const entry = (name: string, createdOn: string) => ({ relative: `${APPLIED}/${name}`, request: { createdOn } });

  it("moves only records from quarters that have ended, keeping their file names", () => {
    const moves = planAppliedArchive(
      [entry("a.json", "2026-08-01T00:00:00Z"), entry("b.json", "2026-10-02T00:00:00Z")],
      "2026-Q4",
    );
    expect(moves).toEqual([{ from: `${APPLIED}/a.json`, to: `${APPLIED}/archive/2026-Q3/a.json` }]);
  });

  it("refuses an unreadable record or one without a usable date", () => {
    expect(() => planAppliedArchive([{ relative: `${APPLIED}/x.json`, error: "bad JSON" }], "2026-Q4")).toThrow(
      /bad JSON/,
    );
    expect(() => planAppliedArchive([entry("y.json", "yesterday")], "2026-Q4")).toThrow(/not an ISO date/);
  });
});

describe("remote reconciliation check after archiving", () => {
  const mainSha = "a".repeat(40);
  const branchSha = "1".repeat(40);
  const run = (branchTree: string) =>
    findUnmergedRemoteReconciliations({
      strictRemote: true,
      lsRemoteOutput: `${mainSha}\trefs/heads/main\n${branchSha}\trefs/heads/claude/issues-reconcile-old`,
      currentBranch: "claude/other",
      runner: (args: string[], options: { input?: string } = {}) => {
        if (args[0] === "remote") return "https://github.com/BigSimmo/PsychSift.git";
        if (args[0] === "rev-parse") return mainSha;
        if (args[0] === "cat-file")
          return (options.input ?? "")
            .trim()
            .split("\n")
            .map((sha) => `${sha} commit`)
            .join("\n");
        if (args[0] === "ls-tree") {
          if (args[3] === "refs/remotes/origin/main") return `${APPLIED}/archive/2026-Q3/${NAME}`;
          return branchTree;
        }
        throw new Error(`unexpected test Git command: ${args[0]}`);
      },
    });

  it("does not treat a branch's flat copy of an archived record as unmerged", () => {
    expect(run(`${APPLIED}/${NAME}`)).toEqual([]);
  });

  it("still flags a record that main does not have anywhere", () => {
    const detected = run(`${APPLIED}/${NAME}\n${APPLIED}/22222222-2222-4222-8222-222222222222.json`);
    expect(detected).toHaveLength(1);
    expect(detected[0].unmergedCount).toBe(1);
  });
});
