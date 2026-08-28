import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { bindSiteContentProjection } from "@/lib/site-content/site-content-sync";

const root = resolve(import.meta.dirname, "..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260827213539_add_site_content_runtime_authority.sql"),
  "utf8",
);
const schema = readFileSync(resolve(root, "supabase/schema.sql"), "utf8");

function functionBody(sql: string, name: string) {
  const start = sql.lastIndexOf(`create or replace function public.${name}`);
  if (start < 0) throw new Error(`Missing SQL function ${name}.`);
  const bodyStart = sql.indexOf("as $$", start);
  const end = sql.indexOf("$$;", bodyStart);
  return sql.slice(start, end + 3);
}

describe("site-content persisted governance authority SQL", () => {
  it("keeps the canonical projection digest fields identical in TypeScript and SQL", () => {
    const binding = bindSiteContentProjection({
      logicalId: "medication:lithium",
      domain: "medications",
      kind: "medication",
      slug: "lithium",
      payload: { title: "Lithium", nested: { b: 2, a: 1 } },
      governance: { validationStatus: "locally_reviewed", sourceStatus: "current" },
      publicationVersion: "2026-08-28T00:00:00.000Z",
      contentHash: `sha256:${"a".repeat(64)}`,
      sourceLineageDigest: `sha256:${"b".repeat(64)}`,
    });
    expect(binding.projectionDigest).toBe("sha256:c6a756e95268c3b72d513f5c01431c4dd16f2e8e71e7cd1dc8ccf37bd13bbd67");
    const digestSql = functionBody(migration, "site_content_projection_digest");
    for (const field of [
      "logicalId",
      "domain",
      "recordKind",
      "slug",
      "payload",
      "governance",
      "publicationVersion",
      "contentHash",
      "sourceLineageDigest",
    ]) {
      expect(digestSql).toContain(`'${field}'`);
    }
    expect(digestSql).toContain("public.site_content_json_digest");
  });

  it.each([migration, schema])(
    "binds publication, derivation, verification, and activation to persisted governance",
    (sql) => {
      const publication = functionBody(sql, "publish_site_content_record");
      expect(publication).toContain("site_content_projection_governance_valid");
      expect(publication).toContain("p_record->>'projectionDigest' is distinct from v_projection_digest");
      const derivation = functionBody(sql, "derive_site_content_release_gate_artifacts");
      expect(derivation).toContain("site_content_release_projection_bindings");
      expect(derivation).toContain("p_governance_receipt->'projectionBindings' is distinct from v_projection_bindings");
      expect(functionBody(sql, "site_content_release_governance_valid")).toMatch(
        /site-content-governance-registry-v1[\s\S]*projectionBindings/,
      );
      expect(sql).toMatch(/before update of governance_verified, state[\s\S]*guard_site_content_release_governance/);
    },
  );

  it.each([migration, schema])(
    "derives bounded runtime status and direct-candidate age from active projections",
    (sql) => {
      const runtime = functionBody(sql, "read_site_content_runtime_authority");
      expect(runtime).toMatch(/domain_evidence[\s\S]*projection\.governance->>'sourceStatus'/);
      expect(runtime).toMatch(
        /case when pg_catalog\.count\(candidate\.id\) = 0 then null[\s\S]*min\(candidate\.created_at\)/,
      );
      expect(runtime).not.toContain("case when pending_summary.logical_id_count = 0 then null");
      expect(runtime).toContain("'domainEvidence', domain_evidence.domains");
      expect(runtime).not.toMatch(/'payload'|'logicalId'|'actorId'|'route'|'error'/);
    },
  );
});
