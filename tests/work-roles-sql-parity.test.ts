import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WORK_CAPABILITIES, WORK_CAPABILITY_RULES } from "@/lib/work-roles/model";

// work_can() in SQL and decideWorkCapability() in TypeScript must give the same answers.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261009070000_work_roles.sql"), "utf8");

function sqlRule(capability: string) {
  const line = sql.split("\n").find((text) => text.trim().startsWith(`when '${capability}' then`));
  if (!line) return null;
  const roles = (name: string) => {
    const match = line.match(new RegExp(`${name} := array\\[([^\\]]*)\\]`));
    return match ? [...match[1].matchAll(/'([a-z]+)'/g)].map((found) => found[1]).sort() : null;
  };
  return {
    administrator: /v_admin_ok := true/.test(line),
    hospital: roles("v_hospital_roles"),
    team: roles("v_team_roles"),
    trainee: /v_trainee_ok := true/.test(line),
  };
}

/**
 * Capabilities only TypeScript checks: their readers call `can()` and never `work_can()`, so the SQL
 * function leaves them out and refuses them (it fails closed on an unknown capability). Adding one
 * here needs no migration. Using one from SQL means adding its line to `work_can()` and removing it here.
 */
const TYPESCRIPT_ONLY = new Set<string>(["staffing.overview"]);

describe("work_can matches the TypeScript rules", () => {
  it.each(WORK_CAPABILITIES.filter((capability) => TYPESCRIPT_ONLY.has(capability)))(
    "%s is TypeScript only, so work_can refuses it",
    (capability) => {
      expect(sqlRule(capability)).toBeNull();
      expect(sql).toMatch(/else return false;/);
    },
  );

  it.each(WORK_CAPABILITIES.filter((capability) => !TYPESCRIPT_ONLY.has(capability)))("%s", (capability) => {
    const rule = WORK_CAPABILITY_RULES[capability];
    expect(sqlRule(capability)).toEqual({
      administrator: rule.administrator,
      hospital: [...rule.hospital].sort(),
      team: [...rule.team].sort(),
      trainee: rule.trainee,
    });
  });
});
