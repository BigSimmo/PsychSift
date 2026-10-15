import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { PublicApiError } from "@/lib/http";
import { rosterApiError, rosterUnavailable } from "@/lib/roster/team/errors";
import {
  ROSTER_READ_SCHEMAS,
  rosterCommandResultSchema,
  rosterTeamsSchema,
  type RosterAction,
  type RosterCommandResult,
  type RosterReadResult,
  type RosterReadWhat,
  type RosterTeam,
} from "@/lib/roster/team/model";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Every team read and write goes through `roster_read` and `roster_command`,
 * which check membership, confirmation and role in SQL on every call. The
 * actor is always the session user the route passes in, never anything the
 * request carried. Answers are parsed with their schema and fail closed: a
 * shape the app doesn't recognise is 503, never a half-parsed object.
 */

function requireActor(actorId: string) {
  if (!actorId) throw new PublicApiError("Sign in to open Roster.", 401, { code: "roster_auth_required" });
}

export type RosterReadPayload = { from?: string; to?: string };

export async function rosterRead<W extends RosterReadWhat>(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  what: W,
  payload: RosterReadPayload = {},
): Promise<RosterReadResult<W>> {
  requireActor(actorId);
  // The team's members have their own member-readable function, outside roster_read.
  const { data, error } =
    what === "members"
      ? await client.rpc("roster_team_members", { p_actor_id: actorId, p_service_id: serviceId })
      : await client.rpc("roster_read", {
          p_actor_id: actorId,
          p_service_id: serviceId,
          p_what: what,
          p_payload: payload,
        });
  if (error) throw rosterApiError(error);
  const parsed = ROSTER_READ_SCHEMAS[what].safeParse(data);
  if (!parsed.success) throw rosterUnavailable();
  return parsed.data as RosterReadResult<W>;
}

/** The teams the actor belongs to, confirmed or not. */
export async function rosterReadTeams(client: AdminClient, actorId: string): Promise<RosterTeam[]> {
  requireActor(actorId);
  const { data, error } = await client.rpc("roster_read", {
    p_actor_id: actorId,
    p_service_id: null,
    p_what: "teams",
    p_payload: {},
  });
  if (error) throw rosterApiError(error);
  const parsed = rosterTeamsSchema.safeParse(data);
  if (!parsed.success) throw rosterUnavailable();
  return parsed.data.teams;
}

function withoutPostKey(payload: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...payload };
  delete rest.postKey;
  return rest;
}

/** A team write. `action` has already passed `rosterActionSchema` (or is a publish-route action). */
export async function rosterCommand(
  client: AdminClient,
  actorId: string,
  serviceId: string,
  action: RosterAction | { action: "publish" | "codes.set"; [key: string]: unknown },
): Promise<RosterCommandResult> {
  requireActor(actorId);
  const { action: name, ...payload } = action;
  // The safe number goes through the stale check, which refuses it once anyone has saved since the editor's read.
  // Taking back an open-shift request has its own function, which only the doctor who asked can call.
  // A post that carries a key goes through roster_open_post_once, which answers a repeat of the same
  // key with the shift already saved instead of saving another; the key itself is not part of the post.
  const { data, error } =
    action.action === "open.withdraw"
      ? await client.rpc("roster_open_withdraw", {
          p_actor_id: actorId,
          p_service_id: serviceId,
          p_open_shift_id: action.openShiftId,
        })
      : action.action === "needs.set"
        ? await client.rpc("roster_needs_replace", {
            p_actor_id: actorId,
            p_service_id: serviceId,
            p_expected_ids: action.expectedIds as never,
            p_needs: action.needs as never,
          })
        : action.action === "open.post" && action.postKey
          ? await client.rpc("roster_open_post_once", {
              p_actor_id: actorId,
              p_service_id: serviceId,
              p_post_key: action.postKey,
              p_payload: withoutPostKey(payload) as never,
            })
          : await client.rpc("roster_command", {
              p_actor_id: actorId,
              p_service_id: serviceId,
              p_action: name,
              p_payload: payload as never,
            });
  if (error) throw rosterApiError(error);
  const parsed = rosterCommandResultSchema.safeParse(data);
  if (!parsed.success) throw rosterUnavailable();
  return parsed.data;
}
