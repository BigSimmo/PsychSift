import { describe, expect, it } from "vitest";

import {
  checkReminderText,
  dueReminders,
  normalizeReminders,
  reminderWhenLabel,
  remindMeWhenOptions,
  type Reminder,
} from "@/lib/alerts/remind-me";

describe("Remind me keeps patient details out", () => {
  it("screen 15: initials and a bed number are caught, with a safer wording", () => {
    expect(checkReminderText("Call back JS bed 12 re bloods")).toEqual({
      title: "This looks like initials and a bed number",
      body: "Reminders can't hold patient details.",
      suggestion: "Call back about bloods",
    });
  });

  it("screen 14: an everyday job passes", () => {
    expect(checkReminderText("Ask switchboard for the new pager list")).toBeNull();
    expect(checkReminderText("Check ECG and LFTs before the MDT")).toBeNull();
  });

  it.each([
    ["Review Mr Smith after lunch", "This looks like a name"],
    ["Chase URN 1234567 discharge", "This looks like a record number"],
    ["Bloods for 9876543", "This looks like a record number"],
    ["See room 4b again", "This looks like a bed number"],
  ])("%s", (text, title) => {
    expect(checkReminderText(text)?.title).toBe(title);
  });

  it.each([
    ["mrs smith wants a call", "This looks like a name"],
    ["Review Mr. o'brien", "This looks like a name"],
    ["Mrs Ó'Brien family meeting", "This looks like a name"],
    ["Call J Smith back", "This looks like a name"],
    ["Ring J.S. about leave", "This looks like initials"],
    ["Review the 34M from last night", "This looks like an age"],
    ["45yo F needs obs", "This looks like an age"],
  ])("also catches %s", (text, title) => {
    expect(checkReminderText(text)?.title).toBe(title);
  });

  it.each([
    "Chase urgent bloods",
    "Send urine sample form",
    "Book urology clinic slot",
    "Check BP and BMI log",
    "LAI clinic list for CBT group",
    "Join the MS Teams call",
    "FYI the OCD and ADHD talk moved",
    "I need to update the roster",
    "A meeting at 3",
  ])("lets an ordinary clinical job through: %s", (text) => {
    expect(checkReminderText(text)).toBeNull();
  });

  it.each(["Check ON CALL roster", "Call RE discharge plan", "Email the MDT TO list", "review in 2 yrs"])(
    "does not refuse ordinary capitals or a length of time: %s",
    (text) => {
      expect(checkReminderText(text)).toBeNull();
    },
  );

  it("gives the same answer every time (no state carried between checks)", () => {
    for (let i = 0; i < 3; i += 1) expect(checkReminderText("bed 3 obs")?.title).toBe("This looks like a bed number");
  });
});

describe("when choices, Perth time", () => {
  const morning = new Date("2026-10-04T23:30:00Z"); // Mon 5 Oct 07:30 Perth

  it("in an hour, 12:00, the end of today's shift and tomorrow 08:00", () => {
    const options = remindMeWhenOptions(morning, "2026-10-05T08:30:00Z");
    expect(options.map((option) => option.label)).toEqual([
      "In 1 hour",
      "12:00",
      "End of shift, 16:30",
      "Tomorrow 08:00",
    ]);
    expect(options[1]!.dueAt).toBe("2026-10-05T04:00:00.000Z");
    expect(options[3]!.dueAt).toBe("2026-10-06T00:00:00.000Z");
  });

  it("no shift today, or it has ended: no end-of-shift choice", () => {
    expect(remindMeWhenOptions(morning, null).some((option) => option.id === "shift-end")).toBe(false);
    expect(remindMeWhenOptions(morning, "2026-10-04T23:00:00Z").some((option) => option.id === "shift-end")).toBe(
      false,
    );
  });

  it("late afternoon skips 12:00 and offers 17:00 only when far enough away", () => {
    const afternoon = new Date("2026-10-05T06:00:00Z"); // 14:00 Perth
    expect(remindMeWhenOptions(afternoon, null).map((option) => option.label)).toEqual([
      "In 1 hour",
      "17:00",
      "Tomorrow 08:00",
    ]);
  });
});

describe("stored reminders", () => {
  const now = new Date("2026-10-05T04:00:00Z");
  const base: Reminder = {
    id: "a",
    text: "Ask switchboard for the new pager list",
    dueAt: "2026-10-05T03:00:00Z",
    createdAt: "2026-10-04T23:30:00Z",
    doneAt: null,
  };

  it("drops garbage, old done notes and anything that fails the patient check", () => {
    const list = normalizeReminders(
      [
        base,
        { ...base, id: "done-old", doneAt: "2026-10-03T00:00:00Z" },
        { ...base, id: "unsafe", text: "Call JS bed 12" },
        { nonsense: true },
      ],
      now,
    );
    expect(list.map((item) => item.id)).toEqual(["a"]);
    expect(normalizeReminders("not a list", now)).toEqual([]);
  });

  it("due means due now or earlier and not ticked off", () => {
    const later = { ...base, id: "later", dueAt: "2026-10-05T09:00:00Z" };
    const done = { ...base, id: "done", doneAt: "2026-10-05T03:30:00Z" };
    expect(dueReminders([base, later, done], now).map((item) => item.id)).toEqual(["a"]);
  });
});

