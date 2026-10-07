"use client";

import { useSyncExternalStore } from "react";

import { FAVOURITES_LOCAL_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { looksLikePatientDetails } from "@/lib/work-search/signals";

/**
 * The parts of Favourites a person shapes for themselves, kept on this device
 * (owner request 7 Oct 2026): saved phone numbers, their own names and notes
 * for favourites, and how the Favourites page is laid out.
 *
 * Device only, because the account table has no columns for them and this
 * round allows no migration. One account-scoped key, cleared at sign-out with
 * the rest (`account-scoped-browser-state.ts`). Every text a person types is
 * checked for patient details before it is kept: these are work numbers and
 * work notes, never a patient's.
 */

/* ------------------------------------------------------------------ types */

export type SavedNumber = {
  readonly id: string;
  readonly label: string;
  /** As typed, spaces and brackets included. Calls use `dialableDigits`. */
  readonly number: string;
  readonly note: string;
  readonly createdAt: number;
  readonly pinnedAt: number | null;
  readonly openedAt: number | null;
};

export type FavouriteOverride = {
  /** The name shown in place of the item's own title. */
  readonly name?: string;
  readonly note?: string;
};

export const FAVOURITES_SECTION_IDS = ["continue", "shelf", "numbers", "clinical", "work"] as const;
export type FavouritesSectionId = (typeof FAVOURITES_SECTION_IDS)[number];
export type FavouritesScope = "all" | "clinical" | "work";
export type FavouritesListView = "recent" | "az" | "type";

export type FavouritesLayout = {
  /** Every section, in the order drawn. */
  readonly order: readonly FavouritesSectionId[];
  readonly hidden: readonly FavouritesSectionId[];
  /** Which tab the page opens on. */
  readonly scope: FavouritesScope;
  readonly view: FavouritesListView;
  readonly shelfSize: 4 | 8;
};

type LocalState = {
  readonly numbers: readonly SavedNumber[];
  readonly overrides: Readonly<Record<string, FavouriteOverride>>;
  readonly layout: FavouritesLayout;
};

export const DEFAULT_FAVOURITES_LAYOUT: FavouritesLayout = Object.freeze({
  order: FAVOURITES_SECTION_IDS,
  hidden: [],
  scope: "all",
  view: "recent",
  shelfSize: 8,
});

export const MAX_SAVED_NUMBERS = 40;
export const NUMBER_LABEL_MAX = 60;
export const NUMBER_NOTE_MAX = 120;
export const OVERRIDE_NAME_MAX = 60;
export const OVERRIDE_NOTE_MAX = 160;

const EMPTY_STATE: LocalState = Object.freeze({
  numbers: Object.freeze([]) as readonly SavedNumber[],
  overrides: Object.freeze({}),
  layout: DEFAULT_FAVOURITES_LAYOUT,
});

/* -------------------------------------------------------------- checking */

/** The digits a phone dials: a leading + kept, everything else but digits dropped. */
export function dialableDigits(number: string): string {
  const trimmed = number.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** A `tel:` link for a saved number, or null when it has too few digits to dial. */
export function telHref(number: string): string | null {
  const digits = dialableDigits(number);
  return digits.replace("+", "").length >= 3 ? `tel:${digits}` : null;
}

/**
 * Why a typed text cannot be kept, or null when it can. The patient-detail
 * check is the same one work search uses (labelled numbers, bed numbers, dates
 * of birth, a title and a name).
 */
export function favouriteTextProblem(text: string, maxLength: number): string | null {
  if (text.length > maxLength) return `Keep it to ${maxLength} characters.`;
  if (looksLikePatientDetails(text)) {
    return "This looks like a patient's details. Save work names only, such as a ward or service.";
  }
  return null;
}

export type NumberDraft = { readonly label: string; readonly number: string; readonly note?: string };
export type NumberDraftProblems = { label?: string; number?: string; note?: string };

/** Checks a number before it is saved. An empty result means it can be saved. */
export function checkNumberDraft(draft: NumberDraft): NumberDraftProblems {
  const problems: NumberDraftProblems = {};
  const label = draft.label.trim();
  const number = draft.number.trim();
  const note = (draft.note ?? "").trim();
  if (!label) problems.label = "Give it a name, such as Ward 4B or Pharmacy.";
  else {
    const problem = favouriteTextProblem(label, NUMBER_LABEL_MAX);
    if (problem) problems.label = problem;
  }
  if (!number) problems.number = "Add the number.";
  else if (!/^[+\d][\d\s()+.-]*$/.test(number) || dialableDigits(number).replace("+", "").length < 3) {
    problems.number = "Use digits, with spaces or brackets if you like.";
  } else if (number.length > 24) problems.number = "That is longer than a phone number.";
  if (note) {
    const problem = favouriteTextProblem(note, NUMBER_NOTE_MAX);
    if (problem) problems.note = problem;
  }
  return problems;
}

/** A gentle reminder, not a block: mobiles usually belong to a person. */
export function isMobileNumber(number: string): boolean {
  const digits = dialableDigits(number);
  return /^(?:04|\+614)\d{8}$/.test(digits);
}

/* --------------------------------------------------------------- storage */

let cache: LocalState | null = null;
const listeners = new Set<() => void>();

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}
function time(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function parseLayout(value: unknown): FavouritesLayout {
  if (!value || typeof value !== "object") return DEFAULT_FAVOURITES_LAYOUT;
  const raw = value as Record<string, unknown>;
  const known = new Set<string>(FAVOURITES_SECTION_IDS);
  const order = Array.isArray(raw.order)
    ? (raw.order.filter(
        (id, index, all) => known.has(id as string) && all.indexOf(id) === index,
      ) as FavouritesSectionId[])
    : [];
  // A section added in a later version joins at its default place, at the end.
  for (const id of FAVOURITES_SECTION_IDS) if (!order.includes(id)) order.push(id);
  const hidden = Array.isArray(raw.hidden)
    ? (raw.hidden.filter(
        (id, index, all) => known.has(id as string) && all.indexOf(id) === index,
      ) as FavouritesSectionId[])
    : [];
  return {
    order,
    hidden,
    scope: raw.scope === "clinical" || raw.scope === "work" ? raw.scope : "all",
    view: raw.view === "az" || raw.view === "type" ? raw.view : "recent",
    shelfSize: raw.shelfSize === 4 ? 4 : 8,
  };
}

function parse(raw: string | null): LocalState {
  if (!raw) return EMPTY_STATE;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_STATE;
    const data = value as Record<string, unknown>;
    const seen = new Set<string>();
    const numbers: SavedNumber[] = [];
    for (const entry of Array.isArray(data.numbers) ? data.numbers : []) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const id = str(item.id, 40);
      const label = str(item.label, NUMBER_LABEL_MAX).trim();
      const number = str(item.number, 24).trim();
      const createdAt = time(item.createdAt);
      if (!id || !label || !number || createdAt === null || seen.has(id)) continue;
      // Re-check on read: a value written by an older version, or by hand, is not trusted.
      if (Object.keys(checkNumberDraft({ label, number, note: str(item.note, NUMBER_NOTE_MAX) })).length) continue;
      seen.add(id);
      numbers.push({
        id,
        label,
        number,
        note: str(item.note, NUMBER_NOTE_MAX).trim(),
        createdAt,
        pinnedAt: time(item.pinnedAt),
        openedAt: time(item.openedAt),
      });
      if (numbers.length >= MAX_SAVED_NUMBERS) break;
    }
    const overrides: Record<string, FavouriteOverride> = {};
    if (data.overrides && typeof data.overrides === "object" && !Array.isArray(data.overrides)) {
      for (const [key, entry] of Object.entries(data.overrides as Record<string, unknown>).slice(0, 500)) {
        if (!entry || typeof entry !== "object" || key.length > 200) continue;
        const name = str((entry as Record<string, unknown>).name, OVERRIDE_NAME_MAX).trim();
        const note = str((entry as Record<string, unknown>).note, OVERRIDE_NOTE_MAX).trim();
        const clean: { name?: string; note?: string } = {};
        if (name && !looksLikePatientDetails(name)) clean.name = name;
        if (note && !looksLikePatientDetails(note)) clean.note = note;
        if (clean.name || clean.note) overrides[key] = clean;
      }
    }
    return { numbers, overrides, layout: parseLayout(data.layout) };
  } catch {
    return EMPTY_STATE;
  }
}

