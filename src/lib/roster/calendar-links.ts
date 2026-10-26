import "server-only";

import { isIP } from "node:net";

import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import { isGlobalPublicAddress } from "@/lib/public-source-acquisition";
import { CalendarLinkError, normaliseCalendarLink, type CalendarLinkFailure } from "@/lib/roster/calendar-link-fetch";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/**
 * A doctor's live roster link (an `.ics` feed from a rostering system), at
 * most 3 per owner (the table's own cap trigger). Every query here filters by
 * `owner_id`, and the full address is read only inside this file: the list
 * handed back to a client carries a host preview, never the link itself, so
 * a token in its query string is never repeated where a client, a log or an
 * error could show it. The database keeps the address encrypted in Vault
 * (privacy audit DB-04): the list reads only `url_host`, and a refresh reads
 * the address back through `roster_calendar_link_urls`, which checks the owner.
 */

export const ROSTER_CALENDAR_LINK_URL_MAX = 2000;
export const ROSTER_CALENDAR_LINK_WORKPLACE_MAX = 80;

/** The reasons `roster_calendar_links.last_error` may hold (the table's own check constraint). `not_https` never reaches here: it is refused when the link is added, before anything is stored. */
export type RosterCalendarLinkReason =
  "unreachable" | "not_calendar" | "too_large" | "too_many_shifts" | "blocked_address";

const KNOWN_LINK_REASONS: ReadonlySet<string> = new Set([
  "unreachable",
  "not_calendar",
  "too_large",
  "too_many_shifts",
  "blocked_address",
]);

/** What a client is shown for one calendar link. Never the stored `url`. */
export type RosterCalendarLink = {
  readonly id: string;
  readonly workplace: string | null;
  /** The link's host and nothing else, e.g. "roster.example.org/…". */
  readonly hostPreview: string;
  readonly lastFetchedAt: string | null;
  readonly lastError: RosterCalendarLinkReason | null;
  readonly createdAt: string;
};

/** One link's full address, read only for a server-side refresh. Never returned to a client. */
export type RosterCalendarLinkForRefresh = {
  readonly id: string;
  readonly url: string;
  readonly workplace: string | null;
};

export const addRosterCalendarLinkSchema = z
  .object({
    url: z.string().trim().min(1).max(ROSTER_CALENDAR_LINK_URL_MAX),
    workplace: z.string().trim().min(1).max(ROSTER_CALENDAR_LINK_WORKPLACE_MAX).nullable(),
  })
  .strict();
export type AddRosterCalendarLinkRequest = z.infer<typeof addRosterCalendarLinkSchema>;

export const removeRosterCalendarLinkSchema = z.object({ id: z.string().uuid() }).strict();

export const refreshRosterCalendarLinksSchema = z.object({ id: z.string().uuid().optional() }).strict();

type LinkRow = {
  id: string;
  url_host: string | null;
  workplace: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
  created_at: string;
};

const LINK_COLUMNS = "id,url_host,workplace,last_fetched_at,last_error,created_at";

function rowToLinkReason(reason: string | null): RosterCalendarLinkReason | null {
  return reason !== null && KNOWN_LINK_REASONS.has(reason) ? (reason as RosterCalendarLinkReason) : null;
}

/** The link's host, with the path, query string and any token squashed to "…". */
function hostPreviewOf(host: string | null): string {
  return host ? `${host}/…` : "…";
}

function rowToLink(row: LinkRow): RosterCalendarLink {
  return {
    id: row.id,
    workplace: row.workplace,
    hostPreview: hostPreviewOf(row.url_host),
    lastFetchedAt: row.last_fetched_at,
    lastError: rowToLinkReason(row.last_error),
    createdAt: row.created_at,
  };
}

function requireOwner(ownerId: string) {
  if (!ownerId) throw new Error("Missing calendar link owner.");
}

/** Every calendar link the owner holds, newest first. The full address never leaves this file. */
export async function fetchOwnerCalendarLinks(supabase: AdminClient, ownerId: string): Promise<RosterCalendarLink[]> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("roster_calendar_links")
    .select(LINK_COLUMNS)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToLink);
}

/**
 * A raw link as pasted, checked before it is ever stored: `https://` only (no
 * port, username or password — `normaliseCalendarLink` throws `not_https`
 * for any of those), and a literal private address is refused outright. A
 * hostname is not resolved here: a name that looks public today but resolves
 * to a private address is caught at refresh time instead, by the guarded
 * fetcher, which pins every hop to the address it actually checked.
 */
function assertAddableLink(rawUrl: string): URL {
  const url = normaliseCalendarLink(rawUrl);
  // `URL.hostname` keeps an IPv6 literal's brackets (`[::1]`), which `isIP` does not read.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(host) !== 0 && !isGlobalPublicAddress(host)) {
    throw new CalendarLinkError("private_address");
  }
  return url;
}

/**
 * Add one calendar link. Throws `CalendarLinkError` for a bad address (the
 * route maps this to 400 with the reason as its code), or `PublicApiError`
 * (409) at the 3-link cap or a duplicate workplace.
 */
