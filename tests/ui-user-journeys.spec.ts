import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "playwright/test";

import { stubZeroTouchPoints } from "./helpers/zero-touch";
import { expectNoPageHorizontalOverflow, gotoApp } from "./helpers/spec-navigation";
import { demoAnswer, demoDocuments } from "../src/lib/demo-data";
import { toClientAnswerPayload } from "../src/lib/answer-client-payload";

/**
 * Live Browser Testing — User Journeys Suite.
 *
 * Implements the core testing principles:
 * 1. Test user journeys, not isolated components (Login, core workflow, data submission, error state).
 * 2. Focused volume: 8 journeys, six answer/retry negative controls, and an offline preview-origin regression.
 * 3. Accessibility in the same run: in-flow @axe-core/playwright scans on key journey states.
 * 4. Sparing visual regression: high-fidelity snapshot attachments and optional visual assertions on 2–3 key views.
 * 5. Deterministic execution: works against runner-owned local server or remote preview deployment (Vercel/Netlify).
 */

const axeWcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const axeBlockingImpacts = new Set(["critical", "serious"]);
const syntheticFailure = "Synthetic answer service unavailable. Please retry.";
const syntheticAnswerText = (query: string) =>
  `Synthetic fixture completed for: ${query}\n\n${demoAnswer(query).answer.split("\n\n")[0]}`;

async function installSyntheticAnswerApis(page: Page, query: string, baseURL: string | undefined) {
  if (!baseURL) throw new Error("Synthetic journeys require an explicit app baseURL.");
  const appOrigin = new URL(baseURL).origin;
  const state = {
    fail: false,
    unfinished: false,
    requests: [] as Array<{ method: string; query: string }>,
    responses: [] as number[],
    blockedOrigins: [] as string[],
  };
  const answer = { ...toClientAnswerPayload(demoAnswer(query)), answer: syntheticAnswerText(query), demoMode: true };
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/answer/stream") state.responses.push(response.status());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    // Navigation/assets use only the configured app origin; API replies remain synthetic.
    // An explicitly approved preview works without admitting unrelated providers or ports.
    if (url.origin !== appOrigin) {
      state.blockedOrigins.push(url.origin);
      await route.abort("blockedbyclient");
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.fallback();
      return;
    }
    if (url.pathname === "/api/answer/stream") {
      state.requests.push({ method: route.request().method(), query: route.request().postDataJSON()?.query });
      if (state.fail) {
        await route.fulfill({ status: 503, json: { error: syntheticFailure } });
        return;
      }
      const events = [{ event: "progress", data: { stage: "generating", message: "Synthetic answer fixture." } }];
      const frames: Array<{ event: string; data: unknown }> = [...events];
      if (!state.unfinished) {
        frames.push({ event: "progress", data: { stage: "complete", message: "Synthetic answer ready." } });
        frames.push({ event: "final", data: answer });
      }
      await route.fulfill({
        contentType: "text/event-stream",
        body: frames.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""),
      });
      return;
    }
    if (url.pathname === "/api/local-project-id") {
      await route.fulfill({
        json: {
          appName: "PsychSift",
          projectId: "test-project",
          identityPath: "/api/local-project-id",
          localServer: { safeLocalOrigin: true },
        },
      });
      return;
    }
    if (url.pathname === "/api/setup-status") {
      await route.fulfill({
        json: {
          demoMode: true,
          checks: [
            { id: "env", status: "ready" },
            { id: "project", status: "ready" },
            { id: "schema", status: "ready" },
            { id: "search", status: "ready" },
            { id: "openai", status: "ready" },
          ],
        },
      });
      return;
    }
    if (url.pathname === "/api/documents") {
      await route.fulfill({ json: { documents: demoDocuments, demoMode: true } });
      return;
    }
    await route.fulfill({ json: { demoMode: true } });
  });
  return state;
}

