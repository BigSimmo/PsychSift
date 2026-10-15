import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SOURCE_WINS,
  checkDecisions,
  comparableText,
  parseDecisionEntry,
  resolveSourcePath,
  sourceContainsPhrase,
} from "../scripts/organisation/decisions.mjs";

const repoRoot = path.resolve(__dirname, "..");
const roots: string[] = [];

function tempRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "decisions-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function entry({
  title = "Squash is the preferred merge method",
  status = "decided 2026-09-16",
  source = "docs/rules.md",
  phrase = "squash when the repository allows it",
  summary = "Pull requests are merged by squash wherever the repository allows it.",
  closing = SOURCE_WINS,
} = {}): string {
  return [
    `# Decision: ${title}`,
    "",
    `- **Status:** ${status}`,
    `- **Source:** \`${source}\`, find "${phrase}"`,
    "",
    summary,
    "",
    closing,
    "",
  ].join("\n");
}

describe("decision entry format", () => {
  it("reads every field of a well-formed entry", () => {
    const parsed = parseDecisionEntry("2026-09-16-squash-merge.md", entry());
    expect(parsed.problems).toEqual([]);
    expect(parsed).toMatchObject({
      date: "2026-09-16",
      slug: "squash-merge",
      title: "Squash is the preferred merge method",
      sourcePath: "docs/rules.md",
      sourcePhrase: "squash when the repository allows it",
    });
    expect(parsed.summary).toContain("merged by squash");
  });

  it("accepts a note after the date, such as a recorded-only date or a supersession", () => {
    const status = "decided 2026-09-16 (the source gives no date; this is when it was first recorded)";
    expect(parseDecisionEntry("2026-09-16-squash-merge.md", entry({ status })).problems).toEqual([]);
    const superseded = "decided 2026-09-16; superseded by 2026-10-01-merge-queue.md";
    expect(parseDecisionEntry("2026-09-16-squash-merge.md", entry({ status: superseded })).problems).toEqual([]);
  });

  it.each([
    ["a sequence number instead of a date", "0001-squash-merge.md"],
    ["an uppercase slug", "2026-09-16-Squash-Merge.md"],
    ["a date with no slug", "2026-09-16.md"],
  ])("rejects a file name with %s", (_label, fileName) => {
    const { problems } = parseDecisionEntry(fileName, entry());
    expect(problems.some((problem) => problem.startsWith("name must be"))).toBe(true);
  });

  it("rejects a date that does not exist", () => {
    const { problems } = parseDecisionEntry("2026-02-30-squash-merge.md", entry({ status: "decided 2026-02-30" }));
    expect(problems).toContain("2026-02-30 is not a real date");
  });

  it("rejects a status date that differs from the file name", () => {
    const { problems } = parseDecisionEntry("2026-09-16-squash-merge.md", entry({ status: "decided 2026-09-17" }));
    expect(problems).toContain("the status date 2026-09-17 differs from the name's 2026-09-16");
  });

  it("names every missing field at once", () => {
    const { problems } = parseDecisionEntry("2026-09-16-squash-merge.md", "Just a note.\n");
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toMatch(/Decision: <title>/);
    expect(problems.join("\n")).toMatch(/Status/);
    expect(problems.join("\n")).toMatch(/Source/);
    expect(problems.join("\n")).toMatch(/source wins/);
  });

  it("rejects an entry with no decision text", () => {
    const { problems } = parseDecisionEntry("2026-09-16-squash-merge.md", entry({ summary: "" }));
    expect(problems.some((problem) => problem.startsWith("missing the decision itself"))).toBe(true);
  });

  it.each(["/etc/rules.md", "../outside.md", "./docs/rules.md", "C:/repo/docs/rules.md"])(
    "rejects a source that is not repository-relative: %s",
    (source) => {
      const { problems } = parseDecisionEntry("2026-09-16-squash-merge.md", entry({ source }));
      expect(problems).toContain(`source ${source} is not a repository-relative path`);
    },
  );
});

describe("finding the quoted phrase in its source", () => {
  it("finds a phrase however the source wraps it", () => {
    const markdown =
      "It uses the existing merge method: squash when the repository\nallows it, otherwise merge commits.";
    expect(sourceContainsPhrase(markdown, "squash when the repository allows it")).toBe(true);
  });

  it("looks through comment markers at the start of wrapped code lines", () => {
    const code = [
      "  // Kept, and settled: the owner ruled on",
      "  // 2026-08-26 that the register belongs here.",
      "  /*",
      "   * The fix: keep one file, but order",
      "   * records by a hash of their id.",
      "   */",
    ].join("\n");
    expect(sourceContainsPhrase(code, "the owner ruled on 2026-08-26 that the register")).toBe(true);
    expect(sourceContainsPhrase(code, "keep one file, but order records by a hash")).toBe(true);
  });

  it("does not find a phrase that is not there", () => {
    expect(sourceContainsPhrase("merge commits only", "squash when the repository allows it")).toBe(false);
  });

  it("collapses whitespace in the phrase as well as the source", () => {
    expect(comparableText("a   b\n  c")).toBe("a b c");
  });

  it("follows a pending issue-inbox request into applied/ once it is reconciled", () => {
    const root = tempRepo({ "docs/outstanding-issues-inbox/applied/abc.json": "{}" });
    expect(resolveSourcePath(root, "docs/outstanding-issues-inbox/abc.json")).toBe(
      "docs/outstanding-issues-inbox/applied/abc.json",
    );
    expect(resolveSourcePath(root, "docs/outstanding-issues-inbox/missing.json")).toBeNull();
  });
});

