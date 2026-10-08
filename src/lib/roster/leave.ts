import "server-only";

import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import { ROSTER_LEAVE_KINDS } from "@/lib/roster/leave-kinds";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterAdminClient } from "@/lib/roster/team/api";
import { rosterRead } from "@/lib/roster/team/repository";

const uuid = z.uuid();
const isoDate = z.iso.date();
const leaveKind = z.enum(ROSTER_LEAVE_KINDS);
const leaveStatus = z.enum(["planned", "applied", "approved"]);

export const createLeaveSchema = z
  .object({
    kind: leaveKind,
    startsOn: isoDate,
    endsOn: isoDate,
    status: leaveStatus,
    serviceId: uuid.nullable(),
  })
  .strict();
export const updateLeaveSchema = z
  .object({
    id: uuid,
    status: leaveStatus.optional(),
    startsOn: isoDate.optional(),
    endsOn: isoDate.optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.startsOn !== undefined || value.endsOn !== undefined);
export const deleteLeaveSchema = z.object({ id: uuid }).strict();

export type RosterLeave = {
  id: string;
  kind: z.infer<typeof leaveKind>;
  startsOn: string;
  endsOn: string;
  status: z.infer<typeof leaveStatus>;
  serviceId: string | null;
};

type LeaveRow = {
  id: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  status: string;
  service_id: string | null;
};

function publicLeave(row: LeaveRow): RosterLeave {
  return {
    id: row.id,
    kind: leaveKind.parse(row.kind),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: leaveStatus.parse(row.status),
    serviceId: row.service_id,
  };
}

function unavailable(): PublicApiError {
  return new PublicApiError("Leave couldn't be reached. Try again shortly.", 503, { code: "roster_unavailable" });
}

function validSpan(startsOn: string, endsOn: string): void {
  const length = (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000;
  if (length < 0 || length > 366) {
    throw new PublicApiError("Leave must end after it starts and span no more than 366 days.", 400, {
      code: "invalid_body",
    });
  }
}

/** Owner table: every read or mutation is scoped to the session owner. */
export async function listOwnerLeave(
  client: RosterAdminClient,
  ownerId: string,
  today = perthDateOf(new Date()),
): Promise<RosterLeave[]> {
  const { data, error } = await client
    .from("roster_leave")
    .select("id,kind,starts_on,ends_on,status,service_id")
    .eq("owner_id", ownerId)
    .gte("ends_on", addDaysToDate(today, -30))
    .order("starts_on", { ascending: true })
    .limit(50);
  if (error || !data) throw unavailable();
  return (data as LeaveRow[]).map(publicLeave);
}

export async function createOwnerLeave(
  client: RosterAdminClient,
  ownerId: string,
  input: z.infer<typeof createLeaveSchema>,
): Promise<RosterLeave> {
  validSpan(input.startsOn, input.endsOn);
  if (input.serviceId) await rosterRead(client, ownerId, input.serviceId, "overview");
  const { data: current, error: countError } = await client
    .from("roster_leave")
    .select("id")
    .eq("owner_id", ownerId)
    .limit(50);
  if (countError || !current) throw unavailable();
  if (current.length >= 50)
    throw new PublicApiError("You can keep up to 50 leave entries.", 409, { code: "roster_limit" });
  const { data, error } = await client
    .from("roster_leave")
    .insert({
      owner_id: ownerId,
      service_id: input.serviceId,
      kind: input.kind,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      status: input.status,
    })
    .select("id,kind,starts_on,ends_on,status,service_id")
    .single();
  if (error || !data) throw unavailable();
  return publicLeave(data as LeaveRow);
}

export async function updateOwnerLeave(
  client: RosterAdminClient,
  ownerId: string,
  input: z.infer<typeof updateLeaveSchema>,
): Promise<RosterLeave> {
  const { data: old, error: readError } = await client
    .from("roster_leave")
    .select("id,kind,starts_on,ends_on,status,service_id")
    .eq("owner_id", ownerId)
    .eq("id", input.id)
    .maybeSingle();
  if (readError) throw unavailable();
  if (!old) throw new PublicApiError("That leave entry wasn't found.", 404, { code: "roster_not_found" });
  validSpan(input.startsOn ?? old.starts_on, input.endsOn ?? old.ends_on);
  const update = {
    ...(input.startsOn ? { starts_on: input.startsOn } : {}),
    ...(input.endsOn ? { ends_on: input.endsOn } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  const { data, error } = await client
    .from("roster_leave")
    .update(update)
    .eq("owner_id", ownerId)
    .eq("id", input.id)
    .select("id,kind,starts_on,ends_on,status,service_id")
    .maybeSingle();
  if (error) throw unavailable();
  if (!data) throw new PublicApiError("That leave entry wasn't found.", 404, { code: "roster_not_found" });
  return publicLeave(data as LeaveRow);
}

export async function deleteOwnerLeave(client: RosterAdminClient, ownerId: string, id: string): Promise<void> {
  const { data, error } = await client
    .from("roster_leave")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw unavailable();
  if (!data) throw new PublicApiError("That leave entry wasn't found.", 404, { code: "roster_not_found" });
}
