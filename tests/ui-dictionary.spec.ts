import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "playwright/test";

/*
 * `/dictionary` is deliberately absent: it has no home of its own any more. The
 * bare path redirects to the shared lightweight home at `/?mode=dictionary`,
 * which is covered by the shared-home suites rather than here.
 */
const routes = [
  { path: "/dictionary/search?q=MSE", testId: "dictionary-catalogue-main" },
  // The same route with no query: one catalogue, two states.
  { path: "/dictionary/search", testId: "dictionary-catalogue-main" },
  { path: "/dictionary/topics", testId: "dictionary-topics-main" },
  {
    path: "/dictionary/topics/assessment-and-measurement",
    testId: "dictionary-topic-detail-main",
  },
  { path: "/dictionary/auditory-hallucination", testId: "dictionary-term-main" },
  {
    path: "/dictionary/compare?a=mental-state-examination&b=mini-mental-state-examination",
    testId: "dictionary-compare-main",
  },
] as const;

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

async function gotoDictionary(page: Page, path: string, testId: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(testId).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

/**
 * Click a control whose handler only exists after React attaches.
 *
 * Every control here paints server-side, so a click issued the moment the
 * element is visible can land before hydration and be swallowed with no error —
 * the sheet simply never opens. Retrying until the expected surface appears is
 * honest about that race; a fixed `waitForTimeout` only moves it.
 */
async function clickUntil(trigger: Locator, settled: Locator) {
  await expect(async () => {
    await trigger.click();
    await expect(settled).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

async function expectDictionaryRoute(page: Page, route: (typeof routes)[number]) {
  await gotoDictionary(page, route.path, route.testId);
  await expect(page.locator("#main-content h1")).toHaveCount(1);
  await expect(page.locator("#main-content table")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
}

async function expectNoBlockingAxeViolations(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await testInfo.attach("dictionary-axe-violations", {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const blocking = results.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => `${violation.id}: ${violation.help}`);
  expect(blocking, "axe found critical or serious Dictionary violations").toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "compact phone", width: 320, height: 760 },
] as const) {
  test(`renders every Dictionary route without overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of routes) await expectDictionaryRoute(page, route);
  });
}

test("keeps mixed result filters truthful, URL-owned, and phone-operable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoDictionary(page, "/dictionary/search?q=MSE", "dictionary-catalogue-main");

  const trigger = page.getByTestId("dictionary-filter-trigger-phone");
  await expect(trigger).toBeVisible();
  await expect(trigger.getByText("Filter", { exact: true })).toBeVisible();
  expect((await trigger.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

  const sheet = page.getByTestId("dictionary-filter-sheet");
  await clickUntil(trigger, sheet);
  await sheet.getByTestId("dictionary-filter-sheet-find").fill("Assessment and measurement");
  await sheet.getByRole("button", { name: /^Assessment and measurement/ }).click();
  await expect(page).toHaveURL(/topic=assessment-and-measurement/);
  await sheet.getByTestId("dictionary-filter-sheet-done").click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Remove Topic: Assessment and measurement filter" })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/topic=assessment-and-measurement/);
  await expectNoHorizontalOverflow(page);
});

/**
 * The merged catalogue's phone header.
 *
 * Filter lives in the original results band on browse and search. Compact Terms
 * / Abbreviations and A–Z sit under that band. The in-page "Clinical terms"
 * title is gone. Phones keep the usual compact bottom dock; the in-page
 * composer slot is desktop-only.
 * This pins the geometry rather than asserting class names.
 */
test("merges search and browse into one catalogue with a measured phone header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // `/dictionary/browse` must not 404; it forwards, query string intact.
  await page.goto("/dictionary/browse?view=abbreviations", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dictionary-catalogue-main").filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/dictionary\/search\?view=abbreviations/);

  // The phone chrome stack is position:fixed and mounts collapsed, so every
  // offset below it is wrong until it settles (#XPY409, docs/testing.md).
  await page.waitForTimeout(1200);

  await expect(page.getByRole("heading", { name: "Clinical terms" })).toHaveCount(0);
  await expect(page.getByText("Clinical dictionary", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Dictionary catalogue", level: 1 })).toHaveCount(1);
  const dock = page.locator("form.answer-footer-search-dock");
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("global-search-input")).toBeVisible();
  await expect(page.getByTestId("dictionary-catalogue-composer")).toBeHidden();
  await expect(page.locator("#main-content [data-testid='global-search-input']")).toHaveCount(0);

  const ribbon = page.getByTestId("search-query-ribbon");
  const toggle = page.getByTestId("dictionary-scope-toggle");
  await expect(ribbon).toBeVisible();
  await expect(toggle).toBeVisible();
  await expect(toggle.getByRole("radio", { name: /Abbreviations/ })).toBeVisible();
  const toggleBox = await toggle.boundingBox();
  // The joined toggle remains compact in width but keeps the shared 48px tap target.
  expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(48);
  expect(toggleBox?.height ?? 0).toBeLessThanOrEqual(52);
  expect(toggleBox?.width ?? 0).toBeLessThan(260);
  await expect(page.getByTestId("dictionary-letter-chip")).toBeVisible();
  await expect(
    ribbon.getByTestId("dictionary-filter-trigger-phone").getByText("Filter", { exact: true }),
  ).toBeVisible();
  expect(
    (await ribbon.getByTestId("dictionary-filter-trigger-phone").boundingBox())?.height ?? 0,
  ).toBeGreaterThanOrEqual(48);
  // Browse band has no invented "All" query chip.
  await expect(ribbon.locator(".search-band-subject")).toHaveCount(0);
  // Toggle and A–Z share the row under the band. The usual phone dock sits
  // below the results, not above the Filter band.
  const browseGeometry = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const ribbon = document.querySelector<HTMLElement>('[data-testid="search-query-ribbon"]');
    const ribbonParent = ribbon?.parentElement?.getBoundingClientRect() ?? null;
    const toggle = document.querySelector<HTMLElement>('[data-testid="dictionary-scope-toggle"]');
    const letter = document.querySelector<HTMLElement>('[data-testid="dictionary-letter-chip"]');
    const controlRow = toggle?.parentElement?.getBoundingClientRect() ?? null;
    const toggleBox = toggle?.getBoundingClientRect() ?? null;
    const letterBox = letter?.getBoundingClientRect() ?? null;
    const controlsLeft = Math.min(toggleBox?.left ?? 0, letterBox?.left ?? 0);
    const controlsRight = Math.max(toggleBox?.right ?? 0, letterBox?.right ?? 0);
    return {
      dockTop: box("form.answer-footer-search-dock")?.top ?? -1,
      ribbonTop: box('[data-testid="search-query-ribbon"]')?.top ?? -1,
      ribbonBottom: box('[data-testid="search-query-ribbon"]')?.bottom ?? -1,
      filterTop: box('[data-testid="dictionary-filter-trigger-phone"]')?.top ?? -1,
      toggleTop: box('[data-testid="dictionary-scope-toggle"]')?.top ?? -1,
      letterTop: box('[data-testid="dictionary-letter-chip"]')?.top ?? -1,
      ribbonTopInset: ribbon && ribbonParent ? ribbon.getBoundingClientRect().top - ribbonParent.top : -1,
      controlsLeftInset: controlRow ? controlsLeft - controlRow.left : -1,
      controlsRightInset: controlRow ? controlRow.right - controlsRight : -1,
    };
  });
  expect(browseGeometry.ribbonTop).toBeGreaterThan(0);
  expect(browseGeometry.ribbonBottom).toBeGreaterThan(0);
  expect(browseGeometry.ribbonTopInset).toBeGreaterThanOrEqual(12);
  expect(browseGeometry.toggleTop).toBeGreaterThanOrEqual(browseGeometry.ribbonBottom);
  expect(Math.abs(browseGeometry.toggleTop - browseGeometry.letterTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(browseGeometry.controlsLeftInset - browseGeometry.controlsRightInset)).toBeLessThanOrEqual(2);
  expect(browseGeometry.filterTop).toBeLessThan(browseGeometry.toggleTop);
  expect(browseGeometry.dockTop).toBeGreaterThan(browseGeometry.toggleTop);

  const scopeSegments = await toggle
    .getByRole("radio")
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width));
  expect(scopeSegments).toHaveLength(2);
  expect(Math.abs(scopeSegments[0] - scopeSegments[1])).toBeLessThanOrEqual(1);
  const abbreviationsRadio = toggle.getByRole("radio", { name: /Abbreviations/ });
  const expectAbbreviationsLabelToFit = async () => {
    const dimensions = await abbreviationsRadio.getByText("Abbreviations", { exact: true }).evaluate((label) => ({
      clientWidth: label.clientWidth,
      scrollWidth: label.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  };
  await expectAbbreviationsLabelToFit();
  await expect(abbreviationsRadio).toBeChecked();
  await abbreviationsRadio.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(toggle.getByRole("radio", { name: /Terms/ })).toBeChecked();
  await expect(page).not.toHaveURL(/view=abbreviations/);

  await page.setViewportSize({ width: 320, height: 760 });
  await page.waitForTimeout(400);
  const narrowRow = await page.evaluate(() => {
    const box = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect() ?? null;
    return {
      toggleWidth: box("dictionary-scope-toggle")?.width ?? 0,
      toggleTop: box("dictionary-scope-toggle")?.top ?? 0,
      ribbonBottom: box("search-query-ribbon")?.bottom ?? 0,
      overflow: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
    };
  });
  expect(narrowRow.toggleTop).toBeGreaterThanOrEqual(narrowRow.ribbonBottom);
  expect(narrowRow.toggleWidth).toBeGreaterThan(120);
  expect(narrowRow.overflow).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(400);
  await expectAbbreviationsLabelToFit();
  await page.setViewportSize({ width: 390, height: 844 });

  await gotoDictionary(page, "/dictionary/search?q=tardive+dyskinesia", "dictionary-catalogue-main");
  await page.waitForTimeout(1200);
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("global-search-input")).toBeVisible();
  await expect(page.getByTestId("dictionary-catalogue-composer")).toBeHidden();
  await expect(ribbon).toBeVisible();
  await expect(ribbon.getByTestId("dictionary-clear-query")).toBeVisible();
  await expect(
    ribbon.getByTestId("dictionary-filter-trigger-phone").getByText("Filter", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("dictionary-letter-chip")).toBeVisible();

  for (const scopeButton of await page.getByTestId("dictionary-scope-toggle").getByRole("radio").all()) {
    expect((await scopeButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
  expect((await page.getByTestId("dictionary-letter-chip").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

  const resultControls = await page.evaluate(() => {
    const ribbon = document.querySelector('[data-testid="search-query-ribbon"]');
    const box = (testId: string) => ribbon?.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect() ?? null;
    return {
      clearTop: box("dictionary-clear-query")?.top ?? -1,
      filterTop: box("dictionary-filter-trigger-phone")?.top ?? -1,
    };
  });
  expect(Math.abs(resultControls.clearTop - resultControls.filterTop)).toBeLessThanOrEqual(2);

  const geometry = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const subject = document.querySelector<HTMLElement>('[data-testid="search-query-ribbon"] .search-band-subject');
    return {
      ribbonBottom: box('[data-testid="search-query-ribbon"]')?.bottom ?? -1,
      toggleTop: box('[data-testid="dictionary-scope-toggle"]')?.top ?? -1,
      letterTop: box('[data-testid="dictionary-letter-chip"]')?.top ?? -1,
      subjectText: subject?.textContent ?? "",
      subjectClipped: subject ? subject.scrollWidth - subject.clientWidth > 1 : true,
    };
  });
  expect(geometry.ribbonBottom).toBeGreaterThan(0);
  expect(geometry.toggleTop).toBeGreaterThanOrEqual(geometry.ribbonBottom);
  expect(Math.abs(geometry.toggleTop - geometry.letterTop)).toBeLessThanOrEqual(2);
  expect(geometry.subjectText).toBe("tardive dyskinesia");
  expect(geometry.subjectClipped).toBe(false);

  await gotoDictionary(page, "/dictionary/search?q=MMSE&view=abbreviations", "dictionary-catalogue-main");
  await expect(ribbon.getByRole("status")).toHaveText(/^1 abbreviation$/);

  await clickUntil(page.getByTestId("dictionary-clear-query"), page.getByTestId("dictionary-letter-chip"));
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page.getByTestId("search-query-ribbon")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("uses a readable phone definition and stacked comparison sections", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await gotoDictionary(page, "/dictionary/auditory-hallucination", "dictionary-term-main");

  const status = page.getByTestId("dictionary-source-status-summary");
  await expect(status).toBeVisible();
  await expect(status).toContainText("Source linked");
  await expect(page.getByRole("complementary", { name: "Entry details" })).toBeHidden();
  const disclosures = page
    .locator(
      "#dictionary-meaning, #dictionary-context, #dictionary-distinctions, #dictionary-sources, #dictionary-related",
    )
    .getByRole("button");
  await expect(disclosures).toHaveCount(5);
  for (const button of await disclosures.all()) {
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
  await expect(page.locator("#dictionary-meaning-content")).toBeVisible();
  await expect(page.locator("#dictionary-context-content")).toBeHidden();

  await gotoDictionary(
    page,
    "/dictionary/compare?a=mental-state-examination&b=mini-mental-state-examination",
    "dictionary-compare-main",
  );
  const meaning = page.getByRole("group", { name: "Meaning" });
  await expect(meaning).toHaveCount(0);
  const phoneSection = page.locator("details.source-print").first();
  await expect(phoneSection).toBeVisible();
  const paired = phoneSection.locator("p");
  await expect(paired).toHaveCount(2);
  const boxes = await paired.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(boxes[1]).toBeGreaterThan(boxes[0]);
  await expectNoHorizontalOverflow(page);
});

test("preserves contrast modes, reduced motion, axe, and print content", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await gotoDictionary(page, "/dictionary/auditory-hallucination", "dictionary-term-main");
  await expectNoBlockingAxeViolations(page, testInfo);

  await page.emulateMedia({ colorScheme: "light", forcedColors: "active", reducedMotion: "reduce" });
  await expect(page.getByTestId("dictionary-source-status-summary")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.emulateMedia({ media: "print", forcedColors: "none" });
  await expect(page.locator("#dictionary-context-content")).toBeVisible();
  await expect(page.getByRole("button", { name: "Print entry" })).toBeHidden();

  await page.emulateMedia({ media: "screen", colorScheme: "light" });
  await gotoDictionary(
    page,
    "/dictionary/compare?a=mental-state-examination&b=mini-mental-state-examination",
    "dictionary-compare-main",
  );
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("A · MSE", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("B · MMSE", { exact: true }).first()).toBeVisible();
});

// The catalogue is a result view, so from sm up it must carry the same compact
// pill every other results page carries: no rotating "Try ..." ticker, no
// Prompts rail, no APP-5 privacy line. It regressed because the page was wired
// to the mode-home composer slot, and slot id is what selects the placement the
// home helpers are gated on (PR #2639).
test("carries the compact result pill alone from sm up, like every other catalogue", async ({ page }) => {
  for (const width of [820, 1280] as const) {
    await page.setViewportSize({ width, height: 900 });
    await gotoDictionary(page, "/dictionary/search", "dictionary-catalogue-main");
    const slot = page.getByTestId("dictionary-catalogue-composer");
    await expect(slot).toBeVisible();
    await expect(slot.getByTestId("global-search-input")).toBeVisible();

    // Exactly one composer on the page, and the page-owned slot is the only
    // element carrying that id — the shell must not emit a second one.
    await expect(page.getByTestId("global-search-input")).toHaveCount(1);
    await expect(page.locator("#desktop-page-search-composer-slot")).toHaveCount(1);
    await expect(page.locator("#mode-home-desktop-composer-slot")).toHaveCount(0);

    // The home-only helpers stay off a results page.
    await expect(page.getByTestId("search-example-ticker")).toHaveCount(0);
    await expect(page.getByTestId("smart-search-prompt-row")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Search privacy notice" })).toHaveCount(0);

    // 80px settled: the compact pill's exact height, from the page slot's own
    // 5rem reserve override rather than the taller mode-home token.
    const height = (await slot.boundingBox())?.height ?? 0;
    expect(height).toBeGreaterThan(64);
    expect(height).toBeLessThanOrEqual(96);

    // Still under the mode nav and above the Filter band, which is the only
    // reason this slot is page-owned at all.
    const nav = await page.getByRole("link", { name: "Topics" }).first().boundingBox();
    const ribbon = await page.getByTestId("search-query-ribbon").boundingBox();
    const slotBox = await slot.boundingBox();
    const navBottom = (nav?.y ?? 0) + (nav?.height ?? 0);
    expect(slotBox?.y ?? 0).toBeGreaterThanOrEqual(navBottom);
    expect(slotBox?.y ?? 0).toBeLessThan(ribbon?.y ?? 0);
  }
});
