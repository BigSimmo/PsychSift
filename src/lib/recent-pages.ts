import { RECENT_PAGES_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";

/**
 * "Recent pages": the last few pages this reader opened, across Work and
 * Clinical, so a doctor moving between On Call, a medicine and a form can get
 * back to what they just looked at without searching again (site
 * recommendations 12 Oct 2026, item 4). The side menu and AI Search show the
 * newest five; each Clinical mode home shows its own newest three as
 * "Continue" (item 3).
 *
 * What it holds and why that is safe: a path WITHOUT its query, the page's own
 * title (a diagnosis, a medicine, "Swaps"), the mode and section it belongs
 * to, and a time. Never a query, a note or anything typed. Only record pages
 * and work area pages are recorded (see `recentPageTarget`); searches, drafts,
 * call notes and the call log, handover, the MHA clock, safety plans, First
 * Nations pages, mock-ups and developer pages never are. It stays in this
 * browser for this account (cleared at sign-out and account switch, see
 * `account-scoped-browser-state.ts`), is recorded only while "Save recent
 * searches" is on, and is cleared with recent searches.
 */

export type RecentPageMode = "work" | "clinical";

/** The section a page belongs to: a Clinical mode id or a Work area's mode id. */
export type RecentPageSection =
  | "dsm"
  | "differentials"
  | "therapy-compass"
  | "prescribing"
  | "documents"
  | "specifiers"
  | "formulation"
  | "forms"
  | "services"
  | "factsheets"
  | "dictionary"
  | "sources"
  | "psychiatry"
  | "medicines"
  | "my-day"
  | "on-call"
  | "open-shifts"
  | "roster"
  | "teaching"
  | "cme"
  | "my-work";

export interface RecentPage {
  /** The path only: never a query string or a hash. */
  readonly path: string;
  readonly title: string;
  readonly mode: RecentPageMode;
  readonly section: RecentPageSection;
  /** Epoch milliseconds of the latest open; orders the list, never shown. */
  readonly at: number;
}

export const RECENT_PAGES_LIMIT = 12;
/** How many the side menu and AI Search show. */
export const RECENT_PAGES_SHOWN = 5;
/** How many a Clinical mode home's Continue shows. */
export const RECENT_PAGES_CONTINUE_SHOWN = 3;
export const RECENT_PAGES_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const recentPagesChangeEvent = "psychsift:recent-pages-change";

export const RECENT_PAGE_SECTION_LABEL: Readonly<Record<RecentPageSection, string>> = {
  dsm: "DSM-5",
  differentials: "Differentials",
  "therapy-compass": "Therapy",
  prescribing: "Medication",
  documents: "Documents",
  specifiers: "Specifiers",
  formulation: "Formulation",
  forms: "Forms",
  services: "Services",
  factsheets: "Factsheets",
  dictionary: "Dictionary",
  sources: "Sources",
  psychiatry: "Psychiatry",
  medicines: "Medicines",
  "my-day": "My Day",
  "on-call": "On Call",
  "open-shifts": "Open shifts",
  roster: "Roster",
  teaching: "Teaching",
  cme: "CPD",
  "my-work": "Admin",
};

const WORK_SECTIONS: ReadonlySet<RecentPageSection> = new Set([
  "my-day",
  "on-call",
  "open-shifts",
  "roster",
  "teaching",
  "cme",
  "my-work",
]);

export function recentPageModeOf(section: RecentPageSection): RecentPageMode {
  return WORK_SECTIONS.has(section) ? "work" : "clinical";
}

/**
 * Clinical record routes: a first segment, the segments that are lists,
 * searches or interactive tools under it (never recorded, because a bare path
 * cannot bring their working state back), and how deep a record sits.
 */
const CLINICAL_RECORD_RULES: ReadonlyArray<{
  readonly root: string;
  readonly section: RecentPageSection;
  /** The second segment a record must have, when the record sits one level further in. */
  readonly via?: readonly string[];
  readonly notRecords?: readonly string[];
}> = [
  { root: "dsm", section: "dsm", via: ["diagnoses"] },
  { root: "differentials", section: "differentials", via: ["diagnoses", "presentations"] },
  {
    root: "therapy-compass",
    section: "therapy-compass",
    notRecords: ["search", "compare", "pathways", "recommend", "review"],
  },
  { root: "medications", section: "prescribing" },
  { root: "documents", section: "documents", notRecords: ["search", "source"] },
  { root: "specifiers", section: "specifiers", notRecords: ["search", "builder", "compare", "map"] },
  { root: "formulation", section: "formulation", notRecords: ["search", "builder", "compare", "map"] },
  // The MHA clock lives under /forms/ but holds detention timers: never recorded.
  { root: "forms", section: "forms", notRecords: ["search", "clock"] },
  { root: "services", section: "services", notRecords: ["search"] },
  { root: "factsheets", section: "factsheets", notRecords: ["search", "topics"] },
  { root: "dictionary", section: "dictionary", notRecords: ["search", "browse", "compare", "sources"] },
  { root: "sources", section: "sources", notRecords: ["search", "currency", "method", "publishers", "topics"] },
];

/** Clinical hubs recorded as area pages (their own home, never a sub-page). */
const CLINICAL_AREA_ROOTS: Readonly<Record<string, RecentPageSection>> = {
  psychiatry: "psychiatry",
  medicines: "medicines",
};

/** Work areas: the area's home and its tab pages are recorded, never anything deeper. */
const WORK_AREA_ROOTS: Readonly<Record<string, RecentPageSection>> = {
  "my-day": "my-day",
  "on-call": "on-call",
  "open-shifts": "open-shifts",
  roster: "roster",
  teaching: "teaching",
  cme: "cme",
  admin: "my-work",
};

/**
 * Work tab pages that are never recorded: call notes and the call log,
 * handover, referrals, searches, and pages built around free-text drafts or a
 * person's own statements (a new CPD entry, job applications, feedback, sick
 * reports, posting a shift, requests).
 */
const WORK_PRIVATE_TABS: Readonly<Record<string, ReadonlySet<string>>> = {
  "on-call": new Set(["call", "handover", "refer", "referrals", "find"]),
  cme: new Set(["new", "applications", "log"]),
  teaching: new Set(["c", "feedback", "import", "review", "assessments"]),
  roster: new Set(["sick", "join", "requests"]),
  admin: new Set(["applications", "requests", "new-job", "hospital"]),
  "open-shifts": new Set(["post", "log"]),
  "my-day": new Set(["setup"]),
};

/**
 * Where a path belongs, or null when it must not be recorded. Pure. A query
 * or hash is dropped before anything is read, so a search's words never reach
 * the list.
 */
export function recentPageTarget(
  pathname: string,
): { readonly path: string; readonly mode: RecentPageMode; readonly section: RecentPageSection } | null {
  const path = (pathname.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  if (!path.startsWith("/") || path.length > 200) return null;
  const segments = path.split("/").filter(Boolean);
  const [root, second, third] = segments;
  if (!root) return null;
  // A segment that is not a plain slug (encoded text, spaces) could carry typed words: never recorded.
  if (segments.some((segment) => !/^[A-Za-z0-9._~-]{1,120}$/.test(segment))) return null;

  const workSection = WORK_AREA_ROOTS[root];
  if (workSection) {
    if (segments.length > 2) return null;
    if (second && WORK_PRIVATE_TABS[root]?.has(second)) return null;
    return { path, mode: "work", section: workSection };
  }

  const areaSection = CLINICAL_AREA_ROOTS[root];
  if (areaSection) {
    return segments.length === 1 ? { path, mode: "clinical", section: areaSection } : null;
  }

  const rule = CLINICAL_RECORD_RULES.find((candidate) => candidate.root === root);
  if (!rule || !second) return null;
  // A record sits at one exact depth: anything below it (a therapy's brief or
  // patient sheet, whose choices live in the query) cannot be brought back by a bare path.
  if (rule.via) {
    if (!rule.via.includes(second) || !third || segments.length !== 3) return null;
  } else if (rule.notRecords?.includes(second) || segments.length !== 2) {
    return null;
  }
  return { path, mode: "clinical", section: rule.section };
}

const GENERIC_TITLES = new Set([
  "psychsift",
  "document",
  "documents",
  "document viewer",
  "loading",
  "untitled",
  "medication",
]);

/**
 * The page's own name from its document title ("Lithium | PsychSift",
 * "Swaps | Roster | PsychSift", "CBT - Therapy"). Only a spaced separator
 * splits, so "Obsessive-compulsive" survives. Null for a missing, generic or
 * "not found" title. Pure.
 */
export function recentPageTitle(documentTitle: string): string | null {
  const first = documentTitle.split(/\s+[|—–-]\s+/)[0]?.trim() ?? "";
  if (!first || first.length > 120) return null;
  if (GENERIC_TITLES.has(first.toLowerCase())) return null;
  if (/not found|^error\b|^search\b/i.test(first)) return null;
  return first;
}

function isRecentPage(value: unknown): value is RecentPage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.path !== "string" || typeof record.title !== "string") return false;
  if (typeof record.at !== "number" || !Number.isFinite(record.at)) return false;
  const target = recentPageTarget(record.path);
  // The stored path must still be one this list may hold, exactly as stored, in the stored section.
  return (
    target !== null &&
    target.path === record.path &&
    target.section === record.section &&
    target.mode === record.mode &&
    record.title.trim().length > 0 &&
    record.title.length <= 120
  );
}

