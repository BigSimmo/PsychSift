import { expect, test } from "playwright/test";

import { clickWhenHydrated, visibleByTestId } from "./playwright-settlement";

/**
 * `/issues` #256, proven where it actually failed: in the browser.
 *
 * The route used to declare its sections in a table beside the page, and the
 * shell dropped every section whose target was absent from the DOM — so a set
 * could rot to nothing and the only symptom was a route silently drawing no
 * navigation, with no error and no failing test. `/forms/<slug>` now mounts the
 * shared `InPageNavHeader` and declares its own sections, but the failure mode
 * is the same one: `useResolvedPageSections` still drops what it cannot see.
 *
 * `tests/in-page-nav-route-sections.dom.test.tsx` asserts every declared anchor
 * renders. That is necessary but not sufficient: jsdom applies no Tailwind, so
 * it cannot distinguish a `-mobile` target from its `-desktop` twin. Only a real
 * browser at a real width can.
 */
/**
 * A real catalogue slug, not the `/forms/form-1` placeholder the unit tests
 * use. Those only exercise pure predicates, which match on `/forms/` and never
 * resolve a record; a browser needs a route that actually renders.
 */
const FORM_ROUTE = "/forms/transport-crisis-form";

// Adoption evidence: these browser regressions exercise DisclosureGroup.items[].extendDescription.
test.describe("Forms section navigation", () => {
  test("keeps information rows inside the mobile viewport", async ({ page }) => {
    for (const width of [320, 390, 639]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(FORM_ROUTE, { waitUntil: "domcontentloaded" });

      const section = page.getByRole("region", { name: "Form information" });
      await expect(section).toBeVisible({ timeout: 20_000 });

      const geometry = await section.locator('[data-testid="disclosure"]').evaluateAll((rows) =>
        rows.map((row) => {
          const bounds = row.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right, width: bounds.width };
        }),
      );

      expect(geometry.length).toBeGreaterThan(0);
      for (const row of geometry) {
        expect(row.left, `${width}px row must not cross the left viewport edge`).toBeGreaterThanOrEqual(0);
        expect(row.right, `${width}px row must not cross the right viewport edge`).toBeLessThanOrEqual(width + 1);
        expect(row.width, `${width}px row must retain a usable width`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The defect this pins: the trigger was a flex row carrying `px-3` and no vertical
   * padding at all, so a row whose preview wrapped grew past the 48px floor and printed
   * its copy hard against the top and bottom borders. It read as text escaping the box.
   *
   * Only a browser can see it. jsdom applies no Tailwind, so the padding it would assert
   * is always `0px`, and the wrap that triggers the overflow never happens.
   *
   * Tablet and desktop are in the list because that is where it was worst — the preview
   * only wrapped from 640px up, so every width the old spec covered was a width where
   * the bug was invisible.
   */
  test("gives every information row symmetric vertical padding at each breakpoint", async ({ page }) => {
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(FORM_ROUTE, { waitUntil: "domcontentloaded" });

      const section = page.getByRole("region", { name: "Form information" });
      await expect(section).toBeVisible({ timeout: 20_000 });

      const rows = await section.locator('[data-testid="disclosure"] button').evaluateAll((triggers) =>
        triggers.map((trigger) => {
          const style = getComputedStyle(trigger);
          const preview = trigger.querySelector("span.line-clamp-2");
          return {
            label: trigger.textContent?.slice(0, 24) ?? "",
            height: trigger.getBoundingClientRect().height,
            paddingTop: Number.parseFloat(style.paddingTop),
            paddingBottom: Number.parseFloat(style.paddingBottom),
            previewOverflows: preview ? preview.scrollWidth > preview.clientWidth + 1 : false,
          };
        }),
      );

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.paddingTop, `${width}px "${row.label}" needs real top padding`).toBeGreaterThan(0);
        expect(row.paddingBottom, `${width}px "${row.label}" must pad symmetrically`).toBeCloseTo(row.paddingTop, 1);
        // The tap floor, which the padding must never quietly undercut.
        expect(row.height, `${width}px "${row.label}" must hold the 48px tap floor`).toBeGreaterThanOrEqual(47.5);
        // Clamped copy is ellipsised inside its box; it never spills sideways.
        expect(row.previewOverflows, `${width}px "${row.label}" preview must stay inside its box`).toBe(false);
      }
    }
  });

  /**
   * Two defects in one measurement, both of which made an `extendDescription` row look
   * broken the instant a reader opened it:
   *
   * - The preview was `text-xs` while the panel body was `text-sm leading-6`, so the SAME
   *   sentence changed size on expand.
   * - The panel carried its own `px-3` while the label sat behind a chevron and an icon
   *   tile, so the copy also jumped left.
   *
   * Both are computed-style facts, so both need a real browser. The row is expanded and
   * re-collapsed against one element pair rather than asserted on class strings, because
   * the class strings are what drifted in the first place.
   */
  test("keeps the expanded body on the label's left edge and in the preview's type", async ({ page }) => {
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(FORM_ROUTE, { waitUntil: "domcontentloaded" });

      const section = page.getByRole("region", { name: "Form information" });
      const trigger = section.getByRole("button", { name: "Does not authorise" });
      await expect(trigger).toBeVisible({ timeout: 20_000 });

      const label = trigger.locator("span.min-w-0 > span").first();
      const preview = trigger.locator("span.line-clamp-2");
      const collapsed = await preview.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          left: node.getBoundingClientRect().left,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
        };
      });
      const labelLeft = await label.evaluate((node) => node.getBoundingClientRect().left);

      const panelId = await trigger.getAttribute("aria-controls");
      if (!panelId) throw new Error("Disclosure trigger is missing aria-controls");
      // A click that lands before hydration is dropped (Firefox, release matrix 2026-09-25),
      // leaving the panel display:none and measured at left 0. Re-click only while collapsed.
      await expect(async () => {
        if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
        await expect(trigger).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      const body = page.locator(`[id="${panelId}"] p`);
      await expect(body).toBeVisible();

      const expanded = await body.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          left: node.getBoundingClientRect().left,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
        };
      });

      expect(expanded.left, `${width}px body must start on the label's left edge`).toBeCloseTo(labelLeft, 0);
      expect(expanded.left, `${width}px body must not move sideways on expand`).toBeCloseTo(collapsed.left, 0);
      expect(expanded.fontSize, `${width}px body must not re-size the preview's sentence`).toBe(collapsed.fontSize);
      expect(expanded.lineHeight, `${width}px body must keep the preview's leading`).toBe(collapsed.lineHeight);
    }
  });

  test("expands information previews into one continuous answer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(FORM_ROUTE, { waitUntil: "domcontentloaded" });

    const section = page.getByRole("region", { name: "Form information" });
    const trigger = section.getByRole("button", { name: "Does not authorise" });
    const preview = "Psychiatric treatment or detention beyond the linked authority.";

    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toHaveAttribute("data-state", "collapsed");
    await expect(trigger.getByText(preview)).toBeVisible();
    await clickWhenHydrated(trigger);

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toHaveAttribute("data-state", "expanded");
    const panelId = await trigger.getAttribute("aria-controls");
    if (!panelId) throw new Error("Disclosure trigger is missing aria-controls");
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel).toHaveAttribute("data-state", "expanded");
    await expect(section.locator('[data-testid="disclosure"][data-state="expanded"]')).toBeVisible();
    await expect(trigger.getByText(preview)).toHaveCount(0);
    await expect(panel.getByText(preview)).toBeVisible();
    await expect(panel).not.toHaveClass(/border-t/);
  });

  test("prints extended information once while collapsed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(FORM_ROUTE, { waitUntil: "domcontentloaded" });

    const section = page.getByRole("region", { name: "Form information" });
    const trigger = section.getByRole("button", { name: "Does not authorise" });
    const preview = "Psychiatric treatment or detention beyond the linked authority.";

    await expect(trigger).toBeVisible({ timeout: 20_000 });
    const panelId = await trigger.getAttribute("aria-controls");
    if (!panelId) throw new Error("Disclosure trigger is missing aria-controls");

    const panel = page.locator(`[id="${panelId}"]`);
    const disclosure = panel.locator("xpath=..");
    const triggerPreview = disclosure.locator('button span[aria-hidden="true"]').filter({ hasText: preview });

    await expect(triggerPreview).toHaveCount(1);
    await expect(triggerPreview).toBeVisible();
    await expect(panel).toBeHidden();

    await page.emulateMedia({ media: "print" });

    await expect(triggerPreview).toBeHidden();
    await expect(panel.getByText(preview, { exact: true })).toBeVisible();
    await expect
      .poll(
        () =>
          disclosure.getByText(preview, { exact: true }).evaluateAll(
            (elements) =>
              elements.filter((element) => {
                const style = getComputedStyle(element);
                return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
              }).length,
          ),
        { message: "extended description should print exactly once" },
      )
      .toBe(1);
  });

  test("opens a section sheet listing the anchors the form record actually paints", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(FORM_ROUTE, { waitUntil: "domcontentloaded" });

    const trigger = page.getByTestId("form-section-trigger");
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await trigger.click();

    const sheet = page.getByTestId("form-section-sheet");
    await expect(sheet).toBeVisible();
    // Every declared section resolves. Before the header existed this route drew
    // no in-page navigation at all.
    await expect(sheet.getByRole("button", { name: "Overview" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Legal boundary" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Decision context" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Source / verification" })).toBeVisible();
  });

  test("moves the reader to a section and records the stable fragment", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(FORM_ROUTE, { waitUntil: "domcontentloaded" });

    await page.getByTestId("form-section-trigger").click();
    await page.getByTestId("form-section-sheet").getByRole("button", { name: "Source / verification" }).click();

    // The breakpoint-independent fragment, not whichever copy is displayed, so
    // a link copied on a phone still resolves on a desktop.
    await expect(page).toHaveURL(/#form-source-verification$/);
    await expect(page.getByTestId("form-section-sheet")).toBeHidden();
  });

  test("resolves each breakpoint variant to the side that is actually visible", async ({ page }) => {
    // The -mobile/-desktop pairs are the part a source scan cannot check.
    // `useResolvedPageSections` takes the FIRST VISIBLE target, and
    // `lg:hidden` / `hidden lg:block` make exactly one side display:none per
    // width. If both resolved, or neither, the section would silently drop.
    for (const [label, width] of [
      ["phone", 390],
      ["desktop", 1280],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(FORM_ROUTE, { waitUntil: "domcontentloaded" });
      // Ledger #093: under Production UI load Next can leave a hidden twin of the
      // in-page header (in-flow under the reserve pad + portaled phone copy, or a
      // streaming clone). Bare getByTestId then fails Playwright strict mode even
      // when only one owner is visible — the same defect that already gates
      // ui-route-coverage through visibleByTestId.
      await expect(visibleByTestId(page, "form-detail-header")).toBeVisible({ timeout: 20_000 });

      const visible = await page.evaluate(() =>
        [
          "form-decision-context-mobile",
          "form-decision-context-desktop",
          "form-source-verification-mobile",
          "form-source-verification-desktop",
        ].filter((id) => {
          const el = document.getElementById(id);
          return Boolean(el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none");
        }),
      );

      // Exactly one of each pair, never both and never neither.
      expect(
        visible.filter((id) => id.startsWith("form-decision-context")),
        `${label} decision context`,
      ).toHaveLength(1);
      expect(
        visible.filter((id) => id.startsWith("form-source-verification")),
        `${label} source/verification`,
      ).toHaveLength(1);
    }
  });
});
