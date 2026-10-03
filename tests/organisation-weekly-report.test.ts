import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BODY_LIMIT,
  SECTION_ORDER,
  buildWeeklyReport,
  capBody,
  escapeGithubReferences,
  parseArgs,
} from "../scripts/organisation/weekly-report.mjs";
import {
  buildPathIndex,
  deriveAreas,
  loadOpenItems,
  renderIssuesByArea,
} from "../scripts/organisation/weekly/issues-by-area.mjs";
import { renderMapHygiene, FIX_COMMAND } from "../scripts/organisation/weekly/map-hygiene.mjs";
import { voteForHome } from "../scripts/organisation/weekly/suggested-homes.mjs";
import { importSpecifiers, resolveLocalImport } from "../scripts/organisation/weekly-lib.mjs";

const RUNNER = path.resolve(__dirname, "../scripts/organisation/weekly-report.mjs");
const NOW = new Date("2026-09-28T00:00:00.000Z");
const ZWSP = "​";
const dirs: string[] = [];

type Files = Record<string, string>;

function tempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(root: string, files: Files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

function git(root: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-C", root, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function area(id: string, paths: string[], kind = "area") {
  return JSON.stringify({ version: 1, id, kind, name: `The ${id}`, owns: `what ${id} owns`, canonicalDocs: [], paths });
}

// A small repository with a real map: three areas, one workstream, an ignore rule, a shared file,
// a not-yet-placed test, a stale exact rule, and tests and scripts the map has not placed.
function fixtureRepo(open: unknown[] = []) {
  const root = tempDir("organisation-weekly-");
  git(root, "init", "-q", "-b", "main");
  const files: Files = {
    "docs/organisation/systems/engine.json": area("engine", ["src/engine/**"]),
    "docs/organisation/systems/site.json": area("site", ["data/outstanding-issues-snapshot.json", "src/site/**"]),
    "docs/organisation/systems/tools.json": area("tools", [
      "docs/organisation/**",
      "scripts/tools/**",
      "scripts/tools/gone.mjs",
      "tests/helpers/**",
    ]),
    "docs/organisation/systems/style.json": area("style", ["src/style/**"], "workstream"),
    "docs/organisation/shared.json": JSON.stringify({
      version: 1,
      entries: [{ path: "src/shared.ts", systems: ["engine", "site"], reason: "Used equally by both" }],
    }),
    "docs/organisation/not-yet-placed.json": JSON.stringify({
      version: 1,
      entries: [{ path: "tests/waiting.test.ts", reason: "Tests the engine but sits with the helpers for now" }],
    }),
    "docs/organisation/ignored.json": JSON.stringify({
      version: 1,
      entries: [{ match: "src/retired/**", reason: "Being removed from the project" }],
    }),
    "docs/organisation/kinds.json": JSON.stringify({ version: 1, generated: [], records: [], historical: [] }),
    "docs/organisation/pins.json": JSON.stringify({ version: 1, pins: {} }),
    "data/outstanding-issues-snapshot.json": JSON.stringify({
      version: "outstanding-issues-snapshot-v2",
      ledger_revision: { committed_at: "2026-09-20" },
      open,
    }),
    "src/engine/rank.ts": "export const rank = 1;\n",
    "src/engine/answer.ts": "export const answer = 1;\n",
    "src/engine/cite.ts": "export const cite = 1;\n",
    "src/site/page.tsx": "export const page = 1;\n",
    "src/style/tokens.ts": "export const tokens = 1;\n",
    "src/shared.ts": "export const shared = 1;\n",
    "src/retired/old-feature.ts": "export const old = 1;\n",
    "src/orphan.ts": "export const orphan = 1;\n",
    "scripts/tools/lint.mjs": "export const lint = 1;\n",
    "tests/helpers/fixture.ts": "export const fixture = 1;\n",
    "tests/waiting.test.ts": [
      'import { rank } from "../src/engine/rank";',
      'import { answer } from "../src/engine/answer.js";',
      'import { cite } from "@/engine/cite";',
      'import { page } from "../src/site/page";',
      'import { fixture } from "./helpers/fixture";',
      'import { describe } from "vitest";',
      "describe(String(rank + answer + cite + page + fixture), () => {});",
      "",
    ].join("\n"),
    "tests/loose.test.ts": 'import { fixture } from "./helpers/fixture";\nexport default fixture;\n',
    "tests/tie.test.ts":
      'import { rank } from "../src/engine/rank";\nimport { page } from "../src/site/page";\nexport default rank + page;\n',
    "scripts/solo.mjs": 'import fs from "node:fs";\nexport default fs;\n',
    "scripts/report.py": "print('hello')\n",
  };
  write(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

function item(id: string, priority: string, summary: string, detail = "", source = "") {
  return { id, priority, type: "task", summary, detail, source, added: "2026-09-01" };
}

// A synthetic placement for the pure area-derivation tests; values follow the checker's shapes.
const placement: Record<string, string> = {
  "src/engine/rank.ts": "engine",
  "src/engine/nested/deep.ts": "engine",
  "src/site/page.tsx": "site",
  "src/site/index.ts": "site",
  "src/engine/index.ts": "engine",
  "src/shared.ts": "(shared) engine + site",
  "src/retired/old-feature.ts": "(ignored)",
  "src/orphan.ts": "(unplaced)",
  "docs/organisation/README.md": "tools",
  "AGENTS.md": "tools",
};
const index = buildPathIndex(Object.keys(placement).sort(), placement);
const known = new Set(["engine", "site", "tools"]);
const areasFor = (text: string) => deriveAreas(text, index, known).areas;

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("issues by area: deriving an item's areas", () => {
  it("places an item by the tracked files its text names, in the spellings prose uses", () => {
    expect(areasFor("see src/engine/rank.ts")).toEqual(["engine"]);
    expect(areasFor("broken at `src/engine/rank.ts:40-59`.")).toEqual(["engine"]);
    expect(areasFor("(src/site/page.tsx)")).toEqual(["site"]);
    expect(areasFor("the tail engine/rank.ts is enough")).toEqual(["engine"]);
    expect(areasFor("a bare page.tsx name is unique")).toEqual(["site"]);
    expect(areasFor("a folder: src/engine/** or src/engine/")).toEqual(["engine"]);
  });

  it("gives no area when nothing named is a placed file", () => {
    expect(areasFor("no paths here, just #123 and e.g. prose")).toEqual([]);
    // index.ts names two files, so a bare mention of it is ambiguous and counts for nothing.
    expect(areasFor("index.ts is ambiguous")).toEqual([]);
    // A folder that spans areas says nothing about which one.
    expect(areasFor("somewhere in src/")).toEqual([]);
    expect(areasFor("src/orphan.ts is not placed")).toEqual([]);
  });

  it("never counts a file the map ignores", () => {
    expect(areasFor("src/retired/old-feature.ts and old-feature.ts")).toEqual([]);
    expect(areasFor("src/retired/old-feature.ts and src/site/page.tsx")).toEqual(["site"]);
  });

  it("spans areas when the text names files in two areas, or a shared file", () => {
    expect(areasFor("src/engine/rank.ts and src/site/page.tsx")).toEqual(["engine", "site"]);
    expect(areasFor("src/shared.ts")).toEqual(["engine", "site"]);
  });

  it("does not let a cited doc or root instruction file add an area beside the code an item names", () => {
    expect(areasFor("src/engine/rank.ts, see docs/organisation/README.md")).toEqual(["engine"]);
    expect(areasFor("AGENTS.md says src/site/page.tsx is wrong")).toEqual(["site"]);
    // A doc still places an item that names nothing else, or names only code with no area.
    expect(areasFor("docs/organisation/README.md is out of date")).toEqual(["tools"]);
    expect(areasFor("src/orphan.ts per AGENTS.md")).toEqual(["tools"]);
    expect(deriveAreas("src/engine/rank.ts and AGENTS.md", index, known).paths).toEqual(["src/engine/rank.ts"]);
  });

  it("lets an [area:<id>] tag override the files named", () => {
    const derived = deriveAreas("src/engine/rank.ts and src/site/page.tsx [area:Tools]", index, known);
    expect(derived).toMatchObject({ areas: ["tools"], by: "tag", unknownTags: [] });
  });

  it("falls back to the files named when a tag names no known area, and reports the tag", () => {
    const derived = deriveAreas("src/engine/rank.ts [area:nowhere]", index, known);
    expect(derived).toMatchObject({ areas: ["engine"], by: "paths", unknownTags: ["nowhere"] });
  });
});

describe("issues by area: the section", () => {
  it("reads only summary and detail, never the source column", () => {
    const root = tempDir("organisation-snapshot-");
    write(root, {
      "data/outstanding-issues-snapshot.json": JSON.stringify({
        open: [item("#AAA111", "P2", "summary text", "detail text", "src/engine/rank.ts")],
      }),
    });
    const { items } = loadOpenItems(root);
    expect(items).toEqual([{ id: "#AAA111", priority: "P2", text: "summary text\ndetail text" }]);
  });

  it("fails loudly on a snapshot without an open list", () => {
    const root = tempDir("organisation-snapshot-");
    write(root, { "data/outstanding-issues-snapshot.json": JSON.stringify({ queue: [] }) });
    expect(() => loadOpenItems(root)).toThrow(/no open\[\] list/);
  });

  it("shows every area with counts by priority and ids, plus the spans and no-area groups", () => {
    const systems = [
      { id: "site", name: "Site", kind: "area" },
      { id: "engine", name: "Engine", kind: "area" },
      { id: "tools", name: "Tools", kind: "workstream" },
    ];
    const items = [
      { id: "#E1", priority: "P1", text: "src/engine/rank.ts" },
      { id: "#E2", priority: "P3", text: "src/engine/nested/deep.ts" },
      { id: "#S1", priority: "P2", text: "page.tsx" },
      { id: "#X1", priority: "P2", text: "src/engine/rank.ts and src/site/page.tsx" },
      { id: "#N1", priority: "P1", text: "nothing to see" },
      { id: "#T1", priority: "P3", text: "src/engine/rank.ts [area:bogus]" },
    ];
    const markdown = renderIssuesByArea({ items, revision: "2026-09-20", systems, index });
    expect(markdown).toContain("6 open items in the outstanding-issues snapshot (ledger revision 2026-09-20)");
    expect(markdown).toContain("| Area | Open | P1 | P2 | P3 | Also in items spanning areas |");
    expect(markdown).toContain("| Engine (`engine`) | 3 | 1 | 0 | 2 | 1 |");
    expect(markdown).toContain("| Site (`site`) | 1 | 0 | 1 | 0 | 1 |");
    expect(markdown).toContain("| Tools (workstream) (`tools`) | 0 | 0 | 0 | 0 | 0 |");
    expect(markdown).toContain("| **Spans areas** | 1 | 0 | 1 | 0 |  |");
    expect(markdown).toContain("| **No area** | 1 | 1 | 0 | 0 |  |");
    // Areas before workstreams, each alphabetical.
    expect(markdown.indexOf("| Engine")).toBeLessThan(markdown.indexOf("| Site"));
    expect(markdown.indexOf("| Site")).toBeLessThan(markdown.indexOf("| Tools"));
    expect(markdown).toContain("- **P3** (2): `#E2`, `#T1`");
    expect(markdown).toContain("- `#X1` (P2): `engine`, `site`");
    expect(markdown).toMatch(/### No area\n\n[^\n]*\n\n- \*\*P1\*\* \(1\): `#N1`/);
    expect(markdown).toContain("- `#T1` names `bogus`, which is not an area");
  });

  it("runs end to end against a repository's map and snapshot without editing anything", async () => {
    const root = fixtureRepo([
      item("#ENG001", "P1", "Ranking drifts", "see src/engine/rank.ts:12"),
      item("#TAG001", "P2", "Tagged [area:site]", "src/engine/rank.ts"),
      item("#OLD001", "P3", "Only the retired feature", "src/retired/old-feature.ts"),
    ]);
    const { results } = await buildWeeklyReport({ root, now: NOW, order: ["issues-by-area"] });
    expect(results[0]).toMatchObject({ status: "ok", title: "Open issues by area" });
    expect(results[0].markdown).toContain("- **P1** (1): `#ENG001`");
    expect(results[0].markdown).toContain("| The site (`site`) | 1 | 0 | 1 | 0 | 0 |");
    expect(results[0].markdown).toMatch(/### No area\n\n[^\n]*\n\n- \*\*P3\*\* \(1\): `#OLD001`/);
    expect(git(root, "status", "--porcelain")).toBe("");
  });
});

describe("map hygiene", () => {
  it("lists unplaced files, stale entries, not-yet-placed entries and map problems, with the fix command", async () => {
    const root = fixtureRepo();
    const { results } = await buildWeeklyReport({ root, now: NOW, order: ["map-hygiene"] });
    const markdown = results[0].markdown ?? "";
    expect(results[0]).toMatchObject({ status: "ok", title: "Map hygiene" });
    expect(markdown).toContain("Checker result: **exit 0 (pass)** on the working tree");
    expect(markdown).toContain("### Unplaced files (5)");
    expect(markdown).toContain("- `tests/loose.test.ts`");
    expect(markdown).toContain("- `src/orphan.ts`");
    expect(markdown).toContain("### Stale entries (1)");
    expect(markdown).toContain("- `docs/organisation/systems/tools.json`: rule `scripts/tools/gone.mjs` names a file");
    expect(markdown).toContain("### Not yet placed (1)");
    expect(markdown).toContain("- `tests/waiting.test.ts`: Tests the engine but sits with the helpers for now");
    expect(markdown).toContain(["```bash", FIX_COMMAND, "```"].join("\n"));
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("says when the checker could not finish, and marks broken findings apart from warnings", () => {
    const markdown = renderMapHygiene(
      {
        exitCode: 2,
        verdict: "could not check",
        scope: "working tree",
        incomplete: "sparse checkout: the file list would be incomplete",
        findings: [
          { level: "broken", key: "tie:a.ts", subject: "a.ts", message: "is claimed equally" },
          { level: "warning", key: "empty-glob:x:y", subject: "m.json", message: "rule `y` matches nothing" },
        ],
      },
      null,
    );
    expect(markdown).toContain("**exit 2 (could not check)**");
    expect(markdown).toContain("The checker could not finish: sparse checkout");
    expect(markdown).toContain("- **map broken** `a.ts`: is claimed equally");
    expect(markdown).toContain("- warning `m.json`: rule `y` matches nothing");
    expect(markdown).toContain("### Not yet placed (list unreadable)");
  });
});

describe("suggested homes", () => {
  const votes: Record<string, string> = {
    "src/engine/a.ts": "engine",
    "src/engine/b.ts": "engine",
    "src/engine/c.ts": "engine",
    "src/site/d.ts": "site",
    "src/shared.ts": "(shared) engine + site",
    "tests/helpers/h.ts": "tools",
  };

  it("votes for the area most local imports belong to", () => {
    const vote = voteForHome(
      "scripts/x.mjs",
      ["src/engine/a.ts", "src/engine/b.ts", "src/engine/c.ts", "src/site/d.ts"],
      votes,
    );
    expect(vote).toMatchObject({ area: "engine", votes: 3, total: 4, helpersSkipped: false });
  });

  it("does not let test helpers outvote the code a test tests, unless they are all it imports", () => {
    expect(voteForHome("tests/x.test.ts", ["src/site/d.ts", "tests/helpers/h.ts"], votes)).toMatchObject({
      area: "site",
      votes: 1,
      total: 1,
      helpersSkipped: true,
    });
    expect(voteForHome("tests/x.test.ts", ["tests/helpers/h.ts"], votes)).toMatchObject({ area: "tools", total: 1 });
  });

  it("makes no suggestion on a tie, with no imports, or when no import is placed in one area", () => {
    expect(voteForHome("scripts/x.mjs", ["src/engine/a.ts", "src/site/d.ts"], votes).area).toBeNull();
    expect(voteForHome("scripts/x.mjs", [], votes)).toMatchObject({ area: null, total: 0 });
    expect(voteForHome("scripts/x.mjs", ["src/shared.ts"], votes)).toMatchObject({ area: null, total: 1 });
  });

  it("reads imports, re-exports, dynamic imports and requires, and resolves only local ones", () => {
    const source = [
      'import a from "./a";',
      'import type { B } from "@/b";',
      'export * from "../c.js";',
      'const d = await import("./d");',
      'const e = require("./e.cjs");',
      'import react from "react";',
    ].join("\n");
    expect(importSpecifiers(source, "scripts/x.ts").sort()).toEqual([
      "../c.js",
      "./a",
      "./d",
      "./e.cjs",
      "@/b",
      "react",
    ]);
    const files = new Set(["scripts/a.ts", "src/b/index.ts", "c.ts", "scripts/d.mjs"]);
    expect(resolveLocalImport("scripts/x.ts", "./a", files)).toBe("scripts/a.ts");
    expect(resolveLocalImport("scripts/x.ts", "@/b", files)).toBe("src/b/index.ts");
    expect(resolveLocalImport("scripts/x.ts", "../c.js", files)).toBe("c.ts");
    expect(resolveLocalImport("scripts/x.ts", "./d", files)).toBe("scripts/d.mjs");
    expect(resolveLocalImport("scripts/x.ts", "react", files)).toBeNull();
    expect(resolveLocalImport("scripts/x.ts", "../../outside", files)).toBeNull();
  });

  it("proposes homes for unplaced and not-yet-placed tests and scripts, with the exact map line, and moves nothing", async () => {
    const root = fixtureRepo();
    const { results } = await buildWeeklyReport({ root, now: NOW, order: ["suggested-homes"] });
    const markdown = results[0].markdown ?? "";
    expect(results[0]).toMatchObject({ status: "ok", title: "Suggested homes" });
    expect(markdown).toContain(
      '- `tests/waiting.test.ts` (not yet placed): **engine**, 3 of 4 imports, not counting test helpers. Add `"tests/waiting.test.ts",` to `paths` in `docs/organisation/systems/engine.json`.',
    );
    expect(markdown).toContain("- `tests/loose.test.ts` (unplaced): **tools**, 1 of 1 import.");
    expect(markdown).toContain("- `tests/tie.test.ts` (unplaced): no suggestion; a tie between `engine` and `site`");
    expect(markdown).toContain("- `scripts/solo.mjs` (unplaced): no suggestion; it has no local imports.");
    expect(markdown).toContain(
      "- `scripts/report.py` (unplaced): no suggestion; it is not a JavaScript or TypeScript file.",
    );
    expect(markdown).toContain("1 other waiting file (not a test or script) gets no suggestion");
    expect(git(root, "status", "--porcelain")).toBe("");
  });
});

describe("escaping for a public issue", () => {
  it("defuses mentions and issue references outside code", () => {
    expect(escapeGithubReferences("ask @someone about #123 and org/repo#45, GH-6")).toBe(
      `ask @${ZWSP}someone about #${ZWSP}123 and org/repo#${ZWSP}45, GH${ZWSP}-6`,
    );
    expect(escapeGithubReferences("@media and @sentry/nextjs")).toBe(`@${ZWSP}media and @${ZWSP}sentry/nextjs`);
  });

  it("leaves code, headings, ledger ids and HTML entities alone", () => {
    const text = [
      "## Heading `@kept` and ``#1 `x` #2``",
      "ledger ids like #ABC123 are not references; &#123; is an entity",
      "```text",
      "@inside #1",
      "```",
      "after @out",
    ].join("\n");
    expect(escapeGithubReferences(text)).toBe(text.replace("after @out", `after @${ZWSP}out`));
  });

  it("treats a backslash-escaped backtick as literal text, so it opens no code span", () => {
    // `\`@user`` renders as a literal backtick, a live mention and a lone backtick.
    expect(escapeGithubReferences("\\`@user`")).toBe(`\\\`@${ZWSP}user\``);
    // An even run of backslashes escapes itself, and the backtick still opens a span.
    expect(escapeGithubReferences("\\\\`@kept`")).toBe("\\\\`@kept`");
  });

  it("does not treat a backtick line whose info string holds a backtick as a fence", () => {
    const text = ["```x`y @user", "@after"].join("\n");
    expect(escapeGithubReferences(text)).toBe(["```x`y @" + ZWSP + "user", "@" + ZWSP + "after"].join("\n"));
    // A tilde fence may carry a backtick in its info string.
    const tilde = ["~~~x`y", "@inside", "~~~"].join("\n");
    expect(escapeGithubReferences(tilde)).toBe(tilde);
  });

  it("escapes a whole report, including what sections return", async () => {
    const sectionsDir = tempDir("organisation-sections-");
    write(sectionsDir, {
      "one.mjs":
        'export async function section() { return { title: "One", markdown: "ping @owner about #42 and `@kept`" }; }',
    });
    const { markdown } = await buildWeeklyReport({ root: sectionsDir, now: NOW, sectionsDir, order: ["one"] });
    expect(markdown).toContain(`ping @${ZWSP}owner about #${ZWSP}42 and \`@kept\``);
  });
});

describe("the 60,000-character cap", () => {
  it("leaves a body under the cap untouched", () => {
    expect(capBody("short", 100)).toBe("short");
  });

  it("cuts at a line break, closes an open code fence and adds a truncation note", () => {
    const body = ["# Report", "```text", ...Array.from({ length: 5000 }, (_, i) => `line ${i}`), "```"].join("\n");
    const capped = capBody(body, 2000);
    expect(capped.length).toBeLessThanOrEqual(2000);
    expect(capped).toContain("The report was cut here to stay under 2,000 characters.");
    expect(capped).toMatch(/line \d+\n```\n\n_The report was cut/);
  });

  it("caps the built report at 60,000 characters by default", async () => {
    const sectionsDir = tempDir("organisation-sections-");
    write(sectionsDir, {
      "big.mjs": 'export async function section() { return { title: "Big", markdown: "word ".repeat(40000) }; }',
    });
    const { markdown } = await buildWeeklyReport({ root: sectionsDir, now: NOW, sectionsDir, order: ["big"] });
    expect(BODY_LIMIT).toBe(60_000);
    expect(markdown.length).toBeLessThanOrEqual(60_000);
    expect(markdown).toContain("The report was cut here");
  });
});

describe("the report runner", () => {
  it("runs sections in the fixed order, skipping missing ones and naming them", async () => {
    const sectionsDir = tempDir("organisation-sections-");
    write(sectionsDir, {
      "map-hygiene.mjs": 'export async function section() { return { title: "Second", markdown: "b" }; }',
      "issues-by-area.mjs": 'export async function section() { return { title: "First", markdown: "a" }; }',
    });
    const { markdown, results } = await buildWeeklyReport({ root: sectionsDir, now: NOW, sectionsDir });
    expect(results.map((result) => result.name)).toEqual(SECTION_ORDER);
    expect(markdown.indexOf("## First")).toBeLessThan(markdown.indexOf("## Second"));
    expect(markdown).toContain(
      "Sections not present in this checkout: review-dates, stale-docs, suggested-homes, untested-code, classifier-disagreements.",
    );
    expect(markdown).toContain("Built 2026-09-28T00:00:00.000Z");
  });

  it("shows 'section failed' for a section that throws, and keeps the rest", async () => {
    const sectionsDir = tempDir("organisation-sections-");
    write(sectionsDir, {
      "throws.mjs": `export async function section() { throw new Error(${JSON.stringify(`no data at ${sectionsDir}/x.json`)}); }`,
      "fine.mjs": 'export async function section() { return { title: "Fine", markdown: "still here" }; }',
    });
    const { markdown } = await buildWeeklyReport({
      root: sectionsDir,
      now: NOW,
      sectionsDir,
      order: ["throws", "fine"],
    });
    // The machine's own path never reaches the public issue.
    expect(markdown).toContain("## throws\n\nsection failed: no data at ./x.json");
    expect(markdown).toContain("## Fine\n\nstill here");
  });

  it("treats a module that will not load, exports no section, returns the wrong shape or never settles as failed", async () => {
    const sectionsDir = tempDir("organisation-sections-");
    write(sectionsDir, {
      "syntax.mjs": "export async function section( {",
      "noexport.mjs": "export const other = 1;",
      "shape.mjs": "export async function section() { return { title: 'x' }; }",
      "never.mjs": "export function section() { return new Promise(() => {}); }",
    });
    const { results } = await buildWeeklyReport({
      root: sectionsDir,
      now: NOW,
      sectionsDir,
      order: ["syntax", "noexport", "shape", "never"],
    });
    expect(results.map((result) => result.status)).toEqual(["failed", "failed", "failed", "failed"]);
    expect(results[1].reason).toContain("does not export a section() function");
    expect(results[2].reason).toContain("returned no { title, markdown }");
    expect(results[3].reason).toContain("without a result");
  });

  it("kills a section stuck in synchronous work, and skips sections once the time budget is spent", async () => {
    const sectionsDir = tempDir("organisation-sections-");
    write(sectionsDir, {
      "spins.mjs": "export function section() { for (;;) {} }",
      "later.mjs": 'export async function section() { return { title: "Later", markdown: "never run" }; }',
    });
    const started = Date.now();
    const { markdown, results } = await buildWeeklyReport({
      root: sectionsDir,
      now: NOW,
      sectionsDir,
      order: ["spins", "later", "absent"],
      timeoutMs: 60_000,
      budgetMs: 1_500,
    });
    // The budget caps the first section's kill timeout, so a spinning section cannot outlast it.
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(results.map((result) => result.status)).toEqual(["failed", "failed", "missing"]);
    expect(results[0].reason).toBe("timed out after 2 s");
    expect(markdown).toContain("## later\n\nsection failed: skipped, time budget used");
  });

  it("passes the repository root and an injected Date to every section", async () => {
    const sectionsDir = tempDir("organisation-sections-");
    write(sectionsDir, {
      "echo.mjs":
        'export async function section({ root, now }) { return { title: "Echo", markdown: `root=${root} now=${now instanceof Date ? now.toISOString() : "not a date"}` }; }',
    });
    const { markdown } = await buildWeeklyReport({ root: sectionsDir, now: NOW, sectionsDir, order: ["echo"] });
    expect(markdown).toContain(`root=${sectionsDir} now=2026-09-28T00:00:00.000Z`);
  });

  it("parses --out and --now, and rejects anything else", () => {
    const args = parseArgs(["--out", "report.md", "--now", "2026-01-02T03:04:05Z"]);
    expect(args.out).toBe(path.resolve("report.md"));
    expect(args.now.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(() => parseArgs(["--now", "not-a-date"])).toThrow(/not a date/);
    expect(() => parseArgs(["--out"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--unknown"])).toThrow(/unknown argument/);
  });

  it("still writes the report, then exits 1, when a section fails", () => {
    // Not a git repository, so every section that asks git fails.
    const root = tempDir("organisation-not-a-repo-");
    const out = path.join(tempDir("organisation-out-"), "weekly.md");
    const result = spawnSync(
      process.execPath,
      [RUNNER, "--root", root, "--out", out, "--now", "2026-09-28T00:00:00Z"],
      {
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTIONS: "" },
      },
    );
    expect(result.status).toBe(1);
    const markdown = fs.readFileSync(out, "utf8");
    expect(markdown.startsWith("# Organisation weekly report\n")).toBe(true);
    expect(markdown).toContain("section failed:");
  });

  it("writes the report to --out from the command line and exits 0", () => {
    const root = fixtureRepo([item("#CLI001", "P2", "src/site/page.tsx")]);
    const out = path.join(tempDir("organisation-out-"), "nested", "weekly.md");
    const result = spawnSync(
      process.execPath,
      [RUNNER, "--root", root, "--out", out, "--now", "2026-09-28T00:00:00Z"],
      { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } },
    );
    expect(result.status).toBe(0);
    const markdown = fs.readFileSync(out, "utf8");
    expect(markdown).toMatch(
      /^# Organisation weekly report\n\nBuilt 2026-09-28T00:00:00\.000Z from commit `[0-9a-f]{12}`/,
    );
    for (const title of ["## Open issues by area", "## Map hygiene", "## Suggested homes"])
      expect(markdown).toContain(title);
    // Tracked files only: sections other builders add may keep untracked caches.
    expect(git(root, "status", "--porcelain", "--untracked-files=no")).toBe("");
  });
});