/** Newest first, one entry per path, expired or malformed entries dropped, capped. Pure. */
export function normaliseRecentPages(raw: unknown, now: number): RecentPage[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter(isRecentPage)
    .filter((page) => now - page.at <= RECENT_PAGES_TTL_MS && page.at <= now + 60_000)
    .sort((a, b) => b.at - a.at)
    .filter((page) => {
      if (seen.has(page.path)) return false;
      seen.add(page.path);
      return true;
    })
    .slice(0, RECENT_PAGES_LIMIT)
    .map(({ path, title, mode, section, at }) => ({ path, title, mode, section, at }));
}

const EMPTY: readonly RecentPage[] = [];
let cache: { raw: string | null; value: readonly RecentPage[]; expiresAt: number } | null = null;

/** The stored list, newest first. Blocked or unreadable storage reads as no history. */
export function readRecentPages(now = Date.now()): readonly RecentPage[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(RECENT_PAGES_STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (cache && cache.raw === raw && now < cache.expiresAt) return cache.value;
  let value: readonly RecentPage[] = EMPTY;
  let storedCount = 0;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      storedCount = Array.isArray(parsed) ? parsed.length : 1;
      value = normaliseRecentPages(parsed, now);
    } catch {
      value = EMPTY;
      storedCount = 1;
    }
  }
  // Expired or unreadable entries are removed from the device, not only hidden.
  if (raw && value.length < storedCount) {
    try {
      if (value.length === 0) window.localStorage.removeItem(RECENT_PAGES_STORAGE_KEY);
      else window.localStorage.setItem(RECENT_PAGES_STORAGE_KEY, JSON.stringify(value));
      raw = value.length === 0 ? null : JSON.stringify(value);
    } catch {
      // Blocked storage: the list read is still filtered.
    }
  }
  // The cached list holds only until its oldest entry expires.
  const oldest = value.reduce((min, page) => Math.min(min, page.at), Infinity);
  cache = { raw, value, expiresAt: oldest === Infinity ? Infinity : oldest + RECENT_PAGES_TTL_MS + 1 };
  return value;
}

