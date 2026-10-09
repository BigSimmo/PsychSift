import { describe, expect, it } from "vitest";

import { resolveRole } from "@/components/teaching/assessments/teaching-assessments";
import { GLOSSARY, MEU_HOW_TO_REACH } from "@/lib/teaching/assessments/content";
import { extrasReducer, initialExtras, readyToSend } from "@/lib/teaching/assessments/extras";
import { EMPTY_ANSWER, claCopyText, inboxRequests } from "@/lib/teaching/assessments/inbox";
import {
  assessmentsReducer,
  initialAssessmentsState,
  kindsDone,
  type AssessmentsAction,
} from "@/lib/teaching/assessments/model";
import {
  SAMPLE_TERMS,
  delegatedEndOfTermLine,
  kindName,
  registrarMidTermLine,
  sampleTerm,
  termKinds,
  termKindsLabel,
  termNumbers,
  termsWithKind,
} from "@/lib/teaching/assessments/sample";
import {
  KINDS_PER_TERM_RULE,
  PGY1_SERVICE_TERM_RULE,
  PGY1_TERM_LINES,
  TRANSCRIPT_LINE,
} from "@/lib/teaching/assessments/year-rules";

/* Owner-approved additions 11 to 20 (assessments review 2, rules audit M5 to M12, site audit A1 to A9). */

