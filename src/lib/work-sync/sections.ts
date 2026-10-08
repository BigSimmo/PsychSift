import {
  MY_DAY_HIDDEN_CARDS_STORAGE_KEY,
  MY_DAY_QUICK_NOTE_STORAGE_KEY,
  MY_DAY_SNOOZED_ITEMS_STORAGE_KEY,
  WORK_PAGE_FAVOURITES_STORAGE_KEY,
} from "@/lib/account-scoped-browser-state";

/**
 * The work-mode choices that follow the doctor to every device they sign in
 * on (owner decision 7 Oct 2026, "Backend decisions for Josh"). Each one is
 * still read and written on the device through its own store; the account
 * copy at `user_preferences.preferences.work` is a mirror kept in step by
 * `work-sync-client.ts`, so the pages work the same with no connection.
 *
 * Shared by the client and the server: no server code and no schemas here.
 */
export const WORK_SYNC_SECTIONS = ["favouriteWorkPages", "myDayHiddenCards", "myDaySnoozes", "myDayQuickNote"] as const;

export type WorkSyncSection = (typeof WORK_SYNC_SECTIONS)[number];

/** The device key each section mirrors. The device value is exactly what the store writes there. */
export const WORK_SYNC_STORAGE_KEYS: Readonly<Record<WorkSyncSection, string>> = {
  favouriteWorkPages: WORK_PAGE_FAVOURITES_STORAGE_KEY,
  myDayHiddenCards: MY_DAY_HIDDEN_CARDS_STORAGE_KEY,
  myDaySnoozes: MY_DAY_SNOOZED_ITEMS_STORAGE_KEY,
  myDayQuickNote: MY_DAY_QUICK_NOTE_STORAGE_KEY,
};

/** Every section but the quick note is stored on the device as JSON; the note is its own text. */
export function isTextSection(section: WorkSyncSection): boolean {
  return section === "myDayQuickNote";
}

export function isWorkSyncSection(value: unknown): value is WorkSyncSection {
  return typeof value === "string" && (WORK_SYNC_SECTIONS as readonly string[]).includes(value);
}

/** Longest quick note kept, matching the My Day field. */
export const WORK_SYNC_QUICK_NOTE_LIMIT = 500;

/** Fired on `window` by a store after the doctor changes one of the keys above on this device. */
export const WORK_SYNC_CHANGE_EVENT = "psychsift:work-sync-change";

/**
 * A store calls this after it writes one of the mirrored keys because the doctor
 * changed something here, so the account copy follows. Never called for a write
 * that came from the account copy, which would echo it straight back.
 */
export function announceWorkSyncChange(storageKey: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORK_SYNC_CHANGE_EVENT, { detail: storageKey }));
}
