import { expect, test, type Locator, type Page } from "playwright/test";
import { demoAnswer, demoDocuments } from "../src/lib/demo-data";
import { toClientAnswerPayload } from "../src/lib/answer-client-payload";
import { normalizeSourceMetadata } from "../src/lib/source-metadata";
import type { SearchResult } from "../src/lib/types";

const readySetupChecks = [
  { id: "env", label: ".env.local configured", status: "ready", detail: "Test environment ready." },
  { id: "project", label: "PsychSift Production target", status: "ready", detail: "Test project ready." },
  { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Test schema ready." },
  { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Test search ready." },
  { id: "openai", label: "Answer provider", status: "ready", detail: "Mock stream ready." },
];

async function waitForReactEventHandler(locator: Locator, eventName: "onChange" | "onSubmit") {
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

async function fillHydratedAnswerQuestion(page: Page, value: string) {
  const input = page.locator('[aria-label^="Search indexed guidelines by question or keyword"]:visible');
  const submit = page.locator('[aria-label="Generate source-backed answer"]:visible');

  await expect(async () => {
    await expect(input).toHaveCount(1, { timeout: 30_000 });
    await expect(submit).toHaveCount(1, { timeout: 30_000 });
    const form = input.locator("xpath=ancestor::form[1]");
    await waitForReactEventHandler(input, "onChange");
    await waitForReactEventHandler(form, "onSubmit");
    await input.fill(value);
    await expect(input).toHaveValue(value);
    await expect(submit).toBeEnabled();
  }).toPass({ timeout: 30_000 });

  return submit;
}

async function dismissBlockingPwaNotice(page: Page) {
  const dismiss = page.getByRole("button", { name: /Dismiss (?:offline notice|update notice|install)/ }).first();
  const noticeAppeared = await dismiss
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (noticeAppeared) await dismiss.click();
}

async function mockDashboardApis(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.fallback();
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
      await route.fulfill({ json: { demoMode: true, checks: readySetupChecks } });
      return;
    }
    if (url.pathname === "/api/documents") {
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
    if (url.pathname === "/api/ingestion/jobs") {
      await route.fulfill({ json: { jobs: [], demoMode: true } });
      return;
    }
    if (url.pathname === "/api/ingestion/batches") {
      await route.fulfill({ json: { batches: [], demoMode: true } });
      return;
    }
    if (url.pathname === "/api/ingestion/quality") {
      await route.fulfill({ json: { items: [], demoMode: true } });
      return;
    }
    await route.fulfill({ json: { demoMode: true } });
  });
}

async function installTimedAnswerStream(page: Page) {
  const finalAnswer = { ...toClientAnswerPayload(demoAnswer("Lithium dosing")), demoMode: true };
  await page.addInitScript(
    ({ answer }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        const pathname = new URL(rawUrl, window.location.href).pathname;
        if (pathname !== "/api/answer/stream") return originalFetch(input, init);

        const encoder = new TextEncoder();
        const events: Array<{ delay: number; event: string; data: unknown }> = [
          { delay: 0, event: "progress", data: { stage: "scoping", message: "Preparing scope." } },
          { delay: 250, event: "progress", data: { stage: "retrieving", message: "Searching documents." } },
          {
            delay: 600,
            event: "progress",
            data: { stage: "retrieved", message: "Retrieved candidates.", resultCount: 12 },
          },
          {
            delay: 900,
            event: "progress",
            data: {
              stage: "ranking",
              message: "private-model-marker private-route-marker",
              selectedContextCount: 4,
              australianSourceCount: 4,
              waSourceCount: 4,
              usedSupplementaryFallback: true,
            },
          },
          { delay: 1_600, event: "progress", data: { stage: "generating", message: "private-draft-marker" } },
          { delay: 2_000, event: "token", data: { delta: "Provisional lithium draft" } },
          // Keep the provisional state observable for more than one browser
          // assertion polling interval. Firefox/WebKit can spend long enough
          // painting the progress stepper to miss a sub-second token window.
          { delay: 3_400, event: "revising", data: { reason: "private-provider-reason-marker" } },
          { delay: 3_450, event: "progress", data: { stage: "fallback", message: "private-fallback-marker" } },
          { delay: 4_000, event: "progress", data: { stage: "verifying", message: "private-check-marker" } },
          {
            delay: 4_600,
            event: "progress",
            data: { stage: "complete", message: "private-ready-marker", elapsedMs: 3_700 },
          },
          { delay: 4_800, event: "final", data: answer },
        ];

        return new Response(
          new ReadableStream({
            start(controller) {
              for (const item of events) {
                window.setTimeout(() => {
                  controller.enqueue(encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`));
                  if (item.event === "final") controller.close();
                }, item.delay);
              }
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
        );
      };
    },
    { answer: finalAnswer },
  );
}

async function installHoldingAnswerStream(page: Page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const pathname = new URL(rawUrl, window.location.href).pathname;
      if (pathname !== "/api/answer/stream") return originalFetch(input, init);

      const encoder = new TextEncoder();
      const events = [
        { delay: 0, stage: "scoping", message: "Preparing scope." },
        { delay: 25, stage: "retrieving", message: "Searching documents." },
        { delay: 50, stage: "ranking", message: "Selecting evidence." },
        { delay: 75, stage: "generating", message: "Drafting answer." },
      ];

      return new Response(
        new ReadableStream({
          start(controller) {
            const timers = events.map((event) =>
              window.setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    `event: progress\ndata: ${JSON.stringify({ stage: event.stage, message: event.message })}\n\n`,
                  ),
                );
              }, event.delay),
            );
            init?.signal?.addEventListener(
              "abort",
              () => {
                for (const timer of timers) window.clearTimeout(timer);
                controller.error(new DOMException("The operation was aborted.", "AbortError"));
              },
              { once: true },
            );
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
      );
    };
  });
}

/**
 * The wait, with the evidence preview on it (#100 Phase 1).
 *
 * The preview rides the existing `progress` event as an optional `verifiedUnit`, and the
 * client discards anything that fails `isDeliverableVerifiedUnit` — exact key allow-list,
 * `images: []`, snippet under 900 characters — so these fixtures are built to that contract
 * rather than to a convenient shape. Eight sources are sent to prove the rail's six-card cap
 * and the line that counts it.
 */
function previewSource(index: number): SearchResult {
  return {
    id: `chunk-${index + 1}`,
    document_id: `doc-${index + 1}`,
    title: `Synthetic monitoring guideline ${index + 1}`,
    file_name: `guideline-${index + 1}.pdf`,
    page_number: index + 2,
    chunk_index: index,
    section_heading: "Monitoring",
    content: "Review the source passage and confirm the monitoring schedule before clinical use.",
    image_ids: [],
    similarity: 0.8 - index * 0.01,
    images: [],
    source_metadata: normalizeSourceMetadata({
      document_status: "current",
      clinical_validation_status: "unverified",
    }),
  };
}

async function installEvidencePreviewAnswerStream(page: Page) {
  const serverAnswer = demoAnswer("Lithium dosing");
  const sources = Array.from({ length: 8 }, (_, index) => previewSource(index));
  const finalAnswer = {
    ...toClientAnswerPayload({ ...serverAnswer, sources: [...sources, ...serverAnswer.sources] }),
    demoMode: true,
  };
  const previewSources = finalAnswer.sources.slice(0, 8);
  await page.addInitScript(
    ({ answer, previewSources }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        const pathname = new URL(rawUrl, window.location.href).pathname;
        if (pathname !== "/api/answer/stream") return originalFetch(input, init);

        const encoder = new TextEncoder();
        const events: Array<{ delay: number; event: string; data: unknown }> = [
          { delay: 0, event: "progress", data: { stage: "scoping", message: "Preparing scope." } },
          { delay: 150, event: "progress", data: { stage: "retrieving", message: "Searching documents." } },
          {
            delay: 400,
            event: "progress",
            data: {
              stage: "ranking",
              message: "Selecting evidence.",
              selectedContextCount: 8,
              verifiedUnit: {
                schemaVersion: 1,
                kind: "evidence_preview",
                sequence: 0,
                selectedContextCount: 8,
                sources: previewSources,
              },
            },
          },
          { delay: 700, event: "progress", data: { stage: "generating", message: "Drafting answer." } },
          // Held wide open: the whole point of the preview is that it is readable for the
          // seconds generation takes, so the assertions below must run inside that window.
          { delay: 4_000, event: "progress", data: { stage: "complete", message: "Ready.", elapsedMs: 4_000 } },
          { delay: 4_100, event: "final", data: answer },
        ];

        return new Response(
          new ReadableStream({
            start(controller) {
              for (const item of events) {
                window.setTimeout(() => {
                  controller.enqueue(encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`));
                  if (item.event === "final") controller.close();
                }, item.delay);
              }
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
        );
      };
    },
    { answer: finalAnswer, previewSources },
  );
}

async function installSuccessfulThenInvalidAnswerStreams(page: Page) {
  const firstAnswer = { ...toClientAnswerPayload(demoAnswer("Lithium dosing")), demoMode: true };
  await page.addInitScript(
    ({ answer }) => {
      const originalFetch = window.fetch.bind(window);
      let answerRequestCount = 0;
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        const pathname = new URL(rawUrl, window.location.href).pathname;
        if (pathname !== "/api/answer/stream") return originalFetch(input, init);

        answerRequestCount += 1;
        const encoder = new TextEncoder();
        const events =
          answerRequestCount === 1
            ? [
                { delay: 0, event: "progress", data: { stage: "scoping", message: "Preparing scope." } },
                {
                  delay: 40,
                  event: "progress",
                  data: { stage: "complete", message: "Answer ready.", elapsedMs: 40 },
                },
                { delay: 80, event: "final", data: answer },
              ]
            : [
                { delay: 0, event: "progress", data: { stage: "retrieving", message: "Searching." } },
                {
                  delay: 40,
                  event: "progress",
                  data: { stage: "complete", message: "Answer ready.", elapsedMs: 40 },
                },
                { delay: 80, event: "final", data: { answer: 42 } },
              ];

        return new Response(
          new ReadableStream({
            start(controller) {
              for (const item of events) {
                window.setTimeout(() => {
                  controller.enqueue(encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`));
                  if (item.event === "final") controller.close();
                }, item.delay);
              }
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
        );
      };
    },
    { answer: firstAnswer },
  );
}

async function installSuccessfulThenHoldingAnswerStreams(page: Page) {
  const firstAnswer = { ...toClientAnswerPayload(demoAnswer("Lithium dosing")), demoMode: true };
  await page.addInitScript(
    ({ answer }) => {
      const originalFetch = window.fetch.bind(window);
      let answerRequestCount = 0;
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        const pathname = new URL(rawUrl, window.location.href).pathname;
        if (pathname !== "/api/answer/stream") return originalFetch(input, init);

        answerRequestCount += 1;
        const encoder = new TextEncoder();
        if (answerRequestCount === 1) {
          const events = [
            { delay: 0, event: "progress", data: { stage: "scoping", message: "Preparing scope." } },
            {
              delay: 40,
              event: "progress",
              data: { stage: "complete", message: "Answer ready.", elapsedMs: 40 },
            },
            { delay: 80, event: "final", data: answer },
          ];

          return new Response(
            new ReadableStream({
              start(controller) {
                for (const item of events) {
                  window.setTimeout(() => {
                    controller.enqueue(encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`));
                    if (item.event === "final") controller.close();
                  }, item.delay);
                }
              },
            }),
            { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
          );
        }

        const events = [
          { delay: 0, stage: "scoping", message: "Preparing follow-up scope." },
          { delay: 25, stage: "retrieving", message: "Searching follow-up sources." },
          { delay: 50, stage: "ranking", message: "Selecting follow-up evidence." },
          { delay: 75, stage: "generating", message: "Drafting follow-up answer." },
        ];

        return new Response(
          new ReadableStream({
            start(controller) {
              const timers = events.map((event) =>
                window.setTimeout(() => {
                  controller.enqueue(
                    encoder.encode(
                      `event: progress\ndata: ${JSON.stringify({ stage: event.stage, message: event.message })}\n\n`,
                    ),
                  );
                }, event.delay),
              );
              init?.signal?.addEventListener(
                "abort",
                () => {
                  for (const timer of timers) window.clearTimeout(timer);
                  controller.error(new DOMException("The operation was aborted.", "AbortError"));
                },
                { once: true },
              );
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
        );
      };
    },
    { answer: firstAnswer },
  );
}

test("answer progress remains user-safe through fallback and discloses the unusual route", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 820 });
  await mockDashboardApis(page);
  await installTimedAnswerStream(page);
  await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });

  const submit = await fillHydratedAnswerQuestion(page, "Lithium dosing");
  await submit.click();

  const progress = page.getByTestId("answer-progress");
  const line = progress.getByTestId("answer-progress-line");
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("aria-busy", "true");
  // The line is the live region, because it is the element that persists while
  // its text is replaced.
  await expect(line).toHaveAttribute("aria-live", "polite");
  await expect(progress.locator('[data-slot="answer-progress-dot"]')).toBeVisible();

  // The retired panel narrated five orchestrator stages the reader is not
  // operating. None of that vocabulary may come back.
  for (const retired of [
    "Prepare scope",
    "Search sources",
    "Select evidence",
    "Draft answer",
    "Check answer",
    "Processing details",
  ]) {
    await expect(progress.getByText(retired, { exact: true })).toHaveCount(0);
  }
  await expect(progress.getByLabel("Answer generation stages")).toHaveCount(0);

  const stop = progress.getByRole("button", { name: "Stop generating answer" });
  await expect(stop).toBeVisible();
  expect((await stop.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

  // No number the reader cannot reconcile with the screen. The stream offers
  // resultCount 12 and australianSourceCount 4 at these stages; neither reaches
  // the line. See tests/answer-progress.test.ts for the rule.
  await expect(line).toContainText("Prioritising Australian sources", { timeout: 3_000 });
  await expect(line).not.toContainText(/\d/);
  await expect(line).toContainText("Writing the answer", { timeout: 4_000 });

  // The wait is where the reader learns the model was not used, rather than
  // meeting a source-only answer that then has to defend itself.
  await expect(line).toContainText("Assembling the answer from the sources directly", { timeout: 5_000 });

  // Rolling deployments may still route a new client to an older server that
  // emits provisional token/revising frames. The client must ignore both so
  // unvalidated clinical prose never reaches the page before the final event.
  await expect(page.getByTestId("answer-streaming")).toHaveCount(0);
  await expect(page.getByTestId("answer-streaming-revising")).toHaveCount(0);
  await expect(page.getByText("Provisional lithium draft")).toHaveCount(0);

  await expect(progress).toHaveAttribute("data-progress-state", "complete", { timeout: 6_000 });
  await expect(page.getByTestId("stop-answer")).toHaveCount(0);
  // No visible completion chrome. The answer surface prints its own governed
  // provenance line above the prose, so a second "Answer ready in 3s" underneath
  // it was a competing completion statement and the last of the elapsed counter.
  await expect(line).toHaveCount(0);
  await expect(page.getByText(/Answer ready in/)).toHaveCount(0);
  await expect(progress.getByRole("status")).toContainText("Answer ready.");

  // This run went through `fallback`, so the build disclosure is offered. On an
  // ordinary run it is not — pinned in the follow-up test below.
  const disclosure = progress.getByText("How this answer was built", { exact: true });
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(progress).toContainText("Assembling the answer from the sources directly");

  await expect(page.getByText(/In the synthetic lithium document/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("body")).not.toContainText(
    /private-(?:model|route|provider-reason|fallback|draft|check|ready)-marker/i,
  );
});

test("follow-up answer generation stays one line above the previous answer", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 820 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockDashboardApis(page);
  await installSuccessfulThenHoldingAnswerStreams(page);
  await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });
  await dismissBlockingPwaNotice(page);

  const submit = await fillHydratedAnswerQuestion(page, "Lithium dosing");
  await submit.click();

  const previousAnswer = page.getByText(/In the synthetic lithium document/i);
  await expect(previousAnswer).toBeVisible({ timeout: 8_000 });

  const progress = page.getByTestId("answer-progress");
  // The first answer took the ordinary route, so nothing is disclosed about it.
  await expect(progress.getByText("How this answer was built", { exact: true })).toHaveCount(0);

  const followUpSubmit = await fillHydratedAnswerQuestion(page, "What monitoring is needed?");
  await followUpSubmit.click();

  await expect(progress.getByTestId("answer-progress-line")).toContainText("Writing the answer");
  await expect(previousAnswer).toBeVisible();
  await expect(progress.getByLabel("Answer generation stages")).toHaveCount(0);

  const dot = progress.locator('[data-slot="answer-progress-dot"]');
  expect(
    await dot.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        name: style.animationName,
        duration: style.animationDuration,
        iterationCount: style.animationIterationCount,
      };
    }),
  ).toEqual({ name: "answer-progress-breath", duration: "2.4s", iterationCount: "infinite" });

  const stop = progress.getByRole("button", { name: "Stop generating answer" });
  expect((await stop.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);

  // The wait must not introduce a horizontal scrollbar at any supported width,
  // and it must stay inside its own column. On 2026-10-04 the owner asked for the
  // wait to stop looking blank, so it now carries the question, the five steps,
  // an answer placeholder and the sources row. Keep it bounded so it never pushes
  // the previous answer more than one phone screen down.
  for (const width of [320, 390, 639, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    const geometry = await progress.evaluate((section) => {
      const sectionRect = section.getBoundingClientRect();
      const lineRect = section
        .querySelector<HTMLElement>('[data-testid="answer-progress-line"]')
        ?.getBoundingClientRect();
      return {
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        sectionLeft: sectionRect.left,
        sectionRight: sectionRect.right,
        sectionHeight: sectionRect.height,
        lineLeft: lineRect?.left ?? 0,
        lineRight: lineRect?.right ?? 0,
      };
    });
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.bodyClientWidth + 1);
    expect(geometry.lineLeft).toBeGreaterThanOrEqual(geometry.sectionLeft - 1);
    expect(geometry.lineRight).toBeLessThanOrEqual(geometry.sectionRight + 1);
    expect(geometry.sectionHeight).toBeLessThanOrEqual(560);
  }

  await stop.press("Enter");
  await expect(page.getByTestId("answer-cancelled")).toBeVisible();
  await expect(previousAnswer).toBeVisible();
});

