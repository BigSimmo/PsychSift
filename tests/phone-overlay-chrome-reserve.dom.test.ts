/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  phoneOverlayReserveGeometryQuietWindowMs,
  __setPhoneOverlayReserveSettledForTests,
  publishPhoneOverlayChromeReserveNow,
  readPhoneOverlayChromeReservePx,
  usePhoneOverlayChromeReserve,
} from "@/components/clinical-dashboard/use-phone-overlay-chrome-reserve";

function stubHeight(element: Element, height: number | (() => number)) {
  const read = () => (typeof height === "function" ? height() : height);
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    get: () => Math.round(read()),
  });
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
    const measured = read();
    return {
      x: 0,
      y: 0,
      top: 0,
      bottom: measured,
      left: 0,
      right: 0,
      width: 0,
      height: measured,
      toJSON: () => ({}),
    };
  });
}

describe("readPhoneOverlayChromeReservePx", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--phone-overlay-chrome-h");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls through a zero-height stack to the collapse row", () => {
    // A present `.phone-sticky-header-stack` with offsetHeight 0 (display:contents
    // / mid-unmount) must not win via `??` and publish 0px over the CSS seed —
    // that is the Services result-anchor jump under CI load (#146 / PR #1562).
    document.body.innerHTML = `
      <div class="phone-sticky-header-stack">
        <div data-testid="universal-header-collapse"></div>
      </div>
    `;
    const stack = document.querySelector(".phone-sticky-header-stack");
    const collapse = document.querySelector('[data-testid="universal-header-collapse"]');
    expect(stack).toBeTruthy();
    expect(collapse).toBeTruthy();
    stubHeight(stack!, 0);
    stubHeight(collapse!, 72);
    expect(readPhoneOverlayChromeReservePx()).toBe(72);
  });

  it("returns 0 when neither stack nor collapse is measurable so the publisher can keep the seed", () => {
    document.body.innerHTML = `
      <div class="phone-sticky-header-stack">
        <div data-testid="universal-header-collapse"></div>
      </div>
    `;
    const stack = document.querySelector(".phone-sticky-header-stack");
    const collapse = document.querySelector('[data-testid="universal-header-collapse"]');
    stubHeight(stack!, 0);
    stubHeight(collapse!, 0);
    expect(readPhoneOverlayChromeReservePx()).toBe(0);
  });

  it.each([131, 151.875])("preserves the measurable stack height of %s CSS pixels", (height) => {
    document.body.innerHTML = `
      <div class="phone-sticky-header-stack">
        <div data-testid="universal-header-collapse"></div>
      </div>
    `;
    const stack = document.querySelector(".phone-sticky-header-stack");
    const collapse = document.querySelector('[data-testid="universal-header-collapse"]');
    stubHeight(stack!, height);
    stubHeight(collapse!, 72);
    expect(readPhoneOverlayChromeReservePx()).toBe(height);
  });

  it("publishes only a frame-confirmed observer height and preserves later geometry changes", () => {
    let stackHeight = 200;
    let collapseHeight = 72;
    let notifyResize: ResizeObserverCallback | null = null;
    let notifyMediaChange: EventListener | null = null;
    let mediaMatches = true;
    let nextFrameId = 1;
    const pendingFrames = new Map<number, FrameRequestCallback>();

    document.body.innerHTML = `
      <div class="phone-sticky-header-stack">
        <div data-testid="universal-header-collapse"></div>
      </div>
    `;
    const stack = document.querySelector(".phone-sticky-header-stack");
    const collapse = document.querySelector('[data-testid="universal-header-collapse"]');
    expect(stack).toBeTruthy();
    expect(collapse).toBeTruthy();
    stubHeight(stack!, () => stackHeight);
    stubHeight(collapse!, () => collapseHeight);

    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return mediaMatches;
      },
      addEventListener: (_type: string, listener: EventListener) => {
        notifyMediaChange = listener;
      },
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = callback;
        }

        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      pendingFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) => {
      pendingFrames.delete(frameId);
    });

    const deliverResize = () => {
      expect(notifyResize).toBeTypeOf("function");
      notifyResize!([], {} as ResizeObserver);
    };
    const currentFrameCallback = () => {
      expect(pendingFrames.size).toBe(1);
      return pendingFrames.entries().next().value! as [number, FrameRequestCallback];
    };
    const flushFrame = (timestamp: number) => {
      const [frameId, callback] = currentFrameCallback();
      pendingFrames.delete(frameId);
      callback(timestamp);
    };

    const { unmount } = renderHook(() => usePhoneOverlayChromeReserve());

    // The synchronous layout read sees a transient expanded stack. Publishing
    // it would create the recorded CSS seed -> 200px -> 72px CLS round trip.
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
    expect(phoneOverlayReserveGeometryQuietWindowMs).toBeGreaterThan(60);

    act(deliverResize);
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
    act(() => flushFrame(0));
    act(() => flushFrame(16));
    act(() => flushFrame(59));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");

    const [, stale200Frame] = currentFrameCallback();
    stackHeight = 72;
    act(deliverResize);
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
    // A callback captured before the 72px observer delivery cannot publish its
    // superseded 200px candidate even if the platform invokes it after cancel.
    act(() => stale200Frame(60));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
    expect(pendingFrames.size).toBe(1);

    act(() => flushFrame(61));
    act(() => flushFrame(61 + phoneOverlayReserveGeometryQuietWindowMs - 1));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
    act(() => flushFrame(61 + phoneOverlayReserveGeometryQuietWindowMs));

    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("72px");

    // A legitimate later addon/orientation geometry change uses the same
    // confirmation path and is not starved after the initial stabilization.
    stackHeight = 151.875;
    act(deliverResize);
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("72px");
    act(() => flushFrame(200));
    act(() => flushFrame(200 + phoneOverlayReserveGeometryQuietWindowMs - 1));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("72px");
    act(() => flushFrame(200 + phoneOverlayReserveGeometryQuietWindowMs));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("151.875px");

    // A transient zero invalidates a pending positive candidate and keeps the
    // last confirmed value; its stale callback cannot revive that candidate.
    stackHeight = 104;
    act(deliverResize);
    const [, staleBeforeZero] = currentFrameCallback();
    stackHeight = 0;
    collapseHeight = 0;
    act(deliverResize);
    act(() => staleBeforeZero(400));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("151.875px");
    expect(pendingFrames.size).toBe(0);

    // Desktop owns an explicit zero. Returning to phone releases that inline
    // override back to the CSS seed until a new height is confirmed.
    stackHeight = 80;
    collapseHeight = 72;
    act(deliverResize);
    const [, staleBeforeDesktop] = currentFrameCallback();
    mediaMatches = false;
    act(() => notifyMediaChange!(new Event("change")));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("0px");
    act(() => staleBeforeDesktop(500));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("0px");
    act(deliverResize);
    expect(pendingFrames.size).toBe(0);

    mediaMatches = true;
    act(() => notifyMediaChange!(new Event("change")));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
    act(deliverResize);
    act(() => flushFrame(600));
    act(() => flushFrame(600 + phoneOverlayReserveGeometryQuietWindowMs));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("80px");

    // Cleanup cancels an outstanding confirmation and removes the inline value.
    stackHeight = 88;
    act(deliverResize);
    expect(pendingFrames.size).toBe(1);
    const [, staleAfterUnmount] = currentFrameCallback();
    unmount();
    expect(pendingFrames.size).toBe(0);
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
    act(() => staleAfterUnmount(800));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
  });

  it("attaches the ResizeObserver when the phone header stack mounts after the hook", async () => {
    const stackHeight = 72;
    let notifyResize: ResizeObserverCallback | null = null;
    let nextFrameId = 1;
    const pendingFrames = new Map<number, FrameRequestCallback>();
    let observedTargets = 0;

    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = callback;
        }

        observe() {
          observedTargets += 1;
        }
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      pendingFrames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) => {
      pendingFrames.delete(frameId);
    });

    const { unmount } = renderHook(() => usePhoneOverlayChromeReserve());
    expect(observedTargets).toBe(0);
    expect(notifyResize).toBeNull();

    const stack = document.createElement("div");
    stack.className = "phone-sticky-header-stack";
    const collapse = document.createElement("div");
    collapse.dataset.testid = "universal-header-collapse";
    stack.append(collapse);
    stubHeight(stack, () => stackHeight);
    stubHeight(collapse, () => stackHeight);

    act(() => {
      document.body.append(stack);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(observedTargets).toBeGreaterThan(0);
    expect(notifyResize).toBeTypeOf("function");
    act(() => notifyResize!([], {} as ResizeObserver));
    const flushFrame = (timestamp: number) => {
      expect(pendingFrames.size).toBe(1);
      const [frameId, callback] = pendingFrames.entries().next().value! as [number, FrameRequestCallback];
      pendingFrames.delete(frameId);
      callback(timestamp);
    };
    act(() => flushFrame(0));
    act(() => flushFrame(phoneOverlayReserveGeometryQuietWindowMs));
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("72px");

    // Having settled through the REAL path, a portal transition may now adjust
    // the reserve immediately. This is the half the test seam cannot prove: if
    // the production code never marked the reserve settled, the publisher would
    // be permanently inert and every seam-driven case would still pass, leaving
    // the #CHPC5C fix silently dead. Overwriting with a sentinel first is what
    // makes the re-publish distinguishable from doing nothing.
    document.documentElement.style.setProperty("--phone-overlay-chrome-h", "999px");
    publishPhoneOverlayChromeReserveNow();
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("72px");

    unmount();
  });
});

