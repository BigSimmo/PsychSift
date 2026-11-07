import "server-only";

import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import { isGlobalPublicAddress } from "@/lib/public-source-acquisition";

/**
 * Fetches a doctor's calendar link (an ICS feed from a rostering system) on the
 * server. The link is the doctor's own and often carries a private token, so it
 * is never logged, and errors never repeat it.
 *
 * Only https to a public internet address: every address the name resolves to
 * must be public, the connection is pinned to the checked address, and each
 * redirect is checked again. Two megabytes and ten seconds at most, and the
 * body must be a calendar.
 */

export const CALENDAR_LINK_MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type CalendarLinkFailure =
  "not_https" | "private_address" | "too_big" | "timeout" | "not_calendar" | "http_error";

export class CalendarLinkError extends Error {
  constructor(readonly reason: CalendarLinkFailure) {
    super(reason);
  }
}

type Address = { address: string; family: 4 | 6 };
export type LinkResolver = (hostname: string) => Promise<Address[]>;
export type LinkResponse = {
  status: number;
  location: string | null;
  body: AsyncIterable<Uint8Array>;
  cancel: () => void;
};
export type LinkRequest = (input: { url: URL; address: Address; signal: AbortSignal }) => Promise<LinkResponse>;

const defaultResolver: LinkResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));

/**
 * A connection `lookup` that always answers with the address already checked.
 * Node 24 asks with `{ all: true }` (to race IPv4 and IPv6), and then the
 * answer must be a list; otherwise it is the single address and its family.
 */
export function pinnedLookup(address: Address) {
  return (
    _hostname: string,
    options: { all?: boolean } | null | undefined,
    callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    if (options?.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  };
}

const defaultRequest: LinkRequest = ({ url, address, signal }) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: { accept: "text/calendar, text/plain" },
        servername: url.hostname,
        lookup: pinnedLookup(address),
        signal,
      },
      (response) =>
        resolve({
          status: response.statusCode ?? 0,
          location: typeof response.headers.location === "string" ? response.headers.location : null,
          body: response,
          cancel: () => response.destroy(),
        }),
    );
    request.once("error", reject);
    request.end();
  });

/** A pasted link as the https URL it will be fetched from; `webcal://` is the same feed over https. */
export function normaliseCalendarLink(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    throw new CalendarLinkError("not_https");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new CalendarLinkError("not_https");
  }
  url.hash = "";
  return url;
}

async function checkedAddress(url: URL, resolve: LinkResolver, signal: AbortSignal): Promise<Address> {
  if (signal.aborted) throw new CalendarLinkError("timeout");
  let rejectAbort: (reason: CalendarLinkError) => void = () => undefined;
  const onAbort = () => rejectAbort(new CalendarLinkError("timeout"));
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
    signal.addEventListener("abort", onAbort, { once: true });
  });
  let addresses: Address[];
  try {
    // DNS itself cannot be cancelled, but the caller's deadline must still
    // settle. Promise.race owns a later resolver rejection as well.
    addresses = await Promise.race([resolve(url.hostname), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  if (addresses.length === 0 || !addresses.every((entry) => isGlobalPublicAddress(entry.address))) {
    throw new CalendarLinkError("private_address");
  }
  return addresses[0]!;
}

export async function fetchCalendarLink(
  raw: string,
  deps: { resolve?: LinkResolver; request?: LinkRequest } = {},
): Promise<string> {
  const resolve = deps.resolve ?? defaultResolver;
  const request = deps.request ?? defaultRequest;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = normaliseCalendarLink(raw);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const address = await checkedAddress(url, resolve, controller.signal);
      if (controller.signal.aborted) throw new CalendarLinkError("timeout");
      const response = await request({ url, address, signal: controller.signal });
      if (response.status >= 300 && response.status < 400 && response.location) {
        response.cancel();
        url = normaliseCalendarLink(new URL(response.location, url).toString());
        continue;
      }
      if (response.status !== 200) {
        response.cancel();
        throw new CalendarLinkError("http_error");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > CALENDAR_LINK_MAX_BYTES) {
          response.cancel();
          throw new CalendarLinkError("too_big");
        }
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
      if (!/^\s*BEGIN:VCALENDAR/i.test(text)) throw new CalendarLinkError("not_calendar");
      return text;
    }
    throw new CalendarLinkError("http_error");
  } catch (error) {
    if (error instanceof CalendarLinkError) throw error;
    throw new CalendarLinkError(controller.signal.aborted ? "timeout" : "http_error");
  } finally {
    clearTimeout(timer);
  }
}
