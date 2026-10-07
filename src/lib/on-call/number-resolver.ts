import { onCallZonedHourStart } from "@/lib/on-call/local-date";
import { isWaPublicHoliday } from "@/lib/on-call/wa-public-holidays";
import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { zonedDateOf, zonedTimeOf } from "@/lib/work-time/format";

/**
 * One number rule for On Call: which half of the day it is, which number a row
 * offers, how a handbook number is dialled, and how every number is written.
 *
 * Before this module the rule lived in three places that disagreed (plan
 * correction C5): the home's weekday-hours test ignored WA public holidays
 * while "Who do I call now?" counted them, the re-render timer ignored them and
 * stopped short of the Christmas run, and the handbook labelled any number it
 * could not dial "Extension", free text included. The weekday primitive and the
 * dial helpers moved here from `home-modules.ts`, which re-exports them, so the
 * import graph stays one-way (`home-modules` → this file).
 */

/**
 * The working day, in the ordinary hospital sense: 08:00 to 17:00, Monday to
 * Friday. Outside it the direct desk line is the number nobody answers.
 *
 * Two separate constants rather than a range object because the boundary is the
 * whole rule: 08:00 is the first in-hours minute and 17:00 the first out-of-hours
 * one, and both are pinned by test.
 */
export const ON_CALL_IN_HOURS_START_HOUR = 8;
export const ON_CALL_IN_HOURS_END_HOUR = 17;

export type OnCallPeriod = "in-hours" | "after-hours";

/**
 * Is this hub being read out of hours?
 *
 * Exported so every screen can agree on one definition instead of each inventing
 * its own — a home that offers the after-hours number while Contacts offers the
 * direct one is exactly the "two different numbers for one role" problem the
 * precedence comment on `resolveOnCallNumber` exists to prevent.
 *
 * Read in the **work time zone** (Perth unless the doctor chose another), for
 * the same reason `onCallLocalDateKey` is: the question is what time it is on
 * the hospital's wall clock. Not UTC, which would hand a Perth registrar the
 * daytime number at 1am (UTC+8 puts local midnight at 16:00 UTC, squarely inside
 * a UTC working day), and not the phone's own zone, which after a trip east
 * would call 06:00 Perth "in hours" because the phone says 08:00.
 *
 * Deliberately approximate: it knows nothing of public holidays or a particular
 * department's roster. It is the weekday primitive; `onCallPeriod` adds the WA
 * public holidays and is the rule screens should use.
 */
export function isOnCallOutOfHours(now: Date = new Date(), zone: string = currentWorkTimeZone()): boolean {
  // 0 = Sunday … 6 = Saturday, for the calendar date in the work zone.
  const day = new Date(`${zonedDateOf(now, zone)}T00:00:00.000Z`).getUTCDay();
  if (day === 0 || day === 6) return true;
  const hour = Number(zonedTimeOf(now, zone).slice(0, 2));
  return hour < ON_CALL_IN_HOURS_START_HOUR || hour >= ON_CALL_IN_HOURS_END_HOUR;
}

/**
 * THE in-hours rule: a weekday between 08:00 and 17:00 that is not a WA public
 * holiday. The home, Contacts, the search box, "Who do I call now?" and the
 * rebuilt hub pages all read this, so no two screens can offer different
 * numbers for one role at the same moment.
 */
export function onCallPeriod(now: Date = new Date(), zone: string = currentWorkTimeZone()): OnCallPeriod {
  return isOnCallOutOfHours(now, zone) || isWaPublicHoliday(now, zone) ? "after-hours" : "in-hours";
}

/**
 * How long until `onCallPeriod` would give a different answer.
 *
 * A screen that picked its number at render keeps that number until something
 * re-renders it, and a phone lying on a desk re-renders nothing, so callers
 * schedule one timer on this and re-read the clock when it fires.
 *
 * Walks forward in whole hours rather than doing calendar arithmetic, because
 * the answer must agree with `onCallPeriod` exactly, and the cheapest way to
 * guarantee that is to ask it. Always strictly positive, so a timer built on it
 * can never spin; standing exactly on 17:00 returns the time to the NEXT flip.
 */
export function msUntilOnCallPeriodChange(now: Date = new Date(), zone: string = currentWorkTimeZone()): number {
  const current = onCallPeriod(now, zone);
  const probe = new Date(onCallZonedHourStart(now, zone));
  // Eight days bounds the longest real run (Christmas to the substitute Monday) with room to spare.
  for (let step = 0; step < 24 * 8; step += 1) {
    probe.setTime(probe.getTime() + 60 * 60 * 1000);
    if (onCallPeriod(probe, zone) !== current) return probe.getTime() - now.getTime();
  }
  // Unreachable while the rule keeps a weekday working day, but a caller must
  // still get a usable delay rather than a zero that would spin a timer.
  return 60 * 60 * 1000;
}

export type OnCallNumberLabel = "Direct" | "After hours" | "Pager" | "Ext";
export type OnCallNumberFields = {
  readonly phone?: string;
  readonly afterHoursPhone?: string;
  readonly pager?: string;
  readonly extension?: string;
};
export type ResolvedOnCallNumber = {
  readonly label: OnCallNumberLabel;
  readonly value: string;
  readonly tel: string | null;
};

