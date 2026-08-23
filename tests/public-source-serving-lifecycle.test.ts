import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql",
  import.meta.url,
);

function migrationSource() {
  try {
    return readFileSync(migrationPath, "utf8").toLowerCase().replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

function functionBody(sql: string, name: string) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) return "";
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end < 0 ? undefined : end);
}

describe("public-source serving lifecycle authority", () => {
  it("makes exact active-version identity the authority for public retrieval and cache eligibility", () => {
    const sql = migrationSource();
    const publicationGuard = functionBody(sql, "require_active_public_source_version_for_publication");
    const eligibility = functionBody(sql, "public_source_document_is_serving_eligible");
    const ineligible = functionBody(sql, "make_public_source_version_ineligible");
    const activationEvent = functionBody(sql, "record_public_source_activation_event");
    const transition = functionBody(sql, "transition_public_source_version");
    const tombstone = functionBody(sql, "tombstone_public_source_version_for_review");

    expect(publicationGuard).toContain("new.owner_id is null");
    expect(publicationGuard).toContain("version.lifecycle = 'active'");
    expect(publicationGuard).toContain("version.staging_document_id = new.id");
    expect(sql).toContain("public_source_documents_require_active_version");
    expect(eligibility).toContain("metadata->>'source_catalogue_key'");
    expect(eligibility).toContain("version.lifecycle = 'active'");
    expect(eligibility).toContain("version.staging_document_id = p_document_id");
    for (const retrievalOwner of [
      "match_document_chunks_text_v2",
      "match_document_chunks_hybrid_v2",
      "match_document_chunks_v2",
      "get_related_document_metadata_v2",
      "match_document_lookup_chunks_text_v2",
      "match_documents_for_query_v2",
      "match_document_table_facts_text_v2",
      "match_document_embedding_fields_hybrid_v2",
      "match_document_index_units_hybrid_v2",
      "match_document_memory_cards_hybrid_v3",
    ]) {
      expect(sql).toContain(`retrieval-owner: ${retrievalOwner}`);
    }
    expect(sql).toContain("public_source_documents_require_active_version");

    for (const artifact of [
      "document_labels",
      "document_summaries",
      "document_sections",
      "document_memory_cards",
      "document_table_facts",
      "document_embedding_fields",
      "document_index_quality",
      "document_index_units",
    ]) {
      expect(ineligible).toContain(`update public.${artifact}`);
      expect(ineligible).toContain("staging_owner_id");
    }
    expect(ineligible).toContain("update public.documents");
    expect(ineligible).toContain("set owner_id = v_version.staging_owner_id");
    expect(ineligible).toContain("app.public_source_lifecycle_exit");
    expect(functionBody(sql, "guard_document_publication_transition")).toContain("app.public_source_lifecycle_exit");
    expect(ineligible).toContain("delete from public.rag_response_cache");
    expect(ineligible).toContain("where owner_id is null");
    expect(activationEvent).toContain("make_public_source_version_ineligible");
    expect(activationEvent).toContain("v_decision in ('quarantine', 'retire')");
    expect(transition).toContain("make_public_source_version_ineligible");
    expect(tombstone).toContain("make_public_source_version_ineligible");

    const cacheOwner = readFileSync(new URL("../src/lib/rag/rag-cache.ts", import.meta.url), "utf8");
    expect(sql).toContain("create table public.public_source_serving_authority");
    expect(sql).toContain("lifecycle_epoch bigint");
    expect(sql).toContain("create or replace function public.public_source_serving_authority_stamp(");
    expect(cacheOwner).toContain('.rpc("public_source_serving_authority_stamp")');
    expect(cacheOwner).toContain("publicSourceAuthorityStamp");
    expect(cacheOwner).toContain("if (!publicSourceAuthorityStamp) return publicSourceAuthorityUnavailable");
    expect(cacheOwner).toContain("if (!cacheAuthorityAvailable(indexingVersion)) return null");
    expect(cacheOwner).toContain("if (!indexingVersion) return");
    const stampOwner = cacheOwner.slice(
      cacheOwner.indexOf("export async function cacheIndexingVersion"),
      cacheOwner.indexOf("export async function getSharedCachedSearch"),
    );
    expect(stampOwner.indexOf('.rpc("public_source_serving_authority_stamp")')).toBeLessThan(
      stampOwner.indexOf("if (cached) return"),
    );
  });

  it("atomically swaps exact old and new versions with immutable lineage and no uniqueness dead end", () => {
    const sql = migrationSource();
    const activation = functionBody(sql, "activate_public_source_version");
    const oldExit = activation.indexOf("set lifecycle = 'superseded'");
    const newEntry = activation.indexOf("set lifecycle = 'active'");

    expect(sql).toContain(
      "check (lifecycle in ('discovered', 'shadow', 'approved', 'active', 'superseded', 'quarantined', 'tombstoned'))",
    );
    expect(activation).toContain("pg_advisory_xact_lock");
    expect(activation).toContain("for update");
    expect(activation).toContain("p_activation->>'expectedoldversionid'");
    expect(activation).toContain("p_activation->>'newversionid'");
    expect(activation).toContain("public source activation old-version identity mismatch");
    expect(activation).toContain("public source activation new-version identity mismatch");
    expect(oldExit).toBeGreaterThan(0);
    expect(newEntry).toBeGreaterThan(oldExit);
    expect(activation).toContain("v_new_version.supersedes_version_id is distinct from v_old_version.id");
    expect(activation).toContain("owner_id = null");
    expect(activation).toContain("lifecycle = 'active'");
    expect(sql).not.toContain("drop index if exists public.public_source_versions_one_active_per_source_idx");
  });

  it("reproves the complete staged acquisition and P02 approval identity at activation", () => {
    const sql = migrationSource();
    const identity = functionBody(sql, "public_source_acquisition_identity_digest");
    const activation = functionBody(sql, "activate_public_source_version");

    for (const field of [
      "source_policy_digest",
      "activation_event_id",
      "exact_canonical_url",
      "exact_version_url",
      "exact_version",
      "content_hash",
      "staged_content_hash",
      "licence_evidence_digest",
      "source_content_type",
      "source_content_byte_length",
      "content_identity_verdict",
      "content_identity_hash",
      "content_identity_verdict_version",
      "canonical_storage_path",
    ]) {
      expect(identity).toContain(field);
    }
    expect(activation).toContain("public_source_acquisition_identity_digest");
    expect(activation).toContain("expectedacquisitionidentitydigest");
    expect(activation).toContain("document_publication_state_digest");
    expect(activation).toContain("document_publication_approvals");
    expect(activation).toContain("reviewed_index_generation_id");
    expect(activation).toContain("reviewed_state_digest");
    expect(activation).toContain("manifest_digest");
    expect(activation).toContain("source_catalogue_key");
    expect(activation).toContain("source_policy_version");
    expect(activation).toContain("public source acquisition identity changed after review");
  });

  it("records unchanged evidence only through a locked exact-active service-role RPC", () => {
    const sql = migrationSource();
    const unchanged = functionBody(sql, "record_unchanged_public_source_check");
    const cli = readFileSync(new URL("../scripts/check-public-source-changes.ts", import.meta.url), "utf8");

    expect(unchanged).toContain("pg_advisory_xact_lock");
    expect(unchanged).toContain("for update");
    expect(unchanged).toMatch(/lifecycle (?:=|<>) 'active'/);
    expect(unchanged).toContain("expectedversionid");
    expect(unchanged).toContain("expectedcataloguekey");
    expect(unchanged).toContain("expectedexactversionurl");
    expect(unchanged).toContain("expectedexactversion");
    expect(unchanged).toContain("expectedcontenthash");
    expect(unchanged).toContain("public source unchanged identity mismatch");
    expect(cli).toContain('.rpc("record_unchanged_public_source_check"');
    expect(cli).not.toContain('.from("audit_logs").insert');
  });

  it("assigns monotonic per-source activation order under lock and never uses transaction time as latest authority", () => {
    const sql = migrationSource();
    const record = functionBody(sql, "record_public_source_activation_event");
    const fetchManifest = functionBody(sql, "create_public_source_fetch_manifest");
    const stage = functionBody(sql, "stage_public_source_version");

    expect(sql).toContain("add column source_sequence bigint");
    expect(sql).toContain("public_source_activation_events_source_sequence_key");
    expect(record).toContain("pg_advisory_xact_lock");
    expect(record).toContain("coalesce(max(source_sequence), 0) + 1");
    expect(record).toContain("source_sequence");
    for (const latestBody of [record, fetchManifest, stage]) {
      expect(latestBody).toContain("order by source_sequence desc");
      expect(latestBody).not.toContain("order by created_at desc");
      expect(latestBody).not.toContain("order by id desc");
    }
  });

  it("keeps every new definer fixed-search-path and service-role-only", () => {
    const sql = migrationSource();
    for (const name of [
      "make_public_source_version_ineligible",
      "public_source_acquisition_identity_digest",
      "activate_public_source_version",
      "record_unchanged_public_source_check",
      "public_source_serving_authority_stamp",
    ]) {
      const body = functionBody(sql, name);
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
      expect(sql).toContain(`revoke all on function public.${name}`);
    }
    expect(sql).not.toMatch(/grant execute on function public\.[^(]+\([^;]+\) to (?:public|anon|authenticated)/);
  });
});
