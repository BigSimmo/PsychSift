import { describe, expect, it } from "vitest";

import { resolveRole } from "@/components/teaching/assessments/teaching-assessments";
import {
  dctForm,
  dctForms,
  dctReducer,
  dctWaiting,
  initialDctState,
  windowDayPlus,
} from "@/lib/teaching/assessments/dct";
import { assessmentsReducer, initialAssessmentsState, type AssessmentsAction } from "@/lib/teaching/assessments/model";

const SIGNED_BY_BOTH: AssessmentsAction[] = [
  { type: "form-example", who: "self" },
  { type: "form-finish", who: "self" },
  { type: "send-request" },
  { type: "form-example", who: "sup" },
  { type: "form-finish", who: "sup" },
  { type: "set-now", now: 1 },
  { type: "book", day: 2, time: "14:30" },
  { type: "set-now", now: 2 },
  { type: "meeting-held" },
  { type: "sign", who: "sup", typed: "Robin Wattle", image: null },
  { type: "sign", who: "self", typed: "Sam Karri", image: null },
];

describe("Assessments: the DCT's queue", () => {
  it("starts with the two made-up term 3 forms", () => {
    const s = initialAssessmentsState();
    expect(dctForms(s).map((f) => f.id)).toEqual(["ella-t3", "noah-t3"]);
    // On Mon 5 Oct one doctor's 14 days are still running and the other's have ended.
    expect(dctForm(s, "ella-t3")?.responseOpen).toBe(true);
    expect(dctForm(s, "noah-t3")?.responseOpen).toBe(false);
  });

  it("closes the 14 days once the made-up date moves past them", () => {
    const s = assessmentsReducer(initialAssessmentsState(), { type: "set-now", now: 0 });
    expect(dctForm(s, "ella-t3")?.responseOpen).toBe(false);
  });

  it("adds Sam's form only once both have signed it, with 14 days to reply", () => {
    const s = SIGNED_BY_BOTH.reduce(assessmentsReducer, initialAssessmentsState());
    expect(s.sigs.doc).not.toBeNull();
    const sam = dctForm(s, "sam-t4");
    expect(sam).not.toBeNull();
    expect(sam?.bothSigned).toBe(s.sigs.doc?.date);
    expect(sam?.responseUntil).toBe(windowDayPlus(s.sigs.doc!.day, 14));
    expect(dctForms(s)[0]?.id).toBe("sam-t4");
  });

  it("counts 14 days across the month", () => {
    expect(windowDayPlus(0, 14)).toBe("Mon 9 Nov");
    expect(windowDayPlus(9, 14)).toBe("Fri 20 Nov");
  });

  it("signs, refuses a second signature, and takes it back", () => {
    const s = initialAssessmentsState();
    const signed = dctReducer(initialDctState(), {
      type: "dct-sign",
      id: "noah-t3",
      date: "Mon 5 Oct",
      feedback: "  Well done.  ",
    });
    expect(signed.signed["noah-t3"]).toEqual({ date: "Mon 5 Oct", feedback: "Well done." });
    expect(dctWaiting(s, signed).map((f) => f.id)).toEqual(["ella-t3"]);
    expect(dctReducer(signed, { type: "dct-sign", id: "noah-t3", date: "Tue 6 Oct", feedback: "" })).toBe(signed);
    expect(dctReducer(signed, { type: "dct-unsign", id: "noah-t3" }).signed).toEqual({});
  });
});

describe("Assessments: whose screen it is", () => {
  it("keeps the DCT on shared tabs and gives the DCT their own screens", () => {
    expect(resolveRole("home", "dct", "doctor")).toBe("dct");
    expect(resolveRole("progress", null, "dct")).toBe("dct");
    expect(resolveRole("overview", null, "dct")).toBe("dct");
    expect(resolveRole("dctsign", null, "doctor")).toBe("dct");
    expect(resolveRole("plan", "supervisor", "supervisor")).toBe("dct");
    expect(resolveRole("hub", "dct", "dct")).toBe("doctor");
  });
});
