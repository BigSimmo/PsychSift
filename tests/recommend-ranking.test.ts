import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  inferRecommendConstraints,
  rankRecommendations,
  recommendQueryTokens,
  resolveRecommendConstraints,
} from "@/components/therapy-compass/data/select";
import { THERAPY_CATALOGUE_ASSETS } from "@/components/therapy-compass/data/generated-assets";
import type { Therapy } from "@/components/therapy-compass/data/types";

const fullTherapyRecords = JSON.parse(
  readFileSync(new URL(`../public/therapy-compass-data/${THERAPY_CATALOGUE_ASSETS.full}`, import.meta.url), "utf8"),
) as Therapy[];

function stubTherapy(overrides: Partial<Therapy> & Pick<Therapy, "slug" | "name">): Therapy {
  return {
    category: "Skills based",
    clinicalSummary: null,
    bestUsedFor: null,
    indications: null,
    contraindicationsOrCautions: null,
    deliverySteps: null,
    patientExplanation: null,
    sourceNotes: null,
    targetSymptoms: null,
    patientPopulation: null,
    setting: null,
    sessionLength: null,
    timeRequired: null,
    complexity: null,
    mechanism: null,
    briefVersion: null,
    fifteenMinuteVersion: null,
    fullSessionVersion: null,
    homework: null,
    materials: null,
    commonPitfalls: null,
    alternatives: null,
    relatedTherapies: null,
    evidenceLevel: null,
    evidenceNotes: null,
    limitations: null,
    references: null,
    reviewStatus: "needs_review",
    confidenceLevel: null,
    contentOrigin: null,
    patientSheetAvailable: false,
    briefInterventionAvailable: false,
    sourceCompleteness: null,
    indexCompleteness: null,
    reviewCompleteness: null,
    tags: [],
    warnings: [],
    aliases: [],
    sources: [],
    patientSheetTemplates: [],
    clinicianScripts: [],
    ...overrides,
  } as Therapy;
}

describe("recommend situation ranking", () => {
  it("strips stopwords so generic question language does not dominate", () => {
    expect(recommendQueryTokens("What therapy for anxiety in outpatient care?")).toEqual(["anxiety", "outpatient"]);
  });

  it("infers setting, time and caution chips from the situation text", () => {
    expect(inferRecommendConstraints("anxiety in outpatient clinic, 15 minutes, bipolar mania risk")).toEqual([
      "outpatient",
      "15min",
      "avoid-mania",
    ]);
    expect(inferRecommendConstraints("trauma-focused work on the ward")).toEqual(["inpatient", "trauma"]);
  });

  it("lets an explicit dismiss win over inferred chips", () => {
    expect(resolveRecommendConstraints("outpatient anxiety", ["outpatient"], ["outpatient"])).toEqual([]);
    expect(resolveRecommendConstraints("outpatient anxiety", [], [])).toEqual(["outpatient"]);
  });

  it("ranks CBT-class anxiety treatments above insomnia-specific CBT for an outpatient anxiety situation", () => {
    const ranked = rankRecommendations(fullTherapyRecords, "What therapy for anxiety in outpatient care?", [
      "outpatient",
    ]);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(6);
    const names = ranked.map((row) => row.therapy.name.toLowerCase());
    expect(names.some((name) => name.includes("insomnia"))).toBe(false);
    expect(names[0]).toMatch(
      /anxiety|cbt|cognitive behavioural|cognitive behavioral|panic|exposure|applied relaxation/,
    );
    expect(names.some((name) => /cbt|cognitive behavioural|cognitive behavioral/.test(name))).toBe(true);
    expect(names[0]).not.toMatch(/psychiatric management/);
    expect(ranked[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("penalises mania risk when avoid-mania is active", () => {
    const safe = stubTherapy({
      slug: "safe",
      name: "Calm skills",
      bestUsedFor: "Anxiety in outpatient care",
      setting: "Outpatient/community",
    });
    const risky = stubTherapy({
      slug: "risky",
      name: "Activating protocol",
      bestUsedFor: "Anxiety in outpatient care",
      setting: "Outpatient/community",
      contraindicationsOrCautions: "Avoid in mania; can increase activation.",
    });
    const ranked = rankRecommendations([risky, safe], "anxiety outpatient", ["outpatient", "avoid-mania"]);
    expect(ranked[0]?.therapy.slug).toBe("safe");
    const riskyRow = ranked.find((row) => row.therapy.slug === "risky");
    if (riskyRow) {
      expect(riskyRow.reasons.some((reason) => /mania/i.test(reason))).toBe(true);
      expect(riskyRow.score).toBeLessThan(ranked[0]?.score ?? 0);
    }
  });

  it("does not penalise evidence-based therapies merely for general caution text discussing mania or activation", () => {
    const evidenceBased = stubTherapy({
      slug: "cbt-standard",
      name: "Cognitive behavioural therapy",
      bestUsedFor: "Anxiety in outpatient care",
      setting: "Outpatient/community",
      contraindicationsOrCautions:
        "Check suicide and self-harm risk, psychosis, mania, cognitive capacity. Confirm behavioral activation is indicated.",
    });
    const ranked = rankRecommendations([evidenceBased], "anxiety outpatient", ["outpatient", "avoid-mania"]);
    expect(ranked[0]?.therapy.slug).toBe("cbt-standard");
    expect(ranked[0]?.reasons.some((reason) => /mania/i.test(reason))).toBe(false);
  });

  it("drops unrelated therapies below the relevance floor instead of padding to six", () => {
    const ranked = rankRecommendations(
      [
        stubTherapy({ slug: "noise", name: "Unrelated ritual", bestUsedFor: "Hair pulling", setting: "Inpatient" }),
        stubTherapy({
          slug: "fit",
          name: "Anxiety skills",
          bestUsedFor: "Anxiety disorders in clinic",
          targetSymptoms: "Worry, panic, avoidance",
          setting: "Outpatient/community",
        }),
      ],
      "anxiety outpatient",
      ["outpatient"],
    );
    expect(ranked.map((row) => row.therapy.slug)).toEqual(["fit"]);
  });
});