describe("Kinds of experience: 1 or 2 per term (rules audit M6)", () => {
  it("counts both kinds of a term accredited for two", () => {
    expect(kindsDone([{ status: "done", category: "A", category2: { letter: "C", name: "Acute" } }])).toBe(2);
    expect(kindsDone([{ status: "current", category: "A", category2: { letter: "C", name: "Acute" } }])).toBe(0);
  });

  it("gives the made-up year one two-kind term without changing what is done", () => {
    expect(SAMPLE_TERMS.filter((t) => t.category2)).toHaveLength(1);
    expect(termKinds(sampleTerm("t1"))).toEqual(["A", "C"]);
    expect(termKindsLabel(sampleTerm("t1"))).toBe("A and C · Undifferentiated illness and acute and critical illness");
    expect(kindsDone(SAMPLE_TERMS)).toBe(3);
    expect(termsWithKind("C", "done").map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(termNumbers(termsWithKind("C", "done"))).toBe("Terms 1 and 3");
    expect(termNumbers(termsWithKind("D", "done"))).toBe("Term 2");
    expect(kindName("C")).toBe("Acute and critical illness");
  });
});

describe("Year rules (rules audit M5 to M7, M11)", () => {
  it("states the PGY1 term rules with their sourced limits", () => {
    expect(PGY1_TERM_LINES).toContain("At least 4\u00a0terms in different specialties.");
    expect(PGY1_TERM_LINES.join(" ")).toMatch(/clinical team for at least half the year/);
    expect(PGY1_TERM_LINES.join(" ")).toMatch(/admission or short-stay ward with several supervisors/);
    expect(PGY1_SERVICE_TERM_RULE).toMatch(/no more than 1\u00a0term in a 4- or 5-term year/);
    expect(KINDS_PER_TERM_RULE).toMatch(/1 or 2 kinds of experience/);
    expect(TRANSCRIPT_LINE).toMatch(/transcript of learning/);
  });

  it("keeps rule text free of semicolons, em dashes and arrows", () => {
    for (const line of [...PGY1_TERM_LINES, MEU_HOW_TO_REACH, ...GLOSSARY.map(([, m]) => m)]) {
      expect(line).not.toMatch(/[;\u2014\u2192]/);
    }
  });
});

describe("Delegation in the made-up story (rules audit M8, site audit A7)", () => {
  it("has one end-of-term completed by a clinical supervisor and countersigned by the term supervisor", () => {
    const delegated = SAMPLE_TERMS.filter((t) => delegatedEndOfTermLine(t));
    expect(delegated.map((t) => t.id)).toEqual(["t2"]);
    expect(delegatedEndOfTermLine(sampleTerm("t2"))).toBe(
      "Completed by Dr Morgan Wandoo (clinical supervisor) and countersigned by Dr Casey Marri (term supervisor) on 30 Jun (made-up).",
    );
  });

  it("has one mid-term by a registrar, signed off by the primary clinical supervisor", () => {
    expect(SAMPLE_TERMS.filter((t) => registrarMidTermLine(t)).map((t) => t.id)).toEqual(["t3"]);
    expect(registrarMidTermLine(sampleTerm("t3"))).toMatch(
      /Dr Pat Tingle \(registrar\), with formal sign-off by Dr Jordan Tuart \(primary clinical supervisor\)/,
    );
  });

  it("gives every term so far its beginning-of-term goals", () => {
    for (const t of SAMPLE_TERMS.filter((x) => x.status !== "next")) expect(t.botd?.goals.length).toBeGreaterThan(0);
    expect(sampleTerm("t5").botd).toBeUndefined();
  });

  it("keeps the beginning-of-term discussion on the doctor's side", () => {
    expect(resolveRole("botd", "supervisor", "supervisor")).toBe("doctor");
    expect(resolveRole("botd", null, "dct")).toBe("doctor");
  });
});

describe("EPA outcome statements (rules audit M9)", () => {
  const asked = () =>
    [{ type: "request-epa", epa: 1, who: "sup" } as AssessmentsAction].reduce(
      assessmentsReducer,
      initialAssessmentsState(),
    );

  it("keeps the outcome statements the assessor confirmed, once each", () => {
    const s = assessmentsReducer(asked(), {
      type: "record-epa",
      index: 0,
      level: "proximal",
      feedback: { observed: "direct", outcomes: ["1.4", "1.2", "1.4"] },
    });
    expect(s.epaRequests[0]?.status).toBe("done");
    expect(s.epaRequests[0]?.feedback).toEqual({ observed: "direct", outcomes: ["1.4", "1.2"] });
  });

  it("refuses an outcome statement that does not exist", () => {
    const s = assessmentsReducer(asked(), {
      type: "record-epa",
      index: 0,
      level: "proximal",
      feedback: { observed: "direct", outcomes: ["1.4", "9.9"] },
    });
    expect(s.epaRequests[0]?.status).toBe("requested");
  });
});

describe("The inbox's quick answer keeps how the assessor knows (rules audit M9)", () => {
  it("keeps it through sending, Undo and To send, and puts it in the copy for CLA", () => {
    const sent = extrasReducer(initialExtras, {
      type: "inbox-send",
      id: "mia-epa-2",
      level: "proximal",
      text: "",
      observed: "team",
      at: "10:00",
    });
    expect(sent.answers["mia-epa-2"]?.observed).toBe("team");
    const undone = extrasReducer(sent, { type: "inbox-undo", id: "mia-epa-2" });
    expect(undone.answers["mia-epa-2"]?.observed).toBe("team");
    const queued = extrasReducer(initialExtras, {
      type: "inbox-queue",
      id: "mia-epa-2",
      level: "direct",
      text: "",
      observed: "direct",
    });
    expect(readyToSend(queued.answers)).toEqual([{ id: "mia-epa-2", level: "direct", text: "", observed: "direct" }]);
    const item = inboxRequests(initialAssessmentsState(), {}).find((i) => i.id === "mia-epa-2")!;
    expect(claCopyText(item, { ...EMPTY_ANSWER, level: "direct", observed: "direct" })).toContain(
      "How I know: I directly observed some part of it",
    );
    expect(claCopyText(item, { ...EMPTY_ANSWER, level: "direct" })).not.toContain("How I know");
  });
});

describe("How to reach the MEU (site audit A9)", () => {
  it("is one plain line with no invented contact", () => {
    expect(MEU_HOW_TO_REACH).toBe(
      "Your Medical Education Unit (MEU): find it on your hospital's intranet, or ask your term supervisor.",
    );
    expect(MEU_HOW_TO_REACH).not.toMatch(/\d|@|http/);
  });
});
