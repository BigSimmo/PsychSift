import { describe, expect, it } from "vitest";

import { EPAS, SUPERVISION_LEVELS } from "@/lib/teaching/assessments/content";
import {
  EPA_FEEDBACK_MAX,
  EPA_REPLY_MAX,
  assessmentsReducer,
  doctorActions,
  epaRecords,
  epaRequestWords,
  fromSpecialist,
  initialAssessmentsState,
  openEpaRequests,
  pendingEpaRequest,
  supervisorTodo,
  type AssessmentsAction,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";

const run = (s: AssessmentsState, ...actions: AssessmentsAction[]) => actions.reduce(assessmentsReducer, s);
const asked = () => run(initialAssessmentsState(), { type: "request-epa", epa: 1, who: "sup" });

describe("Teaching assessments: AMC wording", () => {
  it("names the four EPAs and the three supervision levels as the AMC forms do", () => {
    expect(EPAS.map((e) => e.formal)).toEqual([
      "Clinical assessment",
      "Recognition and care of the acutely unwell patient",
      "Prescribing",
      "Team communication: documentation, handover and referrals",
    ]);
    expect(SUPERVISION_LEVELS.map((l) => l.formLabel)).toEqual([
      "Requires direct supervision",
      "Requires proximal supervision",
      "Requires minimal supervision",
    ]);
  });
});

describe("Teaching assessments: an assessor who can't do an EPA", () => {
  it("can't assess yet keeps it with the assessor and tells the doctor", () => {
    const s = run(asked(), { type: "epa-not-yet", index: 0, reply: " I'd like to see a full admission. " });
    expect(s.epaRequests[0]).toMatchObject({ status: "not-yet", reply: "I'd like to see a full admission." });
    expect(pendingEpaRequest(s, 1)).toBe(s.epaRequests[0]);
    expect(supervisorTodo(s)).toBe(supervisorTodo(asked()));
    expect(epaRequestWords(s.epaRequests[0]!)).toEqual({
      line: `Dr Robin Wattle can't assess it yet. "I'd like to see a full admission."`,
      tag: "Not yet",
    });
    // The doctor can't ask for EPA 1 twice while it is still with the assessor.
    expect(assessmentsReducer(s, { type: "request-epa", epa: 1, who: "reg" })).toBe(s);
  });

  it("a not-yet request can still be recorded, and the reply goes", () => {
    const s = run(
      asked(),
      { type: "epa-not-yet", index: 0 },
      { type: "record-epa", index: 0, level: "proximal", complexity: "medium" },
    );
    expect(s.epaRequests[0]).toEqual({ epa: 1, who: "sup", status: "done", level: "proximal", complexity: "medium" });
    expect(epaRecords(s).at(-1)).toMatchObject({ epa: 1, level: "proximal", complexity: "medium" });
  });

  it("send back needs a short note with no patient details", () => {
    const s = asked();
    expect(assessmentsReducer(s, { type: "epa-send-back", index: 0, reply: "  " })).toBe(s);
    expect(assessmentsReducer(s, { type: "epa-send-back", index: 0, reply: "x".repeat(EPA_REPLY_MAX + 1) })).toBe(s);
    expect(assessmentsReducer(s, { type: "epa-send-back", index: 0, reply: "UMRN A1234567, bed 12" })).toBe(s);
    expect(assessmentsReducer(s, { type: "epa-not-yet", index: 0, reply: "UMRN A1234567, bed 12" })).toBe(s);
  });

  it("send back returns it to the doctor, who can ask someone else", () => {
    const back = run(asked(), { type: "epa-send-back", index: 0, reply: "Ask the night registrar." });
    expect(back.epaRequests[0]).toMatchObject({ status: "sent-back", reply: "Ask the night registrar." });
    expect(pendingEpaRequest(back, 1)).toBeUndefined();
    expect(supervisorTodo(back)).toBe(supervisorTodo(asked()) - 1);
    expect(openEpaRequests(back)).toHaveLength(1);
    // A sent-back EPA 2 also counts as the doctor's to do.
    const two = run(
      initialAssessmentsState(),
      { type: "request-epa", epa: 2, who: "reg" },
      { type: "epa-send-back", index: 0, reply: "Wrong week." },
    );
    expect(doctorActions(two)).toBe(doctorActions(initialAssessmentsState()) + 1);
    // Asking again replaces the sent-back one.
    const again = assessmentsReducer(back, { type: "request-epa", epa: 1, who: "reg" });
    expect(again.epaRequests.map((r) => r.status)).toEqual(["cancelled", "requested"]);
    expect(openEpaRequests(again).map(({ index }) => index)).toEqual([1]);
  });

  it("undo puts the request back to waiting, and can't happen twice", () => {
    const back = run(asked(), { type: "epa-send-back", index: 0, reply: "Wrong week." });
    const undone = assessmentsReducer(back, { type: "undo-epa-answer", index: 0 });
    expect(undone.epaRequests[0]).toEqual({ epa: 1, who: "sup", status: "requested" });
    expect(assessmentsReducer(undone, { type: "undo-epa-answer", index: 0 })).toBe(undone);
  });

  it("a recorded or sent-back request can't be put off again", () => {
    const recorded = run(asked(), { type: "record-epa", index: 0, level: "minimal" });
    expect(assessmentsReducer(recorded, { type: "epa-not-yet", index: 0 })).toBe(recorded);
    expect(assessmentsReducer(recorded, { type: "epa-send-back", index: 0, reply: "No" })).toBe(recorded);
    const back = run(asked(), { type: "epa-send-back", index: 0, reply: "Wrong week." });
    expect(assessmentsReducer(back, { type: "epa-not-yet", index: 0 })).toBe(back);
    expect(assessmentsReducer(back, { type: "record-epa", index: 0, level: "minimal" })).toBe(back);
  });
});

describe("Teaching assessments: the doctor cancelling a request", () => {
  it("cancels in place, so other requests keep their place, and undo restores it", () => {
    const two = run(asked(), { type: "request-epa", epa: 3, who: "reg" });
    const cancelled = assessmentsReducer(two, { type: "cancel-epa-request", index: 0 });
    expect(cancelled.epaRequests.map((r) => r.status)).toEqual(["cancelled", "requested"]);
    expect(openEpaRequests(cancelled).map(({ index }) => index)).toEqual([1]);
    expect(assessmentsReducer(cancelled, { type: "cancel-epa-request", index: 0 })).toBe(cancelled);
    const restored = assessmentsReducer(cancelled, {
      type: "restore-epa-request",
      index: 0,
      request: two.epaRequests[0]!,
    });
    expect(restored.epaRequests).toEqual(two.epaRequests);
  });

  it("undo of a cancel does nothing once the doctor has asked again", () => {
    const s = asked();
    const cancelled = assessmentsReducer(s, { type: "cancel-epa-request", index: 0 });
    const again = assessmentsReducer(cancelled, { type: "request-epa", epa: 1, who: "reg" });
    expect(assessmentsReducer(again, { type: "restore-epa-request", index: 0, request: s.epaRequests[0]! })).toBe(
      again,
    );
  });

  it("a recorded EPA can't be cancelled", () => {
    const recorded = run(asked(), { type: "record-epa", index: 0, level: "minimal" });
    expect(assessmentsReducer(recorded, { type: "cancel-epa-request", index: 0 })).toBe(recorded);
  });
});

describe("Assessments: someone else as assessor, and the full EPA form", () => {
  const guest = (kind: "nurse" | "specialist") =>
    assessmentsReducer(initialAssessmentsState(), { type: "request-epa", epa: 2, who: "guest", guest: kind });

  it("asks a nurse by role, and needs the role", () => {
    const s = guest("nurse");
    const r = s.epaRequests.at(-1)!;
    expect(r).toMatchObject({ epa: 2, who: "guest", guest: "nurse", status: "requested" });
    expect(epaRequestWords(r).line).toBe("Requested from a nurse");
    const none = assessmentsReducer(initialAssessmentsState(), { type: "request-epa", epa: 2, who: "guest" });
    expect(none.epaRequests.some((x) => x.who === "guest")).toBe(false);
  });

  it("keeps the role through can't assess yet and undo", () => {
    let s = guest("nurse");
    const index = s.epaRequests.length - 1;
    s = assessmentsReducer(s, { type: "epa-not-yet", index });
    expect(s.epaRequests[index]).toMatchObject({ guest: "nurse", status: "not-yet" });
    expect(epaRequestWords(s.epaRequests[index]!).line).toBe("A nurse can't assess it yet.");
    s = assessmentsReducer(s, { type: "undo-epa-answer", index });
    expect(s.epaRequests[index]).toMatchObject({ guest: "nurse", status: "requested" });
  });

  it("records the whole AMC form, and only a specialist counts as this term's specialist EPA", () => {
    for (const kind of ["nurse", "specialist"] as const) {
      let s = guest(kind);
      const index = s.epaRequests.length - 1;
      s = assessmentsReducer(s, {
        type: "record-epa",
        index,
        level: "proximal",
        note: "Clear escalation.",
        feedback: { observed: "team", rightLevel: true, better: "  ", goal: "Lead the next MET call." },
      });
      const r = s.epaRequests[index]!;
      expect(r.feedback).toEqual({ observed: "team", rightLevel: true, goal: "Lead the next MET call." });
      const record = epaRecords(s).at(-1)!;
      expect(record.by).toBe("Guest assessor");
      expect(fromSpecialist(record)).toBe(kind === "specialist");
    }
  });

  it("refuses feedback that looks like patient details or runs too long", () => {
    const s = guest("nurse");
    const index = s.epaRequests.length - 1;
    const tried = (feedback: { better?: string; goal?: string }) =>
      assessmentsReducer(s, { type: "record-epa", index, level: "direct", feedback }).epaRequests[index]!.status;
    expect(tried({ better: "URN 1234567 was unwell" })).toBe("requested");
    expect(tried({ goal: "x".repeat(EPA_FEEDBACK_MAX + 1) })).toBe("requested");
    expect(tried({ goal: "Lead a handover." })).toBe("done");
  });
});

describe("Assessments: Undo puts an answer back exactly", () => {
  it("restores a 'not yet' and its note after a send back", () => {
    let s = assessmentsReducer(initialAssessmentsState(), { type: "request-epa", epa: 1, who: "sup" });
    s = assessmentsReducer(s, { type: "epa-not-yet", index: 0, reply: "I'd like to see a full admission." });
    const before = s.epaRequests[0]!;
    s = assessmentsReducer(s, { type: "epa-send-back", index: 0, reply: "Ask the night registrar." });
    s = assessmentsReducer(s, { type: "undo-epa-answer", index: 0, previous: before });
    expect(s.epaRequests[0]).toEqual(before);
  });
});