describe("end-of-shift card", async () => {
  const { endOfShiftCard } = await import("@/lib/alerts/end-of-shift");
  const ward = { label: "Ward 4 day shift", startsAt: "2026-10-05T00:00:00Z", endsAt: "2026-10-05T08:30:00Z" };

  it("shows in the last 30 minutes of a shift that has started", () => {
    expect(endOfShiftCard(new Date("2026-10-05T08:00:00Z"), [ward])).toEqual({
      label: "Ward 4 day shift",
      endsAt: ward.endsAt,
      minutesLeft: 30,
    });
  });

  it("not before, not after, and not with no rostered shift", () => {
    expect(endOfShiftCard(new Date("2026-10-05T07:59:00Z"), [ward])).toBeNull();
    expect(endOfShiftCard(new Date("2026-10-05T08:30:00Z"), [ward])).toBeNull();
    expect(endOfShiftCard(new Date("2026-10-05T08:00:00Z"), [])).toBeNull();
  });
});

describe("reminder time labels", async () => {
  const { reminderWhenLabel } = await import("@/lib/alerts/remind-me");
  const now = new Date("2026-10-04T23:30:00Z"); // Mon 07:30 Perth
  const at = (dueAt: string, doneAt: string | null = null) =>
    reminderWhenLabel({ id: "x", text: "t", dueAt, createdAt: now.toISOString(), doneAt }, now);

  it("says due, today, tomorrow or the weekday", () => {
    expect(at("2026-10-04T23:00:00Z")).toBe("Due 07:00");
    expect(at("2026-10-05T04:00:00Z")).toBe("Today 12:00");
    expect(at("2026-10-06T00:00:00Z")).toBe("Tomorrow 08:00");
    expect(at("2026-10-07T00:00:00Z")).toBe("Wed 08:00");
    expect(at("2026-10-05T04:00:00Z", "2026-10-05T00:00:00Z")).toBe("Done");
  });
});

describe("Remind me edge cases", () => {
  const note = (id: string, dueAt: string, createdAt: string, doneAt: string | null = null): Reminder => ({
    id,
    text: "Chase the ECG report",
    dueAt,
    createdAt,
    doneAt,
  });

  it("a night shift is offered 08:00 this morning, not the day after", () => {
    const twoAm = new Date("2026-10-04T18:00:00Z"); // Mon 5 Oct 02:00 Perth
    const options = remindMeWhenOptions(twoAm, null);
    const morning = options.find((option) => option.id === "morning");
    expect(morning?.label).toBe("08:00");
    expect(morning?.dueAt).toBe("2026-10-05T00:00:00.000Z");
    expect(options.some((option) => option.id === "tomorrow")).toBe(false);
  });

  it("over the cap, ticked-off notes go before any still to do", () => {
    const now = new Date("2026-10-05T02:00:00Z");
    const list = Array.from({ length: 21 }, (_, index) =>
      note(
        `n${index}`,
        new Date(now.getTime() + index * 60_000).toISOString(),
        new Date(now.getTime() - (21 - index) * 60_000).toISOString(),
        index === 20 ? now.toISOString() : null,
      ),
    );
    const kept = normalizeReminders(list, now);
    expect(kept).toHaveLength(20);
    expect(kept.every((item) => item.doneAt === null)).toBe(true);
  });

  it("overdue notes from an earlier day say which day", () => {
    const now = new Date("2026-10-05T04:00:00Z"); // Mon 12:00 Perth
    expect(reminderWhenLabel(note("a", "2026-10-04T04:00:00Z", "2026-10-04T00:00:00Z"), now)).toBe(
      "Due yesterday 12:00",
    );
    expect(reminderWhenLabel(note("b", "2026-10-02T04:00:00Z", "2026-10-02T00:00:00Z"), now)).toBe("Due Fri 12:00");
    expect(reminderWhenLabel(note("c", "2026-10-05T01:00:00Z", "2026-10-05T00:00:00Z"), now)).toBe("Due 09:00");
  });

  it("refuses dates of birth and phone numbers, and the safer wording drops them", () => {
    expect(checkReminderText("check 01/02/1980")?.title).toBe("This looks like a date of birth");
    expect(checkReminderText("D.O.B. 1 Feb 1980 bloods")).not.toBeNull();
    expect(checkReminderText("call 0412 345 678")?.title).toBe("This looks like a phone number");
    const landline = checkReminderText("ring (08) 9224 1234 re results");
    expect(landline?.suggestion).toBe("ring about results");
    // Ordinary shorthand and times still pass.
    for (const ok of ["Review in 2/7", "Book CPD course 12/10", "Ring pharmacy at 12:00", "call ext 4321"]) {
      expect(checkReminderText(ok), ok).toBeNull();
    }
  });
});
