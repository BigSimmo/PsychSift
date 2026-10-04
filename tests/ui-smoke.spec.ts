import AxeBuilder from "@axe-core/playwright";
import type { Route } from "playwright-core";
import { expect, test, type Locator, type Page, type Request } from "playwright/test";
import { stubZeroTouchPoints } from "./helpers/zero-touch";
import { expectNoPageHorizontalOverflow, gotoApp } from "./helpers/spec-navigation";
import { expectMinTouchTarget } from "./helpers/layout-tolerance";

/**
 * Detect Next.js 16 prefetch requests across all prefetch strategies (RSC prefetch,
 * full-strategy HTML/document prefetch, and router state tree prefetch).
 * In Next 16 full-strategy prefetching, prefetch requests carry headers such as
 * `purpose: prefetch`, `x-purpose: prefetch`, `sec-purpose: prefetch`, or
 * `next-router-prefetch`.
 */
function isNextPrefetchRequest(request: Request): boolean {
  const headers = request.headers();
  const purpose = headers["purpose"] ?? headers["x-purpose"] ?? headers["sec-purpose"];
  if (purpose === "prefetch") return true;
  if (headers["next-router-prefetch"] !== undefined) return true;
  return false;
}
import {
  appendPrimaryScrollSpacer,
  readMobileComposerReservePx,
  readPrimaryScrollAndDomGeometry,
  readPrimaryScrollGeometry,
  scrollPrimarySurface,
} from "./playwright-scroll";
import {
  clickWhenHydrated,
  clickWhenSettled,
  expectSingleSettledOwner,
  visibleByTestId,
} from "./playwright-settlement";
import { answerThreadStorageKey } from "../src/lib/answer-thread-storage";
import { toClientAnswerPayload } from "../src/lib/answer-client-payload";
import { BRAND_NAME } from "../src/lib/brand";
import { documentSummaryQuestion } from "../src/lib/answer-contract";
import { demoAnswer, demoDocuments, demoSummary, getDemoDocument, getDemoDocumentPayload } from "../src/lib/demo-data";
import { formRecords } from "../src/lib/forms";
import { publicMedicationGovernance } from "../src/lib/medication-records";
import { getMedicationRecord, loadMedicationSnapshot } from "../src/lib/medication-snapshot";
import { searchMedicationCatalog } from "../src/lib/medication-query";
import { medicationToSearchResult, type MedicationRecord } from "../src/lib/medications";
import { serviceRecords } from "../src/lib/services";
import { recentQueryStorageKey } from "../src/lib/recent-query-storage";

const dashboardViewports = [
  // Representative owners only: one phone (<640), tablet (≤768), laptop, and
  // landscape. Extra phone widths (375/414) duplicated the same overflow + Ask
  // asserts without a distinct layout branch.
  { name: "small-mobile", width: 320, height: 720 },
  { name: "tablet", width: 768, height: 900 },
  { name: "laptop", width: 1280, height: 900 },
  { name: "mobile-landscape", width: 667, height: 375 },
] as const;
const uiAssertionTimeoutMs = 30_000;
const demoAnswerThreadOwnerId = "local-demo-session";
const demoAnswerThreadStorageKey = `${answerThreadStorageKey}:${demoAnswerThreadOwnerId}`;
const demoRecentQueryStorageKey = `${recentQueryStorageKey}:${demoAnswerThreadOwnerId}`;

async function expectDocumentOwnerFillsFrame(page: Page, owner: Locator) {
  // Next streaming can leave a hidden DocumentFrame clone (#093); bare getByTestId
  // then trips strict mode with 2 matches (seen under mobile-composer-reserve-pad).
  const surround = visibleByTestId(page, "document-frame-surround");
  const content = visibleByTestId(page, "document-frame-content");
  await expect(surround).toBeVisible();
  await expect(content).toBeVisible();
  await expect(owner).toBeVisible();

  await expect
    .poll(async () => {
      const [surroundGeometry, contentBox, ownerBox] = await Promise.all([
        surround.evaluate((element) => {
          const style = window.getComputedStyle(element);
          return {
            clientWidth: element.clientWidth,
            paddingLeft: Number.parseFloat(style.paddingLeft),
            paddingRight: Number.parseFloat(style.paddingRight),
          };
        }),
        content.boundingBox(),
        owner.boundingBox(),
      ]);
      if (!contentBox || !ownerBox) return Number.POSITIVE_INFINITY;
      const availableWidth =
        surroundGeometry.clientWidth - surroundGeometry.paddingLeft - surroundGeometry.paddingRight;
      return Math.max(Math.abs(contentBox.width - availableWidth), Math.abs(ownerBox.width - availableWidth));
    })
    .toBeLessThanOrEqual(2);
}

async function revealPhoneHeaderControl(page: Page, control: Locator) {
  // A sheet that just closed returns focus in a frame callback, and PhoneFocusClearance
  // re-checks the restored control one frame after that, scrolling it back into view if it
  // is off screen. WebKit can run those frames up to a second late, so a scroll made before
  // them is undone. Two frames queued now run after both, whatever the frame rate.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const { scrollTop } = await readPrimaryScrollGeometry(page);
  // Exercise the same upward scroll that reveals the phone header to a reader.
  // Programmatic scrollTop=0 can briefly report zero in WebKit, then snap back
  // after the closing sheet restores focus without revealing the header.
  if (scrollTop > 0) {
    // Use the shared programmatic scroll helper because mobile WebKit does not
    // support Playwright's mouse.wheel API.
    await scrollPrimarySurface(page, 0);
    await expect.poll(async () => (await readPrimaryScrollGeometry(page)).scrollTop).toBeLessThanOrEqual(1);
  }
  await expect(control).toBeInViewport();
}

async function installClipboardMock(page: Page) {
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

async function waitForReactEventHandler(locator: Locator, eventName: "onChange" | "onClick" | "onScroll" | "onSubmit") {
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

async function activateFocusedControl(page: Page, control: Locator) {
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}

async function expectSingleMedicationPage(page: Page) {
  // The medication route renders inside GlobalMockupSearchShell, whose Suspense
  // fallback and resolved client subtree both render `children`. During a
  // navigation/hydration overlap the shared data-testid can transiently resolve
  // to two <main> elements and trip Playwright strict mode. Wait for it to settle
  // to exactly one before asserting visibility — a genuine permanent double-render
  // still fails toHaveCount(1), so this does not mask a real regression.
  const medicationPage = page.getByTestId("medication-page-acamprosate");
  if ((await medicationPage.count()) !== 1) {
    await Promise.race([
      page.waitForResponse((response) => response.url().includes("/api/medications/acamprosate") && response.ok(), {
        timeout: 30_000,
      }),
      expect(medicationPage).toHaveCount(1, { timeout: 30_000 }),
    ]).catch(() => undefined);
  }
  await expect(medicationPage).toHaveCount(1, { timeout: 30_000 });
  await expect(medicationPage).toBeVisible({ timeout: 30_000 });
}

function visibleQuestionInput(page: Page) {
  return page.locator('[aria-label^="Search indexed guidelines by question or keyword"]:visible').first();
}

function visibleAnswerSubmitButton(page: Page) {
  return page.locator('[aria-label="Generate source-backed answer"]:visible').first();
}

async function submitDocumentSearch(page: Page) {
  const submit = page.getByRole("button", { name: "Find matching documents" });
  await expect(submit).toBeEnabled();
  await waitForReactEventHandler(submit.locator("xpath=ancestor::form[1]"), "onSubmit");
  const response = page.waitForResponse(
    (candidate) => new URL(candidate.url()).pathname === "/api/search" && candidate.ok(),
    { timeout: 30_000 },
  );
  await Promise.all([response, submit.click()]);
  await expect(page.getByRole("heading", { name: "Finding matching documents" })).toHaveCount(0, {
    timeout: 30_000,
  });
}

function visibleAnswerFollowUpSuggestions(page: Page) {
  return page
    .locator(
      '[data-testid="answer-follow-up-suggestions"]:visible, [data-testid="answer-composer-follow-up-suggestions"]:visible',
    )
    .first();
}

async function isVisibleWithoutThrow(locator: Locator) {
  return locator.isVisible().catch(() => false);
}

async function fillVisibleQuestionInput(page: Page, value: string) {
  const questionInput = page.locator('[aria-label^="Search indexed guidelines by question or keyword"]:visible');
  const submitAnswer = page.locator('[aria-label="Generate source-backed answer"]:visible');

  // Production HTML can be visible before React owns the controlled input.
  // Filling during that gap is immediately overwritten by hydration and leaves
  // the submit button disabled, so establish the live handler boundary first.
  await waitForReactEventHandler(questionInput, "onChange");
  await expect(async () => {
    // A production navigation can briefly overlap or replace the server-rendered
    // composer. Require one settled React owner before filling so the new client
    // tree cannot discard the value and leave submit disabled.
    await expect(questionInput).toHaveCount(1, { timeout: uiAssertionTimeoutMs });
    await expect(submitAnswer).toHaveCount(1, { timeout: uiAssertionTimeoutMs });
    await waitForReactEventHandler(questionInput, "onChange");
    await waitForReactEventHandler(questionInput.locator("xpath=ancestor::form[1]"), "onSubmit");
    await expect(submitAnswer).toHaveAttribute("title", /Enter a clinical question|Generate a source-backed answer/, {
      timeout: uiAssertionTimeoutMs,
    });
    await expect(questionInput).toBeEditable({ timeout: uiAssertionTimeoutMs });
    await questionInput.fill(value);
    await expect(questionInput).toHaveValue(value, { timeout: uiAssertionTimeoutMs });
    await expect(submitAnswer).toBeEnabled({ timeout: uiAssertionTimeoutMs });
  }).toPass({ timeout: uiAssertionTimeoutMs });

  return questionInput;
}

const readySetupChecks = [
  { id: "env", label: ".env.local configured", status: "ready", detail: "Test environment ready." },
  { id: "project", label: "PsychSift Production target", status: "ready", detail: "Test Supabase project ready." },
  { id: "schema", label: "supabase/schema.sql applied", status: "ready", detail: "Test schema ready." },
  { id: "search", label: "Search RPC and vector indexes", status: "ready", detail: "Test search schema ready." },
  { id: "openai", label: "OpenAI API key available", status: "ready", detail: "Test OpenAI ready." },
  { id: "worker", label: "npm run worker running", status: "unknown", detail: "Worker not required for UI smoke." },
];

async function mockLocalProjectIdentity(page: Page) {
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
}

async function mockPrivateUnauthenticatedApi(page: Page) {
  await mockLocalProjectIdentity(page);
  await page.route("**/api/setup-status**", async (route) => {
    await route.fulfill({
      json: { demoMode: false, checks: readySetupChecks },
    });
  });
  await page.route(/\/api\/answer(?:\/stream)?(?:\?.*)?$/, async (route) => {
    const body = route.request().postDataJSON() as {
      query?: string;
      documentId?: string;
      documentIds?: string[];
    };
    await fulfillAnswerResponse(
      route,
      demoAnswer(body.query ?? "What monitoring is required?", body.documentId, body.documentIds),
    );
  });
}

function answerStreamBody(payload: unknown) {
  return [
    `event: progress\ndata: ${JSON.stringify({ stage: "retrieving", message: "Searching indexed documents." })}`,
    `event: progress\ndata: ${JSON.stringify({ stage: "ranking", message: "Selecting governed sources." })}`,
    `event: progress\ndata: ${JSON.stringify({ stage: "complete", message: "Answer ready.", elapsedMs: 1250 })}`,
    `event: final\ndata: ${JSON.stringify(payload)}`,
    "",
  ].join("\n\n");
}

async function fulfillAnswerResponse(route: Route, payload: ReturnType<typeof demoAnswer> & { demoMode?: boolean }) {
  // Match the real JSON/SSE route boundary: server-only answer fields never
  // reach the strict client decoder, including in synthetic browser fixtures.
  const clientPayload = {
    ...toClientAnswerPayload(payload),
    ...(payload.demoMode === undefined ? {} : { demoMode: payload.demoMode }),
  };
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.endsWith("/stream")) {
    await route.fulfill({
      body: answerStreamBody(clientPayload),
      contentType: "text/event-stream; charset=utf-8",
      headers: { "Cache-Control": "no-cache, no-transform" },
    });
    return;
  }

  await route.fulfill({ json: clientPayload });
}

type DemoAnswerOverride = (query: string, documentId?: string, documentIds?: string[]) => ReturnType<typeof demoAnswer>;
type MockDemoApiOptions = {
  answerOverride?: DemoAnswerOverride;
  answerDelayMs?: number;
  onAnswerRequest?: (
    query: string,
    scope: { documentId?: string; documentIds?: string[]; summaryMode?: boolean },
  ) => void;
};

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

function medicationIndexRecords(records: MedicationRecord[]): MedicationRecord[] {
  return records.map((record) => {
    const brandRows = record.sections
      .filter((section) => section.type === "form")
      .flatMap((section) => section.rows)
      .filter((row) => /brand\s*names?/i.test(row.key));
    return {
      slug: record.slug,
      name: record.name,
      class: record.class,
      subclass: record.subclass,
      category: record.category,
      accent: record.accent,
      tag: record.tag,
      schedule: record.schedule,
      stats: [],
      sections: brandRows.length
        ? [{ title: "Formulation & Access", type: "form", rows: brandRows.map((row) => ({ ...row })) }]
        : [],
      quick: [],
    };
  });
}

async function mockDemoApi(page: Page, options: MockDemoApiOptions = {}) {
  await blockExternalRequests(page);
  await mockLocalProjectIdentity(page);
  await page.route("**/api/setup-status**", async (route) => {
    await route.fulfill({
      json: { demoMode: true, checks: readySetupChecks },
    });
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
  await page.route(/\/api\/medications(?:\/([^/?]+))?(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const slug = url.pathname.match(/\/api\/medications\/([^/]+)$/)?.[1];
    if (slug) {
      const record = getMedicationRecord(decodeURIComponent(slug));
      if (!record) {
        await route.fulfill({ status: 404, json: { error: `No medication found for "${slug}".` } });
        return;
      }
      await route.fulfill({
        json: {
          record,
          governance: publicMedicationGovernance(record),
          demoMode: true,
        },
      });
      return;
    }

    const query = url.searchParams.get("q")?.trim() || undefined;
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const fullRecords = loadMedicationSnapshot();
    const records = url.searchParams.get("fields") === "index" ? medicationIndexRecords(fullRecords) : fullRecords;
    const ranked = query ? searchMedicationCatalog(fullRecords, query, limit) : undefined;
    await route.fulfill({
      json: {
        records,
        matches: ranked?.matches.map((match) => ({
          medication: match.medication,
          result: medicationToSearchResult(match),
          score: match.score,
          reasons: match.reasons,
        })),
        interpretation: ranked
          ? {
              correctedQuery:
                ranked.analysis.corrections.length && ranked.analysis.correctedQuery !== ranked.analysis.originalQuery
                  ? ranked.analysis.correctedQuery
                  : undefined,
              corrections: ranked.analysis.corrections.length ? ranked.analysis.corrections : undefined,
              appliedExpansions: ranked.analysis.expansions.length ? ranked.analysis.expansions : undefined,
            }
          : undefined,
        total: records.length,
        governance: {},
        demoMode: true,
      },
    });
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
  await page.route(/\/api\/ingestion\/jobs(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { jobs: [], demoMode: true } });
  });
  await page.route(/\/api\/ingestion\/batches(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { batches: [], demoMode: true } });
  });
  await page.route(/\/api\/ingestion\/quality(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { items: [], demoMode: true } });
  });
  await page.route(/\/api\/answer(?:\/stream)?(?:\?.*)?$/, async (route) => {
    const body = route.request().postDataJSON() as {
      query?: string;
      documentId?: string;
      documentIds?: string[];
      summaryMode?: boolean;
    };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query || query.length > 2000) {
      await route.fulfill({ status: 400, json: { error: "A query between 1 and 2000 characters is required." } });
      return;
    }
    options.onAnswerRequest?.(query, {
      documentId: body.documentId,
      documentIds: body.documentIds,
      summaryMode: body.summaryMode,
    });
    if (options.answerDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.answerDelayMs));
    }
    const answer =
      options.answerOverride?.(query, body.documentId, body.documentIds) ??
      (body.summaryMode && body.documentId
        ? demoSummary(body.documentId)
        : demoAnswer(query, body.documentId, body.documentIds));
    await fulfillAnswerResponse(route, {
      ...answer,
      demoMode: true,
    });
  });
  await page.route(/\/api\/search$/, async (route) => {
    const body = route.request().postDataJSON() as { query?: string; mode?: string };
    const query = body.query?.toLowerCase() ?? "";
    if (query.includes("coffee machine")) {
      await route.fulfill({
        json: {
          results: [],
          visualEvidence: [],
          relatedDocuments: [],
          documentMatches: [],
          relevance: { verdict: "none", score: 0, directSourceCount: 0, weakSourceCount: 0 },
          smartPanel: {},
          telemetry: {
            query_class: "unsupported_or_general",
            retrieval_strategy: "unsupported_short_circuit",
            embedding_skipped: true,
          },
          demoMode: true,
        },
      });
      return;
    }
    const isSafetyPlan = query.includes("patient safety plan");
    await route.fulfill({
      json: {
        results: [
          {
            id: isSafetyPlan ? "55555555-5555-4555-8555-555555555555" : "44444444-4444-4444-8444-444444444442",
            document_id: "11111111-1111-4111-8111-111111111111",
            title: isSafetyPlan ? "Synthetic patient safety plan" : "Synthetic lithium monitoring protocol",
            file_name: isSafetyPlan ? "patient-safety-plan.pdf" : "lithium-monitoring.pdf",
            page_number: 1,
            chunk_index: 0,
            section_heading: isSafetyPlan ? "Safety plan contents" : "Monitoring",
            content: isSafetyPlan
              ? "Patient safety plan should include warning signs, supports, coping strategies, means restriction, and crisis contacts."
              : "Lithium monitoring and toxicity safety-net source passage.",
            image_ids: [],
            similarity: 0.9,
            hybrid_score: 0.92,
            images: [],
          },
        ],
        visualEvidence: [],
        relatedDocuments: [],
        documentMatches: [
          {
            document_id: "11111111-1111-4111-8111-111111111111",
            title: isSafetyPlan ? "Synthetic patient safety plan" : "Synthetic lithium monitoring protocol",
            file_name: isSafetyPlan ? "patient-safety-plan.pdf" : "lithium-monitoring.pdf",
            labels: [
              {
                label: isSafetyPlan ? "patient safety plan" : "lithium",
                label_type: isSafetyPlan ? "document" : "medication",
                source: "generated",
                confidence: 0.94,
              },
            ],
            summarySnippet: isSafetyPlan
              ? "Patient safety plan contents and crisis supports."
              : "Lithium monitoring and toxicity safety-net reminders.",
            bestPages: [1],
            bestChunkIds: [
              isSafetyPlan ? "55555555-5555-4555-8555-555555555555" : "44444444-4444-4444-8444-444444444442",
            ],
            imageCount: 1,
            tableCount: 1,
            matchReason: "Matched indexed passage",
            score: 0.92,
          },
        ],
        smartPanel: {},
        telemetry: {
          query_class: isSafetyPlan ? "document_lookup" : "medication_dose_risk",
          retrieval_strategy: "text_fast_path",
          embedding_skipped: true,
        },
        demoMode: true,
      },
    });
  });
  await page.route(/\/api\/search\/universal(?:\?.*)?$/, async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q")?.trim() ?? "";
    await route.fulfill({
      json: {
        query,
        groups: [],
        tookMs: 0,
        domainOrder: [],
        demoMode: true,
      },
    });
  });
  await page.route(/\/api\/documents\/[^/]+\/search(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: {
        query: new URL(route.request().url()).searchParams.get("q") ?? "",
        results: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            page_number: 1,
            chunk_index: 2,
            section_heading: "Safety plan contents",
            snippet:
              "Patient safety plan should include warning signs, coping strategies, supports, crisis contacts, and means restriction.",
            matched_terms: ["safety", "plan", "include"],
            image_ids: [],
            score: 2.4,
          },
          {
            id: "44444444-4444-4444-8444-444444444442",
            page_number: 1,
            chunk_index: 0,
            section_heading: "Monitoring",
            snippet: "Lithium monitoring and toxicity safety-net source passage.",
            matched_terms: ["monitoring"],
            image_ids: [],
            score: 1.2,
          },
        ],
        pageHits: [1],
        hitCount: 2,
        strategy: "full_text_trigram_rpc",
        demoMode: true,
      },
    });
  });
  await page.route(/\/api\/documents\/([^/]+)\/signed-url(?:\?.*)?$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    const document = getDemoDocument(id);
    if (!document) {
      await route.fulfill({ status: 404, json: { error: "Demo document not found." } });
      return;
    }
    await route.fulfill({
      json: { url: document.storage_path, fileType: document.file_type, demoMode: true },
    });
  });
  await page.route(/\/api\/documents\/[^/]+\/summarize$/, async (route) => {
    await route.fulfill({
      json: {
        answer:
          "Key practical points: **clozapine** monitoring requires regular FBC/ANC checks and review of constipation, myocarditis symptoms, metabolic risk, and missed-dose restart rules.",
        grounded: true,
        confidence: "high",
        citations: [],
        sources: [],
        demoMode: true,
      },
    });
  });
  await page.route(/\/api\/documents\/([^/]+)(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").at(-1) ?? "";
    const selectedChunkId = url.searchParams.get("chunk");
    const payload = getDemoDocumentPayload(id, selectedChunkId);
    if (!payload) {
      await route.fulfill({ status: 404, json: { error: "Demo document not found." } });
      return;
    }
    if (selectedChunkId === "55555555-5555-4555-8555-555555555555") {
      await route.fulfill({
        json: {
          ...payload,
          document: {
            ...payload.document,
            title: "Synthetic patient safety plan",
            file_name: "patient-safety-plan.pdf",
          },
          pages: payload.pages.map((page) => ({
            ...page,
            text: `${page.text}\n\nPatient safety plan should include warning signs, coping strategies, supports, crisis contacts, and means restriction.`,
          })),
          chunks: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              document_id: id,
              page_number: 1,
              chunk_index: 2,
              section_heading: "Safety plan contents",
              content:
                "Patient safety plan should include warning signs, coping strategies, supports, crisis contacts, and means restriction.",
              image_ids: [],
            },
          ],
          demoMode: true,
        },
      });
      return;
    }
    const longSelectedPassage = selectedChunkId
      ? {
          ...payload,
          chunks: payload.chunks.map((chunk) =>
            chunk.id === selectedChunkId ? { ...chunk, content: Array(8).fill(chunk.content).join(" ") } : chunk,
          ),
        }
      : payload;
    await route.fulfill({ json: { ...longSelectedPassage, demoMode: true } });
  });
}

async function expectDomIntegrity(page: Page, options: { mobileNav?: boolean; mobileFabReady?: boolean } = {}) {
  const audit = await page.evaluate(() => {
    const duplicateIds = [...document.querySelectorAll("[id]")]
      .map((element) => element.id)
      .filter((id, index, all) => id && all.indexOf(id) !== index);
    const brokenAriaRefs: Array<{ attr: string; id: string }> = [];

    for (const element of [...document.querySelectorAll("[aria-labelledby],[aria-describedby],[aria-controls]")]) {
      for (const attr of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        for (const id of value.split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) brokenAriaRefs.push({ attr, id });
        }
      }
    }

    return {
      h1Count: document.querySelectorAll("h1,[role='heading'][aria-level='1']").length,
      duplicateIds: [...new Set(duplicateIds)],
      brokenAriaRefs,
      hasFrameworkOverlay: /Unhandled Runtime Error|Build Error|Application error|Next\.js/.test(
        document.body.innerText,
      ),
    };
  });

  expect(audit.h1Count).toBe(1);
  expect(audit.duplicateIds).toEqual([]);
  expect(audit.brokenAriaRefs).toEqual([]);
  expect(audit.hasFrameworkOverlay).toBe(false);

  if (options.mobileNav) {
    await expect(page.getByRole("navigation", { name: "Answer sections" })).toHaveCount(0);
    if (options.mobileFabReady) {
      await expect(page.getByTestId("mobile-section-fab-button")).toBeVisible();
      await expect(page.getByTestId("mobile-section-fab-menu")).toBeHidden();
    } else {
      await expect(page.getByTestId("mobile-section-fab-button")).toHaveCount(0);
      await expect(page.getByTestId("mobile-section-fab-menu")).toHaveCount(0);
    }
  }
}

// Scope opens from the command surface after answer submit and from the "+" menu on mode homes.
async function openScopeControl(page: Page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page
    .getByRole("listbox", { name: /search suggestions/i })
    .waitFor({ state: "hidden", timeout: 5_000 })
    .catch(() => undefined);

  const composer = page.locator('[aria-label^="Search indexed guidelines by question or keyword"]:visible').first();
  const bottomDock = page.locator("form.answer-footer-search-dock");
  if (await bottomDock.isVisible().catch(() => false)) {
    // Prior sheet/scroll interactions can leave the phone dock translated off-screen.
    // Restore it before opening scope so the click lands in the viewport.
    await scrollPrimarySurface(page, 0);
    await expect(bottomDock).not.toHaveAttribute("data-scroll-hidden", "true");
  }

  // If the composer is scrolled out of view on mobile, scroll the container to the top to reveal it
  await scrollPrimarySurface(page, 0);

  await composer.click();
  const scopeOption = page.getByRole("option", { name: /Scope sources/i });
  if (await scopeOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await scopeOption.click();
  } else {
    const actionMenu = page.getByRole("button", { name: "Open answer options" });
    await expect(actionMenu).toBeVisible();
    await waitForReactEventHandler(actionMenu, "onClick");
    await actionMenu.click();
    const actionsMenu = page.getByTestId("daily-actions-menu");
    await expect(actionsMenu).toBeVisible({ timeout: uiAssertionTimeoutMs });
    await actionsMenu.getByRole("button", { name: /^Scope\b/ }).click();
  }
  await expect(page.getByTestId("scope-command-popover")).toBeVisible({ timeout: uiAssertionTimeoutMs });
}

async function tapOutsideActiveSurface(page: Page) {
  const viewport = page.viewportSize() ?? { width: 390, height: 820 };
  await page.mouse.click(Math.max(1, viewport.width - 8), 8);
}

async function scrollMobileTableExpandClearOfFooter(page: Page, clinicalTable: Locator) {
  await clinicalTable.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const expand = document.querySelector('[data-testid="table-expand-button"]');
    const main = document.querySelector<HTMLElement>("main#main-content");
    const footer = document.querySelector(
      ".answer-footer-search-dock, .dashboard-composer-edge.answer-footer-search-edge",
    );
    if (!expand || !main) return;
    const mainOverflowY = window.getComputedStyle(main).overflowY;
    const mainOwnsScroll =
      ["auto", "scroll", "overlay"].includes(mainOverflowY) && main.scrollHeight > main.clientHeight;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const expandRect = expand.getBoundingClientRect();
      const footerTop = footer?.getBoundingClientRect().top ?? window.innerHeight;
      const currentOverlap = expandRect.bottom - footerTop + 24;
      if (currentOverlap <= 0) break;
      if (mainOwnsScroll) main.scrollTop += currentOverlap;
      else window.scrollBy({ top: currentOverlap, behavior: "auto" });
    }
  });
}

async function openMobileTableFullscreen(page: Page, clinicalTable: Locator) {
  await scrollMobileTableExpandClearOfFooter(page, clinicalTable);
  const expandButton = clinicalTable.getByTestId("table-expand-button");
  const tableDialog = page.getByTestId("table-fullscreen-dialog");
  await expect(expandButton).toBeVisible();
  await waitForReactEventHandler(expandButton, "onClick");
  await expandButton.click();
  await expect(tableDialog).toBeVisible({ timeout: 15_000 });
  return tableDialog;
}

