import mhaTimeframes from "../../../data/mha-timeframes.json";
import {
  isNamedPerson,
  ruleContentSha256,
  ruleGate,
  TODAY_RULE_SIGN_OFFS,
  type ApprovedRuleSigner,
  type RuleGate,
  type RuleSignOff,
} from "@/lib/admin/rule-sign-off";
import { isReviewedTimeframe, timelineFor, type MhaTimeframeEntry, type MhaTimeframesFile } from "@/lib/mha-timeline";

/**
 * Mental Health Act 2014 (WA) countdowns for the On Call Today page.
 *
 * NO FIGURES LIVE HERE. Every duration, quote and section comes from the governed timeframe data
 * (`data/mha-timeframes.json`, read through `timelineFor` in `src/lib/mha-timeline.ts`), which pins
 * each entry to the verbatim Act text. This module adds only the per-order countdown and two
 * extra locks, because a live countdown for a real patient is a step beyond the form-page Timeline:
 *
 * 1. Each entry must be signed off by a NAMED clinician: a reviewer name that `isNamedPerson`
 *    accepts, or one of the exact sign-offs (id, reviewer, time and pin) the owner confirmed in
 *    writing as his own, in `OWNER_CONFIRMED_TIMEFRAMES`. The nine shipped entries carry
 *    "PsychSift" and are all listed there.
 * 2. The countdown switch (`MHA_TIMER_SWITCH`) must be signed by a named clinician over the exact
 *    entries, pins, signers and sign-off times it covers, and this module's logic version, and must record that the medical-device ruling was re-checked
 *    for per-patient countdowns (the Today plan, "Safety, privacy and clinical sign-off").
 *    Re-signing any timeframe, even with its content unchanged, turns the switch off until it is signed again.
 *
 * Patient labels: a timer is identified only by the caller's opaque `timerId`. This module never
 * sees or stores a bed number or initials; a caller that shows one keeps it in the on-device
 * patient-label store that is wiped at shift end and sign-out, never in the database.
 *
 * These are memory aids, not legal advice: the Act, not this countdown, decides when a period ends.
 */

const shippedEntries = (mhaTimeframes as MhaTimeframesFile).entries;

export type OwnerConfirmedTimeframe = {
  readonly id: string;
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly reviewedContentSha256: string;
};

/**
 * Timeframe sign-offs the clinical owner confirmed, in writing, as his own named sign-off even though
 * their public attribution ("PsychSift") is not a personal name. Matched by EXACT id, reviewer,
 * sign-off time and content pin: a new or re-signed timeframe labelled "PsychSift" does not count
 * until the owner confirms it too. Evidence: docs/evidence/mha-timeframes-owner-attribution.md
 * (confirmed 3 October 2026). This list is inside the countdown switch's signed content, so changing
 * it turns the switch off until it is signed again. Only the owner's own confirmation adds a row.
 */
export const OWNER_CONFIRMED_TIMEFRAMES: readonly OwnerConfirmedTimeframe[] = Object.freeze([
  {
    id: "form-2-assessment-detention",
    reviewedBy: "PsychSift",
    reviewedAt: "2026-09-26T17:21:45.126Z",
    reviewedContentSha256: "2546503dffaa244251da8993cc6939328e482c9b2fdaeafb8b26e5b1bac1bd01",
  },
  {
    id: "form-3a-detention-to-take-person",
    reviewedBy: "PsychSift",
    reviewedAt: "2026-09-26T17:21:45.126Z",
    reviewedContentSha256: "680e8103b1f2fea5eafdcfd239589161903b8f8ee1933842a4660b1fcf28d89a",
  },
  {
    id: "form-3a-continuous-limit-metropolitan",
    reviewedBy: "PsychSift",
    reviewedAt: "2026-09-26T17:21:45.126Z",
    reviewedContentSha256: "3647c51e79fe687a578d6f0e04b08b4c29247a37de267c9699b1cb84678e4cd3",
  },
  {
    id: "form-3a-continuous-limit-non-metropolitan",
    reviewedBy: "PsychSift",
    reviewedAt: "2026-09-26T17:21:45.126Z",
    reviewedContentSha256: "0754e9b0755e5fc276900fe6a99f9860d2246b6fe7e7d4d2cc88669ec5e9f0c1",
  },
  {
    id: "form-3d-6b-detention-to-take-person",
    reviewedBy: "PsychSift",
    reviewedAt: "2026-09-26T17:21:45.126Z",
    reviewedContentSha256: "d718789024f2d1da792bc2d9e3bd553cd970ca88b84272890b79dcd9f1e5c409",
  },
  {
    id: "form-3d-6b-continuous-limit",
    reviewedBy: "PsychSift",
    reviewedAt: "2026-09-26T17:21:45.126Z",
    reviewedContentSha256: "a787648e03fa281f244d36f5e4fe2b9a71b8b427f0f086b2a20a1d5f58a68793",
  },
  {
    id: "form-5a-confirmation",
    reviewedBy: "PsychSift",
    reviewedAt: "2026-09-26T17:21:45.126Z",
    reviewedContentSha256: "98b774a1659ddc6889563b93a3b1adb546fed59fd293adf902e80e730e462fb1",
  },
  {
    id: "form-12c-advise-chief-mental-health-advocate",
    reviewedBy: "PsychSift",
    reviewedAt: "2026-09-26T17:21:45.126Z",
    reviewedContentSha256: "f8a962c50dc874965b9f98076524e10b85f675c2273554101950fb0d8d555c7a",
  },
  {
    id: "form-12c-first-review",
    reviewedBy: "PsychSift",
    reviewedAt: "2026-09-26T17:21:45.126Z",
    reviewedContentSha256: "43e9898ebf069d3f332a3b005a66cc3cc56ffe19f289ba22a79edcb786412b8f",
  },
]);

