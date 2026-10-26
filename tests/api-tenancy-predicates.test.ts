import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SCOPE_EXEMPTIONS,
  analyzeSource,
  emptyTierNames,
  evaluateSites,
  scanTenancy,
  tableTiersFromDatabaseTypes,
} from "../scripts/lib/tenancy-scan.mjs";

describe("API tenancy predicates AST guard (#J43Z6B)", () => {
  it("asserts scanTenancy(process.cwd()) finds 0 violations across all scanned files and tiers", () => {
    const { violations, counts } = scanTenancy(process.cwd());
    expect(counts.direct).toBeGreaterThan(0);
    expect(counts.userKeyed).toBeGreaterThan(0);
    expect(counts.derived).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it("tiers tables written as GeneratedTable<...> or with a one-line Row, and never a Functions entry", () => {
    const tiers = tableTiersFromDatabaseTypes(`
type GeneratedTable<Row> = { Row: Row; Insert: Partial<Row>; Update: Partial<Row>; Relationships: [] };
export type Database = {
  public: {
    Tables: {
      plain: {
        Row: {
          id: string;
          owner_id: string;
        };
        Insert: { id?: string };
      };
      one_line: {
        Row: { service_id: string; user_id: string };
        Insert: { service_id: string; user_id: string };
      };
      wrapped: GeneratedTable<{
        id: string;
        document_id: string;
      }>;
      untiered: GeneratedTable<{ id: string; name: string }>;
    };
    Functions: {
      not_a_table: { Args: { owner_id: string }; Returns: undefined };
    };
  };
};`);
    expect([...tiers.direct]).toEqual(["plain"]);
    expect([...tiers.userKeyed]).toEqual(["one_line"]);
    expect([...tiers.derived]).toEqual(["wrapped"]);
    expect([...tiers.all].sort()).toEqual(["one_line", "plain", "untiered", "wrapped"]);
  });

  it("reads the real generated types, including every GeneratedTable<...> table", () => {
    const schemaTypes = readFileSync(join(process.cwd(), "src", "lib", "supabase", "database.types.ts"), "utf8");
    const tiers = tableTiersFromDatabaseTypes(schemaTypes);
    expect(tiers.userKeyed.has("work_role_grants")).toBe(true);
    expect(tiers.userKeyed.has("teaching_calendar_optins")).toBe(true);
    expect(tiers.direct.has("cme_plan_goal_carries")).toBe(true);
    expect(tiers.direct.has("work_backups")).toBe(true);
    expect(tiers.all.has("work_hospitals")).toBe(true);
    expect(tiers.all.has("roster_rotation_rounds")).toBe(true);
  });

  it("asserts emptyTierNames(counts) is empty (guaranteeing AST parser is intact and reading schema types)", () => {
    const schemaTypes = readFileSync(join(process.cwd(), "src", "lib", "supabase", "database.types.ts"), "utf8");
    const tiers = tableTiersFromDatabaseTypes(schemaTypes);
    expect(tiers.direct.size).toBeGreaterThan(0);
    expect(tiers.userKeyed.size).toBeGreaterThan(0);
    expect(tiers.derived.size).toBeGreaterThan(0);

    const { counts } = scanTenancy(process.cwd());
    const emptyTiers = emptyTierNames(counts);
    expect(emptyTiers).toEqual([]);
  });

  it("verifies every query chain on a direct multi-tenant table in src/app/api/ is owner-scoped or declared in SCOPE_EXEMPTIONS", () => {
    const { sites } = scanTenancy(process.cwd());
    const directApiSites = sites.filter((site) => site.file.startsWith("src/app/api/") && site.tier === "direct");
    expect(directApiSites.length).toBeGreaterThan(0);

    for (const site of directApiSites) {
      const isCoveredByExemption = SCOPE_EXEMPTIONS.some(
        (entry) => entry.file === site.file && entry.table === site.table && entry.fn === site.scope,
      );

      expect(
        site.ownerScopedChain || isCoveredByExemption,
        `Unscoped direct multi-tenant query at ${site.file}:${site.line} on table "${site.table}" in scope "${site.scope}" ` +
          "neither has an on-chain owner_id predicate nor is covered by a declared exemption in SCOPE_EXEMPTIONS.",
      ).toBe(true);
    }
  });

  it("verifies that an unscoped query on an owner-scoped table is flagged as a violation by evaluateSites", () => {
    const syntheticSource = `export async function GET() {
      return supabase.from("documents").select("*");
    }`;

    const syntheticSites = analyzeSource({
      relativePath: "src/app/api/synthetic-test-route/route.ts",
      source: syntheticSource,
      tiers: {
        direct: new Set(["documents"]),
        userKeyed: new Set(),
        derived: new Set(),
        all: new Set(["documents"]),
      },
    });

    expect(syntheticSites).toHaveLength(1);
    expect(syntheticSites[0].tier).toBe("direct");
    expect(syntheticSites[0].ownerScopedChain).toBe(false);

    const evaluation = evaluateSites({
      sites: syntheticSites,
      exemptions: [],
      inventory: [],
      untiered: [],
      dynamicFrom: [],
    });

    expect(evaluation.violations.length).toBe(1);
    expect(evaluation.violations[0]).toContain("documents");
    expect(evaluation.violations[0]).toContain("undeclared scope-exemption query");
  });
});
