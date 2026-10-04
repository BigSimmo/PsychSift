import { PSYCHIATRY_VISITS_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { perthCalendarDate } from "@/lib/perth-time";

/**
 * The Psychiatry hub's on-device history: which reference records the reader
 * opened in the psychiatry sections, so the hub
 * can offer "Pick up where you left off", a "Continue" list, the forms they
 * open most and a monthly count.
 *
 * What it holds and why that is safe: a path, the page's own title (a
 * diagnosis, therapy or form name), the section and a time. Never a
 * query, a note or anything about a patient. It stays in this browser for this
 * account (cleared at sign-out and account switch, see
 * `account-scoped-browser-state.ts`), is recorded only while "Save recent
 * searches" is on, and is cleared with recent searches.
 */

export type PsychiatryVisitKind = "dsm" | "differentials" | "specifiers" | "formulation" | "therapy" | "forms";

export interface PsychiatryVisit {
  readonly href: string;
  readonly title: string;
  readonly kind: PsychiatryVisitKind;
  /** Epoch milliseconds of the latest open. */
  readonly at: number;
}

export const PSYCHIATRY_VISIT_LIMIT = 60;
export const PSYCHIATRY_VISIT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const psychiatryVisitsChangeEvent = "psychsift:psychiatry-visits-change";

export const PSYCHIATRY_VISIT_KIND_LABEL: Readonly<Record<PsychiatryVisitKind, string>> = {
  dsm: "DSM-5 Diagnosis",
  differentials: "Differentials",
  specifiers: "Specifiers",
  formulation: "Formulation",
  therapy: "Therapy",
  forms: "Forms",
};

/**
 * Listing and search pages are not "a thing you opened", and the interactive
 * tools (builders, compare, maps, the recommender) keep their working state in
 * the address's query, which a bare path cannot bring back. Only records are
 * recorded, so "Pick up where you left off" always reopens what was left.
 */
const NON_RECORD_SEGMENTS = new Set([
  "search",
  "presentations",
  "diagnoses",
  "compare",
  "builder",
  "map",
  "pathways",
  "recommend",
  "review",
]);

const PATH_RULES: ReadonlyArray<{ readonly prefix: string; readonly kind: PsychiatryVisitKind }> = [
  { prefix: "/dsm/", kind: "dsm" },
  { prefix: "/differentials/", kind: "differentials" },
  { prefix: "/specifiers/", kind: "specifiers" },
  { prefix: "/formulation/", kind: "formulation" },
  { prefix: "/therapy-compass/", kind: "therapy" },
  { prefix: "/forms/", kind: "forms" },
];

/**
 * The section a path belongs to, or null when it is not a record page: section
 * homes, search pages, catalogue lists and the interactive tools return null. Documents are
 * left out: the viewer's page title does not name the document, so there is
 * nothing honest to list.
 */
export function psychiatryVisitKindForPath(pathname: string): PsychiatryVisitKind | null {
  const path = pathname.split(/[?#]/)[0] ?? "";
  const rule = PATH_RULES.find((candidate) => path.startsWith(candidate.prefix));
  if (!rule) return null;
  const rest = path.slice(rule.prefix.length).split("/").filter(Boolean);
  if (rest.length === 0) return null;
  // `/differentials/presentations` and `/differentials/diagnoses` are lists; their `[slug]` pages are records.
  if (rest.length === 1 && NON_RECORD_SEGMENTS.has(rest[0] ?? "")) return null;
  return rule.kind;
}

const GENERIC_TITLES = new Set(["psychsift", "document", "documents", "forms", "therapy", "formulation"]);

/**
 * The record's name from a page title such as "Major depressive disorder |
 * DSM-5 Diagnosis | PsychSift", "Lithium - Therapy" or "CBT — Formulation".
 * Only a spaced separator splits, so "Obsessive-compulsive" survives. Returns
 * null for a missing, generic or "not found" title.
 */
export function psychiatryVisitTitle(documentTitle: string): string | null {
  const first = documentTitle.split(/\s+[|—–-]\s+/)[0]?.trim() ?? "";
  if (!first || first.length > 160) return null;
  if (GENERIC_TITLES.has(first.toLowerCase())) return null;
  if (/not found/i.test(first)) return null;
  return first;
}

function isVisit(value: unknown): value is PsychiatryVisit {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.href === "string" &&
    record.href.startsWith("/") &&
    typeof record.title === "string" &&
    typeof record.kind === "string" &&
    record.kind in PSYCHIATRY_VISIT_KIND_LABEL &&
    typeof record.at === "number" &&
    Number.isFinite(record.at)
  );
}

/** Newest first, de-duplicated by path, expired entries dropped. Pure. */
export function normalisePsychiatryVisits(raw: unknown, now: number): PsychiatryVisit[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter(isVisit)
    .filter((visit) => now - visit.at <= PSYCHIATRY_VISIT_TTL_MS)
    .sort((a, b) => b.at - a.at)
    .filter((visit) => {
      if (seen.has(visit.href)) return false;
      seen.add(visit.href);
      return true;
    })
    .slice(0, PSYCHIATRY_VISIT_LIMIT);
}

/** Add one open to the list (newest first, one entry per path). Pure. */
export function withPsychiatryVisit(visits: readonly PsychiatryVisit[], visit: PsychiatryVisit): PsychiatryVisit[] {
  return normalisePsychiatryVisits([visit, ...visits.filter((existing) => existing.href !== visit.href)], visit.at);
}

export interface PsychiatryOpen {
  readonly at: number;
  readonly kind: PsychiatryVisitKind;
  /** The path opened, so per-record counts expire with the 90-day history. */
  readonly href?: string;
}

/** The newest opens kept for the weekly chart and per-record counts. */
export const PSYCHIATRY_OPEN_LIMIT = 500;

function isOpen(value: unknown, now: number): value is PsychiatryOpen {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.at === "number" &&
    Number.isFinite(record.at) &&
    now - record.at <= PSYCHIATRY_VISIT_TTL_MS &&
    typeof record.kind === "string" &&
    record.kind in PSYCHIATRY_VISIT_KIND_LABEL &&
    (record.href === undefined || (typeof record.href === "string" && record.href.startsWith("/")))
  );
}

interface StoredVisits {
  readonly visits: PsychiatryVisit[];
  /**
   * The newest opens (time, section, path) inside the 90 days, for the weekly
   * chart and the forms card's "most opened". Capped, so not used for totals.
   */
  readonly opens: PsychiatryOpen[];
  /**
   * Exact opens per Perth calendar month ("2026-10"), this month and last
   * only, so the ring's totals stay true however many records are opened.
   */
  readonly months: Record<string, number>;
}

const EMPTY: StoredVisits = { visits: [], opens: [], months: {} };

/** Only this Perth month and the one before it are kept. */
function currentMonths(months: Readonly<Record<string, number>>, now: number): Record<string, number> {
  const month = perthMonth(now);
  const keep = new Set([month, previousMonth(month)]);
  const kept: Record<string, number> = {};
  for (const [key, count] of Object.entries(months)) {
    if (keep.has(key) && Number.isInteger(count) && count > 0) kept[key] = count;
  }
  return kept;
}

function parseStored(raw: string | null, now: number): StoredVisits {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredVisits> | null;
    const visits = normalisePsychiatryVisits(parsed?.visits, now);
    const opens = Array.isArray(parsed?.opens) ? parsed.opens.filter((open) => isOpen(open, now)) : [];
    const months =
      parsed?.months && typeof parsed.months === "object" && !Array.isArray(parsed.months)
        ? currentMonths(parsed.months, now)
        : {};
    return { visits, opens, months };
  } catch {
    return EMPTY;
  }
}

