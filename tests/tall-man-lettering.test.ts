import { describe, expect, it } from "vitest";

import { ACSQHC_MIXED_CASE_MEDICATIONS, formatTallMan, isTallManMedication } from "@/lib/medications/tall-man";

describe("ACSQHC mixed-case (Tall Man) lettering for psychotropics (CS-002)", () => {
  it("letters names exactly as the National Mixed-Case Lettering List (April 2024) does", () => {
    expect(formatTallMan("quetiapine")).toBe("QUETIAPine");
    expect(formatTallMan("sertraline")).toBe("SERTRALine");
    expect(formatTallMan("risperidone")).toBe("riSPERIDONe");
    expect(formatTallMan("carbamazepine")).toBe("CARBAMazepine");
    expect(formatTallMan("lamotrigine")).toBe("lamOTRIGine");
    expect(formatTallMan("clonazepam")).toBe("CLONazepam");
    expect(formatTallMan("clobazam")).toBe("cloBAZam");
    expect(formatTallMan("diazepam")).toBe("DIAzepam");
    expect(formatTallMan("fluvoxamine")).toBe("fluVOXAMine");
    expect(formatTallMan("methylphenidate")).toBe("methYLPHENIDATE");
  });

  it("keeps cloZAPine as the one local exception", () => {
    expect(formatTallMan("clozapine")).toBe("cloZAPine");
  });

  it("leaves names that are only on the US list unlettered", () => {
    for (const name of [
      "olanzapine",
      "clonidine",
      "hydroxyzine",
      "bupropion",
      "buspirone",
      "valproate",
      "fluoxetine",
    ]) {
      expect(formatTallMan(name)).toBe(name);
    }
  });

  it("handles case-insensitivity and extra whitespace gracefully", () => {
    expect(formatTallMan("  CLOZAPINE ")).toBe("cloZAPine");
    expect(formatTallMan("Quetiapine")).toBe("QUETIAPine");
  });

  it("returns the name unchanged when it is not on the list", () => {
    expect(formatTallMan("lithium")).toBe("lithium");
    expect(formatTallMan("metformin")).toBe("metformin");
  });

  it("identifies whether a medicine is on the list", () => {
    expect(isTallManMedication("clozapine")).toBe(true);
    expect(isTallManMedication("QUETIAPine")).toBe(true);
    expect(isTallManMedication("aspirin")).toBe(false);
  });

  it("keeps every lettered form a case variant of its key", () => {
    for (const [key, lettered] of Object.entries(ACSQHC_MIXED_CASE_MEDICATIONS)) {
      expect(lettered.toLowerCase()).toBe(key);
    }
  });
});
