import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  areasFor,
  defaultStateDir,
  editHookOutput,
  editNotes,
  pruneOldMemory,
  repoRelativePath,
  sessionHealthLine,
  sessionHookOutput,
  stateKey,
  usableStateDir,
} from "../scripts/organisation/agent-hooks.mjs";
import { safetyClassesFor } from "../scripts/organisation/safety-lists.mjs";

/**
 * The organisation framework's two Claude Code hooks (suggestions 3 and 13): a PreToolUse note
 * when an edit targets a file on a safety list, and a SessionStart line of map health. Both must
 * warn and never block: no `permissionDecision` ever (an "allow" would skip the user's permission
 * prompt), exit 0 on every input, nothing printed on error, no report and no lock written.
 */

const repoRoot = path.resolve(__dirname, "..");
const EDIT_HOOK = path.join(repoRoot, ".claude/hooks/organisation-edit-warning.sh");
const SESSION_HOOK = path.join(repoRoot, ".claude/hooks/organisation-session-line.sh");
const dirs: string[] = [];

type Files = Record<string, string>;

function tempDir(prefix: string) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

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

function system(id: string, name: string, canonicalDocs: string[], paths: string[]) {
  return JSON.stringify({ version: 1, id, kind: "area", name, owns: `what ${id} owns`, canonicalDocs, paths });
}

/** A small checkout of this project: the pr-policy marker, a two-area map and one file per rule. */
function fixtureFiles({ nyp = [] as { path: string; reason: string }[], extraAnswerPaths = [] as string[] } = {}) {
  return {
    "scripts/pr-policy.mjs": "// marker: this is a checkout of the project\n",
    "docs/answers-guide.md": "# guide\n",
    "src/lib/rag/sample.ts": "export {};\n",
    "src/shared.ts": "export {};\n",
    "data/records/sample.json": "{}\n",
    "supabase/migrations/20990101000000_sample.sql": "select 1;\n",
    "legacy/old.ts": "export {};\n",
    "docs/organisation/systems/answers.json": system(
      "answers",
      "Fixture answers",
      ["docs/answers-guide.md"],
      [
        "docs/answers-guide.md",
        "docs/organisation/**",
        "scripts/pr-policy.mjs",
        "src/lib/rag/**",
        ...extraAnswerPaths,
      ].sort(),
    ),
    "docs/organisation/systems/records.json": system(
      "records",
      "Fixture records",
      [],
      ["data/records/**", "supabase/**"],
    ),
    "docs/organisation/shared.json": JSON.stringify({
      version: 1,
      entries: [{ path: "src/shared.ts", systems: ["answers", "records"], reason: "used by both areas" }],
    }),
    "docs/organisation/not-yet-placed.json": JSON.stringify({ version: 1, entries: nyp }),
    "docs/organisation/ignored.json": JSON.stringify({
      version: 1,
      entries: [{ match: "legacy/**", reason: "being removed" }],
    }),
    "docs/organisation/kinds.json": JSON.stringify({ version: 1, generated: [], records: [], historical: [] }),
    "docs/organisation/pins.json": JSON.stringify({ version: 1, pins: {} }),
  } satisfies Files;
}

function fixture(files: Files = fixtureFiles(), { commit = false } = {}) {
  const root = tempDir("organisation-hooks-");
  git(root, "init", "-q", "-b", "main");
  write(root, files);
  git(root, "add", "-A");
  if (commit) git(root, "commit", "-q", "-m", "base");
  return root;
}

function editPayload(file: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    session_id: "session-one",
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: file, old_string: "a", new_string: "b" },
    ...extra,
  });
}

function contextOf(output: string | null): string {
  if (output === null) return "";
  const parsed = JSON.parse(output);
  expect(Object.keys(parsed)).toEqual(["hookSpecificOutput"]);
  expect(Object.keys(parsed.hookSpecificOutput).sort()).toEqual(["additionalContext", "hookEventName"]);
  return parsed.hookSpecificOutput.additionalContext;
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...allKeys(inner)]);
  }
  return [];
}

