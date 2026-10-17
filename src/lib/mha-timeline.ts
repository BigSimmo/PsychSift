import mhaTimeframes from "../../data/mha-timeframes.json";
import {
  AWST_TIME_ZONE,
  awstCalendarDay,
  awstCalendarDayOffset,
  awstWallTimeToInstant,
  toAwstParts,
} from "@/lib/caring-contacts/clock";

/**
 * Mental Health Act 2014 (WA) time limits for the form-page Timeline.
 *
 * THE OWNER'S RULE, and the reason this module is shaped the way it is: a statutory time
 * limit may appear only as a verbatim quote from the pinned Act text
 * (`data/mha-2014-sections.source.json`), and a computed Perth clock time may appear only for
 * an entry the owner has signed off — `status: "reviewed"`, a named reviewer, a UTC sign-off
 * time, and a `reviewedContentSha256` pin that still matches the entry. Agents write entries as
 * `drafted` and never sign them. A drafted entry renders its quote and nothing else.
 *
 * Some limits are never calculated even when signed off (`computeAllowed: false`), because the
 * Act ends the period at a second event the single "When was this made?" time cannot see — the
 * s 28 continuous-detention ceilings also end when the referral expires (s 28(11)).
 *
 * `timeframeContractProblems` is the mechanical half of the rule and is run against the whole
 * file by `tests/mha-timeframes-contract.test.ts`: every quote must be a whitespace-normalised
 * substring of its section's text, must state exactly one duration and it must be the entry's,
 * and each entry's `sourceTextSha256` must equal its pinned section's hash, so refreshing the Act
 * text forces the entry — and therefore its sign-off pin — to be touched.
 */

export type MhaTimeframeUnit = "hours" | "days";

export type MhaTimeframeStatus = "drafted" | "reviewed";

export type MhaTimeframeEntry = {
  id: string;
  /** Form codes as `data/forms-catalog.json` writes them (`form` field), e.g. "3A". */
  formCodes: string[];
  /** What the time limit is for, in plain words. */
  trigger: string;
  /** When the limit applies only in some uses of the form, the condition, shown prominently. */
  condition?: string;
  /** The Act section number, as `data/mha-2014-sections.source.json` keys it. */
  section: string;
  /** `textSha256` of that section in the pinned Act text; covered by the sign-off pin. */
  sourceTextSha256: string;
  /**
   * Verbatim Act words that come before `quote` in the same section and are shown before it with
   * an ellipsis — the stem of a list whose other limb carries a different figure.
   */
  leadIn?: string;
  /** Verbatim (whitespace-normalised) text from that section, stating the duration exactly once. */
  quote: string;
  duration: { value: number; unit: MhaTimeframeUnit };
  /** The event the period is counted from, in plain words. */
  anchor: string;
  /** Verbatim words from the same section that also end the period, shown with the quote. */
  caveat?: { section: string; quote: string };
  /** `false` keeps the entry quote-only for good, even once reviewed. Absent means `true`. */
  computeAllowed?: boolean;
  status: MhaTimeframeStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewedContentSha256: string | null;
};

export type MhaTimeframesFile = {
  exportMetadata: {
    format: "mha-timeframes";
    formatVersion: 1;
    actVersion: string;
    actAsAt: string;
  };
  entries: MhaTimeframeEntry[];
};

export type MhaTimelineQuoteOnlyReason = "awaiting-review" | "not-calculable";

/**
 * `awaitingReview` is separate from `reason` because a `computeAllowed: false` entry is
 * "not-calculable" whether or not it is signed off, and the page must still say it is awaiting
 * clinical review until it is.
 */
export type MhaTimelineItem =
  | { entry: MhaTimeframeEntry; quoteOnly: true; reason: MhaTimelineQuoteOnlyReason; awaitingReview: boolean }
  | { entry: MhaTimeframeEntry; quoteOnly: false; deadline: Date | null };

export type MhaActSourceSection = { section: string; text: string; textSha256: string };

