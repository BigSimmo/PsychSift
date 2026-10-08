"use client";

import { useSyncExternalStore } from "react";

import { subscribeAccountTransition, WORK_ACCOUNT_SYNC_MARKER_KEY } from "@/lib/account-scoped-browser-state";
import { isSharedDevice } from "@/lib/alerts/shared-device";
import { isEmptyWorkSyncValue, mergeWorkSyncValues } from "@/lib/work-sync/merge";
import {
  isTextSection,
  isWorkSyncSection,
  skipsSharedDevice,
  WORK_SYNC_CHANGE_EVENT,
  WORK_SYNC_SECTIONS,
  WORK_SYNC_STORAGE_KEYS,
  type WorkSyncSection,
} from "@/lib/work-sync/sections";

/**
 * Keeps the work choices in `sections.ts` the same on every device a doctor
 * signs in on. The device stores stay the only thing the pages read; this
 * engine copies a store's key up to the account after the doctor changes it,
 * and copies the account's value down when the app opens or comes back to the
 * front. The newest save wins. Signed out, in the demo build or with no
 * connection, nothing changes for the pages: their choices simply stay on this
 * device until the next successful save.
 *
 * Only one session runs at a time, started and stopped by `WorkAccountSync`
 * for the signed-in account. An account transition stops it before the next
 * person's session can start, and every response is dropped unless it still
 * belongs to the session that asked.
 */

export type WorkSyncStatus = "off" | "account" | "device";

type Session = {
  readonly headers: () => Readonly<Record<string, string>>;
  readonly isCurrent: () => boolean;
  readonly dirty: Set<WorkSyncSection>;
  /** Refused by the account for what they hold; kept on this device until the doctor changes them. */
  readonly refused: Set<WorkSyncSection>;
  readonly timers: Map<WorkSyncSection, ReturnType<typeof setTimeout>>;
  /** Bumped on every change, so a save that finishes after a newer change cannot mark it saved. */
  readonly generations: Map<WorkSyncSection, number>;
  /** One save at a time per section, in the order the changes were made. */
  readonly queues: Map<WorkSyncSection, Promise<void>>;
  /** Sections this device has matched with the account at least once. */
  readonly matched: Set<WorkSyncSection>;
  lastPull: number;
  stopped: boolean;
};

const SYNC_URL = "/api/work/sync";
const PUSH_DELAY_MS = 800;
/** Coming back to the app re-reads the account copy, at most this often. */
const PULL_INTERVAL_MS = 30_000;

let session: Session | null = null;
/**
 * Changes not yet saved when a session stopped for any reason but an account
 * transition (a token refresh, a remount). The next session for the same
 * account saves them first, so the account's older copy never replaces them.
 */
const carriedDirty = new Set<WorkSyncSection>();
const statuses = new Map<WorkSyncSection, WorkSyncStatus>();
const statusListeners = new Set<() => void>();

function setStatus(section: WorkSyncSection, status: WorkSyncStatus): void {
  if (statuses.get(section) === status) return;
  statuses.set(section, status);
  for (const listener of statusListeners) listener();
}

function resetStatuses(): void {
  if (statuses.size === 0) return;
  statuses.clear();
  for (const listener of statusListeners) listener();
}

const SECTION_BY_KEY = new Map<string, WorkSyncSection>(
  WORK_SYNC_SECTIONS.map((section) => [WORK_SYNC_STORAGE_KEYS[section], section]),
);

/** On a device marked shared, CPD's job applications are neither copied down nor saved from here. */
function heldOffDevice(section: WorkSyncSection): boolean {
  return skipsSharedDevice(section) && isSharedDevice();
}

function readLocal(section: WorkSyncSection): unknown {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WORK_SYNC_STORAGE_KEYS[section]);
  } catch {
    return null;
  }
  if (raw === null) return null;
  if (isTextSection(section)) return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Writes the account's value into the device key and tells the store, which re-reads it. */
