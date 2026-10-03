/**
 * Account-scoped browser storage: the keys the auth provider must remove at an
 * account transition (sign-out, session expiry, a different user signing in to
 * the same tab), and the one event that tells their owning stores it happened.
 *
 * WHY THIS LIVES IN `src/lib` AND NAMES THE KEYS ITSELF. The auth provider is a
 * lib module and must never import a component module
 * (`tests/lib-layering.test.ts`), yet the favourites pins / last-opened keys it
 * has to clear are component-owned, in
 * `src/components/favourites/favourites-storage.ts` (2026-09-02 audit, L2).
 * So the keys are defined HERE, the component store imports them from here
 * (components -> lib is the permitted direction), and the provider removes the
 * raw entries directly. That is also what closes the full-reload hole: after a
 * navigation the owning module may not be loaded, but its storage key still
 * is, and a listener that was never registered cannot clear anything.
 *
 * One more key is cleared for legacy reasons only: the plan draft of the retired
 * Caring Contacts prototype (audit L6). Its workspace has been removed, but a
 * browser that used it may still hold a draft carrying a patient's name and
 * mobile, so the removal stays until no such browser can remain.
 *
 * THE EVENT IS FOR THE CACHES, NOT THE KEYS. The component stores memoise what
 * they last read and tell their React subscribers through their own listener
 * sets; a `storage` event only fires in *other* tabs. Each store subscribes to
 * `ACCOUNT_TRANSITION_EVENT` at module load, drops its cache and notifies. The
 * keys are removed BEFORE the event is dispatched, so a subscriber that re-reads
 * synchronously sees honest absence, never the previous person's values.
 *
 * Adding an account-scoped store means adding its key to `clearAccountScopedBrowserStorage`
 * below and, if it caches, subscribing to the event where it lives.
 */

export const ACCOUNT_TRANSITION_EVENT = "clinical-kb-account-transition";

/** localStorage — which favourites items were opened, and when (90-day TTL, no owner id). */
export const DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY = "database:favourites:last-opened-v1";
/** localStorage — the pinned favourites item ids (no owner id). */
export const DATABASE_FAVOURITES_PINNED_STORAGE_KEY = "database:favourites:pinned-v1";
/**
 * sessionStorage — the half-finished sign-up left by the retired Caring Contacts
 * prototype, which from stage 3 carried the patient's name and mobile. Nothing
 * writes it any more; it is kept only so a draft a browser still holds is cleared.
 * sessionStorage survives a sign-out and the next sign-in in the same tab.
 */
export const PLAN_DRAFT_STORAGE_KEY = "caring-contacts:plan-draft";
/**
 * sessionStorage — unsaved new CME entry draft, which contains reflections,
 * dates, allocations and notes. Cleared on account transitions so reflections
 * are never left on a shared terminal for the next clinician.
 */
export const CME_NEW_ENTRY_DRAFT_KEY = "cme-entry-draft:new";
/** localStorage — the chosen hospital on the First Nations mode home. Describes no patient. */
export const FIRST_NATIONS_HOSPITAL_STORAGE_KEY = "first-nations:hospital-v1";
/** localStorage — personal doctor credentials (Ahpra, prescriber, provider numbers) saved on-device. */
export const DOCTOR_CREDENTIALS_STORAGE_KEY = "psychsift:admin:doctor-credentials";
/** localStorage — which My Day dashboard cards the reader hid (card ids only). */
export const MY_DAY_HIDDEN_CARDS_STORAGE_KEY = "psychsift:my-day:hidden-cards-v1";
/**
 * localStorage — My Day items the reader moved to tomorrow: item id to the Perth
 * date it comes back. Ids are `<mode>:<kind>:<record id>`; no title, no patient detail.
 */
export const MY_DAY_SNOOZED_ITEMS_STORAGE_KEY = "psychsift:my-day:snoozed-v1";
/**
 * localStorage — My Day's quick note: free text the reader types, kept on this
 * device for this account only. The card says "No patient names or details
 * here"; it is cleared at sign-out, session expiry and account switch.
 */
export const MY_DAY_QUICK_NOTE_STORAGE_KEY = "psychsift:my-day:quick-note-v1";
/**
 * localStorage — the Psychiatry hub's recently opened records: path, the page's
 * own title (a diagnosis, therapy or form name), section and time.
 * Reference records only, never patient detail; kept 90 days, recorded only
 * while "Save recent searches" is on, cleared with recent searches.
 */
export const PSYCHIATRY_VISITS_STORAGE_KEY = "psychsift:psychiatry:visits-v1";

function removeQuietly(storage: () => Storage, key: string): void {
  try {
    storage().removeItem(key);
  } catch {
    // A browser that refuses storage has nothing stored to clear; nothing to tell anyone.
  }
}

/**
 * Remove every account-scoped key this module names, then dispatch one
 * `ACCOUNT_TRANSITION_EVENT` on `window`. Safe to call on the server (no-op).
 */
export function clearAccountScopedBrowserStorage(): void {
  if (typeof window === "undefined") return;
  removeQuietly(() => window.localStorage, DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY);
  removeQuietly(() => window.localStorage, DATABASE_FAVOURITES_PINNED_STORAGE_KEY);
  removeQuietly(() => window.sessionStorage, PLAN_DRAFT_STORAGE_KEY);
  removeQuietly(() => window.sessionStorage, CME_NEW_ENTRY_DRAFT_KEY);

  // Sweep any session/local keys with cme-entry-draft prefix
  for (const getStorage of [() => window.sessionStorage, () => window.localStorage]) {
    try {
      const storage = getStorage();
      const toRemove: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith("cme-entry-draft:")) {
          toRemove.push(key);
        }
      }
      for (const key of toRemove) {
        storage.removeItem(key);
      }
    } catch {
      // Storage access may be blocked or restricted; nothing to clear.
    }
  }

  removeQuietly(() => window.localStorage, FIRST_NATIONS_HOSPITAL_STORAGE_KEY);
  removeQuietly(() => window.localStorage, DOCTOR_CREDENTIALS_STORAGE_KEY);
  removeQuietly(() => window.localStorage, MY_DAY_HIDDEN_CARDS_STORAGE_KEY);
  removeQuietly(() => window.localStorage, MY_DAY_SNOOZED_ITEMS_STORAGE_KEY);
  removeQuietly(() => window.localStorage, MY_DAY_QUICK_NOTE_STORAGE_KEY);
  removeQuietly(() => window.localStorage, PSYCHIATRY_VISITS_STORAGE_KEY);
  window.dispatchEvent(new Event(ACCOUNT_TRANSITION_EVENT));
}

/**
 * Listen for the account transition. Returns the unsubscribe; a no-op returning
 * a no-op on the server, so a module may call it unconditionally at load.
 */
export function subscribeAccountTransition(listener: (event: Event) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(ACCOUNT_TRANSITION_EVENT, listener);
  return () => {
    window.removeEventListener(ACCOUNT_TRANSITION_EVENT, listener);
  };
}
