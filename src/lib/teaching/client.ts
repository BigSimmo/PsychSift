import { ApiClientError, parseApiErrorResponse } from "@/lib/api-client-error";

/*
 * The browser side of Teaching's API. Every read is `cache: "no-store"` and
 * held in React state only: Teaching keeps nothing on the device.
 */
export class TeachingSignedOutError extends Error {
  constructor() {
    super("Sign in to see your hospital's teaching.");
    this.name = "TeachingSignedOutError";
  }
}

export type TeachingLoadFailure = "signed-out" | "offline" | "setup" | "error";

async function settle<T>(response: Response): Promise<T> {
  if (response.status === 401) throw new TeachingSignedOutError();
  if (!response.ok) throw await parseApiErrorResponse(response);
  return (await response.json()) as T;
}

export async function teachingGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  return settle<T>(await fetch(url, { cache: "no-store", signal }));
}

/** `keepalive` lets a delayed post (Organise's undo window) finish if the page closes first. */
export async function teachingPost<T>(
  url: string,
  body: Record<string, unknown>,
  options: { keepalive?: boolean } = {},
): Promise<T> {
  return settle<T>(
    await fetch(url, {
      method: "POST",
      cache: "no-store",
      keepalive: options.keepalive,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * A post that also returns the server's own clock, read once from the response's `Date` header. The check-in
 * card compares it with the server's `recordedAt` to tell a repeat scan from a fresh one: both times come from
 * the server, so a ticking page clock or a device clock running fast can never turn a fresh check-in into a
 * repeat. Null when the header is missing or unreadable, and then the card claims nothing.
 */
export async function teachingPostTimed<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ data: T; serverTime: number | null }> {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const header = response.headers.get("date");
  const parsed = header ? Date.parse(header) : Number.NaN;
  const data = await settle<T>(response);
  return { data, serverTime: Number.isFinite(parsed) ? parsed : null };
}

/** A multipart upload (the term import's .xlsx); the browser sets the boundary header itself. */
export async function teachingUpload<T>(url: string, form: FormData): Promise<T> {
  return settle<T>(await fetch(url, { method: "POST", cache: "no-store", body: form }));
}

export function teachingServiceUrl(serviceId: string, query?: Record<string, string>): string {
  const base = `/api/teaching/services/${encodeURIComponent(serviceId)}`;
  return query ? `${base}?${new URLSearchParams(query).toString()}` : base;
}

/** "offline" only when the browser reports no network: a server fault is never described as the doctor's signal. */
export function teachingLoadFailure(
  error: unknown,
  online: boolean = typeof navigator === "undefined" ? true : navigator.onLine,
): TeachingLoadFailure {
  if (error instanceof TeachingSignedOutError) return "signed-out";
  if (!online) return "offline";
  if (error instanceof ApiClientError && error.code === "teaching_setup_pending") return "setup";
  return "error";
}

const MESSAGES: Record<string, string> = {
  teaching_code_expired: "That code has changed. Scan the new one on screen.",
  teaching_code_invalid: "That code didn't match. Check the six digits on screen and try again.",
  teaching_code_other_team:
    "That code belongs to another service's session. Ask its organiser for an invitation if you should be there.",
  teaching_window_closed: "Check-in for this session has closed. You can still check in without code for 7 days.",
  teaching_link_expired: "This display link has ended. Open a new one from the session page.",
  teaching_not_attended: "Check in first, then log it to CPD.",
  teaching_not_found: "This session is no longer in the programme.",
  teaching_access_denied: "You're not a member of this service. Ask its organiser for an invitation.",
  teaching_role_denied: "That's for your service's organisers.",
  teaching_team_unverified: "This service isn't set up for real records yet, so only the demo service can be used.",
  teaching_limit: "That's more than Teaching takes in one go. Try fewer.",
  teaching_invalid_request: "Something in that didn't look right. Check it and try again.",
  teaching_no_health_service: "Your service has no health service yet. Ask for it to be set.",
  cme_year_missing: "Set up this year in CPD first, then log the session.",
  cme_year_closed: "That CPD year is closed. Open CPD to record an amendment.",
};

export function teachingErrorMessage(error: unknown, context?: "cpd"): string {
  if (error instanceof TeachingSignedOutError) return error.message;
  if (context === "cpd" && error instanceof ApiClientError && error.code === "teaching_window_closed")
    return "Wait until the session has ended before logging it to CPD.";
  if (error instanceof ApiClientError && MESSAGES[error.code]) return MESSAGES[error.code];
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return "You're offline. Teaching needs a connection.";
  return "The outcome could not be confirmed. Check your records before trying again.";
}
