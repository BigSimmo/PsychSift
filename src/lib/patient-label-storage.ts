/**
 * Patient labels on the device: the one place a bed number or a patient's
 * initials may be kept in the browser, and the one way they are wiped.
 *
 * THE RULE. Anything that holds a patient label (a Mental Health Act timer, a
 * quick call note, a handover draft) stores it through this module and nowhere
 * else. Labels never go to the server. They are cleared:
 *   1. at the end of the shift — the rostered shift's end when the caller knows
 *      it, otherwise a fixed number of hours after the first label of the shift
 *      was written; and
 *   2. at every account transition (sign-out, session expiry, a different user
 *      signing in to the same tab), from the auth provider's single clearing
 *      list.
 *
 * WHY IT CANNOT DELETE ANYTHING ELSE. Every label key is
 * `PATIENT_LABEL_KEY_PREFIX` + a short validated name, and the wipe removes only
 * keys that start with that exact prefix (colon included). No other store in
 * the app uses the prefix — `tests/patient-label-storage.test.ts` checks the
 * other known keys — so the wipe can never touch pins, preferences, credentials
 * or drafts.
 *
 * WHY IT FAILS CLOSED. One expiry stamp, kept under the same prefix in
 * localStorage, says when this shift's labels expire. A label is never written
 * unless the stamp was written first, and every read checks the stamp. Labels
 * found with no stamp, an unreadable stamp, a stamp that has passed, or a stamp
 * that only makes sense if the clock went backwards are all wiped rather than
 * shown. Reading an expired label therefore returns nothing even before the
 * background watcher has run.
 *
 * The stamp's end time can be brought forward by a later roster-aware write but
 * never pushed later, so steady use during a shift cannot keep labels alive
 * past it.
 *
 * Keep this module free of imports: the auth provider imports it, and the auth
 * provider is on every page (see `tests/on-call-root-bundle-isolation.test.ts`
 * for the measured cost of getting that wrong).
 */

/** Every patient-label key starts with this. The trailing colon is part of it. */
export const PATIENT_LABEL_KEY_PREFIX = "psychsift:patient-labels:";

/** localStorage — `{ v: 1, startedAt, expiresAt }` (epoch ms) for this shift's labels. */
export const PATIENT_LABEL_EXPIRY_STORAGE_KEY = `${PATIENT_LABEL_KEY_PREFIX}__shift-expiry`;

const HOUR_MS = 60 * 60 * 1000;

/**
 * With no rostered end time, labels last this long from the first label of the
 * shift. Conservative on purpose: a longer shift loses its labels early (they
 * can be re-entered) rather than leaving them for the next person.
 */
export const PATIENT_LABEL_FALLBACK_LIFETIME_MS = 12 * HOUR_MS;

/** A roster end time further away than this is treated as bad data and ignored. */
export const PATIENT_LABEL_MAX_LIFETIME_MS = 24 * HOUR_MS;

/** A clock this far behind the stamp's start means the clock moved: wipe. */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** How often an open page re-checks the expiry. Reads check it exactly. */
export const PATIENT_LABEL_WATCH_INTERVAL_MS = 60 * 1000;

/** Fired on `window` after a wipe, so stores holding a copy drop it. */
export const PATIENT_LABELS_CLEARED_EVENT = "psychsift-patient-labels-cleared";

export type PatientLabelStorageArea = "local" | "session";
export type PatientLabelClearReason = "shift-ended" | "account-transition" | "invalid-expiry" | "manual";

