import type { WorkAreaId } from "@/lib/work-frame/areas";

/*
 * The example data switch's addresses, safe for the server and the browser.
 * The cookie is a display preference, never a credential: no API reads it,
 * and nothing it turns on can write anywhere.
 */

// Named in account-scoped-browser-state.ts, which clears them at every account transition.
export { EXAMPLE_DATA_COOKIE, EXAMPLE_DATA_STORAGE_KEY } from "@/lib/account-scoped-browser-state";

/** Every example record's id starts with this, so a list can always be stripped of examples. */
export const EXAMPLE_ID_PREFIX = "example:";

const AREAS: readonly WorkAreaId[] = ["day", "rost", "teach", "assess", "cpd", "admin", "call"];

/** "day.rost.teach" for a set of areas, or "" for none. */
export function encodeExampleCookie(areas: readonly WorkAreaId[]): string {
  return AREAS.filter((area) => areas.includes(area)).join(".");
}

/** The areas a cookie value names. Anything unrecognised is ignored. */
export function decodeExampleCookie(value: string | null | undefined): WorkAreaId[] {
  if (!value) return [];
  const named = value.split(".");
  return AREAS.filter((area) => named.includes(area));
}
