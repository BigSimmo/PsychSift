import { expect, test, type Page } from "playwright/test";
import { clickWhenHydrated } from "./playwright-settlement";

const serviceId = "5e000000-0000-4000-8000-000000000001";
const openShiftId = "5e000000-0000-4000-8000-000000000002";
const actorId = "5e000000-0000-4000-8000-000000000003";

async function stubOpenShift(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-05T00:00:00.000Z"));
  const startsAt = "2026-10-12T09:00:00.000Z";
  const endsAt = "2026-10-12T17:00:00.000Z";
  const openShift = {
    id: openShiftId,
    status: "open",
    urgent: false,
    startsAt,
    endsAt,
    shiftCode: "D",
    kind: "day",
    minGrade: "registrar",
    siteId: null,
    mine: false,
    // The request is deliberately absent on the read after the stale withdrawal.
    claimedByMe: false,
  };

  await page.route("**/api/roster/team", async (route) =>
    route.fulfill({
      json: {
        actorId,
        teams: [{ serviceId, name: "Example team", enabled: true, role: "member", grade: "registrar" }],
      },
    }),
  );
  await page.route(`**/api/roster/team/${serviceId}**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      const action = request.postDataJSON() as { action?: string };
      if (action.action === "open.claim") {
        return route.fulfill({ json: { result: { ok: true, openShiftId, status: "claimed" } } });
      }
      if (action.action === "open.withdraw") {
        return route.fulfill({
          status: 404,
          json: { code: "roster_not_found", message: "Not found." },
        });
      }
    }
    if (url.searchParams.get("what") === "overview") {
      return route.fulfill({
        json: {
          service: { id: serviceId, name: "Example team" },
          me: { role: "member", grade: "registrar", rotationEndsOn: null },
          latestPublication: null,
          seenLatest: true,
          settings: { swapApproval: "manager", rules: {}, rulesSource: null, payFortnightAnchor: null },
          sites: [],
          managers: [],
        },
      });
    }
    if (url.searchParams.get("what") === "requests") {
      return route.fulfill({ json: { swaps: [], openShifts: [openShift] } });
    }
    return route.fulfill({ json: { assignments: [] } });
  });
  await page.route("**/api/roster/shifts**", (route) => route.fulfill({ json: { shifts: [], sample: false } }));
}

test("a stale take-back reports the decision and refreshes the real advert", async ({ page }) => {
  await stubOpenShift(page);
  await page.goto(`/open-shifts/shift/${serviceId}/${openShiftId}`);

  await clickWhenHydrated(page.getByRole("button", { name: "Request this shift", exact: true }));
  await clickWhenHydrated(page.getByRole("checkbox"));
  await clickWhenHydrated(page.getByRole("button", { name: "Yes, send request", exact: true }));
  await expect(page.getByText("Waiting for approval")).toBeVisible();

  await clickWhenHydrated(page.getByRole("button", { name: "Take back my request", exact: true }));
  await clickWhenHydrated(page.getByRole("button", { name: "Yes, take it back", exact: true }));

  await expect(page.getByRole("alert")).toHaveText("This request can't be found any more. Check My shifts.");
  await expect(page.getByText("Waiting for approval")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Take back my request", exact: true })).toHaveCount(0);
});
