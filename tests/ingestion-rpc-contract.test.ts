import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Postgres RPC the worker or the server library calls by name must exist in the schema
 * mirror. PR 3546 shipped worker and deep-memory code calling five fenced RPCs that no migration
 * defined, so every legacy ingest, image upload and fenced deep-memory build failed at runtime
 * while every offline gate passed. This scan closes that gap offline.
 *
 * Call shapes recognised (string-literal names only; a dynamic name cannot be checked here):
 *   - `.rpc("name"` / `rpc("name"`                       (supabase-js and injected rpc callbacks)
 *   - `mutation(<attempt>, "name"` / `mutate("name"`     (the fenced worker / deep-memory helpers)
 *   - `runIngestionMutation(<attempt>, <rpc>, "name"`    (the shared fenced mutation runner)
 */

const root = join(__dirname, "..");
const SCAN_ROOTS = ["worker", "src/lib"];

/**
 * Names that are called but intentionally not defined in supabase/schema.sql. Each entry needs a
 * reason. An entry whose function later appears in the schema fails the ratchet below, so the list
 * can only shrink.
 */
const KNOWN_UNDEFINED = new Map<string, string>([
  [
    "admit_backend_document",
    "KNOWN GAP, not external: trusted-backend admission (src/lib/trusted-document-admission.ts) calls it, " +
      "but no migration defines it, so backend-channel admission fails closed at runtime. It verifies backend " +
      "credentials, so it needs its own reviewed migration rather than an inferred one.",
  ],
]);

function listTypeScriptFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(directory, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...listTypeScriptFiles(full));
    else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.d\.ts$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const CALL_PATTERNS: RegExp[] = [
  /\brpc\(\s*["'`]([a-z0-9_]+)["'`]/g,
  /\bmutation\(\s*[A-Za-z_][\w.]*(?:\([^()]*\))?\s*,\s*["'`]([a-z0-9_]+)["'`]/g,
  /\bmutate\(\s*["'`]([a-z0-9_]+)["'`]/g,
  /\brunIngestionMutation\([^"'`;]*?["'`]([a-z0-9_]+)["'`]/g,
];

function extractRpcNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const pattern of CALL_PATTERNS) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

function definedPublicFunctions(schemaSql: string): Set<string> {
  const names = new Set<string>();
  const pattern = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.|"public"\.)?"?([a-z0-9_]+)"?\s*\(/gi;
  // A schema-qualified name in another schema (`other.name(`) cannot match: the `.` stops the
  // capture before the required `(`.
  for (const match of schemaSql.matchAll(pattern)) names.add(match[1].toLowerCase());
  return names;
}

const schemaSql = readFileSync(join(root, "supabase/schema.sql"), "utf8");
const defined = definedPublicFunctions(schemaSql);
const callers = new Map<string, Set<string>>();
for (const scanRoot of SCAN_ROOTS) {
  for (const file of listTypeScriptFiles(join(root, scanRoot))) {
    for (const name of extractRpcNames(readFileSync(file, "utf8"))) {
      if (!callers.has(name)) callers.set(name, new Set());
      callers.get(name)!.add(relative(root, file));
    }
  }
}

describe("ingestion RPC contract", () => {
  it("recognises every supported call shape", () => {
    const sample = [
      `await supabase.rpc("plain_rpc", {});`,
      `await mutation(attemptForDocument(documentId), "fenced_document_rpc", { p_generation: g });`,
      `await mutation(attempt, "fenced_attempt_rpc");`,
      `await mutate("deep_memory_rpc", { p_artifact_generation: id });`,
      `await runIngestionMutation(args.attempt, args.rpc, "runner_rpc", {});`,
      `const { data } = await rpc("callback_rpc", { ...payload, p_fence: attempt.fence });`,
    ].join("\n");
    expect([...extractRpcNames(sample)].sort()).toEqual(
      [
        "callback_rpc",
        "deep_memory_rpc",
        "fenced_attempt_rpc",
        "fenced_document_rpc",
        "plain_rpc",
        "runner_rpc",
      ].sort(),
    );
  });

  it("finds the fenced ingestion calls (guards against a scanner that silently matches nothing)", () => {
    for (const name of [
      "reset_ingestion_attempt_artifacts",
      "prepare_ingestion_image_upload",
      "stage_ingestion_deep_memory",
      "cleanup_ingestion_deep_memory_staging",
      "commit_document_deep_memory_generation",
      "write_ingestion_base_artifacts",
      "commit_document_index_generation",
    ]) {
      expect(callers.has(name), name).toBe(true);
    }
  });

  it("defines every called RPC as a public function in supabase/schema.sql", () => {
    const missing = [...callers.entries()]
      .filter(([name]) => !defined.has(name) && !KNOWN_UNDEFINED.has(name))
      .map(([name, files]) => `${name} (called from ${[...files].sort().join(", ")})`)
      .sort();
    expect(missing).toEqual([]);
  });

  it("keeps the known-undefined list honest: each entry is still called and still undefined", () => {
    for (const [name, reason] of KNOWN_UNDEFINED) {
      expect(reason.length, name).toBeGreaterThan(20);
      expect(callers.has(name), `${name} is no longer called; remove it from KNOWN_UNDEFINED`).toBe(true);
      expect(defined.has(name), `${name} is now defined; remove it from KNOWN_UNDEFINED`).toBe(false);
    }
  });
});

describe("fenced ingestion SQL follow-ups", () => {
  const schemaSql = readFileSync("supabase/schema.sql", "utf8");
  const followup = readFileSync("supabase/migrations/20261015200000_fenced_ingestion_followups.sql", "utf8");
  const helperBody = (sql: string) => {
    const starts = [
      ...sql.matchAll(
        /create (?:or replace )?function ingestion_generation_evidence\.assert_deep_memory_staging_owner\(/g,
      ),
    ];
    const start = starts.at(-1)?.index ?? -1;
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf("end $$;", start));
  };
  const patchAllowList = (sql: string) => {
    const start = sql.lastIndexOf("create or replace function public.patch_ingestion_document_state(p_fence jsonb");
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf("end $$;", start));
  };

  it("treats a staged row missing its lease or job id as not owned (null-safe ownership check)", () => {
    for (const sql of [schemaSql, followup]) {
      const body = helperBody(sql);
      expect(body).not.toMatch(/and not \(producer = 'local-worker'/);
      expect(body.match(/\) is not true\)/g)?.length).toBe(3);
    }
  });

  it("lets the worker record extraction_provenance through the fenced document patch", () => {
    expect(readFileSync("worker/main.ts", "utf8")).toContain("extraction_provenance:");
    for (const sql of [schemaSql, followup]) expect(patchAllowList(sql)).toContain("'extraction_provenance'");
  });
});
