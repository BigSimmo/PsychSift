import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directory = "supabase/migrations";
const files = readdirSync(directory);
const name = files.find((file) => file.endsWith("_roster_swap_accept_team_rules.sql"));
if (!name) throw new Error("Missing forward roster accept team-rules migration");
const sql = readFileSync(`${directory}/${name}`, "utf8").replace(/\r\n/g, "\n");
const original = readFileSync(`${directory}/20260926225409_roster_mode.sql`, "utf8").replace(/\r\n/g, "\n");
const addition =
  "        when public.roster_swap_breaks_team_rules(p_service_id, v_swap.id, v_settings.rules) then 'team_rule'\n";

function command(source: string) {
  const start = source.search(/create (?:or replace )?function public\.roster_command\(/);
  if (start < 0) throw new Error("Missing roster_command definition");
  return source.slice(start, source.indexOf("end $$;", start) + "end $$;".length);
}

describe("transactional roster accept team rules (#DW0T5X)", () => {
  it("preserves every original command branch and guard except the extra manager reason", () => {
    expect(sql.split(addition)).toHaveLength(2);
    expect(command(sql).replace(addition, "").replace("create or replace function", "create function")).toBe(
      command(original),
    );
    const accept = command(sql).slice(command(sql).indexOf("if p_action = 'swap.accept' then"));
    expect(accept.indexOf("'different_grade'")).toBeLessThan(accept.indexOf(addition.trim()));
    expect(accept.indexOf(addition.trim())).toBeLessThan(accept.indexOf("-- Apply:"));
  });

  it("evaluates the current rules after acquiring the shared team-write locks", () => {
    const body = command(sql);
    expect(body.indexOf("for share;")).toBeLessThan(body.indexOf("pg_advisory_xact_lock"));
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      body.indexOf("select * into v_settings from public.roster_team_settings"),
    );
    expect(body.indexOf("select * into v_settings from public.roster_team_settings")).toBeLessThan(
      body.indexOf(addition.trim()),
    );
  });

  it("keeps helper reads inside the same service, two people and live lookback rows", () => {
    const helper = sql.slice(0, sql.indexOf("create or replace function public.roster_command"));
    for (const clause of [
      "w.id = p_swap_id and w.service_id = p_service_id",
      "g.service_id = p_service_id",
      "t.service_id = p_service_id",
      "a.service_id = p_service_id and a.superseded_at is null",
      "a.user_id in (s.requester_id, s.counterparty_id)",
      "a.starts_at between s.anchor_from - b.lookback and s.anchor_to + b.lookback",
      "a.kind not in ('leave', 'on_call')",
      "case when a.id = s.give_id then s.counterparty_id",
      "when a.id = s.take_id then s.requester_id",
    ])
      expect(helper).toContain(clause);
  });

  it("compares added flags using Perth start-day runs and clipped rolling hours", () => {
    for (const key of ["minBreakHours", "maxNightsInRow", "maxDaysInRow", "maxHours7d", "maxHours14d"])
      expect(sql).toContain(`p_rules ->> '${key}'`);
    expect(sql).toContain("starts_at at time zone 'Australia/Perth'");
    expect(sql).toContain("select distinct phase, user_id");
    expect(sql).toContain("interval '168 hours'");
    expect(sql).toContain("interval '336 hours'");
    expect(sql).toContain("least(a.ends_at, b.ends_at) - greatest(a.ends_at - h.span, b.starts_at)");
    expect(sql).toContain("round(hours, 1) metric from hour_totals where hours > maximum");
    expect(sql).toContain("b.rule = a.rule and b.metric = a.metric");
    expect(sql).toContain("b.user_id = a.user_id and b.id = a.id");
  });

  it("retains invoker security and service-role-only execution without a data backfill", () => {
    expect(sql.match(/security invoker set search_path = public, pg_catalog, pg_temp/g)).toHaveLength(2);
    for (const signature of [
      "roster_swap_breaks_team_rules(uuid, uuid, jsonb)",
      "roster_command(uuid, uuid, text, jsonb)",
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role`);
    }
    expect(sql).not.toMatch(/security definer|grant .* to (?:anon|authenticated)/i);
    expect(sql).not.toMatch(/alter table|drop table|delete from public\.roster_team_settings/i);
  });

  it("ships a disposable SQL regression fixture for the four newly transactional limits", () => {
    const fixture = readFileSync("tests/sql/roster-swap-accept-team-rules.sql", "utf8");
    for (const rule of ["maxHours7d", "maxHours14d", "maxNightsInRow", "maxDaysInRow"])
      expect(fixture).toContain(`'${rule}'`);
    expect(fixture).toContain("'settings.set'");
    expect(fixture).toContain("'swap.accept'");
    expect(fixture).toContain("set local role service_role");
    expect(fixture.trim()).toMatch(/rollback;$/);
  });
});
