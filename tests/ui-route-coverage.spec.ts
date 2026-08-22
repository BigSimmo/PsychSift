import { resolve } from "node:path";
import type { Route } from "playwright-core";
import { expect, test, type Locator, type Page } from "playwright/test";

import { demoDocuments, getDemoDocument, getDemoDocumentPayload } from "../src/lib/demo-data";
import { getDifferentialDetailContext, getDifferentialRecord } from "../src/lib/differentials";
import { loadMedicationSnapshot } from "../src/lib/medication-snapshot";
import { visibleByTestId } from "./playwright-settlement";

const routeViewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

const differentialDesignSweepViewports = [320, 390, 639, 768, 1440, 1920] as const;

const readySetupChecks = [
  { id: "env", label: ".env.local configured", status: "ready", detail: "Local route fixture ready." },
  { id: "project", label: "Clinical KB Database target", status: "ready", detail: "Local route fixture ready." },
  { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Local route fixture ready." },
  { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Local route fixture ready." },
  { id: "openai", label: "OpenAI API key available", status: "ready", detail: "Not used by this test." },
  { id: "worker", label: "npm run worker running", status: "unknown", detail: "Not required by this test." },
];

const problemsByPage = new WeakMap<Page, string[]>();

function externalHttpUrlPattern(baseURL: string) {
  const localOrigin = new URL(baseURL).origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(?!${localOrigin}(?:/|$))https?://`);
}

async function blockExternalRequests(page: Page, problems: string[], baseURL: string) {
  await page.route(externalHttpUrlPattern(baseURL), async (route) => {
    const url = new URL(route.request().url());
    problems.push(`external ${route.request().method()} ${url.origin}${url.pathname}`);
    await route.abort("blockedbyclient");
  });
}

async function proveExternalRequestGuard(page: Page, problems: string[]) {
  const problemCountBeforeProbe = problems.length;
  const outcome = await page.evaluate(async () => {
    try {
      await fetch("https://example.invalid/route-coverage-acl-probe");
      return "resolved";
    } catch {
      return "blocked";
    }
  });
  const records = problems.splice(problemCountBeforeProbe);
  expect(outcome).toBe("blocked");
  expect(records).toEqual(["external GET https://example.invalid/route-coverage-acl-probe"]);
}

async function fulfillDocumentRequest(route: Route, pathname: string, url: URL) {
  const signedUrlMatch = pathname.match(/^\/api\/documents\/([^/]+)\/signed-url$/);
  if (signedUrlMatch) {
    const document = getDemoDocument(decodeURIComponent(signedUrlMatch[1]));
    if (!document) {
      await route.fulfill({ status: 404, json: { error: "Local demo document not found." } });
      return true;
    }
    await route.fulfill({
      json: { url: document.storage_path, fileType: document.file_type, demoMode: true },
    });
    return true;
  }

  const documentMatch = pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (!documentMatch) return false;
  const payload = getDemoDocumentPayload(
    decodeURIComponent(documentMatch[1]),
    url.searchParams.get("chunk") ?? undefined,
  );
  if (!payload) {
    await route.fulfill({ status: 404, json: { error: "Local demo document not found." } });
    return true;
  }
  await route.fulfill({ json: { ...payload, demoMode: true } });
  return true;
}

async function installOfflineApiFixtures(page: Page, problems: string[]) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;

    if (pathname === "/api/local-project-id") {
      await route.fulfill({
        json: {
          appName: "Clinical KB",
          projectId: "route-coverage-fixture",
          identityPath: "/api/local-project-id",
          localServer: { safeLocalOrigin: true },
        },
      });
      return;
    }
    if (pathname === "/api/setup-status") {
      await route.fulfill({ json: { demoMode: true, checks: readySetupChecks } });
      return;
    }
    if (pathname === "/api/medications") {
      const records = loadMedicationSnapshot();
      await route.fulfill({ json: { records, total: records.length, governance: {}, demoMode: true } });
      return;
    }
    if (pathname === "/api/documents") {
      await route.fulfill({
        json: {
          documents: demoDocuments,
          demoMode: true,
          pagination: {
            limit: 150,
            offset: 0,
            total: demoDocuments.length,
            nextOffset: demoDocuments.length,
            hasMore: false,
          },
        },
      });
      return;
    }
    if (/^\/api\/ingestion\/(jobs|batches|quality)$/.test(pathname)) {
      await route.fulfill({ json: { jobs: [], batches: [], items: [], demoMode: true } });
      return;
    }
    if (pathname === "/api/registry/records") {
      await route.fulfill({ json: { records: [], total: 0, governance: {}, demoMode: true } });
      return;
    }
    if (pathname === "/api/search/universal") {
      const query = url.searchParams.get("q") ?? "";
      const response = {
        query,
        tookMs: 0,
        demoMode: true,
        contextMode: url.searchParams.get("mode") ?? "therapy-compass",
        preferredDomains: ["therapies"],
        domainOrder: [],
        groups: [],
      };
      await route.fulfill({
        body: `${JSON.stringify({ type: "complete", response })}\n`,
        contentType: "application/x-ndjson; charset=utf-8",
      });
      return;
    }
    const differentialMatch = pathname.match(/^\/api\/differentials\/([^/]+)$/);
    if (differentialMatch) {
      const record = getDifferentialRecord(decodeURIComponent(differentialMatch[1]));
      if (!record) {
        await route.fulfill({ status: 404, json: { error: "Local differential fixture not found." } });
        return;
      }
      await route.fulfill({
        json: {
          record,
          detailContext: getDifferentialDetailContext(record),
          governance: { sourceStatus: "current", validationStatus: "approved" },
          demoMode: true,
        },
      });
      return;
    }
    if (await fulfillDocumentRequest(route, pathname, url)) return;

    problems.push(`api ${route.request().method()} ${pathname}`);
    await route.abort("blockedbyclient");
  });
}

