import { describe, expect, it } from "vitest";

import { formatTallMan, isTallManMedication, ISMP_TALL_MAN_MEDICATIONS } from "@/lib/medications/tall-man";

describe("ISMP & ACSQHC Tall Man Lettering for Psychotropic Safety (CS-002)", () => {
  it("formats look-alike / sound-alike psychiatric pairs with standard ISMP / ACSQHC Tall Man lettering", () => {
    expect(formatTallMan("clozapine")).toBe("cloZAPine");
    expect(formatTallMan("clonidine")).toBe("cloNIDine");
    expect(formatTallMan("citalopram")).toBe("CITalopram");
    expect(formatTallMan("escitalopram")).toBe("ESCitalopram");
    expect(formatTallMan("flupentixol")).toBe("FLUpentixol");
    expect(formatTallMan("flupenthixol")).toBe("FLUpenthixol");
    expect(formatTallMan("zuclopenthixol")).toBe("ZUCLOpenthixol");
    expect(formatTallMan("clonazepam")).toBe("CLONazepam");
    expect(formatTallMan("lorazepam")).toBe("LORazepam");
    expect(formatTallMan("diazepam")).toBe("DIAZepam");
    expect(formatTallMan("oxazepam")).toBe("OXazepam");
    expect(formatTallMan("temazepam")).toBe("TEMazepam");
    expect(formatTallMan("alprazolam")).toBe("ALPRAZolam");
    expect(formatTallMan("midazolam")).toBe("MIDazolam");
    expect(formatTallMan("hydroxyzine")).toBe("hydrOXYzine");
    expect(formatTallMan("hydralazine")).toBe("hydrALAZINE");
    expect(formatTallMan("fluoxetine")).toBe("FLUoxetine");
    expect(formatTallMan("fluvoxamine")).toBe("fluvoxaMINE");
    expect(formatTallMan("olanzapine")).toBe("OLANZapine");
    expect(formatTallMan("quetiapine")).toBe("QUEtiapine");
    expect(formatTallMan("bupropion")).toBe("buPROPion");
    expect(formatTallMan("buspirone")).toBe("busPIRone");
    expect(formatTallMan("chlorpromazine")).toBe("chlorproMAZINE");
    expect(formatTallMan("chlorpropamide")).toBe("chlorproPAMIDE");
    expect(formatTallMan("clomipramine")).toBe("clomiPRAMINE");
    expect(formatTallMan("risperidone")).toBe("risperiDONE");
    expect(formatTallMan("ropinirole")).toBe("ropiniROLE");
    expect(formatTallMan("aripiprazole")).toBe("ARIPiprazole");
    expect(formatTallMan("rabeprazole")).toBe("rabePRAZOLE");
  });

  it("formats compound medication strings using word-boundary token matching", () => {
    expect(formatTallMan("Flupentixol decanoate")).toBe("FLUpentixol decanoate");
    expect(formatTallMan("Clozapine (Clopine)")).toBe("cloZAPine (Clopine)");
    expect(formatTallMan("Zuclopenthixol acetate 50 mg")).toBe("ZUCLOpenthixol acetate 50 mg");
  });

  it("handles case-insensitivity and extra whitespace gracefully", () => {
    expect(formatTallMan("  CLOZAPINE ")).toBe("cloZAPine");
    expect(formatTallMan("Clonidine")).toBe("cloNIDine");
  });

  it("returns original string unchanged when medication is not in LASA list", () => {
    expect(formatTallMan("lithium")).toBe("lithium");
    expect(formatTallMan("metformin")).toBe("metformin");
    expect(formatTallMan("valproate")).toBe("valproate");
  });

  it("correctly identifies whether a drug or compound string is on the ISMP / ACSQHC Tall Man list", () => {
    expect(isTallManMedication("clozapine")).toBe(true);
    expect(isTallManMedication("cloZAPine")).toBe(true);
    expect(isTallManMedication("Flupentixol decanoate")).toBe(true);
    expect(isTallManMedication("Clozapine (Clopine)")).toBe(true);
    expect(isTallManMedication("aspirin")).toBe(false);
    expect(isTallManMedication("valproate")).toBe(false);
  });

  it("contains critical high-alert psychiatric drugs in the registry without unverified entries", () => {
    expect(ISMP_TALL_MAN_MEDICATIONS["clozapine"]).toBe("cloZAPine");
    expect(ISMP_TALL_MAN_MEDICATIONS["clonidine"]).toBe("cloNIDine");
    expect(ISMP_TALL_MAN_MEDICATIONS["carbamazepine"]).toBe("carBAMazepine");
    expect(ISMP_TALL_MAN_MEDICATIONS["valproate"]).toBeUndefined();
  });
});
