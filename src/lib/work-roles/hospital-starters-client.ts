import { parseHospitalStartersView, type HospitalStartersView } from "@/lib/work-roles/hospital-starters-model";

/**
 * Typed clients for New starters: Workforce's read of one hospital
 * (`/api/work/hospital/starters`), and a doctor's own sharing choice
 * (`/api/work/starters/sharing`). Every answer comes back as a plain outcome
 * the screen can draw, never a thrown error. Nothing here is kept on the
 * device: each read goes to the server, so a doctor who stops sharing drops off
 * Workforce's next read.
 */

export const HOSPITAL_STARTERS_ENDPOINT = "/api/work/hospital/starters";
export const STARTER_SHARING_ENDPOINT = "/api/work/starters/sharing";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type Failure =
  | { readonly status: "signed-out" }
  | { readonly status: "not-ready" }
  | { readonly status: "offline" }
  | { readonly status: "error"; readonly message: string | null };

export type HospitalStartersOutcome =
  { readonly status: "ok"; readonly data: HospitalStartersView } | { readonly status: "forbidden" } | Failure;

export type StarterSharingOutcome = { readonly status: "ok"; readonly share: boolean } | Failure;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function field(body: unknown, key: "code" | "error" | "message"): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function failed(error: unknown): Failure {
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  return isOffline() ? { status: "offline" } : { status: "error", message: null };
}

/** Turns one HTTP answer into an outcome. Exported for tests. */
export async function hospitalStartersOutcome(response: Response): Promise<HospitalStartersOutcome> {
  const body = await readJson(response);
  if (response.status === 401) return { status: "signed-out" };
  if (response.status === 403) return { status: "forbidden" };
  if (response.status === 503 && field(body, "code") === "work_roles_not_ready") return { status: "not-ready" };
  if (!response.ok) return { status: "error", message: field(body, "error") ?? field(body, "message") };
  const data = parseHospitalStartersView(body);
  return data ? { status: "ok", data } : { status: "error", message: null };
}

/** Reads one hospital's starters who share. */
export async function fetchHospitalStarters(
  hospitalId: string,
  options: { readonly signal?: AbortSignal; readonly fetcher?: Fetcher } = {},
): Promise<HospitalStartersOutcome> {
  try {
    const response = await (options.fetcher ?? fetch)(
      `${HOSPITAL_STARTERS_ENDPOINT}?hospitalId=${encodeURIComponent(hospitalId)}`,
      { cache: "no-store", credentials: "same-origin", signal: options.signal },
    );
    return await hospitalStartersOutcome(response);
  } catch (error) {
    return failed(error);
  }
}

/** Turns one HTTP answer about the sharing choice into an outcome. Exported for tests. */
export async function starterSharingOutcome(response: Response): Promise<StarterSharingOutcome> {
  const body = await readJson(response);
  if (response.status === 401) return { status: "signed-out" };
  if (response.status === 503 && field(body, "code") === "work_roles_not_ready") return { status: "not-ready" };
  if (!response.ok) return { status: "error", message: field(body, "error") ?? field(body, "message") };
  const share = body && typeof body === "object" ? (body as Record<string, unknown>).share : undefined;
  return typeof share === "boolean" ? { status: "ok", share } : { status: "error", message: null };
}

/** Reads the signed-in doctor's own sharing choice. */
export async function fetchStarterSharing(
  options: { readonly signal?: AbortSignal; readonly fetcher?: Fetcher } = {},
): Promise<StarterSharingOutcome> {
  try {
    const response = await (options.fetcher ?? fetch)(STARTER_SHARING_ENDPOINT, {
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal,
    });
    return await starterSharingOutcome(response);
  } catch (error) {
    return failed(error);
  }
}

/** Turns sharing on or off. The answer is the choice the server now holds. */
export async function saveStarterSharing(
  share: boolean,
  options: { readonly fetcher?: Fetcher } = {},
): Promise<StarterSharingOutcome> {
  try {
    const response = await (options.fetcher ?? fetch)(STARTER_SHARING_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share }),
      cache: "no-store",
      credentials: "same-origin",
    });
    return await starterSharingOutcome(response);
  } catch (error) {
    return failed(error);
  }
}
