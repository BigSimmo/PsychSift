// #3732: offline contract for 20261021170000_restore_generation_metadata_on_rollback.sql. The SQL
// itself was exercised against a scratch Postgres (commit, rollback, roll forward, missing
// snapshot, malformed pointer); CI's migration replay runs the whole chain.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261021170000_restore_generation_metadata_on_rollback.sql",
  "utf8",
);
const patchSql = readFileSync("supabase/migrations/20261015200000_fenced_ingestion_followups.sql", "utf8");

function quotedList(source: string) {
  return [...source.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
}

describe("rollback restores generation-specific details (#3732)", () => {
  it("snapshots exactly the worker-owned metadata keys the fenced document patch allows", () => {
    const keysBody = migration.match(
      /document_index_generation_metadata_keys\(\)\s*returns text\[\][\s\S]*?\$\$([\s\S]*?)\$\$/,
    );
    const patchBody = patchSql.match(/jsonb_object_keys\(p_metadata\) k where k <> all\(array\[([^\]]*)\]\)/);
    expect(keysBody && patchBody).toBeTruthy();
    const snapshotKeys = quotedList(keysBody![1]).sort();
    const patchKeys = quotedList(patchBody![1])
      .filter((key) => key !== "index_generation_id")
      .sort();
    expect(snapshotKeys).toEqual(patchKeys);
  });

  it("refuses a rollback whose target has no complete snapshot instead of leaving mismatched details", () => {
    expect(migration).toMatch(
      /if not found or v_snapshot\.metadata is null or v_snapshot\.quality is null then\s+return jsonb_build_object\('ok', false, 'reason', 'target_snapshot_missing'\);/,
    );
  });

  it("restores quality before moving the pointer, and only replaces worker-owned keys", () => {
    const qualityRestore = migration.indexOf("update public.document_index_quality q");
    const pointerMove = migration.indexOf("set metadata = (metadata - v_keys) || v_snapshot.metadata");
    expect(qualityRestore).toBeGreaterThan(0);
    expect(pointerMove).toBeGreaterThan(qualityRestore);
  });

  it("keeps snapshots service-role only and parses the pointer like the generated column", () => {
    expect(migration).toContain("alter table public.document_index_generation_snapshots enable row level security;");
    expect(migration).toContain(
      "revoke all on table public.document_index_generation_snapshots from public, anon, authenticated;",
    );
    expect(migration).toContain("'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'");
    expect(migration).not.toMatch(/nullif\([^)]*\)::uuid/);
  });

  it("is projected into supabase/schema.sql", () => {
    expect(readFileSync("supabase/schema.sql", "utf8")).toContain(
      "-- Projection: 20261021170000_restore_generation_metadata_on_rollback.sql",
    );
  });
});
