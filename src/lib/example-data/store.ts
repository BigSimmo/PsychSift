"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { EXAMPLE_DATA_COOKIE, EXAMPLE_DATA_STORAGE_KEY, encodeExampleCookie } from "@/lib/example-data/keys";
import { useAuthSession } from "@/lib/supabase/client";
import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * The one example data switch for every work area.
 *
 * Example data is made-up content that shows what each screen looks like full.
 * It is display only: it lives in the browser's memory (loaded from the
 * registry when needed), is never written to the account, and every record's
 * id starts with `example:` so exports, sharing, search history and
 * notifications can strip it (`guards.ts`).
 *
 * WHAT IS STORED. One small record on this device: the user's explicit choice
 * (on, off, or none yet), the areas where they added a real record while it
 * was on, and the areas known to hold real data. Area ids and booleans only.
 * It is account scoped and cleared at sign-out, session expiry and account
 * switch, with the cookie that mirrors it for server-rendered pages.
 *
 * THE DEFAULT ("auto"). A brand new account (created in the last 14 days) and
 * a signed-out visitor see example data in any area that has no real data yet,
 * and the area switches to their own data the moment it has some. Everyone
 * else starts with it off. An explicit on or off always wins.
 *
 * EXPLICIT ON fills every area, real data or not, until the user adds a real
 * record in an area: that area then shows their own data, because a record
 * they just saved must never be hidden behind made-up ones.
 */

export type ExampleDataMode = "auto" | "on" | "off";
export type AreaDataState = "unknown" | "empty" | "has-data";

type Stored = {
  readonly v: 1;
  readonly choice: "on" | "off" | null;
  /** Areas where a real record was added while the switch was on. Reset each time it is turned on. */
  readonly addedWhileOn: readonly WorkAreaId[];
  /** Areas known to hold real data, so auto mode never flashes examples over them on the next load. */
  readonly realAreas: readonly WorkAreaId[];
};

const EMPTY: Stored = { v: 1, choice: null, addedWhileOn: [], realAreas: [] };
const NEW_ACCOUNT_DAYS = 14;
const AREA_IDS: readonly WorkAreaId[] = ["day", "rost", "teach", "assess", "cpd", "admin", "call"];

function isArea(value: unknown): value is WorkAreaId {
  return typeof value === "string" && (AREA_IDS as readonly string[]).includes(value);
}

function parse(raw: string | null): Stored {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw) as Partial<Stored> | null;
    if (!value || value.v !== 1) return EMPTY;
    return {
      v: 1,
      choice: value.choice === "on" || value.choice === "off" ? value.choice : null,
      addedWhileOn: Array.isArray(value.addedWhileOn) ? value.addedWhileOn.filter(isArea) : [],
      realAreas: Array.isArray(value.realAreas) ? value.realAreas.filter(isArea) : [],
    };
  } catch {
    return EMPTY;
  }
}

