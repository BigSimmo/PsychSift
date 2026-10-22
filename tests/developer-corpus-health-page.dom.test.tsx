import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeveloperCorpusHealthPage from "@/app/(admin)/admin/developer-hub/corpus-health/page";
import type { CorpusHealth } from "@/lib/developer-area/corpus-health";

// PanelPageShell's back control is a ContextualBackLink, which calls
// next/navigation's useRouter for its history-aware click handler. Outside an
// app-router tree that throws, so every render here needs the router mocked.
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/developer-hub/corpus-health",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * Only the database read is mocked. `resolveQualitySpread` stays the real one,
 * so the reading this panel most needs to get right — every document carrying
 * the same placeholder score — is exercised here end to end rather than
 * restated by a second fixture that could drift from the derivation.
 *
 * The database read itself is owned by `tests/developer-corpus-health.test.ts`:
 * owner scoping, and that an unreadable count reports as null rather than zero.
 */
const health = vi.hoisted(() => ({ value: null as CorpusHealth | null }));

vi.mock("@/lib/developer-area/corpus-health", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/developer-area/corpus-health")>()),
  resolveCorpusHealth: async () => health.value,
}));

function reading(overrides: Partial<CorpusHealth> = {}): CorpusHealth {
  return {
    read: true,
    statuses: { queued: 0, processing: 0, indexed: 40, failed: 0 },
    unsearchable: { count: 0, sample: [] },
    failures: { count: 0, sample: [] },
    quality: {
      extraction: { good: 20, partial: 8, poor: 5, unknown: 4 },
      scored: 37,
      lowest: [],
      lowestScore: 0.1,
      highestScore: 0.9,
      ...(overrides.quality ?? {}),
    },
    ...overrides,
  };
}

afterEach(() => {
  health.value = null;
});

