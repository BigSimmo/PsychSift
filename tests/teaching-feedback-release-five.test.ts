import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const previous = readFileSync("supabase/migrations/20260927135500_teaching_permission_null_guards.sql", "utf8");
const raise = readFileSync("supabase/migrations/20261006060000_teaching_feedback_release_five.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");

function definition(sql: string, prefix: string): string {
  const start = sql.indexOf(`${prefix} public.teaching_depth_command(`);
  if (start < 0) return "";
  const close = sql.indexOf("\nend $$;", start);
  return close < 0 ? "" : sql.slice(start, close + "\nend $$;".length);
}

const three = "if now() < v_occ.ends_at + interval '7 days' or v_count < 3 then";
const five = "if now() < v_occ.ends_at + interval '7 days' or v_count < 5 then";

describe("Teaching feedback release threshold", () => {
  it("releases totals only once 5 people have answered, changing nothing else in the command", () => {
    const before = definition(previous, "create or replace function");
    const after = definition(raise, "create or replace function");

    expect(before.split(three)).toHaveLength(2);
    expect(after.split(five)).toHaveLength(2);
    expect(after).not.toContain("v_count < 3");
    expect(after).toBe(before.replace(three, five));
    expect(raise).toContain(
      "revoke all on function public.teaching_depth_command(uuid, uuid, text, jsonb) from public, anon, authenticated;",
    );
    expect(raise).toContain(
      "grant execute on function public.teaching_depth_command(uuid, uuid, text, jsonb) to service_role;",
    );
  });

  it("keeps schema.sql in step with the migration", () => {
    const mirror = definition(schema, "create function");
    expect(mirror.split(five)).toHaveLength(2);
    expect(mirror).not.toContain("v_count < 3");
  });
});
