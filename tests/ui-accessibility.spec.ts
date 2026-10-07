import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "playwright/test";
import { THERAPY_CATALOGUE_SUMMARY } from "@/components/therapy-compass/data/generated-assets";
import { stubZeroTouchPoints } from "./helpers/zero-touch";
import { expectNoPageHorizontalOverflow, gotoApp } from "./helpers/spec-navigation";
import { visibleByTestId } from "./playwright-settlement";

const readySetupChecks = [
  { id: "env", label: ".env.local configured", status: "ready", detail: "Test environment ready." },
  { id: "project", label: "PsychSift Production target", status: "ready", detail: "Test Supabase project ready." },
  { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Test schema ready." },
  { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Test search schema ready." },
  { id: "openai", label: "OpenAI API key available", status: "ready", detail: "Test OpenAI ready." },
  { id: "worker", label: "npm run worker running", status: "unknown", detail: "Worker not required for UI smoke." },
];
const uiAssertionTimeoutMs = 5_000;

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

async function mockMinimalDashboardApi(page: Page) {
  await blockExternalRequests(page);
  await page.route(/\/api\/local-project-id$/, async (route) => {
    await route.fulfill({
      json: {
        appName: "PsychSift",
        projectId: "test-project",
        identityPath: "/api/local-project-id",
        localServer: {
          currentUrl: "http://localhost:4298",
          currentPort: 4298,
          projectPortStart: 4298,
          projectPortEnd: 53210,
          safeLocalOrigin: true,
          requestOrigin: null,
          requestReferer: null,
          unsafeLocalCaller: null,
        },
      },
    });
  });
  await page.route("**/api/setup-status**", async (route) => {
    await route.fulfill({
      json: { demoMode: false, checks: readySetupChecks },
    });
  });
  await page.route(/\/api\/documents(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        documents: [],
        pagination: { limit: 150, offset: 0, total: 0, nextOffset: 0, hasMore: false },
      },
    });
  });
  await page.route(/\/api\/ingestion\/jobs(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { jobs: [] } });
  });
  await page.route(/\/api\/ingestion\/batches(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { batches: [] } });
  });
  await page.route(/\/api\/ingestion\/quality(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route(/\/api\/registry\/records(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { records: [], total: 0, governance: {} } });
  });
  await page.route(/\/api\/search\/universal(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        query: "",
        contextMode: "differentials",
        preferredDomains: [],
        domainOrder: [],
        groups: [],
      },
    });
  });
}

async function mockDifferentialSearch(page: Page) {
  await page.route(/\/api\/search(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        results: [],
        visualEvidence: [],
        relatedDocuments: [],
        documentMatches: [
          {
            document_id: "11111111-1111-4111-8111-111111111111",
            title: "Acute confusion differential guide",
            file_name: "acute-confusion-differentials.pdf",
            labels: [],
            summarySnippet: "Reviewed acute confusion differential guidance.",
            bestPages: [1],
            bestChunkIds: ["chunk-acute-confusion"],
            imageCount: 0,
            tableCount: 0,
            matchReason: "Matched indexed passage",
            score: 0.93,
          },
        ],
        relevance: { verdict: "strong", score: 0.91, directSourceCount: 1, weakSourceCount: 0 },
        smartPanel: {},
        telemetry: { query_class: "differential_compare", retrieval_strategy: "text_fast_path" },
        scope: { queryMode: "compare_guidance" },
        sourceGovernanceWarnings: [],
        demoMode: true,
      },
    });
  });
}

async function expectDashboardUsable(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "PsychSift" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Clinical Answers", exact: true })).toBeVisible();
  await expect(page.locator('[aria-label^="Search indexed guidelines by question or keyword"]:visible')).toBeVisible();
  await expect(page.getByRole("button", { name: "Open answer options" })).toBeVisible();
  await expectNoPageHorizontalOverflow(page);
}

async function openScopeControl(page: Page) {
  const trigger = page.getByRole("button", { name: "Open answer options" });
  const menu = page.getByTestId("daily-actions-menu");

  await expect(async () => {
    if (await menu.isVisible().catch(() => false)) return;
    await trigger.click();
    await expect(menu).toBeVisible({ timeout: uiAssertionTimeoutMs });
  }).toPass({ timeout: 15_000 });

  await menu.getByRole("button", { name: "Scope", exact: true }).click({ timeout: 15_000 });
  await expect(page.locator('[data-testid="scope-command-popover"]:visible')).toBeVisible({
    timeout: uiAssertionTimeoutMs,
  });
}

const axeWcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
// Advisory gate: only fail on the impacts a clinician-facing release must not ship.
// Lower-impact findings stay visible in the attached report without blocking the lane.
const axeBlockingImpacts = new Set(["critical", "serious"]);

