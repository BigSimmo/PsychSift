/** @vitest-environment jsdom */

// Screens rendered without a sign-in provider (as many dom tests do) must
// still read the example data switch: no throw, no auto default, and an
// explicit choice still applies.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { isExampleRecord } from "@/lib/example-data/guards";
import { resetExampleDataForTests, setExampleDataOn, useExampleData } from "@/lib/example-data/store";

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
});

describe("useExampleData without a sign-in provider", () => {
  it("does not throw, and is off until the user turns it on", () => {
    const { result } = renderHook(() => useExampleData("call"));
    expect(result.current.mode).toBe("auto");
    expect(result.current.active).toBe(false);
    act(() => setExampleDataOn(true));
    expect(result.current.active).toBe(true);
  });
});

describe("isExampleRecord", () => {
  it("recognises the On Call demo corpus's fixed ids and leaves a real id alone", () => {
    expect(isExampleRecord({ id: "00000000-0000-4000-8000-000000000101" })).toBe(true);
    expect(isExampleRecord({ id: "6f1c2b9e-3d4a-4b8c-9e2f-1a2b3c4d5e6f" })).toBe(false);
  });
});