function writeLocal(section: WorkSyncSection, value: unknown): void {
  const key = WORK_SYNC_STORAGE_KEYS[section];
  const next = isEmptyWorkSyncValue(value) ? null : isTextSection(section) ? String(value) : JSON.stringify(value);
  try {
    const current = window.localStorage.getItem(key);
    if (current === next) return;
    if (next === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, next);
  } catch {
    // Storage refused: the page keeps what it has in memory, and the account copy is unchanged.
    return;
  }
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

/**
 * The sections the first release synced. A marker written then holds
 * `matched: true`, which covers only these: a section added later still has
 * its first match on that device, so a record kept only there is merged with
 * the account copy rather than replaced by it.
 */
const FIRST_RELEASE_SECTIONS: readonly WorkSyncSection[] = [
  "favouriteWorkPages",
  "myDayHiddenCards",
  "myDaySnoozes",
  "myDayQuickNote",
];

/**
 * What this device remembers about its match with the account, kept so a
 * reload cannot lose it: which sections have matched at least once, and which sections
 * hold a change the account does not have yet (not saved, or refused). Those
 * sections are saved again on the next start and never replaced by the
 * account's older copy.
 */
type SyncMarker = { readonly matched: ReadonlySet<WorkSyncSection>; readonly ahead: ReadonlySet<WorkSyncSection> };

function readMarker(): SyncMarker {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WORK_ACCOUNT_SYNC_MARKER_KEY);
  } catch {
    return { matched: new Set(), ahead: new Set() };
  }
  if (raw === null) return { matched: new Set(), ahead: new Set() };
  try {
    const parsed = JSON.parse(raw) as { matched?: unknown; ahead?: unknown };
    const ahead = Array.isArray(parsed.ahead) ? parsed.ahead.filter(isWorkSyncSection) : [];
    const matched =
      parsed.matched === true
        ? FIRST_RELEASE_SECTIONS
        : Array.isArray(parsed.matched)
          ? parsed.matched.filter(isWorkSyncSection)
          : [];
    return { matched: new Set(matched), ahead: new Set(ahead) };
  } catch {
    return { matched: new Set(), ahead: new Set() };
  }
}

function writeMarker(active: Session): void {
  if (active.stopped) return;
  const ahead = WORK_SYNC_SECTIONS.filter((section) => active.dirty.has(section) || active.refused.has(section));
  const matched = WORK_SYNC_SECTIONS.filter((section) => active.matched.has(section));
  try {
    window.localStorage.setItem(WORK_ACCOUNT_SYNC_MARKER_KEY, JSON.stringify({ matched, ahead }));
  } catch {
    // Storage refused: the next sign-in merges again, which loses nothing.
  }
}

async function send(active: Session, section: WorkSyncSection): Promise<void> {
  if (active.stopped) return;
  // Marked shared since this save was queued: the device copy is gone, and an empty save would clear the account's.
  if (heldOffDevice(section)) {
    active.dirty.delete(section);
    writeMarker(active);
    return;
  }
  const generation = active.generations.get(section) ?? 0;
  const local = readLocal(section);
  const value = isEmptyWorkSyncValue(local) ? null : local;
  try {
    const response = await fetch(SYNC_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...active.headers() },
      body: JSON.stringify({ section, value }),
    });
    if (active.stopped || !active.isCurrent()) return;
    // A change made while this save was in flight has its own save queued behind it.
    if ((active.generations.get(section) ?? 0) !== generation) return;
    if (response.ok) {
      active.dirty.delete(section);
      writeMarker(active);
      setStatus(section, "account");
      return;
    }
    // Refused for what it holds (a patient detail, no room): it stays on this device, as before.
    if (response.status === 400 || response.status === 413 || response.status === 422) {
      active.dirty.delete(section);
      active.refused.add(section);
      writeMarker(active);
      setStatus(section, "device");
    }
    // Anything else stays dirty and is tried again when the app next comes to the front.
  } catch {
    // Offline: stays dirty for the next try.
  }
}

function push(active: Session, section: WorkSyncSection): void {
  active.timers.delete(section);
  const queued = (active.queues.get(section) ?? Promise.resolve()).then(() => send(active, section));
  active.queues.set(section, queued);
}

function schedulePush(active: Session, section: WorkSyncSection): void {
  if (heldOffDevice(section)) return;
  active.refused.delete(section);
  active.dirty.add(section);
  active.generations.set(section, (active.generations.get(section) ?? 0) + 1);
  writeMarker(active);
  const existing = active.timers.get(section);
  if (existing) clearTimeout(existing);
  active.timers.set(
    section,
    setTimeout(() => push(active, section), PUSH_DELAY_MS),
  );
}

type AccountEntry = { value: unknown; updatedAt: string };

function readSections(payload: unknown): Partial<Record<WorkSyncSection, AccountEntry>> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const sections = (payload as { sections?: unknown }).sections;
  if (typeof sections !== "object" || sections === null) return null;
  const out: Partial<Record<WorkSyncSection, AccountEntry>> = {};
  for (const [section, entry] of Object.entries(sections as Record<string, unknown>)) {
    if (!isWorkSyncSection(section) || typeof entry !== "object" || entry === null) continue;
    const { value, updatedAt } = entry as { value?: unknown; updatedAt?: unknown };
    if (typeof updatedAt === "string") out[section] = { value: value ?? null, updatedAt };
  }
  return out;
}