function runHook(hook: string, input: string, env: Record<string, string> = {}, bash = "bash") {
  const state = tempDir("organisation-hooks-state-");
  return spawnSync(bash, [hook], {
    input,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot, TMPDIR: state, TEMP: state, TMP: state, ...env },
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("edit warning: safety lists", () => {
  it("uses sample paths that pr-policy really classifies (precondition)", () => {
    expect(safetyClassesFor("src/lib/rag/sample.ts")).toContain("ragRanking");
    expect(safetyClassesFor("supabase/migrations/20990101000000_sample.sql")).toContain("migration");
    expect(safetyClassesFor("data/records/sample.json")).toEqual(["clinicalRisk"]);
    expect(safetyClassesFor("docs/answers-guide.md")).toEqual([]);
  });

  it("warns on every edit of a ranking-protected file", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const file = path.join(root, "src/lib/rag/sample.ts");
    for (let i = 0; i < 2; i++) {
      const context = contextOf(editHookOutput(editPayload(file), { stateDir }));
      expect(context).toContain("src/lib/rag/sample.ts is ranking-protected");
      expect(context).toContain("docs/rag-behaviour/");
      expect(context).toContain("`RAG impact:`");
    }
  });

  it("warns on every edit of a migration that merging applies it to the live clinical database", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const file = path.join(root, "supabase/migrations/20990101000000_sample.sql");
    for (let i = 0; i < 2; i++) {
      const context = contextOf(editHookOutput(editPayload(file), { stateDir }));
      expect(context).toContain("is a database migration");
      expect(context).toContain("live clinical database within seconds");
    }
  });

  it("mentions the Clinical Governance Preflight once per session, and again for a subagent", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const file = path.join(root, "data/records/sample.json");
    expect(contextOf(editHookOutput(editPayload(file), { stateDir }))).toContain("Clinical Governance Preflight");
    expect(contextOf(editHookOutput(editPayload(file), { stateDir }))).not.toContain("Clinical Governance Preflight");
    const subagent = editPayload(file, { agent_id: "agent-7" });
    expect(contextOf(editHookOutput(subagent, { stateDir }))).toContain("Clinical Governance Preflight");
    const otherSession = editPayload(file, { session_id: "session-two" });
    expect(contextOf(editHookOutput(otherSession, { stateDir }))).toContain("Clinical Governance Preflight");
  });

  it("shows the once-per-session notes every time when the payload has no usable session id", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const file = path.join(root, "data/records/sample.json");
    for (const session of [undefined, "../escape", ""]) {
      const payload = editPayload(file, { session_id: session });
      expect(contextOf(editHookOutput(payload, { stateDir }))).toContain("Clinical Governance Preflight");
      expect(contextOf(editHookOutput(payload, { stateDir }))).toContain("Clinical Governance Preflight");
    }
    expect(fs.readdirSync(stateDir)).toEqual([]);
  });

  it("says nothing about a file on no safety list once its area has been named", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const file = path.join(root, "docs/answers-guide.md");
    expect(contextOf(editHookOutput(editPayload(file), { stateDir }))).toContain("First edit in Fixture answers");
    expect(editHookOutput(editPayload(file), { stateDir })).toBeNull();
  });
});

