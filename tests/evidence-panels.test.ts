import { describe, expect, it } from "vitest";
import { compactEvidenceSummary } from "../src/components/clinical-dashboard/evidence-panels";
import type { ClientRagAnswerPayload } from "../src/lib/answer-client-payload";
import { buildAnswerRenderModel } from "../src/lib/answer-render-policy";

// #WGMB4Z decision 17 (owner, 2026-09-25): the summary's support word follows the label cap,
// not render trust, so a high-trust answer without reviewed direct support reads "Supported".
describe("compactEvidenceSummary support word", () => {
  const payload = (strongSupportLabelCapped?: boolean): ClientRagAnswerPayload => ({
    answer: "Check lithium levels.",
    grounded: true,
    confidence: "high",
    citations: [],
    sources: [],
    relevance: {
      verdict: "direct",
      label: "Direct",
      matchedTerms: [],
      missingTerms: [],
      directSourceCount: 1,
      weakSourceCount: 0,
      score: 1,
      supportReason: "Direct support",
      isSourceBacked: true,
    },
    ...(strongSupportLabelCapped === undefined ? {} : { strongSupportLabelCapped }),
  });

  it.each([
    [true, "Supported"],
    [false, "Strong support"],
    [undefined, "Strong support"],
  ] as const)("strongSupportLabelCapped=%s starts with %j", (capped, word) => {
    const answer = payload(capped);
    const renderModel = buildAnswerRenderModel(answer);
    expect(renderModel.trust).toBe("high");
    const summary = compactEvidenceSummary(answer, [], undefined, renderModel);
    expect(summary.split(" · ")[0]).toBe(word);
    if (capped) expect(summary).not.toContain("Strong support");
  });
});
