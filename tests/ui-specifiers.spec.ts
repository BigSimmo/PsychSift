import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "playwright/test";
import { clickWhenSettled, expectSingleSettledOwner, visibleByTestId, visibleByText } from "./playwright-settlement";

const axeWcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const axeBlockingImpacts = new Set(["critical", "serious"]);

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
  // Deterministic app-shell mount wait (networkidle burned the full timeout on
  // routes with persistent background fetches; per-test assertions gate readiness).
  await page
    .locator("#main-content")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);
}

/** `gotoApp` waits for the server-rendered shell, not for React to attach its handlers.
 * A click that lands in that window is silently dropped, and the assertion that follows
 * fails as "element(s) not found" for a heading the step change would have rendered.
 * Same probe as `tests/ui-smoke.spec.ts` and `tests/ui-stress.spec.ts`. */
async function waitForReactEventHandler(locator: Locator, eventName: "onClick") {
  await expect
    .poll(
      async () =>
        locator.evaluate((element, reactEventName) => {
          const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
          if (!propsKey) return false;
          const props = (element as unknown as Record<string, Record<string, unknown>>)[propsKey];
          return typeof props?.[reactEventName] === "function";
        }, eventName),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

async function expectNoBlockingAxeViolations(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(axeWcagTags).analyze();
  await testInfo.attach("axe-violations", {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });

  const blocking = results.violations
    .filter((violation) => axeBlockingImpacts.has(violation.impact ?? ""))
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes
          .map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? "no failure summary"}`)
          .join(" | ")}; see ${violation.helpUrl}`,
    );
  expect(blocking, "axe found critical/serious WCAG A/AA violations").toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test("mode Search tab from compare lands on the specifiers search catalogue", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page, "/specifiers/compare");

  await expect(page.getByRole("heading", { name: "Compare two specifiers", exact: true })).toBeVisible();
  const modeNav = page.getByTestId("mode-nav");
  const searchTab = modeNav.getByRole("link", { name: "Search" });
  await expect(searchTab).toBeVisible();
  await expect(searchTab).toHaveAttribute("href", "/specifiers/search");
  await expect(modeNav.getByRole("link", { name: "Compare" })).toHaveAttribute("aria-current", "page");

  await searchTab.click();
  await expect(page).toHaveURL(/\/specifiers\/search(?:\?|$)/, { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("mode")).toBeNull();
  await expect(modeNav.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");
});

test("mode Search tab from builder lands on the specifiers search catalogue", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoApp(page, "/specifiers/builder");

  const modeNav = page.getByTestId("mode-nav");
  const searchTab = modeNav.getByRole("link", { name: "Search" });
  await expect(searchTab).toHaveAttribute("href", "/specifiers/search");
  await expect(modeNav.getByRole("link", { name: "Build" })).toHaveAttribute("aria-current", "page");

  await searchTab.click();
  await expect(page).toHaveURL(/\/specifiers\/search(?:\?|$)/, { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("mode")).toBeNull();
});

test("searches clinical language without provenance fields and carries a result into wording", async ({
  page,
}, testInfo) => {
  // `/specifiers` is a 307 onto the shared home now; going there directly keeps
  // the test on the surface it is actually asserting about.
  await gotoApp(page, "/?mode=specifiers");

  await expect(page.getByRole("heading", { name: "Diagnostic Specifiers", exact: true })).toBeVisible();
  await expect(page.getByTestId("shared-home-empty-state")).toBeVisible();

  const search = page.getByTestId("global-search-input").filter({ visible: true }).first();
  await expect(search).toHaveAccessibleName(
    /Search indexed guidelines by question or keyword - Search psychiatric specifiers by presentation or diagnosis/,
  );
  await search.fill("depressed but racing thoughts");
  await page.getByRole("button", { name: "Find matching psychiatric specifiers" }).click();

  await expect(page).toHaveURL(
    /\/specifiers\/search\?.*q=depressed(?:\+|%20)but(?:\+|%20)racing(?:\+|%20)thoughts.*run=1/,
  );
  const queryRibbon = page.getByTestId("search-query-ribbon");
  await expect(queryRibbon.getByRole("heading", { level: 1, name: "depressed but racing thoughts" })).toBeVisible();
  await expect(queryRibbon.getByRole("group", { name: "Filter specifier results" })).toBeVisible();
  await expect(page.getByText(/Results ranked by text relevance/i)).toHaveCount(0);
  // Smart natural-language queries default to the full catalogue lane. This journey
  // asserts curated guide cards (Top match → wording), so pin Search in → guides first.
  {
    const guidesUrl = new URL(page.url());
    guidesUrl.searchParams.set("scope", "guides");
    await page.goto(guidesUrl.toString());
  }
  await expect(page).toHaveURL(/scope=guides/);
  // `visibleByText`, not a bare getByText: until React's `$RV` reveal runs, the
  // streamed copy of this route is still parked in a `<div hidden id="S:n">` at
  // the end of <body> (see `(search-app)/loading.tsx`), so a page-level query
  // resolves to the live badge plus that hidden twin and trips strict mode.
  // Chromium reveals before this line; WebKit loses the race (#093).
  await expect(visibleByText(page, "Top match", { exact: true })).toBeVisible();
  // Below the sm breakpoint the results band swaps the desktop trigger for its phone twin.
  // `visibleByTestId` for the same hidden streamed twin as the badge above (#093): the
  // trigger renders in both copies, and WebKit can still hold the parked one here.
  const phoneWidth = (page.viewportSize()?.width ?? 1280) < 640;
  const filterTrigger = visibleByTestId(
    page,
    phoneWidth ? "specifier-filter-trigger-phone" : "specifier-filter-trigger-desktop",
  );
  await filterTrigger.click();
  const filterPanel = page.getByTestId("specifier-filter-panel");
  await expect(filterPanel).toBeVisible();
  await expect(filterPanel.getByRole("group", { name: "Search in" })).toBeVisible();
  await expect(filterPanel.getByRole("radiogroup", { name: "Family" })).toBeVisible();
  await expect(filterPanel.getByRole("radiogroup", { name: "Diagnosis" })).toBeVisible();
  await filterPanel.getByTestId("specifier-filter-panel-done").click();
  await expect(page.getByText("Best fit", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/clinical fit/i)).toHaveCount(0);
  const topMatch = page.getByTestId("specifier-top-match");
  const topMatchLink = topMatch.getByRole("link", { name: "Open With mixed features" });
  await expect(topMatchLink).toBeVisible();
  await expect(topMatch.getByTestId("specifier-open-tab")).toHaveText("Open");
  await expect(page.getByText("Source status", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source", { exact: true })).toHaveCount(0);

  await topMatchLink.click();
  await expect(page).toHaveURL(/\/specifiers\/with-mixed-features$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "With mixed features", exact: true })).toBeVisible();
  // Address the record label by id. The in-page section sheet's labels do not
  // currently include these words, but the formulation sibling failed CI under
  // Playwright strict mode once a nav control shared the same text — pin the
  // unique target rather than relying on that coincidence.
  await expect(page.locator("#what-matters-now")).toBeVisible();

  await page.getByRole("link", { name: "Use in builder", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Build a clear diagnosis" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Specifier builder steps" })).toBeVisible();
  await expect(page.getByTestId("specifier-builder-episode-features")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Mixed features/ })).toBeChecked();
  await expect(page.getByTestId("specifier-working-wording")).toContainText(/with mixed features/i);
  await expectNoHorizontalOverflow(page);
  await expectNoBlockingAxeViolations(page, testInfo);
});

