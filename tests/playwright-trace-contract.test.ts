import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../scripts/playwright-base-url", () => ({ getPlaywrightBaseUrl: () => "http://localhost:3999" }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("zero-retry Playwright failure traces", () => {
  for (const ci of ["", "true"]) {
    it(`retains failures without retry when CI=${JSON.stringify(ci)}`, async () => {
      vi.stubEnv("CI", ci);
      vi.stubEnv("PLAYWRIGHT_TRACE", undefined);
      const { default: config } = await import("../playwright.config");
      expect(config.retries).toBe(0);
      expect(config.use?.trace).toBe("retain-on-failure");
      expect(config.projects?.every((project) => project.retries === undefined || project.retries === 0)).toBe(true);
    });
  }
  for (const trace of ["off", "on", "retain-on-failure", "on-first-retry"] as const) {
    it(`preserves the explicit ${trace} override`, async () => {
      vi.stubEnv("CI", "true");
      vi.stubEnv("PLAYWRIGHT_TRACE", trace);
      const { default: config } = await import("../playwright.config");
      expect(config.retries).toBe(0);
      expect(config.use?.trace).toBe(trace);
    });
  }
});
