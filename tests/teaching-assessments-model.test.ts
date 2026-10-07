import { describe, expect, it } from "vitest";

import {
  assessmentsReducer,
  bookableDay,
  compareRatings,
  currentStepNumber,
  dayStatus,
  doctorActions,
  endOfTermLine,
  endOfTermPill,
  endOfTermSteps,
  epaNeedMore,
  epaRecords,
  formBlockers,
  initialAssessmentsState,
  looksLikePatientDetails,
  reportSummary,
  stage,
  suggestedGoals,
  supervisorTodo,
  talkingPoints,
  todayLabel,
  weeksDone,
  type AssessmentsAction,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";
import { EXAMPLE_ANSWERS, SAMPLE_MIDTERM } from "@/lib/teaching/assessments/sample";

const run = (...actions: AssessmentsAction[]) =>
  actions.reduce<AssessmentsState>((s, a) => assessmentsReducer(s, a), initialAssessmentsState());

/** The happy path up to (and including) a named point, as the mock-up's story runs it. */
function storyTo(point: "self" | "sent" | "ready" | "booked" | "met" | "sup-signed" | "doc-signed") {
  const order = ["self", "sent", "ready", "booked", "met", "sup-signed", "doc-signed"] as const;
  const steps: Record<(typeof order)[number], AssessmentsAction[]> = {
    self: [
      { type: "form-example", who: "self" },
      { type: "form-finish", who: "self" },
    ],
    sent: [{ type: "send-request" }],
    ready: [
      { type: "form-example", who: "sup" },
      { type: "form-finish", who: "sup" },
    ],
    booked: [
      { type: "set-now", now: 1 },
      { type: "book", day: 2, time: "14:30" },
    ],
    met: [{ type: "set-now", now: 2 }, { type: "meeting-held" }],
    "sup-signed": [{ type: "sign", who: "sup", typed: "Robin Wattle", image: null }],
    "doc-signed": [{ type: "sign", who: "self", typed: "Sam Karri", image: null }],
  };
  const actions = order.slice(0, order.indexOf(point) + 1).flatMap((k) => steps[k]);
  return run(...actions);
}

describe("Teaching assessments: home on Mon 5 Oct (week 6)", () => {
  const s = initialAssessmentsState();

  it("counts weeks and the made-up date", () => {
    expect(todayLabel(s)).toBe("Mon 5 Oct");
    expect(weeksDone(s)).toBe(35);
  });

  it("counts 8 EPAs recorded and at least 3 more needed", () => {
    expect(epaRecords(s)).toHaveLength(8);
    expect(epaNeedMore(s)).toBe(3);
  });

  it("shows 2 doctor actions: EPA 1 and starting the end-of-term", () => {
    expect(doctorActions(s)).toBe(2);
    expect(stage(s)).toBe("start");
    expect(endOfTermLine(s)).toBe("Rate yourself first (optional), then ask Dr Wattle");
    expect(endOfTermPill(s)).toEqual({ label: "Not started", tone: "accent" });
  });

  it("stops counting EPA 1 once it is requested, and again once it is recorded", () => {
    const requested = assessmentsReducer(s, { type: "request-epa", epa: 1, who: "sup" });
    expect(doctorActions(requested)).toBe(1);
    const recorded = assessmentsReducer(requested, { type: "record-epa", index: 0, level: "proximal" });
    expect(epaRecords(recorded)).toHaveLength(9);
    // EPA 1 done this term: still owed in term 5, plus EPA 4 needs one more = 2.
    expect(epaNeedMore(recorded)).toBe(2);
  });

  it("refuses a second request for the same EPA while one is waiting", () => {
    const once = assessmentsReducer(s, { type: "request-epa", epa: 1, who: "sup" });
    const twice = assessmentsReducer(once, { type: "request-epa", epa: 1, who: "reg" });
    expect(twice.epaRequests).toHaveLength(1);
  });

  it("lets the supervisor record an EPA without a request, and Undo removes it", () => {
    const saved = assessmentsReducer(s, { type: "record-epa-direct", epa: 1, level: "minimal", note: " Clear plans " });
    expect(epaRecords(saved)).toHaveLength(9);
    expect(saved.epaRequests[0]).toMatchObject({
      epa: 1,
      who: "sup",
      status: "done",
      direct: true,
      note: "Clear plans",
    });
    expect(doctorActions(saved)).toBe(1);
    const undone = assessmentsReducer(saved, { type: "undo-record-epa", index: 0 });
    expect(undone.epaRequests).toHaveLength(0);
    expect(epaRecords(undone)).toHaveLength(8);
  });

  it("puts a requested EPA back to waiting on Undo, keeping the doctor's request", () => {
    const requested = assessmentsReducer(s, { type: "request-epa", epa: 1, who: "sup" });
    const recorded = assessmentsReducer(requested, {
      type: "record-epa",
      index: 0,
      level: "direct",
      note: "Keep it up",
    });
    expect(recorded.epaRequests[0]).toMatchObject({ status: "done", level: "direct", note: "Keep it up" });
    const undone = assessmentsReducer(recorded, { type: "undo-record-epa", index: 0 });
    expect(undone.epaRequests).toEqual([{ epa: 1, who: "sup", status: "requested" }]);
    // A second Undo changes nothing.
    expect(assessmentsReducer(undone, { type: "undo-record-epa", index: 0 })).toBe(undone);
  });
});

describe("Teaching assessments: the end-of-term story", () => {
  it("moves through every stage in order", () => {
    expect(stage(storyTo("self"))).toBe("self-done");
    expect(stage(storyTo("sent"))).toBe("requested");
    expect(stage(storyTo("ready"))).toBe("ready");
    expect(stage(storyTo("met"))).toBe("met");
    expect(stage(storyTo("sup-signed"))).toBe("sup-signed");
    expect(stage(storyTo("doc-signed"))).toBe("doc-signed");
  });

  it("marks the supervisor's form as a draft once she saves part of it", () => {
    const s = run({ type: "send-request" }, { type: "set-rating", who: "sup", domain: 1, rating: 4 });
    expect(stage(s)).toBe("sup-draft");
    expect(endOfTermLine(s)).toBe("Sent to Dr Wattle. She's preparing her view.");
  });

  it("counts nothing for the doctor once the meeting is booked and EPA 1 is requested", () => {
    const s = assessmentsReducer(storyTo("booked"), { type: "request-epa", epa: 1, who: "sup" });
    expect(doctorActions(s)).toBe(0);
    expect(endOfTermLine(s)).toBe("Dr Wattle's draft is done. Meeting Wed 28 Oct, 14:30.");
  });

  it("asks the doctor to book once the window opens", () => {
    const s = assessmentsReducer(storyTo("ready"), { type: "set-now", now: 0 });
    expect(endOfTermPill(s)).toEqual({ label: "Book your meeting", tone: "accent" });
    expect(doctorActions(s)).toBe(2);
  });

  it("says booking opens Mon 26 Oct before the window", () => {
    const s = storyTo("ready");
    expect(endOfTermLine(s)).toBe("Dr Wattle's draft is done. Booking opens Mon 26 Oct.");
  });

  it("gives the doctor a turn to sign after the supervisor signs", () => {
    const s = storyTo("sup-signed");
    expect(endOfTermPill(s)).toEqual({ label: "Your turn to sign", tone: "warm" });
    expect(endOfTermLine(s)).toBe("Dr Wattle has signed. Read your report and sign.");
  });

  it("never says sent until the doctor emails the PDF", () => {
    const signed = storyTo("doc-signed");
    expect(endOfTermPill(signed)).toEqual({ label: "Not sent yet", tone: "warm" });
    expect(doctorActions(signed)).toBe(2); // EPA 1 still needed, and the email
    const sent = assessmentsReducer(signed, { type: "sent-to-meu" });
    expect(endOfTermLine(sent)).toBe("Emailed to your MEU. The DCT countersigns next.");
    expect(endOfTermPill(sent)).toEqual({ label: "Awaiting DCT countersign", tone: "neutral" });
  });

  it("lists eight steps with the DCT countersign never done here", () => {
    const steps = endOfTermSteps(initialAssessmentsState());
    expect(steps).toHaveLength(8);
    expect(currentStepNumber(steps)).toBe(1);
    const sent = endOfTermSteps(assessmentsReducer(storyTo("doc-signed"), { type: "sent-to-meu" }));
    expect(sent.at(-1)).toMatchObject({ state: "lock", title: "DCT countersigns" });
    expect(currentStepNumber(sent)).toBe(8);
  });

  it("dates the request on the made-up day it was sent and never claims a real email", () => {
    const s = run({ type: "set-now", now: 1 }, { type: "send-request" }, { type: "set-now", now: 4 });
    expect(endOfTermSteps(s)[1]).toMatchObject({ state: "ok", detail: "Sent Tue 27 Oct" });
    const sent = endOfTermSteps(assessmentsReducer(storyTo("doc-signed"), { type: "sent-to-meu" }));
    expect(sent[6].detail).toBe("Marked as sent (made-up)");
  });

  it("flags a late supervisor from Thu 5 Nov", () => {
    const late = run({ type: "send-request" }, { type: "set-now", now: 8 });
    expect(endOfTermSteps(late)[2]).toMatchObject({ state: "now", detail: "Not finished yet" });
    const early = run({ type: "send-request" }, { type: "set-now", now: 6 });
    expect(endOfTermSteps(early)[2]?.detail).toBe("In progress");
  });
});

describe("Teaching assessments: locks and guards", () => {
  it("locks the self-assessment once the supervisor's draft is done", () => {
    const s = storyTo("ready");
    const edited = assessmentsReducer(s, { type: "set-rating", who: "self", domain: 1, rating: 1 });
    expect(edited.self.ratings[1]).toBe(EXAMPLE_ANSWERS.self.ratings[1]);
  });

  it("lets the supervisor change answers until she signs, then not", () => {
    const ready = storyTo("ready");
    expect(assessmentsReducer(ready, { type: "set-rating", who: "sup", domain: 1, rating: 5 }).sup.ratings[1]).toBe(5);
    const signed = storyTo("sup-signed");
    expect(assessmentsReducer(signed, { type: "set-rating", who: "sup", domain: 1, rating: 5 }).sup.ratings[1]).toBe(4);
  });

  it("will not mark the meeting held before the booked day", () => {
    const s = assessmentsReducer(storyTo("booked"), { type: "meeting-held" });
    expect(stage(s)).toBe("ready");
  });

  it("will not let the doctor sign before the supervisor", () => {
    const s = assessmentsReducer(storyTo("met"), { type: "sign", who: "self", typed: "Sam Karri", image: null });
    expect(s.sigs.doc).toBeNull();
  });

  it("will not sign with an empty signature", () => {
    const s = assessmentsReducer(storyTo("met"), { type: "sign", who: "sup", typed: "  ", image: null });
    expect(s.sigs.sup).toBeNull();
  });
});

describe("Teaching assessments: booking", () => {
  it("blocks rostered nights and days with no times", () => {
    const s = run({ type: "set-now", now: 0 });
    expect(bookableDay(s, 3)).toBe(false);
    expect(dayStatus(s, 3)).toBe("Nights");
    expect(bookableDay(s, 0)).toBe(false);
    expect(dayStatus(s, 0)).toBe("None");
    expect(dayStatus(s, 2)).toBe("3 times");
    expect(bookableDay(s, 2)).toBe(true);
  });

  it("marks earlier days as past and refuses to book them", () => {
    const s = run({ type: "set-now", now: 5 });
    expect(dayStatus(s, 2)).toBe("Past");
    expect(assessmentsReducer(s, { type: "book", day: 2, time: "14:00" }).booking).toBeNull();
  });

  it("refuses a time the supervisor has not offered", () => {
    const s = run({ type: "set-now", now: 0 }, { type: "book", day: 2, time: "08:00" });
    expect(s.booking).toBeNull();
  });

  it("keeps a booked time offered", () => {
    const s = assessmentsReducer(storyTo("booked"), { type: "toggle-availability", day: 2, time: "14:30" });
    expect(s.avail[2]).toContain("14:30");
  });
});

describe("Teaching assessments: the form", () => {
  it("names exactly what stops the supervisor finishing", () => {
    const s = run(
      { type: "form-example", who: "sup" },
      { type: "set-rating", who: "sup", domain: 4, rating: 2 },
      { type: "set-feedback", who: "sup", domain: 4, value: "" },
    );
    expect(formBlockers(s.sup, "sup")).toEqual(["Add feedback for domain 4.", "Tick to notify the MEU."]);
    const finished = assessmentsReducer(s, { type: "form-finish", who: "sup" });
    expect(finished.sup.status).toBe("draft");
  });

  it("asks the doctor only to rate every domain", () => {
    const s = run({ type: "set-rating", who: "self", domain: 1, rating: 2 });
    expect(formBlockers(s.self, "self")).toEqual(["Rate domain 2, 3, 4."]);
  });

  it("clears the doctor's optional overall rating when tapped again", () => {
    const s = run(
      { type: "set-global", who: "self", rating: "sat" },
      { type: "set-global", who: "self", rating: "sat" },
    );
    expect(s.self.global).toBeNull();
  });

  it("catches some patient details and says nothing about ordinary text", () => {
    for (const text of ["URN 1234567", "Mrs Smith in bed 4", "DOB 3/4/1980", "date of birth"])
      expect(looksLikePatientDetails(text), text).toBe(true);
    expect(looksLikePatientDetails(EXAMPLE_ANSWERS.sup.strengths)).toBe(false);
  });
});

describe("Teaching assessments: reports", () => {
  it("compares the mid-term ratings in the doctor's words", () => {
    const rows = compareRatings(SAMPLE_MIDTERM.self.ratings, SAMPLE_MIDTERM.sup.ratings, "doc", "Sam");
    expect(rows.map((r) => r.message)).toEqual([
      "Same rating",
      "Dr Wattle: 1 higher",
      "Same rating",
      "Dr Wattle: 1 higher",
    ]);
    expect(reportSummary(SAMPLE_MIDTERM.self, SAMPLE_MIDTERM.sup)).toMatch(
      /^You rated yourself lower than Dr Wattle in 2 domains\. Ask her what she saw\. You both ticked \d+ of the \d+ outcomes Dr Wattle observed\.$/,
    );
  });

  it("compares in the supervisor's words", () => {
    const rows = compareRatings(EXAMPLE_ANSWERS.self.ratings, EXAMPLE_ANSWERS.sup.ratings, "sup", "Sam");
    expect(rows[0]?.message).toBe("You: 1 higher");
    expect(rows[1]?.message).toBe("Same rating");
  });

  it("says there is nothing to compare without a self-assessment", () => {
    expect(reportSummary(null, SAMPLE_MIDTERM.sup)).toBe(
      "You didn't rate yourself this time, so there's nothing to compare.",
    );
    expect(compareRatings(null, SAMPLE_MIDTERM.sup.ratings, "doc", "Sam")[0]?.message).toBe("No self-rating");
  });

  it("orders talking points by the biggest gap", () => {
    const points = talkingPoints(
      { ratings: { 1: 3, 2: 4, 3: 1, 4: 3 } },
      { ratings: { 1: 4, 2: 4, 3: 3, 4: 3 } },
      "Sam",
    );
    expect(points).toEqual([
      "Domain 3: Sam rated themselves 2 lower than you. Say what you've seen them do well.",
      "Domain 1: Sam rated themselves 1 lower than you. Say what you've seen them do well.",
    ]);
  });

  it("suggests goals from the two lowest-rated domains", () => {
    expect(suggestedGoals(EXAMPLE_ANSWERS.sup.ratings)).toEqual([
      "Link one patient with community supports before discharge and note what helped.",
      "Join the ward audit or bring one paper to journal club.",
    ]);
  });
});

describe("Teaching assessments: the supervisor", () => {
  it("counts Sam's form and EPAs asked of her", () => {
    const s = run(
      { type: "send-request" },
      { type: "request-epa", epa: 1, who: "sup" },
      { type: "request-epa", epa: 2, who: "reg" },
    );
    expect(supervisorTodo(s)).toBe(4);
  });
});

describe("Teaching assessments: post-build review guards", () => {
  it("does not call the supervisor late on Wed 4 Nov", () => {
    const s = run({ type: "send-request" }, { type: "set-now", now: 7 });
    expect(endOfTermSteps(s)[2]).toMatchObject({ state: "now", detail: "In progress" });
  });

  it("never moves the made-up date before something already recorded", () => {
    const sent = run({ type: "set-now", now: 3 }, { type: "send-request" }, { type: "set-now", now: -1 });
    expect(sent.now).toBe(3);
    const signed = storyTo("doc-signed");
    expect(assessmentsReducer(signed, { type: "set-now", now: 0 }).now).toBe(2);
  });

  it("ignores a made-up date or form step that is not a whole number", () => {
    const s = initialAssessmentsState();
    expect(assessmentsReducer(s, { type: "set-now", now: 1.5 })).toBe(s);
    expect(assessmentsReducer(s, { type: "form-step", who: "self", step: Number.NaN })).toBe(s);
  });

  it("refuses a booking before the window opens or before the supervisor's draft is done", () => {
    const early = storyTo("ready");
    expect(early.now).toBe(-1);
    expect(assessmentsReducer(early, { type: "book", day: 2, time: "14:30" }).booking).toBeNull();
    const notReady = run({ type: "send-request" }, { type: "set-now", now: 1 });
    expect(assessmentsReducer(notReady, { type: "book", day: 2, time: "14:30" }).booking).toBeNull();
  });

  it("does not let the supervisor finish before the doctor has asked", () => {
    const s = run({ type: "form-example", who: "sup" }, { type: "form-finish", who: "sup" });
    expect(s.sup.status).toBe("draft");
  });

  it("turns a finished supervisor form back into a draft if a change leaves a gap", () => {
    const met = storyTo("met");
    const changed = assessmentsReducer(met, { type: "set-feedback", who: "sup", domain: 1, value: "" });
    const low = assessmentsReducer(changed, { type: "set-rating", who: "sup", domain: 1, rating: 1 });
    expect(low.sup.status).toBe("draft");
    expect(
      assessmentsReducer(low, { type: "sign", who: "sup", typed: "Robin Wattle", image: null }).sigs.sup,
    ).toBeNull();
  });

  it("counts the booking prompt only while the supervisor's draft is ready", () => {
    const waiting = run(
      { type: "send-request" },
      { type: "set-now", now: 1 },
      { type: "request-epa", epa: 1, who: "sup" },
    );
    expect(doctorActions(waiting)).toBe(0);
    const ready = run(
      { type: "send-request" },
      { type: "form-example", who: "sup" },
      { type: "form-finish", who: "sup" },
      { type: "set-now", now: 1 },
      { type: "request-epa", epa: 1, who: "sup" },
    );
    expect(doctorActions(ready)).toBe(1);
  });

  it("points at the real current step when the doctor skipped rating herself", () => {
    const s = run({ type: "send-request" }, { type: "form-example", who: "sup" }, { type: "form-finish", who: "sup" });
    const steps = endOfTermSteps(s);
    expect(steps[0]).toMatchObject({ state: "lock", detail: "Skipped" });
    expect(currentStepNumber(steps)).toBe(4);
  });

  it("calls an unfinished self-assessment 'Not finished', not 'Skipped', once it locks", () => {
    const s = run(
      { type: "set-text", who: "self", field: "strengths", value: "x" },
      { type: "send-request" },
      { type: "form-example", who: "sup" },
      { type: "form-finish", who: "sup" },
    );
    expect(endOfTermSteps(s)[0]).toMatchObject({ state: "lock", detail: "Not finished" });
  });

  it("ignores an EPA number or supervision level it does not know", () => {
    const s = initialAssessmentsState();
    expect(assessmentsReducer(s, { type: "request-epa", epa: 9 as never, who: "sup" })).toBe(s);
    const asked = assessmentsReducer(s, { type: "request-epa", epa: 2, who: "sup" });
    const i = asked.epaRequests.length - 1;
    expect(assessmentsReducer(asked, { type: "record-epa", index: i, level: "bogus" as never })).toBe(asked);
  });
});
