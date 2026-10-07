import { EXAMPLE_ID_PREFIX } from "@/lib/example-data/keys";

/**
 * No-bleed guards. Example records must never reach the account, an export, a
 * shared link, search history or a notification. Every example record carries
 * an id starting `example:`, so these checks need no other knowledge of it.
 */

export { EXAMPLE_ID_PREFIX };

type WithId = { readonly id?: unknown } | null | undefined;

/** True for an example id, or a record whose id is one. */
export function isExampleRecord(value: string | WithId): boolean {
  const id = typeof value === "string" ? value : value?.id;
  return typeof id === "string" && id.startsWith(EXAMPLE_ID_PREFIX);
}

/** The list without example records. Use before any export, share, history write or notification. */
export function withoutExampleRecords<T extends WithId | string>(list: readonly T[]): T[] {
  return list.filter((item) => !isExampleRecord(item));
}

/** Prefix an id as an example id. Idempotent. */
export function exampleId(id: string): string {
  return id.startsWith(EXAMPLE_ID_PREFIX) ? id : `${EXAMPLE_ID_PREFIX}${id}`;
}

/** What the user tried to do with example data, for the sheet's wording. */
export type ExampleBlockedAction = "export" | "share" | "save" | "send" | "copy";

export const EXAMPLE_BLOCKED_EVENT = "psychsift:example-blocked";

/**
 * Call before an export, share, send or save while an area shows example data.
 * Returns true when the action may go ahead. When `active` is true it returns
 * false and asks the banner to open the "Turn it off to export your own
 * records" sheet, so a screen needs one line: `if (!guardExampleAction(active, "export")) return;`
 */
export function guardExampleAction(active: boolean, kind: ExampleBlockedAction): boolean {
  if (!active) return true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ExampleBlockedAction>(EXAMPLE_BLOCKED_EVENT, { detail: kind }));
  }
  return false;
}
