import "server-only";

/**
 * Server-side access checks shared by the durable teaching assessment routes (dual sign-off and
 * supervisor bookings). Both fail closed: a client without the table or RPC surface, a query
 * error, or a missing row all deny. Callers pass the error to throw so each route keeps its own
 * public error code.
 */

type QueryResult = Promise<{ data: unknown; error: { message?: string } | null }>;

type MembershipQuery = {
  select(columns: string): MembershipQuery;
  eq(column: string, value: string): MembershipQuery;
  is(column: string, value: null): MembershipQuery;
  maybeSingle(): QueryResult;
};

type AccessClient = {
  from?: (table: string) => MembershipQuery;
  rpc?: (fn: string, args: Record<string, unknown>) => QueryResult;
};

/** The user is an active (not revoked) member of the team. */
export async function requireActiveServiceMember(
  client: unknown,
  userId: string,
  serviceId: string,
  deny: () => Error,
): Promise<void> {
  const from = (client as AccessClient | null)?.from;
  if (typeof from !== "function") throw deny();
  const member = await from
    .call(client, "on_call_service_members")
    .select("user_id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (member.error || !member.data) throw deny();
}

/**
 * The actor holds `assessments.review` for the team (a whole-team supervisor or the hospital's
 * DCT) or, when `subjectUserId` is given, for that trainee. Uses `work_can`, the same permission
 * check the SQL callers use; it already refuses a doctor reviewing their own assessments.
 */
export async function requireAssessmentReviewer(
  client: unknown,
  actorId: string,
  serviceId: string,
  subjectUserId: string | null,
  deny: () => Error,
): Promise<void> {
  const rpc = (client as AccessClient | null)?.rpc;
  if (typeof rpc !== "function") throw deny();
  const { data, error } = await rpc.call(client, "work_can", {
    p_actor_id: actorId,
    p_capability: "assessments.review",
    p_service_id: serviceId,
    p_hospital_id: null,
    p_subject_user: subjectUserId,
  });
  if (error || data !== true) throw deny();
}
