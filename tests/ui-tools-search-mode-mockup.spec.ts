import { expect, test, type Page } from "playwright/test";

const mockupPath = "/mockups/tools-search-mode?mode=tools&q=Compare";

async function gotoMockup(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(mockupPath, { waitUntil: "domcontentloaded" });
  const mockup = page.locator('[data-testid="tools-search-mode-mockup"]:visible');
  await expect(mockup).toBeVisible();
  await expect(page.locator('[data-testid="global-search-input"]:visible')).toHaveValue("Compare");
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

test.describe("Perfected Tools results mode mockup @mockup", () => {
  test("desktop uses universal search, task-grouped rows and the About sheet", async ({ page }) => {
    const mockup = await gotoMockup(page, 1440);
    const sheet = page.locator('[data-testid="tools-search-detail-sheet"]:visible');

    await expect(mockup.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
    await expect(mockup.getByText("2 tools", { exact: true })).toBeVisible();
    await expect(mockup.getByRole("heading", { level: 3, name: "Differentials" })).toBeVisible();
    // The near-universal chips were removed: they labelled 13 of 15 tools and told nothing apart.
    await expect(mockup.getByText("Source-backed")).toHaveCount(0);
    await expect(mockup.getByText("High yield")).toHaveCount(0);
    await expect(mockup.getByRole("radiogroup", { name: "Tool category" })).toHaveCount(0);
    await expect(mockup.getByTestId("tools-search-mode-hero")).toHaveCount(0);
    await expect(mockup.getByTestId("universal-also-matches")).toBeVisible();
    await expect(mockup.getByText("Dose converter")).toHaveCount(0);

    const searchInput = page.locator('[data-testid="global-search-input"]:visible');
    await searchInput.fill("Safety");
    await expect(mockup.getByRole("heading", { level: 1, name: "Safety" })).toBeVisible();
    await searchInput.press("Escape");
    await expect(searchInput).toHaveAttribute("aria-expanded", "false");
    await expect(mockup.getByRole("heading", { level: 3, name: "Risk & Safety" })).toBeVisible();

    await searchInput.fill("Compare");
    await searchInput.press("Escape");
    await mockup.getByRole("button", { name: "About Differentials" }).click();
    await expect(sheet.getByRole("heading", { name: "Differentials" })).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Check first" })).toBeVisible();
    await expect(sheet).toContainText("Ranked differentials");
    await sheet.getByRole("button", { name: "Close Differentials" }).click();
    await expect(sheet).toHaveCount(0);

    await searchInput.fill("");
    await expect(mockup.getByRole("heading", { level: 1, name: "All tools", exact: true })).toBeVisible();
    for (const group of ["Safety", "Look it up", "Assess", "Treat and plan", "Coordinate"]) {
      await expect(mockup.getByRole("region", { name: group, exact: true })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
  });

  test("does not let persisted mockup utilities override live-route inline themes", async ({ page }) => {
    await gotoMockup(page, 1440);

    await page.goto("/reference/colour-coding", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/reference\/colour-coding$/);
    await expect(page.getByRole("heading", { level: 1, name: "Colour coding & badges" })).toBeVisible();

    const inlineBorderColor = await page.evaluate(() => {
      const themedCard = document.createElement("div");
      themedCard.className = "border border-[color:var(--border)]";
      themedCard.style.borderTopColor = "rgb(1, 2, 3)";
      document.body.append(themedCard);
      return window.getComputedStyle(themedCard).borderTopColor;
    });
    expect(inlineBorderColor).toBe("rgb(1, 2, 3)");
  });

  test("desktop About opens a labelled dialog and returns focus to its button", async ({ page }) => {
    const mockup = await gotoMockup(page, 1440);
    const about = mockup.getByRole("button", { name: "About Differentials" });

    await about.click();
    const sheet = page.locator('[data-testid="tools-search-detail-sheet"]:visible');
    await expect(sheet.getByRole("heading", { name: "Differentials" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Open Differentials" })).toHaveAttribute(
      "href",
      "/?mode=differentials",
    );
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(about).toBeFocused();
  });

  test("matches the exact displayed tool title after normalising punctuation", async ({ page }) => {
    const mockup = await gotoMockup(page, 1440);
    await page.locator('[data-testid="global-search-input"]:visible').fill("Risk & Safety");

    // The claim is that "&" normalises and the exactly-titled tool wins — not that it is
    // the only match. "Risk & Safety" legitimately also matches "Safety plan" and
    // "Differentials" on their own terms, so the "1 tool" this line used to carry was the
    // same rot the count assertion below was already rewritten to avoid: it went red the
    // moment the catalogue grew into it. Assert the ranking instead, which is the claim.
    const results = mockup.locator('section[aria-label="Tool results"] li');
    await expect(results.first().getByRole("heading", { level: 3, name: "Risk & Safety" })).toBeVisible();
  });

  test("renders every result included in the reported count", async ({ page }) => {
    const mockup = await gotoMockup(page, 1440);

    // The claim is self-consistency — the headline count matches the rows actually
    // rendered — so it reads the rendered count rather than pinning an absolute.
    // A hard-coded total silently rots the moment the catalogue gains a tool, which
    // is what "Add Ward Flow" (#2140, since retired) did to the 14 this line used to carry.
    const results = mockup.locator('section[aria-label="Tool results"] li');
    const rendered = await results.count();
    expect(rendered, "the Compare mockup must render at least one tool").toBeGreaterThan(0);
    await expect(mockup.getByText(`${rendered} ${rendered === 1 ? "tool" : "tools"}`, { exact: true })).toBeVisible();
  });

  test("phone keeps results visible until About opens the bottom sheet", async ({ page }) => {
    const mockup = await gotoMockup(page, 390, 844);

    const sheet = page.locator('[data-testid="tools-search-detail-sheet"]:visible');
    await expect(sheet).toHaveCount(0);
    await expect(mockup.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
    await expect(mockup.getByRole("heading", { level: 3, name: "Differentials" })).toBeVisible();

    const about = mockup.getByRole("button", { name: "About Differentials" });
    await about.click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Differentials" })).toBeVisible();
    // Check first is shown in full, not folded behind an accordion.
    await expect(sheet.getByRole("heading", { name: "Check first" })).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "You will need" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    await about.click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Close Differentials" }).click();
    await expect(about).toBeFocused();
    await expectNoHorizontalOverflow(page);
  });

  test("keeps the About sheet usable when the viewport enters desktop layout", async ({ page }) => {
    const mockup = await gotoMockup(page, 390, 844);
    const sheet = page.locator('[data-testid="tools-search-detail-sheet"]:visible');

    await mockup.getByRole("button", { name: "About Differentials" }).click();
    await expect(sheet).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(sheet.getByRole("link", { name: "Open Differentials" })).toBeVisible();
    await sheet.getByRole("button", { name: "Close Differentials" }).click();
    await expect(sheet).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("keeps the safety tools one tap away while searching on a phone", async ({ page }) => {
    const mockup = await gotoMockup(page, 390, 844);

    const safety = mockup.getByRole("navigation", { name: "Safety tools" });
    await expect(safety.getByRole("link", { name: "Risk & Safety" })).toBeVisible();
    await expect(safety.getByRole("link", { name: "Safety plan" })).toHaveAttribute("href", "/safety-plan");
    // Grouping replaced the category filter, so no filter can hide the safety tools.
    await expect(mockup.getByTestId("tools-search-filter-trigger-phone")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("phone pins follow the About sheet and drop the oldest when full", async ({ page }) => {
    const mockup = await gotoMockup(page, 390, 844);

    await page.locator('[data-testid="global-search-input"]:visible').fill("");
    const pinned = mockup.getByTestId("tools-pinned");
    await expect(pinned).toBeVisible();
    await expect(pinned.getByTestId("tool-pin-medication-prescribing")).toBeVisible();
    await expect(pinned.getByTestId("tool-pin-differentials")).toHaveCount(0);

    await mockup.getByRole("button", { name: "About Differentials" }).click();
    const sheet = page.locator('[data-testid="tools-search-detail-sheet"]:visible');
    const pin = sheet.getByRole("button", { name: "Pin" });
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await pin.click();
    await expect(sheet.getByRole("button", { name: "Unpin" })).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: "Close Differentials" }).click();

    await expect(pinned.getByTestId("tool-pin-differentials")).toBeVisible();
    await expect(pinned.getByTestId("tool-pin-medication-prescribing")).toHaveCount(0);
    await expect(pinned.getByRole("listitem")).toHaveCount(4);
    await expectNoHorizontalOverflow(page);
  });

  test("keeps its shared controls and tool sheet legible in forced colors with reduced motion", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    const mockup = await gotoMockup(page, 390, 844);

    await mockup.getByRole("button", { name: "About Differentials" }).click();
    const sheet = page.locator('[data-testid="tools-search-detail-sheet"]:visible');
    await expect(sheet.getByRole("heading", { name: "Check first" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Open Differentials" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  for (const width of [320, 390, 639, 768, 1440, 1920]) {
    test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
      await gotoMockup(page, width, 900);
      await expectNoHorizontalOverflow(page);
    });
  }
});
