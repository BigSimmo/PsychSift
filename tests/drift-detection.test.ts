import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HISTORY_PROBE_MIGRATION,
  compareDriftSnapshots,
  diffColumns,
  fieldDiff,
  historyEntryProblems,
  normalizedSchemaSha256,
  selfTest,
} from "../scripts/check-drift";

const root = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

describe("drift manifest freshness (offline half of check:drift)", () => {
  it("supabase/drift-manifest.json was generated from the current supabase/schema.sql", () => {
    const manifest = JSON.parse(read("supabase/drift-manifest.json"));
    expect(
      manifest.schema_sha256,
      "supabase/schema.sql changed without regenerating the drift manifest. Run: npm run drift:manifest (requires Docker).",
    ).toBe(normalizedSchemaSha256(read("supabase/schema.sql")));
  });

  it("manifest snapshot carries every inventory category", () => {
    const { snapshot } = JSON.parse(read("supabase/drift-manifest.json"));
    for (const category of [
      "extensions",
      "tables",
      "views",
      "functions",
      "indexes",
      "policies",
      "constraints",
      "triggers",
      "storage_buckets",
    ]) {
      expect(Array.isArray(snapshot[category]), `manifest.snapshot.${category} missing`).toBe(true);
      expect((snapshot[category] as unknown[]).length, `manifest.snapshot.${category} empty`).toBeGreaterThan(0);
    }
    // Full-inventory sanity: the app schema is large; a tiny snapshot means the
    // replay silently failed rather than schema.sql shrinking by 10x.
    expect((snapshot.functions as unknown[]).length).toBeGreaterThan(40);
    expect((snapshot.indexes as unknown[]).length).toBeGreaterThan(100);
    expect((snapshot.tables as unknown[]).length).toBeGreaterThan(30);
  });

  it("manifest snapshot is v2 with the migration-history probe (empty on replay — no history table)", () => {
    const { snapshot } = JSON.parse(read("supabase/drift-manifest.json"));
    expect(snapshot.snapshot_version).toBe(2);
    // The scratch replay never creates supabase_migrations, so the manifest
    // must record that honestly rather than an "ok" probe with zero rows.
    expect(snapshot.migration_history_probe).toBe("no_history_table");
    expect(snapshot.migration_history).toEqual([]);
  });
});

describe("local drift replay container safety", () => {
  const generator = read("scripts/generate-drift-manifest.ts");

  it("uses an immutable cached image and binds scratch Postgres to loopback", () => {
    expect(generator).toContain("@sha256:");
    expect(generator).toContain('"--pull=never"');
    expect(generator).toContain("127.0.0.1");
  });

  it("owns scratch containers per worktree before removing them", () => {
    expect(generator).toContain("DRIFT_OWNER_LABEL");
    expect(generator).toContain("assertOwnedContainer");
    expect(generator).toContain("worktreeIdentity");
    expect(generator).toContain("process.pid");
  });
});

describe("schema_drift_snapshot definition parity (migration vs schema.sql)", () => {
  const extract = (text: string) => {
    const start = text.indexOf("create or replace function public.schema_drift_snapshot()");
    expect(start, "schema_drift_snapshot definition not found").toBeGreaterThanOrEqual(0);
    const end = text.indexOf("grant execute on function public.schema_drift_snapshot() to service_role;", start);
    expect(end, "schema_drift_snapshot grants not found").toBeGreaterThan(start);
    return text.slice(start, end);
  };

  // The newest migration that redefines schema_drift_snapshot(); schema.sql must mirror it.
  const LATEST_DEFINER_MIGRATION = "20261021180000_schema_drift_snapshot_literal_safe_comments.sql";

  it(`migration ${LATEST_DEFINER_MIGRATION.slice(0, 14)} (latest definer) and schema.sql carry byte-identical definitions`, () => {
    const fromMigration = extract(read(`supabase/migrations/${LATEST_DEFINER_MIGRATION}`));
    const fromSchema = extract(read("supabase/schema.sql"));
    expect(fromSchema).toBe(fromMigration);
  });

  it("strips a line comment only where no quoted value is open on that line (#81A3YJ)", () => {
    const sql = extract(read(`supabase/migrations/${LATEST_DEFINER_MIGRATION}`));
    expect(sql).toContain(`'(^|\\n)((?:[^''"\\n-]|-(?!-)|''[^''\\n]*''|"[^"\\n]*")*)--[^\\n]*', '\\1\\2', 'g'`);
    expect(sql).not.toContain(`'--[^\\n]*', '', 'g'`);
    // The latest definer keeps everything the v2 probe added.
    expect(sql).toContain("'snapshot_version', 2");
    expect(sql).toContain("'migration_history_probe', history_probe");
  });

  it("v2 probe reads history via a guarded dynamic query and reports its own availability", () => {
    const sql = extract(read(`supabase/migrations/${HISTORY_PROBE_MIGRATION}`));
    expect(sql).toContain("'snapshot_version', 2");
    expect(sql).toContain("to_regclass('supabase_migrations.schema_migrations')");
    expect(sql).toContain("m.statements is null or cardinality(m.statements) = 0");
    for (const probe of ["'no_history_table'", "'no_statements_column'", "'ok'"]) {
      expect(sql, `probe state ${probe} missing`).toContain(probe);
    }
    expect(sql).toContain("'migration_history', history");
    expect(sql).toContain("'migration_history_probe', history_probe");
    // Still stable + security definer + pinned search_path, exactly like v1.
    expect(sql).toMatch(/stable\s+security definer\s+set search_path to ''/);
  });
});

