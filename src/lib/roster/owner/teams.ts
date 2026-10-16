import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { rosterTeamReleaseEnabled } from "@/lib/roster/team/release";
import { jsonError, PublicApiError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";

type Client = ReturnType<typeof createAdminClient>;
export const ownerServiceIdSchema = z.string().uuid();
export const ownerChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), verified: z.boolean(), isDemo: z.boolean() }).strict(),
  z.object({ action: z.literal("manager"), userId: z.string().uuid(), manager: z.boolean() }).strict(),
]);

export type OwnerTeam = {
  serviceId: string;
  name: string;
  createdAt: string;
  verifiedAt: string | null;
  isDemo: boolean;
  activeMembers: number;
  managers: number;
};

export type OwnerMember = {
  userId: string;
  displayName: string | null;
  rosterName: string | null;
  serviceRole: string;
  rosterRole: "member" | "manager";
  grade: string | null;
  joinedAt: string;
};

/**
 * Platform-owner reads intentionally span services without an owner_id filter.
 * Only this module makes those reads, and every caller first checks the real
 * session's administrator app_metadata. It is outside the owner-scope scan by
 * design; team endpoints must continue using roster_read instead.
 */
export async function withRosterOwnerApi(
  request: Request,
  operation: (client: Client, actorId: string) => Promise<unknown>,
): Promise<Response> {
  let response: Response;
  try {
    if (isDemoMode()) {
      response = publicErrorResponse("Team administration is unavailable in demo mode.", 400, {
        code: "demo_mode_unavailable",
      });
    } else if (!rosterTeamReleaseEnabled()) {
      response = publicErrorResponse("Team roster is not available for real staff yet.", 503, {
        code: "roster_release_held",
      });
    } else {
      const client = createAdminClient();
      const user = await requireAuthenticatedUser(request, client, { administrator: true });
      const rate = await consumeSubjectApiRateLimit({
        supabase: client,
        subject: { kind: "owner", ownerId: user.id },
        bucket: "roster",
        allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
      });
      response = rate.limited
        ? rateLimitJsonResponse("Too many requests. Try again shortly.", rate)
        : NextResponse.json(await operation(client, user.id));
    }
  } catch (error) {
    response = error instanceof AuthenticationError ? unauthorizedResponse() : jsonError(error);
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie, Authorization");
  return response;
}

function unavailable(): PublicApiError {
  return new PublicApiError("Teams could not be loaded or changed. Try again shortly.", 503, {
    code: "roster_unavailable",
  });
}

function mapOwnerRpcError(error: { message?: string | null }): PublicApiError {
  if (error.message === "roster_not_found") {
    return new PublicApiError("That person isn't an active member of this team.", 404, { code: "roster_not_found" });
  }
  if (error.message === "service_not_found") {
    return new PublicApiError("That team is unavailable.", 404, { code: "service_not_found" });
  }
  if (error.message === "service_invalid_request" || error.message === "roster_invalid_request") {
    return new PublicApiError("Check the team request and try again.", 400, { code: error.message });
  }
  return unavailable();
}

const COUNT_PAGE_SIZE = 1000;

/**
 * Reads every matching row by paging, so per-service counts stay exact however many memberships exist
 * (a single capped select would silently under-count). Returns null when any page fails.
 */
async function readAllRows<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let from = 0; ; from += COUNT_PAGE_SIZE) {
    const { data, error } = await page(from, from + COUNT_PAGE_SIZE - 1);
    if (error || !data) return null;
    rows.push(...(data as Row[]));
    if (data.length < COUNT_PAGE_SIZE) return rows;
  }
}

