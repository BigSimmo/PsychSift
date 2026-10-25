import { describe, expect, it } from "vitest";
import { buildDocumentSummaryBadges, documentTagGroupTone } from "@/lib/document-summary-badges";
import { SEMANTIC_TONE_PRIORITY } from "@/lib/semantic-tone";
import type { DocumentLabel } from "@/lib/types";

function label(overrides: Partial<DocumentLabel>): DocumentLabel {
  return {
    id: overrides.id ?? `${overrides.label ?? "label"}-id`,
    document_id: overrides.document_id ?? "doc-1",
    label: overrides.label ?? "monitoring",
    label_type: overrides.label_type ?? "topic",
    source: overrides.source ?? "generated",
    confidence: overrides.confidence ?? 0.8,
    ...overrides,
  };
}

describe("documentTagGroupTone", () => {
  it("maps safety and action groups onto the canonical tones", () => {
    expect(documentTagGroupTone.Risk).toBe("warning");
    expect(documentTagGroupTone.Medication).toBe("clinical");
    expect(documentTagGroupTone["Clinical action"]).toBe("clinical");
    expect(documentTagGroupTone.Workflow).toBe("info");
    expect(documentTagGroupTone.Manual).toBe("success");
    expect(documentTagGroupTone.Site).toBe("neutral");
    expect(documentTagGroupTone.Topic).toBe("neutral");
  });
});

describe("buildDocumentSummaryBadges", () => {
  it("promotes safety-relevant labels and detected phrases, ordered by tone priority", () => {
    const badges = buildDocumentSummaryBadges({
      labels: [
        label({ label: "lithium", label_type: "medication", confidence: 0.9 }),
        label({ label: "toxicity risk", label_type: "risk", confidence: 0.85 }),
        label({ label: "prescribing", label_type: "workflow", confidence: 0.8 }),
        label({ label: "fiona stanley hospital", label_type: "site", confidence: 0.9 }),
      ],
      summaryText:
        "Lithium is a high-risk medication with a narrow therapeutic index. Serum levels require monitoring.",
    });

    const labels_ = badges.map((badge) => badge.label);
    expect(labels_).toContain("Lithium");
    expect(labels_).toContain("Narrow therapeutic index");
    expect(labels_).toContain("High-risk medication");
    expect(labels_).toContain("Monitoring required");
    // Workflow and site labels stay in the tag cloud, not the badge cluster.
    expect(labels_).not.toContain("Prescribing");
    expect(labels_.join(" ")).not.toMatch(/Stanley/);

    // Ordered by descending tone priority: warnings before clinical before info.
    const priorities = badges.map((badge) => SEMANTIC_TONE_PRIORITY[badge.tone]);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });

  it("reserves danger for contraindications and gives Schedule 8 the lock icon", () => {
    const badges = buildDocumentSummaryBadges({
      summaryText: "Contraindicated in severe renal impairment. This Schedule 8 medicine requires monitoring.",
    });
    const contraindication = badges.find((badge) => badge.label === "Contraindications");
    const controlled = badges.find((badge) => badge.label === "Schedule 8");
    expect(contraindication?.tone).toBe("danger");
    expect(controlled?.tone).toBe("warning");
    expect(controlled?.iconKey).toBe("controlled");
    expect(badges[0]).toBe(contraindication);
  });

  it("does not emit a danger badge for negated contraindication text", () => {
    // A red Contraindications badge on negated text is a false clinical stop signal.
    for (const summaryText of [
      "There are no contraindications to this therapy.",
      "Lithium is not contraindicated in mild renal impairment.",
      "No known contraindications have been reported.",
      "Contraindications: none listed for this formulation.",
      "Contraindications - nil known.",
      "Contraindications: N/A.",
    ]) {
      const badges = buildDocumentSummaryBadges({ summaryText });
      expect(badges.find((badge) => badge.label === "Contraindications")).toBeUndefined();
    }
    // Still fires when a genuine (non-negated) contraindication is described.
    const positive = buildDocumentSummaryBadges({
      summaryText: "No dose adjustment needed, but it is contraindicated in severe hepatic failure.",
    });
    expect(positive.find((badge) => badge.label === "Contraindications")?.tone).toBe("danger");
    // A later "none" that is not the label's own value does not negate it.
    const labelled = buildDocumentSummaryBadges({
      summaryText: "Contraindications: severe renal impairment; none of the listed interactions apply.",
    });
    expect(labelled.find((badge) => badge.label === "Contraindications")?.tone).toBe("danger");
  });

  it("deduplicates equivalent label- and phrase-derived badges by display label", () => {
    const badges = buildDocumentSummaryBadges({
      labels: [label({ label: "high-risk medication", label_type: "risk", confidence: 0.9 })],
      summaryText: "This is a high-risk medication.",
    });
    expect(badges.filter((badge) => badge.label.toLowerCase() === "high-risk medication")).toHaveLength(1);
  });

  it("applies the limit and handles empty input", () => {
    const badges = buildDocumentSummaryBadges({
      summaryText:
        "Contraindicated in pregnancy. Schedule 8. Toxicity and escalation criteria apply; urgent review. " +
        "Narrow therapeutic index, high-risk medication, monitoring required.",
      limit: 3,
    });
    expect(badges).toHaveLength(3);
    expect(buildDocumentSummaryBadges({})).toEqual([]);
    expect(buildDocumentSummaryBadges({ labels: null, summaryText: null })).toEqual([]);
  });
});