/** For `useSyncExternalStore`: the server and the first client frame both read no history. */
export function readNoRecentPages(): readonly RecentPage[] {
  return EMPTY;
}

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(recentPagesChangeEvent));
}

subscribeAccountTransition(() => {
  cache = null;
  announcedTitles.clear();
  generation += 1;
  notify();
});

/**
 * Titles a page hands over itself, by path, for pages whose document title
 * does not name the record (a document's viewer is titled "PsychSift"). Held in
 * memory only, until the recorder reads them; never stored apart from the list.
 */
const announcedTitles = new Map<string, string>();
const ANNOUNCED_TITLES_KEPT = 20;

/**
 * Bumped whenever the list is cleared or the account changes, so a page still
 * settling its title from before then can never write itself back.
 */
let generation = 0;
export function recentPagesGeneration(): number {
  return generation;
}

/** A title that could name a patient is never kept (a document title is free text someone typed). */
function safeRecentTitle(title: string): string | null {
  const name = title.trim();
  if (!name || name.length > 120 || looksLikePatientDetail(name)) return null;
  return name;
}
export const recentPageTitleAnnouncedEvent = "psychsift:recent-page-title";

/** A page names itself for Recent pages. Ignored for any path the list may not hold. */
export function announceRecentPageTitle(pathname: string, title: string): void {
  const target = recentPageTarget(pathname);
  const name = safeRecentTitle(title);
  if (!target || !name) return;
  announcedTitles.delete(target.path);
  announcedTitles.set(target.path, name);
  while (announcedTitles.size > ANNOUNCED_TITLES_KEPT) {
    const oldestKey = announcedTitles.keys().next().value;
    if (oldestKey === undefined) break;
    announcedTitles.delete(oldestKey);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(recentPageTitleAnnouncedEvent));
}

