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
 * below and, if it caches, subscribing to the event where it lives. A `psychsift:` key
 * is also caught by the sweep in `account-device-sweep.ts`, so a forgotten one still
 * goes; name it here anyway, because the name is where its contents are written down.
 */

import { sweepAccountDeviceData } from "@/lib/account-device-sweep";
import { LIVE_VERSION_COOKIE } from "@/lib/live-version/live-version";
import { WORK_MODE_PREFERENCE_COOKIE } from "@/lib/work-mode-launch/launch";

export const ACCOUNT_TRANSITION_EVENT = "clinical-kb-account-transition";

/**
 * localStorage — the work pages this person added to Favourites (My Day,
 * Roster, Admin and the rest). Device only: clinical favourites live on the
 * account, but work pages have no account table and no migration is allowed.
 */
export const WORK_PAGE_FAVOURITES_STORAGE_KEY = "psychsift:favourites:work-pages-v1";

/**
 * localStorage — Favourites kept on this device: saved phone numbers, the
 * names and notes a person gave their favourites, and their layout choices.
 */
export const FAVOURITES_LOCAL_STORAGE_KEY = "psychsift:favourites:local-v1";

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
/** localStorage — My Day's earlier alerts the reader cleared or read (alert ids and times). */
export const MY_DAY_EARLIER_ALERTS_STORAGE_KEY = "psychsift:my-day:earlier-alerts-v1";
/**
 * localStorage — Admin paperwork (wiring thread's paperwork-store.ts): the doctor's own
 * requests, documents list and pay and tax checklists. The device copy of the record kept with the
 * account in `work_admin_paperwork` (`@/lib/work-sync`).
 */
export const ADMIN_PAPERWORK_STORAGE_KEY = "psychsift:admin:paperwork-v1";
/**
 * localStorage — Roster rotation preferences while example data is on: the example
 * rounds (invented names, rotations and dates) as the reader changed them. Real
 * rounds live with the team on the server and are never kept here.
 */
export const ROSTER_ROTATIONS_EXAMPLE_STORAGE_KEY = "psychsift:roster:rotations-example-v1";
/**
 * localStorage — Remind me notes: short text and a due time, kept on this
 * device only. The sheet refuses initials, bed and record numbers and names,
 * and a shared device keeps none; cleared at every account transition.
 */
export const REMIND_ME_STORAGE_KEY = "psychsift:alerts:remind-me-v1";
/**
 * localStorage — the Psychiatry hub's recently opened records: path, the page's
 * own title (a diagnosis, therapy or form name), section and time.
 * Reference records only, never patient detail; kept 90 days, recorded only
 * while "Save recent searches" is on, cleared with recent searches.
 */
export const PSYCHIATRY_VISITS_STORAGE_KEY = "psychsift:psychiatry:visits-v1";
/**
 * localStorage — the Psychiatry MHA clock: which Mental Health Act forms the
 * reader is holding (form code, when it was made, a random id). No patient
 * label. Kept until the reader removes a clock or the account changes, because
 * a detention can outlast a shift (owner decision, 5 October 2026).
 */
export const PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY = "psychsift:psychiatry:mha-clocks-v1";
/**
 * localStorage — the Medicines hub's recently opened medicine pages: slug,
 * catalogue name and time (time used for order only, never shown). Reference
 * records only, never patient detail; recorded only while "Save recent
 * searches" is on, cleared with recent searches.
 */
export const MEDICINES_RECENT_STORAGE_KEY = "psychsift:medicines:recent-v1";
/**
 * localStorage — Teaching's term tracker: the doctor's own term dates, assessment due dates, EPA
 * counts, learning goals and "to raise" notes. Backed up to the account in `work_backups`
 * (`@/lib/work-sync`); the screen says no patient details. Cleared at sign-out, session expiry and
 * account switch.
 */
export const TEACHING_TERM_TRACKER_STORAGE_KEY = "psychsift:teaching:term-tracker-v1";
/**
 * localStorage — Teaching's exam prep: exam name and date the doctor set, study minutes by day, topic
 * progress and the next study group. Backed up to the account in `work_backups` (`@/lib/work-sync`).
 */
export const TEACHING_EXAM_PREP_STORAGE_KEY = "psychsift:teaching:exam-prep-v1";
/**
 * localStorage — CPD's "Send to AMA CPD Home": the CSV files made on this device (when, row count,
 * which activity ids) and which the doctor marked added to CPD Home. Ids only, never a title or
 * reflection. Cleared at sign-out, session expiry and account switch.
 */
export const CPD_HOME_SEND_STORAGE_KEY = "psychsift:cpd:cpd-home-v1";
/**
 * localStorage — CPD's Job applications season: dates the doctor typed from an advert, referees
 * (a colleague's name, role and status) and their own personal statement. Patient-detail checks run
 * on every field. Backed up to the account in `work_backups` (`@/lib/work-sync`), never from a device
 * marked shared; cleared at every account transition.
 */
export const CPD_APPLICATIONS_STORAGE_KEY = "psychsift:cpd:applications-v1";
/**
 * localStorage — the work-mode example data switch: the user's choice (on, off or none yet) and work-area
 * ids only, never record content. Example records themselves are never stored. Cleared at every account
 * transition with its cookie, so the next person starts on their own default.
 */
export const EXAMPLE_DATA_STORAGE_KEY = "psychsift:work:example-data-v1";
/** Cookie — mirrors the switch for server-rendered pages. A display preference, never read by any API. */
export const EXAMPLE_DATA_COOKIE = "psychsift_example_data";
/**
 * localStorage — On Call's "Your first week" pack: per hospital (`service:site` ids), which of the
 * five fixed sections the doctor marked read, and when. Section ids and times only, never a title,
 * a name or a number. Cleared at sign-out, session expiry and account switch.
 */