let cache: { raw: string | null; value: StoredVisits } | null = null;

function readStored(now = Date.now()): StoredVisits {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PSYCHIATRY_VISITS_STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (cache && cache.raw === raw) return cache.value;
  const value = parseStored(raw, now);
  cache = { raw, value };
  return value;
}

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(psychiatryVisitsChangeEvent));
}

subscribeAccountTransition(() => {
  cache = null;
  notify();
});

/** Record one open. The caller decides whether recording is allowed (the "Save recent searches" switch). */
export function recordPsychiatryVisit(visit: PsychiatryVisit): void {
  if (typeof window === "undefined") return;
  const current = readStored(visit.at);
  const previous = current.visits.find((existing) => existing.href === visit.href);
  // A title that arrives late (the page set it after the first read) updates the entry, not the counts.
  const sameOpen = previous !== undefined && visit.at - previous.at < 5_000;
  const month = perthMonth(visit.at);
  const next: StoredVisits = {
    visits: withPsychiatryVisit(current.visits, sameOpen ? { ...visit, at: previous.at } : visit),
    opens: sameOpen
      ? current.opens
      : [...current.opens, { at: visit.at, kind: visit.kind, href: visit.href }].slice(-PSYCHIATRY_OPEN_LIMIT),
    months: sameOpen
      ? current.months
      : currentMonths({ ...current.months, [month]: (current.months[month] ?? 0) + 1 }, visit.at),
  };
  try {
    window.localStorage.setItem(PSYCHIATRY_VISITS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  notify();
}

export function clearPsychiatryVisits(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PSYCHIATRY_VISITS_STORAGE_KEY);
  } catch {
    // Nothing stored that we can reach; nothing to clear.
  }
  cache = null;
  notify();
}

