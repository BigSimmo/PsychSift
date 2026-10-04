import { describe, expect, it } from "vitest";

import mhaTimeframesFile from "../data/mha-timeframes.json";
import { ruleContentSha256, UNSIGNED, type ApprovedRuleSigner } from "@/lib/admin/rule-sign-off";
import { timeframeContentSha256, type MhaTimeframeEntry } from "@/lib/mha-timeline";
import {
  currentMhaTimerSwitchContent,
  isRecurringReviewEntry,
  isTimeframeSignedByNamedClinician,
  MHA_RECURRING_DISPLAY_COUNT,
  mhaTimerGate,
  OWNER_CONFIRMED_TIMEFRAMES,
  mhaTimers,
  type MhaTimerSwitch,
} from "@/lib/on-call/mha-timers";

/**
 * Gating and countdown arithmetic only. The fixtures use invented quotes and an invented form
 * code on purpose: statutory content is the timeframe contract test's job, never this file's.
 */

function entry(id: string, hours: number, extra: Partial<MhaTimeframeEntry> = {}): MhaTimeframeEntry {
  return {
    id,
    formCodes: ["ZZ"],
    trigger: `Invented trigger ${id}`,
    section: "999",
    sourceTextSha256: "0".repeat(64),
    quote: `invented ${hours} hours`,
    duration: { value: hours, unit: "hours" },
    anchor: "Invented anchor",
    status: "drafted",
    reviewedBy: null,
    reviewedAt: null,
    reviewedContentSha256: null,
    ...extra,
  };
}

function signedBy(base: MhaTimeframeEntry, reviewer: string): MhaTimeframeEntry {
  const withMeta = {
    ...base,
    status: "reviewed" as const,
    reviewedBy: reviewer,
    reviewedAt: "2026-10-04T01:00:00.000Z",
  };
  return { ...withMeta, reviewedContentSha256: timeframeContentSha256(withMeta) };
}

const named = [signedBy(entry("long", 72), "Dr Jane Example"), signedBy(entry("short", 6), "Dr Jane Example")];

const SIGNER_ID = "11111111-1111-4111-8111-111111111111";
const SIGNERS: readonly ApprovedRuleSigner[] = [{ userId: SIGNER_ID, name: "Dr Jane Example" }];

function onSwitch(entries: readonly MhaTimeframeEntry[]): MhaTimerSwitch {
  const content = currentMhaTimerSwitchContent(entries, { confirmedOn: "2026-10-01", record: "invented record" });
  return {
    content,
    signOff: {
      enabled: true,
      signedBy: "Dr Jane Example",
      signedByUserId: SIGNER_ID,
      signedAt: "2026-10-02T02:00:00.000Z",
      signedContentSha256: ruleContentSha256(content),
    },
  };
}

const madeAt = new Date("2026-10-04T00:00:00.000Z");
const now = new Date("2026-10-04T05:00:00.000Z");

