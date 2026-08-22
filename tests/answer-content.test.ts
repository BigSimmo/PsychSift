import { describe, expect, it } from "vitest";
import { primaryAnswerDisplayText } from "../src/components/clinical-dashboard/answer-content";
import { sourceQuoteDisplayText } from "../src/components/clinical-dashboard/display-text";

describe("primaryAnswerDisplayText", () => {
  it("keeps every sentence of a finalized v19 lead instead of selecting a compact subset", () => {
    // Removing any one of these five governed sentences is a display defect,
    // not an opportunity for the client to choose a more useful answer.
    const answer =
      "Start the prescribed treatment after confirming the indication. Check the baseline observations before administration. Review the response at the planned interval. Record the decision and clinical rationale in the notes. Continue monitoring for the documented adverse effects.";

    expect(primaryAnswerDisplayText(answer)).toBe(answer);
  });

  it("keeps lossless sanitation safeguards while preserving the complete lead", () => {
    const noisyAnswer =
      "Source mentions: Start the prescribed treatment after confirming the indication. Synthetic demo only: illustrative content.";
    const unsafeAnswer = "<script>alert('unsafe')</script> Start the prescribed treatment after confirming the indication.";
    const preformattedAnswer = "Facility code: WA-ABC-9\nUse the local protocol.";

    expect(primaryAnswerDisplayText(noisyAnswer)).toBe("Start the prescribed treatment after confirming the indication.");
    // This helper returns text, not HTML; SafeBoldText renders these characters
    // inertly, so lossless sanitation must not make them executable markup.
    expect(primaryAnswerDisplayText(unsafeAnswer)).toBe(unsafeAnswer);
    expect(primaryAnswerDisplayText(preformattedAnswer, { preformatted: true })).toBe(preformattedAnswer);
  });

  it("keeps a safety cue in a long leading fragment beyond the compact word budget", () => {
    const lead = `${Array.from({ length: 90 }, (_, index) => `detail${index + 1}`).join(" ")} Do not administer the medicine.`;

    expect(primaryAnswerDisplayText(lead)).toContain("Do not administer the medicine.");
  });

  it("keeps a full-word escalation caveat that appears beyond the compact head", () => {
    // A bare `escalat\b` stem never matched "Escalate", so this caveat (the
    // fourth fragment) was silently dropped before the fix.
    const answer =
      "Give paracetamol for ongoing pain. Review the observations hourly overnight. Document the management plan clearly in the notes. Escalate to the senior doctor if the patient deteriorates.";
    expect(primaryAnswerDisplayText(answer)).toContain("Escalate to the senior doctor");
  });

  it("keeps a short contraindication caveat under the 8-word usefulness floor", () => {
    // "Contraindicated in pregnancy and severe renal impairment" is 7 words, so
    // the usefulness/length filter dropped it before the safety-aware exception.
    const answer =
      "Offer oral rehydration first. Reassess fluid balance after two hours. Record the intake and output totals. Contraindicated in pregnancy and severe renal impairment.";
    expect(primaryAnswerDisplayText(answer)).toContain("Contraindicated in pregnancy");
  });

  it("keeps a short stop instruction after normal leading prose", () => {
    const answer =
      "Give paracetamol for ongoing pain. Review the observations hourly overnight. Document the management plan clearly in the notes. Stop lithium.";
    expect(primaryAnswerDisplayText(answer)).toContain("Stop lithium.");
  });

  it("keeps a passive held caveat beyond the compact head", () => {
    const answer =
      "Give paracetamol for ongoing pain. Review the observations hourly overnight. Document the management plan clearly in the notes. Clozapine should be held.";
    expect(primaryAnswerDisplayText(answer)).toContain("should be held");
  });

  it("keeps an avoid directive after normal leading prose", () => {
    const answer =
      "Give paracetamol for ongoing pain. Review the observations hourly overnight. Document the management plan clearly in the notes. Avoid lithium in pregnancy.";
    expect(primaryAnswerDisplayText(answer)).toContain("Avoid lithium in pregnancy");
  });

  it("keeps a caveat whose safety keyword is server-bolded on the preserveBold path", () => {
    // "Do **not** administer" — bold markers inside the phrase must not defeat
    // the safety match, or the compact cap could drop the withhold instruction.
    const answer =
      "Give paracetamol for ongoing pain. Review the observations hourly overnight. Document the management plan clearly in the notes. Do **not** administer lithium.";
    expect(primaryAnswerDisplayText(answer, { preserveBold: true })).toContain("administer lithium");
  });

  it("keeps a should-not / must-not contraindication directive beyond the compact head", () => {
    const answer =
      "Give paracetamol for ongoing pain. Review the observations hourly overnight. Document the management plan clearly in the notes. Clozapine should not be used in this patient.";
    expect(primaryAnswerDisplayText(answer)).toContain("should not be used");
  });

  it("is unchanged for a short answer with no safety signal", () => {
    const answer = "Offer simple analgesia and reassess in one hour.";
    expect(primaryAnswerDisplayText(answer)).toBe(answer);
  });
});

describe("sourceQuoteDisplayText", () => {
  it("removes PDF navigation, footnote, and list artifacts from a cited passage", () => {
    const extracted =
      "Section: Consent > Consent requirements | Page: 9 | o for maintenance ECT consent must be obtained after 12 treatments or every three (3) months, whichever comes first 13 [Level GPP] • complete baseline pathology investigations and ECG.";

    expect(sourceQuoteDisplayText(extracted)).toBe(
      "Consent requirements. For maintenance ECT consent must be obtained after 12 treatments or every three (3) months, whichever comes first 13. Complete baseline pathology investigations and ECG.",
    );
  });

  it("preserves clinically meaningful O tokens in source quotes", () => {
    expect(sourceQuoteDisplayText("blood group o positive should be interpreted with Rh status.")).toContain(
      "Blood group o positive should be interpreted with Rh status.",
    );
    expect(sourceQuoteDisplayText("Record temperature at 37 o C and document response.")).toContain(
      "Record temperature at 37 o C and document response.",
    );
  });

  it("removes evidence-grade markers without dropping nearby numeric values", () => {
    const extracted = "Administer 12 [Level A] as directed and monitor renal function.";
    const result = sourceQuoteDisplayText(extracted);

    expect(result).toContain("Administer 12");
    expect(result).not.toContain("[Level");
  });

  it("preserves clinically meaningful comparison symbols and numbers", () => {
    expect(sourceQuoteDisplayText("Page: 4 | • Withhold if ANC < 1.0 ×10⁹/L.")).toBe("Withhold if ANC < 1.0 ×10⁹/L.");
  });
});
