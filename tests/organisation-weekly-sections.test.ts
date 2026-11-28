import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { codeSpan } from "../scripts/organisation/map-placement.mjs";
import { pinStatus } from "../scripts/organisation/pins.mjs";
import {
  BASELINE_FILE,
  CLASSIFIERS,
  findDisagreements,
  findPositives,
  readBaseline,
  section as classifierSection,
  updateBaseline,
} from "../scripts/organisation/weekly/classifier-disagreements.mjs";
import { section as staleDocsSection } from "../scripts/organisation/weekly/stale-docs.mjs";
import { section as untestedSection, untestedNewCode } from "../scripts/organisation/weekly/untested-code.mjs";

const REPO_ROOT = path.resolve(__dirname, "..");
const roots: string[] = [];
type Files = Record<string, string>;

function git(root: string, args: string[], date?: string) {
  const env = date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env;
  const result = spawnSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-C", root, ...args], {
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "organisation-weekly-"));
  roots.push(dir);
  return dir;
}

function write(root: string, files: Files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
}

const MAP_RULE = "docs/organisation/**";

function mapFiles(
  areas: Record<string, { paths: string[]; docs?: string[] }>,
  { ignored = [] as string[], records = [] as string[], pins = {} as Record<string, string> } = {},
): Files {
  const files: Files = {};
  for (const [id, { paths, docs = [] }] of Object.entries(areas)) {
    files[`docs/organisation/systems/${id}.json`] = JSON.stringify({
      version: 1,
      id,
      kind: "area",
      name: id,
      owns: `what ${id} owns`,
      canonicalDocs: docs,
      paths: [...paths].sort(),
    });
  }
  files["docs/organisation/shared.json"] = JSON.stringify({ version: 1, entries: [] });
  files["docs/organisation/not-yet-placed.json"] = JSON.stringify({ version: 1, entries: [] });
  files["docs/organisation/ignored.json"] = JSON.stringify({
    version: 1,
    entries: ignored.map((match) => ({ match, reason: "being removed" })),
  });
  files["docs/organisation/kinds.json"] = JSON.stringify({ version: 1, generated: [], records, historical: [] });
  files["docs/organisation/pins.json"] = JSON.stringify({ version: 1, pins });
  return files;
}

function repo(files: Files, date = "2030-01-01T00:00:00Z") {
  const root = tempDir();
  git(root, ["init", "-q", "-b", "main"]);
  write(root, files);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"], date);
  return root;
}

function commit(root: string, files: Files, { remove = [] as string[], date = "2030-01-02T00:00:00Z" } = {}) {
  write(root, files);
  for (const file of remove) fs.rmSync(path.join(root, file));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "change"], date);
  return git(root, ["rev-parse", "HEAD"]);
}