/** The title a page handed over for this path, if any. */
export function announcedRecentPageTitle(pathname: string): string | null {
  const target = recentPageTarget(pathname);
  return target ? (announcedTitles.get(target.path) ?? null) : null;
}

/**
 * Record one open of `pathname` titled `title`. Anything `recentPageTarget`
 * refuses is dropped here, whatever the caller checked. The caller decides
 * whether recording is allowed (the "Save recent searches" switch).
 */
export function recordRecentPage(pathname: string, title: string, at: number = Date.now()): void {
  if (typeof window === "undefined") return;
  const target = recentPageTarget(pathname);
  const name = safeRecentTitle(title);
  if (!target || !name) return;
  const page: RecentPage = { ...target, title: name, at };
  const current = readRecentPages(at);
  const next = normaliseRecentPages([page, ...current.filter((existing) => existing.path !== page.path)], at);
  try {
    window.localStorage.setItem(RECENT_PAGES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or blocked storage: losing a convenience list is not worth interrupting the reader.
    return;
  }
  notify();
}

export function forgetRecentPage(path: string): void {
  if (typeof window === "undefined") return;
  const current = readRecentPages();
  const next = current.filter((page) => page.path !== path);
  if (next.length === current.length) return;
  try {
    window.localStorage.setItem(RECENT_PAGES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  notify();
}

export function clearRecentPages(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_PAGES_STORAGE_KEY);
  } catch {
    // Nothing stored that we can reach; nothing to clear.
  }
  cache = null;
  announcedTitles.clear();
  generation += 1;
  notify();
}

export function countRecentPages(): number {
  return readRecentPages().length;
}

export function subscribeRecentPages(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === RECENT_PAGES_STORAGE_KEY) listener();
  };
  window.addEventListener(recentPagesChangeEvent, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(recentPagesChangeEvent, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The newest pages, optionally one section's only, excluding the page being looked at. Pure. */
export function pickRecentPages(
  pages: readonly RecentPage[],
  { limit, section, exceptPath }: { limit: number; section?: RecentPageSection; exceptPath?: string | null },
): RecentPage[] {
  const except = exceptPath ? (exceptPath.split(/[?#]/)[0] ?? "").replace(/\/+$/, "") : null;
  return pages
    .filter((page) => (section ? page.section === section : true))
    .filter((page) => page.path !== except)
    .slice(0, limit);
}
