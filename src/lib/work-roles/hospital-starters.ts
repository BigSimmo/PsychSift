import "server-only";

import { selectNewJobRows } from "@/lib/admin/help-items";
import { selectNewJobStart } from "@/lib/admin/new-job-progress";
import { PublicApiError } from "@/lib/http";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { rowMayBeComplianceRequirement, rowToOnCallEntry } from "@/lib/on-call/repository";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { HospitalStarter, HospitalStartersView } from "@/lib/work-roles/hospital-starters-model";
import { notReady } from "@/lib/work-roles/people";
import { can, isMissingTableError, type WorkRoleContext } from "@/lib/work-roles/server";

/**
 * New starters across a hospital, for Medical Workforce (and the site
 * administrator), held by the `starters.view` capability.
 *
 * Owner request (10 Oct 2026): a doctor's New job progress reaches Medical Workforce only when that
 * doctor turned on "Share my progress with Medical Workforce" on their own New job page. It is off
 * until they do, and turning it off stops it at the next read, because the choice is read here on
 * every request and nothing is cached.
 *
 * Who is listed: active members (`revoked_at` is null) of the teams linked to this hospital in
 * `work_hospital_teams`, whose own choice in `user_preferences.preferences.starterSharing` is on.
 * Nobody else's New job rows are read at all.
 *
 * What is sent for each: the name their team knows them by, those team names, the start date they
 * entered, and for their NON-personal New job items only, how many there are, how many are ticked
 * done and the titles still to do. A personal item never leaves this function, not even in a count.
 * No other detail field, no body, no subtitle and no compliance record is sent. The start date is
 * the one the doctor's own New job page shows, wherever it is stored, because they agreed to share it.
 *
 * Every read is paged and id lists are sent in batches, so a big hospital is never silently cut off
 * at the API's 1,000-row page. A read that cannot finish fails with an error rather than returning
 * part of the list.
 */

type Client = ReturnType<typeof createAdminClient>;

/** The API's page size, and the size of each `.in()` id batch (kept well below URL limits). */
export const STARTERS_PAGE_SIZE = 1000;
export const STARTERS_ID_BATCH = 200;
/** A hard stop, so a misbehaving page can never loop forever. Reaching it is an error, not a cut-off. */
const MAX_PAGES = 200;

function unavailable(): PublicApiError {
  return new PublicApiError("New starters could not be loaded. Try again shortly.", 503, {
    code: "work_starters_unavailable",
  });
}

type PageResult<T> = { data: T[] | null; error: unknown };

/** Reads every page of one query, until a short page comes back. */
async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * STARTERS_PAGE_SIZE;
    const { data, error } = await page(from, from + STARTERS_PAGE_SIZE - 1);
    if (error || !data) throw unavailable();
    rows.push(...data);
    if (data.length < STARTERS_PAGE_SIZE) return rows;
  }
  throw unavailable();
}

function batches<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < list.length; start += STARTERS_ID_BATCH)
    out.push(list.slice(start, start + STARTERS_ID_BATCH));
  return out;
}