function shallowClone(root: string) {
  const dest = path.join(tempDir(), "clone");
  git(root, ["clone", "-q", "--depth", "1", pathToFileURL(root).href, dest]);
  return dest;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("code spans in the report", () => {
  it("keeps file names verbatim, with no backslashes, and fences around backticks", () => {
    expect(codeSpan("src/app/[id]/page_view.tsx")).toBe("`src/app/[id]/page_view.tsx`");
    expect(codeSpan("odd`name.md")).toBe("``odd`name.md``");
    expect(codeSpan("`edge")).toBe("`` `edge ``");
  });
});

describe("pins and stale key documents", () => {
  const areas = {
    eng: { paths: ["src/eng/**", "docs/eng.md", "data/eng/**"], docs: ["docs/eng.md"] },
    kn: { paths: [MAP_RULE, "docs/kn.md"], docs: ["docs/kn.md"] },
  };

  function pinnedRepo() {
    const root = repo({
      ...mapFiles(areas, { records: ["data/eng/**"] }),
      "src/eng/a.ts": "a",
      "src/eng/old.ts": "old",
      "docs/eng.md": "eng",
      "docs/kn.md": "kn",
    });
    const base = git(root, ["rev-parse", "HEAD"]);
    // Recording the pins edits the map folder, which never counts as an area change.
    commit(root, mapFiles(areas, { records: ["data/eng/**"], pins: { "docs/eng.md": base, "docs/kn.md": base } }));
    return { root, base };
  }

  const row = (root: string, doc: string) => pinStatus({ root }).find((r) => r.doc === doc)!;

  it("flags a doc once its area changes after the pin, and not for other areas, records or the map", () => {
    const { root, base } = pinnedRepo();
    expect(row(root, "docs/eng.md")).toMatchObject({ status: "checked", stale: false, commitsSinceInArea: 0 });
    commit(root, { "src/eng/a.ts": "a2", "data/eng/log.json": "{}" });
    const eng = row(root, "docs/eng.md");
    expect(eng).toMatchObject({
      area: "eng",
      pinnedCommit: base,
      status: "checked",
      commitsSinceInArea: 1,
      docChangedSincePin: false,
      commitsSinceLastRead: 1,
      stale: true,
      changedFiles: ["src/eng/a.ts"],
    });
    expect(row(root, "docs/kn.md")).toMatchObject({ commitsSinceInArea: 0, stale: false });
  });

  it("treats an edit to the doc as a read, and flags it again when the area moves on", () => {
    const { root } = pinnedRepo();
    commit(root, { "src/eng/a.ts": "a2" });
    commit(root, { "docs/eng.md": "eng, updated" });
    expect(row(root, "docs/eng.md")).toMatchObject({
      commitsSinceInArea: 1,
      docChangedSincePin: true,
      commitsSinceLastRead: 0,
      stale: false,
    });
    commit(root, {}, { remove: ["src/eng/old.ts"] });
    expect(row(root, "docs/eng.md")).toMatchObject({
      commitsSinceInArea: 2,
      commitsSinceLastRead: 1,
      stale: true,
      changedFiles: ["src/eng/old.ts"],
    });
  });

  it("reports pins it cannot trust instead of guessing", () => {
    const { root } = pinnedRepo();
    git(root, ["checkout", "-q", "-b", "side"]);
    const sideOnly = commit(root, { "src/eng/side.ts": "side" });
    git(root, ["checkout", "-q", "main"]);
    const blob = git(root, ["rev-parse", "HEAD:docs/kn.md"]);
    commit(root, {
      ...mapFiles(
        { ...areas, eng: { ...areas.eng, docs: ["docs/eng.md", "docs/gone.md"] } },
        { pins: { "docs/eng.md": sideOnly, "docs/kn.md": blob } },
      ),
      "docs/extra.md": "not canonical",
    });
    const rows = pinStatus({ root });
    expect(rows.find((r) => r.doc === "docs/eng.md")?.status).toBe("pin not in history");
    expect(rows.find((r) => r.doc === "docs/kn.md")?.status).toBe("pin unreadable");
    expect(rows.find((r) => r.doc === "docs/gone.md")?.status).toBe("doc missing");
  });

  it("says a doc has no pin, and degrades on a shallow clone", async () => {
    const { root } = pinnedRepo();
    commit(root, { "src/eng/a.ts": "a2" });
    const clone = shallowClone(root);
    const rows = pinStatus({ root: clone });
    expect(rows.map((r) => r.status)).toEqual(["pin not in history", "pin not in history"]);
    const { markdown } = await staleDocsSection({ root: clone, now: new Date("2030-02-01T00:00:00Z") });
    expect(markdown).toContain("older than this shallow clone's history");

    commit(root, mapFiles(areas, { records: ["data/eng/**"] }));
    expect(pinStatus({ root }).map((r) => r.status)).toEqual(["no pin", "no pin"]);
  });

  it("writes a section that names the stale doc, what changed and the commit to re-pin to", async () => {
    const { root } = pinnedRepo();
    const head = commit(root, { "src/eng/a.ts": "a2" });
    const { title, markdown } = await staleDocsSection({ root, now: new Date("2030-02-01T00:00:00Z") });
    expect(title).toBe("Key documents that may be out of date");
    expect(markdown).toContain("**1 of 2** key documents may be out of date; 1 is current.");
    expect(markdown).toContain("- `docs/eng.md` (eng): 1 commit since last read, touching `src/eng/a.ts`");
    expect(markdown).toContain(head);
  });
});

describe("untested new code", () => {
  const areas = {
    eng: { paths: ["src/app/things/**", "scripts/run-*", "worker/**"] },
    kn: { paths: [MAP_RULE, "tests/new*", "tests/old*"] },
  };
  const NOW = new Date("2030-01-25T00:00:00Z");

  function historyRepo() {
    const root = repo(
      {
        ...mapFiles(areas, { ignored: ["src/removed/**"] }),
        "src/lib/old-untested.ts": "export const old = 1;\n",
        "tests/old.test.ts": "import { x } from '../src/lib/new-tested';\n",
      },
      "2030-01-01T00:00:00Z",
    );
    commit(
      root,
      {
        "src/lib/new-tested.ts": "import { deep } from './deep';\nexport const x = deep;\n",
        "src/lib/deep.ts": "export const deep = 1;\n",
        "src/lib/new-untested.ts": "export const lonely = 1;\n",
        "src/lib/types-only.ts": "export type A = { a: number };\nexport interface B { b: string }\n",
        "src/lib/only-type-imported.ts": "export const shape = 1;\nexport type Shape = number;\n",
        "src/lib/via-alias.ts": "export const aliased = 1;\n",
        "src/app/things/page.tsx": "export default function Page() { return null; }\n",
        "src/removed/gone-soon.ts": "export const gone = 1;\n",
        "scripts/run-me.mjs": "import './run-me-helper.mjs';\n",
        "scripts/run-me-helper.mjs": "export const helper = 1;\n",
        "worker/first-name.ts": "export const w = 1;\n",
        "tests/new.test.ts": [
          "import type { Shape } from '@/lib/only-type-imported';",
          "import { aliased } from '@/lib/via-alias';",
          "const identity = <T,>(value: T): T => value;",
          "const generic = <T>(value: T) => value;",
          "spawnSync(process.execPath, ['scripts/run-me.mjs']);",
          "",
        ].join("\n"),
      },
      { date: "2030-01-20T00:00:00Z" },
    );
    git(root, ["mv", "worker/first-name.ts", "worker/renamed.ts"]);
    git(root, ["commit", "-q", "-m", "rename"], "2030-01-21T00:00:00Z");
    commit(root, { "src/lib/after-now.ts": "export const later = 1;\n" }, { date: "2030-02-10T00:00:00Z" });
    return root;
  }

  it("lists new code no test reaches, following imports, aliases, renames and paths named in tests", () => {
    const root = historyRepo();
    const result = untestedNewCode({ root, now: NOW });
    expect(result.history).toBe("complete");
    expect(result.untested.map((u) => u.file)).toEqual([
      "src/lib/new-untested.ts",
      "src/lib/only-type-imported.ts",
      "worker/renamed.ts",
    ]);
    // Reached through an import chain, an `@/` alias, or a path named in a test.
    expect(result.candidates).toEqual(
      expect.arrayContaining(["src/lib/deep.ts", "src/lib/via-alias.ts", "scripts/run-me-helper.mjs"]),
    );
    // Outside the window, a Next.js page, an ignored file: never candidates.
    for (const skipped of [
      "src/lib/old-untested.ts",
      "src/lib/after-now.ts",
      "src/app/things/page.tsx",
      "src/removed/gone-soon.ts",
    ]) {
      expect(result.candidates).not.toContain(skipped);
    }
    expect(result.unparsed).toEqual([]);
  });

  it("defaults the window's end to HEAD's commit time, never the clock", () => {
    const root = historyRepo();
    const result = untestedNewCode({ root });
    expect(result.until.toISOString()).toBe("2030-02-10T00:00:00.000Z");
    expect(result.untested.map((u) => u.file)).toContain("src/lib/after-now.ts");
  });

  it("writes per-area counts and caps the list at twenty", async () => {
    const files: Files = {};
    for (let i = 0; i < 23; i++)
      files[`src/feature/loose-${String(i).padStart(2, "0")}.ts`] = `export const v${i} = ${i};\n`;
    files["scripts/tool.mjs"] = "export const tool = 1;\n";
    const root = repo({
      ...mapFiles({ eng: { paths: ["src/feature/**"] }, ops: { paths: ["scripts/too*"] }, kn: { paths: [MAP_RULE] } }),
    });
    commit(root, files, { date: "2030-01-20T00:00:00Z" });
    const { title, markdown } = await untestedSection({ root, now: NOW });
    expect(title).toBe("New code that no test reaches");
    expect(markdown).toContain("**24 of 24** new code files are not reached by any test.");
    expect(markdown).toContain("By area: eng 23, ops 1.");
    expect(markdown.match(/^- `/gm)).toHaveLength(20);
    expect(markdown).toContain("- …and 4 more");
  });

  it("says history is unavailable when a shallow clone cuts the window", async () => {
    const clone = shallowClone(historyRepo());
    const { markdown } = await untestedSection({ root: clone, now: NOW });
    expect(markdown).toContain("Not checked: this checkout is a shallow clone");
  });
});

describe("classifier disagreements", () => {
  const areas = {
    data: { paths: ["db/**"] },
    eng: { paths: ["src/feature/**"] },
    kn: { paths: [MAP_RULE] },
  };

  type Classifier = {
    id: string;
    name: string;
    pairings: Array<{ cls: string; flag: string; expect: string[]; only?: RegExp }>;
    notCompared: string;
    classify?: (root: string, candidates: Map<string, string[]>) => Promise<Map<string, string[]>>;
  };

  // Says "database" for any path containing "db"; expects those files in the data area.
  function fakeClassifier(overrides: Partial<Classifier> = {}): Classifier {
    return {
      id: "fake",
      name: "Fake",
      pairings: [{ cls: "database", flag: "db", expect: ["data"] }],
      notCompared: "nothing else",
      async classify(_root: string, candidates: Map<string, string[]>) {
        return new Map([...candidates].map(([cls, files]) => [cls, files.filter((f) => f.includes("db"))]));
      },
      ...overrides,
    };
  }

  function mapRepo() {
    return repo({
      ...mapFiles(areas, { ignored: ["src/removed/**"] }),
      "db/schema.sql": "",
      "src/feature/db-client.ts": "",
      "src/removed/db-old.ts": "",
      "unplaced/db-note.txt": "",
    });
  }

  it("flags only placed files outside the expected areas", async () => {
    const root = mapRepo();
    const { disagreements, unavailable } = await findDisagreements({ root, classifiers: [fakeClassifier()] });
    expect(unavailable).toEqual([]);
    expect(disagreements).toEqual([
      { classifier: "Fake: database", file: "src/feature/db-client.ts", area: "eng", expected: ["data"] },
    ]);
  });

  it("compares a pairing with `only` for the matching files alone", async () => {
    const root = mapRepo();
    const classifier = fakeClassifier({
      pairings: [{ cls: "database", flag: "db", expect: ["data"], only: /\.sql$/ }],
    });
    const { disagreements } = await findDisagreements({ root, classifiers: [classifier] });
    expect(disagreements).toEqual([]);
  });

  it("reports only disagreements missing from the baseline, and counts resolved ones", async () => {
    const root = mapRepo();
    const classifiers = [fakeClassifier()];
    let { markdown } = await classifierSection({ root, classifiers });
    expect(markdown).toContain("No readable baseline");
    expect(markdown).toContain("**1 new disagreement** (1 today, 0 in the baseline).");

    expect(await updateBaseline({ root, classifiers })).toBe(1);
    expect(readBaseline(root)).toEqual([
      { classifier: "Fake: database", file: "src/feature/db-client.ts", area: "eng" },
    ]);
    ({ markdown } = await classifierSection({ root, classifiers }));
    expect(markdown).toContain("**0 new disagreements** (1 today, 1 in the baseline).");

    commit(root, { "src/feature/db-cache.ts": "" }, { remove: ["src/feature/db-client.ts"] });
    ({ markdown } = await classifierSection({ root, classifiers }));
    expect(markdown).toContain("**1 new disagreement** (1 today, 1 in the baseline).");
    expect(markdown).toContain(
      "- `src/feature/db-cache.ts`: Fake: database (expected in data), but the map places it in eng",
    );
    expect(markdown).toContain("1 baseline entry no longer disagrees");
  });

  it("lists a classifier that could not run, and refuses to rewrite the baseline without it", async () => {
    const root = mapRepo();
    const broken = fakeClassifier({
      name: "Broken",
      async classify() {
        throw new Error("scripts/broken.mjs is missing");
      },
    });
    const { markdown } = await classifierSection({ root, classifiers: [broken] });
    expect(markdown).toContain("- Broken: scripts/broken.mjs is missing");
    await expect(updateBaseline({ root, classifiers: [broken] })).rejects.toThrow(/not updating the baseline/);
    expect(fs.existsSync(path.join(root, BASELINE_FILE))).toBe(false);
  });

  it("finds single positives by halving, with far fewer calls than files", async () => {
    const files = Array.from({ length: 256 }, (_, i) => `f${i}`);
    let calls = 0;
    const found = await findPositives(files, async (list) => {
      calls += 1;
      return list.some((f) => f === "f7" || f === "f200");
    });
    expect(found).toEqual(["f7", "f200"]);
    expect(calls).toBeLessThan(40);
  });

  it("names six classifiers and pairs only job-shaped classes", () => {
    expect(CLASSIFIERS).toHaveLength(6);
    const pairings = CLASSIFIERS.flatMap((c) => c.pairings.map((p) => `${c.id}:${p.cls}=>${p.expect.join("|")}`));
    expect(pairings).toEqual(
      expect.arrayContaining([
        "pr-policy:ranking-protected=>answer-engine|source-intake",
        "pr-policy:migration=>data-platform",
      ]),
    );
    for (const c of CLASSIFIERS) expect(c.notCompared.length).toBeGreaterThan(10);
  });

  it("compares pr-policy's UI class for pages only, never route handlers or components", () => {
    const pages = CLASSIFIERS.find((c) => c.id === "pr-policy")!.pairings.find((p) => p.cls === "UI pages")!;
    expect(pages.expect).toContain("app-experience");
    const only = pages.only!;
    expect(only.test("src/app/(search-app)/my-work/page.tsx")).toBe(true);
    expect(only.test("src/app/layout.tsx")).toBe(true);
    expect(only.test("src/app/auth/callback/route.ts")).toBe(false);
    expect(only.test("src/app/api/cme/route.ts")).toBe(false);
    expect(only.test("src/components/on-call/board.tsx")).toBe(false);
  });

  it("calls the real classifiers without side effects", async () => {
    const outputFile = path.join(tempDir(), "github-output");
    const previous = process.env.GITHUB_OUTPUT;
    process.env.GITHUB_OUTPUT = outputFile;
    try {
      const byId = new Map(CLASSIFIERS.map((c) => [c.id, c]));
      const ci = await byId.get("ci-change-scope")!.classify!(
        REPO_ROOT,
        new Map([
          ["database lane", ["docs/README.md", "supabase/migrations/20990101000000_example.sql", "src/lib/utils.ts"]],
          ["ingestion scan lane", ["docs/README.md"]],
        ]),
      );
      expect(ci.get("database lane")).toEqual(["supabase/migrations/20990101000000_example.sql"]);
      expect(ci.get("ingestion scan lane")).toEqual([]);
      const policy = await byId.get("pr-policy")!.classify!(
        REPO_ROOT,
        new Map([["migration", ["supabase/migrations/20990101000000_example.sql", "docs/README.md"]]]),
      );
      expect(policy.get("migration")).toEqual(["supabase/migrations/20990101000000_example.sql"]);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = previous;
    }
    expect(fs.existsSync(outputFile)).toBe(false);
  });

  it("keeps the committed baseline readable and sorted", () => {
    const baseline = readBaseline(REPO_ROOT);
    expect(baseline).not.toBeNull();
    const keys = baseline!.map((d) => `${d.classifier}\0${d.file}`);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });
});
