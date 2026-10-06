import { describe, expect, it } from "vitest";

import { FATIGUE_RULE_SET, FATIGUE_RULES_SIGN_OFF } from "@/lib/roster/fatigue-rules-source";
import { restRulesGate } from "@/lib/work-profile/model";
import {
  AGREEMENT_PAGE_HREF,
  AGREEMENT_SUGGESTED_QUESTIONS,
  AGREEMENT_TOPICS,
  AGREEMENT_UNION_NAME,
  agreementAnswerCopyText,
  agreementClause,
  agreementClauseCopyText,
  agreementClauses,
  agreementSignOffState,
  agreementSource,
  agreementSuggestions,
  agreementTopicHref,
  agreementWorkSearchAnswer,
  agreementWorkSearchRecords,
  answerAgreementQuestion,
  answerAgreementTopic,
  checkAgreementQuestion,
  normaliseAgreementQuestion,
  uncheckedSentence,
  type AgreementAnswer,
} from "@/lib/work-profile/agreement-answers";

const OFF = { on: false, reason: "unsigned" } as const;
const ON = { on: true } as const;
const opts = { gate: OFF, today: "2026-10-06", thisYear: 2026 };

/** Every quote string in the source, so a test can prove an answer adds no words of its own. */
function sourceQuotes(): Set<string> {
  const quotes = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string") quotes.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(FATIGUE_RULE_SET.rules);
  return quotes;
}

function topicIds(answer: AgreementAnswer): string[] {
  return answer.kind === "quoted" ? answer.topics.map((topic) => topic.id) : [];
}

describe("Ask the agreement: verbatim quotes only", () => {
  it("every line of every topic is a verbatim string from FATIGUE_RULE_SET with a clause 15 number", () => {
    const quotes = sourceQuotes();
    for (const topic of AGREEMENT_TOPICS) {
      expect(topic.lines.length).toBeGreaterThan(0);
      for (const line of topic.lines) {
        expect(quotes.has(line.text), line.text).toBe(true);
        expect(line.clause).toMatch(/^15\(\d\)\([a-g]\)$/);
      }
    }
  });

  it("covers every rule in the source, so nothing quoted is left unreachable", () => {
    const used = new Set(AGREEMENT_TOPICS.flatMap((topic) => topic.lines.map((line) => line.ruleId)));
    expect([...used].sort()).toEqual(Object.keys(FATIGUE_RULE_SET.rules).sort());
  });

  it("groups clauses in clause order, each line once", () => {
    const clauses = agreementClauses();
    expect(clauses.map((entry) => entry.clause)).toEqual([
      "15(3)(c)",
      "15(4)(a)",
      "15(6)(b)",
      "15(6)(c)",
      "15(6)(d)",
      "15(6)(e)",
      "15(6)(f)",
      "15(6)(g)",
    ]);
    expect(agreementClause("15(6)(b)")?.lines).toHaveLength(2);
    expect(agreementClause("15(6)(g)")?.lines).toHaveLength(4);
    expect(agreementClause("99(1)(a)")).toBeNull();
  });
});

