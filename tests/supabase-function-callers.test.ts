import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every database function the live schema is expected to hold should have a caller: application or
// worker code, a script, an edge function, or another piece of SQL (a function body, trigger,
// policy, view or scheduled job). A function nothing calls is dead weight in the live database,
// which is how unused versions pile up. This check is offline: it reads the drift manifest and the
// repository, and never touches the database.

const root = path.resolve(import.meta.dirname, "..");

// Functions with no caller found today. Each is owned by another area and is listed here until its
// owner confirms it can be dropped (an approved database change) or names the caller this check
// cannot see. Remove an entry when that happens; never add one to silence a new function.
const KNOWN_UNCALLED = new Set([
  "activate_public_source_version",
  "on_call_shifts_replace",
  "record_public_source_activation",
  "roster_rotation_can_manage",
  "teaching_platform_command",
  "transition_public_source_version",
]);

const CODE_ROOTS = ["src", "worker", "scripts", "supabase/functions"];
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sql"]);
// Generated from the live schema, so it names every function whether or not anything calls it.
const GENERATED_FILES = new Set([path.join("src", "lib", "supabase", "database.types.ts")]);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir))) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const relative = path.join(dir, entry);
    if (statSync(path.join(root, relative)).isDirectory()) walk(relative, files);
    else if (CODE_EXTENSIONS.has(path.extname(entry)) && !GENERATED_FILES.has(relative)) files.push(relative);
  }
  return files;
}

function expectedFunctionNames(): string[] {
  const manifest = JSON.parse(readFileSync(path.join(root, "supabase/drift-manifest.json"), "utf8")) as {
    snapshot: { functions: { signature: string }[] };
  };
  const names = manifest.snapshot.functions.map((fn) => fn.signature.split("(")[0]!.replace(/^public\./, ""));
  return [...new Set(names)].sort();
}

function codeWords(): Set<string> {
  const words = new Set<string>();
  for (const file of CODE_ROOTS.flatMap((dir) => walk(dir))) {
    for (const word of readFileSync(path.join(root, file), "utf8").match(/[A-Za-z0-9_]+/g) ?? []) words.add(word);
  }
  return words;
}

function migrationSqlWithoutComments(): string {
  const dir = path.join(root, "supabase/migrations");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(path.join(dir, file), "utf8").replace(/--.*$/gm, ""))
    .join("\n");
}

// Statements that name a function without calling it: defining, dropping, altering, granting or commenting.
function withoutSelfReferences(sql: string, name: string): string {
  const declaring = new RegExp(
    String.raw`\b(?:create\s+or\s+replace\s+function|create\s+function|drop\s+function(?:\s+if\s+exists)?|alter\s+function|on\s+function)\s+(?:public\.)?"?${name}\b`,
    "gi",
  );
  return sql.replace(declaring, "");
}

describe("database function callers", () => {
  const names = expectedFunctionNames();
  const words = codeWords();
  const sql = migrationSqlWithoutComments();

  const uncalled = names.filter((name) => {
    if (words.has(name)) return false;
    return !new RegExp(String.raw`(?<![\w])${name}(?![\w])`).test(withoutSelfReferences(sql, name));
  });

  it("finds a caller for every database function the live schema holds", () => {
    expect(names.length).toBeGreaterThan(100);
    expect(uncalled.filter((name) => !KNOWN_UNCALLED.has(name))).toEqual([]);
  });

  it("keeps the known-uncalled list current", () => {
    const stale = [...KNOWN_UNCALLED].filter((name) => !uncalled.includes(name));
    expect(stale).toEqual([]);
  });
});
