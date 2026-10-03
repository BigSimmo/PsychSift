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
 * 1. Each entry must be signed off by a NAMED clinician. The nine shipped entries are marked
 *    reviewed by "PsychSift", which `isNamedPerson` rejects, so today every entry is quote-only.
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

/** What the countdown switch is signed over. Changing any of it needs a fresh sign-off. */
export type MhaTimerSwitchContent = {
  /** Every timeframe the switch covers, with the sign-off pin it was checked against. */
  readonly timeframes: readonly MhaTimerSwitchTimeframe[];
  /** Bump when this module's countdown logic changes, so a logic change also needs a fresh sign-off. */
  readonly interpretation: typeof MHA_TIMER_INTERPRETATION;
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
  "mha-timers v1: elapsed hours from the order time; quote-only unless named sign-off";

export type MhaTimerSwitch = { readonly content: MhaTimerSwitchContent; readonly signOff: RuleSignOff };

/** The content a signer reviews: today's shipped entries and their current pins. */
export function currentMhaTimerSwitchContent(
  entries: readonly MhaTimeframeEntry[] = shippedEntries,
  medicalDeviceRuling: MhaTimerSwitchContent["medicalDeviceRuling"] = null,
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
      } else if (!isReviewedTimeframe(entry) || !isNamedPerson(entry.reviewedBy)) {
        quote("awaiting-named-sign-off");
      } else if (!gate.on) {
        quote("switched-off");
      } else if (!validStart || item.deadline === null) {
        quote("invalid-start");
      } else if (startMs > nowMs) {
        quote("future-start");
      } else {
        const remainingMs = item.deadline.getTime() - nowMs;
        countdowns.push({
          kind: "countdown",
          timerId: input.timerId,
          entry,
          deadline: item.deadline,
          remainingMs,
          expired: remainingMs <= 0,
        });
      }
    }
  }

  countdowns.sort((a, b) => a.deadline.getTime() - b.deadline.getTime() || a.timerId.localeCompare(b.timerId));
  return { gate, items: [...countdowns, ...quoteOnly] };
}
