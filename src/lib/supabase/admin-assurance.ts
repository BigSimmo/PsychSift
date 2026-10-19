import { PublicApiError } from "@/lib/http";
import type { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, extractSessionAccessToken } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTrustedAdministratorAssurance } from "@/lib/trusted-document-admission";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Requires the credential that authenticated this request to carry a recent multi-factor
 * sign-in by the same administrator, the check document admission already applies. Destructive
 * and publishing admin actions use it so a stolen session without recent MFA cannot delete
 * documents or publish content (repository audit F-12).
 *
 * The claims come from the same token the request presented (Authorization header, then the
 * session cookie), so they cannot belong to a different session than the one already resolved.
 */
export async function requireRecentAdministratorAssurance(
  request: Request,
  supabase: AdminClient,
  administratorId: string,
): Promise<void> {
  let claims: unknown = null;
  const token = extractSessionAccessToken(request);
  if (token) {
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) throw new AuthenticationError("Verified administrator claims are required.");
    claims = data.claims;
  } else {
    const userSupabase = await createSupabaseServerClient();
    if (!userSupabase) throw new AuthenticationError("Authenticated administrator session is required.");
    const { data, error } = await userSupabase.auth.getClaims();
    if (error || !data?.claims) throw new AuthenticationError("Verified administrator claims are required.");
    claims = data.claims;
  }
  try {
    assertTrustedAdministratorAssurance(claims, administratorId);
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "administrator_assurance_required";
    throw new PublicApiError("Recent multi-factor administrator authentication is required.", 403, { code });
  }
}