const shippedEntries = (mhaTimeframes as MhaTimeframesFile).entries;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Collapse every run of whitespace to one space, so a quote survives line-wrapping in the source. */
export function normaliseActText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normaliseFormCode(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ---------------------------------------------------------------------------------------------
// The sign-off pin.
//
// MIRRORS `reviewedContentSha256` + the `timeframe` kind in
// scripts/lib/clinical-record-review-contract.mjs (the `npm run clinical:review` tool), which
// src/ cannot import: SHA-256, hex, over JSON.stringify of the entry with the four review fields
// (status, reviewedBy, reviewedAt, reviewedContentSha256) removed and every object's keys sorted
// recursively. Every other field is covered, including ones added later. If that tool's
// canonicalisation changes, this must change with it; tests/mha-timeframes-contract.test.ts
// pins a digest the tool itself produced.
// ---------------------------------------------------------------------------------------------

const REVIEW_METADATA_KEYS = new Set(["status", "reviewedBy", "reviewedAt", "reviewedContentSha256"]);

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalise(record[key])]),
  );
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/**
 * Synchronous SHA-256 (FIPS 180-4) of a string's UTF-8 bytes, as lowercase hex. Written here
 * because the pin must be checkable while rendering, where Web Crypto is async-only and
 * `node:crypto` is unavailable. Proven against `node:crypto` in tests/mha-timeline.test.ts.
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] += a;
    hash[1] += b;
    hash[2] += c;
    hash[3] += d;
    hash[4] += e;
    hash[5] += f;
    hash[6] += g;
    hash[7] += h;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

/** The sign-off pin for an entry, exactly as `npm run clinical:review` computes it. */
export function timeframeContentSha256(entry: MhaTimeframeEntry): string {
  const content = Object.fromEntries(Object.entries(entry).filter(([key]) => !REVIEW_METADATA_KEYS.has(key)));
  return sha256Hex(JSON.stringify(canonicalise(content)));
}

const UTC_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Mirrors the sign-off tool: a real UTC ISO instant, never date-only, never an offset. */
function isUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_ISO_TIMESTAMP.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const normalised = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  return new Date(milliseconds).toISOString() === normalised;
}

// ---------------------------------------------------------------------------------------------
// Duration figures in quotes.
// ---------------------------------------------------------------------------------------------

/** Every "<digits> <time unit>" or "<digits>-<time unit>" in a text, e.g. "72 hours", "6-hour". */
const DURATION_FIGURE = /(?<!\d)(\d+)(?:\s+|-)(minutes?|hours?|days?|weeks?|months?|years?)\b/gi;

function durationFigures(text: string): { value: number; unit: string }[] {
  return [...text.matchAll(DURATION_FIGURE)].map((match) => ({
    value: Number(match[1]),
    unit: match[2].toLowerCase().replace(/s$/, ""),
  }));
}

/** The quote states exactly one duration, and it is this entry's. */
function quoteStatesOnlyDuration(quote: string, duration: MhaTimeframeEntry["duration"]): boolean {
  const figures = durationFigures(quote);
  const unit = duration.unit === "hours" ? "hour" : "day";
  return figures.length === 1 && figures[0].value === duration.value && figures[0].unit === unit;
}

/**
 * Every way these entries break the timeline contract, as readable sentences. Empty means clean.
 *
 * Pure, so the contract test can prove an invented entry fails as well as that the shipped
 * file passes. `sourceSections` is the pinned Act text; it is passed in rather than imported
 * so the (large) source file never enters the page bundle.
 */