describe("matching questions to the checked clauses", () => {
  it.each([
    ["How long a break between shifts?", ["break-between-shifts"]],
    ["Do I get 10 hrs between shifts", ["break-between-shifts"]],
    ["turnaround from late to early", ["break-between-shifts"]],
    ["Can I be rostered straight after nights?", ["rest-after-nights"]],
    ["how many hrs off after 4 nites", ["rest-after-nights"]],
    ["days off after nights", ["rest-after-nights"]],
    ["How many nights in a row can I work?", ["nights-in-a-row"]],
    ["can i do 5 night shifts", ["nights-in-a-row"]],
    ["What is the most hours in a week?", ["hours-in-a-week"]],
    ["max hours per fortnight", ["hours-in-a-week"]],
    ["How long can a shift be?", ["shift-length"]],
    ["can I start a 13 hour shift after noon", ["shift-length"]],
    ["How many days in a row before two days off?", ["days-before-two-off"]],
    ["I worked 13 days straight", ["days-before-two-off"]],
  ])("%s", (question, expected) => {
    expect(topicIds(answerAgreementQuestion(question, opts))).toEqual(expected);
  });

  it("every suggested question leads to a quoted answer, never a dead end", () => {
    for (const question of AGREEMENT_SUGGESTED_QUESTIONS) {
      expect(answerAgreementQuestion(question, opts).kind, question).toBe("quoted");
    }
  });

  it("names topics it has not checked, and never answers them", () => {
    const overtime = answerAgreementQuestion("Am I owed overtime for staying 40 minutes late?", opts);
    expect(overtime).toMatchObject({ kind: "not-checked", unchecked: [{ id: "overtime" }] });
    expect(answerAgreementQuestion("what leave can I take for an exam", opts)).toMatchObject({
      kind: "not-checked",
      unchecked: [{ id: "leave" }],
    });
    expect(answerAgreementQuestion("Is parking free on night shifts?", opts)).toMatchObject({
      kind: "not-checked",
      unchecked: [],
    });
  });

  it("answers the checked part and names the unchecked part of a mixed question", () => {
    const answer = answerAgreementQuestion("Am I paid for working more than 75 hours a week", opts);
    expect(answer.kind).toBe("quoted");
    if (answer.kind !== "quoted") return;
    expect(answer.topics.map((topic) => topic.id)).toEqual(["hours-in-a-week"]);
    expect(answer.unchecked.map((topic) => topic.id)).toEqual(["pay"]);
  });

  it("reads typed shorthand", () => {
    expect(normaliseAgreementQuestion("10hrs b/w nite shifts & O/T?")).toBe("10 hours b/w nights and overtime");
  });

  it("an empty or one-letter question is no answer", () => {
    expect(answerAgreementQuestion("   ", opts).kind).toBe("empty");
    expect(answerAgreementQuestion("a", opts).kind).toBe("empty");
  });
});

describe("the patient-detail catch", () => {
  it.each([
    ["stayed late with UR 4471823", "a record number"],
    ["Mrs Smith asked me to stay", "a name"],
    ["DOB 12/03/1980 can I work nights", "date of birth"],
    ["J Smith in bed 4 after nights", "a name"],
  ])("%s is caught and never matched", (question, what) => {
    const answer = answerAgreementQuestion(question, opts);
    expect(answer.kind).toBe("patient");
    if (answer.kind === "patient") expect(answer.what).toContain(what);
  });

  it("offers a safer wording only when the safer wording passes both checks", () => {
    expect(checkAgreementQuestion("stayed late with UR 4471823 after nights", 2026)).toMatchObject({
      kind: "patient",
      safer: expect.stringContaining("after nights"),
    });
    const safer = checkAgreementQuestion("stayed late with UR 4471823 after nights", 2026);
    if (safer.kind === "patient" && safer.safer) expect(checkAgreementQuestion(safer.safer, 2026).kind).toBe("ok");
  });

  it("ordinary work words pass", () => {
    for (const question of ["Can I work 5 nights in ED", "AMA WA rules", "PGY2 RMO break between shifts"]) {
      expect(checkAgreementQuestion(question, 2026).kind, question).toBe("ok");
    }
  });
});

