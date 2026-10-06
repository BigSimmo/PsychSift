import { describe, expect, it } from "vitest";

import {
  afterLabel,
  deidConfirmedNote,
  feedbackSummary,
  readinessAction,
  readinessCount,
  supervisionLabel,
  supervisionSummary,
  talkKicker,
  upcomingTalkMeta,
} from "@/components/teaching/presenting-model";
import { demoFeedbackTotals, demoSupervision, demoTeach } from "@/lib/teaching/depth-demo";

/* Presenting against its mock-up (v5 screen 02), on the made-up presenter. Tue 6 Oct 2026 12:35 Perth. */

const NB = "\u00a0";
const NOW = new Date("2026-10-06T04:35:00Z");
const TODAY = "2026-10-06";

describe("Presenting's made-up presenter", () => {
  const read = demoTeach(TODAY, NOW);
  const [next, ...after] = read.upcoming;

  it("has the journal club next today at 14:00, three of four ready, its patient check confirmed", () => {
    expect(talkKicker(next, NOW, TODAY)).toBe(`Your next talk · today 14:00 · in 85${NB}min`);
    expect(next.title).toBe("Journal club");
    expect(next.venue).toBe("Library meeting room");
    expect(readinessCount(next)).toBe(`3${NB}of 4`);
    expect(readinessAction(next)).toEqual({ kind: "item", item: "room", label: "Confirm the room" });
    expect(deidConfirmedNote(next.deidConfirmedAt!)).toBe(
      `No patient details in the slides. You confirmed this on 4${NB}Oct.`,
    );
    expect(next.itemNotes).toMatchObject({ reading_list: "Shared 2 Oct", slides_link: "Added 4 Oct" });
  });

  it("lists three later talks after today, and six talks given", () => {
    expect(afterLabel(next, after, TODAY, true)).toBe("After today");
    expect(after.map((talk) => `${talk.title} · ${upcomingTalkMeta(talk)}`)).toEqual([
      `Registrar teaching · Tue 16:00 · 1${NB}of 4 ready`,
      "Grand rounds · Tue 17:00 · not started",
      "Case presentation · Tue 12:30 · not started",
    ]);
    expect(read.taught).toHaveLength(6);
    expect(read.taught[0].title).toBe("Case presentation");
    expect(feedbackSummary(demoFeedbackTotals())).toMatchObject({ answers: "9 answers", usefulness: "4.4" });
  });

  it("names every made-up title and room plainly, without a Demo prefix", () => {
    for (const talk of [...read.upcoming, ...read.taught]) expect(talk.title).not.toMatch(/^Demo /);
    for (const talk of read.upcoming) expect(talk.venue).not.toMatch(/^Demo /);
  });

  it("moves the talk to tomorrow once today's has ended", () => {
    const evening = new Date("2026-10-06T07:00:00Z"); // 15:00 Perth
    expect(talkKicker(demoTeach(TODAY, evening).upcoming[0], evening, TODAY)).toBe("Your next talk · Wed 7 Oct 14:00");
  });

  it("shows 31 h of a 50 h target this year, the latest hour waiting and the group session confirmed", () => {
    const pairings = demoSupervision(TODAY, { supervising: false });
    expect(supervisionLabel(pairings, TODAY)).toBe("Supervision this year");
    const summary = supervisionSummary(pairings);
    expect(summary.mine).toEqual({
      confirmed: `31${NB}h`,
      targetLine: `of your 50${NB}h target`,
      toGo: `19${NB}h to go`,
      percent: 62,
    });
    expect(summary.entries.map((entry) => entry.meta)).toEqual([
      `1 Oct · 60${NB}min · waiting for your supervisor to confirm`,
      `24 Sep · 90${NB}min · confirmed`,
    ]);
    expect(summary.toConfirm).toBe(0);
    // The Supervision page's demo keeps a made-up trainee whose entries can be confirmed.
    expect(supervisionSummary(demoSupervision(TODAY)).toConfirm).toBe(2);
  });
});

describe("Presenting's wording rules", () => {
  it("names the later talks by where they sit", () => {
    const read = demoTeach(TODAY, NOW);
    const [next, ...after] = read.upcoming;
    expect(afterLabel(undefined, after, TODAY, true)).toBe("After today");
    expect(afterLabel(next, after, TODAY, false)).toBe("Your other talks");
    const tomorrow = { ...next, startsAt: "2026-10-07T06:00:00.000Z", endsAt: "2026-10-07T06:45:00.000Z" };
    expect(afterLabel(tomorrow, after, TODAY, true)).toBe("After this one");
  });

  it("says this year only while every pairing began this year", () => {
    const [pairing] = demoSupervision(TODAY, { supervising: false });
    expect(supervisionLabel([{ ...pairing, startsOn: "2025-12-01" }], TODAY)).toBe("Supervision");
    expect(supervisionLabel([], TODAY)).toBe("Supervision");
  });

  it("writes a talk more than two hours away in hours", () => {
    const talk = { ...demoTeach(TODAY, NOW).upcoming[0], startsAt: "2026-10-06T08:00:00.000Z" };
    expect(talkKicker(talk, NOW, TODAY)).toBe(`Your next talk · today 16:00 · in 3${NB}h 25${NB}min`);
  });
});