test("the wait stands where the answer will, so arrival swaps content in place", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboardApis(page);
  await installHoldingAnswerStream(page);
  await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });
  await dismissBlockingPwaNotice(page);

  const submit = await fillHydratedAnswerQuestion(page, "Lithium dosing");
  await submit.click();

  const progress = page.getByTestId("answer-progress");
  await expect(progress.getByTestId("answer-progress-line")).toBeVisible();

  // Status line, then the prose placeholder where the prose lands, then the
  // sources where the answer's own rail lands. The first cut of this component
  // put the rail directly under the line and left the placeholder to render
  // below it, which meant the rail travelled the height of the answer at the
  // exact moment the reader was given something to read.
  const order = await progress.evaluate((section) => {
    const top = (selector: string) => {
      const node = section.querySelector<HTMLElement>(selector);
      return node ? node.getBoundingClientRect().top : null;
    };
    return {
      line: top('[data-testid="answer-progress-line"]'),
      skeleton: top('[data-slot="answer-prose-skeleton"]'),
      sectionChildren: [...section.children].length,
    };
  });
  expect(order.line).not.toBeNull();
  expect(order.skeleton).not.toBeNull();
  expect(order.skeleton ?? 0).toBeGreaterThan(order.line ?? 0);

  // And exactly one prose placeholder on the page — the dashboard must not also
  // render AnswerSkeleton beside this one.
  await expect(page.locator('[role="status"][aria-label="Loading answer"]')).toHaveCount(0);
});

