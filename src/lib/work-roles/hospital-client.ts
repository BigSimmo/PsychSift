import { parseHospitalSickView, type HospitalSickView } from "@/lib/work-roles/hospital-hub";

/**
 * The typed client for `/api/work/hospital/sick`, the hospital's sick calls.
 * Every answer comes back as a plain outcome the screen can draw, never a
 * thrown error: signed out, not allowed, not ready (the role tables are not
 * built yet), offline, or a failure with a short reason.
 */

export const HOSPITAL_SICK_ENDPOINT = "/api/work/hospital/sick";

export type HospitalSickOutcome =
  | { readonly status: "ok"; readonly data: HospitalSickView }
  | { readonly status: "signed-out" }
  | { readonly status: "forbidden" }
  | { readonly status: "not-ready" }
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

function field(body: unknown, key: "code" | "error" | "message"): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Turns one HTTP answer into an outcome. Exported for tests. */
export async function hospitalSickOutcome(response: Response): Promise<HospitalSickOutcome> {
  const body = await readJson(response);
  if (response.status === 401) return { status: "signed-out" };
  if (response.status === 403) return { status: "forbidden" };
  if (response.status === 503 && field(body, "code") === "work_roles_not_ready") return { status: "not-ready" };
  if (!response.ok) return { status: "error", message: field(body, "error") ?? field(body, "message") };
  const data = parseHospitalSickView(body);
  return data ? { status: "ok", data } : { status: "error", message: null };
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Reads one hospital's sick calls, from yesterday to a week ahead. */
export async function fetchHospitalSick(
  hospitalId: string,
  options: { readonly signal?: AbortSignal; readonly fetcher?: Fetcher } = {},
): Promise<HospitalSickOutcome> {
  try {
    const response = await (options.fetcher ?? fetch)(
      `${HOSPITAL_SICK_ENDPOINT}?hospitalId=${encodeURIComponent(hospitalId)}`,
      { cache: "no-store", credentials: "same-origin", signal: options.signal },
    );
    return await hospitalSickOutcome(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return isOffline() ? { status: "offline" } : { status: "error", message: null };
  }
}