describe("sign-off, source and copy", () => {
  it("is not signed off while the gate is off, with the reason in words", () => {
    expect(agreementSignOffState(OFF)).toEqual({
      signedOff: false,
      reason: "Not yet signed by a named clinician",
      signedLine: null,
    });
    const on = agreementSignOffState(ON);
    expect(on.signedOff).toBe(true);
    expect(on.reason).toBeNull();
    expect(on.signedLine).toMatch(/^Signed off/);
    const answer = answerAgreementQuestion("break between shifts", opts);
    expect(answer.kind === "quoted" && answer.signOff.signedOff).toBe(false);
  });

  it("follows the same gate Roster's rest check uses", () => {
    expect(agreementSignOffState().signedOff).toBe(restRulesGate().on);
    const gate = restRulesGate();
    if (gate.on) expect(agreementSignOffState().signedLine).toContain(FATIGUE_RULES_SIGN_OFF.signedBy ?? "Signed off");
  });

  it("states the source with readable dates, and notices expiry", () => {
    expect(agreementSource("2026-10-06")).toEqual({
      title: FATIGUE_RULE_SET.source.title,
      citation: "2024 WAIRC 00992",
      url: FATIGUE_RULE_SET.source.url,
      checkedOn: "3 Oct 2026",
      expiresOn: "2 Sep 2027",
      pastExpiry: false,
    });
    expect(agreementSource("2027-09-03").pastExpiry).toBe(true);
  });

  it("copy text carries every quote and clause, the sign-off caveat, the link and the union", () => {
    const answer = answerAgreementQuestion("How many nights in a row can I work?", opts);
    const text = agreementAnswerCopyText(answer);
    expect(text).toContain(`"${FATIGUE_RULE_SET.rules.maxNightsInRow.quote}" (clause 15(6)(f))`);
    expect(text).toContain("Not signed off yet");
    expect(text).toContain(FATIGUE_RULE_SET.source.url);
    expect(text.trim().endsWith(`${AGREEMENT_UNION_NAME}, your union.`)).toBe(true);
    const signed = agreementAnswerCopyText(answerAgreementQuestion("How many nights in a row?", { ...opts, gate: ON }));
    expect(signed).not.toContain("Not signed off yet");
  });

  it("the not-checked copy says so, points to the agreement and ends with the union, with no phone number", () => {
    const text = agreementAnswerCopyText(answerAgreementQuestion("overtime?", opts));
    expect(text).toContain("Overtime is not in the clauses PsychSift has checked.");
    expect(text).toContain("Open the agreement");
    expect(text).toMatch(/AMA \(WA\), your union\.$/);
    expect(text).not.toMatch(/\d{4} ?\d{3,4}/);
  });

  it("clause copy text", () => {
    const clause = agreementClause("15(4)(a)")!;
    expect(agreementClauseCopyText(clause, agreementSource("2026-10-06"))).toBe(
      [
        `Clause 15(4)(a), ${FATIGUE_RULE_SET.source.title} (2024 WAIRC 00992)`,
        `"${FATIGUE_RULE_SET.rules.minBreakHours.quote}"`,
        FATIGUE_RULE_SET.source.url,
      ].join("\n"),
    );
  });

  it("unchecked sentences read naturally", () => {
    expect(uncheckedSentence([])).toBe("This is not in the clauses PsychSift has checked.");
    expect(
      uncheckedSentence([
        { id: "overtime", label: "Overtime" },
        { id: "pay", label: "Pay and allowances" },
      ]),
    ).toBe("Overtime and pay and allowances are not in the clauses PsychSift has checked.");
  });

  it("a topic opened directly answers with that topic", () => {
    const answer = answerAgreementTopic("rest-after-nights", opts);
    expect(answer).toMatchObject({ kind: "quoted", question: "Time off after nights", unchecked: [] });
  });
});

describe("as-you-type suggestions", () => {
  it("matches word starts in questions and topics", () => {
    const result = agreementSuggestions("nig");
    expect(result.questions).toContain("How many nights in a row can I work?");
    expect(result.topics.map((topic) => topic.id)).toContain("nights-in-a-row");
  });

  it("offers nothing for stop words or unknown words", () => {
    expect(agreementSuggestions("how can I")).toEqual({ questions: [], topics: [] });
    expect(agreementSuggestions("parking")).toEqual({ questions: [], topics: [] });
  });
});

describe("work search provider", () => {
  it("records carry fixed hrefs, never typed text", () => {
    const records = agreementWorkSearchRecords();
    expect(records[0]).toMatchObject({ title: "Ask the agreement", href: AGREEMENT_PAGE_HREF });
    expect(records).toHaveLength(AGREEMENT_TOPICS.length + 1);
    for (const record of records) {
      expect(record.href.startsWith(AGREEMENT_PAGE_HREF)).toBe(true);
      expect(record.keywords.length).toBeGreaterThan(0);
    }
    expect(records.find((r) => r.id === "agreement:rest-after-nights")?.href).toBe(
      agreementTopicHref("rest-after-nights"),
    );
  });

  it("answers rule questions with the first quote and a topic link", () => {
    expect(agreementWorkSearchAnswer("can I be rostered straight after nights", opts)).toEqual({
      kind: "quoted",
      title: "Time off after nights",
      detail: FATIGUE_RULE_SET.rules.restAfterNights.leadIn,
      clauses: ["15(6)(g)"],
      signedOff: false,
      href: "/my-day/profile/agreement?topic=rest-after-nights",
      union: "AMA (WA)",
    });
  });

  it("says not checked only for entitlement questions, and stays out of ordinary searches", () => {
    expect(agreementWorkSearchAnswer("am I owed overtime", opts)).toMatchObject({
      kind: "not-checked",
      href: AGREEMENT_PAGE_HREF,
    });
    expect(agreementWorkSearchAnswer("overtime form", opts)).toBeNull();
    expect(agreementWorkSearchAnswer("journal club", opts)).toBeNull();
  });

  it("returns nothing for patient details, so the typed text never reaches a link", () => {
    expect(agreementWorkSearchAnswer("UR 4471823 after nights", opts)).toBeNull();
  });
});