test("the sources arrive during the wait and hand over to the answer's own rail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboardApis(page);
  await installEvidencePreviewAnswerStream(page);
  await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });
  await dismissBlockingPwaNotice(page);

  const submit = await fillHydratedAnswerQuestion(page, "Lithium dosing");
  await submit.click();

  const progress = page.getByTestId("answer-progress");
  const rail = progress.getByTestId("answer-evidence-preview");
  const cards = rail.getByTestId("answer-evidence-preview-source");

  // The whole point: source-backed content is on screen while the answer is still
  // being written, not only when it lands.
  await expect(rail).toBeVisible({ timeout: 8_000 });
  await expect(progress).toHaveAttribute("data-progress-state", "active");

  // Six of the eight sent — the render policy's primary-source cap.
  await expect(cards).toHaveCount(6);

  // The one number the wait prints, and it counts exactly the cards below it.
  await expect(progress.getByTestId("answer-progress-line")).toContainText("6 sources found");

  // Numbering is what arrival buys. The preview is retrieval order; the final list is
  // rebuilt from what the answer cites, so a number assigned now can point at a
  // different document once the answer lands.
  for (const card of await cards.all()) {
    await expect(card.locator("[aria-hidden='true']").first()).toHaveText("\u2022");
  }
  await expect(rail).toHaveAttribute("aria-label", /not yet numbered/i);

  // Every card is a real link to the real page, so a reader who recognises a document
  // can open it without waiting for the answer at all.
  await expect(cards.first()).toHaveAttribute("href", "/documents/doc-1?page=2&chunk=chunk-1");

  // Line, then the prose placeholder where the prose lands, then the sources where the
  // answer's own rail lands. Every element already stands where its finished counterpart
  // will, which is the entire "nothing jumps" claim.
  const order = await progress.evaluate((section) => {
    const top = (selector: string) => {
      const node = section.querySelector<HTMLElement>(selector);
      return node ? node.getBoundingClientRect().top : null;
    };
    return {
      line: top('[data-testid="answer-progress-line"]'),
      skeleton: top('[data-slot="answer-prose-skeleton"]'),
      preview: top('[data-testid="answer-evidence-preview"]'),
    };
  });
  expect(order.preview).not.toBeNull();
  expect(order.skeleton ?? 0).toBeGreaterThan(order.line ?? 0);
  expect(order.preview ?? 0).toBeGreaterThan(order.skeleton ?? 0);

  // Arrival swaps content in place: the preview rail goes, the answer's own numbered
  // rail stands in its position.
  await expect(page.getByText(/In the synthetic lithium document/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("answer-evidence-preview")).toHaveCount(0);
  await expect(page.getByTestId("answer-source-rail")).toBeVisible();
});

