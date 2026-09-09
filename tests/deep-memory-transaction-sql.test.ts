import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260713030000_producer_scoped_deep_memory.sql", import.meta.url),
  "utf8",
)
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("historical producer-scoped deep-memory transaction SQL", () => {
  it("allows overlapping section indexes only across explicit generations", () => {
    expect(migration).toContain("drop constraint if exists document_sections_document_id_section_index_key");
    expect(migration).toContain("where artifact_generation_id is null");
    expect(migration).toContain("document_id, producer, artifact_generation_id, section_index");
  });

  it("keeps the commit RPC service-role only and locks the document", () => {
    expect(migration).toContain("create or replace function public.commit_document_deep_memory_generation");
    expect(migration).toContain("for update");
    expect(migration).toContain(
      "revoke execute on function public.commit_document_deep_memory_generation(uuid, text, uuid, text, text, integer, integer, jsonb, integer) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.commit_document_deep_memory_generation(uuid, text, uuid, text, text, integer, integer, jsonb, integer) to service_role",
    );
  });

  it("activates the staged generation before deleting only the same producer's older rows", () => {
    for (const table of ["document_sections", "document_memory_cards", "document_index_units"]) {
      expect(migration).toContain(`update public.${table}`);
      expect(migration).toContain(`delete from public.${table}`);
    }
    expect(migration).toContain("artifact_generation_id = p_artifact_generation_id");
    expect(migration).toContain("producer = p_producer");
    expect(migration).toContain("metadata->>'generated_by' = p_producer");
    expect(migration).toContain("v_total_section_count <> v_section_count");
    expect(migration).toContain("v_total_memory_card_count <> v_memory_card_count");
    expect(migration).toContain("v_total_index_unit_count <> coalesce(v_index_unit_count, 0)");
    expect(migration).toContain("owner_id is not distinct from v_document_owner_id");
    expect(migration).not.toContain("delete from public.document_images");
    expect(migration).not.toContain("delete from public.document_table_facts");
  });

  it("fails closed on ambiguous ownership and validates all required commit inputs", () => {
    expect(migration).toContain("producer evidence is contradictory or ambiguous");
    expect(migration).toContain("p_section_count is null");
    expect(migration).toContain("p_memory_card_count is null");
    expect(migration).toContain("p_repaired_anchor_count is null");
    expect(migration).toContain("jsonb_typeof(p_index_unit_counts_by_type) <> 'object'");
    expect(migration).toContain("counts must be nonnegative integers");
    expect(migration).toContain("nullif(btrim(p_rag_memory_version), '') is null");
    expect(migration).toContain("nullif(btrim(p_document_intelligence_version), '') is null");
  });

  it("recognises only consistent legacy ownership and never trusts the caller version for deletion", () => {
    expect(migration).toContain("card.producer is null and card.metadata->>'generated_by' = p_producer");
    expect(migration).toContain("metadata->>'rag_indexing_version' = 'rag-deep-memory-v1'");
    expect(migration).toContain("p_producer = 'local-worker' and artifact_generation_id is null");
    expect(migration).toContain("card.artifact_generation_id is null");
    expect(migration).not.toContain("metadata->>'rag_indexing_version' = p_rag_memory_version");
  });

  it("patches document metadata after artifact activation and deletion", () => {
    const lastDelete = migration.lastIndexOf("delete from public.document_sections");
    const metadataPatch = migration.lastIndexOf("perform public.apply_document_metadata_patch");
    expect(lastDelete).toBeGreaterThan(-1);
    expect(metadataPatch).toBeGreaterThan(lastDelete);
    expect(migration).toContain("'deep_memory_generations'");
    expect(migration).toContain("'section_count', p_section_count");
    expect(migration).toContain("'memory_card_count', p_memory_card_count");
  });
});

const fencedMigration = readFileSync(
  new URL("../supabase/migrations/20260831101000_fence_ingestion_leases_and_repairs.sql", import.meta.url),
  "utf8",
);
const commitStart = fencedMigration.indexOf("function public.commit_document_deep_memory_generation(p_fence");
const fencedCommit = fencedMigration.slice(commitStart, fencedMigration.indexOf("end $$;", commitStart));
describe("U03 effective fenced deep-memory commit SQL (static only)", () => {
  it("checks current authority before exact receipt reuse and rejects altered commit identity", () => {
    expect(fencedCommit.indexOf("assert_current_ingestion_attempt")).toBeLessThan(fencedCommit.indexOf("v_receipt :="));
    expect(fencedCommit).toContain("v_receipt->'request' is distinct from v_request");
    for (const key of [
      "'fence'",
      "'artifact_generation'",
      "'anchors'",
      "'aliases'",
      "'section_count'",
      "'memory_card_count'",
      "'index_unit_counts_by_type'",
    ])
      expect(fencedCommit).toContain(key);
  });
  it("fences chunk anchors and aliases inside the same generation commit rollback boundary", () => {
    expect(fencedCommit).toContain("and anchor_id is null");
    expect(fencedCommit).toContain("index_generation_id=(p_fence->>'expected_generation_id')::uuid");
    expect(fencedCommit).toContain("deep_memory_alias_owner_collision");
    expect(fencedCommit).toContain("public.commit_document_deep_memory_generation(v_document_id,'local-worker'");
    expect(fencedCommit.indexOf("insert into public.rag_aliases")).toBeLessThan(
      fencedCommit.indexOf("'deep_memory_commit_receipts'", fencedCommit.indexOf("insert into public.rag_aliases")),
    );
    expect(fencedCommit).not.toContain("exception when");
    expect(fencedCommit).toContain("raise exception 'invalid_deep_memory_commit_result'");
    expect(fencedCommit.indexOf("invalid_deep_memory_commit_result")).toBeLessThan(
      fencedCommit.indexOf("delete from public.rag_aliases"),
    );
  });
  it("revokes the obsolete worker-callable commit and bounds cleanup to unpublished exact attempts", () => {
    expect(fencedMigration).toContain(
      "commit_document_deep_memory_generation(uuid,text,uuid,text,text,integer,integer,jsonb,integer) from public,anon,authenticated,service_role",
    );
    const start = fencedMigration.indexOf("function public.cleanup_ingestion_deep_memory_staging");
    const cleanup = fencedMigration.slice(start, fencedMigration.indexOf("end $$;", start));
    expect(cleanup).toContain("cannot_cleanup_committed_deep_memory");
    for (const deletion of cleanup.matchAll(/delete from public\.document_[^;]+;/g)) {
      expect(deletion[0]).toContain("producer='local-worker'");
      expect(deletion[0]).toContain("artifact_generation_id=p_artifact_generation");
      expect(deletion[0]).toContain("metadata->>'ingestion_lease_token'=p_fence->>'lease_token'");
    }
  });
});
