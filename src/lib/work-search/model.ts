import type { AppModeId } from "@/lib/app-modes";

/**
 * "Search my work": one search across the staff work areas (Roster, Teaching,
 * CPD, Admin, On Call), opened from the header icon on the staff modes.
 *
 * Everything here runs in the browser over records each area's own server
 * route already returned to the signed-in reader. Nothing is stored, indexed
 * or sent anywhere, and the device-only patient-label store (call log,
 * handover drafts, MHA timers) is never read — `tests/work-search.test.ts`
 * fails if any work-search file imports it.
 */

/** The areas searched, in the order the chips show them. */
export const workSearchAreas = ["roster", "teaching", "cme", "my-work", "on-call"] as const satisfies readonly AppModeId[];
export type WorkSearchArea = (typeof workSearchAreas)[number];

export const workSearchAreaLabels: Readonly<Record<WorkSearchArea, string>> = {
  roster: "Roster",
  teaching: "Teaching",
  cme: "CPD",
  "my-work": "Admin",
  "on-call": "On Call",
};

export function isWorkSearchArea(value: string): value is WorkSearchArea {
  return (workSearchAreas as readonly string[]).includes(value);
}

export type WorkItemKind = "shift" | "leave" | "session" | "cpd-activity" | "renewal" | "entry";

/** One searchable record, in the shape every area maps onto. Display text only. */
export interface WorkItem {
  /** `<area>:<kind>:<record id>`, unique across areas. */
  readonly id: string;
  readonly area: WorkSearchArea;
  readonly kind: WorkItemKind;
  readonly title: string;
  /** One short line under the title, e.g. "Mon 12 Oct · 21:00 to 08:30 · Ward 4". */
  readonly detail: string | null;
  /** Perth calendar date `YYYY-MM-DD` the record falls on or is due, or null when undated. */
  readonly date: string | null;
  readonly href: string;
  /** Text matched with the title's weight: names, kinds and synonyms the reader might type. */
  readonly tags: readonly string[];
  /** Text matched with the lowest weight: places, notes and reflections. */
  readonly text: readonly string[];
}

/** How one area's read went, so the screen can say honestly what it could not search. */
export type WorkAreaStatus = "loading" | "ready" | "failed" | "signed-out";

export interface WorkAreaRead {
  readonly area: WorkSearchArea;
  readonly status: WorkAreaStatus;
  /** True when the records are invented sample data rather than the reader's own. */
  readonly sample: boolean;
}
