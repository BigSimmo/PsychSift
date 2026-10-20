import { describe, expect, it } from "vitest";
import { vitestLeaseMode } from "../scripts/test-run-selection.mjs";

describe("Vitest lease selection requires every selector to be bounded", () => {
  it.each([
    ["run", "tests/example.test.ts", "tests"],
    ["run", "tests", "tests/example.test.ts"],
    ["run", "tests/example.test.ts", "src"],
    ["run", "tests/example.test.ts", "tests/*.test.ts"],
    ["run", "tests/../example.test.ts"],
    ["run", "tests/example.test.ts", "--", "tests"],
    ["run", "--testNamePattern", "tests/example.test.ts"],
    ["run", "tests/example.test.ts", "--unknown", "tests"],
    ["run", "tests/example.test.ts", "--reporter"],
    ["related", "--run", "src/example.ts", "src"],
    ["related", "src", "--run", "src/example.ts"],
    ["related", "--run", "src/**/*.ts"],
  ])("uses an exclusive lease for broad or ambiguous invocation %j", (...args) => {
    expect(vitestLeaseMode(args)).toBe("exclusive");
  });

  it.each([
    ["run", "tests/example.test.ts", "tests/second.dom.test.tsx"],
    ["run", "--reporter", "dot", "tests/example.test.ts"],
    ["run", "tests/example.test.ts", "--reporters=verbose", "-t", "specific case"],
    ["run", "--", "tests/example.test.ts"],
    ["related", "--run", "src/example.ts"],
    ["related", "src/example.ts", "--run", "--reporter=dot"],
  ])("retains a shared lease for bounded invocation %j", (...args) => {
    expect(vitestLeaseMode(args)).toBe("shared");
  });
});
