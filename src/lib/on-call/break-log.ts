import { z } from "zod";

import { onCallBreaksStorageKey, onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";

/**
 * Shift pulse's breaks: when the doctor started and ended each break this
 * shift, and nothing else.
 *
 * Times only. No reason, no place, no patient, no note. The store lives on
 * this device, drops every break 16 hours after it started (longer than any
 * rostered shift, so a break never outlives the shift it was taken in), and
 * `clearOnCallDeviceState()` wipes it at sign-out with every other On Call
 * store. The page also shows only breaks since the current shift began, when
 * the roster knows it.
 *
 * It counts breaks; it does not say how many are owed. How many breaks a shift
 * earns is an agreement rule, and that rule is not part of the signed set.
 */

export const ON_CALL_BREAK_KEEP_HOURS = 16;
const KEEP_MS = ON_CALL_BREAK_KEEP_HOURS * 60 * 60 * 1000;
/** A shift fits comfortably; the cap only bounds a runaway list. */
const BREAK_LIMIT = 12;

const breakSchema = z.object({ startedAt: z.string().min(1), endedAt: z.string().min(1).nullable() }).strict();
const storeSchema = z.object({ v: z.literal(1), breaks: z.array(breakSchema).max(BREAK_LIMIT) }).strict();

export type OnCallBreak = z.infer<typeof breakSchema>;

/** Whole-store rejection, as `call-marks.ts` does: a foreign payload is no breaks. */
export function parseOnCallBreaks(raw: string | null): OnCallBreak[] {
  if (!raw) return [];
  try {
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.breaks : [];
  } catch {
    return [];
  }
}

function live(breaks: readonly OnCallBreak[], now: Date, since?: Date | null): OnCallBreak[] {
  const cutoff = Math.max(now.getTime() - KEEP_MS, since ? since.getTime() : Number.NEGATIVE_INFINITY);
  return breaks
    .filter((entry) => {
      const at = Date.parse(entry.startedAt);
      return Number.isFinite(at) && at >= cutoff && at <= now.getTime() + 60_000;
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function readStored(): OnCallBreak[] {
  if (typeof window === "undefined") return [];
  try {
    return parseOnCallBreaks(window.localStorage.getItem(onCallBreaksStorageKey));
  } catch {
    return [];
  }
}

/** This shift's breaks, oldest first. `since` is the start of the current rostered shift, when known. */
export function onCallBreaksFrom(raw: string | null, now: Date, since?: Date | null): OnCallBreak[] {
  return live(parseOnCallBreaks(raw), now, since);
}

function write(breaks: readonly OnCallBreak[]): void {
  try {
    window.localStorage.setItem(onCallBreaksStorageKey, JSON.stringify({ v: 1, breaks: breaks.slice(-BREAK_LIMIT) }));
    window.dispatchEvent(new Event(onCallDeviceStoreChangedEvent));
  } catch {
    // Blocked storage: the break is not remembered, and nothing else depends on it.
  }
}

/** Start a break now. A break already running is left as it is. */
export function startOnCallBreak(now: Date = new Date()): void {
  if (typeof window === "undefined") return;
  const breaks = live(readStored(), now);
  if (breaks.some((entry) => entry.endedAt === null)) return;
  write([...breaks, { startedAt: now.toISOString(), endedAt: null }]);
}

/** End the running break now, if there is one. */
export function endOnCallBreak(now: Date = new Date()): void {
  if (typeof window === "undefined") return;
  const breaks = live(readStored(), now);
  if (!breaks.some((entry) => entry.endedAt === null)) return;
  write(breaks.map((entry) => (entry.endedAt === null ? { ...entry, endedAt: now.toISOString() } : entry)));
}
