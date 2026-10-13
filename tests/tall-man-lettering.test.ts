import { describe, expect, it } from "vitest";

import { formatTallMan, isTallManMedication, ISMP_TALL_MAN_MEDICATIONS } from "@/lib/medications/tall-man";

describe("ISMP Tall Man Lettering for Psychotropic Safety (CS-002)", () => {
  it("formats look-alike / sound-alike psychiatric pairs with standard ISMP Tall Man lettering", () => {
    expect(formatTallMan("clozapine")).toBe("cloZAPine");
    expect(formatTallMan("clonidine")).toBe("cloNIDine");
    expect(formatTallMan("clonazepam")).toBe("clonazePAM");
    expect(formatTallMan("lorazepam")).toBe("lorazePAM");
    expect(formatTallMan("hydroxyzine")).toBe("hydrOXYzine");
    expect(formatTallMan("hydralazine")).toBe("hydrALAZINE");
    expect(formatTallMan("fluoxetine")).toBe("fluOXEtine");
    expect(formatTallMan("fluvoxamine")).toBe("fluvOXAMine");
    expect(formatTallMan("olanzapine")).toBe("olanzaPINE");
    expect(formatTallMan("quetiapine")).toBe("queTIApine");
    expect(formatTallMan("bupropion")).toBe("buPROPion");
    expect(formatTallMan("buspirone")).toBe("busPIRone");
  });

  it("handles case-insensitivity and extra whitespace gracefully", () => {
    expect(formatTallMan("  CLOZAPINE ")).toBe("cloZAPine");
    expect(formatTallMan("Clonidine")).toBe("cloNIDine");
  });

  it("returns original string unchanged when medication is not in LASA list", () => {
    expect(formatTallMan("lithium")).toBe("lithium");
    expect(formatTallMan("metformin")).toBe("metformin");
  });

  it("correctly identifies whether a drug is on the ISMP / ACSQHC Tall Man list", () => {
    expect(isTallManMedication("clozapine")).toBe(true);
    expect(isTallManMedication("cloZAPine")).toBe(true);
    expect(isTallManMedication("aspirin")).toBe(false);
  });

  it("contains critical high-alert psychiatric drugs in the registry", () => {
    expect(ISMP_TALL_MAN_MEDICATIONS["clozapine"]).toBe("cloZAPine");
    expect(ISMP_TALL_MAN_MEDICATIONS["clonidine"]).toBe("cloNIDine");
    expect(ISMP_TALL_MAN_MEDICATIONS["valproate"]).toBe("VALproate");
    expect(ISMP_TALL_MAN_MEDICATIONS["carbamazepine"]).toBe("carbaMAZEpine");
  });
});
