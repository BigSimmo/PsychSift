import { expect, test, type Page } from "playwright/test";

const readySetupChecks = [
  { id: "env", label: ".env.local configured", status: "ready", detail: "Test environment ready." },
  { id: "project", label: "PsychSift Production target", status: "ready", detail: "Test Supabase project ready." },
  { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Test schema ready." },
  { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Test search schema ready." },
  { id: "openai", label: "OpenAI API key available", status: "ready", detail: "Test OpenAI ready." },
  { id: "worker", label: "npm run worker running", status: "unknown", detail: "Worker not required for UI smoke." },
];

async function mockDemoDashboard(page: Page) {
  await page.route("**/api/setup-status**", async (route) => {
    await route.fulfill({ json: { demoMode: true, checks: readySetupChecks } });
  });
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

test("submitted root search keeps its query and hides the phone suggestion ticker @critical", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await mockDemoDashboard(page);
  await page.goto("/?mode=answer&q=lithium&run=1", { waitUntil: "domcontentloaded" });

  await expect(async () => {
    const header = page.locator("header#search");
    await expect(header).toHaveCount(1);
    await expect(header).toBeVisible();
  }).toPass({ timeout: 30_000 });

  // Once the answer lands the composer becomes an empty follow-up draft box and the
  // submitted query moves into the thread as its question bubble (ClinicalDashboard
  // clears it on completion). Reading the composer's value raced that completion: it
  // passed only while the answer was still pending, so wait for the settled thread.
  await expect(page.getByTestId("plain-answer-response")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("user-question-bubble")).toHaveCount(1);
  await expect(page.getByTestId("user-question-bubble")).toContainText("lithium");
  const composer = page.locator('[data-testid="global-search-input"]:visible');
  await expect(composer).toHaveCount(1);
  await expect(composer).toHaveValue("");
  await expect(composer).toHaveAttribute("placeholder", "Ask a follow-up…");
  await expect(page.getByTestId("smart-search-phone-ticker")).toBeHidden();
});