let cache: Stored | null = null;
/** What each area reported this visit. Memory only: "empty" must be re-earned on every load. */
const reports = new Map<WorkAreaId, AreaDataState>();
let reportsVersion = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function read(): Stored {
  if (cache) return cache;
  if (typeof window === "undefined") return EMPTY;
  try {
    cache = parse(window.localStorage.getItem(EXAMPLE_DATA_STORAGE_KEY));
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function writeCookie(state: Stored) {
  if (typeof document === "undefined") return;
  const value = encodeExampleCookie(
    state.choice === "on" ? AREA_IDS.filter((a) => !state.addedWhileOn.includes(a)) : [],
  );
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = value
    ? `${EXAMPLE_DATA_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
    : `${EXAMPLE_DATA_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function write(next: Stored) {
  cache = next;
  try {
    window.localStorage.setItem(EXAMPLE_DATA_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode): the choice holds for this visit only.
  }
  writeCookie(next);
  notify();
}

if (typeof window !== "undefined") {
  subscribeAccountTransition(() => {
    cache = null;
    reports.clear();
    reportsVersion += 1;
    notify();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== EXAMPLE_DATA_STORAGE_KEY) return;
    cache = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The stored record, for code outside React. */
export function readExampleData(): Stored {
  return read();
}

/** Turn the switch on or off everywhere. On starts fresh: every area shows examples again. */
export function setExampleDataOn(on: boolean): void {
  const current = read();
  write({ ...current, choice: on ? "on" : "off", addedWhileOn: on ? [] : current.addedWhileOn });
}

/**
 * Call after a REAL record is saved in an area. While the switch is on, that
 * area goes back to the user's own data, and in auto mode the area is
 * remembered as holding real data.
 */
export function markRealRecordAdded(area: WorkAreaId): void {
  const current = read();
  const addedWhileOn =
    current.choice === "on" && !current.addedWhileOn.includes(area)
      ? [...current.addedWhileOn, area]
      : current.addedWhileOn;
  const realAreas = current.realAreas.includes(area) ? current.realAreas : [...current.realAreas, area];
  reports.set(area, "has-data");
  reportsVersion += 1;
  if (addedWhileOn === current.addedWhileOn && realAreas === current.realAreas) return notify();
  write({ ...current, addedWhileOn, realAreas });
}

/**
 * What an area's screen loaded from the account: "empty" or "has-data". Call it
 * whenever the real read settles (not while loading, offline with no cache, or
 * signed out with nothing to read). Only the state is kept, never content.
 */
export function reportAreaData(area: WorkAreaId, state: "empty" | "has-data"): void {
  const current = read();
  const changed = reports.get(area) !== state;
  reports.set(area, state);
  if (state === "has-data" && !current.realAreas.includes(area)) {
    reportsVersion += 1;
    return write({ ...current, realAreas: [...current.realAreas, area] });
  }
  if (state === "empty" && current.realAreas.includes(area)) {
    // Everything was deleted: the area is empty again and may show examples in auto mode.
    reportsVersion += 1;
    return write({ ...current, realAreas: current.realAreas.filter((a) => a !== area) });
  }
  if (changed) {
    reportsVersion += 1;
    notify();
  }
}

/** What is known about an area's real data this visit. */
export function areaDataState(area: WorkAreaId): AreaDataState {
  const reported = reports.get(area);
  if (reported) return reported;
  return read().realAreas.includes(area) ? "has-data" : "unknown";
}

/** Whether an account counts as brand new for the auto default. Pure, for tests. */
export function isNewAccount(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return now - created < NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Whether an area shows example data, from the stored record, the area's
 * reported state and whether the auto default applies. Pure, for tests and
 * for the hook below.
 */
export function exampleActiveFor(
  stored: Stored,
  area: WorkAreaId | undefined,
  areaState: AreaDataState,
  autoEligible: boolean,
): boolean {
  if (stored.choice === "off") return false;
  if (stored.choice === "on") return area ? !stored.addedWhileOn.includes(area) : true;
  if (!autoEligible || !area) return false;
  return areaState === "empty";
}

export type ExampleDataControl = {
  /** The switch as the user set it, or "auto" before they have. */
  readonly mode: ExampleDataMode;
  /** Whether the switch reads as on in Settings (explicit on, or auto showing somewhere). */
  readonly on: boolean;
  /** Whether THIS area shows example data now. Always false without an area. */
  readonly active: boolean;
  /** Areas currently showing examples (Settings says "Showing in 5 areas"). */
  readonly activeAreas: readonly WorkAreaId[];
  readonly turnOn: () => void;
  readonly turnOff: () => void;
};

function getSnapshot() {
  return `${JSON.stringify(read())}|${reportsVersion}`;
}

function getServerSnapshot() {
  return "server";
}

/** Read and drive the example data switch. Pass the area to learn whether this screen shows examples. */
export function useExampleData(area?: WorkAreaId): ExampleDataControl {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { session, status } = useAuthSession();
  const autoEligible =
    status === "signed_out" ||
    status === "expired" ||
    (status === "authenticated" && isNewAccount(session?.user?.created_at));
  const turnOn = useCallback(() => setExampleDataOn(true), []);
  const turnOff = useCallback(() => setExampleDataOn(false), []);
  return useMemo(() => {
    const stored = snapshot === "server" ? EMPTY : read();
    const activeAreas = AREA_IDS.filter((a) => exampleActiveFor(stored, a, areaDataState(a), autoEligible));
    return {
      mode: stored.choice ?? "auto",
      on: stored.choice === "on" || activeAreas.length > 0,
      active: area ? activeAreas.includes(area) : false,
      activeAreas,
      turnOn,
      turnOff,
    };
  }, [snapshot, autoEligible, area, turnOn, turnOff]);
}

/** Test hook: forget the module cache and this visit's reports. */
export function resetExampleDataForTests(): void {
  cache = null;
  reports.clear();
  reportsVersion += 1;
}
