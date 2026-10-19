import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import governance from "@/lib/calculators/clinical-math/governance.json";

describe("physiological calculator governance inventory", () => {
  it("keeps every formula and management implementation held without inventing review", () => {
    expect(governance.releaseStatus).toBe("held");
    expect(governance.clinicalReview).toEqual({
      status: "pending",
      reviewer: null,
      reviewedOn: null,
      approvalEvidence: null,
    });
    expect(governance.algorithms.map((entry) => entry.id)).toEqual([
      "cockcroft-gault",
      "ckd-epi-2021",
      "qtc",
      "lithium-level",
      "proportional-lithium-dose",
    ]);
    for (const algorithm of governance.algorithms) {
      expect(algorithm.formula.length).toBeGreaterThan(30);
      expect(algorithm.sourceLeads.length).toBeGreaterThan(0);
      expect(algorithm.reviewRequired.length).toBeGreaterThan(0);
    }
  });

  it("detects drift in all physiological math files and the display boundary", () => {
    const directory = "src/lib/calculators/clinical-math/";
    const implementations = readdirSync(directory)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => directory + file);
    expect(Object.keys(governance.implementationPins).sort()).toEqual(
      [...implementations, "src/components/calculators/clinical-math-panel.tsx"].sort(),
    );
    for (const [path, pin] of Object.entries(governance.implementationPins)) {
      const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
      expect(
        actual,
        `${path} changed: update the held inventory and review scope; a hash is not clinical approval`,
      ).toBe(pin);
    }
  });

  it("inventories every exported physiological calculation", () => {
    const exported = ["renal", "qtc", "lithium"].flatMap((name) => {
      const code = readFileSync(`src/lib/calculators/clinical-math/${name}.ts`, "utf8");
      return [...code.matchAll(/export function (\w+)\(/g)].map((match) => match[1]);
    });
    expect(governance.algorithms.flatMap((entry) => entry.exports).sort()).toEqual(exported.sort());
  });
});
