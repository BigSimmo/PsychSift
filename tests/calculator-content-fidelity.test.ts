import { describe, expect, it } from "vitest";

import { calculators as mockupCalculators } from "@/components/calculator-mockups/calculator-fixtures";
import { calculators as productionCalculators } from "@/components/calculators/calculator-fixtures";

/*
 * Content-fidelity guard for the administered PHQ-9 wording, across BOTH trees.
 *
 * `calculator-fixtures.ts` carries a self-consistent wording fingerprint
 * (`wordingSetId`) and `tests/calculators-governance-hardening.test.ts`
 * recomputes it from the live items. That catches accidental drift, but a
 * fingerprint recomputed from the same fixture cannot catch an intentional
 * paraphrase that ships with an updated hash. This test pins the wording
 * against the approved instrument text so any future paraphrase — even one
 * that also regenerates the fingerprint — goes red.
 *
 * The production fixture (`src/lib/calculators`, re-exported through
 * `src/components/calculators`) and the mockup fixture
 * (`src/components/calculator-mockups`) are two separate copies that have
 * drifted silently before (Ledger #0JGJTK), so both are pinned here.
 *
 * Source: PHQ-9, Kroenke, Spitzer & Williams (2001). Wording as standardised
 * in LOINC (PHQ-9 items 44249-1 … 44261-6) and reproduced in the instrument
 * sheet; item 7 reads "reading the newspaper or watching television" and item
 * 8 reads "Moving or speaking so slowly that other people could have noticed?"
 * with the "moving around a lot more than usual" anchor.
 */

const PHQ9_CANONICAL = {
  stem: "Over the last 2 weeks, how often have you been bothered by:",
  items: [
    "Little interest or pleasure in doing things",
    "Feeling down, depressed, or hopeless",
    "Trouble falling or staying asleep, or sleeping too much",
    "Feeling tired or having little energy",
    "Poor appetite or overeating",
    "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
    "Trouble concentrating on things, such as reading the newspaper or watching television",
    "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
    "Thoughts that you would be better off dead, or of hurting yourself in some way",
  ],
  options: ["Not at all", "Several days", "More than half the days", "Nearly every day"],
  source: "Kroenke, Spitzer & Williams 2001",
} as const;

type Phq9Fixture = {
  id: string;
  stem?: string;
  source: string;
  items: Array<{ text: string; options?: Array<{ label: string }> }>;
};

function findPhq9(collection: readonly Phq9Fixture[]): Phq9Fixture {
  const calc = collection.find((entry) => entry.id === "phq9");
  if (!calc) throw new Error('calculator fixture "phq9" not found');
  return calc;
}

const trees = [
  ["production", productionCalculators],
  ["mockup", mockupCalculators],
] as const;

describe("PHQ-9 content fidelity (approved source wording)", () => {
  it.each(trees)("pins the question stem in the %s tree", (_label, collection) => {
    expect(findPhq9(collection).stem).toBe(PHQ9_CANONICAL.stem);
  });

  it.each(trees)("pins every item wording in the %s tree", (_label, collection) => {
    expect(findPhq9(collection).items.map((item) => item.text)).toEqual(PHQ9_CANONICAL.items);
  });

  it.each(trees)("pins the response anchors in the %s tree", (_label, collection) => {
    const options = findPhq9(collection).items[0]?.options;
    expect(options?.map((option) => option.label)).toEqual(PHQ9_CANONICAL.options);
  });

  it.each(trees)("attributes the source in the %s tree", (_label, collection) => {
    expect(findPhq9(collection).source).toBe(PHQ9_CANONICAL.source);
  });
});