/**
 * The one number a reader's own contact row rings, and what to call it.
 *
 *   in hours      direct → after hours → pager → extension
 *   after hours   after hours → direct → pager → extension
 *
 * Offering the daytime direct line at 3am — a desk nobody is sitting at — is
 * offering the one number that cannot help. Pager and extension stay below both
 * and are never handed to the dialler. The label always names the number
 * actually returned, so no screen shows a number under the wrong name.
 *
 * The reader's own entries keep `onCallTelHref` unchanged (plan ruling
 * "Personal numbers"); the 08 rule and the formatter apply to handbook numbers.
 */
export function resolveOnCallNumber(fields: OnCallNumberFields, now: Date = new Date()): ResolvedOnCallNumber | null {
  const direct = fields.phone ? { label: "Direct" as const, value: fields.phone } : null;
  const after = fields.afterHoursPhone ? { label: "After hours" as const, value: fields.afterHoursPhone } : null;
  const preferred = onCallPeriod(now) === "after-hours" ? (after ?? direct) : (direct ?? after);
  if (preferred) return { ...preferred, tel: onCallTelHref(preferred.value) ?? null };
  if (fields.pager) return { label: "Pager", value: fields.pager, tel: null };
  if (fields.extension) return { label: "Ext", value: fields.extension, tel: null };
  return null;
}

/**
 * A number stripped to what a dialler — or a medical record, or a paging system
 * — will accept: digits, plus a leading `+`, which is part of an international
 * number rather than presentation.
 *
 * Exported because two things need exactly this string and must not disagree
 * about it: the `tel:` link below, and the copy control that puts the number on
 * the clipboard for pasting somewhere the app cannot reach. Returns `undefined`
 * when there is nothing to dial ("via switchboard").
 */
export function onCallDialableNumber(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  if (!/^[+\d\s().-]+$/.test(raw)) return undefined;
  const compact = raw.replace(/[\s().-]/g, "");
  return /^\+?\d+$/.test(compact) ? compact : undefined;
}

/**
 * The invented numbers the sample content uses: a run starting "0000", which is
 * not a valid Australian number. They are shown as text and never offered to a
 * dialler, so a sample row can never ring a real phone.
 */
function isPlaceholderNumber(compact: string): boolean {
  return compact.startsWith("0000");
}

/** True for an invented sample number, which must be shown as text and never linked to a dialler. */
export function isOnCallPlaceholderNumber(raw: string | undefined | null): boolean {
  const compact = onCallDialableNumber(raw);
  return Boolean(compact && isPlaceholderNumber(compact));
}

/** `tel:` target for a number, or undefined when there is nothing dialable. */
export function onCallTelHref(raw: string | undefined | null): string | undefined {
  const compact = onCallDialableNumber(raw);
  if (compact && isPlaceholderNumber(compact)) return undefined;
  // Short extensions and pager IDs must not be handed to an external dialler.
  return compact && /^(?:\+\d{8,15}|\d{8,15}|13\d{4}|000|112|106)$/.test(compact) ? `tel:${compact}` : undefined;
}

/** Which list a handbook number is written for (standard §2). */
export type OnCallNumberScope = "hospital" | "outside";

/** The national numbers any phone reaches, however short. */
const NATIONAL_SHORT = /^(?:000|112|106|13\d{4})$/;

/**
 * A handbook number in national form: digits only, with an international
 * `+61` rewritten to its leading `0`. `undefined` for anything that is not
 * purely a number.
 */
function nationalDigits(raw: string): string | undefined {
  const compact = onCallDialableNumber(raw.trim());
  if (!compact) return undefined;
  if (compact.startsWith("+61") && compact.length === 12) return `0${compact.slice(3)}`;
  return compact.startsWith("+") ? undefined : compact;
}

/** An 8-digit local number is a WA landline: WA's area code is the one this app serves. */
function isWaLocal(digits: string): boolean {
  return /^[2-9]\d{7}$/.test(digits);
}

/**
 * Every handbook number in the standard's one grouping, whatever the editor
 * typed ("90000003", "9000-0003", "(08)90000003"):
 *
 *   WA landline   `9000 0003` in the hospital's own list, `(08) 9000 0003` outside it
 *   other state   `(02) 9000 0003`
 *   mobile        `0400 000 002`
 *   national      `1800 000 012`, `1300 000 012`, `13 00 12`
 *   internal      `ext 4455`; a 2–3 digit hospital code such as `55` stays bare
 *
 * Anything that is not purely a number (free text, "ext" wording, a comma) is
 * returned as typed, trimmed: the app never rewrites words it cannot parse.
 */
