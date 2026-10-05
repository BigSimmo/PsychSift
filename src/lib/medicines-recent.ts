import { MEDICINES_RECENT_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";

/**
 * The Medicines hub's "Recent" list: the last few medicine pages this reader
 * opened on this device, so the 03:00 repeat check is one tap (Medicines
 * mock-up v6, screen 12, agreed 5 Oct 2026).
 *
 * What it holds and why that is safe: the medicine's slug and its catalogue
 * name. Never a time on screen, a query, a dose or anything about a patient.
 * It stays in this browser for this account (cleared at sign-out and account
 * switch, see `account-scoped-browser-state.ts`), is recorded only while "Save
 * recent searches" is on, and is cleared with recent searches.
 */

export interface MedicineVisit {
  readonly slug: string;
  readonly name: string;
  /** Epoch milliseconds of the latest open; used for ordering and expiry only, never shown. */
  readonly at: number;
}

/** The hub shows three; a few more are kept so a cleared row is replaced. */
export const MEDICINES_RECENT_LIMIT = 6;
export const MEDICINES_RECENT_SHOWN = 3;
export const MEDICINES_RECENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const medicinesRecentChangeEvent = "psychsift:medicines-recent-change";

/** A path segment: no separators or whitespace, so a stored value can only ever point at one medicine page. */
const SLUG = /^[^\s/?#\\]{1,160}$/;

/** The medicine page for a stored visit. */
export function medicineVisitHref(visit: Pick<MedicineVisit, "slug">): string {
  return `/medications/${encodeURIComponent(visit.slug)}`;
}

function isVisit(value: unknown): value is MedicineVisit {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.slug === "string" &&
    SLUG.test(record.slug) &&
    typeof record.name === "string" &&
    record.name.trim().length > 0 &&
    record.name.length <= 200 &&
    typeof record.at === "number" &&
    Number.isFinite(record.at)
  );
}

/** Newest first, one entry per medicine, expired entries dropped. Pure. */
export function normaliseMedicineVisits(raw: unknown, now: number): MedicineVisit[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter(isVisit)
    .filter((visit) => now - visit.at <= MEDICINES_RECENT_TTL_MS && visit.at <= now + 60_000)
    .sort((a, b) => b.at - a.at)
    .filter((visit) => {
      if (seen.has(visit.slug)) return false;
      seen.add(visit.slug);
      return true;
    })
    .slice(0, MEDICINES_RECENT_LIMIT);
}

const EMPTY: readonly MedicineVisit[] = [];
let cache: { raw: string | null; value: readonly MedicineVisit[] } | null = null;

/** The stored list, newest first. Blocked or unreadable storage reads as no history. */
export function readMedicineVisits(now = Date.now()): readonly MedicineVisit[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(MEDICINES_RECENT_STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (cache && cache.raw === raw) return cache.value;
  let value: readonly MedicineVisit[] = EMPTY;
  if (raw) {
    try {
      value = normaliseMedicineVisits(JSON.parse(raw), now);
    } catch {
      value = EMPTY;
    }
  }
  cache = { raw, value };
  return value;
}

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(medicinesRecentChangeEvent));
}

subscribeAccountTransition(() => {
  cache = null;
  notify();
});

/** Record one open. The caller decides whether recording is allowed (the "Save recent searches" switch). */
export function recordMedicineVisit(visit: MedicineVisit): void {
  if (typeof window === "undefined" || !isVisit(visit)) return;
  const current = readMedicineVisits(visit.at);
  const next = normaliseMedicineVisits(
    [visit, ...current.filter((existing) => existing.slug !== visit.slug)],
    visit.at,
  );
  try {
    window.localStorage.setItem(MEDICINES_RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or blocked storage: losing a convenience list is not worth interrupting the reader.
    return;
  }
  notify();
}

export function clearMedicineVisits(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MEDICINES_RECENT_STORAGE_KEY);
  } catch {
    // Nothing stored that we can reach; nothing to clear.
  }
  cache = null;
  notify();
}

export function countMedicineVisits(): number {
  return readMedicineVisits().length;
}

export function subscribeMedicineVisits(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === MEDICINES_RECENT_STORAGE_KEY) listener();
  };
  window.addEventListener(medicinesRecentChangeEvent, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(medicinesRecentChangeEvent, listener);
    window.removeEventListener("storage", onStorage);
  };
}
