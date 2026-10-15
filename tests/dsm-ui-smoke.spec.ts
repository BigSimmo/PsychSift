import { expect, test, type Page } from "playwright/test";
import { visibleByTestId } from "./playwright-settlement";

async function blockExternalRequests(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test("DSM mode nav Search returns to search results, not the shared home", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dsm/search?q=major+depressive&run=1", { waitUntil: "domcontentloaded" });
  await expect(visibleByTestId(page, "dsm-search-page")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("mode-nav").getByRole("link", { name: "Compare" }).click();
  await expect(page).toHaveURL(/\/dsm\/compare/, { timeout: 15_000 });

  await page.getByTestId("mode-nav").getByRole("link", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/dsm\/search\?q=major\+depressive&run=1/, { timeout: 15_000 });
  await expect(visibleByTestId(page, "dsm-search-page")).toBeVisible();
  await expect(page).not.toHaveURL(/\/?mode=dsm/);
});

test("empty DSM compare stacks full-width slots and shows starter chips", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dsm/compare", { waitUntil: "domcontentloaded" });
  await expect(visibleByTestId(page, "dsm-comparison-page")).toBeVisible({ timeout: 15_000 });
  // Phone stacks slots A, B and C vertically so none is cut off at the edge.
  const tiles = page.getByTestId("compare-slot-tile");
  await expect(tiles).toHaveCount(3);
  await expect(page.getByTestId("compare-slot-tile-compact")).toHaveCount(0);
  const [first, second] = await Promise.all([tiles.nth(0).boundingBox(), tiles.nth(1).boundingBox()]);
  expect(first && second && second.y >= first.y + first.height).toBe(true);
  expect(first && second && Math.abs(second.x - first.x) <= 1).toBe(true);
  await expect(page.getByTestId("dsm-compare-starters").getByRole("link").first()).toBeVisible();
});

test("DSM result action remains inside the results card at the 1024px breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/dsm/search?q=major+depressive", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });

  const dsmPage = visibleByTestId(page, "dsm-search-page");
  const resultsSection = dsmPage.locator('section[aria-label="DSM diagnosis results"]');
  const result = dsmPage.getByTestId("dsm-search-result").filter({ hasText: "Major depressive disorder" });
  const openDiagnosis = result.getByRole("link", { name: "Open Major depressive disorder" });

  await expect(dsmPage).toBeVisible();
  await expect(resultsSection).toBeVisible();
  await expect(result).toBeVisible();
  await expect(openDiagnosis).toBeVisible();

  const sectionBox = await resultsSection.boundingBox();
  const actionBox = await openDiagnosis.boundingBox();
  expect(sectionBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  if (!sectionBox || !actionBox) {
    throw new Error("Expected DSM results and action bounding boxes");
  }

  const sectionRight = sectionBox.x + sectionBox.width;
  const actionRight = actionBox.x + actionBox.width;
  expect(actionBox.x).toBeGreaterThanOrEqual(sectionBox.x - 1);
  expect(actionRight).toBeLessThanOrEqual(sectionRight + 1);
  expect(actionBox.width).toBeGreaterThanOrEqual(48);
});
