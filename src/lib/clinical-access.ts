import { isLocalNoAuthMode } from "@/lib/env";
import { TERMS_VERSION } from "@/lib/front-door-content";
import { PublicApiError } from "@/lib/http";
import type { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError } from "@/lib/supabase/auth";
import { readTermsAcceptance } from "@/lib/terms-acceptance";

/**
 * Answer, Clinical Ask and the original documents and page images are for signed-in health
 * professionals: the amended TGA exemption for clinical decision support software applies from
 * 1 November 2026 and covers only software for health professionals. Called after
 * `publicAccessContext`, so a signed-out request is refused here, on the server, whatever the
 * browser shows. Demo mode returns before this and keeps its synthetic corpus open, and local
 * no-auth development mode is allowed through because it can never be on in production.
 * See docs/decisions/2026-10-20-clinical-decision-tools-need-sign-in.md.
 */
export function requireSignedInClinicalAccess(access: { authenticated: boolean }) {
  if (access.authenticated || isLocalNoAuthMode()) return;
  throw new AuthenticationError("Sign in to use this.");
}

type AdminClient = ReturnType<typeof createAdminClient>;

export const DECLARATION_REQUIRED_MESSAGE =
  "Answer needs your health professional declaration. Ask again and accept the Terms step.";
export const DECLARATION_CHECK_FAILED_MESSAGE = "We could not check your Terms acceptance. Try again in a moment.";

const DECLARATION_CACHE_TTL_MS = 10 * 60 * 1000;
const DECLARATION_CACHE_MAX = 5000;
const confirmedDeclarations = new Map<string, number>();

/** Test hook: forget every confirmed declaration. */
export function resetHealthProfessionalDeclarationCache() {
  confirmedDeclarations.clear();
}

/**
 * The AI routes also need the "I'm a health professional and I accept the Terms" declaration
 * (regulatory re-audit R2-01, 26 Oct 2026). Sign-up is open to anyone, so sign-in alone does not
 * show the user declared they are a health professional. The record is read fresh from the
 * account on the server, never from the browser's copy, because the access token's metadata
 * goes stale for up to an hour after the Terms step saves it. Only a confirmed record is
 * cached, for ten minutes, so a refusal is always rechecked on the next request. A failed
 * lookup refuses rather than lets the request through. Called after
 * `requireSignedInClinicalAccess`; local no-auth development mode is allowed through for the
 * same reason as there.
 */
export async function requireHealthProfessionalDeclaration(
  access: { authenticated: boolean; ownerId?: string },
  supabase: AdminClient,
  now: number = Date.now(),
) {
  if (isLocalNoAuthMode()) return;
  if (!access.authenticated || !access.ownerId) throw new AuthenticationError("Sign in to use this.");
  const cacheKey = `${access.ownerId}\n${TERMS_VERSION}`;
  const expiresAt = confirmedDeclarations.get(cacheKey);
  if (expiresAt !== undefined && expiresAt > now) return;
  confirmedDeclarations.delete(cacheKey);

  let metadata: unknown;
  try {
    const { data, error } = await supabase.auth.admin.getUserById(access.ownerId);
    if (error || !data?.user) throw error ?? new Error("Account not found.");
    metadata = data.user.user_metadata;
  } catch {
    throw new PublicApiError(DECLARATION_CHECK_FAILED_MESSAGE, 503, { code: "declaration_check_unavailable" });
  }
  if (readTermsAcceptance(metadata)?.version !== TERMS_VERSION) {
    throw new PublicApiError(DECLARATION_REQUIRED_MESSAGE, 403, { code: "terms_acceptance_required" });
  }
  if (confirmedDeclarations.size >= DECLARATION_CACHE_MAX) confirmedDeclarations.clear();
  confirmedDeclarations.set(cacheKey, now + DECLARATION_CACHE_TTL_MS);
}
