// Audit check (26 Oct 2026): a brand and its generic must count as ONE medicine, or
// "Zoloft and sertraline together" would route as a two-medicine interaction question.
// `medicationEntitiesInText` already dedupes by canonical name; this pins it.

import { describe, expect, it } from "vitest";

import { medicationEntitiesInText } from "@/lib/medication-entities";

describe("medicationEntitiesInText brand/generic dedupe", () => {
  it.each([
    ["Zoloft and sertraline together", ["sertraline"]],
    ["Clozaril with clozapine", ["clozapine"]],
    ["Epilim and sodium valproate", ["valproate"]],
    ["Lithicarb and lithium interaction", ["lithium"]],
  ])("counts %o as one medicine", (query, expected) => {
    expect(medicationEntitiesInText(query)).toEqual(expected);
  });

  it("still counts two different medicines named by brand and generic", () => {
    expect(medicationEntitiesInText("Zoloft and lithium together")).toEqual(["sertraline", "lithium"]);
  });
});