/** Every batch's pages, in order. */
async function readBatched<T>(
  ids: readonly string[],
  page: (batch: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (const batch of batches(ids)) rows.push(...(await readAllPages((from, to) => page(batch, from, to))));
  return rows;
}

/** The columns the summary needs. `body`, `subtitle`, links and tags are never read. */
const ENTRY_COLUMNS = "id,owner_id,section,slug,title,details,is_personal,sort_order,last_verified_at";

type EntryRow = Record<string, unknown> & { owner_id: string };

function isDoneStep(entry: OnCallEntry): boolean {
  const details = entry.details;
  return typeof details === "object" && details !== null && (details as { done?: unknown }).done === true;
}

/**
 * One doctor's summary from their own `logistics` rows. The start date comes from the same
 * selection their New job page makes. The items, counts and titles come from shared rows only:
 * a personal row, or a row that might be a compliance record, is left out entirely.
 */
export function summariseStarterRows(
  rows: readonly Record<string, unknown>[],
): Pick<HospitalStarter, "startsOn" | "done" | "total" | "toDo"> {
  const parsed: { entry: OnCallEntry; raw: Record<string, unknown> }[] = [];
  for (const raw of rows) {
    try {
      parsed.push({ entry: rowToOnCallEntry(raw), raw });
    } catch {
      // A row that does not parse is not shown, the same as on the doctor's own page.
    }
  }
  const own = parsed.map((row) => row.entry);
  const start = selectNewJobStart({ own, shared: [] });
  const rawById = new Map(parsed.map((row) => [row.entry.id, row.raw]));
  const steps = selectNewJobRows({ own, shared: [] })
    .logins.map((row) => row.entry)
    .filter((entry) => !entry.isPersonal && !rowMayBeComplianceRequirement(rawById.get(entry.id) ?? {}));
  return {
    startsOn: start?.startsOn ?? null,
    done: steps.filter(isDoneStep).length,
    total: steps.length,
    toDo: steps.filter((entry) => !isDoneStep(entry)).map((entry) => entry.title),
  };
}

export async function readHospitalStarters(
  client: Client,
  context: WorkRoleContext,
  hospitalId: string,
): Promise<HospitalStartersView> {
  if (!context.ready) throw notReady();
  if (!can(context, "starters.view", { kind: "hospital", hospitalId })) {
    throw new PublicApiError("You don't have the role needed for this.", 403, { code: "work_role_required" });
  }
  const hospital = await client.from("work_hospitals").select("id,name").eq("id", hospitalId).is("archived_at", null);
  if (isMissingTableError(hospital.error)) throw notReady();
  if (hospital.error || !hospital.data) throw unavailable();
  if (!hospital.data[0])
    throw new PublicApiError("That hospital is unavailable.", 404, { code: "work_hospital_not_found" });

  const links = await client.from("work_hospital_teams").select("service_id").eq("hospital_id", hospitalId);
  if (links.error || !links.data) throw unavailable();
  const serviceIds = [...new Set(links.data.map((row) => row.service_id))];
  if (!serviceIds.length) return { hospital: hospital.data[0], teams: [], starters: [] };

  const services = await readBatched(serviceIds, (batch, from, to) =>
    client.from("on_call_services").select("id,name").in("id", batch).order("id").range(from, to),
  );
  const teamNames = new Map(services.map((row) => [row.id, row.name]));
  const teams = services
    .map((row) => ({ serviceId: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Active members of the linked teams only. A revoked membership is not a member.
  const members = await readBatched(serviceIds, (batch, from, to) =>
    client
      .from("on_call_service_members")
      .select("service_id,user_id,display_name")
      .in("service_id", batch)
      .is("revoked_at", null)
      .order("service_id")
      .order("user_id")
      .range(from, to),
  );
  const memberIds = [...new Set(members.map((row) => row.user_id))];
  if (!memberIds.length) return { hospital: hospital.data[0], teams, starters: [] };

  // Only the one choice is read from each member's preferences, never the rest of the row.
  // The JSON path is typed by hand: the generated types cannot follow a path into `preferences`.
  type Choice = { user_id: string; workforce: string | null };
  type ChoiceQuery = {
    select(columns: string): {
      in(
        column: "user_id",
        ids: string[],
      ): {
        order(column: "user_id"): { range(from: number, to: number): PromiseLike<PageResult<Choice>> };
      };
    };
  };
  // A fresh query for every page: a query builder is not reused.
  const choices = await readBatched<Choice>(memberIds, (batch, from, to) =>
    (client.from("user_preferences") as unknown as ChoiceQuery)
      .select("user_id,workforce:preferences->starterSharing->>workforce")
      .in("user_id", batch)
      .order("user_id")
      .range(from, to),
  );
  const sharing = new Set(
    choices.flatMap((row) => (row.workforce === "true" && typeof row.user_id === "string" ? [row.user_id] : [])),
  );
  const sharers = memberIds.filter((id) => sharing.has(id));
  if (!sharers.length) return { hospital: hospital.data[0], teams, starters: [] };

  // New job rows are `logistics` rows; only the sharers' own rows are read.
  const entries = await readBatched(sharers, (batch, from, to) =>
    client
      .from("on_call_entries")
      .select(ENTRY_COLUMNS)
      .in("owner_id", batch)
      .eq("section", "logistics")
      .order("owner_id")
      .order("sort_order")
      .order("id")
      .range(from, to),
  );
  const rowsByOwner = new Map<string, Record<string, unknown>[]>();
  for (const row of entries as unknown as EntryRow[]) {
    if (!sharing.has(row.owner_id)) continue;
    const list = rowsByOwner.get(row.owner_id);
    if (list) list.push(row);
    else rowsByOwner.set(row.owner_id, [row]);
  }

  const membershipsByUser = new Map<string, typeof members>();
  for (const row of members) {
    const list = membershipsByUser.get(row.user_id);
    if (list) list.push(row);
    else membershipsByUser.set(row.user_id, [row]);
  }
  const starters: HospitalStarter[] = sharers.map((userId) => {
    const memberships = membershipsByUser.get(userId) ?? [];
    const name = memberships.map((row) => row.display_name?.trim()).find(Boolean) || "Team member";
    const teamList = [
      ...new Set(memberships.flatMap((row) => (teamNames.has(row.service_id) ? [teamNames.get(row.service_id)!] : []))),
    ].sort((a, b) => a.localeCompare(b));
    return { id: userId, name, teams: teamList, ...summariseStarterRows(rowsByOwner.get(userId) ?? []) };
  });
  starters.sort(
    (a, b) =>
      (a.startsOn ?? "9999-12-31").localeCompare(b.startsOn ?? "9999-12-31") ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );

  return { hospital: hospital.data[0], teams, starters };
}
