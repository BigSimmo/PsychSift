import { isValidApplications, type ApplicationsState } from "@/lib/cme/applications";
import {
  isValidExamPrep,
  isValidTermTracker,
  type ExamPrepState,
  type TermTrackerState,
} from "@/lib/teaching/term-tracker";
import { isValidPaperwork, type AdminPaperwork } from "@/lib/work-screens/admin/paperwork-model";
import { isEmptyWorkSyncValue, WORK_SYNC_QUICK_NOTE_LIMIT, type WorkSyncSection } from "@/lib/work-sync/sections";

export { isEmptyWorkSyncValue };

/**
 * Joins what this device kept from before its first sync with what the
 * account already holds, so turning sync on loses nothing from either side.
 * Used once per device and account; after that the account copy wins.
 *
 * Values are as each store keeps them on the device, already parsed: an array
 * for saved pages and hidden cards, an id-to-date map for moved items, text for
 * the quick note, a whole record for Admin paperwork and the Teaching and CPD
 * records. Anything unreadable counts as empty.
 */

const MAX_FAVOURITES = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function favouriteKey(entry: unknown): string | null {
  if (!isRecord(entry) || typeof entry.areaId !== "string" || typeof entry.itemId !== "string") return null;
  return `${entry.areaId}:${entry.itemId}`;
}

function mergeFavourites(local: unknown, account: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const entry of [...(Array.isArray(account) ? account : []), ...(Array.isArray(local) ? local : [])]) {
    const key = favouriteKey(entry);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out.slice(0, MAX_FAVOURITES);
}

function mergeHidden(local: unknown, account: unknown): string[] {
  const all = [...(Array.isArray(account) ? account : []), ...(Array.isArray(local) ? local : [])];
  return [...new Set(all.filter((id): id is string => typeof id === "string"))];
}

/** A moved item keeps the later of its two return dates. */
function mergeSnoozes(local: unknown, account: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const source of [account, local]) {
    if (!isRecord(source)) continue;
    for (const [id, until] of Object.entries(source)) {
      if (typeof until === "string" && (!out[id] || until > out[id])) out[id] = until;
    }
  }
  return out;
}

/** Both notes are kept when they differ, the account's first, as far as the length limit allows. */
function mergeNote(local: unknown, account: unknown): string {
  const a = typeof account === "string" ? account.trim() : "";
  const l = typeof local === "string" ? local.trim() : "";
  if (!a || a === l) return l;
  if (!l) return a;
  const joined = `${a}\n${l}`;
  return joined.length <= WORK_SYNC_QUICK_NOTE_LIMIT ? joined : a;
}

/** What makes a list entry the same entry on two devices: its id, a job application date's stage, or the text itself. */
function entryKey(item: unknown): string | null {
  if (isRecord(item) && typeof item.id === "string") return `id:${item.id}`;
  if (isRecord(item) && typeof item.stage === "string") return `stage:${item.stage}`;
  if (typeof item === "string") return `text:${item}`;
  return null;
}

/**
 * Joins two copies of one whole record (Admin paperwork, the term tracker, exam
 * prep, job applications). A list keeps every entry from both, the account's
 * version where both have it (matched by id, by stage for job application
 * dates, or by the text itself); objects are joined key by key; anything else
 * is the account's.
 */
function mergeRecordValue(local: unknown, account: unknown): unknown {
  if (account === undefined || account === null) return local;
  if (local === undefined || local === null) return account;
  if (Array.isArray(account) && Array.isArray(local)) {
    if (account.length === 0) return local;
    if (local.length === 0) return account;
    if (![...account, ...local].every((item) => entryKey(item) !== null)) return account;
    const keys = new Set(account.map(entryKey));
    return [...account, ...local.filter((item) => !keys.has(entryKey(item)))];
  }
  if (isRecord(account) && isRecord(local)) {
    const out: Record<string, unknown> = { ...local };
    for (const [key, value] of Object.entries(account)) out[key] = mergeRecordValue(local[key], value);
    return out;
  }
  return account;
}

/**
 * A joined record that would not read back (too many entries, two dates for one
 * stage) is not kept: the account's copy wins, as it does after the first match.
 */
function mergeRecord(local: unknown, account: unknown, isValid: (value: never) => boolean): unknown {
  if (!isRecord(account)) return local;
  if (!isRecord(local)) return account;
  const joined = mergeRecordValue(local, account);
  return isValid(joined as never) ? joined : account;
}

export function mergeWorkSyncValues(section: WorkSyncSection, local: unknown, account: unknown): unknown {
  switch (section) {
    case "favouriteWorkPages":
      return mergeFavourites(local, account);
    case "myDayHiddenCards":
      return mergeHidden(local, account);
    case "myDaySnoozes":
      return mergeSnoozes(local, account);
    case "myDayQuickNote":
      return mergeNote(local, account);
    case "adminPaperwork":
      return mergeRecord(local, account, (value: AdminPaperwork) => isValidPaperwork(value));
    case "teachingTermTracker":
      return mergeRecord(local, account, (value: TermTrackerState) => isValidTermTracker(value));
    case "teachingExamPrep":
      return mergeRecord(local, account, (value: ExamPrepState) => isValidExamPrep(value));
    case "cpdApplications":
      return mergeRecord(local, account, (value: ApplicationsState) => isValidApplications(value));
  }
}