export function timeframeContractProblems(
  entries: readonly MhaTimeframeEntry[],
  sourceSections: readonly MhaActSourceSection[],
  knownFormCodes: readonly string[],
): string[] {
  const problems: string[] = [];
  const sources = new Map(
    sourceSections.map((entry) => [entry.section, { text: normaliseActText(entry.text), sha: entry.textSha256 }]),
  );
  const forms = new Set(knownFormCodes.map(normaliseFormCode));
  const seen = new Set<string>();

  for (const entry of entries) {
    const label = hasText(entry.id) ? entry.id : "(entry without an id)";
    if (!hasText(entry.id)) problems.push(`${label}: missing id`);
    else if (seen.has(entry.id)) problems.push(`${label}: duplicate id`);
    else seen.add(entry.id);

    if (!Array.isArray(entry.formCodes) || entry.formCodes.length === 0) {
      problems.push(`${label}: names no form codes`);
    } else {
      for (const code of entry.formCodes) {
        if (!hasText(code) || !forms.has(normaliseFormCode(code)))
          problems.push(`${label}: unknown form code "${code}"`);
      }
    }

    if (!hasText(entry.trigger)) problems.push(`${label}: missing trigger`);
    if (!hasText(entry.anchor)) problems.push(`${label}: missing anchor`);
    if (entry.condition !== undefined && !hasText(entry.condition)) problems.push(`${label}: empty condition`);
    if (entry.computeAllowed !== undefined && typeof entry.computeAllowed !== "boolean") {
      problems.push(`${label}: computeAllowed must be true or false`);
    }

    const { value, unit } = entry.duration ?? ({} as MhaTimeframeEntry["duration"]);
    // Owner ruling pending: whether a statutory "day" is 24 elapsed hours or a calendar day
    // (and whether the day of the event counts). The engine can do either; the data may not
    // use days until the owner decides.
    const unitOk = unit === "hours";
    if (unit === "days") {
      problems.push(`${label}: duration unit "days" is not accepted until the owner rules on how days are reckoned`);
    } else if (!unitOk) {
      problems.push(`${label}: duration unit must be "hours", got "${String(unit)}"`);
    }
    const valueOk = Number.isInteger(value) && value > 0;
    if (!valueOk) problems.push(`${label}: duration value must be a positive whole number, got ${String(value)}`);

    const source = sources.get(entry.section);
    if (source === undefined) {
      problems.push(`${label}: section ${entry.section} is not in the pinned Act text`);
    } else {
      if (entry.sourceTextSha256 !== source.sha) {
        problems.push(`${label}: sourceTextSha256 does not match the pinned text of section ${entry.section}`);
      }
      const quoteAt = hasText(entry.quote) ? source.text.indexOf(normaliseActText(entry.quote)) : -1;
      if (!hasText(entry.quote)) {
        problems.push(`${label}: missing quote`);
      } else {
        if (quoteAt < 0) problems.push(`${label}: quote is not a verbatim substring of section ${entry.section}`);
        if (valueOk && (unit === "hours" || unit === "days") && !quoteStatesOnlyDuration(entry.quote, entry.duration)) {
          problems.push(`${label}: quote does not state exactly one duration, "${value} ${unit}"`);
        }
      }
      if (entry.leadIn !== undefined) {
        const leadInAt = hasText(entry.leadIn) ? source.text.indexOf(normaliseActText(entry.leadIn)) : -1;
        if (leadInAt < 0) problems.push(`${label}: leadIn is not a verbatim substring of section ${entry.section}`);
        else if (quoteAt >= 0 && leadInAt >= quoteAt) problems.push(`${label}: leadIn must come before the quote`);
        if (hasText(entry.leadIn) && durationFigures(entry.leadIn).length > 0) {
          problems.push(`${label}: leadIn must not state a duration`);
        }
      }
    }

    if (entry.caveat !== undefined) {
      if (entry.caveat.section !== entry.section) {
        problems.push(`${label}: caveat must quote the entry's own section, so the same hash pins it`);
      } else if (!hasText(entry.caveat.quote) || !source?.text.includes(normaliseActText(entry.caveat.quote))) {
        problems.push(`${label}: caveat is not a verbatim substring of section ${entry.caveat.section}`);
      }
    }

    if (entry.status === "drafted") {
      if (entry.reviewedBy !== null || entry.reviewedAt !== null || entry.reviewedContentSha256 !== null) {
        problems.push(`${label}: a drafted entry must not carry reviewedBy, reviewedAt or reviewedContentSha256`);
      }
    } else if (entry.status === "reviewed") {
      if (!hasText(entry.reviewedBy)) problems.push(`${label}: a reviewed entry needs reviewedBy`);
      if (!isUtcIsoTimestamp(entry.reviewedAt)) {
        problems.push(`${label}: a reviewed entry needs reviewedAt as a UTC ISO timestamp`);
      }
      if (typeof entry.reviewedContentSha256 !== "string" || !SHA256_HEX.test(entry.reviewedContentSha256)) {
        problems.push(`${label}: a reviewed entry needs a lowercase reviewedContentSha256 pin`);
      } else if (entry.reviewedContentSha256 !== timeframeContentSha256(entry)) {
        problems.push(`${label}: content changed since sign-off (reviewedContentSha256 no longer matches)`);
      }
    } else {
      problems.push(`${label}: status must be "drafted" or "reviewed", got "${String(entry.status)}"`);
    }
  }

  return problems;
}

