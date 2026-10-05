import { z } from "zod";

import { onCallCallCountsStorageKey, onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";

/**
 * Shift pulse's calls by hour: how many calls were noted in each hour, kept
 * for a week so tonight can be set against the last few nights.
 *
 * Counts only. The call log itself is patient-label data, wiped at the end of
 * every shift; this store is fed one number at a time as a call is noted and
 * never holds a bed, a caller, a note or a time finer than the hour. It lives
 * on this device and is wiped at sign-out with the other On Call stores.
 */

const KEEP_DAYS = 7;
const HOUR_MS = 3_600_000;
/** After hours runs 17:00 to 08:00: the hours the pulse draws, in order. */
export const ON_CALL_PULSE_HOURS: readonly number[] = [17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7];
export const ON_CALL_PULSE_NIGHTS = 5;

const storeSchema = z.object({ v: z.literal(1), hours: z.record(z.string(), z.number().int().min(0).max(999)) });

type Store = z.infer<typeof storeSchema>;

const perthParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Perth",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** "2026-10-05T21": the Perth date and hour a moment falls in. */
export function onCallPerthHourKey(at: Date): string {
  const parts = perthParts.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}`;
}

export function parseOnCallCallCounts(raw: string | null): Store {
  if (!raw) return { v: 1, hours: {} };
  try {
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { v: 1, hours: {} };
  } catch {
    return { v: 1, hours: {} };
  }
}

function prune(store: Store, now: Date): Store {
  const oldest = onCallPerthHourKey(new Date(now.getTime() - KEEP_DAYS * 24 * HOUR_MS));
  const hours: Record<string, number> = {};
  for (const [key, count] of Object.entries(store.hours)) if (key >= oldest && count > 0) hours[key] = count;
  return { v: 1, hours };
}

/** Add one call to the hour it was noted in. Best effort: a failure here never stops the note itself. */
export function recordOnCallCallCount(at: Date = new Date()): void {
  if (typeof window === "undefined") return;
  try {
    const store = prune(parseOnCallCallCounts(window.localStorage.getItem(onCallCallCountsStorageKey)), at);
    const key = onCallPerthHourKey(at);
    store.hours[key] = Math.min(999, (store.hours[key] ?? 0) + 1);
    window.localStorage.setItem(onCallCallCountsStorageKey, JSON.stringify(store));
    window.dispatchEvent(new Event(onCallDeviceStoreChangedEvent));
  } catch {
    // Storage full or blocked: the pulse simply shows fewer calls.
  }
}

export type OnCallPulseNight = {
  /** "Tonight", or the weekday the night began on, "Sat". */
  readonly label: string;
  /** One count per hour in `ON_CALL_PULSE_HOURS` order. */
  readonly counts: readonly number[];
};

function perthDate(at: Date): string {
  return onCallPerthHourKey(at).slice(0, 10);
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * The last few after-hours nights, newest first. A night is named for the
 * evening it starts on, so 02:00 on Tuesday belongs to Monday night. Before
 * 08:00 "tonight" is the night that began yesterday evening.
 */
export function onCallPulseNights(raw: string | null, now: Date = new Date()): OnCallPulseNight[] {
  const store = parseOnCallCallCounts(raw);
  const key = onCallPerthHourKey(now);
  const hour = Number(key.slice(11, 13));
  const tonight = hour < 8 ? addDays(perthDate(now), -1) : perthDate(now);
  const weekday = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "UTC" });
  const nights: OnCallPulseNight[] = [];
  for (let back = 0; back < ON_CALL_PULSE_NIGHTS; back += 1) {
    const evening = addDays(tonight, -back);
    const morning = addDays(evening, 1);
    const counts = ON_CALL_PULSE_HOURS.map((h) => {
      const date = h >= 17 ? evening : morning;
      return store.hours[`${date}T${String(h).padStart(2, "0")}`] ?? 0;
    });
    nights.push({
      label: back === 0 ? "Tonight" : weekday.format(new Date(`${evening}T12:00:00.000Z`)),
      counts,
    });
  }
  return nights;
}

/**
 * The two-hour window with the most calls across the nights shown, as
 * "21:00 to 23:00", or null when there are too few calls to say.
 */
export function onCallPulsePeak(nights: readonly OnCallPulseNight[]): string | null {
  const totals = ON_CALL_PULSE_HOURS.map((_, i) => nights.reduce((sum, night) => sum + (night.counts[i] ?? 0), 0));
  if (totals.reduce((sum, n) => sum + n, 0) < 3) return null;
  let best = 0;
  for (let i = 1; i < totals.length - 1; i += 1) {
    if (totals[i]! + totals[i + 1]! > totals[best]! + totals[best + 1]!) best = i;
  }
  const start = ON_CALL_PULSE_HOURS[best]!;
  const end = (start + 2) % 24;
  const words = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${words(start)} to ${words(end)}`;
}
