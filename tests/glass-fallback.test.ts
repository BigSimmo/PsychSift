import { describe, expect, it } from "vitest";

import { GLASS_FALLBACK_SCRIPT, shouldFlattenGlass } from "@/lib/glass-fallback";

const cases: Array<[string, { deviceMemory?: number; hardwareConcurrency?: number }, boolean]> = [
  ["no hints (Safari, Firefox)", {}, false],
  ["mid-range phone", { deviceMemory: 4, hardwareConcurrency: 8 }, false],
  ["2 GB phone", { deviceMemory: 2, hardwareConcurrency: 8 }, true],
  ["1 GB phone", { deviceMemory: 1 }, true],
  ["two cores", { deviceMemory: 4, hardwareConcurrency: 2 }, true],
  ["zero reported", { deviceMemory: 0, hardwareConcurrency: 0 }, false],
];

function runScript(hints: { deviceMemory?: number; hardwareConcurrency?: number }) {
  const attrs = new Map<string, string>();
  const doc = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } };
  new Function("navigator", "document", GLASS_FALLBACK_SCRIPT)(hints, doc);
  return attrs.get("data-glass") === "flat";
}

describe("glass fallback", () => {

  it.each(cases)("%s", (_label, hints, expected) => {
    expect(shouldFlattenGlass(hints)).toBe(expected);
  });

  it.each(cases)("inline script agrees: %s", (_label, hints, expected) => {
    expect(runScript(hints)).toBe(expected);
  });

  it("never throws when navigator is missing", () => {
    expect(() => new Function("navigator", "document", GLASS_FALLBACK_SCRIPT)(undefined, undefined)).not.toThrow();
  });
});