function isOwnerConfirmed(entry: MhaTimeframeEntry, confirmed: readonly OwnerConfirmedTimeframe[]): boolean {
  return confirmed.some(
    (row) =>
      row.id === entry.id &&
      row.reviewedBy === entry.reviewedBy &&
      row.reviewedAt === entry.reviewedAt &&
      row.reviewedContentSha256 === entry.reviewedContentSha256,
  );
}

/** Signed off, with its pin intact, by a named clinician or as an exact owner-confirmed sign-off. */
export function isTimeframeSignedByNamedClinician(
  entry: MhaTimeframeEntry,
  confirmed: readonly OwnerConfirmedTimeframe[] = OWNER_CONFIRMED_TIMEFRAMES,
): boolean {
  if (!isReviewedTimeframe(entry)) return false;
  return isNamedPerson(entry.reviewedBy) || isOwnerConfirmed(entry, confirmed);
}

/** What the countdown switch is signed over. Changing any of it needs a fresh sign-off. */
export type MhaTimerSwitchContent = {
  /** Every timeframe the switch covers, with the sign-off pin it was checked against. */
  readonly timeframes: readonly MhaTimerSwitchTimeframe[];
  /** Bump when this module's countdown logic changes, so a logic change also needs a fresh sign-off. */
  readonly interpretation: typeof MHA_TIMER_INTERPRETATION;
  /** The owner-confirmed sign-offs in force when the switch was signed; changing them needs re-signing. */
  readonly ownerConfirmedTimeframes: readonly OwnerConfirmedTimeframe[];
  /**
   * The date (YYYY-MM-DD) the owner confirmed or revised the medical-device ruling for per-patient
   * countdowns, and where that decision is written down. Null until then, which keeps the switch off.
   */
  readonly medicalDeviceRuling: { readonly confirmedOn: string; readonly record: string } | null;
};

/**
 * One covered timeframe as the switch signer saw it: its content pin AND who signed it, when and
 * in what state. The content pin alone leaves those out, so without them changing only
 * `reviewedBy` from "PsychSift" to a name would start countdowns under an old switch signature.
 */
export type MhaTimerSwitchTimeframe = {
  readonly id: string;
  readonly status: MhaTimeframeEntry["status"];
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly reviewedContentSha256: string | null;
};

export const MHA_TIMER_INTERPRETATION =
  "mha-timers v2: elapsed hours from the order time; a 'before the end of each N-hour period' review repeats every N hours while in force; quote-only unless named sign-off";

/**
 * How many review deadlines a recurring entry shows at once: the next upcoming one plus the
 * following ones, up to this many in total. This is a DISPLAY bound only, to keep Today readable
 * (seven 24-hour reviews is one week ahead). It is not a legal maximum: the Act, not this
 * countdown, decides how long an order stays in force, and the window slides forward as each
 * deadline passes, so the next deadline is always shown however long the order runs.
 */
export const MHA_RECURRING_DISPLAY_COUNT = 7;

/** Matches Act wording of the form "before the end of each 24-hour period that an order ... is in force". */
const RECURRING_PERIOD_PATTERN = /\beach\s+\d+-hour\s+period\b.*\bis in force\b/is;

