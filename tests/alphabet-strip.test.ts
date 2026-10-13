import { describe, expect, it } from "vitest";

import { alphabetStripEntries } from "@/components/mode-kit/alphabet-strip";

const entries = (names: string[]) =>
  alphabetStripEntries(
    names,
    (name) => name,
    (name) => name,
  ).map((entry) => `${entry.letter}:${entry.targetId}`);

describe("alphabetStripEntries", () => {
  it("gives the first row for each letter of an A to Z list", () => {
    expect(entries(["Alpha", "Apple", "Beta", "Gamma"])).toEqual(["A:Alpha", "B:Beta", "G:Gamma"]);
  });

  it("skips a stray row without losing the next letter's first row", () => {
    expect(entries(["Goldfields", "WACHS Goldfields", "Hedland", "Hills"])).toEqual(["G:Goldfields", "H:Hedland"]);
    expect(entries(["Goldfields", "WACHS Goldfields", "Hedland", "Inner City"])).toEqual([
      "G:Goldfields",
      "H:Hedland",
      "I:Inner City",
    ]);
  });

  it("gives no strip for a ranked list", () => {
    expect(entries(["Zeta", "Alpha", "Mu", "Beta", "Yota", "Chi"])).toEqual([]);
  });
});