export async function addCalendarLink(
  supabase: AdminClient,
  ownerId: string,
  rawUrl: string,
  workplace: string | null,
): Promise<RosterCalendarLink> {
  requireOwner(ownerId);
  const url = assertAddableLink(rawUrl);
  // The database seals the address in Vault and keeps no plain-text copy (privacy audit DB-04).
  const { data, error } = await supabase
    .rpc("roster_calendar_link_add", { p_owner_id: ownerId, p_url: url.toString(), p_workplace: workplace })
    .single();
  if (error) {
    if (error.message === "roster_limit") {
      throw new PublicApiError("You already have 3 calendar links. Remove one before adding another.", 409, {
        code: "roster_limit",
      });
    }
    if (error.code === "23505") {
      throw new PublicApiError("You already have a calendar link for that workplace.", 409, {
        code: "duplicate_workplace",
      });
    }
    throw error;
  }
  return rowToLink(data as LinkRow);
}

/** Remove one calendar link. Returns false when it does not exist, or isn't the caller's. */
export async function removeCalendarLink(supabase: AdminClient, ownerId: string, id: string): Promise<boolean> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("roster_calendar_links")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Remove every calendar link one workplace has, so a removed workplace does not come back on the next refresh. */
export async function removeWorkplaceCalendarLinks(
  supabase: AdminClient,
  ownerId: string,
  workplace: string,
): Promise<void> {
  requireOwner(ownerId);
  const { error } = await supabase
    .from("roster_calendar_links")
    .delete()
    .eq("owner_id", ownerId)
    .eq("workplace", workplace);
  if (error) throw error;
}

/** Remove every calendar link the owner has (part of Delete my data). Idempotent. */
export async function deleteOwnerCalendarLinks(supabase: AdminClient, ownerId: string): Promise<void> {
  requireOwner(ownerId);
  const { error } = await supabase.from("roster_calendar_links").delete().eq("owner_id", ownerId);
  if (error) throw error;
}

/**
 * The full addresses of the owner's own links, by id, decrypted by the database. Ids that are not
 * the caller's come back missing, never as someone else's address.
 */
async function decryptedUrls(supabase: AdminClient, ownerId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc("roster_calendar_link_urls", { p_owner_id: ownerId, p_ids: ids });
  if (error) throw error;
  return new Map((data ?? []).map(({ id, url }: { id: string; url: string }) => [id, url]));
}

/** One named link's full address, read only for a server-side refresh. Null when it isn't the caller's. */
export async function fetchCalendarLinkForRefresh(
  supabase: AdminClient,
  ownerId: string,
  id: string,
): Promise<RosterCalendarLinkForRefresh | null> {
  requireOwner(ownerId);
  const { data, error } = await supabase
    .from("roster_calendar_links")
    .select("id,workplace")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const url = (await decryptedUrls(supabase, ownerId, [data.id])).get(data.id);
  return url ? { id: data.id, url, workplace: data.workplace } : null;
}

/** Every link due a refresh: never fetched, or last fetched more than `olderThanMs` ago. */
export async function fetchCalendarLinksDueForRefresh(
  supabase: AdminClient,
  ownerId: string,
  olderThanMs: number,
): Promise<RosterCalendarLinkForRefresh[]> {
  requireOwner(ownerId);
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data, error } = await supabase
    .from("roster_calendar_links")
    .select("id,workplace,last_fetched_at")
    .eq("owner_id", ownerId)
    .or(`last_fetched_at.is.null,last_fetched_at.lt.${cutoff}`);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; workplace: string | null }[];
  const urls = await decryptedUrls(
    supabase,
    ownerId,
    rows.map((row) => row.id),
  );
  return rows.flatMap(({ id, workplace }) => {
    const url = urls.get(id);
    return url ? [{ id, url, workplace }] : [];
  });
}

/**
 * The table's own reason codes a failed refresh may store (see the migration's
 * check constraint). `not_https` never reaches here: a redirect landing on
 * plain http surfaces as `unreachable`, because the doctor cannot fix a
 * redirect the rostering system issues.
 */
export function toStoredLinkReason(reason: CalendarLinkFailure | "too_many_shifts"): RosterCalendarLinkReason {
  switch (reason) {
    case "private_address":
      return "blocked_address";
    case "too_big":
      return "too_large";
    case "timeout":
    case "http_error":
    case "not_https":
      return "unreachable";
    case "not_calendar":
      return "not_calendar";
    case "too_many_shifts":
      return "too_many_shifts";
  }
}

/** Record a refresh outcome. A successful refresh clears any earlier error. */
export async function recordCalendarLinkRefresh(
  supabase: AdminClient,
  ownerId: string,
  id: string,
  outcome: { ok: true } | { ok: false; reason: RosterCalendarLinkReason },
): Promise<void> {
  requireOwner(ownerId);
  const { error } = await supabase
    .from("roster_calendar_links")
    .update({ last_fetched_at: new Date().toISOString(), last_error: outcome.ok ? null : outcome.reason })
    .eq("owner_id", ownerId)
    .eq("id", id);
  if (error) throw error;
}
