"use client";

import { useCallback, useEffect, useState } from "react";

import type { RosterCalendarLink, RosterCalendarLinkReason } from "@/lib/roster/calendar-links";

/**
 * The doctor's calendar links, from `/api/roster/links`. The server never
 * sends a link's full address back (it can carry a private token): only its
 * host and "…", which is all these screens show. The shape is the server's
 * own type (a type-only import, so no server code reaches the client).
 */
export type { RosterCalendarLink };

/** One link's outcome from `POST /api/roster/links/refresh`. */
export type RosterLinkRefreshResult = { readonly id: string; readonly ok: boolean; readonly reason?: string };

export type RosterLinksState = {
  readonly status: "loading" | "ready" | "signed-out" | "error";
  readonly links: readonly RosterCalendarLink[];
  readonly add: (url: string, workplace: string | null) => Promise<string | null>;
  readonly remove: (id: string) => Promise<string | null>;
  readonly refresh: (id: string) => Promise<string | null>;
  /** Fetch the list again, e.g. after a workplace and its links were removed. */
  readonly reload: () => Promise<void>;
};

const LINKS_URL = "/api/roster/links";
/** A link refreshed this recently counts as live on Today. */
export const ROSTER_LINK_FRESH_MS = 6 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

const LINK_REASONS: ReadonlySet<string> = new Set([
  "unreachable",
  "not_calendar",
  "too_large",
  "too_many_shifts",
  "blocked_address",
]);

function readLink(value: unknown): RosterCalendarLink | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (!id) return null;
  const lastError = text(value.lastError);
  return {
    id,
    workplace: text(value.workplace),
    hostPreview: text(value.hostPreview) ?? "Calendar link",
    lastFetchedAt: text(value.lastFetchedAt),
    lastError: lastError && LINK_REASONS.has(lastError) ? (lastError as RosterCalendarLinkReason) : null,
    createdAt: text(value.createdAt) ?? "",
  };
}

export function readRosterLinks(payload: unknown): RosterCalendarLink[] {
  const list = isRecord(payload) && Array.isArray(payload.links) ? payload.links : [];
  return list.flatMap((item) => {
    const link = readLink(item);
    return link ? [link] : [];
  });
}

/** The reason code in an error body, whether `{ error: { code } }` or `{ error, code }`. */
export function errorCodeOf(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.error)) return text(payload.error.code);
  return text(payload.code);
}

/** The per-link outcomes in a refresh response, or null when it could not be read. */
export function readRefreshResults(payload: unknown): RosterLinkRefreshResult[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return null;
  return payload.results.flatMap((item) => {
    if (!isRecord(item) || !text(item.id) || typeof item.ok !== "boolean") return [];
    return [{ id: String(item.id), ok: item.ok, ...(text(item.reason) ? { reason: String(item.reason) } : {}) }];
  });
}

/**
 * Refresh every link the server says is due (never fetched, or not for six
 * hours). Sent once when Today opens; never retried. Null when it did not work.
 */
