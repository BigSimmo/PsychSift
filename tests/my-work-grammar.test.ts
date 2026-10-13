import { describe, expect, it } from "vitest";

import {
  extractAssessmentQueryTerms,
  isAssessmentQuery,
  parseMyWorkAssessmentGrammar,
} from "@/lib/search/my-work-grammar";
import { answerWorkQuestion } from "@/lib/work-search/answers";

describe("Search My Work Assessment Grammar (#PT83FG)", () => {
  describe("isAssessmentQuery", () => {
    it("identifies EPA queries", () => {
      expect(isAssessmentQuery("when is my next epa")).toBe(true);
      expect(isAssessmentQuery("epa milestones")).toBe(true);
      expect(isAssessmentQuery("entrustable professional activities")).toBe(true);
      expect(isAssessmentQuery("how many epas do I have left")).toBe(true);
    });

    it("identifies WBA queries", () => {
      expect(isAssessmentQuery("mini-cex due this week")).toBe(true);
      expect(isAssessmentQuery("case-based discussion")).toBe(true);
      expect(isAssessmentQuery("wbas pending")).toBe(true);
      expect(isAssessmentQuery("dops evaluation")).toBe(true);
    });

    it("identifies term assessment and supervisor queries", () => {
      expect(isAssessmentQuery("mid-term review due")).toBe(true);
      expect(isAssessmentQuery("end-of-term assessment")).toBe(true);
      expect(isAssessmentQuery("when is my next supervisor meeting")).toBe(true);
      expect(isAssessmentQuery("who is assessing me")).toBe(true);
    });

    it("identifies assessment alerts", () => {
      expect(isAssessmentQuery("assessment alerts")).toBe(true);
      expect(isAssessmentQuery("assessment reminders")).toBe(true);
    });

    it("rejects non-assessment queries", () => {
      expect(isAssessmentQuery("when is my next shift")).toBe(false);
      expect(isAssessmentQuery("annual leave form")).toBe(false);
      expect(isAssessmentQuery("switchboard number")).toBe(false);
      expect(isAssessmentQuery("hi")).toBe(false);
    });
  });

  describe("parseMyWorkAssessmentGrammar", () => {
    it("parses upcoming EPA question with next intent", () => {
      const match = parseMyWorkAssessmentGrammar("When is my next EPA?");
      expect(match).not.toBeNull();
      expect(match?.category).toBe("epa");
      expect(match?.intent).toBe("next");
      expect(match?.understood).toBe("Showing your next upcoming EPA milestones");
      expect(match?.targetArea).toBe("assessments");

      const directMatch = parseMyWorkAssessmentGrammar("next EPA");
      expect(directMatch).not.toBeNull();
      expect(directMatch?.category).toBe("epa");
      expect(directMatch?.intent).toBe("next");
    });

    it("parses future timeframe assessment queries as next intent", () => {
      const weekMatch = parseMyWorkAssessmentGrammar("what assessments are next week");
      expect(weekMatch).not.toBeNull();
      expect(weekMatch?.intent).toBe("next");
      expect(weekMatch?.timeframe).toBe("next week");

      const monthMatch = parseMyWorkAssessmentGrammar("my assessments next month");
      expect(monthMatch).not.toBeNull();
      expect(monthMatch?.intent).toBe("next");
      expect(monthMatch?.timeframe).toBe("next month");

      const termMatch = parseMyWorkAssessmentGrammar("what assessments are next term");
      expect(termMatch).not.toBeNull();
      expect(termMatch?.intent).toBe("next");
      expect(termMatch?.timeframe).toBe("next term");
    });

    it("routes next EPA query through Search My Work answerWorkQuestion", () => {
      const answer = answerWorkQuestion("next EPA", {
        items: [],
        areas: [{ area: "teaching", status: "ready", sample: false }],
        today: "2026-10-14",
        cpd: null,
      });
      expect(answer).not.toBeNull();
      expect(answer?.area).toBe("teaching");
      expect(answer?.label).toBe("EPA milestone");
      expect(answer?.understood).toContain("EPA milestones");
      expect(answer?.action?.href).toBe("/teaching/assessments");
      expect(answer?.action?.label).toBe("Open Teaching");
      expect(answer?.headline).toBe("No upcoming epa milestones scheduled");
    });

    it("returns honest unavailable answer when teaching area is not ready", () => {
      const loading = answerWorkQuestion("next EPA", {
        items: [],
        areas: [],
        today: "2026-10-14",
        cpd: null,
      });
      expect(loading).not.toBeNull();
      expect(loading?.label).toBe("Can't check yet");
      expect(loading?.unavailable).toBe("Still loading Teaching.");
    });

    it("routes assessment alert queries to alerts page", () => {
      const answer = answerWorkQuestion("assessment alerts", {
        items: [],
        areas: [{ area: "teaching", status: "ready", sample: false }],
        today: "2026-10-14",
        cpd: null,
      });
      expect(answer).not.toBeNull();
      expect(answer?.action?.href).toBe("/my-day/alerts");
      expect(answer?.action?.label).toBe("Open alerts");
    });

    it("filters and sorts assessments by timeframe and date for next/due queries", () => {
      const sampleItems = [
        {
          id: "t:session:1",
          area: "teaching" as const,
          kind: "session" as const,
          title: "Past EPA review",
          detail: null,
          date: "2026-10-01",
          href: "/teaching/assessments/1",
          tags: [],
          text: [],
        },
        {
          id: "t:session:2",
          area: "teaching" as const,
          kind: "session" as const,
          title: "Upcoming EPA milestone",
          detail: null,
          date: "2026-10-20",
          href: "/teaching/assessments/2",
          tags: [],
          text: [],
        },
        {
          id: "t:session:3",
          area: "teaching" as const,
          kind: "session" as const,
          title: "Far EPA milestone",
          detail: null,
          date: "2026-10-25",
          href: "/teaching/assessments/3",
          tags: [],
          text: [],
        },
      ];
      const answer = answerWorkQuestion("next EPA", {
        items: sampleItems,
        areas: [{ area: "teaching", status: "ready", sample: false }],
        today: "2026-10-14",
        cpd: null,
      });
      expect(answer).not.toBeNull();
      expect(answer?.headline).toBe("Upcoming EPA milestone");
      expect(answer?.action?.href).toBe("/teaching/assessments/2");
      expect(answer?.action?.label).toBe("Open EPA milestone");
      expect(answer?.items).toHaveLength(2);
      expect(answer?.items[0].id).toBe("t:session:2");
      expect(answer?.items[1].id).toBe("t:session:3");
      expect(answer?.date).toBe("2026-10-20");
    });

    it("preserves roster shift count answer when question primary intent is shifts", () => {
      const shiftItems = [
        {
          id: "r:shift:1",
          area: "roster" as const,
          kind: "shift" as const,
          title: "Day shift",
          detail: null,
          date: "2026-10-15",
          href: "/roster/shifts/1",
          tags: [],
          text: [],
          facet: "day",
        },
      ];
      const answer = answerWorkQuestion("how many shifts this week before my assessment?", {
        items: shiftItems,
        areas: [
          { area: "roster", status: "ready", sample: false },
          { area: "teaching", status: "ready", sample: false },
        ],
        today: "2026-10-14",
        cpd: null,
      });
      expect(answer).not.toBeNull();
      expect(answer?.area).toBe("roster");
    });

    it("displays single matching assessment in hero when exactly one match exists", () => {
      const singleItem = [
        {
          id: "t:session:4",
          area: "teaching" as const,
          kind: "session" as const,
          title: "Single Mini-CEX Assessment",
          detail: "Consultant review",
          date: "2026-10-18",
          href: "/teaching/assessments/4",
          tags: [],
          text: [],
        },
      ];
      const answer = answerWorkQuestion("mini-cex due this week", {
        items: singleItem,
        areas: [{ area: "teaching", status: "ready", sample: false }],
        today: "2026-10-14",
        cpd: null,
      });
      expect(answer).not.toBeNull();
      expect(answer?.headline).toBe("Single Mini-CEX Assessment");
      expect(answer?.sub).toContain("Consultant review");
      expect(answer?.action?.href).toBe("/teaching/assessments/4");
      expect(answer?.action?.label).toBe("Open Workplace-Based Assessment");
      expect(answer?.date).toBe("2026-10-18");
    });

    it("parses assessment due question with timeframe", () => {
      const match = parseMyWorkAssessmentGrammar("what assessments are due this month");
      expect(match).not.toBeNull();
      expect(match?.category).toBe("general_assessment");
      expect(match?.intent).toBe("due");
      expect(match?.timeframe).toBe("this month");
      expect(match?.understood).toBe("Showing assessments due this month");
    });

    it("parses mini-cex WBA question", () => {
      const match = parseMyWorkAssessmentGrammar("mini-cex due next week");
      expect(match).not.toBeNull();
      expect(match?.category).toBe("wba");
      expect(match?.intent).toBe("due");
      expect(match?.timeframe).toBe("next week");
      expect(match?.understood).toBe("Showing Workplace-Based Assessments (WBAs) due next week");
    });

    it("parses supervisor inquiry", () => {
      const match = parseMyWorkAssessmentGrammar("who is assessing me");
      expect(match).not.toBeNull();
      expect(match?.category).toBe("supervisor_review");
      expect(match?.intent).toBe("supervisor");
      expect(match?.understood).toBe("Showing your assigned clinical supervisor and review schedule");

      const clinicalMatch = parseMyWorkAssessmentGrammar("who is my clinical supervisor");
      expect(clinicalMatch).not.toBeNull();
      expect(clinicalMatch?.intent).toBe("supervisor");
    });

    it("parses count / progress query", () => {
      const match = parseMyWorkAssessmentGrammar("how many epas remaining");
      expect(match).not.toBeNull();
      expect(match?.category).toBe("epa");
      expect(match?.intent).toBe("count");
      expect(match?.understood).toBe("Showing progress count for EPA milestones");
    });

    it("parses assessment alert query with alerts targetArea", () => {
      const match = parseMyWorkAssessmentGrammar("active assessment alerts");
      expect(match).not.toBeNull();
      expect(match?.category).toBe("alert");
      expect(match?.targetArea).toBe("alerts");
    });
  });

  describe("extractAssessmentQueryTerms", () => {
    it("extracts categories and terms for indexing and search filtering", () => {
      const result = extractAssessmentQueryTerms("epas due this month");
      expect(result).not.toBeNull();
      expect(result?.category).toBe("epa");
      expect(result?.terms).toContain("this month");
      expect(result?.terms).toContain("epa");
      expect(result?.terms).toContain("due");
    });

    it("returns null for non-assessment text", () => {
      expect(extractAssessmentQueryTerms("ward 4 night shift")).toBeNull();
    });
  });
});
