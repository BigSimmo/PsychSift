import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260831104000_create_document_admission_events.sql";
const migration = readFileSync(migrationPath, "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const helper = readFileSync("src/lib/trusted-document-admission.ts", "utf8");

function normalized(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function functionDefinition(sql: string, name: string): string {
  const match = sql.match(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, "i"),
  );
  if (!match) throw new Error(`Missing ${name} in SQL fixture.`);
  return normalized(match[0]);
}

function expectInBoth(fragment: string) {
  expect(normalized(migration)).toContain(normalized(fragment));
  expect(normalized(schema)).toContain(normalized(fragment));
}

describe("trusted document admission schema source contract", () => {
  it("mirrors the private principal and append-only event tables", () => {
    expectInBoth("create table if not exists public.trusted_ingestion_backend_principals");
    expectInBoth("create table if not exists public.document_admission_events");
    expectInBoth("capability_sha256 text not null");
    expectInBoth("staging_owner_id uuid not null references auth.users(id) on delete restrict");
    expectInBoth("document_input_digest text not null");
    expectInBoth("request_digest text not null");
    expectInBoth("document_admission_events_admin_replay_uidx");
    expectInBoth("document_admission_events_backend_replay_uidx");
  });

  it("stores only bounded audit digests and authority rather than raw document input", () => {
    const table = normalized(migration).match(
      /create table if not exists public\.document_admission_events \([\s\S]*?\);/,
    )?.[0];
    expect(table).toBeTruthy();
    expect(table).toContain("content_sha256 text not null");
    expect(table).toContain("file_name_sha256 text not null");
    expect(table).toContain("storage_path_sha256 text not null");
    expect(table).toContain("authority jsonb not null");
    expect(table).not.toMatch(/\b(file_name|storage_path|source_path|body|content)\s+text\b/);

    const eventInsert = normalized(migration).match(
      /insert into public\.document_admission_events \([\s\S]*?\) values \(/,
    )?.[0];
    expect(eventInsert).toBeTruthy();
    expect(eventInsert).not.toMatch(/\b(file_name|storage_path|source_path|body)\b/);
  });

  it("makes events append-only and denies every API role direct table access", () => {
    expectInBoth("before update on public.document_admission_events");
    expectInBoth("before delete on public.document_admission_events");
    expectInBoth("raise exception 'document_admission_events_append_only'");
    expectInBoth("revoke all on table public.document_admission_events from public, anon, authenticated, service_role");
    expectInBoth(
      "revoke all on table public.trusted_ingestion_backend_principals from public, anon, authenticated, service_role",
    );
  });

  it("derives administrator identity and enforces role, AAL2, and recent qualifying AMR", () => {
    const admin = functionDefinition(migration, "admit_administrator_document");
    expect(admin).toContain("v_uid uuid := auth.uid()");
    expect(admin).toContain("v_jwt jsonb := auth.jwt()");
    expect(admin).toContain("v_jwt->>'role' is distinct from 'authenticated'");
    expect(admin).toContain("v_jwt->>'sub' is distinct from v_uid::text");
    expect(admin).toContain("v_jwt#>>'{app_metadata,site_role}' is distinct from 'administrator'");
    expect(admin).toContain("v_jwt->>'aal' is distinct from 'aal2'");
    expect(admin).toContain("('password', 'otp', 'totp', 'webauthn')");
    expect(admin).toContain("interval '900 seconds'");
    expect(admin).toContain("administrator_recent_authentication_required");
    expect(admin).not.toContain("p_administrator_id");
    expect(admin.indexOf("administrator_recent_authentication_required")).toBeLessThan(
      admin.indexOf("public.trusted_document_admission_core"),
    );
  });

  it("requires a configured enabled backend principal, fixed owner, and hashed capability", () => {
    const backend = functionDefinition(migration, "admit_backend_document");
    expect(backend).toContain("auth.jwt()->>'role' is distinct from 'service_role'");
    expect(backend).toContain("p_capability !~ '^[0-9a-f]{64}$'");
    expect(backend).toContain("extensions.digest(");
    expect(backend).toContain("from public.trusted_ingestion_backend_principals principal");
    expect(backend).toContain("and principal.enabled");
    expect(backend).toContain("v_principal.capability_sha256 is distinct from v_capability_sha256");
    expect(backend).toContain("p_admission->>'staging_owner_id' is distinct from v_principal.staging_owner_id::text");
    expect(backend).not.toMatch(/\braise\s+(?:log|notice|warning)\b/);
  });

  it("validates the exact authority template and document binding before writes", () => {
    const core = functionDefinition(migration, "trusted_document_admission_core");
    for (const key of [
      "version",
      "sourcerole",
      "authoritybasis",
      "licencepolicy",
      "rightsevidenceref",
      "publisher",
      "jurisdiction",
      "publicationdate",
      "effectivedate",
      "reviewdate",
      "expirydate",
      "currentness",
      "supersedesdocumentid",
      "purpose",
      "supportedfeatures",
      "providerprocessing",
    ]) {
      expect(core).toContain(`'${key}'`);
    }
    expect(core).not.toContain("'reference_link'");
    expect(core).toContain("('review_required', 'public_index_permitted')");
    expect(core).toContain("('current', 'unknown')");
    expect(core).toContain("p_document->'metadata'->>'corpus_scope' is distinct from 'uploaded_local'");
    expect(core).toContain("p_document->'metadata'->>'content_mode' is distinct from 'indexed_content'");
    expect(core).toContain("p_document->'metadata'->'authority' is distinct from v_authority");
    expect(core).toContain("octet_length((p_document->'metadata')::text) > 65536");
    expect(core).toContain("invalid_trusted_document_max_attempts");
    expect(core).toContain("v_supersedes_document_id = v_document_id");

    const firstWrite = core.indexOf("insert into public.documents");
    expect(firstWrite).toBeGreaterThan(core.indexOf("invalid_trusted_document_authority_binding"));
    expect(firstWrite).toBeGreaterThan(core.indexOf("invalid_trusted_document_supersedes_id"));
  });

  it("shares attempt and encoded-metadata bounds with the TypeScript preflight", () => {
    const core = functionDefinition(migration, "trusted_document_admission_core");
    const normalizedHelper = normalized(helper);
    expect(core).toContain("(p_document->>'max_attempts')::numeric not between 1 and 100");
    expect(core).toContain("octet_length((p_document->'metadata')::text) > 65536");
    expect(normalizedHelper).toContain("document.max_attempts < 1 || document.max_attempts > 100");
    expect(normalizedHelper).toContain('buffer.bytelength(canonicaljson(document.metadata), "utf8") > 65_536');
    expect(normalizedHelper).toContain("sql also enforces its authoritative jsonb text");
  });

  it("filters direct-RPC metadata to naming fields and establishes governance defaults in SQL", () => {
    const core = functionDefinition(migration, "trusted_document_admission_core");
    expect(functionDefinition(schema, "trusted_document_admission_core")).toBe(core);
    expect(core).not.toContain("v_metadata := p_document->'metadata' ||");
    expect(core).toContain("select coalesce(pg_catalog.jsonb_object_agg(item.key, item.value), '{}'::jsonb)");
    expect(core).toContain("into v_metadata");
    expect(core).toContain("from pg_catalog.jsonb_each(p_document->'metadata') as item(key, value)");

    const whitelist = core.match(/where item\.key = any\(array\[(.*?)\]\)/)?.[1];
    expect(whitelist).toBeTruthy();
    const retainedKeys = [...(whitelist ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]).toSorted();
    expect(retainedKeys).toEqual(
      [
        "original_file_name",
        "original_title",
        "smart_title_base",
        "smart_title_group_key",
        "smart_title_duplicate_index",
        "smart_title_duplicate_reason",
        "version",
        "max_upload_mb",
        "queue_batch_size",
      ].toSorted(),
    );
    for (const forgedKey of [
      "clinical_validation_status",
      "clinical_validation_evidence",
      "extraction_quality",
      "publisher_code",
      "indexed_at",
      "governance_disposition",
      "governance_updated_at",
      "governance_updated_by",
      "source_catalogue_key",
      "source_policy_version",
    ]) {
      expect(retainedKeys).not.toContain(forgedKey);
    }

    for (const retainedServerField of [
      "'source_title', p_document->>'title'",
      "'uploaded_by', v_staging_owner_id",
      "'source_path', case when p_document ? 'source_path' then p_document->'source_path' else 'null'::jsonb end",
      "'import_batch_id', v_import_batch_id",
      "'admission_max_attempts', v_max_attempts",
      "'content_hash', v_content_hex",
      "'authority', v_authority",
      "'publisher', v_authority->>'publisher'",
      "'publication_date', v_authority->'publicationdate'",
    ]) {
      expect(core).toContain(retainedServerField);
    }
    expect(core).toContain("'clinical_validation_status', 'unverified'");
    expect(core).toContain("'extraction_quality', 'unknown'");
    expect(core).toContain("'publisher_code', null");
    expect(core).toContain("'indexed_at', null");
    expect(core).toContain("pg_catalog.convert_to(p_document::text, 'utf8')");
  });

  it("serializes replay and content admission and returns stable exact-replay identities", () => {
    const core = functionDefinition(migration, "trusted_document_admission_core");
    const replayLock = core.indexOf("trusted-document-admission:replay:");
    const replayLookup = core.indexOf("from public.document_admission_events event");
    const replayConflict = core.indexOf("admission_replay_conflict");
    const replayOnly = core.indexOf("if p_replay_only then");
    const contentLock = core.indexOf("trusted-document-admission:content:");
    const duplicate = core.indexOf("duplicate_content");
    const documentInsert = core.indexOf("insert into public.documents");
    const jobInsert = core.indexOf("insert into public.ingestion_jobs");
    const eventInsert = core.indexOf("insert into public.document_admission_events");

    expect(replayLock).toBeGreaterThan(0);
    expect(replayLookup).toBeGreaterThan(replayLock);
    expect(replayConflict).toBeGreaterThan(replayLookup);
    expect(replayOnly).toBeGreaterThan(replayConflict);
    expect(contentLock).toBeGreaterThan(replayOnly);
    expect(duplicate).toBeGreaterThan(contentLock);
    expect(documentInsert).toBeGreaterThan(duplicate);
    expect(jobInsert).toBeGreaterThan(documentInsert);
    expect(eventInsert).toBeGreaterThan(jobInsert);
    expect(core).toContain("'outcome', 'not_found'");
    expect(core).toContain("'outcome', 'replayed'");
    expect(core).toContain("'outcome', 'created'");
    expect(core).toContain("'admission_event_id', v_existing_event.id");
    expect(core).toContain("'admission_event_id', v_event_id");
    expect(core.indexOf("'uploaded_at', v_now")).toBeGreaterThan(replayOnly);
    expect(core).toContain("get stacked diagnostics v_constraint_name = constraint_name");
    expect(core).toContain("v_constraint_name = 'documents_owner_content_hash_unique_idx'");
    expect(core).toContain("v_constraint_name = 'documents_pkey'");
  });

  it("keeps the common core private and retires the v1 RPC to denial", () => {
    expectInBoth(
      "revoke all on function public.trusted_document_admission_core(jsonb, jsonb, boolean, text, uuid, text) from public, anon, authenticated, service_role",
    );
    expectInBoth(
      "grant execute on function public.admit_administrator_document(jsonb, jsonb, boolean) to authenticated",
    );
    expectInBoth(
      "grant execute on function public.admit_backend_document(jsonb, jsonb, text, text, boolean) to service_role",
    );
    const legacy = functionDefinition(migration, "create_uploaded_document_with_ingestion_job");
    expect(legacy).toContain("trusted_document_admission_required");
    expectInBoth(
      "revoke all on function public.create_uploaded_document_with_ingestion_job(jsonb, integer) from public, anon, authenticated, service_role",
    );
  });
});
