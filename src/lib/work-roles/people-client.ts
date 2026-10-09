import { parseWorkPeopleResponse, type WorkPeopleAction, type WorkPeopleResponse } from "@/lib/work-roles/people-model";

/**
 * The typed client for `/api/work/people`, the People and roles screen's one
 * read and one write. Every answer comes back as a plain outcome the screen
 * can draw, never a thrown error: signed out, not allowed, not ready (the
 * role tables are not built yet), offline, or a failure with a short reason.
 */

export const WORK_PEOPLE_ENDPOINT = "/api/work/people";

export type WorkPeopleOutcome =
  | { readonly status: "ok"; readonly data: WorkPeopleResponse }
  | { readonly status: "signed-out" }
  | { readonly status: "forbidden" }
  | { readonly status: "not-ready" }
  /** A grant by email found no account with that email. */
  | { readonly status: "person-not-found" }
  | { readonly status: "offline" }
  | { readonly status: "error"; readonly message: string | null };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function codeOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function messageOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { error?: unknown; message?: unknown };
  const text = typeof record.error === "string" ? record.error : record.message;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

/** Turns one HTTP answer into an outcome. Exported for tests. */
export async function workPeopleOutcome(response: Response): Promise<WorkPeopleOutcome> {
  const body = await readJson(response);
  if (response.status === 401) return { status: "signed-out" };
  if (response.status === 403) return { status: "forbidden" };
  if (response.status === 503 && codeOf(body) === "work_roles_not_ready") return { status: "not-ready" };
  if (response.status === 404 && codeOf(body) === "work_person_not_found") return { status: "person-not-found" };
  if (!response.ok) return { status: "error", message: messageOf(body) };
  const data = parseWorkPeopleResponse(body);
  return data ? { status: "ok", data } : { status: "error", message: null };
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Reads one hospital's people and roles. With no id the server picks the viewer's first hospital. */
export async function fetchWorkPeople(
  hospitalId?: string | null,
  options: { readonly signal?: AbortSignal; readonly fetcher?: Fetcher } = {},
): Promise<WorkPeopleOutcome> {
  const url = hospitalId
    ? `${WORK_PEOPLE_ENDPOINT}?hospitalId=${encodeURIComponent(hospitalId)}`
    : WORK_PEOPLE_ENDPOINT;
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal,
    });
    return await workPeopleOutcome(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return isOffline() ? { status: "offline" } : { status: "error", message: null };
  }
}

/** What the screen says when a grant by email finds nobody. */
export const PERSON_NOT_FOUND_MESSAGE = "No PsychSift account uses that email. Ask them to sign in once first.";

/** Sends one change. The answer is the affected hospital, read fresh, in the same shape as the read. */
export async function postWorkPeople(
  action: WorkPeopleAction,
  options: { readonly fetcher?: Fetcher } = {},
): Promise<WorkPeopleOutcome> {
  if (isOffline()) return { status: "offline" };
  try {
    const response = await (options.fetcher ?? fetch)(WORK_PEOPLE_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    return await workPeopleOutcome(response);
  } catch {
    return isOffline() ? { status: "offline" } : { status: "error", message: null };
  }
}