describe("edit warning: areas", () => {
  it("names the area and its key docs on the first edit in each area per session", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const first = contextOf(editHookOutput(editPayload(path.join(root, "src/lib/rag/sample.ts")), { stateDir }));
    expect(first).toContain("First edit in Fixture answers this session; its key docs are docs/answers-guide.md.");
    const again = contextOf(editHookOutput(editPayload(path.join(root, "docs/answers-guide.md")), { stateDir }));
    expect(again).not.toContain("First edit in");
    const other = contextOf(editHookOutput(editPayload(path.join(root, "data/records/sample.json")), { stateDir }));
    expect(other).toContain("First edit in Fixture records this session; it lists no key docs.");
  });

  it("names every area of a shared file, and none for an ignored or unplaced file", () => {
    const root = fixture();
    expect(areasFor(root, "src/shared.ts").map((area) => area.id)).toEqual(["answers", "records"]);
    expect(areasFor(root, "legacy/old.ts")).toEqual([]);
    expect(areasFor(root, "misc/unplaced.ts")).toEqual([]);
    expect(areasFor(root, "src/lib/rag/new-file.ts")).toEqual([
      { id: "answers", name: "Fixture answers", canonicalDocs: ["docs/answers-guide.md"] },
    ]);
  });

  it("forgets the session's notes after a compaction, so they are shown again", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const file = path.join(root, "data/records/sample.json");
    expect(contextOf(editHookOutput(editPayload(file), { stateDir }))).toContain("Clinical Governance Preflight");
    sessionHookOutput(JSON.stringify({ session_id: "session-one", source: "compact" }), { root, stateDir });
    expect(contextOf(editHookOutput(editPayload(file), { stateDir }))).toContain("Clinical Governance Preflight");
  });

  it("builds notes without side effects (pure)", () => {
    const memory = { clinical: false, areas: ["answers"] };
    const result = editNotes({
      rel: "src/lib/rag/x.ts",
      classes: ["ragRanking", "clinicalRisk"],
      areas: [
        { id: "answers", name: "A", canonicalDocs: [] },
        { id: "records", name: "R", canonicalDocs: ["docs/r.md"] },
      ],
      memory,
    });
    expect(result.lines).toHaveLength(3);
    expect(result.memory).toEqual({ clinical: true, areas: ["answers", "records"] });
    expect(memory).toEqual({ clinical: false, areas: ["answers"] });
  });

  it("keys memory by session, and by agent for a subagent", () => {
    expect(stateKey({ session_id: "abc-123" })).toBe("abc-123");
    expect(stateKey({ session_id: "abc-123", agent_id: "a1" })).toBe("abc-123--a1");
    expect(stateKey({ session_id: "../../etc/passwd" })).toBeNull();
    expect(stateKey({ session_id: "served:abc" })).toBeNull();
    expect(stateKey({})).toBeNull();
  });
});

describe("edit warning: paths", () => {
  it("judges a file against its own checkout, not the session's project folder", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const payload = editPayload(path.join(root, "src/lib/rag/sample.ts"), { cwd: repoRoot });
    const context = contextOf(editHookOutput(payload, { stateDir }));
    expect(context).toContain("[organisation] src/lib/rag/sample.ts is ranking-protected");
    expect(context).toContain("Fixture answers");
  });

  it("handles a git worktree nested inside the main checkout", () => {
    const root = fixture(fixtureFiles(), { commit: true });
    const worktree = path.join(root, ".claude/worktrees/one");
    git(root, "worktree", "add", "-q", "-b", "one", worktree);
    expect(repoRelativePath(path.join(worktree, "src/lib/rag/sample.ts"))).toEqual({
      top: fs.realpathSync.native(worktree),
      rel: "src/lib/rag/sample.ts",
    });
  });

  it("normalises Windows backslashes", () => {
    const root = fixture();
    const backslashed = `${root}/src/lib/rag/sample.ts`.replaceAll("/", "\\");
    expect(repoRelativePath(backslashed)?.rel).toBe("src/lib/rag/sample.ts");
  });

  it("resolves a relative path against the payload's cwd", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const payload = editPayload("src/lib/rag/sample.ts", { cwd: root });
    expect(contextOf(editHookOutput(payload, { stateDir }))).toContain("src/lib/rag/sample.ts is ranking-protected");
  });

  it("collapses `..` segments before judging the path", () => {
    const root = fixture();
    const sneaky = `${root}/src/lib/../../supabase/migrations/20990101000000_sample.sql`;
    expect(repoRelativePath(sneaky)?.rel).toBe("supabase/migrations/20990101000000_sample.sql");
  });

  it("handles a new file in folders that do not exist yet", () => {
    const root = fixture();
    expect(repoRelativePath(path.join(root, "src/lib/rag/new/deeper/file.ts"))?.rel).toBe(
      "src/lib/rag/new/deeper/file.ts",
    );
  });

  it("reads notebook_path for NotebookEdit", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const payload = JSON.stringify({
      session_id: "s",
      tool_name: "NotebookEdit",
      tool_input: { notebook_path: path.join(root, "src/lib/rag/notes.ipynb"), new_source: "" },
    });
    expect(contextOf(editHookOutput(payload, { stateDir }))).toContain("ranking-protected");
  });

  it("stays silent outside a git work tree and in another repository", () => {
    const stateDir = tempDir("organisation-hooks-state-");
    const plain = tempDir("organisation-hooks-plain-");
    const saved = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(plain);
    try {
      expect(repoRelativePath(path.join(plain, "src/lib/rag/x.ts"))).toBeNull();
      expect(editHookOutput(editPayload(path.join(plain, "src/lib/rag/x.ts")), { stateDir })).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = saved;
    }
    const other = tempDir("organisation-hooks-other-");
    git(other, "init", "-q");
    expect(editHookOutput(editPayload(path.join(other, "src/lib/rag/x.ts")), { stateDir })).toBeNull();
  });
});

