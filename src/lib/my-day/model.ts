/**
 * My Day: one time-ordered list of what needs the reader across the
 * operational modes (On Call, Roster, CPD, Teaching, Admin).
 *
 * This file holds the shared item shape and the pure merge/sort rules only.
 * It derives nothing itself: each mode's own "needs you" / coming-up
 * selectors produce the facts, and a per-mode adapter under
 * `src/components/my-day/sources/` maps them onto `MyDayItem` (hrefs are
 * built there, because `src/lib` may not import `@/components`).
 *
 * Nothing here is stored or sent anywhere: My Day is a read-only view over
 * data each mode already loads for the reader.
 */

import type { AdminHelpItem } from "@/lib/admin/help-items";
import type { RenewalRow } from "@/lib/my-day/figures";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import type { TodayItem } from "@/lib/today/today-item";
import { todaySeverities, type TodaySeverity } from "@/lib/today/today-item";

/** The modes My Day gathers from, in the order they are named on the page. */
export const myDaySourceModes = ["on-call", "roster", "cme", "teaching", "my-work"] as const;
export type MyDaySourceMode = (typeof myDaySourceModes)[number];

/** Overdue first, then due soon, then the rest: the shared Today order. */
export const myDaySeverities = todaySeverities;
export type MyDaySeverity = TodaySeverity;

/** How many Perth calendar days ahead (inclusive of today) still count as "due soon". */
export const MY_DAY_SOON_DAYS = 7;

/**
 * A shared `TodayItem` whose owning mode is one of the five My Day gathers,
 * so anything that produces Today items can feed My Day unchanged.
 */
export interface MyDayItem extends TodayItem {
  readonly mode: MyDaySourceMode;
}

/**
 * Whether the sources should read, given the sign-in status. A signed-in
 * reader, or a local demo build with no Supabase configured (the API routes
 * answer with demo data), is enabled; loading, error and signed-out are not.
 */
export function myDayEnabledForAuth(status: string): boolean {
  return status === "authenticated" || status === "unconfigured";
}

/** True when the reader has to sign in (again) before My Day can read anything. */
export function myDayNeedsSignIn(status: string): boolean {
  return status === "signed_out" || status === "expired";
}

/** How one mode's read went, so the page can say honestly what it could not load. */
export type MyDaySourceStatus = "loading" | "ready" | "failed" | "signed-out" | "unavailable";

export interface MyDaySourceResult {
  readonly mode: MyDaySourceMode;
  readonly status: MyDaySourceStatus;
  readonly items: readonly MyDayItem[];
  /** True when the data is invented sample/demo data rather than the reader's own. */
  readonly sample?: boolean;
}

/**
 * The reader's next recorded Admin date still ahead (today or later), for the
 * dashboard's "Next renewal" card. Read from Admin's own "Coming up" selector.
 */
export interface MyDayNextRenewal {
  readonly entryId: string;
  /** The reader's own label for the requirement, as Admin shows it. */
  readonly title: string;
  /** `YYYY-MM-DD`, the recorded date. */
  readonly date: string;
  readonly href: string;
  /** True when it comes from invented demo entries. */
  readonly sample: boolean;
}

/** The whole view, as the page and the home card read it. */
export interface MyDayState {
  /** `loading` until every enabled source has settled at least once. */
  readonly status: "loading" | "ready" | "signed-out";
  /** Merged and sorted with `mergeMyDayItems`. */
  readonly items: readonly MyDayItem[];
  readonly sources: readonly MyDaySourceResult[];
  /** True when any source is showing demo/sample data. */
  readonly demoMode: boolean;
  readonly retry: () => void;
  /** Admin's next recorded date ahead; absent until Admin's read is ready, null when there is none. */
  readonly nextRenewal?: MyDayNextRenewal | null;
  /** Every recorded Admin date, passed to a year ahead, for the runway and the wallet. */
  readonly renewals?: readonly RenewalRow[];
  /** Admin's Help items, for the pinned numbers card. */
  readonly helpItems?: readonly AdminHelpItem[];
  /** The reader's own Admin entries, for Renew next and the renewals timeline. */
  readonly adminEntries?: readonly OnCallEntry[];
}
