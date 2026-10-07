"use client";

import { useMemo } from "react";
import { z } from "zod";

import { createBrowserStore } from "@/lib/client-store-factory";
import {
  onCallDeviceStateChangedEvent,
  onCallDeviceStoreChangedEvent,
  onCallShiftPickStorageKey,
} from "@/lib/on-call/device-state-keys";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";
import { selectNextShift } from "@/lib/roster/shifts/next-shift";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { zonedDateOf, zonedTimeOf, zonedWallToIso } from "@/lib/work-time/format";

/**
 * Which shift "now" belongs to, for Now's shift lists and the "Your usual"
 * order (plan 2.1).
 *
 * Three sources, in order:
 *  1. the rostered shift that is on now (Roster's `on_call_shifts`), whose key
 *     is the shift's own id;
 *  2. otherwise the reader's one-tap pick of Day, Evening or Night, kept on the
 *     device for 16 hours;
 *  3. otherwise the Perth wall clock.
 *
 * The period words are labels only. Nothing here infers a duty from them.
 */

export type OnCallShiftPeriod = "day" | "evening" | "night";
export type OnCallShiftPhase = "start" | "during" | "end" | "unknown";
export type OnCallShiftContext =
  | {
      readonly kind: "roster";
      readonly shiftKey: string;
      readonly period: OnCallShiftPeriod;
      readonly phase: Exclude<OnCallShiftPhase, "unknown">;
      readonly startsAt: string;
      readonly endsAt: string;
    }
  | {
      readonly kind: "picked";
      readonly shiftKey: string;
      readonly period: OnCallShiftPeriod;
      readonly phase: "unknown";
    }
  | { readonly kind: "none"; readonly shiftKey: string; readonly period: OnCallShiftPeriod; readonly phase: "unknown" };
export type OnCallShiftPick = { readonly period: OnCallShiftPeriod; readonly at: string };

const HOUR_MS = 60 * 60 * 1000;
/** A rostered shift has "just started" for its first two hours. */
export const ON_CALL_SHIFT_START_WINDOW_MS = 2 * HOUR_MS;
/** And is ending in its last hour. */
export const ON_CALL_SHIFT_END_WINDOW_MS = HOUR_MS;
/** A pick outlives any single shift by a margin, then is forgotten. */
export const ON_CALL_SHIFT_PICK_TTL_MS = 16 * HOUR_MS;

export const ON_CALL_SHIFT_PERIOD_LABELS: Readonly<Record<OnCallShiftPeriod, string>> = {
  day: "Day",
  evening: "Evening",
  night: "Night",
};

const PERIODS = ["day", "evening", "night"] as const satisfies readonly OnCallShiftPeriod[];

/** The hour on the work time zone's wall clock (Perth unless the doctor chose another), never the phone's. */
function workHour(at: Date | string, zone: string): number {
  return Number(zonedTimeOf(at, zone).slice(0, 2));
}

