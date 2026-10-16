import { OPEN_SHIFTS_POST_KEYS_STORAGE_KEY } from "@/lib/account-scoped-browser-state";

/**
 * The retry key for each shift being posted, kept for this tab so it survives a reload. If a post
 * went live but its answer was lost, reloading the page and posting the same shift again sends the
 * same key, and the server answers with the shift it already saved instead of saving a second one.
 * A key is dropped once its post is confirmed, so a deliberate later post of the same shift gets a
 * new key. Keys older than a day are dropped as stale. Storage can be missing or blocked, so every
 * read and write is guarded and the page still works for this visit without it.
 */

const KEY = OPEN_SHIFTS_POST_KEYS_STORAGE_KEY;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Stored = Record<string, { key: string; at: number }>;

function read(now: number): Stored {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const kept: Stored = {};
    for (const [signature, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const { key, at } = entry as { key?: unknown; at?: unknown };
      if (typeof key === "string" && UUID.test(key) && typeof at === "number" && now - at < MAX_AGE_MS) {
        kept[signature] = { key, at };
      }
    }
    return kept;
  } catch {
    return {};
  }
}

function write(stored: Stored): void {
  try {
    if (Object.keys(stored).length === 0) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Storage is blocked or full: the key still holds for this visit.
  }
}

/** The key for this shift: the one kept from an earlier unanswered attempt, or a new one, kept now. */
export function postKeyFor(signature: string, memory: Record<string, string>, now = Date.now()): string {
  const stored = read(now);
  const key = memory[signature] ?? stored[signature]?.key ?? crypto.randomUUID();
  memory[signature] = key;
  if (stored[signature]?.key !== key) write({ ...stored, [signature]: { key, at: now } });
  return key;
}

/** The post is confirmed, so a later post of the same shift is a new one and gets a new key. */
export function forgetPostKey(signature: string, memory: Record<string, string>, now = Date.now()): void {
  delete memory[signature];
  const stored = read(now);
  if (signature in stored) {
    delete stored[signature];
    write(stored);
  }
}
