import { expect, test, type Locator, type Page } from "playwright/test";

import { ON_CALL_IN_HOURS_END_HOUR, isOnCallOutOfHours } from "@/lib/on-call/home-modules";
import { visibleByTestId } from "./playwright-settlement";

/**
 * The eleven artboards, checked against the screen the app actually renders.
 *
 * `tests/on-call-mockup-conformance.test.ts` holds the written record of which
 * drawn element is built, deliberately different, or waiting on the database —
 * but it can only prove that a testid EXISTS IN SOURCE. That is a real ceiling,
 * and it was named in review: a `built` claim could cite a testid that lives
 * only in dead code, or in a branch that never renders, and the offline gate
 * would pass. This spec is the other half. Every element the ledger calls
 * `built` is asserted here, in a browser, on the page a reader would open.
 *
 * The width is 390px because that is the width every board was drawn at. The
 * other widths are the SITE's, not the drawing's — 320px is this repository's
 * blocking narrow breakpoint, and the tablet and desktop points are where the
 * shared chrome changes owner. A hub that matches the drawing at 390px and
 * breaks at 320px has not matched anything worth having.
 *
 * The assertions deliberately go beyond the drawing where the site's own system
 * is stricter than it: measured 48px tap targets rather than the drawing's
 * smaller pills, no horizontal overflow at any width, and the mode's own
 * contract that no search composer appears on any of these routes. Those are
 * the places the built screen should be BETTER than the mockup, and the only
 * way to keep it that way is to assert it.
 *
 * Data comes from the demo corpus (`src/lib/on-call/demo-entries.ts`), which
 * exists so that every drawn module has something to draw. A module with no
 * data renders nothing, and an assertion against an empty page proves nothing.
 *
 * One block at the end covers a page the drawing does not contain. Compliance
 * was cut out of Admin after the boards were drawn, and a page with no
 * artboard is exactly the page that would otherwise have no browser proof at
 * all — the ledger's gate only asks for a block per drawn board.
 */

/** The width every artboard was drawn at. */
const BOARD_WIDTH = 390;
const BOARD_HEIGHT = 844;

/** The site's own widths, which the drawing says nothing about. */
const NARROW = 320;
const TABLET = 768;
const DESKTOP = 1280;

/** This repository's production tap floor, in CSS pixels. */
const TAP_FLOOR = 48;

