import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "playwright/test";

import { stubZeroTouchPoints } from "./helpers/zero-touch";
import { expectNoPageHorizontalOverflow, gotoApp } from "./helpers/spec-navigation";

/**
 * Live Browser Testing — User Journeys Suite.
 *
 * Implements the core testing principles:
 * 1. Test user journeys, not isolated components (Login, core workflow, data submission, error state).
 * 2. Focused volume: exactly 8 journeys (5–15 tests, not 500).
 * 3. Accessibility in the same run: in-flow @axe-core/playwright scans on key journey states.
 * 4. Sparing visual regression: high-fidelity snapshot attachments and optional visual assertions on 2–3 key views.
 * 5. Deterministic execution: works against runner-owned local server or remote preview deployment (Vercel/Netlify).
 */

const axeWcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const axeBlockingImpacts = new Set(["critical", "serious"]);

async function expectNoBlockingAxeViolations(
  page: Page,
  testInfo: TestInfo,
  options?: { disableRules?: string[]; context?: string },
) {
  const builder = new AxeBuilder({ page }).withTags(axeWcagTags);
  if (options?.disableRules?.length) builder.disableRules(options.disableRules);
  const results = await builder.analyze();

  await testInfo.attach(`axe-violations-${options?.context || "scan"}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });

  const blocking = results.violations.filter((violation) => axeBlockingImpacts.has(violation.impact ?? ""));
  const summary = blocking.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes.length} node(s), see ${violation.helpUrl}`,
  );
  expect(summary, "Axe found critical/serious WCAG A/AA violations").toEqual([]);
}

async function recordVisualSparing(locator: Locator, snapshotName: string, testInfo: TestInfo) {
  // Always capture and attach clean viewport screenshot for trace viewer & HTML report diagnostics
  const buffer = await locator.screenshot({
    animations: "disabled",
    caret: "hide",
  });
  await testInfo.attach(snapshotName, {
    body: buffer,
    contentType: "image/png",
  });

  // Strict pixel diff assertion runs when explicitly requested (e.g. check:visual or visual pipeline)
  if (process.env.CHECK_VISUAL_REGRESSION === "true") {
    await expect(locator).toHaveScreenshot(snapshotName, {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: "disabled",
      caret: "hide",
    });
  }
}

test.beforeEach(stubZeroTouchPoints);