async function openMobileClinicalGuideMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "Open PsychSift menu" });
  await expect(trigger).toBeVisible();
  await waitForReactEventHandler(trigger, "onClick");
  await trigger.click();

  const menu = page.getByRole("dialog", { name: "PsychSift" });
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  await expect(menu.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Search PsychSift" })).toBeVisible();
  await expect(menu.getByText("Recent chats", { exact: true })).toHaveCount(0);
  await expect(menu.getByText("Shortcuts", { exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Edit" })).toBeVisible();
  const navigation = menu.getByRole("navigation", { name: "Pinned shortcuts" });
  await expect(navigation).toBeVisible();
  expect(
    await navigation
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => ({ name: link.textContent, href: link.getAttribute("href") }))),
  ).toEqual([
    // Design review 2026-10-03, item 4: My Day leads the default shortcuts.
    { name: "My Day", href: "/my-day" },
    { name: "Answer", href: "/?mode=answer" },
    // Owner decision 2026-08-27: Documents joins the other consolidated modes and
    // links at the shared home. `/documents` still exists and still paints its
    // browse/recent workspace, but it is a second landing page — same subtitle,
    // different title — and reaching it from the sidebar read as the wrong screen.
    // It keeps its route and its inbound link from the Tools directory.
    // Medication also redirects now — through its own bespoke proxy fast-path
    // rather than the shared consolidatedModeHomePaths map, since /medications has
    // no /search sub-route (src/proxy.ts, medicationsHomeTarget()) — and the
    // pinned sidebar entry points straight at the shared home now too, matching
    // Documents/Services above (ClinicalSidebar.tsx).
    { name: "Documents", href: "/?mode=documents" },
    { name: "Services", href: "/?mode=services" },
    { name: "Medication", href: "/?mode=prescribing" },
    { name: "Factsheets", href: "/?mode=factsheets" },
    { name: "Tools", href: "/tools" },
  ]);
  await expect(navigation.getByRole("button", { name: "More modes" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Guide & help", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /^(Switch to )?(dark|light) mode$/i })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: /Appearance Auto/ })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(menu.getByText("Guest")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "PsychSift guide" })).toHaveCount(0);
  await expectNoPageHorizontalOverflow(page);
  return menu;
}

async function waitForDemoDashboardReady(page: Page) {
  await expect(visibleQuestionInput(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Open answer options" })).toBeVisible({ timeout: 30000 });
}

async function waitForPersistedAnswerThread(page: Page, minPriorTurns = 1) {
  await expect
    .poll(async () =>
      page.evaluate((storageKey) => {
        try {
          const raw = window.sessionStorage.getItem(storageKey);
          if (!raw) return 0;
          const parsed = JSON.parse(raw) as { priorTurns?: unknown[] };
          return Array.isArray(parsed.priorTurns) ? parsed.priorTurns.length : 0;
        } catch {
          return 0;
        }
      }, demoAnswerThreadStorageKey),
    )
    .toBeGreaterThanOrEqual(minPriorTurns);
}

async function openGuide(page: Page) {
  const dialog = page.getByRole("dialog", { name: "PsychSift guide" });
  const settings = accountSettingsDialog(page);
  const viewport = page.viewportSize();

  // Guide now lives inside Settings. If Settings is already open (e.g. after
  // closing Guide restores it), skip the reopen click that would hit the overlay.
  if (!(await settings.isVisible().catch(() => false))) {
    // A Settings trigger becomes visible before React attaches its handler, so a
    // single click is silently swallowed and the dialog never opens. Retry the
    // click together with the dialog it should produce, rather than asserting
    // visibility once — the same shape used for the composer and mode menu.
    await expect(async () => {
      // Idempotent by construction. If the dialog opened just after the inner
      // assertion's own deadline expired, `toPass` still schedules another
      // attempt; without this the attempt clicks a trigger the modal is already
      // covering (or reopens the phone menu on top of it) and the helper times
      // out under exactly the load it exists to tolerate.
      if (await settings.isVisible().catch(() => false)) return;
      if (viewport && viewport.width < 768) {
        // The swallowed click leaves the phone menu OPEN, so a retry that always
        // reopens would toggle it shut and then fail to find Settings inside it.
        // Reuse the open menu; only summon one when there is none.
        const openMenu = page.getByRole("dialog", { name: "PsychSift" });
        const menu = (await openMenu.isVisible().catch(() => false))
          ? openMenu
          : await openMobileClinicalGuideMenu(page);
        await menu.getByRole("button", { name: "Settings", exact: true }).click();
      } else if (viewport && viewport.width < 1024) {
        const rail = page.getByLabel("PsychSift collapsed sidebar");
        const railSettings = rail.getByRole("button", { name: "Settings", exact: true });
        await expect(railSettings).toBeVisible();
        await railSettings.click();
      } else {
        const sidebar = page.locator("#clinical-tools-sidebar");
        const settingsTrigger = (await sidebar.isVisible().catch(() => false))
          ? sidebar.getByRole("button", { name: "Settings", exact: true })
          : page.getByLabel("PsychSift collapsed sidebar").getByRole("button", { name: "Settings", exact: true });
        await expect(settingsTrigger).toBeVisible();
        await settingsTrigger.click();
      }
      await expect(settings).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: uiAssertionTimeoutMs });
  }

  await expect(settings).toBeVisible({ timeout: uiAssertionTimeoutMs });
  await settings.getByRole("button", { name: "Guide & help", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "How to verify an answer" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Verify an answer" })).toBeVisible();
  await expectNoPageHorizontalOverflow(page);
  return dialog;
}

function accountSettingsDialog(page: Page) {
  return page.getByRole("dialog", { name: "Account & app" });
}

function accountSetupDialog(page: Page) {
  return page.getByRole("dialog", { name: "Account setup" });
}

async function expectControlsBelowPhoneTopSafeArea(page: Page, controls: Locator[]) {
  const safeAreaTop = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top")),
  );
  expect(safeAreaTop).toBeGreaterThan(0);

  for (const control of controls) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(safeAreaTop);
  }
}

async function expectAccountSettingsSurface(settings: Locator, chrome: "desktop" | "phone") {
  await expect(settings.getByRole("heading", { name: "Account & app" })).toBeVisible();
  const subtitle = settings.getByText("Account and workspace preferences", { exact: true });
  const search = settings.getByRole("search");
  const navigation = settings.getByRole("navigation", { name: "Settings sections" });
  if (chrome === "desktop") {
    await expect(subtitle).toBeHidden();
    await expect(search).toBeVisible();
    await expect(navigation).toBeVisible();
  } else {
    await expect(subtitle).toBeVisible();
    await expect(search).toHaveCount(0);
    await expect(navigation).toHaveCount(0);
  }
  await expect(settings.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Clinical defaults", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "App preferences", exact: true })).toBeVisible();
  await expect(settings.getByTestId("settings-account-card")).toBeVisible();
  await expect(settings.getByTestId("settings-row-profile")).toHaveCount(0);
  await expect(settings.getByTestId("settings-row-jurisdiction")).toBeVisible();
  await expect(settings.getByTestId("settings-row-answer-style")).toBeVisible();
  await expect(settings.getByTestId("settings-row-appearance")).toBeVisible();
  await expect(settings.getByText("Saved on this device; not yet used in answers.")).toHaveCount(1);
  await expect(settings).not.toContainText(/admin|database|storage|source review|import pipeline/i);
}

async function expectMobileSettingsLayout(settings: Locator) {
  await expect(settings.getByRole("search")).toHaveCount(0);
  await expect(settings.getByRole("navigation", { name: "Settings sections" })).toHaveCount(0);
  const jurisdictionRow = settings.getByTestId("settings-row-jurisdiction");
  // The row carries two labels for one control, deliberately. The visible row
  // text is a `<label htmlFor>` so clicking it focuses the select, and the DS
  // `Select` keeps its own `sr-only` label because a field without one is not a
  // field; `aria-labelledby` points at the visible one, so the accessible name
  // is those words once rather than the two concatenated. This layout assertion
  // is about where the *visible* label sits, so it addresses that one by id
  // instead of by text.
  const label = jurisdictionRow.locator("#settings-jurisdiction-label");
  const control = jurisdictionRow.getByRole("combobox");
  const [rowBox, labelBox, controlBox] = await Promise.all([
    jurisdictionRow.boundingBox(),
    label.boundingBox(),
    control.boundingBox(),
  ]);

  expect(rowBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(controlBox).not.toBeNull();
  expect(controlBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height + 8);
  expect(controlBox!.x).toBeGreaterThanOrEqual(rowBox!.x);
  expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);

  // "Motion" joined this list on 2026-08-17: it became a three-option segmented
  // control (System / Reduced / Full) so an OS Reduce Motion request can be
  // explicitly overridden in-app, replacing the old boolean switch.
  for (const groupLabel of ["Answer style", "Appearance", "Interface density", "Default landing view", "Motion"]) {
    const row = settings.getByTestId(`settings-row-${groupLabel.toLowerCase().replaceAll(" ", "-")}`);
    const radios = row.getByRole("radiogroup", { name: groupLabel }).getByRole("radio");
    const radioBoxes = await radios.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        const text = element.querySelector("span");
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          textFits: text ? text.scrollWidth <= text.clientWidth + 1 : true,
        };
      }),
    );

    expect(radioBoxes).toHaveLength(3);
    expect(
      Math.max(...radioBoxes.map((box) => box.y)) - Math.min(...radioBoxes.map((box) => box.y)),
    ).toBeLessThanOrEqual(1);
    expect(radioBoxes.every((box) => box.height >= 48)).toBe(true);
    expect(radioBoxes.every((box) => box.textFits)).toBe(true);
    expect(radioBoxes[0].x + radioBoxes[0].width).toBeLessThanOrEqual(radioBoxes[1].x);
    expect(radioBoxes[1].x + radioBoxes[1].width).toBeLessThanOrEqual(radioBoxes[2].x);
  }

  // A switch row still has to hold the 48px tap target; "Recent searches on home"
  // is the nearest remaining boolean now that Motion is a segmented control.
  const switchBox = await settings
    .getByTestId("settings-row-recent-searches-on-home")
    .getByRole("switch")
    .boundingBox();
  expect(switchBox).not.toBeNull();
  expect(switchBox!.width).toBeGreaterThanOrEqual(48);
  expect(switchBox!.height).toBeGreaterThanOrEqual(48);
  await expect(settings.getByRole("button", { name: "Close settings" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Back from settings" })).toHaveCount(0);
}

async function expectAccountSetupSurface(setup: Locator) {
  await expect(setup.getByRole("heading", { name: "Continue to your workspace" })).toBeVisible();
  await expect(setup.getByRole("heading", { name: "Your workspace, wherever you work." })).toBeVisible();
  await expect(setup.getByLabel("Email address")).toBeVisible();
  await expect(setup.getByRole("button", { name: "Sign in with email" })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Continue with Apple" })).toBeEnabled();
  await expect(setup.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  await expect(setup.getByRole("button", { name: "Continue with Microsoft" })).toBeEnabled();
  await expect(setup.getByText(/Apple sign-in is not available/i)).toHaveCount(0);
  const accountSetupViewportWidth = await setup.evaluate(() => window.innerWidth);
  if (accountSetupViewportWidth >= 1024) {
    await expect(setup.getByText("Save favourites", { exact: true })).toBeVisible();
    await expect(setup.getByText(/Reopen trusted resources on any device/i)).toBeVisible();
    await expect(setup.getByText("Keep your clinical defaults", { exact: true })).toBeVisible();
    await expect(setup.getByText(/Your jurisdiction and answer style follow you/i)).toBeVisible();
    await expect(setup.getByText("Recent searches stay here", { exact: true })).toBeVisible();
    await expect(setup.getByText(/Browser activity does not sync to your account/i)).toBeVisible();
  } else {
    await expect(setup.getByText("Favourites sync", { exact: true })).toBeVisible();
    await expect(setup.getByText("Preferences sync", { exact: true })).toBeVisible();
    await expect(setup.getByText("Searches stay here", { exact: true })).toBeVisible();
  }
  const privacyLink = setup.getByRole("link", { name: "Privacy and data processing" });
  await expect(privacyLink).toBeVisible();
  await expect(privacyLink).toHaveAttribute("href", "/privacy");
  await expect(privacyLink.locator("xpath=..")).toContainText("Do not enter patient-identifiable information.");
}

async function expectAccountProviderLayout(setup: Locator, layout: "row" | "stack") {
  const providers = ["Apple", "Google", "Microsoft"].map((provider) =>
    setup.getByRole("button", { name: `Continue with ${provider}` }),
  );
  const boxes = await Promise.all(providers.map((provider) => provider.boundingBox()));
  expect(boxes.every(Boolean)).toBe(true);
  const [apple, google, microsoft] = boxes as NonNullable<(typeof boxes)[number]>[];

  // Chromium can report a CSS-enforced 48px minimum as 47.999… after layout
  // rounding. Keep the clinical touch-target contract while ignoring that
  // sub-hundredth-pixel measurement noise.
  expect(boxes.every((box) => box!.height >= 47.99)).toBe(true);

  // The same rounding reaches the ADJACENCY checks below, which are the ones that
  // read a sum of two measured floats against a third. CI measured a 0.578px
  // overlap here on 2026-09-16 and failed the stacked branch; nothing is visibly
  // overlapping at that size, and the alignment and equal-width assertions beside
  // these already allow the same 1px. What these assert is order and the absence
  // of a real overlap, so the tolerance must not grow past one device pixel.
  const adjacencyTolerance = 1;
  if (layout === "row") {
    expect(Math.max(apple.y, google.y, microsoft.y) - Math.min(apple.y, google.y, microsoft.y)).toBeLessThanOrEqual(1);
    expect(apple.x + apple.width).toBeLessThanOrEqual(google.x + adjacencyTolerance);
    expect(google.x + google.width).toBeLessThanOrEqual(microsoft.x + adjacencyTolerance);
    expect(
      Math.max(apple.width, google.width, microsoft.width) - Math.min(apple.width, google.width, microsoft.width),
    ).toBeLessThanOrEqual(1);
    return;
  }

  expect(apple.y + apple.height).toBeLessThanOrEqual(google.y + adjacencyTolerance);
  expect(google.y + google.height).toBeLessThanOrEqual(microsoft.y + adjacencyTolerance);
  expect(
    Math.max(apple.width, google.width, microsoft.width) - Math.min(apple.width, google.width, microsoft.width),
  ).toBeLessThanOrEqual(1);
}

async function expectDocumentUploadUnavailable(page: Page) {
  const menu = await openDailyActions(page);
  await expect(menu.getByRole("button", { name: /Add document|Upload PDF/ })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

async function dismissOverlayByHeaderClick(page: Page) {
  // Portaled integrated action menus cover the hero composer; avoid fixed viewport
  // coordinates that can hit menu tiles (e.g. Clinical tools -> tools mode).
  await page.locator("#search").click({ position: { x: 120, y: 28 } });
}

async function openDailyActions(page: Page, triggerName: string | RegExp = /^Open .+ options$/) {
  const trigger = page.getByRole("button", { name: triggerName });
  const menu = page.getByTestId("daily-actions-menu");

  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  await waitForReactEventHandler(trigger, "onClick");
  await trigger.click();
  await expect(menu).toBeVisible({ timeout: uiAssertionTimeoutMs });

  return menu;
}

test.beforeEach(stubZeroTouchPoints);

test.describe("PsychSift UI smoke coverage", () => {
  test.describe.configure({ timeout: 60000 });

  test("Supabase connection hints reach the document head without provider traffic", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const preconnect = page.locator('head link[rel="preconnect"][href="http://127.0.0.1:1"]');
    const dnsPrefetch = page.locator('head link[rel="dns-prefetch"][href="http://127.0.0.1:1"]');

    await expect(preconnect).toHaveCount(1);
    await expect(preconnect).toHaveAttribute("crossorigin", "anonymous");
    await expect(dnsPrefetch).toHaveCount(1);
  });

  for (const viewport of dashboardViewports) {
    test(`dashboard loads without page overflow at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockPrivateUnauthenticatedApi(page);
      await gotoApp(page, "/");
      await waitForDemoDashboardReady(page);

      await expect(page.getByRole("heading", { level: 1, name: "PsychSift" })).toHaveCount(1);
      await expect(page.getByRole("heading", { name: "Clinical Answers", exact: true })).toBeVisible();
      await expect(visibleQuestionInput(page)).toBeVisible();
      await expect(page.getByRole("button", { name: "Generate source-backed answer" })).toHaveText(/^\s*Ask\s*$/);
      const headerHeight = await page.locator("#search").evaluate((element) => element.getBoundingClientRect().height);
      expect(headerHeight).toBeLessThanOrEqual(viewport.width >= 640 ? 185 : 180);
      await expect(page.getByRole("button", { name: "Open answer options" })).toBeVisible();
      await expect(page.getByTestId("scope-command-popover")).toBeHidden();
      await expect(page.getByTestId("scope-prompts-drawer")).toHaveCount(0);
      await expect(page.getByTestId("mobile-scope-popover")).toHaveCount(0);
      await expectDomIntegrity(page, { mobileNav: viewport.width <= 768 });
      if (viewport.width <= 768) {
        await expect(page.getByTestId("mobile-section-fab-button")).toHaveCount(0);
      }
      if (viewport.width < 640) {
        const dailyActionsTrigger = page.getByRole("button", { name: "Open answer options" });
        const dailyActions = await openDailyActions(page);
        const searchAction = dailyActions.getByRole("button", { name: "Search sources", exact: true });
        await expect(searchAction).toBeVisible();
        await expect(dailyActions.getByRole("button", { name: "View evidence" })).toBeVisible();
        await expectMinTouchTarget(searchAction);
        await expect(page.getByRole("dialog", { name: "PsychSift guide" })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(dailyActions).toBeHidden();
        await expect(dailyActionsTrigger).toBeFocused();
      }
      await expectNoPageHorizontalOverflow(page);
    });
  }

  test("anonymous user can see enabled live search without a forced sign-in gate @critical", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockPrivateUnauthenticatedApi(page);
    await page.route(/\/api\/search(?:\?.*)?$/, async (route) => {
      await route.fulfill({ json: { results: [], telemetry: { retrieval_strategy: "text_fast_path" } } });
    });
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await expect(page.getByText("Create your PsychSift account")).toHaveCount(0);
    await expect(page.getByText("Search request was not authorized by the server.")).toHaveCount(0);
    await expect(page.locator('[data-testid="global-search-input"]:visible').first()).toBeEnabled();
  });

  test("anonymous mobile user can search without a forced sign-in gate", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockPrivateUnauthenticatedApi(page);
    await page.route(/\/api\/search(?:\?.*)?$/, async (route) => {
      await route.fulfill({ json: { results: [], telemetry: { retrieval_strategy: "text_fast_path" } } });
    });
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await expect(page.getByText("Create your PsychSift account")).toHaveCount(0);
    await expect(page.getByText("Service unavailable")).toHaveCount(0);
    await expect(page.getByText("API unavailable")).toHaveCount(0);
    await expect(page.getByText("Search request was not authorized by the server.")).toHaveCount(0);
    await expect(page.locator('[data-testid="global-search-input"]:visible').first()).toBeEnabled();
  });

  test("Medication shortcut opens the shared Medication home", async ({ page }) => {
    // Medication was reversed out of its standalone `/medications` home (see
    // src/app/(search-app)/medications/page.tsx) so its idle view is now the shared
    // home, matching the other consolidated modes and Documents.
    await page.setViewportSize({ width: 390, height: 820 });
    await mockPrivateUnauthenticatedApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const menu = await openMobileClinicalGuideMenu(page);
    await menu.getByRole("link", { name: "Medication" }).click();

    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/");
    await expect.poll(() => new URL(page.url()).searchParams.get("mode"), { timeout: 30_000 }).toBe("prescribing");
    await expect(page.getByTestId("shared-home-empty-state")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mode Medication" })).toBeVisible();
  });

  test("mobile search focus is singular, visible, and contained at clipped edges", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockPrivateUnauthenticatedApi(page);
    await gotoApp(page, "/?mode=answer");
    await waitForDemoDashboardReady(page);

    const universalInput = visibleQuestionInput(page);
    const restingPill = await universalInput.evaluate((element) => {
      const pill = element.closest(".answer-footer-search-pill");
      if (!pill) return { border: null, shadow: null };
      const style = getComputedStyle(pill);
      return { border: style.borderColor, shadow: style.boxShadow };
    });
    await universalInput.focus();
    // Poll until the pill owns focus chrome. Firefox can still report the resting
    // border for a frame after programmatic focus even when `:focus-within` has
    // matched; the focus owner is the pill border + accent halo, not the input outline.
    await expect
      .poll(async () => {
        return universalInput.evaluate((element, resting) => {
          const inputStyle = getComputedStyle(element);
          const pill = element.closest(".answer-footer-search-pill");
          const pillStyle = pill ? getComputedStyle(pill) : null;
          const pillBorder = pillStyle?.borderColor ?? null;
          const pillShadow = pillStyle?.boxShadow ?? null;
          return {
            inputOutline: inputStyle.outlineStyle,
            inputShadow: inputStyle.boxShadow,
            pillBorder,
            pillShadow,
            pillBorderChanged: pillBorder !== resting.border,
            pillShadowChanged: pillShadow !== resting.shadow && pillShadow !== "none",
          };
        }, restingPill);
      })
      .toMatchObject({
        inputOutline: "none",
        inputShadow: "none",
        pillBorderChanged: true,
        pillShadowChanged: true,
      });
    const universalFocus = await universalInput.evaluate((element) => {
      const inputStyle = getComputedStyle(element);
      const pill = element.closest(".answer-footer-search-pill");
      const pillStyle = pill ? getComputedStyle(pill) : null;
      return {
        inputOutline: inputStyle.outlineStyle,
        inputShadow: inputStyle.boxShadow,
        pillBorder: pillStyle?.borderColor ?? null,
        pillShadow: pillStyle?.boxShadow ?? null,
      };
    });
    expect(universalFocus.pillBorder).not.toBe(restingPill.border);
    expect(universalFocus.pillShadow).not.toBe("none");
    expect(universalFocus.pillShadow).not.toBe(restingPill.shadow);

    const menu = await openMobileClinicalGuideMenu(page);
    const closeMenu = menu.getByRole("button", { name: "Close PsychSift menu" });
    const newChat = menu.getByRole("button", { name: "New chat" });
    const restingButtonShadow = await newChat.evaluate((element) => getComputedStyle(element).boxShadow);
    await closeMenu.focus();
    await page.keyboard.press("Tab");
    // Firefox includes scrollable containers in the tab order; the sheet body
    // (overflow-y-auto) sits between Close and "New chat" in DOM order and
    // genuinely overflows at this viewport. Step over it when focused.
    const onScrollableBody = await page.evaluate(() => {
      const element = document.activeElement;
      return element instanceof HTMLElement && element.classList.contains("overflow-y-auto");
    });
    if (onScrollableBody) await page.keyboard.press("Tab");
    await expect(newChat).toBeFocused();
    const buttonFocus = await newChat.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
    });
    expect(buttonFocus.outlineStyle).toBe("solid");
    expect(buttonFocus.boxShadow).toBe(restingButtonShadow);

    const guideSearch = menu.getByRole("button", { name: "Search PsychSift" });
    await guideSearch.focus();
    const fieldFocus = await guideSearch.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const outlineWidth = Number.parseFloat(style.outlineWidth);
      const outlineOffset = Number.parseFloat(style.outlineOffset);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth,
        outlineOffset,
        paintedTop: rect.top - outlineOffset - outlineWidth,
        paintedRight: rect.right + outlineOffset + outlineWidth,
        paintedBottom: rect.bottom + outlineOffset + outlineWidth,
        paintedLeft: rect.left - outlineOffset - outlineWidth,
        rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      };
    });
    expect(fieldFocus.outlineStyle).toBe("solid");
    expect(fieldFocus.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(fieldFocus.outlineOffset).toBeLessThan(0);
    expect(fieldFocus.paintedTop).toBeGreaterThanOrEqual(fieldFocus.rect.top);
    expect(fieldFocus.paintedRight).toBeLessThanOrEqual(fieldFocus.rect.right);
    expect(fieldFocus.paintedBottom).toBeLessThanOrEqual(fieldFocus.rect.bottom);
    expect(fieldFocus.paintedLeft).toBeGreaterThanOrEqual(fieldFocus.rect.left);
    await guideSearch.click();
    await expect(menu).toHaveCount(0);
    await expect(visibleQuestionInput(page)).toBeFocused();
    await expectNoPageHorizontalOverflow(page);
  });

  test("desktop sidebar defaults to the collapsed state for new users", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/?mode=answer");
    await waitForDemoDashboardReady(page);

    // No stored preference (PT-10): the collapsed icon rail is the default,
    // so first-run desktop shows the collapsed rail, not the labelled panel;
    // expanding is remembered. #clinical-tools-sidebar only mounts when
    // expanded, so its absence (not just hidden) is the collapsed signal.
    await expect(page.getByLabel("PsychSift collapsed sidebar")).toBeVisible();
    await expect(page.locator("#clinical-tools-sidebar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toHaveCount(0);
  });

  test("desktop sidebar mode sync and accessibility affordances stay coherent", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    // This journey starts from the collapsed rail (now the default for new
    // users too) and exercises expanding/collapsing it.
    await page.addInitScript(() => window.localStorage.setItem("clinical-kb-sidebar-collapsed", "1"));
    await gotoApp(page, "/?mode=tools");

    const sidebar = page.locator("#clinical-tools-sidebar");
    const modeButton = page.getByRole("button", { name: "Mode Tools" });
    await expect(modeButton).toBeVisible();
    const selectedToolSheet = page.getByRole("dialog", { name: "Risk & Safety" });
    if (await isVisibleWithoutThrow(selectedToolSheet)) {
      await selectedToolSheet.getByRole("button", { name: "Close Risk & Safety" }).click();
      await expect(selectedToolSheet).toBeHidden();
    }
    const expandSidebar = page.getByRole("button", { name: "Expand sidebar" });
    await expect(expandSidebar).toBeVisible();
    await expectMinTouchTarget(expandSidebar);
    await expect(page.getByTestId("collapsed-account-settings")).toHaveAccessibleName(
      /G Guest Not signed in\. Set up workspace/,
    );
    await expect(sidebar).toHaveCount(0);
    await expandSidebar.click();
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "View tools" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Tools", exact: true })).toHaveAttribute("href", "/tools");
    await expect(sidebar.getByTestId("sidebar-account-settings")).toHaveAccessibleName(
      /G Guest Not signed in\. Set up workspace/,
    );

    const collapseSidebar = page.getByRole("button", { name: "Collapse sidebar" });
    const guideSearch = sidebar.getByRole("button", { name: "Search PsychSift" });
    await expect(guideSearch).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
    await guideSearch.click();
    await expect(page).toHaveURL(/\/\?mode=answer&focus=1$/);
    await expect(visibleQuestionInput(page)).toBeFocused();
    await collapseSidebar.focus();
    await page.keyboard.press("Control+K");
    await expect(visibleQuestionInput(page)).toBeFocused();

    await expectMinTouchTarget(collapseSidebar);
    await collapseSidebar.click();
    await expect(page.getByTestId("collapsed-account-settings")).toHaveAccessibleName(
      /G Guest Not signed in\. Set up workspace/,
    );

    await expandSidebar.click();
    await sidebar.getByRole("link", { name: "Answer", exact: true }).click();
    await expect(page).toHaveURL(/\/\?mode=answer$/);
    await expect(page.getByRole("button", { name: "Mode Answer" })).toBeVisible();
    await expect(page.getByTestId("answer-section-heading")).toHaveText("Answer");
    await expect(page.getByRole("heading", { name: "Clinical Answers", exact: true })).toBeVisible();
  });

  test("sidebar shortcuts switch mode in place, on the shared home and after an answer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await page.addInitScript(() => window.localStorage.setItem("clinical-kb-sidebar-collapsed", "0"));
    await gotoApp(page, "/?mode=answer");
    await waitForDemoDashboardReady(page);
    const sidebar = page.locator("#clinical-tools-sidebar");
    await expect(sidebar).toBeVisible();
    const documentsShortcut = sidebar.getByRole("link", { name: "Documents", exact: true });

    // On the shared home a shortcut is the mode pill's in-place switch: the URL
    // is rewritten and the mode flips with no navigation request at all.
    const navigationRequests: string[] = [];
    page.on("request", (request) => {
      const headers = request.headers();
      if (headers["rsc"] !== "1") return;
      // Next 16 does NOT mark every prefetch with `next-router-prefetch: 1`.
      // `fetchSegmentPrefetchesUsingDynamicRequest` in
      // node_modules/next/dist/client/components/segment-cache/cache.js sets the
      // header per fetch strategy — `1` loading-boundary, `2` PPR-runtime, `3`
      // runtime-shell — and for `FetchStrategy.Full` it sets NO header at all.
      // A `!== "1"` test therefore reads strategies 2 and 3 as navigations.
      if (headers["next-router-prefetch"] !== undefined) return;
      // A Full-strategy prefetch carries the same headers as a navigation, so
      // headers alone cannot separate them. Scope by route instead, which is
      // what this test actually asks: an in-place mode switch must not fetch
      // the page it is switching to, and every mode here lives on the shared
      // home. The sidebar deliberately prefetches /tools (the one link with
      // `prefetch` plus focus/pointer warming, because Tools is browse-first
      // and opens its own directory route) — a different route, and not a
      // navigation caused by this click.
      if (new URL(request.url()).pathname !== "/") return;
      navigationRequests.push(request.url());
    });
    await documentsShortcut.click();
    await expect(page.getByRole("button", { name: "Mode Documents" })).toBeVisible();
    await expect(page).toHaveURL(/\/\?mode=documents$/);
    await expect(documentsShortcut).toHaveAttribute("aria-current", "page");
    expect(navigationRequests).toEqual([]);

    await sidebar.getByRole("link", { name: "Answer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Mode Answer" })).toBeVisible();
    await expect(page).toHaveURL(/\/\?mode=answer$/);
    expect(navigationRequests).toEqual([]);

    // After an answer the dashboard is off the shared home. The shortcut must
    // still land on the mode it names: the submission left the UI-change flag
    // raised, and the URL sync used to mistake the next navigation for a UI
    // change and skip it — URL on Documents, header and answer still on Answer.
    const question = "What clozapine monitoring items are shown in the table image?";
    await fillVisibleQuestionInput(page, question);
    await visibleAnswerSubmitButton(page).click();
    await expect(page.getByTestId("plain-answer-response")).toBeVisible();
    await expect(page).toHaveURL(/run=1/);

    await documentsShortcut.click();
    await expect(page.getByRole("button", { name: "Mode Documents" })).toBeVisible();
    await expect(page).toHaveURL(/\/\?mode=documents/);
    await expect(documentsShortcut).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("plain-answer-response")).toHaveCount(0);
  });

  test("tablet shows icon rail without drawer trigger or expand control @critical", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await mockDemoApi(page);
    // Seed expanded preference so #clinical-tools-sidebar mounts. Without this
    // seed the panel is absent (count 0) and toBeHidden() would pass vacuously;
    // we need the remembered-expanded path where the panel exists but stays
    // display:none below lg while tablet still only presents the icon rail.
    await page.addInitScript(() => window.localStorage.setItem("clinical-kb-sidebar-collapsed", "0"));
    await gotoApp(page, "/?mode=answer");
    await waitForDemoDashboardReady(page);

    await expect(page.getByRole("button", { name: "Open PsychSift menu" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toHaveCount(0);
    await expect(page.locator("#clinical-tools-sidebar")).toBeHidden();
    await expect(page.getByLabel("PsychSift collapsed sidebar")).toBeVisible();

    const rail = page.getByLabel("PsychSift collapsed sidebar");
    const scrollRegion = rail.getByTestId("collapsed-sidebar-scroll-region");
    const navigation = rail.getByRole("navigation", { name: "Pinned shortcuts" });
    const library = rail.getByRole("navigation", { name: "Your library" });
    await expect(rail.getByRole("button", { name: "New chat" })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(scrollRegion.getByRole("button", { name: "New chat" })).toHaveCount(0);
    await expect(scrollRegion.getByRole("button", { name: "Settings" })).toHaveCount(0);
    expect(
      await navigation
        .getByRole("link")
        .evaluateAll((links) =>
          links.map((link) => ({ name: link.getAttribute("aria-label"), href: link.getAttribute("href") })),
        ),
    ).toEqual([
      { name: "My Day", href: "/my-day" },
      { name: "Answer", href: "/?mode=answer" },
      { name: "Documents", href: "/?mode=documents" },
      { name: "Services", href: "/?mode=services" },
      { name: "Medication", href: "/?mode=prescribing" },
      { name: "Factsheets", href: "/?mode=factsheets" },
      { name: "Tools", href: "/tools" },
    ]);
    expect(
      await library
        .getByRole("link")
        .evaluateAll((links) =>
          links.map((link) => ({ name: link.getAttribute("aria-label"), href: link.getAttribute("href") })),
        ),
    ).toEqual([{ name: "Favourites", href: "/favourites" }]);
    // Specialist mode homes open from a single "More modes" control (sheet), not
    // an always-visible six-link rail group — the mode pill only retargets the
    // composer.
    await expect(rail.getByTestId("sidebar-more-modes")).toBeVisible();
    await expect(page.getByRole("link", { name: "Differentials", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Therapy", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Medication", exact: true })).toHaveCount(1);
    await rail.getByTestId("sidebar-more-modes").click();
    const moreModesSheet = page.getByTestId("sidebar-more-modes-sheet");
    await expect(moreModesSheet).toBeVisible();
    await expect(moreModesSheet.getByRole("navigation", { name: "More modes" })).toBeVisible();
    await expect(moreModesSheet.getByRole("link", { name: "Differentials", exact: true })).toBeVisible();
    await expect(moreModesSheet.getByRole("link", { name: "Therapy", exact: true })).toBeVisible();
    await moreModesSheet.getByRole("button", { name: "Pin Forms" }).click();
    await moreModesSheet.getByRole("button", { name: "Move Forms up" }).click();
    await moreModesSheet.getByRole("button", { name: "Close more modes" }).click();
    expect(
      await navigation.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("aria-label"))),
    ).toEqual(["My Day", "Answer", "Documents", "Services", "Medication", "Factsheets", "Forms", "Tools"]);
    await expect(rail.getByTestId("sidebar-more-modes")).toBeVisible();
    await expect(rail.getByTestId("sidebar-more-modes")).toBeFocused();

    await expectNoPageHorizontalOverflow(page);
  });

  test("tablet rail highlights the active tool for key routes", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await mockDemoApi(page);

    for (const route of [
      { path: "/?mode=answer", label: "Answer" },
      { path: "/documents", label: "Documents" },
      { path: "/favourites", label: "Favourites" },
      { path: "/medications", label: "Medication" },
      { path: "/tools", label: "Tools" },
    ] as const) {
      await gotoApp(page, route.path);
      if (route.path.includes("mode=answer")) {
        await waitForDemoDashboardReady(page);
      }

      const activeLink = page.getByRole("link", { name: route.label, exact: true });
      await expect(activeLink).toBeVisible();
      await expect(activeLink).toHaveAttribute("aria-current", "page");
    }
  });

  test("served response headers do not block cross-origin Supabase images", async ({ page }) => {
    // Regression guard for the "all images fail to render" incident: document
    // page images load cross-origin from Supabase Storage signed URLs. A
    // Cross-Origin-Embedder-Policy: require-corp header (or a CSP that drops
    // the *.supabase.co image origin) silently breaks every image
    // while all other tests still pass. Assert the actual served headers.
    const response = await page.request.get("/");
    expect(response.status()).toBe(200);
    const headers = response.headers();

    expect(headers["cross-origin-embedder-policy"]).toBeUndefined();

    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("img-src");
    const imgSrc = csp.split(";").find((directive) => directive.trim().startsWith("img-src"));
    expect(imgSrc).toContain("https://*.supabase.co");
    expect(imgSrc?.trim().split(/\s+/)).not.toContain("https:");
    expect(csp).toContain("https://*.supabase.co");
  });

  /*
   * The Documents half of the same defect. `/documents` redirects to the shared
   * home, and `documents/page.tsx` records the idle Documents view as deliberately
   * retired — but clearing the composer on a submitted search left `run=1` in the
   * URL, so the shared home stayed suppressed and DocumentSearchResultsPanel fell
   * back to that retired "Start here" home (`document-search-empty-state`).
   */
  test("clearing a documents search returns the shared home, never the retired Start here view", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/documents/search?q=lithium+monitoring&run=1");

    await page
      .getByRole("button", { name: /clear search question|clear search/i })
      .first()
      .click();

    await expect(page).toHaveURL(/\/\?mode=documents&focus=1$/);
    await expect(page.getByTestId("shared-home-empty-state")).toBeVisible();
    await expect(page.getByTestId("document-search-empty-state")).toHaveCount(0);
  });

  test("static agent guidance is available and documents mode avoids the app error boundary", async ({ page }) => {
    const llms = await page.request.get("/llms.txt");
    expect(llms.status()).toBe(200);
    const llmsText = await llms.text();
    expect(llmsText).toContain(BRAND_NAME);
    expect(llmsText).toContain("rely on cited source evidence");

    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    // The Documents workspace lives at its search route since consolidation, and
    // the dashboard only mounts it for a submitted query; `/documents` itself
    // redirects to the shared home.
    await gotoApp(page, "/documents/search?q=lithium+monitoring&run=1");
    await expect(page.getByRole("button", { name: "Mode Documents" })).toBeVisible();
    await expect(page.getByTestId("document-search-workspace")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  });

  test("account setup opens from desktop sidebar account affordances while settings stays separate", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    // Exercises both collapsed and expanded account affordances; seed collapsed
    // explicitly (also the new-user default) so the journey starts on the rail.
    await page.addInitScript(() => window.localStorage.setItem("clinical-kb-sidebar-collapsed", "1"));
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const settings = accountSettingsDialog(page);
    const setup = accountSetupDialog(page);
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.locator("#clinical-tools-sidebar")).toBeVisible();
    await page.locator("#clinical-tools-sidebar").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings).toBeVisible();
    await expectAccountSettingsSurface(settings, "desktop");
    await expectNoPageHorizontalOverflow(page);

    await settings.getByRole("button", { name: "Close settings" }).click();
    await expect(settings).toBeHidden();

    await page.locator("#clinical-tools-sidebar").getByTestId("sidebar-account-settings").click();
    await expect(setup).toBeVisible();
    await expectAccountSetupSurface(setup);
    await expectAccountProviderLayout(setup, "row");
    await expectNoPageHorizontalOverflow(page);
    await setup.getByRole("button", { name: "Close account setup" }).click();
    await expect(setup).toBeHidden();

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.getByTestId("collapsed-account-settings").click();
    await expect(setup).toBeVisible();
    await expectAccountSetupSurface(setup);
  });

  test("desktop settings restores search and section navigation while keeping one scroll owner", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    // Sidebar defaults to collapsed for new users; expand so the in-rail Settings
    // control this journey asserts is reachable (same as the account-setup case).
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.locator("#clinical-tools-sidebar")).toBeVisible();

    const settings = accountSettingsDialog(page);
    await page.locator("#clinical-tools-sidebar").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings).toBeVisible();
    await expectAccountSettingsSurface(settings, "desktop");

    for (const width of [768, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(settings.getByRole("search")).toBeVisible();
      await expect(settings.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
      await expectNoPageHorizontalOverflow(page);
    }

    const rail = settings.getByRole("navigation", { name: "Settings sections" });
    const search = settings.getByTestId("settings-search-input");
    await search.fill("dark mode");
    await expect(settings.getByTestId("settings-row-appearance")).toBeVisible();
    await expect(settings.getByTestId("settings-row-jurisdiction")).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "App preferences", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(settings.getByTestId("settings-row-jurisdiction")).toBeVisible();

    const close = settings.getByRole("button", { name: "Close settings" });
    const port = settings.getByTestId("settings-scroll-port");

    const scrollState = async () =>
      port.evaluate((element) => {
        const panel = element.parentElement;
        return {
          portScrollable: element.scrollHeight > element.clientHeight,
          panelClipped: panel ? panel.scrollHeight > panel.clientHeight : true,
        };
      });

    // The settings column owns the overflow; the two-column panel never becomes
    // a second clipped scroll container.
    expect(await scrollState()).toEqual({ portScrollable: true, panelClipped: false });

    await rail.getByRole("button", { name: "Help & About", exact: true }).click();
    await expect(rail.getByRole("button", { name: "Help & About", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(rail).toBeInViewport();
    await expect(close).toBeInViewport();
    expect((await scrollState()).panelClipped).toBe(false);

    await close.click();
    await expect(settings).toBeHidden();
  });

  test("account settings stays readable at narrow phone widths and closes from its single control or Escape", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockDemoApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const settings = accountSettingsDialog(page);
    const setup = accountSetupDialog(page);
    const menu = await openMobileClinicalGuideMenu(page);
    await menu.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expectAccountSettingsSurface(settings, "phone");
    const settingsBox = await settings.boundingBox();
    const viewport = await page.evaluate(() => ({
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight,
    }));
    const fullscreenTolerance = 16;
    expect(settingsBox).not.toBeNull();
    expect(settingsBox!.x).toBeGreaterThanOrEqual(-1);
    expect(settingsBox!.y).toBeLessThanOrEqual(fullscreenTolerance);
    expect(settingsBox!.width + fullscreenTolerance).toBeGreaterThanOrEqual(viewport.width);
    expect(settingsBox!.height + fullscreenTolerance).toBeGreaterThanOrEqual(viewport.height);
    await expectMobileSettingsLayout(settings);
    await expectNoPageHorizontalOverflow(page);

    await page.setViewportSize({ width: 320, height: 820 });
    await expectMobileSettingsLayout(settings);
    await expectNoPageHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 820 });
    await expectMobileSettingsLayout(settings);
    await expectNoPageHorizontalOverflow(page);

    await page.setViewportSize({ width: 430, height: 820 });
    await expectMobileSettingsLayout(settings);
    await expectNoPageHorizontalOverflow(page);

    await page.setViewportSize({ width: 639, height: 820 });
    await expectMobileSettingsLayout(settings);
    await expectNoPageHorizontalOverflow(page);

    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    const reducedMotionDuration = await settings
      .locator("header")
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(Number.parseFloat(reducedMotionDuration)).toBeLessThanOrEqual(0.001);
    expect(
      await settings.getByRole("button", { name: "Close settings" }).evaluate((element) => {
        return getComputedStyle(element).borderStyle;
      }),
    ).not.toBe("none");
    await expectNoPageHorizontalOverflow(page);
    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });

    await settings.getByRole("button", { name: "Close settings" }).click();
    await expect(settings).toBeHidden();
    await page.setViewportSize({ width: 390, height: 820 });
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-top", "59px");
    });

    const escapeMenu = await openMobileClinicalGuideMenu(page);
    await escapeMenu.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();

    const accountMenu = await openMobileClinicalGuideMenu(page);
    await accountMenu.getByTestId("sidebar-account-settings").click();
    await expect(accountMenu).toHaveCount(0);
    await expect(setup).toBeVisible();
    await expectAccountSetupSurface(setup);
    await expectAccountProviderLayout(setup, "stack");
    await expect(setup.getByLabel("Email address")).toBeFocused();
    const setupClose = setup.getByRole("button", { name: "Close account setup" });
    const workspaceMark = setup.getByTestId("account-workspace-mark");
    const setupScrollPort = setup.locator(".polished-scroll");
    // WebKit scrolls the dialog to the focused email field on open. Prove the
    // autofocus first, then reset that scroll before checking top safe-area layout.
    await setup.getByLabel("Email address").blur();
    await setupScrollPort.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expectControlsBelowPhoneTopSafeArea(page, [setupClose, workspaceMark]);
    const setupBox = await setup.boundingBox();
    expect(setupBox).not.toBeNull();
    expect(setupBox!.x).toBeGreaterThanOrEqual(-1);
    expect(setupBox!.width + fullscreenTolerance).toBeLessThanOrEqual(viewport.width + fullscreenTolerance);
    await expectNoPageHorizontalOverflow(page);

    // With focus released, resizing now checks layout instead of WebKit's
    // focus-follow scrolling of the dialog body.
    for (const viewportSize of [
      { width: 320, height: 700 },
      { width: 430, height: 820 },
      { width: 639, height: 820 },
    ]) {
      await page.setViewportSize(viewportSize);
      await setupScrollPort.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expectControlsBelowPhoneTopSafeArea(page, [setupClose, workspaceMark]);
      await expectNoPageHorizontalOverflow(page);
    }

    await page.setViewportSize({ width: 320, height: 700 });
    const setupEmail = setup.getByLabel("Email address");
    const emailSubmit = setup.getByRole("button", { name: "Sign in with email" });
    // Scroll to the lower of the pair. Scrolling to the field only worked where the engine centres
    // it (Chromium); WebKit scrolls to the nearest edge and leaves the button just below the fold.
    await emailSubmit.scrollIntoViewIfNeeded();
    await expect(setupEmail).toBeInViewport();
    await expect(emailSubmit).toBeInViewport();
    await expect(setupClose).toBeInViewport();
    await expectNoPageHorizontalOverflow(page);

    await setupScrollPort.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(setup.getByRole("link", { name: "Privacy and data processing" })).toBeInViewport();
    await expect(setupClose).toBeInViewport();

    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    expect(await setup.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
    expect(
      await setup.getByRole("button", { name: "Continue with Google" }).evaluate((element) => {
        return getComputedStyle(element).borderStyle;
      }),
    ).not.toBe("none");
    await expectNoPageHorizontalOverflow(page);

    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expect(setupClose).toBeInViewport();
    await expectNoPageHorizontalOverflow(page);
  });

  test("unsafe local caller disables the demo composer when private endpoints are mocked", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    const answerRequests: string[] = [];
    const unsafeLocalProjectPayload = {
      appName: "PsychSift",
      projectId: "test-project",
      identityPath: "/api/local-project-id",
      localServer: {
        currentUrl: "http://localhost:4298",
        currentPort: 4298,
        projectPortStart: 4298,
        projectPortEnd: 53210,
        safeLocalOrigin: false,
        requestOrigin: null,
        requestReferer: null,
        unsafeLocalCaller: "http://localhost:3000",
      },
    };
    await mockPrivateUnauthenticatedApi(page);
    await page.route(/\/api\/local-project-id$/, async (route) => {
      await route.fulfill({ json: unsafeLocalProjectPayload });
    });
    await page.route(/\/api\/answer(?:\/stream)?(?:\?.*)?$/, async (route) => {
      answerRequests.push(route.request().url());
      await route.fulfill({ status: 401, json: { error: "Authentication required." } });
    });
    await gotoApp(page, "/");

    const questionInput = page.locator('[aria-label^="Search indexed guidelines by question or keyword"]:visible');
    const submitAnswer = page.getByRole("button", { name: "Generate source-backed answer" });
    await expect(questionInput).toBeDisabled();
    await expect(submitAnswer).toBeDisabled();
    await expect(page.getByTestId("answer-grounding-chip")).toHaveCount(0);
    expect(answerRequests).toEqual([]);
    await expect(page.getByRole("heading", { level: 1, name: "PsychSift" })).toBeVisible();
    await expectDomIntegrity(page, { mobileNav: true, mobileFabReady: false });
    await expectNoPageHorizontalOverflow(page);
  });

  test("desktop mode options close when clicking outside or opening scope", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockPrivateUnauthenticatedApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const dailyActionsTrigger = page.getByRole("button", { name: "Open answer options" });
    const dailyActionsMenu = page.getByTestId("daily-actions-menu");
    const appModeTrigger = page.getByRole("button", { name: "Mode Answer" });
    const appModeMenu = page.getByRole("menu", { name: "Choose app mode" });

    // Retry open-then-assert together: a click landing before React attaches the
    // trigger's handler is swallowed silently, so asserting visibility once fails
    // on an unhydrated first click rather than on a real regression.
    await expect(async () => {
      // The trigger TOGGLES, so this retry has to be idempotent. If the menu
      // opened just after the inner assertion's deadline expired, a second
      // unconditional click closes it again and the attempts oscillate — the
      // retry would then fail a UI that is working.
      if (await appModeMenu.isVisible().catch(() => false)) return;
      await appModeTrigger.click();
      await expect(appModeMenu).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: uiAssertionTimeoutMs });
    await dismissOverlayByHeaderClick(page);
    await expect(appModeMenu).toBeHidden();

    await appModeTrigger.click();
    await expect(appModeMenu).toBeVisible();
    await dailyActionsTrigger.click();
    await expect(appModeMenu).toBeHidden();
    await expect(dailyActionsMenu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dailyActionsMenu).toHaveCount(0);

    // First open — use robust retry helper to handle async state update timing.
    await openDailyActions(page, "Open answer options");
    await dismissOverlayByHeaderClick(page);
    await expect(dailyActionsMenu).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mode Answer" })).toBeVisible();

    // Second open - verify opening the mode menu closes the daily actions surface.
    await openDailyActions(page, "Open answer options");
    await appModeTrigger.click();

    await expect(dailyActionsMenu).toHaveCount(0);
    await expect(appModeMenu).toBeVisible();
    await dismissOverlayByHeaderClick(page);
    await expect(appModeMenu).toBeHidden();
    await expect(page.getByTestId("app-mode-menu-sheet")).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("phone mode menu groups the catalogue by clinical intent and keeps every mode reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockPrivateUnauthenticatedApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const appModeTrigger = page.getByRole("button", { name: "Mode Answer" });
    await waitForReactEventHandler(appModeTrigger, "onClick");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-top", "59px");
    });
    await appModeTrigger.click();

    const modeSheet = page.getByTestId("app-mode-menu-sheet");
    const appModeMenu = page.getByRole("menu", { name: "Choose app mode" });
    await expect(modeSheet).toBeVisible();
    await expect(modeSheet).toHaveAttribute("role", "dialog");
    await expect(appModeMenu).toBeVisible();
    await expect(appModeTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(appModeTrigger).toHaveAttribute("aria-controls", "app-mode-menu");
    await expectControlsBelowPhoneTopSafeArea(page, [
      modeSheet.getByRole("heading", { name: "Choose mode" }),
      modeSheet.getByRole("button", { name: "Close mode menu" }),
    ]);

    // The full catalogue remains in one radio menu, but the phone presentation
    // now groups it into five doors: My Day (with the work areas), On Call,
    // then the three clinical doors (modes review, phase 1).
    const modeOptions = appModeMenu.getByRole("menuitemradio");
    const modeCount = await modeOptions.count();
    expect(modeCount).toBeGreaterThanOrEqual(10);
    await expect(appModeMenu.getByRole("heading", { name: "Search" })).toBeAttached();
    await expect(appModeMenu.getByRole("heading", { name: "Psychiatry" })).toBeAttached();
    await expect(appModeMenu.getByRole("heading", { name: "Medicines & tools" })).toBeAttached();
    await expect(appModeMenu.getByRole("heading", { name: "On Call" })).toBeAttached();
    await expect(appModeMenu.getByRole("heading", { name: "My Day" })).toBeAttached();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Tools\b/ })).toBeAttached();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Medication\b/ })).toBeAttached();
    // Sources reached the desktop menu (built from `appModeDefinitions`) but not
    // this one, which renders `phoneModeGroups` and drops any mode no group names.
    // `tests/phone-mode-groups.test.ts` guards the constant; this is the rendered proof.
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Sources\b/ })).toBeAttached();
    // My Day leads the list (design review 2026-10-03, item 4), so the first
    // option is My Day and the active Answer option is checked under Search.
    await expect(modeOptions.first()).toBeInViewport();
    await expect(modeOptions.first()).toContainText("My Day");
    const answerOption = appModeMenu.getByRole("menuitemradio", { name: /^Answer\b/ });
    await expect(answerOption).toHaveAttribute("aria-checked", "true");
    await expect(answerOption).toContainText("Source-backed clinical answer");

    // Icon tiles and glyphs use one optical scale even though the canonical
    // Lucide drawings have different silhouettes.
    const iconGeometry = await appModeMenu.locator("[data-mode-icon]").evaluateAll((icons) =>
      icons.map((icon) => {
        const tile = icon.getBoundingClientRect();
        const glyph = icon.querySelector("svg")?.getBoundingClientRect();
        return {
          tile: [Math.round(tile.width), Math.round(tile.height)],
          glyph: glyph ? [Math.round(glyph.width), Math.round(glyph.height)] : null,
        };
      }),
    );
    expect(iconGeometry).toHaveLength(modeCount);
    expect(new Set(iconGeometry.map(({ tile }) => tile.join("x")))).toEqual(new Set(["40x40"]));
    expect(new Set(iconGeometry.map(({ glyph }) => glyph?.join("x")))).toEqual(new Set(["20x20"]));

    const closeButton = modeSheet.getByRole("button", { name: "Close mode menu" });
    const closeGeometry = await closeButton.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      return {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        radius: getComputedStyle(button).borderRadius,
      };
    });
    expect(closeGeometry.width).toBeGreaterThanOrEqual(44);
    expect(closeGeometry.height).toBeGreaterThanOrEqual(44);
    expect(Number.parseFloat(closeGeometry.radius)).toBeGreaterThanOrEqual(22);

    // A lower group remains reachable through the sheet's own scroll owner.
    // Tools is browse-first, so selecting it opens the canonical directory.
    const toolsMode = appModeMenu.getByRole("menuitemradio", { name: /^Tools\b/ });
    await toolsMode.scrollIntoViewIfNeeded();
    await expect(toolsMode).toBeVisible();
    await toolsMode.click();

    await expect(modeSheet).toHaveCount(0);
    await expect(appModeMenu).toHaveCount(0);
    await expect(page).toHaveURL(/\/tools$/);
    const toolsTrigger = page.getByRole("button", { name: "Mode Tools" });
    await expect(toolsTrigger).toBeVisible();
    await expect(page.getByTestId("tools-search-results-page")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Tools", exact: true })).toBeVisible();
    await expectNoPageHorizontalOverflow(page);

    // Reopening on a mode in a lower group must position that selected row in
    // the sheet's own scrollport, without requiring a hunt from the top.
    await toolsTrigger.click();
    const reopenedToolsMode = page.getByRole("menu", { name: "Choose app mode" }).getByRole("menuitemradio", {
      name: /^Tools\b/,
    });
    await expect(reopenedToolsMode).toHaveAttribute("aria-checked", "true");
    await expect(reopenedToolsMode).toBeInViewport();
    await expect(page.getByText("Currently Tools", { exact: true })).toBeVisible();
  });

  test("phone mode menu dismisses via backdrop and restores focus to the Mode button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockPrivateUnauthenticatedApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const appModeTrigger = page.getByRole("button", { name: "Mode Answer" });
    await waitForReactEventHandler(appModeTrigger, "onClick");
    await appModeTrigger.click();

    const modeSheet = page.getByTestId("app-mode-menu-sheet");
    await expect(modeSheet).toBeVisible();

    // Click the dimmed backdrop (outside the dialog panel) to dismiss.
    await modeSheet.locator("..").click({ position: { x: 8, y: 8 } });
    await expect(modeSheet).toHaveCount(0);
    await expect(appModeTrigger).toBeFocused();
    await expect(appModeTrigger).toHaveAttribute("aria-expanded", "false");
  });

  test("desktop mode action placement coalesces scroll updates per frame", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockPrivateUnauthenticatedApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const trigger = page.getByRole("button", { name: "Open answer options" });
    await trigger.evaluate((element) => {
      const originalGetBoundingClientRect = element.getBoundingClientRect.bind(element);
      element.dataset.placementReadCount = "0";
      element.getBoundingClientRect = () => {
        element.dataset.placementReadCount = String(Number(element.dataset.placementReadCount ?? "0") + 1);
        return originalGetBoundingClientRect();
      };
    });

    await openDailyActions(page, "Open answer options");
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await trigger.evaluate((element) => {
      element.dataset.placementReadCount = "0";
    });

    const placementReads = await page.evaluate(async () => {
      for (let index = 0; index < 20; index += 1) {
        window.dispatchEvent(new Event("scroll"));
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const triggerElement = document.querySelector<HTMLElement>('button[aria-label="Open answer options"]');
      return Number(triggerElement?.dataset.placementReadCount ?? "0");
    });

    expect(placementReads).toBeLessThanOrEqual(1);
  });

  test("demo answer flow reaches a source-backed answer @critical", async ({ browserName, page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockDemoApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const question = "What clozapine monitoring items are shown in the table image?";
    const questionInput = await fillVisibleQuestionInput(page, question);
    await expect(questionInput).toHaveValue(question);
    await visibleAnswerSubmitButton(page).click();

    await expect(page.getByRole("button", { name: "Ask a question" })).toHaveCount(0);
    // The current turn's question is a chat bubble, the same shape every prior
    // turn uses; it was a muted echo inside the answer card header until the
    // answer surface became one conversation.
    const questionEcho = page.getByTestId("user-question-bubble");
    await expect(questionEcho).toBeVisible();
    await expect(questionEcho).toContainText(question);

    const plainAnswer = page.getByTestId("plain-answer-response");
    await expect(plainAnswer).toBeVisible();
    await expect(plainAnswer).toContainText("synthetic clozapine table image highlights");
    await expect(plainAnswer.getByTestId("plain-answer-prose")).toBeVisible();
    await expect(page.getByText("Demo", { exact: true })).toHaveCount(0);
    await expect(plainAnswer.locator("ul, ol, li")).toHaveCount(0);
    await expect(plainAnswer.getByTestId("plain-answer-prose").locator("svg")).toHaveCount(0);

    // The numbered marks in the prose. They are the reason the whole surface
    // exists, so this asserts the three things that make one trustworthy: it
    // stays inside the line box, it opens the source it names, and the sentence
    // it belongs to is still findable while the drawer covers the screen.
    const marks = plainAnswer.getByTestId("answer-source-mark");
    await expect(marks.first()).toBeVisible();
    const markGeometry = await plainAnswer.getByTestId("plain-answer-prose").evaluate((prose) => {
      const nodes = [...prose.querySelectorAll('[data-testid="answer-source-mark"]')];
      const boxes = nodes.map((node) => node.getBoundingClientRect());
      let minGap = Number.POSITIVE_INFINITY;
      for (let index = 1; index < boxes.length; index += 1) {
        const previous = boxes[index - 1];
        const current = boxes[index];
        if (Math.abs(previous.top - current.top) > 2) continue;
        minGap = Math.min(minGap, current.left - previous.right);
      }
      return { count: boxes.length, minGap };
    });
    expect(markGeometry.count).toBeGreaterThan(0);
    // Two marks in one cluster must not touch. An earlier shape painted the box
    // from a pseudo-element wider than the control, so "2" and "3" overlapped.
    if (markGeometry.count > 1) expect(markGeometry.minGap).toBeGreaterThan(0);

    await marks.first().click();
    const claimDrawer = page.getByTestId("answer-source-drawer");
    await expect(claimDrawer).toBeVisible();
    // Opened from a claim, so the drawer speaks about the claim — not the
    // "opened from the source list" wording a rail card produces.
    await expect(claimDrawer.getByTestId("answer-source-drawer-support")).toContainText(
      /states the claim|part of the claim/,
    );
    await expect(page.getByTestId("answer-claim").first()).toHaveAttribute("data-claim-lit", "true");
    await page.keyboard.press("Escape");
    await expect(claimDrawer).toHaveCount(0);
    await expect(marks.first()).toBeFocused();

    // The source rail replaced the "Sources" capsule and its popover/sheet pair:
    // the cited list is on the page rather than one tap behind a chip, and each
    // card opens the per-source drawer. Cards scroll sideways so six sources cost
    // one row of phone scroll rather than six.
    const sourceRail = page.getByTestId("answer-source-rail");
    await expect(sourceRail).toBeVisible();
    const railRows = sourceRail.getByTestId("answer-source-rail-row");
    await expect(railRows).toHaveCount(2);
    const firstRailRow = railRows.first();
    await expectMinTouchTarget(firstRailRow);
    await expect(firstRailRow).toHaveAccessibleName(/^Source 1: /);
    await firstRailRow.click();
    const sourceDrawer = page.getByTestId("answer-source-drawer");
    await expect(sourceDrawer).toBeVisible();
    // Opened from a rail card rather than a claim, so the drawer makes no
    // support statement at all — it used to spend its first line saying there
    // was no claim, above a front-page thumbnail of a page it was not showing.
    await expect(sourceDrawer.getByTestId("answer-source-drawer-support")).toHaveCount(0);
    await expect(sourceDrawer.getByTestId("answer-source-drawer-cover")).toHaveCount(0);
    await expect(sourceDrawer.getByTestId("answer-source-drawer-passage")).toBeVisible();
    await expect(page.getByRole("dialog", { name: /PDF|document/i })).toHaveCount(0);
    // Paging is the drawer's whole navigation model; at two sources it is numbered.
    const pager = sourceDrawer.getByTestId("answer-source-drawer-pager");
    await expect(pager).toHaveAttribute("data-pager-variant", "numbered");
    await pager.getByRole("button", { name: /^Show source 2/ }).click();
    await expect(sourceDrawer.getByRole("link", { name: "View original PDF" })).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
    await page.keyboard.press("Escape");
    await expect(sourceDrawer).toHaveCount(0);
    // Focus returns to the row the drawer was showing, not the row it opened from.
    await expect(railRows.nth(1)).toBeFocused();
    if (browserName === "chromium") {
      // The grant used to ride along with the removed "Copy passage" control; the
      // clipboard read below still needs it.
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: new URL(page.url()).origin,
      });
      const copyWithSources = page.getByRole("button", { name: "Copy answer with source status" });
      await expect(copyWithSources).toBeVisible();
      await expectMinTouchTarget(copyWithSources);
      await copyWithSources.click();
      const copiedText = await page.evaluate(() => navigator.clipboard.readText());
      expect(copiedText).toContain("Clinical answer draft");
      expect(copiedText).toContain("Sources for review");
      expect(copiedText).toContain("/documents/");
    }
    await expect(plainAnswer.getByRole("button", { name: "More answer actions" })).toHaveCount(0);

    // The support card was removed on 2026-08-31 (owner decision): the status it
    // carried is now a chip line above the prose, and the safety chip below is
    // the route it used to own. What this block protected — that the answer's
    // state is stated on screen, and that the old per-source sheets stay gone —
    // is asserted against the chip instead.
    const supportChip = page.getByTestId("answer-card-support");
    await expect(supportChip).toBeVisible();
    await expect(supportChip).toContainText(/support/i);
    await expect(page.getByTestId("answer-support-card")).toHaveCount(0);
    await expect(page.getByTestId("answer-clinical-notes-trigger")).toHaveCount(0);
    await expect(page.getByTestId("answer-evidence-trigger")).toHaveCount(0);
    await expect(page.getByTestId("safety-findings-panel")).toHaveCount(0);

    // Safety findings are MANDATORY for this clozapine fixture — the answer is saturated
    // with monitoring/FBC-ANC/metabolic/myocarditis language that extractSafetyFindings
    // keys on. A regression that drops them (so the trigger never mounts — it only renders
    // when safetyFindings.length > 0, see answer-result-surface.tsx) must FAIL this
    // @critical smoke, not pass silently on an absent trigger (audit F3 / C6). Asserting
    // the trigger is visible unconditionally enforces "safety findings present".
    const clinicalPointsRail = page.getByTestId("answer-clinical-points");
    await expect(clinicalPointsRail).toBeVisible();
    const safetyFindingsTrigger = page.getByTestId("answer-safety-findings-trigger");
    await expect(safetyFindingsTrigger).toBeVisible();
    await expectMinTouchTarget(safetyFindingsTrigger);

    // The rail sits at the seam: after the prose, before the cited sources.
    const pointsBox = await clinicalPointsRail.boundingBox();
    const proseSeamBox = await page.getByTestId("plain-answer-prose").boundingBox();
    const sourceRailBox = await page.getByTestId("answer-source-rail").boundingBox();
    expect(pointsBox).not.toBeNull();
    expect(proseSeamBox).not.toBeNull();
    expect(sourceRailBox).not.toBeNull();
    expect(pointsBox!.y).toBeGreaterThanOrEqual(proseSeamBox!.y + proseSeamBox!.height - 1);
    expect(sourceRailBox!.y).toBeGreaterThanOrEqual(pointsBox!.y + pointsBox!.height - 1);

    await safetyFindingsTrigger.click();
    const safetyFindingsSheet = page.getByRole("dialog", { name: "Key points" });
    await expect(safetyFindingsSheet).toBeVisible();
    await expect(safetyFindingsSheet.getByTestId("safety-findings-panel")).toBeVisible();
    await expect.poll(() => safetyFindingsSheet.getByTestId("safety-finding-row").count()).toBeGreaterThan(0);
    // Severity order inside the sheet: a stop-tier row never follows a know-tier
    // one, so the list always reads in the same direction.
    const sheetTones = await safetyFindingsSheet
      .getByTestId("safety-finding-row")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-tone")));
    const toneRank = { stop: 0, act: 1, know: 2 } as Record<string, number>;
    const sheetRanks = sheetTones.map((tone) => toneRank[tone ?? "know"] ?? 2);
    expect(sheetRanks).toEqual([...sheetRanks].sort((left, right) => left - right));
    await safetyFindingsSheet.getByRole("button", { name: "Close key points" }).click();
    await expect(safetyFindingsSheet).toHaveCount(0);
    await expect(safetyFindingsTrigger).toBeFocused();

    // Opening from a LATER pill must return focus to that pill, not to the first
    // one. A ref bound to the first button satisfies every assertion above while
    // dragging focus back to the left edge of a horizontally scrolling rail.
    const laterPills = clinicalPointsRail.getByTestId("answer-clinical-point");
    if ((await laterPills.count()) > 0) {
      const laterPill = laterPills.first();
      await laterPill.click();
      await expect(page.getByRole("dialog", { name: "Key points" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Key points" })).toHaveCount(0);
      await expect(laterPill).toBeFocused();
      await expect(safetyFindingsTrigger).not.toBeFocused();
    }

    // The status chips carry a real 48px tap target inside a 24px-tall pill. The
    // first shape did that with `-my-3`, which keeps `boundingBox()` honest while
    // moving the hit region outside the element's layout box — so the chip
    // quietly sat on top of its neighbours. Measured here before the fix: the
    // safety chip covered a 133x9px band of the support chip and a 133x2px band
    // of the prose, and a tap in either band opened the chip. Geometry is the
    // only thing that catches this — every DOM assertion above passes with the
    // overlap in place — and 320px is the width where the chip row wraps.
    for (const statusWidth of [390, 320]) {
      await page.setViewportSize({ width: statusWidth, height: 820 });
      await expect(safetyFindingsTrigger).toBeVisible();
      await expectMinTouchTarget(safetyFindingsTrigger);
      const collisions = await page.evaluate(() => {
        const box = (selector: string) => {
          const node = document.querySelector(selector);
          return node ? { id: selector, ...node.getBoundingClientRect().toJSON() } : null;
        };
        const chips = [
          box('[data-testid="answer-safety-findings-trigger"]'),
          box('[data-testid="answer-limitations-trigger"]'),
        ].filter((entry) => entry !== null);
        const neighbours = [
          box('[data-testid="answer-card-support"]'),
          box('[data-testid="plain-answer-prose"]'),
          ...chips,
        ].filter((entry) => entry !== null);
        const overlaps: string[] = [];
        for (const chip of chips) {
          for (const other of neighbours) {
            if (other.id === chip.id) continue;
            const width = Math.min(chip.right, other.right) - Math.max(chip.left, other.left);
            const height = Math.min(chip.bottom, other.bottom) - Math.max(chip.top, other.top);
            // Sub-pixel rounding, not a real collision.
            if (width > 0.5 && height > 0.5) {
              overlaps.push(`${chip.id} over ${other.id} by ${width.toFixed(1)}x${height.toFixed(1)}`);
            }
          }
        }
        return overlaps;
      });
      expect(collisions, `status chip hit regions overlap at ${statusWidth}px`).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 820 });

    // The support word and the limitations chip share one line at 390px. They used to be forced
    // onto separate rows by a `w-full` on the chip container, on the reasoning that a 48px
    // control cannot sit in a 24px line without a negative margin. True, and the row is now
    // centre-aligned and 48px tall instead, so no negative margin is needed and the collision
    // check above still passes. Asserted positively because "they do not overlap" is also
    // satisfied by stacking them again, which is the regression this guards.
    const statusRowShare = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const support = rect('[data-testid="answer-card-support"]');
      const chip = rect('[data-testid="answer-limitations-trigger"]');
      if (!support || !chip) return null;
      return {
        verticalOverlap: Math.min(support.bottom, chip.bottom) - Math.max(support.top, chip.top),
        horizontalGap: Math.max(support.left, chip.left) - Math.min(support.right, chip.right),
      };
    });
    expect(statusRowShare, "support pill and limitations chip both render at 390px").not.toBeNull();
    // Sharing a line: the shorter pill's full height sits within the taller chip's band.
    expect(statusRowShare!.verticalOverlap).toBeGreaterThan(8);
    // Side by side, not on top of each other.
    expect(statusRowShare!.horizontalGap).toBeGreaterThan(0);

    // Decision 2 (2026-08-24): tables fold into the source drawer, so they are no
    // longer on the answer surface at all — reaching one goes through a rail row.
    await expect(page.getByLabel("Inline table preview")).toHaveCount(0);
    // A table hangs off the source it was cited from, so open the row that has it
    // rather than assuming it is the best match.
    const tableDrawer = page.getByTestId("answer-source-drawer");
    const clinicalTable = tableDrawer.getByLabel("Inline table preview").first();
    let foundTable = false;
    for (let index = 0; index < (await railRows.count()); index += 1) {
      await railRows.nth(index).click();
      await expect(tableDrawer).toBeVisible();
      if (await clinicalTable.count()) {
        foundTable = true;
        break;
      }
      await page.keyboard.press("Escape");
      await expect(tableDrawer).toHaveCount(0);
    }
    expect(foundTable).toBe(true);
    await expect(clinicalTable).toBeVisible();
    await expect(clinicalTable.getByRole("table")).toBeVisible();
    await expect(clinicalTable).toContainText("FBC/ANC");
    await expect(clinicalTable).not.toContainText(/page|p\.|chunk|Synthetic clozapine monitoring protocol/i);
    await expect(clinicalTable.getByRole("button", { name: "Copy table preview" })).toHaveCount(0);
    await expect(clinicalTable.getByRole("button", { name: "More table actions" })).toHaveCount(0);
    await expect(clinicalTable.getByTestId("accessible-table-surface")).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
    // Full-screen table expansion from inside the drawer is covered on its own by
    // the "clinical table mobile expansion" test below, which owns the nested
    // dialog case rather than repeating it here.
    await tableDrawer.getByRole("button", { name: "Close source detail" }).click();
    await expect(tableDrawer).toHaveCount(0);
    await expect(page.locator("#answer-more-detail-drawer")).toHaveCount(0);
    await expect(page.getByTestId("raw-answer-narrative")).toHaveCount(0);
    await expect(page.getByText("Source narrative")).toHaveCount(0);
    await expect(page.getByText("Quality feedback")).toHaveCount(0);
    await expect(page.getByTestId("smart-follow-up-chips")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Compare sources" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Limit to local/current sources" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Search this document only" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show exact quotes" })).toHaveCount(0);
    await expect(page.getByTestId("answer-top-source-chip")).toHaveCount(0);
    await expect(page.getByTestId("answer-grounding-chip")).toHaveCount(0);
    await expect(page.getByTestId("evidence-rail")).toHaveCount(0);
    await expect(page.getByTestId("evidence-summary-card")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy clinical draft" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy answer with citations" })).toHaveCount(0);
    await expect(page.getByTestId("answer-safety-notice")).toHaveCount(0);
    await expect(page.getByTestId("mobile-section-fab-button")).toHaveCount(0);
    await expect(page.getByTestId("mobile-section-fab-menu")).toHaveCount(0);
    await expectDomIntegrity(page, { mobileNav: true });

    // The clinical-notes sheet and the five-tab evidence sheet are both gone: the
    // rail lists every cited document and the drawer carries that document's
    // support, passage, tables and images. Their triggers must not come back.
    await expect(page.locator("#answer-clinical-notes-drawer-mobile-trigger")).toHaveCount(0);
    await expect(page.locator("#answer-evidence-drawer-mobile-trigger")).toHaveCount(0);
    await expect(page.getByTestId("clinical-notes-checklist")).toHaveCount(0);
    await expect(page.getByTestId("mobile-evidence-tabs")).toHaveCount(0);
    await expect(page.getByTestId("evidence-support-panel")).toHaveCount(0);

    // Document order on the answer surface: question, the status chip line, the
    // prose, the rail that cites it, the quiet utilities, then the governed
    // caution. The caution moved below the answer on 2026-08-31 (owner
    // decision); pinning it here is what stops it drifting back up or, worse,
    // being dropped when a call site takes placement from AnswerCard.
    const hierarchy = await page.evaluate(() => {
      const question = document.querySelector('[data-testid="user-question-bubble"]');
      const plainAnswer = document.querySelector('[data-testid="plain-answer-response"]');
      const rail = document.querySelector('[data-testid="answer-source-rail"]');
      const utilities = document.querySelector('section[aria-label="Answer utilities"]');
      const support = document.querySelector('[data-testid="answer-card-support"]');
      const caution = document.querySelector('[data-testid="verification-notice"]');
      return {
        questionTop: question?.getBoundingClientRect().top ?? 9999,
        plainAnswerTop: plainAnswer?.getBoundingClientRect().top ?? 9999,
        railTop: rail?.getBoundingClientRect().top ?? 9999,
        utilitiesTop: utilities?.getBoundingClientRect().top ?? 9999,
        supportTop: support?.getBoundingClientRect().top ?? 9999,
        cautionTop: caution?.getBoundingClientRect().top ?? 9999,
        cautionPresent: Boolean(caution),
      };
    });
    expect(hierarchy.cautionPresent).toBe(true);
    expect(hierarchy.questionTop).toBeLessThan(hierarchy.supportTop);
    expect(hierarchy.supportTop).toBeLessThan(hierarchy.plainAnswerTop);
    expect(hierarchy.plainAnswerTop).toBeLessThan(hierarchy.railTop);
    expect(hierarchy.railTop).toBeLessThan(hierarchy.utilitiesTop);
    expect(hierarchy.utilitiesTop).toBeLessThan(hierarchy.cautionTop);

    // Evidence gaps and feedback remain answer-level, but use the same quiet
    // utility treatment as Copy with sources rather than the safety panel.
    const utilities = page.getByLabel("Answer utilities");
    const feedbackTrigger = utilities.getByTestId("answer-feedback-trigger");
    await expect(feedbackTrigger).toBeVisible();
    await expectMinTouchTarget(feedbackTrigger);
    // The problem list is a Sheet, so it portals out of the utilities section
    // and is looked up on the page. It has to be: as an in-flow disclosure it
    // opened partly behind the fixed phone composer, and no scripted scroll can
    // clear it without hiding the phone chrome.
    await feedbackTrigger.click();
    const feedbackSheet = page.getByTestId("answer-feedback-sheet");
    await expect(feedbackSheet).toBeVisible();
    await expect(feedbackSheet.getByTestId("answer-review-panel")).toBeVisible();
    await expect(utilities.getByTestId("answer-review-panel")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(feedbackSheet).toHaveCount(0);
    await expect(feedbackTrigger).toBeFocused();

    await expect(page.getByTestId("answer-section-heading")).toHaveText("Answer");
    await expect(page.getByTestId("answer-header-actions")).toHaveCount(0);

    await expect(page.getByText("Top source detail")).toHaveCount(0);
    await expect(page.getByText("Retrieval details")).toHaveCount(0);
    // Tapping the backdrop dismisses the source drawer and returns focus to the
    // rail row that opened it.
    await railRows.first().click();
    const dismissDrawer = page.getByTestId("answer-source-drawer");
    await expect(dismissDrawer).toBeVisible();
    await tapOutsideActiveSurface(page);
    await expect(dismissDrawer).toHaveCount(0);
    await expect(railRows.first()).toBeFocused();

    await openScopeControl(page);
    const scopePopover = page.getByTestId("scope-command-popover");
    await expect(scopePopover).toBeVisible();
    const scopeFilter = scopePopover.locator('[data-testid="document-scope-filter"]');
    await expect(scopeFilter).toBeVisible();
    await expect(scopeFilter).toBeFocused();
    await scopeFilter.fill("lithium");
    await expect(scopePopover).toContainText(/match(?:es)?|No documents match/);
    await expect(scopePopover.getByRole("button", { name: "All documents" })).toBeVisible();
    const popoverMetrics = await scopePopover.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        maxHeight: style.maxHeight,
        overflowY: style.overflowY,
        viewportHeight: window.innerHeight,
      };
    });
    expect(popoverMetrics.overflowY).toBe("auto");
    expect(popoverMetrics.maxHeight).not.toBe("none");
    expect(popoverMetrics.height).toBeLessThanOrEqual(Math.ceil(popoverMetrics.viewportHeight * 0.72));
    await page.keyboard.press("Escape");
    await expect(scopePopover).toBeHidden();
    await expect(async () => {
      await expect(page.getByRole("button", { name: "Open answer options" })).toBeFocused();
    }).toPass({ timeout: 5_000 });
    await expectNoPageHorizontalOverflow(page);
  });

  for (const viewport of [
    { name: "desktop", width: 1280, height: 900 },
    { name: "390x844 mobile", width: 390, height: 844 },
  ] as const) {
    test(`actual answer Copy control preserves ordinary prose at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockDemoApi(page, {
        answerOverride: (query, documentId, documentIds) => ({
          ...demoAnswer(query, documentId, documentIds),
          visualEvidence: [],
        }),
      });
      await installClipboardMock(page);
      await gotoApp(page, "/");
      await waitForDemoDashboardReady(page);

      await fillVisibleQuestionInput(page, "What lithium toxicity symptoms need review?");
      await visibleAnswerSubmitButton(page).click();
      const answerSurface = page.getByTestId("plain-answer-response");
      await expect(answerSurface).toBeVisible({ timeout: uiAssertionTimeoutMs });
      await page.getByRole("button", { name: "Copy answer with source status" }).click();

      const copiedText = await page.evaluate(() => navigator.clipboard.readText());
      expect(copiedText).toContain("toxicity safety-net review");
      expect(copiedText).toContain("Sources for review");
      expect(copiedText).not.toContain("Clinical tables");
    });

    test(`actual answer Copy control matches the visible clinical table at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockDemoApi(page, {
        answerOverride: (query, documentId, documentIds) => {
          const base = demoAnswer(query, documentId, documentIds);
          const table = base.visualEvidence?.[0];
          if (!table) return base;
          const secondTable = {
            ...table,
            id: `${table.id}-second`,
            image_id: `${table.image_id}-second`,
            source_chunk_id: base.sources[1]?.id ?? table.source_chunk_id,
            viewer_href: "/documents/second-table?page=7&chunk=second-table-chunk",
            title: "Synthetic metabolic monitoring guideline",
            page_number: 7,
            tableTitle: "Metabolic monitoring",
            tableColumns: ["Parameter", "Timing"],
            tableRows: [["HbA1c", "At baseline and review"]],
          };
          return {
            ...base,
            sourceGovernanceWarnings: [
              {
                code: "review_due_source" as const,
                severity: "warning" as const,
                message: "One or more supporting sources are due for review.",
              },
            ],
            visualEvidence: [
              {
                ...table,
                tableTitle: "ANC actions",
                tableColumns: ["ANC range", "", "Action"],
                tableRows: [
                  ["1.0–1.5 × 10⁹/L", "", "Increase monitoring"],
                  ["<1.0 × 10⁹/L", "", "Withhold and seek specialist advice"],
                ],
              },
              secondTable,
            ],
          };
        },
      });
      await installClipboardMock(page);
      await gotoApp(page, "/");
      await waitForDemoDashboardReady(page);

      await fillVisibleQuestionInput(page, "What clozapine monitoring items are shown in the table image?");
      await visibleAnswerSubmitButton(page).click();
      // Tables live in the source drawer now, one page at a time. The clipboard
      // still carries every table, so each one must remain reachable — a copy that
      // quotes a table nothing on screen can show is exactly the drift this test
      // was written to catch.
      const rail = page.getByTestId("answer-source-rail");
      await expect(rail).toBeVisible({ timeout: uiAssertionTimeoutMs });
      const rows = rail.getByTestId("answer-source-rail-row");
      const rowCount = await rows.count();
      const seenTables: string[] = [];
      let sawCaveat = false;
      for (let index = 0; index < rowCount; index += 1) {
        await rows.nth(index).click();
        const drawer = page.getByTestId("answer-source-drawer");
        await expect(drawer).toBeVisible();
        for (const name of ["ANC actions", "Metabolic monitoring"]) {
          const table = drawer.getByRole("table", { name });
          if (await table.count()) {
            await expect(table).toBeVisible();
            if (name === "ANC actions") {
              await expect(table).toContainText("1.0–1.5 × 10⁹/L");
              await expect(table).toContainText("Withhold and seek specialist advice");
            } else {
              await expect(table).toContainText("HbA1c");
              await expect(table).toContainText("At baseline and review");
            }
            if (!seenTables.includes(name)) seenTables.push(name);
          }
        }
        if (await drawer.getByTestId("canonical-table-caveat").count()) sawCaveat = true;
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
      }
      expect(seenTables.sort()).toEqual(["ANC actions", "Metabolic monitoring"]);
      expect(sawCaveat).toBe(true);

      await page.getByRole("button", { name: "Copy answer with source status" }).click();
      const copiedText = await page.evaluate(() => navigator.clipboard.readText());
      expect(copiedText).toContain("ANC range | [header missing] | Action");
      expect(copiedText).toContain("1.0–1.5 × 10⁹/L | [blank] | Increase monitoring");
      expect(copiedText).toContain("<1.0 × 10⁹/L | [blank] | Withhold and seek specialist advice");
      expect(copiedText).toContain("Table headers are incomplete");
      expect(copiedText).toContain("One or more supporting sources are due for review.");
      expect(copiedText).toContain("Source: Synthetic clozapine monitoring protocol with image evidence, page 2");
      expect(copiedText).toContain("Metabolic monitoring");
      expect(copiedText).toContain("Parameter | Timing");
      expect(copiedText).toContain("HbA1c | At baseline and review");
    });
  }

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "200% zoom equivalent", width: 640, height: 450 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 900 },
  ] as const) {
    test(`privacy warnings and links are available before clinical input at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockDemoApi(page);
      await gotoApp(page, "/");
      await waitForDemoDashboardReady(page);

      const composer = visibleQuestionInput(page);
      const composerForm = composer.locator("xpath=ancestor::form[1]");
      const composerWarning = composerForm.getByText("Do not enter patient-identifiable information.");
      await expect(composerForm.getByRole("note")).toBeVisible();
      const composerPrivacyLink = composerForm.getByRole("link", { name: "Privacy and data processing" });
      await expect(composerWarning).toBeVisible();
      await expect(composerPrivacyLink).toBeVisible();
      await composerPrivacyLink.focus();
      await expect(composerPrivacyLink).toBeFocused();

      await page.goto("/privacy", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "How PsychSift handles your data" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Before you use PsychSift" })).toBeVisible();
      await expect(page.getByTestId("privacy-trust-brief")).toBeVisible();
      await expect(page.getByTestId("privacy-draft-disclaimer")).toBeVisible();

      const safetyDisclosure = page.getByRole("button", { name: /Read more|Show less/ });
      await safetyDisclosure.focus();
      await expect(safetyDisclosure).toBeFocused();
      await safetyDisclosure.click();
      await expect(safetyDisclosure).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText(/Do not enter identifiable patient details such as names/i)).toBeVisible();

      // The scannable answer layer and the print affordance are the two things a
      // reader arriving from the composer notice needs without opening anything.
      await expect(page.getByRole("heading", { level: 2, name: "At a glance" })).toBeVisible();
      const factColumns = await page.getByTestId("privacy-at-a-glance-grid").evaluate((element) => {
        return getComputedStyle(element).gridTemplateColumns.split(" ").length;
      });
      expect(factColumns).toBe(viewport.width >= 1024 ? 3 : viewport.width >= 640 ? 2 : 1);

      const processingColumns = await page.getByTestId("privacy-processing-stages").evaluate((element) => {
        return getComputedStyle(element).gridTemplateColumns.split(" ").length;
      });
      expect(processingColumns).toBe(viewport.width >= 640 ? 3 : 1);
      // The footer control, not the sm+ header one: the header print button is
      // hidden on a phone, and this assertion runs at 320px too.
      await expect(page.getByRole("button", { name: "Print this page" })).toBeVisible();
      await expectNoPageHorizontalOverflow(page);
    });
  }

  test("privacy sticky chrome is an opaque bar on phones and glass from sm", async ({ page }) => {
    // Proven in a browser, not by class presence: tailwind-merge keeps both the
    // base and the `sm:` utility, so stylesheet order — not the class list —
    // decides which one wins, and jsdom cannot resolve either.
    //
    // The phone case is the one that matters. This band carried translucent
    // glass at every width, so scrolled content ghosted through the title; it
    // was visible against the amber obligation band, whose fill read straight
    // through "Data handling". The repo's own header rule for phones
    // (`.edge-glass-header` / `.universal-header` in globals.css) is an opaque
    // bar with no blur, and this page now follows it.
    const chrome = page.getByTestId("privacy-sticky-chrome");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    await expect(chrome).toBeVisible();

    const phone = await chrome.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, blur: style.backdropFilter };
    });
    // Fully opaque: no alpha channel at all, so nothing can read through.
    expect(phone.background).not.toMatch(/\/\s*0?\.\d+|rgba?\([^)]*,\s*0?\.\d+\s*\)/);
    expect(phone.blur).toBe("none");

    // Scrolled, the band must actually hide what passes behind it.
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(chrome).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /handles your data/i })).not.toBeInViewport();

    // From sm the shared glass treatment is correct again.
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    const wide = await chrome.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, blur: style.backdropFilter };
    });
    expect(wide.blur).toContain("blur(");
    expect(wide.background).not.toBe(phone.background);
  });

  test("privacy trust brief remains operable with reduced motion and forced colours", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await page.goto("/privacy", { waitUntil: "domcontentloaded" });

    const safetyDisclosure = page.getByRole("button", { name: /Read more|Show less/ });
    await safetyDisclosure.focus();
    await expect(safetyDisclosure).toBeFocused();
    await expect
      .poll(() => safetyDisclosure.locator("svg").evaluate((icon) => getComputedStyle(icon).transitionProperty))
      .toBe("none");
    await safetyDisclosure.click();
    await expect(safetyDisclosure).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/Do not enter identifiable patient details such as names/i)).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
  });

  test("answer failure offers a retry action that re-runs the question", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const answerRequests: string[] = [];
    let answerMode: "error" | "ok" = "error";
    await mockDemoApi(page);
    // Override the answer route so the first attempt fails (non-retryable), then
    // succeeds once the user taps Retry. Registered after mockDemoApi so it wins.
    await page.route(/\/api\/answer(?:\/stream)?(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { query?: string; documentId?: string; documentIds?: string[] };
      answerRequests.push(body.query ?? "");
      if (answerMode === "error") {
        await route.fulfill({
          body: `event: error\ndata: ${JSON.stringify({ error: "Answer generation failed for this question.", status: 400 })}\n\n`,
          contentType: "text/event-stream; charset=utf-8",
          headers: { "Cache-Control": "no-cache, no-transform" },
        });
        return;
      }
      await fulfillAnswerResponse(route, {
        ...demoAnswer(body.query ?? "", body.documentId, body.documentIds),
        demoMode: true,
      });
    });
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await fillVisibleQuestionInput(page, "What lithium monitoring is required?");
    await visibleAnswerSubmitButton(page).click();

    const retry = page.getByTestId("answer-error-retry");
    await expect(retry).toBeVisible();
    await expect(page.getByTestId("answer-error")).toContainText("Answer generation failed for this question.");
    await expect(page.getByTestId("answer-error-search-documents")).toBeVisible();
    const requestsBeforeRetry = answerRequests.length;

    answerMode = "ok";
    await retry.click();

    await expect(page.getByTestId("plain-answer-response")).toBeVisible();
    await expect(page.getByTestId("answer-error-retry")).toHaveCount(0);
    expect(answerRequests.length).toBeGreaterThan(requestsBeforeRetry);
    await expectNoPageHorizontalOverflow(page);
  });

  test("answer with no usable results shows a calm recovery panel, not an error alert", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page, {
      // Empty answer text makes the payload unusable, which the executor surfaces
      // as the "No usable results were found." 404 sentinel.
      answerOverride: (query, documentId, documentIds) => ({
        ...demoAnswer(query, documentId, documentIds),
        answer: "",
      }),
    });
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await fillVisibleQuestionInput(page, "A question with no indexed match at all");
    await visibleAnswerSubmitButton(page).click();

    const panel = page.getByTestId("answer-no-results");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("No answer for that yet");
    await expect(page.getByTestId("answer-no-results-rephrase")).toBeVisible();
    await expect(page.getByTestId("answer-no-results-search-documents")).toBeVisible();
    // A calm status panel, never the alarming red error banner.
    await expect(page.getByTestId("answer-error")).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  // Regression for PR #563: on phones a rendered answer must be content-sized and
  // top-aligned, NOT inherit the centred-home viewport-height floor. Otherwise a
  // short answer stretches the section to ~full height and `main` scrolls down into
  // the near-black shell; the fixed composer reserve must also hug the real dock.
  test("phone short answer stays top-aligned with no phantom scroll into black", async ({ page }) => {
    // Tall phone viewport so the deliberately short answer comfortably fits — that
    // is the whole point: content shorter than the viewport must not scroll.
    await page.setViewportSize({ width: 390, height: 900 });
    await mockDemoApi(page, {
      // Keep this a genuinely short answer as the shared answer contract grows:
      // rich support, safety, and related-document fields are covered elsewhere.
      answerOverride: (query, documentId, documentIds) => {
        const base = demoAnswer(query, documentId, documentIds);
        return {
          ...base,
          answer: "Verify the cited passages before using any clinical numbers.",
          answerSections: [],
          visualEvidence: [],
          quoteCards: [],
          documentBreakdown: [],
          evidenceSummary: undefined,
          sourceCoverage: undefined,
          conflictsOrGaps: [],
          bestSource: undefined,
          smartPanel: undefined,
          relatedDocuments: [],
          sources: base.sources.map((source) => ({
            ...source,
            content: "This indexed passage directly supports the short answer.",
          })),
        };
      },
    });
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await fillVisibleQuestionInput(page, "lithium dosing");
    await visibleAnswerSubmitButton(page).click();
    await expect(page.getByTestId("plain-answer-response")).toBeVisible({ timeout: 15_000 });
    // Wait for streaming to finish (deterministic) so the geometry below reads the
    // final, settled layout — replaces a fixed 400ms sleep.
    await expect(page.getByTestId("answer-streaming")).toHaveCount(0);

    const scrollGeometry = await readPrimaryScrollGeometry(page);
    const geo = await page.evaluate(() => {
      const header = document.querySelector("header");
      const surface = document.querySelector('[data-dashboard-stage="answer-surface"]');
      const alsoMatches = document.querySelector('[data-testid="universal-also-matches"]');
      const supportLabel = document.querySelector('[data-testid="answer-card-support"]');
      const sourceRail = document.querySelector('[data-testid="answer-source-rail"]');
      // Include vertical margins: the phone bottom clearance (`max-sm:mb-4`) sits
      // outside getBoundingClientRect().height and still consumes scroll budget.
      let alsoMatchesHeight = 0;
      if (alsoMatches instanceof HTMLElement) {
        const box = alsoMatches.getBoundingClientRect();
        const styles = window.getComputedStyle(alsoMatches);
        alsoMatchesHeight = Math.ceil(
          box.height + (Number.parseFloat(styles.marginTop) || 0) + (Number.parseFloat(styles.marginBottom) || 0),
        );
      }
      // AnswerCard's required evidence-support label is real content the answer
      // surface always renders, same as universal-also-matches above.
      let supportLabelHeight = 0;
      if (supportLabel instanceof HTMLElement) {
        const box = supportLabel.getBoundingClientRect();
        const styles = window.getComputedStyle(supportLabel);
        supportLabelHeight = Math.ceil(
          box.height + (Number.parseFloat(styles.marginTop) || 0) + (Number.parseFloat(styles.marginBottom) || 0),
        );
      }
      // The source rail is real, always-rendered content in the same sense: it is
      // the cited source list, which the old capsule hid behind a single chip.
      let sourceRailHeight = 0;
      if (sourceRail instanceof HTMLElement) {
        const box = sourceRail.getBoundingClientRect();
        const styles = window.getComputedStyle(sourceRail);
        sourceRailHeight = Math.ceil(
          box.height + (Number.parseFloat(styles.marginTop) || 0) + (Number.parseFloat(styles.marginBottom) || 0),
        );
      }
      return {
        headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : 0,
        surfaceTop: surface ? Math.round(surface.getBoundingClientRect().top) : 0,
        alsoMatchesHeight,
        supportLabelHeight,
        sourceRailHeight,
      };
    });
    // Content-sized section => no unexplained phantom scroll. Submitted universal
    // matches are real content below the answer, so their compact panel may account
    // for the overflow; the old viewport floor created much more empty scroll.
    // The responsive notice keeps its complete instruction while returning the
    // unexplained-scroll allowance to the original 8px phone contract. Submitted
    // universal matches are real content, so subtract their measured height
    // before applying that phantom-overflow budget. That measured height already
    // includes the section's phone bottom margin, so the 8px allowance stays put.
    // AnswerCard's required support label is likewise real, always-rendered
    // content (`support` became a required prop), so it is measured and added
    // the same way rather than absorbed into the flat allowance.
    // The rail is measured and added for the same reason the support label is:
    // always-rendered content, not phantom scroll. The flat 8px unexplained-
    // overflow allowance is deliberately unchanged — that is the part of this
    // guard the redesign must not be allowed to spend.
    const permittedOverflow = geo.alsoMatchesHeight + geo.supportLabelHeight + geo.sourceRailHeight + 8;
    expect(scrollGeometry.owner).toBe("document");
    expect(scrollGeometry.maxScrollTop).toBeLessThanOrEqual(permittedOverflow);
    // Top-aligned: the answer sits just under the header, not pushed toward the dock
    // (a bottom-anchor regression would push surfaceTop far down the viewport).
    expect(geo.surfaceTop - geo.headerBottom).toBeGreaterThanOrEqual(0);
    expect(geo.surfaceTop - geo.headerBottom).toBeLessThanOrEqual(160);
    await expectNoPageHorizontalOverflow(page);
  });

  test("phone long answer stays scrollable and clear of the composer dock", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    const longBody = Array.from(
      { length: 16 },
      (_, index) =>
        `Paragraph ${index + 1}: the lithium source supports baseline renal, thyroid, calcium, weight, blood pressure and interacting-medicine checks, plus escalation for vomiting, diarrhoea, dehydration, tremor, confusion or ataxia.`,
    ).join("\n\n");
    await mockDemoApi(page, {
      answerOverride: (query, documentId, documentIds) => ({
        ...demoAnswer(query, documentId, documentIds),
        answer: longBody,
      }),
    });
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await fillVisibleQuestionInput(page, "lithium dosing");
    await visibleAnswerSubmitButton(page).click();
    await expect(page.getByTestId("plain-answer-response")).toBeVisible({ timeout: 15_000 });
    // Wait for streaming to finish (deterministic) so the geometry below reads the
    // final, settled layout — replaces a fixed 400ms sleep.
    await expect(page.getByTestId("answer-streaming")).toHaveCount(0);
    // Apply the Safari toolbar simulation after answer navigation has settled;
    // the submit flow may update the URL and replace earlier document styles.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-bottom", "112px");
    });
    const main = page.locator("main#main-content");
    const bottomDock = page.locator("form.answer-footer-search-dock");
    // Start from the top so the assertions describe the resting, top-aligned
    // view and the hide reporter has observed the restored position.
    await scrollPrimarySurface(page, 0);
    await expect(bottomDock).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect
      .poll(async () => main.evaluate((el) => Number.parseFloat(window.getComputedStyle(el).paddingBottom)))
      .toBeGreaterThan(200);

    const scrollGeometry = await readPrimaryScrollGeometry(page);
    const geo = await page.evaluate(() => {
      const main = document.querySelector("main#main-content");
      const header = document.querySelector("header");
      const surface = document.querySelector('[data-dashboard-stage="answer-surface"]');
      return {
        mainMarginBottom: main ? Number.parseFloat(window.getComputedStyle(main).marginBottom) : -1,
        mainPaddingBottom: main ? Number.parseFloat(window.getComputedStyle(main).paddingBottom) : 0,
        headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : 0,
        surfaceTop: surface ? Math.round(surface.getBoundingClientRect().top) : 0,
      };
    });
    // Browser phones intentionally scroll the document so Safari can minimize
    // its browser chrome. The long answer still overflows that active owner and
    // remains top-aligned under the overlaid header.
    expect(scrollGeometry.owner).toBe("document");
    expect(scrollGeometry.scrollHeight).toBeGreaterThan(scrollGeometry.clientHeight + 40);
    expect(geo.surfaceTop - geo.headerBottom).toBeLessThanOrEqual(160);
    // Content padding—not an outer margin—keeps the answer endpoint clear of
    // the visible composer and Safari toolbar at the active viewport edge.
    const composerInputTop = await visibleQuestionInput(page).evaluate((el) =>
      Math.round(el.getBoundingClientRect().top),
    );
    expect(geo.mainMarginBottom).toBe(0);
    expect(scrollGeometry.viewportTop).toBe(0);
    expect(Math.abs(scrollGeometry.viewportBottom - scrollGeometry.clientHeight)).toBeLessThanOrEqual(1);
    expect(geo.mainPaddingBottom).toBeGreaterThan(112);
    expect(geo.mainPaddingBottom + 4).toBeGreaterThanOrEqual(scrollGeometry.viewportBottom - composerInputTop);

    // Once the fixed dock is actually hidden, release both the composer and
    // Safari toolbar reserve. The scrollport dimensions stay stable while its
    // bottom padding contracts; the bottom-clamp guard must keep the dock from
    // immediately reappearing as a false upward gesture. Do not compare total
    // scrollHeight here because universal matches can finish streaming while
    // this test moves the scrollport.
    const scrollGeometryBeforeHide = {
      ...(await readPrimaryScrollGeometry(page)),
      paddingBottom: await main.evaluate((el) => Number.parseFloat(window.getComputedStyle(el).paddingBottom)),
    };
    // WebKit retains focus on the submitted composer more aggressively than
    // Chromium. Move focus to the scroll surface to model the user dismissing
    // the composer before scrolling; focused composer chrome must stay visible.
    await expect(async () => {
      await main.focus();
      await scrollPrimarySurface(page, 0);
      await expect(bottomDock).not.toHaveAttribute("data-scroll-hidden", "true", { timeout: 1_000 });
      for (const offset of [120, 240, 360]) {
        await scrollPrimarySurface(page, offset);
      }
      await expect(bottomDock).toHaveAttribute("data-scroll-hidden", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect
      .poll(async () => main.evaluate((el) => Number.parseFloat(window.getComputedStyle(el).paddingBottom)))
      .toBeLessThanOrEqual(13);
    const scrollGeometryAfterHide = {
      ...(await readPrimaryScrollGeometry(page)),
      paddingBottom: await main.evaluate((el) => Number.parseFloat(window.getComputedStyle(el).paddingBottom)),
    };
    expect(scrollGeometryBeforeHide.paddingBottom).toBeGreaterThan(200);
    expect(scrollGeometryAfterHide.clientHeight).toBe(scrollGeometryBeforeHide.clientHeight);
    expect(scrollGeometryAfterHide.scrollHeight).toBeGreaterThan(scrollGeometryAfterHide.clientHeight);
    await expect(bottomDock).toHaveAttribute("data-scroll-hidden", "true");
    await expectNoPageHorizontalOverflow(page);
  });

  test("phone answer result keeps the edge dock and shared chrome synchronized on a short runway", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(page, "/?mode=answer&focus=1");
    await waitForDemoDashboardReady(page);

    const input = await fillVisibleQuestionInput(page, "lithium dosing");
    await visibleAnswerSubmitButton(page).click();
    await expect(page.getByTestId("plain-answer-response")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("answer-streaming")).toHaveCount(0);
    // The library matches sit in one line in the answer's evidence stack, open on
    // arrival and collapsible (owner decision, 2026-09-07). The links are
    // asserted where they rest, at full tap size, and the line is then collapsed
    // for the geometry below.
    const relatedRegion = page.getByRole("region", { name: "Related pages in other modes" });
    const relatedTrigger = relatedRegion.getByTestId("cross-mode-links-line-trigger");
    await expect(relatedTrigger).toHaveAttribute("aria-expanded", "true");
    const relatedItems = relatedRegion.getByRole("listitem");
    await expect(relatedItems).toHaveCount(2);
    await expect(relatedItems.last()).toBeVisible();
    // Collapse before the geometry below. The rest of this test measures the
    // answer's scroll runway with the line put away, which is the state the
    // collapse exists to give the reader.
    await relatedTrigger.click();
    await expect(relatedItems.last()).toBeHidden();

    const main = page.locator("main#main-content");
    const header = page.locator("header.universal-header");
    const dock = page.locator("form.answer-footer-search-dock");
    await expect(dock).toBeVisible();
    // Measure the edge-to-edge contract from the revealed state. Expanding the
    // disclosure above scrolls this short page to its end, which is a genuine
    // downward gesture, so the dock may legitimately be scroll-hidden by the
    // time the panel collapses again — hide-on-scroll working, not a defect
    // (one upward drag brings it straight back). Whether that hide engages
    // depends on the exact answer height, so asserting the resting transform
    // here would pin content height rather than the geometry this test names.
    // Return to the top first: the assertions below are about where a *visible*
    // dock sits (flush bottom, full-bleed), and that is what must hold.
    await scrollPrimarySurface(page, 0);
    await expect
      .poll(async () => await dock.evaluate((node) => window.getComputedStyle(node).transform))
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    const edgeGeometry = await dock.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        bottom: style.bottom,
        left: style.left,
        right: style.right,
        width: rect.width,
        viewportWidth: window.innerWidth,
        rectBottom: rect.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    expect(edgeGeometry.bottom).toBe("0px");
    expect(edgeGeometry.left).toBe("0px");
    expect(edgeGeometry.right).toBe("0px");
    expect(Math.abs(edgeGeometry.width - edgeGeometry.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(edgeGeometry.rectBottom - edgeGeometry.viewportHeight)).toBeLessThanOrEqual(1);

    // Submitting from the auto-focused home composer must not carry stale focus
    // into the newly docked follow-up input. A focused dock is intentionally
    // pinned for keyboard safety, so retaining focus here permanently disables
    // the ordinary touch-scroll hide path.
    await expect(input).not.toBeFocused();
    const scrollGeometry = await readPrimaryScrollGeometry(page);
    const collapseBudget = await main.evaluate((node) => {
      const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]');
      return (
        (collapse?.getBoundingClientRect().height ?? 0) + Number.parseFloat(window.getComputedStyle(node).paddingBottom)
      );
    });
    // AnswerCard's required evidence-support label is real, always-rendered
    // content in this scroll container; account for its measured height the
    // same way the geometry above accounts for chrome, rather than baking a
    // stale pre-label constant into the post-collapse ceiling.
    // Measured, not constant: the support label and the source rail are both
    // always-rendered content whose height moves the scroll budget. The rail
    // joined them when it replaced the single-chip capsule.
    const measuredHeight = (selector: string) =>
      page.evaluate((testId) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        if (!(element instanceof HTMLElement)) return 0;
        const box = element.getBoundingClientRect();
        const styles = window.getComputedStyle(element);
        return Math.ceil(
          box.height + (Number.parseFloat(styles.marginTop) || 0) + (Number.parseFloat(styles.marginBottom) || 0),
        );
      }, selector);
    const supportLabelHeight =
      (await measuredHeight("answer-card-support")) + (await measuredHeight("answer-source-rail"));
    const geometry = {
      maxOffset: scrollGeometry.maxScrollTop,
      collapseBudget,
      postCollapseMaxOffset: Math.max(0, scrollGeometry.maxScrollTop - collapseBudget),
    };
    expect(scrollGeometry.owner).toBe("document");
    // Short answers can straddle the 32px hide-intent threshold as text wraps
    // across browsers and font renderers. Both geometries are safe: enough
    // post-collapse range exercises synchronized hide/reveal; a shorter range
    // must remain pinned by the near-bottom guard while still clearing the dock.
    // Long-answer hide/reveal is covered independently above.
    expect(geometry.maxOffset).toBeGreaterThan(100);
    expect(geometry.maxOffset).toBeLessThan(200 + supportLabelHeight);
    expect(geometry.collapseBudget).toBeGreaterThan(112);
    expect(geometry.collapseBudget).toBeLessThan(128);
    expect(geometry.postCollapseMaxOffset).toBeLessThan(72 + supportLabelHeight);
    // A jump straight onto the bottom edge (PageDown / full-page flick) lands
    // past the post-collapse range; hiding there would clamp content under the
    // finger, so the near-bottom guard keeps both chrome edges visible.
    await scrollPrimarySurface(page, geometry.maxOffset);
    await expect(header).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect(dock).not.toHaveAttribute("data-scroll-hidden", "true");
    await scrollPrimarySurface(page, 0);
    if (geometry.postCollapseMaxOffset >= 32) {
      // Deliberate downward travel that still fits the post-collapse range is
      // the designed hide path: past the 8px top band plus 24px intent.
      await scrollPrimarySurface(page, Math.floor(geometry.postCollapseMaxOffset));
      await expect(header).toHaveAttribute("data-scroll-hidden", "true");
      await expect(dock).toHaveAttribute("data-scroll-hidden", "true");
      // The reserve and both chrome edges animate for 240ms. The hidden state
      // must survive the browser clamping scrollTop against the shrinking range.
      await page.waitForTimeout(320);
      await expect(header).toHaveAttribute("data-scroll-hidden", "true");
      await expect(dock).toHaveAttribute("data-scroll-hidden", "true");
      // Headless WebKit can render no frame during the wall-clock delay. Poll
      // the actual painted geometry so the hidden transform must finish.
      await expect
        .poll(async () => header.evaluate((node) => node.getBoundingClientRect().bottom))
        .toBeLessThanOrEqual(1);
      await expect
        .poll(async () => dock.evaluate((node) => node.getBoundingClientRect().top - window.innerHeight))
        .toBeGreaterThanOrEqual(-1);
      await expect.poll(async () => readMobileComposerReservePx(main)).toBeLessThanOrEqual(1);

      await scrollPrimarySurface(page, 20);
      await expect(header).not.toHaveAttribute("data-scroll-hidden", "true");
      await expect(dock).not.toHaveAttribute("data-scroll-hidden", "true");
    } else {
      const liveEndpoint = (await readPrimaryScrollGeometry(page)).maxScrollTop;
      await scrollPrimarySurface(page, liveEndpoint);
      await expect(header).not.toHaveAttribute("data-scroll-hidden", "true");
      await expect(dock).not.toHaveAttribute("data-scroll-hidden", "true");
      // Measure the LAST thing in the runway, which is the follow-up rows — not
      // a library listitem. The library line is collapsed by the block above, so
      // its listitems are `display:none` and expose no element to measure; this
      // branch only ever ran on a taller answer before the support card was
      // removed, which is why the mismatch went unseen. What the assertion is
      // for is unchanged: the last content clears the dock rather than sitting
      // under it.
      const runwayEnd = page.getByTestId("answer-follow-up-suggestions").getByRole("button").last();
      await expect(runwayEnd).toBeVisible();
      const endpoint = await runwayEnd.evaluate((item) => {
        const dockNode = document.querySelector<HTMLElement>("form.answer-footer-search-dock");
        if (!dockNode) throw new Error("Expected phone answer dock");
        return {
          itemBottom: item.getBoundingClientRect().bottom,
          dockTop: dockNode.getBoundingClientRect().top,
        };
      });
      expect(endpoint.itemBottom).toBeLessThanOrEqual(endpoint.dockTop + 1);
    }

    await input.click();
    await expect(input).toBeFocused();

    await page.setViewportSize({ width: 320, height: 844 });
    // Re-open the library line: the tap-target sweep below is about the links
    // inside it, and the geometry block above deliberately collapsed it.
    await relatedTrigger.click();
    const compactCrossModeRail = page.getByTestId("cross-mode-links-rail");
    await expect(compactCrossModeRail).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
    const compactCrossModeLinks = compactCrossModeRail.getByRole("link");
    const compactCrossModeActions = compactCrossModeRail.getByRole("button");
    await expect.poll(() => compactCrossModeLinks.count()).toBeGreaterThan(0);
    await expect.poll(() => compactCrossModeActions.count()).toBeGreaterThan(0);
    for (const control of await compactCrossModeLinks.all()) {
      await expectMinTouchTarget(control, 48);
    }
    for (const control of await compactCrossModeActions.all()) {
      await expectMinTouchTarget(control, 48);
    }
  });

  test("recent searches appear on the answer home and re-run on tap", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const answerRequests: string[] = [];
    await mockDemoApi(page, { onAnswerRequest: (query) => answerRequests.push(query) });
    const recent = "clozapine monitoring schedule";
    // Seed the owner-scoped session history before the app loads.
    await page.addInitScript(
      ({ storageKey, value }) => {
        window.sessionStorage.setItem(storageKey, JSON.stringify([value]));
      },
      { storageKey: demoRecentQueryStorageKey, value: recent },
    );
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const recentChips = page.getByTestId("shared-home-recent-queries");
    await expect(recentChips).toBeVisible();
    await expect(recentChips).toContainText("Recent searches");
    const chip = recentChips.getByRole("button", { name: recent });
    await expect(chip).toBeVisible();
    await chip.click();

    await expect(page.getByTestId("plain-answer-response")).toBeVisible();
    expect(answerRequests).toContain(recent);
    await expectNoPageHorizontalOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    const newChat = page.getByRole("button", { name: /new chat|new comparison/i });
    await expect(newChat).toBeVisible();
    await newChat.click();
    await waitForDemoDashboardReady(page);

    const homeRecentSearches = page.getByTestId("shared-home-recent-queries");
    await homeRecentSearches.scrollIntoViewIfNeeded();
    await expect(homeRecentSearches).toBeVisible();
    const homeRecentDirection = await homeRecentSearches.evaluate((node) => getComputedStyle(node).flexDirection);
    expect(homeRecentDirection, "home recent-searches should stack on phone width").toBe("column");

    const chipsGroup = homeRecentSearches.locator(".answer-suggestion-chips");
    const mobileJustify = await chipsGroup.evaluate((node) => getComputedStyle(node).justifyContent);
    expect(mobileJustify, "phone home recent-search chips should align to flex-start").toBe("flex-start");
  });

  test("legacy unscoped recent-query storage is purged and never displayed @critical", async ({ page }) => {
    // 2026-07-13 audit finding 4: a historical clinical query written by an
    // older build into the unscoped localStorage key must not resurface for
    // whoever uses the browser next, and must be deleted on load.
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    const legacyQuery = "legacy cross-user clozapine query";
    await page.addInitScript(
      ({ storageKey, value }) => {
        window.localStorage.setItem(storageKey, JSON.stringify([value]));
        window.sessionStorage.setItem(storageKey, JSON.stringify([value]));
      },
      { storageKey: recentQueryStorageKey, value: legacyQuery },
    );
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await expect(page.getByText(legacyQuery)).toHaveCount(0);
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), recentQueryStorageKey)).toBeNull();
    await expect
      .poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), recentQueryStorageKey))
      .toBeNull();
  });

  test("answer search URL opens chat without the answer home copy", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    const answerRequests: string[] = [];
    const question = "What clozapine monitoring items are shown in the table image?";
    await mockDemoApi(page, {
      answerDelayMs: 1500,
      onAnswerRequest: (query) => answerRequests.push(query),
    });

    await page.goto(`/?mode=answer&q=${encodeURIComponent(question)}&focus=1&run=1`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("shared-home-empty-state")).toHaveCount(0);
    await expect(page.getByText("What can I help with?", { exact: true })).toHaveCount(0);
    // Prefer :visible — a useSearchParams() Suspense ancestor can leave a persistent
    // hidden S: clone (search-chrome invariant 17), which makes getByTestId strict-mode fail.
    // AnswerProgress owns the in-flight state; AnswerSkeleton no longer renders its own
    // "Loading answer" status line beside it, so the wait is asserted on the progress
    // element's active state rather than the retired label.
    await expect(page.locator('[data-testid="answer-progress"][data-progress-state="active"]:visible')).toBeVisible();
    await expect.poll(() => answerRequests[0]).toBe(question);

    const questionEcho = page.getByTestId("user-question-bubble");
    await expect(questionEcho).toBeVisible({ timeout: uiAssertionTimeoutMs });
    await expect(questionEcho).toContainText(question);
    await expect(page.getByTestId("plain-answer-response")).toContainText("synthetic clozapine table image highlights");
    await expect(visibleQuestionInput(page)).toHaveValue("");
    await expect(page.getByTestId("shared-home-empty-state")).toHaveCount(0);
    await expect(page.getByText("What can I help with?", { exact: true })).toHaveCount(0);
    expect(answerRequests).toEqual([question]);
    await expectNoPageHorizontalOverflow(page);
  });

  test("stopping generation exposes a stable rerun action without answer output", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page, { answerDelayMs: 1500 });
    const question = "What monitoring is required for clozapine?";
    await page.goto(`/?mode=answer&q=${encodeURIComponent(question)}&run=1`, { waitUntil: "domcontentloaded" });

    const stop = page.getByTestId("stop-answer");
    await expect(stop).toBeVisible();
    await stop.focus();
    await page.keyboard.press("Enter");

    const cancelled = page.getByTestId("answer-cancelled");
    await expect(cancelled).toContainText("Generation stopped");
    await expect(cancelled.getByRole("button", { name: "Run again" })).toBeVisible();
    await expect(page.getByTestId("plain-answer-response")).toHaveCount(0);
    await expect(page.getByTestId("answer-streaming")).toHaveCount(0);
    // Intentional fixed wait: this asserts a NEGATIVE (no answer streams in after
    // Stop), so there is no event to await — we give a late async render time to
    // (wrongly) appear, then confirm it did not.
    await page.waitForTimeout(1700);
    await expect(page.getByTestId("plain-answer-response")).toHaveCount(0);
  });

  test("answer results surface cross-mode quick links", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const answerRequests: string[] = [];
    await mockDemoApi(page, { onAnswerRequest: (query) => answerRequests.push(query) });
    const question = "What is the maximum dose of clozapine?";
    await page.goto(`/?mode=answer&q=${encodeURIComponent(question)}&run=1`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("plain-answer-response")).toBeVisible({ timeout: uiAssertionTimeoutMs });

    const answerSurface = page.locator('[data-dashboard-stage="answer-surface"]');
    const strip = answerSurface.getByTestId("cross-mode-links");
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(answerSurface.getByTestId("cross-mode-links")).toHaveCount(1);
    // One collapsed line under the answer, opened on demand (owner decision,
    // 2026-08-26, "direction B"). Everything below still has to work through it,
    // so the test opens it rather than dropping the coverage.
    //
    // The closed state is asserted here at 1280px, not only at phone width. It
    // shipped broken on desktop precisely because the one test that checked the
    // collapse ran at 390px: `hidden` beside a `md:flex` in the same class list
    // loses to the media-query rule from 768px up, so the rail stayed open while
    // its trigger reported `aria-expanded="false"`. Now that the line rests OPEN
    // the same mechanic would hide the failure the other way round, which is why
    // the closed state below is still asserted on the rail's computed display
    // rather than on the trigger's word for it.
    const trigger = strip.getByTestId("cross-mode-links-line-trigger");
    const rail = strip.getByTestId("cross-mode-links-rail");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(rail).toBeVisible();
    await expect(rail).toHaveCSS("display", "flex");
    // Close and re-open: the collapse is the half that regressed before.
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(rail).toBeHidden();
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(rail).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(strip.getByText("Medication", { exact: true }).filter({ visible: true })).toBeVisible();
    const medicationSearch = strip.getByRole("button", { name: "Search Clozapine in Medication" });
    await expect(medicationSearch).toBeVisible();
    // Two signposted actions per card: search inside the mode, and open the
    // record itself. The open control shares the title link's destination and
    // telemetry, so it must not collide with the title's accessible name.
    // `exact`: the rail also carries "Open Clozapine-specific adverse effects",
    // and a substring name matches both.
    const medicationOpen = strip.getByRole("link", { name: "Open Clozapine", exact: true });
    await expect(medicationOpen).toBeVisible();
    await expect(medicationOpen).toHaveAttribute("href", /./);
    await expect(strip.getByText("SGA / TRS", { exact: true }).filter({ visible: true })).toBeVisible();

    const followUps = answerSurface.getByTestId("answer-follow-up-suggestions");
    if (await followUps.isVisible()) {
      const stripBox = await strip.boundingBox();
      const followUpBox = await followUps.boundingBox();
      expect(stripBox).toBeTruthy();
      expect(followUpBox).toBeTruthy();
      // Library context now closes the evidence/safety stack before the next
      // conversational turn begins.
      expect(stripBox!.y).toBeLessThan(followUpBox!.y);
    }

    const medicationLink = strip.getByRole("link", { name: "Clozapine", exact: true });
    await expect(medicationLink).toHaveAttribute("href", "/medications/clozapine");
    await expectMinTouchTarget(medicationLink, 48);
    await expectMinTouchTarget(medicationSearch, 48);
    await waitForReactEventHandler(medicationLink, "onClick");
    await medicationLink.click();
    await expect(page).toHaveURL(/\/medications\/clozapine/, { timeout: 45_000 });
    // MedicationNavHeader portals above `medication-page-*`; InPageNavHeader's
    // back control is always named via aria-label (`Back to ${label}`), which is
    // the only stable accessible name across desktop (visible text) and phone
    // (label hidden). See tests/in-page-nav-playwright-contract.test.ts.
    await expect(page.getByTestId("medication-page-clozapine")).toBeVisible();
    const medicationsBack = page.getByRole("link", { name: "Back to medications" }).filter({ visible: true });
    await expect(medicationsBack).toBeVisible();
    await medicationsBack.click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/" &&
        url.searchParams.get("mode") === "answer" &&
        url.searchParams.get("q") === question &&
        url.searchParams.get("run") === "1",
      { timeout: 45_000 },
    );
    await expect(page.getByTestId("plain-answer-response")).toBeVisible({ timeout: uiAssertionTimeoutMs });
    expect(answerRequests).toEqual([question]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("plain-answer-response")).toBeVisible({ timeout: uiAssertionTimeoutMs });
    expect(answerRequests).toEqual([question]);
    await expectNoPageHorizontalOverflow(page);
  });

  test("answer mode keeps prior turns visible for follow-up questions", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockDemoApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const firstQuestion = "lithium dosing";
    await fillVisibleQuestionInput(page, firstQuestion);
    await visibleAnswerSubmitButton(page).click();

    await expect(page.getByTestId("plain-answer-response")).toHaveCount(1, { timeout: uiAssertionTimeoutMs });
    // One chat: every question in the thread is a bubble, the newest included.
    // The card no longer carries a muted echo of its own question.
    await expect(page.getByTestId("user-question-bubble")).toHaveCount(1);
    await expect(page.getByTestId("user-question-bubble")).toContainText(firstQuestion);
    await expect(page.getByTestId("answer-card-query")).toHaveCount(0);
    await expect(visibleAnswerFollowUpSuggestions(page)).toBeVisible();

    const composer = visibleQuestionInput(page);
    await expect(composer).toHaveValue("");
    await expect(composer).toHaveAttribute("placeholder", "Ask a follow-up...");

    const followUp = "what about renal impairment?";
    await fillVisibleQuestionInput(page, followUp);
    await visibleAnswerSubmitButton(page).click();

    const questionBubbles = page.getByTestId("user-question-bubble");
    await expect(questionBubbles).toHaveCount(2, { timeout: uiAssertionTimeoutMs });
    await expect(questionBubbles.first()).toContainText(firstQuestion);
    await expect(questionBubbles.last()).toContainText(followUp);
    await expect(page.getByTestId("plain-answer-response")).toHaveCount(1);
    await expect(page.locator('[data-dashboard-stage="answer-thread-turn"][data-collapsed="true"]')).toHaveCount(1);
    await expect(composer).toHaveValue("");
    await expect(page).toHaveURL(/\?mode=answer&q=what\+about\+renal\+impairment\%3F&run=1/);
    await expectNoPageHorizontalOverflow(page);

    await waitForPersistedAnswerThread(page, 1);
    await page.reload();
    await waitForDemoDashboardReady(page);
    await expect(async () => {
      await expect(page.getByTestId("user-question-bubble")).toHaveCount(2);
    }).toPass({ timeout: 15_000 });
    await expect(page.getByTestId("user-question-bubble").first()).toContainText(firstQuestion);
    await expect(page.getByTestId("user-question-bubble").last()).toContainText(followUp);
    await expect(page.locator('[data-dashboard-stage="answer-thread-turn"][data-collapsed="true"]')).toHaveCount(1);
  });

  test("answer follow-up suggestions run the next question", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockDemoApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await fillVisibleQuestionInput(page, "lithium dosing");
    await visibleAnswerSubmitButton(page).click();
    await expect(visibleAnswerFollowUpSuggestions(page)).toBeVisible({ timeout: uiAssertionTimeoutMs });

    const suggestion = visibleAnswerFollowUpSuggestions(page).getByRole("button").first();
    const suggestionText = (await suggestion.textContent())?.trim();
    expect(suggestionText).toBeTruthy();
    await suggestion.click();

    await expect(page.getByTestId("user-question-bubble")).toHaveCount(2, { timeout: uiAssertionTimeoutMs });
    await expect(page.getByTestId("user-question-bubble").last()).toContainText(suggestionText ?? "");
  });

  test("quote follow-up stages a composer draft from evidence quotes", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockDemoApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    const question = "What clozapine monitoring items are shown in the table image?";
    await fillVisibleQuestionInput(page, question);
    await visibleAnswerSubmitButton(page).click();
    await expect(page.getByTestId("plain-answer-response")).toBeVisible({ timeout: uiAssertionTimeoutMs });

    // The quote cards' follow-up action came across with the passage: it now lives
    // in the source drawer, beneath the passage it asks about.
    const followUpRail = page.getByTestId("answer-source-rail");
    await expect(followUpRail).toBeVisible();
    await followUpRail.getByTestId("answer-source-rail-row").first().click();

    const followUpDrawer = page.getByTestId("answer-source-drawer");
    await expect(followUpDrawer).toBeVisible();
    await expect(followUpDrawer.getByTestId("answer-source-drawer-passage")).toBeVisible();

    const followUpButton = followUpDrawer.getByTestId("answer-source-drawer-follow-up");
    await expect(followUpButton).toBeVisible();
    await followUpButton.click();

    const composer = visibleQuestionInput(page);
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(/Using the quoted source from/i);
    await expect(composer).toHaveValue(/Quote:/i);
    await expect(visibleAnswerSubmitButton(page)).toBeEnabled();
  });

  test("source-only answer keeps support rows honest", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockDemoApi(page, {
      answerOverride: (query, documentId, documentIds) => {
        const base = demoAnswer(query, documentId, documentIds);
        return {
          ...base,
          answer:
            "I found source material, but the generated answer included clinical numbers that could not be matched verbatim to its cited source chunks. Review the sources directly before using this for dose, threshold, route, timing, monitoring, or risk decisions.",
          grounded: false,
          confidence: "low",
          answerQualityTier: "source_only",
          fallbackReason: "source_only_no_api",
          citations: [],
          answerSections: [],
          quoteCards: [],
          visualEvidence: [],
        };
      },
    });
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await fillVisibleQuestionInput(page, "lithium");
    await visibleAnswerSubmitButton(page).click();

    // Owner decision (2026-09-03): the Source-only pill that used to sit below
    // the prose is gone. Its governed wording leads the Answer limitations
    // disclosure, and the chip that opens it carries the word "Source-only" so
    // the provenance fact still reaches the default view — `VerificationNotice`
    // stays print-only on this answer, so if the chip loses that word nothing
    // on screen says no model wrote the answer.
    await expect(page.getByTestId("verification-notice")).toBeHidden();
    await expect(page.getByTestId("source-only-disclosure")).toHaveCount(0);
    await expect(page.getByTestId("answer-source-status-row")).toHaveCount(0);

    const limitationsChip = page.getByTestId("answer-limitations-trigger");
    const limitationsDetail = page.locator("#answer-limitations-detail");
    const sourceOnlyRail = page.getByTestId("answer-source-rail");
    await expect(limitationsChip).toBeVisible();
    await expect(sourceOnlyRail).toBeVisible();
    await expect(limitationsChip).toContainText("Source-only");
    // Opens a dialog, so it announces `haspopup` rather than `expanded`/`controls`. The two are
    // not interchangeable: `aria-expanded` promises a region revealed in place, which is the
    // behaviour that was removed. Asserted as absent, not merely changed, so a half-finished
    // revert that leaves both attributes on the trigger fails here.
    await expect(limitationsChip).toHaveAttribute("aria-haspopup", "dialog");
    await expect(limitationsChip).not.toHaveAttribute("aria-expanded", /.*/);
    await expect(limitationsChip).not.toHaveAttribute("aria-controls", /.*/);
    // Not merely hidden — the sheet is not in the document until it is opened.
    await expect(limitationsDetail).toHaveCount(0);

    // The chip is a full-size button carrying a small pill, so it keeps the
    // 48px tap region rather than the pill's own height.
    await expectMinTouchTarget(limitationsChip);

    // The prose runs straight into the source rail now that nothing sits between
    // them.
    const proseBox = await page.getByTestId("plain-answer-prose").boundingBox();
    const railBox = await sourceOnlyRail.boundingBox();
    expect(proseBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect(railBox!.y).toBeGreaterThanOrEqual(proseBox!.y + proseBox!.height);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await limitationsChip.focus();
    await expect(limitationsChip).toBeFocused();
    await page.keyboard.press("Enter");
    const limitationsSheet = page.getByRole("dialog", { name: "Answer limitations" });
    await expect(limitationsSheet).toBeVisible();
    await expect(limitationsDetail).toBeVisible();
    // The governed extractive wording, verbatim, as the first row of the sheet. This is the
    // assertion that matters most in this block: the wording must survive the move out of the
    // in-flow panel unchanged, because it is the caution a source-only answer rests on.
    await expect(limitationsDetail.getByTestId("answer-limitation-source-only")).toContainText(
      "Copied from cited sources without model synthesis. Sources could not be shown to support every claim. Check each dose, number, timing and threshold before acting.",
    );

    // Escape closes, and focus comes back to the chip that opened it — the trigger no longer
    // toggles, so a second Enter would reopen rather than close.
    await page.keyboard.press("Escape");
    await expect(limitationsSheet).toHaveCount(0);
    await expect(limitationsChip).toBeFocused();

    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await expect(limitationsChip).toBeVisible();
    await expect(limitationsChip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(limitationsSheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(limitationsSheet).toHaveCount(0);
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });

    for (const width of [320, 390, 639, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 768 ? 820 : 900 });
      await expect(limitationsChip).toBeVisible();
      // The label grew a "Source-only" prefix, so the narrow widths are the ones
      // that matter here.
      await expectMinTouchTarget(limitationsChip);
      await expectNoPageHorizontalOverflow(page);
    }

    // The "Review source match" card is gone with the support card. The caution
    // it restated is not: the limitations chip carries "Source-only" on the
    // default view and its panel carries the governed wording, and the support
    // chip states the degraded support level rather than reading like a fully
    // supported answer.
    const sourceOnlySupportChip = page.getByTestId("answer-card-support");
    await expect(sourceOnlySupportChip).toBeVisible();
    await expect(sourceOnlySupportChip).toHaveAttribute("data-support", /limited|unassessed/);
    await expect(page.getByTestId("answer-support-card")).toHaveCount(0);
    await expect(page.getByTestId("answer-clinical-notes-trigger")).toHaveCount(0);
    await expect(page.getByTestId("answer-evidence-trigger")).toHaveCount(0);

    // A source-only answer still cites real documents, so the rail must list them
    // and the drawer must open — the degraded path is exactly where a clinician
    // most needs the route back to the page.
    const sourceOnlyRow = sourceOnlyRail.getByTestId("answer-source-rail-row").first();
    await expect(sourceOnlyRow).toBeVisible();
    await sourceOnlyRow.click();
    const sourceOnlyDrawer = page.getByTestId("answer-source-drawer");
    await expect(sourceOnlyDrawer).toBeVisible();
    await expect(sourceOnlyDrawer.getByRole("link", { name: "View original PDF" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sourceOnlyDrawer).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("review-due source-only answers keep the overdue detail behind the evidence-gaps chip", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page, {
      answerOverride: (query, documentId, documentIds) => {
        const base = demoAnswer(query, documentId, documentIds);
        return {
          ...base,
          answerQualityTier: "source_only" as const,
          // The combination that matters: source-only AND overdue AND carrying a
          // render warning. The governed verification line is print-only on a
          // source-only answer and the collapsed Source-only pill says only
          // "Source-only · verify passages", so the evidence chip is the one
          // thing on the default view that can state the answer is overdue — and
          // a warning must not displace it there.
          faithfulnessWarning: "One sentence could not be matched to a cited passage.",
          sources: base.sources.map((source, index) =>
            index === 0
              ? {
                  ...source,
                  source_metadata: {
                    ...source.source_metadata!,
                    document_status: "review_due" as const,
                    review_date: "2025-11-01",
                  },
                }
              : source,
          ),
        };
      },
    });
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await fillVisibleQuestionInput(page, "What lithium toxicity symptoms need review?");
    await visibleAnswerSubmitButton(page).click();

    // Owner decision (2026-09-03): the answer body owns no status row at all.
    // Both the Source-only wording and the per-source overdue detail are
    // statements about this answer's evidence, so both live behind the
    // limitations chip with the other such statements.
    await expect(page.getByTestId("answer-source-status-row")).toHaveCount(0);
    await expect(page.getByTestId("source-only-disclosure")).toHaveCount(0);

    const gapsChip = page.getByTestId("answer-limitations-trigger");
    await expect(gapsChip).toBeVisible({ timeout: uiAssertionTimeoutMs });
    // All three parts, not one. This chip is the only thing on the default view
    // that says no model wrote the answer AND that a cited source is overdue —
    // `VerificationNotice` is print-only here — so a limitation count must never
    // displace either prefix.
    await expect(gapsChip).toContainText("Source-only");
    await expect(gapsChip).toContainText("Review due");
    await expect(gapsChip).toContainText(/\d+ limitations?/);
    await expect(gapsChip).toHaveAttribute("aria-haspopup", "dialog");
    const gapsDetail = page.locator("#answer-limitations-detail");
    await expect(gapsDetail).toHaveCount(0);

    const reviewDueTab = page.getByTestId("retrieval-state-stale-toggle");
    await expect(reviewDueTab).toHaveCount(0);
    await expect(page.getByTestId("retrieval-state-overdue-row")).toHaveCount(0);

    await gapsChip.click();
    await expect(page.getByRole("dialog", { name: "Answer limitations" })).toBeVisible();
    await expect(gapsDetail).toBeVisible();
    // And the count is of gaps only. A source being due for review is a
    // statement about that source's currency, not a missing piece of evidence,
    // and it is already the other half of this label — counting it again would
    // both overstate the gaps and report one fact twice under the wrong name.
    // Derived from what the panel actually renders, so the assertion holds when
    // the demo corpus changes how many warnings it produces.
    // The panel's own rows, excluding the heading and the source-only row that
    // leads it — neither is a counted limitation.
    const sourceOnlyRow = gapsDetail.getByTestId("answer-limitation-source-only");
    await expect(sourceOnlyRow).toBeVisible();
    // The wording is state-specific by design (#207 precedence lets stale
    // outrank source_only), so this asserts the ATTRIBUTION rather than one
    // state's sentence: every extractive variant opens "Copied from", and none
    // of them may claim a model wrote the answer.
    await expect(sourceOnlyRow).toContainText(/Copied from/);
    await expect(sourceOnlyRow).not.toContainText("AI-generated");
    // Excluded by ELEMENT, not by text. The source-only row's eyebrow is
    // `uppercase`, so `innerText` reports "SOURCE-ONLY" and a case-sensitive
    // text filter silently counted this row as a limitation.
    //
    // The "Answer limitations" filter below is now belt-and-braces: that heading became the
    // sheet's own title and is no longer a `<p>` inside this container. It is kept so the
    // count stays right if the heading is ever reinstated in the body.
    const panelWarnings = (
      await gapsDetail.locator('> p:not([data-testid="answer-limitation-source-only"])').allInnerTexts()
    ).filter((text) => !/^Answer limitations$/i.test(text.trim()));
    const gapWarnings = panelWarnings.filter((text) => !/\bdue for review\.$/.test(text.trim()));
    expect(panelWarnings.length).toBeGreaterThan(0);
    await expect(gapsChip).toContainText(`${gapWarnings.length} limitation${gapWarnings.length === 1 ? "" : "s"}`);
    // The banner is inside the disclosure, not merely somewhere on the page.
    await expect(gapsDetail.getByTestId("retrieval-state-stale-toggle")).toBeVisible();
    await expect(reviewDueTab).toContainText("Review due");
    await expect(reviewDueTab).toHaveAttribute("aria-expanded", "false");
    const reviewDuePanel = page.locator(`#${await reviewDueTab.getAttribute("aria-controls")}`);
    await expect(reviewDuePanel).toBeHidden();

    for (const viewport of [
      { width: 320, height: 844 },
      { width: 390, height: 844 },
      { width: 639, height: 900 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      // Reading boundingBox() immediately after a resize can race the
      // reflow — Chromium sometimes reports one sibling's box mid-transition
      // (seen ~10px short) while the other has already settled. Two rAF
      // round-trips let layout finish before we measure.
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      // The chip keeps its full tap region at every width, and the longer
      // three-part label must not push the page into horizontal overflow.
      await expect(gapsChip).toBeVisible();
      await expectMinTouchTarget(gapsChip);
      await expectNoPageHorizontalOverflow(page);
      // The overdue detail stays reachable and inside the disclosure, however
      // narrow the viewport gets.
      const gapsDetailBox = await gapsDetail.boundingBox();
      const reviewDueBox = await reviewDueTab.boundingBox();
      expect(gapsDetailBox).toBeTruthy();
      expect(reviewDueBox).toBeTruthy();
      expect(reviewDueBox!.y).toBeGreaterThanOrEqual(gapsDetailBox!.y - 1);
      expect(reviewDueBox!.x).toBeGreaterThanOrEqual(gapsDetailBox!.x - 1);
      expect(reviewDueBox!.x + reviewDueBox!.width).toBeLessThanOrEqual(gapsDetailBox!.x + gapsDetailBox!.width + 1);
      await expectNoPageHorizontalOverflow(page);
    }

    await page.setViewportSize({ width: 390, height: 844 });

    await testInfo.attach("review-due-tab-phone", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });

    // Both disclosures — the chip and the banner inside the sheet it opens — stay operable from
    // the keyboard in forced colors with motion reduced.
    //
    // The sheet is still open from the click above, and it has to be closed before the chip can
    // be driven again: while a sheet is open the trigger sits behind the overlay and focus is
    // trapped inside the dialog. Escape closes and returns focus to the chip, which is the whole
    // round trip this block is here to prove.
    await page.keyboard.press("Escape");
    await expect(gapsDetail).toHaveCount(0);
    await expect(gapsChip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(gapsDetail).toBeVisible();

    await reviewDueTab.focus();
    await expect(reviewDueTab).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(reviewDueTab).toHaveAttribute("aria-expanded", "true");
    // Re-resolved, not reused. `reviewDuePanel` above was captured from the first mount, and the
    // banner's panel id comes from `useId` — closing the sheet unmounts it, so reopening mints a
    // new id and the old locator matches nothing. This is the one real behaviour change the sheet
    // brings to this test: an in-flow panel was only ever hidden, never unmounted.
    const reopenedReviewDuePanel = page.locator(`#${await reviewDueTab.getAttribute("aria-controls")}`);
    await expect(reopenedReviewDuePanel).toBeVisible();
    await expect(page.getByTestId("retrieval-state-overdue-row")).toHaveCount(1);
    await expect(page.getByTestId("retrieval-state-open-source")).toBeVisible();
  });

  test("the problem list opens as a sheet that is fully readable on a phone", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await fillVisibleQuestionInput(page, "What lithium monitoring is required?");
    await visibleAnswerSubmitButton(page).click();

    const trigger = page.getByTestId("answer-feedback-trigger");
    await expect(trigger).toBeVisible({ timeout: uiAssertionTimeoutMs });
    await trigger.click();

    const sheet = page.getByTestId("answer-feedback-sheet");
    await expect(sheet).toBeVisible({ timeout: uiAssertionTimeoutMs });

    // The defect this replaced: as an in-flow disclosure the list opened partly
    // behind the fixed phone composer, so it LOOKED complete when it was not.
    // Every option must now be inside the viewport with the sheet at rest — no
    // page scroll, and none of it under the composer.
    const options = sheet.getByTestId("answer-review-panel").getByRole("button");
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(4);
    const viewport = page.viewportSize()!;
    for (let index = 0; index < optionCount; index += 1) {
      const option = options.nth(index);
      const box = await option.boundingBox();
      expect(box, `option ${index} has no box`).toBeTruthy();
      expect(box!.y, `option ${index} starts above the viewport`).toBeGreaterThanOrEqual(-1);
      expect(box!.y + box!.height, `option ${index} runs past the viewport`).toBeLessThanOrEqual(viewport.height + 1);
      // Production tap-target floor, not the generic WCAG 44px: 48px is what
      // this repo ships and dropping to 44 reintroduces a known ui-smoke flake.
      expect(box!.height, `option ${index} tap target`).toBeGreaterThanOrEqual(48);
    }
    // The affirmative verdict is the thumb up beside the trigger. Offering it
    // inside a list opened to report a fault records the opposite of the intent.
    await expect(sheet.getByRole("button", { name: /Verified/ })).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);

    await testInfo.attach("report-a-problem-sheet-phone", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });

    // Dismissing returns the reader to the control they tapped, and leaves the
    // phone composer where it was — the scroll-hide trap the old disclosure fell
    // into when it tried to scroll itself clear.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(visibleAnswerSubmitButton(page)).toBeVisible();
  });

  for (const viewport of [
    { name: "phone", width: 390, height: 820, sheet: true },
    { name: "tablet", width: 768, height: 1024, sheet: true },
    { name: "near sheet breakpoint", width: 1018, height: 900, sheet: true },
    { name: "desktop", width: 1440, height: 900, sheet: false },
  ] as const) {
    test(`answer support popups adapt at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockDemoApi(page);
      await gotoApp(page, "/");
      await waitForDemoDashboardReady(page);

      await fillVisibleQuestionInput(page, "What clozapine monitoring items are shown in the table image?");
      await visibleAnswerSubmitButton(page).click();

      const plainAnswer = page.getByTestId("plain-answer-response");
      await expect(plainAnswer).toBeVisible();
      await expect(page.getByTestId("answer-card-support")).toBeVisible();
      await expectNoPageHorizontalOverflow(page);

      // One source surface at every breakpoint: the rail on the page, the drawer
      // behind each row. There is no capsule, no popover/sheet split, and no
      // separate clinical-notes or evidence sheet to reach.
      const rail = page.getByTestId("answer-source-rail");
      await expect(rail).toBeVisible();
      const railRow = rail.getByTestId("answer-source-rail-row").first();
      await expectMinTouchTarget(railRow);
      // The card is one control that opens the drawer; the two routes to the PDF
      // itself live in the drawer (its header link and "View original PDF"), so
      // the card does not carry a second competing target at this width.
      await expect(railRow).toHaveAccessibleName(/open source detail$/);
      await railRow.click();
      const drawer = page.getByTestId("answer-source-drawer");
      await expect(drawer).toBeVisible();
      // No claim opened this drawer, so it carries no support sentence; the
      // passage and the route to the PDF are what it must show.
      await expect(drawer.getByTestId("answer-source-drawer-support")).toHaveCount(0);
      await expect(drawer.getByTestId("answer-source-drawer-passage")).toBeVisible();
      await expectMinTouchTarget(drawer.getByRole("link", { name: "View original PDF" }));
      const drawerPager = drawer.getByTestId("answer-source-drawer-pager");
      if (await drawerPager.count()) {
        await expectMinTouchTarget(drawerPager.getByRole("button", { name: "Next source" }));
      }
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(railRow).toBeFocused();

      await expect(page.locator("#answer-clinical-notes-drawer-mobile-trigger")).toHaveCount(0);
      await expect(page.locator("#answer-evidence-drawer-mobile-trigger")).toHaveCount(0);

      await expectNoPageHorizontalOverflow(page);
    });
  }

  for (const viewport of [
    { name: "390px mobile", width: 390, height: 844, expands: true },
    { name: "768px tablet", width: 768, height: 1024, expands: true },
    { name: "1280px desktop", width: 1280, height: 800, expands: false },
  ] as const) {
    test(`clinical table mobile expansion at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockDemoApi(page);
      await gotoApp(page, "/");
      await waitForDemoDashboardReady(page);

      await fillVisibleQuestionInput(page, "What clozapine monitoring items are shown in the table image?");
      const submitAnswer = visibleAnswerSubmitButton(page);
      await submitAnswer.click();

      // Decision 2 (2026-08-24): the wide-screen table column is gone at every
      // breakpoint, so a table is only ever reached through the source drawer.
      await expect(page.getByLabel("Inline table preview")).toHaveCount(0);
      await expect(page.getByTestId("table-specific-answer-layout")).toHaveAttribute(
        "data-desktop-table-aside",
        "false",
      );
      const tableRail = page.getByTestId("answer-source-rail");
      await expect(tableRail).toBeVisible();
      // A table hangs off the source it was cited from, which is not necessarily
      // the best match — open the row that actually has it.
      const tableRows = tableRail.getByTestId("answer-source-rail-row");
      const tableDrawer = page.getByTestId("answer-source-drawer");
      const clinicalTable = tableDrawer.getByLabel("Inline table preview").first();
      let openedTableRow = false;
      for (let index = 0; index < (await tableRows.count()); index += 1) {
        await tableRows.nth(index).click();
        await expect(tableDrawer).toBeVisible();
        if (await clinicalTable.count()) {
          openedTableRow = true;
          break;
        }
        await page.keyboard.press("Escape");
        await expect(tableDrawer).toHaveCount(0);
      }
      expect(openedTableRow).toBe(true);
      await expect(clinicalTable).toBeVisible();
      await expect(clinicalTable).toContainText("FBC/ANC");
      await expect(clinicalTable).not.toContainText(/page|p\.|chunk|Synthetic clozapine monitoring protocol/i);

      const expandButton = clinicalTable.getByTestId("table-expand-button");
      const tableSurface = clinicalTable.getByTestId("accessible-table-surface");
      if (!viewport.expands) {
        // Desktop reads the table in place inside the drawer rather than expanding it.
        await expect(expandButton).toHaveCount(0);
        await expect(tableSurface).toBeVisible();
        await expectNoPageHorizontalOverflow(page);
        return;
      }

      await expect(tableSurface).not.toHaveAttribute("role", "button");
      await expect(tableSurface).not.toHaveAttribute("tabindex");
      await expect(expandButton).toHaveAttribute("aria-expanded", "false");
      const surfaceDialog = await openMobileTableFullscreen(page, clinicalTable);
      await expect(expandButton).toHaveAttribute("aria-expanded", "true");
      await expect(surfaceDialog.getByRole("button", { name: "Close full-screen table" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      expect(await surfaceDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Tab");
      expect(await surfaceDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await expect(surfaceDialog).toContainText("FBC/ANC");
      await page.keyboard.press("Escape");
      await expect(surfaceDialog).toBeHidden();
      await expect(expandButton).toHaveAttribute("aria-expanded", "false");

      await expect(expandButton).toBeVisible();
      const dialog = await openMobileTableFullscreen(page, clinicalTable);
      await expect(dialog.getByRole("table")).toBeVisible();
      await expect(dialog).toContainText("FBC/ANC");
      await expect(dialog).not.toContainText(/page|p\.|chunk|Synthetic clozapine monitoring protocol/i);
      // The full-screen table now opens from inside the source drawer, which is
      // itself a dialog carrying the document's name — so a by-name lookup is
      // ambiguous. `openMobileTableFullscreen` already hands back the right
      // handle; the focus-trap assertions are unchanged.
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Shift+Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await expectNoPageHorizontalOverflow(page);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(expandButton).toBeFocused();
    });
  }

  test("dashboard favourites selection stays on the shared home; submitted links open Favourites", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    const redirectMeasureErrors: string[] = [];
    page.on("pageerror", (error) => {
      if (error.message.includes("cannot have a negative time stamp")) redirectMeasureErrors.push(error.message);
    });

    // Bare /?mode= favourites is the shared home with Favourites preselected —
    // not a redirect to /favourites (legacy proxy used to hop early).
    await gotoApp(page, "/?mode=favourites&q=lithium%20set&focus=1");
    await expect(page).toHaveURL(/\/\?mode=favourites&q=lithium(\+|%20)set&focus=1$/);
    await expect(page.getByRole("button", { name: "Mode Favourites" })).toBeVisible();
    expect(redirectMeasureErrors).toEqual([]);

    await gotoApp(page, "/?mode=favourites&q=lithium%20set&focus=1&run=1");
    await expect(page).toHaveURL(/\/favourites\?q=lithium\+set&focus=1&run=1$/);
    await expectSingleSettledOwner(page.getByTestId("favourites-hub"), { message: "favourites hub owner" });
    await expect(page.getByRole("heading", { level: 1, name: "Favourites", exact: true })).toBeVisible();
  });

  test("dashboard differentials selection stays on the shared home; submitted links open Differentials", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);

    await gotoApp(page, "/?mode=differentials&q=acute+confusion&focus=1");
    await expect(page).toHaveURL(/\/\?mode=differentials&q=acute(\+|%20)confusion&focus=1$/);
    await expect(page.getByRole("button", { name: "Mode Differentials" })).toBeVisible();

    await gotoApp(page, "/?mode=differentials&q=acute+confusion&focus=1&run=1");
    await expect(page).toHaveURL(/\/differentials\/search\?q=acute\+confusion&focus=1&run=1\b/);
    // Submitted differentials deep links resolve to the standalone results
    // surface (`autoRunSearch`), not the mode-home template. Production
    // hydration can briefly overlap the outgoing server tree and the settled
    // client tree on this redirect; wait for one owner before strict locators.
    await expectSingleSettledOwner(page.getByTestId("differentials-search-results"), {
      message: "differentials redirect search results owner",
    });
    await expect(page.getByRole("button", { name: "Mode Differentials" })).toBeVisible();
    await expect(page.getByTestId("differentials-home")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "acute confusion" })).toBeVisible();
  });

  test("DSM diagnosis mode redirects into the local catalogue and opens a diagnosis", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(page, "/?mode=dsm&q=major+depressive&focus=1&run=1");

    await expect(page).toHaveURL(/\/dsm\/search\?q=major\+depressive&focus=1&run=1$/, {
      timeout: 30_000,
    });
    // Own the visible page root and derive every in-page locator from it (#093).
    // Scoping only the root assertion still leaves the ribbon and result rows
    // resolving across both copies once a hidden streaming twin exists.
    const dsmPage = visibleByTestId(page, "dsm-search-page");
    await expect(dsmPage).toBeVisible();
    const queryRibbon = dsmPage.getByTestId("search-query-ribbon");
    await expect(queryRibbon.getByRole("heading", { name: "major depressive" })).toBeVisible();
    await expect(queryRibbon.getByRole("group", { name: "Filter diagnoses by category" })).toBeVisible();

    const result = dsmPage.getByTestId("dsm-search-result").filter({ hasText: "Major depressive disorder" });
    await expect(result).toBeVisible();
    await expectMinTouchTarget(result.getByRole("button", { name: "Add Major depressive disorder to comparison" }));
    await expectMinTouchTarget(result.getByRole("link", { name: "Open Major depressive disorder" }));

    await result.getByRole("link", { name: "Open Major depressive disorder" }).click();
    await expect(page).toHaveURL(/\/dsm\/diagnoses\/major-depressive-disorder$/, { timeout: 30_000 });
    const diagnosisPage = visibleByTestId(page, "dsm-diagnosis-page");
    await expect(diagnosisPage).toBeVisible({ timeout: 30_000 });
    await expect(diagnosisPage.getByRole("heading", { level: 1, name: "Major depressive disorder" })).toBeVisible();
    // The breadcrumb row went with the in-page header: its back control is the
    // one route out to the DSM search catalogue, not the shared home composer.
    // It stays page-scoped because that header portals out of the page root,
    // the same reason the filter panel below is not scoped either.
    await expect(page.getByRole("link", { name: "Back to dsm-5" })).toHaveAttribute("href", "/dsm/search");
    await expectNoPageHorizontalOverflow(page);
  });

  test("factsheet search keeps query and category filters in the ribbon with view controls above results", async ({
    page,
  }) => {
    await mockDemoApi(page);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoApp(page, "/factsheets/search?q=sertraline");
      // The visible owner only: a hidden streaming copy of the page root (#093)
      // can linger after the second navigation.
      const factsheetsPage = visibleByTestId(page, "factsheets-search-page");
      const queryRibbon = factsheetsPage.getByTestId("search-query-ribbon");
      const viewToolbar = factsheetsPage.getByTestId("factsheets-view-toolbar");
      await expect(queryRibbon.getByRole("heading", { name: "sertraline" })).toBeVisible();
      await expect(queryRibbon.getByRole("group", { name: "Result view" })).toHaveCount(0);
      await expect(viewToolbar.getByRole("group", { name: "Result view" })).toBeVisible();
      await expect(queryRibbon.getByRole("group", { name: "Filter factsheets by category" })).toBeVisible();
      // Phone gets the compact trigger; from `sm` up the ribbon shows the chip
      // row instead and the trigger is not rendered at all.
      const categoryTrigger = queryRibbon.getByTestId("factsheet-filter-trigger-phone");
      if (viewport.width < 640) {
        await expect(categoryTrigger).toBeVisible();
        await expect(categoryTrigger).toHaveAccessibleName(/No filters active/);
        await categoryTrigger.click();
        const categoryGroup = page.getByRole("radiogroup", { name: "Category" });
        await expect(categoryGroup.getByRole("radio", { name: "All" })).toBeChecked();
        await page.getByTestId("factsheet-filter-panel-done").click();
        await expect(categoryGroup).toBeHidden();
      } else {
        await expect(categoryTrigger).toBeHidden();
      }
      await expectNoPageHorizontalOverflow(page);
    }
  });

  test("DSM category facets support keyboard selection and restore focus", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 850 });
    await mockDemoApi(page);
    await gotoApp(page, "/dsm/search?q=depression");

    const dsmPage = visibleByTestId(page, "dsm-search-page");
    await expect(dsmPage).toBeVisible();
    // The trigger is rendered inside the page root, so it needs the same owner.
    // The panel below deliberately stays page-scoped: `ResultFilterSheet`
    // renders through `OverlayPortal`, so it lives outside this subtree.
    const trigger = dsmPage.getByTestId("dsm-category-filter-desktop");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("dsm-category-filter-panel");
    await expect(panel).toBeVisible();

    const categoryGroup = panel.getByRole("group", { name: "Category" });
    const category = categoryGroup.locator('button:not([aria-disabled="true"])').first();
    await expect(category).toHaveAttribute("aria-pressed", "false");
    await category.focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/[?&]category=/);
    await expect(category).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("dashboard specifiers mode param redirects to the standalone specifiers route", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/?mode=specifiers&q=anxious+distress&focus=1&run=1");

    // /?mode=specifiers → /specifiers (Specifiers is its own mode, distinct from Formulation)
    await expect(page).toHaveURL(/\/specifiers\/search\?q=anxious\+distress&focus=1&run=1\b/);
    const queryRibbon = page.getByTestId("search-query-ribbon");
    await expect(queryRibbon.getByRole("heading", { level: 1, name: "anxious distress" })).toBeVisible();
    await expect(queryRibbon.getByRole("group", { name: "Filter specifier results" })).toBeVisible();
  });

  test("dashboard formulation mode param redirects to the standalone formulation route", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/?mode=formulation&q=I+keep+going+over+it&focus=1&run=1");

    await expect(page).toHaveURL(/\/formulation\/search\?q=I\+keep\+going\+over\+it&focus=1&run=1\b/);
    const queryRibbon = page.getByTestId("search-query-ribbon");
    await expect(queryRibbon.getByRole("heading", { level: 1, name: "I keep going over it" })).toBeVisible();
    await expect(queryRibbon.getByRole("group", { name: "Filter formulation mechanisms" })).toBeVisible();
  });

  test("submitted differentials searches stay on the standalone differentials route", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/differentials?q=acute+confusion&focus=1&run=1");

    await expect(visibleByTestId(page, "differentials-search-results")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Mode Differentials" })).toBeVisible();
    await expect(page.getByTestId("differentials-home")).toHaveCount(0);

    const origin = new URL(page.url());
    const presentationResult = visibleByTestId(page, "differentials-search-results")
      .locator('a[href^="/differentials/presentations/"]')
      .filter({ visible: true })
      .first();
    await expect(presentationResult).toBeVisible();
    await presentationResult.click();
    await expect(page).toHaveURL(/\/differentials\/presentations\//, { timeout: 30_000 });
    // Presentation comparisons use the shared header navigation. It carries the
    // submitted query (and any resolved selection) back to the search workspace.
    await page.getByTestId("mode-nav").getByRole("link", { name: "Search" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === origin.pathname &&
        url.searchParams.get("q") === origin.searchParams.get("q") &&
        url.searchParams.get("run") === origin.searchParams.get("run"),
      { timeout: 30_000 },
    );
    await expect(visibleByTestId(page, "differentials-search-results")).toBeVisible({ timeout: 30_000 });
  });

  test("document detail back arrow restores its originating search", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/documents/search?mode=documents&q=lithium+monitoring&run=1");

    const workspace = page.getByTestId("document-search-workspace");
    const firstResult = workspace.getByTestId("document-result-card").first();
    await expect(firstResult).toBeVisible({ timeout: 30_000 });
    const origin = new URL(page.url());
    // The card is server-rendered, so it is visible before the client router owns its link. A
    // Firefox release run clicked it in that gap and nothing navigated for 30 s.
    const openLink = firstResult.getByRole("link", { name: /^Open / });
    await waitForReactEventHandler(openLink, "onClick");
    await openLink.click();
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+\?/, { timeout: 30_000 });

    await page.getByRole("link", { name: "Back to documents" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === origin.pathname &&
        url.searchParams.get("q") === origin.searchParams.get("q") &&
        url.searchParams.get("run") === origin.searchParams.get("run") &&
        url.searchParams.get("mode") === origin.searchParams.get("mode"),
      { timeout: 30_000 },
    );
    await expect(workspace).toBeVisible({ timeout: 30_000 });
  });

  test("document detail back arrow skips PDF page changes at phone and desktop", async ({ page }) => {
    await mockDemoApi(page);
    const documentId = "22222222-2222-4222-8222-222222222222";

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, "/documents/search?mode=documents&q=clozapine+monitoring&run=1");
      const origin = new URL(page.url());
      await page.goto(`/documents/${documentId}?page=1`, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { level: 1, name: /Synthetic clozapine monitoring protocol/i }),
      ).toBeVisible({
        timeout: 30_000,
      });

      const historyLength = await page.evaluate(() => window.history.length);
      await page.getByLabel("Next page").first().click();
      await expect(page).toHaveURL(
        (url) => url.pathname === `/documents/${documentId}` && url.searchParams.get("page") === "2",
      );
      expect(await page.evaluate(() => window.history.length)).toBe(historyLength);

      await page.getByRole("link", { name: "Back to documents" }).click();
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === origin.pathname &&
          url.searchParams.get("q") === origin.searchParams.get("q") &&
          url.searchParams.get("run") === origin.searchParams.get("run") &&
          url.searchParams.get("mode") === origin.searchParams.get("mode"),
        { timeout: 30_000 },
      );
    }
  });

  test("opening a document reveals phone chrome hidden by the search route", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(page, "/documents/search?mode=documents&q=lithium+monitoring&run=1");

    const firstResult = page.getByTestId("document-result-card").first();
    const openDocument = firstResult.getByRole("link", { name: /^Open / });
    const collapse = page.getByTestId("universal-header-collapse");
    await expect(openDocument).toBeVisible({ timeout: 30_000 });
    await appendPrimaryScrollSpacer(page, { heightPx: 2_000 });
    for (const offset of [40, 80, 120, 160, 200]) {
      await scrollPrimarySurface(page, offset);
    }
    await expect(collapse).toHaveAttribute("data-scroll-hidden", "true");

    await page.evaluate(() => {
      const state = window as typeof window & { __documentRoutePaintedWithHiddenHeader?: boolean };
      const detectStaleHeader = () => {
        const onDocumentDetail =
          window.location.pathname.startsWith("/documents/") && window.location.pathname !== "/documents/search";
        const documentReady = Boolean(document.querySelector('[data-testid="document-viewer-content"]'));
        const headerHidden =
          document.querySelector('[data-testid="universal-header-collapse"]')?.getAttribute("data-scroll-hidden") ===
          "true";
        if (onDocumentDetail && documentReady && headerHidden) {
          state.__documentRoutePaintedWithHiddenHeader = true;
        }
      };
      new MutationObserver(detectStaleHeader).observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["data-scroll-hidden"],
      });
    });

    // Invoke the already-rendered link without Playwright scrolling it back
    // into view first; the navigation must reset the genuinely hidden state.
    await openDocument.evaluate((element) => (element as HTMLElement).click());
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+\?/, { timeout: 30_000 });
    await expect(page.getByTestId("document-viewer-content")).toBeVisible({ timeout: 30_000 });
    await expect(collapse).not.toHaveAttribute("data-scroll-hidden", "true");
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __documentRoutePaintedWithHiddenHeader?: boolean })
            .__documentRoutePaintedWithHiddenHeader ?? false,
      ),
    ).toBe(false);
  });

  test("newer routed differential context wins over an older response", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    let requestCount = 0;
    let resolveCurrentResponse!: () => void;
    const currentResponseDelivered = new Promise<void>((resolve) => {
      resolveCurrentResponse = resolve;
    });
    await page.route(/\/api\/search$/, async (route) => {
      requestCount += 1;
      const currentRequest = requestCount;
      if (currentRequest === 1) await new Promise((resolve) => setTimeout(resolve, 500));
      const sourceCount = currentRequest === 1 ? 2 : 1;
      try {
        await route.fulfill({
          json: {
            documentMatches: Array.from({ length: sourceCount }, (_, index) => ({
              document_id: `00000000-0000-4000-8000-00000000000${index}`,
              title: `${currentRequest === 1 ? "Older" : "Current"} source ${index + 1}`,
              file_name: `source-${index + 1}.pdf`,
              score: 0.9 - index * 0.1,
            })),
          },
        });
        if (currentRequest > 1) resolveCurrentResponse();
      } catch (error) {
        if (currentRequest > 1) throw error;
      }
    });

    await page.goto("/differentials?q=acute+confusion&run=1", { waitUntil: "domcontentloaded" });
    await expect.poll(() => requestCount).toBeGreaterThanOrEqual(1);
    const baselineRequestCount = requestCount;
    await page.evaluate(() => {
      window.history.pushState(null, "", "/differentials?q=acute+confusion&run=1&scope.sourceStatuses=outdated");
    });

    await expect.poll(() => requestCount).toBeGreaterThan(baselineRequestCount);
    await currentResponseDelivered;
    const sourceStatus = page.getByTestId("differentials-source-status");
    const singularSourceCount = sourceStatus.getByText("1 indexed source match", { exact: true });
    await expect(singularSourceCount).toBeVisible();
    await expect(sourceStatus).not.toContainText("2 indexed source matches");
  });

  test("submitted favourites searches stay on the command library route", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/favourites?q=lithium%20set&focus=1&run=1");

    await expectSingleSettledOwner(page.getByTestId("favourites-hub"), { message: "favourites hub owner" });
    await expect(page.getByRole("heading", { level: 1, name: "Favourites", exact: true })).toBeVisible();
    const queryRibbon = page.getByTestId("search-query-ribbon");
    await expect(queryRibbon.getByRole("heading", { name: "lithium set" })).toBeVisible();
    await expect(page.getByTestId("favourites-active-filters")).toHaveCount(0);
  });

  test("favourites route opens the favourites home", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/favourites?q=lithium%20set");

    const globalSearchInput = page.getByRole("combobox", { name: /Search saved favourites/ });
    await expect(page.getByRole("button", { name: "Mode Favourites" })).toBeVisible();
    await expect(globalSearchInput).toBeVisible({ timeout: 30_000 });
    await expect(globalSearchInput).toHaveAttribute("placeholder", "Search favourites...");
    await expect(globalSearchInput).toHaveValue("lithium set");
    await expectSingleSettledOwner(page.getByTestId("favourites-hub"), { message: "favourites hub owner" });
    await expect(page.getByRole("heading", { level: 1, name: "Favourites", exact: true })).toBeVisible();
    const queryRibbon = page.getByTestId("search-query-ribbon");
    await expect(queryRibbon.getByRole("heading", { name: "lithium set" })).toBeVisible();
    await expect(page.getByTestId("favourites-active-filters")).toHaveCount(0);

    // Desktop hides the header New chat when the sidebar already owns it.
    await page.getByRole("complementary", { name: "PsychSift" }).getByRole("button", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\?mode=answer&focus=1$/);
    await expect(page.getByRole("button", { name: "Mode Answer" })).toBeVisible();
    await expect(page.locator('[data-testid="global-search-input"]:visible').first()).toBeFocused();
  });

  test("favourites search bar stands alone: no privacy line or example ticker (owner decision 2026-09-30)", async ({
    page,
  }) => {
    await mockDemoApi(page);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoApp(page, "/favourites");
      await expect(page.getByRole("combobox", { name: /Search saved favourites/ })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name: "Favourites", exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "Search privacy notice" })).toHaveCount(0);
      await expect(page.getByText("Do not enter patient-identifiable information.")).toHaveCount(0);
      await expect(page.getByTestId("smart-search-phone-ticker")).toHaveCount(0);
      await expect(page.getByTestId("search-example-ticker")).toHaveCount(0);
      await expect(page.getByTestId("smart-search-prompt-row")).toHaveCount(0);
      // With the pill alone, the set chips sit close under the search bar.
      const gap = await page.evaluate(() => {
        const form = document
          .querySelector('.mode-home-composer-slot [data-testid="global-search-input"]')
          ?.closest("form");
        const chips = document.querySelector('[data-testid="favourites-set-chips"]');
        if (!form || !chips) return null;
        return chips.getBoundingClientRect().top - form.getBoundingClientRect().bottom;
      });
      expect(gap, `gap under the search bar at ${viewport.width}px`).not.toBeNull();
      expect(gap!).toBeLessThanOrEqual(24);
    }
    // Every other mode home keeps the line.
    await gotoApp(page, "/documents");
    await expect(page.getByRole("group", { name: "Search privacy notice" })).toBeVisible({ timeout: 30_000 });
  });

  test("favourites hub hydrates saved services from the registry", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    // Override the shared registry fixture with the saved-service scenario.
    await page.route(/\/api\/registry\/records(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        json: {
          records: [{ slug: "13yarn", title: "13YARN", subtitle: "Crisis support line" }],
          total: 1,
          verifiedCount: 0,
          demoMode: true,
        },
      });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem("clinical-kb-saved-services", JSON.stringify(["13yarn"]));
    });
    await gotoApp(page, "/favourites");

    const hub = await expectSingleSettledOwner(page.getByTestId("favourites-hub"), {
      message: "favourites hub owner",
    });
    // The saved service slug is hydrated to its registry title in the hub.
    await expect(hub.getByText("13YARN").first()).toBeVisible();
  });

  test("favourites command library exposes truthful item details and a keyboard-operable action dialog", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/favourites");

    await expect(page.getByRole("heading", { level: 1, name: "Favourites", exact: true })).toBeVisible();
    await expect(page.getByTestId("favourites-item-workspace")).toHaveCount(0);

    await visibleByTestId(page, "favourite-row-lithium-monitoring-guideline").locator("button[aria-pressed]").click();
    const workspace = page.getByTestId("favourites-item-workspace");
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole("heading", { name: "Lithium monitoring guideline", level: 3 })).toBeVisible();

    await workspace.getByRole("button", { name: "Evidence" }).click();
    await expect(workspace).not.toContainText("BNF - Acamprosate");
    await workspace.getByRole("button", { name: "Notes" }).click();
    await expect(workspace).toContainText("No personal note is saved for this item.");

    // The row menu is a named actions sheet (a centred dialog at this width).
    const moreActions = visibleByTestId(page, "favourite-row-lithium-monitoring-guideline").getByRole("button", {
      name: "More actions for Lithium monitoring guideline",
    });
    await moreActions.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Actions for Lithium monitoring guideline" });
    await expect(dialog.getByRole("link", { name: "Ask Lithium monitoring guideline" })).toBeVisible();
    const copyCitation = dialog.getByRole("button", { name: "Copy citation" });
    await copyCitation.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Copied" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(moreActions).toBeFocused();
  });

  test("favourites disable item selection below xl while keeping navigation and actions", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(page, "/favourites");

    const hub = await expectSingleSettledOwner(page.getByTestId("favourites-hub"), {
      message: "favourites hub owner",
    });
    await expect(hub.locator('article[role="button"]')).toHaveCount(0);
    // One row at every width: below xl it is a plain link that opens the item,
    // and the xl-only select button beside it is not rendered visibly.
    const card = hub.getByTestId("favourite-row-acamprosate-renal-screen");
    const openItem = card.getByRole("link", { name: "Open Acamprosate renal screen" });
    const moreActions = card.getByRole("button", { name: "More actions for Acamprosate renal screen" });

    await expect(card).toBeVisible();
    await expect(card.locator("button[aria-pressed]")).toBeHidden();
    await expectMinTouchTarget(openItem);
    await expectMinTouchTarget(moreActions);
    await expectNoPageHorizontalOverflow(page);

    await page.setViewportSize({ width: 1180, height: 820 });
    const row = page.getByTestId("favourite-row-acamprosate-renal-screen");
    await expect(row).toBeVisible();
    await expect(row.locator("button[aria-pressed]")).toBeHidden();
    await expect(row.getByRole("link", { name: "Open Acamprosate renal screen" })).toBeVisible();
    await expect(row.getByRole("button", { name: "More actions for Acamprosate renal screen" })).toBeVisible();

    await page.setViewportSize({ width: 1536, height: 900 });
    const selectItem = row.locator("button[aria-pressed]");
    await expect(selectItem).toBeVisible();
    await selectItem.click();
    await expect(page.getByTestId("favourites-item-workspace")).toBeVisible();

    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(page.getByTestId("favourites-item-workspace")).toBeHidden();
    await expect(selectItem).toBeHidden();
    await expect(row).not.toHaveClass(/(^|\s)bg-\[/);
    await expectNoPageHorizontalOverflow(page);
  });

  test("app mode menu supports keyboard navigation without removed prototype modes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/?mode=answer");

    const appModeButton = page.getByRole("button", { name: "Mode Answer" });
    await waitForReactEventHandler(appModeButton, "onClick");
    await appModeButton.click();
    const modeDialog = page.getByRole("dialog", { name: "Choose app mode" });
    const appModeMenu = modeDialog.getByRole("menu", { name: "Choose app mode" });
    const modeSearch = modeDialog.getByRole("textbox", { name: "Find a mode" });
    await expect(modeDialog).toBeVisible();
    await expect(appModeMenu).toBeVisible();
    await expect(modeSearch).toBeFocused();
    await expect(appModeMenu.getByRole("menuitemradio")).toHaveCount(24);
    await expect(appModeMenu.getByRole("heading", { name: "Search" })).toBeAttached();
    await expect(appModeMenu.getByRole("heading", { name: "Psychiatry" })).toBeAttached();
    await expect(appModeMenu.getByRole("heading", { name: "Medicines & tools" })).toBeAttached();
    await expect(appModeMenu.getByRole("heading", { name: "My Day" })).toBeAttached();
    await expect(appModeMenu.getByRole("heading", { name: "On Call" })).toBeAttached();
    await expect(appModeMenu.getByRole("heading")).toHaveCount(5);
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Dictionary\b/ })).toBeAttached();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^CPD\b/ })).toBeAttached();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Roster\b/ })).toBeAttached();

    await modeSearch.fill("d");
    await expect(modeDialog.getByRole("status")).toHaveText("8 matches");
    await expect(appModeMenu.getByRole("menuitemradio")).toHaveCount(8);
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Documents\b/ })).toBeAttached();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Differentials\b/ })).toBeAttached();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^DSM-5 Diagnosis\b/ })).toBeAttached();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Medication\b/ })).toBeAttached();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Dictionary\b/ })).toBeAttached();
    // "CPD" carries a "d" too (the mode's label was "CME" before the RANZCP rename).
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^CPD\b/ })).toBeAttached();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Admin\b/ })).toBeAttached();
    // "My Day" carries a "d" too.
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^My Day\b/ })).toBeAttached();
    await modeDialog.getByRole("button", { name: "Clear mode search" }).click();
    await expect(appModeMenu.getByRole("menuitemradio")).toHaveCount(24);

    const answerMode = appModeMenu.getByRole("menuitemradio", { name: /^Answer\b/ });
    await answerMode.focus();
    await expect(answerMode).toBeFocused();
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Evidence\b/ })).toHaveCount(0);
    // Arrow Down follows the drawn order, group by group: the end of Search
    // steps into Psychiatry, and the end of Psychiatry steps into Medicines & tools.
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Documents\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Services\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Favourites\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Sources\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Psychiatry\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^DSM-5 Diagnosis\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Differentials\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Specifiers\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Formulation\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Therapy\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Forms\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^First Nations\b/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(appModeMenu.getByRole("menuitemradio", { name: /^Medication\b/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(appModeMenu).toBeHidden();
    await expect(appModeButton).toBeFocused();

    await appModeButton.click();
    await expect(appModeMenu).toBeVisible();
    // Opening schedules the search autofocus in a requestAnimationFrame. Focusing an
    // option before that frame runs lets the autofocus steal focus back into the search
    // box, where Tab is not a dismiss key, so the menu stays open and this fails.
    await expect(modeSearch).toBeFocused();
    const reopenedAnswerMode = appModeMenu.getByRole("menuitemradio", { name: /^Answer\b/ });
    await reopenedAnswerMode.focus();
    await expect(reopenedAnswerMode).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(appModeMenu).toBeHidden();
  });

  test("prescribing workflow uses in-app medication routes @critical", async ({ page }) => {
    test.setTimeout(120_000);
    // Regression guard: navigating away from a mode home used to throw
    // "Cannot read properties of null (reading 'parentNode')" because the header
    // portaled its search composer straight into a page-owned slot that unmounts
    // on navigation. Narrowly scoped to that error so it won't trip on unrelated
    // console noise.
    const parentNodeErrors: string[] = [];
    page.on("pageerror", (error) => {
      if (String(error).includes("parentNode")) parentNodeErrors.push(String(error));
    });
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("parentNode")) parentNodeErrors.push(message.text());
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/?mode=prescribing&q=acamprosate%20renal%20dose&run=1");

    const globalSearchInput = page.locator('[data-testid="global-search-input"]:visible').first();
    await expect(page.getByRole("button", { name: "Mode Medication" })).toBeVisible({ timeout: 30_000 });
    await expect(globalSearchInput).toHaveAttribute("placeholder", "Search medication dosing or safety...");
    await expect(globalSearchInput).toHaveValue("acamprosate renal dose");

    const acamprosateResult = page.getByTestId("medication-result-acamprosate-desktop");
    await expect(acamprosateResult).toHaveAttribute("href", "/medications/acamprosate");
    await acamprosateResult.click();
    await expect(page).toHaveURL(/\/medications\/acamprosate$/, { timeout: 30_000 });
    await expectSingleMedicationPage(page);
    await expect(page.getByRole("link", { name: "Back to medications" }).filter({ visible: true })).toBeVisible();

    // Desktop polish: the patient control belongs to the title row, with a
    // deliberate breathing space before the elevated category rail below it.
    const desktopPatientAction = page.getByTestId("medication-primary-action").filter({ visible: true });
    const desktopMedicationRail = page.getByTestId("medication-section-rail");
    const [patientBox, desktopRailBox] = await Promise.all([
      desktopPatientAction.boundingBox(),
      desktopMedicationRail.boundingBox(),
    ]);
    expect(patientBox).not.toBeNull();
    expect(desktopRailBox).not.toBeNull();
    expect(desktopRailBox!.y - (patientBox!.y + patientBox!.height)).toBeGreaterThanOrEqual(6);

    const summaryCategory = desktopMedicationRail.getByRole("button", { name: /^Summary/ });
    await summaryCategory.focus();
    await expect(summaryCategory).toBeFocused();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() => summaryCategory.evaluate((button) => Number.parseFloat(getComputedStyle(button).transitionDuration)))
      .toBeLessThanOrEqual(0.001);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "no-preference" });
    await expect
      .poll(() => desktopMedicationRail.evaluate((rail) => getComputedStyle(rail).borderTopStyle))
      .not.toBe("none");
    await page.emulateMedia({ forcedColors: "none" });

    // Regression guard for #1802: medication sections use the same priority
    // menu as the mode home, not the older horizontally scrolling tab strip.
    await page.setViewportSize({ width: 390, height: 844 });
    const medicationRail = page.getByTestId("medication-section-rail");
    await expect(medicationRail.getByRole("button", { name: /^Summary/ })).toBeVisible();
    await expect(medicationRail.getByRole("button", { name: /^Dosing/ })).toBeVisible();
    await expect(medicationRail.getByRole("button", { name: /^Safety/ })).toBeHidden();
    await expect(page.getByTestId("medication-section-overflow")).toBeVisible();
    const railGeometry = await medicationRail.evaluate((rail) => ({
      clientWidth: rail.clientWidth,
      scrollWidth: rail.scrollWidth,
      overflowX: getComputedStyle(rail).overflowX,
    }));
    expect(railGeometry.scrollWidth).toBeLessThanOrEqual(railGeometry.clientWidth + 1);
    expect(railGeometry.overflowX).not.toMatch(/auto|scroll/);

    // At the generic four-slot boundary the medication labels still need a
    // little more room for their icons and count badges, so the tail remains
    // folded instead of clipping every visible label.
    await page.setViewportSize({ width: 552, height: 844 });
    await expect(page.getByTestId("medication-section-overflow")).toBeVisible();
    await expect(medicationRail.getByRole("button", { name: /^Additional/ })).toBeHidden();
    const clippedLabelsAtBoundary = await medicationRail
      .locator("button:visible .mode-nav__ink > span.truncate")
      .evaluateAll((labels) =>
        labels.filter((label) => label.scrollWidth > label.clientWidth + 1).map((label) => label.textContent),
      );
    expect(clippedLabelsAtBoundary).toEqual([]);

    await page.setViewportSize({ width: 736, height: 844 });
    await expect(medicationRail.getByRole("button", { name: /^Additional/ })).toBeVisible();
    await expect(page.getByTestId("medication-section-overflow")).toBeHidden();
    const clippedLabelsAtWideBand = await medicationRail
      .locator("button:visible .mode-nav__ink > span.truncate")
      .evaluateAll((labels) =>
        labels.filter((label) => label.scrollWidth > label.clientWidth + 1).map((label) => label.textContent),
      );
    expect(clippedLabelsAtWideBand).toEqual([]);

    expect(parentNodeErrors).toEqual([]);
  });

  test("prescribing workflow shows full mobile action text without horizontal cutoff", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(page, "/?mode=prescribing&q=acamprosate%20renal%20dose&run=1");

    const acamprosateCard = page.getByTestId("medication-result-acamprosate-phone");
    await expect(acamprosateCard).toBeVisible({ timeout: 30_000 });
    await expect(acamprosateCard).toContainText("Contraindicated in renal insufficiency");
    await expect(acamprosateCard).toContainText("micromol/L");

    const actionOverflow = await acamprosateCard.evaluate((card) => {
      const action = Array.from(card.querySelectorAll("p")).find((node) =>
        node.textContent?.includes("Contraindicated in renal insufficiency"),
      );
      if (!action) return { found: false, overflows: true };
      return {
        found: true,
        overflows: action.scrollWidth > action.clientWidth + 1,
        textOverflow: getComputedStyle(action).textOverflow,
      };
    });
    expect(actionOverflow.found).toBe(true);
    expect(actionOverflow.overflows).toBe(false);
    expect(actionOverflow.textOverflow).not.toBe("ellipsis");

    const origin = new URL(page.url());
    await acamprosateCard.click();
    await expect(page).toHaveURL(/\/medications\/acamprosate$/, { timeout: 30_000 });
    // InPageNavHeader always names the control `Back to ${label}` via aria-label;
    // the visible "Medications" text is `hidden sm:inline` and absent on phone.
    // Scope to the visible owner — phone portals the header into the collapse
    // addon, and #093 streaming can leave a hidden twin under full-suite load.
    const backLink = page.getByRole("link", { name: "Back to medications" }).filter({ visible: true });
    await expect(backLink).toBeVisible();
    await expectMinTouchTarget(backLink);
    await backLink.click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === origin.pathname &&
        url.searchParams.get("mode") === origin.searchParams.get("mode") &&
        url.searchParams.get("q") === origin.searchParams.get("q") &&
        url.searchParams.get("run") === origin.searchParams.get("run"),
    );
    await expect(page.getByTestId("medication-result-acamprosate-phone")).toBeVisible();
  });

  test("tablet document chrome keeps one new-chat action and readable Sources rows", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await mockDemoApi(page);
    // Documents' idle browse tiles (including the old "Browse library" button)
    // are retired — `/documents` now redirects to the shared home instead of
    // rendering them. The Sources dialog this test checks is still reachable,
    // from a submitted search's wide filter panel, so land there directly.
    await gotoApp(page, "/documents/search?q=lithium+monitoring&run=1&mode=documents");
    await expect(page.getByTestId("document-search-workspace")).toBeVisible({ timeout: 30_000 });

    const visibleNewChatCount = await page.getByRole("button", { name: /new chat/i }).evaluateAll(
      (buttons) =>
        buttons.filter((button) => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        }).length,
    );
    expect(visibleNewChatCount).toBe(1);

    await page.getByTestId("document-filter-trigger-wide").click();
    const browseLibraryButton = page.getByRole("button", { name: "Browse all sources" }).first();
    await browseLibraryButton.click();
    const sourcesDialog = page.getByRole("dialog", { name: "Sources" });
    await expect(sourcesDialog).toBeVisible();
    await expect(sourcesDialog.getByText("Sources", { exact: true })).toHaveCount(1);

    const documentLink = sourcesDialog.getByRole("link", { name: /Synthetic lithium monitoring protocol/i });
    const addScope = sourcesDialog.getByRole("button", { name: "Add scope" }).first();
    await expect(documentLink).toBeVisible();
    await expect(addScope).toBeVisible();
    const rowGeometry = await sourcesDialog.evaluate((dialog) => {
      const link = Array.from(dialog.querySelectorAll<HTMLAnchorElement>("a")).find((candidate) =>
        candidate.textContent?.toLowerCase().includes("synthetic lithium monitoring protocol"),
      );
      const scope = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent?.trim() === "Add scope",
      );
      if (!link || !scope) return null;
      const linkRect = link.getBoundingClientRect();
      const scopeRect = scope.getBoundingClientRect();
      return {
        linkWidth: linkRect.width,
        linkBottom: linkRect.bottom,
        scopeTop: scopeRect.top,
        horizontalOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
      };
    });
    expect(rowGeometry).not.toBeNull();
    expect(rowGeometry?.linkWidth ?? 0).toBeGreaterThanOrEqual(180);
    expect(rowGeometry?.scopeTop ?? 0).toBeGreaterThanOrEqual((rowGeometry?.linkBottom ?? 0) + 8);
    expect(rowGeometry?.horizontalOverflow).toBe(false);
  });

  test("document search mode lists matching documents and result actions @critical", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockDemoApi(page);
    // Documents' idle browse tiles (Recent documents / Browse library / Open a
    // source PDF, previously rendered on a distinct `/documents` home) are
    // retired — `/documents` now redirects to the shared home with Documents
    // preselected, the same as the other ten consolidated modes. The three
    // actions those tiles used to trigger are still reachable from the
    // composer's "Open documents options" menu (unaffected by this change), so
    // this test exercises them from there instead.
    await gotoApp(page, "/?mode=documents");

    await expect(page.getByRole("button", { name: "Mode Documents" })).toBeVisible();
    await expect(page.getByTestId("answer-section-heading")).toHaveText("Document matches");
    await expect(page.getByRole("button", { name: "Find matching documents" })).toBeDisabled();

    const optionsButton = page.getByRole("button", { name: "Open documents options" });

    await optionsButton.click();
    const recentDocumentsButton = page.getByRole("button", { name: "Recent documents", exact: true });
    await recentDocumentsButton.click();
    const recentDocumentsDialog = page.getByRole("dialog", { name: "Recent documents" });
    await expect(recentDocumentsDialog).toBeVisible();
    await expect(recentDocumentsDialog.getByPlaceholder("Find a document")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(recentDocumentsDialog).toHaveCount(0);

    await optionsButton.click();
    const browseLibraryButton = page.getByRole("button", { name: "Browse library", exact: true });
    await browseLibraryButton.click();
    const sourceLibraryDialog = page.getByRole("dialog", { name: "Sources" });
    await expect(sourceLibraryDialog).toBeVisible();
    await expect(sourceLibraryDialog.getByPlaceholder("Find a document")).toBeFocused();
    await expect(sourceLibraryDialog.getByRole("group", { name: "Refine sources" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sourceLibraryDialog).toHaveCount(0);
    // The menu item that opened it is unmounted once the popover closes, so
    // focus returns to the menu's own trigger instead.
    await expect(optionsButton).toBeFocused();

    await optionsButton.click();
    const sourcePdfButton = page.getByRole("button", { name: "Open source PDF", exact: true });
    await sourcePdfButton.click();
    const sourcePdfDialog = page.getByRole("dialog", { name: "Source PDFs" });
    await expect(sourcePdfDialog).toBeVisible();
    await expect(sourcePdfDialog.getByPlaceholder("Find a source PDF")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sourcePdfDialog).toHaveCount(0);
    await expect(page.getByText("Source library workspace")).toHaveCount(0);
    await expect(page.getByText("Document display")).toHaveCount(0);

    // The mode switch above is covered independently. Submit from the canonical
    // route so a dev-only cross-segment remount cannot abort the mocked POST.
    await gotoApp(page, "/documents/search?mode=documents");
    const questionInput = visibleQuestionInput(page);
    await expect(questionInput).toBeVisible();
    await waitForReactEventHandler(questionInput, "onChange");
    await questionInput.fill("lithium monitoring");
    await submitDocumentSearch(page);

    await expect(page).toHaveURL(/\/documents\/search\?.*q=lithium\+monitoring/);
    const documentWorkspace = page.getByTestId("document-search-workspace");
    const queryRibbon = documentWorkspace.getByTestId("search-query-ribbon");
    await expect(queryRibbon).toBeVisible();
    // One filter surface, two slots: the ribbon's full-width row is suppressed
    // below `sm` and the phone copy sits in the utility row. Both are in the
    // DOM, which is why they carry distinct test ids.
    await expect(queryRibbon.getByTestId("document-filter-trigger-wide")).toBeHidden();
    // Sort is `sm`-and-up. Its two segments cost about half the band's one line
    // on a phone, and relevance — the default, and what `?sort=` still carries
    // in from a link — is the order a phone reader wants.
    //
    // Mounted-and-hidden, asserted as two facts, because `toBeHidden()` alone
    // cannot tell them apart: it passes for a hidden node AND for a node that
    // does not exist. So `includeHidden` (plain `getByRole` filters hidden nodes
    // out and would resolve to nothing) plus a count, then the visibility. A
    // deleted control fails the count; a control returned to the phone line
    // fails the hidden check.
    const phoneSort = queryRibbon.getByRole("group", { name: "Sort results", includeHidden: true });
    await expect(phoneSort).toHaveCount(1);
    await expect(phoneSort).toBeHidden();
    const mobileFilterTrigger = queryRibbon.getByTestId("document-filter-trigger-phone");
    await expect(mobileFilterTrigger).toBeVisible();
    await expect(mobileFilterTrigger).toHaveAccessibleName(/Filter/);
    await expectMinTouchTarget(mobileFilterTrigger);
    // The rail must not clip its own controls. #1615 collapsed this band to one
    // line but left the inline utilities group `shrink`, so an over-subscribed
    // line paid the shortfall out of the *controls* rather than out of the
    // truncating query: the sort group was severed by the track's
    // `overflow-x-auto` and its trailing option was then washed out by the 28px
    // overflow mask.
    //
    // Swept, not asserted once. The band now keeps the phone controls on one
    // line at every supported width, paying any shortfall out of the truncating
    // query instead of the controls. The sweep crosses the retired 414px wrap
    // boundary so that breakpoint cannot silently return. 540 is in
    // the list because a longer query reproduced a 41.9px clip there: width alone
    // never bounded this. Geometry, not a class name — the class that caused it
    // read as correct, and `expectNoPageHorizontalOverflow` cannot see an
    // internal scroller.
    // Polled, because `useRailOverflow` remeasures through a ResizeObserver a
    // frame after the viewport changes.
    const utilityTrack = queryRibbon.getByTestId("search-query-ribbon-utility-track");
    const utilitiesGroup = queryRibbon.getByTestId("search-query-ribbon-utilities");
    for (const width of [320, 375, 390, 402, 414, 430, 440, 540]) {
      await page.setViewportSize({ width, height: 820 });
      await expect
        .poll(
          async () =>
            utilityTrack.evaluate((track) => {
              // The last *rendered* child, not a named control. Sort is
              // `sm`-and-up, so below 640 it is `display:none` and every width
              // in this sweep would measure a zero-sized node and report a
              // dutiful 0 — the sweep would go blind while still passing.
              const rendered = Array.from(track.children).filter((child) => child.getClientRects().length > 0);
              const last = rendered[rendered.length - 1];
              const clipped = last ? last.getBoundingClientRect().right - track.getBoundingClientRect().right : 0;
              return {
                overflow: Math.max(0, track.scrollWidth - track.clientWidth),
                controlClipped: Math.max(0, Math.round(clipped)),
                masked: track.getAttribute("data-overflowing") === "true",
              };
            }),
          { message: `results-band utility rail clipped its own controls at ${width}px` },
        )
        .toEqual({ overflow: 0, controlClipped: 0, masked: false });
      // Track overflow alone is blind to a group pushed off-screen by the
      // band's `overflow-hidden`: both scrollWidth/clientWidth and the last
      // rendered-child measurement can still report zero. Pin the complete
      // utilities group inside the viewport at the former wrap widths too.
      if (width < 414) {
        const utilitiesBox = await utilitiesGroup.boundingBox();
        expect(utilitiesBox, `utilities clipped off-screen at ${width}px`).not.toBeNull();
        expect(utilitiesBox!.x).toBeGreaterThanOrEqual(0);
        expect(utilitiesBox!.x + utilitiesBox!.width).toBeLessThanOrEqual(width + 1);
      }
    }
    await page.setViewportSize({ width: 390, height: 820 });
    // The panel is what the trigger exists to reach — the state that was
    // unreachable before, because its only mount was gated on a selection that
    // nothing could make.
    await expect(page.getByTestId("document-filter-panel")).toHaveCount(0);
    await mobileFilterTrigger.click();
    const filterPanel = page.getByTestId("document-filter-panel");
    await expect(filterPanel).toBeVisible();
    await expect(filterPanel.getByRole("radiogroup", { name: "Source locality" })).toBeVisible();
    await expect(filterPanel.getByRole("radiogroup", { name: "Result type" })).toBeVisible();
    // Library lives in the sheet footer now, under a rule and below the commit
    // action. It was first renamed from "Open source filters" — it browses, it
    // does not refine, and the old name made it read as a duplicate of Filter —
    // but renaming treated the symptom. It sat adjacent to Filter in the utility
    // rail answering a different question and occupied the space the pinned Filter
    // needs. It was once described here as "the sole reason the phone rail could
    // overflow at all"; that was measured wrong. With Library gone the rail still
    // overflowed at every common phone width, because the inline utilities group
    // was `shrink` — see the rail-fit assertion above.
    const libraryButton = filterPanel.getByRole("button", { name: /Browse all sources/ });
    await expect(libraryButton).toBeVisible();
    await expect(libraryButton).toHaveText(/Browse all sources/);
    await expectMinTouchTarget(libraryButton);
    await filterPanel.getByTestId("document-filter-panel-done").click();
    await expect(filterPanel).toHaveCount(0);
    await expect(mobileFilterTrigger).toHaveAttribute("aria-expanded", "false");
    // Asserted as an absence, not merely tolerated: putting Library back on the
    // rail re-creates the overflow it was moved to remove, and both of its new
    // homes (this sheet, and the zero-result state) preserve the query the way
    // the rail placement was protecting.
    await expect(queryRibbon.getByRole("button", { name: "Open source library" })).toHaveCount(0);
    await expect(documentWorkspace.getByText("Documents overview")).toHaveCount(0);
    await expect(documentWorkspace.getByRole("button", { name: /Browse library/i })).toHaveCount(0);
    await expect(page.getByTestId("cross-mode-links")).toHaveCount(0);
    await expect(page.getByText(/Also in your library/i)).toHaveCount(0);

    const documentResults = page.getByRole("article").filter({ hasText: "Synthetic Lithium Monitoring Protocol" });
    await expect(documentResults).toBeVisible();
    // The mocked match carries no relevance verdict, so the first card is only the
    // top result, not a "Best match" (owner decision 11, 2026-09-25).
    await expect(documentResults).toContainText("Top result");
    await expect(documentResults).not.toContainText("Best match");
    await expect(documentResults).toContainText("1 table");

    // The three primary actions keep a symmetric 48px footer at every width.
    // The page preview and inline rank must stay inside the card without forcing
    // the title or the page itself to overflow.
    for (const width of [320, 390, 639, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoPageHorizontalOverflow(page);
      const actionGeometry = await documentResults.getByTestId("document-result-actions").evaluate((rail) => {
        const railStyle = getComputedStyle(rail);
        const widths = Array.from(rail.children).map((child) => child.getBoundingClientRect().width);
        const firstActionStyle = getComputedStyle(rail.children[0]);
        const typeProbe = document.createElement("span");
        typeProbe.style.fontSize = "var(--text-sm)";
        document.body.append(typeProbe);
        const expectedActionFontSize = getComputedStyle(typeProbe).fontSize;
        typeProbe.remove();
        const card = rail.closest("article")?.getBoundingClientRect();
        return {
          display: railStyle.display,
          widths,
          actionFontSize: firstActionStyle.fontSize,
          expectedActionFontSize,
          actionFontWeight: firstActionStyle.fontWeight,
          actionDirection: firstActionStyle.flexDirection,
          cardLeft: card?.left ?? 0,
          cardRight: card?.right ?? 0,
          viewportWidth: window.innerWidth,
        };
      });
      expect(actionGeometry.cardLeft).toBeGreaterThanOrEqual(0);
      expect(actionGeometry.cardRight).toBeLessThanOrEqual(actionGeometry.viewportWidth + 1);
      expect(actionGeometry.display).toBe("grid");
      expect(Math.max(...actionGeometry.widths) - Math.min(...actionGeometry.widths)).toBeLessThanOrEqual(1);
      expect(actionGeometry.actionFontSize).toBe(actionGeometry.expectedActionFontSize);
      expect(actionGeometry.actionDirection).toBe("row");
      // 600, not 800. The result cards spend hierarchy on size and space rather
      // than weight (one accent per card), so the action rail reads at the same
      // semibold as the title above it. Still pinned: an un-weighted action rail
      // is what this assertion exists to catch.
      expect(actionGeometry.actionFontWeight).toBe("600");
      for (const action of await documentResults.getByTestId("document-result-actions").locator(":scope > *").all()) {
        await expectMinTouchTarget(action, 48);
      }
    }
    await page.setViewportSize({ width: 390, height: 820 });
    const openResultLink = documentResults.getByRole("link", { name: /Open Synthetic lithium monitoring protocol/i });
    await openResultLink.focus();
    await expect(openResultLink).toBeFocused();
    await page.emulateMedia({ forcedColors: "active" });
    await expect(documentResults.getByTestId("document-result-actions")).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
    await page.emulateMedia({ forcedColors: "none" });

    const rankBox = await documentResults.getByTestId("document-result-rank").boundingBox();
    const titleBox = await documentResults
      .getByRole("link", { name: /Result 1: Synthetic lithium monitoring protocol/i })
      .boundingBox();
    expect(rankBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(rankBox!.x + rankBox!.width).toBeLessThanOrEqual(titleBox!.x + 1);

    const moreActions = documentResults.getByRole("button", {
      name: /More actions for Synthetic lithium monitoring protocol/i,
    });
    await moreActions.focus();
    await page.keyboard.press("ArrowDown");
    const resultMenu = page.getByTestId("document-result-more-menu");
    await expect(documentResults.getByRole("menu")).toHaveCount(0);
    const menuBox = await resultMenu.boundingBox();
    const triggerBox = await moreActions.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(triggerBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(820);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(triggerBox!.y);
    await expect(resultMenu.getByRole("menuitem", { name: "Search only this source" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const copyCitation = resultMenu.getByRole("menuitem", { name: "Copy citation" });
    await expect(copyCitation).toBeFocused();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      Object.defineProperty(document, "execCommand", { configurable: true, value: () => true });
    });
    await page.keyboard.press("Enter");
    await expect(resultMenu.getByRole("menuitem", { name: "Citation copied" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(moreActions).toBeFocused();

    // Retrieval scope and result refinements now live in one staged panel
    // rather than competing with a native select in the ribbon.
    await mobileFilterTrigger.click();
    const phoneFilterPanel = page.getByTestId("document-filter-panel");
    const phoneTablesFilter = phoneFilterPanel.getByRole("radio", { name: /Tables/ });
    if ((await phoneTablesFilter.count()) > 0) {
      await phoneTablesFilter.click();
      await expect(phoneTablesFilter).toHaveAttribute("aria-checked", "true");
      await phoneFilterPanel
        .getByRole("radiogroup", { name: "Result type" })
        .getByRole("radio", { name: /^All/ })
        .click();
    }
    await phoneFilterPanel.getByTestId("document-filter-panel-done").click();
    await expect(phoneFilterPanel).toHaveCount(0);
    await expect(documentResults).toBeVisible();

    const openDocumentLink = documentResults
      .getByRole("link", { name: /Open Synthetic lithium monitoring protocol/i })
      .last();
    await expect(openDocumentLink).toBeVisible();
    // Exact viewer target built from mockDemoApi's lithium result (document_id / bestPages[0] /
    // bestChunkIds[0]): a link to the wrong document, page, or chunk must fail this assertion.
    await expect(openDocumentLink).toHaveAttribute(
      "href",
      "/documents/11111111-1111-4111-8111-111111111111?page=1&chunk=44444444-4444-4444-8444-444444444442",
    );
    await expect(page.getByRole("complementary", { name: "Selected document evidence" })).toHaveCount(0);
    await expect(documentResults.getByRole("button", { name: /Preview evidence/i })).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expectNoPageHorizontalOverflow(page);

    // Sort is a segmented group of pressed buttons, not a select: the active
    // order is readable without opening anything. Exercised here rather than at
    // 390px because the control is `sm`-and-up — the phone assertion above is
    // that it is hidden; this is the proof it still works where it renders.
    const documentSort = queryRibbon.getByRole("group", { name: "Sort results" });
    await expect(documentSort).toBeVisible();
    await documentSort.getByRole("button", { name: "A–Z" }).click();
    await expect(page).toHaveURL(/[?&]sort=alpha/);
    await expect(documentSort.getByRole("button", { name: "A–Z" })).toHaveAttribute("aria-pressed", "true");
    await documentSort.getByRole("button", { name: "Relevance" }).click();

    // The same panel, reached from the wide-viewport copy of the trigger.
    const wideFilterTrigger = queryRibbon.getByTestId("document-filter-trigger-wide");
    await expect(wideFilterTrigger).toBeVisible();
    // No tap-target assertion here: from `sm` up the ribbon controls are
    // deliberately `min-h-10` (40px) for fine pointers. The 44px floor is a
    // phone contract and is asserted on the phone trigger at 390px above.
    await expect(queryRibbon.getByTestId("document-filter-trigger-phone")).toBeHidden();
    await wideFilterTrigger.click();
    const wideFilterPanel = page.getByTestId("document-filter-panel");
    await expect(wideFilterPanel.getByRole("radiogroup", { name: "Source locality" })).toBeVisible();
    const dashboardMain = page.locator("main#main-content");
    const scrollTopBeforeSources = await dashboardMain.evaluate((element) => element.scrollTop);
    // The corpus is now reached from the sheet's footer rather than the rail,
    // and reaching it dismisses the sheet: browsing is leaving this surface, so
    // the Sources drawer must not open underneath a filter panel still covering
    // the results both of them describe.
    await wideFilterPanel.getByRole("button", { name: /Browse all sources/ }).click();
    await expect(wideFilterPanel).toHaveCount(0);
    const resultsLibraryDialog = page.getByRole("dialog", { name: "Sources" });
    await expect(resultsLibraryDialog).toBeVisible();
    // Prefer Playwright's focus waiter over a raw activeElement poll — Sheet
    // autofocus can land after lazy DocumentDrawer mount + composer focus=1.
    await expect(resultsLibraryDialog.getByPlaceholder("Find a document")).toBeFocused({ timeout: 15_000 });
    const sourceDialogBox = await resultsLibraryDialog.boundingBox();
    expect(sourceDialogBox).not.toBeNull();
    expect(sourceDialogBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((sourceDialogBox?.y ?? 0) + (sourceDialogBox?.height ?? 0)).toBeLessThanOrEqual(900);
    await expect.poll(() => dashboardMain.evaluate((element) => element.scrollTop)).toBe(scrollTopBeforeSources);
    await expect(page.locator("details#dashboard-documents-drawer")).not.toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(resultsLibraryDialog).toHaveCount(0);
    // Focus must come back to a real control, never to `body` — closing a modal
    // into nothing strands a keyboard user at the top of the document.
    //
    // It lands on the documents options button rather than on whatever opened
    // the drawer, because the opener is now the sheet's footer control and the
    // sheet dismisses itself on the way out, so by the time the drawer closes
    // its opener has unmounted. That is a fallback, not the ideal — returning to
    // the filter trigger would be better — but it is a visible, related control
    // in the same workspace, and it is the app's existing restore target rather
    // than anything this change introduced.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null;
            if (!active || active === document.body) return "body";
            return active.getAttribute("aria-label") ?? active.tagName;
          }),
        { timeout: 15_000 },
      )
      .toBe("Open documents options");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(documentResults).toBeVisible();
    await expect(documentResults).toContainText("Top result");
  });

  test("dashboard defers source and administration requests until their surfaces open @critical", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    const requestCounts = { documents: 0, jobs: 0, batches: 0, quality: 0 };
    page.on("request", (request) => {
      if (isNextPrefetchRequest(request)) return;
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/documents") requestCounts.documents += 1;
      if (pathname === "/api/ingestion/jobs") requestCounts.jobs += 1;
      if (pathname === "/api/ingestion/batches") requestCounts.batches += 1;
      if (pathname === "/api/ingestion/quality") requestCounts.quality += 1;
    });

    // Start directly on the shared home with Documents preselected, rather than
    // switching mode from `/`: the mode pill no longer changes the page, and a
    // mid-test navigation would reset the request counts this test exists to
    // measure. `/documents` itself now only 307s here, so land on the real
    // destination directly instead of relying on that extra hop.
    await gotoApp(page, "/?mode=documents");
    // waitForDemoDashboardReady looks for "Open answer options"; the actions
    // trigger is named for the active mode, which is Documents on this route.
    await expect(visibleQuestionInput(page)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Open documents options" })).toBeVisible({ timeout: 30_000 });
    expect(requestCounts).toEqual({ documents: 0, jobs: 0, batches: 0, quality: 0 });

    await openScopeControl(page);
    await expect.poll(() => requestCounts.documents).toBe(1);
    expect(requestCounts.jobs).toBe(0);
    expect(requestCounts.batches).toBe(0);
    expect(requestCounts.quality).toBe(0);
    // Escape closes the scope popover but leaves the composer's command dropdown
    // open, and that dropdown overlays the home content below it — so dismiss the
    // composer the way a user does, by clicking away from it. Previously this test
    // switched mode after scoping and the re-render reset the composer for free;
    // the shared home is a single static route, so the blur has to be explicit.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("scope-command-popover")).toHaveCount(0);
    await page
      .getByRole("main")
      .getByRole("heading", { name: "Documents" })
      .first()
      .click({ position: { x: 2, y: 2 } });
    // Scope restore can land on the composer + trigger; the command listbox must
    // stay closed so it cannot cover the composer's "Open documents options" menu.
    await expect(page.getByRole("listbox", { name: /search suggestions/i })).toHaveCount(0);

    // Documents' idle browse tiles are retired; "Browse library" now lives in
    // the composer's own options menu instead of being directly on the page.
    await page.getByRole("button", { name: "Open documents options" }).click();
    await page.getByRole("button", { name: "Browse library", exact: true }).first().click();
    await expect.poll(() => requestCounts.documents).toBe(1);
    expect(requestCounts.jobs).toBe(0);
    expect(requestCounts.batches).toBe(0);
    expect(requestCounts.quality).toBe(0);
  });

  // The legacy `/?mode=tools` URL used to render a second, hub-shaped launcher. It now
  // redirects to `/tools`, so the query it carries has to survive the hop and land on
  // the one tools directory with the same registry search behind it.
  test("the legacy tools URL carries its query to the tools directory", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockPrivateUnauthenticatedApi(page);
    await gotoApp(page, "/?mode=tools&q=medications&focus=1&run=1");

    await page.waitForURL(/\/tools\?/);
    await expect(page.getByRole("button", { name: "Mode Tools" })).toBeVisible();
    const results = page.getByTestId("tools-search-results-page");
    await expect(results).toBeVisible();
    const queryRibbon = results.getByTestId("search-query-ribbon");
    await expect(queryRibbon.getByRole("heading", { name: "medications" })).toBeVisible();
    await expect(results.getByRole("heading", { level: 3, name: "Medication Prescribing" })).toBeVisible();
    // The pinned row is for an unqueried catalogue, so a running query hides it.
    await expect(page.getByTestId("tools-pinned")).toHaveCount(0);
    await results.getByRole("button", { name: "About Medication Prescribing" }).click();
    await expect(
      page.locator('[data-testid="tools-search-detail-sheet"]:visible').locator('a[href="/medications"]').first(),
    ).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
  });

  test("services shortlist exposes comparison only when requested", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/services?q=mental%20health&focus=1&run=1");

    const navigator = page.getByRole("main");
    await expect(navigator).toBeVisible();
    await expect(navigator.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(navigator.getByTestId("services-shortlist-bar")).toHaveCount(0);
    await expect(navigator.getByTestId("services-comparison")).toHaveCount(0);

    // The compact rail is progressive: it tracks shortlist state rather than
    // standing there as an always-on four-card walkthrough (ledger #163).
    const progress = navigator.getByRole("navigation", { name: "Referral progress" });
    const currentStage = progress.locator('[aria-current="step"]');
    await expect(currentStage).toHaveText("Search");

    const addButtons = navigator.getByRole("button", { name: /Add .* to shortlist/ });
    await addButtons.nth(0).click();
    const shortlist = navigator.getByTestId("services-shortlist-bar");
    await expect(shortlist).toContainText("1 shortlisted");
    await expect(shortlist.getByRole("button", { name: "Compare" })).toBeDisabled();
    await expect(currentStage).toHaveText("Shortlist");

    await addButtons.nth(1).click();
    await expect(shortlist).toContainText("2 shortlisted");
    await shortlist.getByRole("button", { name: "Compare" }).click();
    await expect(navigator.getByTestId("services-comparison")).toBeVisible();
    await expect(currentStage).toHaveText("Compare");

    await shortlist.getByRole("button", { name: "Clear" }).click();
    await expect(navigator.getByTestId("services-shortlist-bar")).toHaveCount(0);
    await expect(navigator.getByTestId("services-comparison")).toHaveCount(0);
    await expect(currentStage).toHaveText("Search");
  });

  test("search regressions avoid fetch errors and open viewer hits @critical", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/");
    await waitForDemoDashboardReady(page);

    await gotoApp(page, "/documents/search?mode=documents");
    const questionInput = visibleQuestionInput(page);
    await expect(questionInput).toBeVisible();
    await waitForReactEventHandler(questionInput, "onChange");

    await questionInput.fill("what is the best coffee machine for my kitchen");
    await submitDocumentSearch(page);
    await expect(page).toHaveURL(/\/documents\/search\?/);
    await expect(page.locator("body")).not.toContainText(/failed to fetch|Search failed/i);
    // Still a heading, deliberately: #1612 promoted this state's title to `h3`
    // because it owns its region, and the move to the shared empty state must
    // not quietly demote it back to a paragraph. Only the copy changed — the
    // shared state names the query that found nothing.
    await expect(
      page.getByRole("heading", { level: 3, name: /No matches for .what is the best coffee machine/ }).first(),
    ).toBeVisible();

    const demoDocId = "11111111-1111-4111-8111-111111111111";
    await gotoApp(page, `/documents/${demoDocId}?chunk=44444444-4444-4444-8444-444444444442`);
    await expect(page).toHaveURL(/chunk=44444444-4444-4444-8444-444444444442/);
    await expect(page.locator("#source-evidence").getByTestId("highlighted-source-passage")).toContainText(
      "Escalate review when there is vomiting",
    );
    // Citation landing keeps the indexed dump collapsed so the PDF stays primary.
    await expect(page.locator("#source-text")).toHaveJSProperty("open", false);
    // A click that lands before hydration is dropped (Firefox, release matrix 2026-09-25).
    // Re-click only while the indexed-text disclosure is still closed.
    const indexedTextPanel = page.locator("#source-text");
    await expect(async () => {
      if (!(await indexedTextPanel.evaluate((node) => (node as HTMLDetailsElement).open))) {
        await page.getByTestId("inspect-indexed-text").click();
      }
      await expect(indexedTextPanel).toHaveJSProperty("open", true, { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await expect(
      page.getByTestId("source-chunk-indexed-text-panel").getByTestId("highlighted-indexed-source-chunk"),
    ).toBeVisible();
    await expect(
      page.getByTestId("source-chunk-indexed-text-panel").getByTestId("highlighted-indexed-source-chunk"),
    ).toHaveJSProperty("open", true);

    // The fixed document composer is the single search owner; the indexed-text
    // disclosure must not duplicate a large search field inside its content.
    // The native <details> toggle above opens without React, so it does not prove
    // hydration, and opening it scroll-hides the header under the pointer (release
    // traces: "<h2> intercepts pointer events", then a click that missed).
    // clickWhenSettled waits for hydration and for the button to stop moving.
    await clickWhenSettled(page.getByRole("button", { name: "Search document" }));
    const sourceSearch = page.getByRole("textbox", { name: "Search within this document" });
    await expect(page.getByLabel("Search within indexed source text")).toHaveCount(0);
    await waitForReactEventHandler(sourceSearch, "onChange");
    await sourceSearch.fill("safety plan include");
    const desktopTextPanel = page.getByTestId("source-chunk-indexed-text-panel");
    await expect(desktopTextPanel.getByText("Hit 1 of 2").first()).toBeVisible();
    await expect(desktopTextPanel.locator("mark").filter({ hasText: "safety" }).first()).toBeVisible();
    const initialActiveHit = desktopTextPanel.locator('details[data-source-active-hit="true"]');
    await expect(initialActiveHit).toHaveJSProperty("open", true);
    const initialActiveHitId = await initialActiveHit.getAttribute("data-source-chunk-id");
    expect(initialActiveHitId).toBeTruthy();
    const initialActiveDisclosure = desktopTextPanel.locator(`details[data-source-chunk-id="${initialActiveHitId}"]`);
    const previousHit = desktopTextPanel.getByRole("button", { name: "Previous document search hit" });
    const nextHit = desktopTextPanel.getByRole("button", { name: "Next document search hit" });
    await expect(previousHit).toHaveAttribute("title", "Previous document search hit");
    await expect(previousHit).toHaveText("");
    await expect(nextHit).toHaveAttribute("title", "Next document search hit");
    await expect(nextHit).toHaveText("");
    // Pointer activation is the regression this test pins: product-side moveHit
    // coalescing + exclusive-accordion open sync must keep a single click from
    // wrapping a two-hit search back to Hit 1 on Firefox. Keyboard coverage is
    // separate (activateFocusedControl elsewhere); do not substitute it here.
    //
    // A wrap-back and a lost click look identical from the counter ("Hit 1 of 2").
    // The lost click is real: the viewer is still settling after the first hit
    // opens, and on a slow runner the button moved ~70px between Playwright's
    // press and release, so mouseup landed on a passage summary and the browser
    // sent the click to their common ancestor (reproduced under 8x CPU throttle;
    // failed on Firefox and desktop WebKit in runs 36214387379, 36210366372).
    // Count the clicks the button itself receives and re-click only when it
    // received none: an undelivered click is retried, while a delivered click
    // that fails to advance still fails here and names its click count.
    await nextHit.evaluate((button) => {
      const counter = window as unknown as { __nextHitClicks: number };
      counter.__nextHitClicks = 0;
      button.addEventListener("click", () => {
        counter.__nextHitClicks += 1;
      });
    });
    const nextHitClicks = () => page.evaluate(() => (window as unknown as { __nextHitClicks: number }).__nextHitClicks);
    await nextHit.click();
    await expect(async () => {
      if ((await nextHitClicks()) === 0) await nextHit.click();
      await expect(
        desktopTextPanel.getByText("Hit 2 of 2"),
        `Next hit button received ${await nextHitClicks()} click(s)`,
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    const nextActiveHit = desktopTextPanel.locator('details[data-source-active-hit="true"]');
    await expect(nextActiveHit).toHaveJSProperty("open", true);
    await expect(initialActiveDisclosure).toHaveJSProperty("open", false);
    await page.getByRole("button", { name: "Close document search" }).click();
    await expect(sourceSearch).toHaveCount(0);
    await expect(desktopTextPanel.getByText("Hit 2 of 2")).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("document viewer hydrates once and signs downloads only on demand @critical", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);

    const documentId = "11111111-1111-4111-8111-111111111111";
    const browserDetailRequests: string[] = [];
    const setupRequests: string[] = [];
    const signedUrlRequests: Array<"preview" | "download"> = [];
    page.on("request", (request) => {
      if (isNextPrefetchRequest(request)) return;
      const url = new URL(request.url());
      if (url.pathname === `/api/documents/${documentId}`) browserDetailRequests.push(request.url());
      if (url.pathname === "/api/setup-status") setupRequests.push(request.url());
    });
    await page.route(/\/api\/documents\/([^/]+)\/signed-url(?:\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      const id = url.pathname.split("/").at(-2) ?? "";
      const document = getDemoDocument(id);
      if (!document) {
        await route.fulfill({ status: 404, json: { error: "Demo document not found." } });
        return;
      }
      const requestKind = url.searchParams.get("download") === "true" ? "download" : "preview";
      signedUrlRequests.push(requestKind);
      if (requestKind === "download") await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        json: { url: document.storage_path, fileType: document.file_type, demoMode: true },
      });
    });

    await gotoApp(page, `/documents/${documentId}?page=1&chunk=44444444-4444-4444-8444-444444444442`);
    await expect(page.getByRole("heading", { level: 1, name: "Synthetic lithium monitoring protocol" })).toBeVisible();
    await expect(page.getByTestId("source-chunk-indexed-text-panel")).toHaveCount(1);
    await expect.poll(() => signedUrlRequests.filter((kind) => kind === "preview").length).toBe(1);
    expect(browserDetailRequests).toHaveLength(0);
    expect(setupRequests).toHaveLength(0);
    expect(signedUrlRequests.filter((kind) => kind === "download")).toHaveLength(0);

    const downloadButton = page.getByRole("button", { name: "Download", exact: true });
    await expect(downloadButton).toBeEnabled();
    await downloadButton.dblclick();
    await expect.poll(() => signedUrlRequests.filter((kind) => kind === "download").length).toBe(1);
  });

  test("document frame stretches the canvas owner at phone and desktop", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await mockDemoApi(page);
    await gotoApp(
      page,
      "/documents/11111111-1111-4111-8111-111111111111?page=1&chunk=44444444-4444-4444-8444-444444444442",
    );

    const canvasOwner = page.getByTestId("pdf-canvas-owner");
    await expect(page.getByTestId("pdf-canvas-scroll").locator("canvas")).toBeVisible({ timeout: 30_000 });
    await expectDocumentOwnerFillsFrame(page, canvasOwner);

    // There is one reader. The browser-engine iframe was removed because the
    // production CSP (`default-src 'self'`, no frame-src) refuses a cross-origin
    // frame; it only ever rendered against this same-origin demo corpus.
    await expect(page.locator("iframe")).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expectDocumentOwnerFillsFrame(page, canvasOwner);
    await expectNoPageHorizontalOverflow(page);
  });

  test("document viewer puts the PDF preview first with pinned evidence after it on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    // iOS Safari cannot fullscreen a plain document element, so production
    // takes the fixed in-app fallback there. Exercise that exact path instead
    // of letting Chromium's native fullscreen top layer hide stacking bugs.
    await page.addInitScript(() => {
      Object.defineProperty(Element.prototype, "requestFullscreen", {
        configurable: true,
        value: () => Promise.reject(new Error("fullscreen blocked by test")),
      });
    });
    await mockDemoApi(page);
    await gotoApp(
      page,
      "/documents/11111111-1111-4111-8111-111111111111?page=1&chunk=44444444-4444-4444-8444-444444444442",
    );

    const evidence = page.locator('[data-testid="pinned-source-evidence"]:visible').first();
    const preview = page.getByTestId("pdf-preview");
    const toolbar = page.getByTestId("document-frame-controls");
    const pdfScroller = page.getByTestId("pdf-canvas-scroll");
    // Phone owns section navigation via the title disclosure + sheet, not the
    // retired in-flow "Document viewer sections" link row.
    const sectionTrigger = page.getByTestId("document-section-trigger");
    const openSection = async (label: RegExp) => {
      await revealPhoneHeaderControl(page, sectionTrigger);
      await sectionTrigger.click();
      const sheet = page.getByTestId("document-section-sheet");
      await expect(sheet).toBeVisible();
      const row = sheet.getByRole("button", { name: label });
      await waitForReactEventHandler(row, "onClick");
      await activateFocusedControl(page, row);
      await expect(sheet).toHaveCount(0);
    };

    await expect(evidence).toBeVisible();
    await expect(evidence.getByText("Highlighted source passage")).toBeVisible();
    await expect(page.locator("#source-text")).toBeVisible();
    await expect(page.locator("#source-text")).toHaveJSProperty("open", false);
    await expect(page.getByTestId("inspect-indexed-text")).toBeVisible();
    await expect(sectionTrigger).toBeVisible();
    await revealPhoneHeaderControl(page, sectionTrigger);
    await sectionTrigger.click();
    const sectionSheet = page.getByTestId("document-section-sheet");
    await expect(sectionSheet.getByRole("button", { name: /Cited excerpt/ })).toBeVisible();
    await expect(sectionSheet.getByRole("button", { name: /PDF preview/ })).toBeVisible();
    await expect(sectionSheet.getByRole("button", { name: /Indexed source text/ })).toBeVisible();
    const mobileDensityToggle = sectionSheet.getByTestId("document-view-density-toggle");
    await expect(mobileDensityToggle).toHaveAttribute("aria-pressed", "true");
    await expect(mobileDensityToggle).toHaveAccessibleName("Show full document content");
    await page.keyboard.press("Escape");
    await expect(sectionSheet).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Synthetic lithium monitoring protocol" })).toBeVisible();
    await expect(preview).toBeVisible();
    await expect(toolbar).toBeVisible({ timeout: 30000 });
    // Phones reach the lower-frequency view actions through the toolbar overflow;
    // sm+ shows them inline. The toolbar is mounted before pdf.js finishes
    // painting, so wait for a control to enable before dispatching a pointer.
    const overflow = page.getByTestId("document-frame-overflow");
    // Prefer the accessible name over role: a bare <summary> under role="toolbar"
    // was exposed as generic in Chromium (CI tip 23dfb955), so button queries hung.
    const overflowToggle = overflow.getByLabel("More viewing options");
    const openOverflow = async () => {
      await overflowToggle.click();
    };
    // At 320px Zoom in lives only inside the overflow menu (inline from 380px).
    await openOverflow();
    await expect(overflow.getByRole("button", { name: "Zoom in" })).toBeEnabled({ timeout: 30000 });
    // Toggle the summary closed so later openOverflow() calls start from closed.
    await overflowToggle.click();
    await expect(pdfScroller.locator("canvas")).toBeVisible();

    await expectDomIntegrity(page);

    const evidenceBox = await evidence.boundingBox();
    const previewBox = await preview.boundingBox();
    const indexedTextHeading = page
      .getByTestId("source-chunk-indexed-text-panel")
      .getByRole("heading", { name: "Indexed source text", exact: true });
    const indexedTextBox = await indexedTextHeading.boundingBox();
    const imagesBox = await page.getByRole("heading", { name: "Tables and diagrams" }).boundingBox();

    expect(evidenceBox).not.toBeNull();
    expect(previewBox).not.toBeNull();
    expect(indexedTextBox).not.toBeNull();
    expect(imagesBox).not.toBeNull();
    expect(previewBox!.y).toBeLessThan(evidenceBox!.y);
    expect(evidenceBox!.height).toBeLessThan(640);
    expect(previewBox!.y).toBeLessThan(indexedTextBox!.y);
    expect(indexedTextBox!.y).toBeLessThan(imagesBox!.y);

    const passageToggle = page.getByTestId("toggle-full-passage").first();
    await expect(passageToggle).toHaveText("Full passage");
    await expect(passageToggle).toHaveAttribute("aria-expanded", "false");
    // Keyboard activation is intentional here: pdf.js can resize the canvas
    // while Firefox is calculating pointer coordinates, but a focused native
    // button must keep its expand/collapse behavior through that layout shift.
    await activateFocusedControl(page, passageToggle);
    await expect(passageToggle).toHaveText("Collapse");
    await expect(passageToggle).toHaveAttribute("aria-expanded", "true");
    const expandedEvidenceBox = await evidence.boundingBox();
    expect(expandedEvidenceBox?.height ?? 0).toBeGreaterThan(evidenceBox!.height);
    await activateFocusedControl(page, passageToggle);
    await expect(passageToggle).toHaveText("Full passage");
    await expect(passageToggle).toHaveAttribute("aria-expanded", "false");
    const collapsedEvidenceBox = await evidence.boundingBox();
    expect(collapsedEvidenceBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(expandedEvidenceBox!.height);
    await openSection(/PDF preview/);
    await expect(preview).toBeInViewport();
    await openSection(/Indexed source text/);
    await expect(indexedTextHeading).toBeInViewport();
    await expect(page.locator("#source-text")).toHaveJSProperty("open", true);
    await expect(
      page.getByTestId("source-chunk-indexed-text-panel").getByTestId("highlighted-indexed-source-chunk"),
    ).toBeVisible();
    await openSection(/PDF preview/);
    await expect(preview).toBeInViewport();

    const mobilePdfStyles = await toolbar.evaluate((element) => ({
      position: window.getComputedStyle(element).position,
    }));
    // Overflow dropdown anchors on the relative <details> wrapper; the toolbar
    // itself stays in normal flow (static) so mobile PDF chrome does not create
    // a sticky/fixed positioning context over the document.
    expect(mobilePdfStyles.position).toBe("static");

    await expect(pdfScroller).toBeVisible();
    await openOverflow();
    await overflow.getByRole("button", { name: "Fullscreen" }).click();
    const fullscreenRootStyles = await page.getByTestId("document-frame").evaluate((element) => {
      const style = window.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const topOwner = document.elementFromPoint(window.innerWidth / 2, 1);
      return {
        position: style.position,
        height: style.height,
        bounds: {
          left: Math.round(bounds.left),
          top: Math.round(bounds.top),
          right: Math.round(bounds.right),
          bottom: Math.round(bounds.bottom),
        },
        ownsTopEdge: Boolean(topOwner && element.contains(topOwner)),
      };
    });
    expect(fullscreenRootStyles.position).toBe("fixed");
    expect(fullscreenRootStyles.bounds).toEqual({ left: 0, top: 0, right: 320, bottom: 720 });
    expect(fullscreenRootStyles.ownsTopEdge).toBe(true);
    await expect(page.locator("#search")).toHaveCSS("visibility", "hidden");
    const exitFullscreen = page.getByRole("button", { name: "Exit fullscreen document view" });
    await expect(exitFullscreen).toBeVisible();
    await expect(exitFullscreen).toBeFocused();
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await expect(exitFullscreen).toBeVisible();
    await expect(page.locator("#search")).toHaveCSS("visibility", "hidden");
    await exitFullscreen.click();
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });

    // A rejected desktop Fullscreen API request uses the same fallback. It must
    // still suppress app chrome, cover the resized viewport, and leave through
    // the keyboard Escape path without requiring the phone overflow menu.
    await page.setViewportSize({ width: 1280, height: 900 });
    const enterFullscreen = page.getByRole("button", { name: "Enter fullscreen document view" });
    await expect(enterFullscreen).toBeVisible();
    await enterFullscreen.click();
    await expect(page.locator("#search")).toHaveCSS("visibility", "hidden");
    await expect(page.getByTestId("document-frame")).toHaveAttribute("data-fullscreen-fallback", "on");
    await expect(page.getByTestId("document-frame")).toHaveCSS("position", "fixed");
    const fullscreenBounds = await page.getByTestId("document-frame").boundingBox();
    expect(fullscreenBounds).not.toBeNull();
    expect({
      x: Math.round(fullscreenBounds!.x),
      y: Math.round(fullscreenBounds!.y),
      width: Math.round(fullscreenBounds!.width),
      height: Math.round(fullscreenBounds!.height),
    }).toEqual({ x: 0, y: 0, width: 1280, height: 900 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("document-frame")).not.toHaveAttribute("data-fullscreen");
    await expect(page.locator("#search")).not.toHaveCSS("visibility", "hidden");
    await page.setViewportSize({ width: 320, height: 720 });

    const fitWidthScrollStyles = await pdfScroller.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        overflowX: style.overflowX,
        touchAction: style.touchAction,
      };
    });
    expect(fitWidthScrollStyles.overflowX).toBe("hidden");
    expect(fitWidthScrollStyles.touchAction).toContain("pan-y");

    // Exercise the independent actions sheet last. Its portal/focus teardown
    // causes a deferred root commit in Firefox; no subsequent target should be
    // selected against the pre-teardown layout.
    const openDocumentActions = page.getByRole("button", { name: "Open document actions" }).first();
    await scrollPrimarySurface(page, 0);
    await expect(openDocumentActions).toBeInViewport();
    await expect(openDocumentActions).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: "Add this document to scope" })).toHaveCount(0);
    await openDocumentActions.click();
    const documentActions = page.getByRole("dialog", { name: "This document" });
    await expect(documentActions).toBeVisible();
    await expect(openDocumentActions).toHaveAttribute("aria-expanded", "true");
    await expect(documentActions.getByRole("button", { name: "Add to scope" })).toHaveCount(0);
    await documentActions.getByRole("button", { name: "Search document" }).click();
    const composer = page.locator("form.document-viewer-composer");
    await expect(composer).toBeVisible();
    await openDocumentActions.click();
    await expect(documentActions).toBeVisible();
    const composerBox = await composer.boundingBox();
    expect(composerBox).not.toBeNull();
    const sheetOwnsComposerPoint = await documentActions.evaluate(
      (dialog, point) => dialog.contains(document.elementFromPoint(point.x, point.y)),
      { x: composerBox!.x + composerBox!.width / 2, y: composerBox!.y + composerBox!.height / 2 },
    );
    expect(sheetOwnsComposerPoint).toBe(true);
    await tapOutsideActiveSurface(page);
    await expect(documentActions).toHaveCount(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("document viewer smart summary is structured with badges and demoted indexing details", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockDemoApi(page);
    await gotoApp(page, "/documents/11111111-1111-4111-8111-111111111111?page=1");

    await expect(page.getByRole("heading", { level: 1, name: "Synthetic lithium monitoring protocol" })).toBeVisible({
      timeout: 30_000,
    });
    // Live document body sits under the shell reserve pad; a streaming twin can
    // still be in `main` (#093) and trips Playwright strict mode on bare testid.
    const clinicalSummary = page.getByTestId("mobile-composer-reserve-pad").getByTestId("document-clinical-summary");
    await expect(clinicalSummary).toBeVisible();
    await expect(clinicalSummary.getByRole("heading", { name: "Clinical priorities" })).toBeVisible();
    const clinicalPriorities = clinicalSummary.getByRole("button", { name: /Clinical priorities/ });
    await expect(clinicalPriorities).toHaveAttribute("aria-expanded", "false");
    const densityToggle = page.getByTestId("document-section-index").getByTestId("document-view-density-toggle");
    await expect(densityToggle).toHaveAttribute("aria-pressed", "true");
    await densityToggle.click();
    await expect(densityToggle).toHaveAttribute("aria-pressed", "false");
    await expect(clinicalPriorities).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("heading", { name: "Key sections", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Useful pages", exact: true })).toHaveCount(0);
    const summaryCard = page.getByTestId("high-yield-summary");
    await expect(summaryCard).toBeVisible();
    await expect(summaryCard).toHaveJSProperty("open", false);
    await summaryCard.getByText("High-yield summary", { exact: true }).click();
    await expect(summaryCard).toHaveJSProperty("open", true);
    // Smart summary: badge cluster from labels + detected phrases, structured
    // sections, and no document-header boilerplate leaking through.
    await expect(summaryCard.getByText("Narrow therapeutic index", { exact: true })).toBeVisible();
    await expect(summaryCard.getByTestId("formatted-high-yield-summary")).toBeVisible();
    await expect(summaryCard).not.toContainText("Reference #");
    await expect(summaryCard).not.toContainText("Service/Department/Unit");

    // The old meta-only "Document details" card is gone; indexing metadata is
    // demoted behind a collapsed disclosure at the bottom of the sidebar.
    await expect(page.getByText("Document details", { exact: true })).toHaveCount(0);
    const indexingDetails = page.getByTestId("indexing-details");
    await expect(indexingDetails).toBeVisible();
    await expect(indexingDetails.getByText("rag-deep-memory-v1")).toBeHidden();
    await indexingDetails.getByText("Indexing details", { exact: true }).click();
    await expect(indexingDetails.getByText("rag-deep-memory-v1")).toBeVisible();

    await expectDomIntegrity(page);
    await expectNoPageHorizontalOverflow(page);
  });

  test("document source text accordion stays compact at 320, 390, and 1280 pixels", async ({ page }) => {
    await mockDemoApi(page);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, "/documents/11111111-1111-4111-8111-111111111111?page=1");
      await expect(page.getByRole("heading", { level: 1, name: "Synthetic lithium monitoring protocol" })).toBeVisible({
        timeout: 30_000,
      });

      const indexedText = page.locator("#source-text");
      const pageText = indexedText.getByTestId("indexed-page-text-disclosure");
      const passages = indexedText.locator("details[data-source-chunk-id]");
      await expect(indexedText).toHaveJSProperty("open", false);
      await expect(passages).toHaveCount(2);
      for (const disclosure of [pageText, passages.nth(0), passages.nth(1)]) {
        await expect(disclosure).toHaveJSProperty("open", false);
      }

      // The accordion sits below the fold; clicking it mid-scroll-hide misses (clickWhenSettled).
      await clickWhenSettled(indexedText.locator("summary").first());
      await expect(indexedText).toHaveJSProperty("open", true);
      await clickWhenSettled(passages.nth(0).locator("summary"));
      await expect(passages.nth(0)).toHaveJSProperty("open", true);
      await expect(passages.nth(1)).toHaveJSProperty("open", false);
      await clickWhenSettled(passages.nth(1).locator("summary"));
      await expect(passages.nth(1)).toHaveJSProperty("open", true);
      await expect(passages.nth(0)).toHaveJSProperty("open", false);
      await expectNoPageHorizontalOverflow(page);
    }
  });

  test("document viewer content disclosures are naturally closed and mutually exclusive by default", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(page, "/documents/11111111-1111-4111-8111-111111111111?page=1");

    await expect(page.getByRole("heading", { level: 1, name: "Synthetic lithium monitoring protocol" })).toBeVisible({
      timeout: 30_000,
    });
    // Live document body sits under the shell reserve pad; a streaming twin can
    // still be in `main` (#093) and trips Playwright strict mode on bare testid.
    const clinicalSummary = page.getByTestId("mobile-composer-reserve-pad").getByTestId("document-clinical-summary");
    const summaryToggle = clinicalSummary.getByTestId("toggle-document-summary");
    await expect(clinicalSummary).toBeVisible();
    await expect(summaryToggle).toBeVisible();
    await expect(summaryToggle).toHaveAttribute("aria-expanded", "false");
    await summaryToggle.click();
    await expect(summaryToggle).toHaveAttribute("aria-expanded", "true");
    await expect(summaryToggle).toContainText("Show less");
    await clickWhenSettled(clinicalSummary.getByTestId("open-clinical-priorities"));
    const prioritiesSheet = page.getByRole("dialog", { name: "Clinical priorities" });
    await expect(prioritiesSheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(prioritiesSheet).toHaveCount(0);
    // The sheet hands focus back to its trigger; WebKit can do so up to a second
    // after the sheet unmounts (see revealPhoneHeaderControl).
    await expect(clinicalSummary.getByTestId("open-clinical-priorities")).toBeFocused();
    const indexedText = page.locator("#source-text");
    const summary = page.getByTestId("high-yield-summary");
    const images = page.locator("#source-images");
    const indexingDetails = page.getByTestId("indexing-details");
    const pageText = indexedText.getByTestId("indexed-page-text-disclosure");
    const passages = indexedText.locator("details[data-source-chunk-id]");
    const sectionTrigger = page.getByTestId("document-section-trigger");
    const clickSectionNav = async (label: RegExp) => {
      await revealPhoneHeaderControl(page, sectionTrigger);
      await sectionTrigger.click();
      const sheet = page.getByTestId("document-section-sheet");
      await expect(sheet).toBeVisible();
      const row = sheet.getByRole("button", { name: label });
      await waitForReactEventHandler(row, "onClick");
      await activateFocusedControl(page, row);
      await expect(sheet).toHaveCount(0);
    };
    // Demo docs with no extracted visuals omit Images from the section sheet;
    // open that disclosure from its own summary so exclusivity still covers
    // the always-present #source-images details.
    const openImagesDisclosure = async () => {
      await images.locator("summary").click();
      await expect(images).toHaveJSProperty("open", true);
    };

    await expect(indexedText).toBeVisible();
    await expect(indexedText).toHaveJSProperty("open", false);
    await expect(passages).toHaveCount(2);
    for (const disclosure of [pageText, passages.nth(0), passages.nth(1)]) {
      await expect(disclosure).toHaveJSProperty("open", false);
    }
    await revealPhoneHeaderControl(page, sectionTrigger);
    await sectionTrigger.click();
    const densitySheet = page.getByTestId("document-section-sheet");
    const densityToggle = densitySheet.getByTestId("document-view-density-toggle");
    await expect(densityToggle).toHaveAttribute("aria-pressed", "true");
    await waitForReactEventHandler(densityToggle, "onClick");
    await activateFocusedControl(page, densityToggle);
    await expect(densityToggle).toHaveAttribute("aria-pressed", "false");
    await expect(indexedText).toHaveJSProperty("open", true);
    await activateFocusedControl(page, densityToggle);
    await expect(densityToggle).toHaveAttribute("aria-pressed", "true");
    await expect(indexedText).toHaveJSProperty("open", false);
    await page.keyboard.press("Escape");
    await expect(densitySheet).toHaveCount(0);
    await expect(sectionTrigger).toBeFocused();
    for (const disclosure of [summary, images, indexingDetails]) {
      await expect(disclosure).toHaveJSProperty("open", false);
    }

    const summaryContent = summary.getByTestId("formatted-high-yield-summary");
    await expect(summaryContent).toBeHidden();
    await openImagesDisclosure();
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await expect(indexedText).toHaveJSProperty("open", true);
    await expect(pageText).toHaveJSProperty("open", true);
    await expect(passages.nth(0)).toHaveJSProperty("open", true);
    await expect(passages.nth(1)).toHaveJSProperty("open", true);
    await page.emulateMedia({ media: "print" });
    await expect(summaryContent).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(summaryContent).toBeHidden();
    await expect(images).toHaveJSProperty("open", true);
    await expect(indexedText).toHaveJSProperty("open", false);
    await expect(pageText).toHaveJSProperty("open", false);
    await expect(passages.nth(0)).toHaveJSProperty("open", false);
    await expect(passages.nth(1)).toHaveJSProperty("open", false);

    await clickSectionNav(/Indexed source text/);
    await expect(indexedText).toBeInViewport();
    await expect(indexedText).toHaveJSProperty("open", true);
    await expect(images).toHaveJSProperty("open", false);
    await passages.nth(0).locator("summary").click();
    await expect(passages.nth(0)).toHaveJSProperty("open", true);
    await passages.nth(1).locator("summary").click();
    await expect(passages.nth(1)).toHaveJSProperty("open", true);
    await expect(passages.nth(0)).toHaveJSProperty("open", false);

    await clickSectionNav(/High-yield summary/);
    // At this 390px viewport the rail's high-yield-summary disclosure is
    // hidden (superseded by the in-flow DocumentClinicalSummary card), so
    // there is nothing for the exclusive accordion to open here —
    // jumpToDocumentSection scrolls to the visible copy instead.
    await expect(page.locator("#source-summary-card")).toBeInViewport();
    await expect(summary).toHaveJSProperty("open", false);
    await expect(indexedText).toHaveJSProperty("open", false);

    await openImagesDisclosure();
    await expect(images).toHaveJSProperty("open", true);
    await expect(summary).toHaveJSProperty("open", false);

    await indexingDetails.getByText("Indexing details", { exact: true }).click();
    await expect(indexingDetails).toHaveJSProperty("open", true);
    await expect(images).toHaveJSProperty("open", false);

    await expectDomIntegrity(page);
    await expectNoPageHorizontalOverflow(page);
  });

  test("answer glass header overlays main and fully hides while scrolling on phones", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, "/?mode=answer");

    const header = page.locator("header.universal-header");
    await expect(header).toBeVisible();
    await expect(header).not.toHaveAttribute("data-scroll-hidden", "true");
    // Browser-mode phones attach the overlay to the visual viewport so Safari
    // can use document scrolling. Installed standalone mode uses the compiled
    // absolute-to-frame override covered by the dedicated PWA contract test.
    await expect.poll(async () => header.evaluate((node) => window.getComputedStyle(node).position)).toBe("fixed");
    const main = page.locator("main#main-content");
    const reserve = await main.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).paddingTop));
    const headerHeight = await header.evaluate((node) => node.getBoundingClientRect().height);
    expect(Math.abs(reserve - headerHeight)).toBeLessThanOrEqual(2);

    await appendPrimaryScrollSpacer(page, { heightPx: 2000, testId: "header-hide-scroll-spacer" });
    await expect.poll(async () => (await readPrimaryScrollGeometry(page)).owner).toBe("document");
    // Step the active document owner so the dashboard reporter sees deliberate movement.
    for (const offset of [40, 80, 120, 160, 200]) {
      await scrollPrimarySurface(page, offset);
    }

    await expect(header).toHaveAttribute("data-scroll-hidden", "true");
    await expect
      .poll(async () =>
        header.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return Math.max(0, rect.bottom) - Math.max(0, rect.top);
        }),
      )
      .toBe(0);
    // The scrim tail (taller than the bar) may leave only a whisper at the top
    // edge while hidden — bound it so it can't grow into a visible band.
    const scrimBottom = await page
      .locator(".edge-glass-header-backdrop")
      .evaluate((node) => node.getBoundingClientRect().bottom);
    expect(scrimBottom).toBeLessThanOrEqual(34);

    // Any deliberate scroll up slides the glass bar back in.
    for (const offset of [160, 120, 60]) {
      await scrollPrimarySurface(page, offset);
    }
    await expect(header).not.toHaveAttribute("data-scroll-hidden", "true");
  });

  test("private-scope alert stays reachable while the answer view scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    // An unauthenticated session with a routed private-scope ref resolves to
    // privateScopeStatus="unavailable", which renders the recovery alert.
    await gotoApp(page, "/?mode=answer&scopeRef=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const alert = page.getByTestId("private-scope-unavailable");
    await expect(alert).toBeVisible({ timeout: 15000 });

    await appendPrimaryScrollSpacer(page, { heightPx: 2000 });
    await expect.poll(async () => (await readPrimaryScrollGeometry(page)).owner).toBe("document");
    for (const offset of [80, 160, 260, 380]) {
      await scrollPrimarySurface(page, offset);
    }

    // Sticky inside <main>: the recovery actions must remain on-screen (they
    // used to scroll away with content, stranding the user mid-thread).
    await expect(alert).toBeVisible();
    const box = await alert.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThanOrEqual(200);
  });

  test("private-scope alert clears the revealed phone header outside the answer view", async ({ page }) => {
    // Reachable is not the same as visible. The alert is `sticky` inside <main>
    // with `z-20`, while the phone header owns `z-30` at the viewport top, so an
    // offset that assumes the header is out of the way leaves the recovery
    // buttons underneath it. Measured 35px of the alert obscured before this
    // guard, on a probe shorter than the real two-line alert. It predates phone
    // overlay motion — a header pinned by `position: sticky` covered it exactly
    // as much as the fixed overlay does — so assert the geometry, not the
    // mechanism, and do it on a non-answer mode where the offset differs.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(page, "/documents?scopeRef=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    const alert = page.getByTestId("private-scope-unavailable");
    await expect(alert).toBeVisible({ timeout: 15000 });

    await appendPrimaryScrollSpacer(page, { heightPx: 2000 });
    await expect.poll(async () => (await readPrimaryScrollGeometry(page)).owner).toBe("document");

    // Hide the chrome, then bring it back — the state that puts a full-height
    // header over a sticky alert. Assert the hide, not just the reveal: if
    // hide-on-scroll stopped firing the chrome would never leave, the upward
    // scrolls would still end revealed, and the overlap check below would pass
    // without ever exercising the state it exists to cover.
    const collapse = page.getByTestId("universal-header-collapse");
    for (const offset of [80, 160, 260, 380]) {
      await scrollPrimarySurface(page, offset);
    }
    await expect(collapse).toHaveAttribute("data-scroll-hidden", "true");

    for (const offset of [300, 240, 200]) {
      await scrollPrimarySurface(page, offset);
    }
    await expect(collapse).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect(alert).toBeVisible();

    const overlap = await page.evaluate(() => {
      const node = document.querySelector('[data-testid="private-scope-unavailable"]');
      const stack = document.querySelector(".phone-sticky-header-stack");
      // Throw rather than return a sentinel: a negative number satisfies the
      // `<= 1` assertion below, so a missing element would report a passing
      // overlap contract that was never measured.
      if (!(node instanceof HTMLElement) || !(stack instanceof HTMLElement)) {
        throw new Error("private-scope alert overlap: the alert or the phone header stack was not rendered");
      }
      const a = node.getBoundingClientRect();
      const h = stack.getBoundingClientRect();
      return Math.max(0, Math.min(a.bottom, h.bottom) - Math.max(a.top, h.top));
    });
    expect(overlap, "the revealed phone header must not cover the recovery alert").toBeLessThanOrEqual(1);
  });

  test("answer glass header hides and returns on desktop widths too", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await gotoApp(page, "/?mode=answer");

    const header = page.locator("header.universal-header");
    await expect(header).toBeVisible();
    await expect.poll(async () => header.evaluate((node) => window.getComputedStyle(node).position)).toBe("absolute");

    const main = page.locator("main#main-content");
    await waitForReactEventHandler(main, "onScroll");
    await main.evaluate((node) => {
      const spacer = document.createElement("div");
      spacer.style.height = "2400px";
      node.appendChild(spacer);
    });
    for (const offset of [40, 90, 150, 220, 300]) {
      await scrollPrimarySurface(page, offset);
    }
    await expect(header).toHaveAttribute("data-scroll-hidden", "true");

    for (const offset of [250, 200, 140]) {
      await scrollPrimarySurface(page, offset);
    }
    await expect(header).not.toHaveAttribute("data-scroll-hidden", "true");
  });

  test("non-answer phone header keeps the in-flow collapse hide", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(page, "/documents/search?q=lithium+monitoring&run=1");

    const header = page.locator("header.universal-header");
    const collapseHost = page.getByTestId("universal-header-collapse");
    await expect(header).toBeVisible();
    await expect(collapseHost).not.toHaveAttribute("data-scroll-hidden", "true");
    // Non-answer modes keep the header in flow — their sm+ composer renders
    // beneath it, which the absolute answer-mode overlay would bury.
    await expect.poll(async () => header.evaluate((node) => window.getComputedStyle(node).position)).toBe("relative");

    const main = page.locator("main#main-content");
    await appendPrimaryScrollSpacer(page, { heightPx: 2000 });
    await expect.poll(async () => (await readPrimaryScrollGeometry(page)).owner).toBe("document");
    for (const offset of [40, 80, 120, 160, 200]) {
      await scrollPrimarySurface(page, offset);
    }

    await expect(collapseHost).toHaveAttribute("data-scroll-hidden", "true");
    await expect
      .poll(async () =>
        header.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return Math.max(0, rect.bottom) - Math.max(0, rect.top);
        }),
      )
      .toBe(0);

    // A descendant may become the active scroller. Its near-zero offset must
    // establish a new baseline rather than looking like a large upward gesture
    // relative to the deeply scrolled main container.
    await main.evaluate(async (node) => {
      const nested = document.createElement("div");
      nested.dataset.testid = "nested-scroll-intent-source";
      nested.style.height = "40px";
      nested.style.overflowY = "auto";
      const content = document.createElement("div");
      content.style.height = "200px";
      nested.appendChild(content);
      node.appendChild(nested);
      nested.scrollTop = 4;
      nested.dispatchEvent(new Event("scroll"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await expect(collapseHost).toHaveAttribute("data-scroll-hidden", "true");

    // At the bottom, collapsing the in-flow header can reflow the scroll
    // surface and clamp scrollTop. That geometry-driven event is not an upward
    // user gesture and must not immediately reveal the header. The collapse
    // -budget gate refuses to START a hide at the bottom edge (that is the
    // #964 "locks to the bottom" trap), so hide with runway remaining first,
    // then ride the clamp to the bottom while hidden.
    await scrollPrimarySurface(page, 0);
    await expect(collapseHost).not.toHaveAttribute("data-scroll-hidden", "true");
    const visibleMaxOffset = (await readPrimaryScrollGeometry(page)).maxScrollTop;
    await scrollPrimarySurface(page, visibleMaxOffset - 400);
    await expect(collapseHost).toHaveAttribute("data-scroll-hidden", "true");
    await scrollPrimarySurface(page, "end");
    await expect(collapseHost).toHaveAttribute("data-scroll-hidden", "true");
    await expect.poll(async () => collapseHost.getAttribute("data-scroll-hidden"), { timeout: 1_000 }).toBe("true");
    // The hidden attribute flips before the 240ms grid-row transition has
    // released the header's layout space. Wait for rendered geometry so this
    // assertion cannot race the animation on faster or slower CI runners.
    await expect
      .poll(async () =>
        header.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return Math.max(0, rect.bottom) - Math.max(0, rect.top);
        }),
      )
      .toBe(0);
    // A deliberate upward gesture reveals the chrome again. Use two separated
    // steps, each yielding frames: on a starved CI renderer a single upward
    // write can coalesce into the trailing bottom-clamp evaluation and be
    // rebased away as geometry feedback. A real drag always emits follow-up
    // events, and the second step is a clean upward delta past reveal intent.
    const settledBottomOffset = (await readPrimaryScrollGeometry(page)).scrollTop;
    for (const rise of [24, 48]) {
      await scrollPrimarySurface(page, Math.max(0, settledBottomOffset - rise));
    }
    await expect(collapseHost).not.toHaveAttribute("data-scroll-hidden", "true");
  });

  test("document viewer bottom composer hides while scrolling down on phones", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockDemoApi(page);
    await gotoApp(
      page,
      "/documents/11111111-1111-4111-8111-111111111111?page=1&chunk=44444444-4444-4444-8444-444444444442",
    );

    await expect(page.getByRole("heading", { level: 1, name: "Synthetic lithium monitoring protocol" })).toBeVisible();
    const composer = page.locator("form.document-viewer-composer");
    await page.getByRole("button", { name: "Open document actions" }).click();
    await page.getByRole("dialog", { name: "This document" }).getByRole("button", { name: "Search document" }).click();
    await expect(composer).toBeVisible();
    // Opening search moves focus into the input two animation frames later. Wait for that
    // before blurring: headless WebKit runs frames only when something asks for one, so
    // blurring early let the deferred focus land mid-scroll and pin the composer open.
    await expect(composer.locator("input")).toBeFocused();
    await composer.locator("input").evaluate((element) => element.blur());
    // The chunk deep link intentionally scrolls the highlighted passage into
    // view, which can initially hide the phone composer. Returning to the top
    // must restore it before the explicit hide-on-scroll checks below.
    await scrollPrimarySurface(page, 0);
    await expect(composer).not.toHaveAttribute("data-scroll-hidden", "true");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-bottom", "112px");
    });
    const viewerContent = page.getByTestId("document-viewer-content");
    const main = page.locator("#main-content");
    // DocumentViewer owns the floating dock. The shell must keep only a tiny
    // pad even when Safari's toolbar inset is large — otherwise #932's
    // max(2rem, --safe-area-bottom) shell reserve recreates the blank band
    // under the viewer while the viewer itself collapses correctly.
    await expect.poll(async () => readMobileComposerReservePx(main)).toBeLessThanOrEqual(13);
    await expect
      .poll(async () =>
        viewerContent.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).paddingBottom)),
      )
      .toBeGreaterThan(250);

    await appendPrimaryScrollSpacer(page, { heightPx: 2000, testId: "composer-hide-scroll-spacer" });
    await expect.poll(async () => (await readPrimaryScrollGeometry(page)).owner).toBe("document");

    // Hide on deliberate scroll down past the activation offset. The chunk
    // deep-link effect can finish late in Chromium and move the scrollport once
    // more, so treat reset + deliberate movement as one retriable action.
    await expect(async () => {
      await scrollPrimarySurface(page, 0);
      await expect(composer).not.toHaveAttribute("data-scroll-hidden", "true", { timeout: 1_000 });
      for (const offset of [40, 80, 120, 160, 200]) {
        await scrollPrimarySurface(page, offset);
      }
      await expect(composer).toHaveAttribute("data-scroll-hidden", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect
      .poll(async () =>
        viewerContent.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).paddingBottom)),
      )
      .toBeLessThanOrEqual(13);
    await expect.poll(async () => readMobileComposerReservePx(main)).toBeLessThanOrEqual(13);

    // Reappear on scroll up.
    await scrollPrimarySurface(page, 60);
    await expect(composer).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect
      .poll(async () =>
        viewerContent.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).paddingBottom)),
      )
      .toBeGreaterThan(250);
    await expect.poll(async () => readMobileComposerReservePx(main)).toBeLessThanOrEqual(13);

    // Keyboard focus inside the composer reveals it while hidden.
    await scrollPrimarySurface(page, 240);
    await expect(composer).toHaveAttribute("data-scroll-hidden", "true");
    await composer.locator("input").focus();
    await expect(composer).not.toHaveAttribute("data-scroll-hidden", "true");
    await expect
      .poll(async () =>
        viewerContent.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).paddingBottom)),
      )
      .toBeGreaterThan(250);
    await expect.poll(async () => readMobileComposerReservePx(main)).toBeLessThanOrEqual(13);

    await scrollPrimarySurface(page, 0);
    await composer.getByRole("button", { name: "Close document search" }).click();
    await expect(composer).toHaveCount(0);
    await expect(viewerContent).toHaveAttribute("data-phone-footer-owner", "none");
    await expect
      .poll(async () =>
        viewerContent.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).paddingBottom)),
      )
      .toBeLessThanOrEqual(13);
  });

  test("document search stays separate from the shared answer stream and summary action", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    const answerRequests: Array<{ query: string; documentId?: string; summaryMode?: boolean }> = [];
    let legacySummaryRequestCount = 0;
    page.on("request", (request) => {
      if (isNextPrefetchRequest(request)) return;
      if (/\/api\/documents\/[^/]+\/summarize$/.test(new URL(request.url()).pathname)) {
        legacySummaryRequestCount += 1;
      }
    });
    await mockDemoApi(page, {
      onAnswerRequest: (query, scope) =>
        answerRequests.push({ query, documentId: scope.documentId, summaryMode: scope.summaryMode }),
      answerOverride: (query, documentId, documentIds) => ({
        ...demoAnswer(query, documentId, documentIds),
        answer:
          "Key practical points: **clozapine** monitoring requires regular FBC/ANC checks and review of constipation, myocarditis symptoms, metabolic risk, and missed-dose restart rules.",
      }),
    });
    await gotoApp(
      page,
      "/documents/11111111-1111-4111-8111-111111111111?page=1&chunk=44444444-4444-4444-8444-444444444442",
    );

    const composer = page.locator("form.document-viewer-composer");
    await clickWhenHydrated(page.getByRole("button", { name: "Open document actions" }));
    await page.getByRole("dialog", { name: "This document" }).getByRole("button", { name: "Search document" }).click();
    const documentSearchInput = composer.getByRole("textbox", { name: "Search within this document" });
    // Opening focuses the input two animation frames later. Wait for that
    // focus, or it can land after the submit button is focused below and take
    // focus back from it (seen on the iPhone app-mode project).
    await expect(documentSearchInput).toBeFocused();
    await documentSearchInput.fill("safety plan include");
    await activateFocusedControl(page, composer.getByRole("button", { name: "Search within this document" }));
    await expect(page.getByTestId("source-chunk-indexed-text-panel").getByText("Hit 1 of 2").first()).toBeVisible();
    expect(answerRequests).toEqual([]);

    const openDocumentActions = page.getByRole("button", { name: "Open document actions" });
    await composer.getByRole("button", { name: "Close document search" }).click();
    await expect(composer).toHaveCount(0);
    await expect(openDocumentActions).toBeFocused();
    await openDocumentActions.click();
    const documentActions = page.getByRole("dialog", { name: "This document" });
    await documentActions.getByRole("button", { name: "Answer from this", exact: true }).click();

    const generatedSummary = page.getByTestId("generated-clinical-summary");
    await expect(generatedSummary).toBeVisible();
    await expect(page.getByTestId("answer-progress")).toHaveAttribute("data-progress-state", "complete");
    // The completed wait prints no visible chrome: the summary card arriving is
    // the completion signal, and an elapsed time is a timing boast rather than
    // anything a reader acts on. The announcement survives for screen readers.
    await expect(page.getByText(/Answer ready in/)).toHaveCount(0);
    await expect(page.getByTestId("answer-progress").getByRole("status")).toContainText("Answer ready.");
    await expect(generatedSummary).toContainText("clozapine monitoring requires regular FBC/ANC checks");
    await expect(generatedSummary).not.toContainText("Key practical points:");
    await expect(generatedSummary).not.toContainText("**");
    await expect(generatedSummary.locator("strong").filter({ hasText: "clozapine" })).toHaveCount(1);

    // The generated answer deliberately smooth-scrolls into view. Read both
    // boxes in one browser evaluation so viewport motion cannot corrupt their
    // relative order between independent Playwright round trips.
    const answerGeometry = await readPrimaryScrollAndDomGeometry(page, {
      summary: '[data-testid="generated-clinical-summary"]',
      preview: '[data-testid="pdf-preview"]',
    });
    expect(answerGeometry.nodes.summary.count).toBe(1);
    expect(answerGeometry.nodes.preview.count).toBe(1);
    expect(answerGeometry.nodes.summary.rect).not.toBeNull();
    expect(answerGeometry.nodes.preview.rect).not.toBeNull();
    expect(answerGeometry.nodes.summary.rect!.top).toBeLessThan(answerGeometry.nodes.preview.rect!.top);
    expect(answerRequests).toEqual([
      {
        query: documentSummaryQuestion,
        documentId: "11111111-1111-4111-8111-111111111111",
        summaryMode: true,
      },
    ]);
    expect(legacySummaryRequestCount).toBe(0);
    await expectNoPageHorizontalOverflow(page);
  });

  test("document viewer failed preview exposes retry recovery @critical", async ({ page }) => {
    await page.route("**/api/setup-status**", async (route) => {
      await route.fulfill({ json: { demoMode: true, checks: readySetupChecks } });
    });
    await page.route(/\/api\/documents\/([^/]+)(?:\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      const id = url.pathname.split("/").at(-1) ?? "";
      const payload = getDemoDocumentPayload(id, url.searchParams.get("chunk"));
      await route.fulfill({ json: { ...payload, demoMode: true } });
    });
    await page.route(/\/api\/documents\/[^/]+\/signed-url(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 503,
        json: { error: "Source preview could not be loaded." },
      });
    });
    await page.setViewportSize({ width: 390, height: 820 });
    await gotoApp(
      page,
      "/documents/11111111-1111-4111-8111-111111111111?page=1&chunk=44444444-4444-4444-8444-444444444442",
    );

    await expect(page.getByTestId("pdf-preview").getByText("Source preview could not be loaded.")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByRole("button", { name: "Retry preview" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Synthetic lithium monitoring protocol" })).toBeVisible();
    await expectDomIntegrity(page);
    await expectNoPageHorizontalOverflow(page);
  });

  test("document viewer missing source state is coherent", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockPrivateUnauthenticatedApi(page);
    await page.route(/\/api\/documents\/[^/]+\/signed-url(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 404,
        json: { error: "Document not found." },
      });
    });
    await gotoApp(
      page,
      "/documents/99999999-9999-4999-8999-999999999999?page=1&chunk=99999999-9999-4999-8999-999999999998",
    );

    // Missing/unowned documents now resolve through the segment not-found boundary
    // (page.tsx calls notFound() on PublicApiError 404) instead of DocumentViewer.
    await expect(page.getByRole("heading", { level: 1, name: "Document Not Found" })).toBeVisible({
      timeout: 30000,
    });
    const recovery = page.locator("[data-route-recovery]");
    await expect(recovery.getByRole("status")).toContainText(/unavailable|private|missing|removed/i);
    await expect(page.getByRole("link", { name: /Return to document library/i })).toBeVisible();
    await expect(recovery.getByRole("status")).not.toContainText("loading source");
    await expect(recovery.getByRole("status")).not.toContainText("Loading source metadata");
    await expectDomIntegrity(page);
    await expectNoPageHorizontalOverflow(page);
  });

  test("setup status endpoint returns non-secret checklist state", async ({ request }) => {
    const response = await request.get("/api/setup-status");
    expect(response.ok()).toBe(true);

    const payload = await response.json();
    expect(typeof payload.demoMode).toBe("boolean");
    expect(payload.checks).toHaveLength(7);
    expect(payload.checks.map((check: { id: string }) => check.id)).toEqual([
      "env",
      "project",
      "schema",
      "search",
      "openai",
      "worker",
      // Added by #2590 and missed here, so this assertion was red on `main` from that merge until
      // #2593 corrected it. Reached the same fix independently here; the conflict was comment-only.
      // The list is a deliberate enumeration rather than a count, so it must name the check.
      "answerPreview",
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/sk-|service_role|eyJ/i);
    // The whole point of this endpoint's coarsening. `answerPreview` is the one check whose detail
    // now survives for an anonymous caller, so pin that its content stays a decision word: no
    // query, document title, owner, or clinical text may ever appear here.
    const answerPreview = payload.checks.find((check: { id: string }) => check.id === "answerPreview");
    expect(answerPreview.detail).toMatch(/^(On\.|Switched off,)/);
  });

  test("production site does not offer document uploads to unauthenticated users", async ({ page, request }) => {
    await page.setViewportSize({ width: 414, height: 820 });
    await mockPrivateUnauthenticatedApi(page);
    const setupStatusResponse = await request.get("/api/setup-status");
    expect(setupStatusResponse.ok()).toBe(true);
    expect((await setupStatusResponse.json()).demoMode).toBe(true);

    await gotoApp(page, "/");
    await expect(visibleQuestionInput(page)).toBeVisible();

    await expectDocumentUploadUnavailable(page);
    await expectNoPageHorizontalOverflow(page);
  });

  test("demo site does not offer document uploads", async ({ page }) => {
    await page.setViewportSize({ width: 414, height: 820 });
    await mockDemoApi(page);
    await gotoApp(page, "/");

    await expectDocumentUploadUnavailable(page);
    await expectNoPageHorizontalOverflow(page);
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 820 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 900 },
  ]) {
    test(`guide opens and dismisses at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockPrivateUnauthenticatedApi(page);
      await gotoApp(page, "/");

      const dialog = await openGuide(page);
      await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Shift+Tab");
      await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Tab");
      await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await dialog.getByRole("button", { name: "Close guide" }).click();
      await expect(dialog).toBeHidden();
      const restoredSettings = accountSettingsDialog(page);
      await expect(restoredSettings).toBeVisible();
      await expect(restoredSettings.getByRole("button", { name: "Guide & help", exact: true })).toBeFocused();

      const reopenedDialog = await openGuide(page);
      if (viewport.width >= 1024) {
        await tapOutsideActiveSurface(page);
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(reopenedDialog).toBeHidden();
      await expectNoPageHorizontalOverflow(page);
    });
  }

  test("guide centre topic navigation and tour progress remain accessible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await mockPrivateUnauthenticatedApi(page);
    await gotoApp(page, "/");

    const dialog = await openGuide(page);
    const guideScrollBody = dialog.locator(".polished-scroll");
    const mobileFooter = dialog.locator("[data-guide-mobile-footer]");
    const mobileHeader = dialog.locator('[data-sheet-header="true"]');
    // Opening mounts the dock's scroll-hide reporter, which clears any hidden state on its
    // first animation frame. WebKit on CI ran that frame after the scroll below, so the dock
    // was hidden, then reset to visible before the focus probe. Let the opening frames run.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await guideScrollBody.evaluate((element) => {
      element.scrollTop = 140;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(mobileFooter).toHaveAttribute("aria-hidden", "true");
    await expect(mobileFooter).toHaveAttribute("inert", "");
    // Only the dock hides. The pinned header compacts, while "Close guide" and
    // the view tabs stay reachable however far the reader has scrolled.
    await expect(mobileHeader).toHaveClass(/guide-centre-header--compact/);
    await expect(mobileHeader).toHaveAttribute("aria-hidden", "false");
    await expect(mobileHeader).not.toHaveAttribute("inert");
    await expect(dialog.getByRole("button", { name: "Close guide" })).toBeVisible();

    /**
     * The invariant is that a HIDDEN dock is not keyboard-reachable, and the way
     * to test it is to try to focus it directly. The old tab sweep could not:
     * tabbing scrolls the container, and a scroll back up legitimately reveals
     * the dock. Measured 2026-08-19 at 390x820, the very first Tab already put
     * `scrollTop` at 0 and `aria-hidden` at "false", so the sweep asserted
     * against a dock that was correctly visible and focusable every time — it
     * failed CI while testing nothing. (It is also why pinning `tabIndex={-1}`
     * on the dock buttons could not fix it.)
     */
    const dockWhileHidden = await mobileFooter.evaluate((element) => {
      const button = element.querySelector("button");
      const before = document.activeElement;
      button?.focus({ preventScroll: true });
      return {
        hidden: element.getAttribute("aria-hidden") === "true",
        inert: element.hasAttribute("inert"),
        focusMovedIntoDock: element.contains(document.activeElement),
        focusMovedAtAll: document.activeElement !== before,
      };
    });
    // Guard the guard: a dock that was not hidden would make the rest vacuous.
    expect(dockWhileHidden.hidden).toBe(true);
    expect(dockWhileHidden.inert).toBe(true);
    expect(dockWhileHidden.focusMovedIntoDock).toBe(false);
    expect(dockWhileHidden.focusMovedAtAll).toBe(false);

    await guideScrollBody.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(mobileFooter).toHaveAttribute("aria-hidden", "false");
    await expect(mobileFooter).not.toHaveAttribute("inert");
    await expect(mobileHeader).not.toHaveClass(/guide-centre-header--compact/);
    // The dock carries the guided tour and nothing else — no composer, no input.
    await expect(dialog.locator("[data-guide-universal-search]")).toHaveCount(0);
    await expect(dialog.locator("input")).toHaveCount(0);

    await dialog.getByRole("button", { name: "All topics" }).click();
    await dialog.getByRole("button", { name: /Privacy & safe use/ }).click();
    await expect(dialog.getByRole("heading", { name: "Privacy and safe use" })).toBeFocused();

    await dialog.getByRole("button", { name: "Guide home" }).click();
    await dialog.getByRole("button", { name: "Start guided tour" }).click();
    await expect(dialog.getByRole("heading", { level: 2, name: "The evidence-first workflow" })).toBeFocused();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { level: 2, name: "Ask for one decision at a time" })).toBeFocused();
    // The tour advances the heading before WebKit finishes updating the
    // Previous button's disabled state and forced-colors foreground.
    await expect(dialog.getByRole("button", { name: "Previous" })).toBeEnabled();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    const axeResults = await new AxeBuilder({ page })
      .include('[data-testid="clinical-kb-guide-centre"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      axeResults.violations
        .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
        .map((violation) => violation.id),
    ).toEqual([]);

    await dialog.getByRole("button", { name: "Close guide" }).click();
    await expect(dialog).toBeHidden();
    const reopenedDialog = await openGuide(page);
    await reopenedDialog.getByRole("button", { name: "Resume guided tour" }).click();
    await expect(
      reopenedDialog.getByRole("heading", { level: 2, name: "Ask for one decision at a time" }),
    ).toBeFocused();
    await expectNoPageHorizontalOverflow(page);
  });

  test("guide centre phone dock paints through the bottom safe area", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await mockPrivateUnauthenticatedApi(page);
    await gotoApp(page, "/");

    const dialog = await openGuide(page);
    const band = dialog.locator(".guide-tour-dock");
    await expect(band).toBeVisible();
    // Seed the inset on :root and wait until content padding includes it. An
    // inline style on the dialog node is lost when React re-renders the Sheet,
    // which made contentPaddingBottom flake at 80px (5rem + 0) instead of 114px
    // (5rem + 34px). Re-seed inside the poll so a late Sheet render cannot
    // measure the unseeded token.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => {
            document.documentElement.style.setProperty("--safe-area-bottom", "34px");
          });
          return band.evaluate((element) => {
            const contentElement = element.closest('[role="dialog"]')?.querySelector("[data-guide-content]");
            return contentElement ? Number.parseFloat(window.getComputedStyle(contentElement).paddingBottom) : 0;
          });
        },
        { message: "guide content padding must include the seeded 34px safe-area inset (5rem + 34px)" },
      )
      .toBeGreaterThanOrEqual(114);

    const painted = await band.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const scrim = element.querySelector(".answer-footer-search-backdrop");
      const scrimStyle = scrim ? window.getComputedStyle(scrim) : null;
      const action = element.querySelector<HTMLElement>("[data-guide-tour-action-row] button");
      const actionRect = action?.getBoundingClientRect();
      const contentElement = element.closest('[role="dialog"]')?.querySelector("[data-guide-content]");
      return {
        background: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        paddingBottom: Number.parseFloat(style.paddingBottom),
        left: Math.round(rect.left),
        right: Math.round(window.innerWidth - rect.right),
        bottom: Math.round(window.innerHeight - rect.bottom),
        scrimDisplay: scrimStyle?.display ?? null,
        scrimHeight: scrimStyle ? Math.round(Number.parseFloat(scrimStyle.height)) : 0,
        scrimBackground: scrimStyle?.backgroundImage ?? "",
        scrimMask: scrimStyle?.maskImage || scrimStyle?.getPropertyValue("-webkit-mask-image") || "",
        actionBottomClearance: actionRect ? Math.round(window.innerHeight - actionRect.bottom) : 0,
        contentPaddingBottom: contentElement
          ? Number.parseFloat(window.getComputedStyle(contentElement).paddingBottom)
          : 0,
      };
    });

    // The wrapper remains a flush, transparent dock; its child scrim owns paint.
    expect(painted.background).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(painted.borderTopWidth).toBe("0px");
    expect(painted.boxShadow === "none" || /rgba\(0, 0, 0, 0\)/.test(painted.boxShadow)).toBe(true);
    expect(painted.left).toBe(0);
    expect(painted.right).toBe(0);
    expect(painted.bottom).toBe(0);

    // At a seeded 34px inset, the guide-specific 130px scrim remains compact
    // while its opaque terminal mask keeps the Home Indicator region painted.
    expect(painted.scrimDisplay).toBe("block");
    expect(painted.scrimHeight).toBeGreaterThanOrEqual(130);
    expect(painted.scrimHeight).toBeLessThan(160);
    expect(painted.scrimBackground).not.toBe("none");
    expect(painted.scrimMask).toMatch(/100%/);
    expect(painted.scrimMask).not.toMatch(/transparent 100%/);
    expect(painted.paddingBottom).toBeGreaterThanOrEqual(44);
    expect(painted.actionBottomClearance).toBeGreaterThanOrEqual(44);
    expect(painted.contentPaddingBottom).toBeGreaterThanOrEqual(114);

    const action = band.locator("[data-guide-tour-action-row] button");
    await expect(action).toHaveCount(1);
    const pill = await action.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--command)";
      element.parentElement?.append(probe);
      const commandFill = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        background: style.backgroundColor,
        commandFill,
        borderRadius: Number.parseFloat(style.borderTopLeftRadius),
        minHeight: Number.parseFloat(style.minHeight),
      };
    });
    expect(pill.borderRadius).toBeGreaterThan(100);
    expect(pill.minHeight).toBeGreaterThanOrEqual(48);
    expect(pill.background).toBe(pill.commandFill);
  });
});
