import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("site-content production authority contract", () => {
  it("uses route to authenticated RPC to migration authority without a parallel transaction implementation", () => {
    expect(existsSync(resolve(root, "src/lib/site-content/site-content-transaction-reference.ts"))).toBe(false);
    const route = readFileSync(resolve(root, "src/app/api/admin/site-content/publish/route.ts"), "utf8");
    expect(route).toMatch(/createSupabaseBearerServerClient[\s\S]*read_site_content_release_gate_artifacts/i);
    expect(route).toMatch(/verifySiteContentReleaseGateArtifacts[\s\S]*verify_site_content_candidate_release/i);
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql"),
      "utf8",
    );
    expect(sql).toMatch(/create table public\.site_content_release_gate_artifacts/i);
    expect(sql).toMatch(/record_site_content_release_gate_artifact[\s\S]*to service_role/i);
    expect(sql).toMatch(/read_site_content_release_gate_artifacts[\s\S]*administrator required/i);
    expect(sql).toMatch(/from vault\.decrypted_secrets/i);
  });

  it("transactionally consumes one binding identity and permits retry only with a new binding", () => {
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql"),
      "utf8",
    );
    expect(sql).toMatch(/create table public\.site_content_validation_binding_consumptions/i);
    expect(sql).toMatch(
      /site_content_consume_validation_binding[\s\S]*insert into public\.site_content_validation_binding_consumptions/i,
    );
    expect(sql).toMatch(/on conflict\s*\(binding_id\)\s*do nothing[\s\S]*row_count/i);
    expect(sql).toMatch(
      /site_content_consume_validation_binding[\s\S]*'adopt'[\s\S]*'begin'[\s\S]*'verify'[\s\S]*'activate'[\s\S]*'rollback'/i,
    );
  });
});
