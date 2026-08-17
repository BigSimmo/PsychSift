import { expect, test, type Page } from "playwright/test";

const path = "/mockups/sidebar-live";

async function gotoMockup(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const mockup = page.locator('[data-testid="sidebar-live-mockup"]:visible');
  await expect(mockup).toBeVisible();
  await expect(mockup.getByTestId("sidebar-live-rail")).toBeVisible();
  return mockup;
}

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(Math.max(geometry.body, geometry.document)).toBeLessThanOrEqual(geometry.viewport + 1);
}

test.describe("Perfected live sidebar mockup @mockup", () => {
  test("uses live tokens and preserves the chosen information hierarchy", async ({ page }) => {
    const mockup = await gotoMockup(page, 1440, 1000);
    const sections = mockup.getByTestId("sidebar-sections");

    await expect(sections.getByRole("heading", { level: 2 })).toHaveText(["Shortcuts"]);
    await expect(sections.getByRole("heading", { name: "Recent chats" })).toHaveCount(0);
    await expect(mockup.getByTestId("recent-chats").getByRole("button", { name: /More options for/ })).toHaveCount(3);
    await expect(mockup.getByRole("navigation", { name: "Pinned shortcuts" }).getByRole("button")).toHaveText([
      "Answer",
      "Documents",
      "Services",
      "Medication",
      "Factsheets",
      "Tools",
      "More modes",
    ]);

    const railWidth = await mockup
      .getByTestId("sidebar-live-rail")
      .evaluate((rail) => rail.getBoundingClientRect().width);
    expect(railWidth).toBe(320);

    await mockup.getByRole("button", { name: "Collapse sidebar" }).press("Enter");
    const expandSidebar = mockup.getByRole("button", { name: "Expand sidebar" });
    await expect(expandSidebar).toBeFocused();
    await expect(mockup).toHaveAttribute("data-collapsed", "true");
    await expect(mockup.getByRole("navigation", { name: "Collapsed shortcuts" }).getByRole("button")).toHaveCount(7);
    await mockup.getByRole("button", { name: "More modes" }).click();
    await expect(page.getByRole("dialog", { name: "More modes" })).toBeVisible();
    await page.getByRole("button", { name: "Close more modes" }).click();
    await expect(mockup.getByRole("button", { name: "More modes" })).toBeFocused();
    await expandSidebar.press("Enter");
    await expect(mockup.getByRole("button", { name: "Collapse sidebar" })).toBeFocused();

    await mockup.getByRole("button", { name: /Appearance/ }).click();
    const appearance = page.getByRole("menu", { name: "Appearance" });
    await appearance.getByRole("menuitemradio", { name: /Light/ }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "Search Clinical Guide" });
    await expect(search.getByRole("searchbox", { name: "Search everything" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(mockup.getByRole("button", { name: /Search Clinical Guide/ })).toBeFocused();

    await mockup
      .getByRole("navigation", { name: "Pinned shortcuts" })
      .getByRole("button", { name: "More modes" })
      .click();
    const launcher = page.getByRole("dialog", { name: "More modes" });
    await launcher.getByRole("button", { name: "Pin Guidelines" }).click();
    await launcher.getByRole("button", { name: "Close more modes" }).click();
    await expect(
      mockup.getByRole("navigation", { name: "Pinned shortcuts" }).getByRole("button", { name: "Guidelines" }),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test("stays overflow-free across required widths and remains legible in forced colors", async ({ page }) => {
    await gotoMockup(page, 320, 844);

    await page.getByRole("button", { name: "Close sidebar" }).click();
    const reopenNavigation = page.getByRole("button", { name: "Open navigation" });
    await expect(reopenNavigation).toBeVisible();
    await reopenNavigation.click();
    await expect(page.getByRole("button", { name: "Close sidebar" })).toBeVisible();

    const phoneSections = page.getByTestId("sidebar-sections");
    await phoneSections.evaluate((sections) => {
      sections.scrollTop = sections.scrollHeight;
    });
    const phoneMoreModes = page
      .getByRole("navigation", { name: "Pinned shortcuts" })
      .getByRole("button", { name: "More modes" });
    await expect(phoneMoreModes).toBeInViewport();
    await phoneMoreModes.click();
    await expect(page.getByRole("dialog", { name: "More modes" })).toBeVisible();
    await page.getByRole("button", { name: "Close more modes" }).click();

    for (const width of [320, 390, 639, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      await expectNoHorizontalOverflow(page);
    }

    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="sidebar-live-rail"]:visible')).toBeVisible();
    await expect(page.getByRole("button", { name: /Search Clinical Guide/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