function read(): LocalState {
  if (typeof window === "undefined") return EMPTY_STATE;
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(FAVOURITES_LOCAL_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing kept, which is honest.
  }
  cache = parse(raw);
  return cache;
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One faulty subscriber must not stop the others.
    }
  }
}

/** Returns false when the browser refused the write. */
function write(next: LocalState): boolean {
  cache = next;
  let saved = true;
  try {
    window.localStorage.setItem(FAVOURITES_LOCAL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    saved = false;
  }
  notify();
  return saved;
}

let storageListenerAttached = false;
function attachStorageListener() {
  if (storageListenerAttached || typeof window === "undefined") return;
  storageListenerAttached = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === FAVOURITES_LOCAL_STORAGE_KEY) {
      cache = null;
      notify();
    }
  });
}

subscribeAccountTransition(() => {
  cache = null;
  notify();
});

export function subscribeFavouritesLocal(listener: () => void): () => void {
  attachStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getServerSnapshot = () => EMPTY_STATE;

function useLocalState(): LocalState {
  return useSyncExternalStore(subscribeFavouritesLocal, read, getServerSnapshot);
}

export function useSavedNumbers(): readonly SavedNumber[] {
  return useLocalState().numbers;
}
export function useFavouriteOverrides(): Readonly<Record<string, FavouriteOverride>> {
  return useLocalState().overrides;
}
export function useFavouritesLayout(): FavouritesLayout {
  return useLocalState().layout;
}
export function loadFavouritesLocal(): LocalState {
  return read();
}

/* --------------------------------------------------------------- numbers */

function newId(now: number): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `n${now.toString(36)}${random}`;
}

