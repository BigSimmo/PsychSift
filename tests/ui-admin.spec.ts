import { expect, test, type Page } from "playwright/test";

import { visibleByTestId } from "./playwright-settlement";

/**
 * Admin's own short browser journey (Task 10, integration): the two retired
 * paths, the pill's identity, Help's phone layout, and the one-composer
 * contract every Admin page keeps. Amended for the work-mode redesign (owner
 * request 6 Oct 2026): `/my-work` lands on Today, Admin is slate, and the rail
 * is the shared chip row.
 *
 * Case 2 checks the Checklist tab's real grouped headings rather than the
 * "Blocking / Partial / Chased / Unrecorded" bands task-10-brief.md names.
 * Those bands belonged to the original compliance-section design; Josh's
 * 18:48Z approval (see `.superpowers/sdd/plan-update-1/lane-rules.md`'s
 * "Efficiency" note and lane-b-ui-report.md) rebuilt Renewals as the
 * final-design Requirements checklist before this spec was written, and that
 * page groups its rows by the catalogue's own groups (Registration, Checks,
 * Health, Training, Job — the 5 Oct mock-up v2), never by the old band words —
 * nothing in the shipped app renders them (`git grep` confirms). This spec
 * asserts what actually ships.
 */

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

/**
 * Admin's mode identity in light mode. Work-mode redesign, owner request 6 Oct
 * 2026: Admin moved from brown to the slate palette (#44566e), measured in
 * Chromium on /admin/help.
 */
const ADMIN_IDENTITY_LIGHT_RGB = "rgb(68, 86, 110)";

async function gotoPhone(page: Page, path: string) {
  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
  await page.goto(path);
}

test.describe("Admin mode — redirects, pill identity and shared chrome", () => {
  // Work-mode redesign, owner request 6 Oct 2026: Today is Admin's first tab
  // again, so `/my-work` lands on `/admin`. Pill 4b (Josh, 7 Oct 2026): on a
  // work page the pill names the area alone, in its colour, and the band's
  // current tab names the page — so Today is asserted on the tab, not the pill.
  test("/my-work lands on /admin, the pill names Admin, and the Today tab is current", async ({ page }) => {
    await page.goto("/my-work");
    await expect(page).toHaveURL(/\/admin$/);
    const pill = page.getByRole("button", { name: "Mode Admin", exact: true });
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("Admin");
    await expect(
      page.getByRole("navigation", { name: "Admin pages" }).getByRole("link", { name: /^Today\b/ }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("/on-call/compliance lands on /admin/renewals, keeping the checklist's own groups", async ({ page }) => {
    await page.goto("/on-call/compliance");
    await expect(page).toHaveURL(/\/admin\/renewals$/);
    await expect(page.getByRole("heading", { level: 1, name: "Renewals" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Checklist" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Personal" })).toBeVisible();
    // CI runs this in demo mode. The demo corpus links seven rows to catalogue
    // items (`src/lib/on-call/demo-entries.ts`), so the Registration and
    // Checks groups both hold a recorded row.
    // `tests/admin-requirements.test.ts` pins that corpus property offline.
    await expect(page.getByRole("heading", { name: /^Registration · \d+$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Checks · \d+$/ })).toBeVisible();
    await expect(visibleByTestId(page, "admin-renewals-checklist-row-medical-registration-renewal")).toBeVisible();
  });

  // Work-mode redesign, owner request 6 Oct 2026: the underlined rail became the
  // shared chip row, and the active chip carries the identity colour itself.
  test("at 390px, Help puts its crisis lines ahead of every content section, and the active chip wears Admin's identity colour with no identity-filled button anywhere", async ({
    page,
  }) => {
    await gotoPhone(page, "/admin/help");

    const crisis = visibleByTestId(page, "admin-help-crisis");
    await expect(crisis).toBeVisible();

    const rail = visibleByTestId(page, "admin-section-header-section-rail");
    await expect(rail).toBeVisible();

    // Crisis lines are the page's first real content, above every one of the
    // four content sections.
    const crisisTop = (await crisis.boundingBox())?.y ?? Number.POSITIVE_INFINITY;
    for (const label of ["Support", "Guides", "Contacts", "On site"]) {
      const section = page.locator(`section[aria-label="${label}"]`);
      const sectionTop = (await section.boundingBox())?.y ?? Number.NEGATIVE_INFINITY;
      expect(sectionTop, `${label}'s section should sit below the crisis lines`).toBeGreaterThan(crisisTop);
    }

    // Whichever chip settled active, it resolves to Admin's identity colour,
    // not the product accent.
    await expect.poll(async () => rail.locator('button[aria-current="true"]').count()).toBeGreaterThan(0);
    const activeChip = rail.locator('button[aria-current="true"]').first();
    await expect(activeChip).toHaveCSS("color", ADMIN_IDENTITY_LIGHT_RGB);

    // The identity colour is identity only (standard §3): never a button's fill.
    const buttonBackgrounds = await page
      .locator("button")
      .evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).backgroundColor));
    expect(buttonBackgrounds).not.toContain(ADMIN_IDENTITY_LIGHT_RGB);
  });

  test("at 390px, no Admin page renders the shared search composer or a microphone, and demo Renewals cannot add", async ({
    page,
  }) => {
    for (const path of ["/admin", "/admin/renewals", "/admin/new-job", "/admin/help"]) {
      await gotoPhone(page, path);
      // The mode declares no results surface (`resultsSurface: "none"`), so no
      // Admin page may grow the shared composer — the same one-composer
      // contract `tests/ui-on-call-boards.spec.ts` holds On Call to.
      await expect(page.locator('[data-testid="global-search-composer"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: /microphone/i })).toHaveCount(0);
    }

    await gotoPhone(page, "/admin/renewals");
    // Production browser CI serves synthetic demo rows and refuses writes.
    await expect(page.getByTestId("admin-renewals-add")).toHaveCount(0);
    await page.getByRole("radio", { name: "Personal" }).click();
    await expect(page.getByTestId("admin-renewals-personal-empty-add")).toHaveCount(0);
  });
});