describe("drift allowlist hygiene", () => {
  const allowlist = JSON.parse(read("supabase/drift-allowlist.json")) as {
    entries: {
      category: string;
      kind: string;
      key: string;
      live_key?: string;
      reason: string;
      guard?: { class: string; migration: string; objects?: string[] };
    }[];
  };

  it("every entry is well-formed with a real reason", () => {
    expect(Array.isArray(allowlist.entries)).toBe(true);
    for (const entry of allowlist.entries) {
      expect([
        "extensions",
        "tables",
        "views",
        "functions",
        "indexes",
        "policies",
        "constraints",
        "triggers",
        "storage_buckets",
        "migration_history",
      ]).toContain(entry.category);
      expect(["missing_live", "unexpected_live", "mismatch", "alias", "no_statements"]).toContain(entry.kind);
      expect(entry.key.length).toBeGreaterThan(0);
      expect(entry.reason.length, `allowlist entry ${entry.category}/${entry.key} needs a reason`).toBeGreaterThan(20);
      expect(entry.reason).not.toContain("UNCLASSIFIED");
      if (entry.kind === "alias") {
        expect(entry.live_key, `alias entry ${entry.key} needs live_key`).toBeTruthy();
      }
      // migration_history <-> no_statements is a one-to-one pairing, and every
      // such entry must pass the structural guard validation check:drift uses.
      if (entry.category === "migration_history" || entry.kind === "no_statements") {
        expect(entry.category).toBe("migration_history");
        expect(entry.kind).toBe("no_statements");
        expect(historyEntryProblems(entry as never), `history entry ${entry.key}`).toEqual([]);
      }
    }
  });

  it("has no duplicate entries", () => {
    const seen = new Set<string>();
    for (const entry of allowlist.entries) {
      const id = `${entry.category}|${entry.kind}|${entry.key}|${entry.live_key ?? ""}`;
      expect(seen.has(id), `duplicate allowlist entry: ${id}`).toBe(false);
      seen.add(id);
    }
  });
});