describe("checking a decisions folder", () => {
  it("passes a folder of well-formed entries whose sources still hold their phrases", () => {
    const root = tempRepo({
      "docs/rules.md": "Merges use squash when the repository allows it.\n",
      "docs/decisions/README.md": "# Decisions\n",
      "docs/decisions/2026-09-16-squash-merge.md": entry(),
      "docs/decisions/abc123-full-record.md": "# Decision: a full record with its own analysis\n",
    });
    const result = checkDecisions({ repoRoot: root });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.entries.map((item) => item.fileName)).toEqual(["2026-09-16-squash-merge.md"]);
    expect(result.records).toEqual(["docs/decisions/abc123-full-record.md"]);
  });

  it("fails a malformed entry, and a full record without a decision heading", () => {
    const root = tempRepo({
      "docs/rules.md": "squash when the repository allows it\n",
      "docs/decisions/2026-09-16-squash-merge.md": entry({ status: "decided 2026-09-15" }),
      "docs/decisions/notes.md": "Some notes\n",
    });
    const { errors } = checkDecisions({ repoRoot: root });
    expect(errors).toEqual([
      "docs/decisions/2026-09-16-squash-merge.md: the status date 2026-09-15 differs from the name's 2026-09-16",
      'docs/decisions/notes.md: a full record must open with "# Decision: <title>"',
    ]);
  });

  it("treats a file that starts like an entry but is misnamed as an error, not a record", () => {
    const root = tempRepo({
      "docs/rules.md": "squash when the repository allows it\n",
      "docs/decisions/2026-9-16-squash-merge.md": entry(),
    });
    const { errors, records } = checkDecisions({ repoRoot: root });
    expect(records).toEqual([]);
    expect(errors.some((error) => error.includes("name must be"))).toBe(true);
  });

  it("only warns when a source has moved or no longer holds the phrase", () => {
    const root = tempRepo({
      "docs/rules.md": "merge commits only\n",
      "docs/decisions/2026-09-16-squash-merge.md": entry(),
      "docs/decisions/2026-09-17-moved-source.md": entry({ status: "decided 2026-09-17", source: "docs/gone.md" }),
    });
    const { errors, warnings } = checkDecisions({ repoRoot: root });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      'docs/decisions/2026-09-16-squash-merge.md: "squash when the repository allows it" is no longer found in docs/rules.md; re-read the source and update the entry',
      "docs/decisions/2026-09-17-moved-source.md: source docs/gone.md no longer exists; point the entry at where the text now lives",
    ]);
  });

  it("warns about two entries sharing a slug", () => {
    const root = tempRepo({
      "docs/rules.md": "squash when the repository allows it\n",
      "docs/decisions/2026-09-16-squash-merge.md": entry(),
      "docs/decisions/2026-09-17-squash-merge.md": entry({ status: "decided 2026-09-17" }),
    });
    const { errors, warnings } = checkDecisions({ repoRoot: root });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      "docs/decisions/2026-09-17-squash-merge.md: same slug as docs/decisions/2026-09-16-squash-merge.md; check it is not a duplicate",
    ]);
  });

  it("reports a missing folder as an error rather than passing", () => {
    const root = tempRepo({ "docs/rules.md": "" });
    expect(checkDecisions({ repoRoot: root }).errors).toEqual(["docs/decisions: the folder does not exist"]);
  });
});

function chatEntry(extraFields: string[] = [], status = "decided 2026-10-15"): string {
  return [
    "# Decision: Keep the review bot but stop it blocking merges",
    "",
    `- **Status:** ${status}`,
    "- **Source:** the owner, in chat",
    ...extraFields,
    "",
    "The review bot stays, but its reviews must not block a merge.",
    "",
    SOURCE_WINS,
    "",
  ].join("\n");
}

const RETIRED_RULES = JSON.stringify({
  version: 1,
  rules: [
    {
      id: "old-merge-gate",
      retired: "2026-10-15",
      summary: "The old merge gate was removed.",
      pattern: "old merge gate",
      allowedContext: "removed",
      decision: "docs/decisions/2026-10-15-review-bot.md",
    },
  ],
});

