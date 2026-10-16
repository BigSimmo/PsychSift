import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260713030000_producer_scoped_deep_memory.sql", import.meta.url),
  "utf8",
)
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("producer-scoped deep-memory transaction SQL", () => {
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

describe("fenced deep-memory commit legacy cleanup", () => {
  const fenced = readFileSync(
    new URL("../supabase/migrations/20261015185000_fenced_ingestion_reset_and_deep_memory.sql", import.meta.url),
    "utf8",
  )
    .replace(/\s+/g, " ")
    .toLowerCase();
  const supersede = fenced.slice(
    fenced.indexOf("-- 3. supersede earlier local-worker deep memory"),
    fenced.indexOf("-- 4a. anchor repair"),
  );
  const legacyBranch =
    "or ((index_generation_id is null or index_generation_id = v_committed) and artifact_generation_id is null and (producer = 'local-worker' or producer is null) and (metadata->>'generated_by' = 'local-worker' or (nullif(metadata->>'generated_by', '') is null and metadata->>'rag_indexing_version' in ('rag-deep-memory-v1', 'rag-deep-memory-v2'))))";

  it("removes legacy rows that health repair stamped with the committed generation", () => {
    for (const table of ["document_memory_cards", "document_index_units", "document_sections"]) {
      const start = supersede.indexOf(`delete from public.${table} `);
      expect(start, `${table} cleanup exists`).toBeGreaterThan(-1);
      expect(supersede.slice(start, start + 900), `${table} legacy branch`).toContain(legacyBranch);
    }
  });

  it("never infers deep-memory ownership from missing markers alone", () => {
    expect(supersede).not.toContain("coalesce(nullif(metadata->>'generated_by', ''), 'local-worker')");
  });
});
