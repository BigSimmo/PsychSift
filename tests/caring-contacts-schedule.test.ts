// tests/caring-contacts-schedule.test.ts
import { describe, expect, it } from "vitest";

import { awstCalendarDay, toAwstParts } from "@/lib/caring-contacts/clock";
import { buildApprovedSchedule } from "@/lib/caring-contacts/schedule";

const discharge = new Date("2026-03-10T06:30:00.000Z"); // 14:30 AWST on 2026-03-10

function ok(result: ReturnType<typeof buildApprovedSchedule>) {
  if (!result.ok) throw new Error(`expected success, got ${result.reason}`);
  return result.contacts;
}

describe("buildApprovedSchedule", () => {
  it("produces exactly ten contacts with the approved cadence labels", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(contacts).toHaveLength(10);
    expect(contacts.map((c) => c.cadenceLabel)).toEqual([
      "Day 1",
      "Week 1",
      "Month 1",
      "Month 2",
      "Month 3",
      "Month 4",
      "Month 6",
      "Month 8",
      "Month 10",
      "Month 12",
    ]);
  });

  it("defaults the first contact to the day after discharge", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(contacts[0].calendarDay).toBe("2026-03-11");
    expect(contacts[1].calendarDay).toBe("2026-03-17"); // discharge + 7
  });

  it("anchors every later contact to the discharge date, not the first contact date", () => {
    const moved = ok(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-14",
        firstContactReason: "Patient requested a later start",
      }),
    );
    expect(moved[0].calendarDay).toBe("2026-03-14");
    expect(moved[2].calendarDay).toBe("2026-04-10"); // Month 1 from discharge, unmoved
  });

  it("clamps month arithmetic to the last day of a shorter month", () => {
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2026-01-31T02:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(contacts[2].calendarDay).toBe("2026-02-28"); // 2026 is not a leap year
  });

  it("clamps into a leap February", () => {
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2028-01-31T02:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(contacts[2].calendarDay).toBe("2028-02-29");
  });

  it("maps each preference to its exact AWST hour", () => {
    for (const [preference, hour] of [
      ["morning", 10],
      ["afternoon", 14],
      ["earlyEvening", 17],
    ] as const) {
      const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: preference }));
      for (const contact of contacts) expect(toAwstParts(contact.sendAt).hour).toBe(hour);
    }
  });

  it("never schedules outside 09:00-18:00 AWST", () => {
    for (const preference of ["morning", "afternoon", "earlyEvening"] as const) {
      const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: preference }));
      for (const contact of contacts) {
        const { hour } = toAwstParts(contact.sendAt);
        expect(hour).toBeGreaterThanOrEqual(9);
        expect(hour).toBeLessThan(18);
      }
    }
  });

  it("sends on weekends without adjustment", () => {
    // 2026-03-13 is a Friday; +1 day is Saturday 2026-03-14.
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2026-03-13T02:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(contacts[0].calendarDay).toBe("2026-03-14");
    expect(new Date(`${contacts[0].calendarDay}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it("types the first and closing messages", () => {
    const contacts = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "morning" }));
    expect(contacts[0].messageType).toBe("first");
    expect(contacts[9].messageType).toBe("closing");
    expect(contacts.slice(1, 9).every((c) => c.messageType === "standard")).toBe(true);
  });

  it("accepts both ends of the permitted first-contact range", () => {
    for (const day of ["2026-03-10", "2026-03-17"]) {
      const result = buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: day,
        firstContactReason: "Coordinator decision",
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects a first contact date outside the permitted range", () => {
    for (const day of ["2026-03-09", "2026-03-18"]) {
      expect(
        buildApprovedSchedule({
          dischargeAt: discharge,
          sendingPreference: "morning",
          firstContactDate: day,
          firstContactReason: "Too far",
        }),
      ).toEqual({ ok: false, reason: "first-contact-out-of-range" });
    }
  });

  it("requires a reason whenever the first contact date is not the default", () => {
    expect(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-13",
      }),
    ).toEqual({ ok: false, reason: "first-contact-reason-required" });
    expect(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-13",
        firstContactReason: "   ",
      }),
    ).toEqual({ ok: false, reason: "first-contact-reason-required" });
  });

  it("suppresses Week 1 when the first contact absorbs it, rather than sending twice in a day", () => {
    const contacts = ok(
      buildApprovedSchedule({
        dischargeAt: discharge,
        sendingPreference: "morning",
        firstContactDate: "2026-03-17",
        firstContactReason: "Patient away for a week",
      }),
    );
    expect(contacts[1].suppressed).toEqual({ reason: "absorbedByFirstContact" });
    expect(contacts.filter((c) => !c.suppressed)).toHaveLength(9);
  });

  it("keeps non-suppressed calendar days strictly increasing", () => {
    for (const day of ["2026-03-10", "2026-03-13", "2026-03-17"]) {
      const contacts = ok(
        buildApprovedSchedule({
          dischargeAt: discharge,
          sendingPreference: "morning",
          firstContactDate: day,
          firstContactReason: "Coordinator decision",
        }),
      ).filter((c) => !c.suppressed);
      const days = contacts.map((c) => c.calendarDay);
      expect([...days].sort()).toEqual(days);
      expect(new Set(days).size).toBe(days.length);
    }
  });

  it("is deterministic", () => {
    const a = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "afternoon" }));
    const b = ok(buildApprovedSchedule({ dischargeAt: discharge, sendingPreference: "afternoon" }));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("derives the discharge day in AWST, not UTC", () => {
    // 20:00 UTC on 2026-03-10 is 04:00 AWST on 2026-03-11, so day 1 is the 12th.
    const contacts = ok(
      buildApprovedSchedule({ dischargeAt: new Date("2026-03-10T20:00:00.000Z"), sendingPreference: "morning" }),
    );
    expect(awstCalendarDay(new Date("2026-03-10T20:00:00.000Z"))).toBe("2026-03-11");
    expect(contacts[0].calendarDay).toBe("2026-03-12");
  });
});
