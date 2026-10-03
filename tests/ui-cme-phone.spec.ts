import { expect, test } from "playwright/test";

import { expectSingleSettledOwner } from "./playwright-settlement";

/**
 * 19 September 2026, 10:00 Perth. Every figure the CME screens derive from
 * "now" — days remaining, the pace projection, which year an entry falls in —
 * is fixed by this, so the screens are byte-stable between runs. Perth rather
 * than UTC because the CPD year boundary is a Perth midnight: an entry logged
 * at 20:00 on 31 December is in that year, and a UTC comparison would move it
 * to the next.
 *
 * `src/components/cme/cme-dashboard-route.tsx` and
 * `cme-routines-route.tsx` already pass `DEMO_CME_INSTANT`
 * (`src/lib/cme/demo-year.ts`) rather than `new Date()` into the components
 * they wire up, so this freeze is defense in depth against a future change
 * reintroducing a live clock — not a workaround for a live one today. Without
 * it, the day this file's assumptions stop holding is invisible until a
 * screenshot review notices the "days left" figure has quietly moved.
 */
const FROZEN = new Date("2026-09-19T02:00:00Z");

/**
 * The original visual reference routes. Setup and routines additionally have
 * responsive journey coverage below now that they are functional screens.
 */
// `/cme/programme` is now only a redirect to Set up, so the baseline measures Set up itself.
export const CME_BASELINE_ROUTES = ["/cme", "/cme/log", "/cme/new", "/cme/setup"] as const;

const CME_CORE_ROUTES = [...CME_BASELINE_ROUTES, "/cme/routines", "/cme/summary?year=2026"] as const;

const CLINICAL_STATUS_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke)-(?:red|amber|green|orange|rose|emerald|yellow)-[0-9]/;

