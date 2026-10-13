import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { THERAPY_CATALOGUE_ASSETS } from "@/components/therapy-compass/data/generated-assets";
import type { Therapy } from "@/components/therapy-compass/data/types";
import {
  glanceLine,
  glanceList,
  KEY_FACT_GLANCE_MAX_CHARS,
  therapyKeyFactCards,
} from "@/components/therapy-compass/record/key-fact-cards";

const catalogue = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/therapy-compass-data", THERAPY_CATALOGUE_ASSETS.full), "utf8"),
) as Therapy[];

function bySlug(slug: string): Therapy {
  const record = catalogue.find((therapy) => therapy.slug === slug);
  if (!record) throw new Error(`Expected the catalogue to carry ${slug}`);
  return record;
}

function therapyStub(overrides: Partial<Therapy>): Therapy {
  return {
    slug: "stub",
    name: "Stub therapy",
    category: "Standard Talking Therapies",
    reviewStatus: "needs_review",
    patientSheetAvailable: false,
    briefInterventionAvailable: false,
    tags: [],
    warnings: [],
    aliases: [],
    sources: [],
    patientSheetTemplates: [],
    clinicianScripts: [],
    reviewChecklist: null,
    ...overrides,
  } as Therapy;
}

describe("glanceLine", () => {
  it("keeps a short first sentence whole", () => {
    expect(glanceLine("Group programme. Longer protocol notes follow.")).toBe("Group programme.");
  });

  it("strips a trailing citation before measuring the budget", () => {
    const face = glanceLine(
      "Assess mania, delirium, and untreated sleep apnoea before starting. (PubMed) Extra sentence.",
    );
    expect(face).not.toContain("PubMed");
    expect(face.endsWith("…") || face.length <= KEY_FACT_GLANCE_MAX_CHARS).toBe(true);
  });

  it("trims at a word boundary and marks the overflow", () => {
    const face = glanceLine(
      "Patients with persistent insomnia who can keep sleep diaries, tolerate behaviour change, and engage with counterintuitive sleep interventions.",
    );
    expect(face.length).toBeLessThanOrEqual(KEY_FACT_GLANCE_MAX_CHARS);
    expect(face.endsWith("…")).toBe(true);
    expect(face).not.toMatch(/\S…\S/);
    expect(face).not.toContain("interventions");
  });

  it("returns empty for blank input", () => {
    expect(glanceLine("   ")).toBe("");
    expect(glanceLine(null)).toBe("");
  });
});

describe("glanceList", () => {
  it("keeps a single setting as the face", () => {
    expect(glanceList("Outpatient")).toBe("Outpatient");
  });

  it("shows the first setting plus an overflow count", () => {
    expect(glanceList("Emergency/acute, Telehealth/digital, Group")).toBe("Emergency/acute +2");
  });
});

