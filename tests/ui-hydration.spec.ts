import { test, expect } from "playwright/test";

import { expectHydrated } from "./playwright-settlement";

test.describe("React Hydration Safety", () => {
  const scenarios = [
    { name: "dashboard defaults", route: "/", storage: {} },
    {
      // Seed expanded ("0") so the client preference differs from the
      // collapsed SSR/server snapshot after the closed-by-default flip —
      // that is the mismatch/re-render path useSyncExternalStore must handle.
      name: "dashboard persisted theme and sidebar",
      route: "/",
      storage: { "clinical-kb-theme": "dark", "clinical-kb-sidebar-collapsed": "0" },
      themeCookie: "dark",
    },
    {
      name: "dictionary catalogue phone composer slot",
      route: "/dictionary/search",
      storage: {},
      viewport: { width: 390, height: 844 },
    },
    {
      name: "dictionary catalogue desktop composer slot",
      route: "/dictionary/search",
      storage: {},
      viewport: { width: 1280, height: 900 },
    },
    {
      name: "document viewer deep-linked page",
      route: "/documents/11111111-1111-4111-8111-111111111111?page=1",
      storage: {},
    },
  ] as const;

  for (const scenario of scenarios) {
    test(`${scenario.name} does not emit hydration warnings during initial load`, async ({ page, baseURL }) => {
      const hydrationErrors: string[] = [];

      const isHydrationError = (text: string) =>
        text.includes("Warning: Text content did not match") ||
        text.includes("Warning: Expected server HTML to contain") ||
        (text.includes("Warning: Prop") && text.includes("did not match")) ||
        text.includes("A tree hydrated but some attributes") ||
        text.includes("Hydration failed because") ||
        text.includes("There was an error while hydrating") ||
        /Minified React error #(?:418|423|425)\b/.test(text);

      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") {
          const text = msg.text();
          if (isHydrationError(text)) hydrationErrors.push(text);
        }
      });
      page.on("pageerror", (error) => {
        const text = error.message;
        if (isHydrationError(text)) hydrationErrors.push(text);
      });

      if ("viewport" in scenario) await page.setViewportSize(scenario.viewport);

      if ("themeCookie" in scenario) {
        expect(baseURL).toBeTruthy();
        await page
          .context()
          .addCookies([{ name: "clinical-theme", value: scenario.themeCookie, url: new URL("/", baseURL).toString() }]);
      }
      await page.addInitScript((storage) => {
        for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
      }, scenario.storage);

      // Navigate to the route, ensuring we load it from the server with persisted state already seeded.
      const response = await page.goto(scenario.route);
      expect(response?.ok()).toBe(true);

      // Wait until React has hydrated the page's main landmark. networkidle is
      // unreliable on routes that keep a connection open (ledger #PVVAPA).
      await expectHydrated(page.locator("main").first());
      if ("viewport" in scenario) {
        // The parent header can hydrate before this streamed page segment.
        // Wait for the slot itself before accepting a warning-free load.
        await expect(page.getByTestId("dictionary-catalogue-composer")).toHaveAttribute(
          "data-composer-slot-ready",
          "true",
        );
        await expect(page.getByTestId("dictionary-catalogue-composer")).not.toHaveAttribute(
          "data-composer-reserve",
          "pending",
        );
      }

      // Fail the test if any hydration errors were captured
      expect(hydrationErrors, "Expected no React hydration mismatch warnings or errors in the console").toEqual([]);
    });
  }
});
