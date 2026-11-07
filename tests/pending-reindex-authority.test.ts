import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PENDING_REINDEX_AUTHORITY_KEYS, effectiveReindexAuthorityMetadata } from "../worker/pending-reindex-authority";

const root = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20261106184724_defer_readmission_ranking_authority.sql");

function functionBody(sql: string, header: string) {
  const start = sql.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("\nend $$;", start);
  return sql.slice(start, end + "\nend $$;".length);
}

describe("deferred readmission ranking authority migration", () => {
  it("keeps provider facts pending-aware without changing leases, permissions, completions or readmission", () => {
    const name = "20261107001000_pending_readmission_provider_authority.sql";
    const forward = read(`supabase/migrations/${name}`);
    expect(forward).toContain("public.read_ingestion_generation_inventory(jsonb,uuid)");
    expect(forward).toContain("pending_reindex_authority_valid(pa_metadata)");
    expect(forward).toContain("coalesce(pa_metadata->prior.key,'null'::jsonb) is distinct from prior.value");
    expect(forward).toContain("pa_metadata:=pa_metadata||(pa_metadata#>'{pending_reindex_authority,values}')");
    expect(forward).toContain("pending_provider_authority_preimage");
    expect(forward).not.toMatch(/\b(?:grant|revoke|create function|update public|insert into)\b/i);
    expect(read("supabase/schema.sql")).toContain(`-- Source migration: ${name}\n${forward}`);
  });
  it("changes the authority digest only by reading pending values for the three flat keys it already bound", () => {
    const header = "create or replace function public.lock_ingestion_document_authority(";
    const previous = functionBody(
      read("supabase/migrations/20261013075944_administrator_txt_fenced_runtime_cutover.sql"),
      header,
    );
    const current = functionBody(migration, header);
    const pendingBlock = current.slice(
      current.indexOf("    -- A readmission's flat ranking fields wait"),
      current.indexOf(
        "    v_digest := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(\n      'owner'",
      ),
    );
    expect(pendingBlock).toContain("v_effective := v_metadata;");
    const reverted = current
      .replace(pendingBlock, "")
      .replace("v_metadata jsonb; v_effective jsonb;", "v_metadata jsonb;")
      .replaceAll("v_effective->'licence_policy'", "v_metadata->'licence_policy'")
      .replaceAll("v_effective->'source_role'", "v_metadata->'source_role'")
      .replaceAll("v_effective->'rights_evidence_ref'", "v_metadata->'rights_evidence_ref'");
    // Same key set and expressions otherwise: digests without a pending block are unchanged.
    expect(reverted).toBe(previous);
    expect(current.match(/v_effective->/g)).toHaveLength(3);
  });

  it("stores readmission ranking fields as pending with the prior live snapshot instead of writing them live", () => {
    const body = functionBody(
      migration,
      "create or replace function public.readmit_administrator_document_for_reindex(",
    );
    expect(body).not.toContain("next_metadata:=next_metadata||jsonb_build_object(pair.metadata_key");
    expect(body).toContain("'pending_reindex_authority',jsonb_build_object('version','pending-reindex-authority-v1'");
    expect(body).toContain("coalesce(d.metadata->pair.metadata_key,'null'::jsonb)");
    for (const key of PENDING_REINDEX_AUTHORITY_KEYS) expect(body).toContain(`('${key}',`);
    // The authority object and provider permission stay live so the attempt can claim.
    expect(body).toContain("'authority',p_authority,");
    expect(body).toContain("'provider_processing','permitted'");
  });

  it("patches every PDF terminal after completion and is mirrored byte-for-byte at the end of schema.sql", () => {
    for (const signature of [
      "public.complete_managed_full_pdf(jsonb,uuid,text,boolean)",
      "public.complete_managed_general_pdf(jsonb,uuid,jsonb,boolean)",
      "ingestion_generation_evidence.complete_admin_pdf(jsonb,uuid,jsonb,boolean)",
    ])
      expect(migration).toContain(`'${signature}'`);
    const schema = read("supabase/schema.sql");
    const mirrored = `\n\n-- Source migration: 20261106184724_defer_readmission_ranking_authority.sql\n${migration}`;
    const at = schema.indexOf(mirrored);
    expect(at).toBeGreaterThan(-1);
    // Later migrations may follow, each as its own mirrored section.
    const rest = schema.slice(at + mirrored.length);
    expect(rest === "" || rest.startsWith("\n-- Source migration: ")).toBe(true);
  });
});

describe("pending-aware supplier metadata", () => {
  const values = Object.fromEntries(PENDING_REINDEX_AUTHORITY_KEYS.map((key) => [key, null]));
  const base = { admission_event_id: "event", publisher: "Old" };

  it("returns metadata unchanged when there is no pending block", () => {
    expect(effectiveReindexAuthorityMetadata(base)).toBe(base);
  });

  it("overlays pending values and refuses foreign or malformed blocks", () => {
    const pending = {
      version: "pending-reindex-authority-v1",
      admissionEventId: "event",
      values: { ...values, publisher: "Declared" },
      prior: values,
    };
    expect(effectiveReindexAuthorityMetadata({ ...base, pending_reindex_authority: pending })?.publisher).toBe(
      "Declared",
    );
    for (const bad of [
      { ...pending, admissionEventId: "other" },
      { ...pending, version: "v0" },
      { ...pending, values: { publisher: "Declared" } },
      { ...pending, extra: true },
      null,
    ])
      expect(effectiveReindexAuthorityMetadata({ ...base, pending_reindex_authority: bad })).toBeNull();
  });
});
