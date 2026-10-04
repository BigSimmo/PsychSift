import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "playwright/test";

/**
 * Pixel baselines for the surfaces whose appearance is the product.
 *
 * This is the gate `tests/ui-visual-artifacts.spec.ts` was never able to be: that
 * spec attaches four screenshots for a human to eyeball, so nothing fails when a
 * surface silently changes. Here each target is compared against a committed
 * baseline.
 *
 * Three deliberate constraints, each from a defect this repo has already paid for:
 *
 * 1. **Never `fullPage`.** Under CI load Next.js leaves a hidden duplicate page
 *    root in the stream (ledger #093), so a whole-page capture can contain the
 *    layout twice. Every target is clipped to a locator.
 * 2. **Demo mode only.** The Playwright runner forces `NEXT_PUBLIC_DEMO_MODE` and
 *    offline providers (`scripts/test-environment.mjs`), so content comes from the
 *    synthetic corpus and is byte-stable between runs. A live-provider run would
 *    re-baseline on every answer.
 * 3. **Motion off, carets hidden.** Both are frame-timing noise rather than
 *    appearance; the suite already runs `reducedMotion: "reduce"`.
 *
 * Baselines are platform-suffixed (see `playwright.visual.config.ts`). Adopt them
 * from the CI artifact, not from a developer laptop, or font hinting alone will
 * make every subsequent run red.
 *
 * A target with no committed baseline reports SKIPPED and writes a candidate PNG
 * for review, but only while it is declared in `AWAITING_BASELINE` below; an
 * undeclared missing baseline still fails. That split is the point — see the
 * comment on that list for why a permanently-red advisory check is worse than no
 * check at all.
 */

const documentPath =
  "/documents/11111111-1111-4111-8111-111111111111?page=1&chunk=44444444-4444-4444-8444-444444444442";

const phone = { width: 390, height: 820 } as const;
const desktop = { width: 1280, height: 900 } as const;

/**
 * The ribbon (`SearchResultsHeaderBand`) is unconditionally in the DOM in every
 * state — including while `useRegistryRecords` is still waiting on its first
 * `/api/registry/records` round trip — so `settle()`'s plain visibility check
 * passes before the fetch resolves. A capture taken in that window shows a
 * spinner and no filter/sort row instead of the settled match count and
 * controls, purely from CI scheduling jitter. `data-status` on the ribbon
 * (`search-results-header-band.tsx`) already distinguishes the two transient
 * states from every settled one, so wait for those to clear rather than
 * masking or widening the target.
 */
async function waitForRibbonSettled(page: Page): Promise<void> {
  const ribbon = page.locator('[data-testid="search-query-ribbon"]:visible').first();
  await expect
    .poll(() => ribbon.getAttribute("data-status"), { timeout: 20_000 })
    .not.toMatch(/^(?:loading|refetching)$/);
}

type BaselineTarget = {
  readonly name: string;
  readonly route: string;
  /** Clipped region. Must resolve to exactly one visible element. */
  readonly selector: string;
  readonly viewport: { readonly width: number; readonly height: number };
  /** Put an interaction-dependent surface into one explicit state before capture. */
  readonly prepare?: (page: Page) => Promise<void>;
  /**
   * Regions to paint over before comparing. Only for genuinely non-deterministic
   * content — a mask is a hole in the gate, so prefer making the fixture stable.
   */
  readonly mask?: readonly string[];
};

