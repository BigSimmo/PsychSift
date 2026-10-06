import { expect, test, type Page, type TestInfo } from "playwright/test";

const documentPath =
  "/documents/11111111-1111-4111-8111-111111111111?page=1&chunk=44444444-4444-4444-8444-444444444442";

function isScreenshotCaptureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Unable to capture screenshot|captureScreenshot/i.test(message);
}

async function captureViewportPng(page: Page): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await page.screenshot({
        fullPage: false,
        animations: "disabled",
        caret: "hide",
        timeout: 10_000,
      });
    } catch (error) {
      if (!isScreenshotCaptureError(error)) throw error;
      lastError = error;
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to capture screenshot");
}

async function attachViewportScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  viewport: { width: number; height: number },
  path: string,
) {
  await page.setViewportSize(viewport);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // `:visible` rather than `.first()`: ledger #093, a hidden streaming twin can
  // sit in front of the live page root and make Chromium's captureScreenshot fail.
  const main = page.locator("#main-content:visible").first();
  await expect(main).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("body")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  await testInfo.attach(name, {
    body: await captureViewportPng(page),
    contentType: "image/png",
  });
}

test.describe("PsychSift visual QA artifacts", () => {
  test.beforeEach(async ({ page }) => {
    // The first-visit "Search my work" note sits over the header on staff modes
    // and has made Chromium refuse `Page.captureScreenshot` under CI load
    // (Production UI shard 1 on PR #3332). Mark it seen before any navigation.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("psychsift:work-search-coach-seen", "1");
      } catch {
        // Storage blocked: the note may still appear.
      }
    });
  });

  test("captures dashboard and document viewer screenshots", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await attachViewportScreenshot(page, testInfo, "dashboard-mobile", { width: 390, height: 820 }, "/");
    await attachViewportScreenshot(page, testInfo, "dashboard-desktop", { width: 1280, height: 900 }, "/");
    await attachViewportScreenshot(page, testInfo, "document-mobile", { width: 390, height: 820 }, documentPath);
    await attachViewportScreenshot(page, testInfo, "document-desktop", { width: 1280, height: 900 }, documentPath);
  });

  /**
   * The human-review channel while the CME screens are still moving: nothing
   * here fails when a surface changes, it just attaches a screenshot for the
   * owner to look at each round. The clock is frozen for the same reason
   * `tests/ui-cme-phone.spec.ts` freezes it — the dashboard's "days left" and
   * pace projection move every night, and an unfrozen capture would not be
   * the same screen twice in a row.
   */
  test("captures the CME screens", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    // `setFixedTime`, not `install` + `pauseAt`: pausing the clock also
    // freezes `requestAnimationFrame`, which stalls React 19's rAF-deferred
    // Suspense cleanup and strands a hidden duplicate copy of the page in
    // the DOM. `setFixedTime` still pins `new Date()` for these screenshots
    // without that side effect.
    await page.clock.setFixedTime(new Date("2026-09-19T02:00:00Z"));
    // Same four surfaces as `CME_BASELINE_ROUTES` in ui-cme-phone.spec.ts.
    // Programme is only a redirect to Set up, so capture Set up itself.
    for (const [name, path] of [
      ["cme-dashboard-mobile", "/cme"],
      ["cme-log-mobile", "/cme/log"],
      ["cme-new-entry-mobile", "/cme/new"],
      ["cme-setup-mobile", "/cme/setup"],
    ] as const) {
      await attachViewportScreenshot(page, testInfo, name, { width: 390, height: 820 }, path);
    }
  });

  /**
   * The My Day dashboard (design review v13): a look check for the owner, not
   * a pixel gate. Each page at phone width, light and dark, attached for a
   * person to compare with the mock-up; nothing here fails when a card moves.
   * The clock is fixed for the same reason as the CME capture above, and the
   * local demo build supplies the data, so no provider is touched.
   */
  test("captures My Day", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.clock.setFixedTime(new Date("2026-10-03T04:40:00Z"));
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const tab of ["today", "work", "me"] as const) {
        await attachViewportScreenshot(
          page,
          testInfo,
          `my-day-${tab}-${scheme}-mobile`,
          { width: 390, height: 844 },
          tab === "today" ? "/my-day" : `/my-day?page=${tab}`,
        );
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await attachViewportScreenshot(page, testInfo, "my-day-today-desktop", { width: 1366, height: 900 }, "/my-day");
  });
});
