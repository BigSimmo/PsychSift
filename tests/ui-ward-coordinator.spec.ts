import { expect, test, type Locator, type Page } from "playwright/test";

import {
  buildActionInbox,
  candidateReason,
  eligibleCandidates,
  isOpen,
} from "@/components/ward-management/ward-derivations";
import type { Movement } from "@/components/ward-management/ward-model";
import { PARALLEL_REFERRAL_CAP } from "@/components/ward-management/ward-model";
import { movementById, wardMovements } from "@/components/ward-management/ward-movements";
import { NOW_ANCHOR } from "@/components/ward-management/ward-sites";

async function gotoCoordinator(page: Page) {
  await page.goto("/ward-management", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-coordinator")).toBeVisible({ timeout: 15_000 });
  // The console is visible from the first paint, but this dev environment settles the route
  // shortly after (a second same-URL navigation event follows the first). A click issued in
  // that window can be lost even though every element is already visible and stable, so wait
  // for network activity to quiesce — the one reliable, non-arbitrary signal available here —
  // before the first interaction. Mirrors `gotoWardFlow` in ui-ward-management.spec.ts (Task 4
  // review Important 6: a retry loop around the click was masking this instead of fixing it).
  await page.waitForLoadState("networkidle");
}

/**
 * Resolves a movement id off a real, currently-rendered queue row rather than trusting whatever
 * the test author expected to be there — the same reasoning `movementById` itself documents
 * (never fall back to a different record on a miss).
 */
function requireMovement(movementId: string | undefined | null): Movement {
  const movement = movementId ? movementById(movementId) : undefined;
  if (!movement) throw new Error(`Fixture is missing movement ${String(movementId)}`);
  return movement;
}

/**
 * Pins the diagram's routed set to the SELECTED MOVEMENT'S OWN shortlist identity — not merely
 * its size. `eligibleCandidates` is computed independently here, against the same real fixture
 * the app renders against, so a hard-coded routed set of the wrong units (or the brief's own
 * tautological `toHaveCount(await routed.count())`, which compares a value to itself and passes
 * at any count including zero) both fail this. Called for two different movements with two
 * different shortlists in the main diagram test (review Important 3 — a single-movement proof
 * only rules out a hard-coded set that happens to match that one movement).
 *
 * Also asserts route connectors are counted and distinguished from demand connectors via
 * `data-connector-kind` (review Important 4) — deleting every route connector while leaving the
 * demand connectors alone must turn this red, proven manually against the pre-fix component
 * before this assertion was accepted (see the task report).
 */
async function assertRoutedMatchesShortlist(diagram: Locator, movementId: string) {
  const movement = requireMovement(movementId);
  const shortlist = eligibleCandidates(movement, NOW_ANCHOR, PARALLEL_REFERRAL_CAP);
  const expectedUnitIds = shortlist.map((candidate) => candidate.unit.id).sort();

  const routed = diagram.locator('[data-routed="true"]');
  const routedCount = await routed.count();
  expect(routedCount, `${movementId}: routed count`).toBeGreaterThan(0);
  expect(routedCount, `${movementId}: routed count vs PARALLEL_REFERRAL_CAP`).toBeLessThanOrEqual(
    PARALLEL_REFERRAL_CAP,
  );
  const routedUnitIds = (await routed.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid"))))
    .map((testId) => String(testId).replace("ward-diagram-unit-", ""))
    .sort();
  expect(routedUnitIds, `${movementId}: routed unit identity`).toEqual(expectedUnitIds);

  const routeConnectors = diagram.locator('svg path[data-connector-kind="route"]');
  await expect(routeConnectors, `${movementId}: route connector count`).toHaveCount(routedCount);

  return { movement, shortlist };
}

/**
 * `.screen` sets `overflow: hidden`, so `document.documentElement` can never report an
 * overflow regardless of what breaks inside it — measuring the document was a test that could
 * not fail (Task 3 review Important 1). The region grid is the element whose track widths
 * actually constrain the five-region layout, so it is the element whose scroll box has to stay
 * within its client box.
 */
async function expectNoRegionGridOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="ward-coordinator-region-grid"]');
    if (!grid) return null;
    return grid.scrollWidth - grid.clientWidth;
  });
  expect(overflow).not.toBeNull();
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe("Ward Flow coordinator screen", () => {
  test.describe.configure({ timeout: 45_000 });

  test("presents the five coordination regions", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    await expect(page.getByRole("region", { name: "Emergency department pressure" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Priority queue" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Statewide flow" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Explainable shortlist" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Exceptions/ })).toBeVisible();

    await expectNoRegionGridOverflow(page);
  });

  // The equivalent coverage for these two lived on WardManagementConsole, which Task 3 stopped
  // rendering at /ward-management. Task 9 deletes that component; until then the behaviour has
  // no home on the coordinator screen and these stay fixme so the gap is visible in the runner
  // (not just in a ledger row) rather than silently dropped.

  // The shortlist region is still a placeholder (Task 7 builds the real explainable shortlist),
  // but its placeholder text already names the selected movement, so the wiring this test is
  // actually about — a queue click driving `selectedMovementId` through to that region, and a
  // second click moving the selection rather than adding to it — is real Task 5 behaviour with
  // a real home, not a gap. Task 7 replaces the shortlist body without touching this contract.
  test("queue selection drives the explainable shortlist", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });
    await expect(shortlist).toContainText("Select a movement");

    const rows = queue.locator('[data-testid^="ward-queue-row-"]');
    const firstRow = rows.first();
    const firstId = (await firstRow.getAttribute("data-testid"))?.replace("ward-queue-row-", "");
    await firstRow.click();
    await expect(firstRow).toHaveAttribute("aria-pressed", "true");
    await expect(shortlist).toContainText(String(firstId));

    // A second selection replaces the first rather than accumulating.
    const secondRow = rows.nth(1);
    const secondId = (await secondRow.getAttribute("data-testid"))?.replace("ward-queue-row-", "");
    await secondRow.click();
    await expect(secondRow).toHaveAttribute("aria-pressed", "true");
    await expect(firstRow).toHaveAttribute("aria-pressed", "false");
    await expect(shortlist).toContainText(String(secondId));
  });

  // Task 8: the exceptions drawer is the coordinator's work list, not a report. Collapsed by
  // default; its toggle's count and the drawer's own rendered rows must always agree (ruling 3 —
  // the "48 open movements" defect in miniature is a header count that disagrees with the rows
  // beneath it); selecting a row drives the same movement selection the queue does; and on a
  // phone the diagram and pressure strip disappear while the queue and exceptions stay reachable.
  test("keeps exceptions one tap away and collapses to a queue-first phone form", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const toggle = page.getByRole("button", { name: /Exceptions/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    const drawer = page.getByRole("region", { name: "Exceptions" });
    await expect(drawer).toBeVisible();
    const items = drawer.locator('[data-testid^="ward-exception-"]');
    await expect(items.first()).toBeVisible();

    // Ruling 3: the toggle's count must be the true count — exactly what the drawer renders,
    // computed independently here from the real fixture so a hard-coded toggle number cannot
    // pass by coincidence.
    // Whole-branch review Minor 6: the drawer is scoped to OPEN movements, so the independent
    // count here must be too — computing it over all 48 records would agree with a screen that
    // wrongly listed a closed patient's breached deadline.
    const expectedCount = buildActionInbox(wardMovements.filter(isOpen), NOW_ANCHOR).length;
    expect(expectedCount).toBeGreaterThan(1);
    await expect(items).toHaveCount(expectedCount);
    await expect(toggle).toContainText(String(expectedCount));

    // Review Important 2: "the true count" means every row the header claims is actually ON
    // SCREEN, not merely present in a DOM a nested scroller has clipped — a header reading "8"
    // over a box showing 4 is the same defect this ruling exists to prevent, just moved one
    // level down. Assert every row, not just the first, is really in the viewport.
    const itemCount = await items.count();
    for (let index = 0; index < itemCount; index += 1) {
      await expect(items.nth(index)).toBeInViewport();
    }

    // Review Critical 1: the shortlist `<aside>` renders unconditionally — it is already visible
    // before any click — so "is it visible" proves nothing about whether the drawer actually
    // drives selection. Click a SPECIFIC, known exception (WF-005) and assert both that the
    // shortlist names that exact movement and that the underlying queue row shows the same
    // movement as pressed, proving the drawer and the queue really are one shared selection.
    const wf005Item = drawer.locator('[data-testid*="-WF-005"]').first();
    await expect(wf005Item).toBeVisible();
    await wf005Item.click();
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });
    await expect(shortlist).toBeVisible();
    await expect(shortlist).toContainText("WF-005");
    await expect(page.getByTestId("ward-queue-row-WF-005")).toHaveAttribute("aria-pressed", "true");

    // Phone: queue and exceptions survive, the diagram and the pressure strip do not (Minor 6:
    // the brief required both hidden, not just the diagram), and nothing overflows.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("region", { name: "Priority queue" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Exceptions/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Statewide flow" })).toBeHidden();
    await expect(page.getByRole("region", { name: "Emergency department pressure" })).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);

    // Review Important 3: "one-tap confirm" means Confirm is actually reachable without a long
    // scroll once a movement is selected on the phone — not merely present somewhere on a page
    // that happens to be scrollable. Select via the drawer again (closing it in the same tap,
    // same as the desktop step above) and assert Confirm is in the viewport with no scrolling.
    await toggle.click();
    const phoneDrawer = page.getByRole("region", { name: "Exceptions" });
    await expect(phoneDrawer).toBeVisible();
    await phoneDrawer.locator('[data-testid*="-WF-005"]').first().click();
    await expect(page.getByTestId("ward-shortlist-refer")).toBeInViewport();
  });

  test("orders by clinical tier first and labels the score as operational, not clinical", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const rows = queue.locator('[data-testid^="ward-queue-row-"]');
    const rowCount = await rows.count();

    // A queue that renders zero rows must not be able to satisfy the ordering assertion below
    // by absence — `expect([]).toEqual([])` would otherwise pass silently if the tier badge
    // were ever removed from the row (Task 5 review Important 1). Pin the collected tier list
    // to the same length as the rendered rows, and require at least one row to exist.
    const tiers = await rows
      .locator("[data-tier]")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-tier"))));
    expect(rowCount).toBeGreaterThan(0);
    expect(tiers).toHaveLength(rowCount);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));

    // Within a tier, the operational score must be non-increasing — the queue's core claim
    // (Task 5 review Important 2). This reads the property off `data-score`, not a hard-coded
    // fixture value, so it still holds if the fixture data changes; inverting the tiebreak
    // comparator in `queueOrder` must turn this red.
    const rowKeys = await rows.evaluateAll((nodes) =>
      nodes.map((node) => ({
        tier: Number(node.querySelector("[data-tier]")?.getAttribute("data-tier")),
        score: Number(node.getAttribute("data-score")),
      })),
    );
    for (let i = 1; i < rowKeys.length; i++) {
      const prev = rowKeys[i - 1];
      const curr = rowKeys[i];
      if (curr.tier === prev.tier) {
        expect(
          curr.score,
          `row ${i} (tier ${curr.tier}, score ${curr.score}) must not outrank row ${i - 1} (score ${prev.score})`,
        ).toBeLessThanOrEqual(prev.score);
      }
    }

    // The score must never read as clinical severity.
    await expect(queue).toContainText("Operational");
    await expect(queue).not.toContainText("Severity");
    await expect(queue).not.toContainText("Acuity");

    // The rendered score is the derived one, not a constant or a stale placeholder (Task 5
    // review Important 3) — compare the first row against itself rather than importing the
    // derivation into this spec.
    const firstRow = rows.first();
    const firstRowScore = await firstRow.getAttribute("data-score");
    await expect(firstRow).toContainText(`Operational ${firstRowScore}`);

    // The breach line is the row a coordinator must not miss, and it must be able to vanish
    // silently for neither direction (Task 5 review Important 3).
    //
    // Task 6A fix round 1 corrected two errors this comment used to carry (WF-017 as "first
    // row", and "Form 2A" instead of "1A"). The clinician's "Bed need confirmed" factor, added
    // 2026-08-22, moves the goalposts a second time: a movement whose examination outcome is
    // recorded as `inpatient_order` now outranks one nobody has assessed at all, inside the
    // same tier. WF-009 and WF-017 both carry that confirmed need and both carry a Form 3B with
    // no `dueAt` (Task 6A deleted the fabricated one, so a 3B can never be breached) — they now
    // rank rows 1 and 2 ahead of WF-303, which carries the breached Form 1A but no confirmed
    // need. So `firstRow`/`secondRow` can no longer be used to prove the breach line renders —
    // by design, neither of the top two rows has one to render — and the breach-line assertion
    // is pinned by id instead, the same pattern the "shows a failing gate" test below already
    // uses for WF-017/WF-009 for the identical reason (a fixture fact tied to a specific
    // movement, not to whichever row currently ranks first).
    await expect(firstRow).not.toContainText("passed its deadline");
    const secondRow = rows.nth(1);
    await expect(secondRow).not.toContainText("passed its deadline");
    // Fixture assumption: WF-303 carries a breached Form 1A and no confirmed bed need, so it
    // must still show the breach line — it just no longer does so from row 1 or 2.
    const breachedRow = queue.locator('[data-testid="ward-queue-row-WF-303"]');
    await expect(breachedRow).toContainText("passed its deadline");

    // Selecting a movement drives the rest of the screen.
    await firstRow.click();
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });
    const selectedId = await queue.locator('[aria-pressed="true"]').getAttribute("data-testid");
    await expect(shortlist).toContainText(String(selectedId).replace("ward-queue-row-", ""));
  });

  test("ranks emergency departments worst first and filters the queue when one is chosen", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const strip = page.getByRole("region", { name: "Emergency department pressure" });
    const cards = strip.locator('[data-testid^="ward-ed-"]');
    await expect(cards).toHaveCount(8);

    // The worst department leads, and says why it is worst.
    const worst = cards.first();
    await expect(worst).toContainText("waiting");
    await expect(worst).toContainText("longest");

    // The rendered sequence itself is non-increasing on the two keys `edPressure` ranks by.
    // Asserting only that card 1 "contains some text" (above) stays true even if the rows were
    // reversed — this pins the ordering property instead (Task 4 review Important 1). It reads
    // the actual numeric sort keys off `data-breaching`/`data-longest-minutes` rather than
    // hard-coding "PEEL is first", so it keeps validating the rule if the fixture data changes.
    const sortKeys = await cards.evaluateAll((nodes) =>
      nodes.map((node) => ({
        breaching: Number(node.getAttribute("data-breaching")),
        longestMinutes: Number(node.getAttribute("data-longest-minutes")),
      })),
    );
    for (let i = 1; i < sortKeys.length; i++) {
      const prev = sortKeys[i - 1];
      const curr = sortKeys[i];
      const doesNotOutrankPrevious =
        curr.breaching < prev.breaching ||
        (curr.breaching === prev.breaching && curr.longestMinutes <= prev.longestMinutes);
      expect(
        doesNotOutrankPrevious,
        `card ${i} ${JSON.stringify(curr)} must not rank above card ${i - 1} ${JSON.stringify(prev)}`,
      ).toBe(true);
    }

    // Choosing one filters the queue to that department and says so — and to exactly that
    // department's own movements, not merely to some smaller set of the same rough size. A
    // filter that names the clicked department while quietly showing a different one's patients
    // is worse than no filter, and `after < before` alone cannot tell the two apart (Task 4
    // review Important 2).
    const worstEdId = (await worst.getAttribute("data-testid"))?.replace("ward-ed-", "");
    const worstWaiting = Number(await worst.getAttribute("data-waiting"));
    const queue = page.getByRole("region", { name: "Priority queue" });
    const before = await queue.locator('[data-testid^="ward-queue-row-"]').count();
    await worst.click();
    await expect(queue).toContainText("Filtered to");
    const rows = queue.locator('[data-testid^="ward-queue-row-"]');
    await expect(rows).toHaveCount(worstWaiting);
    const originIds = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-origin-ed")));
    for (const originId of originIds) {
      expect(originId).toBe(worstEdId);
    }
    expect(worstWaiting).toBeLessThan(before);

    // And clearing restores it.
    await queue.getByRole("button", { name: /Clear filter/ }).click();
    await expect(queue.locator('[data-testid^="ward-queue-row-"]')).toHaveCount(before);
  });

  test("draws the selected movement's routes from its department to its shortlisted units", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const diagram = page.getByRole("region", { name: "Statewide flow" });

    // Connector paths are drawn by a client layout effect — this is the hydration signal.
    await expect(diagram.locator("svg path[marker-end]").first()).toBeAttached({ timeout: 15_000 });

    // Every one of the 22 fixture units renders as its own node regardless of selection — a unit
    // whose service-group lookup silently fails must not just vanish from the count (review
    // Minor 6; `flow-diagram.tsx` renders an explicit "Unresolved health service" anomaly card
    // for exactly that case rather than dropping the unit).
    await expect(diagram.locator('[data-testid^="ward-diagram-unit-"]')).toHaveCount(22);

    // Demand connectors (department → hub) exist regardless of selection, always eight. No
    // movement is selected yet, so there must be zero route connectors — proving the two kinds
    // are distinguished by `data-connector-kind`, not merely by an incidental class name (review
    // Important 4).
    await expect(diagram.locator('svg path[data-connector-kind="demand"]')).toHaveCount(8);
    await expect(diagram.locator('svg path[data-connector-kind="route"]')).toHaveCount(0);

    // Excludes WF-009 by id. The clinician's "Bed need confirmed" factor (added 2026-08-22) can
    // put WF-009 at row 1 on the current fixture — see the "orders by clinical tier" test above
    // — and the contrast this test needs below only holds if the two clicked movements are
    // genuinely different. Without the exclusion, "row 1" and "WF-009" could silently become the
    // same movement and the second assertion would pass by tautology rather than by proof.
    const firstRow = page
      .getByRole("region", { name: "Priority queue" })
      .locator('[data-testid^="ward-queue-row-"]:not([data-testid="ward-queue-row-WF-009"])')
      .first();
    const movementId = (await firstRow.getAttribute("data-testid"))?.replace("ward-queue-row-", "");
    expect(movementId, "the first queue row must carry a real movement id").toBeTruthy();
    expect(movementId, "the exclusion above must keep this genuinely different from WF-009").not.toBe("WF-009");
    await firstRow.click();

    const { movement } = await assertRoutedMatchesShortlist(diagram, String(movementId));

    // The origin department is marked, and it is the selected movement's own — not merely
    // some department, which a hard-coded card would also satisfy.
    const origin = diagram.locator('[data-origin="true"]');
    await expect(origin).toHaveCount(1);
    await expect(origin).toHaveAttribute("data-testid", `ward-diagram-ed-${movement.originEdId}`);

    // Review Important 3: the identity assertion above must hold for more than the one movement
    // selected above. WF-009 has an entirely different shortlist (proven separately, in the
    // ineligible-routes test below, to also be an entirely different eligibility outcome) — a
    // hard-coded routed set that coincidentally matched the first movement's shortlist would
    // fail here instead of passing by coincidence.
    await page.getByRole("region", { name: "Priority queue" }).locator('[data-testid="ward-queue-row-WF-009"]').click();
    await assertRoutedMatchesShortlist(diagram, "WF-009");
  });

  test("marks an ineligible shortlisted unit as not currently placeable, not as a routed destination", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const diagram = page.getByRole("region", { name: "Statewide flow" });
    await expect(diagram.locator("svg path[marker-end]").first()).toBeAttached({ timeout: 15_000 });

    const movement = requireMovement("WF-009");
    const shortlist = eligibleCandidates(movement, NOW_ANCHOR, PARALLEL_REFERRAL_CAP);
    // This test's whole premise is a shortlist with ZERO eligible candidates — WF-009 has been
    // declined by five units, and its three cohort-matching candidates (since `eligibleCandidates`
    // sorts eligible-first but never filters) are all ineligible: two already declined it, one fails
    // the security gate. If the fixture ever changes so this stops being true, the assertions
    // below must fail loudly here rather than vacuously pass on an empty or partially-eligible
    // set.
    expect(shortlist.length).toBeGreaterThan(0);
    expect(shortlist.every((candidate) => !candidate.verdict.eligible)).toBe(true);

    await page.getByRole("region", { name: "Priority queue" }).locator('[data-testid="ward-queue-row-WF-009"]').click();

    // Every routed node is marked not-eligible on the node itself...
    const routed = diagram.locator('[data-routed="true"]');
    await expect(routed).toHaveCount(shortlist.length);
    const eligibleFlags = await routed.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-eligible")));
    for (const flag of eligibleFlags) {
      expect(flag).toBe("false");
    }

    // ...and states its own specific reason as real text (never colour alone — must survive
    // forced-colors — and never a generic "not eligible", proving `candidateReason(verdict)`
    // actually reaches the DOM for each unit, not just a shared placeholder).
    for (const candidate of shortlist) {
      const node = diagram.locator(`[data-testid="ward-diagram-unit-${candidate.unit.id}"]`);
      await expect(node).toContainText(candidateReason(candidate.verdict));
    }

    // The connector lines themselves are marked ineligible too, so the arrow cannot read as an
    // endorsement the node's own text denies.
    const routeConnectors = diagram.locator('svg path[data-connector-kind="route"]');
    await expect(routeConnectors).toHaveCount(shortlist.length);
    const connectorFlags = await routeConnectors.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-eligible")),
    );
    for (const flag of connectorFlags) {
      expect(flag).toBe("false");
    }

    // The hub states the true eligible count — zero — never the shortlist size framed as routes.
    await expect(diagram).toContainText(`no eligible destination; ${shortlist.length} candidates, all excluded`);
  });

  test("distinguishes an accepted destination from an outstanding referral, and shows every parallel referral", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const diagram = page.getByRole("region", { name: "Statewide flow" });
    await expect(diagram.locator("svg path[marker-end]").first()).toBeAttached({ timeout: 15_000 });
    const queue = page.getByRole("region", { name: "Priority queue" });

    // WF-017 has an outstanding referral to BTY Adult Secure and no acceptance yet —
    // `destinationUnit`'s single conflated field (`acceptedUnitId ?? referredUnitIds[0]`) used
    // to badge this "Current recorded destination", which reads as an acceptance that has not
    // happened (review Important 2).
    await queue.locator('[data-testid="ward-queue-row-WF-017"]').click();
    const bty = diagram.locator('[data-testid="ward-diagram-unit-bty-adult-secure"]');
    await expect(bty).toHaveAttribute("data-referred", "true");
    await expect(bty).not.toHaveAttribute("data-accepted", "true");
    await expect(bty).toContainText("Outstanding referral");
    await expect(bty).not.toContainText("Accepted destination");

    // WF-013 carries two parallel referrals — both must be visible, not only
    // `referredUnitIds[0]`.
    await queue.locator('[data-testid="ward-queue-row-WF-013"]').click();
    await expect(diagram.locator('[data-testid="ward-diagram-unit-bty-older-adult"]')).toHaveAttribute(
      "data-referred",
      "true",
    );
    await expect(diagram.locator('[data-testid="ward-diagram-unit-gry-older-adult"]')).toHaveAttribute(
      "data-referred",
      "true",
    );

    // WF-003 has an actual acceptance — a different fact, with a different badge.
    await queue.locator('[data-testid="ward-queue-row-WF-003"]').click();
    const accepted = diagram.locator('[data-testid="ward-diagram-unit-rph-adult-secure"]');
    await expect(accepted).toHaveAttribute("data-accepted", "true");
    await expect(accepted).toContainText("Accepted destination");
    await expect(accepted).not.toContainText("Outstanding referral");
  });

  /**
   * Whole-branch review Important 3: routes were drawn only to the three candidates, so for 18 of
   * the 41 open movements the unit the patient is actually going to had no connector at all while
   * three arrows pointed at wards they are not going to — and the hub read "WF-004 — 3 eligible
   * destinations" for a movement whose bed is already held elsewhere.
   *
   * WF-004 is the case the review named: its accepted unit is NOT among its candidates, so before
   * the fix its destination connector count was zero. Both halves are asserted — the connector
   * exists and is its own kind, and the hub leads with the recorded fact rather than a candidate
   * count.
   */
  test("draws the recorded destination as its own connector and says so at the hub", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const diagram = page.getByRole("region", { name: "Statewide flow" });
    await expect(diagram.locator("svg path[marker-end]").first()).toBeAttached({ timeout: 15_000 });
    const queue = page.getByRole("region", { name: "Priority queue" });

    const wf004 = requireMovement("WF-004");
    const acceptedUnitId = wf004.acceptedUnitId;
    expect(acceptedUnitId, "fixture assumption: WF-004 has an accepted destination").toBeTruthy();
    const candidateIds = eligibleCandidates(wf004, NOW_ANCHOR, PARALLEL_REFERRAL_CAP).map(
      (candidate) => candidate.unit.id,
    );
    expect(
      candidateIds,
      "fixture assumption: WF-004's accepted unit is not one of its candidates, so only the destination connector can reach it",
    ).not.toContain(acceptedUnitId);

    await queue.locator('[data-testid="ward-queue-row-WF-004"]').click();

    const destinationConnectors = diagram.locator('svg path[data-connector-kind="destination"]');
    await expect(destinationConnectors).toHaveCount(1);
    await expect(destinationConnectors).toHaveAttribute("data-recorded", "accepted");

    // The hub leads with the recorded destination, and never claims the movement is looking for
    // three of them.
    await expect(diagram).toContainText("accepted destination:");
    await expect(diagram).not.toContainText("WF-004 — 3 eligible destinations");

    // An outstanding referral is a different recorded fact and gets its own connector too —
    // WF-013 carries two, so a single-referral implementation (`referredUnitIds[0]`) fails here.
    const wf013 = requireMovement("WF-013");
    expect(wf013.referredUnitIds.length, "fixture assumption: WF-013 carries two parallel referrals").toBe(2);
    await queue.locator('[data-testid="ward-queue-row-WF-013"]').click();
    await expect(diagram.locator('svg path[data-connector-kind="destination"]')).toHaveCount(2);
    await expect(diagram.locator('svg path[data-connector-kind="destination"]').first()).toHaveAttribute(
      "data-recorded",
      "referred",
    );

    // A movement with no recorded destination draws none — the connector reports a fact, never a
    // suggestion dressed as one.
    const wf009 = requireMovement("WF-009");
    expect(wf009.acceptedUnitId).toBeUndefined();
    expect(wf009.referredUnitIds).toHaveLength(0);
    await queue.locator('[data-testid="ward-queue-row-WF-009"]').click();
    await expect(diagram.locator('svg path[data-connector-kind="destination"]')).toHaveCount(0);
  });

  /**
   * Whole-branch review Important 5: `eligibility()` passes a Secure ward for an Open movement with
   * the affirmative detail "Secure ward meets an open requirement", marked "Met" — so the screen
   * offers a locked ward to a patient who does not need one, and can label it "Suggested
   * destination". `ward-eligibility.ts` is a protected surface, so the gate is deliberately
   * unchanged and the fact is surfaced instead. This pins that it really reaches the DOM, on the
   * shortlist and on the diagram, and that it does NOT appear where it would be false.
   */
  test("states plainly when a candidate ward is more restrictive than the movement requires", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });
    const diagram = page.getByRole("region", { name: "Statewide flow" });
    await expect(diagram.locator("svg path[marker-end]").first()).toBeAttached({ timeout: 15_000 });

    // WF-001 is an OPEN-status movement whose top candidate is a locked ward that passes every
    // gate — the exact pairing the review found.
    const wf001 = requireMovement("WF-001");
    expect(wf001.security, "fixture assumption: WF-001 is an open-status movement").toBe("Open");
    const candidates = eligibleCandidates(wf001, NOW_ANCHOR, PARALLEL_REFERRAL_CAP);
    const locked = candidates.filter((candidate) => candidate.unit.security === "Secure");
    const open = candidates.filter((candidate) => candidate.unit.security === "Open");
    expect(locked.length, "fixture assumption: WF-001 has at least one locked-ward candidate").toBeGreaterThan(0);
    expect(
      open.length,
      "fixture assumption: WF-001 also has an open-ward candidate, so this is not blanket text",
    ).toBeGreaterThan(0);

    await queue.locator('[data-testid="ward-queue-row-WF-001"]').click();

    // The locked candidates say so on their own rows; the open one does not. Both the shortlist
    // row and the diagram node now read `restrictionNotice`'s own wording (flow-diagram fix:
    // the diagram used to read the older, superseded `MORE_RESTRICTIVE_NOTE` text and diverge
    // from the shortlist here — it no longer does, so both assertions use the same string).
    for (const candidate of locked) {
      await expect(shortlist.locator(`[data-testid="ward-shortlist-candidate-${candidate.unit.id}"]`)).toContainText(
        "More restrictive than this movement requires",
      );
      await expect(diagram.locator(`[data-testid="ward-diagram-unit-${candidate.unit.id}"]`)).toContainText(
        "More restrictive than this movement requires",
      );
    }
    for (const candidate of open) {
      await expect(
        shortlist.locator(`[data-testid="ward-shortlist-candidate-${candidate.unit.id}"]`),
      ).not.toContainText("More restrictive than this movement requires");
    }

    // And it is stated at the moment of decision — above the gate list, where the security check
    // reads "Met" — for whichever unit's gates are on screen.
    await shortlist.locator(`[data-testid="ward-shortlist-candidate-${locked[0].unit.id}"]`).click();
    await expect(shortlist.getByTestId("ward-shortlist-restrictive-note")).toBeVisible();
    await expect(shortlist.locator('[data-testid="ward-gate-security"][data-pass="true"]')).toHaveCount(1);
    await shortlist.locator(`[data-testid="ward-shortlist-candidate-${open[0].unit.id}"]`).click();
    await expect(shortlist.getByTestId("ward-shortlist-restrictive-note")).toHaveCount(0);

    // A Secure movement on a Secure ward is a plain match — the note must not appear there, or it
    // would be noise a coordinator learns to ignore.
    await queue.locator('[data-testid="ward-queue-row-WF-004"]').click();
    await expect(shortlist).not.toContainText("More restrictive than this movement requires");
  });

  /**
   * Flow-diagram fix: `flow-diagram.tsx` used to compute its restriction badge with the
   * superseded `isMoreRestrictiveThanRequired`, which only recognises Open-movement-on-Secure-
   * ward. It returns false for a Voluntary movement on a Secure ward, so the diagram rendered
   * nothing at all for the sharper case the shortlist already flags. The test above (WF-001,
   * Open/non-Voluntary) only ever exercised the milder `more_restrictive` level — this pins the
   * `voluntary_on_locked` one, which is the case this fix exists for.
   *
   * WF-301 is selected by id, never by queue rank — rank-based selection has broken three other
   * tests in this phase. Re-measured against the real fixture: 26 Voluntary movements exist, and
   * 4 of them also carry `security: "Secure"` — WF-301, WF-308, WF-322, WF-329. WF-301's cohort
   * is Adult, so all three of its shortlisted candidates are the Secure adult wards
   * (`rph-adult-secure`, `fsh-adult-secure`, `rgh-adult-secure`), every one eligible — verified
   * with `eligibleCandidates` below rather than assumed, so this test fails loudly instead of
   * silently no-op'ing if the fixture ever changes underneath it.
   */
  test("gives a voluntary patient on a locked ward its own, more prominent notice on the diagram", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });
    const diagram = page.getByRole("region", { name: "Statewide flow" });
    await expect(diagram.locator("svg path[marker-end]").first()).toBeAttached({ timeout: 15_000 });

    const wf301 = requireMovement("WF-301");
    expect(wf301.legalStatus, "fixture assumption: WF-301 is a Voluntary movement").toBe("Voluntary");
    const candidates = eligibleCandidates(wf301, NOW_ANCHOR, PARALLEL_REFERRAL_CAP);
    const locked = candidates.filter((candidate) => candidate.unit.security === "Secure");
    expect(locked.length, "fixture assumption: WF-301 has at least one Secure shortlisted candidate").toBeGreaterThan(
      0,
    );

    await queue.locator('[data-testid="ward-queue-row-WF-301"]').click();

    for (const candidate of locked) {
      const shortlistRow = shortlist.locator(`[data-testid="ward-shortlist-candidate-${candidate.unit.id}"]`);
      await expect(shortlistRow).toContainText(
        "Voluntary patient on a locked ward — review legal status before admission",
      );

      // The case that renders nothing today: the diagram node must carry the same
      // `restrictionNotice` wording as the shortlist, not silence.
      const diagramNode = diagram.locator(`[data-testid="ward-diagram-unit-${candidate.unit.id}"]`);
      await expect(diagramNode).toContainText(
        "Voluntary patient on a locked ward — review legal status before admission",
      );
      // And it must be the sharper, danger-toned variant, not the plain over-restrictive one —
      // the two levels are visually distinguished by `data-level`, not merely by wording.
      await expect(diagramNode.locator('[data-level="voluntary_on_locked"]')).toHaveCount(1);
    }
  });

  /**
   * Task 7's own controller finding: the whole-branch review found a green tick rendered beside
   * "SJGS Adult Open is not authorised under the Mental Health Act". This test pins the fix at the
   * DOM level, not just at the derivation level (`ward-eligibility.test.ts` already proves the
   * gate logic itself).
   *
   * The brief's own draft of this test clicked queue row 1 and only conditionally checked a
   * failing gate's icon (`if (await failing.count())`) — but WF-017's default candidate
   * (`rph-adult-secure`) passes all eight gates, so that conditional block would silently skip
   * whenever row 1 lands on a clean movement like WF-017, exactly the "test that cannot fail"
   * shape Phase 1 shipped once already. WF-009 (declined by five units, whose own three
   * candidates are all ineligible — see `ward-derivations.ts`) is used instead to guarantee a
   * failing gate is actually on screen (Ruling 3), and the confirm journey is walked end to end
   * rather than merely checking a button is visible (Ruling 4).
   *
   * Task 6A fix round 1: queue row 1 used to be WF-017 only because a fabricated Form 3B
   * deadline (deleted in Task 6A) inflated its operational score; WF-303 and WF-009 ranked
   * first and second by `queueOrder` on that fixture instead. The clinician's "Bed need
   * confirmed" factor (added 2026-08-22 — a movement whose examination outcome is recorded as
   * `inpatient_order` now outranks one nobody has assessed, inside its tier) reorders it again:
   * WF-009 and WF-017 both carry that confirmed need and now rank rows 1 and 2, ahead of
   * WF-303. This test selects both WF-017 and WF-009 explicitly by id rather than by row
   * position, so it does not depend on either fixture's ordering. WF-017's default candidate
   * still passes all eight gates (re-verified against the current fixture), so the
   * clean-vs-failing contrast this test depends on still holds; WF-009 still guarantees a
   * failing gate on its own default candidate regardless of which row it renders in.
   */
  test("shows a failing gate as a failure and never auto-allocates", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

    // WF-017: selected explicitly by id, not by row position — it no longer ranks first in the
    // queue now that Task 6A deleted the fabricated deadline that used to inflate its score (see
    // comment above), but its default candidate still passes all eight gates. Every gate row
    // states its own verdict in text, not only by icon, and all eight gates are rendered — never
    // a `.slice()`.
    await queue.locator('[data-testid="ward-queue-row-WF-017"]').click();
    const wf017Gates = shortlist.locator('[data-testid^="ward-gate-"]');
    await expect(wf017Gates).toHaveCount(8);
    for (const gate of await wf017Gates.all()) {
      const pass = await gate.getAttribute("data-pass");
      await expect(gate).toContainText(pass === "true" ? "Met" : "Not met");
    }

    // Nothing is allocated until a human refers — before any candidate selection or click.
    await expect(shortlist).toContainText("No automatic allocation");
    await expect(shortlist).not.toContainText("Referred by a human coordinator");
    await expect(shortlist).not.toContainText("Overridden by a human coordinator");
    await expect(shortlist.getByRole("button", { name: /Refer/ })).toBeVisible();

    // WF-009: guaranteed to surface a failing gate on its default candidate, unlike WF-017
    // above — this is the unconditional proof the brief's own guarded assertion could skip.
    // Selected by id, not by row position, so it does not matter which row it currently ranks.
    await queue.locator('[data-testid="ward-queue-row-WF-009"]').click();
    const wf009Gates = shortlist.locator('[data-testid^="ward-gate-"]');
    await expect(wf009Gates).toHaveCount(8);
    for (const gate of await wf009Gates.all()) {
      const pass = await gate.getAttribute("data-pass");
      await expect(gate).toContainText(pass === "true" ? "Met" : "Not met");
    }

    // A failing gate never renders the success icon. Note the selector: lucide-react emits
    // `lucide-circle-check` for `CheckCircle2`, not `lucide-check-circle-2` — the class Phase 1
    // asserted on, which could never fail regardless of what the icon actually was. Paired with a
    // present-icon assertion on the same row so this cannot pass merely because both icons are
    // absent (Ruling 3).
    const failing = shortlist.locator('[data-testid^="ward-gate-"][data-pass="false"]');
    await expect(failing.first()).toBeVisible();
    await expect(failing.first().locator("svg.lucide-circle-check")).toHaveCount(0);
    await expect(failing.first().locator("svg.lucide-circle-alert")).toHaveCount(1);

    // Selecting an ineligible candidate (WF-009's default) leaves referring unavailable, with
    // the reason stated rather than the control silently vanishing. Nothing has been clicked on
    // this movement yet, so this is really "nothing selected" — the same guard the default-candidate
    // test below exercises directly.
    const referButton = shortlist.getByRole("button", { name: /Refer/ });
    await expect(referButton).toHaveAttribute("aria-disabled", "true");
    await expect(shortlist).not.toContainText("Referred by a human coordinator");

    // Selecting WF-017's own eligible candidate makes referring available, and referring
    // records a real human decision on screen — never an automatic allocation triggered by
    // merely selecting a row. Fix round 1: the record is `movement.referredUnitIds` itself
    // (the "Parallel referral" badge), never a local optimistic flag, so this also proves the
    // dispatch actually reached shared state rather than merely toggling local UI. WF-017
    // already carries its own pre-existing "Parallel referral: BTY Adult Secure" from the
    // fixture, so the pre-click assertion checks the SPECIFIC new referral is absent, not the
    // phrase overall.
    await queue.locator('[data-testid="ward-queue-row-WF-017"]').click();
    await shortlist.locator('[data-testid="ward-shortlist-candidate-rph-adult-secure"]').click();
    await expect(referButton).not.toHaveAttribute("aria-disabled", "true");
    await expect(shortlist).not.toContainText("Parallel referral: RPH Adult Secure");
    await referButton.click();
    await expect(shortlist).toContainText("Parallel referral: RPH Adult Secure");
  });

  /**
   * Whole-branch review Critical 2, carried into Task 5. `ShortlistPanel` defaults `activeUnit`
   * to `shortlist[0]` so the gate list is never empty, but Refer and Override now act only on
   * `referTargets` — the real, explicit multi-select state a candidate-row click drives — never
   * on that default. On WF-004 (stage `bed_held`, accepted destination BTY Adult Secure) the
   * default is RPH Adult Secure; a default that Refer could act on would be an auto-allocation
   * with one tap of consent, which is the single thing this phase claims it never does.
   *
   * Proven red before the fix: with `canRefer` restored to `activeUnit !== undefined && ...`,
   * the first `aria-disabled` assertion below fails on WF-017 (whose default candidate is
   * eligible), and the WF-004 half records a referral against a unit nobody selected.
   */
  test("never refers or overrides against a default candidate the coordinator did not choose", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });
    const referButton = shortlist.getByTestId("ward-shortlist-refer");
    const overrideToggle = shortlist.getByTestId("ward-shortlist-override-toggle");

    // WF-017's default candidate passes all eight gates, so "unavailable" here cannot be an
    // accident of ineligibility — it can only be the missing human selection. Pinned against the
    // real fixture so this test fails loudly rather than passing vacuously if that changes.
    const wf017 = requireMovement("WF-017");
    const wf017Default = eligibleCandidates(wf017, NOW_ANCHOR, PARALLEL_REFERRAL_CAP)[0];
    expect(wf017Default, "fixture assumption: WF-017 has at least one candidate").toBeTruthy();
    expect(
      wf017Default.verdict.eligible,
      "fixture assumption: WF-017's default candidate is eligible, so only the missing selection can block Refer",
    ).toBe(true);

    await queue.locator('[data-testid="ward-queue-row-WF-017"]').click();

    // The default candidate's gates are shown (orientation is fine)...
    await expect(shortlist.locator('[data-testid^="ward-gate-"]')).toHaveCount(8);
    // ...but nothing on screen claims a human pressed anything.
    await expect(shortlist.locator('[data-testid^="ward-shortlist-candidate-"][aria-pressed="true"]')).toHaveCount(0);

    // ...and BOTH halves of the human decision are unavailable, each saying why rather than
    // silently doing nothing. Override is not a lesser path — the governing rule is "a human
    // confirms OR overrides, always, with the reason recorded" — so a coordinator blocked from
    // referring an un-chosen default must not be able to override straight into it.
    await expect(referButton).toHaveAttribute("aria-disabled", "true");
    await expect(overrideToggle).toHaveAttribute("aria-disabled", "true");
    await expect(shortlist).toContainText("Choose at least one candidate ward before referring");
    await expect(shortlist).toContainText("Choose at least one candidate ward before overriding");
    // `force` because Playwright's actionability check already refuses an `aria-disabled` control.
    // Bypassing it is the stronger proof: even a real activation must record nothing, since the
    // repo's unavailable-control pattern keeps the button focusable and clickable by design (it is
    // `aria-disabled` + an inert handler, never native `disabled`, so the stated reason stays
    // reachable to a keyboard and screen-reader user).
    await referButton.click({ force: true });
    await expect(shortlist).not.toContainText("Referred by a human coordinator");

    // A forced activation of Override must not even open the reason form — if it opened, the
    // textarea would be addressed to the default unit and one submission would record an override
    // against a ward nobody picked.
    await overrideToggle.click({ force: true });
    await expect(overrideToggle).toHaveAttribute("aria-expanded", "false");
    await expect(shortlist.getByLabel(/Reason for overriding/)).toHaveCount(0);
    await expect(shortlist).not.toContainText("Overridden by a human coordinator");

    // Choosing a candidate is what makes both available. Fix round 1: the record below is
    // `movement.referredUnitIds` itself (the "Parallel referral" badge), never a local
    // optimistic flag.
    await shortlist.locator(`[data-testid="ward-shortlist-candidate-${wf017Default.unit.id}"]`).click();
    await expect(referButton).not.toHaveAttribute("aria-disabled", "true");
    await expect(overrideToggle).not.toHaveAttribute("aria-disabled", "true");
    await referButton.click();
    await expect(shortlist).toContainText(`Parallel referral: ${wf017Default.unit.name}`);

    // WF-004 is the worst case the review found: a bed is already held elsewhere, and the default
    // candidate is a different ward entirely. The screen must never assert two destinations for
    // one patient off a single tap.
    const wf004 = requireMovement("WF-004");
    expect(wf004.acceptedUnitId, "fixture assumption: WF-004 has an accepted destination").toBeTruthy();
    const wf004Default = eligibleCandidates(wf004, NOW_ANCHOR, PARALLEL_REFERRAL_CAP)[0];
    expect(
      wf004Default.unit.id,
      "fixture assumption: WF-004's default candidate is NOT its accepted destination",
    ).not.toBe(wf004.acceptedUnitId);

    await queue.locator('[data-testid="ward-queue-row-WF-004"]').click();
    await expect(shortlist).toContainText("Accepted destination:");
    await expect(referButton).toHaveAttribute("aria-disabled", "true");
    await expect(overrideToggle).toHaveAttribute("aria-disabled", "true");
    await referButton.click({ force: true });
    await overrideToggle.click({ force: true });
    await expect(shortlist).not.toContainText("Referred by a human coordinator");
    await expect(shortlist).not.toContainText("Overridden by a human coordinator");
  });

  /**
   * Task 7 review Important 1: reversing the gate-list comparator to put failures LAST left the
   * rest of the suite green, because every other assertion checks text/icon correctness per row,
   * not the row ORDER. This pins the order itself, independent of gate count or wording, so a
   * future edit that buries a failing gate anywhere but first is caught regardless of exactly how
   * many gates fail.
   */
  test("keeps failing gates ordered before passing gates", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

    // WF-009's default candidate (RPH Adult Secure) fails exactly one of the eight gates
    // (prior_decline) — enough to prove ordering without depending on how many gates fail.
    await queue.locator('[data-testid="ward-queue-row-WF-009"]').click();
    const passFlags = await shortlist
      .locator('[data-testid^="ward-gate-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-pass")));
    expect(passFlags).toHaveLength(8);
    const lastFalseIndex = passFlags.lastIndexOf("false");
    const firstTrueIndex = passFlags.indexOf("true");
    expect(
      lastFalseIndex,
      "at least one failing gate must be present for this assertion to mean anything",
    ).toBeGreaterThanOrEqual(0);
    expect(
      firstTrueIndex,
      "at least one passing gate must be present for this assertion to mean anything",
    ).toBeGreaterThanOrEqual(0);
    expect(lastFalseIndex, "every failing gate must render before every passing gate").toBeLessThan(firstTrueIndex);
  });

  /**
   * Task 7 review Important 2: adding `.slice(0, 3)` to the declines list silently dropped two of
   * WF-009's five recorded declines and the suite stayed green, because nothing previously counted
   * the rendered rows against the movement's own real decline count.
   */
  test("renders every recorded decline, never a truncated subset", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

    const movement = requireMovement("WF-009");
    expect(movement.declines.length, "fixture assumption: WF-009 carries five declines").toBe(5);

    await queue.locator('[data-testid="ward-queue-row-WF-009"]').click();
    await expect(shortlist.locator('[data-testid="ward-decline-row"]')).toHaveCount(movement.declines.length);
  });

  /**
   * Task 7 review Important 3: replacing the eligible-only lookup with the shortlist's raw first
   * entry labels an INELIGIBLE unit "Suggested destination" on a movement like WF-009 (all three
   * candidates ineligible) — precisely what ruling 5 forbids, since it would recommend a
   * ward that already refused the patient. The suite stayed green under that mutation because
   * nothing previously asserted the label's absence on an all-ineligible movement.
   */
  test("never labels an ineligible candidate as the suggested destination", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

    // WF-009: every one of its three candidates is ineligible, so there is no unit this
    // panel may honestly suggest.
    await queue.locator('[data-testid="ward-queue-row-WF-009"]').click();
    await expect(shortlist).not.toContainText("Suggested destination");
    await expect(shortlist).toContainText("No eligible destination found yet.");

    // WF-017: carries a recorded outstanding referral (a fact, never a computed suggestion), so
    // "Suggested destination" must not appear here either. That referral — BTY Adult Secure,
    // selectable via the diagram's shared selection state — passes every gate, so presenting it
    // as fact carries no hidden risk of recommending a failing unit.
    await queue.locator('[data-testid="ward-queue-row-WF-017"]').click();
    await expect(shortlist).toContainText("Parallel referral: BTY Adult Secure");
    await expect(shortlist).not.toContainText("Suggested destination");

    const diagram = page.getByRole("region", { name: "Statewide flow" });
    await diagram.locator('[data-testid="ward-diagram-unit-bty-adult-secure"]').click();
    const btyGates = shortlist.locator('[data-testid^="ward-gate-"]');
    await expect(btyGates).toHaveCount(8);
    await expect(shortlist.locator('[data-testid^="ward-gate-"][data-pass="false"]')).toHaveCount(0);
  });

  /**
   * Task 7 review Important 4: override is half of the phase's central governance claim ("a human
   * confirms OR overrides, always, with the reason recorded"), and previously had zero test
   * coverage in either ward spec — proven only by reading the source. This walks it end to end:
   * reachable, reason-gated (an empty submission records nothing), and the recorded reason is
   * visible on screen afterwards.
   */
  test("the override path is a real, reason-gated confirmation path", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

    // WF-009: every candidate is ineligible, so override is the only human path that can
    // place a patient here — exactly the scenario the control exists for.
    await queue.locator('[data-testid="ward-queue-row-WF-009"]').click();

    const overrideToggle = shortlist.getByTestId("ward-shortlist-override-toggle");
    await expect(overrideToggle).toBeVisible();
    // Override, like Confirm, acts only on a candidate a human explicitly chose — never on the
    // panel's default (whole-branch review Critical 2, extended to the other half of the control
    // pair). Choosing RPH Adult Secure is what a coordinator would really do before overriding into
    // it, and it is the same unit the recorded override below must name.
    await expect(overrideToggle).toHaveAttribute("aria-disabled", "true");
    await shortlist.locator('[data-testid="ward-shortlist-candidate-rph-adult-secure"]').click();
    await expect(overrideToggle).not.toHaveAttribute("aria-disabled", "true");
    await overrideToggle.click();

    const reasonField = shortlist.getByLabel(/Reason for overriding/);
    const submitButton = shortlist.getByRole("button", { name: "Record override" });
    await expect(reasonField).toBeVisible();

    // A reason is required — submitting empty must record nothing.
    await submitButton.click();
    await expect(shortlist).not.toContainText("Overridden by a human coordinator");

    // A real reason produces a real, human-attributed record, visible on screen.
    const reasonText = "Duty psychiatrist directs placement despite the prior decline; bed confirmed by phone.";
    await reasonField.fill(reasonText);
    await submitButton.click();
    await expect(shortlist).toContainText("Overridden by a human coordinator");
    await expect(shortlist).toContainText(reasonText);
    await expect(shortlist).toContainText("RPH Adult Secure");
  });

  /**
   * Task 5: the screen goes live. Selecting a candidate row is what makes Refer available —
   * never a default — and Refer dispatches a real `REFER_TO_UNITS` event through the provider,
   * so the referral is a fact in shared state (`movement.referredUnitIds`), not merely a local
   * "you clicked a button" note. The Correction applied to this task's brief: the candidate rows
   * use `data-testid="ward-shortlist-candidate-<unit id>"` (never `ward-candidate-`), and the
   * primary control is `data-testid="ward-shortlist-refer"` labelled "Refer" — Tasks 7 and 12
   * both select on that testid.
   */
  test("refers a patient to up to three wards and records what it did", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    // Task 6A note: this used to click the queue's top row, which happened to always be WF-017
    // — not because WF-017 legitimately ranks first, but because its now-deleted fabricated
    // Form 3B deadline artificially inflated its operational score to the top. With that fixed,
    // the genuine top-ranked movement can legitimately be in any stage (today it is a generated
    // movement in a non-referable stage), which this test — about the refer/shortlist mechanism,
    // not queue rank — was never meant to depend on. WF-002 (destination_review, no legal form
    // at all) is a stable, always-referable movement, selected explicitly by id like every other
    // test in this file already does.
    await queue.locator('[data-testid="ward-queue-row-WF-002"]').click();

    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

    // Nothing is referable until a human picks a ward.
    const refer = shortlist.getByRole("button", { name: /Refer/ });
    await expect(refer).toHaveAttribute("aria-disabled", "true");

    await shortlist.locator('[data-testid^="ward-shortlist-candidate-"]').first().click();
    await expect(refer).not.toHaveAttribute("aria-disabled", "true");
    await refer.click();

    // The referral is recorded on the screen, and the parallel cap is stated.
    await expect(shortlist).toContainText(/parallel referral/i);
    await expect(shortlist).not.toContainText(/Confirm placement/);
  });

  /**
   * Task 5 fix round 1, Finding 1. `REFER_TO_UNITS` only accepts a movement at
   * `placement_requested` or `destination_review`; WF-004 sits at `bed_held` — still open, still
   * offering an eligible-shaped candidate on its shortlist — so Refer must never be reachable
   * there, and must never claim success even under a forced activation. `force` is the stronger
   * proof than merely checking `aria-disabled`: it proves the handler itself is inert, not only
   * that the control looks disabled (the repo's `aria-disabled` pattern keeps a control
   * focusable and clickable by design, so a forced click is a real, reachable activation).
   */
  test("never claims a referral succeeded on a non-referable movement", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const wf004 = requireMovement("WF-004");
    expect(wf004.stage, "fixture assumption: WF-004 sits in a non-referable stage").toBe("bed_held");
    const wf004Default = eligibleCandidates(wf004, NOW_ANCHOR, PARALLEL_REFERRAL_CAP)[0];
    expect(
      wf004Default,
      "fixture assumption: WF-004 still has a candidate on offer despite being non-referable",
    ).toBeTruthy();

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

    await queue.locator('[data-testid="ward-queue-row-WF-004"]').click();
    await shortlist.locator(`[data-testid="ward-shortlist-candidate-${wf004Default.unit.id}"]`).click();

    const refer = shortlist.getByRole("button", { name: /Refer/ });
    await expect(refer).toHaveAttribute("aria-disabled", "true");
    // The stated reason names the movement's own real stage, never a generic string.
    await expect(refer).toHaveAttribute("title", /bed held/i);

    await refer.click({ force: true });
    await expect(shortlist).not.toContainText("Parallel referral");
    await expect(shortlist).not.toContainText("Referred by a human coordinator");
  });

  /**
   * Task 5 fix round 1, Finding 3: the first version of this test opened Exceptions with zero
   * rejections ever raised and asserted `/refus/i`, which the empty-state copy itself contains —
   * it could only ever catch the whole region disappearing. This raises a genuine refusal first
   * (WF-004 again: Refer is unreachable there, but Override is deliberately NOT stage-gated —
   * see the comment above `canOverride` in `shortlist-panel.tsx` — so it dispatches the same
   * `REFER_TO_UNITS` event and the reducer refuses it for real) and then asserts the refusal's
   * own specific content, including the reducer's real reason text.
   */
  test("shows a refused transition instead of swallowing it", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await gotoCoordinator(page);

    const wf004 = requireMovement("WF-004");
    const wf004Default = eligibleCandidates(wf004, NOW_ANCHOR, PARALLEL_REFERRAL_CAP)[0];
    expect(wf004Default, "fixture assumption: WF-004 has a candidate to override into").toBeTruthy();

    const queue = page.getByRole("region", { name: "Priority queue" });
    const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

    await queue.locator('[data-testid="ward-queue-row-WF-004"]').click();
    await shortlist.locator(`[data-testid="ward-shortlist-candidate-${wf004Default.unit.id}"]`).click();

    const overrideToggle = shortlist.getByTestId("ward-shortlist-override-toggle");
    await expect(overrideToggle).not.toHaveAttribute("aria-disabled", "true");
    await overrideToggle.click();
    await shortlist.getByLabel(/Reason for overriding/).fill("Testing a genuine reducer refusal.");
    await shortlist.getByRole("button", { name: "Record override" }).click();

    // The override never claims success — it was refused, and nothing here may say otherwise.
    await expect(shortlist).not.toContainText("Overridden by a human coordinator");

    // The refusal is visible, with its own real content — not merely the word "refus" surviving
    // from an empty-state placeholder.
    const drawer = page.getByRole("button", { name: /Exceptions/ });
    await drawer.click();
    const exceptions = page.getByRole("region", { name: "Exceptions" });
    await expect(exceptions).toContainText(/refus/i);
    await expect(exceptions).toContainText("REFER_TO_UNITS");
    await expect(exceptions).toContainText(`cannot refer a movement while it is ${wf004.stage}`);
  });

  /**
   * Task 7. The coordinator used to chase the referral control into view on a phone with a
   * double-`requestAnimationFrame` `scrollIntoView` effect — deleted now that
   * `.shortlistActionRow` is pinned to the viewport bottom by CSS (`coordinator.module.css`,
   * `@media (max-width: 48rem)`). A pinned control cannot need scrolling to reach it, so the
   * defining assertion here is that selecting a patient moves nothing: `.body`'s own `scrollTop`
   * (`data-testid="ward-coordinator-body"`) before and after the click must be identical, not
   * merely that the control ends up in the viewport (which a JS scroll could also achieve).
   *
   * Task 7 addendum R24: select the movement explicitly by `data-testid`, never `.first()` — Task
   * 6A had to remove exactly that fragility from two other tests in this file once the fabricated
   * Form 3B deadline that used to inflate WF-017's score to rank 1 was deleted. WF-002 is used
   * instead of a rank-derived row, verified against the current fixture rather than assumed: its
   * fixture record (`ward-movements.ts`) sets `stage: "destination_review"`, and the reducer's
   * `REFERRABLE_MOVEMENT_STAGES` (`ward-flow-reducer.ts`) is `["placement_requested",
   * "destination_review"]` — so WF-002 is genuinely referable, matching the "refers a patient to
   * up to three wards" test above, which documents the same fact and selects the same row.
   *
   * Task 7 addendum R25: `expect(page.evaluate(...)).resolves.toBe(...)` is Jest/Vitest
   * vocabulary Playwright's `expect` may not carry — written here as `expect(await
   * page.evaluate(...)).toBe(...)` instead, so a missing `.resolves` chain cannot silently no-op
   * this assertion into an unconditional pass.
   *
   * Fix round 1, R50: the original code here read `window.scrollY`, which mutation testing
   * proved cannot fail — `.screen` is `height: 100dvh; overflow: hidden`, so the real
   * `<html>`/`<body>` never has any scroll range at all, and `window.scrollY` is `0` before and
   * after on every run regardless of what the code does. R25 only checked the matcher's *style*
   * (`.resolves` vs. the plain form), never whether the asserted quantity could actually change.
   * `.body` (`.shortlistBody`'s ancestor, `overflow: auto`) is the real scroll container — the one
   * the deleted `scrollIntoView({ block: "nearest" })` actually moved — so this now reads that
   * element's `scrollTop` through its own stable `data-testid` rather than a CSS-module class name
   * (which is hashed at build time and not a stable selector).
   */
  test("keeps the referral control reachable on a phone without moving the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoCoordinator(page);

    const queue = page.getByRole("region", { name: "Priority queue" });
    const body = page.getByTestId("ward-coordinator-body");
    const scrollBefore = await body.evaluate((el) => el.scrollTop);
    await queue.locator('[data-testid="ward-queue-row-WF-002"]').click();

    // The control is pinned, so selecting a patient must not scroll `.body` — the real scroll
    // container on this screen — out from under the thumb to reach it.
    const scrollAfter = await body.evaluate((el) => el.scrollTop);
    expect(scrollAfter).toBe(scrollBefore);
    await expect(page.getByTestId("ward-shortlist-refer")).toBeInViewport();

    // And the queue keeps the room it was previously losing to a nested scroller: every movement
    // the fixture holds is still really rendered, not truncated to make room for anything else.
    const rows = await queue.locator('[data-testid^="ward-queue-row-"]').count();
    expect(rows).toBeGreaterThan(4);
  });
});
