import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VIEWER_MAX_ZOOM } from "@/components/document-viewer/viewer-zoom";

/**
 * Page virtualization behaviour for the PDF reader, in a real React tree.
 *
 * The budget arithmetic has its own unit tests and the raster has a browser
 * gate; what neither covers is the wiring between them — which slots exist, how
 * many hold a canvas at once, when a disposed page releases its backing store,
 * and whether a scroll-derived page change writes the route exactly once. Those
 * are the parts that would silently regress into "renders every page" or
 * "remounts pdf.js on every flip".
 *
 * jsdom has no 2D canvas, so `getContext` is stubbed to a recording double and
 * pdf.js is mocked entirely. That is enough for the wiring; it is deliberately
 * NOT enough to claim the page paints, which is what
 * `tests/ui-document-canvas.spec.ts` exists for.
 */

const PAGE_COUNT = 8;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const renderCalls: number[] = [];
const cleanupCalls: number[] = [];
let getPageCalls: number[] = [];
let getDocumentOptions: Record<string, unknown> | null = null;
/** Each page's stored /Rotate, for pages that have one. */
let storedPageRotation = new Map<number, number>();
/** Pages whose raster rejects, as an unsupported font or image would. */
let failingRenderPages = new Set<number>();
let viewportRotations: { pageNumber: number; rotation: number | undefined }[] = [];

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  const makePage = (pageNumber: number) => ({
    rotate: storedPageRotation.get(pageNumber) ?? 0,
    getViewport: ({ scale = 1, rotation }: { scale?: number; rotation?: number }) => {
      viewportRotations.push({ pageNumber, rotation });
      return {
        width: PAGE_WIDTH * scale,
        height: PAGE_HEIGHT * scale,
      };
    },
    render: () => {
      renderCalls.push(pageNumber);
      if (failingRenderPages.has(pageNumber)) {
        return { promise: Promise.reject(new Error("synthetic raster failure")), cancel: () => {} };
      }
      return { promise: Promise.resolve(), cancel: () => {} };
    },
    cleanup: () => {
      cleanupCalls.push(pageNumber);
    },
  });

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: (options: Record<string, unknown>) => {
      getDocumentOptions = options;
      return {
        promise: Promise.resolve({
          numPages: PAGE_COUNT,
          getPage: (pageNumber: number) => {
            getPageCalls.push(pageNumber);
            return Promise.resolve(makePage(pageNumber));
          },
        }),
        destroy: () => Promise.resolve(),
      };
    },
  };
});

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  observed: Set<Element>;
};

let observers: ObserverRecord[] = [];
/**
 * Idle callbacks are captured rather than run, so a test can assert what the
 * viewer does BEFORE render-ahead fires. A timer-backed stub would race every
 * `waitFor` and make "only the reader's page" unassertable.
 */
let idleCallbacks: (() => void)[] = [];
let animationFrameCallbacks = new Map<number, FrameRequestCallback>();
let nextAnimationFrame = 1;

async function flushIdle() {
  try {
    await waitFor(() => expect(idleCallbacks.length).toBeGreaterThan(0));
  } catch (cause) {
    // `waitFor` alone reports "expected 0 to be greater than 0", which reads as
    // a slow machine and is usually not one. The viewer schedules render-ahead
    // ONLY when `liveCanvasLimit > 1`, and `resolveLiveCanvasWindow` collapses
    // that to 1 whenever `perCanvasPixels` is 0 — which is exactly what jsdom's
    // zero-width layout measurement yields before `contentWidth` lands. In that
    // case no callback is ever scheduled and no amount of waiting produces one,
    // so say which of the two happened instead of timing out opaquely.
    const slots = screen.queryAllByTestId("pdf-page-slot");
    throw new Error(
      "No render-ahead idle callback was scheduled within the waitFor window. " +
        "The viewer schedules one only while the canvas budget allows more than one live " +
        "canvas; a zero-width measurement collapses that budget to the reader's page alone " +
        "and skips scheduling entirely. Observed at timeout: " +
        `${slots.length} page slot(s), ` +
        `${slots.filter((slot) => slot.getAttribute("data-rendered") === "true").length} rendered, ` +
        `${observers.length} intersection observer(s).`,
      { cause },
    );
  }
  const pending = idleCallbacks;
  idleCallbacks = [];
  await act(async () => {
    for (const callback of pending) callback();
    await Promise.resolve();
  });
}