/**
 * #CHPC5C — the reserve has to grow in the same commit that takes the addon row
 * out of page flow, not 110ms later.
 *
 * Measured on `/differentials/compare` at 390x844: the page paints with the 49px
 * mode-nav row in flow over the 72px CSS seed; the row portals into the fixed
 * header at ~315ms and every element rises 49px; the reserve only republishes
 * 121px at ~423ms. Under renderer load that window widens, and a tap inside it
 * pressed "Open comparison" and released on "Edit selection" where the link had
 * just been. The browser retargets such a click to the two controls' common
 * ancestor, so the link never activates — no error, no navigation, and the
 * Playwright hit-target check cannot see it because press and release were each
 * individually on a real element.
 *
 * The quiet window still guards what it was built for (a transient wide-stack
 * measurement during hydration, #147); it just no longer gates a discrete portal
 * mount whose geometry is already correct.
 *
 * EVERY CASE BELOW CALLS THE PUBLISHER DIRECTLY, so it proves what the function
 * does once invoked and nothing about who invokes it, or when. Both
 * `useLayoutEffect` blocks that call it could be deleted and this whole block
 * would stay green. The wiring — and the two transitions it does not cover, one
 * of which is the cold load #CHPC5C actually recorded — lives in
 * `tests/phone-overlay-reserve-portal-wiring.dom.test.tsx`.
 */