describe("decisions given in chat and links between records", () => {
  it("accepts an entry the owner gave in chat and lists it as unanchored", () => {
    const parsed = parseDecisionEntry("2026-10-15-review-bot.md", chatEntry());
    expect(parsed.problems).toEqual([]);
    expect(parsed.fromChat).toBe(true);
    const root = tempRepo({ "docs/decisions/2026-10-15-review-bot.md": chatEntry() });
    const result = checkDecisions({ repoRoot: root });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.unanchored).toEqual(["docs/decisions/2026-10-15-review-bot.md"]);
  });

  it("passes a Retires link to a rule that exists, and a rule pointing back at the entry", () => {
    const root = tempRepo({
      "docs/organisation/retired-rules.json": RETIRED_RULES,
      "docs/decisions/2026-10-15-review-bot.md": chatEntry(["- **Retires:** `old-merge-gate`"]),
    });
    const result = checkDecisions({ repoRoot: root });
    expect(result.errors).toEqual([]);
    expect(result.entries[0]?.retires).toEqual(["old-merge-gate"]);
  });

  it("fails a Retires link to a rule that does not exist, and a malformed Retires line", () => {
    const root = tempRepo({
      "docs/organisation/retired-rules.json": RETIRED_RULES,
      "docs/decisions/2026-10-15-review-bot.md": chatEntry(["- **Retires:** `no-such-rule`"]),
      "docs/decisions/2026-10-16-other.md": chatEntry(["- **Retires:** old-merge-gate"], "decided 2026-10-16"),
    });
    const { errors } = checkDecisions({ repoRoot: root });
    expect(errors).toContain(
      'docs/decisions/2026-10-15-review-bot.md: retires "no-such-rule", which is not in docs/organisation/retired-rules.json',
    );
    expect(errors.some((error) => error.startsWith('docs/decisions/2026-10-16-other.md: "Retires" must list'))).toBe(
      true,
    );
  });

  it("fails a retired rule whose decision pointer names no entry", () => {
    const root = tempRepo({
      "docs/organisation/retired-rules.json": RETIRED_RULES,
      "docs/decisions/2026-10-14-elsewhere.md": chatEntry([], "decided 2026-10-14"),
    });
    expect(checkDecisions({ repoRoot: root }).errors).toEqual([
      'docs/organisation/retired-rules.json: rule "old-merge-gate" points at decision docs/decisions/2026-10-15-review-bot.md, which is not an entry in docs/decisions',
    ]);
  });

  it("fails a superseded-by link to an entry that does not exist, and passes one that does", () => {
    const root = tempRepo({
      "docs/decisions/2026-10-14-older.md": chatEntry([], "decided 2026-10-14; superseded by 2026-10-15-missing.md"),
      "docs/decisions/2026-10-13-oldest.md": chatEntry([], "decided 2026-10-13; superseded by 2026-10-14-older.md"),
    });
    expect(checkDecisions({ repoRoot: root }).errors).toEqual([
      "docs/decisions/2026-10-14-older.md: superseded by 2026-10-15-missing.md, which is not an entry in docs/decisions",
    ]);
  });
});

describe("every tool is told how to record a decision", () => {
  it("states the procedure in the always-loaded core and links its full text", () => {
    const agents = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
    expect(agents).toContain("# When the owner makes a decision");
    expect(agents).toContain("(docs/agents/native-startup/recording-decisions.md)");
    expect(fs.existsSync(path.join(repoRoot, "docs/agents/native-startup/recording-decisions.md"))).toBe(true);
  });

  it("loads the same procedure natively for tools that read .agents/rules", () => {
    const wrapper = fs.readFileSync(path.join(repoRoot, ".agents/rules/project-recording-decisions.md"), "utf8");
    expect(wrapper).toContain("trigger: always_on");
    expect(wrapper).toContain("../../docs/agents/native-startup/recording-decisions.md");
  });
});

describe("the repository's decisions folder", () => {
  const result = checkDecisions({ repoRoot });

  it("has no malformed entries", () => {
    expect(result.errors).toEqual([]);
  });

  it("indexes decisions rather than holding none", () => {
    expect(result.entries.length).toBeGreaterThan(20);
  });

  it("keeps the full review-coverage record beside the index", () => {
    expect(result.records).toContain("docs/decisions/ccz4hb-review-coverage.md");
  });

  it("explains in its README that it indexes decisions and how to add one", () => {
    const readme = fs.readFileSync(path.join(repoRoot, "docs/decisions/README.md"), "utf8");
    expect(readme).toContain("This is an index, not a new home for the text.");
    expect(readme).toContain(SOURCE_WINS);
    expect(readme).toContain("## Adding or changing a decision");
  });
});
