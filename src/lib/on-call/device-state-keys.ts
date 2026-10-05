/**
 * Every On Call store that lives on the device, and the one operation the
 * sign-out path needs to wipe them — deliberately alone in a module that
 * imports nothing.
 *
 * Sibling of `recent-storage-keys.ts`, `checklist-storage-keys.ts` and
 * `entry-cache-keys.ts`, and here for the same measured reason:
 * `src/app/layout.tsx` mounts the auth provider on every page, so importing a
 * store instead would pull the On Call domain model into every page's bundle —
 * that cost 21 KiB gzip on `/` last time.
 *
 * Adding a store to the rebuilt On Call pages means adding its key to
 * `ON_CALL_DEVICE_STATE_KEYS` below, not inventing a second sign-out path.
 * None of these stores holds a phone number or an entry title: they hold ids, times,
 * yes/no answers and the reader's own choices.
 *
 * Keep it free of imports. Anything added here is added to every page.
 */

/** `{ serviceId, siteId }` — the hospital this reader last chose. */
export const onCallHospitalChoiceStorageKey = "clinical-kb-on-call-hospital-choice";
/** `{ [service:site]: { seen: { [entryId]: time }, gone: { [entryId]: time } } }` — ids and times only (review B2). */
export const onCallHandbookSeenStorageKey = "clinical-kb-on-call-handbook-seen";
/** Reports sent from this device, so one fault is reported once (30 days). */
export const onCallHandbookReportedStorageKey = "clinical-kb-on-call-handbook-reported";
/** "You called 02:14" (and lane B's "Didn't connect"): entry ids and times, 12 hours. */
export const onCallCallMarksStorageKey = "clinical-kb-on-call-call-marks";
/** The reader's own team, for Now's "Your team" block. */
export const onCallMyTeamStorageKey = "clinical-kb-on-call-my-team";
/** The shift the reader picked when the roster could not say. */
export const onCallShiftPickStorageKey = "clinical-kb-on-call-shift-pick";
/** Lane D's hospital copy for no-signal areas. Used only if the owner approves lane D. */
export const onCallHandbookOfflineStorageKey = "clinical-kb-on-call-handbook-offline-v1";
/**
 * `{ [service:site]: boolean }` — whether the hospital showed a pinned emergency
 * row last time. A yes or no only, never the number, so Now can reserve the
 * space before the network answers (review F7).
 */
export const onCallEmergencyPinnedStorageKey = "clinical-kb-on-call-emergency-pinned";
/**
 * Whether the signed-in reader edits any hospital handbook. The pages sheet
 * reads it to list "Manage service" for editors only (review F24) without a
 * fetch of its own. It is a navigation hint, not a permission: the server still
 * decides every edit.
 */
export const onCallEditorFlagStorageKey = "clinical-kb-on-call-editor";
/** "Your usual": the order frozen at the start of this shift (review F8). */
export const onCallUsualOrderStorageKey = "clinical-kb-on-call-usual-order";
/** Call's "Didn't connect" marks: entry ids and times, 12 hours. */
export const onCallDidntConnectStorageKey = "clinical-kb-on-call-didnt-connect";
/** "I'm on a hospital phone": a yes about this phone only, off by default. */
export const onCallHospitalPhoneStorageKey = "clinical-kb-on-call-hospital-phone";
/**
 * Shift pulse: `{ v: 1, hours: { "2026-10-05T21": 3 } }` — how many calls were
 * noted in each Perth hour, for the last week. Counts only: never a bed, a
 * caller, a note or anything else from the call itself.
 */
export const onCallCallCountsStorageKey = "clinical-kb-on-call-call-counts";

/**
 * Fired once after `clearOnCallDeviceState` (the sign-out wipe), so mounted
 * stores drop in-memory copies — including `useHospitalHandbook`'s 60-second
 * read memo. Ordinary writes to one store fire `onCallDeviceStoreChangedEvent`
 * instead, so recording a call never throws away a hospital read.
 */
