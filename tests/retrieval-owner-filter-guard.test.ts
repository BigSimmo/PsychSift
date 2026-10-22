import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

import {
  DERIVED_QUERY_INVENTORY,
  DYNAMIC_FROM_DECLARATIONS,
  DYNAMIC_TABLE,
  PROOF_KINDS,
  SCANNED_LIB_MODULES,
  SCOPE_EXEMPTIONS,
  UNTIERED_TABLE_DECLARATIONS,
  analyzeRpcDispatch,
  analyzeSource,
  emptyTierNames,
  evaluateSites,
  queriedTablesByTier,
  scanRpcDispatch,
  scanTenancy,
  tableTiersFromDatabaseTypes,
} from "../scripts/lib/tenancy-scan.mjs";

// Guard for the retrieval owner-scope boundary (48h-review finding #3).
//
// The SQL `retrieval_owner_matches(owner_filter, row_owner_id)` now fails CLOSED when
// `owner_filter IS NULL` (migration 20260708160001_retrieval_owner_matches_fail_closed), and
// src/lib/owner-scope.ts no longer emits null — so the database has a real tenant floor. This
// test remains as defense-in-depth on the app side: no `.rpc(...)` call in `src/` may pass a
// *literal* null/undefined `owner_filter`, and every owner_filter value must come from the
// sanctioned scope helpers (which fail closed in production) or the public sentinel — never a
// raw/unaudited value.

const SRC_DIR = join(process.cwd(), "src");
const API_DIR = join(SRC_DIR, "app", "api");

// Keep this deliberately explicit. These are the owner_id-bearing tables queried
// directly by API route modules today. Adding a new owner-scoped table to an API
// handler must also add it here so the tenancy boundary remains reviewable.
const OWNER_SCOPED_API_TABLES = new Set([
  "clinical_registry_record_sources",
  "clinical_registry_records",
  // The two CME tables the API routes query directly. `cme_allocations`,
  // `cme_requirements` and `cme_routines` are absent on purpose: nothing under
  // src/app/api reaches them yet (allocations live in lib/cme/repository), and
  // this list must match what the routes actually touch, not what the schema
  // contains — an aspirational entry here would make the guard pass over a
  // table no route has ever been checked against.
  "cme_entries",
  // Evidence attachments, queried directly by the evidence upload/download routes
  // (`src/app/api/cme/entries/[id]/evidence/**`). `cme_years` moved OFF this list: it is
  // reached only through `src/lib/cme/repository.ts` and `evidence-repository.ts` now, never
  // directly by an API route, so keeping it here would make the guard pass over a table no
  // route has been checked against.
  "cme_evidence",
  "document_index_quality",
  "document_labels",
  "document_summaries",
  "document_table_facts",
  "documents",
  // Roster's "stayed late" button writes the doctor's own extra-time row from
  // src/app/api/roster/extra-time/route.ts; Admin reads the same table later.
  "extra_time_records",
  "import_batches",
  "on_call_entries",
  "rag_answer_feedback",
  "rag_queries",
  "rag_query_misses",
  "rag_retrieval_logs",
  "storage_cleanup_jobs",
]);

