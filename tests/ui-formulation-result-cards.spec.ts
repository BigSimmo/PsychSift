import { expect, test, type Page } from "playwright/test";
import { stubZeroTouchPoints } from "./helpers/zero-touch";
import { expectAtLeastCssPx } from "./helpers/layout-tolerance";

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

async function gotoApp(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
  await stubZeroTouchPoints({ page });
});

test("lists mechanisms as compact rows with small Use and Open actions on each row", async ({ page }) => {
  // Compact rows (Clinical audit, 13 Oct 2026, item 12): one hairline card with
  // divided rows, the same row Therapy search uses. Each row keeps both actions
  // as 48px buttons beside the title, and the whole row opens the mechanism.
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await gotoApp(page, "/formulation?q=What+if+something+goes+wrong&run=1");

    const rows = page.locator("[data-formulation-result-card]");
    // WebKit can stream a hidden duplicate of the page root (#093).
    const topMatch = page.getByTestId("formulation-top-match").filter({ visible: true });
    const actionGroup = topMatch.locator("[data-formulation-card-action]");
    const action = actionGroup.getByRole("link", { name: "Open Worry" });
    const secondaryAction = actionGroup.getByRole("link", { name: "Use Worry in formulation" });

    await expect(rows.first()).toBeVisible();
    await expect.poll(() => rows.count()).toBeGreaterThan(1);
    await expect(action).toBeVisible();
    await expect(secondaryAction).toBeVisible();
    await expect(topMatch.getByText("Top match", { exact: true })).toBeVisible();

    const geometry = await topMatch.evaluate((row) => {
      const headerElement = row.querySelector<HTMLElement>("[data-formulation-card-header]");
      const actionElement = row.querySelector<HTMLElement>("[data-formulation-card-action]");
      const primaryElement = actionElement?.querySelector<HTMLElement>("a:last-of-type");
      const secondaryElement = actionElement?.querySelector<HTMLElement>("a:first-of-type");
      const list = row.parentElement;
      const nextRow = row.nextElementSibling as HTMLElement | null;
      if (!headerElement || !actionElement || !primaryElement || !secondaryElement || !list || !nextRow) {
        throw new Error("Expected complete formulation result-row structure");
      }

      const rowRect = row.getBoundingClientRect();
      const headerRect = headerElement.getBoundingClientRect();
      const actionRect = actionElement.getBoundingClientRect();
      const primaryRect = primaryElement.getBoundingClientRect();
      const secondaryRect = secondaryElement.getBoundingClientRect();
      const nextRowRect = nextRow.getBoundingClientRect();
      const listStyle = getComputedStyle(list);

      return {
        actionTop: actionRect.top,
        actionBottom: actionRect.bottom,
        headerTop: headerRect.top,
        headerBottom: headerRect.bottom,
        actionGroupWidth: actionRect.width,
        rowHeight: rowRect.height,
        rowWidth: rowRect.width,
        primaryHeight: primaryRect.height,
        primaryWidth: primaryRect.width,
        secondaryHeight: secondaryRect.height,
        secondaryWidth: secondaryRect.width,
        nextRowGap: nextRowRect.top - rowRect.bottom,
        listBorder: Number.parseFloat(listStyle.borderTopWidth),
        listRadius: Number.parseFloat(listStyle.borderTopLeftRadius),
      };
    });

    // The actions sit on the title row, inside the row's header band.
    expect(geometry.actionTop).toBeGreaterThanOrEqual(geometry.headerTop - 1);
    expect(geometry.actionBottom).toBeLessThanOrEqual(geometry.headerBottom + 1);
    // 48px taps for both small actions.
    expectAtLeastCssPx(geometry.primaryHeight, 47, "formulation Open tap height");
    expectAtLeastCssPx(geometry.secondaryHeight, 47, "formulation Use tap height");
    expectAtLeastCssPx(geometry.primaryWidth, 47, "formulation Open tap width");
    expectAtLeastCssPx(geometry.secondaryWidth, 47, "formulation Use tap width");
    // Rows are divided inside one hairline card, not separate cards.
    expect(Math.abs(geometry.nextRowGap)).toBeLessThanOrEqual(1);
    expect(geometry.listBorder).toBeGreaterThanOrEqual(1);
    expect(geometry.listRadius).toBeGreaterThanOrEqual(8);
    // Compact: the old card was about 1,000px tall on a phone.
    expect(geometry.rowHeight).toBeLessThan(260);
    expect(geometry.actionGroupWidth).toBeLessThan(geometry.rowWidth / 2);

    await action.focus();
    await expect(action).toBeFocused();
    await expectNoHorizontalOverflow(page);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() => topMatch.evaluate((row) => Number.parseFloat(getComputedStyle(row).transitionDuration)))
      .toBeLessThanOrEqual(0.001);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }

  await page.emulateMedia({ forcedColors: "active" });
  const forcedColorsAction = page
    .getByTestId("formulation-top-match")
    .locator("[data-formulation-card-action]")
    .getByRole("link", { name: "Open Worry" });
  await expect(forcedColorsAction).toBeVisible();
  await forcedColorsAction.focus();
  await expect(forcedColorsAction).toBeFocused();
});
