import { expect, test, type Page } from "playwright/test";

const PATH = "/ward-management";

async function gotoWardFlow(page: Page) {
  await page.goto(PATH, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="ward-coordinator"]:visible')).toHaveCount(1, { timeout: 15_000 });
  // The console is visible from the first paint, but this dev environment settles the route
  // shortly after (a second same-URL navigation event follows the first). A click issued in
  // that window can be lost even though every element is already visible and stable, so wait
  // for network activity to quiesce — the one reliable, non-arbitrary signal available here —
  // before the first interaction.
  await page.waitForLoadState("networkidle");
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

/**
 * `document.documentElement` can never report an overflow on the coordinator route — `.screen`
 * sets `overflow: hidden` — so `expectNoPageOverflow` alone cannot catch a track inside the
 * region grid running wider than its box (Task 3 review Important 1). Only meaningful on
 * /ward-management itself, where the region grid testid exists.
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

test.describe("Ward Flow command view", () => {
  test.describe.configure({ timeout: 45_000 });

  // "supports role-aware queue review and human-confirmed destination choice" and "collapses
  // the queue, opens the action inbox, and reaches the patient workspace" asserted against
  // WardManagementConsole, which Task 3 stopped rendering at /ward-management. That component is
  // unreferenced and Task 9 deletes it; the equivalent coverage on the coordinator screen has no
  // home yet. See the fixme placeholders in tests/ui-ward-coordinator.spec.ts.
  //
  // Task 9 retires Constellation into the coordinator screen. Its own behaviour (the
  // ward-constellation gate check, the WF-002 confirm journey) already has a home: the confirm
  // journey and the failing-gate icon guard both live in tests/ui-ward-coordinator.spec.ts
  // ("shows a failing gate as a failure and never auto-allocates"), so the Constellation step is
  // removed here rather than repointed — leaving it would assert a route that no longer exists.

  test("opens every Ward Flow mode", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await gotoWardFlow(page);

    // This only proves every remaining mode link still opens its route; per-mode behaviour is
    // covered by each mode's own tests elsewhere.
    const modes = [
      ["Network", "ward-mode-network"],
      ["Priority queue", "ward-mode-queue"],
      ["Capacity", "ward-mode-capacity"],
      ["Movements", "ward-mode-movements"],
      ["Exceptions", "ward-mode-exceptions"],
      ["Transport", "ward-mode-transport"],
      ["Governance", "ward-mode-governance"],
    ] as const;
    for (const [linkName, testId] of modes) {
      await page.getByRole("link", { name: linkName }).click();
      await expect(page.getByTestId(testId)).toBeVisible();
      await expectNoPageOverflow(page);
    }
  });

  /**
   * Task 9 review Critical 1: `.modeNavigation` (ward-management-modes.module.css) is a flex
   * column, and flex items shrink by default even with an explicit `height` unless
   * `flex-shrink: 0` is set. Without it, the eight rail mode links compressed to as little as
   * 22px on narrow viewports — under half the mandated 3rem/48px tap-target floor — while a
   * check run only at 1440x1024 (where the rail had room to spare) stayed green. 320x640 is
   * short enough on both axes to force the rail's mode-link section into its scrollable
   * fallback, which is exactly the condition that exposed the regression.
   */
  test("keeps every rail mode link at the 3rem tap-target floor on a short, narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await gotoWardFlow(page);

    const nav = page.getByRole("navigation", { name: "Ward Flow views" });
    const links = await nav.getByRole("link").all();
    expect(links.length).toBe(8);
    for (const link of links) {
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.width).toBeGreaterThanOrEqual(48);
    }
  });

  test("routes a selected movement across the network diagram and explains the shortlist", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto("/ward-management/network", { waitUntil: "domcontentloaded" });

    const network = page.getByTestId("ward-network-view");
    await expect(network).toBeVisible({ timeout: 15_000 });

    // Connector paths are drawn by a client layout effect, so their presence is the
    // hydration signal: before it fires, queue clicks would be swallowed.
    await expect(network.locator("svg path[marker-end]").first()).toBeAttached({ timeout: 15_000 });

    // Pipeline counts are derived from the movement records, so they must total the queue.
    await expect(network.getByRole("region", { name: "Movement pipeline" })).toContainText("Placement requested");

    // WF-001 is first in the queue; its eligible shortlist is RPH, SCGH and FSH Adult Secure/Open.
    const shortlist = network.getByRole("complementary", { name: "Explainable shortlist" });
    await expect(shortlist).toContainText("WF-001");
    await expect(shortlist.getByRole("columnheader", { name: /RPH Adult Secure/ })).toBeVisible();
    // Eligibility is a binary verdict, not a score: gates are not commensurable, so no row
    // ever renders a "N of M passed" fraction.
    await expect(shortlist.getByRole("row", { name: /Eligibility/ })).toContainText("Eligible");
    // WF-001 has no recorded destination, so none of its three candidates — including the
    // first-ranked one — may inherit its (nonexistent) transport job.
    await expect(shortlist.getByRole("row", { name: /Transport state/ })).toContainText("Not yet booked");
    await expect(shortlist.getByRole("row", { name: /Transport state/ })).not.toContainText("Not yet requested");
    await expect(shortlist).toContainText("No automatic allocation");

    // Shortlisted services are marked as routed on the canvas; Armadale is not in WF-001's
    // eligible top three.
    await expect(network.getByTestId("ward-network-card-rph-adult-secure")).toHaveAttribute("data-routed", "true");
    await expect(network.getByTestId("ward-network-card-arm-adult-open")).not.toHaveAttribute("data-routed", "true");

    // Kununurra is one of the services with no available beds.
    await expect(network.getByTestId("ward-network-card-kun-adult-open")).toContainText("Kununurra");

    // Selecting another movement re-routes the diagram and swaps the shortlist. WF-002 is
    // South Metro; Fremantle Older Adult is its one same-service eligible candidate.
    await network.getByTestId("ward-network-queue-WF-002").click();
    await expect(shortlist).toContainText("WF-002");
    await expect(network.getByTestId("ward-network-card-fre-older-adult")).toHaveAttribute("data-routed", "true");
    // This row compares health services against the *origin* ED, not the patient's catchment
    // (catchment is where a patient lives, not where they presented) — named for what it
    // actually measures rather than implying a judgement the model cannot make yet.
    await expect(shortlist.getByRole("row", { name: /Same health service as origin/ })).toContainText("Escalation");

    // A service card opens its own detail block.
    await network.getByTestId("ward-network-card-fre-older-adult").click();
    await expect(shortlist.getByRole("region", { name: "Selected service detail" })).toContainText("FRE Older Adult");
    await expectNoPageOverflow(page);
  });

  test("provides a queue-first phone fallback without page overflow", async ({ page }) => {
    // The coordinator shell's own responsibility is not overflowing and keeping the priority
    // queue reachable at the narrowest supported width (320px, not the 390px this test used
    // against WardManagementConsole). The full phone composition — hiding the diagram column,
    // one-tap confirm — belongs to Task 8; this only proves the frame itself does not break.
    await page.setViewportSize({ width: 320, height: 820 });
    await gotoWardFlow(page);

    await expect(page.getByRole("region", { name: "Priority queue" })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoRegionGridOverflow(page);
  });

  test("retains its operating structure in dark, forced-colours, and print modes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoWardFlow(page);
    await expect(page.getByRole("region", { name: "Emergency department pressure" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Priority queue" })).toBeVisible();
    await expect(page.getByTestId("ward-coordinator-governance")).toBeVisible();

    await page.emulateMedia({ forcedColors: "active" });
    await expect(page.getByRole("region", { name: "Emergency department pressure" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Priority queue" })).toBeVisible();
    await expect(page.getByTestId("ward-coordinator-governance")).toBeVisible();

    await page.emulateMedia({ colorScheme: "light", forcedColors: "none", media: "print" });
    await expect(page.locator('[data-testid="ward-coordinator-governance"]:visible')).toBeVisible();
  });
});