// Now carries no search (ruling F6): the one search box lives on Call.
test("Call search narrows to the exact contact on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: NARROW, height: BOARD_HEIGHT });
  await page.goto("/on-call/call");
  const main = page.getByTestId("on-call-call-main");
  const status = main.getByRole("status").filter({ hasText: /result/ });
  // Text typed before hydration is dropped (mobile WebKit, release matrix 2026-09-25).
  await expect(async () => {
    await main.getByRole("searchbox", { name: "Search Call" }).fill("coordination");
    await expect(status).toHaveText("1 result", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(main).toContainText("Example after-hours coordination extension");
  await expect(main).not.toContainText("Synthetic emergency line");
  expect(await main.evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
});

const ROUTES = {
  home: "/on-call",
  contacts: "/on-call/contacts",
  playbook: "/on-call/playbook",
  referrals: "/on-call/referrals",
  orientation: "/on-call/orientation",
  // On Call's parallel teaching calendar redirects to Teaching Week; Teaching
  // boards live in ui-teaching.spec.ts. Do not keep a ROUTES.teaching entry here
  // — the chrome loop would open a non-On-Call mode under On Call's board suite.
  // On Call's Admin (`logistics`) rows and Compliance moved to the Admin mode on
  // 2026-09-26 (Admin update 1): Admin > Help and Admin > Renewals. The keys keep
  // their old names so every board that opens them still does.
  logistics: "/admin/help",
  // A route of its own over rows that are not a section of their own.
  // Compliance is the `logistics` rows carrying `details.kind: "compliance"`,
  // split out because `section` is a database CHECK constraint and a seventh
  // value costs a migration against the live clinical database. It belongs in
  // this list all the same: the chrome loop at the foot of the file opens
  // every entry here, and a page left out of it is a page nothing checks.
  compliance: "/admin/renewals",
  whoIsWho: "/on-call/who-is-who",
} as const;

/** The list each section route renders once its entries have arrived. */
const SECTION_LIST_TEST_IDS: Record<string, string> = {
  [ROUTES.contacts]: "on-call-contacts-section",
  [ROUTES.playbook]: "on-call-playbook-section",
  [ROUTES.referrals]: "on-call-referrals-section",
  [ROUTES.orientation]: "on-call-orientation-section",
  [ROUTES.logistics]: "admin-help-main",
  [ROUTES.compliance]: "admin-renewals-main",
  [ROUTES.whoIsWho]: "on-call-who-is-who-section",
};

async function openBoard(page: Page, route: string, width = BOARD_WIDTH) {
  await page.setViewportSize({ width, height: BOARD_HEIGHT });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  // Every On Call route streams through the `(search-app)` group's `loading.tsx`
  // Suspense boundary, so React parks a second, hidden copy of the page in a
  // `<div hidden id="S:n">` staging container at the end of `<body>` until its
  // deferred reveal (`$RC` -> `$RV`, scheduled on a frame) removes it. Until
  // then every testid below resolves to two elements — the live one and the
  // staged orphan — and a strict locator fails on the pair rather than on
  // anything being wrong with the board. CI caught exactly that on the hub:
  // `on-call-home-sections` once inside `mobile-composer-reserve-pad`, once in
  // the staging copy. Wait for the document to settle to ONE copy, as the
  // retired Ward Flow journeys did, rather than relaxing the locators to
  // `.first()` — that would leave them free to assert against the inert staged copy.
  await expect(
    page.locator('div[hidden][id^="S:"]'),
    "React's streamed content is still staged, so the whole page is duplicated in the document",
  ).toHaveCount(0, { timeout: 20_000 });
  // The entry store fetches on the client, so every board below waits on data
  // rather than on the shell. The hub has no page header, so the two wait on
  // different things: the hub on its tile grid, a section page on its header.
  if (route === ROUTES.home) {
    // Visible owner only: a full load can briefly leave Next's hidden streamed
    // copy of the page in the DOM, which a bare testid counts twice (#093).
    // The v6 rebuild replaced Home's tile grid with Now (plan C25); the demo
    // handbook always pins a synthetic emergency route (`service-demo.ts`), so
    // that module is the settled signal rather than the hospital line, which
    // can render before the handbook itself has arrived.
    await expect(visibleByTestId(page, "on-call-now-emergency")).toBeVisible({ timeout: 20_000 });
    return;
  }
  // The list, not the header: a section page renders a header only when it has
  // two or more groups to move between, and Playbook, Who's who and Teaching
  // have one or none in the demo corpus. The list is also the better signal
  // either way — the header used to render before the fetch resolved, so
  // waiting on it measured the loading state.
  const listTestId = SECTION_LIST_TEST_IDS[route];
  if (listTestId) await expect(visibleByTestId(page, listTestId)).toBeVisible({ timeout: 20_000 });
}

/**
 * The bar of this page's own groups, once it has settled to exactly one.
 *
 * `.first()` and a count settle, because a client-side route change keeps the
 * outgoing page's tree mounted until the incoming one is ready — so for a
 * moment two headers exist and a strict locator fails on the pair rather than
 * on anything being wrong.
 */
/**
 * On Call's own section pages render `OnCallSectionNavHeader`, whose header
 * testid prefix is `on-call-section`. Admin's Help and New job pages render
 * the different `AdminNavHeader` instead (Admin update 1), whose rail is the
 * same `InPageNavHeader` component but under its own `admin-section-header`
 * prefix — a page borrowing Admin's identity must not read as an On Call page
 * in a test id. Callers on an Admin route pass that prefix.
 */
const ADMIN_SECTION_HEADER_PREFIX = "admin-section-header";

async function sectionBar(page: Page, prefix = "on-call-section") {
  await expect(page.getByTestId(`${prefix}-detail-header`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`${prefix}-detail-header`)).toHaveCount(1, { timeout: 20_000 });
  return page.getByTestId(`${prefix}-section-rail`);
}

/** The words the bar is currently showing, in order, excluding More. */
async function barWords(page: Page, prefix = "on-call-section") {
  const bar = await sectionBar(page, prefix);
  return bar.evaluate((nav) =>
    Array.from(nav.querySelectorAll("li"))
      .filter((slot) => getComputedStyle(slot).display !== "none" && !slot.classList.contains("mode-nav__more"))
      .map((slot) => slot.textContent?.trim() ?? ""),
  );
}

/**
 * Fails when anything reaches past the right edge — the site's rule, not the
 * drawing's.
 *
 * Two checks, because the obvious one is not enough. `scrollWidth` catches a
 * page that can be dragged sideways, but a container with `overflow: hidden`
 * absorbs the excess and the page stays exactly as wide as the viewport while
 * the words at the right are simply gone. That is the worse failure — nothing
 * looks broken, the text has just been cut — so the second check walks the
 * rendered boxes and names the element that crossed the edge.
 *
 * Elements that scroll on purpose are excluded by their own container: the
 * ward strip and the chip rows carry `overflow-x: auto`, so their children are
 * meant to sit outside the viewport.
 */
async function expectNoHorizontalOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const limit = doc.clientWidth + 1;
    const scrollsOnPurpose = (node: Element) => {
      let current: Element | null = node;
      while (current) {
        const overflowX = getComputedStyle(current).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
        current = current.parentElement;
      }
      return false;
    };
    let offender: { tag: string; text: string; right: number } | null = null;
    for (const element of Array.from(doc.querySelectorAll("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.right <= limit) continue;
      // Only the narrowest offender is worth naming; its ancestors are stretched by it.
      if (element.querySelector("*")) continue;
      if (scrollsOnPurpose(element)) continue;
      offender = { tag: element.tagName, text: (element.textContent ?? "").slice(0, 50), right: Math.round(box.right) };
      break;
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offender };
  });
  expect(result.scrollWidth, `${label} scrolls sideways`).toBeLessThanOrEqual(result.clientWidth + 1);
  expect(
    result.offender,
    `${label}: <${result.offender?.tag}> "${result.offender?.text}" reaches ${result.offender?.right}px, past the ${result.clientWidth}px edge`,
  ).toBeNull();
}

/** Measures the rendered box, not the class name. */
async function expectTapFloor(target: Locator, label: string) {
  const box = await target.boundingBox();
  expect(box, `${label} has no box`).not.toBeNull();
  expect(box!.height, `${label} is ${box!.height}px tall, under the ${TAP_FLOOR}px floor`).toBeGreaterThanOrEqual(
    TAP_FLOOR - 0.5,
  );
}

test.describe("01 Home", () => {
  // The v6 rebuild (plan C25) replaced board 01's tile-grid Home with Now: the
  // hospital line, its pinned emergency route, the dark Right now hero, Your
  // usual, Your team and the footer group. `docs/on-call/design/mockup-conformance.md`
  // records each retired element's departure; this block proves what replaced
  // it actually renders, in the safety order.

  test("draws Now's modules, in the order the page draws them", async ({ page }) => {
    await openBoard(page, ROUTES.home);

    const modules = [
      "on-call-now-hospital",
      "on-call-now-emergency",
      "on-call-now-right-now",
      "on-call-home-recent",
      "on-call-now-team",
      "on-call-now-footer",
    ];
    for (const id of modules) {
      await expect(visibleByTestId(page, id), `${id} is drawn on Now but does not render`).toBeVisible();
    }

    // Top to bottom in the drawn order. A module that renders in the wrong
    // place still passes a presence check, and the order is the safety order:
    // hospital, its emergency route, Right now, Your usual, Your team, footer.
    const tops = await Promise.all(
      modules.map(async (id) => (await visibleByTestId(page, id).boundingBox())?.y ?? Number.NaN),
    );
    for (let index = 1; index < tops.length; index += 1) {
      expect(tops[index], `${modules[index]} is above ${modules[index - 1]}`).toBeGreaterThan(tops[index - 1]!);
    }
  });

  test("leads with Who do I call now, which opens the escalation steps with call buttons", async ({ page }) => {
    await openBoard(page, ROUTES.home);
    await visibleByTestId(page, "on-call-home-call-now").click();
    await expect(page).toHaveURL(/\/on-call\/now$/);
    await expect(page.getByTestId("on-call-now-ladder")).toBeVisible();
    await expect(page.getByTestId("on-call-now-steps").getByRole("listitem").first()).toBeVisible();
  });

  test("answers Right now with the hospital's switchboard, and reaches all roles in one tap", async ({ page }) => {
    await openBoard(page, ROUTES.home);
    // No hospital has set after-hours times in the demo handbook, so the
    // switchboard is the answer (v6 figure 03) rather than a team role.
    const hero = visibleByTestId(page, "on-call-now-right-now");
    await expect(hero).toContainText("Switchboard");
    const allRoles = hero.getByRole("link", { name: "All roles" });
    await expect(allRoles).toHaveAttribute("href", "/on-call/call");
    await expectTapFloor(allRoles, "Right now's All roles link");
  });

  test("keeps First night and Who do I call now live in the footer group", async ({ page }) => {
    await openBoard(page, ROUTES.home);
    const footer = visibleByTestId(page, "on-call-now-footer");
    const firstNight = footer.getByTestId("on-call-home-first-night");
    await expect(firstNight).toHaveAttribute("href", "/on-call/first-night");
    await expectTapFloor(firstNight, "First night row");
    // The literal href the route-reachability guard reads; the click test
    // above proves the destination actually renders.
    await expect(footer.getByTestId("on-call-home-call-now")).toHaveAttribute("href", "/on-call/now");
  });

  test("puts the page menu in the universal header, and offers no chat there", async ({ page }) => {
    await openBoard(page, ROUTES.home);
    const trigger = page.getByTestId("on-call-page-menu-trigger");
    await expect(trigger).toBeVisible();
    await expectTapFloor(trigger, "hub page menu trigger");

    // On Call answers nothing, so there is no conversation to start. The
    // button used to be stood down only while a page filled the header's
    // trailing slot, which meant it came back the moment a page put its own
    // controls somewhere else.
    await expect(page.getByRole("button", { name: "Start a new chat" })).toHaveCount(0);
  });

  test("holds together at the site's narrow width, which the drawing never shows", async ({ page }) => {
    await openBoard(page, ROUTES.home, NARROW);
    await expect(visibleByTestId(page, "on-call-now-footer")).toBeVisible();
    await expectNoHorizontalOverflow(page, "Now at 320px");
  });
});

test.describe("Coming up — moved off Home to Teaching (plan C25)", () => {
  test("legacy /on-call/education hard-redirects to Teaching Week", async ({ page }) => {
    await page.goto("/on-call/education", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/teaching\/week/);
    await expect(visibleByTestId(page, "teaching-week")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("02 More, 03 All modes — the pill owns page switching", () => {
  test("opens this mode's own sections from the pill, with one tap back to all modes", async ({ page }) => {
    await openBoard(page, ROUTES.contacts, DESKTOP);
    await page.getByRole("button", { name: /Mode/ }).first().click();

    // In a mode that owns its own pages the pill opens THOSE, drawn like the
    // switcher everywhere else, rather than making a reader step in from the
    // full mode list every time they want another section.
    const sections = page.locator("#app-mode-menu");
    await expect(sections).toBeVisible();
    await expect(sections).toHaveAttribute("aria-label", /On Call pages/);
    await expect(sections.getByRole("link", { name: "Now" })).toBeVisible();

    // And never a dead end: the level above is one control away.
    await page.getByTestId("app-mode-popover-back").click();
    await expect(page.locator("#app-mode-menu")).toHaveAttribute("aria-label", /Choose app mode/);
  });

  test("carries no second bar repeating those same destinations", async ({ page }) => {
    // The whole point of the change. The pill above already opens the mode's
    // pages — nine when this was written, ten since Compliance; a rail
    // underneath listing the same ten was two controls doing one job, and it
    // hid five of them behind "More" while doing it.
    for (const route of [ROUTES.home, ROUTES.contacts, ROUTES.playbook, ROUTES.logistics, ROUTES.compliance]) {
      await openBoard(page, route);
      await expect(page.getByTestId("mode-nav")).toHaveCount(0);
      // The one exception is the mode header band's tab row (the C4 header the
      // owner locked on 5 Oct 2026 for every mode, On Call included). It is
      // the only "On Call pages" bar allowed; nothing else may repeat it.
      // Some pages show the band without tabs, so the bar is at most that one.
      expect(await page.getByRole("navigation", { name: "On Call pages" }).count()).toBeLessThanOrEqual(1);
      expect(await page.getByTestId("mode-band-tabs").count()).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("02 More — the second row is about the page you are on", () => {
  test("is a bar of this page's own groups, with the current one marked", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    const bar = await sectionBar(page);
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("aria-label", "Sections of this page");

    // The areas Contacts files its rows under, as plain words. This is the
    // assertion jsdom cannot make: section resolution tests visibility with
    // getClientRects, which jsdom reports empty for everything.
    expect(await barWords(page)).toEqual(["Services", "Tonight", "Wards"]);

    // Not the mode's routes — those belong to the pill above.
    await expect(bar.getByRole("button", { name: /^Playbook$/ })).toHaveCount(0);

    // Exactly one slot is current, and it is marked by more than colour: the
    // rule under it is drawn, and `aria-current` names it.
    await expect(bar.locator('button[aria-current="true"]')).toHaveCount(1);
  });

  test("carries no title, no back arrow and no actions of its own", async ({ page }) => {
    // Everything this row used to hold moved up one level, to the pill and the
    // universal header's trailing slot. What is left is navigation inside the
    // page, which is the only thing this row was ever meant to be.
    await openBoard(page, ROUTES.contacts);
    const header = page.getByTestId("on-call-section-detail-header");
    await expect(header).not.toContainText("Contacts");
    await expect(header.getByRole("link", { name: /back to on call/i })).toHaveCount(0);
    await expect(page.getByTestId("on-call-section-actions-trigger")).toHaveCount(0);
    await expect(page.getByTestId("on-call-section-section-trigger")).toHaveCount(0);
  });

  test("names the page once, in the pill, with the mode beneath it", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    // The pill's accessible name still opens `Mode …` — twelve test files and
    // the shared helper find this control by that prefix — and now says the
    // page as well.
    // Contacts is the editor behind Call (kit 1.7), so the pill names Call.
    const pill = page.getByRole("button", { name: "Mode On Call, page Call" });
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("Call");
    await expect(pill).toContainText("On Call");

    // And nothing else on the page paints the name. Measured, not counted by
    // role: the `<h1>` names the page and the `<h2>` labels the list region, so
    // both are still in the accessibility tree; each is clipped to a pixel.
    const titles = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3")).filter(
        (node) => node.textContent?.trim() === "Contacts",
      );
      return {
        headings: headings.length,
        painted: headings.filter((node) => node.getBoundingClientRect().height > 16).length,
      };
    });
    expect(titles.headings, "the page must still be named for a screen reader").toBeGreaterThanOrEqual(1);
    expect(titles.painted, "a heading repeats the name the pill already shows").toBe(0);
  });

  test("carries the mode's own colour on the pill and the bar, and only there", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    const identity = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).getPropertyValue("--clinical-accent").trim() : null;
      };
      return {
        pill: read('[data-mode-identity="on-call"].universal-header-mode-button'),
        bar: read('[data-testid="on-call-section-section-rail"]'),
        page: getComputedStyle(document.body).getPropertyValue("--clinical-accent").trim(),
      };
    });
    // One token, two elements, so the filled circle and the active underline
    // cannot end up different greens.
    expect(identity.pill).toBe(identity.bar);
    expect(identity.pill).toBeTruthy();
    // And the rest of the page keeps the product accent: the hue is scoped to
    // the mode's own chrome, not sprayed over its content.
    expect(identity.page).not.toBe(identity.pill);
  });

  test("fits its words without truncating at the site's narrow width", async ({ page }) => {
    // The failure this profile exists to prevent, and the one a screenshot
    // catches only if someone looks: "Servi…" in a 48px bar. Measured on the
    // rendered label box rather than inferred from the band.
    //
    // Four routes, not one. The one-word convention this mode is built on came
    // from a measurement recorded at board 11 below — a drawn phrase came to
    // 165px in this row against a 288px phone, and three such slots needed
    // 372px — and the three pages RE-CUT because of it were the three this
    // guard did not follow: Admin (Leave / Rosters / Pay / Forms / Access /
    // Facilities), Orientation (Induction / Manuals / Policies / Departure /
    // Unfiled) and Compliance (Blocking / Partial / Chased / Unrecorded).
    // Until this list grew, no test in the suite had measured a single one of
    // those words; four source files cite the measurement and nothing proved
    // the pages still obeyed it.
    //
    // Compliance has since left this list: it became Admin > Renewals
    // (2026-09-26), a checklist with Checklist / Personal tabs and no section
    // rail at all, so there is no bar there to measure. Its block at the foot
    // of this file covers the page it became.
    //
    // What this reaches, and what it does not. Only the slots the band
    // actually renders can be measured: the tail of a longer list is
    // `display: none` behind More at these widths and is filtered out above.
    // So Admin contributes Access and Facilities at 320px and Forms as well at
    // 390px — Leave first appears at the five-slot band and Pay and Rosters
    // never reach the bar at all — and Orientation's Departure and Unfiled
    // likewise wait for that band. That is the right boundary rather than a
    // hole: a word folded into the sheet is not in the 48px row and cannot be
    // clipped by it, and the bands that do reveal it are wider ones, with more
    // room per slot rather than less.
    for (const route of [ROUTES.contacts, ROUTES.logistics, ROUTES.orientation]) {
      const prefix = route === ROUTES.logistics ? ADMIN_SECTION_HEADER_PREFIX : undefined;
      for (const width of [NARROW, BOARD_WIDTH]) {
        await openBoard(page, route, width);
        const clipped = await (
          await sectionBar(page, prefix)
        ).evaluate((nav) =>
          Array.from(nav.querySelectorAll("li"))
            .filter((slot) => getComputedStyle(slot).display !== "none")
            .flatMap((slot) => Array.from(slot.querySelectorAll("span")))
            .filter((span) => span.scrollWidth > span.clientWidth + 1)
            .map((span) => span.textContent ?? ""),
        );
        expect(clipped, `a label is truncated on ${route} at ${width}px`).toEqual([]);
      }
    }
  });

  test("keeps every slot on the production tap floor", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    const bar = await sectionBar(page);
    const slots = bar.getByRole("button");
    for (let index = 0; index < (await slots.count()); index += 1) {
      await expectTapFloor(slots.nth(index), `bar slot ${index}`);
    }
  });

  test("jumps to a group and follows the reader back down the page", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    const bar = await sectionBar(page);
    await bar.getByRole("button", { name: /^Wards$/ }).click();

    const wards = page.locator("#on-call-group-wards");
    await expect(wards).toBeInViewport({ timeout: 5_000 });
    // Still on the page, which is the whole difference from the chip row this
    // replaced: tapping "Wards" used to DELETE Tonight and Services.
    await expect(page.getByTestId("on-call-contact-row-demo-interpreter-line")).toHaveCount(1);
    await expect(bar.locator('button[aria-current="true"]')).toContainText("Wards");
  });

  test("says nothing else above the list", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    // No eyebrow repeating the mode, no display-size title, no paragraph
    // explaining how the section is filed, and no chip row naming the same
    // groups the bar names.
    await expect(page.getByText(/Filed by role first/)).toHaveCount(0);
    await expect(page.getByTestId("on-call-contacts-filters")).toHaveCount(0);
    const firstGroup = page.getByTestId("on-call-contacts-group-needs-checking");
    const header = page.getByTestId("on-call-section-detail-header");
    // The mode header band (C4, locked 5 Oct 2026) sits between this bar and
    // the list by design, so the gap is measured from whichever ends lower.
    const band = page.getByTestId("mode-band");
    const [groupBox, sectionBox, bandBox] = [
      await firstGroup.boundingBox(),
      await header.boundingBox(),
      await band.boundingBox(),
    ];
    const headerBox =
      bandBox && sectionBox && bandBox.y + bandBox.height > sectionBox.y + sectionBox.height ? bandBox : sectionBox;
    // The threshold is the height of a control band, not a design opinion: a
    // chip row or a toolbar is a 48px control plus its gaps, so anything that
    // reappears between the header and the list pushes this well past 72. The
    // shell's own top padding accounts for the ~48 that is there.
    expect(
      groupBox!.y - (headerBox!.y + headerBox!.height),
      "a band of controls has reappeared between the header and the list",
    ).toBeLessThan(72);
    await expect(page.getByRole("button", { name: "Start a new chat" })).toHaveCount(0);
  });

  test("gives a page that lost its chips real groups instead", async ({ page }) => {
    await openBoard(page, ROUTES.referrals);
    await expect(page.getByTestId("on-call-referrals-filters")).toHaveCount(0);
    const groups = page.locator('[data-testid^="on-call-referrals-group-"]');
    await expect.poll(() => groups.count()).toBeGreaterThan(1);

    // And the bar can now move between them, which the flat list could not.
    expect(await barWords(page)).toContain("Community");
  });

  test("gives the orientation shelf its groups too", async ({ page }) => {
    await openBoard(page, ROUTES.orientation);
    await expect(page.getByTestId("on-call-orientation-filters")).toHaveCount(0);
    await expect.poll(() => page.locator('[data-testid^="on-call-orientation-group-"]').count()).toBeGreaterThan(1);
  });

  test("declares no anchor the page does not render", async ({ page }) => {
    // Admin, and deliberately only Admin. Admin's Help page (`/admin/help`)
    // renders `AdminNavHeader`, whose rail words are `ADMIN_HELP_SECTIONS`'
    // own labels, and whose anchors are that same list's ids
    // (`admin-help-support`, `admin-help-guides`, ...) — this re-derives the
    // slug from the word in the bar and checks it against that `admin-help-`
    // prefix, which holds for every word this page's rail can show.
    await openBoard(page, ROUTES.logistics);
    for (const label of await barWords(page, ADMIN_SECTION_HEADER_PREFIX)) {
      const slug = label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!slug) continue;
      await expect(page.locator(`#admin-help-${slug}`), `${label} is offered but absent`).toHaveCount(1);
    }
  });
});