test.describe("CME on a phone", () => {
  test.use({ viewport: { width: 390, height: 820 } });

  test.beforeEach(async ({ page }) => {
    // `setFixedTime` pins `new Date()` to FROZEN without touching
    // `requestAnimationFrame`. `page.clock.install()` + `pauseAt()` also
    // freezes rAF, which stalls React 19's rAF-deferred Suspense cleanup and
    // strands a hidden duplicate copy of the page in the DOM — do not go
    // back to that combination.
    await page.clock.setFixedTime(FROZEN);
  });

  test("the dashboard leads with position, pace and one action", async ({ page }) => {
    await page.goto("/cme");
    await expect(page.locator("#main-content")).toBeVisible();
    // `toContainText`, not `toHaveText`: the testid now sits on a hero span
    // whose text is "32.5 of 50 h" — the figure plus its own muted "of N h"
    // sibling text. An exact-text match would pin that whole sentence instead
    // of the one figure this assertion is actually about.
    await expect(page.getByTestId("cme-total-hours")).toContainText("32.5");
    await expect(page.getByTestId("cme-pace-sentence")).toContainText("About 1.2 h a week reaches 50 h by 31 Dec");
    await expect(page.getByTestId("cme-hero-season")).toHaveText("Year ends 31 Dec 2026, in 15 weeks");
    await expect(page.getByTestId("cme-next-action")).toBeVisible();
  });

  test("every baseline route renders its main region at 390px with no sideways scroll", async ({ page }) => {
    for (const route of CME_BASELINE_ROUTES) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${route} scrolls sideways at 390px`).toBeLessThanOrEqual(0);
    }
  });

  /**
   * The dom-level contract (`tests/cme-visual-contract.dom.test.tsx`) checks
   * for the CSS class token that guarantees a 48px floor, because jsdom
   * cannot lay out real pixels. This is the complement: a real Chromium
   * layout, measuring the actual rendered box of every interactive control
   * across every CME baseline route.
   */
  test("every interactive control on a baseline route actually measures at least 48px tall", async ({ page }) => {
    for (const route of CME_BASELINE_ROUTES) {
      await page.goto(route);
      const shortControls = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll<HTMLElement>("button, a[href], [role='button']")];
        return (
          nodes
            .map((node) => ({ node, rect: node.getBoundingClientRect() }))
            // Excludes two shapes that are not an undersized tap target: a
            // zero-size box (not rendered — e.g. inside a closed disclosure),
            // and the root layout's global "Skip to main content" link,
            // which is `sr-only` (a real, correctly-implemented 1x1px
            // visually-hidden-until-focus pattern every page in the app
            // carries, not a CME control at all) until it is focused.
            .filter(({ rect }) => rect.height > 0 && rect.height < 48 && rect.width > 4)
            .map(({ node, rect }) => ({
              label: node.textContent?.trim() || node.getAttribute("aria-label") || node.tagName,
              height: Math.round(rect.height),
            }))
        );
      });
      expect(shortControls, `${route} has a control under 48px tall`).toEqual([]);
    }
  });

  test("paints no clinical status colour anywhere on the dashboard", async ({ page }) => {
    await page.goto("/cme");
    const offenders = await page.evaluate((patternSource) => {
      const pattern = new RegExp(patternSource);
      return [...document.querySelectorAll<HTMLElement>("[class]")]
        .filter((node) => pattern.test(node.className))
        .map((node) => node.className);
    }, CLINICAL_STATUS_CLASS.source);
    expect(offenders).toEqual([]);
  });

  test("the customise screen's reorder controls are real buttons a keyboard can reach and use", async ({ page }) => {
    await page.goto("/cme/customise");
    const list = page.getByTestId("cme-module-order");
    await expect(list).toBeVisible();

    const firstItemLabel = list.getByRole("listitem").first();
    const labelBefore = (await firstItemLabel.textContent())?.trim();

    const moveDown = list.getByRole("button", { name: /move .* down/i }).first();
    await moveDown.focus();
    await expect(moveDown).toBeFocused();
    await page.keyboard.press("Enter");

    const labelAfter = (await list.getByRole("listitem").first().textContent())?.trim();
    expect(labelAfter).not.toBe(labelBefore);
  });
});

test.describe("CME core screens at phone widths", () => {
  test("a due routine prefills an activity without recording attendance", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cme/routines");
    await page.getByRole("button", { name: "Log 1.0 h for Demo journal club", exact: true }).click();
    await expect(page).toHaveURL(/\/cme\/new\?routine=/);
    await expect(page.getByLabel("What was it", { exact: false })).toHaveValue("Demo journal club");
    // The routine's usual hours are shown, not assumed: the doctor chooses the hours actually spent.
    await expect(page.getByText("This routine usually takes 1 h.")).toBeVisible();
    const oneHour = page.getByRole("group", { name: "Hours" }).getByRole("button", { name: "1", exact: true });
    await expect(oneHour).toHaveAttribute("aria-pressed", "false");
    await oneHour.click();
    await expect(oneHour).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Educational", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Save entry", exact: true })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByTestId("cme-entry-demo-notice")).toContainText("Saving is available only");
  });

  test("year navigation returns to the current year's visible records", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cme/log");
    await expect(page.locator('[data-testid^="cme-log-row-"]')).toHaveCount(47);
    // The year choice lives in the filter sheet on a phone.
    await page.getByTestId("cme-log-open-filters").click();
    await page
      .getByTestId("cme-log-filter-sheet")
      .getByRole("navigation", { name: "Select year" })
      .getByRole("link", { name: /^2025\b/ })
      .click();
    await expect(page).toHaveURL(/year=2025/);
    await expect(page.locator('[data-testid^="cme-log-row-"]')).toHaveCount(0);
    await page.getByRole("navigation", { name: "Log tabs" }).getByRole("link", { name: "Routines" }).click();
    await expect(page).toHaveURL(/\/cme\/routines\?year=2025/);
    await page.getByRole("navigation", { name: "Log tabs" }).getByRole("link", { name: "Activities" }).click();
    await expect(page).toHaveURL(/\/cme\/log\?year=2025/);
    await expect(page.locator('[data-testid^="cme-log-row-"]')).toHaveCount(0);
    // The year choice lives in the filter sheet on a phone.
    await page.getByTestId("cme-log-open-filters").click();
    await page
      .getByTestId("cme-log-filter-sheet")
      .getByRole("navigation", { name: "Select year" })
      .getByRole("link", { name: /^2026\b/ })
      .click();
    await expect(page.locator('[data-testid^="cme-log-row-"]')).toHaveCount(47);
  });

  for (const scenario of [
    { width: 320, colorScheme: "light" },
    { width: 390, colorScheme: "dark" },
    { width: 430, colorScheme: "light" },
  ] as const) {
    test(`${scenario.width}px ${scenario.colorScheme}: controls fit and text does not overflow`, async ({ page }) => {
      await page.setViewportSize({ width: scenario.width, height: 844 });
      await page.emulateMedia({ colorScheme: scenario.colorScheme, reducedMotion: "reduce" });
      await page.clock.setFixedTime(FROZEN);
      for (const route of CME_CORE_ROUTES) {
        await page.goto(route);
        await expect(page.locator("#main-content")).toBeVisible();
        await expect(page.locator("#main-content")).not.toContainText(/NaN|undefined/);
        const dimensions = await page.evaluate(() => ({
          // The app's edge-to-edge shell includes a desktop browser scrollbar
          // gutter; use the viewport, as the existing phone route contract does.
          width: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(dimensions.scrollWidth, `${route} overflows at ${scenario.width}px`).toBeLessThanOrEqual(
          dimensions.width + 1,
        );
        const smallControls = await page.locator("#main-content").evaluate((root) =>
          Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input:not([type=checkbox]), select"))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 4 && rect.height > 0 && rect.height < 48;
            })
            .map((node) => node.getAttribute("aria-label") || node.textContent?.trim() || node.tagName),
        );
        expect(smallControls, `${route} has undersized phone controls`).toEqual([]);
      }
    });
  }

  test("setup remains readable with forced colours and keyboard focus", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.goto("/cme/setup");
    await expect(page.locator("#main-content")).toBeVisible();
    // Set up opens on its read view, whose first control is a link (Edit), not a button.
    const control = page.locator("#main-content").locator("a[href], button").first();
    await control.focus();
    await expect(control).toBeFocused();
    await expect(control).toBeInViewport();
  });
});

test.describe("CME annual records and explicit learning handoff", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("prints the whole selected year with black text and no controls or clipping ancestors", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto("/cme/summary?year=2026");
    const summary = await expectSingleSettledOwner(page.getByTestId("cme-annual-summary"));
    await expect(summary.getByRole("heading", { level: 1 })).toContainText("2026");
    await expect(summary).toContainText("47 active activities");
    await page.emulateMedia({ media: "print" });
    // The page controls and the close-the-year panel both stay out of the printout.
    const printControls = summary.locator(".cme-print-controls");
    await expect(printControls).toHaveCount(2);
    for (const control of await printControls.all()) await expect(control).toBeHidden();
    // WebKit can hide print controls before its print color cascade has painted.
    // Keep the all-black requirement, then inspect the settled print geometry.
    await expect
      .poll(() =>
        summary.evaluate((root) => [
          ...new Set(
            [...root.querySelectorAll<HTMLElement>("h1,h2,h3,p,li")].map((node) => getComputedStyle(node).color),
          ),
        ]),
      )
      .toEqual(["rgb(0, 0, 0)"]);
    const printLayout = await summary.evaluate((root) => {
      const ancestors = [];
      for (let parent = root.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        ancestors.push({ overflow: style.overflowY, height: style.maxHeight });
      }
      return {
        colors: [...root.querySelectorAll<HTMLElement>("h1,h2,h3,p,li")].map((node) => getComputedStyle(node).color),
        overflow: getComputedStyle(root).overflowY,
        position: getComputedStyle(root).position,
        height: root.getBoundingClientRect().height,
        ancestors,
      };
    });
    expect(printLayout.colors.length).toBeGreaterThan(47);
    expect([...new Set(printLayout.colors)]).toEqual(["rgb(0, 0, 0)"]);
    expect(printLayout.overflow).toBe("visible");
    expect(printLayout.position).toBe("static");
    expect(printLayout.height).toBeGreaterThan(844);
    expect(printLayout.ancestors.every((item) => item.overflow === "visible" && item.height === "none")).toBe(true);
  });

  test("downloads the selected demo year as private CSV and never substitutes another year", async ({ page }) => {
    await page.goto("/cme/summary?year=2026");
    const link = page.getByTestId("cme-annual-summary").getByRole("link", { name: "Download CSV" });
    await expect(link).toHaveAttribute("href", "/api/cme/export?year=2026");
    // A download is not a page response in every engine: WebKit never reported one here, so
    // waiting for it timed out the whole test on both Safari projects. Take the file from the
    // download event and the privacy headers from a direct request for the same URL.
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe("cme-2026-demo.csv");
    const exported = await page.request.get("/api/cme/export?year=2026");
    expect(exported.status()).toBe(200);
    expect(exported.headers()["cache-control"]).toContain("no-store");
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv).toContain("Formal peer review hours (subset of reviewing)");
    expect(csv).toContain("Source URL (not evidence)");
    expect(csv).toContain('"2026-');
    expect(csv).not.toContain('"2025-');
    const unavailable = await page.request.get("/api/cme/export?year=2025");
    expect(unavailable.status()).toBe(404);
    await page.goto("/cme/summary?year=2025");
    await expect(page.getByTestId("cme-annual-summary")).toHaveCount(0);
  });

  test("opens the current year's summary when no year is given", async ({ page }) => {
    await page.goto("/cme/summary");
    const summary = page.getByTestId("cme-annual-summary");
    await expect(summary.getByRole("heading", { level: 1 })).toContainText("2026");
    await expect(page.getByText("Choose a valid year from your CPD log.")).toHaveCount(0);
  });

  test("teaching handoff prefills only title and source until duration and categories are confirmed", async ({
    page,
  }) => {
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/cme/entries")) writes.push(request.url());
    });
    const query = new URLSearchParams({
      title: "Synthetic teaching review",
      sourceUrl: "https://example.org/synthetic-teaching",
    });
    await page.goto(`/cme/new?${query.toString()}`);
    await expect(page.getByLabel("What was it", { exact: false })).toHaveValue("Synthetic teaching review");
    await expect(page.getByLabel("Learning source URL", { exact: false })).toHaveValue(
      "https://example.org/synthetic-teaching",
    );
    await expect(page.getByText("Opening this form does not record an activity.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save entry", exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(writes).toEqual([]);
    await page.getByRole("group", { name: "Hours" }).getByRole("button", { name: "1", exact: true }).click();
    await page.getByRole("button", { name: "Educational", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save entry", exact: true })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(writes).toEqual([]);
  });
});

test.describe("CME phone design", () => {
  test("opening a Today figure explains its source without shifting the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cme");
    const main = page.locator("#main-content");
    await expect(main).toBeVisible();
    const before = await main.boundingBox();
    await page.getByTestId("cme-hero-summary").getByRole("button").click();
    const sheet = page.getByTestId("cme-today-detail-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("cme-today-detail-total")).toContainText("saved activities");
    await expect(sheet.getByText(/This app does not independently certify it/)).toBeVisible();
    const after = await main.boundingBox();
    expect(after?.x).toBe(before?.x);
    expect(after?.width).toBe(before?.width);
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
  });

  test("the Log button opens a quick panel over the dashboard without recording anything", async ({ page }) => {
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/cme/entries")) writes.push(request.url());
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cme");
    await expect(page.getByTestId("cme-hero-summary").filter({ visible: true })).toBeVisible();
    const logButton = await expectSingleSettledOwner(page.getByTestId("cme-quick-log-button"));
    await logButton.click();
    const sheet = page.getByTestId("cme-quick-log-sheet");
    await expect(sheet.getByLabel("What was it", { exact: false })).toBeVisible();
    await sheet.getByLabel("What was it", { exact: false }).fill("Synthetic grand round");
    await sheet.getByRole("group", { name: "Hours" }).getByRole("button", { name: "1", exact: true }).click();
    await sheet.getByRole("button", { name: "Educational", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Save entry", exact: true })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(writes).toEqual([]);
  });

  test("the new-entry Save stays on screen while the form scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cme/new");
    const bar = page.getByTestId("cme-entry-save-bar");
    await expect(bar).toBeInViewport();
    await page.getByLabel("What was it", { exact: false }).focus();
    await expect(bar).toBeInViewport();
  });

  test("the year check lists every target with a status in words, and links back to the log", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cme");
    await page.getByTestId("cme-year-check-link").filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/cme\/check\?year=2026/);
    const check = page.getByTestId("cme-year-check");
    await expect(check.getByRole("heading", { level: 1 })).toHaveText(/\d+ of \d+ done/);
    await expect(check.getByTestId("cme-check-row-total")).toBeVisible();
    await expect(check.getByTestId("cme-check-row-evidence")).toContainText("Not checked");
    await expect(check.getByTestId("cme-check-row-copied")).toBeVisible();
  });

  test("the calendar opens on the current month and changes month with the arrows", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/cme/calendar");
    const calendar = page.getByTestId("cme-calendar-view");
    await expect(calendar.getByRole("heading", { level: 2 })).toHaveText("September 2026");
    await expect(calendar.getByRole("list", { name: "What the marks mean" })).toBeVisible();
    await calendar.getByRole("button", { name: "Next month" }).click();
    await expect(calendar.getByRole("heading", { level: 2 })).toHaveText("October 2026");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });
});
