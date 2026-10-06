import { z } from "zod";

import { onCallCallMarksStorageKey, onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";

/**
 * "You called 02:14": which rows this reader rang during this shift.
 *
 * At 3 am "did I already page them?" is a real question (idea 3). The answer is
 * kept on the device only, holds an entry id and a time and nothing else — no
 * digits, no name, no outcome — and expires 12 hours after the call, so it
 * never becomes a record of a person. `clearOnCallDeviceState()` wipes it at
 * sign-out with every other On Call store.
 *
 * Lane B's "Didn't connect" marks share this key's 12-hour rule; they add their
 * own reader beside this one. Now's "They answered" is one more mark here, under
 * an `answered:<ladder id>` id: a ladder id and a time, still nothing about a patient.
 */

export const ON_CALL_YOU_CALLED_HOURS = 12;
const EXPIRY_MS = ON_CALL_YOU_CALLED_HOURS * 60 * 60 * 1000;
/** A night of dialling fits comfortably; the cap only bounds a runaway list. */
const MARK_LIMIT = 40;

const youCalledSchema = z.array(z.object({ entryId: z.string().min(1), calledAt: z.string().min(1) }).strict());

export type OnCallYouCalled = z.infer<typeof youCalledSchema>[number];

function live(marks: readonly OnCallYouCalled[], now: Date): OnCallYouCalled[] {
  const cutoff = now.getTime() - EXPIRY_MS;
  return marks.filter((mark) => {
    const at = Date.parse(mark.calledAt);
    return Number.isFinite(at) && at > cutoff && at <= now.getTime() + 60_000;
  });
}

/** Whole-list rejection, as `recent-storage.ts` does: a foreign payload is no marks. */
function readStored(): OnCallYouCalled[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(onCallCallMarksStorageKey);
    if (!raw) return [];
    const parsed = youCalledSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Calls within the last 12 hours, newest first. */
export function readOnCallYouCalled(now: Date = new Date()): OnCallYouCalled[] {
  return live(readStored(), now).sort((a, b) => b.calledAt.localeCompare(a.calledAt));
}

/** The time this entry was last called within 12 hours, or null. */
export function onCallYouCalledAt(entryId: string, now: Date = new Date()): string | null {
  return readOnCallYouCalled(now).find((mark) => mark.entryId === entryId)?.calledAt ?? null;
}

/** Record a call. A repeat replaces the earlier time rather than adding a row. */
export function rememberOnCallYouCalled(entryId: string, now: Date = new Date()): void {
  if (typeof window === "undefined" || !entryId) return;
  const next = [
    { entryId, calledAt: now.toISOString() },
    ...live(readStored(), now).filter((mark) => mark.entryId !== entryId),
  ].slice(0, MARK_LIMIT);
  try {
    window.localStorage.setItem(onCallCallMarksStorageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(onCallDeviceStoreChangedEvent));
  } catch {
    // Blocked storage: the reminder is a convenience, never worth an error.
  }
}