/**
 * Signed off by a named person at a stated UTC time, with a pin that still matches the entry.
 * Anything short of that — a blank reviewer, a date-only sign-off, an entry edited after
 * sign-off — is treated as drafted, so the page fails closed to quote-only.
 */
export function isReviewedTimeframe(entry: MhaTimeframeEntry): boolean {
  return (
    entry.status === "reviewed" &&
    hasText(entry.reviewedBy) &&
    isUtcIsoTimestamp(entry.reviewedAt) &&
    typeof entry.reviewedContentSha256 === "string" &&
    entry.reviewedContentSha256 === timeframeContentSha256(entry)
  );
}

/**
 * The instant a period ends, counted from `start`.
 *
 * Hours are elapsed time. Days are Perth calendar days: the same Perth wall-clock time that
 * many days later, stepped through the Perth calendar so month ends and 29 February fall out
 * of the calendar rather than out of a day-length assumption. The contract does not yet let
 * any entry use days (owner ruling pending), so that path is exercised only by its tests.
 */
export function computeDeadline(entry: MhaTimeframeEntry, start: Date): Date {
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) throw new Error("computeDeadline: invalid start instant");
  const { value, unit } = entry.duration;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`computeDeadline: invalid duration for ${entry.id}`);

  if (unit === "hours") return new Date(startMs + value * HOUR_MS);
  if (unit === "days") {
    const { hour, minute } = toAwstParts(start);
    const endDay = awstCalendarDayOffset(awstCalendarDay(start), value);
    // Wall time carries whole minutes; add back the seconds and milliseconds of the start.
    const subMinuteMs = ((startMs % MINUTE_MS) + MINUTE_MS) % MINUTE_MS;
    return new Date(awstWallTimeToInstant(endDay, hour, minute).getTime() + subMinuteMs);
  }
  throw new Error(`computeDeadline: unsupported unit for ${entry.id}`);
}

function durationHours(entry: MhaTimeframeEntry): number {
  return entry.duration.unit === "days" ? entry.duration.value * 24 : entry.duration.value;
}

/**
 * A form's timeline, shortest period first (file order breaks ties). An entry that is not
 * signed off, or may never be calculated (`computeAllowed: false`), comes back quote-only with a
 * reason, an `awaitingReview` flag and no `deadline` key; a calculable, signed-off one carries the computed instant, or
 * `null` until a start is known.
 */
export function timelineFor(
  formCode: string,
  start: Date | null,
  entries: readonly MhaTimeframeEntry[] = shippedEntries,
): MhaTimelineItem[] {
  const code = normaliseFormCode(formCode);
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.formCodes.some((candidate) => normaliseFormCode(candidate) === code))
    .sort((a, b) => durationHours(a.entry) - durationHours(b.entry) || a.index - b.index)
    .map(({ entry }): MhaTimelineItem => {
      const reviewed = isReviewedTimeframe(entry);
      if (entry.computeAllowed === false) {
        return { entry, quoteOnly: true, reason: "not-calculable", awaitingReview: !reviewed };
      }
      if (!reviewed) return { entry, quoteOnly: true, reason: "awaiting-review", awaitingReview: true };
      return { entry, quoteOnly: false, deadline: start ? computeDeadline(entry, start) : null };
    });
}

export function hasMhaTimeline(formCode: string): boolean {
  const code = normaliseFormCode(formCode);
  return shippedEntries.some((entry) => entry.formCodes.some((candidate) => normaliseFormCode(candidate) === code));
}

/**
 * A `datetime-local` value ("2026-09-25T14:30") read as Perth wall time, whatever time zone
 * the browser is in. Returns null for anything that is not a real calendar date and time.
 */
export function parsePerthDateTimeInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  const calendarDay = `${match[1]}-${match[2]}-${match[3]}`;
  return awstWallTimeToInstant(calendarDay, hour, minute);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-AU", { timeZone: AWST_TIME_ZONE, weekday: "short" });

/** "Fri 25 Sep 2026, 14:30 (Perth time)". */
export function formatPerthDateTime(instant: Date): string {
  const { year, month, day, hour, minute } = toAwstParts(instant);
  const weekday = WEEKDAY_FORMAT.format(instant);
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}, ${time} (Perth time)`;
}
