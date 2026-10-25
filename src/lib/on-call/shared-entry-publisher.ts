import { isAdministratorAppMetadata } from "@/lib/authorization";
import { PublicApiError, publicErrorResponse } from "@/lib/http";
import type { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/supabase/auth";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Whether this caller may create, edit or verify a SHARED On Call entry: one that is not
 * personal, so every signed-in user reads it (`fetchSharedOnCallEntries`). Only a site
 * administrator may (owner decision, 25 Oct 2026). Sign-up has been open to anyone since
 * 21 Oct 2026, so an ordinary account could otherwise put an escalation ladder or a contact
 * number in front of every clinician. Anyone signed in may still keep private entries.
 *
 * The session's own claim is read first, so an ordinary account costs no second lookup. An
 * account that claims the role is then checked live against Auth, the way administrator routes
 * check it, so a stale or forwarded claim cannot publish.
 */
export async function mayPublishSharedOnCallEntry(
  request: Request,
  supabase: AdminClient,
  user: AuthenticatedUser,
): Promise<boolean> {
  if (!isAdministratorAppMetadata(user.appMetadata)) return false;
  try {
    const live = await requireAuthenticatedUser(request, supabase, { administrator: true });
    return live.id === user.id;
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 403) return false;
    throw error;
  }
}

/** The refusal for a shared write from an account that is not an administrator. */
export function sharedOnCallEntryRefusedResponse() {
  return publicErrorResponse(
    "Only an administrator can share an On Call entry with everyone signed in. Make the entry private to keep it for yourself.",
    403,
    { code: "on_call_shared_entry_administrator_required" },
  );
}