/** Batched member and manager counts across all services in O(1) queries. */
export async function listOwnerTeams(client: Client): Promise<{ teams: OwnerTeam[] }> {
  const { data: services, error } = await client
    .from("on_call_services")
    .select("id,name,created_at,verified_at,is_demo")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !services) throw unavailable();
  if (services.length === 0) return { teams: [] };

  const serviceIds = services.map((service) => service.id);
  const [members, roles] = await Promise.all([
    readAllRows<{ service_id?: string }>((from, to) =>
      client
        .from("on_call_service_members")
        .select("service_id,user_id")
        .in("service_id", serviceIds)
        .is("revoked_at", null)
        .order("service_id")
        .order("user_id")
        .range(from, to),
    ),
    readAllRows<{ service_id?: string }>((from, to) =>
      client
        .from("roster_member_roles")
        .select("service_id,user_id")
        .in("service_id", serviceIds)
        .eq("role", "manager")
        .is("revoked_at", null)
        .order("service_id")
        .order("user_id")
        .range(from, to),
    ),
  ]);
  if (!members || !roles) throw unavailable();

  const memberCounts = new Map<string, number>();
  for (const row of members) {
    const key = row.service_id ?? (serviceIds.length === 1 ? serviceIds[0] : undefined);
    if (key) memberCounts.set(key, (memberCounts.get(key) ?? 0) + 1);
  }

  const managerCounts = new Map<string, number>();
  for (const row of roles) {
    const key = row.service_id ?? (serviceIds.length === 1 ? serviceIds[0] : undefined);
    if (key) managerCounts.set(key, (managerCounts.get(key) ?? 0) + 1);
  }

  return {
    teams: services.map((service) => ({
      serviceId: service.id,
      name: service.name,
      createdAt: service.created_at,
      verifiedAt: service.verified_at,
      isDemo: service.is_demo,
      activeMembers: memberCounts.get(service.id) ?? 0,
      managers: managerCounts.get(service.id) ?? 0,
    })),
  };
}

export async function listOwnerMembers(client: Client, serviceId: string): Promise<{ members: OwnerMember[] }> {
  const { data: service, error: serviceError } = await client
    .from("on_call_services")
    .select("id")
    .eq("id", serviceId)
    .maybeSingle();
  if (serviceError) throw unavailable();
  if (!service) throw new PublicApiError("That team is unavailable.", 404, { code: "service_not_found" });
  const { data: members, error } = await client
    .from("on_call_service_members")
    .select("user_id,display_name,role,joined_at")
    .eq("service_id", serviceId)
    .is("revoked_at", null)
    .order("joined_at", { ascending: true })
    .limit(200);
  if (error || !members) throw unavailable();
  if (members.length === 0) return { members: [] };
  const { data: roles, error: rolesError } = await client
    .from("roster_member_roles")
    .select("user_id,role,grade,roster_name")
    .eq("service_id", serviceId)
    .is("revoked_at", null)
    .in(
      "user_id",
      members.map((member) => member.user_id),
    );
  if (rolesError || !roles) throw unavailable();
  const byUser = new Map(roles.map((role) => [role.user_id, role]));
  return {
    members: members.map((member) => {
      const role = byUser.get(member.user_id);
      return {
        userId: member.user_id,
        displayName: member.display_name,
        rosterName: role?.roster_name ?? null,
        serviceRole: member.role,
        rosterRole: role?.role === "manager" ? "manager" : "member",
        grade: role?.grade ?? null,
        joinedAt: member.joined_at,
      };
    }),
  };
}

export async function ownerMemberEmail(
  client: Client,
  serviceId: string,
  userId: string,
): Promise<{ email: string | null }> {
  const { data: member, error } = await client
    .from("on_call_service_members")
    .select("user_id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw unavailable();
  if (!member)
    throw new PublicApiError("That person isn't an active member of this team.", 404, { code: "roster_not_found" });
  const { data, error: authError } = await client.auth.admin.getUserById(userId);
  if (authError || !data.user) throw unavailable();
  return { email: data.user.email ?? null };
}

export async function changeOwnerTeam(
  client: Client,
  actorId: string,
  serviceId: string,
  change: z.infer<typeof ownerChangeSchema>,
): Promise<{ result: unknown }> {
  const answer =
    change.action === "verify"
      ? await client.rpc("on_call_service_set_verified", {
          p_service_id: serviceId,
          p_actor_id: actorId,
          p_verified: change.verified,
          p_is_demo: change.isDemo,
        })
      : await client.rpc("roster_set_manager", {
          p_service_id: serviceId,
          p_user_id: change.userId,
          p_actor_id: actorId,
          p_manager: change.manager,
        });
  if (answer.error) throw mapOwnerRpcError(answer.error);
  return { result: answer.data };
}