describe("compareDriftSnapshots", () => {
  const base = {
    extensions: [{ name: "vector", schema: "extensions" }],
    tables: [
      {
        name: "documents",
        rls_enabled: true,
        rls_forced: false,
        reloptions: null,
        acl: ["postgres=arwdDxtm/postgres"],
        columns: [{ name: "id", type: "uuid", not_null: true, identity: "", generated: "", default: null }],
      },
    ],
    views: [],
    functions: [{ signature: "public.fn()", def_hash: "aaa", acl: ["postgres=X/postgres"] }],
    indexes: [
      {
        name: "documents_pkey",
        table: "documents",
        def: "CREATE UNIQUE INDEX documents_pkey ON public.documents USING btree (id)",
        def_hash: "h1",
      },
    ],
    policies: [],
    constraints: [],
    triggers: [],
    storage_buckets: [],
  };
  const clone = () => JSON.parse(JSON.stringify(base));

  it("reports nothing when snapshots match", () => {
    const r = compareDriftSnapshots(clone(), clone(), []);
    expect(r.findings).toEqual([]);
    expect(r.staleEntries).toEqual([]);
  });

  it("detects mismatches, missing and unexpected objects", () => {
    const live = clone();
    live.functions[0].def_hash = "bbb";
    live.indexes = [];
    live.tables.push({ ...base.tables[0], name: "rogue_table" });
    const r = compareDriftSnapshots(clone(), live, []);
    const kinds = r.findings.map(
      (f: { category: string; kind: string; key: string }) => `${f.category}:${f.kind}:${f.key}`,
    );
    expect(kinds).toContain("functions:mismatch:public.fn()");
    expect(kinds).toContain("indexes:missing_live:documents_pkey");
    expect(kinds).toContain("tables:unexpected_live:rogue_table");
    expect(r.findings).toHaveLength(3);
  });

  it("treats extra live extensions as informational, missing ones as findings", () => {
    const live = clone();
    live.extensions = [{ name: "pg_net", schema: "extensions" }];
    const r = compareDriftSnapshots(clone(), live, []);
    expect(r.infos.some((i: string) => i.includes("pg_net"))).toBe(true);
    expect(r.findings.map((f: { key: string }) => f.key)).toContain("vector");
  });

  it("allowlist consumes matching findings and reports stale entries", () => {
    const live = clone();
    live.functions[0].def_hash = "bbb";
    const entries = [
      { category: "functions", kind: "mismatch", key: "public.fn()", reason: "pending migration" },
      { category: "tables", kind: "mismatch", key: "documents", reason: "no longer true" },
    ] as never[];
    const r = compareDriftSnapshots(clone(), live, entries);
    expect(r.findings).toEqual([]);
    expect(r.allowed).toHaveLength(1);
    expect(r.staleEntries).toHaveLength(1);
  });

  it("alias entries require an identical name-stripped definition on the same table", () => {
    const expected = clone();
    const live = clone();
    live.indexes = [
      {
        name: "documents_pkey_legacy",
        table: "documents",
        def: "CREATE UNIQUE INDEX documents_pkey_legacy ON public.documents USING btree (id)",
        def_hash: "h2",
      },
    ];
    const alias = [
      {
        category: "indexes",
        kind: "alias",
        key: "documents_pkey",
        live_key: "documents_pkey_legacy",
        reason: "legacy live name x",
      },
    ] as never[];
    const r = compareDriftSnapshots(expected, live, alias);
    expect(r.findings).toEqual([]);
    expect(r.allowed).toHaveLength(2); // consumes missing_live + unexpected_live

    // A legacy index with a DIFFERENT shape must NOT satisfy the alias.
    const badLive = clone();
    badLive.indexes = [
      {
        name: "documents_pkey_legacy",
        table: "documents",
        def: "CREATE INDEX documents_pkey_legacy ON public.documents USING btree (created_at)",
        def_hash: "h3",
      },
    ];
    const r2 = compareDriftSnapshots(expected, badLive, alias);
    expect(r2.findings.map((f: { kind: string }) => f.kind)).toContain("missing_live");
  });

  describe("migration-history probe", () => {
    const withHistory = (rows: unknown[], probe = "ok") => ({
      ...clone(),
      migration_history: rows,
      migration_history_probe: probe,
    });
    const rows = [
      { version: "20260701030000", name: "schema_health_hybrid_execution_smoke", signal: "null" },
      { version: "20260712170500", name: "codify_live_operational_indexes", signal: "empty" },
    ];
    const validEntry = {
      category: "migration_history",
      kind: "no_statements",
      key: "20260701030000",
      reason: "mark-applied after hand-apply; function redefined by the M13 guard migration",
      guard: {
        class: "superseded",
        migration: "20260706010000_search_schema_health_m13_guard.sql",
        objects: ["search_schema_health"],
      },
    } as never;

    it("reports every live no-statements version as a finding, ignoring the manifest side", () => {
      // The manifest replay has no history table: expected side is [] / not ok.
      const expected = { ...clone(), migration_history: [], migration_history_probe: "no_history_table" };
      const r = compareDriftSnapshots(expected, withHistory(rows), []);
      const history = r.findings.filter((f: { category: string }) => f.category === "migration_history");
      expect(history.map((f: { key: string }) => f.key)).toEqual(["20260701030000", "20260712170500"]);
      expect(history.every((f: { kind: string }) => f.kind === "no_statements")).toBe(true);
      expect(history[1].detail).toContain("codify_live_operational_indexes (statements empty)");
      // Object categories still compare cleanly; history rows never appear as unexpected_live.
      expect(r.findings).toHaveLength(2);
    });

    it("a valid guard-backed allowlist entry consumes exactly its version", () => {
      const r = compareDriftSnapshots(clone(), withHistory(rows), [validEntry]);
      expect(r.findings.map((f: { key: string }) => f.key)).toEqual(["20260712170500"]);
      expect(r.allowed).toHaveLength(1);
      expect(r.staleEntries).toEqual([]);
    });

    it("a malformed or unbacked entry never silences a row and is reported stale", () => {
      const noGuard = { ...(validEntry as object), guard: undefined } as never;
      const missingFile = {
        ...(validEntry as object),
        guard: { class: "superseded", migration: "20260706010001_does_not_exist.sql", objects: ["x"] },
      } as never;
      const wrongClassForNewVersion = {
        ...(validEntry as object),
        key: "20260901000000",
        guard: { class: "superseded", migration: "20260901010000_later.sql", objects: ["x"] },
      } as never;
      const laterRows = [...rows, { version: "20260901000000", name: "future_repair", signal: "null" }];
      const r = compareDriftSnapshots(clone(), withHistory(laterRows), [noGuard, missingFile, wrongClassForNewVersion]);
      expect(r.findings.map((f: { key: string }) => f.key)).toEqual([
        "20260701030000",
        "20260712170500",
        "20260901000000",
      ]);
      expect(r.staleEntries).toHaveLength(3);
      expect(historyEntryProblems(noGuard)).toContain("guard is required");
      expect(historyEntryProblems(missingFile).join(" ")).toContain("does not exist");
      expect(historyEntryProblems(wrongClassForNewVersion, { migrationExists: () => true }).join(" ")).toContain(
        "must use a validation guard",
      );
    });

    it("explains a live snapshot without the probe as a pending deploy, not as drift", () => {
      const r = compareDriftSnapshots(clone(), clone(), []);
      expect(r.findings).toEqual([]);
      expect(r.infos.some((i: string) => i.includes(HISTORY_PROBE_MIGRATION))).toBe(true);
      const r2 = compareDriftSnapshots(clone(), withHistory([], "no_statements_column"), []);
      expect(r2.findings).toEqual([]);
      expect(r2.infos.some((i: string) => i.includes("no_statements_column"))).toBe(true);
    });
  });

  describe("wide-table column diff and selfTest (#90EVWZ)", () => {
    it("runs check-drift offline selfTest without throwing", () => {
      expect(() => selfTest()).not.toThrow();
    });

    it("outputs full column names and property diffs for wide tables without 240-char clipping", () => {
      const wideColumns = Array.from({ length: 25 }, (_, i) => ({
        name: `column_${String(i).padStart(2, "0")}_very_long_descriptive_name_padding_the_json`,
        type: "text",
        not_null: false,
        default: null,
        identity: "",
        generated: "",
      }));

      // Mutate the 25th column (late in the alphabet)
      const liveColumns = wideColumns.map((c, i) => (i === 24 ? { ...c, type: "bigint", not_null: true } : { ...c }));

      const expTable = {
        name: "document_chunks_wide",
        rls_enabled: true,
        rls_forced: false,
        reloptions: null,
        acl: ["postgres=arwdDxtm/postgres"],
        columns: wideColumns,
      };
      const liveTable = {
        ...expTable,
        columns: liveColumns,
      };

      const diff = fieldDiff("tables", expTable, liveTable);
      expect(diff).toContain("column_24_very_long_descriptive_name_padding_the_json");
      expect(diff).toContain('type: manifest="text" live="bigint"');
      expect(diff).toContain("not_null: manifest=false live=true");
      expect(diff).not.toContain("…");
    });

    it("detects missing and unexpected columns in diffColumns", () => {
      const colA = { name: "col_a", type: "text", not_null: false, default: null, identity: "", generated: "" };
      const colB = { name: "col_b", type: "integer", not_null: true, default: null, identity: "", generated: "" };

      const diffMissing = diffColumns([colA, colB], [colA]);
      expect(diffMissing).toContain("missing_in_live(col_b:");

      const diffUnexpected = diffColumns([colA], [colA, colB]);
      expect(diffUnexpected).toContain("unexpected_in_live(col_b:");
    });
  });
});