test.describe("05 Page menu", () => {
  test("opens from the universal header, the same control the mode home uses", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    const trigger = page.getByTestId("on-call-page-menu-trigger");
    await expect(trigger).toBeVisible();
    await expectTapFloor(trigger, "page menu trigger");
    // One menu for the whole mode, in the slot the new-chat button would
    // otherwise hold — a mode with no results surface has nowhere for a new
    // conversation to land. A second ellipsis on the page's own row would have
    // cost 48px to duplicate this one.
  });

  test("carries the order control, the pocket card, and the privacy explanation", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    await page.getByTestId("on-call-page-menu-trigger").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("on-call-page-menu-order")).toBeVisible();
    await expect(page.getByTestId("on-call-page-menu-card")).toBeVisible();
    await expect(page.getByTestId("on-call-page-menu-privacy")).toBeVisible();
    // Board 05 puts the order control inside the sheet at phone width rather
    // than letting it claim a band of its own above the list.
    const orderBox = await page.getByTestId("on-call-page-menu-order").boundingBox();
    const sheetBox = await sheet.boundingBox();
    expect(orderBox!.y).toBeGreaterThanOrEqual(sheetBox!.y - 1);
  });

  test("reorders the list from the sheet", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    await expect(page.getByTestId("on-call-contacts-group-tonight")).toBeVisible();
    await page.getByTestId("on-call-page-menu-trigger").click();
    await page.getByRole("radio", { name: "By role" }).click();
    await expect(page.getByTestId("on-call-contacts-group-role")).toBeVisible();
    await expect(page.getByTestId("on-call-contacts-group-tonight")).toHaveCount(0);
  });
});

