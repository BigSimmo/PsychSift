import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for audit F-09 (#EG02B7): pruning superseded index generations on commit.
// Behaviour is proven against a replayed database by tests/sql/index-generation-prune.sql.
const migrationPath = "supabase/migrations/20261019155200_prune_superseded_index_generations_on_commit.sql";
const sql = readFileSync(migrationPath, "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const code = sql.replace(/--.*$/gm, "");

const artifactTables = [
  "document_embedding_fields",
  "document_index_units",
  "document_table_facts",
  "document_memory_cards",
  "document_sections",
  "document_images",
  "document_pages",
  "document_chunks",
];

describe("prune superseded index generations migration", () => {
  it("is mirrored verbatim in schema.sql", () => {
    expect(schema).toContain(sql.trimEnd());
    expect(schema).toContain("-- Projection: 20261019155200_prune_superseded_index_generations_on_commit.sql");
  });

  it("runs transactionally with bounded lock and statement timeouts", () => {
    expect(code).toContain("set local lock_timeout = '5s';");
    expect(code).toContain("set local statement_timeout = '30s';");
    expect(code).not.toMatch(/\bconcurrently\b/i);
    expect(code).not.toMatch(/\b(begin|commit)\s*;/i);
  });

  it("leaves the commit function and every retrieval function untouched", () => {
    expect(code).not.toMatch(/function public\.commit_document_index_generation/);
    expect(code).not.toMatch(
      /function public\.(match_|search_|hybrid_|is_committed_artifact_generation|is_visible_document_page)/,
    );
  });

  it("scopes every delete to the one document, skips NULL-generation rows and the keep set", () => {
    const deletes = [...code.matchAll(/delete from public\.(\w+) t using victims v where t\.id = v\.id/g)].map(
      (m) => m[1],
    );
    expect(deletes).toEqual(artifactTables);
    const victimSelects = [...code.matchAll(/select t\.id from public\.(\w+) t\n\s+where ([\s\S]*?)limit v_batch/g)];
    expect(victimSelects.map((m) => m[1])).toEqual(artifactTables);
    for (const [, , predicate] of victimSelects) {
      expect(predicate).toContain("t.document_id = p_document_id");
      expect(predicate).toContain("t.index_generation_id is not null");
      expect(predicate).toContain("t.index_generation_id <> all(v_keep)");
      // A row whose metadata names a kept generation survives even if its typed column disagrees.
      expect(predicate).toContain(
        "pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)",
      );
    }
  });

  it("protects the new, previous, live-pointer, open-job and pending-candidate generations", () => {
    expect(code).toContain("array[new.index_generation_id, old.index_generation_id]");
    expect(code).toContain("select d.index_generation_id from public.documents d where d.id = p_document_id");
    expect(code).toMatch(/from public\.ingestion_jobs j[\s\S]*?j\.status in \('pending', 'processing'\)/);
    expect(code).toMatch(/from public\.indexing_v3_agent_jobs j[\s\S]*?j\.status in \('pending', 'processing'\)/);
    expect(code).toContain("lease_write_generation_id");
    expect(code).toContain("lease_expected_generation_id");
    expect(code).toMatch(
      /from ingestion_generation_evidence\.candidates c\s+where c\.document_id = p_document_id\s+and not exists \(select 1 from public\.ingestion_jobs j where j\.id = c\.job_id and j\.status = 'completed'\)/,
    );
  });

  it("bounds the work a commit can spend: row ceiling, small batches, deadline per batch, fast lock failure", () => {
    expect(code).toContain("p_row_limit not between 1 and 50000");
    expect(code).toContain("v_budget := p_row_limit;");
    expect(code).toContain("v_batch := least(v_budget, 250);");
    // The deadline is checked inside the batch loop, before every delete statement.
    expect(code).toMatch(
      /loop\n\s+exit when v_budget <= 0 or pg_catalog\.clock_timestamp\(\) > v_deadline;\n\s+v_batch := least\(v_budget, 250\);/,
    );
    expect(code).toContain("v_deadline := pg_catalog.clock_timestamp() + interval '500 milliseconds';");
    expect(code).toContain(
      "pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => v_timeout_ms / 2000.0)",
    );
    expect(code).toContain("'skipped', 'no_time_headroom'");
    expect(code).toMatch(/security definer\nset search_path = ''\nset lock_timeout = '100ms'\nas \$\$/);
    expect(code).toMatch(/array\[new\.index_generation_id, old\.index_generation_id\], 2000\)/);
  });

  it("never swallows a statement timeout or cancel", () => {
    expect(code).not.toMatch(/query_canceled|57014/i);
    expect(code.match(/exception when/g)).toHaveLength(1);
  });

  it("guards kept rows from cascades and set-nulls through older parents", () => {
    expect(code).toContain("not exists (select 1 from public.document_memory_cards m where m.section_id = t.id)");
    expect(code).toContain("t.id::text is distinct from v_cover");
    for (const child of ["document_table_facts f", "document_embedding_fields e", "document_index_units u"]) {
      expect(code).toContain(
        `not exists (select 1 from public.${child} where ${child.slice(-1)}.source_chunk_id = t.id)`,
      );
    }
  });

  it("queues unreferenced image objects for the janitor instead of deleting storage inline", () => {
    expect(code).not.toMatch(/storage\.objects/);
    expect(code).toContain("where not exists (select 1 from public.document_images i where i.storage_path = p.path)");
    expect(code).toMatch(
      /insert into public\.storage_cleanup_jobs\([\s\S]*?v_owner, null, '\{\}'::text\[\], 'clinical-images', v_stale_paths, 'pending'/,
    );
    expect(code).toContain("'operation', 'superseded_index_generation_prune'");
  });

  it("is best effort on the commit path and reachable only through the trigger", () => {
    expect(code).toMatch(/exception when others then\s+raise warning 'index_generation_prune_skipped/);
    expect(code).toContain(
      "after update of metadata on public.documents\nfor each row\nwhen (new.index_generation_id is not null and old.index_generation_id is distinct from new.index_generation_id)",
    );
    for (const signature of [
      "public.prune_superseded_document_index_generations(uuid, uuid[], integer)",
      "public.prune_superseded_index_generations_after_commit()",
    ]) {
      expect(code).toContain(`alter function ${signature} owner to postgres;`);
      expect(code).toMatch(
        new RegExp(
          `revoke all on function ${signature.replace(/[()[\]]/g, "\\$&")}\\s+from public, anon, authenticated, service_role;`,
        ),
      );
    }
    expect(code.match(/security definer\nset search_path = ''\n/g)).toHaveLength(2);
  });
});
