/**
 * The catch-all half of the account-transition clear (sign-out, expiry, account
 * switch), run by `clearAccountScopedBrowserStorage` after it removes the named
 * keys. The named list says what each key holds; this sweep makes sure a key
 * somebody forgets to name is cleared anyway, which matters most on a shared
 * ward computer where the next person sits down at the same browser.
 *
 * What it clears:
 * - Every `psychsift:` key in localStorage and sessionStorage (all work-mode
 *   areas use `psychsift:<area>:`), except the device conveniences listed in
 *   `DEVICE_PREFERENCE_KEYS`.
 * - The clinical draft builders' session drafts: the formulation draft and the
 *   per-diagnosis DSM note drafts. Both hold free text about a patient.
 * - The private document search scope (the person's own document ids).
 * - Every IndexedDB database on this origin. The app keeps none today, so this
 *   only stops a future one outliving its owner.
 * - Cache Storage that the page or a library created. The service worker's own
 *   caches (`clinical-kb-pwa-*`) are kept: by its privacy rule they hold only the
 *   public app files and the generic offline page, never a page, an API answer or
 *   anything with a query string, and deleting them would only break the offline
 *   page. The worker itself is not touched.
 * - Notifications PsychSift showed on this device (roster pushes carry `data.t`),
 *   so the next person does not see the last person's alerts in the tray.
 *
 * Device preferences (theme, the shared-device switch, install prompts) are not
 * `psychsift:`-prefixed or are on the keep list, so they stay.
 */

const PSYCHSIFT_PREFIX = "psychsift:";

/** `psychsift:` keys that describe the device, not the person, and must survive. */
const DEVICE_PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  // Work search's one-time coach mark: "remembered per device, a convenience only".
  "psychsift:work-search-coach-seen",
]);

/** Clinical drafts outside the `psychsift:` namespace that carry patient free text. */
const CLINICAL_DRAFT_KEYS: readonly string[] = ["psychsift_formulation_draft"];
const CLINICAL_DRAFT_PREFIXES: readonly string[] = ["psychsift_dsm_draft_", "clinical.private-search-scope."];

const SERVICE_WORKER_CACHE_PREFIX = "clinical-kb-pwa-";

function sweepStorage(storage: Storage): void {
  const doomed: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const workKey = key.startsWith(PSYCHSIFT_PREFIX) && !DEVICE_PREFERENCE_KEYS.has(key);
    const draftKey = CLINICAL_DRAFT_KEYS.includes(key) || CLINICAL_DRAFT_PREFIXES.some((p) => key.startsWith(p));
    if (workKey || draftKey) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
}

function sweepWebStorage(): void {
  for (const getStorage of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      sweepStorage(getStorage());
    } catch {
      // Storage blocked: nothing was stored to clear.
    }
  }
}

async function deleteIndexedDbDatabases(): Promise<void> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return;
  const databases = await indexedDB.databases();
  for (const { name } of databases) {
    if (name) indexedDB.deleteDatabase(name);
  }
}

async function deletePageCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => !name.startsWith(SERVICE_WORKER_CACHE_PREFIX)).map((name) => caches.delete(name)),
  );
}

async function closePsychSiftNotifications(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const notifications = await registration.getNotifications();
  for (const notification of notifications) {
    const data = notification.data as { t?: unknown } | null | undefined;
    if (data && data.t !== undefined && data.t !== null) notification.close();
  }
}

/**
 * Synchronous part first (web storage, so a store that re-reads straight after
 * sees honest absence), then the asynchronous parts in the background. Safe on
 * the server (no-op) and never throws.
 */
export function sweepAccountDeviceData(): void {
  if (typeof window === "undefined") return;
  sweepWebStorage();
  for (const task of [deleteIndexedDbDatabases, deletePageCaches, closePsychSiftNotifications]) {
    void task().catch(() => undefined);
  }
}