test("the arriving sources are simply present when motion is suppressed", async ({ page }) => {
  // The suite runs reduced-motion by default (see the dual-mode note on contextOptions in
  // playwright.config.ts), so this is that half of the pair.
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboardApis(page);
  await installEvidencePreviewAnswerStream(page);
  await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });
  await dismissBlockingPwaNotice(page);

  const submit = await fillHydratedAnswerQuestion(page, "Lithium dosing");
  await submit.click();

  const cards = page.getByTestId("answer-evidence-preview").getByTestId("answer-evidence-preview-source");
  await expect(cards.first()).toBeVisible({ timeout: 8_000 });

  // Suppressing motion must never withhold the content. The pacing that reveals the cards one
  // at a time is JS, so unlike a CSS delay it could genuinely hold cards back from a
  // reduced-motion reader — the reveal therefore returns the full count immediately, and every
  // card is here at once, not animating, fully opaque.
  await expect(cards).toHaveCount(6);
  const suppressed = await cards.evaluateAll((nodes) =>
    nodes.map((node) => ({
      name: getComputedStyle(node).animationName,
      delay: getComputedStyle(node).animationDelay,
      opacity: getComputedStyle(node).opacity,
    })),
  );
  for (const card of suppressed) {
    expect(card.name).toBe("none");
    expect(card.delay).toBe("0s");
    expect(card.opacity).toBe("1");
  }
  await expect(page.getByTestId("answer-progress-line")).toContainText("6 sources found");
});