test.describe("06 Contacts", () => {
  test("puts the overdue group at the top, above the area groups, and no chip row", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    await expect(page.getByTestId("on-call-contacts-filters")).toHaveCount(0);
    const needsChecking = page.getByTestId("on-call-contacts-group-needs-checking");
    await expect(needsChecking).toBeVisible();

    // Board 06's rule: overdue rows collect at the TOP rather than hiding in
    // place among the good ones.
    const overdueTop = (await needsChecking.boundingBox())!.y;
    const firstAreaTop = (await page.getByTestId("on-call-contacts-group-tonight").boundingBox())!.y;
    expect(overdueTop).toBeLessThan(firstAreaTop);
  });

  test("reaches a group without hiding the others", async ({ page }) => {
    // What the chip row used to do, and the reason it went: tapping "Wards"
    // REMOVED Tonight and Services from the page, so a mistap cost the reader
    // the list rather than their place. The bar moves them instead.
    await openBoard(page, ROUTES.contacts);
    const bar = await sectionBar(page);
    await bar.getByRole("button", { name: /^Wards$/ }).click();

    await expect(page.locator("#on-call-group-wards")).toBeInViewport({ timeout: 5_000 });
    await expect(page.getByTestId("on-call-contact-row-demo-ward-one")).toBeVisible();
    // Still on the page, which is the whole difference from a filter.
    await expect(page.getByTestId("on-call-contact-row-demo-interpreter-line")).toHaveCount(1);
  });

  test("never offers an invented 0000 number to the dialler, and keeps the row one target", async ({ page }) => {
    // Every example number starts "0000", and a phone keying "000…" can reach
    // Triple Zero, so example rows show their number as text with no call link.
    await openBoard(page, ROUTES.contacts);
    const row = page.getByTestId("on-call-contact-row-demo-nurse-manager");
    await expect(row).toContainText("0000 000 001");
    await expect(row.locator('a[href^="tel:"]')).toHaveCount(0);
    expect((await row.getAttribute("href")) ?? "").not.toMatch(/^tel:/);
    await expectTapFloor(row, "contact row");
    await expect(row.locator("button")).toHaveCount(0);
  });

  test("shows a private row's rule and withholds its digits", async ({ page }) => {
    await openBoard(page, ROUTES.contacts);
    const row = page.getByTestId("on-call-contact-row-demo-private-line");
    await expect(row).toBeVisible();
    await expect(row.getByTestId("on-call-private-flag")).toContainText("Private");
    await expect(row).not.toContainText(/0000 000 0\d\d/);
    // Board 06 draws no call control on it either.
    expect(await row.getAttribute("href")).toBeNull();
  });

  test("stays inside the viewport at the site's narrow width", async ({ page }) => {
    await openBoard(page, ROUTES.contacts, NARROW);
    await expect(page.getByTestId("on-call-contacts-group-needs-checking")).toBeVisible();
    await expectNoHorizontalOverflow(page, "contacts at 320px");
  });
});

