import { describe, expect, it } from "vitest";
import { extractReporters, vitestRunIsMemoisable } from "../scripts/run-vitest.mjs";

describe("Vitest result reuse matches CLI modes and reporter aliases", () => {
  it.each([
    ["run", "--reporters=json"],
    ["run", "--reporters", "junit"],
    ["run", "--reporter=blob"],
    ["run", "--reporters", "./custom.mjs"],
    ["run", "-w"],
    ["watch"],
    ["dev"],
    ["list"],
    ["bench"],
    [],
  ])("does not reuse artifact or interactive invocation %j", (...args) => {
    expect(vitestRunIsMemoisable(args)).toBe(false);
  });
  it("collects plural reporters and retains ordinary console reuse", () => {
    expect(extractReporters(["--reporters=json", "--reporters", "junit"])).toEqual(["json", "junit"]);
    expect(vitestRunIsMemoisable(["run", "tests/example.test.ts"])).toBe(true);
    expect(vitestRunIsMemoisable(["run", "--reporters=verbose"])).toBe(true);
  });
});
