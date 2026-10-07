import { looksLikePatientDetails } from "@/lib/work-search/signals";

/**
 * Everything Search my work remembers, in one place, so each path can be shown
 * to keep patient details out (privacy fix approved by Josh, 7 Oct 2026).
 *
 * All of it lives in this tab's memory only: never in browser storage, the
 * address, history entries, logs or anything sent. Each write that could carry
 * typed text re-runs the patient-detail check itself, whatever the caller
 * already checked, so a new caller cannot skip it.
 *
 * - Recent searches: up to five, per account (auth epoch).
 * - The last unfinished search: restored if the search is reopened within five minutes.
 * - "Cleared what you typed": a flag only, never the text.
 * - Timings: fixed names on the browser's own performance timeline. No function
 *   here takes text for a timing, so typed text cannot reach one.
 */

export const RECENT_LIMIT = 5;
export const RESUME_FOR_MS = 5 * 60 * 1000;

let recentMemory: { epoch: number; list: string[] } = { epoch: -1, list: [] };
let lastSearch: { epoch: number; query: string; at: number } | null = null;
let clearedPatientDetails: { epoch: number } | null = null;
let navigatedAway = false;
let historyStepHeld = false;

/** True when the text may be kept: long enough to be a search, and not patient details. */
export function safeToKeep(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 2 && !looksLikePatientDetails(trimmed);
}

export function recentsFor(epoch: number): string[] {
  return recentMemory.epoch === epoch ? recentMemory.list : [];
}

/** Adds a search to Recent, most recent first. Patient details are refused here, not only by the caller. */
export function rememberQuery(query: string, epoch: number): boolean {
  if (!safeToKeep(query)) return false;
  const trimmed = query.trim();
  const list = recentsFor(epoch).filter((value) => safeToKeep(value));
  recentMemory = {
    epoch,
    list: [trimmed, ...list.filter((value) => value.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENT_LIMIT),
  };
  return true;
}

export function forgetRecent(value: string, epoch: number) {
  recentMemory = { epoch, list: recentsFor(epoch).filter((item) => item !== value) };
}

export function clearRecents(epoch: number) {
  recentMemory = { epoch, list: [] };
}

/** The search to restore on reopening, if it is recent, from this account, and (checked again) safe to show. */
export function resumableSearch(epoch: number, now: number = Date.now()): string {
  if (!lastSearch || lastSearch.epoch !== epoch || now - lastSearch.at >= RESUME_FOR_MS) return "";
  return safeToKeep(lastSearch.query) ? lastSearch.query : "";
}

/**
 * As the search closes: keep an unfinished search for a few minutes (never patient details), and when
 * patient details were left in the box, drop them and leave the flag for "Cleared what you typed".
 */
export function noteClosing(query: string, epoch: number, navigated: boolean, now: number = Date.now()) {
  const current = query.trim();
  const hasPatientDetails = current.length > 0 && looksLikePatientDetails(current);
  lastSearch = !navigated && current && safeToKeep(current) ? { epoch, query: current, at: now } : null;
  if (hasPatientDetails) clearedPatientDetails = { epoch };
  navigatedAway = navigated;
}

/** Whether "Cleared what you typed" is owed to this account's next opening. Reading does not spend it. */
export function clearedNoticeOwed(epoch: number): boolean {
  return clearedPatientDetails?.epoch === epoch;
}

/** Spends the "Cleared what you typed" flag once the opening that shows it has read it. */
export function takeClearedFlag(epoch: number): boolean {
  const owed = clearedNoticeOwed(epoch);
  clearedPatientDetails = null;
  return owed;
}

/** True when the search last closed by opening a result, so focus belongs to the new page. */
export function closedByNavigating(): boolean {
  return navigatedAway;
}

/** The open search added one history step (the same address, no text), so Back closes it. */
export function holdHistoryStep() {
  historyStepHeld = true;
}

export function holdsHistoryStep(): boolean {
  return historyStepHeld;
}

/** Gives up the history step: true when there was one to give up. */
export function takeHistoryStep(): boolean {
  const held = historyStepHeld;
  historyStepHeld = false;
  return held;
}

/** The only timing names Search my work records. Fixed strings: never built from what was typed. */
export const WORK_SEARCH_TIMINGS = {
  open: "work-search:open",
  key: "work-search:key",
  openToFirstResult: "work-search:open-to-first-result",
  keyToResults: "work-search:keystroke-to-results",
} as const;

function timeline(): Performance | null {
  return typeof performance === "undefined" ? null : performance;
}

function measure(name: string, from: string) {
  const perf = timeline();
  if (!perf) return;
  try {
    if (perf.getEntriesByName(from, "mark").length === 0) return;
    if (perf.getEntriesByName(name, "measure").length > 40) perf.clearMeasures(name);
    perf.measure(name, from);
    perf.clearMarks(from);
  } catch {
    // A browser without the timeline simply records nothing.
  }
}

/** A key was pressed in the box. Takes no text. */
export function markKeystroke() {
  try {
    timeline()?.mark(WORK_SEARCH_TIMINGS.key);
  } catch {
    // As above.
  }
}

/** The results caught up with the last key. Takes no text. */
export function measureKeystrokeToResults() {
  measure(WORK_SEARCH_TIMINGS.keyToResults, WORK_SEARCH_TIMINGS.key);
}

/** The first records showed after opening. Takes no text. */
export function measureOpenToFirstResult() {
  measure(WORK_SEARCH_TIMINGS.openToFirstResult, WORK_SEARCH_TIMINGS.open);
}

/** For tests: forget everything. */
export function resetWorkSearchMemory() {
  recentMemory = { epoch: -1, list: [] };
  lastSearch = null;
  clearedPatientDetails = null;
  navigatedAway = false;
  historyStepHeld = false;
}