describe("therapyKeyFactCards", () => {
  it("emits Cautions, Format, Setting, and Suits — never Evidence", () => {
    const cards = therapyKeyFactCards(bySlug("cognitive-behavioural-therapy-for-insomnia"));
    expect(cards.map((card) => card.label)).toEqual(["Cautions", "Format", "Setting", "Suits"]);
    expect(cards.some((card) => card.label === "Evidence" || card.id === ("evidence" as typeof card.id))).toBe(false);
  });

  it("gives CBT-I complete faces and longer sheet bodies", () => {
    const cards = therapyKeyFactCards(bySlug("cognitive-behavioural-therapy-for-insomnia"));
    const byId = Object.fromEntries(cards.map((card) => [card.id, card]));

    expect(byId.format.face).toBe("Group programme");
    expect(byId.format.body).toContain("4–8 sessions");
    expect(byId.format.hasDetail).toBe(true);

    expect(byId.setting.face).toBe("Emergency/acute +2");
    expect(byId.setting.body).toBe("Emergency/acute, Telehealth/digital, Group");
    expect(byId.setting.hasDetail).toBe(true);

    expect(byId.suits.face.length).toBeLessThanOrEqual(KEY_FACT_GLANCE_MAX_CHARS);
    expect(byId.suits.face.endsWith("…")).toBe(true);
    expect(byId.suits.body).toContain("sleep diaries");
    expect(byId.suits.hasDetail).toBe(true);

    // Cautions is a safety cue: the whole first sentence, never cut to the glance budget.
    expect(byId.cautions.face.endsWith("…")).toBe(false);
    expect(byId.cautions.body.startsWith(byId.cautions.face.replace(/\.$/, ""))).toBe(true);
    expect(byId.cautions.body.length).toBeGreaterThan(byId.cautions.face.length);
    expect(byId.cautions.hasDetail).toBe(true);
  });

  it("uses timeRequired as the Format face when session length is absent", () => {
    const cards = therapyKeyFactCards(
      therapyStub({
        timeRequired: "4–8 sessions with between-session practice.",
        setting: "Outpatient",
        patientPopulation: "Adults.",
      }),
    );
    const format = cards.find((card) => card.id === "format");
    expect(format).toMatchObject({
      face: "4–8 sessions with between-session practice.",
      body: "4–8 sessions with between-session practice.",
      hasDetail: false,
    });
  });

  it("does not promise detail when the face is the whole field", () => {
    const cards = therapyKeyFactCards(
      therapyStub({
        contraindicationsOrCautions: "Avoid in acute mania.",
        sessionLength: "Single session",
        timeRequired: "Single session",
        setting: "Outpatient",
        patientPopulation: "Adults.",
      }),
    );
    const byId = Object.fromEntries(cards.map((card) => [card.id, card]));
    expect(byId.cautions.face).toBe("Avoid in acute mania.");
    expect(byId.cautions.hasDetail).toBe(false);
    expect(byId.format.hasDetail).toBe(false);
    expect(byId.setting.face).toBe("Outpatient");
    expect(byId.setting.hasDetail).toBe(false);
    expect(byId.suits.hasDetail).toBe(false);
  });

  it("appends limitations only when they add something new", () => {
    const overlapping = therapyKeyFactCards(
      therapyStub({
        contraindicationsOrCautions: "Avoid in acute mania. Limited in psychosis.",
        limitations: "Limited in psychosis.",
        sessionLength: "Single session",
        setting: "Outpatient",
        patientPopulation: "Adults.",
      }),
    );
    expect(overlapping[0]?.body).toBe("Avoid in acute mania. Limited in psychosis.");

    const extra = therapyKeyFactCards(
      therapyStub({
        contraindicationsOrCautions: "Avoid in acute mania.",
        limitations: "Not a first-line trauma treatment.",
        sessionLength: "Single session",
        setting: "Outpatient",
        patientPopulation: "Adults.",
      }),
    );
    expect(extra[0]?.body).toContain("Avoid in acute mania.");
    expect(extra[0]?.body).toContain("Not a first-line trauma treatment.");
    expect(extra[0]?.hasDetail).toBe(true);
  });

  it("keeps every catalogue face on budget and off the Evidence label", () => {
    expect(catalogue.length).toBe(205);
    for (const therapy of catalogue) {
      const cards = therapyKeyFactCards(therapy);
      expect(cards).toHaveLength(4);
      expect(cards.map((card) => card.id)).toEqual(["cautions", "format", "setting", "suits"]);
      for (const card of cards) {
        expect(card.label).not.toBe("Evidence");
        // Cautions is exempt from the glance budget: a safety cue reads as a whole
        // sentence (it takes the full row on phones) and is never cut with an ellipsis.
        if (card.id === "cautions") {
          expect(card.face.endsWith("…")).toBe(false);
          continue;
        }
        expect(card.face.length).toBeLessThanOrEqual(KEY_FACT_GLANCE_MAX_CHARS);
        if (card.face.endsWith("…")) {
          expect(card.face.slice(0, -1)).not.toMatch(/\s$/);
          expect(card.hasDetail).toBe(true);
        }
      }
    }
  });
});
