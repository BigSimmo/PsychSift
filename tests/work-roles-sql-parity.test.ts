import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WORK_CAPABILITIES, WORK_CAPABILITY_RULES } from "@/lib/work-roles/model";

// work_can() in SQL and decideWorkCapability() in TypeScript must give the same answers.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261009010000_work_roles.sql"), "utf8");

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

describe("work_can matches the TypeScript rules", () => {
  it.each(WORK_CAPABILITIES)("%s", (capability) => {
    const rule = WORK_CAPABILITY_RULES[capability];
    expect(sqlRule(capability)).toEqual({
      administrator: rule.administrator,
      hospital: [...rule.hospital].sort(),
      team: [...rule.team].sort(),
      trainee: rule.trainee,
    });
  });
});