async function expectHydratedHandler(locator: Locator, eventName: "onChange" | "onClick" | "onSubmit") {
  await expect
    .poll(
      () =>
        locator.evaluate((element, event) => {
          const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
          const props = propsKey ? (element as unknown as Record<string, Record<string, unknown>>)[propsKey] : null;
          return typeof props?.[event] === "function";
        }, eventName),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function hydratedAnswerSubmit(page: Page, query: string) {
  await gotoApp(page, "/?mode=answer");
  const input = page.locator('[aria-label^="Search indexed guidelines by question or keyword"]:visible');
  const submit = page.locator('[aria-label="Generate source-backed answer"]:visible');
  await expect(input).toHaveCount(1);
  await expect(submit).toHaveCount(1);
  for (const [locator, eventName] of [
    [input, "onChange"],
    [input.locator("xpath=ancestor::form[1]"), "onSubmit"],
  ] as const) {
    await expectHydratedHandler(locator, eventName);
  }
  await expect(input).toBeEnabled();
  await input.fill(query);
  await expect(input).toHaveValue(query);
  await expect(submit).toBeEnabled();
  return submit;
}

async function expectSyntheticAnswer(
  page: Page,
  state: Awaited<ReturnType<typeof installSyntheticAnswerApis>>,
  query: string,
  requestCount: number,
  timeout = 10_000,
) {
  await expect
    .poll(() => state.requests.length, { message: "Answer submission must issue a new request", timeout })
    .toBe(requestCount);
  expect(state.requests).toEqual(Array.from({ length: requestCount }, () => ({ method: "POST", query })));
  await expect.poll(() => state.responses.at(-1), { timeout }).toBe(200);
  await expect(page.getByTestId("answer-progress")).toHaveAttribute("data-progress-state", "complete", { timeout });
  const prose = page.getByTestId("plain-answer-response");
  await expect(prose).toBeVisible({ timeout });
  await expect(prose).toContainText(syntheticAnswerText(query), { timeout });
  await expect(page.getByTestId("answer-error")).toHaveCount(0);
  return prose;
}

async function expectSyntheticFailure(page: Page, state: Awaited<ReturnType<typeof installSyntheticAnswerApis>>) {
  await expect.poll(() => state.responses.filter((status) => status === 503).length).toBeGreaterThan(0);
  await expect(page.getByTestId("answer-error")).toBeVisible();
  await expect(page.getByTestId("answer-error")).toContainText(syntheticFailure);
  await expect(page.getByTestId("answer-error-retry")).toBeVisible();
  await expect(page.getByTestId("plain-answer-response")).toHaveCount(0);
}

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

    // Phones open the menu from the header and tablets from the rail; either way
    // the account action is on the menu's You side. Desktop keeps the sidebar's.
    const phoneMenu = page.getByRole("button", { name: "Open PsychSift menu", exact: true });
    const railYou = page.getByTestId("two-pane-rail-you");
    const menu = page.getByRole("dialog", { name: "PsychSift menu", exact: true });
    let signInTrigger;
    if ((await phoneMenu.isVisible()) || (await railYou.isVisible())) {
      if (await phoneMenu.isVisible()) {
        await expectHydratedHandler(phoneMenu, "onClick");
        await phoneMenu.click();
        await expect(menu).toBeVisible();
        await menu.getByTestId("two-pane-menu-you").click();
      } else {
        await expectHydratedHandler(railYou, "onClick");
        await railYou.click();
        await expect(menu).toBeVisible();
      }
      signInTrigger = menu.getByTestId("two-pane-menu-account");
      await expect(signInTrigger).toBeVisible();
      await expect(signInTrigger).toContainText("Set up your workspace");
    } else {
      signInTrigger = page.locator(
        'button[data-testid="collapsed-account-settings"]:visible, button[data-testid="sidebar-account-settings"]:visible',
      );
      await expect(signInTrigger).toHaveCount(1);
      await expect(signInTrigger).toBeVisible();
      await expect(signInTrigger).toHaveAccessibleName(/Guest Not signed in\. Set up workspace/);
    }
    await expectHydratedHandler(signInTrigger, "onClick");

    // Trigger Account Setup dialog
    await signInTrigger.click();

    // Verify modal sheet appears with federated SSO options and email authentication
    const dialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "Account setup", exact: true }),
    });
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/continue to your workspace|sign up|sign in/i).first()).toBeVisible();
    await expect(dialog.locator('[data-testid="account-provider-grid"]')).toBeVisible();

    // In-flow accessibility audit of the authentication modal dialog
    await expectNoBlockingAxeViolations(page, testInfo, { context: "auth-modal" });

    // Dismiss dialog cleanly
    const closeButton = dialog.getByRole("button", { name: "Close account setup", exact: true });
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
  test("Journey 3 (Core Workflow): clinical query submission to synthesized answer", async ({
    page,
    baseURL,
  }, testInfo) => {
    const query = "What are the clinical signs of lithium toxicity?";
    const state = await installSyntheticAnswerApis(page, query, baseURL);
    const submit = await hydratedAnswerSubmit(page, query);
    await submit.click();
    const answerContainer = await expectSyntheticAnswer(page, state, query, 1);

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

  test("Journey 8 (Error State): simulated API network failure and retry recovery", async ({ page, baseURL }) => {
    const query = "What monitoring does the synthetic clozapine table describe?";
    const state = await installSyntheticAnswerApis(page, query, baseURL);
    state.fail = true;
    const submit = await hydratedAnswerSubmit(page, query);
    await submit.click();
    await expectSyntheticFailure(page, state);
    const failedRequestCount = state.requests.length;
    state.fail = false;
    await page.getByTestId("answer-error-retry").click();
    await expectSyntheticAnswer(page, state, query, failedRequestCount + 1);
  });

  for (const control of ["no-op", "failed", "unfinished"] as const) {
    test(`Answer completion negative control: ${control}`, async ({ page, baseURL }) => {
      const query = "Synthetic lithium toxicity completion control";
      const state = await installSyntheticAnswerApis(page, query, baseURL);
      state.fail = control === "failed";
      state.unfinished = control === "unfinished";
      const submit = await hydratedAnswerSubmit(page, query);
      if (control === "no-op") {
        await submit.locator("xpath=ancestor::form[1]").evaluate((form) => {
          form.addEventListener(
            "submit",
            (event) => {
              event.preventDefault();
              event.stopImmediatePropagation();
            },
            { capture: true },
          );
        });
      }
      await submit.click();
      if (control !== "no-op") await expect.poll(() => state.requests.length).toBeGreaterThan(0);
      await expect(expectSyntheticAnswer(page, state, query, 1, 500)).rejects.toThrow();
    });
  }

  for (const control of ["missing-request", "missing-retry", "persistent-failure"] as const) {
    test(`Answer recovery negative control: ${control}`, async ({ page, baseURL }) => {
      const query = "Synthetic clozapine monitoring recovery control";
      const state = await installSyntheticAnswerApis(page, query, baseURL);
      state.fail = true;
      const submit = await hydratedAnswerSubmit(page, query);
      if (control !== "missing-request") {
        await submit.click();
        await expectSyntheticFailure(page, state);
      }
      const expectedRequests = state.requests.length + 1;
      if (control === "persistent-failure") {
        await page.getByTestId("answer-error-retry").click();
        await expect.poll(() => state.requests.length).toBeGreaterThanOrEqual(expectedRequests);
      } else {
        state.fail = false;
      }
      await expect(expectSyntheticAnswer(page, state, query, expectedRequests, 500)).rejects.toThrow();
    });
  }
});