export type SaveResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: "invalid" | "full" | "storage"; readonly problems?: NumberDraftProblems };

export function addSavedNumber(draft: NumberDraft & { pinned?: boolean }, now: number = Date.now()): SaveResult {
  const problems = checkNumberDraft(draft);
  if (Object.keys(problems).length) return { ok: false, reason: "invalid", problems };
  const state = read();
  if (state.numbers.length >= MAX_SAVED_NUMBERS) return { ok: false, reason: "full" };
  const id = newId(now);
  const entry: SavedNumber = {
    id,
    label: draft.label.trim(),
    number: draft.number.trim(),
    note: (draft.note ?? "").trim(),
    createdAt: now,
    pinnedAt: draft.pinned ? now : null,
    openedAt: null,
  };
  return write({ ...state, numbers: [entry, ...state.numbers] }) ? { ok: true, id } : { ok: false, reason: "storage" };
}

export function updateSavedNumber(id: string, draft: NumberDraft): SaveResult {
  const problems = checkNumberDraft(draft);
  if (Object.keys(problems).length) return { ok: false, reason: "invalid", problems };
  const state = read();
  if (!state.numbers.some((entry) => entry.id === id)) return { ok: false, reason: "invalid" };
  const numbers = state.numbers.map((entry) =>
    entry.id === id
      ? { ...entry, label: draft.label.trim(), number: draft.number.trim(), note: (draft.note ?? "").trim() }
      : entry,
  );
  return write({ ...state, numbers }) ? { ok: true, id } : { ok: false, reason: "storage" };
}