const SANCTIONED_API_OWNER_SCOPE = [
  /\bwithOwnerReadScope\s*\(/,
  /\.eq\(\s*["']owner_id["']\s*,/,
  /\.eq\(\s*["']documents\.owner_id["']\s*,/,
  /\brequireOwnedDocument\s*\(/,
  /\bloadOwnedDocument\s*\(/,
  /\brequireOwnerScope\s*\(/,
  /\bretrievalOwnerFilter\s*\(/,
  /\b(?:p_)?owner_id\s*:/,
];

// setup-status performs bounded schema/existence probes and never returns table
// rows. It is intentionally owner-agnostic so a fresh deployment can diagnose
// missing setup before any user corpus exists.
const OWNER_SCOPE_EXEMPTIONS = new Set([
  "setup-status/route.ts:documents",
  "setup-status/route.ts:import_batches",
  "setup-status/route.ts:storage_cleanup_jobs",
  // The clinical-quality route is an administrator-gated, cross-tenant governance
  // dashboard. Its helpers run only after authorizeAndLimit and return aggregate
  // quality metadata, so owner filtering would invalidate the oversight use case.
  "clinical-quality/route.ts:rag_answer_feedback",
  "clinical-quality/route.ts:clinical_registry_record_sources",
  "clinical-quality/route.ts:clinical_registry_records",
  "clinical-quality/route.ts:rag_retrieval_logs",
]);

// These internal helpers consume owner-authorized capability IDs created by the
// surrounding route; they are not request-entry reads. Keep the names explicit so
// moving either query to a new helper or route forces a tenancy review.
const OWNER_SCOPED_HELPER_EXEMPTIONS = new Set([
  "documents/[id]/labels/route.ts:document_labels:selectLabels",
  "documents/[id]/route.ts:storage_cleanup_jobs:updateStorageCleanupJob",
]);

// Sanctioned right-hand sides for an `owner_filter` / `p_owner_filter` RPC argument.
const SANCTIONED_SOURCES = [
  /^retrievalOwnerFilter\(/,
  /^requireOwnerScope\(/,
  /^ownerScopeForDocumentFilteredRetrieval\(/,
  /^PUBLIC_OWNER_FILTER_SENTINEL\b/,
  // corpus-grounding threads through the exact scope it was handed; documented safe because rag.ts
  // derives `args.ownerFilter` from ownerScopeForDocumentFilteredRetrieval (never a raw null in prod).
  /^args\.ownerFilter\b/,
  // Versioned-RPC rollout adapters derive these locals from RetrievalAccessScope before
  // issuing exact-owner and public-sentinel legacy calls.
  /^ownerFilter\b/,
  /^scope\.ownerId\b/,
  /^accessScope\.ownerId\b/,
];

const OWNER_FILTER_ARG = /\b(?:p_)?owner_filter\s*:\s*(.+?)\s*,?\s*$/;

function sourceFiles(dir: string): string[] {
  // `recursive: true` without `withFileTypes` returns relative paths as strings — avoids the
  // Dirent.parentPath/path typing churn across @types/node versions.
  return readdirSync(dir, { recursive: true })
    .map((entry) => String(entry))
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".d.ts") && !name.includes("database.types"))
    .map((name) => join(dir, name));
}

function apiRouteFiles(): string[] {
  return sourceFiles(API_DIR).filter((file) => file.replace(/\\/g, "/").endsWith("/route.ts"));
}

function nearestFunctionOrSource(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return current ?? node;
}

function functionName(node: ts.Node) {
  const scope = nearestFunctionOrSource(node);
  return ts.isFunctionDeclaration(scope) && scope.name ? scope.name.text : null;
}

function directTableNames(file: string, source: string) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tables = new Set<string>();

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "from" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      tables.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return tables;
}

function ownerIdTablesFromDatabaseTypes() {
  const lines = readFileSync(join(SRC_DIR, "lib", "supabase", "database.types.ts"), "utf8").split(/\r?\n/);
  const tables = new Set<string>();
  let table: string | null = null;
  let inRow = false;

  for (const line of lines) {
    const tableMatch = line.match(/^      ([a-z0-9_]+): \{$/);
    if (tableMatch) {
      table = tableMatch[1];
      inRow = false;
    } else if (table && /^        Row: \{$/.test(line)) {
      inRow = true;
    } else if (/^        Insert: \{$/.test(line)) {
      inRow = false;
    } else if (table && inRow && /^          owner_id:/.test(line)) {
      tables.add(table);
    }
  }

  return tables;
}

function ownerScopedApiAccesses(file: string, source: string): { checked: number; offenders: string[] } {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const relativeFile = file.slice(API_DIR.length + 1).replace(/\\/g, "/");
  const offenders: string[] = [];
  let checked = 0;

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "from" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const table = node.arguments[0].text;
      if (OWNER_SCOPED_API_TABLES.has(table)) {
        checked += 1;
        const exemptionKey = `${relativeFile}:${table}`;
        const helperExemptionKey = `${exemptionKey}:${functionName(node) ?? ""}`;
        if (!OWNER_SCOPE_EXEMPTIONS.has(exemptionKey) && !OWNER_SCOPED_HELPER_EXEMPTIONS.has(helperExemptionKey)) {
          const scope = nearestFunctionOrSource(node).getText(parsed);
          if (!SANCTIONED_API_OWNER_SCOPE.some((pattern) => pattern.test(scope))) {
            const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
            offenders.push(`${relativeFile}:${line} — ${table} access has no sanctioned owner-scope helper/filter`);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return { checked, offenders };
}

describe("retrieval owner_filter callsite guard (finding #3)", () => {
  it("pins governed v3 candidate calls to the public sentinel", () => {
    const source = readFileSync(join(SRC_DIR, "lib", "rag", "rag-candidate-sources.ts"), "utf8");
    expect(source).toContain("owner_filter: PUBLIC_OWNER_FILTER_SENTINEL");
    expect(source).toContain("include_public: true");
    expect(source).not.toMatch(/owner_filter:\s*args\.ownerId/);
  });

  it("routes every owner_filter RPC argument through a sanctioned scope source (never literal null)", () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const file of sourceFiles(SRC_DIR)) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        const match = trimmed.match(OWNER_FILTER_ARG);
        if (!match) return;

        checked += 1;
        const rhs = match[1].trim();
        const location = `${file.replace(process.cwd(), "").replace(/\\/g, "/")}:${index + 1}`;
        if (/^(null|undefined)\b/.test(rhs)) {
          offenders.push(`${location} — literal ${rhs}`);
        } else if (!SANCTIONED_SOURCES.some((pattern) => pattern.test(rhs))) {
          offenders.push(`${location} — unsanctioned owner_filter source: ${rhs}`);
        }
      });
    }

    // Fail loudly if the scan matched nothing (e.g. the RPC param was renamed) rather than passing vacuously.
    expect(
      checked,
      "found no owner_filter RPC callsites to guard — has the param name changed?",
    ).toBeGreaterThanOrEqual(5);
    expect(
      offenders,
      `owner_filter must come from retrievalOwnerFilter / requireOwnerScope / ` +
        `ownerScopeForDocumentFilteredRetrieval / PUBLIC_OWNER_FILTER_SENTINEL — never a raw or null value:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("owner-scoped API table guard", () => {
  it("recognizes sanctioned helpers and rejects an unscoped handler", () => {
    const safe = ownerScopedApiAccesses(
      join(API_DIR, "synthetic-safe", "route.ts"),
      `export async function GET() {
        return withOwnerReadScope(supabase.from("documents").select("id"), access.ownerId);
      }`,
    );
    const unsafe = ownerScopedApiAccesses(
      join(API_DIR, "synthetic-unsafe", "route.ts"),
      `export async function GET() {
        return supabase.from("documents").select("id");
      }`,
    );

    expect(safe).toEqual({ checked: 1, offenders: [] });
    expect(unsafe.checked).toBe(1);
    expect(unsafe.offenders).toHaveLength(1);
  });

  it("keeps the explicit table list aligned with generated owner_id table types", () => {
    const directApiTables = new Set<string>();
    for (const file of apiRouteFiles()) {
      for (const table of directTableNames(file, readFileSync(file, "utf8"))) directApiTables.add(table);
    }
    const typedOwnerTables = ownerIdTablesFromDatabaseTypes();
    const expected = [...directApiTables].filter((table) => typedOwnerTables.has(table)).sort();
    const configured = [...OWNER_SCOPED_API_TABLES].sort();

    expect(
      configured,
      "OWNER_SCOPED_API_TABLES must exactly match owner_id tables directly queried by API routes.",
    ).toEqual(expected);
  });

  it("keeps every direct owner-scoped API table access behind a sanctioned scope", () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const file of apiRouteFiles()) {
      const result = ownerScopedApiAccesses(file, readFileSync(file, "utf8"));
      checked += result.checked;
      offenders.push(...result.offenders);
    }

    expect(checked, "found no owner-scoped API table accesses — is the explicit table list stale?").toBeGreaterThan(0);
    expect(
      offenders,
      `Owner-scoped API table access must use withOwnerReadScope, an explicit owner_id filter/stamp, ` +
        `an owned-document helper, or a documented narrow exemption:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------------------
 * Mechanical tenancy scan (the five blind spots closed 2026-09-02).
 *
 * The suites above check the OLD contract: owner_filter RPC sources, and owner_id-bearing
 * tables in `route.ts` files scoped somewhere in the enclosing function. Those assertions
 * stay exactly as they were. The suites below add the stricter contract that
 * scripts/lib/tenancy-scan.mjs implements — three table tiers, scope attributed per query
 * CHAIN rather than per function, a declared inventory for join-through tables, a wider
 * file set, and a pin on the one dynamic RPC dispatcher — and every rule here ships with a
 * synthetic fixture proving it FAILS on the thing it claims to catch.
 * ---------------------------------------------------------------------------------------
 */

type ScanTiers = ReturnType<typeof tableTiersFromDatabaseTypes>;

/** Scan a synthetic module as if it lived at `relativePath`, using the given tier sets. */
function scanFixture(relativePath: string, source: string, tiers: Partial<ScanTiers> = {}) {
  const direct = tiers.direct ?? new Set(["documents"]);
  const userKeyed = tiers.userKeyed ?? new Set(["user_favourites"]);
  const derived = tiers.derived ?? new Set(["document_chunks"]);
  return analyzeSource({
    relativePath,
    source,
    // `all` is every table the generated types declare, tiered or not; a table in `all` and
    // in no tier is the untiered case the fourth signal exists for.
    tiers: { direct, userKeyed, derived, all: tiers.all ?? new Set([...direct, ...userKeyed, ...derived]) },
  });
}

const FIXTURE_FILE = "src/app/api/synthetic/route.ts";

// Sanctioned names are resolved to an import or to a file-local definition that itself
// carries an owner predicate — never matched on identifier text — so a fixture that means
// to USE one has to actually bring it into scope (security review P2-4).
const IMPORT_WRAPPER = 'import { withOwnerReadScope } from "@/lib/public-api-access";\n';
const LOCAL_OWNED_DOCUMENT_HELPER = `async function loadOwnedDocument(args) {
        return args.supabase
          .from("documents")
          .select("id")
          .eq("id", args.documentId)
          .eq("owner_id", args.ownerId)
          .maybeSingle();
      }
      `;

describe("tenancy table tiers", () => {
  it("splits generated table types into direct, user-keyed and derived tiers", () => {
    const generated = [
      "export type Database = {",
      "  public: {",
      "    Tables: {",
      "      documents: {",
      "        Row: {",
      "          id: string;",
      "          owner_id: string;",
      "        };",
      "        Insert: {",
      "          id?: string;",
      "        };",
      "      };",
      "      user_favourites: {",
      "        Row: {",
      "          content_key: string;",
      "          user_id: string;",
      "        };",
      "        Insert: {",
      "          content_key: string;",
      "        };",
      "      };",
      "      document_chunks: {",
      "        Row: {",
      "          id: string;",
      "          document_id: string;",
      "        };",
      "        Insert: {",
      "          id?: string;",
      "        };",
      "      };",
      "      api_versions: {",
      "        Row: {",
      "          id: string;",
      "        };",
      "        Insert: {",
      "          id?: string;",
      "        };",
      "      };",
      "    };",
      "    Functions: {",
      "      match_document_chunks: {",
      "        Row: {",
      "          owner_id: string;",
      "        };",
      "      };",
      "    };",
      "  };",
      "};",
    ].join("\n");

    const tiers = tableTiersFromDatabaseTypes(generated);
    expect([...tiers.direct]).toEqual(["documents"]);
    expect([...tiers.userKeyed]).toEqual(["user_favourites"]);
    expect([...tiers.derived]).toEqual(["document_chunks"]);
    // A Functions entry that happens to name owner_id must not be mistaken for a table.
    expect(tiers.direct.has("match_document_chunks")).toBe(false);
    // A table with none of the three columns belongs to no tenancy tier.
    expect(
      tiers.direct.has("api_versions") || tiers.userKeyed.has("api_versions") || tiers.derived.has("api_versions"),
    ).toBe(false);
  });

  it("keeps each configured tier exactly equal to the tables the scanned files query", () => {
    const { tiers, direct, userKeyed, derived } = queriedTablesByTier(process.cwd());
    // The tier sets are DERIVED from database.types.ts, so the assertion that matters is the
    // other direction: every table the scanned files actually query must land in a tier, and
    // the tier it lands in must match the generated column shape. An unclassified table
    // queried by a scanned file would be absent from all three buckets below.
    for (const table of direct) expect(tiers.direct.has(table), `${table} is not a direct-tier table`).toBe(true);
    for (const table of userKeyed) expect(tiers.userKeyed.has(table), `${table} is not a user-keyed table`).toBe(true);
    for (const table of derived) expect(tiers.derived.has(table), `${table} is not a derived-tier table`).toBe(true);
    expect(direct.length + userKeyed.length + derived.length).toBeGreaterThan(0);

    // The full column-derived user-keyed tier, independent of whether anything under
    // src/app/api or SCANNED_LIB_MODULES queries a table directly. `on_call_service_members`
    // and `on_call_service_orientation` carry a `user_id` column (supabase/migrations/
    // 20260922174716_on_call_service_handbooks.sql) and so classify into this tier by shape —
    // but every read/write against them goes through `on_call_service_command`, the single
    // security-invoker RPC, never a direct `.from()` in a scanned file. That is why they
    // appear here and NOT in the queried-tables assertion below. The Roster tables and the
    // membership audit table (the combined Roster database change) are the same shape: a
    // `user_id` column, reached only through `roster_read` / `roster_command` or
    // `on_call_service_command`.
    expect([...tiers.userKeyed].sort()).toEqual([
      "on_call_service_member_events",
      "on_call_service_members",
      "on_call_service_orientation",
      "roster_assignments",
      "roster_change_agreements",
      "roster_draft_assignments",
      "roster_member_roles",
      "roster_publication_seen",
      "roster_unavailability",
      "user_favourite_sets",
      "user_favourites",
      "user_preferences",
    ]);
    // The user-keyed tier ACTUALLY QUERIED by scanned files is small and fully enumerated:
    // withOwnerReadScope cannot be used on it (it filters owner_id), so every call site
    // hand-rolls .eq("user_id", …).
    // `roster_unavailability` is read only by Delete-my-data cleanup, with `.eq("user_id", …)` on the chain.
    // `on_call_service_members` and `roster_member_roles` are read team-wide by the site-administrator
    // Roster view and the rotation team list, each a declared scope exemption (added 2026-10-21).
    expect(userKeyed).toEqual([
      "on_call_service_members",
      "roster_member_roles",
      "roster_unavailability",
      "user_favourite_sets",
      "user_favourites",
      "user_preferences",
    ]);
  });
});

describe("per-chain owner scope (direct and user-keyed tiers)", () => {
  it("accepts an owner predicate on the query's own chain and a sanctioned wrapper", () => {
    const onChain = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("documents").select("id").eq("owner_id", user.id);
      }`,
    );
    const wrapped = scanFixture(
      FIXTURE_FILE,
      IMPORT_WRAPPER +
        `export async function GET() {
        return withOwnerReadScope(supabase.from("documents").select("id"), access.ownerId);
      }`,
    );
    const stamped = scanFixture(
      FIXTURE_FILE,
      `export async function POST() {
        return supabase.from("documents").insert({ owner_id: user.id, title });
      }`,
    );
    const publicOverlay = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("documents").select("id").or("owner_id.eq." + id + ",owner_id.is.null");
      }`,
    );

    for (const sites of [onChain, wrapped, stamped]) {
      expect(sites).toHaveLength(1);
      expect(sites[0].ownerScopedChain, JSON.stringify(sites[0].proofs)).toBe(true);
    }
    // `.or("owner_id.eq…")` is only recognised from a string literal; a concatenation is not.
    expect(publicOverlay[0].ownerScopedChain).toBe(false);
    expect(
      scanFixture(
        FIXTURE_FILE,
        `export async function GET() {
          return supabase.from("documents").select("id").or("owner_id.eq.abc,owner_id.is.null");
        }`,
      )[0].ownerScopedChain,
    ).toBe(true);
  });

  it("attributes scope per QUERY, not per function — a scoped sibling query no longer covers an unscoped one", () => {
    // This is blind spot C. Both guards that existed before asked whether a sanctioned token
    // appeared anywhere in the enclosing function, so this handler passed.
    const sites = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        const owned = await supabase.from("documents").select("id").eq("owner_id", user.id);
        const everything = await supabase.from("documents").select("*");
        return { owned, everything };
      }`,
    );
    expect(sites).toHaveLength(2);
    expect(sites.filter((site) => site.ownerScopedChain)).toHaveLength(1);

    const { violations } = evaluateSites({ dynamicFrom: [], sites, exemptions: [], inventory: [], untiered: [] });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("undeclared scope-exemption query");
  });

  it("requires a user_id predicate on the chain for user-keyed tables (blind spot B)", () => {
    const scoped = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("user_favourites").select("content_key").eq("user_id", user.id);
      }`,
    );
    const unscoped = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("user_favourites").select("content_key").eq("content_type", type);
      }`,
    );
    expect(scoped[0].userScopedChain).toBe(true);
    expect(unscoped[0].userScopedChain).toBe(false);
    expect(
      evaluateSites({ dynamicFrom: [], sites: unscoped, exemptions: [], inventory: [], untiered: [] }).violations,
    ).toHaveLength(1);
    // owner_id is NOT a substitute: these tables have no owner_id column at all.
    const wrongColumn = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("user_favourites").select("content_key").eq("owner_id", user.id);
      }`,
    );
    expect(wrongColumn[0].userScopedChain).toBe(false);
  });

  it("resolves an owner_id stamp through a locally built write payload", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `export async function POST() {
        const labelRows = documents.map((document) => ({ owner_id: user.id, document_id: document.id }));
        return supabase.from("documents").upsert(labelRows, { onConflict: "id" });
      }`,
    );
    expect(sites[0].ownerScopedChain).toBe(true);

    const unstamped = scanFixture(
      FIXTURE_FILE,
      `export async function POST() {
        const labelRows = documents.map((document) => ({ document_id: document.id }));
        return supabase.from("documents").upsert(labelRows, { onConflict: "id" });
      }`,
    );
    expect(unstamped[0].ownerScopedChain).toBe(false);
  });
});

describe("derived-tier inventory (blind spot A)", () => {
  const derivedSource =
    IMPORT_WRAPPER +
    `export async function GET() {
        const { data: document } = await withOwnerReadScope(
          supabase.from("documents").select("id").eq("id", id),
          access.ownerId,
        ).maybeSingle();
        if (!document) return notFound();
        return supabase.from("document_chunks").select("content").eq("document_id", id);
      }`;

  it("fails a join-through query that is not declared, even when the handler is owner-scoped", () => {
    // Both older guards ignored document_chunks entirely: it has no owner_id column.
    // check-owner-scope-api.mjs's own self-test still asserts the regex tier does not flag it.
    const sites = scanFixture(FIXTURE_FILE, derivedSource);
    const derived = sites.filter((site) => site.tier === "derived");
    expect(derived).toHaveLength(1);

    const { violations } = evaluateSites({ dynamicFrom: [], sites, exemptions: [], inventory: [], untiered: [] });
    expect(violations.filter((violation) => violation.includes("undeclared derived-inventory query"))).toHaveLength(1);
  });

  it("accepts the same query once it is declared with a verifiable owner-pinned document id", () => {
    const sites = scanFixture(FIXTURE_FILE, derivedSource);
    const inventory = [
      {
        file: FIXTURE_FILE,
        table: "document_chunks",
        fn: "GET",
        queries: 1,
        proof: PROOF_KINDS.OWNER_PINNED_DOCUMENT_ID,
        identifier: "id",
        reason: "fixture",
      },
    ];
    expect(evaluateSites({ dynamicFrom: [], sites, exemptions: [], inventory, untiered: [] }).violations).toEqual([]);

    // The identity is checked in the AST, not trusted from the reason string: declaring a
    // different identifier than the one the owner-scoped query pinned must fail.
    const wrongIdentifier = evaluateSites({
      dynamicFrom: [],
      sites,
      exemptions: [],
      inventory: [{ ...inventory[0], identifier: "otherId" }],
      untiered: [],
    }).violations;
    // Two violations: the entry matches nothing, and the query is therefore undeclared.
    expect(wrongIdentifier).toHaveLength(2);
    expect(wrongIdentifier.join("\n")).toContain("not the declared otherId");
    expect(wrongIdentifier.join("\n")).toContain("undeclared derived-inventory query");
  });

  it("fails owner-pinned-document-id when the ownership proof is dropped from the scope", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        const { data: document } = await supabase.from("documents").select("id").eq("id", id).maybeSingle();
        if (!document) return notFound();
        return supabase.from("document_chunks").select("content").eq("document_id", id);
      }`,
    );
    const violations = evaluateSites({
      dynamicFrom: [],
      sites,
      exemptions: [],
      inventory: [
        {
          file: FIXTURE_FILE,
          table: "document_chunks",
          fn: "GET",
          queries: 1,
          proof: PROOF_KINDS.OWNER_PINNED_DOCUMENT_ID,
          identifier: "id",
          reason: "fixture",
        },
      ],
    }).violations;
    // The documents query lost its owner filter, so nothing pins `id` any more.
    expect(violations.join("\n")).toContain("no owner-scoped documents query in this scope pins `id`");
  });

  it("verifies the documents!inner proof and fails when the owner filter is dropped", () => {
    const joined = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase
          .from("document_chunks")
          .select("*, documents!inner(owner_id)")
          .eq("documents.owner_id", user.id);
      }`,
    );
    const entry = {
      file: FIXTURE_FILE,
      table: "document_chunks",
      fn: "GET",
      queries: 1,
      proof: PROOF_KINDS.DOCUMENTS_INNER_JOIN,
      reason: "fixture",
    };
    expect(
      evaluateSites({ dynamicFrom: [], sites: joined, exemptions: [], inventory: [entry], untiered: [] }).violations,
    ).toEqual([]);

    const unfiltered = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("document_chunks").select("*, documents!inner(owner_id)").eq("status", "indexed");
      }`,
    );
    const violations = evaluateSites({
      dynamicFrom: [],
      sites: unfiltered,
      exemptions: [],
      inventory: [entry],
      untiered: [],
    }).violations;
    expect(violations.join("\n")).toContain("does not filter `documents.owner_id`");
  });

  it("verifies the owned-document-helper proof and fails when the helper call is removed", () => {
    const entry = {
      file: FIXTURE_FILE,
      table: "document_chunks",
      fn: "PATCH",
      queries: 1,
      proof: PROOF_KINDS.OWNED_DOCUMENT_HELPER,
      identifier: "id",
      reason: "fixture",
    };
    const withHelper = scanFixture(
      FIXTURE_FILE,
      LOCAL_OWNED_DOCUMENT_HELPER +
        `export async function PATCH() {
        const document = await loadOwnedDocument({ supabase, documentId: id, ownerId: user.id });
        if (!document) return notFound();
        return supabase.from("document_chunks").select("id").eq("document_id", id);
      }`,
    );
    expect(
      evaluateSites({ dynamicFrom: [], sites: withHelper, exemptions: [], inventory: [entry], untiered: [] })
        .violations,
    ).toEqual([]);

    const withoutHelper = scanFixture(
      FIXTURE_FILE,
      `export async function PATCH() {
        return supabase.from("document_chunks").select("id").eq("document_id", id);
      }`,
    );
    expect(
      evaluateSites({
        dynamicFrom: [],
        sites: withoutHelper,
        exemptions: [],
        inventory: [entry],
        untiered: [],
      }).violations.join("\n"),
    ).toContain("no owning-document helper in this scope was handed `id`");
  });

  it("verifies the owner-scoped-id-list proof and fails when the list is not locally derived", () => {
    const entry = {
      file: FIXTURE_FILE,
      table: "document_chunks",
      fn: "GET",
      queries: 1,
      proof: PROOF_KINDS.OWNER_SCOPED_ID_LIST,
      identifier: "documentIds",
      reason: "fixture",
    };
    const derivedList = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        const { data } = await supabase.from("documents").select("id").eq("owner_id", user.id);
        const documentIds = data.map((row) => row.id);
        return supabase.from("document_chunks").select("content").in("document_id", documentIds);
      }`,
    );
    expect(
      evaluateSites({ dynamicFrom: [], sites: derivedList, exemptions: [], inventory: [entry], untiered: [] })
        .violations,
    ).toEqual([]);

    const requestSuppliedList = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        const { data } = await supabase.from("documents").select("id").eq("owner_id", user.id);
        return supabase.from("document_chunks").select("content").in("document_id", body.documentIds);
      }`,
    );
    expect(
      evaluateSites({
        dynamicFrom: [],
        sites: requestSuppliedList,
        exemptions: [],
        inventory: [entry],
        untiered: [],
      }).violations.join("\n"),
    ).toContain("not the declared documentIds");
  });

  it("verifies the parent-document-verified proof and fails when no owner-scoped parent read remains", () => {
    const entry = {
      file: FIXTURE_FILE,
      table: "document_chunks",
      fn: "GET",
      queries: 1,
      proof: PROOF_KINDS.PARENT_DOCUMENT_VERIFIED,
      reason: "fixture",
    };
    const verified = scanFixture(
      FIXTURE_FILE,
      IMPORT_WRAPPER +
        `export async function GET() {
        const { data: chunk } = await supabase.from("document_chunks").select("document_id").eq("id", id).maybeSingle();
        const { data: document } = await withOwnerReadScope(
          supabase.from("documents").select("id").eq("id", chunk.document_id),
          access.ownerId,
        ).maybeSingle();
        return document ? chunk : notFound();
      }`,
    );
    expect(
      evaluateSites({ dynamicFrom: [], sites: verified, exemptions: [], inventory: [entry], untiered: [] }).violations,
    ).toEqual([]);

    const unverified = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        const { data: chunk } = await supabase.from("document_chunks").select("document_id").eq("id", id).maybeSingle();
        return chunk;
      }`,
    );
    expect(
      evaluateSites({
        dynamicFrom: [],
        sites: unverified,
        exemptions: [],
        inventory: [entry],
        untiered: [],
      }).violations.join("\n"),
    ).toContain("the parent document is never verified");
  });

  it("fails a stale entry that no longer matches any query site", () => {
    const violations = evaluateSites({
      dynamicFrom: [],
      sites: [],
      exemptions: [],
      inventory: [
        {
          file: FIXTURE_FILE,
          table: "document_chunks",
          fn: "GET",
          queries: 1,
          proof: PROOF_KINDS.REVIEWED_INDIRECT,
          reason: "fixture",
        },
      ],
    }).violations;
    expect(violations.join("\n")).toContain("No query site matched it at all");
  });

  it("fails when a scope grows an extra derived query beyond its declared count", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        const a = supabase.from("document_chunks").select("content").eq("document_id", id);
        const b = supabase.from("document_chunks").select("metadata").eq("document_id", id);
        return [a, b];
      }`,
    );
    const violations = evaluateSites({
      dynamicFrom: [],
      sites,
      exemptions: [],
      inventory: [
        {
          file: FIXTURE_FILE,
          table: "document_chunks",
          fn: "GET",
          queries: 1,
          proof: PROOF_KINDS.REVIEWED_INDIRECT,
          reason: "fixture",
        },
      ],
    }).violations;
    expect(violations.join("\n")).toContain("undeclared derived-inventory query");
  });
});

/*
 * ---------------------------------------------------------------------------------------
 * Security review of the scanner (2026-09-02). Every fixture below is a query the reviewer
 * constructed that is GENUINELY CROSS-TENANT and that the scanner REPORTED AS SCOPED. None
 * is load-bearing in the repo today, so these were latent guard defects — but a guard that
 * passes when it should fail is precisely the failure this work exists to prevent. Each
 * `it` asserts the scanner now rejects the shape it used to accept.
 * ---------------------------------------------------------------------------------------
 */

describe("P1-1 — an update payload is a written VALUE, not a filter", () => {
  it("rejects an unfiltered mass reassignment of every tenant's rows to the caller", () => {
    const massReassign = scanFixture(
      FIXTURE_FILE,
      `export async function PATCH() {
        return supabase.from("documents").update({ owner_id: user.id, title });
      }`,
    );
    expect(massReassign).toHaveLength(1);
    // Previously `update:owner_id` was an OWNER_PROOF, so this reported ownerScoped with
    // zero violations while rewriting every other tenant's documents to the caller.
    expect(massReassign[0].ownerScopedChain, JSON.stringify(massReassign[0].proofs)).toBe(false);
    expect(
      evaluateSites({ dynamicFrom: [], sites: massReassign, exemptions: [], inventory: [], untiered: [] }).violations,
    ).toHaveLength(1);
  });

  it("rejects an owner_id write filtered only by a request-supplied id", () => {
    const byRequestId = scanFixture(
      FIXTURE_FILE,
      `export async function PATCH() {
        return supabase.from("documents").update({ owner_id: user.id }).eq("id", body.id);
      }`,
    );
    expect(byRequestId[0].ownerScopedChain).toBe(false);
  });

  it("rejects the same shape on a user-keyed table", () => {
    const userKeyed = scanFixture(
      FIXTURE_FILE,
      `export async function PATCH() {
        return supabase.from("user_favourites").update({ user_id: user.id, content_key: key });
      }`,
    );
    expect(userKeyed[0].userScopedChain).toBe(false);
  });

  it("still accepts an update whose OWN CHAIN carries the owner predicate", () => {
    const filtered = scanFixture(
      FIXTURE_FILE,
      `export async function PATCH() {
        return supabase.from("documents").update({ title }).eq("id", body.id).eq("owner_id", user.id);
      }`,
    );
    expect(filtered[0].ownerScopedChain).toBe(true);
  });

  it("does not count an owner_id key buried in a nested JSON column as a stamp", () => {
    const nested = scanFixture(
      FIXTURE_FILE,
      `export async function POST() {
        return supabase.from("documents").insert({ title, metadata: { owner_id: user.id } });
      }`,
    );
    // subtreeStampsColumn used to recurse the whole argument, so a metadata key counted.
    expect(nested[0].ownerScopedChain, JSON.stringify(nested[0].proofs)).toBe(false);

    const topLevel = scanFixture(
      FIXTURE_FILE,
      `export async function POST() {
        return supabase.from("documents").insert({ owner_id: user.id, metadata: { source: "upload" } });
      }`,
    );
    expect(topLevel[0].ownerScopedChain).toBe(true);
  });

  it("requires every element of an array payload to carry the stamp", () => {
    const mixed = scanFixture(
      FIXTURE_FILE,
      `export async function POST() {
        return supabase.from("documents").insert([{ owner_id: user.id }, { title }]);
      }`,
    );
    expect(mixed[0].ownerScopedChain).toBe(false);
  });
});

describe("P1-2 — `.or()` is a disjunction and cannot be an owner proof on its own", () => {
  const orFixture = (filter: string) =>
    scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("documents").select("id").or(${JSON.stringify(filter)});
      }`,
    )[0];

  it("rejects a disjunct that does not constrain owner_id", () => {
    // Both of these return other tenants' rows; both were accepted before 2026-09-02
    // because the literal merely CONTAINED `owner_id.is.` / `owner_id.eq.`.
    expect(orFixture("owner_id.is.null,status.eq.indexed").ownerScopedChain).toBe(false);
    expect(orFixture("owner_id.eq.11111111-1111-4111-8111-111111111111,id.eq.abc").ownerScopedChain).toBe(false);
    expect(orFixture("status.eq.indexed,owner_id.eq.abc").ownerScopedChain).toBe(false);
  });

  it("accepts the nested shape withOwnerReadScope actually emits", () => {
    // src/lib/public-api-access.ts:113-116 — the split must be parenthesis-aware, and the
    // `and(...)` group is restricted as soon as one of ITS terms restricts owner_id.
    expect(
      orFixture(
        "owner_id.eq.11111111-1111-4111-8111-111111111111,and(owner_id.is.null,metadata->>public_corpus.eq.true)",
      ).ownerScopedChain,
    ).toBe(true);
    expect(orFixture("owner_id.eq.abc,owner_id.is.null").ownerScopedChain).toBe(true);
  });

  it("rejects an and() group that constrains no owner column, and a negated group", () => {
    expect(orFixture("owner_id.eq.abc,and(status.eq.indexed,id.eq.x)").ownerScopedChain).toBe(false);
    expect(orFixture("owner_id.eq.abc,not.and(owner_id.is.null,id.eq.x)").ownerScopedChain).toBe(false);
  });

  it("applies the same rule to user-keyed tables", () => {
    const leaky = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("user_favourites").select("content_key").or("user_id.eq.abc,content_type.eq.tool");
      }`,
    );
    expect(leaky[0].userScopedChain).toBe(false);
  });
});

describe("P2-3 — write-payload identifiers resolve lexically, not file-wide by name", () => {
  it("does not let an owner-stamped `rows` in one function vouch for `rows` in another", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `async function stampOwnedRows(supabase, user) {
        const rows = documents.map((document) => ({ owner_id: user.id, document_id: document.id }));
        return supabase.from("documents").insert(rows);
      }

      export async function POST(request) {
        const rows = body.rows;
        return supabase.from("documents").insert(rows);
      }`,
    );
    expect(sites).toHaveLength(2);
    const byScope = new Map(sites.map((site) => [site.scope, site]));
    expect(byScope.get("stampOwnedRows")?.ownerScopedChain).toBe(true);
    // Before the fix payloadStampsColumn walked the whole file for any variable of this
    // name, so the helper's stamped `rows` vouched for the handler's `body.rows`.
    expect(byScope.get("POST")?.ownerScopedChain, JSON.stringify(byScope.get("POST")?.proofs)).toBe(false);
  });

  it("still resolves a payload built in the same function, and a module-level const", () => {
    const sameFunction = scanFixture(
      FIXTURE_FILE,
      `export async function POST() {
        const rows = documents.map((document) => ({ owner_id: user.id }));
        return supabase.from("documents").insert(rows);
      }`,
    );
    expect(sameFunction[0].ownerScopedChain).toBe(true);

    const moduleConst = scanFixture(
      FIXTURE_FILE,
      `const seedRow = { owner_id: SYSTEM_OWNER_ID, title: "seed" };
      export async function POST() {
        return supabase.from("documents").insert(seedRow);
      }`,
    );
    expect(moduleConst[0].ownerScopedChain).toBe(true);
  });
});

describe("Codex-1 — a payload identifier binds where it is declared, not anywhere in the function", () => {
  it("does not let a sibling block's const vouch for an untrusted payload", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `export async function POST(request) {
        const body = await request.json();
        if (SHOULD_SEED) {
          const rows = [{ owner_id: user.id }];
          void rows;
        }
        return supabase.from("documents").insert(body.rows);
      }`,
    );
    // The earlier fix bounded resolution to the enclosing function but still scanned its
    // whole body, so this block's `rows` bound at a use site it never reaches.
    expect(sites[0].ownerScopedChain, JSON.stringify(sites[0].proofs)).toBe(false);
  });

  it("does not let a `let` that is reassigned before the write count as a stamp", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `export async function POST(request) {
        let rows = [{ owner_id: user.id }];
        rows = await request.json();
        return supabase.from("documents").insert(rows);
      }`,
    );
    expect(sites[0].ownerScopedChain, JSON.stringify(sites[0].proofs)).toBe(false);
  });

  it("does not fall through a shadowing parameter to an outer const of the same name", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `const rows = [{ owner_id: SYSTEM_OWNER_ID }];
      export async function POST(rows) {
        return supabase.from("documents").insert(rows);
      }`,
    );
    expect(sites[0].ownerScopedChain, JSON.stringify(sites[0].proofs)).toBe(false);
  });

  it("still resolves the binding that really is in scope at the write", () => {
    const sameBlock = scanFixture(
      FIXTURE_FILE,
      `export async function POST() {
        if (ready) {
          const rows = [{ owner_id: user.id }];
          return supabase.from("documents").insert(rows);
        }
        return null;
      }`,
    );
    expect(sameBlock[0].ownerScopedChain).toBe(true);

    const outerBlock = scanFixture(
      FIXTURE_FILE,
      `export async function POST() {
        const rows = [{ owner_id: user.id }];
        if (ready) {
          return supabase.from("documents").insert(rows);
        }
        return null;
      }`,
    );
    expect(outerBlock[0].ownerScopedChain).toBe(true);
  });
});

describe("Codex-2 — ownership facts stop at nested functions the query is not inside", () => {
  it("does not let a never-invoked nested helper pin the document id", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `export async function GET(request) {
        const never = async () => {
          return supabase.from("documents").select("id").eq("id", id).eq("owner_id", ownerId).maybeSingle();
        };
        void never;
        return supabase.from("document_chunks").select("content").eq("document_id", id);
      }`,
    );
    const chunks = sites.find((site) => site.table === "document_chunks");
    // Before the fix this collection recursed into every nested function, so an
    // owner-scoped query that never runs satisfied OWNER_PINNED_DOCUMENT_ID for a read
    // that had no scoping of its own.
    expect(chunks?.facts.ownerScopedDocumentIds.has("id")).toBe(false);
    expect(chunks?.facts.hasOwnerScopedDocumentsQuery).toBe(false);
  });

  it("keeps the facts a query can genuinely see, in its own scope and in its own callback", () => {
    const sameScope = scanFixture(
      FIXTURE_FILE,
      `export async function GET(request) {
        const owned = await supabase.from("documents").select("id").eq("id", id).eq("owner_id", ownerId).maybeSingle();
        if (!owned.data) return notFound();
        return supabase.from("document_chunks").select("content").eq("document_id", id);
      }`,
    );
    expect(sameScope.find((site) => site.table === "document_chunks")?.facts.ownerScopedDocumentIds.has("id")).toBe(
      true,
    );

    const ownCallback = scanFixture(
      FIXTURE_FILE,
      `export async function GET(request) {
        return Promise.all(
          ids.map(async (id) => {
            const owned = await supabase
              .from("documents")
              .select("id")
              .eq("id", id)
              .eq("owner_id", ownerId)
              .maybeSingle();
            if (!owned.data) return null;
            return supabase.from("document_chunks").select("content").eq("document_id", id);
          }),
        );
      }`,
    );
    expect(ownCallback.find((site) => site.table === "document_chunks")?.facts.ownerScopedDocumentIds.has("id")).toBe(
      true,
    );
  });
});

describe("Codex-3 — a table named through an identifier fails closed", () => {
  const dynamicFixture = `export async function POST() {
    const naming = { from: (table) => adminSupabase.from(table) };
    const buffer = Buffer.from(await file.arrayBuffer());
    const ids = Array.from(new Set(list));
    await adminSupabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).upload(path, buffer);
    return planDocumentName({ supabase: naming, ownerId, ids });
  }`;

  it("reports the dynamic dispatch and ignores Buffer.from, Array.from and storage buckets", () => {
    const sites = scanFixture(FIXTURE_FILE, dynamicFixture).filter((site) => site.tier === "dynamic-from");
    expect(sites).toHaveLength(1);
    expect(sites[0].argument).toBe("table");
  });

  it("fails an undeclared dynamic dispatch", () => {
    const { violations } = evaluateSites({
      sites: scanFixture(FIXTURE_FILE, dynamicFixture),
      exemptions: [],
      inventory: [],
      untiered: [],
      dynamicFrom: [],
    });
    expect(violations.join("\n")).toMatch(/undeclared dynamic-from query/);
  });

  it("refuses a declaration whose delegate is not itself scanned", () => {
    const { violations } = evaluateSites({
      sites: scanFixture(FIXTURE_FILE, dynamicFixture),
      exemptions: [],
      inventory: [],
      untiered: [],
      dynamicFrom: [
        {
          file: FIXTURE_FILE,
          table: DYNAMIC_TABLE,
          fn: "POST",
          queries: 1,
          proof: PROOF_KINDS.DYNAMIC_TABLE_DISPATCH,
          delegate: "src/lib/not-scanned.ts",
          reason: "a delegate nothing reads is exactly the blind spot this closes",
        },
      ],
    });
    // A declaration pointing at an unscanned module would move the blind spot rather than
    // close it, so the entry has to name a module the scan actually reads.
    expect(violations.join("\n")).toMatch(/is not in SCANNED_LIB_MODULES/);
  });

  it("sees the real dynamic dispatch the review found, declared against a scanned delegate", () => {
    expect(DYNAMIC_FROM_DECLARATIONS).toHaveLength(1);
    const [entry] = DYNAMIC_FROM_DECLARATIONS;
    expect(entry.file).toBe("src/app/api/upload/route.ts");
    expect(SCANNED_LIB_MODULES).toContain(entry.delegate);
    // The delegate is scanned as an ordinary direct-tier site, so its owner filter is
    // proven mechanically rather than asserted in the declaration's prose.
    const documentNaming = scanTenancy(process.cwd()).sites.filter(
      (site) => site.file === entry.delegate && site.table === "documents",
    );
    expect(documentNaming.length).toBeGreaterThan(0);
    expect(documentNaming.every((site) => site.ownerScopedChain)).toBe(true);
  });
});

describe("P2-4 — sanctioned names are resolved, not matched as text", () => {
  it("rejects a file-local no-op named withOwnerReadScope", () => {
    const shadowed = scanFixture(
      FIXTURE_FILE,
      `function withOwnerReadScope(query) {
        return query;
      }

      export async function GET() {
        return withOwnerReadScope(supabase.from("documents").select("id"), access.ownerId);
      }`,
    );
    expect(shadowed[0].ownerScopedChain, JSON.stringify(shadowed[0].proofs)).toBe(false);
  });

  it("rejects the wrapper imported from a module that is not the sanctioned one", () => {
    const wrongModule = scanFixture(
      FIXTURE_FILE,
      'import { withOwnerReadScope } from "@/lib/somewhere-else";\n' +
        `export async function GET() {
        return withOwnerReadScope(supabase.from("documents").select("id"), access.ownerId);
      }`,
    );
    expect(wrongModule[0].ownerScopedChain).toBe(false);
  });

  it("accepts a file-local wrapper that itself carries the owner predicate", () => {
    const realLocal = scanFixture(
      FIXTURE_FILE,
      `function withOwnerReadScope(query, ownerId) {
        return query.eq("owner_id", ownerId);
      }

      export async function GET() {
        return withOwnerReadScope(supabase.from("documents").select("id"), access.ownerId);
      }`,
    );
    expect(realLocal[0].ownerScopedChain).toBe(true);
  });

  it("rejects a file-local no-op named loadOwnedDocument", () => {
    const entry = {
      file: FIXTURE_FILE,
      table: "document_chunks",
      fn: "PATCH",
      queries: 1,
      proof: PROOF_KINDS.OWNED_DOCUMENT_HELPER,
      identifier: "id",
      reason: "fixture",
    };
    const shadowed = scanFixture(
      FIXTURE_FILE,
      `async function loadOwnedDocument(args) {
        return { id: args.documentId };
      }

      export async function PATCH() {
        const document = await loadOwnedDocument({ supabase, documentId: id, ownerId: user.id });
        if (!document) return notFound();
        return supabase.from("document_chunks").select("id").eq("document_id", id);
      }`,
    );
    expect(
      evaluateSites({
        dynamicFrom: [],
        sites: shadowed,
        exemptions: [],
        inventory: [entry],
        untiered: [],
      }).violations.join("\n"),
    ).toContain("no owning-document helper in this scope was handed `id`");
  });

  it("registers only the documentId-shaped argument as an owning-document argument", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      LOCAL_OWNED_DOCUMENT_HELPER +
        `export async function PATCH() {
        const document = await loadOwnedDocument({ supabase, documentId: id, ownerId: user.id });
        if (!document) return notFound();
        return supabase.from("document_chunks").select("id").eq("document_id", id);
      }`,
    );
    const derivedSite = sites.find((site) => site.table === "document_chunks");
    const owningArguments = derivedSite!.facts.owningHelperArguments;
    expect([...owningArguments]).toEqual(["id"]);
    // Every shorthand/identifier argument used to be collected, so `supabase` counted as an
    // owning-document argument and could satisfy an entry declaring it as the identifier.
    expect(owningArguments.has("supabase")).toBe(false);
    expect(owningArguments.has("user")).toBe(false);
  });

  it("resolves a positional owning-helper call through the helper's own parameter names", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `async function requireOwnedDocument(supabase, documentId, ownerId) {
        const { data } = await supabase
          .from("documents")
          .select("id")
          .eq("id", documentId)
          .eq("owner_id", ownerId)
          .maybeSingle();
        if (!data) throw new PublicApiError("Document not found.", 404);
      }

      export async function PATCH() {
        await requireOwnedDocument(supabase, id, user.id);
        return supabase.from("document_chunks").select("id").eq("document_id", id);
      }`,
    );
    const derivedSite = sites.find((site) => site.table === "document_chunks");
    expect([...derivedSite!.facts.owningHelperArguments]).toEqual(["id"]);
  });
});

describe("P2-5 — a table outside the three tiers is signalled, never silently uncovered", () => {
  const TRIAGE = "clinical_quality_feedback_triage";
  const untieredFixture = () =>
    scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("${TRIAGE}").select("signal_id,status,owner_user_id");
      }`,
      { all: new Set(["documents", "user_favourites", "document_chunks", TRIAGE]) },
    );

  it("fails an undeclared query on a table that lands in no tenancy tier", () => {
    const sites = untieredFixture();
    expect(sites).toHaveLength(1);
    expect(sites[0].tier).toBe("untiered");
    const { violations, counts } = evaluateSites({
      dynamicFrom: [],
      sites,
      exemptions: [],
      inventory: [],
      untiered: [],
    });
    expect(counts.untiered).toBe(1);
    // Before the fourth signal this query produced NO site, NO violation and no mention
    // anywhere: zero coverage with zero signal.
    expect(violations.join("\n")).toContain("undeclared untiered-table query");
    expect(violations.join("\n")).toContain("carries no owner_id, user_id or document_id column");
  });

  it("passes once the table is declared with a reason", () => {
    const violations = evaluateSites({
      dynamicFrom: [],
      sites: untieredFixture(),
      exemptions: [],
      inventory: [],
      untiered: [
        {
          file: FIXTURE_FILE,
          table: TRIAGE,
          fn: "GET",
          queries: 1,
          proof: PROOF_KINDS.UNTIERED_TABLE,
          reason: "fixture",
        },
      ],
    }).violations;
    expect(violations).toEqual([]);
  });

  it("refuses an untiered declaration pointed at a table that IS in a tier", () => {
    const sites = scanFixture(
      FIXTURE_FILE,
      `export async function GET() {
        return supabase.from("documents").select("id");
      }`,
    );
    const violations = evaluateSites({
      dynamicFrom: [],
      sites,
      exemptions: [],
      inventory: [],
      untiered: [
        {
          file: FIXTURE_FILE,
          table: "documents",
          fn: "GET",
          queries: 1,
          proof: PROOF_KINDS.UNTIERED_TABLE,
          reason: "fixture",
        },
      ],
    }).violations;
    expect(violations.join("\n")).toContain("No query site matched it at all");
  });

  it("sees the real untiered table the review found, and it is declared", () => {
    const { untiered, tiers } = queriedTablesByTier(process.cwd());
    expect(untiered, "the scanned files query no untiered table — has the tier parse changed?").toContain(TRIAGE);
    for (const table of untiered) {
      expect(tiers.direct.has(table) || tiers.userKeyed.has(table) || tiers.derived.has(table)).toBe(false);
      expect(
        UNTIERED_TABLE_DECLARATIONS.some((entry) => entry.table === table),
        `${table} is queried, is in no tenancy tier, and is not declared in UNTIERED_TABLE_DECLARATIONS`,
      ).toBe(true);
    }
  });

  it("treats an empty tier as a broken scan, not a clean repo", () => {
    // The database.types.ts parse is anchored to that generated file's exact indentation.
    // De-indent it and every tier empties, every site disappears and the scan reports zero
    // violations — so the shipped command asserts non-empty tier counts, and so does this.
    expect(emptyTierNames({ direct: 0, userKeyed: 0, derived: 0 })).toEqual(["direct", "userKeyed", "derived"]);
    expect(emptyTierNames({ direct: 5, userKeyed: 0, derived: 2 })).toEqual(["userKeyed"]);
    expect(emptyTierNames(scanTenancy(process.cwd()).counts)).toEqual([]);
  });
});

