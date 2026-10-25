import { describe, expect, it } from "vitest";
import {
  answerLinePresentation,
  coerceAnswerDisplayMode,
  parseAnswerDisplayContent,
} from "../src/lib/answer-formatting";

describe("answer display formatting", () => {
  it("parses markdown-style answer bullets into labeled display rows", () => {
    const parsed = parseAnswerDisplayContent(
      "- Monitoring: Check observations after IM medication.\n- Dose detail: Lorazepam **1mg** to **2mg** may be used when supported.",
    );

    expect(parsed.type).toBe("bullets");
    expect(parsed.mode).toBe("clinical_pathway");
    expect(parsed.lines).toMatchObject([
      {
        label: "Monitoring",
        displayLabel: "Monitoring",
        group: "monitoring",
        text: "Check observations after IM medication.",
      },
      {
        label: "Dose detail",
        displayLabel: "Medication",
        group: "medication",
        text: "Lorazepam **1mg** to **2mg** may be used when supported.",
      },
    ]);
    expect(answerLinePresentation(parsed.lines[0])).toMatchObject({ tone: "monitoring", symbol: "⏱" });
    expect(answerLinePresentation(parsed.lines[1])).toMatchObject({ tone: "medication", symbol: "Rx" });
    expect(parsed.groups.map((group) => group.group)).toEqual(["monitoring", "medication"]);
  });

  it("recovers inline bullets after whitespace has been compacted", () => {
    const parsed = parseAnswerDisplayContent(
      "- Bottom line: Use the source-backed pathway. - Escalation/risk: Seek senior review if no response.",
    );

    expect(parsed.type).toBe("bullets");
    expect(parsed.mode).toBe("clinical_pathway");
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].label).toBe("Bottom line");
    expect(parsed.lines[1].label).toBe("Escalation/risk");
    expect(parsed.lines[0].group).toBe("bottom_line");
    expect(parsed.lines[1].group).toBe("escalation");
    expect(parsed.lead?.text).toBe("Use the source-backed pathway.");
    expect(answerLinePresentation(parsed.lines[0])).toMatchObject({ tone: "direct", symbol: "✓" });
    expect(answerLinePresentation(parsed.lines[1])).toMatchObject({ tone: "risk", symbol: "!" });
  });

  it("keeps a prose lead before bullet rows", () => {
    const parsed = parseAnswerDisplayContent(
      "Use the source-backed pathway for clozapine monitoring.\n- Monitoring/timing: Check FBC weekly.\n- Medication/dose details: Withhold clozapine if ANC is unsafe.",
    );

    expect(parsed.type).toBe("bullets");
    expect(parsed.lead).toMatchObject({
      group: "monitoring",
      text: "Use the source-backed pathway for clozapine monitoring.",
    });
    expect(parsed.groups.map((group) => group.group)).toEqual(["monitoring", "medication"]);
    expect(parsed.lines[1]).toMatchObject({ displayLabel: "Monitoring", group: "monitoring" });
    expect(parsed.lines[2]).toMatchObject({ displayLabel: "Medication", group: "medication" });
  });

  it("merges non-bullet continuation lines into the previous bullet", () => {
    const parsed = parseAnswerDisplayContent(
      "- Monitoring: Check FBC weekly.\nContinue weekly until stable and document abnormal results.\n- Medication/dose details: Withhold clozapine if ANC is unsafe.\nRestart only when the source threshold is met.",
    );

    expect(parsed.type).toBe("bullets");
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].text).toBe("Check FBC weekly. Continue weekly until stable and document abnormal results.");
    expect(parsed.lines[1].text).toBe(
      "Withhold clozapine if ANC is unsafe. Restart only when the source threshold is met.",
    );
  });

  it("keeps ordinary prose as a paragraph", () => {
    const parsed = parseAnswerDisplayContent("The indexed source does not contain enough information.");

    expect(parsed.type).toBe("paragraph");
    expect(parsed.mode).toBe("evidence_gap");
    expect(parsed.lines[0]).toMatchObject({
      label: null,
      displayLabel: "Source gap",
      group: "gap",
      text: "The indexed source does not contain enough information.",
    });
    expect(answerLinePresentation(parsed.lines[0])).toMatchObject({ tone: "gap", symbol: "?" });
  });

  it("uses unlabeled clinical keywords to group dense answer prose", () => {
    const parsed = parseAnswerDisplayContent(
      "Arrange baseline renal function, thyroid function, calcium, and lithium level before continuing treatment.",
    );

    expect(parsed.type).toBe("paragraph");
    expect(parsed.mode).toBe("clinical_pathway");
    expect(parsed.lines[0]).toMatchObject({ explicitLabel: false, group: "monitoring", displayLabel: "Monitoring" });
  });

  it("uses checklist mode for practical action answers", () => {
    const parsed = parseAnswerDisplayContent(
      "- Required actions: Complete the source form.\n- Documentation/forms: Record review and consent.",
    );

    expect(parsed.mode).toBe("checklist");
    expect(parsed.groups.map((group) => group.group)).toEqual(["action", "documentation"]);
    expect(answerLinePresentation(parsed.lines[0])).toMatchObject({ tone: "action", symbol: "→" });
    expect(answerLinePresentation(parsed.lines[1])).toMatchObject({ tone: "documentation", symbol: "§" });
  });

  it("uses comparison mode and symbols for contrast answers", () => {
    const parsed = parseAnswerDisplayContent(
      "- Comparison: One document describes routine monitoring.\n- Source point: Another source describes escalation criteria.",
    );

    expect(parsed.mode).toBe("comparison");
    expect(parsed.groups.map((group) => group.group)).toEqual(["comparison", "source"]);
    expect(answerLinePresentation(parsed.lines[0])).toMatchObject({ tone: "comparison", symbol: "↔" });
    expect(answerLinePresentation(parsed.lines[1])).toMatchObject({ tone: "source", symbol: "#" });
  });

  it("allows explicit response modes to override prose inference", () => {
    const threshold = parseAnswerDisplayContent(
      "ANC below the table threshold requires source verification.",
      "threshold_table",
    );
    const comparison = parseAnswerDisplayContent(
      "- Source A: Routine review.\n- Source B: Escalation criteria.",
      "comparison_matrix",
    );

    expect(threshold.mode).toBe("threshold_table");
    expect(comparison.mode).toBe("comparison_matrix");
    expect(coerceAnswerDisplayMode("document_lookup")).toBe("document_lookup");
  });

  it("keeps a spaced numeric range whole instead of splitting it into bullets (#178)", () => {
    const parsed = parseAnswerDisplayContent("Target lithium level is 0.6 - 0.8 mmol/L for maintenance.");

    expect(parsed.lines.map((line) => line.text)).toEqual([
      "Target lithium level is 0.6 - 0.8 mmol/L for maintenance.",
    ]);
  });

  it("still splits inline bullets that start with a number after a word", () => {
    const parsed = parseAnswerDisplayContent("Check levels weekly. - 2 checks are needed before discharge.");

    expect(parsed.lines.map((line) => line.text)).toEqual([
      "Check levels weekly.",
      "2 checks are needed before discharge.",
    ]);
  });
});
