import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every database function the live schema is expected to hold should have a caller: application or
// worker code, a script, an edge function, or SQL in the current schema (a function body, trigger,
// policy or view) or a scheduled job. A function nothing calls is dead weight in the live database,
// which is how unused versions pile up. This check is offline: it reads the drift manifest and the
// repository, and never touches the database.

const root = path.resolve(import.meta.dirname, "..");

// Functions with no caller found today. Each is owned by another area and is listed here until its
// owner confirms it can be dropped (an approved database change) or names the caller this check
// cannot see. Remove an entry when that happens; never add one to silence a new function.
const KNOWN_UNCALLED = new Set([
  "activate_public_source_version",
  "backfill_legacy_index_health_batch",
  "create_uploaded_document_with_ingestion_job",
  "document_label_metadata",
  "document_summary_text",
  "get_visual_evidence_cards",
  // PS-025: existing deployed RPC retired from application reads because it omits
  // summary generation stamps. Retain SQL until owner-approved database removal.
  "get_related_document_metadata_v2",
  "invoke_indexing_v3_agent",
  "match_document_embedding_fields_text",
  "on_call_shifts_replace",
  "prepare_completed_admin_text_reference",
  "read_completed_admin_text_source_layout",
  "record_public_source_activation",
  "repair_enrichment_quality_batch",
  "roster_rotation_can_manage",
  "run_all_visual_eval_cases",
  "set_document_corpus_access_mode",
  "stamp_document_deep_memory_version",
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

// A name that only appears in a comment is not a caller. Block comments, `//` comments that start a
// line or follow whitespace (so URLs inside strings survive), and `#` or `--` line comments in Python
// and SQL files are dropped before collecting words.
function withoutCodeComments(source: string, file: string): string {
  const extension = path.extname(file);
  if (extension === ".py") return source.replace(/(^|\s)#.*$/gm, "$1");
  if (extension === ".sql") return source.replace(/--.*$/gm, "");
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function codeWords(): Set<string> {
  const words = new Set<string>();
  for (const file of CODE_ROOTS.flatMap((dir) => walk(dir))) {
    const source = withoutCodeComments(readFileSync(path.join(root, file), "utf8"), file);
    for (const word of source.match(/[A-Za-z0-9_]+/g) ?? []) words.add(word);
  }
  return words;
}

// The current schema (`supabase/schema.sql`, which the drift manifest is built from) is the only SQL
// that can call anything: superseded bodies in older migrations no longer run. When schema.sql
// redefines a function, only its last definition counts.
function currentSchemaSql(): string {
  const sql = readFileSync(path.join(root, "supabase/schema.sql"), "utf8").replace(/--.*$/gm, "");
  const definition =
    /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([^)]*)\)[\s\S]*?\bas\s+(\$\w*\$)[\s\S]*?\3/gi;
  const definitions = [...sql.matchAll(definition)];
  const last = new Map<string, number>();
  for (const match of definitions)
    last.set(`${match[1]!.toLowerCase()}(${match[2]!.replace(/\s+/g, " ").trim()})`, match.index);
  let current = "";
  let cursor = 0;
  for (const match of definitions) {
    const key = `${match[1]!.toLowerCase()}(${match[2]!.replace(/\s+/g, " ").trim()})`;
    current += sql.slice(cursor, match.index);
    if (last.get(key) === match.index) current += match[0];
    cursor = match.index + match[0].length;
  }
  return current + sql.slice(cursor) + "\n" + scheduledJobCommands();
}

// Scheduled jobs live in pg_cron's own table, not in schema.sql, so the commands migrations scheduled
// are callers too.
function scheduledJobCommands(): string {
  const dir = path.join(root, "supabase/migrations");
  const schedule = /\bcron\.schedule\s*\(([\s\S]*?)\)\s*;/gi;
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .flatMap((file) => [...readFileSync(path.join(dir, file), "utf8").replace(/--.*$/gm, "").matchAll(schedule)])
    .map((match) => match[1])
    .join("\n");
}

// Text that names a function without calling it: its own definition and body, drop, alter, grant and
// comment statements, and catalog lookups by name (`to_regprocedure('public.x(uuid)')`,
// `proname = 'x'`, or a quoted `'public.x(...)'` identity string).
function withoutSelfReferences(sql: string, name: string): string {
  const ownDefinition = new RegExp(
    String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?${name}"?\s*\([\s\S]*?\bas\s+(\$\w*\$)[\s\S]*?\1`,
    "gi",
  );
  const naming = new RegExp(
    String.raw`\b(?:drop\s+function(?:\s+if\s+exists)?|alter\s+function|on\s+function)\s+(?:public\.)?"?${name}\b`,
    "gi",
  );
  const lookups = new RegExp(String.raw`proname\s*=\s*'${name}'|'(?:public\.)?${name}(?:\([^']*\))?'(?:::\w+)?`, "gi");
  return sql.replace(ownDefinition, "").replace(naming, "").replace(lookups, "");
}

describe("database function callers", () => {
  const names = expectedFunctionNames();
  const words = codeWords();
  const sql = currentSchemaSql();

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