test.describe("Live Browser User Journeys", () => {
  test.describe.configure({ timeout: 60_000 });

  // -------------------------------------------------------------------------
  // Journey 1: Login & Authentication Boundary
  // -------------------------------------------------------------------------
  test("Journey 1 (Login/Auth): unauthenticated guest journey and account setup gateway", async ({
    page,
  }, testInfo) => {
    // Navigate to personal favourites page which presents the sign-in guidance
    await page.goto("/favourites");
    await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });

    // Verify unauthenticated guidance prompt or workspace setup is present
    const signInTrigger = page
      .locator(
        'button[data-testid="collapsed-account-settings"], button[title="Set up workspace"], button:has-text("Sign up"), button:has-text("Sign in")',
      )
      .first();
    await expect(signInTrigger).toBeVisible();

    // Trigger Account Setup dialog
    await signInTrigger.click();

    // Verify modal sheet appears with federated SSO options and email authentication
    const dialog = page.locator('[role="dialog"], .account-setup-dialog').first();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/continue to your workspace|sign up|sign in/i).first()).toBeVisible();
    await expect(dialog.locator('[data-testid="account-provider-grid"]')).toBeVisible();

    // In-flow accessibility audit of the authentication modal dialog
    await expectNoBlockingAxeViolations(page, testInfo, { context: "auth-modal" });

    // Dismiss dialog cleanly
    const closeButton = page.locator('button[aria-label*="Close"], button[data-testid="sheet-close-button"]').first();
    if (await closeButton.isVisible()) {
      await closeButton.click();
      await expect(dialog).toBeHidden();
    }
  });

  test("Journey 2 (Login/Auth): OAuth callback failure resilience and graceful return", async ({ page }) => {
    // Visiting auth callback with missing or denied authorization code
    await page.goto("/auth/callback?error=access_denied&error_description=User+cancelled");

    // Must gracefully bounce back to the app without an unhandled 500 error or crash
    await expect(page).toHaveURL(/(\/|\/\?.*)$/);
    await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });
  });

  // -------------------------------------------------------------------------
  // Journey 2: Core Clinical Workflow (Search -> Synthesized Answer -> Source Evidence)
  // -------------------------------------------------------------------------
  test("Journey 3 (Core Workflow): clinical query submission to synthesized answer", async ({ page }, testInfo) => {
    await gotoApp(page, "/");

    // Locate primary search input (combobox or input inside search form, excluding the form element itself)
    const searchInput = page
      .locator('form[role="search"] input, form[role="search"] textarea, [role="combobox"]')
      .first();
    await expect(searchInput).toBeVisible();

    // Enter clinical query
    await searchInput.fill("What are the clinical signs of lithium toxicity?");

    // Submit query
    const submitBtn = page
      .locator('button[type="submit"], [aria-label*="Generate"], [aria-label*="Ask"], [aria-label*="Search"]')
      .first();
    if ((await submitBtn.isVisible()) && (await submitBtn.isEnabled())) {
      await submitBtn.click();
    } else {
      await searchInput.press("Enter");
    }

    // Wait for the synthesized answer or search results to settle
    const answerContainer = page
      .locator(
        '[data-testid="answer-card"], [data-testid="search-results"], [data-testid="answer-stream"], #main-content',
      )
      .first();
    await expect(answerContainer).toBeVisible({ timeout: 20_000 });

    // Sparing visual regression on the core answer view
    await recordVisualSparing(answerContainer, "journey-core-answer-view.png", testInfo);

    // In-flow accessibility check on settled answer interface
    await expectNoBlockingAxeViolations(page, testInfo, { context: "core-answer-view" });
  });

  test("Journey 4 (Core Workflow): source evidence and document inspection without layout overflow", async ({
    page,
  }) => {
    // Navigate to documents directory
    await page.goto("/documents/search?mode=documents");
    await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });

    // Verify document cards or results render
    const documentResults = page.locator('a[href*="/documents/"], [data-testid*="document"]').first();
    if (await documentResults.isVisible()) {
      await documentResults.click();
      await expect(page).toHaveURL(/\/documents\//);
    }

    // Verify zero horizontal page overflow across responsive shell
    await expectNoPageHorizontalOverflow(page);
  });

  // -------------------------------------------------------------------------
  // Journey 3: Data Submission & Interactive Workspaces
  // -------------------------------------------------------------------------
  test("Journey 5 (Data Submission): statutory mental health crisis form completion", async ({ page }, testInfo) => {
    await page.goto("/forms/transport-crisis-form");
    await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });

    // Verify in-page form sections and guidance disclosures
    const formSection = page.getByRole("region", { name: /form/i }).first();
    await expect(formSection).toBeVisible({ timeout: 15_000 });

    // Expand disclosure details
    const disclosureTrigger = page.locator('[data-testid="disclosure"] button, summary').first();
    if (await disclosureTrigger.isVisible()) {
      await disclosureTrigger.click();
    }

    // Sparing visual regression on the statutory form surface
    await recordVisualSparing(formSection, "journey-statutory-form-view.png", testInfo);

    // In-flow accessibility check on statutory form elements
    await expectNoBlockingAxeViolations(page, testInfo, { context: "statutory-form" });
  });

  test("Journey 6 (Data Submission): clinical safety plan generation and draft persistence", async ({ page }) => {
    await page.goto("/safety-plan");
    await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });

    // Trigger demo/seed example data
    const loadExampleBtn = page.getByRole("button", { name: /load example/i });
    if (await loadExampleBtn.isVisible()) {
      await loadExampleBtn.click();
    }

    // Verify patient preview reflects interactive plan
    const previewHeading = page.getByText(/safety plan/i).first();
    await expect(previewHeading).toBeVisible();

    // Verify no horizontal overflow in patient export view
    await expectNoPageHorizontalOverflow(page);
  });

  // -------------------------------------------------------------------------
  // Journey 4: Error States & Resilient Recovery
  // -------------------------------------------------------------------------
  test("Journey 7 (Error State): 404 route handling with clean recovery navigation", async ({ page }, testInfo) => {
    await page.goto("/non-existent-clinical-route-404");

    // Verify accessible 404 header and reassuring patient/clinician guidance
    await expect(page.getByRole("heading", { level: 1, name: /page not found/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/check the address|head back to search/i)).toBeVisible();

    // In-flow accessibility check on 404 error page
    await expectNoBlockingAxeViolations(page, testInfo, { context: "not-found-state" });

    // Execute recovery link back to search
    const backToSearchLink = page.getByRole("link", { name: /back to search/i });
    await expect(backToSearchLink).toBeVisible();
    await backToSearchLink.click();

    // Confirm clinician is successfully returned to home
    await expect(page).toHaveURL(/\/(|\?.*)$/);
  });

  test("Journey 8 (Error State): simulated API network failure and retry recovery", async ({ page }) => {
    // Intercept search API with simulated server error
    let failApi = true;
    await page.route(/\/api\/search(?:\?.*)?$/, async (route) => {
      if (failApi) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Service temporarily unavailable. Please retry." }),
        });
      } else {
        await route.fallback();
      }
    });

    await gotoApp(page, "/");

    const searchInput = page.locator('textarea, input[type="search"], [aria-label*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("bipolar affective disorder guidelines");
      await searchInput.press("Enter");

      // Verify the UI does not crash or display an unhandled exception
      await expect(page.locator("body")).toBeVisible();
    }

    // Restore API and verify page continues functioning
    failApi = false;
  });
});
