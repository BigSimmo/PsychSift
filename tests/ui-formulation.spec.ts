import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "playwright/test";
import { stubZeroTouchPoints } from "./helpers/zero-touch";
import { readPrimaryScrollGeometry } from "./playwright-scroll";
import { visibleByTestId, visibleByText } from "./playwright-settlement";

const axeWcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const axeBlockingImpacts = new Set(["critical", "serious"]);

async function blockExternalRequests(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fallback();
  });
}

async function gotoApp(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

async function expectNoBlockingAxeViolations(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(axeWcagTags).analyze();
  await testInfo.attach("axe-violations", {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });

  const blocking = results.violations
    .filter((violation) => axeBlockingImpacts.has(violation.impact ?? ""))
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes
          .map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? "no failure summary"}`)
          .join(" | ")}; see ${violation.helpUrl}`,
    );
  expect(blocking, "axe found critical/serious WCAG A/AA violations").toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
  await stubZeroTouchPoints({ page });
});

test("searches patient language, opens a mechanism guide, and carries it into the builder", async ({
  page,
}, testInfo) => {
  // `/formulation` is a 307 onto the shared home now; going there directly keeps
  // the test on the surface it is actually asserting about.
  await gotoApp(page, "/?mode=formulation");

  await expect(page.getByRole("heading", { name: "Clinical Formulation", exact: true })).toBeVisible();
  await expect(page.getByTestId("shared-home-empty-state")).toBeVisible();

  const search = page.getByTestId("global-search-input").filter({ visible: true }).first();
  await expect(search).toHaveAccessibleName(
    /Search indexed guidelines by question or keyword - Search formulation mechanisms by pattern or patient language/,
  );
  await search.fill("I keep going over it");
  await page.getByRole("button", { name: "Find matching formulation mechanisms" }).click();

  await expect(page).toHaveURL(
    /\/formulation\/search\?.*q=I(?:\+|%20)keep(?:\+|%20)going(?:\+|%20)over(?:\+|%20)it.*run=1/,
  );
  const queryRibbon = visibleByTestId(page, "search-query-ribbon");
  await expect(queryRibbon.getByRole("heading", { level: 1, name: "I keep going over it" })).toBeVisible();
  await expect(queryRibbon.getByRole("group", { name: "Filter formulation mechanisms" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rumination", exact: true })).toBeVisible();
  await expect(page.getByText("Source status", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Open Rumination" }).click();
  await expect(page).toHaveURL(/\/formulation\/rumination$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Rumination", exact: true })).toBeVisible();
  // The record's own section label, addressed by id rather than by text: the
  // in-page section sheet carries the same words, and a bare text locator
  // matches both under Playwright strict mode.
  await expect(page.locator("#formulation-what-matters-now-label")).toBeVisible();
  await page.getByTestId("formulation-section-trigger").click();
  await expect(
    page.getByTestId("formulation-section-sheet").getByRole("button", { name: "What matters now", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("formulation-section-sheet")).toBeHidden();

  await page.getByRole("link", { name: "Use in formulation", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Build a formulation that can be tested" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Rumination/ })).toBeChecked();
  await expect(visibleByText(page, /Rumination appears to keep the patient caught/i).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoBlockingAxeViolations(page, testInfo);
});

test("keeps mobile search, domain filtering, record actions, and universal chrome usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/formulation?q=What+if+something+goes+wrong&run=1");

  const queryRibbon = visibleByTestId(page, "search-query-ribbon");
  await expect(queryRibbon.getByRole("heading", { level: 1, name: "What if something goes wrong" })).toBeVisible();
  await expect(queryRibbon.getByRole("group", { name: "Filter formulation mechanisms" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Worry", exact: true })).toBeVisible();
  await expect(page.getByText("Matches use patient language", { exact: false })).toHaveCount(0);
  const topMatch = page.getByTestId("formulation-top-match");
  await expect(topMatch.getByText("Top match", { exact: true })).toBeVisible();
  await expect(topMatch.getByRole("link", { name: "Worry", exact: true })).toBeVisible();
  // One compact trigger opening a sheet. The sheet now holds a single group:
  // the old `Pattern` group called router.push and replaced the query, so its
  // presets moved below the band as suggested searches.
  const filterTrigger = queryRibbon.getByTestId("formulation-filter-trigger-phone");
  await expect(filterTrigger).toBeVisible();
  await expect(page.getByTestId("formulation-pattern-suggestions")).toBeVisible();
  await filterTrigger.click();
  await expect(page.getByRole("radiogroup", { name: "Pattern" })).toHaveCount(0);
  // Domain is a facet, not a lens: many-of-N, so aria-pressed toggles inside a
  // role="group" rather than radios, and no "All domains" escape option — an
  // empty selection already means no constraint.
  const domainGroup = page.getByRole("group", { name: "Domain" });
  await expect(domainGroup).toBeVisible();
  await expect(domainGroup.getByRole("radio")).toHaveCount(0);
  // Derived from what the library carries, not from what is declared. The
  // contextual concepts made Biological and Social reachable; Cultural is not
  // offered while all its records are held for review (#3412), so 11 of 12 show.
  await expect(domainGroup.getByRole("button")).toHaveCount(11);
  await expect(domainGroup.getByRole("button", { name: /^Cultural/ })).toHaveCount(0);
  const affect = domainGroup.getByRole("button", { name: /^Affect/ });
  await expect(affect).toHaveAttribute("aria-pressed", "false");
  await affect.click();
  await expect(affect).toHaveAttribute("aria-pressed", "true");
  // Accumulates rather than replaces — the whole point of the facet kind.
  const cognition = domainGroup.getByRole("button", { name: /^Cognition/ });
  await cognition.click();
  await expect(affect).toHaveAttribute("aria-pressed", "true");
  await expect(cognition).toHaveAttribute("aria-pressed", "true");
  await expect(filterTrigger).toHaveAccessibleName(/2 filters active/);
  await page.getByTestId("formulation-filter-panel-done").click();
  await expect(domainGroup).toBeHidden();
  await expect(page.getByTestId("global-search-input").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Source status", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Source", { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "Open Worry" }).click();
  await expect(async () => {
    await expect(page).toHaveURL(/\/formulation\/worry$/);
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Worry", exact: true })).toBeVisible({ timeout: 30_000 });
  // The record's actions moved into the in-page header's ellipsis sheet.
  await page.getByTestId("formulation-actions-trigger").click();
  const mechanismActions = page.getByTestId("formulation-actions-sheet");
  await expect(mechanismActions.getByRole("link", { name: "Compare", exact: true })).toBeVisible();
  await expect(mechanismActions.getByRole("link", { name: "Use in formulation", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mechanismActions).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await expectNoBlockingAxeViolations(page, testInfo);
});

test("does not promote a top match when the leading results are tied", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/formulation?q=sleep&run=1");

  const topMatch = page.getByText("Top match", { exact: true });
  await expect(topMatch).toHaveCount(0);
  await expect(topMatch).toBeHidden();
});

test("keeps long mobile formulation pages inside the active app scroll surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page, "/formulation/builder?mechanism=rumination&template=5Ps");

  await expect(page.getByRole("heading", { name: "Build a formulation that can be tested" })).toBeVisible();

  const scrollGeometry = await readPrimaryScrollGeometry(page);
  const mainGeometry = await page.locator("#main-content").evaluate((main) => {
    const rect = main.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      overflowY: window.getComputedStyle(main).overflowY,
      viewportHeight: window.innerHeight,
    };
  });

  expect(scrollGeometry.owner).toBe("document");
  expect(scrollGeometry.scrollHeight).toBeGreaterThan(scrollGeometry.clientHeight + 40);
  expect(mainGeometry.overflowY).toBe("visible");
  expect(mainGeometry.bottom).toBeGreaterThanOrEqual(mainGeometry.viewportHeight - 1);
});

test("keeps unavailable builder navigation natively disabled without fading its text", async ({ page }, testInfo) => {
  await gotoApp(page, "/formulation/builder?template=5Ps");

  const previousStep = page.getByRole("button", { name: "Previous", exact: true });
  const continueStep = page.getByRole("button", { name: "Continue to framework", exact: true });

  await expect(previousStep).toBeDisabled();
  await expect(continueStep).toBeDisabled();
  await expect(previousStep).toHaveCSS("opacity", "1");
  await expect(continueStep).toHaveCSS("opacity", "1");

  const disabledControlsAcceptedFocus = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLButtonElement>("button:disabled")).filter((button) =>
      ["Previous", "Continue to framework"].includes(button.textContent?.trim() ?? ""),
    );
    return controls.map((control) => {
      control.focus();
      return document.activeElement === control;
    });
  });
  expect(disabledControlsAcceptedFocus).toEqual([false, false]);
  await expectNoBlockingAxeViolations(page, testInfo);
});

test("moves a selected mechanism through framework, quality review, and an editable draft", async ({
  page,
}, testInfo) => {
  await gotoApp(page, "/formulation/builder?mechanism=rumination&template=5Ps");

  await expect(page.getByRole("checkbox", { name: /Rumination/ })).toBeChecked();
  const previousStep = page.getByRole("button", { name: "Previous", exact: true });
  const continueStep = page.getByRole("button", { name: "Continue to framework", exact: true });
  await expect(previousStep).toBeDisabled();
  await expect(previousStep).toHaveCSS("opacity", "1");
  await expect(continueStep).toBeEnabled();
  await continueStep.click();
  await expect(page.getByTestId("formulation-builder-structure")).toBeVisible();
  const frameworkGroup = page.getByRole("radiogroup", { name: "Formulation framework" });
  const cbtCycle = frameworkGroup.getByRole("radio", { name: /CBT cycle/ });
  // Controlled `sr-only` radios still flake under `locator.check({ force })` on
  // Production UI shard 1 (state does not flip). Drive selection through the
  // visible label click handler instead, then assert the radio role.
  await frameworkGroup.getByText("CBT cycle", { exact: true }).click();
  await expect(cbtCycle).toBeChecked();
  await page
    .getByRole("textbox", { name: "Presenting problem" })
    .fill("De-identified recurring low mood and overthinking.");

  await page.getByRole("button", { name: "Review quality", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Evidence supporting this mechanism" })
    .fill("Repetitive review follows perceived failures and delays sleep.");
  await page
    .getByRole("textbox", { name: "Alternative explanation" })
    .fill("Check future-focused worry and realistic problem solving.");

  await page.getByRole("button", { name: "Create draft" }).click();
  const draft = page.getByRole("textbox", { name: "Formulation draft" });
  await expect(draft).toHaveValue(/CBT cycle formulation/);
  await expect(draft).toHaveValue(/Rumination appears to keep the patient caught/);

  await draft.fill("Stale edited draft");
  // The step rail shows each step's description ("Mechanisms", "Formulation") from lg up only, so
  // below that the accessible names are the bare labels. Address the rail's own buttons by label.
  const stepRail = page.getByRole("list", { name: "Formulation builder steps" });
  await stepRail.getByRole("button", { name: /\bSelect\b/ }).click();
  await expect(page.getByTestId("formulation-builder-select")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  // Clear unmounts the selected-hypotheses strip; wait for that layout settle
  // before the step-rail click so it is not lost to a mid-reflow miss
  // (Production UI shard flake on PR #1791).
  await expect(page.getByRole("heading", { name: "No mechanisms selected" })).toBeVisible();
  await stepRail.getByRole("button", { name: /\bDraft\b/ }).click();
  await expect(page.getByTestId("formulation-builder-draft")).toBeVisible();
  await expect(draft).not.toHaveValue("Stale edited draft");
  await expect(draft).toHaveValue(/Select mechanisms and add case evidence/);
  await expectNoHorizontalOverflow(page);
  // Regression guard for matrix run 4012: the old disabled opacity utility could
  // remain stale in WebKit after this button re-enabled, which made axe measure a
  // phantom low-contrast enabled state. Keep the live state explicit before scanning.
  await expect(previousStep).toBeEnabled();
  await expect(previousStep).toHaveCSS("opacity", "1");
  await expectNoBlockingAxeViolations(page, testInfo);
});

test("keeps specifier and formulation route families clinically separate", async ({ page }) => {
  await gotoApp(page, "/specifiers/with-anxious-distress");

  await expect(page).toHaveURL(/\/specifiers\/with-anxious-distress$/);
  await expect(page.getByRole("heading", { name: "With anxious distress", exact: true })).toBeVisible();
  await expect(visibleByText(page, "Psychiatric specifier", { exact: true })).toBeVisible();
  await expect(page.getByText(/Mechanisms matching/)).toHaveCount(0);
  await expect(page.getByText("Page not found", { exact: true })).toHaveCount(0);

  await gotoApp(page, "/formulation/rumination");
  await expect(page).toHaveURL(/\/formulation\/rumination$/);
  await expect(page.getByRole("heading", { name: "Rumination", exact: true })).toBeVisible();
  await expect(visibleByText(page, "Formulation mechanism", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("With anxious distress", { exact: true })).toHaveCount(0);
});

test("compares supported alternatives and groups mechanisms without implying causation", async ({ page }) => {
  await gotoApp(page, "/formulation/compare?a=rumination&b=worry");
  await expect(page.getByRole("heading", { name: "Compare mechanisms" })).toBeVisible();
  await expect(
    visibleByText(page, /replaying what happened or trying to prevent what might happen next/i),
  ).toBeVisible();
  await expect(visibleByText(page, "Most useful distinction", { exact: true })).toBeVisible();

  await gotoApp(page, "/formulation/map?mechanism=shame");
  await expect(page.getByRole("heading", { name: "Mechanism map" })).toBeVisible();
  await expect(visibleByText(page, /does not assert causation/i)).toBeVisible();
  await expect(visibleByText(page, "Selected mechanism", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shame", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
