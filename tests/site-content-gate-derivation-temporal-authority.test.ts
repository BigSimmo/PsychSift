import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseSiteContentGateDerivationClock,
  SITE_CONTENT_GATE_RECEIPT_MAX_AGE_MS,
} from "../src/lib/site-content/site-content-release-evidence";

const root = resolve(import.meta.dirname, "..");

describe("site-content gate derivation temporal authority", () => {
  it("shares one exact database clock and five-minute boundary with TypeScript", () => {
    expect(SITE_CONTENT_GATE_RECEIPT_MAX_AGE_MS).toBe(5 * 60 * 1000);
    expect(parseSiteContentGateDerivationClock({ verificationNow: "2026-08-24T12:00:00.000Z" })).toEqual(
      new Date("2026-08-24T12:00:00.000Z"),
    );
    for (const value of [null, {}, { verificationNow: "2026-08-24 12:00:00Z" }, { verificationNow: null }]) {
      expect(() => parseSiteContentGateDerivationClock(value)).toThrow(/database.*clock/i);
    }

    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql"),
      "utf8",
    );
    expect(sql).toMatch(
      /site_content_gate_owner_receipt_valid\([^)]*p_verification_now timestamptz[\s\S]*v_observed_at<p_verification_now-interval '5 minutes'[\s\S]*v_observed_at>p_verification_now/i,
    );
    expect(sql).not.toMatch(/v_observed_at>p_verification_now\+interval/i);
  });

  it("validates complete chronology and exact existing rows before any immutable insert", () => {
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260824130000_add_site_content_release_and_outbox.sql"),
      "utf8",
    );
    const derive =
      sql.match(
        /create or replace function public\.derive_site_content_release_gate_artifacts[\s\S]*?\nend \$\$;/i,
      )?.[0] ?? "";
    const invalidIndex = derive.indexOf("fixed gate-owner output invalid");
    const chronologyIndex = derive.indexOf("gate-owner chronology invalid");
    const existingRevalidationIndex = derive.indexOf("existing immutable gate artifact set invalid");
    const insertIndex = derive.indexOf("insert into public.site_content_release_gate_artifacts");
    expect(invalidIndex).toBeGreaterThan(0);
    expect(chronologyIndex).toBeGreaterThan(invalidIndex);
    expect(existingRevalidationIndex).toBeGreaterThan(chronologyIndex);
    expect(insertIndex).toBeGreaterThan(existingRevalidationIndex);
    expect(derive.slice(0, insertIndex)).not.toMatch(/insert into public\.site_content_release_gate_artifacts/i);
    expect(derive).not.toMatch(/delete from public\.site_content_release_gate_artifacts/i);
    expect(derive).toMatch(/governance_observed_at[\s\S]*recovery_verified_at/i);
    expect(derive).toMatch(/must_pass_observed_at[\s\S]*governance_observed_at/i);
    expect(derive).toMatch(/verificationNow[\s\S]*derived/i);
  });
});