test("the arriving sources are paced apart when motion is allowed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboardApis(page);
  await installEvidencePreviewAnswerStream(page);
  await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });
  await dismissBlockingPwaNotice(page);

  // Record when each card is inserted, rather than sampling the count from the test side.
  // A MutationObserver sees every insertion, so the proof does not depend on how fast this
  // machine happens to poll — the pacing either produced separated insertions or it did not.
  await page.evaluate(() => {
    const stamps: number[] = [];
    (window as unknown as { __evidenceCardStamps: number[] }).__evidenceCardStamps = stamps;
    const card = '[data-testid="answer-evidence-preview-source"]';
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          // Descendants too, not only the node itself. The first card arrives inside the rail
          // container, so the observer sees the container added and the card only as its
          // child — matching the added node alone silently loses card one and makes the
          // pacing look one beat shorter than it is.
          const added = node.matches(card) ? 1 : node.querySelectorAll(card).length;
          for (let index = 0; index < added; index += 1) stamps.push(performance.now());
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  const submit = await fillHydratedAnswerQuestion(page, "Lithium dosing");
  await submit.click();

  const cards = page.getByTestId("answer-evidence-preview").getByTestId("answer-evidence-preview-source");
  await expect(cards).toHaveCount(6, { timeout: 8_000 });

  const stamps = await page.evaluate(
    () => (window as unknown as { __evidenceCardStamps: number[] }).__evidenceCardStamps,
  );
  expect(stamps).toHaveLength(6);
  // One card per --duration-moderate (200ms), so first to last spans about a second. The
  // bound is deliberately loose at both ends: the point is that the rail accrues rather than
  // blinking into place, and that it is still standing well before generation ends.
  const span = (stamps.at(-1) ?? 0) - (stamps[0] ?? 0);
  expect(span).toBeGreaterThan(500);
  expect(span).toBeLessThan(3_000);

  // The wait's one copy rule, checked where it is easiest to break: the number in the line is
  // the number of cards beneath it, all the way to the end of the reveal.
  await expect(page.getByTestId("answer-progress-line")).toContainText("6 sources found");
});

