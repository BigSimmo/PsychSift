import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Static contract for the Teaching migration. Roster re-stamps the file when it assembles the
// combined DB PR, so it is found by its suffix, never by a fixed timestamp.
const migrationName = readdirSync("supabase/migrations").find((name) => name.endsWith("_teaching_mode.sql"));
const sql = migrationName ? readFileSync(`supabase/migrations/${migrationName}`, "utf8") : "";

const teachingTables = [
  "teaching_attendance",
  "teaching_audit_events",
  "teaching_calendar_optins",
  "teaching_checkin_claims",
  "teaching_collection_sections",
  "teaching_collections",
  "teaching_display_links",
  "teaching_feedback_answers",
  "teaching_feedback_replied",
  "teaching_group_members",
  "teaching_groups",
  "teaching_member_roles",
  "teaching_notice_reads",
  "teaching_notices",
  "teaching_occurrences",
  "teaching_readiness",
  "teaching_resource_saves",
  "teaching_resources",
  "teaching_series",
  "teaching_supervision_entries",
  "teaching_supervision_notes",
  "teaching_supervision_pairings",
  "teaching_team_settings",
  "teaching_week_adds",
];

/** Column lines of every `create table public.<name> (` ... `);` block, keyed by table name. */
function tableBlocks(): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  for (const match of sql.matchAll(/create table public\.(\w+) \(\n([\s\S]*?)\n\);/g)) {
    blocks.set(match[1], match[2].split("\n"));
  }
  return blocks;
}