describe("dynamic retrieval RPC dispatch (blind spot E)", () => {
  it("flags a second dynamic .rpc() dispatch site and a non-literal dispatcher name", () => {
    const secondDispatcher = analyzeRpcDispatch({
      relativePath: "src/lib/synthetic-retrieval.ts",
      source: `export async function callSomething(client, name, args) {
        return client.rpc(name, args);
      }`,
    });
    expect(secondDispatcher.dynamicRpcCalls).toHaveLength(1);
    expect(secondDispatcher.dynamicRpcCalls[0].scopes).toContain("callSomething");
    expect(secondDispatcher.dynamicRpcCalls[0].scopes).not.toContain("callVersionedRetrievalRpc");

    const literalCall = analyzeRpcDispatch({
      relativePath: "src/lib/rag/synthetic.ts",
      source: `const result = await callVersionedRetrievalRpc(supabase, "match_v2", "match", args, signal);`,
    });
    expect(literalCall.dispatcherCallSites).toHaveLength(1);
    expect(literalCall.dispatcherCallSites[0].literalNames).toBe(true);

    const computedCall = analyzeRpcDispatch({
      relativePath: "src/lib/rag/synthetic.ts",
      source: `const result = await callVersionedRetrievalRpc(supabase, versionedName, legacyName, args, signal);`,
    });
    expect(computedCall.dispatcherCallSites[0].literalNames).toBe(false);
  });

  it("pins callVersionedRetrievalRpc as the only dynamic dispatcher in src/", { timeout: 60_000 }, () => {
    const { dynamicRpcCalls, dispatcherCallSites, violations } = scanRpcDispatch(process.cwd());
    expect(dynamicRpcCalls.length, "found no .rpc() calls at all — has the client API changed?").toBeGreaterThan(0);
    expect(
      dispatcherCallSites.length,
      "found no callVersionedRetrievalRpc call sites — the retrieval RPC surface moved",
    ).toBeGreaterThan(0);
    expect(dispatcherCallSites.every((site) => site.literalNames)).toBe(true);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("mechanical tenancy scan over the real surface", () => {
  it("covers every .ts under src/app/api plus the named server-side read modules", () => {
    const { sites } = scanTenancy(process.cwd());
    const scannedPaths = new Set(sites.map((site) => site.file));
    for (const modulePath of SCANNED_LIB_MODULES) {
      expect(scannedPaths.has(modulePath), `${modulePath} produced no scanned query — is it still a read module?`).toBe(
        true,
      );
    }
    // /api/documents/images/batch is a bare re-export of /api/images/signed-urls and so has
    // no query of its own; the re-exported module is what carries the inventory entry.
    expect(scannedPaths.has("src/app/api/documents/images/batch/route.ts")).toBe(false);
    expect(scannedPaths.has("src/app/api/images/signed-urls/route.ts")).toBe(true);
  });

  it("keeps every direct, user-keyed and derived query scoped on its chain or declared", () => {
    const { violations, counts } = scanTenancy(process.cwd());
    expect(counts.direct, "found no direct-tier queries — is the tier derivation stale?").toBeGreaterThan(0);
    expect(counts.userKeyed, "found no user-keyed queries — is the tier derivation stale?").toBeGreaterThan(0);
    expect(counts.derived, "found no derived-tier queries — is the tier derivation stale?").toBeGreaterThan(0);
    expect(
      violations,
      "Every query on an owner_id / user_id / document_id table must carry its tenancy predicate on its own " +
        "query chain, or be declared in SCOPE_EXEMPTIONS / DERIVED_QUERY_INVENTORY " +
        `(scripts/lib/tenancy-scan.mjs) with the proof of ownership:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("documents every declared exemption and inventory entry in the tenancy review", () => {
    const review = readFileSync(join(process.cwd(), "docs", "audit", "tenancy-defense-in-depth-review.md"), "utf8");
    const lines = review.split("\n");
    for (const entry of [...SCOPE_EXEMPTIONS, ...DERIVED_QUERY_INVENTORY, ...UNTIERED_TABLE_DECLARATIONS]) {
      expect(entry.reason.length, `${entry.file} / ${entry.table} has no reason`).toBeGreaterThan(40);
      const documented = lines.some((line) => line.includes(entry.file) && line.includes(entry.table));
      expect(
        documented,
        `${entry.file} / ${entry.table} (${entry.fn}) is not documented in docs/audit/tenancy-defense-in-depth-review.md`,
      ).toBe(true);
    }
  });
});