export function formatOnCallNumber(raw: string, scope: OnCallNumberScope): string {
  const value = raw.trim();
  const digits = nationalDigits(value);
  if (!digits) return value;
  if (NATIONAL_SHORT.test(digits)) {
    return digits.length === 6 ? `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}` : digits;
  }
  const local = isWaLocal(digits) ? digits : /^08[2-9]\d{7}$/.test(digits) ? digits.slice(2) : null;
  if (local) {
    const short = `${local.slice(0, 4)} ${local.slice(4)}`;
    return scope === "hospital" ? short : `(08) ${short}`;
  }
  if (/^0[45]\d{8}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (/^1[38]00\d{6}$/.test(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (/^0[237]\d{8}$/.test(digits)) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)} ${digits.slice(6)}`;
  if (digits.length < 8) return digits.length <= 3 ? digits : `ext ${digits}`;
  return value;
}

/**
 * The `tel:` target for a handbook number. An 8-digit WA landline always
 * carries 08 (review F19), because some mobile networks need the area code;
 * anything shorter than 8 digits, other than 000, 112, 106 and 13xxxx, is for a
 * hospital phone and gets none.
 */
function handbookTel(raw: string): string | null {
  const digits = nationalDigits(raw);
  if (!digits || isPlaceholderNumber(digits)) return null;
  if (isWaLocal(digits)) return `tel:08${digits}`;
  return onCallTelHref(raw.trim()) ?? null;
}

/**
 * Where a handbook number can be rung from. `hospital-phone` numbers show
 * "From a hospital phone" and never get a call disc (review F1, idea 2).
 */
export type OnCallDialRoute = "any-phone" | "hospital-phone";

export type HandbookDial =
  | {
      readonly kind: "direct";
      readonly display: string;
      readonly tel: string;
      readonly copy: string;
      readonly route: "any-phone";
    }
  | {
      readonly kind: "switchboard-extension";
      readonly display: string;
      readonly switchboard: string;
      readonly extension: string;
      readonly tel: string;
      /** The switchboard number, so copying never loses the row (review F23). */
      readonly copy: string;
      readonly route: "any-phone";
    }
  | {
      readonly kind: "extension";
      readonly display: string;
      readonly extension: string;
      readonly tel: null;
      readonly copy: string;
      readonly route: "hospital-phone";
    }
  | {
      readonly kind: "text";
      readonly display: string;
      readonly tel: null;
      readonly copy: null;
      readonly route: null;
    }
  | { readonly kind: "none"; readonly display: ""; readonly tel: null; readonly copy: null; readonly route: null };

const PAUSE_DIAL = /^\s*([+\d\s().-]+?)\s*,\s*(\d{2,6})\s*$/;

/**
 * How a handbook entry's `phone` field is dialled.
 *
 * The switchboard-then-extension format is recorded with an **explicit comma**
 * (`9000 0004, 4455`): it becomes `tel:0890000004,4455`, the comma being the
 * pause both the Android and iOS diallers accept. Nothing else produces a pause
 * dial, and "ext" wording is never guessed. The extension is always printed
 * beside the button, so a dialler that ignores the pause still leaves the
 * caller able to key it.
 */
export function resolveHandbookPhone(raw: string, scope: OnCallNumberScope = "hospital"): HandbookDial {
  const value = raw.trim();
  if (!value) return { kind: "none", display: "", tel: null, copy: null, route: null };
  const pause = PAUSE_DIAL.exec(value);
  if (pause) {
    const switchboardTel = handbookTel(pause[1]);
    if (!switchboardTel) return { kind: "text", display: value, tel: null, copy: null, route: null };
    const switchboard = formatOnCallNumber(pause[1], scope);
    return {
      kind: "switchboard-extension",
      display: `${switchboard}, then ext ${pause[2]}`,
      switchboard,
      extension: pause[2],
      tel: `${switchboardTel},${pause[2]}`,
      copy: switchboardTel.slice("tel:".length),
      route: "any-phone",
    };
  }
  const tel = handbookTel(value);
  if (tel) {
    return {
      kind: "direct",
      display: formatOnCallNumber(value, scope),
      tel,
      copy: tel.slice("tel:".length),
      route: "any-phone",
    };
  }
  const digits = nationalDigits(value);
  if (digits && digits.length < 8) {
    return {
      kind: "extension",
      display: formatOnCallNumber(value, scope),
      extension: digits,
      tel: null,
      copy: digits,
      route: "hospital-phone",
    };
  }
  return { kind: "text", display: value, tel: null, copy: null, route: null };
}

/**
 * A number's accessible name, digit by digit: screen readers read "9000 0012"
 * as "nine thousand, twelve" (review F27). Groups are separated by a comma
 * pause; words ("then ext") are kept as they are.
 */
export function spokenOnCallNumber(display: string): string {
  const tokens = display.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  let spoken = "";
  let previousWasNumber = false;
  let previousEndedWithComma = false;
  for (const token of tokens) {
    const endsWithComma = token.endsWith(",");
    const bare = endsWithComma ? token.slice(0, -1) : token;
    const isNumber = /^\+?\d+$/.test(bare);
    const word = isNumber ? bare.split("").join(" ") : bare;
    if (spoken) spoken += (previousWasNumber && isNumber) || previousEndedWithComma ? ", " : " ";
    spoken += word;
    previousWasNumber = isNumber;
    previousEndedWithComma = endsWithComma;
  }
  return spoken;
}
