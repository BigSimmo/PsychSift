import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const original = readFileSync("supabase/migrations/20260926225609_teaching_mode.sql", "utf8");
const repair = readFileSync("supabase/migrations/20260927135500_teaching_permission_null_guards.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");

function definition(sql: string, name: string, replacement = false): string {
  const prefix = replacement ? "create or replace function" : "create function";
  const start = sql.indexOf(`${prefix} public.${name}(`);
  if (start < 0) return "";
  const close = sql.indexOf("\nend $$;", start);
  return close < 0 ? "" : sql.slice(start, close + "\nend $$;".length);
}

// 20261006060000 raised the feedback release threshold from 3 to 5 answers.
function laterChanges(name: string, sql: string): string {
  return name === "teaching_depth_command" ? sql.replace("or v_count < 3 then", "or v_count < 5 then") : sql;
}

const repairs = [
  {
    name: "teaching_depth_command",
    action: "feedback.totals",
    old: "if not (v_occ.presenter_id = p_actor_id or v_role = 'organiser') then raise exception 'teaching_role_denied'; end if;",
    next: "if (v_occ.presenter_id = p_actor_id or v_role = 'organiser') is not true then raise exception 'teaching_role_denied'; end if;",
  },
  {
    name: "teaching_whats_on_command",
    action: "resource.remove",
    old: "if not (v_role = 'organiser' or v_resource.added_by = p_actor_id) then raise exception 'teaching_role_denied'; end if;",
    next: "if (v_role = 'organiser' or v_resource.added_by = p_actor_id) is not true then raise exception 'teaching_role_denied'; end if;",
  },
] as const;

describe("Teaching permission null guards", () => {
  for (const { name, action, old, next } of repairs) {
    it(`${action} denies NULL ownership while retaining the existing command and grants`, () => {
      const before = definition(original, name);
      const after = definition(repair, name, true);
      const mirror = definition(schema, name);

      expect(before).toContain(old);
      expect(before.split(old)).toHaveLength(2);
      expect(after).toContain(next);
      expect(after.split(next)).toHaveLength(2);
      expect(after).toBe(
        before
          .replace(`create function public.${name}`, `create or replace function public.${name}`)
          .replace(old, next),
      );
      // schema.sql also carries later, separately tested changes to the same function.
      expect(mirror).toBe(laterChanges(name, before.replace(old, next)));
      expect(after).toContain("security invoker set search_path = public, pg_catalog, pg_temp");
      expect(repair).toContain(
        `revoke all on function public.${name}(uuid, uuid, text, jsonb) from public, anon, authenticated;`,
      );
      expect(repair).toContain(`grant execute on function public.${name}(uuid, uuid, text, jsonb) to service_role;`);
    });
  }

  it("requires an explicitly true permission for presenter, author, or organiser", () => {
    const deniedBySql = (owns: boolean | null, organiser: boolean): boolean =>
      // PostgreSQL: (NULL OR FALSE) IS NOT TRUE, while (NULL OR TRUE) IS NOT TRUE is false.
      !(owns === true || organiser);

    expect(deniedBySql(null, false)).toBe(true); // presenter or author was deleted
    expect(deniedBySql(false, false)).toBe(true); // another team member
    expect(deniedBySql(true, false)).toBe(false); // presenter or author
    expect(deniedBySql(null, true)).toBe(false); // organiser, despite NULL ownership
    expect(deniedBySql(false, true)).toBe(false); // organiser

    for (const { next } of repairs) expect(repair).toContain(next);
  });
});