const targets: readonly BaselineTarget[] = [
  // Product surfaces only. Future AnswerCard baselines (DS-P2-23 / FIX-GUIDE residual)
  // must include both frame="bare" (live answer-result-surface) and frame="raised"
  // (default / design-sync preview). Do not add those targets, PNGs, or
  // AWAITING_BASELINE ids here — there is no approval path without fake
  // committed baselines.
  {
    name: "dashboard-shell",
    route: "/",
    selector: "#main-content",
    viewport: desktop,
  },
  {
    name: "dashboard-shell-phone",
    route: "/",
    selector: "#main-content",
    viewport: phone,
  },
  {
    name: "search-results-band",
    route: "/services?q=CMHT&run=1",
    selector: '[data-testid="search-query-ribbon"]',
    viewport: desktop,
    prepare: waitForRibbonSettled,
  },
  {
    name: "search-results-band-phone",
    route: "/services?q=CMHT&run=1",
    selector: '[data-testid="search-query-ribbon"]',
    viewport: phone,
    prepare: waitForRibbonSettled,
  },
  {
    name: "document-viewer",
    route: documentPath,
    selector: "#main-content",
    viewport: desktop,
    /**
     * The document header is viewport-pinned (`sm:sticky sm:top-0` in
     * `DocumentViewer.tsx`), and this target clips a ~2900px region against a
     * 900px viewport. Playwright stitches an oversized element capture, so the
     * header lands partway DOWN the image, overlaps whatever content sits behind
     * it at that offset, and moves whenever the content above it changes height.
     * That made an unrelated edit anywhere on the page redraw a band of the
     * golden and inflated every diff (#278).
     *
     * Masked rather than clipped away: it is real chrome that belongs in the
     * frame, and narrowing the selector would drop the rail panels this target
     * exists to watch. A mask is a hole in the gate, so it is limited to that one
     * pinned element — its own geometry is covered by the phone chrome contracts
     * in `docs/search-chrome-behaviour.md`, not by this pixel gate. The selector
     * is the document-specific `data-document-sticky-header` attribute, not
     * `.edge-glass-header`, because the universal search header also carries that
     * class and would keep the fail-loud mask guard green after a DocumentViewer
     * rename.
     *
     * `.document-viewer-composer` was masked here for the same reason until
     * document search became on-demand: the composer is now rendered only after
     * "Search document" is pressed, so the default state this target captures has
     * no composer at all. `assertMaskSelectors` fails loudly on a mask that
     * matches nothing — deliberately, so a rename cannot silently stop masking —
     * which would have turned this advisory job red on every run for a reason
     * that has nothing to do with pixels. Nothing is lost: a masked region was
     * never compared. The closed composer is now inside the golden, which is the
     * state a reader actually lands on. If a target ever needs the open composer
     * in frame, open it in that target's own `prepare` and re-declare the mask
     * there.
     */
    mask: ["[data-document-sticky-header]"],
    prepare: async (page) => {
      const sectionIndex = page.getByTestId("document-section-index");
      const sourceText = sectionIndex.getByRole("button", { name: /Page text/ });
      await expect(sourceText).toBeVisible();
      await sourceText.click();
      await expect(sourceText).toHaveAttribute("aria-current", "true");

      const pdfViewport = page.locator('[data-testid="pdf-canvas-scroll"]:visible').first();
      const renderedPage = pdfViewport.locator('canvas[aria-label$="page 1"]');
      await expect(renderedPage).toBeVisible();
      await expect(pdfViewport.getByText(/Loading PDF|Rendering page/)).toHaveCount(0);
      await expect
        .poll(() =>
          renderedPage.evaluate((node) => {
            if (!(node instanceof HTMLCanvasElement)) return false;
            const canvas = node as HTMLCanvasElement;
            return canvas.width > 0 && canvas.height > 0 && canvas.style.width !== "" && canvas.style.height !== "";
          }),
        )
        .toBe(true);
    },
  },
  {
    name: "therapy-compass-home",
    route: "/therapy-compass",
    selector: "#main-content",
    viewport: desktop,
  },
];

async function assertMaskSelectors(page: Page, target: BaselineTarget): Promise<void> {
  // A mask selector that matches nothing masks nothing, silently — the golden
  // simply keeps comparing the region the mask was meant to exclude, and the
  // declaration reads as protection that is not there. Renaming a class is
  // enough to cause it, so each declared mask must resolve to at least one
  // element before capture or comparison is trusted.
  for (const selector of target.mask ?? []) {
    await expect(
      page.locator(selector),
      `mask selector "${selector}" on target "${target.name}" matched no element`,
    ).not.toHaveCount(0);
  }
}

async function settle(page: Page, target: BaselineTarget): Promise<Locator> {
  await page.setViewportSize({ ...target.viewport });
  await page.goto(target.route, { waitUntil: "domcontentloaded" });

  // `:visible` rather than a bare `.first()`. Under ledger #093 the stream can
  // leave a hidden duplicate page root BEFORE the visible one, so `.first()` would
  // pin the assertion and the screenshot to the hidden clone — the exact artifact
  // this suite avoids by clipping instead of capturing fullPage.
  const region = page.locator(`${target.selector}:visible`).first();
  await expect(region).toBeVisible({ timeout: 20_000 });
  // Web fonts swapping in after the capture is the most common source of a
  // one-pixel-everywhere diff, so wait for them explicitly rather than sleeping.
  // The promise is mapped to undefined because it resolves to a FontFaceSet, which
  // Playwright cannot serialise back out of the page.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await target.prepare?.(page);
  await assertMaskSelectors(page, target);
  return region;
}

