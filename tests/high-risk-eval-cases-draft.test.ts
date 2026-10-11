import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { answerQualityEvalCases } from "../src/lib/rag/rag-eval-cases";

// High-risk answer-quality cases (#ZZ4RAP). This test proves the cases are grounded:
// every expected fact must be quoted verbatim from a source passage the repository
// already holds. It also proves the cases wired into answerQualityEvalCases match
// this evidence record exactly, so the harness cannot drift from the quotes.

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

type Passage = {
  id: string;
  content: string;
  file_name?: string;
  source_metadata?: { source_title?: string };
};
const mhaSourcePath = "data/mha-2014-sections.source.json";
const passagesByFile: Record<string, Passage[]> = {
  "tests/fixtures/lithium-monitoring-live-excerpts.json": readJson(
    "tests/fixtures/lithium-monitoring-live-excerpts.json",
  ).cases.flatMap((entry: { sources: Passage[] }) => entry.sources),
  "tests/fixtures/clozapine-threshold-source-chunks.json": readJson(
    "tests/fixtures/clozapine-threshold-source-chunks.json",
  ),
};
const mhaSections: { section: string; text: string }[] = readJson(mhaSourcePath).sections;

function sourceText(evidence: Evidence): string | undefined {
  if (evidence.file === mhaSourcePath) {
    return mhaSections.find((section) => section.section === evidence.section)?.text;
  }
  return passagesByFile[evidence.file]?.find((passage) => passage.id === evidence.passageId)?.content;
}

// The title a source passage carries in its own metadata, so a case cannot name a
// source its evidence does not come from.
function sourceTitle(evidence: Evidence): string | undefined {
  if (evidence.file === mhaSourcePath) return `Mental Health Act 2014 (WA) s ${evidence.section}`;
  const passage = passagesByFile[evidence.file]?.find((candidate) => candidate.id === evidence.passageId);
  return passage?.source_metadata?.source_title ?? passage?.file_name?.replace(/\.pdf$/i, "");
}

describe("high-risk eval cases draft", () => {
  it("records the owner's go-ahead", () => {
    expect(draft.reviewStatus).toBe("owner_go_ahead");
  });

  it("is mirrored exactly by the harness cases, leaving out the cases with no source", () => {
    const harness = new Map(answerQualityEvalCases.map((testCase) => [testCase.id, testCase] as const));
    for (const testCase of draft.cases) {
      const wired = harness.get(`high-risk-${testCase.id}`);
      if (testCase.expectedBehaviour === "source_needed") {
        expect(wired, testCase.id).toBeUndefined();
        continue;
      }
      expect(wired?.question, testCase.id).toBe(testCase.question);
      expect(wired?.requiredConceptGroups, testCase.id).toEqual(testCase.mustContain);
    }
    const wiredIds = answerQualityEvalCases.filter((testCase) => testCase.id.startsWith("high-risk-"));
    expect(wiredIds).toHaveLength(
      draft.cases.filter((testCase) => testCase.expectedBehaviour !== "source_needed").length,
    );
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

  it("names exactly the sources its evidence comes from", () => {
    for (const testCase of draft.cases.filter((candidate) => candidate.evidence.length > 0)) {
      const evidenceTitles = new Set(testCase.evidence.map(sourceTitle));
      expect(evidenceTitles.has(undefined), `${testCase.id}: evidence without a source title`).toBe(false);
      expect([...evidenceTitles].sort(), testCase.id).toEqual([...new Set(testCase.expectedSources)].sort());
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