test.describe("07 Playbook", () => {
  test("numbers the escalation ladder and keeps the consultant sentence in full ink", async ({ page }) => {
    await openBoard(page, ROUTES.playbook);
    const steps = page.locator('[data-testid^="on-call-playbook-step-"]');
    await expect.poll(() => steps.count()).toBeGreaterThanOrEqual(3);
    await expect(steps.first()).toContainText("1.");
    await expect(page.getByText("You are expected to make this call")).toBeVisible();
  });

  test("collects the scenarios with no linked guideline into their own group", async ({ page }) => {
    await openBoard(page, ROUTES.playbook);
    await expect(page.getByTestId("on-call-playbook-group-no-guideline")).toBeVisible();
    // The designed empty state, not an absent one: it names what is missing and
    // offers a document search rather than inventing advice.
    await expect(page.locator('[data-testid^="on-call-playbook-no-guideline-"]').first()).toContainText(
      /No local guideline/i,
    );
  });
});

/**
 * Open one referral row. The row's button is in the page before React has attached its click
 * handler, and a click in that gap is swallowed: a Firefox CI run clicked the right button (its
 * id unchanged, so nothing remounted) and the row stayed collapsed. Wait for the handler first.
 *
 * Waiting for the handler was not enough on its own: a Chromium CI run (2026-09-26, #3086) saw
 * the handler attached, clicked, and the row still read collapsed for the full timeout. So the
 * click is retried, but only while the row still reads collapsed, so a retry can never close a
 * row the first click opened.
 */
