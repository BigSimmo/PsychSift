import { expect, test, type Page } from "playwright/test";
import { clickWhenSettled } from "./playwright-settlement";

/**
 * Element-overlap regression coverage.
 *
 * The page-overflow smoke checks only assert document-level horizontal
 * overflow, which overlapping siblings never trigger. This header bug class
 * shipped three separate times (source ledger under the mode pill, the
 * composer clear button over typed text, and the standalone-home status chips
 * under the pill), so these tests assert directly that visible header
 * elements do not stack on top of each other at any supported width, and
 * that the composer clear button occupies its own slot.
 */

const headerWidths = [640, 768, 1024, 1152, 1280, 1366, 1440, 1536] as const;

const readySetupChecks = [
  { id: "env", label: ".env.local configured", status: "ready", detail: "Test environment ready." },
  { id: "project", label: "PsychSift Production target", status: "ready", detail: "Test Supabase project ready." },
  { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Test schema ready." },
  { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Test search schema ready." },
  { id: "openai", label: "OpenAI API key available", status: "ready", detail: "Test OpenAI ready." },
  { id: "worker", label: "npm run worker running", status: "unknown", detail: "Worker not required for UI smoke." },
];

async function mockSetupStatus(page: Page) {
  await page.route("**/api/setup-status**", async (route) => {
    await route.fulfill({ json: { demoMode: true, checks: readySetupChecks } });
  });
}

async function mockDemoDashboard(page: Page) {
  await mockSetupStatus(page);
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
  await page.route(/\/api\/documents(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        documents: [],
        demoMode: true,
        pagination: { limit: 150, offset: 0, total: 0, nextOffset: 0, hasMore: false },
      },
    });
  });
}

async function gotoHome(page: Page) {
  // Pin mode=answer so GlobalSearchShell does not immediately router.replace()
  // for a stored landing preference. That replace can briefly leave two mounted
  // shells (and two header#search nodes), which trips Playwright strict mode.
  await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });
  // Wait until React settles on a single header. During client remount /
  // hydration a second transient header#search can exist briefly; checking
  // count then immediately calling waitFor races that flicker into a strict-mode
  // violation. Retry count+visibility together so permanent double-render still
  // fails while transient remounts can settle.
  await expect(async () => {
    const header = page.locator("header#search");
    await expect(header).toHaveCount(1);
    await expect(header).toBeVisible();
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: "Open answer options" }).waitFor({ state: "visible", timeout: 30_000 });
}

type OverlapReport = { count: number; overlaps: string[] };

async function collectHeaderOverlaps(page: Page): Promise<OverlapReport> {
  return page.evaluate(() => {
    const header = Array.from(document.querySelectorAll("header#search, header, [role='banner']")).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!header) return { count: 0, overlaps: ["visible header not found"] };
    // Interactive controls plus the styled status chips (spans) that sit
    // alongside them; nested elements are excluded via the contains() check.
    const candidates = Array.from(
      header.querySelectorAll("button, summary, a, div > span.inline-flex, div > span.grid"),
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const overlaps: string[] = [];
    const label = (element: Element) =>
      element.getAttribute("aria-label") ?? (element.textContent ?? "").trim().slice(0, 24);
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i].getBoundingClientRect();
        const b = candidates[j].getBoundingClientRect();
        const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const nested = candidates[i].contains(candidates[j]) || candidates[j].contains(candidates[i]);
        // 4px tolerance ignores subpixel rounding and intentional edge kisses.
        if (xOverlap > 4 && yOverlap > 4 && !nested) {
          overlaps.push(
            `"${label(candidates[i])}" overlaps "${label(candidates[j])}" by ${Math.round(Math.min(xOverlap, yOverlap))}px`,
          );
        }
      }
    }
    return { count: candidates.length, overlaps };
  });
}

// The settled mode-home stack is 160px for a mouse or trackpad. On a touch screen the prompt chips
// meet the 48px tap floor instead of 32px (`@media (pointer: coarse)` on `.answer-suggestion-chip`
// in globals.css), so the same one-row stack is 16px taller. The iPhone projects run these wide
// viewports with a touch pointer, which is why they measured 176 and failed against a bare 160.
async function expectedModeHomeStackHeight(page: Page) {
  const coarsePointer = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  return coarsePointer ? 176 : 160;
}

