import "server-only";

import type { RosterAdminClient } from "@/lib/roster/team/api";

/** Resolve only active members' ids for this team; names never enter an alert. */
export async function activeRecipientIds(
  client: RosterAdminClient,
  serviceId: string,
  candidates: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(candidates)].slice(0, 500);
  if (!ids.length) return new Set();
  const { data, error } = await client
    .from("on_call_service_members")
    .select("user_id")
    .eq("service_id", serviceId)
    .is("revoked_at", null)
    .in("user_id", ids)
    .limit(500);
  if (error || !data) throw new Error("Recipient check unavailable");
  return new Set(data.map((row) => row.user_id));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Row-id and team-id together keep an alert from naming someone in another team. */
export async function swapParties(
  client: RosterAdminClient,
  serviceId: string,
  swapId: string,
): Promise<{ requesterId: string; counterpartyId: string } | null> {
  const { data, error } = await client
    .from("roster_swaps")
    .select("requester_id,counterparty_id")
    .eq("service_id", serviceId)
    .eq("id", swapId)
    .maybeSingle();
  if (error || !data) return null;
  return { requesterId: data.requester_id, counterpartyId: data.counterparty_id };
}

export async function openParties(
  client: RosterAdminClient,
  serviceId: string,
  openShiftId: string,
  failOnError = false,
) {
  const { data, error } = await client
    .from("roster_open_shifts")
    .select("posted_by,claimed_by,assignment_id,starts_at,ends_at,min_grade,status")
    .eq("service_id", serviceId)
    .eq("id", openShiftId)
    .maybeSingle();
  if (error && failOnError) throw new Error("Opening check unavailable");
  return error ? null : data;
}

/** The prior holder is present in the SQL's undo row only for a transferred shift. */
export async function previousOpenHolder(
  client: RosterAdminClient,
  serviceId: string,
  openShiftId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("roster_changes")
    .select("undo")
    .eq("service_id", serviceId)
    .eq("source", "open_shift")
    .contains("change", { openShiftId })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const undo = data.undo;
  if (!undo || typeof undo !== "object" || Array.isArray(undo)) return null;
  const assignments = (undo as { assignments?: unknown }).assignments;
  if (!Array.isArray(assignments)) return null;
  const first = assignments[0];
  const userId =
    first && typeof first === "object" && !Array.isArray(first) ? (first as { userId?: unknown }).userId : null;
  return typeof userId === "string" && UUID.test(userId) ? userId : null;
}
