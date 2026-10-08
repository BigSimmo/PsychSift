import {
  ON_CALL_SHIFT_IMPORT_MAX,
  ON_CALL_SHIFT_LOCATION_MAX,
  ON_CALL_SHIFT_TITLE_MAX,
  ON_CALL_SHIFT_UID_MAX,
  shiftLengthIsValid,
  type OnCallShiftInput,
} from "@/lib/roster/shifts/model";
import { perthWallToIso } from "@/lib/roster/shifts/perth-time";

/**
 * Reads shifts out of a calendar (`.ics`) file, on the device.
 *
 * Deliberately small: VEVENTs with a start, an end (or duration), a summary, a
 * location and a UID. Everything else in the file is ignored, and on purpose
 * that includes DESCRIPTION, ATTENDEE and ORGANIZER, which can name colleagues.
 *
 * All-day events are skipped: a roster's shifts have times, and an all-day
 * "Annual leave" or "Public holiday" is not a shift. Cancelled events and
 * repeating events are skipped with a note, rather than guessed at.
 */

export type RosterParseResult = {
  readonly shifts: OnCallShiftInput[];
  /** Plain sentences about anything that was skipped. Empty when everything was read. */
  readonly notes: string[];
};

/** The note a parse writes when it hit the per-import shift cap, or null when it did not. */
export function shiftCapNote(result: RosterParseResult): string | null {
  return result.notes.find((note) => /more were left out\.$/.test(note)) ?? null;
}

type Property = { name: string; params: Record<string, string>; value: string };

function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

function parseProperty(line: string): Property | null {
  const colon = findUnquoted(line, ":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [rawName, ...rawParams] = splitUnquoted(head, ";");
  const params: Record<string, string> = {};
  for (const param of rawParams) {
    const eq = param.indexOf("=");
    if (eq > 0) params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (rawName ?? "").toUpperCase(), params, value };
}

function findUnquoted(text: string, char: string): number {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') quoted = !quoted;
    else if (!quoted && text[index] === char) return index;
  }
  return -1;
}

function splitUnquoted(text: string, char: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') quoted = !quoted;
    else if (!quoted && text[index] === char) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, " ")
    .replace(/\\([,;\\])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The instant a wall-clock time in `timeZone` names. Perth, a missing zone and
 * a zone this device does not know are all read as Perth, because every roster
 * this app serves is a Perth roster.
 */
function zonedWallToIso(date: string, time: string, timeZone: string | undefined): string | null {
  const perth = perthWallToIso(date, time);
  if (!perth || !timeZone || /perth/i.test(timeZone)) return perth;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-AU", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return perth;
  }
  // Start from the wall time read as UTC, then correct by the zone's offset at
  // that instant; a second pass settles the rare daylight-saving boundary.
  const wallAsUtc = Date.parse(`${date}T${time}:00Z`);
  let guess = wallAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const shown = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    guess += wallAsUtc - shown;
  }
  return new Date(guess).toISOString();
}

type DateValue = { kind: "date" } | { kind: "instant"; iso: string } | { kind: "invalid" };

function parseDateValue(property: Property): DateValue {
  const value = property.value.trim();
  if (property.params.VALUE === "DATE" || /^\d{8}$/.test(value)) return { kind: "date" };
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!match) return { kind: "invalid" };
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const time = `${match[4]}:${match[5]}`;
  if (match[7]) {
    const iso = new Date(`${date}T${time}:${match[6] ?? "00"}Z`);
    return Number.isNaN(iso.getTime()) ? { kind: "invalid" } : { kind: "instant", iso: iso.toISOString() };
  }
  const iso = zonedWallToIso(date, time, property.params.TZID);
  return iso ? { kind: "instant", iso } : { kind: "invalid" };
}

function durationMs(value: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  return ((((weeks ?? 0) * 7 + (days ?? 0)) * 24 + (hours ?? 0)) * 60 + (minutes ?? 0)) * 60000 + (seconds ?? 0) * 1000;
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max).trim() : value;
}

export function parseRosterIcs(text: string, window?: { from: string; to: string }): RosterParseResult {
  const shifts: OnCallShiftInput[] = [];
  let allDay = 0;
  let cancelled = 0;
  let repeating = 0;
  let unreadable = 0;
  let overLimit = 0;
  let current: Property[] | null = null;

  for (const line of unfold(text)) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (upper === "END:VEVENT") {
      const event = current ?? [];
      current = null;
      const get = (name: string) => event.find((property) => property.name === name);
      if (get("STATUS")?.value.trim().toUpperCase() === "CANCELLED") {
        cancelled += 1;
        continue;
      }
      if (get("RRULE")) {
        repeating += 1;
        continue;
      }
      const dtstart = get("DTSTART");
      if (!dtstart) {
        unreadable += 1;
        continue;
      }
      const start = parseDateValue(dtstart);
      if (start.kind === "date") {
        allDay += 1;
        continue;
      }
      if (start.kind === "invalid") {
        unreadable += 1;
        continue;
      }
      let endIso: string | null = null;
      const dtend = get("DTEND");
      if (dtend) {
        const end = parseDateValue(dtend);
        endIso = end.kind === "instant" ? end.iso : null;
      } else {
        const duration = get("DURATION");
        const ms = duration ? durationMs(duration.value) : null;
        endIso = ms ? new Date(Date.parse(start.iso) + ms).toISOString() : null;
      }
      const title = clip(unescapeText(get("SUMMARY")?.value ?? ""), ON_CALL_SHIFT_TITLE_MAX) || "Shift";
      if (!endIso || !shiftLengthIsValid(start.iso, endIso)) {
        unreadable += 1;
        continue;
      }
      // A long-lived feed lists years of history before this shift's real window; drop
      // out-of-window events here, before the import cap, so the cap is spent on shifts
      // that matter rather than on old history the doctor never asked to import.
      if (window && (start.iso < window.from || start.iso >= window.to)) continue;
      if (shifts.length >= ON_CALL_SHIFT_IMPORT_MAX) {
        overLimit += 1;
        continue;
      }
      const location = clip(unescapeText(get("LOCATION")?.value ?? ""), ON_CALL_SHIFT_LOCATION_MAX);
      const uid = get("UID")?.value.trim() ?? "";
      shifts.push({
        startsAt: start.iso,
        endsAt: endIso,
        title,
        location: location || null,
        sourceUid: uid ? clip(uid, ON_CALL_SHIFT_UID_MAX) : null,
      });
      continue;
    }
    if (current) {
      const property = parseProperty(line);
      if (property) current.push(property);
    }
  }

  const notes: string[] = [];
  if (allDay) notes.push(`${plural(allDay, "all-day event")} skipped, because shifts have start and end times.`);
  if (cancelled) notes.push(`${plural(cancelled, "cancelled event")} skipped.`);
  if (repeating) notes.push(`${plural(repeating, "repeating event")} skipped. Export the roster as single shifts.`);
  if (unreadable)
    notes.push(`${plural(unreadable, "event")} could not be read and ${unreadable === 1 ? "was" : "were"} skipped.`);
  if (overLimit)
    notes.push(`Only the first ${ON_CALL_SHIFT_IMPORT_MAX} shifts were read, and ${overLimit} more were left out.`);
  shifts.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { shifts, notes };
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