test.describe("Header element overlap coverage", () => {
  for (const width of headerWidths) {
    test(`header controls do not overlap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockDemoDashboard(page);
      await gotoHome(page);

      // gotoHome settles on a single visible header, but a later React remount
      // can detach it again between that settle and this measurement — the
      // header then has a 0x0 rect, no candidates are collected, and count is 0.
      // Retry the collection (not the overlap assertion) so a header that never
      // renders still fails, while a transient remount settles. Without this the
      // suite fails at a different, arbitrary width on each contended run.
      let report = await collectHeaderOverlaps(page);
      await expect(async () => {
        report = await collectHeaderOverlaps(page);
        expect(report.count, "expected the active mode control in the header").toBeGreaterThanOrEqual(
          width >= 768 ? 1 : 2,
        );
      }).toPass({ timeout: 15_000 });
      expect(report.overlaps, `overlapping header elements at ${width}px`).toEqual([]);

      if (width >= 768) {
        await expect(page.getByRole("button", { name: "Start a new chat" })).toHaveCount(0);
      }
      if (width >= 1024) {
        await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeVisible();
      } else if (width >= 768) {
        // The two-pane side menu's strip stands in for the clinical icon rail on tablets.
        await expect(page.getByTestId("two-pane-rail")).toBeVisible();
      }
    });
  }

  for (const viewport of [
    { name: "narrow-phone", width: 360, height: 780 },
    { name: "phone", width: 390, height: 820 },
  ] as const) {
    test(`header menu and new-chat insets stay symmetric on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockDemoDashboard(page);
      await gotoHome(page);

      const menu = page.getByRole("button", { name: "Open PsychSift menu" });
      const newChat = page.getByRole("button", { name: "Start a new chat" });
      await expect(menu).toBeVisible();
      await expect(newChat).toBeVisible();

      // Headless Chromium reports env(safe-area-inset-*) as 0, so this asserts
      // the --header-edge-pad (1rem) chrome inset — not notch asymmetry.
      //
      // Sample the geometry inside a retry: a React remount can leave the header
      // mid-layout, and a single sample then reads transient boxes. The
      // assertions themselves are unchanged and still strict, so a genuinely
      // asymmetric header fails once the retry budget is spent — only a
      // transient one settles.
      await expect(async () => {
        const menuBox = await menu.boundingBox();
        const newChatBox = await newChat.boundingBox();
        expect(menuBox, "menu control must have geometry").not.toBeNull();
        expect(newChatBox, "new-chat control must have geometry").not.toBeNull();

        const leftInset = menuBox!.x;
        const rightInset = viewport.width - (newChatBox!.x + newChatBox!.width);
        // 1rem header pad (~16px) with 2px subpixel tolerance.
        expect(leftInset, "left menu inset should be at least ~1rem").toBeGreaterThanOrEqual(14);
        expect(rightInset, "right new-chat inset should be at least ~1rem").toBeGreaterThanOrEqual(14);
        expect(
          Math.abs(leftInset - rightInset),
          `left/right insets should match (left=${leftInset}, right=${rightInset})`,
        ).toBeLessThanOrEqual(2);
      }).toPass({ timeout: 15_000 });
    });
  }

  for (const viewport of [
    { name: "narrow-phone", width: 360, height: 780 },
    { name: "phone", width: 390, height: 820 },
  ] as const) {
    test(`in-page action group stays inside the header gutter on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockDemoDashboard(page);
      await page.goto("/therapy-compass/cognitive-behavioural-therapy-cbt", { waitUntil: "domcontentloaded" });

      const back = page.getByRole("link", { name: /Back to /i });
      const actionGroup = page.getByTestId("therapy-detail-action-group");
      await expect(actionGroup).toBeVisible({ timeout: 30_000 });
      await expect(back).toBeVisible();

      // Same contract as hamburger / new-chat: --header-edge-pad (~16px) with
      // 2px subpixel tolerance. Headless Chromium reports safe-area insets as 0.
      await expect(async () => {
        const backBox = await back.boundingBox();
        const groupBox = await actionGroup.boundingBox();
        expect(backBox, "back control must have geometry").not.toBeNull();
        expect(groupBox, "action group must have geometry").not.toBeNull();

        const leftInset = backBox!.x;
        const rightInset = viewport.width - (groupBox!.x + groupBox!.width);
        expect(leftInset, "left back inset should be at least ~1rem").toBeGreaterThanOrEqual(14);
        expect(rightInset, "right action-group inset should be at least ~1rem").toBeGreaterThanOrEqual(14);
        expect(
          Math.abs(leftInset - rightInset),
          `left/right insets should match (left=${leftInset}, right=${rightInset})`,
        ).toBeLessThanOrEqual(2);
      }).toPass({ timeout: 15_000 });
    });
  }

  for (const viewport of [
    { name: "mobile", width: 390, height: 820 },
    { name: "desktop", width: 1280, height: 900 },
  ] as const) {
    test(`composer clear button does not cover typed text at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockDemoDashboard(page);
      await gotoHome(page);

      const input = page.locator('[data-testid="global-search-input"]:visible').first();
      await expect(input).toBeEditable();
      await expect(async () => {
        await input.click();
        await input.fill("Synthetic lithium monitoring guidance question");
        await expect(input).toHaveValue("Synthetic lithium monitoring guidance question");
        await expect(page.locator('[aria-label="Clear search question"]:visible').first()).toBeVisible();
      }).toPass({ timeout: 15_000 });

      const geometry = await page.evaluate(() => {
        const inputElement = document.querySelector('[data-testid="global-search-input"]');
        const clearElement = document.querySelector('[aria-label="Clear search question"]');
        if (!inputElement || !clearElement) return null;
        const inputRect = inputElement.getBoundingClientRect();
        const clearRect = clearElement.getBoundingClientRect();
        return { inputRight: inputRect.right, clearLeft: clearRect.left };
      });

      expect(geometry, "input and clear button must both render").not.toBeNull();
      expect(
        geometry!.inputRight,
        "the input must end before the clear button starts (no text under the button)",
      ).toBeLessThanOrEqual(geometry!.clearLeft + 1);
    });
  }

  test("desktop dormant search keeps the example ticker and prompts around the composer without a Smart promise", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoDashboard(page);
    await gotoHome(page);

    // Every mode home shares the same stack: "Try …" ticker line above the
    // pill, prompt rail below. Answer is a dormant mode, so the ticker must
    // read as an ordinary example search with no Smart wording.
    const ticker = page.getByTestId("search-example-ticker");
    const promptRow = page.getByTestId("smart-search-prompt-row");
    await expect(ticker).toBeVisible();
    await expect(ticker).toContainText("in Answer.");
    await expect(ticker).not.toContainText("Smart");
    await expect(page.getByTestId("smart-search-intent-cue")).toHaveCount(0);
    await expect(promptRow).toBeVisible();
    await expect(promptRow.getByRole("button", { name: "lithium level timing" })).toBeVisible();
    await expect(promptRow.getByRole("button", { name: "clozapine ANC monitoring" })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const ticker = document.querySelector('[data-testid="search-example-ticker"]');
      const prompt = document.querySelector('[data-testid="smart-search-prompt-row"]');
      const pill = document.querySelector(".answer-footer-search-pill");
      if (!ticker || !prompt || !pill) return null;
      const tickerRect = ticker.getBoundingClientRect();
      const promptRect = prompt.getBoundingClientRect();
      const pillRect = pill.getBoundingClientRect();
      return {
        tickerBottom: tickerRect.bottom,
        pillTop: pillRect.top,
        pillBottom: pillRect.bottom,
        promptTop: promptRect.top,
      };
    });

    expect(geometry, "composer, ticker, and prompt row must render").not.toBeNull();
    expect(geometry!.tickerBottom, "the ticker should sit above the search bar").toBeLessThanOrEqual(
      geometry!.pillTop + 1,
    );
    expect(geometry!.promptTop, "prompts should sit below the search bar").toBeGreaterThanOrEqual(
      geometry!.pillBottom - 1,
    );

    await promptRow.getByRole("button", { name: "lithium level timing" }).click();
    await expect(page.locator('[data-testid="global-search-input"]:visible').first()).toHaveValue(
      "lithium level timing",
    );
  });

  // The mode-home Prompts rail must stay ONE scrolling line at every sm+ width.
  // It was a single line only across 640-1279.98px, so above 1280px the chips
  // were free to wrap. Fifteen modes hid that because their three prompts fit
  // the rail; Specifiers' did not, so its home alone stood 39px taller than the
  // stack the reserve token is sized for. Widths chosen either side of the old
  // 1279.98px boundary, and Specifiers is named because it is the mode whose
  // prompt copy actually overflows.
  test("mode-home prompt rails stay on one line above the old tablet boundary", async ({ page }) => {
    await mockDemoDashboard(page);

    for (const width of [1280, 1920]) {
      await page.setViewportSize({ width, height: 950 });
      for (const mode of ["specifiers", "forms", "answer"]) {
        const label = `/?mode=${mode} @ ${width}px`;
        await page.goto(`/?mode=${mode}`, { waitUntil: "domcontentloaded" });
        await expect(async () => {
          await expect(page.locator("header#search")).toHaveCount(1);
          await expect(page.getByTestId("smart-search-prompt-row")).toBeVisible();
        }).toPass({ timeout: 30_000 });

        const geometry = await page.evaluate(() => {
          const slot = document.getElementById("mode-home-desktop-composer-slot");
          const chips = slot?.querySelector('[data-testid="smart-search-prompt-row"] .answer-suggestion-chips');
          if (!slot || !chips) return null;
          const rows = new Set([...chips.children].map((chip) => Math.round(chip.getBoundingClientRect().top)));
          return {
            chipRows: rows.size,
            chipCount: chips.children.length,
            composerHeight: Math.round(slot.getBoundingClientRect().height),
          };
        });

        expect(geometry, `${label}: home composer and prompt rail must render`).not.toBeNull();
        expect(geometry!.chipCount, `${label}: the rail must carry prompts to be worth measuring`).toBeGreaterThan(1);
        expect(geometry!.chipRows, `${label}: prompt chips must share one row`).toBe(1);
        // 160px is the settled stack every mode home shares: 24px ticker line,
        // the pill, gaps, the one-line rail and the privacy line.
        expect(geometry!.composerHeight, `${label}: home composer must be the shared 160px stack`).toBe(
          await expectedModeHomeStackHeight(page),
        );
      }
    }
  });

  test("tablet and desktop result views render the compact pill alone in every mode", async ({ page }) => {
    await mockDemoDashboard(page);

    for (const width of [820, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      // Dictionary is in this list because it was the mode that fell out of it:
      // its catalogue was wired to the mode-home composer slot, so it kept the
      // hero ticker, Prompts rail and privacy line long after every other result
      // view had dropped them. Select the slot by id, not by test id — the
      // dictionary catalogue renders the same slot itself under its mode nav.
      for (const route of [
        "/forms/search?q=lithium&run=1",
        "/services/search?q=crisis&run=1",
        "/dictionary/search?q=lithium",
      ]) {
        const label = `${route} @ ${width}px`;
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(async () => {
          const header = page.locator("header#search");
          await expect(header).toHaveCount(1);
          await expect(page.locator('[data-testid="global-search-input"]:visible').first()).toBeVisible();
        }).toPass({ timeout: 30_000 });

        await expect(page.getByTestId("smart-search-prompt-row"), label).toHaveCount(0);
        await expect(page.getByTestId("search-example-ticker"), label).toHaveCount(0);
        await expect(page.getByTestId("smart-search-phone-ticker"), label).toHaveCount(0);
        // Result composers are the compact pill alone: the APP-5 line lives on
        // the mode-home hero and the answer dock, not under a result bar.
        await expect(page.getByTestId("answer-composer-privacy-warning"), label).toHaveCount(0);

        // The page slot reserves exactly the settled composer height, so no
        // blank band sits between the pill and the results at any sm+ width.
        const geometry = await page.evaluate(() => {
          const slot = document.getElementById("desktop-page-search-composer-slot");
          const form = slot?.querySelector('form[role="search"]');
          if (!slot || !form) return null;
          return { slot: slot.getBoundingClientRect().height, form: form.getBoundingClientRect().height };
        });
        expect(geometry, `${label}: page slot and composer must render`).not.toBeNull();
        expect(
          Math.abs(geometry!.slot - geometry!.form),
          `${label}: page slot must hug the composer (slot ${geometry!.slot}px vs composer ${geometry!.form}px)`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test("phone result views keep the single compact dock in every mode", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoDashboard(page);

    for (const route of ["/forms/search?q=lithium&run=1", "/documents/search?q=lithium"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(async () => {
        await expect(page.locator("header#search")).toHaveCount(1);
        await expect(page.locator('[data-testid="global-search-input"]:visible').first()).toBeVisible();
      }).toPass({ timeout: 30_000 });

      const dock = page.locator('form[role="search"][data-footer-variant="compact"]');
      await expect(dock, route).toHaveCount(1);
      await expect(page.getByTestId("smart-search-phone-ticker"), route).toHaveCount(0);
      await expect(page.getByTestId("smart-search-prompt-row"), route).toBeHidden();
      // Phone result docks omit the privacy line so content keeps the screen.
      await expect(page.getByTestId("answer-composer-privacy-warning"), route).toHaveCount(0);
    }
  });

  // #ASVM8H (SPEC 9.4, "sticky elements do not cover focused content"). A browser phone
  // scrolls the document, and a Tab press scrolls the focused control into view without
  // knowing the fixed dock exists. The clearance comes from the `.phone-scroll-surface`
  // focus rule in globals.css (scroll-margin-block-end = the live composer reserve), so
  // this walks every result tab stop with real key presses and checks each one is on
  // screen, above the visible dock, and is what a tap at its centre would actually hit.
  test("phone Tab never leaves a focused result control under the compact dock", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoDashboard(page);
    await page.route(/\/api\/search(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          results: [],
          visualEvidence: [],
          relatedDocuments: [],
          documentMatches: Array.from({ length: 5 }, (_, index) => ({
            document_id: `1111111${index}-1111-4111-8111-111111111111`,
            title: `Lithium monitoring guideline ${index + 1}`,
            file_name: `lithium-monitoring-${index + 1}.pdf`,
            labels: [],
            summarySnippet: "Reviewed lithium monitoring guidance covering levels, renal and thyroid checks.",
            bestPages: [1, 2],
            bestChunkIds: [`chunk-lithium-${index}`],
            imageCount: 0,
            tableCount: 0,
            matchReason: "Matched indexed passage",
            score: 0.9 - index * 0.05,
          })),
          relevance: { verdict: "strong", score: 0.91, directSourceCount: 5, weakSourceCount: 0 },
          smartPanel: {},
          telemetry: { query_class: "lookup", retrieval_strategy: "text_fast_path" },
          scope: { queryMode: "lookup" },
          sourceGovernanceWarnings: [],
          demoMode: true,
        },
      });
    });

    await page.goto("/documents/search?q=lithium", { waitUntil: "domcontentloaded" });
    const input = page.locator('[data-testid="global-search-input"]:visible').first();
    await expect(async () => {
      await expect(page.locator("header#search")).toHaveCount(1);
      await expect(input).toBeVisible();
    }).toPass({ timeout: 30_000 });
    // Submit from the dock so the search runs after setup status has settled.
    await input.fill("lithium");
    await input.press("Enter");
    await expect(page.getByRole("link", { name: /Result 5:/ })).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      // Blurring alone leaves Chromium's sequential focus starting point on the dock input,
      // so the first Tab would land on the dock's Clear button and end the walk. Move the
      // starting point to the top of the page (the skip link) before walking.
      const start = document.querySelector<HTMLElement>('a[href="#main-content"]');
      if (start) {
        start.focus({ preventScroll: true });
        start.blur();
      } else {
        (document.activeElement as HTMLElement | null)?.blur();
      }
      window.scrollTo(0, 0);
    });

    const covered: string[] = [];
    let resultStops = 0;
    let scrolledStops = 0;
    for (let press = 0; press < 80; press++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) return { kind: "none" as const };
        if (active.closest(".phone-footer-layer")) return { kind: "dock" as const };
        if (!active.closest(".phone-scroll-surface")) {
          return { kind: "chrome" as const };
        }
        const rect = active.getBoundingClientRect();
        const dockForm = document.querySelector('form[role="search"][data-footer-variant="compact"]');
        const dockLayer = (dockForm?.closest(".phone-footer-layer") ?? dockForm) as HTMLElement | null;
        const dockRect = dockLayer?.getBoundingClientRect();
        const dockStyle = dockLayer ? getComputedStyle(dockLayer) : null;
        const dockShowing = Boolean(
          dockRect &&
          dockStyle &&
          dockStyle.visibility !== "hidden" &&
          Number(dockStyle.opacity) > 0 &&
          dockRect.top < window.innerHeight - 1,
        );
        const floor = dockShowing ? dockRect!.top : window.innerHeight;
        const centreX = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
        const centreY = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
        const hit = document.elementFromPoint(centreX, centreY);
        return {
          kind: "content" as const,
          label: (active.getAttribute("aria-label") ?? active.innerText ?? "").trim().slice(0, 40),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          floor: Math.round(floor),
          scrollY: Math.round(window.scrollY),
          hitIsSelf: Boolean(hit && (hit === active || active.contains(hit))),
        };
      });
      if (stop.kind === "dock") break;
      if (stop.kind !== "content") continue;
      resultStops += 1;
      if (stop.scrollY > 0) scrolledStops += 1;
      // 1px tolerance for subpixel layout.
      if (stop.top < 0 || stop.bottom > stop.floor + 1 || !stop.hitIsSelf) {
        covered.push(
          `"${stop.label}" at [${stop.top}, ${stop.bottom}] vs dock line ${stop.floor} (scrollY ${stop.scrollY}, hit self: ${stop.hitIsSelf})`,
        );
      }
    }

    // The walk must reach tab stops that start below the dock line, or it proves nothing.
    expect(resultStops, "Tab must walk the result list").toBeGreaterThanOrEqual(10);
    expect(scrolledStops, "some result stops must need the page to scroll").toBeGreaterThan(0);
    expect(covered, "no focused result control may sit under the dock or off screen").toEqual([]);
  });

  test("phone home keeps one tappable example ticker without a Smart promise", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockDemoDashboard(page);
    await gotoHome(page);

    // The desktop prompt rail is display:none on a phone, so the ticker is the
    // only suggestion a phone home page carries. It offers an ordinary search,
    // which is why it stays while the Smart line does not.
    await expect(page.getByTestId("search-example-ticker")).toBeHidden();
    await expect(page.getByTestId("smart-search-prompt-row")).toBeHidden();

    const ticker = page.getByTestId("smart-search-phone-ticker");
    await expect(ticker).toBeVisible();
    await expect(ticker).toContainText("Try this");
    await expect(ticker).toContainText("Tap to search");

    const tickerBox = await ticker.boundingBox();
    expect(tickerBox, "phone suggestion ticker must render").not.toBeNull();
    expect(tickerBox!.height, "phone ticker must meet the tap-target floor").toBeGreaterThanOrEqual(48);

    // Hover first: the ticker freezes its rotation on pointer/focus, so the
    // label read below cannot be superseded by the 3.2s tick between reading it
    // and clicking. Reading the label on a live rotation is the race that made
    // this journey flaky.
    await ticker.hover();
    const ariaLabel = (await ticker.getAttribute("aria-label")) ?? "";
    // Label-in-Name (WCAG 2.5.3): visible "Try this" / suggestion / "Tap to search"
    // must appear in the accessible name.
    expect(ariaLabel).toMatch(/^Try this .+\. Tap to search$/);
    const suggestion = ariaLabel.replace(/^Try this /, "").replace(/\. Tap to search$/, "");
    expect(suggestion).toBeTruthy();
    await ticker.click();
    await expect(page.locator('[data-testid="global-search-input"]:visible').first()).toHaveValue(suggestion ?? "");
  });

  test("phone suggestion ticker renders on /documents mode home", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockDemoDashboard(page);
    await page.goto("/documents", { waitUntil: "domcontentloaded" });
    await expect(async () => {
      const header = page.locator("header#search");
      await expect(header).toHaveCount(1);
      await expect(header).toBeVisible();
    }).toPass({ timeout: 30_000 });

    const ticker = page.getByTestId("smart-search-phone-ticker");
    await expect(ticker).toBeVisible();
    // Documents has no governed Smart answers, so the ticker must stay an
    // ordinary example search — no Smart wording anywhere on the composer.
    await expect(page.getByTestId("search-example-ticker")).toBeHidden();
    await expect(page.getByTestId("smart-search-intent-cue")).toHaveCount(0);
    const tickerBox = await ticker.boundingBox();
    expect(tickerBox, "phone suggestion ticker must render on /documents home").not.toBeNull();
    expect(tickerBox!.height, "phone ticker must meet the tap-target floor on /documents").toBeGreaterThanOrEqual(48);
  });
});