export function removeSavedNumbers(ids: ReadonlySet<string>): readonly SavedNumber[] {
  const state = read();
  const removed = state.numbers.filter((entry) => ids.has(entry.id));
  if (removed.length) write({ ...state, numbers: state.numbers.filter((entry) => !ids.has(entry.id)) });
  return removed;
}

export function restoreSavedNumbers(entries: readonly SavedNumber[]): boolean {
  const state = read();
  const present = new Set(state.numbers.map((entry) => entry.id));
  const missing = entries.filter((entry) => !present.has(entry.id));
  if (!missing.length) return true;
  return write({ ...state, numbers: [...missing, ...state.numbers].slice(0, MAX_SAVED_NUMBERS) });
}

export function setSavedNumbersPinned(ids: ReadonlySet<string>, pinned: boolean, now: number = Date.now()): boolean {
  const state = read();
  return write({
    ...state,
    numbers: state.numbers.map((entry) => (ids.has(entry.id) ? { ...entry, pinnedAt: pinned ? now : null } : entry)),
  });
}

/** Changes pin order: each id gets a pin time in list order, so the shelf draws them that way. */
export function setPinOrder(ids: readonly string[], base: number = Date.now()): boolean {
  const state = read();
  const rank = new Map(ids.map((id, index) => [id, base + index]));
  return write({
    ...state,
    numbers: state.numbers.map((entry) =>
      rank.has(entry.id) && entry.pinnedAt !== null ? { ...entry, pinnedAt: rank.get(entry.id)! } : entry,
    ),
  });
}

export function recordNumberOpened(id: string, now: number = Date.now()): void {
  const state = read();
  if (!state.numbers.some((entry) => entry.id === id)) return;
  write({ ...state, numbers: state.numbers.map((entry) => (entry.id === id ? { ...entry, openedAt: now } : entry)) });
}

/* -------------------------------------------------------------- overrides */

/**
 * Sets, or with null clears, the name and note a person gave one favourite.
 * `itemId` is the favourite's id (`services:slug`, `work:day:my-day-week`, `number:n…`).
 * Returns the problem text when the text cannot be kept.
 */
export function setFavouriteOverride(
  itemId: string,
  override: FavouriteOverride | null,
): { ok: true } | { ok: false; field: "name" | "note" | "storage"; problem: string } {
  const state = read();
  const next = { ...state.overrides };
  const name = override?.name?.trim() ?? "";
  const note = override?.note?.trim() ?? "";
  if (name) {
    const problem = favouriteTextProblem(name, OVERRIDE_NAME_MAX);
    if (problem) return { ok: false, field: "name", problem };
  }
  if (note) {
    const problem = favouriteTextProblem(note, OVERRIDE_NOTE_MAX);
    if (problem) return { ok: false, field: "note", problem };
  }
  if (!name && !note) delete next[itemId];
  else next[itemId] = { ...(name ? { name } : {}), ...(note ? { note } : {}) };
  return write({ ...state, overrides: next })
    ? { ok: true }
    : { ok: false, field: "storage", problem: "This device did not save that. Storage is blocked or full." };
}

/* ----------------------------------------------------------------- layout */

export function setFavouritesLayout(patch: Partial<FavouritesLayout>): boolean {
  const state = read();
  return write({ ...state, layout: parseLayout({ ...state.layout, ...patch }) });
}

export function resetFavouritesLayout(): boolean {
  const state = read();
  return write({ ...state, layout: DEFAULT_FAVOURITES_LAYOUT });
}

/** Sections in drawing order, without the hidden ones. */
export function visibleSections(layout: FavouritesLayout): FavouritesSectionId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id));
}

/* ------------------------------------------------------------------ reset */

/** Removes everything this store keeps on the device. Sign-out does this too. */
export function clearFavouritesLocal(): void {
  cache = null;
  try {
    window.localStorage.removeItem(FAVOURITES_LOCAL_STORAGE_KEY);
  } catch {
    // Nothing stored to remove.
  }
  notify();
}

export function resetFavouritesLocalForTesting(): void {
  cache = null;
  listeners.clear();
}
