import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

/**
 * What kind of shift a row is. The letter squares, the week chart, hours and
 * the calendar feed all read this one list. Kinds are facts about a shift's
 * time, never about the person, and there is no sick or carer's leave kind.
 */
export const SHIFT_KINDS = ["day", "evening", "night", "on_call", "leave", "other"] as const;
export type ShiftKind = (typeof SHIFT_KINDS)[number];

/**
 * The code shown for each kind: the design system's shift codes (the `--work-shift-*` tokens in work-mode-tokens.css,
 * the same as My Day's week strip): D day, L late (the evening shift), N night, OC on call,
 * AL leave. Only the label changes; the stored kind stays `evening`, `on_call`, `leave`.
 */
export const SHIFT_LETTER: Readonly<Record<ShiftKind, string>> = {
  day: "D",
  evening: "L",
  night: "N",
  on_call: "OC",
  leave: "AL",
  other: "W",
};

/** Text colour for a kind's letter, from the design tokens. The letter stays, so colour is never the only cue. */
export const SHIFT_LETTER_TONE: Readonly<Record<ShiftKind, string>> = {
  day: "text-[color:var(--success)]",
  evening: "text-[color:var(--warning)]",
  night: "text-[color:var(--info)]",
  on_call: "text-[color:var(--clinical-accent)]",
  leave: "text-[color:var(--text-muted)]",
  other: "text-[color:var(--text)]",
};

export const SHIFT_KIND_LABEL: Readonly<Record<ShiftKind, string>> = {
  day: "Day",
  evening: "Late",
  night: "Night",
  on_call: "On call",
  leave: "Leave",
  other: "Other work",
};

/** Kinds that count towards rostered hours and breaks. On call from home and leave do not. */
export function isWorkedKind(kind: ShiftKind): boolean {
  return kind === "day" || kind === "evening" || kind === "night" || kind === "other";
}

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/**
 * The kind a shift from a calendar file or spreadsheet most likely is, from its
 * title first and its Perth times second. A shift that starts at 18:00 or later
 * and ends the next day is a night; one that starts at noon or later is an
 * evening; anything else is a day. The doctor can change it afterwards.
 */
export function inferShiftKind(shift: { startsAt: string; endsAt: string; title: string }): ShiftKind {
  const title = shift.title.toLowerCase();
  if (/\bon[\s-]?call\b/.test(title)) return "on_call";
  if (/\b(annual leave|leave|pdl|study leave)\b/.test(title)) return "leave";
  if (/\bnights?\b/.test(title)) return "night";
  if (/\b(evening|late)\b/.test(title)) return "evening";
  const start = minutesOf(perthTimeOf(shift.startsAt));
  const crossesMidnight =
    perthDateOf(shift.startsAt) !== perthDateOf(shift.endsAt) && minutesOf(perthTimeOf(shift.endsAt)) > 0;
  if (crossesMidnight && start >= 18 * 60) return "night";
  if (start >= 12 * 60) return "evening";
  return "day";
}
