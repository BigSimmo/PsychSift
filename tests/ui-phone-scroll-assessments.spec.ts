import { writeFile } from "node:fs/promises";
import { expect, test } from "playwright/test";
import {
  blockExternalRequests,
  dragScrollBy,
  forceCompiledStandalonePhoneCss,
  gotoPhoneSurface,
  phoneViewport,
  readGeometry,
} from "./helpers/phone-scroll";

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
  await page.setViewportSize(phoneViewport);
});

for (const standalone of [false, true]) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`assessment scrolling stays stable in ${standalone ? "installed layout" : "browser"}, ${reducedMotion}`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ reducedMotion });
      await gotoPhoneSurface(page, "/teaching/assessments");
      await expect(page.getByTestId("assess-doctor-hero")).toBeVisible();
      if (standalone) expect(await forceCompiledStandalonePhoneCss(page)).toBeGreaterThan(0);
      await expect.poll(async () => (await readGeometry(page)).scrollOwner).toBe(standalone ? "main" : "document");
      const band = page.getByTestId("mode-band");
      const collapse = page.getByTestId("universal-header-collapse");

      // Small steps exercise threshold crossings; large steps exercise flicks.
      // Compare the settled offset with delivered travel to catch geometry
      // feedback that moves the page after the gesture has stopped.
      for (const delta of [180, 90, -80, 130, -60, 45, -35, 90]) {
        const before = await readGeometry(page);
        const travelled = await dragScrollBy(page, delta, Math.abs(delta) > 100 ? 18 : Math.abs(delta));
        await page.waitForTimeout(350);
        const after = await readGeometry(page);
        expect(
          Math.abs(after.scrollTop - before.scrollTop - travelled),
          "no post-gesture scroll jump",
        ).toBeLessThanOrEqual(2);
        expect(after.horizontalOverflow).toBeLessThanOrEqual(1);
        const hidden = (await collapse.getAttribute("data-scroll-hidden")) === "true";
        expect((await band.getAttribute("data-bar-hidden")) !== null).toBe(hidden);
        if (hidden && (await band.getAttribute("data-stuck")) !== null) {
          const bottom = await band.locator("nav").evaluate((nav) => nav.getBoundingClientRect().bottom);
          expect(bottom, "hidden tabs leave no strip over the content").toBeLessThanOrEqual(1);
        }
      }

      await dragScrollBy(page, 5000, 500);
      const bottom = await readGeometry(page);
      await page.waitForTimeout(350);
      expect(Math.abs((await readGeometry(page)).scrollTop - bottom.scrollTop)).toBeLessThanOrEqual(2);
      await expect(page.locator("#assess-made-up-date")).toBeInViewport();
      const screenshot = testInfo.outputPath("assessment-scroll.png");
      await page.screenshot({ path: screenshot });
      await testInfo.attach(`assessments-${standalone ? "installed" : "browser"}-${reducedMotion}`, {
        path: screenshot,
        contentType: "image/png",
      });

      // Bring a hidden tab back by keyboard focus, then change pages from a
      // scrolled state. Focused navigation must remain clickable.
      const progress = band.getByRole("link", { name: "Progress", exact: true });
      await progress.focus();
      await expect(progress).toBeInViewport({ ratio: 1 });
      await progress.press("Enter");
      await expect(page).toHaveURL(/view=progress/);
      await expect(page.locator("[data-screen-heading]").first()).toBeFocused();
      await page.goto("/teaching/assessments");
      await expect(page.getByTestId("assess-doctor-hero")).toBeVisible();
      await page.getByRole("button", { name: /^Request an EPA From/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page.getByText("I supervise", { exact: true }).click();
      await expect(page).toHaveURL(/as=supervisor/);
      expect((await readGeometry(page)).horizontalOverflow).toBeLessThanOrEqual(1);
    });
  }
}

