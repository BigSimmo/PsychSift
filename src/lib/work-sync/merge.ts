import { WORK_SYNC_QUICK_NOTE_LIMIT, type WorkSyncSection } from "@/lib/work-sync/sections";

/**
 * Joins what this device kept from before its first sync with what the
 * account already holds, so turning sync on loses nothing from either side.
 * Used once per device and account; after that the account copy wins.
 *
 * Values are as each store keeps them on the device, already parsed: an array
 * for saved pages and hidden cards, an id-to-date map for moved items, text for
 * the quick note. Anything unreadable counts as empty.
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
  }
}

/** True when a value holds nothing, which the device stores keep as no key at all. */
export function isEmptyWorkSyncValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}
