import { describe, expect, it } from "vitest";

import {
  assessmentsReducer,
  initialAssessmentsState,
  type AssessmentsAction,
  type AssessmentsState,
} from "@/lib/teaching/assessments/model";

/* Undo after an EPA answer or a save restores only its own step (review findings on PR 3382, 9 Oct 2026). */

const run = (s: AssessmentsState, ...actions: AssessmentsAction[]) =>
  actions.reduce<AssessmentsState>((acc, a) => assessmentsReducer(acc, a), s);
const asked = () => run(initialAssessmentsState(), { type: "request-epa", epa: 1, who: "sup" });

describe("Assessments undo order", () => {
  it("an older Undo never reverses a newer answer", () => {
    const start = asked();
    const first = run(start, { type: "epa-not-yet", index: 0, reply: "Next week." });
    const second = run(first, { type: "epa-send-back", index: 0, reply: "Ask the night registrar." });
    const undone = run(second, {
      type: "undo-epa-answer",
      index: 0,
      previous: start.epaRequests[0],
      answered: { status: "not-yet", reply: "Next week." },
    });
    expect(undone.epaRequests[0]).toMatchObject({ status: "sent-back", reply: "Ask the night registrar." });
  });

  it("undoing a save made after Can't assess yet goes back to not yet, note kept", () => {
    const notYet = run(asked(), { type: "epa-not-yet", index: 0, reply: "Next week." });
    const saved = run(notYet, { type: "record-epa", index: 0, level: "proximal" });
    expect(saved.epaRequests[0]?.status).toBe("done");
    const undone = run(saved, { type: "undo-record-epa", index: 0, previous: notYet.epaRequests[0] });
    expect(undone.epaRequests[0]).toMatchObject({ status: "not-yet", reply: "Next week." });
  });
});
