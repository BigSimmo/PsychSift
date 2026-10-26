import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnswerCrisisBanner } from "@/components/clinical-dashboard/answer-crisis-banner";
import { CAMHS_CRISIS_CONNECT_CONTACT, WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";

// Owner decision 2026-10-26 (D10): under-18 wording puts CAMHS Crisis Connect straight after 000.
// Kept apart from answer-crisis-banner.dom.test.tsx so the two changes land independently.
function numbersInOrder(html: string) {
  return Array.from(html.matchAll(/href="tel:(\d+)"/g), (match) => match[1]);
}

describe("AnswerCrisisBanner under-18 wording", () => {
  it("adds CAMHS Crisis Connect straight after 000 when the question names someone under 18", () => {
    for (const query of ["my 15 year old wants to kill herself", "16yo suicidal", "aged 15 and suicidal"]) {
      expect(numbersInOrder(renderToStaticMarkup(<AnswerCrisisBanner query={query} />)), query).toEqual([
        "000",
        "1800048636",
        "1300555788",
        "131114",
      ]);
    }
  });

  it("keeps the Poisons Information Centre after CAMHS Crisis Connect for an under-18 overdose", () => {
    const html = renderToStaticMarkup(<AnswerCrisisBanner query="16yo overdose on sertraline" />);
    expect(numbersInOrder(html)).toEqual(["000", "1800048636", "131126", "1300555788", "131114"]);
  });

  it("leaves the adult card unchanged", () => {
    const html = renderToStaticMarkup(<AnswerCrisisBanner query="I want to kill myself" />);
    expect(numbersInOrder(html)).toEqual(["000", "1300555788", "131114"]);
  });

  it("keeps CAMHS Crisis Connect off the patient safety-plan list, with its source and check date", () => {
    expect(WA_CRISIS_CONTACTS.some((contact) => contact.telephoneDisplay === "1800 048 636")).toBe(false);
    expect(CAMHS_CRISIS_CONNECT_CONTACT.telephoneUri).toBe(
      CAMHS_CRISIS_CONNECT_CONTACT.telephoneDisplay.replace(/\s+/g, ""),
    );
    expect(CAMHS_CRISIS_CONNECT_CONTACT.sourceUrl).toMatch(/^https:\/\/www\.mhc\.wa\.gov\.au\//);
    expect(CAMHS_CRISIS_CONNECT_CONTACT.verifiedOn).toBe("2026-10-26");
  });
});