async function expandReferral(page: Page, name: string) {
  const trigger = page.getByRole("button", { name, exact: true });
  await expect
    .poll(
      () =>
        trigger.evaluate((element) => {
          const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
          const props = propsKey ? (element as unknown as Record<string, Record<string, unknown>>)[propsKey] : null;
          return typeof props?.onClick === "function";
        }),
      { message: "referral row click handler attached", timeout: 15_000 },
    )
    .toBe(true);
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

test.describe("08 Referrals", () => {
  test("expands a service in place rather than routing away", async ({ page }) => {
    await openBoard(page, ROUTES.referrals);
    const before = page.url();
    await expandReferral(page, "Demo community mental health team");
    await expect(page.getByTestId("on-call-referral-panel-demo-community-team")).toBeVisible();
    expect(page.url()).toBe(before);
  });

  test("labels what a service accepts and does not accept, never colour alone", async ({ page }) => {
    await openBoard(page, ROUTES.referrals);
    await expandReferral(page, "Demo community mental health team");
    const panel = page.getByTestId("on-call-referral-panel-demo-community-team");
    await expect(panel).toContainText("Accepts");
    await expect(panel).toContainText("Does not accept");
  });
});

test.describe("08 Referrals — freshness says something or says nothing", () => {
  test("keeps a current service's checked date out of the collapsed row", async ({ page }) => {
    await openBoard(page, ROUTES.referrals);
    const row = page.getByRole("button", { name: /Demo community/ }).first();
    await expect(row).toBeVisible();
    // "Checked <date>" on a row where nothing is wrong is a pill wider than
    // the service's own name; the name truncated to make room for it.
    await expect(row.getByTestId("on-call-freshness-badge")).toHaveCount(0);

    await row.click();
    await expect(page.getByTestId("on-call-freshness-badge").first()).toBeVisible();
  });
});

test.describe("10 Orientation", () => {
  test("draws both checklists, and a tick greys the step it belongs to", async ({ page }) => {
    await openBoard(page, ROUTES.orientation);
    const checklists = page.locator('[data-testid^="on-call-orientation-checklist-"]');
    await expect.poll(() => checklists.count()).toBeGreaterThanOrEqual(2);

    const step = page.getByRole("button", { name: /Collect the on-call phone/ });
    await expectTapFloor(step, "checklist step");
    await expect(step).toHaveAttribute("aria-pressed", "false");
    await step.click();
    await expect(page.getByRole("button", { name: /Collect the on-call phone/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Board 10: done items grey and strike through, so what remains stands out.
    const decoration = await page
      .getByRole("button", { name: /Collect the on-call phone/ })
      .locator("span", { hasText: "Collect the on-call phone" })
      .last()
      .evaluate((node) => getComputedStyle(node).textDecorationLine);
    expect(decoration).toContain("line-through");
  });

  test("badges the owner's note as the owner's words", async ({ page }) => {
    await openBoard(page, ROUTES.orientation);
    await expect(page.locator('[data-testid^="on-call-orientation-note-"]').first()).toContainText("Your note");
  });
});

/**
 * Board 11 was drawn as "Logistics". Admin update 1 (2026-09-26) split that
 * page in two: the rows that expire moved to Compliance
 * (`test.describe("Compliance", ...)` below), and everything else moved to
 * Admin's own Help page (boards 09/18/19/25) — crisis lines first, an
 * in-page "Find in Help" filter, then Support/Guides/Contacts/On site, each
 * an own or shared `on_call_entries` row placed by category and title rather
 * than a stored "folder". The route segment (`/admin/help`), the underlying
 * `logistics` section and its rows' `category` values are unchanged; only the
 * page that reads them is new, so the assertions below check what that page
 * actually renders instead of the folder headings it replaced.
 */
test.describe("11 Admin: Help", () => {
  /** Clicks a tab's "Show all" if the demo corpus gave it one, so a row past
   * the first eight is still found regardless of exactly where it falls. */
  async function showAll(page: Page, listTestId: string) {
    const button = page.getByTestId(`${listTestId}-show-all`);
    if (await button.count()) await button.click();
  }

  test("puts crisis lines first, with 000 the only filled emergency control and Lifeline its own number", async ({
    page,
  }) => {
    await openBoard(page, ROUTES.logistics);
    await expect(page.getByTestId("admin-help-crisis")).toBeVisible();
    // Quiet red and filled is 000's alone; every other line is an outlined disc.
    await expect(page.locator('[data-testid$="-emergency-dot"]')).toHaveCount(1);
    await expect(page.getByTestId("admin-help-crisis-SYN-CRISIS-CONTACT-001-emergency-dot")).toBeVisible();
    await expect(page.getByTestId("admin-help-crisis-SYN-CRISIS-CONTACT-001-call")).toHaveAttribute("href", "tel:000");
    // Lifeline rings on its own number, never folded into 000's.
    const lifeline = page.getByTestId("admin-help-crisis-SYN-CRISIS-CONTACT-005");
    await expect(lifeline).toContainText("Lifeline");
    await expect(lifeline).toContainText("13 11 14");
    await expect(page.getByTestId("admin-help-crisis-SYN-CRISIS-CONTACT-005-call")).toHaveAttribute(
      "href",
      "tel:131114",
    );
  });

  test("finds a row by an everyday word, without hiding crisis lines", async ({ page }) => {
    await openBoard(page, ROUTES.logistics);
    // No microphone on this box: it is a filter over what is already on the
    // page, never the shared search composer (spec).
    const filter = page.getByRole("textbox", { name: "Find in Help" });
    const guides = page.getByTestId("admin-help-guides-list");
    // Text typed before hydration is dropped (mobile WebKit, release matrix
    // 2026-10-04), so retype until the filter has visibly applied.
    await expect(async () => {
      await filter.fill("payslip");
      await expect(guides.getByText("Demo sick leave, and who to tell first")).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(guides.getByText("Demo payslips and pay queries")).toBeVisible();
    // Crisis lines are never filtered (spec): they render above this check.
    await expect(page.getByTestId("admin-help-crisis")).toBeVisible();
  });

  test("shows the Guides tab's own rows, each with its own provenance line", async ({ page }) => {
    await openBoard(page, ROUTES.logistics);
    const guides = page.getByTestId("admin-help-guides-list");
    await showAll(page, "admin-help-guides-list");
    const row = guides.locator("li", { hasText: "Demo payslips and pay queries" });
    // The demo corpus has no other account, so every row here is the reader's
    // own — "Shared by another doctor" only ever appears once a second
    // account's guide exists, which board 30's long-name case exercises.
    await expect(row).toContainText(/Yours · Updated/);
  });

  test("shows the On site tab's rows, and the after-hours line exactly when it applies", async ({ page }) => {
    await openBoard(page, ROUTES.logistics);
    const onSite = page.getByTestId("admin-help-on-site-list");
    await showAll(page, "admin-help-on-site-list");
    await expect(onSite.locator("li", { hasText: "Demo security escort" })).toBeVisible();
    await expect(onSite.locator("li", { hasText: "Demo after-hours entry" })).toBeVisible();
    await expect(onSite.locator("li", { hasText: "Demo locked wards" })).toBeVisible();

    // Read in the reader's own zone (spec), so this mirrors the app's own
    // rule rather than pinning a time of day the suite happens to run at.
    const afterHours = page.getByTestId("admin-help-on-site-after-hours");
    if (isOnCallOutOfHours(new Date())) {
      await expect(afterHours).toContainText(
        `After hours now · from ${String(ON_CALL_IN_HOURS_END_HOUR).padStart(2, "0")}:00`,
      );
    } else {
      await expect(afterHours).toHaveCount(0);
    }
  });

  test("keeps New job's login rows off Help entirely", async ({ page }) => {
    await openBoard(page, ROUTES.logistics);
    // "Demo logins, paging and remote access" is category Access with a login
    // title, so `adminPlacementForEntry` files it at New job, not here — Help
    // must never show a row New job already owns.
    await expect(page.getByText("Demo logins, paging and remote access")).toHaveCount(0);
  });

  test("shows a workforce role explainer in Contacts, not the desk number New job already shows", async ({ page }) => {
    await openBoard(page, ROUTES.logistics);
    const contacts = page.getByTestId("admin-help-contacts-list");
    await showAll(page, "admin-help-contacts-list");
    const explainer = contacts.locator("li", { hasText: "What medical workforce does" });
    await expect(explainer).toBeVisible();
    await expect(explainer).toContainText("No date recorded");
    // The workforce desk's own number is reused, not duplicated, on New job.
    await expect(page.getByTestId("admin-help-contacts-list").getByText("Demo medical workforce unit")).toHaveCount(0);
  });
});

/**
 * Compliance — a page the eleven boards never drew, now Admin > Renewals.
 *
 * It was cut out of On Call's Admin after the drawing, and on 2026-09-26
 * (Admin update 1) it moved again: `/on-call/compliance` redirects to
 * `/admin/renewals`, which is rebuilt as a checklist of the statewide
 * Requirements catalogue crossed with the doctor's own recorded dates. It has
 * no section rail and no consequence bands any more; rows are grouped by
 * state ("Soonest first", "No end date", "Not recorded yet").
 *
 * With no artboard to check it against, this block checks what ships: the
 * groups in that order with the demo corpus's recorded rows in the first, the
 * "not a check" line above the list, and a Personal tab that holds only the
 * reader's own off-catalogue renewals — never a contact or a guide.
 */
test.describe("Compliance — the view the boards never drew", () => {
  test("files the requirements under state groups, soonest first", async ({ page }) => {
    await openBoard(page, ROUTES.compliance);

    // The demo corpus links three rows to catalogue items (registration,
    // indemnity, Working with Children Check), so both groups have rows.
    const soonest = visibleByTestId(page, "admin-renewals-checklist-group-Soonest first");
    const notRecorded = visibleByTestId(page, "admin-renewals-checklist-group-Not recorded yet");
    await expect(soonest, "the demo corpus's recorded rows do not render").toBeVisible();
    await expect(notRecorded).toBeVisible();
    await expect(soonest).toContainText("Medical registration renewal");
    await expect(soonest).toContainText("Working with Children Check");

    // Order is the page's argument: a recorded date to act on comes before
    // the slots nobody has filled in yet.
    const [soonestBox, notRecordedBox] = [await soonest.boundingBox(), await notRecorded.boundingBox()];
    expect(notRecordedBox!.y, "Not recorded yet is above Soonest first").toBeGreaterThan(soonestBox!.y);
  });

  test("says on the page that these are dates the reader entered, not a check", async ({ page }) => {
    await openBoard(page, ROUTES.compliance);
    const summary = visibleByTestId(page, "admin-renewals-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("Dates you entered, not a check");

    // Above the list, not at its foot. A reader who meets this sentence after
    // scrolling past their own registration has already read every date on the
    // way down and believed them. A clinical-governance review rejected an
    // earlier design for implying the app had checked these dates, and this
    // sentence in this position is the control that keeps it rejected.
    const [summaryBox, firstGroup] = [
      await summary.boundingBox(),
      await visibleByTestId(page, "admin-renewals-checklist-group-Soonest first").boundingBox(),
    ];
    expect(summaryBox!.y, "the 'not a check' line has slipped below the list").toBeLessThan(firstGroup!.y);
  });

  test("keeps Checklist and Personal tabs, and Personal holds only the reader's own renewals", async ({ page }) => {
    await openBoard(page, ROUTES.compliance);
    await expect(page.getByRole("tab", { name: "Checklist" })).toBeVisible();
    await page.getByRole("tab", { name: "Personal" }).click();

    const personal = visibleByTestId(page, "admin-renewals-personal");
    await expect(personal).toBeVisible();
    // A demo compliance row that matches no catalogue item.
    await expect(personal).toContainText("Demo basic life support module");
    // Never a row from another On Call section: offering "Renewed" on a
    // contact or a guide would plant compliance keys that hide it from every
    // colleague's shared read.
    await expect(personal.getByText("Demo Ward One")).toHaveCount(0);
    await expect(personal).not.toContainText("Medical registration renewal");
  });
});

test.describe("The mode's own chrome, across the site's widths", () => {
  for (const [name, route] of Object.entries(ROUTES)) {
    test(`keeps ${name} free of a search composer and free of sideways scroll`, async ({ page }) => {
      await openBoard(page, route);
      // The mode declares no results surface, so no route in it may grow a
      // composer or a second dock — the one-composer rule, checked where it
      // would actually be visible rather than in a class name.
      await expect(page.locator('[data-testid="global-search-composer"]')).toHaveCount(0);
      await expectNoHorizontalOverflow(page, `${name} at ${BOARD_WIDTH}px`);
    });
  }

  test("keeps the page header intact at the tablet width the drawing never shows", async ({ page }) => {
    await openBoard(page, ROUTES.contacts, TABLET);
    await expect(page.getByTestId("on-call-section-detail-header")).toBeVisible();
    // From `sm` the bar is a bordered card rather than a rule under the phone
    // header, and every group still fits: no overflow slot at any width the
    // demo corpus produces.
    expect(await barWords(page)).toEqual(["Services", "Tonight", "Wards"]);
    await expectNoHorizontalOverflow(page, "contacts at 768px");
  });

  test("re-resolves the hub in dark rather than leaking a light value", async ({ page }) => {
    // Switch schemes BETWEEN navigations, never before the first one.
    //
    // This test failed on Firefox in every release-browser-matrix run, reading
    // rgb(255, 255, 255) where it wanted a dark value, and the cause is the
    // ordering rather than the app: it set the override while the page was
    // still on about:blank, and Playwright's Firefox build does not carry that
    // into the very first navigation. The theme is resolved once, pre-paint, by
    // the inline bootstrap in `src/lib/theme.ts` reading
    // `matchMedia("(prefers-color-scheme: dark)")` — so a preference that
    // arrives late has already been missed, and the page stays light forever.
    //
    // Firefox itself resolves dark correctly on this app: the twelve dark
    // assertions in the since-retired Caring Contacts workspace suite passed on
    // Firefox in the same runs where this one failed, and every one of them
    // navigated first and switched afterwards. That is the pattern copied here, in
    // preference to `test.use({ colorScheme })`, which nothing in this
    // repository has yet proved against Firefox.
    const hubBackground = async () => {
      await openBoard(page, ROUTES.home);
      return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    };

    await page.emulateMedia({ colorScheme: "light" });
    const light = await hubBackground();

    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await hubBackground();

    const [r, g, b] = dark.match(/\d+/g)!.map(Number);
    expect(r + g + b, `body background ${dark} is not a dark value`).toBeLessThan(360);
    // The title's actual claim. A hardcoded light background would satisfy
    // neither this nor the threshold above, but only this one names the defect.
    expect(dark, `the hub painted ${dark} in both schemes`).not.toBe(light);
  });

  test("keeps the private marker legible once forced colours drop every tint", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openBoard(page, ROUTES.contacts);
    // The words survive the tint, which is the whole reason the flag says
    // "Private" rather than only showing a lock.
    await expect(page.getByTestId("on-call-private-flag").first()).toContainText("Private");
  });
});