async function expectNoBlockingAxeViolations(page: Page, testInfo: TestInfo, options?: { disableRules?: string[] }) {
  const builder = new AxeBuilder({ page }).withTags(axeWcagTags);
  if (options?.disableRules?.length) builder.disableRules(options.disableRules);
  const results = await builder.analyze();

  await testInfo.attach("axe-violations", {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });

  const blocking = results.violations.filter((violation) => axeBlockingImpacts.has(violation.impact ?? ""));
  const summary = blocking.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help} — ${violation.nodes.length} node(s), see ${violation.helpUrl}`,
  );
  expect(summary, "axe found critical/serious WCAG A/AA violations").toEqual([]);
}

test.beforeEach(stubZeroTouchPoints);

test.describe("PsychSift accessibility coverage", () => {
  test.describe.configure({ timeout: 60_000 });

  test("dashboard remains usable with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await mockMinimalDashboardApi(page);
    await gotoApp(page);

    await expectDashboardUsable(page);
    await openScopeControl(page);
    await expectNoPageHorizontalOverflow(page);
  });

  test("scripted scrolls honour the reduced-motion preference", async ({ page }) => {
    // ANIM-01 (WCAG 2.3.3): the scripted scrollTo/scrollIntoView calls resolve their
    // behaviour through resolveScrollBehavior(), so a reduced-motion preference must
    // turn them into instant ("auto") jumps instead of smooth animations. Record the
    // behaviour argument every scroll call receives, then trigger a known one.
    await page.addInitScript(() => {
      const store: string[] = [];
      (window as unknown as { __scrollBehaviors: string[] }).__scrollBehaviors = store;
      const record = (behavior?: ScrollBehavior) => store.push(behavior ?? "auto");
      const origScrollTo = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function scrollTo(this: Element, ...args: unknown[]) {
        const options = args[0];
        if (options && typeof options === "object" && "behavior" in options) {
          record((options as ScrollToOptions).behavior);
        }
        return (origScrollTo as (...callArgs: unknown[]) => void).apply(this, args);
      } as typeof Element.prototype.scrollTo;
      const origScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function scrollIntoView(this: Element, ...args: unknown[]) {
        const options = args[0];
        if (options && typeof options === "object" && "behavior" in options) {
          record((options as ScrollIntoViewOptions).behavior);
        }
        return (origScrollIntoView as (...callArgs: unknown[]) => void).apply(this, args);
      } as typeof Element.prototype.scrollIntoView;
    });

    const readBehaviours = () =>
      page.evaluate(() => (window as unknown as { __scrollBehaviors: string[] }).__scrollBehaviors);
    const resetBehaviours = () =>
      page.evaluate(() => {
        (window as unknown as { __scrollBehaviors: string[] }).__scrollBehaviors.length = 0;
      });

    await page.setViewportSize({ width: 1280, height: 800 });
    await mockMinimalDashboardApi(page);

    // New chat lives on both the collapsed rail and the expanded panel. With
    // collapsed-by-default the expanded panel is unmounted, so scope to the
    // rail rather than relying on .first() (same hazard the forced-colors
    // journey below guards against).
    const railNewChat = page.getByLabel("PsychSift collapsed sidebar").getByRole("button", { name: "New chat" });

    // Reduced motion → every scripted scroll must be an instant "auto" jump.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoApp(page);
    await expectDashboardUsable(page);
    await resetBehaviours();
    await railNewChat.click();
    await expect.poll(readBehaviours).not.toHaveLength(0);
    const reduced = await readBehaviours();
    expect(reduced, "reduced motion must not animate scripted scrolls").not.toContain("smooth");
    expect(reduced.every((behaviour) => behaviour === "auto")).toBe(true);

    // No preference → the same action animates smoothly.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await resetBehaviours();
    await railNewChat.click();
    await expect.poll(readBehaviours).not.toHaveLength(0);
    expect(await readBehaviours(), "no-preference should animate scripted scrolls").toContain("smooth");
  });

  test("mode menu dismisses when keyboard focus leaves its wrapper", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockMinimalDashboardApi(page);
    await gotoApp(page);
    await expectDashboardUsable(page);

    const modeButton = page.getByRole("button", { name: "Mode Answer", exact: true });
    const modeMenu = page.getByRole("menu", { name: "Choose app mode", exact: true });
    await modeButton.click();
    await expect(modeMenu).toBeVisible();
    await expect(modeButton).toHaveAttribute("aria-expanded", "true");
    // Opening moves focus into the current mode one animation frame later. Under load WebKit
    // ran that frame after the Shift+Tab below, so the keypress left the row, landed back
    // on the trigger inside the wrapper, and the menu stayed open. Let the deferred focus
    // land first so the keypress starts from the trigger as intended.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    await modeButton.press("Shift+Tab");
    await expect(modeButton).not.toBeFocused();
    await expect(modeButton).toHaveAttribute("aria-expanded", "false");
    await expect(modeMenu).toBeHidden();
  });

  test("shared-home mode changes keep the document title aligned with visible copy", async ({ page }) => {
    await mockMinimalDashboardApi(page);
    await gotoApp(page);

    await expect(page).toHaveTitle("Clinical Answers | PsychSift");
    await page.getByRole("button", { name: /Mode\s*Answer/i }).click();
    const modeMenu = page.getByRole("menu");
    await expect(modeMenu).toBeVisible();
    await modeMenu.getByText("Dictionary", { exact: true }).click();

    await expect(page).toHaveURL(/\?mode=dictionary$/);
    await expect(page.getByRole("heading", { level: 2, name: "Clinical Dictionary" })).toBeVisible();
    await expect(page).toHaveTitle("Clinical Dictionary | PsychSift");

    // Repeated parameters are an adversarial deep-link case. The first value is
    // the canonical selection used by both the server metadata and client state.
    await page.goto("/?mode=therapy-compass&mode=dictionary", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: "Therapy" })).toBeVisible();
    await expect(page).toHaveTitle("Therapy | PsychSift");
  });

  test("an open sheet deactivates the page behind it and releases it on close", async ({ page }) => {
    // jsdom cannot enforce `inert`, so the browser is the only place the modal
    // containment contract (and its release) can actually be proven.
    await page.setViewportSize({ width: 390, height: 844 });
    await mockMinimalDashboardApi(page);
    await gotoApp(page);
    await expectDashboardUsable(page);

    const readState = () =>
      page.evaluate(() => {
        const marked = Array.from(document.querySelectorAll('[data-sheet-inert="true"]'));
        const dialog = document.querySelector('[role="dialog"]');
        const background = marked.flatMap((element) => Array.from(element.querySelectorAll("button, a[href]"))).at(0);
        let focusRefused: boolean | null = null;
        if (background instanceof HTMLElement) {
          const before = document.activeElement;
          background.focus();
          focusRefused = document.activeElement !== background;
          if (before instanceof HTMLElement) before.focus();
        }
        return {
          marked: marked.length,
          allInert: marked.every((element) => element.hasAttribute("inert")),
          dialogIsMarked: dialog != null && dialog.closest('[data-sheet-inert="true"]') != null,
          focusInDialog: dialog != null && document.activeElement != null && dialog.contains(document.activeElement),
          focusRefused,
          overflow: document.body.style.overflow,
        };
      });

    const modeButton = page.getByRole("button", { name: "Mode Answer", exact: true });
    await modeButton.click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();

    const open = await readState();
    expect(open.marked, "background should be deactivated behind the sheet").toBeGreaterThan(0);
    expect(open.allInert).toBe(true);
    expect(open.dialogIsMarked, "the sheet itself must stay interactive").toBe(false);
    expect(open.focusInDialog).toBe(true);
    expect(open.focusRefused, "the browser must refuse focus into the deactivated background").toBe(true);
    expect(open.overflow).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]').first()).toBeHidden();

    await expect
      .poll(async () => (await readState()).marked, { message: "inert markers must be released on close" })
      .toBe(0);
    await expect(page.locator("[inert]")).toHaveCount(0);
    await expect(modeButton).toBeFocused();
    expect((await readState()).overflow).toBe("");
  });

  test("phone privacy link meets the tap target and guests do not poll private ingestion routes", async ({ page }) => {
    const privateIngestionRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/ingestion\/(?:jobs|batches|quality)(?:\?|$)/.test(request.url())) {
        privateIngestionRequests.push(request.url());
      }
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await mockMinimalDashboardApi(page);
    await gotoApp(page);
    await expectDashboardUsable(page);

    const targetSizes = await Promise.all(
      [page.getByRole("link", { name: "Privacy and data processing", exact: true })].map((target) =>
        target.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
      ),
    );

    for (const targetSize of targetSizes) {
      expect(targetSize.width).toBeGreaterThanOrEqual(44);
      expect(targetSize.height).toBeGreaterThanOrEqual(44);
    }
    expect(privateIngestionRequests).toEqual([]);
  });

  test("dashboard remains usable with forced colors", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize({ width: 390, height: 844 });
    await mockMinimalDashboardApi(page);
    await gotoApp(page);

    await expectDashboardUsable(page);
    await openScopeControl(page);
    await expectNoPageHorizontalOverflow(page);
  });

  test("solid-button label tokens stay legible with forced colors", async ({ browserName, page }) => {
    test.skip(
      browserName === "webkit",
      "WebKit has no forced-colors implementation; Playwright's forcedColors emulation cannot engage the @media (forced-colors: active) token remap under test (the guarded glyph-backplate behavior is Chromium's).",
    );
    // Chromium paints a Canvas backplate behind every glyph run in forced-colors
    // mode: a label whose color resolves into the Canvas/ButtonFace family
    // disappears into its own backplate (axe cannot see this — it reads CSS,
    // not painted pixels). Lock the glyph tokens to a non-Canvas resolution.
    await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockMinimalDashboardApi(page);
    // Target the expanded sidebar's solid --command "New chat" button. With the
    // collapsed-by-default rail, getByRole("New chat").first() would hit the
    // icon-rail control (text-muted), not the solid label this regression guards.
    await page.addInitScript(() => window.localStorage.setItem("clinical-kb-sidebar-collapsed", "0"));
    await gotoApp(page);
    await expectDashboardUsable(page);

    const newChat = page.locator("#clinical-tools-sidebar").getByRole("button", { name: "New chat" });
    await expect(newChat).toBeVisible();
    const { canvas, buttonLabelColor, tokenColors } = await newChat.evaluate((button) => {
      const probe = document.createElement("span");
      document.body.append(probe);
      const resolveColor = (value: string) => {
        probe.style.color = "";
        probe.style.color = value;
        return getComputedStyle(probe).color;
      };
      const resolvedCanvas = resolveColor("Canvas");
      const glyphTokens = [
        "--command-contrast",
        "--primary-contrast",
        "--clinical-accent-contrast",
        "--danger-solid-contrast",
      ].map((token) => [token, resolveColor(`var(${token})`)] as const);
      probe.remove();
      return {
        canvas: resolvedCanvas,
        buttonLabelColor: getComputedStyle(button).color,
        tokenColors: glyphTokens,
      };
    });

    expect(buttonLabelColor).not.toBe(canvas);
    for (const [token, color] of tokenColors) {
      expect(`${token}: ${color}`).not.toBe(`${token}: ${canvas}`);
    }
  });

  test("dashboard remains usable at 200 percent zoom", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockMinimalDashboardApi(page);
    await gotoApp(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });

    await expectDashboardUsable(page);
    await expectNoPageHorizontalOverflow(page);
  });

  test("dashboard passes axe WCAG A/AA scan with default colors", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockMinimalDashboardApi(page);
    await gotoApp(page);

    // Scan only after the usability gate: the shell double-renders during hydration and a
    // premature scan reports duplicated-landmark false positives.
    await expectDashboardUsable(page);
    await expectNoBlockingAxeViolations(page, testInfo);
  });

  test("dashboard passes axe WCAG A/AA scan with forced colors", async ({ page }, testInfo) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.setViewportSize({ width: 390, height: 844 });
    await mockMinimalDashboardApi(page);
    await gotoApp(page);

    await expectDashboardUsable(page);
    // color-contrast is unreliable under forced-colors emulation (the OS palette overrides
    // author colors); contrast is asserted by the default-colors scan instead.
    await expectNoBlockingAxeViolations(page, testInfo, { disableRules: ["color-contrast"] });
  });

  // The wide presentation is a different container from the phone sheet — a
  // non-modal panel anchored under the trigger rather than a modal full-height
  // rail. jsdom proves the roles and the dismiss paths; only a browser can show
  // that it is actually placed under its trigger and leaves the results
  // reachable. See docs/filter-contract.md section 5b.
  test("the desktop differential filter opens under its trigger and leaves the results reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockMinimalDashboardApi(page);
    await mockDifferentialSearch(page);
    await gotoApp(page, "/differentials");

    const presentationInput = page.locator('input[placeholder="Ask or search a presentation..."]:visible').first();
    const differentialSubmit = page.locator('button[aria-label="Search differential presentations"]:visible');
    await expect(async () => {
      await presentationInput.fill("acute confusion");
      await expect(presentationInput).toHaveValue("acute confusion");
      await expect(differentialSubmit).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await differentialSubmit.click();
    const results = visibleByTestId(page, "differentials-search-results");
    await expect(results).toBeVisible();

    const trigger = page.getByTestId("differential-filter-trigger-desktop");
    await expect(trigger).toBeVisible();
    await trigger.click();

    const panel = page.getByTestId("differential-filter-panel");
    await expect(panel).toBeVisible();
    // Non-modal: no focus trap, no inert background. The list being filtered
    // stays on screen and hit-testable, which is the whole reason the rail went.
    await expect(panel).not.toHaveAttribute("aria-modal", "true");
    await expect(results).toBeVisible();

    // Anchored, not a full-height rail: it starts below the trigger and is
    // materially shorter than the viewport.
    const triggerBox = (await trigger.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 1);
    expect(panelBox.height).toBeLessThan(700);
    // Right-aligned to the trigger rather than pinned to the viewport edge.
    // Left-aligned to the trigger: the panel's leading edge lines up with the
    // control that opened it, rather than being pinned to the viewport edge.
    expect(Math.abs(panelBox.x - triggerBox.x)).toBeLessThan(4);

    // The lens is a segmented bar here, and still a real radiogroup.
    const showGroup = panel.getByRole("radiogroup", { name: "Show" });
    await expect(showGroup.getByRole("radio", { name: /^All/ })).toBeChecked();
    await showGroup.getByRole("radio", { name: /^Presentations/ }).click();
    await expect(showGroup.getByRole("radio", { name: /^Presentations/ })).toBeChecked();

    // Escape dismisses and hands focus back to the control that opened it.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("differential result types use an accessible mobile filter instead of tabs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockMinimalDashboardApi(page);
    await mockDifferentialSearch(page);
    await gotoApp(page, "/differentials");

    // Retry fill-then-enabled together: the server-rendered composer is visible
    // before React controls it, and a fill landing in that gap is discarded by
    // hydration, leaving the search button disabled and the click a no-op.
    const presentationInput = page.locator('input[placeholder="Ask or search a presentation..."]:visible').first();
    const differentialSubmit = page.locator('button[aria-label="Search differential presentations"]:visible');
    await expect(async () => {
      await presentationInput.fill("acute confusion");
      await expect(presentationInput).toHaveValue("acute confusion");
      await expect(differentialSubmit).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await differentialSubmit.click();
    await expect(visibleByTestId(page, "differentials-search-results")).toBeVisible();

    // The phone filter is a trigger opening a sheet, not a native select. Its
    // resting accessible name must still say there is nothing applied, because
    // the badge that carries that information visually is absent at zero.
    const filterTrigger = page.getByTestId("differential-filter-trigger-phone");
    await expect(filterTrigger).toBeVisible();
    await expect(filterTrigger).toHaveAccessibleName(/No filters active/);
    await expect(page.getByRole("tab")).toHaveCount(0);

    await filterTrigger.focus();
    await expect(filterTrigger).toBeFocused();
    await filterTrigger.press("Enter");

    // One-of-N, expressed as radios: selecting one dimension must uncheck the
    // other rather than leaving two contradictory filters both "on".
    const filterGroup = page.getByRole("radiogroup", { name: "Show" });
    await expect(filterGroup).toBeVisible();
    await expect(filterGroup.getByRole("radio", { name: /^All/ })).toBeChecked();
    await filterGroup.getByRole("radio", { name: /^Presentations/ }).click();
    await expect(filterGroup.getByRole("radio", { name: /^Presentations/ })).toBeChecked();
    await expect(filterGroup.getByRole("radio", { name: /^All/ })).not.toBeChecked();
    await filterGroup.getByRole("radio", { name: /^Differentials/ }).click();
    await expect(filterGroup.getByRole("radio", { name: /^Differentials/ })).toBeChecked();

    // The radio role promises a keyboard model, so prove it in a real browser and
    // not only in jsdom: one tab stop, arrows moving focus AND selection, Home and
    // End reaching the ends. jsdom cannot vouch for focus behaviour under a real
    // focus trap, which is what the sheet puts around this group.
    const all = filterGroup.getByRole("radio", { name: /^All/ });
    const presentations = filterGroup.getByRole("radio", { name: /^Presentations/ });
    const differentials = filterGroup.getByRole("radio", { name: /^Differentials/ });
    await differentials.focus();
    await differentials.press("Home");
    await expect(all).toBeFocused();
    await expect(all).toBeChecked();
    await all.press("ArrowRight");
    await expect(presentations).toBeFocused();
    await expect(presentations).toBeChecked();
    await presentations.press("End");
    await expect(differentials).toBeFocused();
    await expect(differentials).toBeChecked();
    // Exactly one tab stop for the group — the checked option.
    await expect(differentials).toHaveAttribute("tabindex", "0");
    await expect(all).toHaveAttribute("tabindex", "-1");
    await expect(presentations).toHaveAttribute("tabindex", "-1");

    await page.getByTestId("differential-filter-panel-done").click();
    await expect(filterTrigger).toHaveAccessibleName(/1 filter active/);
  });

  test("document actions do not offer uploads and preserve focus", async ({ page }) => {
    await page.setViewportSize({ width: 414, height: 820 });
    await mockMinimalDashboardApi(page);
    await gotoApp(page);

    const menuTrigger = page.getByRole("button", { name: "Open answer options" });
    await expect(menuTrigger).toBeVisible();
    await menuTrigger.click();
    const menu = page.getByTestId("daily-actions-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: /Add document|Upload PDF/ })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const activeElement = document.activeElement;
          return activeElement instanceof HTMLElement
            ? `${activeElement.tagName}:${activeElement.getAttribute("aria-label") ?? activeElement.textContent?.trim() ?? ""}:${activeElement.getClientRects().length > 0 ? "visible" : "hidden"}`
            : "none";
        }),
      )
      .toBe("BUTTON:Open answer options:visible");
  });

  test("Therapy Compass preserves focus, selection, tap targets, and fixed paper tokens", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 390, height: 844 });
    // `/therapy-compass` redirects to the shared home since consolidation; going
    // there directly keeps this on the surface it is asserting about.
    await page.goto("/?mode=therapy-compass", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Therapy", exact: true })).toBeVisible({
      timeout: 60_000,
    });

    for (const width of [320, 390, 639, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await expectNoPageHorizontalOverflow(page);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/therapy-compass/search", { waitUntil: "domcontentloaded" });
    // The shared `ModeNav` routes with real hrefs, so the current page is a
    // link with `aria-current`, not a button with an onClick. Deep links,
    // middle-click, back and prefetch all work as a result.
    await expect(
      page.getByRole("navigation", { name: "Therapy pages" }).getByRole("link", { name: "Search", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const therapyRibbon = page.getByTestId("search-query-ribbon");
    await expect(therapyRibbon.getByRole("heading", { name: "All", level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(therapyRibbon.getByRole("group", { name: "Filter therapy results" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search therapies" })).toHaveCount(0);
    // Topics and availability used to be two native `<select>`s faking
    // multi-select: `value` pinned to "", a literal "✓ " prefix in option text,
    // and the placeholder row doing the reporting ("1 topics selected"). A
    // listbox cannot express "three of these are on", so assistive technology
    // was told the opposite of what the visible text said. Both are now the
    // shared `aria-pressed` facet toggles every adopted mode uses, converged
    // onto `ResultFilterSheet`/`ResultFilterTrigger` (docs/filter-contract.md).
    const therapyFilterTrigger = therapyRibbon.getByTestId("therapy-filter-trigger-phone");
    await expect(therapyFilterTrigger).toBeVisible();
    await expect(therapyFilterTrigger).toHaveAccessibleName(/Filter/);
    await expect(therapyFilterTrigger).toHaveAttribute("aria-haspopup", "dialog");

    await therapyFilterTrigger.focus();
    const triggerFocus = await therapyFilterTrigger.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
    });
    expect(triggerFocus.outlineStyle).not.toBe("none");
    expect(triggerFocus.outlineWidth).toBeGreaterThanOrEqual(2);

    const triggerSize = await therapyFilterTrigger.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    // 44, not 48. This trigger sits in the ribbon's utility row, which is
    // `min-h-tap` (44px) throughout — raising only this control would leave the
    // row visibly ragged. (`ResultSortControl` set that rhythm before it became
    // `sm`-and-up; the row still holds it.) The repo's `min-h-12` rule
    // exists to stop generic a11y advice pulling production down to `min-h-11`
    // (a known `ui-smoke` flake), not to override a page's own row rhythm; the
    // sheet's own toggles, which have the room, are `min-h-12`.
    expect(triggerSize.width).toBeGreaterThanOrEqual(44);
    expect(triggerSize.height).toBeGreaterThanOrEqual(44);

    await therapyFilterTrigger.click();
    const therapyFilterPanel = page.getByTestId("therapy-filter-panel");
    await expect(therapyFilterPanel).toBeVisible();
    await expect(therapyFilterTrigger).toHaveAttribute("aria-expanded", "true");
    const therapyPanelId = await therapyFilterPanel.getAttribute("id");
    expect(therapyPanelId).toBeTruthy();
    await expect(therapyFilterTrigger).toHaveAttribute("aria-controls", therapyPanelId!);

    // The state the old select could not express: selection is on the control
    // itself, and turning one on leaves the others alone. Names carry a
    // trailing count ("CBT (158)") via the shared facet chip's `aria-label` —
    // section 3's "how many would I have if I ticked this as well" — so match
    // on the prefix rather than the exact string.
    const cbtToggle = therapyFilterPanel.getByRole("button", { name: /^CBT/ });
    const reviewedToggle = therapyFilterPanel.getByRole("button", { name: /^Reviewed only/ });
    await expect(cbtToggle).toHaveAttribute("aria-pressed", "false");
    await cbtToggle.click();
    await expect(cbtToggle).toHaveAttribute("aria-pressed", "true");
    // How many therapies are reviewed depends on the catalogue's clinical
    // sign-off state, which this accessibility test must not pin. Assert the
    // shared facet contract for either state instead: a zero-count option is
    // disabled rather than offering a control that can never produce results,
    // and a non-zero one turns on by itself without disturbing CBT.
    await expect(reviewedToggle).toHaveAttribute("aria-label", /\(\d+\)$/);
    const reviewedCount = Number(/\((\d+)\)$/.exec((await reviewedToggle.getAttribute("aria-label")) ?? "")?.[1]);
    if (reviewedCount === 0) {
      await expect(reviewedToggle).toBeDisabled();
      await expect(reviewedToggle).toHaveAttribute("aria-pressed", "false");
    } else {
      await expect(reviewedToggle).toBeEnabled();
      await reviewedToggle.click();
      await expect(reviewedToggle).toHaveAttribute("aria-pressed", "true");
    }
    await expect(cbtToggle).toHaveAttribute("aria-pressed", "true");

    await therapyFilterPanel.getByTestId("therapy-filter-panel-clear").click();
    await expect(cbtToggle).toHaveAttribute("aria-pressed", "false");
    await expect(reviewedToggle).toHaveAttribute("aria-pressed", "false");

    await therapyFilterPanel.getByTestId("therapy-filter-panel-done").click();
    await expect(therapyFilterPanel).toHaveCount(0);

    // End-to-end guard the component tests cannot give: it is `SearchScreen`
    // that decides what the trigger counts, and what the sheet's Clear all
    // can reach. A query-only session has nothing for the filter sheet to
    // clear — the composer's own "Clear search" already covers the query, on
    // every breakpoint — so Clear all must be absent rather than present and
    // wiping a search the reader cannot see it is about to lose
    // (docs/filter-contract.md section 6: "onClearAll never touches the query").
    await page.goto("/therapy-compass/search?q=anxiety", { waitUntil: "domcontentloaded" });
    await expect(therapyRibbon.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
    const queryOnlyTrigger = therapyRibbon.getByTestId("therapy-filter-trigger-phone");
    await expect(queryOnlyTrigger).toHaveAccessibleName(/No filters active/);
    await queryOnlyTrigger.click();
    const queryOnlyPanel = page.getByTestId("therapy-filter-panel");
    await expect(queryOnlyPanel.getByTestId("therapy-filter-panel-clear")).toHaveCount(0);
    await queryOnlyPanel.getByTestId("therapy-filter-panel-done").click();

    await expectNoPageHorizontalOverflow(page);

    // The record is taken from the catalogue manifest rather than hardcoded.
    // `/brief` calls notFound() for any record without a brief version, so a
    // pinned slug silently turns this accessibility assertion into a 404 the
    // moment that record's `briefInterventionAvailable` changes — which is
    // exactly what happened when the flag stopped being asserted for all 205
    // records and CBT, a "Group programme", correctly lost it.
    expect(THERAPY_CATALOGUE_SUMMARY.defaultBriefSlug, "catalogue has no brief-capable record").toBeTruthy();
    await page.goto(`/therapy-compass/${THERAPY_CATALOGUE_SUMMARY.defaultBriefSlug}/brief`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Brief Intervention" })).toBeVisible({ timeout: 60_000 });
    const durationTabs = page.getByRole("tablist", { name: "Brief intervention duration" });
    const fiveMinuteTab = durationTabs.getByRole("tab", { name: "5 minutes", exact: true });
    const fifteenMinuteTab = durationTabs.getByRole("tab", { name: "15 minutes", exact: true });
    await expect(fiveMinuteTab).toHaveAttribute("aria-selected", "true");
    await fifteenMinuteTab.click();
    await expect(fiveMinuteTab).toHaveAttribute("aria-selected", "false");
    await expect(fifteenMinuteTab).toHaveAttribute("aria-selected", "true");

    await page.goto("/therapy-compass/cognitive-behavioural-therapy-cbt/sheet", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Patient Sheet Builder" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("radio", { name: "Plain", exact: true })).toBeChecked();

    const clinicianSwitch = page.getByRole("switch", { name: "Show clinician footer" });
    const clinicianSwitchSize = await clinicianSwitch.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    expect(clinicianSwitchSize.width).toBeGreaterThanOrEqual(44);
    expect(clinicianSwitchSize.height).toBeGreaterThanOrEqual(44);

    // Sheet builder therapy picker — the only aria-expanded control in the builder rail.
    const builderPicker = page.locator("[data-therapy-root] button[aria-expanded]").first();
    await expect(builderPicker).toHaveAttribute("aria-expanded", "false");
    await builderPicker.click();
    await expect(builderPicker).toHaveAttribute("aria-expanded", "true");
    await builderPicker.click();
    await expect(builderPicker).toHaveAttribute("aria-expanded", "false");

    const paper = page.locator("[data-therapy-paper]");
    const paperColors = await paper.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        ink: style.getPropertyValue("--tc-paper-ink").trim(),
        muted: style.getPropertyValue("--tc-paper-muted").trim(),
      };
    });
    expect(paperColors).toEqual({ background: "rgb(255, 255, 255)", ink: "#0f1720", muted: "#5b6472" });

    const editable = paper.locator('[contenteditable="true"]').first();
    await editable.focus();
    const editableOutline = await editable.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(editableOutline).not.toBe("none");
    await expectNoBlockingAxeViolations(page, testInfo);
  });
  // The accent must actually win the cascade. Tailwind's utilities layer outranks
  // `@layer components` regardless of specificity, and `.search-band-lead` is
  // deliberately unlayered, so a layered rule degrades it to a zero-width box
  // while every class-presence assertion still passes — the same failure the old
  // border-top version of this test caught, in the same place. Assert computed
  // style, not classes.
  //
  // It also asserts the fault signal, which the border-top version could not: a
  // border has no style to change, and the state tile that used to carry a
  // CircleAlert is gone. Under forced colors --clinical-accent resolves to
  // LinkText and --warning is not remapped at all, so hue cannot carry state
  // there; the mark carries it as stroke count instead.
  test("search results band renders the accent rail and survives forced colors", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/services?q=CMHT&run=1", { waitUntil: "domcontentloaded" });
    const band = page.locator('[data-testid="search-query-ribbon"]:visible').first();
    await expect(band).toBeVisible({ timeout: 20_000 });

    const lead = band.locator(".search-band-lead").first();
    await expect(lead).toBeAttached();

    const rail = await lead.evaluate((node) => {
      const style = getComputedStyle(node);
      const card = node.closest('[data-testid="search-query-ribbon"]') as HTMLElement;
      // Reading the custom property off the element can hand back another
      // `var(...)`; resolve it through a real colour property instead so the
      // comparison is between two computed rgb values.
      const probe = document.createElement("span");
      probe.style.color = "var(--clinical-accent)";
      card.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return {
        width: style.borderLeftWidth,
        style: style.borderLeftStyle,
        color: style.borderLeftColor,
        accent,
        neutral: getComputedStyle(card).borderTopColor,
        cardTopWidth: getComputedStyle(card).borderTopWidth,
        height: Math.round(node.getBoundingClientRect().height),
        tone: node.getAttribute("data-tone"),
      };
    });

    // Assert the probe produced real values before trusting any comparison: a
    // silently-null measurement is exactly the kind of evidence that reads as a
    // pass. This suite has been burned by one.
    expect(rail.accent, "the accent probe returned nothing to compare against").toMatch(/^rgba?\(/);
    expect(rail.tone, "a healthy search must render the accent tone").toBe("accent");
    expect(rail.width, "lead rule must be 2px, not a collapsed or inert border").toBe("2px");
    expect(rail.style, "one stroke is a healthy search; two means degraded").toBe("solid");
    expect(rail.height, "lead rule must be 18px tall, not stretched or zero").toBe(18);
    expect(rail.color, "lead rule must resolve to --clinical-accent").toBe(rail.accent);
    expect(rail.color, "lead rule must not degrade to the card's neutral border").not.toBe(rail.neutral);
    expect(rail.color, "lead rule must not be inert/transparent").not.toBe("rgba(0, 0, 0, 0)");
    // The accent lives inside the padding now. A 2px top border here would be the
    // old full-width rail leaking back alongside the new mark.
    expect(rail.cardTopWidth, "the card keeps its 1px neutral border, not a second accent rail").toBe("1px");

    // Poll: the forced-colors style recalc does not always land on the first read
    // after emulateMedia resolves.
    await page.emulateMedia({ forcedColors: "active" });
    await expect
      .poll(async () => lead.evaluate((node) => getComputedStyle(node).borderLeftWidth), { timeout: 10_000 })
      .toBe("2px");
    await expect(lead).toHaveCSS("border-left-style", "solid");
    await page.emulateMedia({ forcedColors: "none" });
  });

  // The state that must never be carried by colour alone. Split from the test
  // above because it needs an intercepted route, and because a fault signal that
  // regresses is a clinical defect rather than a styling one: without it a failed
  // search is visually identical to a successful one.
  test("a faulted search is legible as shape, not only as hue", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // `/api/differentials`, NOT `/api/search`. This page's catalog hook fetches
    // `/api/differentials?kind=diagnosis|presentation` (`use-differential-catalog.ts:204`)
    // and never touches `/api/search`, so intercepting the latter faults
    // nothing and the band stays healthy — the test then hangs on a fault panel
    // that will never render. That swap was made on review advice and shipped
    // without running this spec; it cost two red `Production UI` shards.
    await page.route(/\/api\/differentials(?:\?.*)?$/, (route) =>
      route.fulfill({ status: 500, json: { error: "down" } }),
    );
    await page.goto("/differentials?q=acute+confusion&run=1", { waitUntil: "domcontentloaded" });

    const band = page.locator('[data-testid="search-query-ribbon"]:visible').first();
    await expect(band.locator('[data-testid="search-query-ribbon-fault"]')).toBeVisible({ timeout: 20_000 });

    const lead = band.locator(".search-band-lead").first();
    await expect(lead).toHaveAttribute("data-tone", "warning");
    await expect(lead).toHaveCSS("border-left-style", "double");
    await expect(lead).toHaveCSS("border-left-width", "6px");
    // The third non-chromatic channel, and the invariant behind it: a search that
    // failed has no count to report, so no digit may reach the DOM.
    await expect(band.getByRole("status")).not.toHaveText(/\d/);

    await page.emulateMedia({ forcedColors: "active" });
    await expect
      .poll(async () => lead.evaluate((node) => getComputedStyle(node).borderLeftStyle), { timeout: 10_000 })
      .toBe("double");
    await expect(lead).toHaveCSS("border-left-width", "6px");
    // Redundant on purpose: at 58px an 18px mark is easy to miss, so the card's
    // own top edge doubles too.
    await expect(band).toHaveCSS("border-top-style", "double");
    await page.emulateMedia({ forcedColors: "none" });
  });

  test("fault recovery actions wrap instead of clipping on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Differentials is the widest fault: Retry plus two "Browse …" links. Their
    // combined width exceeds a 390px panel, and the band root is
    // `overflow-hidden`, so without wrapping the trailing link is cut off.
    // See the sibling test above: this page's search is `/api/differentials`.
    await page.route(/\/api\/differentials(?:\?.*)?$/, (route) =>
      route.fulfill({ status: 500, json: { error: "down" } }),
    );
    await page.goto("/differentials?q=acute+confusion&run=1", { waitUntil: "domcontentloaded" });

    const fault = page.locator('[data-testid="search-query-ribbon-fault"]:visible').first();
    await expect(fault).toBeVisible({ timeout: 20_000 });

    const actions = fault.locator("a, button");
    await expect(actions).toHaveCount(3);

    const panelBox = await fault.boundingBox();
    expect(panelBox).not.toBeNull();
    const boxes = await actions.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top };
      }),
    );

    for (const box of boxes) {
      expect(box.left, "a recovery action must not start left of the fault panel").toBeGreaterThanOrEqual(
        panelBox!.x - 1,
      );
      expect(box.right, "a recovery action must not be clipped by the overflow-hidden band").toBeLessThanOrEqual(
        panelBox!.x + panelBox!.width + 1,
      );
    }

    // Proof the row actually wrapped rather than merely fitting: three actions
    // this wide cannot share one line at 390px.
    expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBeGreaterThan(1);
  });
});
