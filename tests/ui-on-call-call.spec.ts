import { expect, test, type Locator, type Page } from "playwright/test";

import { clickWhenHydrated, expectHydrated } from "./playwright-settlement";

/**
 * Call, Refer and Find in demo mode (plan 3.6): the demo handbook is the
 * synthetic "Example Hospital", so every number here is made up.
 */

async function shortTargets(scope: Locator): Promise<string[]> {
  return scope.locator("button, input, a").evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && rect.height < 47.5;
      })
      .map((node) => node.textContent?.trim() || node.getAttribute("aria-label") || node.tagName),
  );
}

/** In dark mode nothing with a bright fill is taller than 48px (standard §10). */
async function brightBlocksOver48(scope: Locator): Promise<string[]> {
  return scope.locator("*").evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.height <= 48.5 || rect.width === 0) return false;
        const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(node).backgroundColor);
        if (!match) return false;
        const [, r, g, b, alpha] = match;
        if (alpha !== undefined && Number(alpha) < 0.5) return false;
        return (Number(r) + Number(g) + Number(b)) / 3 > 200;
      })
      .map((node) => `${node.tagName}.${node.getAttribute("data-testid") ?? ""}`),
  );
}

async function open(page: Page, path: string, colorScheme: "light" | "dark") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
  // An explicit app preference wins over the emulated OS setting. Pin the
  // requested theme before the bootstrap script reads storage on navigation.
  await page.addInitScript((theme) => window.localStorage.setItem("clinical-kb-theme", theme), colorScheme);
  await page.goto(path);
  // React parks a hidden staged copy of a streamed page until its reveal, so a
  // strict locator would match twice (#093). Wait for the one live copy.
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator("html")).toHaveClass(colorScheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`On Call Call, Refer and Find (${colorScheme})`, () => {
    test("People names the hospital, dials the pause route and keeps short codes desk-only", async ({ page }) => {
      await open(page, "/on-call/call", colorScheme);
      const main = page.getByTestId("on-call-call-main");
      await expect(main.getByTestId("on-call-hospital-line")).toContainText("Example Hospital");
      await expect(main.locator('a[href="tel:0855500000,4455"]')).toHaveCount(1);
      await expect(main).toContainText("then ext 4455");

      const emergency = main.locator("li", { hasText: "Synthetic emergency line" }).first();
      await expect(emergency).toContainText("From a hospital phone");
      await expect(emergency.getByRole("link", { name: /from a mobile/i })).toHaveCount(1);

      // "Didn't connect" is marked from the number's own sheet, not a button on every row.
      await expect(main.getByRole("button", { name: /^Didn't connect/ })).toHaveCount(0);
      await clickWhenHydrated(main.getByRole("button", { name: /^Switchboard, .*Dialling details$/ }));
      const sheet = page.getByRole("dialog", { name: "Switchboard" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "Didn't connect: Switchboard" }).click();
      await expect(page.getByRole("dialog", { name: "Didn't connect" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Didn't connect" })).toHaveCount(0);
      await expect(main.locator("li", { hasText: "Switchboard" }).first()).toContainText(
        /Didn't connect at \d{2}:\d{2}/,
      );

      // People: search, then the Hospital / Outside lines / Mine switch; no call log here any more.
      await expect(main.getByRole("radio", { name: "Hospital" })).toHaveAttribute("aria-checked", "true");
      await expect(main).toContainText("Off: you're on your mobile, so full numbers are dialled");
      await expect(main.getByTestId("on-call-call-handover")).toHaveCount(0);
      await clickWhenHydrated(main.getByRole("radio", { name: "Outside lines" }));
      await expect(main.getByTestId("on-call-call-external")).toContainText("Lifeline");
      await clickWhenHydrated(main.getByRole("radio", { name: "Hospital" }));

      expect(await main.evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await shortTargets(main)).toEqual([]);
      if (colorScheme === "dark") expect(await brightBlocksOver48(main)).toEqual([]);
    });

    test("Refer opens a referral's detail in a sheet", async ({ page }) => {
      await open(page, "/on-call/refer", colorScheme);
      const main = page.getByTestId("on-call-refer-main");
      await clickWhenHydrated(main.getByRole("button", { name: /Example internal referral route/ }));
      await expect(page.getByTestId("on-call-refer-detail")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(main.getByTestId("on-call-refer-services-link")).toHaveAttribute("href", "/services/search");
      expect(await main.evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await shortTargets(main)).toEqual([]);
      if (colorScheme === "dark") expect(await brightBlocksOver48(main)).toEqual([]);
    });

    test("Find puts Systems down first, leaves on-site items to Admin, and lands on the anchor", async ({ page }) => {
      await open(page, "/on-call/find#on-call-group-downtime", colorScheme);
      const main = page.getByTestId("on-call-find-main");
      const search = main.getByRole("searchbox", { name: "Search the handbook" });
      await expectHydrated(search);
      const firstGroup = main.locator('[id^="on-call-group-"]').first();
      await expect(firstGroup).toHaveAttribute("id", "on-call-group-downtime");
      await expect(firstGroup).toBeInViewport();
      await expect(main).not.toContainText("Car park after hours");
      await expect(main.getByTestId("on-call-find-on-site").getByRole("link")).toHaveAttribute("href", "/admin/help");
      await expect(main.getByTestId("on-call-find-first-night")).toContainText("Sort these in daylight");
      expect(await main.evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await shortTargets(main)).toEqual([]);
      if (colorScheme === "dark") expect(await brightBlocksOver48(main)).toEqual([]);
    });
  });
}
