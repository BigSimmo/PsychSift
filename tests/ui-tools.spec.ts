import { expect, test, type Locator, type Page } from "playwright/test";
import { stubZeroTouchPoints } from "./helpers/zero-touch";
import { expectNoPageHorizontalOverflow } from "./helpers/spec-navigation";
import { expectMinTouchTarget } from "./helpers/layout-tolerance";
import type { Route } from "playwright-core";
import { acuteConfusionPresentationWorkflow, differentialRecords } from "../src/lib/differentials";
import { demoAnswer, demoDocuments } from "../src/lib/demo-data";
import { toClientAnswerPayload } from "../src/lib/answer-client-payload";
import { formRecords, rankFormRecords } from "../src/lib/forms";
import { loadMedicationSnapshot } from "../src/lib/medication-snapshot";
import { medicationToSearchResult, rankMedicationRecords } from "../src/lib/medications";
import { sortResultItems } from "../src/lib/result-sort";
import { serviceRecords } from "../src/lib/services";
import { openAppModeMenu } from "./playwright-app-mode";
import {
  appendPrimaryScrollSpacer,
  readMobileComposerReservePx,
  readPrimaryScrollGeometry,
  scrollPrimarySurface,
} from "./playwright-scroll";
import { clickWhenSettled, expectSingleSettledOwner, visibleByTestId } from "./playwright-settlement";

const readySetupChecks = [
  { id: "env", label: ".env.local configured", status: "ready", detail: "Test environment ready." },
  { id: "project", label: "PsychSift Production target", status: "ready", detail: "Test Supabase project ready." },
  { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Test schema ready." },
  { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Test search schema ready." },
  { id: "openai", label: "OpenAI API key available", status: "ready", detail: "Test OpenAI ready." },
  { id: "worker", label: "npm run worker running", status: "unknown", detail: "Worker not required for UI smoke." },
];

async function fulfillAnswerResponse(route: Route, payload: ReturnType<typeof demoAnswer> & { demoMode?: boolean }) {
  const clientPayload = {
    ...toClientAnswerPayload(payload),
    ...(payload.demoMode === undefined ? {} : { demoMode: payload.demoMode }),
  };
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.endsWith("/stream")) {
    const body = [
      `event: progress\ndata: ${JSON.stringify({ stage: "retrieving", message: "Searching indexed documents." })}`,
      `event: final\ndata: ${JSON.stringify(clientPayload)}`,
      "",
    ].join("\n\n");
    await route.fulfill({
      body,
      contentType: "text/event-stream; charset=utf-8",
      headers: { "Cache-Control": "no-cache, no-transform" },
    });
    return;
  }

  await route.fulfill({ json: clientPayload });
}

async function blockExternalRequests(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fallback();
  });
}

function waitForDifferentialCatalogQuery(page: Page, query: string) {
  const expectedQuery = query.trim().toLowerCase();
  return Promise.all(
    ["diagnosis", "presentation"].map((kind) =>
      page.waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.pathname === "/api/differentials" &&
            url.searchParams.get("kind") === kind &&
            url.searchParams.get("q")?.trim().toLowerCase() === expectedQuery &&
            response.ok()
          );
        },
        { timeout: 30_000 },
      ),
    ),
  );
}

async function submitDifferentialSearch(page: Page, query: string) {
  const input = page.locator('input[placeholder="Ask or search a presentation..."]:visible').first();
  const submit = page.locator('button[aria-label="Search differential presentations"]:visible');

  // Own the fill here rather than leaving it to callers. The server-rendered
  // composer is visible before React controls it, so a fill landing in that gap
  // is discarded by hydration and submit stays disabled ("Start a differential
  // search"). Establish the live handler boundary, fill, then confirm the value
  // actually stuck — retrying the whole sequence so a client remount between
  // steps cannot strand a half-applied state.
  await expect(async () => {
    await waitForReactEventHandler(input, "onChange");
    await input.fill(query);
    await expect(input).toHaveValue(query);
    await expect(submit).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  await Promise.all([waitForDifferentialCatalogQuery(page, query), submit.click()]);
}

async function mockAnswerDashboardApi(page: Page) {
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
    await route.fulfill({ json: { demoMode: true, checks: readySetupChecks } });
  });
  await page.route(/\/api\/documents(?:\?.*)?$/, async (route) => {
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
  });
  await page.route(/\/api\/medications(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q")?.trim() || undefined;
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const records = loadMedicationSnapshot();
    const matches = query ? rankMedicationRecords(records, query, limit) : undefined;
    await route.fulfill({
      json: {
        records,
        matches: matches?.map((match) => ({
          medication: match.medication,
          result: medicationToSearchResult(match),
          score: match.score,
          reasons: match.reasons,
        })),
        total: records.length,
        governance: {},
        demoMode: true,
      },
    });
  });
  await page.route(/\/api\/answer(?:\/stream)?(?:\?.*)?$/, async (route) => {
    const body = route.request().postDataJSON() as { query?: string; documentId?: string; documentIds?: string[] };
    const answer = demoAnswer(body.query ?? "What monitoring is required?", body.documentId, body.documentIds);
    await fulfillAnswerResponse(route, { ...answer, demoMode: true });
  });
  await page.route(/\/api\/ingestion\/jobs(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { jobs: [], demoMode: true } });
  });
  await page.route(/\/api\/ingestion\/batches(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { batches: [], demoMode: true } });
  });
  await page.route(/\/api\/ingestion\/quality(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { items: [], demoMode: true } });
  });
  await page.route(/\/api\/registry\/records(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const kind = url.searchParams.get("kind");
    const view = url.searchParams.get("view") ?? "full";
    const records = kind === "form" ? formRecords : serviceRecords;
    await route.fulfill({
      json: {
        records,
        total: records.length,
        verifiedCount: 0,
        ...(view === "full" ? { governance: {} } : {}),
        demoMode: true,
      },
    });
  });
  await page.route(/\/api\/registry\/records\/[^/?]+(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const slug = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const kind = url.searchParams.get("kind");
    const record =
      kind === "form"
        ? formRecords.find((form) => form.slug === slug)
        : serviceRecords.find((service) => service.slug === slug);
    if (!record) {
      await route.fulfill({ status: 404, json: { error: "Registry record not found" } });
      return;
    }
    await route.fulfill({
      json: {
        record,
        linkedDocuments: [],
        governance: { sourceStatus: "current", validationStatus: "unverified" },
        demoMode: true,
      },
    });
  });
}

async function mockDifferentialCatalogApi(page: Page) {
  await page.route(/\/api\/differentials(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q")?.trim() ?? "";
    const kind = url.searchParams.get("kind") ?? "diagnosis";

    if (kind === "presentation") {
      await route.fulfill({
        json: {
          matches: [
            {
              workflow: acuteConfusionPresentationWorkflow,
              score: 1,
              reasons: [`Matched ${query}`],
            },
          ],
          demoMode: true,
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        matches: differentialRecords.slice(0, 20).map((record, index) => ({
          record,
          score: 1 - index / 10,
          reasons: [`Matched ${query}`],
        })),
        demoMode: true,
      },
    });
  });
}

async function commandSurfaceOpensAbovePill(page: Page) {
  const input = visibleGlobalSearchInput(page).first();
  await expect(input).toBeVisible();
  // Phone footer-dock placement is applied after the header's media-query effect.
  // Opening the command surface before that settles leaves the dropdown on the
  // inline placement (hidden below lg) even though the footer composer is visible.
  await page.waitForFunction(
    () => Boolean(document.querySelector("form.answer-footer-search-dock, form.answer-footer-search-edge")),
    undefined,
    { timeout: 10_000 },
  );
  await input.click();
  await expect(async () => {
    await input.press("ArrowDown");
    await expect(page.getByRole("listbox").first()).toBeVisible();
    await expect(page.getByRole("option").first()).toBeVisible();
  }).toPass({ timeout: 15_000 });

  const listbox = page.getByRole("listbox").first();
  await expect(listbox).toBeVisible();

  const geometry = await page.evaluate(() => {
    const pill = document.querySelector(".answer-footer-search-pill");
    const dropdown = document.querySelector(".universal-command-dropdown");
    if (!pill || !dropdown) return null;
    const pillRect = pill.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    return {
      pillTop: pillRect.top,
      dropdownBottom: dropdownRect.bottom,
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry?.dropdownBottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((geometry?.pillTop ?? 0) + 2);
}

/** A tool row's own launch link. The title is the link, and the whole row opens it. */
function toolRowLink(scope: Locator, id: string) {
  return scope.getByTestId(`tool-row-${id}`).getByRole("link");
}

async function gotoLauncher(page: Page, path = "/tools") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 15_000 });
}

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

async function expectIdlePhoneHomeCentered(page: Page, homeTestId: string) {
  await expect(page.getByTestId(homeTestId)).toBeVisible();
  // Hydration/streaming can briefly swap the home, canvas or main node after the first
  // visible paint; read the geometry once all three exist rather than on a single sample.
  const readGeometry = () =>
    page.evaluate((homeTestId) => {
      const home = [...document.querySelectorAll(`[data-testid="${homeTestId}"]`)].find((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      const canvas = document.querySelector("[data-mode-home-canvas]");
      const main = document.getElementById("main-content");
      if (!home || !canvas || !main) return null;
      const homeRect = home.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return {
        homeMidX: homeRect.left + homeRect.width / 2,
        homeMidY: homeRect.top + homeRect.height / 2,
        canvasMidX: canvasRect.left + canvasRect.width / 2,
        canvasMidY: canvasRect.top + canvasRect.height / 2,
        canvasHeight: canvasRect.height,
        docOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        mainOverflowY: main.scrollHeight - main.clientHeight,
      };
    }, homeTestId);
  await expect.poll(readGeometry, { message: "the idle home, canvas and main must all render" }).not.toBeNull();
  const geometry = await readGeometry();

  expect(geometry).not.toBeNull();
  expect(geometry!.docOverflowY).toBeLessThanOrEqual(2);
  expect(geometry!.mainOverflowY).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry!.homeMidY - geometry!.canvasMidY)).toBeLessThanOrEqual(
    Math.max(24, geometry!.canvasHeight * 0.12),
  );
  expect(Math.abs(geometry!.homeMidX - geometry!.canvasMidX)).toBeLessThanOrEqual(24);
  await expectNoPageHorizontalOverflow(page);
}

async function expectMapLabelsContained(canvas: Locator) {
  await expect
    .poll(async () =>
      canvas.locator("[data-map-node]").evaluateAll((nodes) => {
        if (nodes.length === 0) return false;
        return nodes.every((node) => {
          const card = node.getBoundingClientRect();
          const labels = Array.from(node.querySelectorAll<HTMLElement>("[data-map-node-label]"));
          return (
            labels.length > 0 &&
            labels.every((label) => {
              const range = document.createRange();
              range.selectNodeContents(label);
              return Array.from(range.getClientRects()).every(
                (rect) =>
                  rect.left >= card.left - 1 &&
                  rect.right <= card.right + 1 &&
                  rect.top >= card.top - 1 &&
                  rect.bottom <= card.bottom + 1,
              );
            })
          );
        });
      }),
    )
    .toBe(true);
}

function visibleGlobalSearchInput(page: Page) {
  return page.locator('[data-testid="global-search-input"]:visible');
}

async function globalSearchComposerMetrics(page: Page, homeTestId?: string) {
  return visibleGlobalSearchInput(page)
    .first()
    .evaluate((input, homeTestId) => {
      const form = input.closest("form");
      const pill = input.closest(".answer-footer-search-pill");
      const home = homeTestId
        ? [...document.querySelectorAll(`[data-testid="${homeTestId}"]`)].find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const style = window.getComputedStyle(candidate);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          })
        : null;
      if (!form) return null;

      const formRect = form.getBoundingClientRect();
      const homeRect = home?.getBoundingClientRect();
      const style = window.getComputedStyle(form);
      // Sticky-stack hosts (`wide: "sticky"`) keep the composer `relative` inside
      // an outer sticky [top bar | search] wrapper — do not require the form itself
      // to be `position: sticky`.
      let stickyAncestor = style.position === "sticky";
      for (let node: HTMLElement | null = form.parentElement; node && !stickyAncestor; node = node.parentElement) {
        if (window.getComputedStyle(node).position === "sticky") stickyAncestor = true;
      }

      return {
        formLeft: formRect.left,
        formRight: formRect.right,
        formTop: formRect.top,
        formBottom: formRect.bottom,
        formWidth: formRect.width,
        formCenterX: formRect.left + formRect.width / 2,
        formCenterY: formRect.top + formRect.height / 2,
        homeLeft: homeRect?.left ?? null,
        homeRight: homeRect?.right ?? null,
        homeCenterX: homeRect ? homeRect.left + homeRect.width / 2 : null,
        position: style.position,
        stickyAncestor,
        composerPlacement: form.dataset.composerPlacement ?? null,
        insideDesktopPageSlot: Boolean(form.closest('[data-testid="desktop-page-search-composer-slot"]')),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        pillClassName: pill?.className?.toString() ?? "",
      };
    }, homeTestId);
}

async function expectVerticalSeparation(page: Page, upperSelector: string, lowerSelector: string, minimumGap = 8) {
  const metrics = await page.evaluate(
    ({ upperSelector, lowerSelector }) => {
      const upper = document.querySelector(upperSelector)?.getBoundingClientRect();
      const lower = document.querySelector(lowerSelector)?.getBoundingClientRect();
      if (!upper || !lower) return null;
      return {
        upperBottom: upper.bottom,
        lowerTop: lower.top,
      };
    },
    { upperSelector, lowerSelector },
  );

  expect(metrics).not.toBeNull();
  expect((metrics?.lowerTop ?? 0) - (metrics?.upperBottom ?? 0)).toBeGreaterThanOrEqual(minimumGap);
}

test.beforeEach(stubZeroTouchPoints);

