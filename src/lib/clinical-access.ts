import { isLocalNoAuthMode } from "@/lib/env";
import { AuthenticationError } from "@/lib/supabase/auth";

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
