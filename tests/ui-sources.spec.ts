import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { expectSingleSettledOwner, visibleByTestId } from "./playwright-settlement";

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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test("Dictionary sources redirects into the Sources catalogue", async ({ page }) => {
  await page.goto("/dictionary/sources", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/sources\/search\?usedBy=dictionary$/);
  await expect(page.getByRole("button", { name: "Remove Used in: Dictionary filter" })).toBeVisible();
});

test("a submitted link to the Sources home forwards to the catalogue", async ({ page }) => {
  // `/sources` served both the home and the catalogue before it was consolidated,
  // so this bookmark shape has to keep resolving to results rather than the home.
  await page.goto("/sources?q=RANZCP&run=1", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/sources\/search\?q=RANZCP&run=1&mode=sources$/);
  await expectSingleSettledOwner(page.getByTestId("sources-catalogue-main"));
});

test("a filter-only link to the Sources home forwards without run=1", async ({ page }) => {
  // A filter chip has no draft state, so a shareable catalogue link must not need
  // `run=1` to survive the hop (`#ZBAC9D`).
  await page.goto("/sources?usedBy=dictionary", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/sources\/search\?usedBy=dictionary&mode=sources$/);
  await expect(page.getByRole("button", { name: "Remove Used in: Dictionary filter" })).toBeVisible();
});

test("Sources opens the shared home, which chips through to the catalogue", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto("/sources", { waitUntil: "domcontentloaded" });

  // The four-card home that used to live here was a second home for a mode that
  // already had one. `/sources` now forwards to that one.
  await expect(page).toHaveURL(/\/\?mode=sources$/);
  const home = page.getByTestId("shared-home-empty-state");
  await expect(home).toBeVisible();
  await expect(home.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(page.getByTestId("sources-home")).toHaveCount(0);

  // The shared home renders no cards and no mode tab bar, so the chip is the only
  // route into the catalogue that is not a typed search.
  await page.getByTestId("sources-show-all").click();
  await expect(page).toHaveURL(/\/sources\/search$/);
  await expectSingleSettledOwner(page.getByTestId("sources-catalogue-main"));
});

test("@critical Sources catalogue filters and opens traceability", async ({ page }) => {
  await page.goto("/sources/search?usedBy=dictionary", { waitUntil: "domcontentloaded" });
  await expectSingleSettledOwner(page.getByTestId("sources-catalogue-main"));
  await expect(page.getByRole("button", { name: "Remove Used in: Dictionary filter" })).toBeVisible();
  await expect(page.getByTestId("search-query-ribbon").getByRole("status")).toContainText("source");

  // Below the sm breakpoint the toolbar swaps the desktop trigger for its phone twin.
  const phoneWidth = (page.viewportSize()?.width ?? 1280) < 640;
  await visibleByTestId(page, phoneWidth ? "sources-filter-trigger-phone" : "sources-filter-trigger-desktop").click();
  const sheet = page.getByTestId("sources-filter-sheet");
  await expect(sheet).toBeVisible();
  // Sources hands the sheet four facet groups, which is past the density
  // threshold in docs/filter-contract.md section 5, so every group without a
  // selection starts collapsed. The band options exist only once it is opened.
  const bandGroup = sheet.getByRole("button", { name: "Quality band", exact: true });
  await bandGroup.click();
  await expect(bandGroup).toHaveAttribute("aria-expanded", "true");
  await sheet.getByRole("button", { name: /D · Review required/ }).click();
  await expect(page).toHaveURL(/band=D/);

  await page.keyboard.press("Escape");
  await page
    .getByRole("link", { name: /view source details/i })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 2, name: "Where this source is used" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sources" })).toBeVisible();
});

