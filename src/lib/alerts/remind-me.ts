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
]);

const BED = /\b(?:bed|bay|room|rm|cubicle|cube)\s*#?\s*\d+[a-z]?\b/gi;
const RECORD_NUMBER = /\b(?:urn|mrn|umrn|ur)\s*[:#-]?\s*\w+|\b\d{5,}\b/gi;
const TITLE_NAME = /\b(?:[Mm]rs?|[Mm]s|[Mm]iss|[Mm]x|[Mm]aster)\.?\s+[A-Z][a-z'-]+/g;
const INITIALS = /\b[A-Z]{2,3}\b/g;

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
    [BED, "a bed number"],
    [RECORD_NUMBER, "a record number"],
  ];
  let safer = text;
  for (const [pattern, label] of checks) {
    // A fresh copy each time: a shared /g pattern keeps its position between calls.
    const fresh = new RegExp(pattern.source, pattern.flags);
    if (fresh.test(text)) found.push(label);
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
  const tomorrow = perthAt(at, 8, 1);
  options.push({ id: "tomorrow", label: "Tomorrow 08:00", dueAt: new Date(tomorrow).toISOString() });
  return options;
}

/** Stored values become a valid list: unknown shapes dropped, done ones kept a day, newest last, capped. */
export function normalizeReminders(input: unknown, now: Date): Reminder[] {
  if (!Array.isArray(input)) return [];
  const dayAgo = now.getTime() - 24 * HOUR_MS;
  return (
    input
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
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
      .slice(-REMIND_ME_MAX)
  );
}

/** Due now or earlier and not yet ticked off. */
export function dueReminders(list: readonly Reminder[], now: Date): Reminder[] {
  return list.filter((item) => item.doneAt === null && Date.parse(item.dueAt) <= now.getTime());
}

export { perthClock as remindMeClock };