test("assessment controls fit all required widths, enlarged text and forced colours", async ({ page }) => {
  await gotoPhoneSurface(page, "/teaching/assessments");
  await expect(page.getByTestId("assess-doctor-hero")).toBeVisible();
  for (const width of [320, 390, 639, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(async () => (await readGeometry(page)).horizontalOverflow).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize(phoneViewport);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect.poll(async () => (await readGeometry(page)).horizontalOverflow).toBeLessThanOrEqual(1);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const action = page.getByRole("link", { name: "Start end-of-term", exact: true });
  await action.focus();
  await expect(action).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 600, height: 390 });
  await expect.poll(async () => (await readGeometry(page)).horizontalOverflow).toBeLessThanOrEqual(1);
  await page.setViewportSize(phoneViewport);
  await action.focus();
  await expect(action).toBeInViewport({ ratio: 1 });
});

test("installed assessment focus clears the bottom action dock", async ({ page }) => {
  await gotoPhoneSurface(page, "/teaching/assessments");
  await expect(page.getByTestId("assess-doctor-hero")).toBeVisible();
  expect(await forceCompiledStandalonePhoneCss(page)).toBeGreaterThan(0);
  const clearance = await page.locator("#main-content").evaluate((main) => {
    const css = getComputedStyle(main);
    return { bottom: Number.parseFloat(css.scrollPaddingBottom), top: Number.parseFloat(css.scrollPaddingTop) };
  });
  expect(clearance.bottom).toBeGreaterThanOrEqual(34 + 5.75 * 16);
  expect(clearance.top).toBeGreaterThan(59);
  const help = page.getByRole("link", { name: "Help and words Every abbreviation in plain words", exact: true });
  await help.focus();
  await expect(help).toBeInViewport({ ratio: 1 });
  const bounds = await help.boundingBox();
  const dock = await page.locator(".work-dock").boundingBox();
  expect(bounds).not.toBeNull();
  expect(dock).not.toBeNull();
  expect(bounds!.y + bounds!.height, "focused link stays above the action").toBeLessThanOrEqual(dock!.y + 1);
});

test("assessment direction changes capture a warmed performance trace", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Chrome tracing is developer evidence, not a Safari performance claim");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await gotoPhoneSurface(page, "/teaching/assessments");
  await expect(page.getByTestId("assess-doctor-hero")).toBeVisible();
  await dragScrollBy(page, 180, 18);
  await dragScrollBy(page, -180, 18);
  await page.waitForTimeout(400);
  const session = await page.context().newCDPSession(page);
  const complete = new Promise<{ stream?: string }>((resolve) => session.once("Tracing.tracingComplete", resolve));
  await session.send("Tracing.start", {
    categories: "devtools.timeline,toplevel,disabled-by-default-devtools.timeline",
    transferMode: "ReturnAsStream",
  });
  for (const delta of [180, 90, -90, 120, -80]) await dragScrollBy(page, delta, 18);
  await page.waitForTimeout(400);
  await session.send("Tracing.end");
  const { stream } = await complete;
  if (!stream) throw new Error("The browser did not return the captured scroll trace");
  let data = "";
  for (;;) {
    const chunk = await session.send("IO.read", { handle: stream });
    data += chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString("utf8") : chunk.data;
    if (chunk.eof) break;
  }
  await session.send("IO.close", { handle: stream });
  await session.detach();
  const tracePath = testInfo.outputPath("assessment-scroll-performance-trace.json");
  await writeFile(tracePath, data);
  await testInfo.attach("assessment-scroll-performance-trace", { path: tracePath, contentType: "application/json" });
  const trace = JSON.parse(data) as { traceEvents: { name: string; dur?: number }[] };
  const layouts = trace.traceEvents.filter((event) => event.name === "Layout");
  const tasks = trace.traceEvents.filter((event) => event.name === "RunTask");
  expect(tasks.length, "the trace includes task events, so absent long tasks are observable").toBeGreaterThan(0);
  const summary = {
    layoutCount: layouts.length,
    maxLayoutMs: Math.max(0, ...layouts.map((event) => (event.dur ?? 0) / 1000)),
    taskCount: tasks.length,
    longTaskMs: tasks.filter((event) => (event.dur ?? 0) >= 50_000).map((event) => event.dur! / 1000),
    note: "Local production Chromium trace; whole-page measurements, not physical iPhone evidence",
  };
  const summaryPath = testInfo.outputPath("assessment-scroll-performance-summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  await testInfo.attach("assessment-scroll-performance-summary", {
    path: summaryPath,
    contentType: "application/json",
  });
});
