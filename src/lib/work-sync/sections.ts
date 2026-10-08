import {
  ADMIN_PAPERWORK_STORAGE_KEY,
  CPD_APPLICATIONS_STORAGE_KEY,
  MY_DAY_HIDDEN_CARDS_STORAGE_KEY,
  MY_DAY_QUICK_NOTE_STORAGE_KEY,
  MY_DAY_SNOOZED_ITEMS_STORAGE_KEY,
  TEACHING_EXAM_PREP_STORAGE_KEY,
  TEACHING_TERM_TRACKER_STORAGE_KEY,
  WORK_PAGE_FAVOURITES_STORAGE_KEY,
} from "@/lib/account-scoped-browser-state";

/**
 * The work-mode choices that follow the doctor to every device they sign in
 * on (owner decision 7 Oct 2026, "Backend decisions for Josh"). Each one is
 * still read and written on the device through its own store; the account
 * copy is a mirror kept in step by `work-sync-client.ts`, so the pages work the
 * same with no connection.
 *
 * The small choices live at `user_preferences.preferences.work`. Admin paperwork
 * has its own table, and the Teaching and CPD records are backed up to another
 * (owner decision 8 Oct 2026, questions 3 and 4): see `WORK_SYNC_ACCOUNT_STORES`.
 *
 * Shared by the client and the server: no server code and no schemas here.
 */
export const WORK_SYNC_SECTIONS = [
  "favouriteWorkPages",
  "myDayHiddenCards",
  "myDaySnoozes",
  "myDayQuickNote",
  "adminPaperwork",
  "teachingTermTracker",
  "teachingExamPrep",
  "cpdApplications",
] as const;

export type WorkSyncSection = (typeof WORK_SYNC_SECTIONS)[number];

/** The device key each section mirrors. The device value is exactly what the store writes there. */
export const WORK_SYNC_STORAGE_KEYS: Readonly<Record<WorkSyncSection, string>> = {
  favouriteWorkPages: WORK_PAGE_FAVOURITES_STORAGE_KEY,
  myDayHiddenCards: MY_DAY_HIDDEN_CARDS_STORAGE_KEY,
  myDaySnoozes: MY_DAY_SNOOZED_ITEMS_STORAGE_KEY,
  myDayQuickNote: MY_DAY_QUICK_NOTE_STORAGE_KEY,
  adminPaperwork: ADMIN_PAPERWORK_STORAGE_KEY,
  teachingTermTracker: TEACHING_TERM_TRACKER_STORAGE_KEY,
  teachingExamPrep: TEACHING_EXAM_PREP_STORAGE_KEY,
  cpdApplications: CPD_APPLICATIONS_STORAGE_KEY,
};

/**
 * Where the account copy of each section is kept: the preferences row (small
 * choices), the `work_admin_paperwork` table, or the `work_backups` table.
 */
export type WorkSyncAccountStore = "preferences" | "paperwork" | "backups";

export const WORK_SYNC_ACCOUNT_STORES: Readonly<Record<WorkSyncSection, WorkSyncAccountStore>> = {
  favouriteWorkPages: "preferences",
  myDayHiddenCards: "preferences",
  myDaySnoozes: "preferences",
  myDayQuickNote: "preferences",
  adminPaperwork: "paperwork",
  teachingTermTracker: "backups",
  teachingExamPrep: "backups",
  cpdApplications: "backups",
};

/**
 * Never copied down to a device marked shared ("This is a shared computer" in
 * Alerts): CPD keeps no job applications there, because a referee's name must
 * not sit on a ward computer for the next person (`src/lib/cme/device-record.ts`).
 */
export function skipsSharedDevice(section: WorkSyncSection): boolean {
  return section === "cpdApplications";
}

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

/** True when a value holds nothing, which the device stores keep as no key at all. */
export function isEmptyWorkSyncValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}
