import {
  PATIENT_LABEL_KEY_PREFIX,
  readPatientLabels,
  removePatientLabels,
  subscribePatientLabelsCleared,
  writePatientLabels,
} from "@/lib/patient-label-storage";

/**
 * The MHA clock's on-device list: which Mental Health Act forms the reader is holding right now,
 * and when each was made.
 *
 * What it holds and why: a form code ("3A"), the time the form was made and an opaque random id.
 * Never a name, bed number, initials or note. Whether a clock may carry any patient label is the
 * owner's open decision (decisions-5-oct, "MHA clock"), so this store has no field for one.
 *
 * Where it lives: through `src/lib/patient-label-storage.ts`, the one store that module's rule names
 * for a Mental Health Act timer. That gives the clocks the same retention as every other shift
 * record: cleared at the end of the shift (12 hours after the first entry when no roster end is
 * known) and at every sign-out or account switch. Nothing goes to the server, search or AI.
 *
 * The time limits themselves are not here. The page reads them from the governed timeframe data
 * through `mhaTimers` (`src/lib/on-call/mha-timers.ts`), which shows a countdown only while the
 * owner's signed switch is on.
 */

export const MHA_CLOCK_STORE_NAME = "mha-clocks";
/** A shift's worth. More than this is refused rather than silently dropping the oldest. */
export const MHA_CLOCK_LIMIT = 12;
export const mhaClocksChangeEvent = "psychsift:mha-clocks-change";

export interface MhaClock {
  /** Opaque random id. Never derived from anything about the person. */
  readonly id: string;
  /** Form code as the forms catalogue writes it, e.g. "3A". */
  readonly formCode: string;
  /** Epoch milliseconds of when the form was made. */
  readonly madeAt: number;
}

type StoredClocks = { readonly v: 1; readonly clocks: readonly MhaClock[] };

const FORM_CODE = /^[0-9]{1,2}[A-Z]?$/;
const ID = /^[a-z0-9-]{8,64}$/;

export const EMPTY_MHA_CLOCKS: readonly MhaClock[] = Object.freeze([]);

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

/** Parse the stored value, dropping anything malformed. Exported for tests. */
export function parseMhaClocks(raw: string | null): readonly MhaClock[] {
  if (!raw) return EMPTY_MHA_CLOCKS;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredClocks>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.clocks)) return EMPTY_MHA_CLOCKS;
    return parsed.clocks.filter(isClock).slice(0, MHA_CLOCK_LIMIT);
  } catch {
    return EMPTY_MHA_CLOCKS;
  }
}

// useSyncExternalStore needs the same object back while nothing changed.
let cachedRaw: string | null | undefined;
let cachedClocks: readonly MhaClock[] = EMPTY_MHA_CLOCKS;

/** The clocks on this device, oldest form first. Empty on the server. */
export function loadMhaClocks(): readonly MhaClock[] {
  if (typeof window === "undefined") return EMPTY_MHA_CLOCKS;
  const raw = readPatientLabels(MHA_CLOCK_STORE_NAME);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedClocks = [...parseMhaClocks(raw)].sort((a, b) => a.madeAt - b.madeAt);
  }
  return cachedClocks;
}

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(mhaClocksChangeEvent));
}

function save(clocks: readonly MhaClock[]): boolean {
  if (clocks.length === 0) {
    removePatientLabels(MHA_CLOCK_STORE_NAME);
    notify();
    return true;
  }
  const ok = writePatientLabels(MHA_CLOCK_STORE_NAME, JSON.stringify({ v: 1, clocks } satisfies StoredClocks));
  notify();
  return ok;
}

export type AddMhaClockResult = "added" | "full" | "invalid" | "not-saved";

/** Start a clock. The caller checks the form has a timeline; this checks only the shape. */
export function addMhaClock(formCode: string, madeAt: Date): AddMhaClockResult {
  const ms = madeAt.getTime();
  if (!FORM_CODE.test(formCode) || !Number.isFinite(ms)) return "invalid";
  const current = loadMhaClocks();
  if (current.length >= MHA_CLOCK_LIMIT) return "full";
  const clock: MhaClock = { id: window.crypto.randomUUID(), formCode, madeAt: ms };
  return save([...current, clock]) ? "added" : "not-saved";
}

export function removeMhaClock(id: string): void {
  save(loadMhaClocks().filter((clock) => clock.id !== id));
}

export function clearMhaClocks(): void {
  save(EMPTY_MHA_CLOCKS);
}

/** Changes in this tab, other tabs, and the shift-end or sign-out wipe. */
export function subscribeMhaClocks(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PATIENT_LABEL_KEY_PREFIX)) listener();
  };
  window.addEventListener(mhaClocksChangeEvent, listener);
  window.addEventListener("storage", onStorage);
  const stopCleared = subscribePatientLabelsCleared(listener);
  return () => {
    window.removeEventListener(mhaClocksChangeEvent, listener);
    window.removeEventListener("storage", onStorage);
    stopCleared();
  };
}