describe("publishPhoneOverlayChromeReserveNow", () => {
  beforeEach(() => {
    // Every case below states its own precondition; none inherits a settled
    // reserve from an earlier one.
    __setPhoneOverlayReserveSettledForTests(false);
  });

  afterEach(() => {
    __setPhoneOverlayReserveSettledForTests(false);
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--phone-overlay-chrome-h");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mountStack({ stackHeight, matches }: { stackHeight: number; matches: boolean }) {
    document.body.innerHTML = `
      <div class="phone-sticky-header-stack">
        <div data-testid="universal-header-collapse"></div>
      </div>
    `;
    const stack = document.querySelector(".phone-sticky-header-stack");
    const collapse = document.querySelector('[data-testid="universal-header-collapse"]');
    stubHeight(stack!, stackHeight);
    stubHeight(collapse!, stackHeight);
    vi.stubGlobal("matchMedia", () => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  /**
   * Stand in for the quiet window having already committed a value. These cases
   * are about what the publisher does once a settled reserve exists, not about
   * how it came to exist — the last case in this block covers that for real.
   */
  function settleReserve() {
    __setPhoneOverlayReserveSettledForTests(true);
  }

  it.each([121, 151.875])("publishes %s CSS pixels with no frames and no quiet window", (height) => {
    mountStack({ stackHeight: height, matches: true });
    settleReserve();
    publishPhoneOverlayChromeReserveNow();
    // No requestAnimationFrame is stubbed: if this needed a frame to land, the
    // assertion below could not pass at all.
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe(`${height}px`);
  });

  it("is a no-op above the phone breakpoint, where the stack stays in flow", () => {
    mountStack({ stackHeight: 121, matches: false });
    settleReserve();
    publishPhoneOverlayChromeReserveNow();
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
  });

  it("refuses to publish a non-positive measurement over the CSS seed", () => {
    // Same protection as the observer path: a mid-unmount or `display:contents`
    // read of 0 must leave the seed alone rather than collapse the reserve
    // (#146 / PR #1562).
    mountStack({ stackHeight: 0, matches: true });
    settleReserve();
    publishPhoneOverlayChromeReserveNow();
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
  });

  it("stays silent before the quiet window has settled anything, even with a stack to measure", () => {
    // The defect this guard exists for (review, PR #2929): on a cold phone load
    // the portal's layout effect can run while responsive layout still reports
    // the WIDE stack — observed as 200px for 15-60ms (#147). Publishing that over
    // the CSS seed and letting the observer correct it afterwards moves content a
    // second time, which is the tap-target swap this change removes, relocated to
    // first paint. Before settle the hook's own path owns the reserve.
    mountStack({ stackHeight: 200, matches: true });
    publishPhoneOverlayChromeReserveNow();
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
  });

  it("adjusts once settled, so the transient is suppressed without losing the fix", () => {
    mountStack({ stackHeight: 200, matches: true });
    publishPhoneOverlayChromeReserveNow();
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("");
    // The quiet window settles the real phone stack, and only then does a portal
    // transition get to move it.
    settleReserve();
    mountStack({ stackHeight: 121, matches: true });
    publishPhoneOverlayChromeReserveNow();
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("121px");
  });

  it("publishes a shrunk stack too, when something invokes it after the row returns to flow", () => {
    // The mirror of the defect: leaving the larger reserve in place after the
    // portal releases the row holds content 49px too low instead. Note the
    // careful title — the function shrinks correctly, but on a portal UNMOUNT
    // nothing calls it, which the wiring test pins as an open gap.
    mountStack({ stackHeight: 121, matches: true });
    settleReserve();
    publishPhoneOverlayChromeReserveNow();
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("121px");
    mountStack({ stackHeight: 72, matches: true });
    publishPhoneOverlayChromeReserveNow();
    expect(document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h")).toBe("72px");
  });
});
