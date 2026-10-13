import { describe, expect, it, vi } from "vitest";

const sampleObj = { calculate: () => 42 };

describe("Vitest Node mock isolation (TS-01)", () => {
  it("part A: stubs a global and creates a spy", () => {
    vi.stubGlobal("__PSYCHSIFT_TEST_STUB__", "active_stub");
    expect((globalThis as Record<string, unknown>).__PSYCHSIFT_TEST_STUB__).toBe("active_stub");

    vi.spyOn(sampleObj, "calculate").mockReturnValue(100);
    expect(sampleObj.calculate()).toBe(100);
  });

  it("part B: verifies globals and spies are automatically restored by setup", () => {
    // If afterEach unstubAllGlobals ran, the stub property should be undefined
    expect((globalThis as Record<string, unknown>).__PSYCHSIFT_TEST_STUB__).toBeUndefined();

    // This is the same object spied on in part A, so restoration is observable.
    expect(sampleObj.calculate()).toBe(42);
  });
});