export function countPsychiatryVisits(): number {
  return readStored().visits.length;
}

export type PsychiatryVisitState = StoredVisits;

export function loadPsychiatryVisitState(now = Date.now()): PsychiatryVisitState {
  return readStored(now);
}

export function subscribePsychiatryVisits(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PSYCHIATRY_VISITS_STORAGE_KEY) listener();
  };
  window.addEventListener(psychiatryVisitsChangeEvent, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(psychiatryVisitsChangeEvent, listener);
    window.removeEventListener("storage", onStorage);
  };
}

function perthMonth(at: number): string {
  return perthCalendarDate(at).slice(0, 7);
}

function previousMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return monthNumber === 1 ? `${year - 1}-12` : `${year}-${String(monthNumber - 1).padStart(2, "0")}`;
}

/** Records opened this Perth calendar month, and last month, for the hub's ring. Pure. */
export function psychiatryMonthFigures(
  months: Readonly<Record<string, number>>,
  now: number,
): { thisMonth: number; lastMonth: number } {
  const month = perthMonth(now);
  return { thisMonth: months[month] ?? 0, lastMonth: months[previousMonth(month)] ?? 0 };
}

/** The Act and Standards page is a reference, not a form; the card links it separately. */
const NOT_A_FORM = new Set(["/forms/act"]);

/**
 * The forms opened most in the 90 days, most first, ties to the most recent.
 * Counted from the timestamped opens, so old opens expire with the history. Pure.
 */
export function mostOpenedForms(
  visits: readonly PsychiatryVisit[],
  opens: readonly PsychiatryOpen[],
  limit = 4,
): PsychiatryVisit[] {
  const counts = new Map<string, number>();
  for (const open of opens) {
    if (open.href) counts.set(open.href, (counts.get(open.href) ?? 0) + 1);
  }
  return visits
    .filter((visit) => visit.kind === "forms" && !NOT_A_FORM.has(visit.href))
    .map((visit, recency) => ({ visit, recency, count: counts.get(visit.href) ?? 1 }))
    .sort((a, b) => b.count - a.count || a.recency - b.recency)
    .slice(0, limit)
    .map(({ visit }) => visit);
}

/** Opens per section in the last seven days, busiest first; sections with none are left out. Pure. */
export function psychiatryWeekBySection(
  opens: readonly PsychiatryOpen[],
  now: number,
): Array<{ readonly kind: PsychiatryVisitKind; readonly count: number }> {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const totals = new Map<PsychiatryVisitKind, number>();
  for (const open of opens) {
    if (open.at < weekAgo || open.at > now) continue;
    totals.set(open.kind, (totals.get(open.kind) ?? 0) + 1);
  }
  return [...totals.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
}

export const EMPTY_PSYCHIATRY_VISIT_STATE: PsychiatryVisitState = EMPTY;

const PERTH_TIME = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Australia/Perth",
});
const PERTH_DAY = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Perth" });

/** "Today 14:30", "Yesterday" or "3 Oct", in Perth time. Pure. */
export function formatPsychiatryVisitWhen(at: number, now: number): string {
  const day = perthCalendarDate(at);
  const today = perthCalendarDate(now);
  if (day === today) return `Today ${PERTH_TIME.format(at)}`;
  if (day === perthCalendarDate(now - 24 * 60 * 60 * 1000)) return "Yesterday";
  return PERTH_DAY.format(at);
}
