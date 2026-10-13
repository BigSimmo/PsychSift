import { describe, expect, it } from "vitest";

import {
  extractAssessmentQueryTerms,
  isAssessmentQuery,
  parseMyWorkAssessmentGrammar,
} from "@/lib/search/my-work-grammar";

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
