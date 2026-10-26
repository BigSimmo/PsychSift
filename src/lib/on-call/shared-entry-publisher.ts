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

/**
 * How long the list of site administrators is trusted before Auth is asked again. Granting or
 * removing the role takes effect on the shared read within this window.
 */
export const SHARED_ON_CALL_PUBLISHER_TTL_MS = 5 * 60_000;
const PUBLISHER_PAGE_SIZE = 1000;
const PUBLISHER_MAX_PAGES = 50;

let publisherCache: { ids: readonly string[]; expiresAt: number } | null = null;

/**
 * The accounts whose shared On Call entries every signed-in user may read: site administrators,
 * read live from Auth (owner decision, 26 Oct 2026). The 25 Oct rule stopped ordinary accounts
 * creating shared entries, but a shared entry one posted before then would still have reached
 * everyone, because the shared read never asked who wrote it. Now it does, so a row from an
 * ordinary account stays with its owner whenever it was written. Nothing is deleted.
 *
 * Read from the administrator side, not per row, so a flood of rows from one account cannot push
 * an administrator's entries past the read's row cap. A failed refresh reuses the last list it
 * had. With no list at all it throws rather than guess, because an empty answer would read as
 * "no shared entries".
 */
export async function sharedOnCallPublisherIds(
  supabase: AdminClient,
  now: number = Date.now(),
): Promise<readonly string[]> {
  if (publisherCache && publisherCache.expiresAt > now) return publisherCache.ids;
  try {
    const ids: string[] = [];
    for (let page = 1; page <= PUBLISHER_MAX_PAGES; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PUBLISHER_PAGE_SIZE });
      if (error) throw error;
      const users = data?.users ?? [];
      for (const user of users) {
        if (isAdministratorAppMetadata(user.app_metadata)) ids.push(user.id);
      }
      if (users.length < PUBLISHER_PAGE_SIZE) break;
    }
    publisherCache = { ids, expiresAt: now + SHARED_ON_CALL_PUBLISHER_TTL_MS };
    return ids;
  } catch (error) {
    if (publisherCache) return publisherCache.ids;
    throw error;
  }
}

export function resetSharedOnCallPublisherCacheForTests() {
  publisherCache = null;
}