test.describe("PsychSift tools directory and legacy launcher", () => {
  test.describe.configure({ timeout: 60_000 });

  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "desktop", width: 1280, height: 900 },
  ] as const) {
    test(`universal mode picker opens the all tools directory at ${viewport.name} width`, async ({ page }) => {
      await mockAnswerDashboardApi(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoLauncher(page, "/?mode=answer");

      const menu = await openAppModeMenu(page, "Answer");
      const toolsOption = menu.getByRole("menuitemradio", { name: /^Tools\b/ });
      await toolsOption.scrollIntoViewIfNeeded();
      await Promise.all([page.waitForURL(/\/tools$/), toolsOption.click()]);

      await expect(visibleByTestId(page, "tools-search-results-page")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Tools", exact: true })).toBeVisible();
      await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
      await expect(page.locator("form.answer-footer-search-dock")).toHaveCount(0);
      await expectNoPageHorizontalOverflow(page);
    });
  }

  for (const viewport of [
    { name: "mobile", width: 390, height: 820 },
    { name: "desktop", width: 1280, height: 900 },
  ] as const) {
    /**
     * This case used to load `/?mode=tools`, the hub that was one of two Tools
     * surfaces. That alias now redirects to the directory, so the same contract is
     * asserted here on the single surface: the pinned row, the safety band ahead of
     * the task groups, the About sheet with a real launch link, and no shared search
     * chrome on a route that owns its own search box.
     */
    test(`the tools directory is usable at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoLauncher(page, "/tools");

      const results = visibleByTestId(page, "tools-search-results-page");
      await expect(results.getByRole("heading", { level: 1, name: "Tools", exact: true })).toBeVisible();
      await expect(results.getByRole("region", { name: "Pinned", exact: true })).toBeVisible();
      // Safety has its own band ahead of the task groups, so nothing can filter it away.
      const safety = results.getByRole("region", { name: "Safety", exact: true });
      await expect(toolRowLink(safety, "risk-safety")).toBeVisible();
      await expect(toolRowLink(safety, "safety-plan")).toHaveAttribute("href", "/safety-plan");
      for (const group of ["Look it up", "Assess", "Treat and plan", "Coordinate"]) {
        await expect(results.getByRole("region", { name: group, exact: true })).toBeVisible();
      }
      if (viewport.name === "mobile") {
        await results.getByRole("button", { name: "About Medication Prescribing" }).click();
        const detailSheet = page.locator('[data-testid="tools-search-detail-sheet"]:visible');
        await expect(detailSheet.getByRole("heading", { name: "Medication Prescribing" })).toBeVisible();
        // Check first is shown in full, not folded behind an accordion.
        await expect(detailSheet.getByRole("heading", { name: "Check first" })).toBeVisible();
        await expect(detailSheet.getByText("Contraindications", { exact: true })).toBeVisible();
        const mobileLaunchLink = detailSheet.locator('a[href="/medications"]').first();
        await expect(mobileLaunchLink).toBeVisible();
        await expect(mobileLaunchLink).not.toHaveAttribute("target", "_blank");
        await detailSheet.getByRole("button", { name: "Close Medication Prescribing" }).click();
        await expect(detailSheet).toHaveCount(0);
      } else {
        await expect(results.getByRole("button", { name: "About PsychSift Search" })).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "Mode Tools" })).toBeVisible();
      await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
      await expect(page.locator("form.answer-footer-search-dock")).toHaveCount(0);
      await expectNoPageHorizontalOverflow(page);
    });
  }

  test("all tools are visible immediately without a shared search composer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/tools");

    const results = visibleByTestId(page, "tools-search-results-page");
    await expect(results).toBeVisible();
    await expect(results.getByRole("heading", { level: 1, name: "Tools", exact: true })).toBeVisible();
    await expect(results.getByRole("heading", { level: 3, name: "PsychSift Search" })).toBeVisible();
    await expect(results.getByRole("heading", { level: 3, name: "Medication Prescribing" })).toBeVisible();
    await expect(toolRowLink(results, "clinical-kb-search")).toHaveAttribute("href", "/?mode=answer");
    await expect(toolRowLink(results, "medication-prescribing")).toHaveAttribute("href", "/medications");
    await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
    await expect(page.locator("form.answer-footer-search-dock")).toHaveCount(0);
    // The route owns its filtering, so it has its own in-flow box and no shared
    // composer. This box came here from the retired `/?mode=tools` hub, which was
    // the only place a tools search could be typed until that alias redirected.
    await expect(page.getByTestId("tools-local-search-input")).toBeVisible();

    // An entry that only opens another mode says so on its row.
    await expect(results.getByTestId("tool-row-risk-safety")).toContainText("Opens Ask with a starter question");

    // Below the fold at 1280x900: see clickWhenSettled for why this click must not scroll.
    await clickWhenSettled(results.getByRole("button", { name: "About Medication Prescribing" }));
    const detailSheet = page.locator('[data-testid="tools-search-detail-sheet"]:visible');
    await expect(detailSheet.getByRole("link", { name: "Open Medication Prescribing" })).toHaveAttribute(
      "href",
      "/medications",
    );
    await expectNoPageHorizontalOverflow(page);
  });

  test("a submitted Tools URL opens the route-owned results page without a composer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoLauncher(page, "/tools?q=Compare&run=1");

    const results = visibleByTestId(page, "tools-search-results-page");
    await expect(results).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
    await expect(page.getByTestId("tools-home")).toHaveCount(0);
    await expect(results.getByRole("heading", { level: 1, name: "Compare" })).toBeVisible();
    await expect(results.getByText("2 tools", { exact: true })).toBeVisible();
    await expect(results.getByRole("heading", { level: 3, name: "Differentials" })).toBeVisible();
    await expect(toolRowLink(results, "differentials")).toHaveAttribute("href", "/?mode=differentials");
    await expect(results.getByRole("heading", { level: 3, name: "Clinical Dictionary" })).toBeVisible();

    // Safety stays one tap away while searching, whatever the query matched.
    const safety = results.getByRole("navigation", { name: "Safety tools" });
    await expect(safety.getByRole("link", { name: "Risk & Safety" })).toBeVisible();
    await expect(safety.getByRole("link", { name: "Safety plan" })).toHaveAttribute("href", "/safety-plan");
    await expect(results.getByRole("region", { name: "Pinned", exact: true })).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("a no-match Tools URL can return to the full catalogue without a composer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoLauncher(page, "/tools?q=unknown&run=1");

    const results = visibleByTestId(page, "tools-search-results-page");
    await expect(results.getByRole("heading", { level: 2, name: "No tools match" })).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
    const showAll = results.getByRole("link", { name: "Show all tools" });
    await expect(showAll).toHaveAttribute("href", "/tools");
    await Promise.all([page.waitForURL(/\/tools$/), showAll.click()]);
    await expect(results.getByRole("heading", { level: 1, name: "Tools", exact: true })).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("submitted Tools results open the About sheet on a phone and return focus", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoLauncher(page, "/tools?q=Compare&run=1");

    const results = visibleByTestId(page, "tools-search-results-page");
    await expect(results).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
    await expect(page.locator("form.answer-footer-search-dock")).toHaveCount(0);

    await expect(toolRowLink(results, "differentials")).toHaveAttribute("href", "/?mode=differentials");
    const details = results.getByRole("button", { name: "About Differentials" });
    await details.click();
    const detailSheet = page.locator('[data-testid="tools-search-detail-sheet"]:visible');
    await expect(detailSheet).toBeVisible();
    await expect(detailSheet.getByRole("heading", { name: "Differentials" })).toBeVisible();
    await expect(detailSheet.getByRole("heading", { name: "Check first" })).toBeVisible();
    await expect(detailSheet.getByRole("link", { name: "Open Differentials" })).toHaveAttribute(
      "href",
      "/?mode=differentials",
    );
    await detailSheet.getByRole("button", { name: "Close Differentials" }).click();
    await expect(details).toBeFocused();
    await expectNoPageHorizontalOverflow(page);
  });

  test("phone Tools launches every shared-home mode without a redirect hop or stale layout", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const launches = [
      { tool: "differentials", mode: "differentials", heading: "Differential Diagnosis" },
      { tool: "clinical-dictionary", mode: "dictionary", heading: "Clinical Dictionary" },
      { tool: "services", mode: "services", heading: "Clinical Services" },
      { tool: "forms", mode: "forms", heading: "Clinical Forms" },
      { tool: "calculators", mode: "calculators", heading: "Clinical Calculators" },
    ] as const;

    for (const launch of launches) {
      await mockAnswerDashboardApi(page);
      await gotoLauncher(page, "/tools");
      const link = toolRowLink(visibleByTestId(page, "tools-search-results-page"), launch.tool);
      await expect(link).toHaveAttribute("href", `/?mode=${launch.mode}`);
      await Promise.all([page.waitForURL(`**/?mode=${launch.mode}`), link.click()]);

      const home = visibleByTestId(page, "shared-home-empty-state");
      await expect(home.getByRole("heading", { level: 2, name: launch.heading })).toBeVisible();
      await expectIdlePhoneHomeCentered(page, "shared-home-empty-state");
    }
  });

  test("all tools stay visible across supported breakpoints and media preferences", async ({ page }) => {
    await gotoLauncher(page, "/tools");

    for (const width of [320, 390, 639, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("heading", { level: 1, name: "Tools", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Safety", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: "PsychSift Search" })).toBeVisible();
      await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
      await expect(page.locator("form.answer-footer-search-dock")).toHaveCount(0);
      await expectNoPageHorizontalOverflow(page);
    }

    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await expect(page.getByRole("heading", { level: 1, name: "Tools", exact: true })).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  // Moved off `/?mode=tools` when that alias started redirecting here. The hrefs are
  // the point of the case and are unchanged: both surfaces read them from the same
  // tools catalogue, so the directory proves the same contract the hub used to.
  test("tool links point to the expected in-app modes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/tools");

    const results = visibleByTestId(page, "tools-search-results-page");
    for (const [id, title, href] of [
      ["medication-prescribing", "Medication Prescribing", "/medications"],
      ["documents", "Documents", "/documents"],
      ["services", "Services", "/?mode=services"],
      ["forms", "Forms", "/?mode=forms"],
      ["favourites", "Saved workflows", "/favourites"],
      ["clinical-kb-search", "PsychSift Search", "/?mode=answer"],
    ] as const) {
      await expect(toolRowLink(results, id)).toHaveAttribute("href", href);
      // Most rows sit below the fold, and the header's scroll-hide moves them mid-click.
      await clickWhenSettled(results.getByRole("button", { name: `About ${title}` }));
      const detail = page.locator('[data-testid="tools-search-detail-sheet"]:visible');
      await expect(detail.getByRole("link", { name: `Open ${title}` })).toHaveAttribute("href", href);
      await detail.getByRole("button", { name: `Close ${title}` }).click();
      await expect(detail).toHaveCount(0);
    }
    // External companion-app launchers were removed; no localhost links should remain.
    await expect(page.locator('a[href^="http://localhost"], a[href^="http://127.0.0.1"]')).toHaveCount(0);
  });

  test("a URL query and filters reduce visible application rows without overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/tools?q=medication");

    await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
    const results = visibleByTestId(page, "tools-search-results-page");
    await expect(results).toBeVisible();
    await expect(results.getByRole("heading", { level: 3, name: "Medication Prescribing" })).toBeVisible();
    await expect(results.getByRole("heading", { level: 3, name: "Documents" })).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("non-submitted tools query keeps the all-results page without a composer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/tools?q=medication&focus=1");

    await expect(page.getByRole("button", { name: "Mode Tools" })).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveCount(0);

    const results = visibleByTestId(page, "tools-search-results-page");
    await expect(results).toBeVisible();
    await expect(results.getByRole("heading", { level: 1, name: "medication" })).toBeVisible();
    const medicationDetails = results.getByRole("button", { name: "About Medication Prescribing" });
    await expect(results.getByRole("heading", { level: 3, name: "Documents" })).toHaveCount(0);
    await expect(page.locator("form.answer-footer-search-dock")).toHaveCount(0);

    await medicationDetails.click();
    const medicationPanel = page.locator('[data-testid="tools-search-detail-sheet"]:visible');
    await expect(medicationPanel).toBeVisible();
    await expect(medicationPanel.getByRole("link", { name: "Open Medication Prescribing" })).toHaveAttribute(
      "href",
      "/medications",
    );
    await expectNoPageHorizontalOverflow(page);
  });

  test("shared-home presentation updates in place when the mode changes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // Asserts the collapsed rail affordance below; explicit for clarity even
    // though collapsed is now the default for new users too.
    await page.addInitScript(() => window.localStorage.setItem("clinical-kb-sidebar-collapsed", "1"));
    await gotoLauncher(page, "/?mode=answer");

    const sharedHome = visibleByTestId(page, "shared-home-empty-state");
    const searchInput = visibleGlobalSearchInput(page);
    const sharedHomeBrand = page.getByTestId("shared-home-brand");
    await expect(sharedHomeBrand).toBeVisible();
    await expect(sharedHomeBrand).toContainText("PsychSift");
    await expect(sharedHomeBrand).toContainText("From question to source");
    await expect(sharedHome.getByRole("heading", { level: 2, name: "Clinical Answers" })).toBeVisible();
    await expect(sharedHome.locator(".mode-home-icon svg")).toHaveClass(/\blucide-sparkles\b/);
    await searchInput.fill("lithium draft");
    const historyLengthBefore = await page.evaluate(() => window.history.length);

    const answerMenu = await openAppModeMenu(page, "Answer");
    const servicesMode = answerMenu.getByRole("menuitemradio", { name: /^Services\b/ });
    await waitForReactEventHandler(servicesMode);
    await servicesMode.click();

    // `/` is the single home page: picking a mode stays put while its hero and
    // composer retarget together. It must NOT navigate to /services.
    await expect(page).toHaveURL(/\/\?mode=services\b/, { timeout: 20_000 });
    const servicesModeButton = page.getByRole("button", { name: "Mode Services" });
    await expect(servicesModeButton).toBeVisible();
    await expect(servicesModeButton).toBeFocused();
    await expect(sharedHome).toBeVisible();
    await expect(sharedHome.getByRole("heading", { level: 2, name: "Clinical Services" })).toBeVisible();
    await expect(sharedHome.locator(".mode-home-icon svg")).toHaveClass(/\blucide-route\b/);
    await expect(sharedHomeBrand).toContainText("PsychSift");
    await expect(page.getByText("Services Navigator", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("services-home")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(page.getByTestId("collapsed-account-settings")).toBeVisible();

    // One composer stays mounted with its draft while every visible mode cue
    // updates from the same URL-owned searchMode.
    await expect(searchInput).toHaveCount(1);
    await expect(searchInput).toHaveAttribute("placeholder", "Search services...");
    await expect(searchInput).toHaveValue("lithium draft");
    expect(await page.evaluate(() => window.history.length)).toBe(historyLengthBefore);

    const servicesMenu = await openAppModeMenu(page, "Services");
    await expect(servicesMenu.getByRole("menuitemradio", { name: /^Answer\b/ })).toBeVisible();
    await expect(servicesMenu.getByRole("menuitemradio", { name: /^Documents\b/ })).toBeVisible();
    await expect(servicesMenu.getByRole("menuitemradio", { name: /^Services\b/ })).toBeVisible();
    await expect(servicesMenu.getByRole("menuitemradio", { name: /^Forms\b/ })).toBeVisible();
    await expect(servicesMenu.getByRole("menuitemradio", { name: /^Differentials\b/ })).toBeVisible();
    await expect(servicesMenu.getByRole("menuitemradio", { name: /^Medication\b/ })).toBeVisible();
    await expect(servicesMenu.getByRole("menuitemradio", { name: /^Tools\b/ })).toBeVisible();
    const formsMode = servicesMenu.getByRole("menuitemradio", { name: /^Forms\b/ });
    await waitForReactEventHandler(formsMode);
    await formsMode.click();
    await expect(page).toHaveURL(/\/\?mode=forms\b/, { timeout: 20_000 });
    const formsModeButton = page.getByRole("button", { name: "Mode Forms" });
    await expect(formsModeButton).toBeVisible();
    await expect(formsModeButton).toBeFocused();
    await expect(sharedHome.getByRole("heading", { level: 2, name: "Clinical Forms" })).toBeVisible();
    await expect(sharedHome.locator(".mode-home-icon svg")).toHaveClass(/\blucide-file-pen-line\b/);
    await expect(page.getByTestId("forms-home")).toHaveCount(0);
    await expect(searchInput).toHaveAttribute("placeholder", "Search forms...");
    await expect(searchInput).toHaveValue("lithium draft");
    expect(await page.evaluate(() => window.history.length)).toBe(historyLengthBefore);
    await expectNoPageHorizontalOverflow(page);
  });

  test("submitting from the shared home opens the selected mode's search page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/?mode=answer");

    const answerMenu = await openAppModeMenu(page, "Answer");
    const dsmMode = answerMenu.getByRole("menuitemradio", { name: /^DSM/ });
    await waitForReactEventHandler(dsmMode);
    await dsmMode.click();
    await expect(page).toHaveURL(/\/\?mode=dsm\b/, { timeout: 20_000 });
    const dsmModeButton = page.getByRole("button", { name: "Mode DSM-5 Diagnosis" });
    await expect(dsmModeButton).toBeVisible();
    await expect(dsmModeButton).toBeFocused();

    // Submitting is the only thing that leaves home.
    //
    // Click the input before filling it (not just `.fill()`, which focuses
    // programmatically without moving the pointer). The new searchable mode
    // dialog is taller/wider than the old flat menu it replaced, so the "DSM"
    // option now renders at a different on-screen position; leaving the
    // pointer stranded there after `dsmMode.click()` puts it exactly over a
    // command-dropdown suggestion once that dropdown opens on focus, and
    // Chromium fires a hover on whatever now sits under a stationary pointer.
    // That hover sets the dropdown's active item, which hijacks Enter to
    // select the suggestion instead of submitting the search. A real mouse
    // user has to move the pointer to the input to focus it, so this pointer
    // relocation is what an actual click already gives them for free.
    await visibleGlobalSearchInput(page).click();
    await visibleGlobalSearchInput(page).fill("bipolar");
    await visibleGlobalSearchInput(page).press("Enter");
    await expect(page).toHaveURL(/\/dsm\/search\?.*q=bipolar/, { timeout: 20_000 });
    await expect(visibleGlobalSearchInput(page)).toHaveCount(1);
    await expectNoPageHorizontalOverflow(page);
  });

  test("dashboard mode switches return answer results to the shared home as a draft", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/?mode=answer&q=lithium+dosing&run=1");
    await expect(page.getByTestId("plain-answer-response")).toHaveCount(1, { timeout: 30_000 });

    const menu = await openAppModeMenu(page, "Answer");
    const formsMode = menu.getByRole("menuitemradio", { name: /^Forms\b/ });
    await waitForReactEventHandler(formsMode);
    await formsMode.click();

    await expect
      .poll(() => {
        const url = new URL(page.url());
        return {
          pathname: url.pathname,
          mode: url.searchParams.get("mode"),
          query: url.searchParams.get("q"),
          run: url.searchParams.get("run"),
        };
      })
      .toEqual({ pathname: "/", mode: "forms", query: "lithium dosing", run: null });
    await expect(page.getByRole("button", { name: "Mode Forms" })).toBeVisible();
    await expect(visibleByTestId(page, "shared-home-empty-state")).toBeVisible();
    await expect(page.getByTestId("plain-answer-response")).toHaveCount(0);
    await expect(visibleGlobalSearchInput(page)).toHaveValue("lithium dosing");
    await expectNoPageHorizontalOverflow(page);
  });

  test("header mode switches return results and mode homes to the shared home", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    await gotoLauncher(page, "/services?q=13YARN&focus=1&run=1");
    await expect(page.getByRole("button", { name: "Mode Services" })).toBeVisible();
    await expect(page.getByText("Services Navigator", { exact: true })).toBeVisible();
    await expect(page.getByTestId("shared-home-brand")).toHaveCount(0);
    await expect(page.getByTestId("service-search-results")).toBeVisible();
    await expect(page.getByTestId("service-search-result-13yarn")).toBeVisible();

    let menu = await openAppModeMenu(page, "Services");
    const formsMode = menu.getByRole("menuitemradio", { name: /^Forms\b/ });
    await expect(formsMode).toBeVisible();
    await waitForReactEventHandler(formsMode);
    await formsMode.click();

    // Results are cleared and the query becomes an unsubmitted draft on the
    // universal home. The picker must not open or pre-run the Forms route.
    await expect(page).toHaveURL(/\/\?mode=forms&q=13YARN$/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Mode Forms" })).toBeVisible();
    await expect(visibleByTestId(page, "shared-home-empty-state")).toBeVisible();
    await expect(page.getByTestId("forms-home")).toHaveCount(0);
    await expect(page.getByTestId("service-search-results")).toHaveCount(0);
    await expect(visibleGlobalSearchInput(page)).toHaveCount(1);
    await expect(visibleGlobalSearchInput(page)).toHaveValue("13YARN");

    // Re-selecting the current mode from its old home also returns to the shared
    // home; same-mode picks must not be mistaken for no-ops on deeper routes.
    // `/forms` is that old home, and now redirects onto the shared one.
    await gotoLauncher(page, "/forms");
    await expect(page.getByRole("button", { name: "Mode Forms" })).toBeVisible();
    await expect(visibleByTestId(page, "shared-home-empty-state")).toBeVisible();

    menu = await openAppModeMenu(page, "Forms");
    const currentFormsMode = menu.getByRole("menuitemradio", { name: /^Forms\b/ });
    await expect(currentFormsMode).toBeVisible();
    await waitForReactEventHandler(currentFormsMode);
    await currentFormsMode.click();

    await expect(page).toHaveURL(/\/\?mode=forms\b/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Mode Forms" })).toBeVisible();
    await expect(visibleByTestId(page, "shared-home-empty-state")).toBeVisible();
    await expect(page.getByTestId("forms-home")).toHaveCount(0);
    await expect(visibleGlobalSearchInput(page)).toHaveCount(1);
    await expect(visibleGlobalSearchInput(page)).toHaveValue("");
    await expectNoPageHorizontalOverflow(page);
  });

  test("phone shared-home presentation stays accessible and centered after a mode change", async ({ page }) => {
    await mockAnswerDashboardApi(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await gotoLauncher(page, "/?mode=answer");
    const sharedHome = page.getByTestId("shared-home-empty-state");
    await expect(sharedHome).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveCount(1, { timeout: 15_000 });

    const answerMenu = await openAppModeMenu(page, "Answer");
    const specifiersMode = answerMenu.getByRole("menuitemradio", { name: /^Specifiers\b/ });
    await waitForReactEventHandler(specifiersMode);
    await specifiersMode.focus();
    await specifiersMode.press("Enter");

    await expect(page).toHaveURL(/\/\?mode=specifiers\b/, { timeout: 20_000 });
    const specifiersModeButton = page.getByRole("button", { name: "Mode Specifiers" });
    await expect(specifiersModeButton).toBeVisible();
    await expect(specifiersModeButton).toBeFocused();
    await expect(sharedHome.getByRole("heading", { level: 2, name: "Diagnostic Specifiers" })).toBeVisible();
    await expect(sharedHome.locator(".mode-home-icon svg")).toHaveClass(/\blucide-tags\b/);

    const heroSearch = sharedHome.getByTestId("global-search-input");
    await expect(visibleGlobalSearchInput(page)).toHaveCount(1);
    await expect(heroSearch).toBeVisible();
    await expect(heroSearch).toHaveAttribute("placeholder", "Describe the presentation or search a specifier...");
    await expect(page.getByTestId("specifiers-home")).toHaveCount(0);

    const expectSoundPhoneGeometry = async () => {
      const searchBox = await heroSearch.boundingBox();
      const headingBox = await page.getByRole("heading", { level: 2, name: "Diagnostic Specifiers" }).boundingBox();
      const mainBox = await page.locator("#main-content").boundingBox();
      expect(searchBox).not.toBeNull();
      expect(headingBox).not.toBeNull();
      expect(mainBox).not.toBeNull();
      expect((headingBox?.y ?? 0) + (headingBox?.height ?? 0)).toBeLessThan(searchBox?.y ?? 0);
      // Search sits in the lower half of the centred cluster, so its midpoint
      // is not the optical centre. Keep a coarse pane bound here; the helper
      // below pins the whole home cluster to the leftover canvas.
      const searchMidpoint = (searchBox?.y ?? 0) + (searchBox?.height ?? 0) / 2;
      const mainTop = mainBox?.y ?? 0;
      const mainHeight = mainBox?.height ?? 844;
      expect(searchMidpoint).toBeLessThan(mainTop + mainHeight * 0.72);
      expect(searchMidpoint).toBeGreaterThan(mainTop + mainHeight * 0.08);
      await expectIdlePhoneHomeCentered(page, "shared-home-empty-state");
      const metrics = await globalSearchComposerMetrics(page, "shared-home-empty-state");
      expect(metrics).not.toBeNull();
      expect(metrics?.position).not.toBe("fixed");
      expect(metrics?.formWidth ?? 0).toBeLessThanOrEqual(390 - 16);
      expect(metrics?.pillClassName).toContain("answer-footer-search-pill");
      expect(metrics?.homeCenterX).not.toBeNull();
      expect(Math.abs((metrics?.formCenterX ?? 0) - (metrics?.homeCenterX ?? 0))).toBeLessThanOrEqual(24);
      await expectNoPageHorizontalOverflow(page);
    };

    await expectSoundPhoneGeometry();
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
    await expectSoundPhoneGeometry();
    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
    await expectSoundPhoneGeometry();
    await expect(page.locator(".answer-footer-search-chip:visible")).toHaveCount(0);
    // The home hero is the only phone surface with the APP-5 privacy notice.
    await expect(page.getByTestId("answer-composer-privacy-warning")).toBeVisible();
  });

  test("idle phone mode homes stay centered without scrolling", async ({ page }) => {
    const sizes = [
      { width: 320, height: 720 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ] as const;
    const homes = ["/?mode=answer", "/?mode=documents"] as const;

    for (const size of sizes) {
      await page.setViewportSize(size);
      for (const path of homes) {
        await mockAnswerDashboardApi(page);
        await gotoLauncher(page, path);
        await expectIdlePhoneHomeCentered(page, "shared-home-empty-state");
      }
    }
  });

  test("320px shared-home presentation wraps the longest mode copy without overflow", async ({ page }) => {
    await mockAnswerDashboardApi(page);
    await page.setViewportSize({ width: 320, height: 720 });

    await gotoLauncher(page, "/?mode=answer");
    const sharedHome = page.getByTestId("shared-home-empty-state");
    const historyLengthBefore = await page.evaluate(() => window.history.length);
    await expect(sharedHome).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveCount(1, { timeout: 15_000 });

    const answerMenu = await openAppModeMenu(page, "Answer");
    const specifiersMode = answerMenu.getByRole("menuitemradio", { name: /^Specifiers\b/ });
    await waitForReactEventHandler(specifiersMode);
    await specifiersMode.focus();
    await specifiersMode.press("Enter");

    await expect(page).toHaveURL(/\/\?mode=specifiers\b/, { timeout: 20_000 });
    const specifiersModeButton = page.getByRole("button", { name: "Mode Specifiers" });
    await expect(specifiersModeButton).toBeFocused();
    await expect(sharedHome.getByRole("heading", { level: 2, name: "Diagnostic Specifiers" })).toBeVisible();
    // The shared home carries the mode's own subtitle, so pin the copy itself
    // rather than a paragraph count that moves with the design. No mode home
    // carries a caveat line under the composer any more.
    await expect(sharedHome.getByText("Check specifier fit and exclusions.", { exact: true })).toBeVisible();
    // Asserted absent rather than simply deleted: this is the browser-level half
    // of the no-caveat contract, which the structural half in
    // tests/mode-home-no-caveat-footer.test.ts cannot provide.
    await expect(
      sharedHome.getByText("Review criteria and exclusions before documenting", { exact: true }),
    ).toHaveCount(0);
    await expect(sharedHome.locator(".mode-home-icon svg")).toHaveClass(/\blucide-tags\b/);
    await expect(visibleGlobalSearchInput(page)).toHaveAttribute(
      "placeholder",
      "Describe the presentation or search a specifier...",
    );
    await expect(page.getByTestId("specifiers-home")).toHaveCount(0);

    const specifiersHeadingBox = await sharedHome
      .getByRole("heading", { level: 2, name: "Diagnostic Specifiers" })
      .boundingBox();
    expect(specifiersHeadingBox).not.toBeNull();
    expect((specifiersHeadingBox?.x ?? 0) + (specifiersHeadingBox?.width ?? 0)).toBeLessThanOrEqual(320);
    let metrics = await globalSearchComposerMetrics(page, "shared-home-empty-state");
    expect(metrics).not.toBeNull();
    expect(metrics?.position).not.toBe("fixed");
    expect(metrics?.formWidth ?? 0).toBeLessThanOrEqual(320 - 16);
    const specifiersComposerTop = metrics?.formTop ?? 0;
    await expectNoPageHorizontalOverflow(page);

    const specifiersMenu = await openAppModeMenu(page, "Specifiers");
    const formulationMode = specifiersMenu.getByRole("menuitemradio", { name: /^Formulation\b/ });
    await waitForReactEventHandler(formulationMode);
    await formulationMode.focus();
    await formulationMode.press("Enter");

    await expect(page).toHaveURL(/\/\?mode=formulation\b/, { timeout: 20_000 });
    const formulationModeButton = page.getByRole("button", { name: "Mode Formulation" });
    await expect(formulationModeButton).toBeFocused();
    const formulationModeLabel = formulationModeButton.getByText("Formulation", { exact: true });
    await expect(formulationModeLabel).toBeVisible();
    expect(
      await formulationModeLabel.evaluate((label) => label.scrollWidth <= label.clientWidth),
      "the full 320px mode label should fit without visual truncation",
    ).toBe(true);
    await expect(sharedHome.getByRole("heading", { level: 2, name: "Clinical Formulation" })).toBeVisible();
    await expect(sharedHome.locator(".mode-home-icon svg")).toHaveClass(/\blucide-network\b/);
    await expect(visibleGlobalSearchInput(page)).toHaveAttribute(
      "placeholder",
      "Describe a pattern or clinical clue...",
    );
    await expect(page.getByTestId("formulation-home")).toHaveCount(0);
    await expect(visibleGlobalSearchInput(page)).toHaveCount(1);
    expect(await page.evaluate(() => window.history.length)).toBe(historyLengthBefore);

    const formulationHeadingBox = await sharedHome
      .getByRole("heading", { level: 2, name: "Clinical Formulation" })
      .boundingBox();
    expect(formulationHeadingBox).not.toBeNull();
    expect((formulationHeadingBox?.x ?? 0) + (formulationHeadingBox?.width ?? 0)).toBeLessThanOrEqual(320);
    metrics = await globalSearchComposerMetrics(page, "shared-home-empty-state");
    expect(metrics).not.toBeNull();
    expect(metrics?.position).not.toBe("fixed");
    expect(metrics?.formWidth ?? 0).toBeLessThanOrEqual(320 - 16);
    expect(Math.abs((metrics?.formTop ?? 0) - specifiersComposerTop)).toBeLessThanOrEqual(1);
    await expectNoPageHorizontalOverflow(page);
  });

  test("phone mode homes keep the in-flow hero pill, matching the answer home", async ({ page }) => {
    await mockAnswerDashboardApi(page);
    await page.setViewportSize({ width: 390, height: 820 });

    for (const home of [
      // Consolidated modes: the shared home is now the only home they have, and
      // it must keep the in-flow hero pill for each of them. `factsheets` and
      // `dictionary` borrow `resultKind: "tools"` as a benign search kind and
      // used to inherit the Tools dock exception here, losing the hero pill,
      // ticker and privacy line — which is why they are named individually.
      { path: "/?mode=services", testId: "shared-home-empty-state" },
      { path: "/?mode=forms", testId: "shared-home-empty-state" },
      { path: "/?mode=differentials", testId: "shared-home-empty-state" },
      { path: "/?mode=factsheets", testId: "shared-home-empty-state" },
      { path: "/?mode=dictionary", testId: "shared-home-empty-state" },
      // Still route-owned homes, and still held to the same contract.
      { path: "/favourites", testId: "favourites-hub" },
      { path: "/?mode=therapy-compass", testId: "shared-home-empty-state" },
      // /tools is the documented exception: phones use the shared footer dock
      // instead of the in-flow hero pill (docs/search-chrome-behaviour.md).
    ] as const) {
      await gotoLauncher(page, home.path);
      const homeSurface = page.getByTestId(home.testId);
      // Production hydration can briefly overlap the outgoing server tree and
      // the settled client tree. Require the DOM to converge to one owner
      // before using strict locators; duplicate settled homes still fail.
      await expectSingleSettledOwner(homeSurface, { message: `${home.path} home owner` });
      await expectSingleSettledOwner(page.getByTestId("global-search-input"), {
        message: `${home.path} composer owner`,
      });

      // The composer sits in the middle of the hero (in-flow) at phone width too,
      // not docked to the bottom edge: it renders inside the mode-home composer
      // slot and there is no fixed bottom dock.
      await expect(page.locator(".mode-home-composer-slot").getByTestId("global-search-input"), home.path).toHaveCount(
        1,
      );
      await expect(page.locator("form.answer-footer-search-dock"), home.path).toHaveCount(0);

      const metrics = await globalSearchComposerMetrics(page, home.testId);
      expect(metrics, home.path).not.toBeNull();
      // In-flow (not viewport-fixed), scrolls with the content, and stays within
      // the phone column. The pill class is shared with the dock, so it still
      // reads answer-footer-search-pill.
      expect(metrics?.position, home.path).not.toBe("fixed");
      expect(metrics?.formWidth ?? 0).toBeLessThanOrEqual(390);
      expect(metrics?.pillClassName).toContain("answer-footer-search-pill");
      // The APP-5 privacy notice rides the hero pill on phones too (as on desktop),
      // except on Favourites, which omits it by owner decision 2026-09-30.
      await expect(page.getByTestId("answer-composer-privacy-warning"), home.path).toHaveCount(
        home.path === "/favourites" ? 0 : 1,
      );
      if (home.path !== "/favourites") {
        await expect(page.getByTestId("answer-composer-privacy-warning"), home.path).toBeVisible();
      }

      // The in-flow composer must not cover the page with the universal sheet.
      const heroInput = page.locator(".mode-home-composer-slot").getByTestId("global-search-input");
      await heroInput.click();
      await heroInput.press("ArrowDown");
      await expect(page.locator(".universal-command-dropdown:visible")).toHaveCount(0);
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await expectNoPageHorizontalOverflow(page);
    }
  });

  // Required-gate guard for the bug class PR #456 fixed and then reintroduced in
  // a narrower form: a mode-home page rendering with NO search composer at some
  // width. Presence plus hero containment are asserted at the extreme widths on
  // one dashboard-shell home and one standalone-shell home; the full 5-route
  // design spec stays in the advisory "mode home routes center the shared
  // search on mobile" test above.
  for (const viewport of [
    { name: "phone", width: 390, height: 820 },
    { name: "desktop", width: 1280, height: 900 },
  ] as const) {
    for (const home of [
      { path: "/?mode=answer", testId: "shared-home-empty-state" },
      { path: "/?mode=services", testId: "shared-home-empty-state" },
    ] as const) {
      test(`mode home search composer is present at ${viewport.name} width on ${home.path} @critical`, async ({
        page,
      }) => {
        await mockAnswerDashboardApi(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoLauncher(page, home.path);
        const homeSurface = page.getByTestId(home.testId);
        await expect(homeSurface).toHaveCount(1, { timeout: 15_000 });
        await expect(homeSurface).toBeVisible();
        // The composer must never vanish: exactly one visible search input.
        await expect(visibleGlobalSearchInput(page)).toHaveCount(1, { timeout: 15_000 });
        // The hero owns the composer at every width: the answer home and every
        // standalone mode home keep the in-flow hero pill, phones included.
        await expect(homeSurface.getByTestId("global-search-input")).toBeVisible();
      });
    }
  }

  test("answer composer keeps the PHI warning visible before submission @critical", async ({ page }) => {
    await mockAnswerDashboardApi(page);

    for (const viewport of [
      { width: 390, height: 820 },
      { width: 1280, height: 900 },
    ] as const) {
      await page.setViewportSize(viewport);
      await gotoLauncher(page, "/?mode=answer");

      const warning = page.getByTestId("answer-composer-privacy-warning");
      await expect(warning).toBeVisible();
      await expect(warning).toContainText("Do not enter patient-identifiable information.");
      await expect(warning.getByRole("link", { name: "Privacy and data processing" })).toBeVisible();
      await expect(visibleGlobalSearchInput(page)).toHaveAttribute(
        "aria-describedby",
        "answer-composer-privacy-warning",
      );
      // The composer notice is the single site-wide privacy element — no other
      // /privacy link (e.g. the old hero-footer duplicate) may render with it.
      await expect(page.locator('a[href="/privacy"]')).toHaveCount(1);
    }
  });

  for (const home of [
    { path: "/?mode=answer", testId: "shared-home-empty-state", heroTestId: "shared-home-empty-state" },
    // Consolidated modes share one hero, so each is checked through the shared
    // home its bare path now redirects to. The copy differs per mode, which is
    // what makes more than one row worth running. Medication (prescribing) was
    // the last standalone home to join this list (2026-09): `/medications` now
    // redirects here too, and its own `medication-home` idle view is retired.
    {
      path: "/?mode=prescribing",
      testId: "shared-home-empty-state",
      heroTestId: "shared-home-empty-state",
    },
    {
      path: "/?mode=documents",
      testId: "shared-home-empty-state",
      heroTestId: "shared-home-empty-state",
    },
    { path: "/?mode=services", testId: "shared-home-empty-state", heroTestId: "shared-home-empty-state" },
    { path: "/?mode=forms", testId: "shared-home-empty-state", heroTestId: "shared-home-empty-state" },
    {
      path: "/?mode=differentials",
      testId: "shared-home-empty-state",
      heroTestId: "shared-home-empty-state",
    },
  ] as const) {
    test(`mode home hero uses the shared mobile sizing on ${home.path}`, async ({ page }) => {
      await mockAnswerDashboardApi(page);
      await page.setViewportSize({ width: 390, height: 820 });
      await gotoLauncher(page, home.path);
      const homeRegion = page.getByTestId(home.testId);
      await expect(homeRegion).toHaveCount(1, { timeout: 15_000 });
      await expect(homeRegion).toBeVisible();

      const icon = homeRegion.locator(".mode-home-icon").first();
      await expect(icon).toBeVisible();
      const iconBox = await icon.boundingBox();
      expect(iconBox, `${home.path} hero icon`).not.toBeNull();

      // ModeHomeHero gives its heading the deterministic id `<heroTestId>-title`
      // (role/name lookups can collide with sr-only section headings).
      const heading = page.locator(`#${home.heroTestId}-title`);
      await expect(heading).toBeVisible();
      const headingFontSize = await heading.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      const subtitle = heading.locator("xpath=following-sibling::p[1]");
      // The shared home carries a per-mode subtitle like every standalone mode
      // home, so it takes the same sizing assertions rather than opting out.
      await expect(subtitle).toBeVisible();
      const subtitleFontSize: number = await subtitle.evaluate((el) =>
        Number.parseFloat(getComputedStyle(el).fontSize),
      );
      const expectedTypeSizes = await page.evaluate(() => {
        const resolveFontSize = (token: string) => {
          const probe = document.createElement("span");
          probe.style.fontSize = `var(${token})`;
          document.body.append(probe);
          const size = Number.parseFloat(getComputedStyle(probe).fontSize);
          probe.remove();
          return size;
        };
        return {
          hero: resolveFontSize("--text-hero"),
          subtitle: resolveFontSize("--text-sm"),
        };
      });

      const metrics = {
        iconWidth: Math.round(iconBox?.width ?? 0),
        iconHeight: Math.round(iconBox?.height ?? 0),
        headingFontSize,
      };
      // The hero tile is `h-tap w-tap` on phones, so it tracks `--spacing-tap`
      // (48px since PR 5b), not a standalone pixel choice.
      expect(metrics.iconWidth).toBe(48);
      expect(metrics.iconHeight).toBe(48);
      expect(metrics.headingFontSize).toBeCloseTo(expectedTypeSizes.hero, 1);
      expect(subtitleFontSize).toBeCloseTo(expectedTypeSizes.subtitle, 1);

      await expectNoPageHorizontalOverflow(page);
    });
  }

  test("phone bottom-dock search keeps the command results sheet hidden", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await gotoLauncher(page, "/services?q=13YARN&focus=1&run=1");
    await expect(page.getByRole("button", { name: "Mode Services" })).toBeVisible();
    const input = visibleGlobalSearchInput(page).first();
    await expect(input).toBeVisible();
    const quickFilter = page.getByTestId("service-filter-trigger-phone");
    await expect(quickFilter).toBeVisible();
    await expect(quickFilter).toHaveAccessibleName(/No filters active/);
    await expect(page.getByTestId("service-quick-search-suggestions")).toHaveCount(0);
    await input.fill("crisis");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/services\/search\?.*q=crisis/);

    // Phones keep the full search results in the page instead of opening a
    // command sheet over the small viewport.
    await input.click();
    await input.press("ArrowDown");
    await expect(page.locator(".universal-command-dropdown:visible")).toHaveCount(0);
    await expect(page.getByRole("listbox", { name: "Services search suggestions" })).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("tablet non-Tools mode homes keep the shared search in the hero, not the bottom dock", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    for (const home of ["/services", "/forms", "/differentials"]) {
      await gotoLauncher(page, home);
      const heroInput = page.locator(".mode-home-composer-slot").getByTestId("global-search-input");
      await expect(heroInput).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("form.answer-footer-search-dock")).toHaveCount(0);

      // The pill sits in the flow of the hero, not fixed to the viewport bottom.
      const geometry = await heroInput.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
      });
      expect(geometry.top).toBeGreaterThan(0);
      expect(geometry.bottom).toBeLessThan(geometry.viewportHeight - 40);
      await expectNoPageHorizontalOverflow(page);
    }
  });

  test("tablet legacy Tools alias redirects to the directory without shared search chrome", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoLauncher(page, "/?mode=tools");

    await page.waitForURL(/\/tools$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tools", exact: true })).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveCount(0);
    await expect(page.locator("form.answer-footer-search-dock")).toHaveCount(0);
    await expect(page.getByTestId("tools-search-results-page").getByTestId("tools-local-search-input")).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
  });

  test("desktop answer footer opens the command surface above the pill", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/?mode=answer&q=lithium+dosing&run=1");
    await expect(page.getByTestId("plain-answer-response")).toHaveCount(1, { timeout: 30_000 });

    const metrics = await globalSearchComposerMetrics(page);
    expect(metrics?.position).toBe("fixed");
    await expect(page.locator(".answer-footer-search-chip:visible")).toHaveCount(0);
    await commandSurfaceOpensAbovePill(page);
    await expectNoPageHorizontalOverflow(page);
  });

  for (const viewport of [
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 900 },
  ] as const) {
    for (const home of [
      {
        path: "/?mode=answer",
        testId: "shared-home-empty-state",
        heading: "Clinical Answers",
        headingLevel: 2,
      },
      {
        path: "/?mode=documents",
        testId: "shared-home-empty-state",
        heading: "Clinical Documents",
        headingLevel: 2,
      },
      // Consolidated modes reach the same hero through the shared home; the
      // heading is the mode's own `sharedHomePresentation` title at level 2.
      // Medication (prescribing) joined this list in 2026-09 when `/medications`
      // stopped rendering its own `medication-home` idle view and started
      // redirecting here like the others — the heading text is unchanged, since
      // both surfaces read it from the same `sharedHomePresentation.prescribing`.
      {
        path: "/?mode=prescribing",
        testId: "shared-home-empty-state",
        heading: "Medication Reference",
        headingLevel: 2,
      },
      {
        path: "/?mode=services",
        testId: "shared-home-empty-state",
        heading: "Clinical Services",
        headingLevel: 2,
      },
      { path: "/?mode=forms", testId: "shared-home-empty-state", heading: "Clinical Forms", headingLevel: 2 },
      {
        path: "/?mode=differentials",
        testId: "shared-home-empty-state",
        heading: "Differential Diagnosis",
        headingLevel: 2,
      },
    ] as const) {
      test(`mode home search is centered at ${viewport.name} width on ${home.path}`, async ({ page }) => {
        await mockAnswerDashboardApi(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoLauncher(page, home.path);
        const homeRoot = page.locator(`[data-testid="${home.testId}"]:visible`).last();
        await expect(homeRoot).toBeVisible();
        await expect(visibleGlobalSearchInput(page)).toHaveCount(1);

        // From the tablet breakpoint up the composer is portaled into the hero
        // (inside the mode-home container) rather than floated over the heading.
        const heroSearch = homeRoot.getByTestId("global-search-input");
        await expect(heroSearch).toBeVisible();

        const searchBox = await heroSearch.boundingBox();
        // Scope to the mode-home container and match exactly: the standalone
        // "Medication" hero title is otherwise a substring of the answer
        // section's sr-only "Medication matches" heading (strict-mode clash).
        const headingBox = await page
          .locator(`[data-testid="${home.testId}"]:visible`)
          .last()
          .getByRole("heading", { level: home.headingLevel, name: home.heading, exact: true })
          .boundingBox();
        expect(searchBox).not.toBeNull();
        expect(headingBox).not.toBeNull();
        // Search sits below the heading with no overlap.
        expect((headingBox?.y ?? 0) + (headingBox?.height ?? 0)).toBeLessThanOrEqual(searchBox?.y ?? 0);

        const metrics = await globalSearchComposerMetrics(page, home.testId);
        expect(metrics, `${home.path} at ${viewport.name}`).not.toBeNull();
        expect(metrics?.position).not.toBe("fixed");
        expect(metrics?.pillClassName).toContain("answer-footer-search-pill");
        expect(metrics?.formWidth ?? 0).toBeLessThanOrEqual(viewport.width - 16);
        expect(metrics?.homeLeft).not.toBeNull();
        expect(metrics?.homeRight).not.toBeNull();
        expect(metrics?.homeCenterX).not.toBeNull();
        expect(metrics?.formLeft ?? 0).toBeGreaterThanOrEqual((metrics?.homeLeft ?? 0) - 1);
        expect(metrics?.formRight ?? 0).toBeLessThanOrEqual((metrics?.homeRight ?? viewport.width) + 1);
        expect(Math.abs((metrics?.formCenterX ?? 0) - (metrics?.homeCenterX ?? 0))).toBeLessThanOrEqual(24);
        await expectNoPageHorizontalOverflow(page);
      });
    }
  }

  for (const viewport of [
    { name: "mobile", width: 390, height: 820 },
    // Tablet (≥640) shares the desktop-page composer path with desktop; keep one
    // representative width above the phone breakpoint.
    { name: "desktop", width: 1280, height: 900 },
  ] as const) {
    for (const route of [
      {
        path: "/services?q=13YARN&focus=1&run=1",
        modeButton: "Mode Services",
        compactBottomSearch: true,
        ribbonQuery: "13YARN",
      },
      // `/services/13yarn` was listed here while record pages still carried a
      // composer. It is an information page, not a search route, and now owns
      // none — its contract is proved at all six widths by "13YARN service
      // detail is usable at ..." below. Every entry left is a submitted search.
      {
        path: "/forms?q=transport&focus=1&run=1",
        modeButton: "Mode Forms",
        compactBottomSearch: true,
        ribbonQuery: "transport",
      },
      {
        path: "/favourites?q=lithium&focus=1&run=1",
        modeButton: "Mode Favourites",
        compactBottomSearch: true,
        ribbonQuery: "lithium",
      },
      {
        path: "/differentials?q=acute+confusion&focus=1&run=1",
        modeButton: "Mode Differentials",
        compactBottomSearch: true,
        ribbonQuery: "acute confusion",
      },
    ] as const) {
      test(`search route keeps the correct composer at ${viewport.name} width on ${route.path}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await gotoLauncher(page, route.path);
        await expect(page.getByRole("button", { name: route.modeButton })).toBeVisible({ timeout: 20_000 });
        await expect(visibleGlobalSearchInput(page), `${route.path} at ${viewport.name}`).toHaveCount(1, {
          timeout: 20_000,
        });
        if (route.ribbonQuery) {
          // Prefer the settled visible ribbon — CI can leave a hidden Next
          // streaming `#S:1` clone beside the live band (outstanding #093).
          const ribbon = visibleByTestId(page, "search-query-ribbon");
          await expect(ribbon, `${route.path} at ${viewport.name}`).toBeVisible({ timeout: 20_000 });
          await expect(ribbon.getByRole("heading", { name: route.ribbonQuery })).toBeVisible();
          await expect(ribbon.getByRole("status")).toBeVisible();
        }

        const metrics = await globalSearchComposerMetrics(page);
        expect(metrics, `${route.path} at ${viewport.name}`).not.toBeNull();
        expect(metrics?.pillClassName).toContain("answer-footer-search-pill");
        expect(metrics?.formWidth ?? 0).toBeLessThanOrEqual(viewport.width);

        if (viewport.width < 640) {
          expect(metrics?.position).toBe("fixed");
          expect(metrics?.formCenterY ?? 0).toBeGreaterThan(viewport.height * 0.72);
          await expect(page.locator(".answer-footer-search-chip:visible")).toHaveCount(0);
          if (route.compactBottomSearch) {
            // Edge-to-edge dock: the form itself must sit flush to the viewport
            // bottom (safe-area is padding inside the form, not a `bottom` gap).
            expect(metrics?.formBottom ?? 0).toBeGreaterThanOrEqual(viewport.height - 2);
          }
        } else {
          expect(metrics?.composerPlacement).toBe("desktop-page");
          expect(metrics?.insideDesktopPageSlot).toBe(true);
          expect(metrics?.position).toBe("relative");
          expect(metrics?.stickyAncestor).toBe(false);
          expect(metrics?.formCenterY ?? viewport.height).toBeLessThan(viewport.height * 0.35);
          await expect(page.locator(".answer-footer-search-chip:visible")).toHaveCount(0);
        }

        await expectNoPageHorizontalOverflow(page);
      });
    }
  }

  test("mode home deep links preserve focus=1 on initial load", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // `focus=1` has to survive the consolidation hop: `/services?focus=1` is a
    // 307 onto the shared home, and dropping the parameter there would land the
    // visitor on a home with an unfocused composer for no visible reason.
    for (const path of ["/services?focus=1", "/forms?focus=1"]) {
      await gotoLauncher(page, path);
      const composer = visibleByTestId(page, "shared-home-empty-state").getByTestId("global-search-input");
      await expect(composer, path).toBeVisible();
      await expect(composer, path).toBeFocused();
    }
  });

  test("services mode shows source-backed records in search results", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/services?q=13YARN&focus=1&run=1");

    await expect(page.getByRole("button", { name: "Mode Services" })).toBeVisible();
    await expect(page.locator('input[placeholder="Search services..."]:visible').first()).toHaveValue("13YARN");
    await expect(page.getByTestId("service-search-results")).toBeVisible();
    await expect(page.getByTestId("service-search-result-13yarn")).toContainText("13YARN");
    await expect(
      page.getByTestId("service-search-result-13yarn").getByLabel("Review referral for 13YARN"),
    ).toHaveAttribute("href", "/services/13yarn");
    await expectNoPageHorizontalOverflow(page);
  });

  test("services query param fallback ignores whitespace-only q values", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/services?q=%20&query=13YARN&run=1");

    await expect(page.getByRole("button", { name: "Mode Services" })).toBeVisible();
    await expect(page.locator('input[placeholder="Search services..."]:visible').first()).toHaveValue("13YARN");
    await expect(page.getByTestId("service-search-results")).toBeVisible();
    await expect(page.getByTestId("service-search-result-13yarn")).toContainText("13YARN");
    await expectNoPageHorizontalOverflow(page);
  });

  test("services results keep browse navigation and filters without a suggestion rail", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/services?q=13YARN&focus=1&run=1");

    await expect(page.getByRole("heading", { level: 1, name: "13YARN" })).toBeVisible();
    await expect(page.getByLabel("Referral workflow")).toHaveCount(0);
    // The four-card numbered walkthrough stays gone (assertion above); what
    // replaces it is a one-line dot rail under a DIFFERENT accessible name,
    // so the check above cannot be satisfied by quietly renaming the old
    // component back onto this route (ledger #163).
    const referralProgress = page.getByRole("navigation", { name: "Referral progress" });
    await expect(referralProgress).toBeVisible();
    await expect(referralProgress.locator('[aria-current="step"]')).toHaveText("Search");
    await expect(page.getByTestId("services-shortlist-bar")).toHaveCount(0);

    // The row is compact by contract: the Catchment/Eligibility/Cost strip
    // moved to the record, and the bookmark is a persisted favourite that is
    // deliberately distinct from the in-page shortlist.
    const firstResult = page.getByTestId("service-search-result-13yarn");
    await expect(firstResult.getByText("Catchment", { exact: true })).toHaveCount(0);
    await expect(firstResult.getByRole("button", { name: "Save 13YARN to favourites" })).toBeVisible();

    await expect(page.getByTestId("service-quick-search-suggestions")).toHaveCount(0);

    // Exercise a real facet, then clear only that facet while preserving q.
    await page.getByTestId("service-filter-trigger-desktop").click();
    const filterPanel = page.getByTestId("service-filter-panel");

    // The old standalone "Service groups" browse nav is folded into this
    // sheet as a facet (ledger follow-up to #163) rather than a separate
    // route-driven row above the results.
    await expect(filterPanel.getByRole("button", { name: /^Service group/ })).toBeVisible();
    await filterPanel.getByRole("button", { name: /^Service group/ }).click();
    const urgentGroupFacet = filterPanel.getByRole("button", { name: /^Crisis & urgent/ });
    await expect(urgentGroupFacet).toBeVisible();
    await urgentGroupFacet.click();
    await expect(page).toHaveURL(/group=urgent/);
    await urgentGroupFacet.click();
    await expect(page).not.toHaveURL(/group=urgent/);

    await filterPanel.getByRole("button", { name: /^Acuity/ }).click();
    const crisisFacet = filterPanel.getByRole("button", { name: /^Crisis \/ urgent/ });
    await expect(crisisFacet).toBeVisible();
    await crisisFacet.click();
    await expect(page).toHaveURL(/acuity_flags=crisis_high/);
    await filterPanel.getByTestId("service-filter-panel-clear").click();
    await expect(page).toHaveURL(/[?&]q=13YARN(?:&|#|$)/);
    await expect(page).not.toHaveURL(/group=/);
    await expect(page.getByTestId("service-search-result-13yarn")).toBeVisible();
    await filterPanel.getByRole("button", { name: "Close", exact: true }).click();

    await page
      .getByTestId("service-search-result-13yarn")
      .getByRole("link", { name: "Review referral for 13YARN" })
      .click();
    await expect(page).toHaveURL(/\/services\/13yarn$/);
    await expect(page.getByText("Best use").first()).toBeVisible();
    await expect(page.getByText(/crisis support/i).first()).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
  });

  test("forms mode shows registry-backed form records without unsupported pathway claims", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/forms?q=transport%20forms&focus=1&run=1");

    await expect(page.getByRole("button", { name: "Mode Forms" })).toBeVisible();
    await expect(visibleGlobalSearchInput(page)).toHaveValue("transport forms");
    await expect(page.getByTestId("form-search-results")).toBeVisible();
    await expect(page.getByTestId("form-search-results")).toContainText("Best matches");
    await expect(page.getByTestId("form-search-result-transport-crisis-form")).toContainText("Transport order");
    await expect(page.getByTestId("form-search-result-extension-transport-order")).toContainText(
      "Extension of transport order",
    );
    await expect(page.getByTestId("form-search-result-detention-examination-movement")).toContainText(
      "Detention order",
    );
    await expect(page.getByTestId("form-search-result-transfer-order")).toContainText("Transfer order");
    await expect(
      page.getByTestId("form-search-result-transport-crisis-form").getByLabel("Open Transport order"),
    ).toHaveAttribute("href", "/forms/transport-crisis-form");
    // Documents-style funnel Filter on the results band (wide slot at this viewport).
    await expect(page.getByTestId("form-filter-trigger-wide")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Forms search sections" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refine" })).toHaveCount(0);
    await expect(page.getByTestId("form-search-results")).not.toContainText(/pathway/i);
    await expect(page.getByText(/Evidence 278|Pathways 12|Tasks 8|Source verified|Aligned to MHA 2014/)).toHaveCount(0);
    await expect(page.getByText(/PSOLIS Transport|View full pathway/)).toHaveCount(0);
    await expect(page.getByTestId("service-search-results")).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("a forms result opens from anywhere in its row, and the Open button still opens it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/forms?q=transport%20forms&focus=1&run=1");

    // Clicking the row itself, not a control inside it. Playwright only allows
    // this if the point actually hit the row or something inside it, so the
    // click landing at all is the proof: the row's centre is the tags/match
    // columns, nowhere near the Open button in the last column.
    await page.getByTestId("form-search-result-transport-crisis-form").click();
    await expect(page).toHaveURL(/\/forms\/transport-crisis-form/);

    await page.goBack();
    await expect(page.getByTestId("form-search-results")).toBeVisible();

    // Widening the row must not have cost the button its own click.
    await page.getByTestId("form-search-result-transport-crisis-form").getByLabel("Open Transport order").click();
    await expect(page).toHaveURL(/\/forms\/transport-crisis-form/);
  });

  test("a forms result opens on a tablet tap anywhere in its row", async ({ browser, baseURL }) => {
    // The results table renders from `md` up — a phone shows the mobile cards
    // instead — so a tablet is the width where a touch user meets this table at
    // all. Its own context because the desktop projects carry no touch.
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      hasTouch: true,
      viewport: { width: 1024, height: 768 },
    });
    const page = await context.newPage();

    try {
      await mockAnswerDashboardApi(page);
      await gotoLauncher(page, "/forms?q=transport%20forms&focus=1&run=1");

      await page.getByTestId("form-search-result-transport-crisis-form").tap();
      await expect(page).toHaveURL(/\/forms\/transport-crisis-form/);
    } finally {
      await context.close();
    }
  });

  test("result sorting persists in the URL and restores through browser history", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/forms?q=transport%20forms&focus=1&run=1");

    const results = page.getByTestId("form-search-results");
    // Sort is a segmented group; the persisted order reads off aria-pressed rather
    // than a select value, including after history navigation.
    const visibleSort = page.locator('[role="group"][aria-label="Sort results"]:visible');
    const sortOption = (name: string) => visibleSort.getByRole("button", { name });
    const rankedResults = rankFormRecords(formRecords, "transport forms", formRecords.length, [], true);
    const expectedRelevanceFirstTestId = `form-search-result-${rankedResults[0]?.service.slug}`;
    const expectedAlphaFirstTestId = `form-search-result-${
      sortResultItems(rankedResults, "alpha", (match) => match.service.title)[0]?.service.slug
    }`;
    await expect(results.locator('article[data-testid^="form-search-result-"]').first()).toHaveAttribute(
      "data-testid",
      expectedRelevanceFirstTestId,
    );

    await sortOption("A–Z").click();
    await expect(page).toHaveURL(/\bsort=alpha\b/);
    await expect(results.locator('article[data-testid^="form-search-result-"]').first()).toHaveAttribute(
      "data-testid",
      expectedAlphaFirstTestId,
    );

    await page.goBack();
    await expect(sortOption("Relevance")).toHaveAttribute("aria-pressed", "true");
    await expect(results.locator('article[data-testid^="form-search-result-"]').first()).toHaveAttribute(
      "data-testid",
      expectedRelevanceFirstTestId,
    );

    await page.goForward();
    await expect(sortOption("A–Z")).toHaveAttribute("aria-pressed", "true");
    await expect(results.locator('article[data-testid^="form-search-result-"]').first()).toHaveAttribute(
      "data-testid",
      expectedAlphaFirstTestId,
    );
    await expectNoPageHorizontalOverflow(page);
  });

  test("form detail pages render inside the shell with no search composer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/forms/transport-crisis-form");
    // Hydration can briefly overlap the outgoing RSC tree and the settled
    // client tree (two <main data-testid="form-detail-page">). Wait for one
    // owner; a permanent double-render still fails.
    const formDetail = await expectSingleSettledOwner(page.getByTestId("form-detail-page"), {
      message: "form detail page owner",
      timeout: 30_000,
    });

    // Structural coverage — runs on every browser, WebKit included: the record
    // sits inside the shared shell, keeps the mode chip, and carries no stale
    // results. As an information page it owns no composer, so neither the
    // Forms-mode search field nor the shared input is present.
    await expect(page.getByRole("button", { name: "Mode Forms" })).toBeVisible({ timeout: 20_000 });
    await expect(formDetail.getByRole("heading", { level: 1, name: "Transport order" })).toBeVisible();
    await expect(page.getByTestId("form-search-results")).toHaveCount(0);
    await expect(page.locator('input[placeholder="Search forms..."]')).toHaveCount(0);
    await expect(page.getByTestId("global-search-input")).toHaveCount(0);
    await expect(page.locator("form.answer-footer-search-dock, form.answer-footer-search-edge")).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("the forms home composer searches the register and links back to the record", async ({ page }) => {
    // This journey used to start on the form record, which carried a composer.
    // Information pages no longer do, so it starts one route earlier on the
    // mode home — the surface that actually owns the Forms composer now.
    // `/forms` is a consolidated bare path that redirects here, so go straight
    // to the shared home and skip the redirect hop.
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/?mode=forms");

    const formsSearchInput = page.locator('input[placeholder="Search forms..."]:visible').first();
    await expect(formsSearchInput).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Loading your forms registry...")).toBeHidden({ timeout: 30_000 });
    const formsSearchButton = page.getByRole("button", { name: "Search forms" });
    await formsSearchInput.fill("transport forms");
    await expect(formsSearchButton).toBeEnabled();
    await waitForReactEventHandler(formsSearchButton.locator("xpath=ancestor::form[1]"), "onSubmit");
    await formsSearchButton.click();
    await expect(page).toHaveURL(/\/forms\/search\?.*\bq=transport(?:\+|%20)forms\b/, { timeout: 20_000 });
    await expect(page.getByTestId("form-search-results")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("form-search-result-transport-crisis-form")).toContainText("Transport order");
    await expect(
      page.getByTestId("form-search-result-transport-crisis-form").getByLabel("Open Transport order"),
    ).toHaveAttribute("href", "/forms/transport-crisis-form");
    await expectNoPageHorizontalOverflow(page);
  });

  test("form detail mobile renders decision context after the form content", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/forms/transport-crisis-form");

    // Same hydration overlap as the desktop form-detail wiring test: require a
    // single settled <main> before strict visibility / geometry asserts.
    const formDetail = await expectSingleSettledOwner(page.getByTestId("form-detail-page"), {
      message: "form detail page owner (mobile)",
      timeout: 30_000,
    });
    await expect(formDetail.getByTestId("form-decision-context-mobile")).toBeVisible();
    // Information page: no phone dock either, so the record reads to the edge.
    await expect(page.locator('[data-testid="global-search-input"]:visible')).toHaveCount(0);

    // Decision context now stacks below the priority facts and source snapshot
    // on phones — the primary form content reads first.
    await expectVerticalSeparation(
      page,
      '[aria-label="Priority facts"]',
      '[data-testid="form-decision-context-mobile"]',
      8,
    );
    await expectNoPageHorizontalOverflow(page);
  });

  test("forms search mockup is usable without horizontal overflow on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/forms?q=transport&focus=1&run=1");

    await expect(page.getByTestId("form-search-mobile-results")).toBeVisible();
    await expect(page.getByTestId("form-search-mobile-result-transport-crisis-form")).toContainText("Transport order");
    // Guards the unsubstantiated pathway-claims feature (supportsPathwayClaims),
    // not the word itself: result cards now carry the catalogue's own purpose
    // text, and several official purposes legitimately say "pathway" ("Use for
    // each leave episode from inpatient treatment order pathway"). Match the
    // feature's own strings so real form content cannot trip this guard.
    await expect(page.getByTestId("form-search-mobile-results")).not.toContainText(
      /related pathway|view full pathway/i,
    );
    await expect(page.getByText(/PSOLIS Transport|View full pathway|Source verified/)).toHaveCount(0);
    await expect(visibleGlobalSearchInput(page)).toHaveValue("transport");
    await expectNoPageHorizontalOverflow(page);
  });

  test("phone bottom search dock stays edge-to-edge with safe-area padding inside the form", async ({ page }) => {
    // Guards the white-strip regression: a non-zero CSS `bottom` on the dock
    // (or a 100dvh shell dead band) leaves blank page chrome under the pill.
    // Safe-area must be padding inside a form flush to the viewport bottom.
    await page.setViewportSize({ width: 390, height: 844 });
    const safeAreaBottom = 34;

    for (const route of [
      { path: "/forms?q=transport&run=1", resultsTestId: "form-search-mobile-results" },
      { path: "/differentials?q=acute+confusion&run=1", resultsTestId: "differentials-search-results" },
    ] as const) {
      await gotoLauncher(page, route.path);
      const results = page.getByTestId(route.resultsTestId);
      // A soft navigation can briefly retain the previous reserve-pad owner.
      // Wait for the new route to settle to the single-owner contract before
      // making a strict visibility assertion.
      await expect(results).toHaveCount(1, { timeout: 20_000 });
      await expect(results).toBeVisible();
      const dock = page.locator("form.answer-footer-search-dock");
      await expect(dock, route.path).toBeVisible();
      await expect(dock, route.path).not.toHaveAttribute("data-scroll-hidden", "true");

      await page.evaluate((inset) => {
        document.documentElement.style.setProperty("--safe-area-bottom", `${inset}px`);
      }, safeAreaBottom);

      const geometry = await dock.evaluate((node) => {
        const style = window.getComputedStyle(node);
        const formRect = node.getBoundingClientRect();
        const pill = node.querySelector(".answer-footer-search-pill");
        const pillRect = pill?.getBoundingClientRect();
        return {
          bottomCss: style.bottom,
          paddingBottom: Number.parseFloat(style.paddingBottom),
          formBottom: formRect.bottom,
          pillBottom: pillRect?.bottom ?? null,
          viewportHeight: window.innerHeight,
        };
      });

      expect(geometry.bottomCss, route.path).toBe("0px");
      expect(Math.abs(geometry.formBottom - geometry.viewportHeight), route.path).toBeLessThanOrEqual(1);
      expect(geometry.paddingBottom, route.path).toBeGreaterThanOrEqual(safeAreaBottom - 1);
      expect(geometry.pillBottom, route.path).not.toBeNull();
      // Pill sits above the safe-area pad; do not require exact px (borders/gaps).
      expect(geometry.pillBottom!, route.path).toBeLessThanOrEqual(geometry.viewportHeight - safeAreaBottom + 2);
    }
  });

  test("phone bottom search dock hides while scrolling down on search results", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoLauncher(page, "/forms?q=transport&focus=1&run=1");

    await expect(page.getByTestId("form-search-mobile-results")).toBeVisible();
    const dock = page.locator("form.answer-footer-search-dock");
    await expect(dock).toBeVisible();
    await expect(dock).not.toHaveAttribute("data-scroll-hidden", "true");
    const main = page.locator("#main-content");
    // Safari reports its translucent bottom toolbar through the safe-area
    // inset. Make that region deliberately large so this catches the exact
    // toolbar-sized blank band seen on an iPhone, even in Chromium CI.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-bottom", "112px");
    });
    await expect.poll(async () => readMobileComposerReservePx(main)).toBeGreaterThan(112);
    const visibleMainGeometry = await main.evaluate((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        marginBottom: Number.parseFloat(style.marginBottom),
        overflowY: style.overflowY,
        top: Math.round(rect.top),
        viewportHeight: window.innerHeight,
      };
    });
    expect(visibleMainGeometry.marginBottom).toBe(0);
    expect(visibleMainGeometry.overflowY).toBe("visible");
    expect(visibleMainGeometry.top).toBeLessThan(visibleMainGeometry.viewportHeight);
    expect(visibleMainGeometry.bottom).toBeGreaterThanOrEqual(visibleMainGeometry.viewportHeight - 1);
    const transition = await dock.evaluate((node) => {
      const style = window.getComputedStyle(node);
      const durationMs = Math.max(
        ...style.transitionDuration.split(",").map((value) => {
          const normalized = value.trim();
          const duration = Number.parseFloat(normalized);
          return normalized.endsWith("ms") ? duration : duration * 1000;
        }),
      );
      return { durationMs, property: style.transitionProperty };
    });
    expect(transition.property).toMatch(/transform|all/);
    expect(transition.durationMs).toBeGreaterThanOrEqual(100);

    // focus=1 leaves the composer focused; hide-on-scroll stays off while it has focus.
    const input = visibleGlobalSearchInput(page).first();
    await input.focus();
    await page.keyboard.press("Escape");
    await input.blur();
    await expect(dock).not.toHaveAttribute("data-command-open", "true");

    // Inject content through the resolved owner so the browser document and
    // standalone-PWA inner scroller exercise the same directional behavior.
    await appendPrimaryScrollSpacer(page, { heightPx: 2000, testId: "test-scroll-spacer" });
    await expect.poll(async () => (await readPrimaryScrollGeometry(page)).owner).toBe("document");

    // Treat the deliberate scroll and its resulting UI state as one retriable
    // action. Firefox/WebKit can finish the focus=1 hydration effect after the
    // first scripted blur/scroll, which legitimately keeps the dock visible.
    await expect(async () => {
      await input.blur();
      await expect(input).not.toBeFocused({ timeout: 1_000 });
      await scrollPrimarySurface(page, 0);
      for (const offset of [40, 80, 120, 160, 200]) {
        await scrollPrimarySurface(page, offset);
      }
      await expect(dock).toHaveAttribute("data-scroll-hidden", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect
      .poll(async () => dock.evaluate((node) => window.getComputedStyle(node).transform !== "none"))
      .toBe(true);
    await expect.poll(async () => readMobileComposerReservePx(main)).toBeLessThanOrEqual(13);
    const hiddenMainGeometry = await main.evaluate((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        marginBottom: Number.parseFloat(style.marginBottom),
        top: Math.round(rect.top),
        viewportHeight: window.innerHeight,
      };
    });
    expect(hiddenMainGeometry.marginBottom).toBe(0);
    expect(hiddenMainGeometry.top).toBeLessThan(hiddenMainGeometry.viewportHeight);
    expect(hiddenMainGeometry.bottom).toBeGreaterThanOrEqual(hiddenMainGeometry.viewportHeight - 1);

    await scrollPrimarySurface(page, 60);
    await expect(dock).not.toHaveAttribute("data-scroll-hidden", "true");
    // Resting edge docks may use translateY(calc(-1 * var(--keyboard-height))) with
    // height 0, which computes to an identity matrix rather than "none".
    await expect
      .poll(async () =>
        dock.evaluate((node) => {
          const transform = window.getComputedStyle(node).transform;
          return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
        }),
      )
      .toBe(true);
    await expect.poll(async () => readMobileComposerReservePx(main)).toBeGreaterThan(112);
  });

  test("tablet and desktop forms results keep non-phone bottom clearance", async ({ page }) => {
    // Phone dock reserve (max-sm) must not leak into sm+/lg layouts.
    for (const viewport of [
      { width: 768, height: 1024, label: "tablet" },
      { width: 1280, height: 900, label: "desktop" },
    ] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoLauncher(page, "/forms?q=transport&run=1");
      await expect(page.getByTestId("form-search-results")).toBeVisible();
      const main = page.locator("#main-content");
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--safe-area-bottom", "112px");
      });
      const geometry = await main.evaluate((node) => {
        const style = window.getComputedStyle(node);
        return {
          paddingBottom: Number.parseFloat(style.paddingBottom),
          marginBottom: Number.parseFloat(style.marginBottom),
        };
      });
      // sm+ uses static desktop padding (pb-8 = 32px) or larger desktop dock
      // clearance — never the phone hide-collapse path alone.
      expect(geometry.paddingBottom, viewport.label).toBeGreaterThanOrEqual(32);
      // Phone-only hide transform should not be active on these widths.
      const dock = page.locator("form.answer-footer-search-dock");
      if ((await dock.count()) > 0 && (await dock.first().isVisible())) {
        await expect(dock.first()).not.toHaveAttribute("data-scroll-hidden", "true");
      }
    }
  });

  test("mode toggle keeps the shared home hero geometry when the mode changes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/?mode=answer");

    const menu = await openAppModeMenu(page, "Answer");
    await expect(menu.getByRole("menuitemradio", { name: /^Services\b/ })).toBeVisible();
    await menu.getByRole("menuitemradio", { name: /^Forms\b/ }).click();

    // Picking a mode must not move the page or the composer: the hero stays put
    // while its presentation and placeholder update in place. A geometry shift
    // here is the reserve flip the pathname-gated hero rule exists to prevent.
    await expect(page).toHaveURL(/\/\?mode=forms\b/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Mode Forms" })).toBeVisible();
    await expect(visibleByTestId(page, "shared-home-empty-state")).toBeVisible();
    await expect(page.getByTestId("forms-home")).toHaveCount(0);
    await expect(page.getByTestId("services-home")).toHaveCount(0);

    const heroSearch = visibleByTestId(page, "shared-home-empty-state").getByTestId("global-search-input");
    await expect(heroSearch).toBeVisible();
    await expect(heroSearch).toHaveAttribute("placeholder", "Search forms...");
    const searchBox = await heroSearch.boundingBox();
    const headingBox = await page.getByRole("heading", { level: 2, name: "Clinical Forms" }).boundingBox();
    expect(searchBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect((headingBox?.y ?? 0) + (headingBox?.height ?? 0)).toBeLessThan(searchBox?.y ?? 0);
    // The shared home keeps one search row with no auxiliary action rail. Keep
    // the field in the upper viewport without encoding a brittle pixel height.
    expect((searchBox?.y ?? 0) + (searchBox?.height ?? 0) / 2).toBeLessThan(900 * 0.7);
    await expectNoPageHorizontalOverflow(page);
  });

  // `/differentials` no longer renders a home of its own: it redirects onto the
  // shared one, which is where a direct link, a bookmark and the sidebar's "More
  // modes" sheet all now land.
  test("a direct link to the differentials home lands on the shared home", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/differentials");

    await expect(page).toHaveURL(/\/\?mode=differentials\b/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Mode Differentials" })).toBeVisible();
    const sharedHome = visibleByTestId(page, "shared-home-empty-state");
    await expect(sharedHome).toBeVisible();
    await expect(sharedHome.getByRole("heading", { level: 2, name: "Differential Diagnosis" })).toBeVisible();
    await expect(page.getByTestId("differentials-home")).toHaveCount(0);

    // One composer, in the hero, carrying the mode's own placeholder.
    await expect(visibleGlobalSearchInput(page)).toHaveCount(1);
    const heroSearch = sharedHome.getByTestId("global-search-input");
    await expect(heroSearch).toBeVisible();
    await expect(heroSearch).toHaveAttribute("placeholder", "Ask or search a presentation...");

    // The hero heading sits above the composer, and the composer stays in the
    // upper two thirds — the same geometry contract every mode home is held to.
    await expect(async () => {
      const searchBox = await heroSearch.boundingBox();
      const headingBox = await sharedHome
        .getByRole("heading", { level: 2, name: "Differential Diagnosis" })
        .boundingBox();
      expect(searchBox).not.toBeNull();
      expect(headingBox).not.toBeNull();
      expect((headingBox?.y ?? 0) + (headingBox?.height ?? 0)).toBeLessThan(searchBox?.y ?? 0);
      expect((searchBox?.y ?? 0) + (searchBox?.height ?? 0) / 2).toBeLessThan(900 * 0.65);
    }).toPass({ timeout: 10_000 });
    await expectNoPageHorizontalOverflow(page);
  });

  test("differentials global search posts the standalone differentials mode", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const searchRequests: Array<Record<string, unknown>> = [];

    await page.route(/\/api\/setup-status(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          demoMode: true,
          checks: [
            { id: "env", label: ".env.local configured", status: "ready", detail: "Test environment ready." },
            { id: "project", label: "PsychSift Production target", status: "ready", detail: "Test project ready." },
            { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Test schema ready." },
            { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Test search ready." },
            { id: "openai", label: "OpenAI API key available", status: "ready", detail: "Test OpenAI ready." },
          ],
        },
      });
    });
    await page.route(/\/api\/search(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      searchRequests.push(body);
      await route.fulfill({
        json: {
          results: [
            {
              id: "chunk-acute-confusion",
              document_id: "11111111-1111-4111-8111-111111111111",
              title: "Acute confusion differential guide",
              file_name: "acute-confusion-differentials.pdf",
              page_number: 1,
              chunk_index: 0,
              section_heading: "Differentials",
              content: "Acute confusion with inattention should prioritise delirium and other urgent causes.",
              image_ids: [],
              similarity: 0.91,
              hybrid_score: 0.93,
              images: [],
            },
          ],
          visualEvidence: [],
          relatedDocuments: [],
          documentMatches: [
            {
              document_id: "11111111-1111-4111-8111-111111111111",
              title: "Acute confusion differential guide",
              file_name: "acute-confusion-differentials.pdf",
              labels: [
                {
                  id: "label-delirium",
                  document_id: "11111111-1111-4111-8111-111111111111",
                  label: "Delirium",
                  label_type: "topic",
                  source: "generated",
                  confidence: 0.96,
                },
              ],
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
          scope: { queryMode: body.queryMode },
          sourceGovernanceWarnings: [],
          demoMode: true,
        },
      });
    });

    await gotoLauncher(page, "/differentials");
    await expect(page.getByRole("button", { name: "Mode Differentials" })).toBeVisible();
    await submitDifferentialSearch(page, "acute confusion");

    await expect.poll(() => searchRequests.length).toBeGreaterThan(0);
    expect(searchRequests.at(-1)).toMatchObject({
      query: "acute confusion",
      mode: "differentials",
      queryMode: "compare_guidance",
    });

    // Evidence arrived, so the results view renders with a real query-matched
    // result row from the imported differentials catalogue.
    await expect(visibleByTestId(page, "differentials-search-results")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Differential matches" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Acute confusion and delirium" }).first()).toBeVisible();
    const desktopBestMatch = page.getByTestId("differential-best-match-card");
    await expect(desktopBestMatch).toBeVisible();
    await expect(desktopBestMatch.getByText("Best match", { exact: true })).toBeVisible();
    await expect(desktopBestMatch.getByTestId("differential-best-match-panel")).toContainText(
      /Why considered.*Look for.*Check next/s,
    );
    await expect(page.getByTestId("differential-compact-result").first()).toContainText("Clinical cues");
    await expect(visibleByTestId(page, "differentials-search-results")).not.toContainText("Decision support");
  });

  test("differentials evidence-backed search badges stay single-line on narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await page.route(/\/api\/setup-status(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          demoMode: true,
          checks: [
            { id: "env", label: ".env.local configured", status: "ready", detail: "Test environment ready." },
            { id: "project", label: "[REDACTED] target", status: "ready", detail: "Test project ready." },
            { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Test schema ready." },
            { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Test search ready." },
            { id: "openai", label: "OpenAI API key available", status: "ready", detail: "Test OpenAI ready." },
          ],
        },
      });
    });
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

    await gotoLauncher(page, "/differentials");
    await submitDifferentialSearch(page, "acute confusion");

    const evidenceBackedResults = visibleByTestId(page, "differentials-search-results");
    await expect(evidenceBackedResults).toBeVisible();
    await expect(evidenceBackedResults.getByRole("region", { name: "Source status" })).toContainText(
      "1 indexed source match",
    );
    const visibleTypeBadges = evidenceBackedResults.locator('[data-testid="differential-result-type-badge"]:visible');
    await expect(visibleTypeBadges.filter({ hasText: "Presentation" }).first()).toBeVisible();
    await expect(visibleTypeBadges.filter({ hasText: "Differential" }).first()).toBeVisible();
    const sourceStatusBox = await evidenceBackedResults.getByTestId("differentials-source-status").boundingBox();
    const safetyBannerBox = await evidenceBackedResults.getByTestId("differentials-safety-banner").boundingBox();
    expect(sourceStatusBox).not.toBeNull();
    expect(safetyBannerBox).not.toBeNull();
    expect(sourceStatusBox!.y + sourceStatusBox!.height).toBeLessThanOrEqual(safetyBannerBox!.y);
    const typeTrigger = page.getByTestId("differential-filter-trigger-phone");
    await expect(typeTrigger).toBeVisible();
    await expect(typeTrigger).toHaveAccessibleName(/No filters active/);
    await typeTrigger.click();
    const typeGroup = page.getByRole("radiogroup", { name: "Show" });
    await typeGroup.getByRole("radio", { name: /^Differentials/ }).click();
    await expect(typeGroup.getByRole("radio", { name: /^Differentials/ })).toBeChecked();
    await typeGroup.getByRole("radio", { name: /^All/ }).click();
    await page.getByTestId("differential-filter-panel-done").click();
    await expect(typeGroup).toBeHidden();
    await expect(typeTrigger).toHaveAccessibleName(/No filters active/);

    // Sort is `sm`-and-up, so on a phone the page filter is the whole utilities
    // group: it renders last, hard against the ribbon's right edge, and it is
    // what has to carry the phone tap height. Sort stays mounted but hidden —
    // asserted, not assumed, so returning it to the phone line fails here.
    const utilities = page.getByTestId("search-query-ribbon-utilities");
    const pageFilters = page.getByTestId("search-query-ribbon-mobile-controls");
    const railMetrics = await utilities.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      right: element.getBoundingClientRect().right,
      lastChildIsPageFilter:
        element.lastElementChild?.getAttribute("data-testid") === "search-query-ribbon-mobile-controls",
    }));
    expect(railMetrics.lastChildIsPageFilter).toBe(true);
    // Mounted-and-hidden is two facts, and `toBeHidden()` alone cannot separate
    // them: it passes for a hidden node AND for one that does not exist. Plain
    // `getByRole` also filters hidden nodes out, so it would resolve to nothing
    // here and pass even with the control deleted. Count under `includeHidden`,
    // then visibility.
    const phoneSort = utilities.getByRole("group", { name: "Sort results", includeHidden: true });
    await expect(phoneSort).toHaveCount(1);
    await expect(phoneSort).toBeHidden();
    const filterHeight = await pageFilters.evaluate((element) => element.getBoundingClientRect().height);
    expect(filterHeight).toBeGreaterThanOrEqual(43);

    const emergentBadge = page.getByTestId("differential-status-badge").first();
    await expect(emergentBadge).toBeVisible();
    await expect(emergentBadge).toHaveText(/Emergent/i);
    const badgeMetrics = await emergentBadge.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, scrollHeight: element.scrollHeight };
    });
    expect(badgeMetrics.height).toBeGreaterThanOrEqual(22);
    expect(badgeMetrics.scrollHeight).toBeLessThanOrEqual(badgeMetrics.height + 1);
    await expectNoPageHorizontalOverflow(page);
  });

  test("differentials search badges stay single-line on narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await page.route(/\/api\/setup-status(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          demoMode: true,
          checks: [
            { id: "env", label: ".env.local configured", status: "ready", detail: "Test environment ready." },
            { id: "project", label: "[REDACTED] target", status: "ready", detail: "Test project ready." },
            { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Test schema ready." },
            { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Test search ready." },
            { id: "openai", label: "OpenAI API key available", status: "ready", detail: "Test OpenAI ready." },
          ],
        },
      });
    });
    await page.route(/\/api\/search(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          results: [
            {
              id: "chunk-acute-confusion",
              document_id: "11111111-1111-4111-8111-111111111111",
              title: "Acute confusion differential guide",
              file_name: "acute-confusion-differentials.pdf",
              page_number: 1,
              chunk_index: 0,
              section_heading: "Differentials",
              content: "Acute confusion with inattention should prioritise delirium and other urgent causes.",
              image_ids: [],
              similarity: 0.91,
              hybrid_score: 0.93,
              images: [],
            },
          ],
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

    await gotoLauncher(page, "/differentials");
    await submitDifferentialSearch(page, "acute confusion");

    await expect(visibleByTestId(page, "differentials-search-results")).toBeVisible();
    const typeTrigger = page.getByTestId("differential-filter-trigger-phone");
    await expect(typeTrigger).toBeVisible();
    await expect(typeTrigger).toHaveAccessibleName(/No filters active/);
    await typeTrigger.click();
    const typeGroup = page.getByRole("radiogroup", { name: "Show" });
    await typeGroup.getByRole("radio", { name: /^Presentations/ }).click();
    await expect(typeGroup.getByRole("radio", { name: /^Presentations/ })).toBeChecked();
    await typeGroup.getByRole("radio", { name: /^All/ }).click();
    await page.getByTestId("differential-filter-panel-done").click();
    await expect(typeGroup).toBeHidden();

    // Sort is `sm`-and-up, so on a phone the page filter is the whole utilities
    // group: it renders last, hard against the ribbon's right edge, and it is
    // what has to carry the phone tap height. Sort stays mounted but hidden —
    // asserted, not assumed, so returning it to the phone line fails here.
    const utilities = page.getByTestId("search-query-ribbon-utilities");
    const pageFilters = page.getByTestId("search-query-ribbon-mobile-controls");
    const railMetrics = await utilities.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      right: element.getBoundingClientRect().right,
      lastChildIsPageFilter:
        element.lastElementChild?.getAttribute("data-testid") === "search-query-ribbon-mobile-controls",
    }));
    expect(railMetrics.lastChildIsPageFilter).toBe(true);
    // Mounted-and-hidden is two facts, and `toBeHidden()` alone cannot separate
    // them: it passes for a hidden node AND for one that does not exist. Plain
    // `getByRole` also filters hidden nodes out, so it would resolve to nothing
    // here and pass even with the control deleted. Count under `includeHidden`,
    // then visibility.
    const phoneSort = utilities.getByRole("group", { name: "Sort results", includeHidden: true });
    await expect(phoneSort).toHaveCount(1);
    await expect(phoneSort).toBeHidden();
    const filterHeight = await pageFilters.evaluate((element) => element.getBoundingClientRect().height);
    expect(filterHeight).toBeGreaterThanOrEqual(43);

    const emergentBadge = page.getByTestId("differential-status-badge").first();
    await expect(emergentBadge).toBeVisible();
    await expect(emergentBadge).toHaveText(/Emergent/i);
    const badgeMetrics = await emergentBadge.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, scrollHeight: element.scrollHeight };
    });
    expect(badgeMetrics.height).toBeGreaterThanOrEqual(22);
    expect(badgeMetrics.scrollHeight).toBeLessThanOrEqual(badgeMetrics.height + 1);

    // Tall browser-phone results must be top-aligned in the document owner:
    // Best Answer stays reachable at scrollTop 0 without a competing inner offset.
    await expect.poll(async () => (await readPrimaryScrollGeometry(page)).owner).toBe("document");
    await expect.poll(async () => (await readPrimaryScrollGeometry(page)).scrollTop).toBe(0);
    const bestAnswer = page.getByTestId("differential-best-answer");
    await expect(bestAnswer).toBeVisible();
    await expect(bestAnswer.getByText("Best match", { exact: true })).toBeVisible();
    await expect(bestAnswer.getByTestId("differential-best-match-panel")).toContainText(
      /Why considered.*Look for.*Check next/s,
    );
    await expect(bestAnswer).not.toContainText("Decision support");
    const foldLayout = await bestAnswer.evaluate((best) => {
      const main = document.querySelector("#main-content");
      const header = document.querySelector("header.universal-header");
      if (!main) return null;
      const bestRect = best.getBoundingClientRect();
      const headerBottom = header?.getBoundingClientRect().bottom ?? main.getBoundingClientRect().top;
      return {
        bestTop: bestRect.top,
        bestBottom: bestRect.bottom,
        headerBottom,
        viewportHeight: window.innerHeight,
      };
    });
    expect(foldLayout).not.toBeNull();
    // Best Answer must start in the visible upper fold under the consolidated
    // query, sort, and result-type controls — never clipped above the scrollport.
    expect(foldLayout!.bestTop).toBeGreaterThanOrEqual(foldLayout!.headerBottom - 2);
    expect(foldLayout!.bestTop).toBeLessThan(foldLayout!.viewportHeight * 0.5);

    // The featured best match owns rank 1; compact results continue at 2.
    const mobileCards = page.getByTestId("differential-mobile-result-card");
    await expect(mobileCards.first()).toBeVisible();
    await expect(mobileCards.first().getByTestId("differential-mobile-result-rank")).toHaveText("2");
    const ranks = await mobileCards.getByTestId("differential-mobile-result-rank").allTextContents();
    expect(ranks).toEqual(ranks.map((_, index) => String(index + 2)));

    // Selection reads as a checkbox, but only the visible box is compact. Its
    // surrounding label retains the repository's 48px phone target contract.
    const uncheckedSelection = mobileCards.getByRole("checkbox", { name: /^Add .+ to comparison$/ }).first();
    await expect(uncheckedSelection).toBeVisible();
    await expect(uncheckedSelection).not.toBeChecked();
    const uncheckedName = await uncheckedSelection.getAttribute("aria-label");
    expect(uncheckedName).toMatch(/^Add .+ to comparison$/);
    const checkedName = uncheckedName!.replace(/^Add /, "Remove ").replace(/ to comparison$/, " from comparison");
    const selectionTarget = uncheckedSelection.locator("xpath=..");
    await expectMinTouchTarget(selectionTarget, 48);
    const visibleSelectionBox = await selectionTarget.getByTestId("differential-selection-box").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(visibleSelectionBox).toEqual({ width: 24, height: 24 });
    await uncheckedSelection.focus();
    await expect(uncheckedSelection).toBeFocused();
    await uncheckedSelection.press("Space");
    const checkedSelection = mobileCards.getByRole("checkbox", { name: checkedName, exact: true });
    await expect(checkedSelection).toBeChecked();

    // Status badge sits on its own meta row below the title, never beside it.
    const titleBadgeLayout = await mobileCards.first().evaluate((card) => {
      const title = card.querySelector("a span.line-clamp-2") ?? card.querySelector("a");
      const badge = card.querySelector('[data-testid="differential-status-badge"]');
      if (!title || !badge) return null;
      const titleRect = title.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      return { titleBottom: titleRect.bottom, badgeTop: badgeRect.top };
    });
    expect(titleBadgeLayout).not.toBeNull();
    expect(titleBadgeLayout!.badgeTop).toBeGreaterThanOrEqual(titleBadgeLayout!.titleBottom - 1);

    const cardOverflow = await mobileCards.evaluateAll((cards) =>
      cards.map((card) => ({
        overflowX: card.scrollWidth > card.clientWidth + 1,
        width: card.clientWidth,
      })),
    );
    for (const card of cardOverflow) {
      expect(card.overflowX).toBe(false);
    }

    await expectNoPageHorizontalOverflow(page);
  });

  test("mobile differential compare dock hides on scroll down and stays tappable when revealed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockAnswerDashboardApi(page);
    await mockDifferentialCatalogApi(page);
    await page.route(/\/api\/search(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          results: [],
          visualEvidence: [],
          relatedDocuments: [],
          documentMatches: [],
          relevance: { verdict: "weak", score: 0, directSourceCount: 0, weakSourceCount: 0 },
          smartPanel: {},
          telemetry: { query_class: "differential_compare", retrieval_strategy: "text_fast_path" },
          scope: { queryMode: "compare_guidance" },
          sourceGovernanceWarnings: [],
          demoMode: true,
        },
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoLauncher(page, "/differentials");

    const input = page.locator('input[placeholder="Ask or search a presentation..."]:visible');
    const submit = page.locator('button[aria-label="Search differential presentations"]:visible');
    await expect(input).toHaveCount(1, { timeout: 15_000 });
    await expect(submit).toHaveCount(1, { timeout: 15_000 });
    await waitForReactEventHandler(input, "onChange");
    await waitForReactEventHandler(input.locator("xpath=ancestor::form[1]"), "onSubmit");
    await input.fill("acute confusion");
    await expect(submit).toBeEnabled();
    const searchResponse = page.waitForResponse(
      (response) => response.url().includes("/api/search") && response.request().method() === "POST",
    );
    await submit.click();
    await searchResponse;

    const compareAction = page.getByTestId("differentials-compare-selected-mobile");
    const dock = page.locator("form.answer-footer-search-dock");
    const scrollport = visibleByTestId(page, "differentials-search-results");
    const mainContent = page.locator("#main-content");
    await expect(scrollport).toBeVisible();
    await expect(scrollport.getByRole("region", { name: "Source status" })).toContainText("No indexed source matches");
    await expect(page.locator("#differentials-mobile-compare-addon-slot")).toHaveCount(1);
    await expect(compareAction).toBeVisible();
    await expect(compareAction).toContainText("Compare selected");
    await expect(dock).not.toHaveAttribute("data-scroll-hidden", "true");

    // Begin with the visible composer reserve. Document scrolling deliberately
    // blurs the focused composer, and the resulting chrome transition can
    // change the document range after the first endpoint scroll. Re-issue the
    // endpoint action while asserting so the position converges with the
    // settled range instead of polling a stale scrollTop.
    await input.focus();
    await expect(dock).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect.poll(async () => readMobileComposerReservePx(mainContent)).toBeGreaterThan(180);
    // The visible dock/reserve can finish its layout commit after the first
    // endpoint scroll, increasing document height. Treat scrolling to the live
    // endpoint and measuring it as one retriable action; a persistent clearance
    // regression still fails this assertion.
    await expect(async () => {
      await scrollPrimarySurface(page, "end");
      const geometry = await readPrimaryScrollGeometry(page);
      expect(geometry.owner).toBe("document");
      expect(geometry.maxScrollTop - geometry.scrollTop).toBeLessThanOrEqual(1);
    }).toPass({ timeout: 15_000 });
    await expect(dock).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect.poll(async () => readMobileComposerReservePx(mainContent)).toBeGreaterThan(180);
    const clearance = await page.evaluate(() => {
      const main = document.getElementById("main-content");
      const last = document.querySelector('[data-testid="differential-mobile-result-card"]:last-of-type');
      const dock = document.querySelector("form.answer-footer-search-dock");
      const style = main ? window.getComputedStyle(main) : null;
      const pad = main?.querySelector<HTMLElement>('[data-testid="mobile-composer-reserve-pad"]');
      return {
        lastBottom: last?.getBoundingClientRect().bottom ?? null,
        dockTop: dock?.getBoundingClientRect().top ?? null,
        reservePx: pad
          ? Number.parseFloat(window.getComputedStyle(pad).paddingBottom)
          : style
            ? Number.parseFloat(style.paddingBottom)
            : null,
        reserve: style?.getPropertyValue("--mobile-composer-reserve").trim() ?? null,
        scrollHidden: dock?.getAttribute("data-scroll-hidden"),
        url: window.location.href,
      };
    });
    expect(clearance, JSON.stringify(clearance)).toMatchObject({
      scrollHidden: null,
    });
    expect(clearance.lastBottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(clearance.dockTop ?? 0);

    // Compare lives in the dock addon slot above the search pill.
    const revealedGeometry = await compareAction.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const dockRect = element.closest("form")?.getBoundingClientRect();
      const centreX = rect.left + rect.width / 2;
      const centreY = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(centreX, centreY);
      return {
        top: rect.top,
        bottom: rect.bottom,
        dockTop: dockRect?.top ?? null,
        dockBottom: dockRect?.bottom ?? null,
        viewportHeight: window.innerHeight,
        receivesPointer: hit === element || element.contains(hit),
      };
    });
    expect(revealedGeometry.dockTop).not.toBeNull();
    expect(revealedGeometry.top).toBeGreaterThanOrEqual(revealedGeometry.dockTop!);
    expect(revealedGeometry.bottom).toBeLessThanOrEqual(revealedGeometry.dockBottom!);
    expect(revealedGeometry.receivesPointer).toBe(true);
    // Last card must clear the floating compare CTA, not only the composer dock.
    expect(clearance.lastBottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(revealedGeometry.top);

    const reservePx = await readMobileComposerReservePx(mainContent);
    const dockHeight = await dock.evaluate((element) => element.getBoundingClientRect().height);
    expect(reservePx).toBeGreaterThanOrEqual(dockHeight);

    // Ensure enough owner scroll room for hide thresholds even with a short result list.
    await appendPrimaryScrollSpacer(page, { heightPx: 2000, testId: "test-scroll-spacer" });

    // Apply the Safari toolbar simulation after the visible-dock clearance
    // checks above. A collapsed reserve that still includes the toolbar inset
    // must fail the ≤13px assertion below.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-bottom", "112px");
    });
    await expect.poll(async () => readMobileComposerReservePx(mainContent)).toBeGreaterThan(200);

    await expect(async () => {
      await input.blur();
      await expect(input).not.toBeFocused({ timeout: 1_000 });
      await scrollPrimarySurface(page, 0);
      for (const offset of [40, 80, 120, 160, 200]) {
        await scrollPrimarySurface(page, offset);
      }
      await expect(dock).toHaveAttribute("data-scroll-hidden", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });

    await expect
      .poll(async () => dock.evaluate((node) => window.getComputedStyle(node).transform !== "none"))
      .toBe(true);
    await expect.poll(async () => readMobileComposerReservePx(mainContent)).toBeLessThanOrEqual(13);

    // Wait for the hide transition to finish so the in-dock Compare bar is fully
    // off-screen (translateY(100%) parks the dock top on the viewport bottom edge).
    await expect
      .poll(async () =>
        compareAction.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            top: rect.top,
            viewportHeight: window.innerHeight,
            offscreen: rect.top >= window.innerHeight - 1,
          };
        }),
      )
      .toMatchObject({ offscreen: true });

    await scrollPrimarySurface(page, 60);
    await expect(dock).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect(compareAction).toBeVisible();
    // Poll through the reveal transition: a single elementFromPoint sample can
    // miss while translateY is still easing back into the viewport on CI.
    await expect
      .poll(async () =>
        compareAction.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === element || element.contains(hit);
        }),
      )
      .toBe(true);
    await expectNoPageHorizontalOverflow(page);

    // The result cards and compare bar remain in their non-desktop layout up
    // to 1023px, so the composer must keep providing the portal host on tablet.
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator("#differentials-mobile-compare-addon-slot")).toHaveCount(1);
    await expect(compareAction).toBeVisible();
    await expect(compareAction).toContainText("Compare selected");
  });

  test("diagnosis detail actions stay tappable and tabs stay single-line", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await gotoLauncher(page, "/differentials/diagnoses/delirium");
    // Scope to the live shell scrollport: Next may briefly retain a hidden
    // streaming `S:` clone of the page root under CI load, which would make a
    // document-wide getByTestId strict-mode fail.
    const detailPage = page.getByTestId("mobile-composer-reserve-pad").getByTestId("differential-detail-page");
    await expect(detailPage).toBeVisible();
    // The desktop action cluster must keep its intrinsic width (shrink-0) so the
    // icon action does not get crushed below the 44px tap standard.
    await expectMinTouchTarget(detailPage.getByRole("button", { name: "Save diagnosis" }));

    // Phones navigate from the header disclosure, not the labelled strip: the
    // strip is `sm+` only, so at 320px there is nothing left to clip. Assert the
    // template's phone affordance instead — active section on line two of the
    // title control, and the section sheet behind it.
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(detailPage).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
    const safetySnapshot = detailPage.getByTestId("differential-safety-snapshot");
    await expect(safetySnapshot).toBeVisible();
    await expect(safetySnapshot.getByTestId("differential-safety-cta")).toHaveCount(0);

    const safetyMetricItems = safetySnapshot.getByRole("list", { name: "Safety metrics" }).getByRole("listitem");
    await expect(safetyMetricItems).toHaveCount(4);
    const metricRows = await safetyMetricItems.evaluateAll((items) => {
      return new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size;
    });
    expect(metricRows).toBe(1);
    const metricValuesStayWithinCells = await safetyMetricItems.evaluateAll((items) => {
      return items.every((item) => {
        const value = item.querySelector('[data-testid="differential-safety-value"]');
        if (!value) return false;
        const valueRange = document.createRange();
        valueRange.selectNodeContents(value);
        const valueBounds = valueRange.getBoundingClientRect();
        const itemBounds = item.getBoundingClientRect();
        return valueBounds.left >= itemBounds.left - 0.5 && valueBounds.right <= itemBounds.right + 0.5;
      });
    });
    expect(metricValuesStayWithinCells).toBe(true);

    const watchRowCenterSpread = await safetySnapshot
      .getByTestId("differential-safety-watchlist")
      .evaluate((watchlist) => {
        const centers = Array.from(watchlist.children).map((item) => {
          const bounds = item.getBoundingClientRect();
          return bounds.top + bounds.height / 2;
        });
        return Math.max(...centers) - Math.min(...centers);
      });
    expect(watchRowCenterSpread).toBeLessThan(1);
    const safetySnapshotBox = await safetySnapshot.boundingBox();
    expect(safetySnapshotBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(250);
    await expect(detailPage.getByRole("tab", { name: "Overview" })).toBeHidden();
    // The header is portaled into the universal collapse row on phones, so it
    // lives outside the page root that `detailPage` scopes to.
    const sectionTrigger = page.getByTestId("differential-section-trigger");
    await expect(sectionTrigger).toBeVisible();
    await expect(sectionTrigger).toContainText("Overview");
    await expectMinTouchTarget(sectionTrigger);

    // The page title already has a dedicated back control in the in-page
    // header, so the old three-part breadcrumb is intentionally absent. Map
    // and Related are useful enough to remain visible without opening the
    // section sheet on a phone.
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
    const discoveryActions = detailPage.getByRole("navigation", { name: "Explore diagnosis" });
    await expect(discoveryActions).toBeVisible();
    const mapAction = discoveryActions.getByRole("button", { name: /^Map/ });
    const relatedAction = discoveryActions.getByRole("button", { name: /^Related/ });
    await expectMinTouchTarget(mapAction);
    await expectMinTouchTarget(relatedAction);
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await expect(discoveryActions).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
    await mapAction.focus();
    await expect(mapAction).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sectionTrigger).toContainText("Map");
    await expect(page).toHaveURL(/[?&]tab=map/);
    await relatedAction.click();
    await expect(sectionTrigger).toContainText("Related");
    await expect(page).toHaveURL(/[?&]tab=related/);

    await sectionTrigger.click();
    const sectionSheet = page.getByTestId("differential-section-sheet");
    await expect(sectionSheet).toBeVisible();
    await sectionSheet.getByRole("button", { name: /^Map/ }).click();
    await expect(sectionSheet).toBeHidden();
    await expect(sectionTrigger).toContainText("Map");
    await expect(page).toHaveURL(/[?&]tab=map/);

    // Single-line labels at the narrowest width the strip actually renders at.
    await page.setViewportSize({ width: 768, height: 900 });
    await expectNoPageHorizontalOverflow(page);
    const overviewTab = detailPage.getByRole("tab", { name: "Overview" });
    await expect(overviewTab).toBeVisible();
    // Count rendered label lines from text-node rects (an icon rect would bridge
    // two wrapped lines and mask a wrap); the tab label must stay on one line.
    const overviewLineCount = await overviewTab.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const rects: DOMRect[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!(node.textContent ?? "").trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.height > 4 && rect.width > 1) rects.push(rect);
        }
      }
      rects.sort((a, b) => a.top - b.top);
      let lines = 0;
      let lineBottom = Number.NEGATIVE_INFINITY;
      for (const rect of rects) {
        if (rect.top >= lineBottom - 4) {
          lines += 1;
          lineBottom = rect.bottom;
        } else {
          lineBottom = Math.max(lineBottom, rect.bottom);
        }
      }
      return lines;
    });
    expect(overviewLineCount).toBe(1);

    await overviewTab.click();
    await expect(safetySnapshot).toBeVisible();

    // The clinical hinge is the discriminating line every record carries and
    // used to be reachable only through "Copy after review".
    await expect(detailPage.getByTestId("differential-clinical-hinge")).toContainText(
      "Inattention plus altered awareness",
    );

    // Desktop Overview splits into the review column plus a summary rail. 1280
    // rather than 1024 so the assertion does not sit exactly on the `lg`
    // breakpoint, where a classic scrollbar can put the layout on the wrong
    // side of it.
    await page.setViewportSize({ width: 1280, height: 900 });
    const overviewRail = detailPage.getByTestId("differential-overview-rail");
    const phoneDoNow = detailPage.getByTestId("differential-do-now-phone");
    await expect(overviewRail).toBeVisible();
    await expect(overviewRail).toContainText("Do now");
    await expect(overviewRail).toContainText("First-line tests");
    await expect(overviewRail).toContainText("Source and review");
    // Exactly one of the two paints. On desktop the rail owns "Do now"; the
    // phone card must not stack a second copy under it.
    await expect(phoneDoNow).toBeHidden();
    await expectNoPageHorizontalOverflow(page);

    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(safetySnapshot).toBeVisible();
    // The rail is desktop breathing room; a phone must not get a fourth
    // summary of the same record stacked under the ones it already has.
    await expect(overviewRail).toBeHidden();
    // It does still get the first moves. Those steps are the reviewed overlay
    // and the rail was their only surface, so on call they were invisible on
    // the device this is used on.
    await expect(phoneDoNow).toBeVisible();
    await expect(phoneDoNow).toContainText("Do now");
    await expectNoPageHorizontalOverflow(page);
    const forcedColorsMetricRows = await safetyMetricItems.evaluateAll((items) => {
      return new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size;
    });
    expect(forcedColorsMetricRows).toBe(1);
  });

  test("diagnosis map keeps labels contained and the selected inspector out of the canvas", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await gotoLauncher(page, "/differentials/diagnoses/catatonia-in-mood-disorder?tab=map");
    // `gotoLauncher` waits only for #main-content, so the trigger is present and clickable
    // before React has attached its onClick. A click landing in that window is swallowed and
    // the dialog simply never opens — which is how this test failed on CI run 32460303619
    // ("element(s) not found" for the dialog after a 10s wait) while passing on the head
    // immediately before it, whose only delta was ledger JSON. Same wait every other click in
    // this file already uses.
    // The map's information layer sits under the preview, where a phone reader
    // meets it without opening the fullscreen dialog at all.
    const previewCanvas = visibleByTestId(page, "diagnosis-map-preview-canvas");
    const selectedSummary = visibleByTestId(page, "diagnosis-map-selected-summary");
    await expect(selectedSummary).toContainText("Catatonia in mood disorder");
    const comparison = visibleByTestId(page, "diagnosis-map-comparison");
    await expect(comparison.getByTestId("diagnosis-map-comparison-row")).toHaveCount(5);
    await expect(comparison).toContainText("Fever, autonomic instability and a raised CK");
    await expectNoPageHorizontalOverflow(page);

    const serotoninNode = previewCanvas.getByTestId("diagnosis-map-node-serotonin-toxicity");
    await waitForReactEventHandler(serotoninNode);
    await serotoninNode.click();
    await expect(selectedSummary).toContainText("Serotonin toxicity");

    const openMap = visibleByTestId(page, "open-diagnosis-map");
    await waitForReactEventHandler(openMap);
    await openMap.click();

    const dialog = page.getByTestId("diagnosis-map-dialog");
    const canvas = dialog.getByTestId("diagnosis-map-full-canvas");
    const inspector = dialog.getByTestId("diagnosis-map-node-details");
    await expect(dialog).toBeVisible();
    await expect(canvas).toBeVisible();
    await expectMapLabelsContained(canvas);
    await expectNoPageHorizontalOverflow(page);

    // All five related nodes are "Possible" for this record, so an empty
    // must-not-miss filter must not be advertised as a working control.
    await expect(dialog.getByRole("button", { name: "Must-not-miss" })).toHaveCount(0);
    await expect(dialog.getByLabel("Map legend")).toContainText("Focus diagnosis");
    await expect(dialog.getByLabel("Map legend")).toContainText("Possible");

    await canvas.getByTestId("diagnosis-map-node-catatonia-in-psychotic-disorder").click();
    await expect(inspector).toContainText("Psychosis plus marked motor syndrome");
    await expect(inspector).toContainText("Characteristic motor syndrome");
    await expect(inspector).not.toContainText(
      "Refusal of intake, immobility complications, dehydration, autonomic change, hyperthermia, DVT/PE, rhabdomyolysis.",
    );
    await expect(inspector.getByRole("button", { name: "Collapse selected diagnosis details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const nonOverlap = await Promise.all([canvas.boundingBox(), inspector.boundingBox()]);
    expect(nonOverlap[0]).not.toBeNull();
    expect(nonOverlap[1]).not.toBeNull();
    expect(nonOverlap[1]!.y).toBeGreaterThanOrEqual(nonOverlap[0]!.y + nonOverlap[0]!.height - 1);

    await inspector.getByRole("button", { name: "Add to compare" }).click();
    await expect(inspector.getByRole("link", { name: "Compare (2)" })).toHaveAttribute(
      "href",
      "/differentials/compare?ids=catatonia-in-mood-disorder%2Ccatatonia-in-psychotic-disorder",
    );

    const zoom = dialog.getByLabel("Map zoom");
    await expect(zoom).toHaveText("100%");
    await dialog.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoom).toHaveText("114%");
    await dialog.getByRole("button", { name: "Reset map view" }).click();
    await expect(zoom).toHaveText("100%");

    await canvas.focus();
    await expect(canvas).toBeFocused();
    const focusNode = canvas.getByTestId("diagnosis-map-node-diagnosis");
    const fittedFocusBox = await focusNode.boundingBox();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await focusNode.boundingBox())?.x ?? Number.POSITIVE_INFINITY)
      .toBeLessThan((fittedFocusBox?.x ?? 0) - 20);
    await page.keyboard.press("Home");
    await expect
      .poll(async () => Math.abs(((await focusNode.boundingBox())?.x ?? 0) - (fittedFocusBox?.x ?? 0)))
      .toBeLessThanOrEqual(1);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 639, height: 900 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await expectMapLabelsContained(canvas);
      await expectNoPageHorizontalOverflow(page);
    }

    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await expectMapLabelsContained(canvas);
    await expect(canvas.getByTestId("diagnosis-map-node-diagnosis")).toBeVisible();
  });

  test("differentials compare queue launches presentation comparison", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 920 });
    const workflow = acuteConfusionPresentationWorkflow;

    await gotoLauncher(page, "/differentials/compare");
    await expect(page).toHaveURL(/\/differentials\/compare\/?$/, { timeout: 30_000 });
    await expect(page.getByTestId("differential-compare-empty")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mode Differentials" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Compare", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Open Search" })).toBeVisible();
    // Queue is a mode surface (composer allowed); presentation workflow below still owns no-composer chrome.
    await expectNoPageHorizontalOverflow(page);

    await gotoLauncher(page, "/differentials/compare?ids=wernicke-encephalopathy&q=Pain");
    await expect(page).toHaveURL(/\/differentials\/compare/);
    await expect(page).toHaveURL(/ids=wernicke-encephalopathy/);
    // A hidden streaming clone of the page root can coexist briefly in WebKit (#093).
    const queue = await expectSingleSettledOwner(page.getByTestId("differential-compare-queue"), { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "1 diagnosis selected" })).toBeVisible();
    await expect(queue.getByRole("link", { name: "Wernicke encephalopathy", exact: true })).toBeVisible();
    // The hidden streamed twin (#093) can return after the queue settles, so act on the visible copy.
    await visibleByTestId(page, "differential-compare-edit-selection").click();
    await expect(visibleByTestId(page, "differential-compare-picker")).toBeVisible();
    await expect(visibleByTestId(page, "differential-compare-open")).toBeVisible();

    const desktopOpen = visibleByTestId(page, "differential-compare-open");
    await expect(desktopOpen).toHaveAttribute("href", /\/differentials\/presentations\/acute-confusion-encephalopathy/);
    await desktopOpen.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/differentials\/presentations\/acute-confusion-encephalopathy/, { timeout: 30_000 }),
      desktopOpen.click(),
    ]);
    await expect(page).toHaveURL(/ids=wernicke-encephalopathy/);

    await expect(
      page.getByTestId("mobile-composer-reserve-pad").getByTestId("differential-presentation-page"),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: workflow.title })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `Selected differentials (1 of ${workflow.totalCount})` }).first(),
    ).toBeVisible();
    await expect(
      page.locator("span:visible", { hasText: `+${workflow.totalCount - 1} not selected` }).first(),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Safety snapshot" }).first()).toBeVisible();
    await expect(page.getByText("Service details")).toHaveCount(0);
    await expect(page.getByText("Transport order")).toHaveCount(0);
    await expect(page.getByLabel("Differential review sidebar").getByText("Local content only").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy after review" })).toBeVisible();
    await expect(page.getByTestId("differential-presentation-edit-selection-desktop")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit columns" })).toHaveCount(0);
    await expect(page.getByTestId("global-search-input")).toHaveCount(0);

    const tableScrolls = await page.getByTestId("differential-comparison-scroll").evaluate((element) => {
      return element.scrollWidth > element.clientWidth;
    });
    expect(tableScrolls).toBe(true);
    const desktopTableBox = await page.getByTestId("differential-comparison-scroll").boundingBox();
    expect(desktopTableBox?.width ?? 0).toBeGreaterThan(900);
    await expectNoPageHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoLauncher(page, "/differentials/compare?ids=wernicke-encephalopathy");
    // The navigation briefly overlaps the outgoing and incoming page roots; wait for one owner.
    await expectSingleSettledOwner(page.getByTestId("differential-compare-queue"), {
      message: "phone compare queue owner",
      timeout: 30_000,
    });
    // Scope to the visible owner: the hidden streaming copy of the page (#093)
    // can still be in the tree after the navigation above.
    const mobileOpen = visibleByTestId(page, "differential-compare-open");
    await expect(mobileOpen).toHaveAttribute("href", /\/differentials\/presentations\/acute-confusion-encephalopathy/);
    await mobileOpen.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(/\/differentials\/presentations\/acute-confusion-encephalopathy/, { timeout: 30_000 }),
      mobileOpen.click(),
    ]);

    // Scope to the live shell scrollport: Next may briefly retain a hidden
    // streaming `S:` clone of the page root under CI load, which would make a
    // document-wide getByTestId strict-mode fail.
    const presentationPage = page
      .getByTestId("mobile-composer-reserve-pad")
      .getByTestId("differential-presentation-page");
    await expect(presentationPage).toBeVisible({ timeout: 30_000 });
    const differentialModeNav = page.getByRole("navigation", { name: "Differentials pages" });
    await expect(differentialModeNav).toBeVisible();
    const modeOverflow = differentialModeNav.getByRole("button", { name: /More/ });
    await expect(modeOverflow).toBeVisible();
    await modeOverflow.click();
    const modeSheet = page.getByRole("dialog", { name: "Differentials pages" });
    await expect(modeSheet).toBeVisible();
    await expect(modeSheet.getByRole("link", { name: "Presentations" })).toHaveAttribute("aria-current", "page");
    await expect(modeSheet.getByRole("link", { name: "Compare" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modeSheet).toBeHidden();
    await expect(page.getByRole("link", { name: "Back to differentials" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Differential breadcrumbs" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: workflow.title })).toBeVisible();
    const mobileComparison = page.getByLabel("Mobile differential comparison");
    const editSelection = mobileComparison.getByRole("link", { name: "Edit" });
    await expect(editSelection).toBeVisible();
    await expect(editSelection).toHaveAttribute("href", /\/differentials\/search\?.*ids=wernicke-encephalopathy/);
    await expect(mobileComparison.getByText("Wernicke encephalopathy", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Language and region settings (coming soon)" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start a new chat" })).toBeVisible();
    await expect(page.getByTestId("global-search-input")).toHaveCount(0);
    await expect(page.getByText("Service details")).toHaveCount(0);
    await expect(page.getByText("Transport order")).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);

    for (const viewport of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 639, height: 900 },
      { width: 768, height: 1024 },
      { width: 1440, height: 920 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.getByRole("heading", { level: 1, name: workflow.title })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Differentials pages" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Safety snapshot" }).first()).toBeVisible();
      await expectNoPageHorizontalOverflow(page);
    }

    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { level: 1, name: workflow.title })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Differentials pages" })).toBeVisible();
    await expect(page.getByTestId("differential-presentation-edit-selection-mobile")).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
  });

  test("tools mode opens tool details before navigation on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await gotoLauncher(page, "/tools");

    const results = visibleByTestId(page, "tools-search-results-page");
    const detailsButton = results.getByRole("button", { name: "About Medication Prescribing" });
    await detailsButton.click();
    const detailSheet = page.getByTestId("tools-search-detail-sheet");
    await expect(detailSheet).toBeVisible();
    await expect(detailSheet.getByRole("heading", { name: "Medication Prescribing" })).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
  });
});

