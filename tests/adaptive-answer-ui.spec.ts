import { expect, test, type Locator, type Page } from "playwright/test";

import { demoAnswer, demoDocuments } from "../src/lib/demo-data";
import {
  projectClientAnswerPayload,
  toClientAnswerPayload,
  type ClientRagAnswerPayload,
} from "../src/lib/answer-client-payload";

const readySetupChecks = [
  { id: "env", label: ".env.local configured", status: "ready", detail: "Synthetic test environment ready." },
  { id: "project", label: "PsychSift Production target", status: "ready", detail: "Synthetic project ready." },
  { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Synthetic schema ready." },
  { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Synthetic search ready." },
  { id: "openai", label: "Answer provider", status: "ready", detail: "Synthetic stream ready." },
];

const viewports = [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
] as const;

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

async function submitAnswer(page: Page, query: string) {
  const input = page.locator('[aria-label^="Search indexed guidelines by question or keyword"]:visible');
  const submit = page.locator('[aria-label="Generate source-backed answer"]:visible');
  await expect(async () => {
    await expect(input).toHaveCount(1);
    await expect(submit).toHaveCount(1);
    await waitForReactEventHandler(input, "onChange");
    await waitForReactEventHandler(input.locator("xpath=ancestor::form[1]"), "onSubmit");
    await input.fill(query);
    await expect(input).toHaveValue(query);
    await expect(submit).toBeEnabled();
  }).toPass({ timeout: 30_000 });
  await submit.click();
}

async function dismissBlockingPwaNotice(page: Page) {
  const dismiss = page.getByRole("button", { name: /Dismiss (?:offline notice|update notice|install)/ }).first();
  if (
    await dismiss
      .waitFor({ state: "visible", timeout: 2_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await dismiss.click();
  }
}

async function mockSyntheticDashboardApis(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    if (!url.pathname.startsWith("/api/") || url.pathname === "/api/local-project-id") {
      // The runner proves the real task server identity. This spec must never
      // replace that endpoint with a fixture.
      await route.fallback();
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

function adaptiveFixture(query: string, prefix: "Prior" | "Current"): ClientRagAnswerPayload {
  const base = toClientAnswerPayload(demoAnswer(query));
  if (!base) throw new Error(`Synthetic ${prefix.toLowerCase()} server fixture did not project to the client DTO`);
  const primary = base.sources[0];
  const secondary = base.sources[1];
  if (!primary || !secondary) throw new Error(`Synthetic ${prefix.toLowerCase()} fixture requires two sources`);

  const projected = projectClientAnswerPayload(
    {
      ...base,
      answer: `${prefix} adaptive lead remains complete for review.\n\nSynthetic demo only: this is not clinical guidance.`,
      answerContractVersion: "clinical-rag-answer-v20",
      renderAdaptiveAnswer: true,
      // The server's client projection always states this flag, and the persisted answer thread
      // (v3) refuses any turn that does not, so a fixture without it would never survive a reload.
      strongSupportLabelCapped: false,
      demoMode: true,
      visualEvidence: [],
      quoteCards: [],
      citations: [base.citations[0]!],
      answerSections: [
        {
          heading: `${prefix} required action`,
          body: `${prefix} required action stays visible in the main answer.`,
          kind: "required_actions",
          supportLevel: "direct",
          citation_chunk_ids: [primary.id],
        },
        {
          heading: `${prefix} source difference`,
          body: `${prefix} uploaded protocol differs from the synthetic regional guideline; review both documented instructions.`,
          kind: "source_conflict",
          supportLevel: "direct",
          citation_chunk_ids: [primary.id, secondary.id],
        },
        {
          heading: `${prefix} source gap`,
          body: `${prefix} active synthetic sources support only part of the follow-up question.`,
          kind: "source_gap",
          supportLevel: "unsupported",
          citation_chunk_ids: [],
        },
      ],
    },
    true,
  );
  if (!projected) throw new Error(`Synthetic ${prefix.toLowerCase()} final payload violated the strict client DTO`);
  return projected;
}

async function installSyntheticAnswerStreams(page: Page, answers: ClientRagAnswerPayload[]) {
  await page.addInitScript(
    ({ finalAnswers }) => {
      const originalFetch = window.fetch.bind(window);
      let requestCount = 0;
      Object.defineProperty(window, "__adaptiveAnswerRequestCount", {
        configurable: true,
        get: () => requestCount,
      });
      window.fetch = async (input, init) => {
        const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        const pathname = new URL(rawUrl, window.location.href).pathname;
        if (pathname !== "/api/answer/stream") return originalFetch(input, init);

        const answer = finalAnswers[requestCount];
        requestCount += 1;
        if (!answer) return new Response("No synthetic answer remains.", { status: 500 });
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              window.setTimeout(() => {
                controller.enqueue(
                  encoder.encode(
                    `event: progress\ndata: ${JSON.stringify({
                      stage: "complete",
                      message: "Synthetic answer ready.",
                      elapsedMs: 20,
                    })}\n\n`,
                  ),
                );
              }, 20);
              window.setTimeout(() => {
                controller.enqueue(encoder.encode(`event: final\ndata: ${JSON.stringify(answer)}\n\n`));
                controller.close();
              }, 40);
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new DOMException("The operation was aborted.", "AbortError")),
                { once: true },
              );
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
        );
      };
    },
    { finalAnswers: answers },
  );
}

async function installClipboardProbe(page: Page) {
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
}

async function expectCompleteUnclippedSections(surface: Locator, prefix: "Prior" | "Current") {
  const sections = surface.getByTestId("adaptive-answer-section");
  await expect(sections).toHaveCount(3);
  await expect(sections.locator("h3")).toHaveText([
    `${prefix} required action`,
    `${prefix} source difference`,
    `${prefix} source gap`,
  ]);
  await expect(sections.nth(0).getByTestId("citation")).toHaveCount(1);
  await expect(sections.nth(1).getByTestId("citation")).toHaveCount(2);
  await expect(sections.nth(2).getByTestId("citation")).toHaveCount(0);
  await expect(sections.nth(2)).toContainText(
    `${prefix} active synthetic sources support only part of the follow-up question.`,
  );
  await expect(sections.nth(2)).not.toContainText("No source covers this gap.");
  await expect(sections.nth(2)).not.toContainText("No source supports this statement.");

  const geometry = await sections.evaluateAll((items) =>
    items.flatMap((item) =>
      Array.from(item.querySelectorAll(":scope > h3, :scope > p")).map((prose) => {
        const element = prose as HTMLElement;
        const style = getComputedStyle(element);
        return {
          clientHeight: element.clientHeight,
          clientWidth: element.clientWidth,
          lineClamp: style.getPropertyValue("-webkit-line-clamp"),
          overflow: style.overflow,
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth,
          text: element.textContent ?? "",
          textOverflow: style.textOverflow,
        };
      }),
    ),
  );
  for (const item of geometry) {
    expect(item.text).not.toContain("…");
    expect(item.lineClamp).toBe("none");
    expect(item.textOverflow).not.toBe("ellipsis");
    expect(item.scrollHeight).toBeLessThanOrEqual(item.clientHeight + 1);
    expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
    expect(item.overflow).not.toBe("hidden");
  }
}

for (const viewport of viewports) {
  test(`complete adaptive answer survives current, prior, copy, reload, and print at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    const priorAnswer = adaptiveFixture("Lithium toxicity monitoring", "Prior");
    const currentAnswer = adaptiveFixture("Clozapine monitoring table", "Current");
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockSyntheticDashboardApis(page);
    await installClipboardProbe(page);
    await installSyntheticAnswerStreams(page, [priorAnswer, currentAnswer]);
    await page.goto("/?mode=answer", { waitUntil: "domcontentloaded" });
    await dismissBlockingPwaNotice(page);

    await submitAnswer(page, "Lithium toxicity monitoring");
    await expect(page.getByText("Prior adaptive lead remains complete for review.", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await submitAnswer(page, "Clozapine monitoring table");
    await expect(page.getByText("Current adaptive lead remains complete for review.", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const showPrevious = page.getByRole("button", { name: "Show previous answer" });
    await expect(showPrevious).toBeVisible();
    await showPrevious.press("Enter");
    const sectionSurfaces = page.getByTestId("adaptive-answer-sections");
    await expect(sectionSurfaces).toHaveCount(2);
    await expectCompleteUnclippedSections(sectionSurfaces.nth(0), "Prior");
    await expectCompleteUnclippedSections(sectionSurfaces.nth(1), "Current");
    await expect(page.getByText("Prior adaptive lead remains complete for review.", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Current adaptive lead remains complete for review.", { exact: true })).toHaveCount(1);
    expect(await page.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth + 1)).toBe(true);
    await expect(
      page.getByRole("dialog", { name: /Safety-critical source findings|Clinical notes|Evidence/i }),
    ).toHaveCount(0);

    if (viewport.width === 320 || viewport.width === 1280) {
      await page
        .getByTestId("answer-card")
        .screenshot({ path: testInfo.outputPath(`adaptive-current-answer-${viewport.width}x${viewport.height}.png`) });
    }

    const answerSurfaces = page.getByTestId("plain-answer-response");
    await expect(answerSurfaces).toHaveCount(2);
    // The live answer owns the shared utility row; prior turns retain their
    // local copy action inside the historical answer surface.
    await page
      .getByLabel("Answer utilities")
      .getByRole("button", { name: "Copy answer with source status" })
      .press("Enter");
    const currentCopy = await page.evaluate(() => navigator.clipboard.readText());
    for (const text of [
      "Current adaptive lead remains complete for review.",
      "Current required action",
      "Current required action stays visible in the main answer.",
      "Current source difference",
      "Current uploaded protocol differs from the synthetic regional guideline",
      "Current source gap",
      "Current active synthetic sources support only part of the follow-up question.",
    ]) {
      expect(currentCopy).toContain(text);
    }
    expect(currentCopy).not.toContain("Prior adaptive lead");

    await answerSurfaces.nth(0).getByRole("button", { name: "Copy answer with source status" }).press("Enter");
    const priorCopy = await page.evaluate(() => navigator.clipboard.readText());
    expect(priorCopy).toContain("Prior adaptive lead remains complete for review.");
    expect(priorCopy).toContain("Prior source difference");
    expect(priorCopy).toContain("Prior source gap");
    expect(priorCopy).not.toContain("Current adaptive lead");

    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(sessionStorage)
            .filter((key) => key.startsWith("clinical-kb-answer-thread:"))
            .some((key) => {
              const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
                latestTurn?: { answer?: { answerContractVersion?: string; renderAdaptiveAnswer?: boolean } };
                priorTurns?: Array<{ answer?: { answerContractVersion?: string; renderAdaptiveAnswer?: boolean } }>;
              } | null;
              return (
                value?.latestTurn?.answer?.answerContractVersion === "clinical-rag-answer-v20" &&
                value.latestTurn.answer.renderAdaptiveAnswer === true &&
                value.priorTurns?.[0]?.answer?.answerContractVersion === "clinical-rag-answer-v20" &&
                value.priorTurns[0].answer?.renderAdaptiveAnswer === true
              );
            }),
        ),
      )
      .toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await dismissBlockingPwaNotice(page);
    await expect(page.getByText("Current adaptive lead remains complete for review.", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    const restoredShowPrevious = page.getByRole("button", { name: "Show previous answer" });
    if (await restoredShowPrevious.isVisible().catch(() => false)) await restoredShowPrevious.press("Enter");
    await expect(page.getByTestId("adaptive-answer-sections")).toHaveCount(2);
    await expectCompleteUnclippedSections(page.getByTestId("adaptive-answer-sections").nth(0), "Prior");
    await expectCompleteUnclippedSections(page.getByTestId("adaptive-answer-sections").nth(1), "Current");
    expect(
      await page.evaluate(
        () => (window as Window & { __adaptiveAnswerRequestCount?: number }).__adaptiveAnswerRequestCount ?? -1,
      ),
    ).toBe(0);

    await page.emulateMedia({ media: "screen", reducedMotion: "reduce", forcedColors: "active" });
    await expect(page.getByText("Current source gap", { exact: true })).toBeVisible();
    await expect(
      page
        .getByTestId("adaptive-answer-section")
        .last()
        .getByText("Current active synthetic sources support only part of the follow-up question."),
    ).toBeVisible();
    await expect(page.getByText("No source covers this gap.")).toHaveCount(0);
    await expect(page.getByText("No source supports this statement.")).toHaveCount(0);

    const currentGapBody = page.getByText(
      "Current active synthetic sources support only part of the follow-up question.",
      { exact: true },
    );
    const tailVisibility = await currentGapBody.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = element.getBoundingClientRect();
      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent?.trim()) textNodes.push(node as Text);
      }
      // Probe visible glyphs rather than whole text-node line boxes. Chromium
      // can include collapsed wrap whitespace in a line box, placing its sample
      // just outside the inline element even though every glyph is visible.
      const linePoints = textNodes.flatMap((node) =>
        Array.from(node.data.matchAll(/\S/gu)).flatMap((match) => {
          const range = document.createRange();
          const start = match.index ?? 0;
          range.setStart(node, start);
          range.setEnd(node, start + match[0].length);
          return Array.from(range.getClientRects())
            .filter((glyphRect) => glyphRect.width > 0 && glyphRect.height > 0)
            .map((glyphRect) => ({
              x: glyphRect.left + glyphRect.width / 2,
              y: glyphRect.top + glyphRect.height / 2,
            }));
        }),
      );
      const probeLinePoints = () =>
        linePoints.map(({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return {
            hitTagName: hit?.tagName ?? null,
            hitTestId: hit?.getAttribute("data-testid") ?? null,
            targetContainsHit: hit ? element.contains(hit) : false,
            x,
            y,
          };
        });

      const overlay = document.createElement("div");
      overlay.dataset.testid = "tail-visibility-negative-control";
      Object.assign(overlay.style, {
        height: `${rect.height}px`,
        left: `${rect.left}px`,
        pointerEvents: "auto",
        position: "fixed",
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        zIndex: "2147483647",
      });
      let coveredControl: ReturnType<typeof probeLinePoints> = [];
      try {
        document.body.append(overlay);
        coveredControl = probeLinePoints();
      } finally {
        overlay.remove();
      }

      const uncovered = probeLinePoints();
      return {
        bottom: rect.bottom,
        coveredControl,
        coveredPoints: uncovered.filter(({ targetContainsHit }) => !targetContainsHit),
        linePoints,
        top: rect.top,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });
    expect(tailVisibility.top).toBeGreaterThanOrEqual(0);
    expect(tailVisibility.bottom).toBeLessThanOrEqual(tailVisibility.viewportHeight);
    expect(tailVisibility.linePoints.length).toBeGreaterThan(0);
    for (const point of tailVisibility.linePoints) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(tailVisibility.viewportWidth);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThan(tailVisibility.viewportHeight);
    }
    expect(tailVisibility.coveredControl).toHaveLength(tailVisibility.linePoints.length);
    for (const point of tailVisibility.coveredControl) {
      expect(point.hitTestId).toBe("tail-visibility-negative-control");
      expect(point.targetContainsHit).toBe(false);
    }
    expect(tailVisibility.coveredPoints).toEqual([]);

    await page.emulateMedia({ media: "print", reducedMotion: "reduce", forcedColors: null });
    await expect(page.getByText("Prior source difference", { exact: true })).toBeVisible();
    await expect(page.getByText("Current source difference", { exact: true })).toBeVisible();
    await page.emulateMedia({ media: "screen", reducedMotion: "no-preference", forcedColors: null });

    const targetSource = currentAnswer.sources[0]!;
    const currentCitation = page
      .getByTestId("adaptive-answer-sections")
      .nth(1)
      .getByTestId("adaptive-answer-section")
      .first()
      .getByTestId("citation");
    await currentCitation.focus();
    await expect(currentCitation).toBeFocused();
    await currentCitation.press("Enter");
    await page.waitForURL(
      (url) =>
        url.pathname === `/documents/${targetSource.document_id}` &&
        url.searchParams.get("page") === String(targetSource.page_number) &&
        url.searchParams.get("chunk") === targetSource.id,
    );
  });
}