/**
 * Tablet regressions, measured at the width they were reported at.
 *
 * There is no tablet Playwright project — the config has a 390px phone and a
 * 1280px desktop and nothing between — and adding one would multiply every
 * journey in the required matrix. These four cases opt into 820px inside the
 * existing chromium project instead, which is the width all four defects were
 * found at and the width none of them is otherwise measured at.
 */
test.describe("Tablet usability regressions", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  // #2M4PX1. The rail must stay one line at every sm+ width — the test above
  // pins that at 1280 and 1920, and globals.css is read for `flex-wrap: nowrap`
  // by tests/search-route-ownership.test.ts. So the chips that do not fit are
  // reachable by a horizontal gesture only, and the trailing fade mask does not
  // announce one. Specifiers is the mode whose prompt copy actually overflows.
  test("the one-line prompt rail offers a real control to reach its clipped chips", async ({ page }) => {
    await mockDemoDashboard(page);
    await page.goto("/?mode=specifiers", { waitUntil: "domcontentloaded" });
    await expect(async () => {
      await expect(page.locator("header#search")).toHaveCount(1);
      await expect(page.getByTestId("smart-search-prompt-row")).toBeVisible();
    }).toPass({ timeout: 30_000 });

    // WebKit can stream a hidden duplicate of the page root (#093), so a bare
    // document.querySelector may read the clone's rail, which never scrolls.
    // Read the rail from the same visible owner the control is clicked in.
    const promptRow = page.getByTestId("smart-search-prompt-row").filter({ visible: true });
    const forward = promptRow.getByTestId("answer-suggestion-scroll-forward");
    await expect(forward, "the rail overflows at 820px, so the control must be offered").toBeVisible();

    // Production tap floor, and never min-h-11: TOKENS.md records 44px as the
    // value that reintroduces a known ui-smoke sub-pixel flake.
    const box = await forward.boundingBox();
    expect(box, "the scroll control must render").not.toBeNull();
    expect(box!.height, "scroll control must meet the 48px tap floor").toBeGreaterThanOrEqual(48);
    expect(box!.width, "scroll control must meet the 48px tap floor").toBeGreaterThanOrEqual(48);

    const rail = promptRow.locator(".answer-suggestion-chips");
    const before = await rail.evaluate((node) => node.scrollLeft);
    // The composer mounts and measures its rail in the first second after load. A WebKit release
    // run clicked the control while that was still happening and the rail never moved, so wait
    // for the control to hold still before pressing it.
    //
    // Evidence on failure only — the assertion below is unchanged. This journey has failed
    // on WebKit alone (scrollLeft stays 0) and cannot be reproduced in Chromium, so record what
    // WebKit actually did: whether the click reached the product handler, what the scroll call
    // asked for and got, and whether the rail read afterwards is still the node that was clicked.
    await rail.evaluate((node) => {
      const record: Record<string, unknown> = { scrollByCalls: [] as unknown[], clicks: [] as string[] };
      (window as unknown as { __railEvidence: typeof record }).__railEvidence = record;
      node.setAttribute("data-rail-evidence", "clicked-rail");
      const nativeScrollBy = node.scrollBy.bind(node);
      node.scrollBy = ((...args: Parameters<Element["scrollBy"]>) => {
        const beforeCall = node.scrollLeft;
        nativeScrollBy(...args);
        (record.scrollByCalls as unknown[]).push({
          args,
          beforeCall,
          afterCall: node.scrollLeft,
          connected: node.isConnected,
        });
      }) as Element["scrollBy"];
      document.addEventListener(
        "click",
        (event) => {
          const target = event.target as Element | null;
          (record.clicks as string[]).push(
            `${target?.tagName ?? "?"} in ${target?.closest("[data-testid]")?.getAttribute("data-testid") ?? "?"}`,
          );
        },
        { capture: true },
      );
    });
    await clickWhenSettled(forward);
    try {
      await expect
        .poll(async () => rail.evaluate((node) => node.scrollLeft), {
          message: "the control must actually move the rail",
          timeout: 5_000,
        })
        .toBeGreaterThan(before);
    } catch (error) {
      const evidence = await page.evaluate(() => {
        const rails = [...document.querySelectorAll<HTMLElement>(".answer-suggestion-chips-scroll")];
        return {
          ...(window as unknown as { __railEvidence?: Record<string, unknown> }).__railEvidence,
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          activeElement: document.activeElement?.tagName,
          rails: rails.map((rail) => {
            const style = getComputedStyle(rail);
            return {
              clickedRail: rail.getAttribute("data-rail-evidence") === "clicked-rail",
              visible: rail.getClientRects().length > 0,
              scrollLeft: rail.scrollLeft,
              scrollWidth: rail.scrollWidth,
              clientWidth: rail.clientWidth,
              overflowX: style.overflowX,
              scrollBehavior: style.scrollBehavior,
            };
          }),
        };
      });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nrail evidence: ${JSON.stringify(evidence)}`,
      );
    }
    await expect(promptRow.getByTestId("answer-suggestion-scroll-back")).toBeVisible();

    // The contract the affordance had to be designed around: one row of chips,
    // and a composer still the settled 160px with the control rendered.
    const chipGeometry = await rail.evaluate((chips) => ({
      chipRows: new Set([...chips.children].map((chip) => Math.round(chip.getBoundingClientRect().top))).size,
      chipCount: chips.children.length,
    }));
    const composerHeight = await page
      .locator("#mode-home-desktop-composer-slot")
      .filter({ visible: true })
      .evaluate((slot) => Math.round(slot.getBoundingClientRect().height));
    const geometry = { ...chipGeometry, composerHeight };
    expect(geometry, "home composer and prompt rail must render").not.toBeNull();
    expect(geometry!.chipCount, "the rail must carry prompts to be worth measuring").toBeGreaterThan(1);
    expect(geometry!.chipRows, "prompt chips must still share one row").toBe(1);
    expect(geometry!.composerHeight, "the control must not grow the shared 160px stack").toBe(
      await expectedModeHomeStackHeight(page),
    );
  });

  // #SFFGYD. These three carried `min-h-12 … sm:min-h-10`, so they met the floor
  // on a phone and stood at 40px from 640px up — every tablet, every desktop.
  test("services result-card actions keep the 48px tap floor", async ({ page }) => {
    await mockDemoDashboard(page);
    await page.goto("/services/search?q=crisis&run=1", { waitUntil: "domcontentloaded" });
    await expect(async () => {
      await expect(page.locator("header#search")).toHaveCount(1);
      await expect(page.getByRole("link", { name: /^Review referral for / }).first()).toBeVisible();
    }).toPass({ timeout: 30_000 });

    const controls = [
      page.getByRole("link", { name: /^Review referral for / }).first(),
      page.getByRole("button", { name: /^Add .+ to shortlist$/ }).first(),
      page.getByRole("button", { name: /^(Save|Remove) .+ (to|from) favourites$/ }).first(),
    ];
    for (const control of controls) {
      const name = await control.getAttribute("aria-label");
      const box = await control.boundingBox();
      expect(box, `${name}: control must render`).not.toBeNull();
      expect(box!.height, `${name}: must meet the 48px tap floor at 820px`).toBeGreaterThanOrEqual(48);
    }
  });

  // #EKB6XR. Two elements answered to "Close": the header button and a
  // full-viewport backdrop button that also spans behind the panel.
  test("the calculator sheet has exactly one named close, and the backdrop still closes it", async ({ page }) => {
    await mockDemoDashboard(page);
    await page.goto("/calculators/search?q=phq", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: /^Open PHQ-9/ })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /close/i })).toHaveCount(1);

    await page.getByTestId("calculator-sheet-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(dialog).toHaveCount(0);
  });

  // #6GR6B8 (c). "transport" is indexed six ways in the register, so a blank
  // list was the page failing to say the search had not run.
  test("a forms search whose registry fails says so instead of showing nothing", async ({ page }) => {
    await mockDemoDashboard(page);
    await page.route(/\/api\/registry\/records\?/, async (route) => {
      await route.fulfill({ status: 500, json: { error: "registry unavailable" } });
    });
    await page.goto("/forms/search?q=transport&run=1", { waitUntil: "domcontentloaded" });

    // Two nodes carry this copy and both are meant to: the visible paragraph,
    // and the sr-only live region the empty state populates after mount so the
    // degraded state is announced rather than heard as a silent zero. Playwright
    // matches text by substring, so the bare string resolved to both and failed
    // strict mode. Name each one instead of loosening the assertion.
    await expect(page.getByText("Search could not complete", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Search could not complete\. Part of the search index did not respond/)).toHaveCount(
      1,
    );
    await expect(page.getByText(/^No matches for/)).toHaveCount(0);
  });

  // #3CJPX5. The shared home writes document.title imperatively and never gave
  // it back, so the last mode selected on `/` stayed in the tab afterwards.
  test("leaving the shared home hands the page title back to the next route", async ({ page }) => {
    await mockDemoDashboard(page);
    await page.goto("/?mode=calculators", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Clinical Calculators | PsychSift");

    // A CLIENT navigation is the whole test. A fresh load would read the new
    // route's server metadata and pass however the imperative write behaved.
    await page.getByRole("link", { name: "Show all calculators" }).first().click();
    await expect(page).toHaveURL(/\/calculators\/search/);
    await expect(page).toHaveTitle("Search clinical calculators | PsychSift");
  });
});