/**
 * Targets that knowingly have no committed baseline yet.
 *
 * Without this list "no baseline" and "the pixels moved" are the same red, and
 * because the first state persists until someone adopts baselines from a CI
 * artifact, the job would be red on every UI-touching PR indefinitely. A check
 * that is always red is a check nobody reads, so the day a real regression
 * appears it looks exactly like the eleven runs before it. That is the same
 * failure mode as ledger #095's false red, arrived at from the other direction.
 *
 * So the two states are separated. A target listed here reports SKIPPED with the
 * path to commit, and its candidate PNG is written to `test-results/` for review.
 * A target NOT listed here with no baseline still FAILS — that is a deleted or
 * mis-pathed golden, which must stay loud.
 *
 * Adopting a baseline means deleting its name from this list in the same commit
 * that adds the PNG. `declares no baseline it already has` below fails if the two
 * ever disagree, so the list cannot rot into a permanent exemption.
 */
const AWAITING_BASELINE: ReadonlySet<string> = new Set([]);

/**
 * Where a candidate PNG is written when no baseline exists.
 *
 * Deliberately NOT the snapshot directory. Writing into `__screenshots__` would
 * let a second attempt in the same job compare against a golden this very run
 * produced and report green — the self-adoption hole `retries: 0` exists to
 * close in playwright.visual.config.ts. Keeping candidates in `test-results/`
 * means the baseline directory is only ever written by a human.
 */
function candidatePath(testInfo: TestInfo, name: string): string {
  return join(testInfo.project.outputDir, "visual-candidates", process.platform, `${name}.png`);
}

test.describe("visual baselines", () => {
  test.describe.configure({ timeout: 90_000 });

  for (const target of targets) {
    test(`${target.name} matches its baseline`, async ({ page }, testInfo) => {
      const baseline = testInfo.snapshotPath(`${target.name}.png`);
      const masks = (target.mask ?? []).map((selector) => page.locator(selector));

      if (!existsSync(baseline)) {
        // Capture anyway: a skipped target with nothing to look at gives a
        // reviewer no way to adopt it, which is how "adopt from CI" stalls.
        const region = await settle(page, target);
        const candidate = candidatePath(testInfo, target.name);
        await mkdir(dirname(candidate), { recursive: true });
        await region.screenshot({
          path: candidate,
          animations: "disabled",
          caret: "hide",
          scale: "css",
          mask: masks,
        });
        await testInfo.attach(`${target.name} (candidate baseline)`, { path: candidate, contentType: "image/png" });

        // Not listed as awaiting: the golden was deleted, renamed, or the
        // platform path changed. That is a real fault and stays red.
        expect(
          AWAITING_BASELINE.has(target.name),
          `No baseline at ${baseline}, and "${target.name}" is not in AWAITING_BASELINE. ` +
            "Either the committed golden was deleted/renamed, or a new target was added without declaring it.",
        ).toBe(true);

        test.skip(
          true,
          `No baseline committed yet for "${target.name}". Download this run's artifact and copy ` +
            `visual-candidates/${process.platform}/${target.name}.png to ${baseline}, then remove ` +
            `"${target.name}" from AWAITING_BASELINE in the same commit.`,
        );
        return;
      }

      const region = await settle(page, target);

      await expect(region).toHaveScreenshot(`${target.name}.png`, {
        animations: "disabled",
        caret: "hide",
        // CSS pixels, so a runner with a different device-pixel-ratio does not
        // produce a differently-sized image against the same baseline.
        scale: "css",
        mask: masks,
      });
    });
  }

  // Keeps the declaration honest in both directions. Without these two the list
  // would silently become a permanent opt-out: a stale entry would skip a target
  // whose golden is sitting right there, and a typo would exempt nothing while
  // looking like it exempted something.
  test("declares no baseline it already has", async ({}, testInfo) => {
    const stale = [...AWAITING_BASELINE].filter((name) => existsSync(testInfo.snapshotPath(`${name}.png`)));
    expect(
      stale,
      `These targets have a committed baseline but are still listed as awaiting one: ${stale.join(", ")}. ` +
        "Remove them from AWAITING_BASELINE so the comparison actually runs.",
    ).toEqual([]);
  });

  test("declares only real targets", async () => {
    const names = new Set(targets.map((target) => target.name));
    const unknown = [...AWAITING_BASELINE].filter((name) => !names.has(name));
    expect(unknown, `AWAITING_BASELINE names no such target: ${unknown.join(", ")}`).toEqual([]);
  });
});