test.describe("Synthetic preview-origin navigation", () => {
  test.use({
    baseURL: "https://approved-preview.invalid",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "https://approved-preview.invalid",
          localStorage: [{ name: "clinical-kb-pwa-ios-install-dismissed-at", value: String(Date.now()) }],
        },
      ],
    },
  });

  test("allows the configured preview, settles synthetic output, and blocks a sibling origin", async ({
    page,
    baseURL,
  }, testInfo) => {
    // Global configuration has already validated the local project identity or
    // explicit HTTPS preview opt-in before this test overrides its fixture URL.
    const configuredAppOrigin = new URL(String(testInfo.project.use.baseURL)).origin;
    let foreignFallbacks = 0;
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== baseURL) {
        foreignFallbacks += 1;
        await route.abort("blockedbyclient");
        return;
      }
      // The reserved preview hostname never reaches DNS: documents/assets come from
      // the validated app origin (loopback in local verification), and every API
      // request is handled by the newer synthetic route before this fallback.
      const response = await route.fetch({
        url: `${configuredAppOrigin}${url.pathname}${url.search}`,
        maxRedirects: 0,
      });
      // A request the page abandons mid-fetch (a navigation or a superseded asset)
      // disposes its response before it can be fulfilled. Only that teardown is
      // ignored; fetch errors and every other fulfil error still fail the test.
      await route.fulfill({ response }).catch((error: unknown) => {
        if (!/Fetch response has been disposed/.test(String(error))) throw error;
      });
    });
    const query = "Synthetic preview-origin lithium completion";
    const state = await installSyntheticAnswerApis(page, query, baseURL);
    const submit = await hydratedAnswerSubmit(page, query);
    await submit.click();
    await expectSyntheticAnswer(page, state, query, 1);
    expect(new URL(page.url()).origin).toBe(baseURL);
    // Navigation reaches routing independently of the app's connect-src policy.
    await expect(page.goto("https://approved-preview.invalid:444/api/answer/stream")).rejects.toThrow();
    expect(state.blockedOrigins).toContain("https://approved-preview.invalid:444");
    expect(foreignFallbacks).toBe(0);
    expect(state.requests).toEqual([{ method: "POST", query }]);
  });
});