test("a completion frame cannot mark a previous answer complete when final is invalid", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDashboardApis(page);
  await installSuccessfulThenInvalidAnswerStreams(page);
  await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });

  const submit = await fillHydratedAnswerQuestion(page, "Lithium dosing");
  await submit.click();

  await expect(page.getByText(/In the synthetic lithium document/i)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("answer-progress")).toHaveAttribute("data-progress-state", "complete");

  const followUpSubmit = await fillHydratedAnswerQuestion(page, "What about monitoring?");
  await followUpSubmit.click();

  await expect(page.getByTestId("answer-error")).toContainText("Answer stream returned an invalid final payload", {
    timeout: 10_000,
  });
  await expect(page.locator('[data-progress-state="complete"]')).toHaveCount(0);
  await expect(page.getByText(/Answer ready in/)).toHaveCount(0);
  await expect(page.getByText(/In the synthetic lithium document/i)).toBeVisible();
});

test("answer progress keeps focus, reduced-motion, and forced-colour behavior intact", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 820 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockDashboardApis(page);
  await installHoldingAnswerStream(page);
  await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });
  await dismissBlockingPwaNotice(page);

  const submit = await fillHydratedAnswerQuestion(page, "Lithium dosing");
  await submit.click();

  const progress = page.getByTestId("answer-progress");
  const line = progress.getByTestId("answer-progress-line");
  const dot = progress.locator('[data-slot="answer-progress-dot"]');
  await expect(line).toContainText("Writing the answer");
  await expect(dot).toBeVisible();

  // Suppressing motion must not delete the indicator. The retired ECG sweep
  // resolved to opacity 0 here, which left everyone with OS Reduce Motion
  // staring at a blank, frozen panel on a physical iPhone. A dot has a correct
  // resting frame, so the guarantee is simply full opacity.
  expect(await dot.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await dot.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  const restingBox = await dot.boundingBox();
  expect(restingBox?.width ?? 0).toBeGreaterThan(0);
  expect(restingBox?.height ?? 0).toBeGreaterThan(0);

  // Stop is the only control in the running state, and it is reachable and
  // operable from the keyboard.
  const stop = progress.getByRole("button", { name: "Stop generating answer" });
  await stop.focus();
  await expect(stop).toBeFocused();

  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(
    await dot.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        name: style.animationName,
        duration: style.animationDuration,
        iterationCount: style.animationIterationCount,
      };
    }),
  ).toEqual({ name: "answer-progress-breath", duration: "2.4s", iterationCount: "infinite" });

  const restingOpacity = await dot.evaluate(async (node) => {
    const animation = node.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    await new Promise(requestAnimationFrame);
    return getComputedStyle(node).opacity;
  });
  const restingPixels = await dot.screenshot();
  const midOpacity = await dot.evaluate(async (node) => {
    const animation = node.getAnimations()[0];
    animation.currentTime = 1_200;
    await new Promise(requestAnimationFrame);
    return getComputedStyle(node).opacity;
  });
  const midPixels = await dot.screenshot();
  // The breath actually breathes: a different computed opacity AND a raster that
  // genuinely differs. Computed style alone was never enough — the animation this
  // replaced satisfied every computed-style assertion while reading as static.
  expect(restingOpacity).toBe("1");
  expect(midOpacity).not.toBe(restingOpacity);
  expect(Number.parseFloat(midOpacity)).toBeGreaterThan(0.2);
  expect(restingPixels.equals(midPixels), "the WebKit raster must visibly change as the dot breathes").toBe(false);

  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  // Forced colours paint neither the token background nor the animation, so the
  // dot declares a system colour of its own. Without it the only indicator on the
  // surface disappears for high-contrast users.
  await expect(dot).toBeVisible();
  await expect(line).toContainText("Writing the answer");
  expect(await dot.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");

  await stop.press("Enter");
  await expect(page.getByTestId("answer-cancelled")).toBeVisible();
});
