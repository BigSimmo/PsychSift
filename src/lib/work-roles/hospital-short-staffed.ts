import "server-only";

import { PublicApiError } from "@/lib/http";
import {
  STAFFING_NEEDS_PAGE,
  STAFFING_NEEDS_PER_TEAM_LIMIT,
  staffingNeedFromRow,
} from "@/lib/roster/staffing/staffing-need-rows";
import {
  belowSafeDays,
  hasSafeNumber,
  judgeDay,
  safeNumberOn,
  staffingDays,
  type CountedKind,
  type StaffingNeed,
} from "@/lib/roster/staffing/team-staffing";
import { ROSTER_ASSIGNMENT_KINDS, type RosterAssignment } from "@/lib/roster/team/model";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  shortStaffedWindow,
  type HospitalShortStaffedView,
  type ShortStaffedDay,
  type ShortStaffedTeam,
} from "@/lib/work-roles/hospital-short-staffed-view";
import { notReady } from "@/lib/work-roles/people";
import { can, isMissingTableError, type WorkRoleContext } from "@/lib/work-roles/server";
import { zonedWallToIso } from "@/lib/work-time/format";
import { DEFAULT_WORK_TIME_ZONE } from "@/lib/work-time/zones";

/**
 * Short-staffed days across a hospital, for Medical Workforce (and the site
 * administrator). For every team linked to the hospital: its safe number (the
 * Day and Evening cover its roster manager set), who is on each day from today
 * through four weeks, and how far its published roster reaches. A day past the
 * published roster is not rostered yet, never short. Only counts and team
 * names leave this file: never a name, a leave row or a reason.
 *
 * One read for the hospital's teams, then the team names, needs, shifts and
 * publications each across every team at once, each paged so a big hospital is
 * never cut off at the API's 1,000 rows. A read that would pass its ceiling
 * fails instead of answering with part of the hospital.
 */

type Client = ReturnType<typeof createAdminClient>;

/** The API returns at most 1,000 rows per read. */
const PAGE = STAFFING_NEEDS_PAGE;
/** Ceilings that fail the read rather than cut it short. Far above any real hospital. */
const MAX_TEAMS = 5_000;
const MAX_SHIFTS = 200_000;
const MAX_PUBLICATIONS = 100_000;

const COUNTED: readonly CountedKind[] = ["day", "evening"];

function unavailable(): PublicApiError {
  return new PublicApiError("Short-staffed days could not be loaded. Try again shortly.", 503, {
    code: "work_short_staffed_unavailable",
  });
}

function tooMany(): PublicApiError {
  return new PublicApiError("This hospital has too many shifts to check at once.", 503, {
    code: "work_short_staffed_too_many",
  });
}

type PageResult<Row> = PromiseLike<{ data: Row[] | null; error: unknown }>;

/** Every row a query has, a page at a time, in the query's own stable order. */
async function readEvery<Row>(page: (from: number, to: number) => PageResult<Row>, maxRows: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await page(start, start + PAGE - 1);
    if (error || !data) throw unavailable();
    rows.push(...data);
    // Checked after the read, so exactly maxRows rows still loads and one more is refused.
    if (rows.length > maxRows) throw tooMany();
    if (data.length < PAGE) return rows;
  }
}