/** Whether the entry's own quote says the duty repeats for each period while the order is in force. */
export function isRecurringReviewEntry(entry: MhaTimeframeEntry): boolean {
  return entry.duration.unit === "hours" && RECURRING_PERIOD_PATTERN.test(entry.quote);
}

export type MhaTimerSwitch = { readonly content: MhaTimerSwitchContent; readonly signOff: RuleSignOff };

/** The content a signer reviews: today's shipped entries and their current pins. */
export function currentMhaTimerSwitchContent(
  entries: readonly MhaTimeframeEntry[] = shippedEntries,
  medicalDeviceRuling: MhaTimerSwitchContent["medicalDeviceRuling"] = null,
  ownerConfirmedTimeframes: readonly OwnerConfirmedTimeframe[] = OWNER_CONFIRMED_TIMEFRAMES,
): MhaTimerSwitchContent {
  return {
    timeframes: entries.map((entry) => ({
      id: entry.id,
      status: entry.status,
      reviewedBy: entry.reviewedBy,
      reviewedAt: entry.reviewedAt,
      reviewedContentSha256: entry.reviewedContentSha256,
    })),
    interpretation: MHA_TIMER_INTERPRETATION,
    ownerConfirmedTimeframes,
    medicalDeviceRuling,
  };
}

/** Read from `src/lib/admin/today-rule-sign-offs.json`; shipped OFF and unsigned. Only `npm run rules:sign` writes it. */
export const MHA_TIMER_SWITCH: MhaTimerSwitch = {
  content: currentMhaTimerSwitchContent(shippedEntries, TODAY_RULE_SIGN_OFFS.mhaTimerSwitch.medicalDeviceRuling),
  signOff: TODAY_RULE_SIGN_OFFS.mhaTimerSwitch.signOff,
};

export type MhaTimerGate =
  RuleGate | { readonly on: false; readonly reason: "medical-device-ruling-pending" | "stale-switch" };

const PERTH_OFFSET_MS = 8 * 3_600_000;

/**
 * A real YYYY-MM-DD date, not after the Perth day the switch was signed (a ruling cannot have been
 * re-checked in the future), and a non-blank record of where the decision is written.
 */