async function installTherapyFixtures(page: Page) {
  await page.route("**/therapy-compass-data/*.json", async (route) => {
    const filename = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    if (!/^(?:therapies(?:-(?:home|index))?\.[a-f0-9]{16}|pathways|reference)\.json$/.test(filename)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      path: resolve(process.cwd(), "public", "therapy-compass-data", filename),
    });
  });
}

async function gotoApp(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page
    .locator("#main-content")
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => undefined);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
          return documentWidth - document.documentElement.clientWidth;
        }),
      { timeout: 5_000 },
    )
    .toBeLessThanOrEqual(2);
}

/**
 * `gotoApp` settles on `domcontentloaded` and the ready assertions below read
 * server-rendered markup, so every one of them can pass before React has
 * hydrated the route. `toBeEnabled()` does not close that gap — the SSR button
 * is enabled and clickable while its `onClick` is still absent, and a click
 * landing in that window is simply dropped, leaving the state attribute at its
 * server value until the assertion times out. That is how the DSM review-lens
 * step failed on PR #2211's `Production UI (1)` (run 32470201734), where
 * `aria-pressed` stayed `"false"` for the full 10s on a single resolved button.
 * Wait for the handler itself before clicking, the same way `ui-smoke.spec.ts`
 * and `ui-tools.spec.ts` do.
 */