const posixOnly = process.platform === "win32";

describe("edit warning: symlinked targets", () => {
  it.skipIf(posixOnly)("judges a link to a ranking file as the file it points to", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const link = path.join(root, "docs/innocent.ts");
    fs.symlinkSync(path.join(root, "src/lib/rag/sample.ts"), link);
    expect(repoRelativePath(link)?.rel).toBe("src/lib/rag/sample.ts");
    expect(contextOf(editHookOutput(editPayload(link), { stateDir }))).toContain(
      "src/lib/rag/sample.ts is ranking-protected",
    );
  });

  it.skipIf(posixOnly)("judges a link leading out of the checkout, or a broken one, by its own path", () => {
    const root = fixture();
    const outside = tempDir("organisation-hooks-outside-");
    fs.writeFileSync(path.join(outside, "x.ts"), "export {};\n");
    fs.symlinkSync(path.join(outside, "x.ts"), path.join(root, "docs/out.ts"));
    fs.symlinkSync(path.join(root, "gone.ts"), path.join(root, "docs/broken.ts"));
    expect(repoRelativePath(path.join(root, "docs/out.ts"))?.rel).toBe("docs/out.ts");
    expect(repoRelativePath(path.join(root, "docs/broken.ts"))?.rel).toBe("docs/broken.ts");
  });
});