export const ON_CALL_FIRST_WEEK_READ_STORAGE_KEY = "psychsift:on-call:first-week-read-v1";

/**
 * localStorage — Set up Work: where the doctor got to in the walkthrough (step id, finished and
 * skipped step ids, and the work areas they said they use). Holds no setting and no free text.
 */
export const WORK_SETUP_PROGRESS_STORAGE_KEY = "psychsift:work-setup:progress-v1";
/**
 * localStorage — the work frame's chosen first tabs per area (which pages sit first in each tab row).
 * Page ids only, never records. Kept on this device only.
 */
export const WORK_TAB_PICKS_STORAGE_KEY = "psychsift:work:tab-picks-v1";
/**
 * localStorage — whether this device has matched its work choices with the account copy
 * (`src/lib/work-sync/`), and which sections hold a change the account does not have yet. Until
 * the first match a sign-in merges the two; after it the account copy wins, except for those sections.
 */
export const WORK_ACCOUNT_SYNC_MARKER_KEY = "psychsift:work:account-sync-v1";
/**
 * localStorage — Open shifts Browse: the filter choices the doctor kept (no clashes, lower levels,
 * start times). Choices only, never a site, a shift or a name. Its key uses a dot, not the
 * `psychsift:` prefix, so the sweep would miss it: it is named here.
 */
export const OPEN_SHIFTS_SAVED_FILTERS_STORAGE_KEY = "psychsift.open-shifts.filters.v1";

/**
 * The app preferences (`use-app-preferences.ts`). Display settings in it are the
 * device's and stay; only the doctor's self-chosen work stage is a person's, so
 * only those fields go at a transition.
 */
export const APP_PREFERENCES_STORAGE_KEY = "clinical-kb-preferences";
/**
 * `timeZone` is the work time zone: the next person on this browser starts on the Perth default, not this one's zone.
 * `reminders` holds quiet hours and alert choices, which belong to the person (owner decision, 8 October 2026);
 * the account copy comes back at their next sign-in.
 */
export const ACCOUNT_SCOPED_PREFERENCE_KEYS = ["workStage", "ranzcpStage", "timeZone", "reminders"] as const;

function stripAccountScopedPreferences(): void {
  try {
    const raw = window.localStorage.getItem(APP_PREFERENCES_STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Record<string, unknown> | null;
    if (!stored || typeof stored !== "object") return;
    if (!ACCOUNT_SCOPED_PREFERENCE_KEYS.some((key) => key in stored)) return;
    for (const key of ACCOUNT_SCOPED_PREFERENCE_KEYS) delete stored[key];
    window.localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage blocked or the value unreadable: the preferences store treats it as defaults anyway.
  }
}

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
  // Cookie — the live version switch (src/lib/live-version): a tester's choice of version only.
  try {
    document.cookie = `${LIVE_VERSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    // Cookie — the classic or new work view choice: the person's, so the next person starts on the default.
    document.cookie = `${WORK_MODE_PREFERENCE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // No document (a worker) or cookies blocked: nothing was set.
  }
  removeQuietly(() => window.localStorage, DATABASE_FAVOURITES_LAST_OPENED_STORAGE_KEY);
  removeQuietly(() => window.localStorage, DATABASE_FAVOURITES_PINNED_STORAGE_KEY);
  removeQuietly(() => window.localStorage, WORK_PAGE_FAVOURITES_STORAGE_KEY);
  removeQuietly(() => window.localStorage, FAVOURITES_LOCAL_STORAGE_KEY);
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
  removeQuietly(() => window.localStorage, MY_DAY_EARLIER_ALERTS_STORAGE_KEY);
  removeQuietly(() => window.localStorage, ADMIN_PAPERWORK_STORAGE_KEY);
  removeQuietly(() => window.localStorage, ROSTER_ROTATIONS_EXAMPLE_STORAGE_KEY);
  removeQuietly(() => window.localStorage, PSYCHIATRY_VISITS_STORAGE_KEY);
  removeQuietly(() => window.localStorage, PSYCHIATRY_MHA_CLOCKS_STORAGE_KEY);
  removeQuietly(() => window.localStorage, MEDICINES_RECENT_STORAGE_KEY);
  removeQuietly(() => window.localStorage, REMIND_ME_STORAGE_KEY);
  removeQuietly(() => window.localStorage, TEACHING_TERM_TRACKER_STORAGE_KEY);
  removeQuietly(() => window.localStorage, TEACHING_EXAM_PREP_STORAGE_KEY);
  removeQuietly(() => window.localStorage, CPD_HOME_SEND_STORAGE_KEY);
  removeQuietly(() => window.localStorage, CPD_APPLICATIONS_STORAGE_KEY);
  removeQuietly(() => window.localStorage, ON_CALL_FIRST_WEEK_READ_STORAGE_KEY);
  removeQuietly(() => window.localStorage, EXAMPLE_DATA_STORAGE_KEY);
  try {
    document.cookie = `${EXAMPLE_DATA_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // No document (a worker) or cookies blocked: nothing was set.
  }
  removeQuietly(() => window.localStorage, WORK_SETUP_PROGRESS_STORAGE_KEY);
  removeQuietly(() => window.localStorage, WORK_TAB_PICKS_STORAGE_KEY);
  removeQuietly(() => window.localStorage, WORK_ACCOUNT_SYNC_MARKER_KEY);
  removeQuietly(() => window.localStorage, OPEN_SHIFTS_SAVED_FILTERS_STORAGE_KEY);
  stripAccountScopedPreferences();
  // The catch-all: every other `psychsift:` key, the clinical drafts, IndexedDB,
  // page caches and PsychSift's notifications (see account-device-sweep.ts).
  sweepAccountDeviceData();
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
