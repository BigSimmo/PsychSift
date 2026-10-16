import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const waiverPath = path.join(root, "docs", "release-source-metadata-debt-2026-06-30.json");

describe("release source metadata debt waiver (#49Q5FB)", () => {
  const waiver = JSON.parse(readFileSync(waiverPath, "utf8")) as {
    accepted: boolean;
    accepted_by: string;
    accepted_at: string;
    verified_at: string;
    expires_at: string;
    status: string;
    missing_required_metadata_count: number;
    observed_live_corpus: {
      missing_required_source_metadata: number;
      missing_required_metadata_count: number;
    };
    ceilings: {
      max_stale_rate: number;
      max_review_required_rate: number;
      max_outdated_top_results: number;
      max_poor_extraction_top_results: number;
      max_source_governance_danger_failure_rate: number;
    };
  };

  it("records zero missing required source metadata keys and resolved status", () => {
    expect(waiver.accepted).toBe(true);
    expect(waiver.status).toBe("resolved_zero_missing_metadata");
    expect(waiver.missing_required_metadata_count).toBe(0);
    expect(waiver.observed_live_corpus.missing_required_source_metadata).toBe(0);
    expect(waiver.observed_live_corpus.missing_required_metadata_count).toBe(0);
    expect(waiver.verified_at).toBe("2026-10-16");
  });

  it("maintains a valid non-expired review window and required audit-source-governance ceilings", () => {
    const acceptedAtMs = Date.parse(waiver.accepted_at);
    const expiresAtMs = Date.parse(waiver.expires_at);
    expect(Number.isFinite(acceptedAtMs)).toBe(true);
    expect(Number.isFinite(expiresAtMs)).toBe(true);
    expect(expiresAtMs).toBeGreaterThan(Date.now());
    expect(waiver.expires_at).toContain("2027-04-16");

    expect(waiver.ceilings.max_stale_rate).toBe(0);
    expect(waiver.ceilings.max_review_required_rate).toBeLessThanOrEqual(0.6);
    expect(waiver.ceilings.max_outdated_top_results).toBe(0);
    expect(waiver.ceilings.max_poor_extraction_top_results).toBe(0);
    expect(waiver.ceilings.max_source_governance_danger_failure_rate).toBe(0);
  });
});