async function flushAnimationFrames() {
  await act(async () => {
    while (animationFrameCallbacks.size > 0) {
      const pending = [...animationFrameCallbacks.values()];
      animationFrameCallbacks.clear();
      for (const callback of pending) callback(Date.now());
      await Promise.resolve();
    }
  });
}

/** Drive the slot observer as though the reader had scrolled to a page. */
function scrollToPage(pageNumber: number) {
  for (const observer of observers) {
    const entries = [...observer.observed].map((target) => ({
      target,
      intersectionRatio: Number(target.getAttribute("data-page")) === pageNumber ? 1 : 0,
      isIntersecting: Number(target.getAttribute("data-page")) === pageNumber,
    })) as unknown as IntersectionObserverEntry[];
    if (entries.length === 0) continue;
    observer.callback(entries, {} as IntersectionObserver);
  }
}

beforeEach(() => {
  renderCalls.length = 0;
  cleanupCalls.length = 0;
  getPageCalls = [];
  getDocumentOptions = null;
  storedPageRotation = new Map();
  failingRenderPages = new Set();
  viewportRotations = [];
  observers = [];
  idleCallbacks = [];
  animationFrameCallbacks = new Map();
  nextAnimationFrame = 1;

  vi.stubGlobal(
    "IntersectionObserver",
    class {
      readonly observed = new Set<Element>();

      constructor(private readonly callback: IntersectionObserverCallback) {
        observers.push({ callback, observed: this.observed });
      }

      observe(target: Element) {
        this.observed.add(target);
      }

      unobserve(target: Element) {
        this.observed.delete(target);
      }

      disconnect() {
        this.observed.clear();
        observers = observers.filter((record) => record.observed !== this.observed);
      }

      takeRecords() {
        return [];
      }
    },
  );

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  // jsdom throws on getContext; the raster path only needs a recording double.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ setTransform: () => {}, imageSmoothingEnabled: false }) as unknown as CanvasRenderingContext2D,
  );

  // requestIdleCallback drives render-ahead; jsdom does not implement it, and
  // leaving it undefined would silently exercise only the setTimeout fallback.
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });
  vi.stubGlobal("cancelIdleCallback", () => {});
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = nextAnimationFrame;
    nextAnimationFrame += 1;
    animationFrameCallbacks.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    animationFrameCallbacks.delete(handle);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderViewer(props: Record<string, unknown> = {}) {
  const { PdfCanvasViewer } = await import("@/components/document-viewer/pdf-canvas-viewer");
  const onPageChange = vi.fn();
  const viewer = (overrides: Record<string, unknown>) => (
    <PdfCanvasViewer
      url="https://storage.test/source.pdf?token=abc"
      title="Synthetic monitoring protocol"
      initialPage={1}
      fitWidth
      zoom={1}
      onFitWidthChange={vi.fn()}
      onZoomChange={vi.fn()}
      onPageChange={onPageChange}
      {...props}
      {...overrides}
    />
  );

  let rerenderViewer: (ui: React.ReactElement) => void = () => {};
  await act(async () => {
    ({ rerender: rerenderViewer } = render(viewer({})));
  });
  await waitFor(() => expect(screen.getAllByTestId("pdf-page-slot").length).toBe(PAGE_COUNT));
  await flushAnimationFrames();

  /** Re-render as the route would: a changed `initialPage` on the same tree. */
  const navigateRouteTo = async (page: number) => {
    await act(async () => {
      rerenderViewer(viewer({ initialPage: page }));
    });
    await flushAnimationFrames();
  };

  return { onPageChange, navigateRouteTo };
}

/**
 * Give the holder and every slot a real vertical layout.
 *
 * jsdom reports every rect as zero, which makes the viewer's scroll-to-page a
 * no-op — and a no-op scroll deliberately does NOT arm the pending gate, so
 * without this the gate can never be exercised at all.
 */
