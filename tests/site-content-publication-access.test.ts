import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import { readPublicSiteContentPartition } from "../src/lib/site-content/public-site-content";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const migrations = join(root, "supabase", "migrations");

function taskMigration() {
  const file = readdirSync(migrations).find((entry) => entry.endsWith("_add_site_content_release_and_outbox.sql"));
  expect(file).toBeDefined();
  return { file: file!, sql: readFileSync(join(migrations, file!), "utf8") };
}

describe("public site-content publication access", () => {
  it("uses bundled fallback only when the reader RPC is not yet applied and preserves authoritative empty partitions", async () => {
    const missing = {
      rpc: async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }),
    };
    await expect(readPublicSiteContentPartition(missing as never, { domain: "medications" })).resolves.toBeNull();

    const empty = {
      rpc: async () => ({
        data: {
          activeReleaseId: "11111111-1111-4111-8111-111111111111",
          changeEpoch: 7,
          state: "current",
          records: [],
        },
        error: null,
      }),
    };
    await expect(readPublicSiteContentPartition(empty as never, { domain: "medications" })).resolves.toEqual({
      activeReleaseId: "11111111-1111-4111-8111-111111111111",
      changeEpoch: 7,
      state: "current",
      records: [],
    });

    const failed = { rpc: async () => ({ data: null, error: { message: "database unavailable" } }) };
    await expect(readPublicSiteContentPartition(failed as never, { domain: "medications" })).rejects.toThrow(
      "Canonical public site-content read failed.",
    );
    const unrelatedMissing = {
      rpc: async () => ({ data: null, error: { code: "XX000", message: "relation cache does not exist" } }),
    };
    await expect(
      readPublicSiteContentPartition(unrelatedMissing as never, { domain: "medications" }),
    ).rejects.toThrow();
    for (const data of [null, { records: "not-an-array" }, { changeEpoch: 1, state: "bogus", records: [] }]) {
      const malformed = { rpc: async () => ({ data, error: null }) };
      await expect(readPublicSiteContentPartition(malformed as never, { domain: "medications" })).rejects.toThrow(
        /invalid/i,
      );
    }
    for (const state of ["current", "updating", "unavailable"] as const) {
      const valid = {
        rpc: async () => ({
          data: {
            activeReleaseId: state === "unavailable" ? null : "11111111-1111-4111-8111-111111111111",
            changeEpoch: 1,
            state,
            records: [],
          },
          error: null,
        }),
      };
      await expect(readPublicSiteContentPartition(valid as never, { domain: "medications" })).resolves.toMatchObject({
        state,
      });
    }
  });

  it("binds readers, completion, activation, quarantine, and rollback to one exact release authority", () => {
    const { sql } = taskMigration();
    expect(sql).toMatch(/site_content_release_projections[\s\S]*active_release_id/i);
    expect(sql).toMatch(/join public\.site_content_release_projections[\s\S]*active_release_id/i);
    expect(sql).toMatch(/site_content_release_operations[\s\S]*operation\.logical_id\s*=\s*projection\.logical_id/i);
    expect(sql).toMatch(/operation\.operation\s*<>\s*'unchanged'[\s\S]*operation\.status\s*<>\s*'complete'/i);
    expect(sql).toMatch(/p_release_id is null[\s\S]*raise exception/i);
    expect(sql).toMatch(/completed_release_id[\s\S]*candidate/i);
    expect(sql).toMatch(/status in \('pending', 'leased', 'quarantined'\)/i);
    expect(sql).toMatch(/fail_site_content_sync_event[\s\S]*lease_expires_at\s*>\s*now\(\)/i);
    expect(sql).toMatch(/restoredResource,releaseId[\s\S]*previous_release_id/i);
    expect(sql).toMatch(/activationReceiptId[\s\S]*activationReceiptDigest/i);
    expect(sql).not.toMatch(/create table public\.site_content_release_receipts/i);
  });

  it("supports every route domain, enforces database-derived administrator authority, and generates complete types", () => {
    const { sql } = taskMigration();
    expect(sql).toMatch(/domain in \('services', 'forms', 'medications', 'differentials'\)/i);
    expect(sql).toMatch(/auth\.jwt\(\)[\s\S]*administrator/i);
    expect(sql).not.toMatch(/p_administrator_authorized boolean/i);
    expect(sql).not.toMatch(/grant all on public\.site_content/i);
    expect(sql).toMatch(/grant execute[\s\S]*publish_site_content_record[\s\S]*to authenticated/i);
    const types = readFileSync(join(root, "src/lib/supabase/database.types.ts"), "utf8");
    for (const table of [
      "site_content_public_authority",
      "site_content_releases",
      "site_content_publications",
      "site_content_release_projections",
      "site_content_sync_outbox",
      "site_content_release_operations",
    ]) {
      expect(types).toContain(`${table}: {`);
    }
    expect(types).not.toMatch(/p_administrator_authorized/);
  });
  it("allocates a forward-only migration after every existing migration", () => {
    const { file } = taskMigration();
    const timestamps = readdirSync(migrations)
      .filter((entry) => entry !== file)
      .map((entry) => Number(entry.slice(0, 14)))
      .filter(Number.isFinite);
    expect(Number(file.slice(0, 14))).toBeGreaterThan(Math.max(...timestamps));
  });

  it("publishes the public row, epoch, pending exclusion, and outbox atomically behind administrator authority", () => {
    const { sql } = taskMigration();
    expect(sql).toMatch(/create table public\.site_content_publications/i);
    expect(sql).toMatch(/create unique index[\s\S]*logical_id/i);
    expect(sql).toMatch(/create table public\.site_content_sync_outbox/i);
    expect(sql).toMatch(/create table public\.site_content_public_authority/i);
    expect(sql).toMatch(/create or replace function public\.publish_site_content_record/i);
    expect(sql).toMatch(/site_content_admin_authorized\(\)[\s\S]*raise exception/i);
    expect(sql).toMatch(/change_epoch\s*=\s*change_epoch\s*\+\s*1/i);
    expect(sql).toMatch(/insert into public\.site_content_sync_outbox/i);
    expect(sql).toMatch(/delete from public\.rag_response_cache/i);
    expect(sql).toMatch(/revoke all[\s\S]*from public\s*,\s*anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/grant execute[\s\S]*to service_role/i);
    expect(sql).not.toMatch(/grant (?:insert|update|delete)[^;]* to (?:anon|authenticated)/i);
  });

  it("defines fixed-search-path lease fencing, exact pending anti-join, activation, and retained rollback receipts", () => {
    const { sql } = taskMigration();
    for (const name of [
      "claim_site_content_sync_events",
      "begin_site_content_candidate_release",
      "heartbeat_site_content_sync_event",
      "stage_site_content_candidate_projection",
      "stage_site_content_candidate_operation",
      "complete_site_content_sync_event",
      "fail_site_content_sync_event",
      "activate_site_content_release",
      "rollback_site_content_release",
      "adopt_site_content_baseline",
      "verify_site_content_candidate_release",
      "read_site_content_release_activation_context",
    ]) {
      expect(sql).toContain(`function public.${name}`);
    }
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toMatch(/operation in \('changed','unchanged','tombstone'\)/i);
    expect(sql).toMatch(/prior\.embedding_bytes_digest/i);
    expect(sql).toMatch(/embedding_bytes_digest[\s\S]*float4send/i);
    expect(sql).toMatch(/lease_id[\s\S]*generation_id[\s\S]*lease_expires_at/i);
    expect(sql).toMatch(/projection\.release_id\s*=\s*authority\.active_release_id/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/restorationMethod[\s\S]*retained-pointer/i);
    expect(sql).toMatch(/site_content_p05_digest\(p_activation_receipt\)/i);
    expect(sql).toMatch(/site_content_p05_digest\(p_rollback_receipt\)/i);
    expect(sql).toMatch(/recoveryEvidenceId[\s\S]*evidenceId/i);
    expect(sql).toMatch(/stateDigest[\s\S]*dynamic_state_digest/i);
    expect(sql).toMatch(/validUntil[\s\S]*now\(\)/i);
    expect(sql).toMatch(/site_content_validation_binding_valid[\s\S]*extensions\.hmac/i);
    expect(sql).toMatch(/from vault\.decrypted_secrets[\s\S]*site_content_recovery_validation_secret/i);
    expect(sql).toMatch(/provision_site_content_validation_secret[\s\S]*vault\.(?:create|update)_secret/i);
    expect(sql).toMatch(
      /grant execute on function public\.provision_site_content_validation_secret[\s\S]*to service_role/i,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.provision_site_content_validation_secret[\s\S]*to authenticated/i,
    );
    expect(sql).toMatch(/expectedCurrentDigest[\s\S]*current_digest[\s\S]*rotationReason/i);
    expect(sql).toMatch(
      /verificationEvidence[\s\S]*subjectDigest[\s\S]*publicVisibility[\s\S]*governance[\s\S]*mustPass/i,
    );
    expect(sql).not.toMatch(/p_verification#>>'\{flags,/i);
    expect(sql).toMatch(/site_content_validation_binding_consumptions/i);
    expect(sql).toMatch(/site_content_release_gate_artifacts/i);
    expect(sql).toMatch(/site_content_json_digest\(p_plan-'planDigest'\)/i);
    expect(sql).toMatch(/legacy_reconciliation_digest[\s\S]*legacy_dispositions/i);
  });

  it("keeps reader selection independent of actor and legacy owner identity", () => {
    const routePaths = [
      "src/app/api/registry/records/route.ts",
      "src/app/api/registry/records/[slug]/route.ts",
      "src/app/api/medications/route.ts",
      "src/app/api/medications/[slug]/route.ts",
      "src/app/api/differentials/route.ts",
      "src/app/api/differentials/[slug]/route.ts",
      "src/app/api/differentials/presentations/[slug]/route.ts",
    ];
    for (const routePath of routePaths) {
      const source = readFileSync(join(root, routePath), "utf8");
      expect(source, basename(routePath)).not.toMatch(/\.eq\("owner_id",\s*access\.ownerId\)/);
      expect(source, basename(routePath)).not.toMatch(/fetchOwner[A-Za-z]+Rows/);
      expect(source, basename(routePath)).toMatch(/canonical public|publicSiteContent|public.*payload/i);
      expect(source).not.toMatch(/export async function (?:POST|PUT|PATCH|DELETE)/);
    }
  });
});
