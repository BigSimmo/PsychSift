import { requireHealthProfessionalDeclaration } from "@/lib/clinical-access";
import { env, isLocalNoAuthMode } from "@/lib/env";
import { PublicApiError } from "@/lib/http";
import { isAdministratorUser } from "@/lib/authorization";
import { callerOwnsDocumentRow } from "@/lib/public-api-access";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export const ORIGINAL_DECLARATION_REQUIRED_MESSAGE =
  "Opening original documents needs your health professional declaration. Accept the Terms when asked, then try again.";
export const ORIGINAL_ADMIN_ONLY_MESSAGE =
  "Original files from other publishers are open to administrators only for now. The cited excerpts are still available.";
export const ORIGINAL_ACCESS_CHECK_FAILED_MESSAGE = "We could not check access to this file. Try again in a moment.";

/**
 * The checks before a signed link to a document's original file is issued, after sign-in.
 * A caller's own upload is always theirs to open. Anything else is a shared source, so:
 *
 * - D26-40 (26 Oct 2026): the "I'm a health professional and I accept the Terms" declaration
 *   is read from the account on the server, the same check Answer makes, never the browser's
 *   copy. It reads the record wherever the app asks for it, so it holds whether the Terms step
 *   stays at the first Ask or moves to first open.
 * - R-05: when `THIRD_PARTY_ORIGINALS_ADMIN_ONLY` is on, only administrators get the original,
 *   checked on a live account lookup. A failed lookup refuses. Off by default.
 *
 * Local no-auth development mode is allowed through, as in `requireSignedInClinicalAccess`.
 */
export async function requireOriginalDocumentAccess(
  access: { authenticated: boolean; ownerId?: string },
  document: { owner_id?: unknown },
  supabase: AdminClient,
) {
  if (isLocalNoAuthMode() || callerOwnsDocumentRow(document, access.ownerId)) return;
  await requireHealthProfessionalDeclaration(access, supabase, Date.now(), ORIGINAL_DECLARATION_REQUIRED_MESSAGE);
  if (!env.THIRD_PARTY_ORIGINALS_ADMIN_ONLY) return;

  let administrator: boolean;
  try {
    const { data, error } = await supabase.auth.admin.getUserById(access.ownerId ?? "");
    if (error || !data?.user) throw error ?? new Error("Account not found.");
    administrator = isAdministratorUser(data.user);
  } catch {
    throw new PublicApiError(ORIGINAL_ACCESS_CHECK_FAILED_MESSAGE, 503, { code: "original_access_check_unavailable" });
  }
  if (!administrator) {
    throw new PublicApiError(ORIGINAL_ADMIN_ONLY_MESSAGE, 403, { code: "original_document_admin_only" });
  }
}
