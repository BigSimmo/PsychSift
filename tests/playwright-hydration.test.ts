import type { Locator } from "playwright/test";
import { describe, expect, it, vi } from "vitest";

import { expectHydrated } from "./playwright-settlement";

const navigationError = () =>
  new Error("locator.evaluate: Execution context was destroyed, most likely because of a navigation.");

function syntheticLocator(probe: () => Promise<boolean>) {
  const evaluate =
    vi.fn<(callback: unknown, argument?: unknown, options?: { timeout?: number }) => Promise<boolean>>(probe);
  return { locator: { evaluate } as unknown as Locator, evaluate };
}

describe("hydration polling across streamed canonical redirects", () => {
  it("preserves Playwright's explicit zero-timeout convention", async () => {
    const { locator, evaluate } = syntheticLocator(async () => true);
    await expectHydrated(locator, { timeout: 0 });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0]?.[2]?.timeout).toBe(0);
  });

  it("retries navigation context loss and waits for the replacement node to hydrate within one budget", async () => {
    let calls = 0;
    const { locator, evaluate } = syntheticLocator(async () => {
      calls += 1;
      if (calls === 1) throw navigationError();
      return calls === 3;
    });

    await expectHydrated(locator, { timeout: 1_500 });

    expect(evaluate).toHaveBeenCalledTimes(3);
    const budgets = evaluate.mock.calls.map((call) => call[2]?.timeout);
    for (const budget of budgets) {
      expect(budget).toBeGreaterThan(0);
      expect(budget).toBeLessThanOrEqual(1_500);
    }
    expect(budgets[1]).toBeLessThan(budgets[0]!);
    expect(budgets[2]).toBeLessThan(budgets[1]!);
  });

  it.each([
    "locator.evaluate: Target page, context or browser has been closed",
    'locator.evaluate: Error: strict mode violation: locator("#main-content") resolved to 2 elements',
    "locator.evaluate: Timeout 20ms exceeded.",
    "locator.evaluate: TypeError: Object.keys is unavailable",
    "locator.evaluate: Cannot find context with specified id",
  ])("preserves unexpected failures: %s", async (message) => {
    const failure = new Error(message);
    const { locator, evaluate } = syntheticLocator(async () => {
      throw failure;
    });

    await expect(expectHydrated(locator, { timeout: 500 })).rejects.toBe(failure);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("fails by the existing deadline when navigation keeps replacing the document", async () => {
    const { locator, evaluate } = syntheticLocator(async () => {
      throw navigationError();
    });

    await expect(expectHydrated(locator, { timeout: 200 })).rejects.toThrow(
      "the control must be hydrated before it is used",
    );
    expect(evaluate.mock.calls.length).toBeGreaterThan(1);
    for (const call of evaluate.mock.calls) expect(call[2]?.timeout).toBeLessThanOrEqual(200);
  });

  it("does not accept a document that never hydrates", async () => {
    const { locator } = syntheticLocator(async () => false);
    await expect(expectHydrated(locator, { timeout: 200 })).rejects.toThrow(
      "the control must be hydrated before it is used",
    );
  });
});
