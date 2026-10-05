import { useSyncExternalStore } from "react";

import { PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { readPatientLabels, removePatientLabels } from "@/lib/patient-label-storage";

/**
 * The MHA clock's on-device list: which Mental Health Act forms the reader is holding right now,
 * and when each was made.
 *
 * What it holds and why: a form code ("3A"), the time the form was made and an opaque random id.
 * Never a name, bed number, initials or note: the owner decided a clock carries no label
 * (5 October 2026), so this store has no field for one and is not a patient-label store.
 *
 * Where it lives and for how long: its own localStorage key, kept until the reader removes a clock
 * or the account changes (sign-out, session expiry, another user signing in), when the auth
 * provider's single clearing list removes it (`src/lib/account-scoped-browser-state.ts`). It is
 * deliberately NOT cleared at the end of a shift: a Form 3A detention can run 72 hours, or 144
 * outside the metropolitan area, so a shift-end wipe could drop a running legal time limit
 * (owner decision, 5 October 2026). Nothing goes to the server, search or AI.
 *
 * Clocks made before that decision lived in the patient-label store; the first read moves them
 * across once and removes the old copy.
 *
 * Reads are honest about failure: a browser that refuses storage, or a stored value that cannot be
 * parsed, reports `unreadable` so the page never says "No clocks yet" over clocks it could not see.
 *
 * The time limits themselves are not here. The page reads them from the governed timeframe data
 * through `mhaTimers` (`src/lib/on-call/mha-timers.ts`), which shows a countdown only while the
 * owner's signed switch is on.
 */

/** The store name the clocks used inside the patient-label store, before 5 October 2026. */
export const LEGACY_MHA_CLOCK_STORE_NAME = "mha-clocks";
/** A night's worth. More than this is refused rather than silently dropping the oldest. */
export const MHA_CLOCK_LIMIT = 12;
export const mhaClocksChangeEvent = "psychsift:mha-clocks-change";
/** Said instead of any count or "No clocks" when this device could not read its clocks. */
export const MHA_CLOCK_UNREADABLE = "Clocks could not be read on this phone.";

export interface MhaClock {
  /** Opaque random id. Never derived from anything about the person. */
  readonly id: string;
  /** Form code as the forms catalogue writes it, e.g. "3A". */
  readonly formCode: string;
  /** Epoch milliseconds of when the form was made. */
  readonly madeAt: number;
}

export interface MhaClockState {
  /** The clocks that could be read, oldest form first. */
  readonly clocks: readonly MhaClock[];
  /** True when storage refused the read, or some or all of what it held could not be parsed. */
  readonly unreadable: boolean;
}

type StoredClocks = { readonly v: 1; readonly clocks: readonly MhaClock[] };

const FORM_CODE = /^[0-9]{1,2}[A-Z]?$/;
const ID = /^[a-z0-9-]{8,64}$/;

export const EMPTY_MHA_CLOCKS: readonly MhaClock[] = Object.freeze([]);
export const EMPTY_MHA_CLOCK_STATE: MhaClockState = Object.freeze({ clocks: EMPTY_MHA_CLOCKS, unreadable: false });
const UNREADABLE_STATE: MhaClockState = Object.freeze({ clocks: EMPTY_MHA_CLOCKS, unreadable: true });

function isClock(value: unknown): value is MhaClock {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    ID.test(row.id) &&
    typeof row.formCode === "string" &&
    FORM_CODE.test(row.formCode) &&
    typeof row.madeAt === "number" &&
    Number.isFinite(row.madeAt)
  );
}

/** Parse a stored value. Anything malformed is dropped and reported as unreadable. Exported for tests. */
export function parseMhaClockState(raw: string | null): MhaClockState {
  if (!raw) return EMPTY_MHA_CLOCK_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredClocks>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.clocks)) return UNREADABLE_STATE;
    // Rebuild each row from its three fields, so nothing else a stored value carries (a label, a
    // note) survives a read or is written back by the next change.
    const clocks = parsed.clocks
      .filter(isClock)
      .map(({ id, formCode, madeAt }): MhaClock => ({ id, formCode, madeAt }));
    return {
      clocks: [...clocks].sort((a, b) => a.madeAt - b.madeAt).slice(0, MHA_CLOCK_LIMIT),
      unreadable: clocks.length !== parsed.clocks.length || clocks.length > MHA_CLOCK_LIMIT,
    };
  } catch {
    return UNREADABLE_STATE;
  }
}

/** Just the clocks from a stored value. Exported for tests. */
export function parseMhaClocks(raw: string | null): readonly MhaClock[] {
  return parseMhaClockState(raw).clocks;
}

function readRaw(): { readonly raw: string | null; readonly failed: boolean } {
  try {
    return { raw: window.localStorage.getItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY), failed: false };
  } catch {
    return { raw: null, failed: true };
  }
}