describe("edit warning: memory folder", () => {
  it("uses a per-user folder, and none in a per-run `hook-` sandbox temp folder", () => {
    const user = process.getuid?.() ?? os.userInfo().username;
    expect(defaultStateDir(path.join("/tmp", "x"))).toBe(
      path.join("/tmp", "x", `psychsift-organisation-hooks-${String(user).replace(/[^A-Za-z0-9_.-]/g, "_")}`),
    );
    expect(defaultStateDir(path.join("/tmp", "hook-abc123"))).toBeNull();
  });

  it("gives only the every-edit notes when memory is unavailable in a sandbox", () => {
    const root = fixture();
    for (let i = 0; i < 2; i++) {
      const ranking = contextOf(
        editHookOutput(editPayload(path.join(root, "src/lib/rag/sample.ts")), { stateDir: null }),
      );
      expect(ranking).toContain("ranking-protected");
      expect(ranking).not.toContain("First edit in");
      expect(editHookOutput(editPayload(path.join(root, "data/records/sample.json")), { stateDir: null })).toBeNull();
    }
  });

  it.skipIf(posixOnly)("trusts only a private real directory owned by this user", () => {
    const base = tempDir("organisation-hooks-state-");
    expect(usableStateDir(path.join(base, "fresh"))).toBe(true);
    expect((fs.statSync(path.join(base, "fresh")).mode & 0o077) === 0).toBe(true);
    const open = path.join(base, "open");
    fs.mkdirSync(open);
    fs.chmodSync(open, 0o777);
    expect(usableStateDir(open)).toBe(false);
    fs.symlinkSync(path.join(base, "fresh"), path.join(base, "link"));
    expect(usableStateDir(path.join(base, "link"))).toBe(false);
    fs.writeFileSync(path.join(base, "file"), "");
    expect(usableStateDir(path.join(base, "file"))).toBe(false);
    expect(usableStateDir(null)).toBe(false);
  });

  it.skipIf(posixOnly)("repeats the notes and writes nothing in an untrusted folder", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    fs.chmodSync(stateDir, 0o777);
    const file = path.join(root, "data/records/sample.json");
    for (let i = 0; i < 2; i++) {
      expect(contextOf(editHookOutput(editPayload(file), { stateDir }))).toContain("Clinical Governance Preflight");
    }
    expect(fs.readdirSync(stateDir)).toEqual([]);
  });

  it.skipIf(posixOnly)("refuses a state file that is a link, and never writes through it", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    const elsewhere = path.join(tempDir("organisation-hooks-outside-"), "planted.json");
    const planted = `${JSON.stringify({ version: 1, clinical: true, areas: ["records"] })}\n`;
    fs.writeFileSync(elsewhere, planted);
    fs.symlinkSync(elsewhere, path.join(stateDir, "session-one.json"));
    const file = path.join(root, "data/records/sample.json");
    expect(contextOf(editHookOutput(editPayload(file), { stateDir }))).toContain("Clinical Governance Preflight");
    expect(fs.readFileSync(elsewhere, "utf8")).toBe(planted);
  });

  it.skipIf(posixOnly)("writes a private state file and leaves no temp file behind", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    editHookOutput(editPayload(path.join(root, "data/records/sample.json")), { stateDir });
    expect(fs.readdirSync(stateDir).sort()).toEqual([".last-prune", "session-one.json"]);
    expect(fs.statSync(path.join(stateDir, "session-one.json")).mode & 0o777).toBe(0o600);
  });

  it("prunes week-old memory at most once a day, by a marker file's mtime", () => {
    const stateDir = tempDir("organisation-hooks-state-");
    const now = Date.UTC(2030, 0, 10);
    const day = 24 * 60 * 60 * 1000;
    const age = (name: string, ms: number) => {
      fs.writeFileSync(path.join(stateDir, name), "{}\n");
      fs.utimesSync(path.join(stateDir, name), (now - ms) / 1000, (now - ms) / 1000);
    };
    age("old.json", 8 * day);
    age("recent.json", day);
    expect(pruneOldMemory(stateDir, now)).toBe(true);
    expect(fs.readdirSync(stateDir).sort()).toEqual([".last-prune", "recent.json"]);
    age("old2.json", 8 * day);
    expect(pruneOldMemory(stateDir, now + day / 2)).toBe(false);
    expect(fs.existsSync(path.join(stateDir, "old2.json"))).toBe(true);
    expect(pruneOldMemory(stateDir, now + day + 1)).toBe(true);
    expect(fs.existsSync(path.join(stateDir, "old2.json"))).toBe(false);
  });
});

const garbage = [
  "",
  "not json",
  "[]",
  "null",
  "42",
  "{}",
  '{"tool_input":null}',
  '{"tool_name":"Edit","tool_input":{"file_path":42}}',
  '{"tool_name":"Edit","tool_input":{"file_path":""}}',
  '{"tool_name":"Read","tool_input":{"file_path":"/etc/hosts"}}',
  "\u0000\u0001binary",
];

describe("edit warning: fails open", () => {
  it("returns nothing for malformed or irrelevant payloads", () => {
    const stateDir = tempDir("organisation-hooks-state-");
    for (const input of garbage) expect(editHookOutput(input, { stateDir }), JSON.stringify(input)).toBeNull();
    expect(fs.readdirSync(stateDir)).toEqual([]);
  });
});

