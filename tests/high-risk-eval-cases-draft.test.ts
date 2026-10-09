import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Draft high-risk answer-quality cases (#ZZ4RAP). This test only proves the draft
// is grounded: every expected fact must be quoted verbatim from a source passage the
// repository already holds. It does not run the cases or wire them into the eval
// harness; that waits for the owner's clinical review and a live canary pair.

type Evidence = { file: string; passageId?: string; section?: string; quotes: string[] };
type DraftCase = {
  id: string;
  area: string;
  question: string;
  expectedBehaviour: "answer" | "correct_the_premise" | "source_needed";
  mustContain: string[][];
  mustNotState: string[];
  expectedSources: string[];
  evidence: Evidence[];
  reviewNote?: string;
};

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const normalise = (text: string) => text.replace(/\s+/g, " ").trim();

const draft = readJson("tests/fixtures/high-risk-eval-cases.draft.json") as {
  reviewStatus: string;
  cases: DraftCase[];
};

type Passage = { id: string; content: string };
const lithiumPassages: Passage[] = readJson("tests/fixtures/lithium-monitoring-live-excerpts.json").cases.flatMap(
  (entry: { sources: Passage[] }) => entry.sources,
);
const clozapinePassages: Passage[] = readJson("tests/fixtures/clozapine-threshold-source-chunks.json");
const mhaSections: { section: string; text: string }[] = readJson("data/mha-2014-sections.source.json").sections;

function sourceText(evidence: Evidence): string | undefined {
  if (evidence.file === "data/mha-2014-sections.source.json") {
    return mhaSections.find((section) => section.section === evidence.section)?.text;
  }
  const passages =
    evidence.file === "tests/fixtures/lithium-monitoring-live-excerpts.json"
      ? lithiumPassages
      : evidence.file === "tests/fixtures/clozapine-threshold-source-chunks.json"
        ? clozapinePassages
        : [];
  return passages.find((passage) => passage.id === evidence.passageId)?.content;
}

describe("high-risk eval cases draft", () => {
  it("stays a draft until the owner has reviewed it", () => {
    expect(draft.reviewStatus).toBe("draft_awaiting_owner_review");
  });

  it("covers the owner's recommended mix of twenty cases", () => {
    const counts: Record<string, number> = {};
    for (const testCase of draft.cases) counts[testCase.area] = (counts[testCase.area] ?? 0) + 1;
    expect(counts).toEqual({
      pregnancy_breastfeeding: 3,
      renal_hepatic: 3,
      older_adult: 2,
      qtc: 2,
      lithium_clozapine_monitoring: 2,
      overdose_toxicity: 2,
      drug_interaction: 2,
      mental_health_act: 2,
      false_premise: 2,
    });
    expect(new Set(draft.cases.map((testCase) => testCase.id)).size).toBe(draft.cases.length);
  });

  it("quotes every piece of evidence verbatim from a held source passage", () => {
    for (const testCase of draft.cases) {
      for (const evidence of testCase.evidence) {
        const text = sourceText(evidence);
        expect(text, `${testCase.id}: source passage not found`).toBeDefined();
        for (const quote of evidence.quotes) {
          expect(normalise(text!), `${testCase.id}: quote not in source`).toContain(normalise(quote));
        }
      }
    }
  });

  it("draws every required fact from the quoted evidence", () => {
    for (const testCase of draft.cases) {
      const quoted = normalise(testCase.evidence.flatMap((evidence) => evidence.quotes).join(" ")).toLowerCase();
      for (const alternatives of testCase.mustContain) {
        expect(
          alternatives.some((fact) => quoted.includes(normalise(fact).toLowerCase())),
          `${testCase.id}: none of [${alternatives.join(", ")}] is in the quoted evidence`,
        ).toBe(true);
      }
    }
  });

  it("marks a case source_needed exactly when it has no evidence or expected facts", () => {
    for (const testCase of draft.cases) {
      const ungrounded = testCase.evidence.length === 0 || testCase.mustContain.length === 0;
      expect(testCase.expectedBehaviour === "source_needed", testCase.id).toBe(ungrounded);
      if (ungrounded) expect(testCase.reviewNote, testCase.id).toBeTruthy();
    }
  });
});
