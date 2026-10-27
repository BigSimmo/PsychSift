/**
 * Recovery for a page that asks for a piece of the app's code that is no longer there.
 *
 * Every merge to `main` redeploys the app, and the new build replaces the old build's code
 * files. A tab, phone or in-app browser opened before the deploy still runs the old page, so the
 * first lazily loaded piece it needs afterwards (the sign-in sheet, the Supabase library, the
 * Terms prompt) is a 404. Before this, that showed "This page didn't finish loading" in the
 * middle of signing in (owner report, 26 Oct 2026, iPhone in-app browser), and a sign-in button
 * whose library failed to load simply did nothing. A single reload fetches the current build and
 * fixes it, so the page now does that itself, once.
 *
 * The reload is rate-limited per tab through sessionStorage: a second chunk failure within the
 * window means reloading did not help (a genuinely dropped connection), and the visible
 * "Reload page" card is left to the reader rather than looping.
 */

const CHUNK_LOAD_MESSAGE =
  /Loading (?:CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export const CHUNK_RELOAD_STORAGE_KEY = "psychsift.chunkReloadAt";
/** A second failure inside this window shows the card instead of reloading again. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

/**
 * True for a failure to download part of the app's own code: a dropped connection, or a
 * deploy that replaced the file mid-session (audit F11).
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown };
  if (candidate.name === "ChunkLoadError") return true;
  return typeof candidate.message === "string" && CHUNK_LOAD_MESSAGE.test(candidate.message);
}

type ReloadEnvironment = {
  readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
  readonly now: number;
  readonly reload: () => void;
  readonly online: boolean;
};

function sessionStorageOrNull(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reloads the page once for a stale-build chunk failure. Returns true when it reloaded.
 * Without working storage it never reloads, because it could not tell a loop from a first try.
 * Offline it never reloads either: the new build cannot download, and the reload would replace
 * the open page (or a navigation the reader just started) with the offline page.
 */
export function reloadOnceForChunkLoadError(environment?: Partial<ReloadEnvironment>): boolean {
  if (typeof window === "undefined") return false;
  const storage = environment && "storage" in environment ? environment.storage : sessionStorageOrNull();
  const now = environment?.now ?? Date.now();
  const reload = environment?.reload ?? (() => window.location.reload());
  const online = environment?.online ?? window.navigator.onLine !== false;
  if (!storage || !online) return false;
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_STORAGE_KEY));
    if (Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * Catches chunk failures that never reach an error boundary: a lazy `import()` awaited inside a
 * click handler (the Supabase library behind every sign-in button) rejects into
 * `unhandledrejection`, and a failed `<script>` or stylesheet chunk fires a window `error`.
 * Returns the cleanup.
 */
export function installChunkLoadRecovery(target: Window = window): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    if (isChunkLoadError(event.reason)) reloadOnceForChunkLoadError();
  };
  const onError = (event: ErrorEvent) => {
    if (isChunkLoadError(event.error) || (typeof event.message === "string" && isChunkLoadError(event))) {
      reloadOnceForChunkLoadError();
    }
  };
  target.addEventListener("unhandledrejection", onRejection);
  target.addEventListener("error", onError);
  return () => {
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener("error", onError);
  };
}