function groupBy<Row>(rows: readonly Row[], key: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const list = groups.get(key(row));
    if (list) list.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export async function readHospitalShortStaffed(
  client: Client,
  context: WorkRoleContext,
  hospitalId: string,
  now = new Date(),
): Promise<HospitalShortStaffedView> {
  if (!context.ready) throw notReady();
  if (!can(context, "staffing.overview", { kind: "hospital", hospitalId })) {
    throw new PublicApiError("You don't have the role needed for this.", 403, { code: "work_role_required" });
  }
  const hospital = await client.from("work_hospitals").select("id,name").eq("id", hospitalId).is("archived_at", null);
  if (isMissingTableError(hospital.error)) throw notReady();
  if (hospital.error || !hospital.data) throw unavailable();
  if (!hospital.data[0])
    throw new PublicApiError("That hospital is unavailable.", 404, { code: "work_hospital_not_found" });

  const zone = DEFAULT_WORK_TIME_ZONE;
  const window = shortStaffedWindow(now, zone);
  const links = await readEvery(
    (from, to) =>
      client
        .from("work_hospital_teams")
        .select("service_id")
        .eq("hospital_id", hospitalId)
        .order("service_id")
        .range(from, to),
    MAX_TEAMS,
  );
  const serviceIds = [...new Set(links.map((row) => row.service_id))];
  if (!serviceIds.length) return { hospital: hospital.data[0], window, teams: [], days: [] };

  const fromIso = zonedWallToIso(window.from, "00:00", zone);
  const toIso = zonedWallToIso(addDays(window.to, 1), "00:00", zone);
  if (!fromIso || !toIso) throw unavailable();

  const [services, needRows, shiftRows, publications] = await Promise.all([
    readEvery(
      (from, to) => client.from("on_call_services").select("id,name").in("id", serviceIds).order("id").range(from, to),
      MAX_TEAMS,
    ),
    readEvery(
      (from, to) =>
        client
          .from("roster_staffing_needs")
          .select("service_id,weekday,on_date,kind,grade,site_id,needed")
          .in("service_id", serviceIds)
          .order("service_id")
          .order("id")
          .range(from, to),
      // One page more than every team's full allowance, so a full hospital still reads to the end.
      serviceIds.length * STAFFING_NEEDS_PER_TEAM_LIMIT + PAGE,
    ),
    readEvery(
      (from, to) =>
        client
          .from("roster_assignments")
          .select("id,service_id,user_id,roster_name,starts_at,kind")
          .in("service_id", serviceIds)
          .is("superseded_at", null)
          .gte("starts_at", fromIso)
          .lt("starts_at", toIso)
          .order("service_id")
          .order("starts_at")
          .order("id")
          .range(from, to),
      MAX_SHIFTS,
    ),
    readEvery(
      (from, to) =>
        client
          .from("roster_publications")
          .select("id,service_id,version,period_end")
          .in("service_id", serviceIds)
          .order("service_id")
          .order("id")
          .range(from, to),
      MAX_PUBLICATIONS,
    ),
  ]);

  const needsByTeam = new Map<string, StaffingNeed[]>();
  for (const row of needRows) {
    const need = staffingNeedFromRow(row);
    if (!need) continue;
    const list = needsByTeam.get(row.service_id);
    if (list) list.push(need);
    else needsByTeam.set(row.service_id, [need]);
  }

  // The published roster reaches the end of the team's latest publication, as the team's own overview says.
  const latest = new Map<string, { version: number; periodEnd: string }>();
  for (const row of publications) {
    const held = latest.get(row.service_id);
    if (!held || row.version > held.version)
      latest.set(row.service_id, { version: row.version, periodEnd: row.period_end });
  }

  const shiftsByTeam = groupBy(
    shiftRows.flatMap((row): (RosterAssignment & { serviceId: string })[] => {
      const kind = ROSTER_ASSIGNMENT_KINDS.find((entry) => entry === row.kind);
      if (!kind) return [];
      // Only what counting people needs. The roster name stands in for someone without an account.
      return [
        {
          serviceId: row.service_id,
          id: row.id,
          userId: row.user_id,
          name: row.roster_name,
          grade: null,
          siteId: null,
          siteName: null,
          startsAt: row.starts_at,
          endsAt: row.starts_at,
          shiftCode: "",
          kind,
        },
      ];
    }),
    (row) => row.serviceId,
  );

  const names = new Map(services.map((row) => [row.id, row.name]));
  const teams: ShortStaffedTeam[] = [];
  const days: ShortStaffedDay[] = [];
  for (const serviceId of serviceIds) {
    if (!names.has(serviceId)) continue;
    const name = names.get(serviceId) ?? "Team";
    const needs = needsByTeam.get(serviceId) ?? [];
    const knownThrough = latest.get(serviceId)?.periodEnd ?? null;
    const counted = staffingDays(shiftsByTeam.get(serviceId) ?? [], window, { actorId: null, knownThrough });
    const known = counted.filter((day) => day.on !== null);
    teams.push({
      serviceId,
      name,
      safeNumber: hasSafeNumber(needs),
      checkedThrough: known.length ? known[known.length - 1]!.date : null,
    });
    const below = new Set(belowSafeDays(counted, null, needs));
    for (const day of counted) {
      if (!below.has(day.date)) continue;
      const judgement = judgeDay(day, needs, false);
      if (!judgement?.below) continue;
      const safe = safeNumberOn(day.date, needs);
      days.push({
        date: day.date,
        serviceId,
        teamName: name,
        on: judgement.on,
        needed: judgement.needed,
        short: judgement.short,
        kinds: COUNTED.filter((kind) => safe[kind] !== undefined),
      });
    }
  }

  return {
    hospital: hospital.data[0],
    window,
    teams: teams.sort((a, b) => a.name.localeCompare(b.name)),
    days: days.sort((a, b) => a.date.localeCompare(b.date) || a.teamName.localeCompare(b.teamName)),
  };
}
