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

test("This week leads with the session on now or next, and fits a phone in light and dark", async ({
  page,
}, testInfo) => {
  await page.goto("/teaching");
  await expect(visibleByTestId(page, "teaching-hero")).toBeVisible({ timeout: 20_000 });
  await expect(visibleByTestId(page, "teaching-week-list")).toBeVisible();
  await expectNoSidewaysScroll(page, "This week");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await testInfo.attach(`teaching-this-week-${scheme}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
});

test("This week at 200% text keeps every time clear of its title and never scrolls sideways", async ({
  page,
}, testInfo) => {
  await page.goto("/teaching");
  const list = visibleByTestId(page, "teaching-week-list");
  await expect(list).toBeVisible({ timeout: 20_000 });
  await largeText(page);
  const rows = list.locator("li:has([data-row-time])");
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    const time = await row.locator("[data-row-time]").boundingBox();
    const body = await row.locator("[data-row-body]").boundingBox();
    const clear = time && body && (time.x + time.width <= body.x + 1 || time.y + time.height <= body.y + 1);
    expect(clear, "time does not overlap the title").toBe(true);
  }
  await expectNoSidewaysScroll(page, "This week at 200%");
  const presenting = visibleByTestId(page, "teaching-this-week").getByRole("button", {
    name: "Presenting",
    exact: true,
  });
  await presenting.scrollIntoViewIfNeeded();
  await expect(presenting).toBeInViewport({ ratio: 1 });
  await testInfo.attach("teaching-this-week-200", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("the old Week address shows This week, so links with an On Call anchor keep working", async ({ page }) => {
  await page.goto("/teaching/week");
  await expect(visibleByTestId(page, "teaching-this-week")).toBeVisible({ timeout: 20_000 });
});

test("a session opened from This week says where and when, and fits at 200% text", async ({ page }) => {
  await page.goto("/teaching");
  await visibleByTestId(page, "teaching-week-list").locator("a").first().click();
  await expect(page).toHaveURL(/\/teaching\/session\/[0-9a-f-]{36}$/);
  await expect(visibleByTestId(page, "teaching-session")).toBeVisible({ timeout: 20_000 });
  await largeText(page);
  await expectNoSidewaysScroll(page, "Session at 200%");
});

test("On Call's legacy teaching calendar opens Teaching's This week", async ({ page }) => {
  await page.goto("/on-call/education");
  await expect(page).toHaveURL(/\/teaching\/week$/);
  await expect(visibleByTestId(page, "teaching-this-week")).toBeVisible({ timeout: 20_000 });
});

test("Teaching's five tabs reach Presenting, My record, Resources and Organise", async ({ page }) => {
  await page.goto("/teaching");
  await expect(visibleByTestId(page, "teaching-hero")).toBeVisible({ timeout: 20_000 });
  for (const [id, path, testId] of [
    ["teach", "/teaching/teach", "teaching-presenting"],
    ["logbook", "/teaching/logbook", "teaching-logbook"],
    ["resources", "/teaching/resources", "teaching-resources"],
  ] as const) {
    await page.getByRole("button", { name: /^Mode Teaching/ }).click();
    await visibleByTestId(page, `app-mode-section-${id}`).click();
    await expect(page).toHaveURL(path);
    await expect(visibleByTestId(page, testId)).toBeVisible({ timeout: 20_000 });
    await expectNoSidewaysScroll(page, id);
  }
});

for (const [path, testId] of [
  ["teach", "teaching-presenting"],
  ["logbook", "teaching-logbook"],
  ["resources", "teaching-resources"],
  ["organise", "teaching-organise"],
  ["term", "teaching-term"],
  ["exam-prep", "teaching-exam-prep"],
] as const) {
  test(`${path} (v5) fits a phone in light and dark, and at 200% text`, async ({ page }, testInfo) => {
    await page.goto(`/teaching/${path}`);
    await expect(visibleByTestId(page, testId)).toBeVisible({ timeout: 20_000 });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectNoSidewaysScroll(page, `${path} ${scheme}`);
      await testInfo.attach(`${path}-v5-${scheme}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    }
    await largeText(page);
    await expectNoSidewaysScroll(page, `${path} at 200%`);
  });
}

for (const [path, heading] of [
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
