/**
 * Remind me: a short note to self with a time, kept on this device only.
 *
 * The words never leave the device, so they must never describe a patient.
 * `checkReminderText` refuses the shapes a hurried note most often takes when
 * it does (initials, a bed or room, a record number, a title and surname) and
 * offers the same note with those parts taken out. It is a guard against the
 * common slip, not a guarantee, which is why the sheet also says it in words.
 */

export const REMIND_ME_TEXT_LIMIT = 120;
export const REMIND_ME_MAX = 20;

export type Reminder = {
  readonly id: string;
  readonly text: string;
  /** ISO instant it is due. */
  readonly dueAt: string;
  readonly createdAt: string;
  /** ISO instant it was ticked off, or null. */
  readonly doneAt: string | null;
};

export type ReminderTextProblem = {
  readonly title: string;
  readonly body: string;
  /** The same note without the flagged parts, or null when nothing sensible is left. */
  readonly suggestion: string | null;
};

/**
 * Two- and three-letter capitals that are clinical or service words, not
 * initials. Anything else in capitals is treated as possible initials.
 */
const NOT_INITIALS = new Set([
  "AM",
  "PM",
  "ED",
  "ICU",
  "HDU",
  "GP",
  "MHA",
  "CPD",
  "ECT",
  "ECG",
  "EEG",
  "FBC",
  "LFT",
  "LFTS",
  "UEC",
  "UECS",
  "TFT",
  "TFTS",
  "CRP",
  "BSL",
  "BGL",
  "INR",
  "OT",
  "SW",
  "MO",
  "RMO",
  "HMO",
  "JMO",
  "AMA",
  "NOK",
  "CL",
  "IT",
  "HR",
  "MDT",
  "CT",
  "MRI",
  "IV",
  "IM",
  "PO",
  "PRN",
  "BD",
  "TDS",
  "QID",
  "OD",
  "NBM",
  "DNR",
  "NFR",
  "AMO",
  "MSE",
  "CTO",
  "PD",
  "CNS",
  "CNC",
  "NUM",
  "ADON",
  "DON",
  "WA",
  "UK",
  "US",
  "OK",
  "CEO",
  "HSP",
  "ID",
  "CPR",
  "URN",
  "MRN",
  "UR",
  "BLS",
  "ALS",
  "PPE",
  "COVID",
  "RAT",
  "PCR",
  "OSCE",
  "AHPRA",
  "RANZCP",
  "ACEM",
  "PMCWA",
  "AMC",
  "EMR",
  "BP",
  "BMI",
  "LAI",
  "CBT",
  "DBT",
  "MDD",
  "BPD",
  "OCD",
  "GAD",
  "ASD",
  "TMS",
  "AOD",
  "MH",
  "OPD",
  "EPSE",
  "NMS",
  "UDS",
  "PHQ",
  "TBC",
  "FYI",
  "MS",
  "ADHD",
  "PTSD",
  "SMS",
  // Ordinary words typed in capitals.
  "ON",
  "TO",
  "RE",
  "NO",
  "DO",
  "IN",
  "AT",
  "OF",
  "OR",
  "AN",
  "AS",
  "BY",
  "IS",
  "UP",
  "WE",
  "ME",
  "MY",
  "BE",
  "GO",
  "SO",
  "IF",
  "THE",
  "AND",
  "FOR",
  "NOT",
  "ALL",
  "ASAP",
  "CALL",
  "NEW",
  "OFF",
  "OUT",
  "DUE",
]);