function writeRaw(raw: string | null): boolean {
  try {
    if (raw === null) window.localStorage.removeItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY);
    else window.localStorage.setItem(PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move clocks out of the patient-label store, once, when the new store is empty. The old copy is
 * removed only after the new copy was written, so a refused write leaves the clocks where they were.
 * An old value this code cannot fully read is moved across exactly as it was, so the page says
 * "Clocks could not be read" and offers to keep the readable ones, rather than saying "No clocks
 * yet" over clocks it could not see. Run from `subscribeMhaClocks`, outside render, because it
 * writes. Returns true when it moved anything.
 */
function migrateLegacyClocks(): boolean {
  const { raw, failed } = readRaw();
  if (failed || raw !== null) return false;
  const legacy = readPatientLabels(LEGACY_MHA_CLOCK_STORE_NAME);
  if (legacy === null) return false;
  const { clocks, unreadable } = parseMhaClockState(legacy);
  const moved = unreadable
    ? legacy
    : clocks.length > 0
      ? JSON.stringify({ v: 1, clocks } satisfies StoredClocks)
      : null;
  if (moved !== null && !writeRaw(moved)) return false;
  removePatientLabels(LEGACY_MHA_CLOCK_STORE_NAME);
  return moved !== null;
}

// useSyncExternalStore needs the same object back while nothing changed.
let cachedRaw: string | null | undefined;
let cachedFailed = false;
let cachedState: MhaClockState = EMPTY_MHA_CLOCK_STATE;

/** The clocks on this device and whether they could all be read. Empty on the server. */
export function loadMhaClockState(): MhaClockState {
  if (typeof window === "undefined") return EMPTY_MHA_CLOCK_STATE;
  const { raw, failed } = readRaw();
  if (raw !== cachedRaw || failed !== cachedFailed) {
    cachedRaw = raw;
    cachedFailed = failed;
    cachedState = failed ? UNREADABLE_STATE : parseMhaClockState(raw);
  }
  return cachedState;
}

/** The clocks on this device, oldest form first. Empty on the server. */
export function loadMhaClocks(): readonly MhaClock[] {
  return loadMhaClockState().clocks;
}

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(mhaClocksChangeEvent));
}

function save(clocks: readonly MhaClock[]): boolean {
  const ok = writeRaw(clocks.length === 0 ? null : JSON.stringify({ v: 1, clocks } satisfies StoredClocks));
  notify();
  return ok;
}

export type AddMhaClockResult = "added" | "full" | "invalid" | "not-saved" | "unreadable";

/**
 * The clocks a write may build on, or null while the store is unreadable: writing then would
 * silently overwrite what could not be read, so every change is refused until the reader chooses
 * `keepReadableMhaClocks`.
 */
function writableClocks(): readonly MhaClock[] | null {
  const state = loadMhaClockState();
  return state.unreadable ? null : state.clocks;
}

/** Start a clock. The caller checks the form has a timeline; this checks only the shape. */
export function addMhaClock(formCode: string, madeAt: Date): AddMhaClockResult {
  const ms = madeAt.getTime();
  if (!FORM_CODE.test(formCode) || !Number.isFinite(ms)) return "invalid";
  const current = writableClocks();
  if (current === null) return "unreadable";
  if (current.length >= MHA_CLOCK_LIMIT) return "full";
  const clock: MhaClock = { id: window.crypto.randomUUID(), formCode, madeAt: ms };
  return save([...current, clock]) ? "added" : "not-saved";
}

/** Remove one clock. Returns false when the browser refused the change or the store is unreadable. */
export function removeMhaClock(id: string): boolean {
  const current = writableClocks();
  if (current === null) return false;
  return save(current.filter((clock) => clock.id !== id));
}

/**
 * The reader's explicit choice after "Clocks could not be read": keep the clocks that could be read
 * and drop the rest. Returns false when the browser refused the change, or refused even to read the
 * store: then nothing was seen, so nothing is dropped.
 */
export function keepReadableMhaClocks(): boolean {
  if (readRaw().failed) return false;
  return save(loadMhaClockState().clocks);
}

/**
 * Put back a clock the reader just removed (the page's Undo). Refused when it is already there,
 * the list is full, or the clock is malformed.
 */
export function restoreMhaClock(clock: MhaClock): AddMhaClockResult {
  if (!isClock(clock)) return "invalid";
  const current = writableClocks();
  if (current === null) return "unreadable";
  if (current.some((existing) => existing.id === clock.id)) return "added";
  if (current.length >= MHA_CLOCK_LIMIT) return "full";
  return save([...current, clock]) ? "added" : "not-saved";
}

export function clearMhaClocks(): void {
  save(EMPTY_MHA_CLOCKS);
}

/** Changes in this tab, other tabs, and the sign-out wipe. */
export function subscribeMhaClocks(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY) listener();
  };
  window.addEventListener(mhaClocksChangeEvent, listener);
  window.addEventListener("storage", onStorage);
  const stopTransition = subscribeAccountTransition(listener);
  if (migrateLegacyClocks()) listener();
  return () => {
    window.removeEventListener(mhaClocksChangeEvent, listener);
    window.removeEventListener("storage", onStorage);
    stopTransition();
  };
}

/** The clocks and whether they could all be read, kept current across tabs and sign-out. */
export function useMhaClockState(): MhaClockState {
  return useSyncExternalStore(subscribeMhaClocks, loadMhaClockState, () => EMPTY_MHA_CLOCK_STATE);
}