async function waitForReactEventHandler(locator: Locator, eventName: "onChange" | "onClick" | "onSubmit" = "onClick") {
  await expect
    .poll(
      async () =>
        locator.evaluate((element, reactEventName) => {
          const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
          if (!propsKey) return false;
          const props = (element as unknown as Record<string, Record<string, unknown>>)[propsKey];
          return typeof props?.[reactEventName] === "function";
        }, eventName),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function proveRenderedRoute(
  page: Page,
  path: string,
  assertReady: (page: Page) => Promise<void>,
  provePhoneAction: (page: Page) => Promise<void>,
) {
  await page.setViewportSize(routeViewports[0]);
  await gotoApp(page, path);
  for (const viewport of routeViewports) {
    await page.setViewportSize(viewport);
    await assertReady(page);
    await expectNoHorizontalOverflow(page);
  }
  await provePhoneAction(page);
}

test.describe("previously uncovered production routes", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page, baseURL }) => {
    const problems: string[] = [];
    problemsByPage.set(page, problems);
    if (!baseURL) throw new Error("ui-route-coverage requires the verified Playwright base URL.");
    page.on("pageerror", (error) => problems.push(`pageerror ${error.message}`));
    await blockExternalRequests(page, problems, baseURL);
    await proveExternalRequestGuard(page, problems);
    await installOfflineApiFixtures(page, problems);
    await installTherapyFixtures(page);
  });

  test.afterEach(async ({ page }) => {
    expect(
      problemsByPage.get(page) ?? [],
      "route made an unmocked API/external request or raised a page error",
    ).toEqual([]);
  });

  test("Therapy Compass renders responsively and opens its local search", async ({ page }) => {
    await proveRenderedRoute(
      page,
      "/therapy-compass",
      async (currentPage) => {
        // `/therapy-compass` redirects onto the shared home, whose per-mode title
        // is a level-2 heading under the page's sr-only "Clinical Guide" h1.
        await expect(currentPage.getByRole("main")).toBeVisible();
        await expect(currentPage.getByRole("heading", { name: "Therapy", level: 2, exact: true })).toBeVisible({
          timeout: 30_000,
        });
      },
      async (currentPage) => {
        // The "Common therapy searches" pills lived on the retired detailed home,
        // which moved to /mockups when Therapy joined the shared home. The
        // destination they opened is what this step is really about, so go there:
        // a submitted therapy search, which is also where the mode nav renders.
        await currentPage.goto("/therapy-compass/search?q=Anxiety+in+outpatient+care&run=1", {
          waitUntil: "domcontentloaded",
        });
        await expect(
          currentPage.getByRole("heading", { name: "Anxiety in outpatient care", level: 1, exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(visibleByTestId(currentPage, "search-query-ribbon")).toBeVisible();
        // The common-search pill lands on `/therapy-compass/search`, which is the
        // shared `ModeNav`. It portals into the header collapse host (outside
        // [data-therapy-root]), so read the canvas colour from the workspace root
        // still in the page, and prove the bar is anchored under the collapsing top bar.
        const nav = currentPage.getByRole("navigation", { name: "Therapy pages" });
        const layout = await nav.evaluate((element) => {
          const bar = element.querySelector<HTMLElement>(".mode-nav__bar");
          const root = document.querySelector("[data-therapy-root]");
          return {
            backgroundColor: root ? getComputedStyle(root).backgroundColor : "",
            portaledIntoCollapse: Boolean(element.closest('[data-testid="universal-header-collapse"]')),
            // The bar must never scroll sideways: a strip that hides
            // destinations past its right edge is the defect this replaced.
            inlineOverflow: bar ? bar.scrollWidth - bar.clientWidth : Number.POSITIVE_INFINITY,
          };
        });
        // [data-therapy-root] is `background: var(--background)`, so this tracks the app's
        // page floor — canonical v2 white from the root-mounted `.ckb-v2`
        // layer, while the route keeps ownership of its specialised layout.
        expect(layout.backgroundColor).toBe("rgb(255, 255, 255)");
        expect(layout.portaledIntoCollapse).toBe(true);
        expect(layout.inlineOverflow).toBeLessThanOrEqual(1);
      },
    );
  });

  test("Therapy result cards use the full phone width with a symmetric action row", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, "/therapy-compass/search?q=CBT&run=1");

    const card = page.locator("[data-therapy-result-card]").first();
    await expect(card).toBeVisible({ timeout: 30_000 });

    for (const width of [320, 390, 639, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await expectNoHorizontalOverflow(page);

      const layout = await card.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const copy = element.querySelector<HTMLElement>("[data-therapy-result-copy]")!.getBoundingClientRect();
        const evidence = element.querySelector<HTMLElement>("[data-therapy-result-evidence]")!.getBoundingClientRect();
        const actions = element.querySelector<HTMLElement>("[data-therapy-result-actions]")!;
        const buttons = [...actions.querySelectorAll<HTMLButtonElement>("button")].map((button) => {
          const buttonBounds = button.getBoundingClientRect();
          return {
            left: buttonBounds.left,
            right: buttonBounds.right,
            top: buttonBounds.top,
            width: buttonBounds.width,
            height: buttonBounds.height,
          };
        });
        return {
          card: { left: bounds.left, right: bounds.right },
          copyLeft: copy.left,
          evidence: { left: evidence.left, right: evidence.right },
          buttons,
        };
      });

      if (width < 640) {
        expect(Math.abs(layout.evidence.left - layout.card.left), `${width}px evidence left edge`).toBeLessThanOrEqual(
          1,
        );
        expect(
          Math.abs(layout.card.right - layout.evidence.right),
          `${width}px evidence right edge`,
        ).toBeLessThanOrEqual(1);
        expect(layout.copyLeft - layout.card.left, `${width}px copy inset`).toBeGreaterThanOrEqual(15);
        expect(new Set(layout.buttons.map((button) => Math.round(button.top))).size, `${width}px button row`).toBe(1);
        expect(
          Math.max(...layout.buttons.map((button) => button.width)) -
            Math.min(...layout.buttons.map((button) => button.width)),
          `${width}px equal action widths`,
        ).toBeLessThanOrEqual(1);
        for (const button of layout.buttons) {
          expect(button.height, `${width}px action target`).toBeGreaterThanOrEqual(48);
        }
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const compare = card.locator("[data-therapy-result-actions] button").nth(1);
    await expect(compare).toHaveAccessibleName("Compare");
    await compare.focus();
    const focusStyle = await compare.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
    });
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
    await testInfo.attach("therapy-result-card-phone", {
      body: await card.screenshot(),
      contentType: "image/png",
    });

    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await expectNoHorizontalOverflow(page);
    await expect(card.locator("[data-therapy-result-actions] button")).toHaveCount(3);

    await compare.focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/\/therapy-compass\/compare(?:\?.*)?$/);
    const comparisonUrl = new URL(page.url());
    expect(comparisonUrl.searchParams.get("q")).toBe("CBT");
    expect(comparisonUrl.searchParams.get("ids")).toBeTruthy();
    await expect(page.getByRole("heading", { name: "Therapy Comparison", level: 1 })).toBeVisible();
  });

  // `/dsm` redirects onto the shared home, so the route this proves is the shared
  // one with DSM preselected. Comparison moved with it: the Compare action was on
  // the retired detailed home, and its live entry point is the DSM mode nav.
  test("DSM home renders responsively and opens comparison", async ({ page }) => {
    await proveRenderedRoute(
      page,
      "/dsm",
      async (currentPage) => {
        // Scope to the visible owner: Next streaming can leave a hidden duplicate
        // page root (#093), and bare getByTestId then fails Playwright strict mode
        // (Production UI shard 2 on PR #1729).
        await expect(visibleByTestId(currentPage, "shared-home-empty-state")).toBeVisible();
        await expect(currentPage.getByRole("heading", { name: "DSM-5 Diagnosis", level: 2 })).toBeVisible();
      },
      async (currentPage) => {
        await currentPage.goto("/dsm/search?q=major+depressive&run=1", { waitUntil: "domcontentloaded" });
        const compare = currentPage
          .getByRole("navigation", { name: "DSM-5 Diagnosis pages" })
          .getByRole("link", { name: "Compare", exact: true });
        await expect(compare).toBeVisible();
        await compare.click();
        await expect(currentPage).toHaveURL(/\/dsm\/compare$/);
        await expect(currentPage.getByRole("heading", { name: "Compare DSM diagnoses", level: 1 })).toBeVisible();
      },
    );
  });

  test("DSM comparison renders responsively and removes a selected diagnosis", async ({ page }) => {
    await proveRenderedRoute(
      page,
      "/dsm/compare?ids=major-depressive-disorder,bipolar-ii-disorder",
      async (currentPage) => {
        await expect(visibleByTestId(currentPage, "dsm-comparison-page")).toBeVisible();
        await expect(currentPage.getByRole("heading", { name: "Compare DSM diagnoses", level: 1 })).toBeVisible();
      },
      async (currentPage) => {
        // Scope to the visible comparison owner (#093): under Production UI load,
        // Next streaming can leave a hidden duplicate root, and same-route
        // search-param soft-nav has been observed to click without updating the
        // URL. Pin the visible tree and wait for navigation with the click
        // (DsmCompareRemoveLink uses location.assign for this hop).
        const pageRoot = visibleByTestId(currentPage, "dsm-comparison-page");
        const remove = pageRoot.getByRole("link", {
          name: "Remove Major depressive disorder from comparison",
        });
        await expect(remove).toBeEnabled();
        // `DsmCompareRemoveLink` is a `<Link>` whose `onClick` calls
        // `preventDefault()` and then `window.location.assign(href)`. Before
        // hydration the anchor is a bare `<a href>`, so a click there races two
        // different navigations — the browser's native one, or React capturing
        // the discrete event for replay once the root hydrates — and neither is
        // guaranteed to leave the URL where this step asserts it. Waiting for
        // the handler makes the assign hop the only path the click can take.
        await waitForReactEventHandler(remove);
        // Same-route `?ids=` assign can update the URL without a new document
        // load. `waitUntil: "domcontentloaded"` then hangs for 30s after the
        // hop already happened (Production UI on #2299: waitForURL timeout
        // while the heading assertion never ran). Wait for the URL only.
        await Promise.all([
          currentPage.waitForURL(/\/dsm\/compare\?ids=bipolar-ii-disorder$/, {
            timeout: 30_000,
          }),
          remove.click(),
        ]);
        await expect(currentPage.getByRole("heading", { name: "Choose at least two diagnoses" })).toBeVisible();
      },
    );
  });

  test("DSM differential considerations render responsively and change review lens", async ({ page }) => {
    await proveRenderedRoute(
      page,
      "/dsm/diagnoses/major-depressive-disorder/differentials",
      async (currentPage) => {
        await expect(visibleByTestId(currentPage, "dsm-differential-considerations-page")).toBeVisible();
        await expect(currentPage.getByRole("heading", { name: "Major depressive disorder", level: 1 })).toBeVisible();
      },
      async (currentPage) => {
        const medicalLens = currentPage.getByRole("button", { name: /Substance \/ medical/ });
        await expect(medicalLens).toBeEnabled();
        await waitForReactEventHandler(medicalLens);
        await medicalLens.click();
        await expect(medicalLens).toHaveAttribute("aria-pressed", "true");
      },
    );
  });

  test("Specifier comparison renders responsively and swaps both selections", async ({ page }) => {
    await proveRenderedRoute(
      page,
      "/specifiers/compare?a=with-mixed-features&b=with-anxious-distress",
      async (currentPage) => {
        await expect(currentPage.getByRole("main")).toBeVisible();
        await expect(currentPage.getByRole("heading", { name: "Compare two specifiers", level: 1 })).toBeVisible();
        await expect(currentPage.getByText("Find the deciding clinical difference.", { exact: true })).toBeVisible();
        await expect(currentPage.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
      },
      async (currentPage) => {
        const selects = currentPage.locator("select");
        const before = await selects.evaluateAll((items) => items.map((item) => (item as HTMLSelectElement).value));
        const swap = currentPage.getByRole("button", { name: "Swap compared specifiers" });
        await expect(swap).toBeEnabled();
        await waitForReactEventHandler(swap);
        await swap.click();
        await expect
          .poll(() => selects.evaluateAll((items) => items.map((item) => (item as HTMLSelectElement).value)))
          .toEqual([before[1], before[0]]);
      },
    );
  });

  test("Specifier map renders responsively and changes its selected specifier", async ({ page }) => {
    await proveRenderedRoute(
      page,
      "/specifiers/map?selected=with-anxious-distress",
      async (currentPage) => {
        await expect(currentPage.getByRole("main")).toBeVisible();
        await expect(currentPage.getByRole("heading", { name: "Find the right specifier", level: 1 })).toBeVisible();
        await expect(currentPage.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
      },
      async (currentPage) => {
        const courseJump = currentPage.getByTestId("specifier-map-jump-course-onset");
        await waitForReactEventHandler(courseJump);
        await courseJump.click();
        await expect(courseJump).toHaveAttribute("aria-current", "true");
        await expect(currentPage).toHaveURL(/#course-onset$/);

        const mixedFeatures = currentPage.getByRole("button", { name: "Mixed features" });
        await expect(mixedFeatures).toBeEnabled();
        await waitForReactEventHandler(mixedFeatures);
        await mixedFeatures.click();
        await expect(mixedFeatures).toHaveAttribute("aria-pressed", "true");
        await expect(currentPage.getByRole("heading", { name: "Mixed features", level: 2 })).toBeVisible();
      },
    );
  });

  test("Differential streams use lightweight controls and open a local entry", async ({ page, browserName }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      const isWebKitViewportDiagnostic =
        browserName === "webkit" && text === 'Viewport argument key "interactive-widget" not recognized and ignored.';
      if (message.type() === "error" && !isWebKitViewportDiagnostic) consoleErrors.push(text);
    });
    await proveRenderedRoute(
      page,
      "/differentials/diagnoses?q=delirium",
      async (currentPage) => {
        await expect(currentPage.getByRole("main")).toBeVisible();
        await expect(currentPage.getByRole("heading", { name: "Diagnoses", level: 1 })).toBeVisible();
        await expect(currentPage.getByText("Compare likely causes and exclusion clues.")).toBeVisible();
        await expect(visibleByTestId(currentPage, "search-query-ribbon")).toBeVisible();
        await expect(currentPage.getByTestId("differentials-stream-match-controls")).toHaveCount(0);
        await expect(currentPage.getByRole("button", { name: "Prev match" })).toHaveCount(0);
        await expect(currentPage.getByRole("button", { name: "Next match" })).toHaveCount(0);

        const headerMetrics = await visibleByTestId(currentPage, "differentials-stream-header").evaluate((header) => {
          const heading = header.querySelector("h1");
          return {
            height: header.getBoundingClientRect().height,
            headingSize: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : Number.POSITIVE_INFINITY,
          };
        });
        expect(headerMetrics.height).toBeLessThan(100);
        expect(headerMetrics.headingSize).toBeLessThanOrEqual(30);

        const scrollOffset = await currentPage.evaluate(() =>
          Math.max(document.scrollingElement?.scrollTop ?? 0, document.querySelector("#main-content")?.scrollTop ?? 0),
        );
        expect(scrollOffset).toBeLessThanOrEqual(2);
      },
      async (currentPage) => {
        for (const width of differentialDesignSweepViewports) {
          await currentPage.setViewportSize({ width, height: width < 768 ? 844 : 900 });
          await expect(currentPage.getByRole("heading", { name: "Diagnoses", level: 1 })).toBeVisible();
          await expectNoHorizontalOverflow(currentPage);
        }
        await currentPage.setViewportSize({ width: 390, height: 844 });

        const filterTrigger = visibleByTestId(currentPage, "differentials-stream-filter-trigger");
        await expect(filterTrigger).toBeVisible();
        await filterTrigger.focus();
        await currentPage.keyboard.press("Enter");

        const filterPanel = visibleByTestId(currentPage, "differentials-stream-filter-panel");
        await expect(filterPanel).toBeVisible();
        const familyView = filterPanel.getByRole("radiogroup", { name: "Family view" });
        const allEntries = familyView.getByRole("radio", { name: "All entries", exact: true });
        await allEntries.focus();
        await currentPage.keyboard.press("ArrowRight");
        await expect(familyView.getByRole("radio", { name: /Focused family/ })).toHaveAttribute("aria-checked", "true");
        await filterPanel.getByTestId("differentials-stream-filter-panel-done").click();
        await expect(filterTrigger).toBeFocused();

        const removeFamily = currentPage.getByRole("button", { name: /Remove Family: .+ filter/ });
        await expect(removeFamily).toBeVisible();
        await removeFamily.click();
        await expect(removeFamily).toHaveCount(0);

        const entry = currentPage.locator('main a[href^="/differentials/diagnoses/"]:visible').first();
        await expect(entry).toBeVisible();
        const entryHref = await entry.getAttribute("href");
        expect(entryHref).toMatch(/^\/differentials\/diagnoses\/[a-z0-9-]+$/);
        await Promise.all([
          currentPage.waitForURL((url) => url.pathname === entryHref, { timeout: 30_000 }),
          entry.click(),
        ]);
      },
    );

    await gotoApp(page, "/differentials/presentations");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(visibleByTestId(page, "search-query-ribbon")).toBeVisible();
    const presentationBrowseTrigger = visibleByTestId(page, "differentials-stream-filter-trigger-desktop");
    await presentationBrowseTrigger.click();
    await expect(page.getByRole("radiogroup", { name: "Clinical urgency" })).toBeVisible();
    await page.getByTestId("differentials-stream-filter-panel-done").click();
    await expect(page.getByText("High-priority presentation pathways")).toBeVisible();
    await expect(page.getByRole("link", { name: /Open pathway/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Show family" })).toHaveCount(0);

    await gotoApp(page, "/differentials/presentations?q=agitation");
    for (const width of differentialDesignSweepViewports) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await expect(page.getByRole("heading", { name: "Presentations", level: 1 })).toBeVisible();
      await expect(
        page.getByText("Start with what is happening now, then open a pathway to compare likely causes."),
      ).toBeVisible();
      await expect(visibleByTestId(page, "search-query-ribbon")).toBeVisible();
      await expect(page.getByTestId("differentials-stream-match-controls")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const presentationFilterTrigger = visibleByTestId(page, "differentials-stream-filter-trigger");
    await presentationFilterTrigger.focus();
    await page.keyboard.press("Enter");
    const presentationFilterPanel = visibleByTestId(page, "differentials-stream-filter-panel");
    await expect(presentationFilterPanel).toBeVisible();
    const allPriorities = presentationFilterPanel.getByRole("radio", { name: "All priorities" });
    await allPriorities.focus();
    await page.keyboard.press("ArrowRight");
    await expect(presentationFilterPanel.getByRole("radio", { name: "Emergent" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await presentationFilterPanel.getByTestId("differentials-stream-filter-panel-done").click();
    await expect(presentationFilterTrigger).toBeFocused();
    await expect(page.getByRole("button", { name: "Remove Priority: Emergent filter" })).toBeVisible();
    const visiblePresentationCards = page.locator('[data-testid^="differential-stream-card-"]:visible');
    await expect(visiblePresentationCards.first()).toHaveAttribute("data-status", "emergent");
    await expect.poll(async () => visiblePresentationCards.count()).toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expectNoHorizontalOverflow(page);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await expect(page.getByRole("heading", { name: "Presentations", level: 1 })).toBeVisible();
    await expect(visibleByTestId(page, "search-query-ribbon")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(consoleErrors, "differential stream and detail should stay console-error free").toEqual([]);
  });

  test("colour-coding reference renders responsively and targets main content from the skip link", async ({ page }) => {
    await proveRenderedRoute(
      page,
      "/reference/colour-coding",
      async (currentPage) => {
        await expect(currentPage.getByRole("main")).toBeVisible();
        await expect(currentPage.getByRole("heading", { name: "Colour coding reference", level: 1 })).toBeVisible();
      },
      async (currentPage) => {
        const skipLink = currentPage.getByRole("link", { name: "Skip to main content" });
        await expect(skipLink).toHaveAttribute("href", "#main-content");
        await expect(skipLink).toBeEnabled();
        await skipLink.focus();
        await expect(skipLink).toBeVisible();
        await skipLink.press("Enter");
        const mainContent = currentPage.locator("#main-content");
        await expect(mainContent).toBeFocused();
        await expect
          .poll(() => mainContent.evaluate((element) => window.getComputedStyle(element).outlineStyle))
          .not.toBe("none");
      },
    );
  });

  test("legacy Applications redirect preserves query parameters at canonical Tools", async ({ page }) => {
    await gotoApp(page, "/applications?source=legacy&tag=one&tag=two");
    const destination = new URL(page.url());
    expect(destination.pathname).toBe("/tools");
    expect(destination.searchParams.get("source")).toBe("legacy");
    expect(destination.searchParams.getAll("tag")).toEqual(["one", "two"]);
    await expect(page.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
  });

  test("Medications index serves the Medication mode home", async ({ page }) => {
    // Previously a 307 to `/?mode=prescribing`. `/` is now the shared home for
    // every mode, so Medication owns a real home here instead of aliasing to it.
    await gotoApp(page, "/medications");
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/medications");
    const destination = new URL(page.url());
    expect(destination.pathname).toBe("/medications");
    expect(destination.searchParams.toString()).toBe("");
    await expect(page.getByRole("button", { name: "Mode Medication" })).toBeVisible({ timeout: 30_000 });
  });

  test("Document source redirect forwards a valid page and chunk", async ({ page }) => {
    const id = demoDocuments[0].id;
    await gotoApp(page, `/documents/source?id=${id}&page=2&chunk=safety%20plan`);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 60_000 }).toBe(`/documents/${id}`);
    const destination = new URL(page.url());
    expect(destination.pathname).toBe(`/documents/${id}`);
    expect(destination.searchParams.get("page")).toBe("2");
    expect(destination.searchParams.get("chunk")).toBe("safety plan");
  });

  test("Document source evidence alias preserves invalid-id fallback", async ({ page }) => {
    await gotoApp(page, "/documents/source/evidence?id=not-a-uuid&page=2");
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/documents/search");
    const destination = new URL(page.url());
    expect(destination.pathname).toBe("/documents/search");
    expect(destination.search).toBe("");
  });
});
