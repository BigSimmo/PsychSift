import { expect, test } from "playwright/test";
import { clickWhenHydrated, expectHydrated } from "./playwright-settlement";

test.describe("Invited handbook phone experience", () => {
  for (const width of [320, 390, 430, 1280]) {
    test(`readable service, handbook and orientation at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: width === 390 ? "dark" : "light", reducedMotion: "reduce" });
      await page.goto("/on-call/service");
      const workspace = page.getByTestId("service-page").filter({ visible: true });
      await expect(workspace).toHaveCount(1);
      await expect(workspace).toBeVisible();
      await expect(workspace.getByTestId("service-context-banner")).toContainText("Synthetic");
      await expect(workspace.getByTestId("service-handbook")).toBeVisible();
      await expect(workspace.getByRole("link", { name: /Chief Psychiatrist.*forms/ })).toBeVisible();
      expect(await workspace.evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
      const shortTargets = await workspace
        .locator("button, select, input:not([type=checkbox]), a")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && rect.height < 47.5;
            })
            .map((node) => node.textContent?.trim() || node.getAttribute("aria-label")),
        );
      expect(shortTargets).toEqual([]);
      await workspace.getByRole("button", { name: "Orientation", exact: true }).click();
      await expect(workspace.getByTestId("service-orientation")).toBeVisible();
      await expect(workspace.getByRole("heading", { name: "Before leaving", exact: true })).toBeVisible();
      expect(await workspace.evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("editors import a spreadsheet as drafts and see what needs checking", async ({ page }) => {
    // Demo mode signs the reader in as the synthetic service's admin, an editor.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/on-call/service");
    const workspace = page.getByTestId("service-page").filter({ visible: true });
    const tabs = workspace.getByRole("navigation", { name: "Service handbook sections" });
    for (const name of ["Import", "Needs checking"]) {
      const tab = tabs.getByRole("button", { name, exact: true });
      await expect(tab).toBeVisible();
      // WebKit can replace the streamed tab between visibility and geometry
      // reads. Keep the tap-height requirement while waiting for the live tab.
      await expect.poll(async () => (await tab.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(47.5);
    }
    await clickWhenHydrated(tabs.getByRole("button", { name: "Import", exact: true }));
    await workspace.getByLabel("Choose a CSV file").setInputFiles({
      name: "synthetic-numbers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Team,Role,Phone\nMedicine,Synthetic registrar,5550 0042\nICU,Synthetic registrar,4456\n"),
    });
    const preview = workspace.getByTestId("service-import-preview");
    await expect(preview.getByRole("table")).toBeVisible();
    await expect(preview.getByText("Medicine: Synthetic registrar")).toBeVisible();
    // Demo mode previews but saves nothing; the drafts-only rule is stated above the file input.
    await expect(
      workspace.getByText("Rows are saved as drafts. Nobody sees them until you publish below."),
    ).toBeVisible();
    await expect(preview.getByRole("button", { name: "Demo mode saves nothing" })).toBeDisabled();
    expect(await workspace.evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
    await clickWhenHydrated(tabs.getByRole("button", { name: "Needs checking", exact: true }));
    await expect(workspace.getByRole("heading", { name: "What needs checking" })).toBeVisible();
    await expect(workspace.getByRole("link", { name: "Check these" })).toHaveAttribute("href", "/on-call/check");
  });

  test("finds the exact local extension and never offers a public dial action", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/on-call/service");
    const handbookSearch = page.getByRole("searchbox", { name: "Search service handbook" });
    await expectHydrated(handbookSearch);
    await handbookSearch.fill("coordination extension");
    await clickWhenHydrated(page.getByRole("button", { name: "Open first result" }));
    const entry = page.getByTestId("service-entry-61000000-0000-4000-8000-000000000001");
    await expect(entry).toBeFocused();
    await expect(entry.getByRole("button", { name: /Copy extension/ })).toBeVisible();
    await expect(entry.locator('a[href^="tel:"]')).toHaveCount(0);
  });

  test("copies only a blank structure and opens explicit learning capture", async ({ page }) => {
    // Clipboard permissions are Chromium-only names: Firefox rejects "clipboard-read" and WebKit
    // "clipboard-write", so granting them failed this test before it started on every non-Chromium
    // project. The question here is what the page writes, so capture it with the same in-page
    // clipboard the answer Copy journeys in ui-smoke.spec.ts use.
    await page.addInitScript(() => {
      let clipboardText = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          readText: async () => clipboardText,
          writeText: async (value: string) => {
            clipboardText = value;
          },
        },
      });
    });
    await page.goto("/on-call/service");
    const telephone = page
      .locator("div")
      .filter({ has: page.getByText("Telephone advice structure", { exact: true }) })
      .last();
    await telephone.getByRole("button", { name: "Copy blank structure" }).click();
    // The copy runs after the click resolves, so poll rather than read once.
    await expect
      .poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"))
      .toContain("Reason for call\nInformation provided");
    const resources = page.getByTestId("handbook-resources");
    await resources.getByRole("link", { name: "Log this learning", exact: true }).first().click();
    await expect(page).toHaveURL(/\/cme\/new\?title=/);
    await expect(page.getByRole("button", { name: /^Save/ })).toBeDisabled();
  });
});

test("reviewable cover and ladder details fit the phone handbook", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/on-call/service");
  const handbook = page.getByTestId("service-handbook").filter({ visible: true });
  const cover = handbook.getByTestId("service-entry-61000000-0000-4000-8000-000000000019");
  await expect(cover.getByTestId("service-structured-preview")).toContainText("00:00–23:59 (Perth)");
  await expect(cover.getByTestId("service-structured-preview")).toContainText("Staff: Dr Alex Example");
  await expect(cover.getByRole("button", { name: "Still correct" })).toBeVisible();
  const ladder = handbook.getByTestId("service-entry-61000000-0000-4000-8000-000000000020");
  await expect(ladder.getByTestId("service-structured-preview")).toContainText("Hospital-set wait: 10 min");
  expect(await handbook.evaluate((el) => el.scrollWidth <= window.innerWidth)).toBe(true);
});
