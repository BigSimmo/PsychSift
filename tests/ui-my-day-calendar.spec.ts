import { expect, test, type Locator, type Page } from "playwright/test";

import { clickWhenHydrated, visibleByTestId } from "./playwright-settlement";

/*
 * My Day Calendar, clicked through the way a doctor uses it: months back and
 * forward, list and month views, a chosen day, the area filter and the "Add to
 * your calendar" sheet. Your own shifts are stubbed (both the main list and the
 * dated read an older month makes), so an older month proves its shifts show.
 * The other sources are the demo data the server serves with no Supabase env.
 * Every shift here is invented.
 */

// Saturday 10 October 2026, 10:00 in Perth.
const NOW = new Date("2026-10-10T02:00:00Z");

const recent = {
  id: "calendar-spec-recent",
  startsAt: "2026-10-10T00:00:00Z",
  endsAt: "2026-10-10T08:30:00Z",
  title: "Day shift",
  location: null,
  sourceUid: null,
  kind: "day",
  source: "manual",
  seriesId: null,
  workplace: "Example Hospital",
};
const older = {
  ...recent,
  id: "calendar-spec-older",
  startsAt: "2026-08-12T00:00:00Z",
  endsAt: "2026-08-12T08:30:00Z",
};

async function stubShifts(page: Page): Promise<string[]> {
  const datedReads: string[] = [];
  await page.route("**/api/roster/shifts**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.pathname !== "/api/roster/shifts") return route.fallback();
    if (url.searchParams.has("from")) {
      datedReads.push(url.search);
      return route.fulfill({ json: { shifts: [older] } });
    }
    return route.fulfill({ json: { shifts: [recent], latestImport: null } });
  });
  return datedReads;
}

/** The calendar once its first read has settled and the month summary is no longer "Updating…". */
async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/my-day/calendar");
  const calendar = visibleByTestId(page, "my-day-calendar-ready");
  await expect(calendar).toBeVisible({ timeout: 30_000 });
  await expectSettled(calendar);
  return calendar;
}

async function expectSettled(calendar: Locator) {
  await expect(calendar).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  await expect(calendar.getByTestId("my-day-calendar-summary")).not.toHaveText("Updating…");
}

async function expectMonth(calendar: Locator, title: string) {
  await expect(calendar.getByRole("heading", { level: 2, name: title })).toBeVisible();
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label} scrolls sideways`).toBeLessThanOrEqual(clientWidth + 1);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test("moves between months, shows your older shifts, and returns to today", async ({ page }) => {
  const datedReads = await stubShifts(page);
  const calendar = await openCalendar(page);
  await expectMonth(calendar, "October 2026");

  const today = calendar.getByTestId("my-day-calendar-day-2026-10-10");
  await expect(today).toHaveAttribute("aria-current", "date");
  await expect(today).toHaveAttribute("aria-pressed", "true");
  await expect(calendar.getByTestId(`my-day-calendar-item-shift:${recent.id}`)).toBeVisible();
  // This month is within the main list, so no dated read was needed.
  expect(datedReads).toEqual([]);

  await clickWhenHydrated(calendar.getByRole("button", { name: "Next month" }));
  await expectMonth(calendar, "November 2026");
  await expectSettled(calendar);
  await expect(calendar.getByTestId("my-day-calendar-day-2026-11-01")).toHaveAttribute("aria-pressed", "true");

  await calendar.getByRole("button", { name: "Previous month" }).click();
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await expectMonth(calendar, "August 2026");
  await expectSettled(calendar);
  await expect(page.getByTestId("my-day-calendar-history-notice")).toHaveCount(0);
  expect(datedReads.some((query) => query.includes("from=2026-07-31"))).toBe(true);

  await calendar.getByTestId("my-day-calendar-day-2026-08-12").click();
  await expect(calendar.getByTestId("my-day-calendar-day-2026-08-12")).toHaveAttribute("aria-pressed", "true");
  const day = calendar.getByTestId("my-day-calendar-day");
  await expect(day.getByTestId(`my-day-calendar-item-shift:${older.id}`)).toBeVisible();

  await calendar.getByTestId("my-day-calendar-today").click();
  await expectMonth(calendar, "October 2026");
  await expect(calendar.getByTestId("my-day-calendar-today")).toHaveCount(0);
  await expect(today).toHaveAttribute("aria-pressed", "true");
});

test("switches to the list and back, filters an area, and opens Add to your calendar", async ({ page }) => {
  await stubShifts(page);
  const calendar = await openCalendar(page);
  const shift = calendar.getByTestId(`my-day-calendar-item-shift:${recent.id}`);

  const views = calendar.getByTestId("my-day-calendar-view");
  await clickWhenHydrated(views.getByRole("button", { name: "List" }));
  await expect(views.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await expect(calendar.getByTestId("my-day-calendar-grid")).toHaveCount(0);
  await expect(calendar.getByTestId("my-day-calendar-list")).toBeVisible();
  await expect(calendar.getByTestId(`my-day-calendar-list-item-shift:${recent.id}`)).toBeVisible();
  await views.getByRole("button", { name: "Month" }).click();
  await expect(calendar.getByTestId("my-day-calendar-grid")).toBeVisible();

  const roster = calendar.getByTestId("my-day-calendar-filter").getByRole("button", { name: "Roster", exact: true });
  await roster.click();
  await expect(roster).toHaveAttribute("aria-pressed", "false");
  await expect(shift).toHaveCount(0);
  await roster.click();
  await expect(roster).toHaveAttribute("aria-pressed", "true");
  await expect(shift).toBeVisible();

  // The add button sits beside the item's link, in the same row. `has` is matched inside each row,
  // so it takes a page-rooted locator rather than one that starts from the calendar.
  const row = calendar.locator("li", { has: page.getByTestId(`my-day-calendar-item-shift:${recent.id}`) });
  const add = row.getByRole("button", { name: /^Add .+ to your calendar$/ });
  await add.click();
  const sheet = visibleByTestId(page, "my-day-calendar-add-sheet");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(add).toBeFocused();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("fits the width in both views, with area chips big enough to tap", async ({ page }) => {
    await stubShifts(page);
    const calendar = await openCalendar(page);
    await expectNoSidewaysScroll(page, "Calendar month");

    for (const chip of await calendar.getByTestId("my-day-calendar-filter").getByRole("button").all()) {
      const box = await chip.boundingBox();
      expect(box?.height ?? 0, `${await chip.textContent()} chip height`).toBeGreaterThanOrEqual(44);
    }

    await clickWhenHydrated(calendar.getByTestId("my-day-calendar-view").getByRole("button", { name: "List" }));
    await expect(calendar.getByTestId("my-day-calendar-list")).toBeVisible();
    await expectNoSidewaysScroll(page, "Calendar list");

    await calendar.getByRole("button", { name: "Previous month" }).click();
    await calendar.getByRole("button", { name: "Previous month" }).click();
    await expectMonth(calendar, "August 2026");
    await expectSettled(calendar);
    await expectNoSidewaysScroll(page, "An older month's list");
  });
});