/** The whole text of one `create function public.<name>(` definition, up to its closing `$$`. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create function public.${name}(`);
  if (start < 0) return "";
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(start, close + 2);
}

/** The text of one action's branch (`p_action = '<action>'`), up to the next branch of its chain. */
function actionBranch(body: string, action: string): string {
  const quoted = action.replaceAll(".", "\\.");
  let start = body.search(new RegExp(`(if|elsif) p_action = '${quoted}' then`));
  if (start < 0) start = body.search(new RegExp(`elsif p_action in \\([^)]*'${quoted}'[^)]*\\) then`));
  if (start < 0) return "";
  const rest = body.slice(start + 5);
  const next = rest.search(/\n\s*elsif p_action |\n {2}end if;\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** Argument text of every call to `fn(` in `text`, matched by balanced parentheses. */
function callArguments(text: string, fn: string): string[] {
  const out: string[] = [];
  const needle = `${fn}(`;
  let from = text.indexOf(needle);
  while (from >= 0) {
    const isPartOfLongerName = from > 0 && /[a-z0-9_]/i.test(text[from - 1]);
    let depth = 0;
    let index = from + needle.length - 1;
    for (; index < text.length; index++) {
      if (text[index] === "(") depth++;
      else if (text[index] === ")" && --depth === 0) break;
    }
    if (!isPartOfLongerName) out.push(text.slice(from + needle.length, index));
    from = text.indexOf(needle, from + needle.length);
  }
  return out;
}

/** `name(type, type)` for every function the migration creates, from its parameter list. */
function functionSignatures(): string[] {
  const signatures: string[] = [];
  for (const match of sql.matchAll(/create function public\.(\w+)\(([^)]*)\)/g)) {
    const types = match[2]
      .split(",")
      .map((parameter) => parameter.trim())
      .filter(Boolean)
      .map((parameter) => parameter.split(/\s+/)[1]);
    signatures.push(`${match[1]}(${types.join(", ")})`);
  }
  return signatures;
}

describe("teaching migration: tables (D1)", () => {
  it("exists under a stamped name found by suffix", () => {
    expect(migrationName).toMatch(/^\d{14}_teaching_mode\.sql$/);
  });

  it("creates exactly the contract's teaching tables", () => {
    const created = [...tableBlocks().keys()].filter((name) => name.startsWith("teaching_")).sort();
    expect(created).toEqual([...teachingTables].sort());
  });

  it("enables RLS on every teaching table and revokes it from public, anon and authenticated", () => {
    const revoke = sql.split("\n").find((line) => line.startsWith("revoke all on public.teaching_member_roles,")) ?? "";
    expect(revoke.endsWith(" from public, anon, authenticated;")).toBe(true);
    for (const table of teachingTables) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(revoke).toMatch(new RegExp(`public\\.${table}[,\\s]`));
    }
  });

  it("grants tables only to service_role, keeps the audit trail append-only, and has no policies", () => {
    expect(sql).not.toMatch(/^grant[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/im);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("grant select, insert, delete on public.teaching_audit_events to service_role;");
    const tableGrant =
      sql
        .split("\n")
        .find((line) => line.startsWith("grant select, insert, update, delete on public.teaching_member_roles,")) ?? "";
    expect(tableGrant).not.toContain("teaching_audit_events");
    for (const table of teachingTables.filter((name) => name !== "teaching_audit_events")) {
      expect(tableGrant).toMatch(new RegExp(`public\\.${table}[,\\s]`));
    }
  });

  it("accepts only https links, without user info", () => {
    const joinUrlLines = sql.split("\n").filter((line) => /^\s+join_url text/.test(line));
    expect(joinUrlLines).toHaveLength(2);
    for (const line of joinUrlLines) expect(line).toContain("join_url ~ '^https://[^/@[:space:]]+(/|$)'");
    expect(functionBody("teaching_valid_links")).toContain("!~ '^https://[^/@[:space:]]+(/|$)'");
    expect(sql).not.toMatch(/https\?/);
  });

  it("never returns or serialises the check-in secret", () => {
    for (const fn of [
      "jsonb_build_object",
      "to_jsonb",
      "jsonb_agg",
      "json_build_object",
      "row_to_json",
      "jsonb_object_agg",
    ]) {
      for (const args of callArguments(sql, fn)) {
        expect(args, `${fn}(${args})`).not.toContain("checkin_secret");
        // A whole row passed to a serialiser would carry every column, the secret included.
        if (fn !== "jsonb_build_object") expect(args.trim(), `${fn}(${args})`).not.toMatch(/^[a-z_][a-z0-9_]*$/);
      }
    }
    const uses = sql.split("\n").filter((line) => line.includes("checkin_secret") && !line.trim().startsWith("--"));
    for (const line of uses) {
      const isColumn = line.trim().startsWith("checkin_secret bytea not null default extensions.gen_random_bytes(32)");
      const isDerivation = /^\s*v_[a-z_]+ := public\.teaching_(code_mac|typed_code)\(v_occ\.checkin_secret, /.test(
        line,
      );
      expect(isColumn || isDerivation, line).toBe(true);
    }
    expect(sql).not.toMatch(/returning[^;]*checkin_secret/);
  });

  it("stores no free text in the audit, notice, note or feedback tables", () => {
    const blocks = tableBlocks();
    for (const table of [
      "teaching_audit_events",
      "teaching_notices",
      "teaching_notice_reads",
      "teaching_supervision_notes",
      "teaching_feedback_answers",
      "teaching_feedback_replied",
    ]) {
      for (const line of blocks.get(table) ?? []) {
        if (!/^\s+\w+ (text|jsonb|varchar|character varying)\b/.test(line)) continue;
        expect(line, `${table}: ${line}`).toMatch(/check \(.*( in \(|~ '|public\.teaching_valid_correction\()/);
      }
    }
    // Feedback answers carry no person, no timestamp and nothing to order them by.
    const answers = (blocks.get("teaching_feedback_answers") ?? []).join("\n");
    expect(answers).not.toMatch(/user_id|_by\b|timestamptz|_at\b|identity/);
    const replied = (blocks.get("teaching_feedback_replied") ?? []).join("\n");
    expect(replied).not.toMatch(/timestamptz|useful|pace/);
    // The "already answered" marker is one-way: no user id and no link to auth.users.
    expect(replied).not.toMatch(/user_id|references auth\.users/);
    expect(replied).toContain("reply_marker text not null check (reply_marker ~ '^[a-f0-9]{64}$')");
  });

  it("sets people references to null on account deletion, except a doctor's own rows", () => {
    const cascades: string[] = [];
    for (const [table, lines] of tableBlocks()) {
      if (!table.startsWith("teaching_")) continue;
      for (const line of lines) {
        const match = line.match(/^\s+(\w+) uuid .*references auth\.users\(id\) on delete (set null|cascade)/);
        if (!match) continue;
        if (match[2] === "cascade") cascades.push(`${table}.${match[1]}`);
      }
      if (lines.some((line) => /references auth\.users\(id\)(?! on delete (set null|cascade))/.test(line))) {
        throw new Error(`${table} has a person reference with no delete rule`);
      }
    }
    expect(cascades.sort()).toEqual([
      "teaching_attendance.user_id",
      "teaching_notice_reads.user_id",
      "teaching_resource_saves.user_id",
      "teaching_week_adds.user_id",
    ]);
    for (const table of ["teaching_member_roles", "teaching_group_members", "teaching_calendar_optins"]) {
      expect((tableBlocks().get(table) ?? []).join("\n")).toContain(
        "references public.on_call_service_members(service_id, user_id) on delete cascade",
      );
    }
  });

  it("holds What's on and Resources as links only, team-only by default, with a platform-set health service (spec §5a)", () => {
    const blocks = tableBlocks();
    const settings = (blocks.get("teaching_team_settings") ?? []).join("\n");
    expect(settings).toContain(
      "health_service text not null check (health_service in ('nmhs','smhs','emhs','wachs','cahs','demo'))",
    );
    const series = (blocks.get("teaching_series") ?? []).join("\n");
    expect(series).toContain("open_to text not null default 'team' check (open_to in ('team','health_service'))");
    // R4 "My level": a fixed audience per series, all doctors unless the organiser picks one.
    expect(series).toContain(
      "audience text not null default 'all_doctors' check (audience in ('interns','residents','registrars','consultants','all_doctors'))",
    );
    // R3 "Moved from 12:30": the earlier start, never kept on a session that was not changed.
    const occurrences = (blocks.get("teaching_occurrences") ?? []).join("\n");
    expect(occurrences).toContain("previous_starts_at timestamptz,");
    expect(occurrences).toContain("check (previous_starts_at is null or status <> 'scheduled')");
    const attendance = (blocks.get("teaching_attendance") ?? []).join("\n");
    expect(attendance).toContain("visitor boolean not null default false");
    expect(attendance).toContain("check (not visitor or method = 'self')");
    const resources = (blocks.get("teaching_resources") ?? []).join("\n");
    expect(resources).toContain(
      "url text check (url is null or (char_length(url) <= 2000 and url ~ '^https://[^/@[:space:]]+(/|$)'))",
    );
    expect(resources).toContain("kind text not null check (kind in ('slides','recording','reading','link','library'))");
    expect(resources).toContain("check ((url is null) <> (library_document_id is null))");
    expect(resources).toContain("check ((kind = 'library') = (library_document_id is not null))");
    expect(resources).toContain("no_patient_details_confirmed_at timestamptz not null");
    expect(resources).toContain("removed_at timestamptz");
    expect(resources).toContain("added_by uuid references auth.users(id) on delete set null");
    // Links only: nothing stores a file, a blob or a storage path.
    expect(resources).not.toMatch(/bytea|storage|file_path|object_key/);
    expect((blocks.get("teaching_week_adds") ?? []).join("\n")).toContain(
      "check (num_nonnulls(occurrence_id, series_id) = 1)",
    );
  });

  it("review focus 5: a locked supervision entry never blocks an account deletion", () => {
    const guard = functionBody("teaching_guard_supervision_entry");
    expect(guard).toContain("if old.locked and");
    // The person columns are left out of the comparison, so on delete set null still works.
    expect(guard).not.toMatch(/confirmed_by|logged_by/);
    expect(sql).toContain("before update on public.teaching_supervision_entries");
    expect(sql).not.toMatch(/before (update or )?delete on public\.teaching_supervision_entries/);
  });
});

describe("teaching migration: helpers and check-in functions (D2)", () => {
  it("defines the check-in codes exactly as the contract says", () => {
    expect(functionBody("teaching_code_mac")).toContain(
      "encode(substring(extensions.hmac(convert_to(p_occurrence::text || ':' || p_stream || ':' || p_window::text, 'UTF8'), p_secret, 'sha256') from 1 for 16), 'hex')",
    );
    const typed = functionBody("teaching_typed_code");
    expect(typed).toContain("|| ':typed', 'UTF8'), p_secret, 'sha256')");
    expect(typed).toContain("% 1000000)::text, 6, '0')");
    const equal = functionBody("teaching_const_eq");
    expect(equal).toContain("v_diff := v_diff | (get_byte(v_left, v_index) # get_byte(v_right, v_index));");
    // No early exit inside the loop: every byte is compared.
    expect(equal.slice(equal.indexOf("for v_index in"), equal.indexOf("end loop;"))).not.toContain("return");
  });

  it("checks a scanned code's MAC in constant time before revealing anything about the session", () => {
    const open = functionBody("teaching_checkin_open");
    const mac = open.indexOf("if not public.teaching_const_eq(v_parts[4], v_expected)");
    expect(mac).toBeGreaterThan(-1);
    for (const later of [
      "teaching_team_unverified",
      "teaching_window_closed",
      "teaching_code_expired",
      "insert into public.teaching_checkin_claims",
    ]) {
      expect(open.indexOf(later), later).toBeGreaterThan(mac);
    }
    expect(open).toContain("v_window not in (v_now_window, v_now_window - 1)");
    expect(open).toContain(
      "now() < v_occ.starts_at - interval '15 minutes' or now() > v_occ.ends_at + interval '15 minutes'",
    );
    expect(open).toContain("now() + interval '10 minutes'");
    expect(open).toContain(
      "return jsonb_build_object('occurrenceId', v_occ.id, 'title', v_occ.title, 'startsAt', v_occ.starts_at, 'stream', v_stream);",
    );
  });

  it("lets a display link show codes and nothing else, only while its creator is still in the team", () => {
    const display = functionBody("teaching_display_code");
    expect(display).toContain("public.service_member_active(v_occ.service_id, v_link.created_by)");
    expect(display).not.toMatch(/insert into|update public\.|delete from/);
    const keys = callArguments(display, "jsonb_build_object").flatMap((args) =>
      [...args.matchAll(/^\s*'(\w+)',/gm)].map((match) => match[1]),
    );
    expect(keys).toEqual(["token", "typedCode", "window", "title", "venue", "closesAt"]);
  });

  it("resolves a role from the shared active-member helper first, then Teaching's own row", () => {
    const resolver = functionBody("teaching_member_role");
    const active = resolver.indexOf("public.service_member_active(p_service_id, p_user_id)");
    expect(active).toBeGreaterThan(-1);
    expect(resolver.indexOf("from public.teaching_member_roles r")).toBeGreaterThan(active);
    expect(resolver).toContain("r.revoked_at is null");
    expect(resolver).toContain("return coalesce(v_role, 'doctor');");
  });

  it("review focus 2: ignores a Teaching role granted before the member's latest join", () => {
    expect(functionBody("teaching_member_role")).toContain("r.granted_at >= m.joined_at");
    expect(functionBody("teaching_admin_count")).toContain("r.granted_at >= m.joined_at");
    expect(functionBody("teaching_can_invite")).toContain(
      "public.teaching_member_role(p_service_id, p_user_id) in ('organiser','admin')",
    );
  });

  it("review focus 2: a shared revoke cascades to the Teaching role, and a rejoin neither re-revokes nor restores it", () => {
    // Fires only on the null -> time change. A rejoin (revoked_at back to null) does not fire it.
    expect(sql).toContain(
      "create trigger teaching_member_revoke_cascade\n  after update of revoked_at on public.on_call_service_members\n  for each row when (old.revoked_at is null and new.revoked_at is not null)\n  execute function public.teaching_cascade_member_revoke();",
    );
    const cascade = functionBody("teaching_cascade_member_revoke");
    expect(cascade).toContain(
      "update public.teaching_member_roles set revoked_at = now()\n  where service_id = new.service_id and user_id = new.user_id and revoked_at is null;",
    );
    expect(cascade).toContain(
      "insert into public.on_call_service_member_events(service_id, user_id, event, mode, actor_id)\n    values (new.service_id, new.user_id, 'role_changed', 'teaching', null);",
    );
    // Never restores a role: nothing here clears revoked_at or inserts a role row.
    expect(cascade).not.toMatch(/revoked_at = null|insert into public\.teaching_member_roles/);
    // The stale-role guard stays as a second layer.
    expect(functionBody("teaching_member_role")).toContain("r.granted_at >= m.joined_at");
  });

  it("defines teaching_can_invite for On Call's shared join (contract v3)", () => {
    expect(sql).toContain(
      "create function public.teaching_can_invite(p_service_id uuid, p_user_id uuid) returns boolean\nlanguage plpgsql stable security invoker set search_path = public, pg_catalog, pg_temp as $$",
    );
  });

  it("gives every function it creates to service_role only, as security invoker", () => {
    expect(sql).not.toMatch(/security definer/i);
    const signatures = functionSignatures();
    expect(signatures.length).toBeGreaterThan(0);
    for (const signature of signatures) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    for (const match of sql.matchAll(/create function public\.(\w+)\([^)]*\) returns [^\n]*\nlanguage [^\n]*/g)) {
      expect(match[0], match[1]).toContain("security invoker set search_path = public, pg_catalog, pg_temp as $$");
    }
  });

  it("review focus 4: payload readers raise teaching_invalid_request instead of a cast error", () => {
    for (const name of ["teaching_date_arg", "teaching_ts_arg"]) {
      const body = functionBody(name);
      expect(body, name).toContain("exception when invalid_datetime_format or datetime_field_overflow then");
      expect(body, name).toContain("raise exception 'teaching_invalid_request';");
    }
    // A timestamp must carry its offset, so nothing is read in the database's UTC session zone.
    expect(functionBody("teaching_ts_arg")).toContain("(Z|[+-][0-9]{2}:[0-9]{2})$'");
    const uuid = functionBody("teaching_uuid_arg");
    expect(uuid.indexOf("!~*")).toBeLessThan(uuid.indexOf("::uuid"));
    const integer = functionBody("teaching_int_arg");
    expect(integer.indexOf("!~ '^-?[0-9]{1,6}$'")).toBeLessThan(integer.indexOf("::integer"));
  });

  it("keeps one attendance row per person, upgrades self-declared to code, never downgrades", () => {
    const record = functionBody("teaching_record_attendance");
    expect(record).toContain("on conflict (occurrence_id, user_id) do nothing");
    expect(record).toContain("if v_row.method = 'self' and p_method <> 'self' then");
    expect(record).toContain("'attendance.upgrade'");
  });
});

describe("teaching migration: teaching_command (D3)", () => {
  const command = functionBody("teaching_command");
  const actions = [
    "week.read",
    "session.read",
    "attendance.self",
    "checkin.code",
    "checkin.typed",
    "checkin.complete",
    "display.create",
    "display.revoke",
    "notice.read",
    "calendar.set",
    "logbook.read",
    "series.save",
    "occurrence.change",
    "group.save",
    "group.delete",
    "group.members.set",
    "register.read",
    "export.attendance",
    "members.read",
    "invitation.create",
    "role.set",
    "audit.read",
    "cpd.unlogged",
    "organise.read",
    "attendance.remove",
    "session.next",
    "supervision.pending",
    "supervision.left_services",
    "teach.read",
    "feedback.open",
  ];

  it("has the contract's signature and handles every contract action", () => {
    expect(sql).toContain(
      "create function public.teaching_command(p_actor_id uuid, p_service_id uuid, p_action text, p_payload jsonb default '{}') returns jsonb",
    );
    for (const action of actions) expect(actionBranch(command, action), action).not.toBe("");
    expect(command.trimEnd().endsWith("raise exception 'teaching_invalid_request';\nend $$")).toBe(true);
  });

  it("takes a null team only for the actor's own cross-team actions, and for session.read from a calendar link", () => {
    expect(command).toContain(
      "if p_action in ('week.read','logbook.read','checkin.complete','cpd.unlogged','session.next','supervision.pending','supervision.left_services','teach.read','feedback.open') then",
    );
    expect(command).toContain("if p_service_id is not null then raise exception 'teaching_invalid_request'; end if;");
    // session.read takes the team from the occurrence, before the unchanged membership check.
    const derive = command.indexOf("if p_action = 'session.read' and p_service_id is null then");
    expect(derive).toBeGreaterThan(-1);
    expect(command.indexOf("v_role := public.teaching_member_role(p_service_id, p_actor_id);")).toBeGreaterThan(derive);
    expect(command).toContain(
      "select o.service_id into p_service_id from public.teaching_occurrences o\n    where o.id = public.teaching_uuid_arg(p_payload, 'occurrenceId');",
    );
  });

  it("locks as the shared contract says and never replaces the On Call command", () => {
    expect(command).toContain("from public.on_call_services where id = p_service_id for share;");
    expect(command).toContain("pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74818))");
    expect(sql).not.toMatch(/on_call_services[^;]*for update/);
    expect(sql).not.toMatch(/create (or replace )?function public\.on_call_service_command/);
    expect(sql).not.toMatch(/(from|join) auth\.users/);
  });

  it("refuses every write in an unverified team except role.set", () => {
    expect(command).toContain(
      "if p_action not in ('session.read','checkin.code','register.read','export.attendance','members.read','organise.read','audit.read','role.set')\n    and not (v_service.verified_at is not null or v_service.is_demo) then\n    raise exception 'teaching_team_unverified';",
    );
  });

  it("audits every write and every read of someone else's record in the same transaction", () => {
    for (const action of [
      "display.create",
      "display.revoke",
      "notice.read",
      "calendar.set",
      "series.save",
      "occurrence.change",
      "group.save",
      "group.delete",
      "group.members.set",
      "export.attendance",
      "members.read",
      "invitation.create",
      "role.set",
      "audit.read",
      "organise.read",
      "attendance.remove",
    ]) {
      expect(actionBranch(command, action), action).toContain(
        `public.teaching_audit(p_service_id, p_actor_id, '${action}'`,
      );
    }
    expect(actionBranch(command, "register.read")).toContain(
      "public.teaching_audit(p_service_id, p_actor_id, 'register.read'",
    );
    for (const action of ["attendance.self", "checkin.typed", "checkin.complete"]) {
      expect(actionBranch(command, action), action).toContain("public.teaching_record_attendance(");
    }
  });

  it("limits the week to 42 days and the leaver window to 90 days from the shared revoke", () => {
    expect(actionBranch(command, "week.read")).toContain("v_to - v_from >= 42");
    for (const action of ["logbook.read", "cpd.unlogged"]) {
      expect(actionBranch(command, action), action).toContain(
        "m.revoked_at is null or m.revoked_at > now() - interval '90 days'",
      );
    }
  });

  it("gives the presenter counts only and the organiser names", () => {
    const register = actionBranch(command, "register.read");
    expect(register.indexOf("if v_role = 'organiser' then")).toBeLessThan(
      register.indexOf("'name', coalesce(m.display_name, 'Member')"),
    );
    const presenter = register.slice(register.indexOf("elsif v_is_presenter then"));
    expect(presenter).toContain("'counts'");
    expect(presenter).not.toMatch(/'name'|user_id,|'userId'/);
  });

  it("sends every invitation through On Call's command, forced to member and marked Teaching", () => {
    const invite = actionBranch(command, "invitation.create");
    expect(invite).toContain("lower(btrim(coalesce(public.teaching_text_arg(p_payload, 'email'), '')))");
    expect(invite).toContain(
      "public.on_call_service_command(p_actor_id, p_service_id, 'invitation.create', jsonb_build_object(\n        'tokenHash', v_code, 'invitedEmail', v_text, 'expiresInDays', 7, 'role', 'member', 'issuedViaMode', 'teaching'))",
    );
    // On Call's command is the single writer and holds the cap lock; Teaching has no copy of either.
    expect(sql).not.toMatch(/(insert into|update) public\.on_call_service_invitations/);
    expect(sql).not.toContain("74817");
    expect(invite).not.toMatch(/count\(\*\)|pg_advisory/);
    // No share lock or 74818 for this action: On Call's command locks the service row itself.
    expect(command).toContain(
      "  else\n    -- invitation.create does not: On Call's command, which it calls, locks the row itself, and\n    -- upgrading a share lock held here would deadlock two concurrent invites.\n    select * into v_service from public.on_call_services where id = p_service_id;\n  end if;",
    );
    const lockList = command.slice(command.indexOf("v_needs_lock := "), command.indexOf("if v_needs_lock then"));
    expect(lockList).not.toContain("invitation.create");
  });

  it("records every role change in the shared member events and keeps one Teaching admin", () => {
    const role = actionBranch(command, "role.set");
    expect(role).toContain(
      "insert into public.on_call_service_member_events(service_id, user_id, event, mode, actor_id)\n    values (p_service_id, v_user, 'role_changed', 'teaching', p_actor_id);",
    );
    expect(role).toContain("raise exception 'teaching_last_admin';");
    expect(role).toContain("public.teaching_admin_count(p_service_id) = 0 and exists");
  });

  it("lets cpd.unlogged return a count and nothing from CPD", () => {
    const unlogged = actionBranch(command, "cpd.unlogged");
    expect(unlogged).toContain("return jsonb_build_object('count', v_count);");
    expect(unlogged).toContain("e.archived_at is null");
    expect(unlogged).not.toMatch(/e\.title|reflection|cme_allocations/);
  });

  it("keeps the spec's narrower rule: the check-in code is the presenter's or an organiser's, not an admin's", () => {
    const code = actionBranch(command, "checkin.code");
    expect(code).toContain(
      "if not (v_is_presenter or v_role = 'organiser') then raise exception 'teaching_role_denied'; end if;",
    );
    expect(actionBranch(command, "session.read")).toContain(
      "'canShowCode', v_is_presenter or coalesce(v_role = 'organiser', false),",
    );
    // Spec §4 (R23): groups, pairings and import are for organisers and admins.
    for (const action of ["group.save", "group.delete", "group.members.set"]) {
      expect(actionBranch(command, action), action).toContain(
        "if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;",
      );
    }
  });

  it("gives organisers and admins the programme, groups and members in one audited read", () => {
    const organise = actionBranch(command, "organise.read");
    expect(organise).toContain(
      "if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;",
    );
    expect(organise).toContain("public.teaching_audit(p_service_id, p_actor_id, 'organise.read', null)");
    for (const key of [
      "'series'",
      "'groups'",
      "'members'",
      "'seriesId'",
      "'startTime', to_char(s.start_time, 'HH24:MI')",
      "'lastConfirmedAt'",
      "'userIds'",
      "'name', coalesce(m.display_name, 'Member')",
    ]) {
      expect(organise, key).toContain(key);
    }
    expect(organise).not.toMatch(/checkin_secret|teaching_attendance|displayName/);
  });

  it("serves the calendar feed only for opted-in active teams, cancelled sessions included, with no join link or names", () => {
    const feed = functionBody("teaching_feed_events");
    expect(sql).toContain(
      "create function public.teaching_feed_events(p_owner_id uuid, p_from date, p_to date) returns jsonb",
    );
    expect(feed).toContain("p_to - p_from > 120");
    expect(feed).toContain("from public.teaching_calendar_optins c");
    expect(feed).toContain("public.service_member_active(c.service_id, p_owner_id)");
    expect(feed).toContain(
      "public.teaching_occurrence_listed(o.id, p_owner_id, public.teaching_member_role(c.service_id, p_owner_id))",
    );
    expect(feed).toContain("o.starts_at >= (p_from::timestamp at time zone 'Australia/Perth')");
    expect(feed).toContain("'source', 'teaching'");
    // Cancelled sessions stay in, so calendars mark them cancelled; nothing personal leaves.
    expect(feed).not.toMatch(
      /status <> 'cancelled'|'joinUrl'|'presenterName'|teaching_attendance|teaching_audit|display_name/,
    );
  });

  it("counts a self-reported check-in straight away and lets only an organiser remove one, audited", () => {
    // No approval queue: attendance.self records the row at once, like a code check-in.
    expect(actionBranch(command, "attendance.self")).toContain(
      "return public.teaching_record_attendance(p_actor_id, p_service_id, v_occ.id, 'self');",
    );
    const remove = actionBranch(command, "attendance.remove");
    expect(remove).toContain("if v_role <> 'organiser' then raise exception 'teaching_role_denied'; end if;");
    expect(remove).toContain("and a.user_id = v_user and a.method = 'self';");
    expect(remove).toContain("public.teaching_audit(p_service_id, p_actor_id, 'attendance.remove', v_user)");
  });

  it("returns the actor's next session however far ahead, for the quiet-day hero", () => {
    const next = actionBranch(command, "session.next");
    expect(next).toContain("where o.ends_at > now() and o.status <> 'cancelled'");
    expect(next).toContain("order by o.starts_at, o.id\n        limit 1");
    expect(next).toContain(
      "public.teaching_occurrence_listed(o.id, p_actor_id, public.teaching_member_role(o.service_id, p_actor_id))",
    );
    // No date window: unlike week.read, nothing bounds how far ahead it looks.
    expect(next).not.toMatch(/v_from|v_to|Australia\/Perth/);
  });

  it("gives a supervisor a count of pending confirmations and nothing else", () => {
    const pending = actionBranch(command, "supervision.pending");
    expect(pending).toContain(
      "where p.supervisor_id = p_actor_id and e.status = 'pending' and public.service_member_active(p.service_id, p_actor_id))",
    );
    expect(pending).toContain(
      "where p.supervisor_id = p_actor_id and n.confirmed_at is null and public.service_member_active(p.service_id, p_actor_id))",
    );
    expect(pending).toContain("return jsonb_build_object('count', v_count);");
    expect(pending).not.toMatch(/topics|session_date|minutes|display_name|teaching_audit/);
  });

  it("opens a series only to the same health service, from verified or demo teams on both sides (spec §5a)", () => {
    const open = functionBody("teaching_series_open_to");
    expect(open).toContain("where s.id = p_series_id and s.open_to = 'health_service'");
    expect(open).toContain(
      "join public.on_call_services hs on hs.id = s.service_id and (hs.verified_at is not null or hs.is_demo)",
    );
    expect(open).toContain("join public.teaching_team_settings vt on vt.health_service = ht.health_service");
    expect(open).toContain(
      "join public.on_call_services vs on vs.id = vt.service_id and (vs.verified_at is not null or vs.is_demo)",
    );
    expect(functionBody("teaching_occurrence_open_to")).toContain(
      "return public.teaching_series_open_to(v_series, p_actor_id);",
    );
  });

  it("lets a visitor read an opened session only, and counts visitors without naming them", () => {
    expect(command).toContain(
      "if v_role is null and not (p_action = 'session.read'\n      and public.teaching_occurrence_open_to(public.teaching_uuid_arg(p_payload, 'occurrenceId'), p_actor_id)) then",
    );
    const register = actionBranch(command, "register.read");
    expect(register).toContain("where a.occurrence_id = v_occ.id and not a.visitor), '[]'::jsonb),");
    expect(register.match(/'visitors', \(select count\(\*\)/g)).toHaveLength(2);
    const exported = actionBranch(command, "export.attendance");
    expect(exported.match(/where a\.service_id = p_service_id and not a\.visitor/g)).toHaveLength(2);
  });

  it("shows a visitor time, place, join link and materials only, flagged visitor, with no presenter name (R5, R15)", () => {
    const read = actionBranch(command, "session.read");
    expect(read).toContain("v_visitor := v_role is null;");
    expect(read).toContain("if v_visitor then v_is_presenter := false; end if;");
    expect(read).toContain("'visitor', v_visitor,");
    expect(read).toContain("'presenterName', case when v_visitor or v_occ.presenter_id is null then null else");
    // Code and counts hang off the presenter or a role, both of which a visitor lacks.
    expect(read).toContain("'canShowCode', v_is_presenter or coalesce(v_role = 'organiser', false),");
    expect(read).toContain(
      "'counts', case when v_is_presenter or v_role in ('organiser','admin') then jsonb_build_object(",
    );
  });

  it("sends the session fields the UI reads: seriesId, previousStartsAt, myAttendance, inCalendar and counts (R3, R9)", () => {
    const read = actionBranch(command, "session.read");
    expect(read).toContain("'seriesId', v_occ.series_id,");
    expect(read).toContain("'previousStartsAt', case when v_occ.status = 'moved' then v_occ.previous_starts_at end,");
    expect(read).toContain(
      "from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.user_id = p_actor_id),",
    );
    expect(read).toContain("'inCalendar', public.teaching_week_added(v_occ.id, p_actor_id),");
    expect(read).toContain("'expected', case when cardinality(coalesce(v_series.group_ids, '{}')) > 0 then");
    expect(read).toContain(
      "'visitors', (select count(*) from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.visitor)",
    );
    expect(actionBranch(command, "occurrence.change")).toContain(
      "previous_starts_at = case when v_starts <> v_occ.starts_at then v_occ.starts_at else v_occ.previous_starts_at end",
    );
  });

  it("takes an optional audience on series.save and returns it with openTo on organise.read (R3, R4, R6)", () => {
    // series.save checks the role and audits; the shared save (also import.commit's) does the rest.
    const branch = actionBranch(command, "series.save");
    expect(branch).toContain("if v_role <> 'organiser' then raise exception 'teaching_role_denied'; end if;");
    expect(branch).toContain("v_result := public.teaching_series_save(p_actor_id, p_service_id, p_payload);");
    const save = functionBody("teaching_series_save");
    expect(save).not.toMatch(/teaching_audit|v_role|pg_advisory/);
    expect(save).toContain(
      "or (p_payload ? 'audience' and coalesce(v_audience, '') not in ('interns','residents','registrars','consultants','all_doctors'))",
    );
    expect(save).toContain("coalesce(v_audience, 'all_doctors'), now(), p_actor_id)");
    expect(save).toContain("audience = coalesce(v_audience, audience),");
    expect(save).toContain("return jsonb_build_object('seriesId', v_series.id, 'occurrences', v_count);");
    expect(actionBranch(command, "group.save")).toContain("return jsonb_build_object('groupId', v_id);");
    expect(actionBranch(command, "organise.read")).toContain("'audience', s.audience, 'openTo', s.open_to,");
    const whatsOn = actionBranch(functionBody("teaching_whats_on_command"), "whats_on.read");
    expect(whatsOn).toContain("'audience', coalesce(ser.audience, 'all_doctors'))");
    expect(whatsOn).toContain("left join public.teaching_series ser on ser.id = o.series_id");
  });

  it("puts sessions added from What's on into Week and the feed, and keeps visitor rows in the visitor's own logbook", () => {
    const added =
      "public.teaching_week_added(o.id, p_actor_id) and public.teaching_occurrence_open_to(o.id, p_actor_id)";
    expect(actionBranch(command, "week.read")).toContain(added);
    expect(functionBody("teaching_feed_events")).toContain(added.replaceAll("p_actor_id", "p_owner_id"));
    for (const action of ["logbook.read", "cpd.unlogged"]) {
      expect(actionBranch(command, action), action).toContain(
        "(a.visitor or (m.user_id is not null and (m.revoked_at is null or",
      );
    }
  });

  it("pages the audit log by (at, id) and purges it after 12 months", () => {
    const audit = actionBranch(command, "audit.read");
    expect(audit).toContain("(e.at, e.id) < (v_before, v_before_id)");
    expect(audit).toContain("order by e.at desc, e.id desc");
    expect(audit).toContain("'actorId', x.actor_id");
    expect(sql).toContain("delete from public.teaching_audit_events where at < now() - interval '12 months';");
  });

  it("review focus 1: saving a series never touches attended, changed or used occurrences", () => {
    const generate = functionBody("teaching_series_generate");
    const update = generate.slice(
      generate.indexOf("update public.teaching_occurrences"),
      generate.indexOf("delete from public.teaching_occurrences"),
    );
    const remove = generate.slice(
      generate.indexOf("delete from public.teaching_occurrences"),
      generate.indexOf("insert into public.teaching_occurrences"),
    );
    for (const [label, part] of [
      ["update", update],
      ["delete", remove],
    ] as const) {
      expect(part, label).toContain("o.status = 'scheduled' and o.changed_at is null");
      expect(part, label).toContain("o.starts_at > now() + interval '15 minutes'");
      expect(part, label).toContain(
        "not exists (select 1 from public.teaching_attendance a where a.occurrence_id = o.id)",
      );
      expect(part, label).toContain(
        "not exists (select 1 from public.teaching_checkin_claims c where c.occurrence_id = o.id)",
      );
    }
    for (const table of [
      "teaching_notices",
      "teaching_readiness",
      "teaching_feedback_answers",
      "teaching_feedback_replied",
      "teaching_display_links",
    ]) {
      expect(remove, table).toContain(`not exists (select 1 from public.${table} `);
    }
    // Matching is by the rule date, so a moved or cancelled date is never recreated.
    expect(generate).toContain(
      "and not exists (select 1 from public.teaching_occurrences o where o.series_id = v_series.id and o.series_date = d);",
    );
    expect(generate).toContain("if cardinality(v_dates) > 60 then raise exception 'teaching_limit'; end if;");
  });

  it("review focus 3: works in Perth time and never in the database's UTC day", () => {
    expect(sql).not.toMatch(/current_date|now\(\)::date|localtimestamp|current_time\b/);
    const generate = functionBody("teaching_series_generate");
    expect(generate).toContain("(d + v_series.start_time) at time zone 'Australia/Perth'");
    expect(generate).toContain("(o.series_date + v_series.start_time) at time zone 'Australia/Perth'");
    expect(actionBranch(command, "week.read")).toContain(
      "o.starts_at >= (v_from::timestamp at time zone 'Australia/Perth')",
    );
    expect(actionBranch(command, "week.read")).toContain(
      "o.starts_at < ((v_to + 1)::timestamp at time zone 'Australia/Perth')",
    );
  });

  it("review focus 4: never casts a raw payload value", () => {
    for (const body of [command, functionBody("teaching_depth_command")]) {
      expect(body).not.toMatch(/p_payload->>'\w+'\)::(?!boolean\b|numeric\b)/);
      expect(body).not.toMatch(/p_payload->>'\w+'::/);
    }
    expect(actionBranch(command, "calendar.set")).toContain(
      "if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'teaching_invalid_request'; end if;",
    );
  });
});

describe("teaching migration: depth decisions (R23)", () => {
  const command = functionBody("teaching_command");
  const depth = functionBody("teaching_depth_command");
  const blocks = tableBlocks();

  it("handles import.commit all or nothing, for organisers and admins, through the shared series save", () => {
    expect(depth).toContain("'feedback.submit','feedback.totals','import.commit') then");
    expect(depth).toContain("if p_action in ('pairing.save','pairing.reassign','import.commit') then");
    const commit = actionBranch(depth, "import.commit");
    expect(commit).toContain(
      "if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;",
    );
    expect(commit).toContain("jsonb_array_length(p_payload->'rows') not between 1 and 200");
    expect(commit).toContain("if jsonb_typeof(v_row) is distinct from 'object' or v_row ? 'seriesId' then");
    expect(commit).toContain("v_result := public.teaching_series_save(p_actor_id, p_service_id, v_row);");
    expect(commit).toContain("public.teaching_audit(p_service_id, p_actor_id, 'series.save'");
    expect(commit).toContain("public.teaching_audit(p_service_id, p_actor_id, 'import.commit', null)");
    // No exception handler: one refused row aborts the statement, so nothing before it is kept.
    expect(commit).not.toMatch(/exception when/);
    // Pairings stay open to admins, including a pairing that includes the admin.
    expect(actionBranch(depth, "pairing.save")).toContain("if not (v_role = 'admin' or (v_role = 'organiser' and");
  });

  it("reads a presenter's own talks and the feedback still owed, across the actor's active teams", () => {
    const teach = actionBranch(command, "teach.read");
    expect(teach).toContain(
      "where o.presenter_id = p_actor_id and o.ends_at > now() and o.starts_at < now() + interval '90 days'",
    );
    expect(teach).toContain(
      "'items', coalesce(to_jsonb(r.items), '[]'::jsonb), 'deidConfirmedAt', r.deid_confirmed_at)",
    );
    expect(teach).toContain("order by o.starts_at desc, o.id limit 50");
    const open = actionBranch(command, "feedback.open");
    expect(open).toContain("and o.ends_at <= now() and o.ends_at > now() - interval '7 days'");
    // The same one-way marker feedback.submit writes; nothing new ties a person to an answer.
    const marker =
      "convert_to('teaching-feedback:' || o.id::text || ':' || p_actor_id::text, 'UTF8'), 'sha256'), 'hex')";
    expect(open).toContain(marker);
    expect(actionBranch(depth, "feedback.submit")).toContain(marker.replace("o.id::text", "v_occ.id::text"));
    expect(open).not.toMatch(/teaching_feedback_answers|teaching_audit/);
  });

  it("adds presenting to week.read's teams for the pages sheet", () => {
    expect(actionBranch(command, "week.read")).toContain(
      "'presenting', exists (select 1 from public.teaching_occurrences o\n              where o.service_id = t.id and o.presenter_id = p_actor_id and o.status <> 'cancelled'\n                and o.ends_at > now() and o.starts_at < now() + interval '90 days')",
    );
  });

  it("takes none to five supervision topics, in the table, the log and a correction", () => {
    const entries = (blocks.get("teaching_supervision_entries") ?? []).join("\n");
    expect(entries).toContain("topics text[] not null check (cardinality(topics) between 0 and 5 and topics <@");
    expect(actionBranch(depth, "supervision.log")).toContain("or cardinality(v_topics) not between 0 and 5");
    expect(functionBody("teaching_valid_correction")).toContain(
      "else jsonb_array_length(p_value->'topics') between 0 and 5",
    );
    expect(sql).not.toMatch(/cardinality\((v_)?topics\) (not )?between 1|'topics'\) between 1/);
  });

  it("uses the four approved readiness items and keeps the cases-checked confirmation", () => {
    const readiness = (blocks.get("teaching_readiness") ?? []).join("\n");
    expect(readiness).toContain(
      "items text[] not null default '{}' check (items <@ array['reading_list','aims','slides_link','room']::text[]),",
    );
    expect(readiness).toContain("deid_confirmed_at timestamptz,");
    expect(actionBranch(depth, "readiness.set")).toContain(
      "if v_text is null or v_text not in ('reading_list','aims','slides_link','room')",
    );
    expect(sql).not.toMatch(/slides_ready|room_confirmed|join_link_tested|materials_linked|reading_list_set/);
  });

  it("hides a session's slides from all but its presenter and organisers until its cases are checked", () => {
    const released = functionBody("teaching_slides_released");
    expect(released).toContain("r.deid_confirmed_at is not null");
    expect(released).toContain("(p_actor_id is not null and v_occ.presenter_id is not distinct from p_actor_id)");
    expect(released).toContain(
      "coalesce(public.teaching_member_role(v_occ.service_id, p_actor_id) = 'organiser', false)",
    );
    expect(released).not.toMatch(/'admin'/);
    const visible = functionBody("teaching_resource_visible");
    const gate = visible.indexOf("if v_resource.kind = 'slides' and v_resource.occurrence_id is not null");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(visible.indexOf("public.service_member_active(v_resource.service_id, p_actor_id)"));
    // Every resource read goes through the visibility check, including a team collection's items.
    const whatsOn = functionBody("teaching_whats_on_command");
    const collection = actionBranch(whatsOn, "collection.read");
    expect(collection).toContain(
      "from public.teaching_resources r where r.collection_id = v_collection.id and r.removed_at is null\n              and public.teaching_resource_visible(r.id, p_actor_id)",
    );
  });

  it("audits an organiser's whole-team supervision read once, and lets a leaver read their own for 90 days", () => {
    const read = actionBranch(depth, "supervision.read");
    expect(read).toContain(
      "if v_id is null and v_role = 'organiser' then\n      -- An organiser's whole-team read (Logbook, Today): one service-level row per call.\n      perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.read', null);",
    );
    expect(depth).toContain(
      "v_leaver := p_action = 'supervision.read' and exists (select 1 from public.on_call_service_members m\n      where m.service_id = p_service_id and m.user_id = p_actor_id\n        and m.revoked_at is not null and m.revoked_at > now() - interval '90 days');",
    );
    expect(depth).toContain("if not v_leaver then raise exception 'teaching_access_denied'; end if;");
    // A leaver sees only pairings where they are the registrar.
    expect(read).toContain(
      "and (p.registrar_id = p_actor_id or (not v_leaver and (p.supervisor_id = p_actor_id or v_role = 'organiser')));",
    );
    // Totals stay organiser-only.
    expect(actionBranch(depth, "feedback.totals")).toContain(
      "if not (v_occ.presenter_id = p_actor_id or v_role = 'organiser')",
    );
  });

  it("lists the teams a leaver can still read supervision in, as registrar with entries, for 90 days and nothing more", () => {
    const left = actionBranch(command, "supervision.left_services");
    expect(left).not.toBe("");
    // Keyed on the caller's own shared membership, left within supervision.read's leaver window.
    expect(left).toContain(
      "where m.user_id = p_actor_id\n        and m.revoked_at is not null and m.revoked_at > now() - interval '90 days'",
    );
    // Only where the caller is the registrar on a pairing that has entries (never as supervisor).
    expect(left).toContain(
      "where p.service_id = m.service_id and p.registrar_id = p_actor_id\n            and exists (select 1 from public.teaching_supervision_entries e where e.pairing_id = p.id));",
    );
    expect(left).toContain("'readableUntil', m.revoked_at + interval '90 days'");
    // Team and dates only: exactly these keys, no pairing details, no other people, no audit, no lock.
    const keys = [...left.matchAll(/'(\w+)', /g)].map((match) => match[1]).sort();
    expect(keys).toEqual(["leftAt", "readableUntil", "serviceId", "serviceName", "services"]);
    expect(left).not.toMatch(/supervisor_id|display_name|topics|minutes|teaching_audit|for share|pg_advisory/);
  });
});

describe("teaching migration: admins may export attendance (20261016134500)", () => {
  const followUpName = "20261016134500_teaching_admin_attendance_export.sql";
  const followUp = readFileSync(`supabase/migrations/${followUpName}`, "utf8");
  const oldGuard = "if v_role <> 'organiser' then raise exception 'teaching_role_denied'; end if;";
  const newGuard = "if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;";

  /** One `create [or replace] function public.teaching_command(` definition, through its grant line. */
  function commandDefinition(text: string, opener: string): string {
    const start = text.indexOf(`${opener} public.teaching_command(`);
    if (start < 0) return "";
    const grant = "grant execute on function public.teaching_command(uuid, uuid, text, jsonb) to service_role;";
    const end = text.indexOf(grant, start);
    return end < 0 ? "" : text.slice(start, end + grant.length);
  }

  const original = commandDefinition(sql, "create function");
  const replaced = commandDefinition(followUp, "create or replace function");

  it("lets an organiser or an admin export attendance, and still refuses every other role", () => {
    const exported = actionBranch(replaced, "export.attendance");
    expect(exported).not.toBe("");
    // The role check is an allow-list, so 'doctor' (the default role) and any other role are refused.
    expect(exported).toContain(`p_action = 'export.attendance' then\n    ${newGuard}`);
    expect(exported).not.toContain(oldGuard);
    expect(exported.match(/v_role/g)).toHaveLength(1);
    expect(exported).not.toContain("doctor");
    // The original branch was organiser-only.
    expect(actionBranch(original, "export.attendance")).toContain(oldGuard);
  });

  it("changes nothing else in teaching_command, and restates the same grants", () => {
    expect(original).not.toBe("");
    expect(replaced).not.toBe("");
    const expected = original
      .replace("create function public.teaching_command(", "create or replace function public.teaching_command(")
      .replace(
        `elsif p_action = 'export.attendance' then\n    ${oldGuard}`,
        `elsif p_action = 'export.attendance' then\n    ${newGuard}`,
      );
    expect(expected).not.toBe(original);
    expect(replaced).toBe(expected);
    expect(replaced).toContain(
      "revoke all on function public.teaching_command(uuid, uuid, text, jsonb) from public, anon, authenticated;",
    );
  });

  it("is recorded in the teaching_command migration chain", () => {
    const redefiners = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .filter((name) =>
        /create (or replace )?function public\.teaching_command\(/.test(
          readFileSync(`supabase/migrations/${name}`, "utf8"),
        ),
      )
      .sort();
    expect(redefiners).toContain(followUpName);
  });
});

describe("teaching migration: display.revoke null creator guard (20261017120000)", () => {
  const prevName = "20261016134500_teaching_admin_attendance_export.sql";
  const followUpName = "20261017120000_teaching_display_revoke_null_creator_guard.sql";
  const prevSql = readFileSync(`supabase/migrations/${prevName}`, "utf8");
  const followUp = readFileSync(`supabase/migrations/${followUpName}`, "utf8");
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const oldRevokeGuard =
    "if not (v_link.created_by = p_actor_id or v_role = 'organiser') then raise exception 'teaching_role_denied'; end if;";
  const newRevokeGuard =
    "if coalesce(v_link.created_by = p_actor_id, false) is not true and v_role <> 'organiser' then raise exception 'teaching_role_denied'; end if;";

  function commandDefinition(text: string, opener: string): string {
    const start = text.indexOf(`${opener} public.teaching_command(`);
    if (start < 0) return "";
    const grant = "grant execute on function public.teaching_command(uuid, uuid, text, jsonb) to service_role;";
    const end = text.indexOf(grant, start);
    return end < 0 ? "" : text.slice(start, end + grant.length);
  }

  const prevDef = commandDefinition(prevSql, "create or replace function");
  const replaced = commandDefinition(followUp, "create or replace function");

  it("denies non-organisers when display link created_by is NULL", () => {
    const revokeBranch = actionBranch(replaced, "display.revoke");
    expect(revokeBranch).not.toBe("");
    expect(revokeBranch).toContain(newRevokeGuard);
    expect(revokeBranch).not.toContain(oldRevokeGuard);
    expect(actionBranch(prevDef, "display.revoke")).toContain(oldRevokeGuard);
  });

  it("changes nothing else in teaching_command from 20261016134500, and restates the same grants", () => {
    expect(prevDef).not.toBe("");
    expect(replaced).not.toBe("");
    const expected = prevDef.replace(oldRevokeGuard, newRevokeGuard);
    expect(expected).not.toBe(prevDef);
    expect(replaced).toBe(expected);
    expect(replaced).toContain(
      "revoke all on function public.teaching_command(uuid, uuid, text, jsonb) from public, anon, authenticated;",
    );
  });

  it("is the latest definition of teaching_command, and schema.sql mirrors it", () => {
    const redefiners = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .filter((name) =>
        /create (or replace )?function public\.teaching_command\(/.test(
          readFileSync(`supabase/migrations/${name}`, "utf8"),
        ),
      )
      .sort();
    expect(redefiners.at(-1)).toBe(followUpName);
    expect(commandDefinition(schema, "create function")).toBe(
      replaced.replace("create or replace function", "create function"),
    );
  });
});