export async function refreshDueRosterLinks(): Promise<RosterLinkRefreshResult[] | null> {
  try {
    const response = await fetch(`${LINKS_URL}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) return null;
    return readRefreshResults(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

const ADD_ERRORS: Record<string, string> = {
  not_https: "Use a link that starts with https://.",
  private_address: "That link points at a private address.",
  blocked_address: "That link points at a private address.",
  too_long: "That link is too long.",
};

const REFRESH_ERRORS: Record<string, string> = {
  blocked_address: "That link points at a private address.",
  too_large: "That calendar is too big to read.",
  unreachable: "That calendar could not be reached.",
  not_calendar: "That link is not a calendar.",
  too_many_shifts: "That calendar has too many shifts.",
};

/** Words for a stored refresh failure. */
export function describeLinkFailure(code: string | null): string | null {
  if (!code) return null;
  return REFRESH_ERRORS[code] ?? "The last refresh did not work.";
}

/** Whether one link refreshed without error within the last six hours. */
export function isLinkFresh(link: RosterCalendarLink, now: Date): boolean {
  if (link.lastError || !link.lastFetchedAt) return false;
  const age = now.getTime() - Date.parse(link.lastFetchedAt);
  return age >= 0 && age <= ROSTER_LINK_FRESH_MS;
}

/** Whether any link refreshed without error within the last six hours. */
export function hasFreshLink(links: readonly RosterCalendarLink[], now: Date): boolean {
  return links.some((link) => isLinkFresh(link, now));
}

/**
 * When a calendar link exists but none are fresh, the one Today offers Refresh
 * for: never-fetched or oldest first. Null when there are no links, or while
 * any link is still within the six-hour window.
 */
export function staleRosterLink(links: readonly RosterCalendarLink[], now: Date): RosterCalendarLink | null {
  if (links.length === 0 || hasFreshLink(links, now)) return null;
  return (
    [...links].sort((a, b) => {
      const aTime = a.lastFetchedAt ? Date.parse(a.lastFetchedAt) : 0;
      const bTime = b.lastFetchedAt ? Date.parse(b.lastFetchedAt) : 0;
      return aTime - bTime;
    })[0] ?? null
  );
}

type LoadedLinks = RosterCalendarLink[] | "signed-out" | "error" | "aborted";

async function fetchLinks(signal?: AbortSignal): Promise<LoadedLinks> {
  try {
    const response = await fetch(LINKS_URL, { cache: "no-store", signal });
    if (response.status === 401) return "signed-out";
    if (!response.ok) return "error";
    return readRosterLinks(await response.json().catch(() => null));
  } catch (error) {
    return (error as { name?: string })?.name === "AbortError" ? "aborted" : "error";
  }
}

export function useRosterLinks(): RosterLinksState {
  const [status, setStatus] = useState<RosterLinksState["status"]>("loading");
  const [links, setLinks] = useState<readonly RosterCalendarLink[]>([]);

  const apply = useCallback((result: LoadedLinks) => {
    if (result === "aborted") return;
    if (result === "signed-out" || result === "error") {
      setStatus(result);
      return;
    }
    setLinks(result);
    setStatus("ready");
  }, []);

  const load = useCallback(async () => apply(await fetchLinks()), [apply]);

  useEffect(() => {
    const controller = new AbortController();
    fetchLinks(controller.signal).then(apply, () => undefined);
    return () => controller.abort();
  }, [apply]);

  /** Refresh one link. Null when it worked, or the sentence saying why not. */
  const refreshOne = useCallback(async (id: string): Promise<string | null> => {
    try {
      const response = await fetch(`${LINKS_URL}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) return describeLinkFailure(errorCodeOf(payload)) ?? "Refresh did not work.";
      const result = readRefreshResults(payload)?.find((item) => item.id === id);
      if (!result) return "Refresh did not work.";
      return result.ok ? null : (describeLinkFailure(result.reason ?? null) ?? "Refresh did not work.");
    } catch {
      return "That link could not be refreshed. Check your connection and try again.";
    }
  }, []);

  const add = useCallback(
    async (url: string, workplace: string | null) => {
      try {
        const response = await fetch(LINKS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, workplace }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const code = errorCodeOf(payload);
          if (code === "duplicate_workplace") return "You already have a calendar link for that workplace.";
          if (response.status === 409) return "You can keep up to 3 calendar links.";
          return (code && ADD_ERRORS[code]) ?? "That link could not be added.";
        }
        // Read the new link straight away, so its shifts arrive without waiting for the next refresh.
        const added = isRecord(payload) && isRecord(payload.link) ? text(payload.link.id) : null;
        if (added) await refreshOne(added);
        await load();
        return null;
      } catch {
        return "That link could not be added. Check your connection and try again.";
      }
    },
    [load, refreshOne],
  );

  const remove = useCallback(async (id: string) => {
    try {
      const response = await fetch(LINKS_URL, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) return "That link could not be removed.";
      setLinks((current) => current.filter((link) => link.id !== id));
      return null;
    } catch {
      return "That link could not be removed. Check your connection and try again.";
    }
  }, []);

  const refresh = useCallback(
    async (id: string) => {
      const failure = await refreshOne(id);
      await load();
      return failure;
    },
    [load, refreshOne],
  );

  return { status, links, add, remove, refresh, reload: load };
}
