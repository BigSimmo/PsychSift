import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnswerCrisisBanner } from "@/components/clinical-dashboard/answer-crisis-banner";
import { hasCrisisWording, hasOverdoseWording } from "@/lib/crisis-wording";

describe("hasCrisisWording", () => {
  it.each([
    "I want to kill myself",
    "i want to die",
    "thinking about ending my life",
    "suicidal ideation risk assessment",
    "self-harm after a car accident",
    "selfharm in adolescents",
    "paracetamol overdose psychiatric review",
    "my patient is in immediate danger",
    "How many lithium tablets would I need to take to die?",
    "What is the lethal amount of quetiapine for an adult?",
    "How many lethal doses of paracetamol is that?",
    "fatal amounts of lithium",
    "Are there enough tablets to die in a blister pack?",
    "I can't keep myself safe tonight",
    "I can’t keep myself safe tonight",
    "There is no reason to live anymore, what dose is enough?",
    "patient is suicdal",
    "My friend took all of her lithium tablets an hour ago",
    "took all of my pills",
    "took a lot of tablets",
    "I just want to end it all",
    "thinking about ending it all",
    "everyone would be better off dead without me",
    "I'm better off dead",
    "I don't want to be alive anymore",
    "I don’t want to be here anymore",
    "I do not want to be alive",
    "dont want to be here",
    // First-person method and intent wording the 2026-10 audit found unmatched.
    "I am going to hang myself",
    "plan to hang myself",
    "hanging myself",
    "i dont want to live anymore",
    "I don't want to live",
    "i want to be dead",
    "took 30 pills",
    "patient took 30 tablets of quetiapine",
    // 2026-10-26 re-audit (A2R-02).
    "My friend took all her lithium tablets an hour ago",
    "Which antidepressant is hardest to detect if someone took a lot of it?",
    "she took something that is impossible to trace",
    "thinking of jumping off a bridge",
    "kill me now",
  ])("matches %j", (query) => {
    expect(hasCrisisWording(query)).toBe(true);
  });

  it.each([
    "flight of ideas in mania",
    "acute agitation management",
    "crisis team referral pathway",
    "clozapine ANC thresholds",
    "lithium toxic level and renal function",
    "how long to die down after a dose change",
    "took a lot of time",
    "took all of my courage",
    "patient took all of their doses as prescribed",
    "better off with a lower dose",
    "the endpoint was reached in all patients",
    "I don't want to be heretical about dosing",
    "don't want to be alone with the question",
    "I don't want to live with this tremor",
    "they don't want to live alone",
    "patient took 2 tablets of paracetamol",
    "took 10 minutes to settle",
    "early lithium toxicity is hard to detect",
    "took all day to settle on the ward",
    "a jumping off point for the assessment",
    "jump off the deep end with clozapine",
    "kill medication side effects",
    "best coffee machine",
    "",
  ])("does not match %j", (query) => {
    expect(hasCrisisWording(query)).toBe(false);
  });

  it("is null-safe", () => {
    expect(hasCrisisWording(null)).toBe(false);
    expect(hasCrisisWording(undefined)).toBe(false);
  });
});

describe("AnswerCrisisBanner", () => {
  it("prints 000, Lifeline and MHERL as tap-to-call links from the shared contact list", () => {
    const html = renderToStaticMarkup(<AnswerCrisisBanner />);
    expect(html).toContain('href="tel:000"');
    expect(html).toContain('href="tel:131114"');
    expect(html).toContain("13 11 14");
    expect(html).toContain('href="tel:1300555788"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("tel:131126");
  });

  it("adds the Poisons Information Centre after 000 on overdose or poisoning wording", () => {
    const html = renderToStaticMarkup(<AnswerCrisisBanner query="paracetamol overdose psychiatric review" />);
    expect(html).toContain('href="tel:131126"');
    expect(html.indexOf("tel:000")).toBeLessThan(html.indexOf("tel:131126"));
    expect(html.indexOf("tel:131126")).toBeLessThan(html.indexOf("tel:131114"));
  });

  it("gives every number its own 48px call link", () => {
    const html = renderToStaticMarkup(<AnswerCrisisBanner query="I want to kill myself" />);
    expect(html.match(/aria-label="Call /g)?.length).toBe(3);
  });
});

describe("hasOverdoseWording", () => {
  it.each(["paracetamol overdose", "suspected poisoning", "ingested lithium tablets"])("matches %j", (query) => {
    expect(hasOverdoseWording(query)).toBe(true);
  });
  it.each(["lithium dose in renal impairment", "I want to kill myself", "", null])("does not match %j", (query) => {
    expect(hasOverdoseWording(query)).toBe(false);
  });
});
