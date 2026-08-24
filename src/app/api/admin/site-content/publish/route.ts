import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireAuthenticatedUser(request, createAdminClient(), { administrator: true });
    const userSupabase = await createSupabaseServerClient();
    if (!userSupabase) throw new AuthenticationError("Authenticated administrator session is required.");
    const body = await request.json();
    const mutation =
      body && typeof body === "object" && (body as { action?: unknown }).action === "begin"
        ? { rpc: "begin_site_content_candidate_release" as const, args: { p_plan: (body as { plan?: unknown }).plan } }
        : { rpc: "publish_site_content_record" as const, args: { p_record: body } };
    const { data, error } = await userSupabase.rpc(mutation.rpc, mutation.args);
    if (error) throw new Error("Site-content publication failed.");
    return Response.json(data, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse(error);
    return jsonError(error);
  }
}