// The wrappers are a Bash contract exercised on Linux CI. On Windows `bash.exe` can be the WSL
// launcher, which cannot run these native paths, so the wrapper tests skip there (the same
// convention as the push-format-guard and pr-handoff-stop tests); the functions above still run.
describe.skipIf(process.platform === "win32")("hook wrappers: exit 0 and never decide", () => {
  it.each(garbage.map((input) => [JSON.stringify(input), input]))("exits 0 with no output on %s", (_label, input) => {
    const result = runHook(EDIT_HOOK, input as string);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("never emits permissionDecision or any other decision field, through the real wrapper", () => {
    const samples = [
      "src/lib/rag/sample.ts",
      "supabase/migrations/20990101000000_sample.sql",
      "src/data/sample.json",
      "README.md",
      "docs/organisation/README.md",
    ];
    let spoke = 0;
    for (const [i, file] of samples.entries()) {
      for (const tool of ["Edit", "Write", "MultiEdit"]) {
        const result = runHook(
          EDIT_HOOK,
          editPayload(path.join(repoRoot, file), { session_id: `s${i}`, tool_name: tool }),
        );
        expect(result.status).toBe(0);
        if (result.stdout === "") continue;
        spoke += 1;
        const parsed = JSON.parse(result.stdout);
        const keys = allKeys(parsed);
        for (const forbidden of [
          "permissionDecision",
          "permissionDecisionReason",
          "decision",
          "continue",
          "updatedInput",
        ]) {
          expect(keys, `${file} via ${tool}`).not.toContain(forbidden);
        }
        expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      }
    }
    expect(spoke, "the ranking and migration samples must produce a warning").toBeGreaterThanOrEqual(6);
  });

  it("in a per-run `hook-` temp folder, keeps the ranking note, drops the area note and writes nothing", () => {
    const sandbox = tempDir("hook-");
    const result = runHook(EDIT_HOOK, editPayload(path.join(repoRoot, "src/lib/rag/sample.ts")), {
      TMPDIR: sandbox,
      TEMP: sandbox,
      TMP: sandbox,
    });
    expect(result.status).toBe(0);
    const context = contextOf(result.stdout);
    expect(context).toContain("ranking-protected");
    expect(context).not.toContain("First edit in");
    expect(fs.readdirSync(sandbox)).toEqual([]);
  });

  it("exits 0 with no output when node is missing", () => {
    const bash = spawnSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();
    const emptyPath = tempDir("organisation-hooks-nopath-");
    for (const hook of [EDIT_HOOK, SESSION_HOOK]) {
      const result = runHook(
        hook,
        editPayload(path.join(repoRoot, "src/lib/rag/sample.ts")),
        { PATH: emptyPath },
        bash,
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    }
  });

  it("runs the session line on this checkout: exit 0 and at most one line", { timeout: 60_000 }, () => {
    for (const input of ['{"session_id":"s","source":"startup"}', "garbage", ""]) {
      const result = runHook(SESSION_HOOK, input);
      expect(result.status).toBe(0);
      if (result.stdout !== "") {
        const parsed = JSON.parse(result.stdout);
        expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
        expect(parsed.hookSpecificOutput.additionalContext).toMatch(/^\[organisation\] Map health: [^\n]+$/);
        expect(allKeys(parsed)).not.toContain("permissionDecision");
      }
    }
  });
});

describe("session line", () => {
  it("is null when every count is zero, or when the checker could not run", () => {
    const clean = { exitCode: 0, totals: { unplaced: 0, notYetPlaced: 0 }, findings: [] };
    expect(sessionHealthLine(clean)).toBeNull();
    expect(sessionHealthLine({ ...clean, exitCode: 2, totals: { unplaced: 9 } })).toBeNull();
    expect(sessionHealthLine(null)).toBeNull();
    expect(sessionHealthLine("garbage")).toBeNull();
    expect(sessionHealthLine({ exitCode: 0, totals: "x", findings: "y" })).toBeNull();
  });

  it("names only the non-zero counts, on one line", () => {
    const line = sessionHealthLine({
      exitCode: 1,
      totals: { unplaced: 2, notYetPlaced: 1 },
      findings: [
        { level: "broken", key: "tie:src/a.ts" },
        { level: "warning", key: "dead-rule:answers:src/gone.ts" },
        { level: "warning", key: "nyp-superseded:src/b.ts" },
        { level: "warning", key: "empty-glob:answers:src/old/**" },
        { level: "warning", key: "unplaced:src/c.ts" },
      ],
    });
    expect(line).toBe(
      "[organisation] Map health: 1 map problem, 2 unplaced files, 2 stale entries, 1 rule matching nothing, 1 file not yet placed. `npm run check:organisation` lists them, and `npm run check:organisation -- --fix` tidies the stale entries.",
    );
    expect(line).not.toContain("\n");
    const noFix = sessionHealthLine({ exitCode: 0, totals: { unplaced: 1 }, findings: [] });
    expect(noFix).toBe("[organisation] Map health: 1 unplaced file. `npm run check:organisation` lists them.");
  });

  it("stays silent when the only count is files not yet placed (a normal, recorded state)", () => {
    expect(sessionHealthLine({ exitCode: 0, totals: { unplaced: 0, notYetPlaced: 40 }, findings: [] })).toBeNull();
    const root = fixture({
      ...fixtureFiles({ nyp: [{ path: "misc/pending.ts", reason: "waiting for a home" }] }),
      "misc/pending.ts": "export {};\n",
    });
    expect(sessionHookOutput("{}", { root, stateDir: tempDir("organisation-hooks-state-") })).toBeNull();
  });

  it("prints nothing for a clean map and writes no report or lock", () => {
    const root = fixture();
    const stateDir = tempDir("organisation-hooks-state-");
    expect(sessionHookOutput("{}", { root, stateDir })).toBeNull();
    expect(fs.existsSync(path.join(root, "output"))).toBe(false);
  });

  it("reports unplaced, stale and not-yet-placed files from a real checker run", () => {
    const files: Files = {
      ...fixtureFiles({
        nyp: [{ path: "misc/pending.ts", reason: "waiting for a home" }],
        extraAnswerPaths: ["src/lib/gone.ts"],
      }),
      "misc/loose.ts": "export {};\n",
      "misc/pending.ts": "export {};\n",
    };
    const root = fixture(files);
    const stateDir = tempDir("organisation-hooks-state-");
    const output = sessionHookOutput("{}", { root, stateDir });
    expect(output).not.toBeNull();
    const parsed = JSON.parse(output as string);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toBe(
      "[organisation] Map health: 1 unplaced file, 1 stale entry, 1 file not yet placed. `npm run check:organisation` lists them, and `npm run check:organisation -- --fix` tidies the stale entries.",
    );
    expect(allKeys(parsed)).not.toContain("permissionDecision");
    expect(fs.existsSync(path.join(root, "output"))).toBe(false);
  });

  it("prints nothing when the checker runs past its time limit", () => {
    const root = fixture({ ...fixtureFiles(), "misc/loose.ts": "export {};\n" });
    const stateDir = tempDir("organisation-hooks-state-");
    expect(sessionHookOutput("{}", { root, stateDir, timeoutMs: 1 })).toBeNull();
  });

  it("prints nothing when the checker cannot check the folder", () => {
    const plain = tempDir("organisation-hooks-plain-");
    const stateDir = tempDir("organisation-hooks-state-");
    expect(sessionHookOutput("{}", { root: plain, stateDir })).toBeNull();
  });
});

describe("registration", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude/settings.json"), "utf8"));
  type Entry = { matcher?: string; hooks: { command: string; timeout?: number }[] };

  it("registers the edit warning as PreToolUse on every file-editing tool", () => {
    const entry = (settings.hooks.PreToolUse as Entry[]).find((e) =>
      e.hooks.some((h) => h.command.includes("organisation-edit-warning.sh")),
    );
    expect(entry).toBeDefined();
    const matcher = new RegExp(`^(?:${entry?.matcher})$`);
    for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(matcher.test(tool), tool).toBe(true);
    for (const tool of ["Bash", "Read"]) expect(matcher.test(tool), tool).toBe(false);
    const hook = entry?.hooks.find((h) => h.command.includes("organisation-edit-warning.sh"));
    expect(hook?.command).toBe('bash "$CLAUDE_PROJECT_DIR/.claude/hooks/organisation-edit-warning.sh"');
    expect(hook?.timeout).toBeLessThanOrEqual(15);
  });

  it("registers the session line as SessionStart", () => {
    const hooks = (settings.hooks.SessionStart as Entry[]).flatMap((e) => e.hooks);
    const hook = hooks.find((h) => h.command.includes("scripts/claude-session-start.sh"));
    expect(hook?.command).toBe('bash "$CLAUDE_PROJECT_DIR/scripts/claude-session-start.sh"');
    expect(typeof hook?.timeout).toBe("number");
    expect(fs.readFileSync(path.join(repoRoot, "scripts", "claude-session-start.mjs"), "utf8")).toContain(
      ".claude/hooks/organisation-session-line.sh",
    );
  });
});
