import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runSqlExpectation } from "../scripts/check-site-content-control-plane.mjs";

const authorityMigration = "supabase/migrations/20260830120000_harden_site_content_initial_adoption.sql";
const transitionMigration = "supabase/migrations/20260830121000_bind_site_content_release_transitions.sql";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("P06 site-content control-plane correction", () => {
  it("moves reconciliation review to authenticated database-derived authority", () => {
    const sql = read(authorityMigration);

    expect(sql).toContain("lock table public.site_content_reconciliation_plans in access exclusive mode");
    expect(sql).toContain("site_content_phase_correction_requires_empty_reconciliation_plans");
    expect(sql).toContain("administrator_authorized_at timestamptz not null");
    expect(sql).toContain("administrator_authorization_version text not null");
    expect(sql).toContain("drop function public.record_site_content_reconciliation_plan(jsonb, uuid)");
    expect(sql).toContain("create function public.record_site_content_reconciliation_plan(p_plan jsonb)");
    expect(sql).toContain("v_actor := auth.uid()");
    expect(sql).toContain("from auth.users u");
    expect(sql).toContain("for share");
    expect(sql).toContain("raw_app_meta_data->>'site_role'");
    expect(sql).toContain("perform pg_catalog.pg_advisory_xact_lock(93206431)");
    expect(sql).toContain("v_counts - array['adopt','retire','identicalDuplicate','total']");
    expect(sql).toContain("jsonb_typeof(p_plan->'expectedRecordCount') is distinct from 'number'");
    expect(sql).toContain("jsonb_typeof(v_item->'disposition') is distinct from 'string'");
    expect(sql).toContain(
      "v_item->>'sourceRowId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'",
    );
    expect(sql).toContain(
      "grant execute on function public.record_site_content_reconciliation_plan(jsonb) to authenticated",
    );
    expect(sql).toContain(
      "revoke all on function public.record_site_content_reconciliation_plan(jsonb) from public, anon, authenticated, service_role",
    );
    expect(sql).not.toContain("p_reviewed_by");
  });

  it("rejects null or out-of-range claim bounds before mutation", () => {
    const sql = read(authorityMigration);
    const claim = sql.slice(sql.indexOf("create or replace function public.claim_site_content_sync_events("));
    const guard = claim.indexOf("site_content_claim_bounds_invalid");

    expect(claim).toContain("p_worker_id is null");
    expect(claim).toContain("p_limit is null");
    expect(claim).toContain("p_lease_seconds is null");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(claim.indexOf("update public.site_content_sync_events"));
  });

  it("binds state transitions to an atomic durable receipt pointer", () => {
    const sql = read(transitionMigration);

    expect(sql).toContain("active_transition_receipt_id text");
    expect(sql).toContain("guard_site_content_sync_state_transition_pointer");
    expect(sql).toContain("site_content_transition_backfill_unprovable");
    expect(sql).toContain("site_content_initial_adoption_closure_valid");
    expect(sql).toContain("v_active.release_digest is distinct from v_state.active_release_digest");
    expect(sql).toContain("(select count(*) from public.site_content_releases where state = 'active') <> 1");
    expect(sql).toContain("p_receipt->>'recoveryReadinessDigest' is distinct from p_recovery_digest");
    expect(sql).toContain("p_receipt->>'projectRef' !~ '^[a-z0-9][a-z0-9_-]{2,63}$'");
    expect(sql).toContain("source.state = 'rolled_back'");
    expect(sql).toContain("source.target_change_epoch = p_served_change_epoch");
    expect(sql).toContain("active_transition_receipt_id = v_receipt_id");
    expect(sql).toContain("served_change_epoch = v_state.change_epoch");
    expect(sql).toContain("'changeEpoch', s.change_epoch::text");
    expect(sql).not.toContain("'changeEpoch', rel.target_change_epoch::text");
    expect(sql).toContain("h.head_change_epoch > s.served_change_epoch");

    const activation = sql.slice(sql.indexOf("create or replace function public.activate_site_content_release("));
    const rollback = sql.slice(sql.indexOf("create or replace function public.rollback_site_content_release("));
    expect(activation.indexOf("site_content_receipt_bytes_valid(")).toBeLessThan(
      activation.indexOf("insert into public.site_content_release_receipts"),
    );
    expect(rollback.indexOf("site_content_receipt_bytes_valid(")).toBeLessThan(
      rollback.indexOf("insert into public.site_content_release_receipts"),
    );
  });

  it("keeps the accepted migrations immutable", () => {
    expect(read("supabase/migrations/20260824122000_add_site_content_release_and_outbox.sql")).not.toContain(
      "active_transition_receipt_id",
    );
    expect(read("supabase/migrations/20260824123000_add_site_content_health_probe.sql")).not.toContain(
      "active_transition_receipt_id",
    );
  });

  it("provides a provider-free offline executable SQL runner", () => {
    const runner = read("scripts/check-site-content-control-plane.mjs");
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    expect(runner).toContain("--pull=never");
    expect(runner).toContain("supabase/postgres:17.6.1.127@sha256:");
    expect(runner).toContain("site-content-invocation-state-machine.sql");
    expect(runner).toContain("site-content-reconciliation-authority.sql");
    expect(runner).toContain("site-content-transition-backfill-seed.sql");
    expect(runner).toContain("site_content_transition_ambiguous");
    expect(runner).toContain("site_content_transition_guard_invalid");
    expect(runner).toContain("site_content_transition_source_state_invalid");
    expect(runner).toContain("site_content_rollback_head_reject");
    expect(runner).toContain("site_content_null_activation_receipt");
    expect(runner).toContain("site_content_null_rollback_receipt");
    expect(runner).toContain("site_content_extra_active_release");
    expect(runner).toMatch(/create database/i);
    expect(runner).toMatch(/template/i);
    expect(runner).not.toMatch(/OPENAI|ANTHROPIC|NEXT_PUBLIC_SUPABASE_URL/);
    expect(packageJson.scripts["check:site-content-control-plane"]).toBe(
      "node scripts/check-site-content-control-plane.mjs",
    );
  });

  it("keeps reconciliation validation pure and the planner CLI free of review authority", () => {
    const validator = read("src/lib/site-content/site-content-reconciliation.ts");
    const cli = read("scripts/sync-site-content-corpus.ts");

    expect(validator).not.toMatch(/process\.env|supabase|next\/|node:fs|provider/i);
    expect(cli).toContain("assertSiteContentReconciliationInput");
    expect(cli).not.toMatch(/record_site_content_reconciliation_plan|administrator.?token|reviewedBy|actorId/i);
  });

  it("fails an expected refusal when the SQL succeeds", () => {
    expect(() => runSqlExpectation(() => "ok", "site_content_transition_backfill_unprovable")).toThrow(
      "Expected site_content_transition_backfill_unprovable, but SQL succeeded.",
    );
  });

  it("accepts an expected refusal only when the failure carries the marker", () => {
    const refusal = Object.assign(new Error("psql failed"), {
      stderr: "ERROR:  site_content_transition_backfill_unprovable",
    });
    expect(
      runSqlExpectation(() => {
        throw refusal;
      }, "site_content_transition_backfill_unprovable"),
    ).toContain("site_content_transition_backfill_unprovable");
    expect(() =>
      runSqlExpectation(() => {
        throw new Error("psql failed: unrelated");
      }, "site_content_transition_backfill_unprovable"),
    ).toThrow("SQL failed without expected marker");
    expect(runSqlExpectation(() => "ok", undefined)).toBe("ok");
  });
});
