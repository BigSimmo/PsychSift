import { expect, test, type Page } from "playwright/test";

import { visibleByTestId } from "./playwright-settlement";

/*
 * Teaching on a 390px phone, in the demo programme the dev server serves with
 * no Supabase env. Review focus 1: at 200% text nothing scrolls sideways, every
 * session's time sits above its title, and the switch scrolls rather than
 * cutting a label. The light and dark screenshots go into the report for the
 * PR, not into a baseline.
 */
test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  // Week hides past days. Pin a Wednesday in Perth so the demo has upcoming
  // sessions even when CI runs at the weekend; keep timers and animation live.
  await page.clock.setFixedTime(new Date("2026-10-07T02:00:00Z"));
});

async function largeText(page: Page) {
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label} scrolls sideways`).toBeLessThanOrEqual(clientWidth + 1);
}

test("Today leads with the next session and links to the week", async ({ page }, testInfo) => {
  await page.goto("/teaching");
  await expect(visibleByTestId(page, "teaching-hero")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /Rest of this week/ })).toHaveAttribute("href", "/teaching/week");
  await expectNoSidewaysScroll(page, "Today");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await testInfo.attach(`teaching-today-${scheme}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
});

test("Week at 200% text puts every time above its title and never scrolls sideways", async ({ page }, testInfo) => {
  await page.goto("/teaching/week");
  const list = visibleByTestId(page, "teaching-week-list");
  await expect(list).toBeVisible({ timeout: 20_000 });
  await largeText(page);
  const rows = list.locator("li");
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    const time = await row.locator("[data-row-time]").boundingBox();
    const body = await row.locator("[data-row-body]").boundingBox();
    expect(time && body && time.y + time.height <= body.y + 1, "time sits above the title").toBe(true);
  }
  await expectNoSidewaysScroll(page, "Week at 200%");
  const presenting = page.getByRole("radio", { name: "Presenting" });
  await presenting.scrollIntoViewIfNeeded();
  await expect(presenting).toBeInViewport({ ratio: 1 });
  await testInfo.attach("teaching-week-200", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("a session opened from Week says where and when, and fits at 200% text", async ({ page }) => {
  await page.goto("/teaching/week");
  await visibleByTestId(page, "teaching-week-list").locator("a").first().click();
  await expect(page).toHaveURL(/\/teaching\/session\/[0-9a-f-]{36}$/);
  await expect(visibleByTestId(page, "teaching-session")).toBeVisible({ timeout: 20_000 });
  await largeText(page);
  await expectNoSidewaysScroll(page, "Session at 200%");
});

test("On Call's legacy teaching calendar redirects to Teaching Week", async ({ page }) => {
  await page.goto("/on-call/education");
  await expect(page).toHaveURL(/\/teaching\/week$/);
});

test("Teaching page menu reaches Resources and What's on", async ({ page }) => {
  await page.goto("/teaching");
  await expect(visibleByTestId(page, "teaching-hero")).toBeVisible();
  for (const [id, path] of [
    ["resources", "/teaching/resources"],
    ["whats-on", "/teaching/whats-on"],
  ] as const) {
    await page.getByRole("button", { name: /^Mode Teaching/ }).click();
    await visibleByTestId(page, `app-mode-section-${id}`).click();
    await expect(page).toHaveURL(path);
    await expect(visibleByTestId(page, `teaching-${id}`)).toBeVisible();
    await expectNoSidewaysScroll(page, id);
  }
});

for (const [path, heading] of [
  ["teach", "Teach"],
  ["supervision", "Supervision"],
  ["feedback", "Feedback"],
  ["review", "Weekly CPD review"],
  ["import", "Import a timetable"],
] as const) {
  test(`${heading} fits a phone in light and dark appearance`, async ({ page }, testInfo) => {
    await page.goto(`/teaching/${path}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectNoSidewaysScroll(page, `${heading} ${scheme}`);
      await testInfo.attach(`${path}-${scheme}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
    await largeText(page);
    await expectNoSidewaysScroll(page, `${heading} at 200%`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectNoSidewaysScroll(page, `${heading} desktop at 200%`);
  });
}