test("keeps mobile search, filters, results, and the fixed composer usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/specifiers/search?q=returns+every+winter&run=1");

  const queryRibbon = page.getByTestId("search-query-ribbon");
  await expect(queryRibbon.getByRole("heading", { level: 1, name: "returns every winter" })).toBeVisible();
  await expect(queryRibbon.getByRole("group", { name: "Filter specifier results" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open With seasonal pattern" })).toBeVisible();
  // Both dimensions used to be side-by-side selects in the ribbon; they are now
  // one compact trigger opening a sheet that holds both groups.
  const filterTrigger = queryRibbon.getByTestId("specifier-filter-trigger-phone");
  await expect(filterTrigger).toBeVisible();
  await expect(filterTrigger).toHaveAccessibleName(/No filters active/);
  await expect(page.getByTestId("global-search-input").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Source status", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source", { exact: true })).toHaveCount(0);

  const topMatch = page.getByTestId("specifier-top-match");
  const topMatchLink = topMatch.getByRole("link", { name: "Open With seasonal pattern" });
  for (const width of [320, 390, 639, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expectNoHorizontalOverflow(page);

    const geometry = await topMatch.evaluate((card) => {
      const copy = card.querySelector<HTMLElement>("[data-specifier-card-copy]");
      const signal = card.querySelector<HTMLElement>("[data-specifier-card-signal]");
      const tab = card.querySelector<HTMLElement>("[data-testid='specifier-open-tab']");
      const detailCells = [...card.querySelectorAll<HTMLElement>("[data-specifier-card-details] > div")];
      if (!copy || !signal || !tab || detailCells.length !== 2) {
        throw new Error("Expected complete specifier result-card structure");
      }

      const cardRect = card.getBoundingClientRect();
      const copyRect = copy.getBoundingClientRect();
      const signalRect = signal.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      const cardStyle = getComputedStyle(card);
      const tabStyle = getComputedStyle(tab);
      const detailRects = detailCells.map((cell) => cell.getBoundingClientRect());
      return {
        borderColors: [
          cardStyle.borderTopColor,
          cardStyle.borderRightColor,
          cardStyle.borderBottomColor,
          cardStyle.borderLeftColor,
        ],
        borderWidths: [
          cardStyle.borderTopWidth,
          cardStyle.borderRightWidth,
          cardStyle.borderBottomWidth,
          cardStyle.borderLeftWidth,
        ].map(Number.parseFloat),
        card: { top: cardRect.top, right: cardRect.right },
        copy: { left: copyRect.left, right: copyRect.right },
        detailCells: detailRects.map((rect) => ({ top: rect.top, width: rect.width })),
        signal: { left: signalRect.left, right: signalRect.right },
        tab: { top: tabRect.top, right: tabRect.right, height: tabRect.height, color: tabStyle.color },
      };
    });

    expect(new Set(geometry.borderColors).size, `${width}px complete blue frame`).toBe(1);
    expect(geometry.borderColors[0], `${width}px frame uses the clinical blue`).toBe(geometry.tab.color);
    expect(Math.min(...geometry.borderWidths), `${width}px complete frame width`).toBeGreaterThanOrEqual(2);
    expect(Math.abs(geometry.tab.top - geometry.card.top), `${width}px tab top edge`).toBeLessThanOrEqual(3);
    expect(Math.abs(geometry.card.right - geometry.tab.right), `${width}px tab right edge`).toBeLessThanOrEqual(3);
    expect(geometry.tab.height, `${width}px open target`).toBeGreaterThanOrEqual(48);

    if (width < 640) {
      expect(
        Math.abs(geometry.copy.left - geometry.signal.left),
        `${width}px aligned content left edge`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(geometry.copy.right - geometry.signal.right),
        `${width}px aligned content right edge`,
      ).toBeLessThanOrEqual(1);
    } else {
      expect(
        Math.abs(geometry.detailCells[0].top - geometry.detailCells[1].top),
        `${width}px detail row`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(geometry.detailCells[0].width - geometry.detailCells[1].width),
        `${width}px equal detail columns`,
      ).toBeLessThanOrEqual(1);
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await topMatchLink.focus();
  await expect(topMatchLink).toBeFocused();
  const focusStyle = await topMatch.evaluate((card) => {
    const style = getComputedStyle(card);
    return {
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(focusStyle.outlineOffset).toBeGreaterThanOrEqual(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => topMatch.evaluate((card) => Number.parseFloat(getComputedStyle(card).transitionDuration)))
    .toBeLessThanOrEqual(0.001);
  await testInfo.attach("specifier-result-card-phone", {
    body: await topMatch.screenshot(),
    contentType: "image/png",
  });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await expect(topMatch.getByTestId("specifier-open-tab")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "none", reducedMotion: "reduce" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const darkTheme = await topMatch.evaluate((card) => {
    const tab = card.querySelector<HTMLElement>("[data-testid='specifier-open-tab']");
    if (!tab) throw new Error("Expected the specifier open tab");
    const cardStyle = getComputedStyle(card);
    const tabStyle = getComputedStyle(tab);
    return {
      borderColors: [
        cardStyle.borderTopColor,
        cardStyle.borderRightColor,
        cardStyle.borderBottomColor,
        cardStyle.borderLeftColor,
      ],
      tabColor: tabStyle.color,
    };
  });
  expect(new Set(darkTheme.borderColors).size, "dark mode complete blue frame").toBe(1);
  expect(darkTheme.borderColors[0], "dark mode frame uses the clinical blue").toBe(darkTheme.tabColor);
  await expectNoHorizontalOverflow(page);
  // Let the light-to-dark colour transition settle; WebKit sampled a mid-transition colour.
  // One round is not enough: inherited colours start fresh transitions as their parents
  // finish, so WebKit still had hundreds running after the first batch resolved.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
          return document.getAnimations().length;
        }),
      { message: "light-to-dark colour transitions settle" },
    )
    .toBe(0);
  await expectNoBlockingAxeViolations(page, testInfo);
  await testInfo.attach("specifier-result-card-phone-dark", {
    body: await topMatch.screenshot(),
    contentType: "image/png",
  });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.emulateMedia({ colorScheme: "light", forcedColors: "none", reducedMotion: "reduce" });

  await filterTrigger.click();
  const familyGroup = page.getByRole("radiogroup", { name: "Family" });
  const diagnosisGroup = page.getByRole("radiogroup", { name: "Diagnosis" });
  await familyGroup.getByRole("radio", { name: "Course" }).click();
  await expect(familyGroup.getByRole("radio", { name: "Course" })).toBeChecked();
  await diagnosisGroup.getByRole("radio", { name: "Depressive" }).click();
  await expect(diagnosisGroup.getByRole("radio", { name: "Depressive" })).toBeChecked();
  await page.getByTestId("specifier-filter-panel-done").click();

  // Two dimensions applied, counted independently on the badge.
  await expect(filterTrigger).toHaveAccessibleName(/2 filters active/);
  await expect(page.getByRole("link", { name: "Open With seasonal pattern" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "Open With seasonal pattern" }).click();
  await expect(page.getByRole("heading", { name: "With seasonal pattern", exact: true })).toBeVisible();
  // The record's actions moved into the in-page header's ellipsis sheet.
  await page.getByTestId("specifier-actions-trigger").click();
  const recordActions = page.getByTestId("specifier-actions-sheet");
  await expect(recordActions.getByRole("link", { name: "Compare", exact: true })).toBeVisible();
  await expect(recordActions.getByRole("link", { name: "Build wording", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(recordActions).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await expectNoBlockingAxeViolations(page, testInfo);
});

test("keeps the specifier map flow usable with reduced motion and forced colors", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await gotoApp(page, "/specifiers/map?selected=with-anxious-distress");

  await expect(page.getByRole("heading", { name: "Find the right specifier", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  const roleNavigation = page.getByRole("navigation", { name: "Choose a specifier role" });
  await expect(roleNavigation.getByRole("button")).toHaveCount(3);
  await expect(page.getByText("Base diagnosis", { exact: true })).toHaveCount(0);

  const courseJump = page.getByTestId("specifier-map-jump-course-onset");
  await courseJump.focus();
  await expect(courseJump).toBeFocused();
  await expect
    .poll(() => courseJump.evaluate((button) => Number.parseFloat(getComputedStyle(button).transitionDuration)))
    .toBeLessThanOrEqual(0.001);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/#course-onset$/);
  await expect(courseJump).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#course-onset")).toBeInViewport();
  await expectNoHorizontalOverflow(page);
  await expectNoBlockingAxeViolations(page, testInfo);
  await testInfo.attach("specifier-map-flow-phone-forced-colors", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("keeps the base diagnosis severity-neutral when applying a severity descriptor", async ({ page }) => {
  await gotoApp(page, "/specifiers/builder?specifier=mild-severity");

  await expect(page.getByTestId("specifier-builder-severity-remission")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Mild/ })).toBeChecked();
  await expect(page.getByTestId("specifier-working-wording")).toHaveText("Major depressive disorder, recurrent, mild");
  await expect(page.getByText(/severe, mild|moderate, mild/i)).toHaveCount(0);

  await page.getByRole("button", { name: /Step 2 of 4: Episode features/ }).click();
  const anxiousDistress = page.getByRole("checkbox", { name: /Anxious distress/ });
  await page.getByText("Anxious distress", { exact: true }).click();
  await expect(anxiousDistress).toBeChecked();
  await expect(page.getByTestId("specifier-working-wording")).toHaveText(
    "Major depressive disorder, recurrent, with anxious distress, mild",
  );
});

test("keeps the guided builder readable without horizontal overflow on phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/specifiers/builder?specifier=mild-severity");

  const steps = page.getByRole("list", { name: "Specifier builder steps" });
  await expect(steps).toBeVisible();
  await expect(steps.getByRole("button", { name: /Step 1 of 4: Base diagnosis/ })).toBeVisible();
  await expect(steps.getByRole("button", { name: /Step 2 of 4: Episode features/ })).toBeVisible();
  await expect(steps.getByRole("button", { name: /Step 3 of 4: Course and onset/ })).toBeVisible();
  await expect(steps.getByRole("button", { name: /Step 4 of 4: Severity or remission/ })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.getByRole("heading", { name: "Build a clear diagnosis" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Mild/ })).toBeChecked();
  await expectNoHorizontalOverflow(page);
  await expectNoBlockingAxeViolations(page, testInfo);
});

test("guides choices into a reviewable and copyable diagnosis", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => window.sessionStorage.setItem("specifier-builder-copied-text", value),
      },
    });
  });
  await gotoApp(page, "/specifiers/builder");

  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  const previous = page.getByRole("button", { name: "Previous", exact: true });
  await expect(previous).toBeDisabled();

  const continueToFeatures = page.getByRole("button", { name: "Continue to features" });
  await waitForReactEventHandler(continueToFeatures, "onClick");
  // Wait for the collapsing phone chrome to stop moving the button, so the tap
  // lands on it rather than where it was a frame earlier.
  await clickWhenSettled(continueToFeatures);
  await expect(page.getByRole("heading", { name: "Add episode features" })).toBeFocused();
  await page.getByText("Mixed features", { exact: true }).click();
  await page.getByRole("button", { name: "Continue to course" }).click();
  await page.getByRole("button", { name: "Continue to severity" }).click();

  await page.getByText("Mild", { exact: true }).click();
  await expect(page.getByRole("radio", { name: /Mild/ })).toBeChecked();
  await page.getByText("Partial remission", { exact: true }).click();
  await expect(page.getByRole("radio", { name: /Partial remission/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Mild/ })).not.toBeChecked();

  await page.getByRole("button", { name: "Review wording" }).click();
  const review = page.getByTestId("specifier-builder-review");
  await expect(review.getByRole("heading", { name: "Review the wording" })).toBeVisible();
  await expect(review.getByRole("heading", { name: "Review the wording" })).toBeFocused();
  await expect(review.getByTestId("specifier-completed-wording")).toHaveText(
    "Major depressive disorder, recurrent, with mixed features, in partial remission",
  );

  await review.getByRole("button", { name: "Copy wording" }).click();
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("specifier-builder-copied-text")))
    .toBe("Major depressive disorder, recurrent, with mixed features, in partial remission");
  await expect(review.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(review.getByRole("status")).toHaveText("Wording copied to the clipboard.");

  await review.getByRole("button", { name: "Edit Episode features" }).click();
  await expect(page.getByRole("checkbox", { name: /Mixed features/ })).toBeChecked();
  await page.getByRole("button", { name: /Step 4 of 4: Severity or remission/ }).click();
  await page.getByRole("button", { name: "Review wording" }).click();
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByTestId("specifier-builder-base")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Diagnostic phrase" })).toHaveValue("mdd-recurrent");
  await expect(page.getByTestId("specifier-working-wording")).toHaveText("Major depressive disorder, recurrent");
  await expectNoBlockingAxeViolations(page, testInfo);
});

test("fits the guided builder across its responsive breakpoints", async ({ page }) => {
  for (const width of [320, 639, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await gotoApp(page, "/specifiers/builder");
    await expect(page.getByRole("list", { name: "Specifier builder steps" })).toBeVisible();
    // A hidden streaming clone of the page root can coexist briefly in WebKit (#093).
    await expectSingleSettledOwner(page.getByTestId("specifier-builder-base"));
    await expectNoHorizontalOverflow(page);
  }
});

test("keeps the guide usable with reduced motion and forced colors", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await gotoApp(page, "/specifiers/builder");

  await expect
    .poll(() => page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window.matchMedia("(forced-colors: active)").matches)).toBe(true);
  const continueToFeatures = page.getByRole("button", { name: "Continue to features" });
  await waitForReactEventHandler(continueToFeatures, "onClick");
  await clickWhenSettled(continueToFeatures);
  await expect(page.getByRole("heading", { name: "Add episode features" })).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await expectNoBlockingAxeViolations(page, testInfo);
});

test("blocks incompatible specifiers and preserves severe psychotic-features wording", async ({ page }) => {
  // Psychotic features applies to MDD, so the deep link stays on the recurrent-MDD base.
  // Rapid cycling is bipolar-only, so it must remain blocked until a bipolar base is chosen.
  await gotoApp(page, "/specifiers/builder?specifier=with-psychotic-features");

  await page.getByRole("button", { name: /Step 3 of 4: Course and onset/ }).click();
  const rapidCycling = page.getByRole("checkbox", { name: /Rapid cycling/ });
  await expect(rapidCycling).toBeDisabled();
  await expect(rapidCycling).not.toBeChecked();
  await expect(page.getByTestId("specifier-working-wording")).toHaveText(
    "Major depressive disorder, recurrent, severe with psychotic features",
  );

  await page.getByRole("button", { name: /Step 1 of 4: Base diagnosis/ }).click();
  await page.getByRole("combobox", { name: "Diagnostic phrase" }).selectOption("bipolar-i-manic");
  await page.getByRole("button", { name: /Step 3 of 4: Course and onset/ }).click();
  await expect(rapidCycling).toBeEnabled();
  await page.getByText("Rapid cycling", { exact: true }).click();
  await expect(rapidCycling).toBeChecked();
});

test("infers a compatible diagnosis for non-MDD builder deep links", async ({ page }) => {
  await gotoApp(page, "/specifiers/builder?specifier=with-rapid-cycling&specifier=with-psychotic-features");

  await page.getByRole("button", { name: /Step 3 of 4: Course and onset/ }).click();
  const rapidCycling = page.getByRole("checkbox", { name: /Rapid cycling/ });
  await page.getByRole("button", { name: /Step 1 of 4: Base diagnosis/ }).click();
  await expect(page.getByRole("combobox", { name: "Diagnostic phrase" })).toHaveValue("bipolar-i-depressed");
  await page.getByRole("button", { name: /Step 3 of 4: Course and onset/ }).click();
  await expect(rapidCycling).toBeEnabled();
  await expect(rapidCycling).toBeChecked();
  await expect(page.getByTestId("specifier-working-wording")).toHaveText(
    "Bipolar I disorder, current episode depressed, severe with psychotic features, with rapid cycling",
  );

  await page.getByRole("button", { name: /Step 1 of 4: Base diagnosis/ }).click();
  await page.getByRole("combobox", { name: "Diagnostic phrase" }).selectOption("bipolar-i-manic");
  await page.getByRole("button", { name: /Step 3 of 4: Course and onset/ }).click();
  await expect(rapidCycling).toBeEnabled();
  await expect(rapidCycling).toBeChecked();
});
