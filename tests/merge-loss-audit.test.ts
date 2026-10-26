import { describe, expect, it } from "vitest";

import {
  classifyMergeLoss,
  classifyRemoval,
  isReconciliationMove,
  parseLogEntries,
  parsePullNumber,
  parseTreeEntry,
} from "../scripts/audit-merge-loss.mjs";

const INBOX = "docs/outstanding-issues-inbox";

/** Tree-entry table keyed `<ref>:<path>`; a missing key means the path does not exist. */
const reader = (blobs: Record<string, string>) => (ref: string, file: string) => blobs[`${ref}:${file}`] ?? null;

const landing = (pullNumber: number, files: string[]) => ({
  sha: `sha${pullNumber}`,
  date: "2026-08-11T00:00:00+00:00",
  subject: `subject (#${pullNumber})`,
  pullNumber,
  preRef: "pre",
  files,
});

describe("merge-loss subject parsing", () => {
  it("reads a merge landing", () => {
    expect(parsePullNumber("Merge pull request #1935 from BigSimmo/codex/fix-ecg")).toBe(1935);
  });

  it("reads a squash landing", () => {
    expect(parsePullNumber("ci: speed iteration without weakening gates (#1926)")).toBe(1926);
  });

  it("prefers the trailing number when the subject also cites an issue", () => {
    // GitHub appends the PR number, so the last parenthesised number wins.
    expect(parsePullNumber("docs(issues): close #170 and (#309) partially (#1925)")).toBe(1925);
  });

  it("returns undefined for a commit that is not a pull request landing", () => {
    expect(parsePullNumber("Merge branch 'main' into claude/feature")).toBeUndefined();
    expect(parsePullNumber("wip")).toBeUndefined();
    expect(parsePullNumber("")).toBeUndefined();
  });

  it("parses tab-delimited log lines and keeps a subject containing tabs", () => {
    const entries = parseLogEntries("abc\t2026-08-14T06:00:11+08:00\tfix: thing\there (#12)\n\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sha: "abc", pullNumber: 12 });
    expect(entries[0].subject).toBe("fix: thing\there (#12)");
  });
});

describe("merge-loss classification", () => {
  it("does not flag a file whose change is still present", () => {
    const entryAt = reader({ "pre:kept.ts": "aaa", "head:kept.ts": "bbb" });
    expect(classifyMergeLoss({ ref: "head", entryAt, landings: [landing(1, ["kept.ts"])] }).findings).toEqual([]);
  });

  it("flags a file that reverted to its pre-merge blob", () => {
    // The acf78bf case: the landing's contribution to this file is gone.
    const entryAt = reader({ "pre:lost.ts": "ccc", "head:lost.ts": "ccc" });
    const { findings } = classifyMergeLoss({ ref: "head", entryAt, landings: [landing(1803, ["lost.ts"])] });
    expect(findings).toHaveLength(1);
    expect(findings[0].pullNumber).toBe(1803);
    expect(findings[0].revertedFiles).toEqual([{ file: "lost.ts", absent: false }]);
  });

  it("flags a file the pull request added that is absent again", () => {
    // Absent before and absent now: the addition was undone.
    const { findings } = classifyMergeLoss({ ref: "head", entryAt: reader({}), landings: [landing(1, ["added.ts"])] });
    expect(findings[0].revertedFiles).toEqual([{ file: "added.ts", absent: true }]);
  });

  it("does not flag a deletion that survived", () => {
    // Present before, absent now — the pull request deleted it and it stayed deleted.
    const entryAt = reader({ "pre:removed.ts": "ddd" });
    expect(classifyMergeLoss({ ref: "head", entryAt, landings: [landing(1, ["removed.ts"])] }).findings).toEqual([]);
  });

  it("does not flag a surviving mode-only change", () => {
    const entryAt = reader({
      "pre:script.sh": "100644 blob aaa",
      "head:script.sh": "100755 blob aaa",
    });
    expect(classifyMergeLoss({ ref: "head", entryAt, landings: [landing(1, ["script.sh"])] }).findings).toEqual([]);
  });

  it("skips commits with no pull request number instead of dropping them silently", () => {
    const result = classifyMergeLoss({
      ref: "head",
      entryAt: reader({}),
      landings: [
        { sha: "x", date: "d", subject: "Merge branch 'main'", pullNumber: undefined, preRef: "pre", files: [] },
      ],
    });
    expect(result.findings).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.scannedLandings).toBe(0);
  });

  it("orders findings by how much of the landing is missing", () => {
    const entryAt = reader({ "pre:a.ts": "1", "head:a.ts": "1", "pre:b.ts": "2", "head:b.ts": "2" });
    const { findings } = classifyMergeLoss({
      ref: "head",
      entryAt,
      landings: [landing(10, ["a.ts"]), landing(20, ["a.ts", "b.ts"])],
    });
    expect(findings.map((finding) => finding.pullNumber)).toEqual([20, 10]);
  });
});