test("@critical Sources browse tabs carry the results band and reach the filtered catalogue", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto("/sources/topics", { waitUntil: "domcontentloaded" });

  const topics = await expectSingleSettledOwner(visibleByTestId(page, "sources-topics-main"));
  // The same band the Catalogue shows, counting topics rather than sources.
  await expect(page.getByTestId("search-query-ribbon")).toBeVisible();
  await expect(page.getByTestId("search-query-ribbon").getByRole("status")).toContainText("topic");
  await expectNoHorizontalOverflow(page);

  // The phone control is the badged trigger, which is what keeps the band on
  // one line at 390px (AGENTS.md "Search chrome behaviour").
  await page.getByTestId("sources-topic-filter-trigger-phone").click();
  const sheet = page.getByTestId("sources-topic-filter-sheet");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");

  await topics
    .getByRole("link", { name: /view .* sources$/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/sources\/search\?topic=/);
  await expectSingleSettledOwner(page.getByTestId("sources-catalogue-main"));

  await page.goto("/sources/publishers", { waitUntil: "domcontentloaded" });
  await expectSingleSettledOwner(page.getByTestId("sources-publishers-main"));
  await expect(page.getByTestId("search-query-ribbon").getByRole("status")).toContainText("publisher");
  await expectNoHorizontalOverflow(page);
});

test("catalogue Clear search stays on the catalogue and keeps the filters", async ({ page }) => {
  // It used to push `/sources`, which left the results entirely and landed on the
  // retired four-card home with every filter silently dropped. The empty state
  // offers Clear filters as its own control, so this one must only clear the query.
  await page.goto("/sources/search?usedBy=dictionary&q=zzzzznomatch", { waitUntil: "domcontentloaded" });
  await page.getByTestId("search-results-empty-clear-search").click();
  await expect(page).toHaveURL(/\/sources\/search\?usedBy=dictionary$/);
  await expect(page.getByRole("button", { name: "Remove Used in: Dictionary filter" })).toBeVisible();
  await expectSingleSettledOwner(page.getByTestId("sources-catalogue-main"));
});

test("a browse query narrows the browse list instead of being ignored", async ({ page }) => {
  await page.goto("/sources/topics?q=zzzzznomatch", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("search-query-ribbon").getByRole("status")).toContainText("0 topics");
  await expect(page.getByTestId("search-results-empty-clear-search")).toBeVisible();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`Sources remains operable at phone width and under accessibility media (${colorScheme})`, async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== "chromium", "forced-colors emulation is Chromium-only");
    await page.setViewportSize({ width: 320, height: 760 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active", colorScheme });
    // The catalogue is paginated server-side at 50 entries, and the default
    // order is by quality band — so `excluded` sources now sit on the last page,
    // not the first. The band filter is what puts one in front of the assertion;
    // the point of the check is unchanged: the lowest band's chip tone has to
    // survive forced colors.
    const surfaces = [
      ["/sources/search?band=excluded", "sources-catalogue-main"],
      ["/sources/topics", "sources-topics-main"],
      ["/sources/publishers", "sources-publishers-main"],
    ] as const;

    for (const [route, testId] of surfaces) {
      await page.goto(route);
      await expectSingleSettledOwner(page.getByTestId(testId));
      if (route.startsWith("/sources/search")) {
        await expect(
          page
            .getByTestId("chip")
            .filter({ hasText: /^Excluded$/ })
            .first(),
        ).toBeVisible();
      }
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus-visible")).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      await testInfo.attach(`sources-axe-${testId}`, {
        body: JSON.stringify(axe.violations, null, 2),
        contentType: "application/json",
      });
      expect(
        axe.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious"),
      ).toEqual([]);
    }
  });
}

test("the Currency check is reachable from the Sources pages and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sources/currency", { waitUntil: "domcontentloaded" });
  await expectSingleSettledOwner(page.getByTestId("sources-currency-main"));
  await expect(page.getByRole("heading", { name: "Is my copy still the latest?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Reviews coming up/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Needs review first/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const results = await new AxeBuilder({ page }).include('[data-testid="sources-currency-main"]').analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});
