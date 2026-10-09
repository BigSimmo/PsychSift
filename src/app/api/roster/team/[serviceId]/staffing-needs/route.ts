import { z } from "zod";

import type { StaffingNeed } from "@/lib/roster/staffing/team-staffing";
import { withRosterApi, type RosterAdminClient } from "@/lib/roster/team/api";
import { demoRosterRead } from "@/lib/roster/team/demo-team";
import { rosterInvalidRequest, rosterUnavailable } from "@/lib/roster/team/errors";
import { rosterRead } from "@/lib/roster/team/repository";

export const runtime = "nodejs";

/**
 * The team's safe number for its doctors: the cover needs the roster manager
 * set (weekday or date, kind, grade, site, how many), and nothing else. No
 * ids, no names, no shifts. The `maker` read that also returns them is
 * manager-only, so this route is the member-safe read the leave staffing check
 * uses.
 *
 * The actor comes from the session only (`withRosterApi`, which also applies
 * the `roster` rate limit and the release hold). Before the needs are read with
 * the admin client, `roster_read` must accept the actor for this team: an
 * active, unrevoked member of a confirmed (verified or demo) team, exactly as
 * for every other team read. A query string of any kind is refused, so no
 * parameter can name another actor.
 */

type Context = { params: Promise<{ serviceId: string }> };

const NEED_KINDS = ["day", "evening", "night", "on_call", "other"] as const;
/** Read a page at a time: the API returns at most 1,000 rows per read, and the database stops a team at 2,000 needs. */
const NEEDS_PAGE = 1000;
const NEEDS_PAGES = 3;

async function serviceIdFrom(request: Request, context: Context): Promise<string> {
  if (new URL(request.url).search) throw rosterInvalidRequest();
  const parsed = z.uuid().safeParse((await context.params).serviceId);
  if (!parsed.success) throw rosterInvalidRequest("Unknown team.");
  return parsed.data;
}

/**
 * The actor may read this team: the same `roster_read` check every other team
 * read makes (an active, unrevoked member of `on_call_service_members`, on a
 * team that is verified or demo), through its security-invoker RPC rather than
 * a direct membership query. It throws the public roster error otherwise. The
 * overview it returns holds no one else's name and is not passed on.
 */
async function requireActiveMember(client: RosterAdminClient, actorId: string, serviceId: string): Promise<void> {
  await rosterRead(client, actorId, serviceId, "overview");
}

async function readStaffingNeeds(
  client: RosterAdminClient,
  actorId: string,
  serviceId: string,
): Promise<{ needs: StaffingNeed[] }> {
  await requireActiveMember(client, actorId, serviceId);
  // Every need, never a cut-off list: a missing dated need would judge a day against the wrong number.
  const needs: StaffingNeed[] = [];
  for (let page = 0; ; page += 1) {
    if (page === NEEDS_PAGES) throw rosterUnavailable();
    const { data, error } = await client
      .from("roster_staffing_needs")
      .select("weekday,on_date,kind,grade,site_id,needed")
      .eq("service_id", serviceId)
      .order("on_date", { ascending: true, nullsFirst: true })
      .order("weekday", { ascending: true, nullsFirst: false })
      .order("kind", { ascending: true })
      .order("id", { ascending: true })
      .range(page * NEEDS_PAGE, page * NEEDS_PAGE + NEEDS_PAGE - 1);
    if (error || !data) throw rosterUnavailable();
    for (const row of data) {
      if (!(NEED_KINDS as readonly string[]).includes(row.kind)) continue;
      needs.push({
        weekday: row.weekday,
        date: row.on_date,
        kind: row.kind,
        grade: row.grade,
        siteId: row.site_id,
        needed: row.needed,
      });
    }
    if (data.length < NEEDS_PAGE) break;
  }
  return { needs };
}

/** The invented sample team's needs, the same ones its manager sees on the Cover tab, without ids. */
function demoStaffingNeeds(): { needs: StaffingNeed[] } {
  return {
    needs: demoRosterRead("maker", {}).needs.map((need) => ({
      weekday: need.weekday,
      date: need.date,
      kind: need.kind,
      grade: need.grade,
      siteId: need.siteId,
      needed: need.needed,
    })),
  };
}

export async function GET(request: Request, context: Context) {
  return withRosterApi(
    request,
    async (client, actorId) => readStaffingNeeds(client, actorId, await serviceIdFrom(request, context)),
    {
      demo: () => demoStaffingNeeds(),
      sample: async () => {
        await serviceIdFrom(request, context);
        return demoStaffingNeeds();
      },
    },
  );
}