describe("developer corpus health page", () => {
  it("renders inside the shared shell and stamps its own library as the source", async () => {
    health.value = reading();
    render(await DeveloperCorpusHealthPage());

    expect(screen.getByTestId("developer-corpus-health")).toBeInTheDocument();
    expect(screen.getByTestId("developer-corpus-health-back")).toHaveAttribute("href", "/admin/developer-hub");
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Your library/);
  });

  it("shows the four document states as counts", async () => {
    health.value = reading({ statuses: { queued: 2, processing: 1, indexed: 40, failed: 3 } });
    render(await DeveloperCorpusHealthPage());

    expect(screen.getByTestId("developer-corpus-health-count-indexed-value")).toHaveTextContent("40");
    expect(screen.getByTestId("developer-corpus-health-count-failed-value")).toHaveTextContent("3");
    expect(screen.getByTestId("developer-corpus-health-count-processing-value")).toHaveTextContent("1");
    expect(screen.getByTestId("developer-corpus-health-count-queued-value")).toHaveTextContent("2");
  });

  /**
   * The mistake this whole panel is built to avoid. On every count here `0` is
   * the reassuring answer, so a count that was never read must never be able to
   * render as one.
   */
  it("renders a count it could not read as words, never as zero", async () => {
    health.value = reading({
      statuses: { queued: null, processing: null, indexed: null, failed: null },
      // The module derives the failed count and the failed list from one read,
      // so an unreadable pair is the only shape it can produce.
      failures: { count: null, sample: [] },
    });
    const { container } = render(await DeveloperCorpusHealthPage());

    const indexed = screen.getByTestId("developer-corpus-health-count-indexed-value");
    expect(indexed).toHaveTextContent("Not read");
    expect(indexed).not.toHaveTextContent("0");
    expect(container.querySelector("#developer-corpus-health-failures-heading")).toHaveTextContent("Failed · not read");
  });

  it("says an unread page is an absence of information rather than a healthy library", async () => {
    health.value = reading({
      read: false,
      statuses: { queued: null, processing: null, indexed: null, failed: null },
    });
    render(await DeveloperCorpusHealthPage());

    const notice = screen.getByTestId("developer-corpus-health-unread");
    expect(notice).toHaveTextContent(/Nothing was read/);
    expect(notice).toHaveTextContent(/never as a healthy library/);
  });

  it("lists the documents that finished and produced no text chunk", async () => {
    health.value = reading({
      unsearchable: {
        count: 1,
        sample: [{ id: "doc-a", title: "Empty guideline", pageCount: 12, imageCount: 3 }],
      },
    });
    const { container } = render(await DeveloperCorpusHealthPage());

    const entry = screen.getByTestId("developer-corpus-health-unsearchable-doc-a");
    expect(entry).toHaveTextContent("Empty guideline");
    expect(entry).toHaveTextContent("12 pages");
    expect(entry).toHaveTextContent("3 images");
    expect(entry).toHaveTextContent("no text chunks");
    expect(container.querySelector("#developer-corpus-health-unsearchable-heading")).toHaveTextContent(
      "Finished but unsearchable · 1",
    );
  });

  it("says a truncated list is truncated, and against the true total", async () => {
    health.value = reading({
      unsearchable: {
        count: 137,
        sample: [{ id: "doc-a", title: "Empty guideline", pageCount: 1, imageCount: 0 }],
      },
    });
    const { container } = render(await DeveloperCorpusHealthPage());

    expect(container.textContent).toMatch(/Showing the 20 most recently updated of 137/);
  });

  it("shows the recorded reason for a failure, and names its absence when there is none", async () => {
    health.value = reading({
      failures: {
        count: 2,
        sample: [
          { id: "doc-b", title: "Broken scan", errorMessage: "OCR timed out" },
          { id: "doc-c", title: "Silent failure", errorMessage: null },
        ],
      },
    });
    render(await DeveloperCorpusHealthPage());

    expect(screen.getByTestId("developer-corpus-health-failure-doc-b")).toHaveTextContent("OCR timed out");
    expect(screen.getByTestId("developer-corpus-health-failure-doc-c")).toHaveTextContent("No reason was recorded.");
  });

  /**
   * Both empty states are the reassuring-looking readings, which is exactly why
   * each has to say in words what it does not prove.
   */
  it("says what an empty result does not prove", async () => {
    health.value = reading();
    render(await DeveloperCorpusHealthPage());

    expect(screen.getByTestId("developer-corpus-health-unsearchable-empty")).toHaveTextContent(
      /absence of the worst failure rather than proof of a good index/,
    );
    expect(screen.getByTestId("developer-corpus-health-failures-empty")).toHaveTextContent(
      /current state, not a history/,
    );
  });

  it("states the limits of its own coverage above the evidence, not as a footnote", async () => {
    health.value = reading({
      failures: { count: 1, sample: [{ id: "doc-b", title: "Broken scan", errorMessage: "OCR timed out" }] },
    });
    const { container } = render(await DeveloperCorpusHealthPage());
    const text = container.textContent ?? "";

    expect(text).toMatch(/Nothing here reads answer quality/);
    // The caveat has to precede the evidence it qualifies; a reader who stops
    // at the first section must already have read it.
    expect(text.indexOf("Nothing here reads answer quality")).toBeLessThan(text.indexOf("Broken scan"));
  });

  /**
   * The finding this panel must not swallow. A quality column that defaults to
   * `0` and a scorer that never ran produce a perfectly tidy distribution, so a
   * page that renders one as a measurement is worse than a page with no quality
   * section at all.
   */
  it("says outright when every scored document carries the identical score", async () => {
    health.value = reading({
      quality: {
        extraction: { good: 0, partial: 0, poor: 0, unknown: 2851 },
        scored: 2851,
        lowest: [],
        lowestScore: 0,
        highestScore: 0,
      },
    });
    render(await DeveloperCorpusHealthPage());

    const note = screen.getByTestId("developer-corpus-health-quality-spread");
    expect(note).toHaveTextContent("All 2851 scored documents carry the identical score 0.00");
    expect(note).toHaveTextContent(/not usable as a measure/);
    // Raised in review of PR #2539. `assessDocumentIndexQuality` starts the
    // score at 1 and only subtracts penalties, then rounds to three decimals,
    // so a corpus that extracted cleanly can legitimately score the same value
    // for every document. Naming the tie as proof of a broken scorer would be
    // the same overclaiming this panel exists to avoid.
    expect(note).toHaveTextContent(/not by itself evidence that scoring is broken/);
    expect(note).toHaveTextContent(/starts at 1.00 and only subtracts penalties/);
    // Zero is also the column's default, so this reading cannot be told apart
    // from a corpus nothing ever scored — and the page must say so.
    expect(note).toHaveTextContent(/what a corpus that was never scored looks like/);
  });

  it("reports both ends of a genuine score range", async () => {
    health.value = reading();
    render(await DeveloperCorpusHealthPage());

    expect(screen.getByTestId("developer-corpus-health-quality-spread")).toHaveTextContent(
      "Scores run from 0.10 to 0.90 across 37 scored documents.",
    );
  });

  it("says the quality scores are unread rather than describing them", async () => {
    health.value = reading({
      quality: {
        extraction: { good: null, partial: null, poor: null, unknown: null },
        scored: null,
        lowest: [],
        lowestScore: null,
        highestScore: null,
      },
    });
    render(await DeveloperCorpusHealthPage());

    expect(screen.getByTestId("developer-corpus-health-quality-spread")).toHaveTextContent(
      /could not be read, so nothing on this page describes them/,
    );
  });

  it("lists the lowest scoring documents with the issues each recorded", async () => {
    health.value = reading({
      quality: {
        extraction: { good: 20, partial: 8, poor: 5, unknown: 4 },
        scored: 37,
        lowest: [
          { documentId: "doc-a", score: 0.1, extractionQuality: "poor", issues: ["no_text", "ocr_failed"] },
          { documentId: "doc-d", score: 0.4, extractionQuality: "partial", issues: [] },
        ],
        lowestScore: 0.1,
        highestScore: 0.9,
      },
    });
    render(await DeveloperCorpusHealthPage());

    expect(screen.getByTestId("developer-corpus-health-low-doc-a")).toHaveTextContent("no_text, ocr_failed");
    expect(screen.getByTestId("developer-corpus-health-low-doc-d")).toHaveTextContent("No issues recorded.");
  });

  /**
   * Both caveats are structural facts about the schema, not decoration: the
   * score column defaults to 0 and the quality table's owner column is nullable
   * while its read policy matches on it, so a lower total here than the indexed
   * count has an honest explanation that is not breakage.
   */
  it("explains why the quality total can sit below the indexed count", async () => {
    health.value = reading();
    const { container } = render(await DeveloperCorpusHealthPage());
    const text = container.textContent ?? "";

    expect(text).toMatch(/may never have been scored at all rather than having scored badly/);
    expect(text).toMatch(/a row written without an owner is invisible here/);
  });
});