function stubColumnLayout(slotHeight = 100) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const slotPage = Number(this.getAttribute?.("data-page") ?? Number.NaN);
    const top = Number.isFinite(slotPage) ? (slotPage - 1) * slotHeight : 0;
    return {
      top,
      bottom: top + slotHeight,
      left: 0,
      right: 600,
      width: 600,
      height: slotHeight,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

const renderedPages = () =>
  screen
    .getAllByTestId("pdf-page-slot")
    .filter((slot) => slot.getAttribute("data-rendered") === "true")
    .map((slot) => Number(slot.getAttribute("data-page")));

describe("PDF reader page virtualization", () => {
  it("reserves a slot for every page but rasters only the reader's page on arrival", async () => {
    await renderViewer();

    expect(screen.getAllByTestId("pdf-page-slot")).toHaveLength(PAGE_COUNT);
    // Before idle, render-ahead has not fired: exactly one canvas exists, which
    // is what keeps opening a 300-page guideline from costing 300 rasters.
    expect(renderedPages()).toEqual([1]);
    expect(screen.getByLabelText("Synthetic monitoring protocol page 1")).toBeTruthy();
    expect(screen.queryByLabelText("Synthetic monitoring protocol page 2")).toBeNull();
  });

  it("keeps range-fetching on demand rather than pulling the whole document", async () => {
    await renderViewer();

    // Render-ahead pulls bytes these flags hold back, so it must not have
    // quietly dropped them to make neighbour rendering easier.
    expect(getDocumentOptions).toMatchObject({ disableAutoFetch: true, disableStream: true });
  });

  it("reads exactly one page ahead and one behind, and only once idle", async () => {
    await renderViewer({ initialPage: 4 });
    expect(renderedPages()).toEqual([4]);

    await flushIdle();

    await waitFor(() => expect(renderedPages().sort((a, b) => a - b)).toEqual([3, 4, 5]));
    // Never the whole document, and never a page two away.
    expect(getPageCalls).not.toContain(1);
    expect(getPageCalls).not.toContain(6);
  });

  it("collapses render-ahead to the reader's page alone when one canvas costs the whole budget", async () => {
    // The other half of the curve the test above measures.
    //
    // `resolveCanvasRasterPlan` bounds ONE canvas against WebKit's ~2^24 ceiling
    // and says nothing about how many exist, so the document-wide budget is what
    // stops three individually-legal canvases exhausting device memory. At this
    // page size, zoom and density a single canvas costs ~16.8M backing pixels
    // against a 24M budget, so `resolveLiveCanvasWindow` returns 1 and
    // render-ahead is vetoed by memory rather than by the idle gate — which is
    // why this asserts AFTER `flushIdle()`, not before.
    vi.stubGlobal("devicePixelRatio", 3);

    await renderViewer({ initialPage: 4, fitWidth: false, zoom: VIEWER_MAX_ZOOM });

    // `renderZoom` is a debounced mirror of `zoom`; the raster runs at the
    // default zoom until it settles. Reading before that measures a cheap canvas
    // and proves nothing about the budget.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await flushIdle();

    await waitFor(() => expect(renderedPages()).toEqual([4]));
    expect(getPageCalls).not.toContain(3);
    expect(getPageCalls).not.toContain(5);
  });

  it("releases the backing store of a page that leaves the render window", async () => {
    await renderViewer();
    const canvas = screen.getByLabelText("Synthetic monitoring protocol page 1") as HTMLCanvasElement;
    expect(canvas.tagName).toBe("CANVAS");

    await act(async () => {
      scrollToPage(6);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(renderedPages()).toContain(6));
    expect(renderedPages()).not.toContain(1);
    // pdf.js page resources are released too, not just the canvas element.
    expect(cleanupCalls).toContain(1);
  });

  it("writes the route once when the reader scrolls to a new page, and not at all when they scroll back to it", async () => {
    const { onPageChange } = await renderViewer();

    await act(async () => {
      scrollToPage(3);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(3));
    const callsAfterFirstScroll = onPageChange.mock.calls.length;

    // Re-reporting the same page must not re-enter the route. This is the loop
    // the pending-scroll gate exists to prevent: route -> scroll -> derive ->
    // route, once per animation frame.
    await act(async () => {
      scrollToPage(3);
      scrollToPage(3);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onPageChange.mock.calls.length).toBe(callsAfterFirstScroll);
  });

  it("does not write the route back when the route itself moved the reader", async () => {
    const { onPageChange, navigateRouteTo } = await renderViewer();
    onPageChange.mockClear();

    // A rail filmstrip jump arrives as a changed `initialPage`. The scroll it
    // triggers derives its own page, and echoing that back to the route is the
    // feedback loop that would re-enter this effect on every frame.
    await navigateRouteTo(5);
    await act(async () => {
      scrollToPage(5);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(onPageChange).not.toHaveBeenCalledWith(5);
    expect(renderedPages()).toContain(5);
  });

  it("ignores the pages a route-driven scroll passes over on its way to the target", async () => {
    stubColumnLayout();
    const { onPageChange, navigateRouteTo } = await renderViewer();
    onPageChange.mockClear();

    await navigateRouteTo(7);
    // Mid-flight intersections while the column is still travelling must not be
    // mistaken for the reader choosing those pages.
    await act(async () => {
      scrollToPage(3);
      scrollToPage(5);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onPageChange).not.toHaveBeenCalled();

    // Arriving at the target releases the gate...
    await act(async () => {
      scrollToPage(7);
      await Promise.resolve();
    });
    await waitFor(() => expect(renderedPages()).toContain(7));
    expect(onPageChange).not.toHaveBeenCalled();

    // ...and the reader's own scrolling is heard again immediately afterwards.
    await act(async () => {
      scrollToPage(8);
      await Promise.resolve();
    });
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(8));
  });

  it("reconciles a deep link past the end of the document onto its last page", async () => {
    const { onPageChange } = await renderViewer({ initialPage: 99 });

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(PAGE_COUNT));
    expect(renderedPages()).toContain(PAGE_COUNT);
  });

  it("draws a page at its own stored rotation plus the reader's turn", async () => {
    // pdf.js replaces, not adds to, the page's /Rotate when a rotation is passed,
    // so a landscape table stored as /Rotate 90 drew sideways at the default 0°.
    storedPageRotation.set(1, 90);
    await renderViewer();
    await waitFor(() => expect(renderCalls).toContain(1));
    const pageOne = viewportRotations.filter((call) => call.pageNumber === 1).map((call) => call.rotation);
    expect(pageOne.length).toBeGreaterThan(0);
    expect(new Set(pageOne)).toEqual(new Set([90]));

    cleanup();
    viewportRotations = [];
    await renderViewer({ rotation: 270 });
    await waitFor(() => expect(viewportRotations.some((call) => call.pageNumber === 1)).toBe(true));
    expect(new Set(viewportRotations.filter((call) => call.pageNumber === 1).map((call) => call.rotation))).toEqual(
      new Set([0]),
    );
  });

  it("keeps the column mounted when one page fails to render, with the error in that page's slot", async () => {
    failingRenderPages.add(1);
    await renderViewer();

    const errorCard = await screen.findByTestId("pdf-page-render-error");
    expect(errorCard.textContent).toContain("Could not display page 1 of the PDF.");
    // The rest of the document is still there to scroll to.
    expect(screen.getByTestId("pdf-page-column")).toBeTruthy();
    expect(screen.getAllByTestId("pdf-page-slot")).toHaveLength(PAGE_COUNT);
    expect(errorCard.closest('[data-page="1"]')).toBeTruthy();
    expect(document.querySelector('[data-preview-error="true"]')).toBeNull();

    // Let any layout-driven re-raster settle first, so the count below measures
    // the retry alone. The page keeps failing meanwhile, so the error stays.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.getByTestId("pdf-page-render-error")).toBeTruthy();

    // Retrying re-renders that page, and a success clears its error.
    failingRenderPages.delete(1);
    const callsBefore = renderCalls.filter((page) => page === 1).length;
    await act(async () => {
      screen.getByRole("button", { name: "Retry page" }).click();
    });
    await waitFor(() => expect(renderCalls.filter((page) => page === 1).length).toBeGreaterThan(callsBefore));
    await waitFor(() => expect(screen.queryByTestId("pdf-page-render-error")).toBeNull());
  });
});