async function pull(active: Session): Promise<void> {
  active.lastPull = Date.now();
  let payload: unknown;
  try {
    const response = await fetch(SYNC_URL, { cache: "no-store", headers: active.headers() });
    if (!response.ok) return;
    payload = await response.json();
  } catch {
    return;
  }
  if (active.stopped || !active.isCurrent()) return;
  const sections = readSections(payload);
  if (!sections || (payload as { demoMode?: unknown }).demoMode === true) return;

  for (const section of WORK_SYNC_SECTIONS) {
    // A change made on this device while the read was in flight is newer than what came back.
    // So is one the account refused: its older account copy must not replace it.
    if (active.dirty.has(section) || active.refused.has(section) || heldOffDevice(section)) continue;
    const entry = sections[section];
    const local = readLocal(section);
    const firstMatch = !active.matched.has(section);
    active.matched.add(section);
    if (!entry) {
      if (!isEmptyWorkSyncValue(local)) schedulePush(active, section);
      else setStatus(section, "account");
      continue;
    }
    if (!firstMatch || isEmptyWorkSyncValue(local)) {
      writeLocal(section, entry.value);
      setStatus(section, "account");
      continue;
    }
    // This device's first match with the account for this section: keep both sides, then save the result.
    const merged = mergeWorkSyncValues(section, local, entry.value);
    writeLocal(section, merged);
    schedulePush(active, section);
  }
  writeMarker(active);
}

/** Starts syncing for the signed-in account. Returns the stop. */
export function startWorkSync(options: {
  readonly headers: () => Readonly<Record<string, string>>;
  readonly isCurrent: () => boolean;
}): () => void {
  stopWorkSync();
  const marker = readMarker();
  const active: Session = {
    headers: options.headers,
    isCurrent: options.isCurrent,
    dirty: new Set([...carriedDirty, ...marker.ahead]),
    refused: new Set(),
    timers: new Map(),
    generations: new Map(),
    queues: new Map(),
    matched: new Set(marker.matched),
    lastPull: 0,
    stopped: false,
  };
  session = active;
  carriedDirty.clear();
  for (const section of active.dirty) schedulePush(active, section);

  const onChange = (event: Event) => {
    const key = (event as CustomEvent<unknown>).detail;
    const section = typeof key === "string" ? SECTION_BY_KEY.get(key) : undefined;
    if (section && !active.stopped) schedulePush(active, section);
  };
  const onFront = () => {
    if (active.stopped || document.visibilityState !== "visible") return;
    for (const section of active.dirty) if (!active.timers.has(section)) schedulePush(active, section);
    if (Date.now() - active.lastPull >= PULL_INTERVAL_MS) void pull(active);
  };
  window.addEventListener(WORK_SYNC_CHANGE_EVENT, onChange);
  document.addEventListener("visibilitychange", onFront);
  window.addEventListener("online", onFront);
  const stopOnTransition = subscribeAccountTransition(() => {
    // The next person must never inherit this one's unsaved changes.
    active.dirty.clear();
    carriedDirty.clear();
    stopWorkSync();
  });

  void pull(active);

  const stop = () => {
    active.stopped = true;
    for (const section of active.dirty) carriedDirty.add(section);
    for (const timer of active.timers.values()) clearTimeout(timer);
    active.timers.clear();
    window.removeEventListener(WORK_SYNC_CHANGE_EVENT, onChange);
    document.removeEventListener("visibilitychange", onFront);
    window.removeEventListener("online", onFront);
    stopOnTransition();
    if (session === active) {
      session = null;
      resetStatuses();
    }
  };
  stopCurrent = stop;
  return stop;
}

let stopCurrent: (() => void) | null = null;

export function stopWorkSync(): void {
  const stop = stopCurrent;
  stopCurrent = null;
  stop?.();
}

function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * Where a section's choices are kept right now: "account" once it matches the
 * account copy, "device" when the account refused it (the quick note read as a
 * patient detail, or the account is full), "off" when signed out, in the demo
 * build or before the first read.
 */
export function useWorkSyncStatus(section: WorkSyncSection): WorkSyncStatus {
  return useSyncExternalStore(
    subscribeStatus,
    () => statuses.get(section) ?? "off",
    () => "off",
  );
}

/** Test seam. */
export function resetWorkSyncForTesting(): void {
  stopWorkSync();
  session = null;
  carriedDirty.clear();
  statuses.clear();
  statusListeners.clear();
}