test.describe("PsychSift service detail page", () => {
  test.describe.configure({ timeout: 60_000 });

  for (const viewport of [
    { name: "small phone", width: 320, height: 740 },
    { name: "phone", width: 390, height: 820 },
    { name: "large phone", width: 639, height: 900 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
    { name: "wide desktop", width: 1920, height: 1080 },
  ] as const) {
    test(`13YARN service detail is usable at ${viewport.name}`, async ({ page }) => {
      await mockAnswerDashboardApi(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoLauncher(page, "/services/13yarn");

      const servicePage = page.locator('[data-testid="service-detail-page"]:visible').last();
      await expect(servicePage).toBeVisible();
      await expect(servicePage.getByRole("heading", { level: 1, name: "13YARN" })).toBeVisible();
      // The record's controls live in the in-page header's actions sheet, and
      // the header is a sibling of the shell rather than inside it — one page
      // header per route, portaled into the phone collapse row below `sm`.
      await expect(page.getByRole("link", { name: "Back to services" })).toBeVisible();
      await visibleByTestId(page, "service-actions-trigger").click();
      const actions = page.getByTestId("service-actions-sheet");
      await expect(actions.getByRole("button", { name: "Save service" })).toBeVisible();
      await expect(actions.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:139276");
      await expect(actions.getByRole("button", { name: "Use in navigator" })).toBeVisible();
      await expect(servicePage.getByRole("link", { name: "Call 13 92 76" })).toHaveAttribute("href", "tel:139276");
      await expect(servicePage.getByRole("heading", { name: "Priority facts" })).toBeVisible();
      await expect(servicePage.getByRole("button", { name: /copy/i })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(actions).toBeHidden();
      // Information pages carry no search composer at any breakpoint: not the
      // shell chrome above the record, not the phone bottom dock, and nothing
      // page-local either. This loop runs at all six widths, which is the
      // phone/tablet/desktop proof.
      await expect(page.getByTestId("global-search-input")).toHaveCount(0);
      await expect(page.locator("form.answer-footer-search-dock, form.answer-footer-search-edge")).toHaveCount(0);
      await expect(servicePage.getByPlaceholder(/Search services/i)).toHaveCount(0);
      await expectNoPageHorizontalOverflow(page);
    });
  }

  test("service referral action remains keyboard reachable in reduced motion and forced colors", async ({ page }) => {
    await mockAnswerDashboardApi(page);
    await page.setViewportSize({ width: 390, height: 820 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await gotoLauncher(page, "/services/13yarn");

    const servicePage = page.locator('[data-testid="service-detail-page"]:visible').last();
    const referralAction = servicePage.getByRole("link", { name: "Call 13 92 76" });
    await referralAction.focus();

    await expect(referralAction).toBeFocused();
    await expect(referralAction).toHaveAttribute("href", "tel:139276");
    await expectNoPageHorizontalOverflow(page);
  });

  test("long mobile service details paint to the viewport edge with no bottom search dock", async ({ page }) => {
    // The record page is an information page, so the shell mounts no phone dock
    // and the reserve collapses to the idle content pad. This used to prove the
    // opposite (footer clears a visible dock); the end-of-page hazard it guards
    // is the same one, now expressed against the composer-free contract: the
    // last line of the record must be fully on screen at the scroll endpoint,
    // with no leftover dock-sized blank band under it.
    await mockAnswerDashboardApi(page);
    await page.setViewportSize({ width: 390, height: 820 });
    await gotoLauncher(page, "/services/city-east-community-mental-health-service");

    // Scope to the live shell scrollport: Next may briefly retain a hidden
    // streaming `S:` clone of the page root under CI load.
    const servicePage = page.getByTestId("mobile-composer-reserve-pad").getByTestId("service-detail-page");
    const footer = servicePage.getByText("Information accuracy may vary. Confirm locally before use.");
    const mainContent = page.locator("#main-content");
    await expect(servicePage).toBeVisible();
    await expect(page.locator("form.answer-footer-search-dock, form.answer-footer-search-edge")).toHaveCount(0);
    await expect(page.getByTestId("global-search-input")).toHaveCount(0);
    // mobileComposerIdleReserve is 2rem (32px) with no safe-area inset added,
    // because no composer chrome is visible to consume one.
    await expect.poll(async () => readMobileComposerReservePx(mainContent)).toBeLessThanOrEqual(32);
    const readClearance = () =>
      footer.evaluate((element) => {
        const mainElement = document.querySelector<HTMLElement>("#main-content");
        const servicePage = document.querySelector<HTMLElement>('[data-testid="service-detail-page"]');
        if (!mainElement) return null;
        const mainStyle = window.getComputedStyle(mainElement);
        const pad = mainElement.querySelector<HTMLElement>('[data-testid="mobile-composer-reserve-pad"]');
        return {
          footerBottom: element.getBoundingClientRect().bottom,
          viewportHeight: window.innerHeight,
          reservePx: pad
            ? Number.parseFloat(window.getComputedStyle(pad).paddingBottom)
            : Number.parseFloat(mainStyle.paddingBottom),
          reserve: mainStyle.getPropertyValue("--mobile-composer-reserve").trim(),
          serviceBottom: servicePage?.getBoundingClientRect().bottom ?? null,
          serviceHeight: servicePage?.getBoundingClientRect().height ?? null,
        };
      });

    // Document scrolling can change the settled range after the first endpoint
    // jump (reserve/layout commit), and it can drift back off the endpoint
    // AFTER the range has once converged. So the rect is read INSIDE this
    // retry, bracketed by an endpoint assertion on either side: only a rect
    // taken while the page was genuinely at its endpoint reaches the
    // assertions below, and a drift retries instead of failing them. Reading
    // it after the loop is what let a converged scroll regress to the
    // documented ~67px and fail the footer clearance on a position that
    // clearance never described (PR #2903, CI run 35458348083, 2026-09-19).
    let scrollGeometry: Awaited<ReturnType<typeof readPrimaryScrollGeometry>> | null = null;
    let clearance: Awaited<ReturnType<typeof readClearance>> = null;
    await expect(async () => {
      await scrollPrimarySurface(page, "end");
      const before = await readPrimaryScrollGeometry(page);
      expect(before.owner).toBe("document");
      expect(before.maxScrollTop - before.scrollTop).toBeLessThanOrEqual(1);

      const measured = await readClearance();

      const after = await readPrimaryScrollGeometry(page);
      expect(after.owner).toBe("document");
      expect(after.maxScrollTop - after.scrollTop).toBeLessThanOrEqual(1);

      clearance = measured;
      scrollGeometry = after;
    }).toPass({ timeout: 15_000 });

    expect(scrollGeometry!.owner).toBe("document");
    expect(clearance, JSON.stringify({ clearance, scrollGeometry })).not.toBeNull();
    expect(clearance!.reservePx, JSON.stringify({ clearance, scrollGeometry })).toBeLessThanOrEqual(32);
    // Fully on screen, and not floated above the fold by an oversized reserve.
    expect(clearance!.footerBottom, JSON.stringify({ clearance, scrollGeometry })).toBeLessThanOrEqual(
      clearance!.viewportHeight,
    );
    expect(clearance!.footerBottom, JSON.stringify({ clearance, scrollGeometry })).toBeGreaterThan(
      clearance!.viewportHeight - 120,
    );
  });

  test("service navigator action uses the shared global search route", async ({ page }) => {
    await mockAnswerDashboardApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/services/13yarn");

    await visibleByTestId(page, "service-actions-trigger").click();
    await page.getByTestId("service-actions-sheet").getByRole("button", { name: "Use in navigator" }).click();
    await expect(page).toHaveURL(/\/services\/search\?/);
    await expect(page).toHaveURL(/run=1/);
    await expect(page).toHaveURL(/focus=1/);
  });

  test("service actions keep a distinct verification source beside the contact route", async ({ page }) => {
    await mockAnswerDashboardApi(page);
    await page.setViewportSize({ width: 390, height: 820 });
    await gotoLauncher(page, "/services/adult-home-treatment-team");

    await visibleByTestId(page, "service-actions-trigger").click();
    const actions = page.getByTestId("service-actions-sheet");
    await expect(actions.getByRole("link", { name: "Call" })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Open source" })).toHaveAttribute("href", /^https?:\/\//);
    await expect(page.getByRole("link", { name: "View service source" })).toHaveAttribute("href", /^https?:\/\//);
  });

  test("service detail actions save and back from direct entry", async ({ page }) => {
    await mockAnswerDashboardApi(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoLauncher(page, "/services/13yarn");

    const actionsTrigger = visibleByTestId(page, "service-actions-trigger");
    const actions = page.getByTestId("service-actions-sheet");

    // The action closes the sheet, so the feedback banner it writes has to stay
    // mounted on the page behind it — that banner is the save confirmation.
    await actionsTrigger.click();
    await actions.getByRole("button", { name: "Save service" }).click();
    await expect(page.getByTestId("service-detail-page").getByRole("status")).toContainText("Service saved");

    await actionsTrigger.click();
    await expect(actions.getByRole("button", { name: "Remove saved service" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Copy contact" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: "Back to services" }).click();
    // "/services" is a consolidated mode path: consolidatedModeHomeTarget redirects
    // the bare path onto the shared home rather than rendering a standalone page.
    await expect(page).toHaveURL(/\?mode=services(?:&|$)/);
  });
});

test.describe("Responsive layout guards", () => {
  test.describe.configure({ timeout: 90_000 });

  // Widths straddle every breakpoint the mockups switch layout at: the sm (640px),
  // lg (1024px), and xl (1280px) grid changes, plus the narrow phone floor (320px).
  const responsiveWidths = [320, 375, 414, 640, 768, 1024, 1280] as const;

  async function settleLayout(page: Page) {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }

  const mockupRoutes = [
    { name: "tools command center", path: "/mockups/tools-command-center" },
    { name: "tools split pane", path: "/mockups/tools-split-pane" },
    { name: "tools workflow board", path: "/mockups/tools-workflow-board" },
  ] as const;

  for (const route of mockupRoutes) {
    test(`${route.name} never overflows horizontally across sizes @mockup`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await gotoLauncher(page, route.path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

      for (const width of responsiveWidths) {
        await page.setViewportSize({ width, height: 900 });
        await settleLayout(page);
        await expectNoPageHorizontalOverflow(page);
      }
    });
  }

  const modeHomeRoutes = [
    { name: "prescribing", path: "/medications" },
    { name: "differentials", path: "/differentials" },
    { name: "services", path: "/?mode=services" },
    { name: "forms", path: "/?mode=forms" },
  ] as const;

  for (const route of modeHomeRoutes) {
    test(`${route.name} mode home never overflows horizontally across sizes`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await gotoLauncher(page, route.path);
      await expect(page.getByRole("heading").first()).toBeVisible();

      for (const width of responsiveWidths) {
        await page.setViewportSize({ width, height: 900 });
        await settleLayout(page);
        await expectNoPageHorizontalOverflow(page);
      }
    });
  }

  // "prescribing mode home centres above the phone composer and balances on
  // tablet" and the idle portion of "prescribing mobile shortcuts and checks are
  // distinct, actionable, and scrollable" were removed here (2026-09
  // consolidation): both exercised the `medication-home` idle view — the
  // Dose/Safety/Monitoring/Access shortcut pills and the vertical centering of
  // that specific component — that `/medications` used to render on its own
  // standalone route. `/medications` now redirects to the shared home
  // (`/?mode=prescribing`, `shared-home-empty-state`) like most other modes, so
  // `medication-home` is retired and no longer reachable from any route; its
  // vertical-centering behavior is unreachable along with it, and the pill
  // click/query assertions have nothing left to click. The still-live half of
  // the second test — the submitted-search results view — survives below,
  // reached directly instead of via a pill click.
  /*
   * Clearing the composer used to empty the React query while leaving `q` and
   * `run=1` in the URL. `showSharedHome` reads `run=1` off the URL, so it stayed
   * suppressed while MedicationPrescribingWorkspace, now seeing no query, fell back
   * to `medication-home` — the Dose/Safety/Monitoring tiles `/medications` was
   * consolidated away from, and which this file's own note above calls "retired and
   * no longer reachable from any route". It was reachable, by this exact click.
   */
  test("clearing a prescribing search returns the shared home, never the retired medication home", async ({ page }) => {
    await mockAnswerDashboardApi(page);
    await gotoLauncher(page, "/?mode=prescribing&q=acamprosate%20renal%20dose&run=1");

    await page
      .getByRole("button", { name: /clear search question|clear search/i })
      .first()
      .click();

    await expect(page).toHaveURL(/\/\?mode=prescribing&focus=1$/);
    await expect(page.getByTestId("shared-home-empty-state")).toBeVisible();
    await expect(page.getByTestId("medication-home")).toHaveCount(0);
  });

  test("prescribing submitted search keeps results above the phone bottom dock", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    await mockAnswerDashboardApi(page);

    await gotoLauncher(page, "/?mode=prescribing&q=acamprosate%20renal%20dose&run=1");
    const resultCard = page.getByTestId("medication-result-acamprosate-phone");
    const bottomDock = page.locator("form.answer-footer-search-dock");
    await expect(resultCard).toBeVisible();
    const queryRibbon = page.getByTestId("search-query-ribbon");
    await expect(queryRibbon).toBeVisible();
    await expect(queryRibbon.getByRole("heading", { name: "acamprosate renal dose" })).toBeVisible();
    await expect(queryRibbon.getByRole("status")).toBeVisible();
    const resultFilter = queryRibbon.getByTestId("medication-filter-trigger-phone");
    await expect(resultFilter).toBeVisible();
    await expect(resultFilter).toHaveAccessibleName(/No filters active/);
    await expect(bottomDock).toBeVisible();
    await scrollPrimarySurface(page, "end");
    await expect
      .poll(async () => {
        const geometry = await readPrimaryScrollGeometry(page);
        return geometry.maxScrollTop - geometry.scrollTop;
      })
      .toBeLessThanOrEqual(1);
    expect((await readPrimaryScrollGeometry(page)).owner).toBe("document");
    await expect(bottomDock).not.toHaveAttribute("data-scroll-hidden", "true");
    const resultBox = await resultCard.boundingBox();
    const dockBox = await bottomDock.boundingBox();
    expect(resultBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(resultBox!.y + resultBox!.height).toBeLessThanOrEqual(dockBox!.y + 2);
  });

  test("safety-plan working content stays local until an explicit export", async ({ page }) => {
    const appRequests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "fetch" || request.resourceType() === "xhr") appRequests.push(request.url());
    });

    await page.goto("/safety-plan");
    await expect(page.getByLabel(/Patient \(name or initials\)/i)).toHaveCount(0);
    const privacyRegion = page.getByRole("region", { name: "Safety plan privacy" });
    await expect(privacyRegion).toHaveCount(1);
    await expect(privacyRegion.getByText(/kept only in this browser tab/i)).toBeVisible();
    // Pin the single-panel invariant BEFORE reading text out of it.
    //
    // Scoping to [data-safety-plan-copy] was already an attempt to dodge a
    // strict-mode failure, and it proved insufficient: one Production UI run saw
    // the notice resolve to two identical <p> elements, one reachable through
    // getByRole("main") and one not. Nothing in the product renders it twice —
    // the copy appears once in patient-safety-plan.tsx, the panel carries the
    // attribute once, and /safety-plan mounts the component once, verified by
    // 240 DOM samples across six loads through the hydration window — so what
    // that run caught was a transient second tree during navigation, not a
    // duplicate render.
    //
    // Asserting the count first makes the test wait for a settled single tree
    // instead of sampling mid-swap, and it turns "there is exactly one patient
    // copy panel" into something the suite states outright rather than assumes.
    // That is strictly more coverage than the bare visibility check, so the
    // flake is removed by tightening the assertion rather than loosening it.
    const patientCopyPanel = page.locator("[data-safety-plan-copy]");
    await expect(patientCopyPanel).toHaveCount(1);
    // Below lg the builder and the patient copy are two tabs, so a phone user reaches the
    // export buttons, and the warning beside them, through "Plan preview". Walk the same path.
    const paneSwitch = page.getByRole("tablist", { name: "Safety plan view" });
    const phonePanes = await paneSwitch.isVisible();
    const showPane = async (name: "Build" | "Plan preview") => {
      if (phonePanes) await paneSwitch.getByRole("tab", { name }).click();
    };
    await showPane("Plan preview");
    await expect(
      patientCopyPanel.getByText(/Copying, printing, or saving a PDF moves the plan outside PsychSift/i),
    ).toBeVisible();

    await page.evaluate(() => {
      const testWindow = window as typeof window & { __copiedPlan?: string; __printCalled?: boolean };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            testWindow.__copiedPlan = value;
          },
        },
      });
      window.print = () => {
        testWindow.__printCalled = true;
      };
    });
    appRequests.length = 0;

    await showPane("Build");
    await page.getByLabel("e.g. Not sleeping for a couple of nights").fill("Not sleeping");
    await page.getByRole("button", { name: "Add" }).first().click();
    await showPane("Plan preview");
    await page.getByRole("button", { name: "Copy" }).click();

    await expect
      .poll(() => page.evaluate(() => (window as typeof window & { __copiedPlan?: string }).__copiedPlan))
      .toContain("Not sleeping");
    expect(await page.evaluate(() => (window as typeof window & { __copiedPlan?: string }).__copiedPlan)).not.toMatch(
      /^For:/m,
    );

    await page.getByRole("button", { name: "Print / PDF" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as typeof window & { __printCalled?: boolean }).__printCalled))
      .toBe(true);
    expect(appRequests).toEqual([]);
  });
});