/** Work-zone wall clock: 08:00–16:59 day, 17:00–21:59 evening, anything else night. */
export function onCallClockPeriod(now: Date, zone: string = currentWorkTimeZone()): OnCallShiftPeriod {
  const hour = workHour(now, zone);
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** The work-zone date a period began on: a night read before 08:00 began the day before. */
function periodStartDate(period: OnCallShiftPeriod, now: Date, zone: string): string {
  const date = zonedDateOf(now, zone);
  return period === "night" && workHour(now, zone) < 8 ? addDaysToDate(date, -1) : date;
}

/**
 * A rostered shift is named by when it starts, not by the clock now: a shift
 * starting 05:00–11:59 is a day, 12:00–19:59 an evening, anything later a night.
 */
function rosterPeriod(shift: OnCallShift, zone: string): OnCallShiftPeriod {
  const hour = workHour(shift.startsAt, zone);
  if (hour >= 5 && hour < 12) return "day";
  if (hour >= 12 && hour < 20) return "evening";
  return "night";
}

export function onCallShiftContext(input: {
  readonly shifts: readonly OnCallShift[];
  readonly pick: OnCallShiftPick | null;
  readonly now: Date;
  /** The work time zone; defaults to the saved one (Perth). */
  readonly zone?: string;
}): OnCallShiftContext {
  const { shifts, pick, now } = input;
  const zone = input.zone ?? currentWorkTimeZone();
  const at = now.getTime();
  const next = selectNextShift(shifts, now);
  if (next && Date.parse(next.startsAt) <= at) {
    const start = Date.parse(next.startsAt);
    const end = Date.parse(next.endsAt);
    const phase =
      end - at <= ON_CALL_SHIFT_END_WINDOW_MS ? "end" : at - start < ON_CALL_SHIFT_START_WINDOW_MS ? "start" : "during";
    return {
      kind: "roster",
      shiftKey: next.id,
      period: rosterPeriod(next, zone),
      phase,
      startsAt: next.startsAt,
      endsAt: next.endsAt,
    };
  }
  if (pick && isLive(pick, now)) {
    const pickedAt = new Date(pick.at);
    return {
      kind: "picked",
      shiftKey: `picked:${periodStartDate(pick.period, pickedAt, zone)}:${pick.period}`,
      period: pick.period,
      phase: "unknown",
    };
  }
  const period = onCallClockPeriod(now, zone);
  return { kind: "none", shiftKey: `clock:${periodStartDate(period, now, zone)}:${period}`, period, phase: "unknown" };
}

/** The work-zone wall-clock hours at which `onCallClockPeriod` changes. */
const CLOCK_BOUNDARY_HOURS = [8, 17, 22] as const;

/**
 * How long until `onCallShiftContext` could give a different answer: a roster
 * shift starting, leaving its first two hours, entering its last hour or
 * ending; a pick expiring; or the work zone's clock crossing 08:00, 17:00 or 22:00.
 * Now wakes itself then, so a page left open on a desk moves to the end-of-shift
 * list (and a new shift's key) without being touched.
 */
export function msUntilOnCallShiftContextChange(input: {
  readonly shifts: readonly OnCallShift[];
  readonly pick: OnCallShiftPick | null;
  readonly now: Date;
  /** The work time zone; defaults to the saved one (Perth). */
  readonly zone?: string;
}): number {
  const at = input.now.getTime();
  const zone = input.zone ?? currentWorkTimeZone();
  const candidates: number[] = [];
  for (const shift of input.shifts) {
    const start = Date.parse(shift.startsAt);
    const end = Date.parse(shift.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    candidates.push(start, start + ON_CALL_SHIFT_START_WINDOW_MS, end - ON_CALL_SHIFT_END_WINDOW_MS, end);
  }
  const pickedAt = input.pick ? Date.parse(input.pick.at) : Number.NaN;
  if (Number.isFinite(pickedAt)) candidates.push(pickedAt + ON_CALL_SHIFT_PICK_TTL_MS);
  // Read each boundary off the zone's own calendar, so a daylight-saving day in Sydney still lands on 08:00.
  const today = zonedDateOf(input.now, zone);
  for (const day of [0, 1]) {
    for (const hour of CLOCK_BOUNDARY_HOURS) {
      const boundary = zonedWallToIso(addDaysToDate(today, day), `${String(hour).padStart(2, "0")}:00`, zone);
      if (boundary) candidates.push(Date.parse(boundary));
    }
  }
  const next = Math.min(...candidates.filter((candidate) => candidate > at));
  return Math.max(1_000, next - at);
}

const pickSchema = z.object({ period: z.enum(PERIODS), at: z.string().min(1) }).strict();

function isLive(pick: OnCallShiftPick, now: Date): boolean {
  const at = Date.parse(pick.at);
  return Number.isFinite(at) && now.getTime() - at < ON_CALL_SHIFT_PICK_TTL_MS && at <= now.getTime() + 60_000;
}

function parsePick(raw: string | null): OnCallShiftPick | null {
  if (!raw) return null;
  try {
    const parsed = pickSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(onCallShiftPickStorageKey);
  } catch {
    return null;
  }
}

/** The reader's pick, or null when none is stored or it is older than 16 hours. */
export function readOnCallShiftPick(now: Date = new Date()): OnCallShiftPick | null {
  const pick = parsePick(readRaw());
  return pick && isLive(pick, now) ? pick : null;
}

function write(value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(onCallShiftPickStorageKey);
    else window.localStorage.setItem(onCallShiftPickStorageKey, value);
    window.dispatchEvent(new Event(onCallDeviceStoreChangedEvent));
  } catch {
    // Blocked storage: the pick lasts for this page only, through the clock.
  }
}

/** Stores a period word and a time, nothing else. */
export function saveOnCallShiftPick(period: OnCallShiftPeriod, now: Date = new Date()): void {
  write(JSON.stringify({ period, at: now.toISOString() } satisfies OnCallShiftPick));
}

export function clearOnCallShiftPick(): void {
  write(null);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(onCallDeviceStoreChangedEvent, onChange);
  window.addEventListener(onCallDeviceStateChangedEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(onCallDeviceStoreChangedEvent, onChange);
    window.removeEventListener(onCallDeviceStateChangedEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const usePickSnapshot = createBrowserStore(subscribe, () => readRaw() ?? "", "");

/** The stored pick as the page renders it; the TTL is applied by `onCallShiftContext`. */
export function useOnCallShiftPick(): OnCallShiftPick | null {
  const raw = usePickSnapshot();
  return useMemo(() => parsePick(raw || null), [raw]);
}