export const onCallDeviceStateChangedEvent = "clinical-kb-on-call-device-state-changed";
/** Fired after a write to any one of the stores below, for this tab's subscribers. */
export const onCallDeviceStoreChangedEvent = "clinical-kb-on-call-device-store-changed";

export const ON_CALL_DEVICE_STATE_KEYS: readonly string[] = [
  onCallHospitalChoiceStorageKey,
  onCallHandbookSeenStorageKey,
  onCallHandbookReportedStorageKey,
  onCallCallMarksStorageKey,
  onCallMyTeamStorageKey,
  onCallShiftPickStorageKey,
  onCallHandbookOfflineStorageKey,
  onCallEmergencyPinnedStorageKey,
  onCallEditorFlagStorageKey,
  onCallUsualOrderStorageKey,
  onCallDidntConnectStorageKey,
  onCallHospitalPhoneStorageKey,
  onCallCallCountsStorageKey,
];

/**
 * Sign-out, session-expiry and account-switch boundary.
 *
 * Each key is removed inside its own `try`, so one blocked key cannot keep the
 * rest on a shared ward phone. The event is dispatched in a separate `try`
 * whatever happened to storage: a store holding an in-memory copy must drop it
 * even when the device refused to delete the saved one. Called from
 * `src/lib/supabase/client.tsx`; do not invent a second sign-out path.
 */
export function clearOnCallDeviceState(): void {
  if (typeof window === "undefined") return;
  for (const key of ON_CALL_DEVICE_STATE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Blocked storage: nothing further can be removed for this key.
    }
  }
  try {
    window.dispatchEvent(new Event(onCallDeviceStateChangedEvent));
  } catch {
    // No window events to send; nothing is listening either.
  }
}

/** What the handbook last said about this reader's role; "unknown" until it has said anything. */
export type OnCallEditorStatus = "editor" | "not-editor" | "unknown";

export function readOnCallEditorStatus(): OnCallEditorStatus {
  if (typeof window === "undefined") return "unknown";
  try {
    const stored = window.localStorage.getItem(onCallEditorFlagStorageKey);
    return stored === "1" ? "editor" : stored === "0" ? "not-editor" : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Whether the pages sheet offers the editor rows ("Manage service"). True for
 * an editor AND while the role is unknown (a fresh device, after the sign-out
 * wipe, blocked storage); false only once the handbook has said this reader
 * does not edit (review S3, amendment 1.7: "keep it visible"). The page
 * itself does the real gating.
 */
export function readOnCallEditorFlag(): boolean {
  return readOnCallEditorStatus() !== "not-editor";
}

/**
 * `useSyncExternalStore` subscription for the editor flag, so the mode pill's
 * pages sheet can offer "Manage service" (editors, or role unknown) without a fetch of its
 * own (F24). Listens to this tab's store writes, the sign-out wipe, and writes
 * from other tabs.
 */
export function subscribeOnCallEditorFlag(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(onCallDeviceStoreChangedEvent, onChange);
  window.addEventListener(onCallDeviceStateChangedEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(onCallDeviceStoreChangedEvent, onChange);
    window.removeEventListener(onCallDeviceStateChangedEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Recorded by `useHospitalHandbook` whenever it reads the reader's services:
 * "1" for an editor, "0" for a reader who does not edit. A yes/no about the
 * reader's own role, nothing about the hospital. The sign-out wipe removes it,
 * which returns the device to "unknown".
 */
export function rememberOnCallEditorFlag(isEditor: boolean): void {
  if (typeof window === "undefined") return;
  const next: OnCallEditorStatus = isEditor ? "editor" : "not-editor";
  try {
    if (readOnCallEditorStatus() === next) return;
    window.localStorage.setItem(onCallEditorFlagStorageKey, isEditor ? "1" : "0");
    window.dispatchEvent(new Event(onCallDeviceStoreChangedEvent));
  } catch {
    // Blocked storage: the role stays unknown, which keeps Manage service offered.
  }
}