describe("mhaTimers", () => {
  it("stays off while the switch is unsigned, so nothing counts down", () => {
    const unsigned: MhaTimerSwitch = { content: currentMhaTimerSwitchContent(), signOff: UNSIGNED };
    expect(mhaTimerGate(unsigned)).toEqual({ on: false, reason: "unsigned" });
    const result = mhaTimers([{ timerId: "t1", formCode: "2", madeAt }], now, { timerSwitch: unsigned });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.kind === "quote-only")).toBe(true);
  });

  it("counts the shipped 'PsychSift' sign-offs as the owner's named sign-off", () => {
    const shipped = mhaTimeframesFile.entries as unknown as MhaTimeframeEntry[];
    expect(shipped.every((candidate) => isTimeframeSignedByNamedClinician(candidate))).toBe(true);
    const result = mhaTimers([{ timerId: "t1", formCode: "2", madeAt }], now, {
      timerSwitch: onSwitch(shipped),
      approvedSigners: SIGNERS,
    });
    expect(result.items.map((item) => item.kind)).toContain("countdown");
  });

  it("counts only the exact sign-offs the owner confirmed, not any entry labelled PsychSift", () => {
    expect(isTimeframeSignedByNamedClinician(signedBy(entry("new-entry", 24), "PsychSift"))).toBe(false);
    const shipped = (mhaTimeframesFile.entries as unknown as MhaTimeframeEntry[])[0]!;
    const resigned = signedBy({ ...shipped, anchor: "Changed anchor" }, "PsychSift");
    expect(isTimeframeSignedByNamedClinician(resigned)).toBe(false);
    expect(OWNER_CONFIRMED_TIMEFRAMES.map((row) => row.id)).toEqual(
      (mhaTimeframesFile.entries as unknown as MhaTimeframeEntry[]).map((candidate) => candidate.id),
    );
  });

  it("turns the switch off when the owner-confirmed list changes", () => {
    const shipped = mhaTimeframesFile.entries as unknown as MhaTimeframeEntry[];
    const timerSwitch = onSwitch(shipped);
    expect(mhaTimerGate(timerSwitch, shipped, SIGNERS)).toEqual({ on: true });
    const shorter = currentMhaTimerSwitchContent(
      shipped,
      timerSwitch.content.medicalDeviceRuling,
      OWNER_CONFIRMED_TIMEFRAMES.slice(1),
    );
    const signedOverShorter: MhaTimerSwitch = {
      content: shorter,
      signOff: { ...timerSwitch.signOff, signedContentSha256: ruleContentSha256(shorter) },
    };
    expect(mhaTimerGate(signedOverShorter, shipped, SIGNERS)).toEqual({ on: false, reason: "stale-switch" });
  });

  it("does not accept an attribution the owner has not confirmed", () => {
    expect(isTimeframeSignedByNamedClinician(signedBy(entry("other", 24), "PsychSift Team"))).toBe(false);
    expect(isTimeframeSignedByNamedClinician(signedBy(entry("other", 24), "System"))).toBe(false);
    expect(isTimeframeSignedByNamedClinician(entry("drafted", 24))).toBe(false);
  });

  it("counts down signed entries, soonest first, once the switch is signed", () => {
    const result = mhaTimers([{ timerId: "t1", formCode: "ZZ", madeAt }], now, {
      entries: named,
      timerSwitch: onSwitch(named),
      approvedSigners: SIGNERS,
    });
    expect(result.gate).toEqual({ on: true });
    expect(result.items.map((item) => [item.kind, item.entry.id])).toEqual([
      ["countdown", "short"],
      ["countdown", "long"],
    ]);
    const [short, long] = result.items;
    expect(short.kind === "countdown" && short.deadline.toISOString()).toBe("2026-10-04T06:00:00.000Z");
    expect(short.kind === "countdown" && short.remainingMs).toBe(60 * 60 * 1000);
    expect(long.kind === "countdown" && long.expired).toBe(false);
  });

  it("marks a passed deadline expired with a negative remainder", () => {
    const later = new Date("2026-10-04T07:00:00.000Z");
    const result = mhaTimers([{ timerId: "t1", formCode: "ZZ", madeAt }], later, {
      entries: named,
      timerSwitch: onSwitch(named),
      approvedSigners: SIGNERS,
    });
    const short = result.items.find((item) => item.entry.id === "short")!;
    expect(short.kind === "countdown" && short.expired).toBe(true);
    expect(short.kind === "countdown" && short.remainingMs).toBe(-60 * 60 * 1000);
  });

  it("keeps an entry signed by a system name quote-only even with the switch on", () => {
    const mixed = [named[0]!, signedBy(entry("system", 24), "System")];
    const result = mhaTimers([{ timerId: "t1", formCode: "ZZ", madeAt }], now, {
      entries: mixed,
      timerSwitch: onSwitch(mixed),
      approvedSigners: SIGNERS,
    });
    const system = result.items.find((item) => item.entry.id === "system")!;
    expect(system).toMatchObject({ kind: "quote-only", reason: "awaiting-named-sign-off" });
  });

  it("never counts an entry the Act ends at a second event", () => {
    const blocked = [signedBy(entry("ceiling", 72, { computeAllowed: false }), "Dr Jane Example")];
    const result = mhaTimers([{ timerId: "t1", formCode: "ZZ", madeAt }], now, {
      entries: blocked,
      timerSwitch: onSwitch(blocked),
      approvedSigners: SIGNERS,
    });
    expect(result.items).toEqual([expect.objectContaining({ kind: "quote-only", reason: "not-calculable" })]);
  });

  it("stays off until the medical-device ruling is recorded", () => {
    const content = currentMhaTimerSwitchContent(named, null);
    const timerSwitch: MhaTimerSwitch = {
      content,
      signOff: {
        enabled: true,
        signedBy: "Dr Jane Example",
        signedByUserId: SIGNER_ID,
        signedAt: "2026-10-02T02:00:00.000Z",
        signedContentSha256: ruleContentSha256(content),
      },
    };
    expect(mhaTimerGate(timerSwitch, named, SIGNERS)).toEqual({ on: false, reason: "medical-device-ruling-pending" });
  });

  it("turns off when a timeframe is re-signed after the switch was signed", () => {
    const timerSwitch = onSwitch(named);
    const resigned = [signedBy({ ...named[0]!, anchor: "Changed anchor" }, "Dr Jane Example"), named[1]!];
    expect(mhaTimerGate(timerSwitch, resigned, SIGNERS)).toEqual({ on: false, reason: "stale-switch" });
    const result = mhaTimers([{ timerId: "t1", formCode: "ZZ", madeAt }], now, {
      entries: resigned,
      timerSwitch,
      approvedSigners: SIGNERS,
    });
    expect(result.items.every((item) => item.kind === "quote-only" && item.reason === "switched-off")).toBe(true);
  });

  it("turns off when only the reviewer changes, with the content untouched", () => {
    const system = [signedBy(entry("long", 72), "PsychSift")];
    const timerSwitch = onSwitch(system);
    const renamed = [signedBy(entry("long", 72), "Dr Jane Example")];
    expect(renamed[0]!.reviewedContentSha256).toBe(system[0]!.reviewedContentSha256);
    expect(mhaTimerGate(timerSwitch, renamed, SIGNERS)).toEqual({ on: false, reason: "stale-switch" });
  });

  it("needs a real date and a written record for the medical-device ruling", () => {
    for (const ruling of [
      { confirmedOn: "", record: "" },
      { confirmedOn: "2026-10-04", record: "  " },
      { confirmedOn: "2026-02-30", record: "invented record" },
      { confirmedOn: "9999-01-01", record: "invented record" },
      { confirmedOn: "2026-10-04", record: "invented record" },
    ]) {
      const content = currentMhaTimerSwitchContent(named, ruling);
      const timerSwitch: MhaTimerSwitch = {
        content,
        signOff: {
          enabled: true,
          signedBy: "Dr Jane Example",
          signedByUserId: SIGNER_ID,
          signedAt: "2026-10-02T02:00:00.000Z",
          signedContentSha256: ruleContentSha256(content),
        },
      };
      expect(mhaTimerGate(timerSwitch, named, SIGNERS)).toEqual({ on: false, reason: "medical-device-ruling-pending" });
    }
  });

  it("will not count from an order time later than now", () => {
    const result = mhaTimers([{ timerId: "t1", formCode: "ZZ", madeAt: new Date("2026-10-05T00:00:00.000Z") }], now, {
      entries: named,
      timerSwitch: onSwitch(named),
      approvedSigners: SIGNERS,
    });
    expect(result.items.every((item) => item.kind === "quote-only" && item.reason === "future-start")).toBe(true);
  });

  it("reports an invalid start rather than inventing a deadline", () => {
    const result = mhaTimers([{ timerId: "t1", formCode: "ZZ", madeAt: new Date("not a date") }], now, {
      entries: named,
      timerSwitch: onSwitch(named),
      approvedSigners: SIGNERS,
    });
    expect(result.items.every((item) => item.kind === "quote-only" && item.reason === "invalid-start")).toBe(true);
  });

  describe("recurring 'each N-hour period' review", () => {
    const recurring = [
      signedBy(
        entry("review", 24, {
          quote: "before the end of each 24-hour period that an order is in force, review it",
        }),
        "Dr Jane Example",
      ),
    ];
    const run = (at: Date, entries = recurring, start = madeAt) =>
      mhaTimers([{ timerId: "t1", formCode: "ZZ", madeAt: start }], at, {
        entries,
        timerSwitch: onSwitch(entries),
        approvedSigners: SIGNERS,
      });
    const deadlines = (r: ReturnType<typeof run>) =>
      r.items.map((i) =>
        i.kind === "countdown" ? [i.occurrence, i.deadline.toISOString(), i.repeatsEveryHours] : null,
      );

    it("recognises the repeating wording only", () => {
      expect(isRecurringReviewEntry(recurring[0]!)).toBe(true);
      expect(isRecurringReviewEntry(named[0]!)).toBe(false);
    });

    it("shows every further 24-hour deadline up to the display bound", () => {
      const r = run(now);
      expect(r.items).toHaveLength(MHA_RECURRING_DISPLAY_COUNT);
      expect(deadlines(r).slice(0, 3)).toEqual([
        [1, "2026-10-05T00:00:00.000Z", 24],
        [2, "2026-10-06T00:00:00.000Z", 24],
        [3, "2026-10-07T00:00:00.000Z", 24],
      ]);
    });

    it("slides to the next upcoming deadline once earlier ones have passed", () => {
      const r = run(new Date("2026-10-06T12:00:00.000Z"));
      expect(deadlines(r)[0]).toEqual([3, "2026-10-07T00:00:00.000Z", 24]);
      expect(r.items).toHaveLength(MHA_RECURRING_DISPLAY_COUNT);
    });

    it("keeps a deadline that is exactly due, and every fail-closed lock", () => {
      const r = run(new Date("2026-10-05T00:00:00.000Z"));
      expect(deadlines(r)[0]).toEqual([1, "2026-10-05T00:00:00.000Z", 24]);
      const future = run(new Date("2026-10-03T00:00:00.000Z"));
      expect(future.items).toEqual([expect.objectContaining({ kind: "quote-only", reason: "future-start" })]);
      const unsigned = mhaTimers([{ timerId: "t1", formCode: "ZZ", madeAt }], now, {
        entries: recurring,
        timerSwitch: { content: currentMhaTimerSwitchContent(recurring), signOff: UNSIGNED },
      });
      expect(unsigned.items.every((i) => i.kind === "quote-only")).toBe(true);
    });
  });
});