export function isRecordedRuling(
  ruling: MhaTimerSwitchContent["medicalDeviceRuling"],
  signedAt: string | null,
): boolean {
  if (ruling === null || typeof ruling.record !== "string" || ruling.record.trim() === "") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ruling.confirmedOn)) return false;
  const date = new Date(`${ruling.confirmedOn}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || !date.toISOString().startsWith(ruling.confirmedOn)) return false;
  const signedMs = signedAt === null ? Number.NaN : Date.parse(signedAt);
  if (Number.isNaN(signedMs)) return false;
  return ruling.confirmedOn <= new Date(signedMs + PERTH_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whether countdowns may run at all. Fails closed. */
export function mhaTimerGate(
  timerSwitch: MhaTimerSwitch = MHA_TIMER_SWITCH,
  entries: readonly MhaTimeframeEntry[] = shippedEntries,
  approvedSigners?: readonly ApprovedRuleSigner[],
): MhaTimerGate {
  const signed = ruleGate(timerSwitch.signOff, timerSwitch.content, approvedSigners);
  if (!signed.on) return signed;
  if (!isRecordedRuling(timerSwitch.content.medicalDeviceRuling, timerSwitch.signOff.signedAt)) {
    return { on: false, reason: "medical-device-ruling-pending" };
  }
  // The switch must cover today's entries, signers and logic: a re-signed or added timeframe, or
  // changed countdown logic, needs the switch signed again.
  const current = currentMhaTimerSwitchContent(entries, timerSwitch.content.medicalDeviceRuling);
  if (ruleContentSha256(timerSwitch.content) !== ruleContentSha256(current)) {
    return { on: false, reason: "stale-switch" };
  }
  return { on: true };
}

/** One order the user is tracking. `timerId` is opaque: never a name, bed number or initials. */
export type MhaTimerInput = { readonly timerId: string; readonly formCode: string; readonly madeAt: Date };

export type MhaTimerQuoteOnlyReason =
  /** The countdown switch is off; `MhaTimersResult.gate` says why. */
  | "switched-off"
  /** Not signed off at all, or the pin no longer matches. */
  | "awaiting-review"
  /** Signed off, but by a system name such as "PsychSift" rather than a named clinician. */
  | "awaiting-named-sign-off"
  /** The Act ends this period at a second event the start time cannot see (`computeAllowed: false`). */
  | "not-calculable"
  /** The start time given is not a real instant. */
  | "invalid-start"
  /** The order time is later than now, which would stretch the countdown past the Act's period. */
  | "future-start";

export type MhaTimerItem =
  | {
      readonly kind: "countdown";
      readonly timerId: string;
      readonly entry: MhaTimeframeEntry;
      readonly deadline: Date;
      /** Milliseconds from `now` to the deadline; negative once it has passed. */
      readonly remainingMs: number;
      readonly expired: boolean;
      /** 1 for the first (or only) deadline; 2, 3... for later reviews of a recurring duty. */
      readonly occurrence: number;
      /** Set for a recurring duty: the deadline repeats every this many hours while the order is in force. */
      readonly repeatsEveryHours: number | null;
    }
  | {
      readonly kind: "quote-only";
      readonly timerId: string;
      readonly entry: MhaTimeframeEntry;
      readonly reason: MhaTimerQuoteOnlyReason;
    };

export type MhaTimersResult = { readonly gate: MhaTimerGate; readonly items: readonly MhaTimerItem[] };

/**
 * Every time limit that applies to each tracked order. Countdowns come first, soonest deadline
 * first; quote-only items follow in input order, so the Act's words are always on screen even
 * when nothing may be counted. "Due soon" banding is left to the screen: this module invents no
 * warning threshold.
 */
export function mhaTimers(
  inputs: readonly MhaTimerInput[],
  now: Date,
  options: {
    readonly timerSwitch?: MhaTimerSwitch;
    readonly entries?: readonly MhaTimeframeEntry[];
    readonly approvedSigners?: readonly ApprovedRuleSigner[];
  } = {},
): MhaTimersResult {
  const entries = options.entries ?? shippedEntries;
  const gate = mhaTimerGate(options.timerSwitch ?? MHA_TIMER_SWITCH, entries, options.approvedSigners);
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) throw new Error("mhaTimers: invalid now");

  const countdowns: Extract<MhaTimerItem, { kind: "countdown" }>[] = [];
  const quoteOnly: Extract<MhaTimerItem, { kind: "quote-only" }>[] = [];

  for (const input of inputs) {
    const startMs = input.madeAt.getTime();
    const validStart = !Number.isNaN(startMs);
    for (const item of timelineFor(input.formCode, validStart ? input.madeAt : null, entries)) {
      const { entry } = item;
      const quote = (reason: MhaTimerQuoteOnlyReason) =>
        quoteOnly.push({ kind: "quote-only", timerId: input.timerId, entry, reason });
      if (item.quoteOnly) {
        quote(item.reason === "not-calculable" ? "not-calculable" : "awaiting-review");
      } else if (!isTimeframeSignedByNamedClinician(entry)) {
        quote("awaiting-named-sign-off");
      } else if (!gate.on) {
        quote("switched-off");
      } else if (!validStart || item.deadline === null) {
        quote("invalid-start");
      } else if (startMs > nowMs) {
        quote("future-start");
      } else {
        const firstMs = item.deadline.getTime();
        const periodMs = entry.duration.value * 3_600_000;
        const recurring = isRecurringReviewEntry(entry);
        const push = (occurrence: number) => {
          const deadline = new Date(startMs + occurrence * periodMs);
          const remainingMs = deadline.getTime() - nowMs;
          countdowns.push({
            kind: "countdown",
            timerId: input.timerId,
            entry,
            deadline,
            remainingMs,
            expired: remainingMs <= 0,
            occurrence,
            repeatsEveryHours: recurring ? entry.duration.value : null,
          });
        };
        if (!recurring) {
          push(1);
        } else {
          // The next deadline not yet passed (a deadline exactly due now still shows, as expired), then the
          // following ones. Earlier, already-passed reviews are not shown: this module cannot
          // know whether they were done.
          const firstUpcoming = nowMs <= firstMs ? 1 : Math.ceil((nowMs - startMs) / periodMs);
          for (let k = 0; k < MHA_RECURRING_DISPLAY_COUNT; k += 1) push(firstUpcoming + k);
        }
      }
    }
  }

  countdowns.sort((a, b) => a.deadline.getTime() - b.deadline.getTime() || a.timerId.localeCompare(b.timerId));
  return { gate, items: [...countdowns, ...quoteOnly] };
}