describe("merge-loss reconciliation exemption", () => {
  const request = `${INBOX}/11111111-1111-4111-8111-111111111111.json`;
  const applied = `${INBOX}/applied/11111111-1111-4111-8111-111111111111.json`;

  it("does not report an inbox request that reconcile moved to applied/", () => {
    // issues:reconcile moves the request verbatim; that is its lifecycle, not a loss.
    const result = classifyMergeLoss({
      ref: "head",
      entryAt: reader({ [`sha1915:${request}`]: "100644 blob eee", [`head:${applied}`]: "100644 blob eee" }),
      landings: [landing(1915, [request])],
    });
    expect(result.findings).toEqual([]);
    expect(result.filesExempted).toBe(1);
  });

  it("still reports an inbox request that vanished without an audit record", () => {
    // No applied/ counterpart means the request was genuinely lost.
    const result = classifyMergeLoss({ ref: "head", entryAt: reader({}), landings: [landing(1915, [request])] });
    expect(result.findings).toHaveLength(1);
    expect(result.filesExempted).toBe(0);
  });

  it("credits only a verbatim move to the matching request filename", () => {
    const entryAt = reader({ [`landing:${request}`]: "100644 blob eee", [`head:${applied}`]: "100644 blob eee" });
    expect(isReconciliationMove(request, "landing", "head", entryAt)).toBe(true);
    expect(isReconciliationMove(`${INBOX}/22222222-2222-4222-8222-222222222222.json`, "landing", "head", entryAt)).toBe(
      false,
    );
    expect(isReconciliationMove("src/lib/rag/rag.ts", "landing", "head", entryAt)).toBe(false);
    expect(isReconciliationMove(applied, "landing", "head", entryAt)).toBe(false);
  });

  it("reports a missing request when its applied record has different contents", () => {
    const result = classifyMergeLoss({
      ref: "head",
      entryAt: reader({ [`sha1915:${request}`]: "100644 blob original", [`head:${applied}`]: "100644 blob changed" }),
      landings: [landing(1915, [request])],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.filesExempted).toBe(0);
  });

  it("exempts a reconciled request when entries come from real ls-tree output", () => {
    // The guard the `"\\t"` bug needed. Every other test in this file injects bare
    // entries, which compare equal whether or not the path was stripped; only a
    // realistic entry exposes a cross-path comparison that can never match.
    const lsTree = (file: string) => parseTreeEntry(`100644 blob eee\t${file}`);
    const result = classifyMergeLoss({
      ref: "head",
      entryAt: reader({ [`sha1915:${request}`]: lsTree(request)!, [`head:${applied}`]: lsTree(applied)! }),
      landings: [landing(1915, [request])],
    });
    expect(result.findings).toEqual([]);
    expect(result.filesExempted).toBe(1);
  });
});

describe("merge-loss tree-entry parsing", () => {
  it("strips the path from an ls-tree line", () => {
    // `<mode> SP <type> SP <oid> TAB <path>` — the separator is a real tab.
    expect(parseTreeEntry("100644 blob aa5bc159018775a3ba075fa846ff4c1fda01e236\tpackage.json")).toBe(
      "100644 blob aa5bc159018775a3ba075fa846ff4c1fda01e236",
    );
  });

  it("gives two paths sharing a blob the same entry", () => {
    // This is what the reconciliation exemption depends on.
    const inbox = parseTreeEntry("100644 blob eee\tdocs/outstanding-issues-inbox/x.json");
    const moved = parseTreeEntry("100644 blob eee\tdocs/outstanding-issues-inbox/applied/x.json");
    expect(inbox).toBe(moved);
  });

  it("keeps a mode difference visible", () => {
    expect(parseTreeEntry("100644 blob aaa\ts.sh")).not.toBe(parseTreeEntry("100755 blob aaa\ts.sh"));
  });

  it("treats a missing path as null", () => {
    expect(parseTreeEntry(undefined)).toBeNull();
    expect(parseTreeEntry("")).toBeNull();
  });
});

describe("merge-loss removal mechanism", () => {
  const walk = (commits: Array<{ sha: string; subject: string }>, merges: string[] = []) => ({
    historyOf: () => commits,
    entryAt: () => "pre-entry" as string | null,
    isMergeCommit: (sha: string) => merges.includes(sha),
  });
  const base = { file: "lost.ts", landingSha: "s1", preEntry: "pre-entry", ref: "head" };

  it("classifies a merge commit as a merge resolution", () => {
    const removal = classifyRemoval({
      ...base,
      ...walk(
        [{ sha: "acf78bf4", subject: "Merge remote-tracking branch 'origin/main' into probe2-1815" }],
        ["acf78bf4"],
      ),
    });
    expect(removal).toMatchObject({ mechanism: "merge-resolution", sha: "acf78bf4" });
  });

  it("classifies a single-parent commit as deliberate", () => {
    const removal = classifyRemoval({
      ...base,
      ...walk([{ sha: "8ca147d5", subject: "ci: speed iteration without weakening gates (#1926)" }]),
    });
    expect(removal).toMatchObject({
      mechanism: "deliberate-commit",
      subject: "ci: speed iteration without weakening gates (#1926)",
    });
  });

  it("blames the oldest matching commit, not a later one carrying the absence forward", () => {
    const removal = classifyRemoval({
      ...base,
      historyOf: () => [
        { sha: "culprit", subject: "Merge branch 'main'" },
        { sha: "later", subject: "unrelated touch" },
      ],
      entryAt: () => "pre-entry",
      isMergeCommit: (sha: string) => sha === "culprit",
    });
    expect(removal).toMatchObject({ mechanism: "merge-resolution", sha: "culprit" });
  });

  it("reports unknown rather than guessing when no commit matches the pre-merge entry", () => {
    const removal = classifyRemoval({
      ...base,
      historyOf: () => [{ sha: "c1", subject: "something else" }],
      entryAt: () => "a-different-entry",
      isMergeCommit: () => false,
    });
    expect(removal.mechanism).toBe("unknown");
    expect(removal.sha).toBeUndefined();
  });

  it("reports unknown for an empty history", () => {
    expect(classifyRemoval({ ...base, ...walk([]) }).mechanism).toBe("unknown");
  });

  // Main lands every pull request as a two-parent merge, so its first-parent chain blames
  // "Merge pull request" for every removal unless the walk follows the side that made it.
  describe("through a pull request merge on main", () => {
    const histories: Record<string, Array<{ sha: string; subject: string }>> = {
      "s1..head:lost.ts": [{ sha: "prMerge", subject: "Merge pull request #9 from BigSimmo/branch" }],
      "s1..branchTip:lost.ts": [
        { sha: "syncMerge", subject: "Merge remote-tracking branch 'origin/main' into branch" },
        { sha: "revert", subject: "Revert the landing on purpose" },
      ],
    };
    const parents: Record<string, string[]> = {
      prMerge: ["mainBefore", "branchTip"],
      syncMerge: ["branchBase", "s1"],
    };
    const options = (entries: Record<string, string>) => ({
      ...base,
      historyOf: (landingSha: string, reference: string, file: string) =>
        histories[`${landingSha}..${reference}:${file}`] ?? [],
      entryAt: (reference: string) => entries[reference] ?? "landed-entry",
      isMergeCommit: (sha: string) => (parents[sha] ?? []).length > 1,
      parentsOf: (sha: string) => parents[sha] ?? [],
      isAncestor: (ancestor: string, descendant: string) => ancestor === "s1" && descendant === "branchTip",
    });

    it("attributes a deliberate revert on the side branch to that commit, not the merge", () => {
      const removal = classifyRemoval(options({ prMerge: "pre-entry", branchTip: "pre-entry", revert: "pre-entry" }));
      expect(removal).toMatchObject({ mechanism: "deliberate-commit", sha: "revert" });
    });

    it("blames the side branch's own merge when its conflict resolution dropped the change", () => {
      const removal = classifyRemoval(
        options({ prMerge: "pre-entry", branchTip: "pre-entry", syncMerge: "pre-entry", revert: "pre-entry" }),
      );
      expect(removal).toMatchObject({ mechanism: "merge-resolution", sha: "syncMerge" });
    });

    it("keeps MERGE-RESOLUTION when the pull request merge itself dropped the change", () => {
      const removal = classifyRemoval(options({ prMerge: "pre-entry" }));
      expect(removal).toMatchObject({ mechanism: "merge-resolution", sha: "prMerge" });
    });
  });
});

describe("merge-loss mechanism reporting", () => {
  const entryAt = reader({ "pre:a.ts": "1", "head:a.ts": "1", "pre:b.ts": "2", "head:b.ts": "2" });

  it("leaves the finding shape and order untouched when no mechanism reader is given", () => {
    const result = classifyMergeLoss({ ref: "head", entryAt, landings: [landing(10, ["a.ts"])] });
    expect(result.findings[0].revertedFiles).toEqual([{ file: "a.ts", absent: false }]);
    expect(result.mechanismCounts).toEqual({ "merge-resolution": 0, "deliberate-commit": 0, unknown: 0 });
  });

  it("attaches the mechanism and counts it", () => {
    const result = classifyMergeLoss({
      ref: "head",
      entryAt,
      landings: [landing(10, ["a.ts"])],
      removalOf: () => ({ mechanism: "merge-resolution", sha: "acf78bf4", subject: "Merge origin/main" }),
    });
    expect(result.findings[0].revertedFiles[0]).toMatchObject({
      file: "a.ts",
      removal: { mechanism: "merge-resolution", sha: "acf78bf4" },
    });
    expect(result.mechanismCounts["merge-resolution"]).toBe(1);
  });

  it("lists merge-resolution findings before larger deliberate ones", () => {
    // #1800 lost 6 files to acf78bf; #1815 lost 47 to a re-land. The accidental
    // case must not be buried under the bigger deliberate one.
    const result = classifyMergeLoss({
      ref: "head",
      entryAt,
      landings: [landing(1815, ["a.ts", "b.ts"]), landing(1800, ["a.ts"])],
      removalOf: ({ landingSha }: { landingSha: string }) =>
        landingSha === "sha1800"
          ? { mechanism: "merge-resolution", sha: "acf78bf4", subject: "Merge origin/main" }
          : { mechanism: "deliberate-commit", sha: "f89fbcc7", subject: "Re-land the retirement" },
    });
    expect(result.findings.map((finding) => finding.pullNumber)).toEqual([1800, 1815]);
    expect(result.mechanismCounts).toEqual({ "merge-resolution": 1, "deliberate-commit": 2, unknown: 0 });
  });
});