const BED = /\b(?:bed|bay|room|rm|cubicle|cube)\s*#?\s*\d+[a-z]?\b/gi;
const RECORD_NUMBER = /\b(?:urn|mrn|umrn|ur)\b\s*[:#-]?\s*\w+|\b\d{5,}\b/gi;
// A title then a surname, in any case ("Mrs Smith", "mr. o'brien"); "MS Teams" is the software.
const TITLE_NAME =
  /\b(?:[Mm]rs?|[Mm]s|[Mm]x)\b\.?\s+(?![Tt]eams\b)\p{L}[\p{L}'-]+|\b(?:Miss|Master)\s+\p{Lu}[\p{L}'-]+/gu;
// One initial then a surname ("J Smith", "J. Smith"); A and I are left alone as ordinary words.
const INITIAL_SURNAME = /\b[B-HJ-Z]\.?\s\p{Lu}\p{Ll}[\p{L}'-]+/gu;
const DOTTED_INITIALS = /\b[A-Z]\.\s?[A-Z]\.?(?:\s?[A-Z]\.?)?(?=\W|$)/g;
// "45yo", "45 y/o F", "34M", "45 yrs F"; a bare "2 yrs" is a length of time, not an age.
const AGE_SEX = /\b\d{1,3}\s?(?:yo|y\/o)\b(?:\s?[MFmf]\b)?|\b\d{1,3}\s?yrs?\s?[MFmf]\b|\b\d{1,3}[MF]\b/g;
const INITIALS = /\b[A-Z]{2,3}\b/g;
// A full date with a year ("01/02/1980", "1-2-80", "1 Feb 1980"), usually a date of birth. "2/7" (two days) has no year and passes.
const FULL_DATE =
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s\d{4}\b|\bD\.?O\.?B\b\.?/gi;
// An Australian phone number: "0412 345 678", "(08) 9224 1234", "08 9224 1234".
const PHONE = /(?:\(0\d\)|\b0\d)(?:[\s-]?\d){8}\b/g;

function initialsIn(text: string): string[] {
  return [...new Set(text.match(new RegExp(INITIALS.source, INITIALS.flags)) ?? [])].filter(
    (word) => !NOT_INITIALS.has(word),
  );
}

function tidy(text: string): string {
  return text
    .replace(/\bre\b/gi, "about")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\babout\s+about\b/gi, "about")
    .trim();
}

/** Null when the note reads as safe; otherwise what looks wrong, in words, and a safer wording. */
export function checkReminderText(text: string): ReminderTextProblem | null {
  const found: string[] = [];
  const initials = initialsIn(text);
  if (initials.length) found.push("initials");
  const checks: [RegExp, string][] = [
    [TITLE_NAME, "a name"],
    [INITIAL_SURNAME, "a name"],
    [DOTTED_INITIALS, "initials"],
    [AGE_SEX, "an age"],
    [FULL_DATE, "a date of birth"],
    [PHONE, "a phone number"],
    [BED, "a bed number"],
    [RECORD_NUMBER, "a record number"],
  ];
  let safer = text;
  for (const [pattern, label] of checks) {
    // A fresh copy each time: a shared /g pattern keeps its position between calls.
    const fresh = new RegExp(pattern.source, pattern.flags);
    if (fresh.test(text) && !found.includes(label)) found.push(label);
    safer = safer.replace(new RegExp(pattern.source, pattern.flags), " ");
  }
  for (const word of initials) safer = safer.replace(new RegExp(`\\b${word}\\b`, "g"), " ");
  if (!found.length) return null;
  const what = found.length === 1 ? found[0]! : `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
  const suggestion = tidy(safer);
  return {
    title: `This looks like ${what}`,
    body: "Reminders can't hold patient details.",
    suggestion: suggestion.split(" ").length >= 2 ? suggestion : null,
  };
}

export type WhenOption = { readonly id: string; readonly label: string; readonly dueAt: string };

const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function perthClock(instant: number): string {
  const date = new Date(instant + PERTH_OFFSET_MS);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

/** The UTC instant of a Perth wall-clock time on the Perth day `instant` falls in, plus `addDays`. */
function perthAt(instant: number, hours: number, addDays = 0): number {
  const perth = new Date(instant + PERTH_OFFSET_MS);
  return (
    Date.UTC(perth.getUTCFullYear(), perth.getUTCMonth(), perth.getUTCDate() + addDays, hours, 0) - PERTH_OFFSET_MS
  );
}

/**
 * The quick choices: in an hour; the next of 12:00 or 17:00 at least 90
 * minutes away; the end of today's rostered shift, when one is still to come;
 * and tomorrow at 08:00. Perth time throughout.
 */
export function remindMeWhenOptions(now: Date, shiftEndsAt: string | null): WhenOption[] {
  const at = now.getTime();
  const options: WhenOption[] = [{ id: "hour", label: "In 1 hour", dueAt: new Date(at + HOUR_MS).toISOString() }];
  const later = [12, 17].map((hour) => perthAt(at, hour)).find((instant) => instant - at >= 1.5 * HOUR_MS);
  if (later !== undefined)
    options.push({ id: "later", label: perthClock(later), dueAt: new Date(later).toISOString() });
  const end = shiftEndsAt ? Date.parse(shiftEndsAt) : Number.NaN;
  if (Number.isFinite(end) && end - at > 15 * 60 * 1000 && end - at < 16 * HOUR_MS)
    options.push({ id: "shift-end", label: `End of shift, ${perthClock(end)}`, dueAt: new Date(end).toISOString() });
  // Before 08:00 (a night shift) "08:00" means this morning, not the day after.
  const morning = perthAt(at, 8);
  if (morning - at >= 1.5 * HOUR_MS)
    options.push({ id: "morning", label: "08:00", dueAt: new Date(morning).toISOString() });
  else options.push({ id: "tomorrow", label: "Tomorrow 08:00", dueAt: new Date(perthAt(at, 8, 1)).toISOString() });
  return options;
}

/** Stored values become a valid list: unknown shapes dropped, done ones kept a day, newest last, capped. */
export function normalizeReminders(input: unknown, now: Date): Reminder[] {
  if (!Array.isArray(input)) return [];
  const dayAgo = now.getTime() - 24 * HOUR_MS;
  const list = input
    .filter(
      (item): item is Reminder =>
        typeof item === "object" &&
        item !== null &&
        typeof item.id === "string" &&
        typeof item.text === "string" &&
        item.text.length <= REMIND_ME_TEXT_LIMIT &&
        Number.isFinite(Date.parse(item.dueAt)) &&
        typeof item.createdAt === "string" &&
        (item.doneAt === null || Number.isFinite(Date.parse(item.doneAt))),
    )
    .filter((item) => item.doneAt === null || Date.parse(item.doneAt) > dayAgo)
    // A note saved before this check existed is re-checked on every read, never shown if it fails.
    .filter((item) => checkReminderText(item.text) === null)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  return capReminders(list);
}

/** Over the cap, ticked-off notes go first, then the oldest written; never a note still to do ahead of them. */
function capReminders(list: Reminder[]): Reminder[] {
  if (list.length <= REMIND_ME_MAX) return list;
  const drop = new Set(
    [...list]
      .sort((a, b) => Number(a.doneAt === null) - Number(b.doneAt === null) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, list.length - REMIND_ME_MAX)
      .map((item) => item.id),
  );
  return list.filter((item) => !drop.has(item.id));
}

/** True when this device already holds the most notes still to do, so a new one can't be kept. */
export function remindersFull(list: readonly Reminder[]): boolean {
  return list.filter((item) => item.doneAt === null).length >= REMIND_ME_MAX;
}

/** Due now or earlier and not yet ticked off. */
export function dueReminders(list: readonly Reminder[], now: Date): Reminder[] {
  return list.filter((item) => item.doneAt === null && Date.parse(item.dueAt) <= now.getTime());
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function perthDayIndex(instant: number): number {
  return Math.floor((instant + PERTH_OFFSET_MS) / (24 * HOUR_MS));
}

/** "Due 12:00", "Today 12:00", "Tomorrow 08:00" or "Wed 08:00", Perth time. */
export function reminderWhenLabel(reminder: Reminder, now: Date): string {
  if (reminder.doneAt) return "Done";
  const due = Date.parse(reminder.dueAt);
  const clock = perthClock(due);
  const days = perthDayIndex(due) - perthDayIndex(now.getTime());
  if (due <= now.getTime()) {
    if (days === 0) return `Due ${clock}`;
    if (days === -1) return `Due yesterday ${clock}`;
    return `Due ${DAYS[new Date(due + PERTH_OFFSET_MS).getUTCDay()]} ${clock}`;
  }
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Tomorrow ${clock}`;
  return `${DAYS[new Date(due + PERTH_OFFSET_MS).getUTCDay()]} ${clock}`;
}

export { perthClock as remindMeClock };

/** My Day reads `?sheet=reminders` on arrival and opens Your reminders, so a reminder tapped elsewhere lands on its list. */
export const MY_DAY_REMINDERS_HREF = "/my-day?sheet=reminders";