type ExpiryStamp = { v: 1; startedAt: number; expiresAt: number };

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The storage key for one label store. Throws on a name that could escape the namespace. */
export function patientLabelStorageKey(name: string): string {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid patient-label store name: ${JSON.stringify(name)}`);
  }
  return `${PATIENT_LABEL_KEY_PREFIX}${name}`;
}

function storageFor(area: PatientLabelStorageArea): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function labelKeysIn(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(PATIENT_LABEL_KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

function hasAnyLabelKeys(): boolean {
  for (const area of ["local", "session"] as const) {
    const storage = storageFor(area);
    if (!storage) continue;
    try {
      if (labelKeysIn(storage).length > 0) return true;
    } catch {
      // Unreadable storage holds nothing we can show.
    }
  }
  return false;
}

/**
 * Strict parse of a raw expiry stamp: `{ v: 1, startedAt, expiresAt }` with a
 * forward, at most 24-hour lifetime. Null for anything else. Pure, so a render
 * path can apply the same validation the store does.
 */
export function parsePatientLabelExpiryStamp(raw: string | null): ExpiryStamp | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<ExpiryStamp> | null;
    if (
      value === null ||
      typeof value !== "object" ||
      value.v !== 1 ||
      typeof value.startedAt !== "number" ||
      typeof value.expiresAt !== "number" ||
      !Number.isFinite(value.startedAt) ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= value.startedAt ||
      value.expiresAt - value.startedAt > PATIENT_LABEL_MAX_LIFETIME_MS
    ) {
      return null;
    }
    return { v: 1, startedAt: value.startedAt, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

function readStamp(): ExpiryStamp | "missing" | "invalid" {
  const storage = storageFor("local");
  if (!storage) return "missing";
  let raw: string | null;
  try {
    raw = storage.getItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY);
  } catch {
    return "invalid";
  }
  if (raw === null) return "missing";
  return parsePatientLabelExpiryStamp(raw) ?? "invalid";
}

/**
 * Remove every patient label from localStorage and sessionStorage — and only
 * those — then fire `PATIENT_LABELS_CLEARED_EVENT`. Safe on the server (no-op).
 */
export function clearPatientLabels(reason: PatientLabelClearReason = "manual"): void {
  if (typeof window === "undefined") return;
  for (const area of ["local", "session"] as const) {
    const storage = storageFor(area);
    if (!storage) continue;
    try {
      for (const key of labelKeysIn(storage)) storage.removeItem(key);
    } catch {
      // Storage that refuses access has nothing stored to clear.
    }
  }
  window.dispatchEvent(new CustomEvent(PATIENT_LABELS_CLEARED_EVENT, { detail: { reason } }));
}

/**
 * Wipe the labels if the shift has ended or the stamp cannot be trusted.
 * Returns true when labels were wiped. Nothing stored means nothing to do.
 */
export function clearExpiredPatientLabels(now: number = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  const stamp = readStamp();
  if (stamp === "missing") {
    // Labels with no stamp were left by another tab's wipe or a partial write.
    if (!hasAnyLabelKeys()) return false;
    clearPatientLabels("invalid-expiry");
    return true;
  }
  if (stamp === "invalid") {
    clearPatientLabels("invalid-expiry");
    return true;
  }
  if (now >= stamp.expiresAt) {
    clearPatientLabels("shift-ended");
    return true;
  }
  if (now < stamp.startedAt - CLOCK_SKEW_TOLERANCE_MS) {
    clearPatientLabels("invalid-expiry");
    return true;
  }
  return false;
}

/** When this shift's labels will be wiped, or null if none are stored. */
export function patientLabelsExpireAt(now: number = Date.now()): number | null {
  clearExpiredPatientLabels(now);
  const stamp = readStamp();
  return typeof stamp === "object" ? stamp.expiresAt : null;
}

/**
 * The roster end to use, `null` when there is none worth trusting (absent,
 * unreadable, or implausibly far away), or `"ended"` when the shift it names
 * is already over — a label written then belongs to no shift and is refused.
 */
function usableShiftEnd(shiftEndsAt: Date | string | number | null | undefined, now: number): number | null | "ended" {
  if (shiftEndsAt === null || shiftEndsAt === undefined) return null;
  const at = shiftEndsAt instanceof Date ? shiftEndsAt.getTime() : new Date(shiftEndsAt).getTime();
  if (!Number.isFinite(at)) return null;
  if (at <= now) return "ended";
  if (at - now > PATIENT_LABEL_MAX_LIFETIME_MS) return null;
  return at;
}

export type WritePatientLabelsOptions = {
  readonly area?: PatientLabelStorageArea;
  /** The rostered end of the current shift, when the caller knows it. */
  readonly shiftEndsAt?: Date | string | number | null;
  readonly now?: number;
};

/**
 * Store one label store's value (the caller serialises it). Returns false, and
 * stores nothing, when the expiry stamp could not be written first or when the
 * rostered shift the caller names has already ended.
 */
export function writePatientLabels(name: string, value: string, options: WritePatientLabelsOptions = {}): boolean {
  const key = patientLabelStorageKey(name);
  const now = options.now ?? Date.now();
  const local = storageFor("local");
  const target = storageFor(options.area ?? "local");
  if (!local || !target) return false;

  clearExpiredPatientLabels(now);
  const rosterEnd = usableShiftEnd(options.shiftEndsAt, now);
  // An autosave as the rostered shift ends must not start a fresh 12-hour stamp.
  if (rosterEnd === "ended") return false;
  const existing = readStamp();
  const stamp: ExpiryStamp =
    typeof existing === "object"
      ? {
          v: 1,
          startedAt: existing.startedAt,
          // A roster end may bring the wipe forward, never push it back.
          expiresAt: rosterEnd !== null && rosterEnd < existing.expiresAt ? rosterEnd : existing.expiresAt,
        }
      : { v: 1, startedAt: now, expiresAt: rosterEnd ?? now + PATIENT_LABEL_FALLBACK_LIFETIME_MS };

  try {
    local.setItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY, JSON.stringify(stamp));
  } catch {
    return false;
  }
  try {
    target.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Read one label store's raw value, or null when absent, expired or untrusted. */
export function readPatientLabels(
  name: string,
  options: { readonly area?: PatientLabelStorageArea; readonly now?: number } = {},
): string | null {
  const key = patientLabelStorageKey(name);
  clearExpiredPatientLabels(options.now ?? Date.now());
  const storage = storageFor(options.area ?? "local");
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Remove one label store, for example when the user deletes a timer. */
export function removePatientLabels(name: string, options: { readonly area?: PatientLabelStorageArea } = {}): void {
  const key = patientLabelStorageKey(name);
  const storage = storageFor(options.area ?? "local");
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing readable to remove.
  }
}

/** Listen for wipes. Returns the unsubscribe; a no-op on the server. */
export function subscribePatientLabelsCleared(listener: (event: Event) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(PATIENT_LABELS_CLEARED_EVENT, listener);
  return () => window.removeEventListener(PATIENT_LABELS_CLEARED_EVENT, listener);
}

/**
 * Check the expiry now, whenever the page becomes visible or focused, when
 * another tab removes the stamp, and every `PATIENT_LABEL_WATCH_INTERVAL_MS`.
 * Mounted once by the auth provider, which is on every page. Returns the stop.
 */
export function watchPatientLabelExpiry(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const check = () => {
    clearExpiredPatientLabels();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") check();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PATIENT_LABEL_EXPIRY_STORAGE_KEY) check();
  };
  check();
  const interval = window.setInterval(check, PATIENT_LABEL_WATCH_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", check);
  window.addEventListener("pageshow", check);
  window.addEventListener("storage", onStorage);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", check);
    window.removeEventListener("pageshow", check);
    window.removeEventListener("storage", onStorage);
  };
}
