/**
 * Does a portal actually REACH the immediate publisher, and when?
 *
 * `tests/phone-overlay-chrome-reserve.dom.test.ts` calls
 * `publishPhoneOverlayChromeReserveNow()` by hand, so it proves what the
 * function does once invoked and nothing at all about who invokes it. Both
 * `useLayoutEffect` blocks that call it could be deleted outright and every
 * case in that file would still pass. This file closes that hole by mounting
 * the real hook and a real portal together and asserting the reserve after the
 * commit — which is also how the scope limit below was found (adversarial
 * review of PR #2929).
 *
 * THE SCOPE LIMIT, PINNED HERE ON PURPOSE. React runs layout effects
 * children-first. The reserve hook belongs to the shell (`GlobalSearchShell`)
 * and both portals are its descendants, so on a FIRST mount the portal's effect
 * runs before the shell's hook effect has started — long before the hook's 80ms
 * geometry quiet window has settled anything. `publishPhoneOverlayChromeReserveNow`
 * refuses to publish before that settle (it must: on a cold load responsive
 * layout can still be reporting the wide 200px stack, #147). So on a cold load
 * the immediate publish never fires and the quiet window alone corrects the
 * reserve, exactly as it did before PR #2929.
 *
 * That is why portals now go through `claimPhoneOverlayAddonReserve`: it writes
 * the CSS seed plus the row's own height inline on a cold load, re-measures once
 * settled, and gives the height back on release. The
 * cold and release cases below were pinned as known gaps until that landed.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { PhoneHeaderCollapsePortal } from "@/components/clinical-dashboard/phone-header-collapse-portal";
import { ModeNavHeaderPortal } from "@/components/mode-nav/mode-nav-portal";
import {
  __setPhoneOverlayReserveSettledForTests,
  phoneOverlayReserveGeometryQuietWindowMs,
  publishPhoneOverlayChromeReserveNow,
  usePhoneOverlayChromeReserve,
} from "@/components/clinical-dashboard/use-phone-overlay-chrome-reserve";
import { phoneHeaderCollapseAddonSlotId } from "@/lib/mode-home-composer";

const baseStackPx = 72;
// The 24px title's 1.12 leading makes the current row fractional. Replacing
// this in-flow box with an integer reserve moved the cold-load target.
const addonRowPx = 79.875;

function stubHeight(element: HTMLElement, measure: () => number) {
  Object.defineProperty(element, "offsetHeight", { configurable: true, get: () => Math.round(measure()) });
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => {
    const height = measure();
    return { x: 0, y: 0, top: 0, bottom: height, left: 0, right: 0, width: 0, height, toJSON: () => ({}) };
  });
}

// These cases drive `createRoot` directly rather than through Testing Library,
// because the subject IS commit ordering and a render helper that flushes for
// you would hide it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pendingFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function installPhoneStubs() {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
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
}

/**
 * The header stack, measuring itself the way the browser does: taller by one
 * addon row exactly while the slot is occupied. That coupling is the whole
 * subject — the reserve has to change in the commit that changes occupancy.
 */
// The production CSS seed, so a pre-settle claim has the reserve in force to add to.
const seedExpression = "calc(max(0.5rem,var(--safe-area-top)) + var(--shell-header-h))";

function mountChrome() {
  document.head.innerHTML = `<style>:root { --phone-overlay-chrome-h: ${seedExpression}; }</style>`;
  document.body.innerHTML = `
    <div class="phone-sticky-header-stack">
      <div data-testid="universal-header-collapse">
        <div id="${phoneHeaderCollapseAddonSlotId}"></div>
      </div>
    </div>
    <div id="app-root"></div>
  `;
  const stack = document.querySelector<HTMLElement>(".phone-sticky-header-stack")!;
  const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]')!;
  const slot = document.getElementById(phoneHeaderCollapseAddonSlotId)!;
  const measure = () => baseStackPx + (slot.childElementCount > 0 ? addonRowPx : 0);
  stubHeight(stack, measure);
  stubHeight(collapse, measure);
  // The slot holds one page-owned row, so its own height is that row's height.
  stubHeight(slot, () => (slot.childElementCount > 0 ? addonRowPx : 0));
  return { slot, container: document.getElementById("app-root")! };
}

function Shell({ children }: { children: ReactNode }) {
  usePhoneOverlayChromeReserve();
  return <>{children}</>;
}

const reserve = () => document.documentElement.style.getPropertyValue("--phone-overlay-chrome-h");

/** Runs whatever frames the hook has queued, at the timestamps given. */
function flushFrames(timestamps: number[]) {
  for (const timestamp of timestamps) {
    const entry = pendingFrames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) return;
    pendingFrames.delete(entry[0]);
    act(() => {
      entry[1](timestamp);
    });
  }
}

describe("portal wiring into the immediate reserve publisher", () => {
  beforeEach(() => {
    pendingFrames.clear();
    nextFrameId = 1;
    __setPhoneOverlayReserveSettledForTests(false);
    installPhoneStubs();
  });

  afterEach(() => {
    __setPhoneOverlayReserveSettledForTests(false);
    document.documentElement.style.removeProperty("--phone-overlay-chrome-h");
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("grows the reserve in the same commit the row leaves flow, once the shell has settled", () => {
    const { slot, container } = mountChrome();
    const root = createRoot(container);

    // The shell mounts first and its quiet window settles the bare 72px stack —
    // an in-session navigation, not a cold load.
    act(() => {
      root.render(<Shell>{null}</Shell>);
    });
    flushFrames([0, phoneOverlayReserveGeometryQuietWindowMs + 1]);
    expect(reserve()).toBe(`${baseStackPx}px`);

    // Now the route with the nav row arrives. The row leaves page flow in this
    // commit, so the reserve must include its exact height by the end of it — with no frame run
    // in between, which is what the absent `flushFrames` call below asserts.
    act(() => {
      root.render(
        <Shell>
          <PhoneHeaderCollapsePortal>
            <nav data-testid="mode-nav-row">nav</nav>
          </PhoneHeaderCollapsePortal>
        </Shell>,
      );
    });
    expect(slot.childElementCount).toBe(1);
    expect(reserve()).toBe(`${baseStackPx + addonRowPx}px`);

    act(() => {
      root.unmount();
    });
  });

  it("does the same for ModeNavHeaderPortal, which is the portal #CHPC5C actually goes through", () => {
    // The two portals call the publisher from separate, independent effects, so
    // covering one proves nothing about the other. Covering only
    // PhoneHeaderCollapsePortal was exactly that mistake: the recorded #CHPC5C
    // failure is on /differentials/compare, whose mode-nav row travels through
    // ModeNavHeaderPortal, and deleting that call left every case in this file
    // green. Raised by review on PR #2938.
    const { slot, container } = mountChrome();
    const root = createRoot(container);

    act(() => {
      root.render(<Shell>{null}</Shell>);
    });
    flushFrames([0, phoneOverlayReserveGeometryQuietWindowMs + 1]);
    expect(reserve()).toBe(`${baseStackPx}px`);

    act(() => {
      root.render(
        <Shell>
          <ModeNavHeaderPortal>
            <nav data-testid="mode-nav-row">nav</nav>
          </ModeNavHeaderPortal>
        </Shell>,
      );
    });
    expect(slot.childElementCount).toBe(1);
    expect(reserve()).toBe(`${baseStackPx + addonRowPx}px`);

    act(() => {
      root.unmount();
    });
  });

  it("shrinks the reserve in the same commit the row returns to page flow", () => {
    // The mirror of the defect — content held 49px too LOW instead of too high,
    // the same tap-retarget class. A cleanup cannot re-measure (React runs
    // layout-effect destroys before it detaches the portal's children), so the
    // claim gives back the row's own height as a delta instead.
    const { slot, container } = mountChrome();
    const root = createRoot(container);

    act(() => {
      root.render(<Shell>{null}</Shell>);
    });
    flushFrames([0, phoneOverlayReserveGeometryQuietWindowMs + 1]);
    act(() => {
      root.render(
        <Shell>
          <PhoneHeaderCollapsePortal>
            <nav>nav</nav>
          </PhoneHeaderCollapsePortal>
        </Shell>,
      );
    });
    expect(reserve()).toBe(`${baseStackPx + addonRowPx}px`);

    act(() => {
      root.render(<Shell>{null}</Shell>);
    });
    expect(slot.childElementCount).toBe(0);
    expect(reserve()).toBe(`${baseStackPx}px`);

    act(() => {
      root.unmount();
    });
  });

  it("gives back the row's current fractional height after it grows and shrinks while claimed", () => {
    // A medication route's nav row renders without its section rail while the
    // record is null, then grows in place once it loads. The settled reserve is
    // republished at the taller height, so the release must subtract the row's
    // height at release time, not the height captured when it was claimed.
    const { slot, container } = mountChrome();
    const stack = document.querySelector<HTMLElement>(".phone-sticky-header-stack")!;
    const collapse = document.querySelector<HTMLElement>('[data-testid="universal-header-collapse"]')!;
    let railPx = 0;
    const rowHeight = () => (slot.childElementCount > 0 ? addonRowPx + railPx : 0);
    for (const element of [stack, collapse]) {
      stubHeight(element, () => baseStackPx + rowHeight());
    }
    stubHeight(slot, rowHeight);
    const root = createRoot(container);

    act(() => {
      root.render(<Shell>{null}</Shell>);
    });
    flushFrames([0, phoneOverlayReserveGeometryQuietWindowMs + 1]);
    act(() => {
      root.render(
        <Shell>
          <PhoneHeaderCollapsePortal>
            <nav>nav</nav>
          </PhoneHeaderCollapsePortal>
        </Shell>,
      );
    });
    expect(reserve()).toBe(`${baseStackPx + addonRowPx}px`);

    // The rail arrives and the settled reserve is republished at the new height.
    railPx = 40.25;
    publishPhoneOverlayChromeReserveNow();
    expect(reserve()).toBe(`${baseStackPx + addonRowPx + railPx}px`);

    // Resizing the rail smaller keeps its fractional size through release too.
    railPx = 20.5;
    publishPhoneOverlayChromeReserveNow();
    expect(reserve()).toBe(`${baseStackPx + addonRowPx + railPx}px`);

    act(() => {
      root.render(<Shell>{null}</Shell>);
    });
    expect(slot.childElementCount).toBe(0);
    expect(reserve()).toBe(`${baseStackPx}px`);

    act(() => {
      root.unmount();
    });
  });

  it("swaps one row for another without drifting the reserve", () => {
    // In-session navigation between two addon routes: the old portal's cleanup
    // subtracts and the new portal's claim re-measures, in one commit.
    const { container } = mountChrome();
    const root = createRoot(container);

    act(() => {
      root.render(<Shell>{null}</Shell>);
    });
    flushFrames([0, phoneOverlayReserveGeometryQuietWindowMs + 1]);
    act(() => {
      root.render(
        <Shell>
          <PhoneHeaderCollapsePortal key="a">
            <nav>a</nav>
          </PhoneHeaderCollapsePortal>
        </Shell>,
      );
    });
    act(() => {
      root.render(
        <Shell>
          <ModeNavHeaderPortal key="b">
            <nav>b</nav>
          </ModeNavHeaderPortal>
        </Shell>,
      );
    });
    expect(reserve()).toBe(`${baseStackPx + addonRowPx}px`);

    act(() => {
      root.unmount();
    });
  });

  it("covers a cold first mount in the same commit, on top of the CSS seed", () => {
    // The #CHPC5C path: a cold `page.goto` on a Differentials phone route.
    // Layout effects run children-first, so the portal claims before the shell's
    // hook has settled anything. No stack measurement may be published before
    // settle (#147), so the claim writes the seed plus the row's own height as
    // an inline calc() — the page clears the taller header from the very commit
    // that shortened it.
    for (const Portal of [PhoneHeaderCollapsePortal, ModeNavHeaderPortal]) {
      const { slot, container } = mountChrome();
      const root = createRoot(container);

      act(() => {
        root.render(
          <Shell>
            <Portal>
              <nav>nav</nav>
            </Portal>
          </Shell>,
        );
      });

      expect(slot.childElementCount).toBe(1);
      expect(reserve()).toBe(`calc(${seedExpression} + ${addonRowPx}px)`);

      // The quiet window later settles the same total in pixels.
      flushFrames([0, phoneOverlayReserveGeometryQuietWindowMs + 1]);
      flushFrames([2 * (phoneOverlayReserveGeometryQuietWindowMs + 1)]);
      expect(reserve()).toBe(`${baseStackPx + addonRowPx}px`);

      act(() => {
        root.unmount();
      });
      pendingFrames.clear();
      __setPhoneOverlayReserveSettledForTests(false);
      document.documentElement.style.removeProperty("--phone-overlay-chrome-h");
    }
  });

  it("gives the seed back when the row leaves before the reserve has settled", () => {
    const { slot, container } = mountChrome();
    const root = createRoot(container);

    act(() => {
      root.render(
        <Shell>
          <PhoneHeaderCollapsePortal>
            <nav>nav</nav>
          </PhoneHeaderCollapsePortal>
        </Shell>,
      );
    });
    expect(reserve()).toBe(`calc(${seedExpression} + ${addonRowPx}px)`);

    act(() => {
      root.render(<Shell>{null}</Shell>);
    });
    expect(slot.childElementCount).toBe(0);
    expect(reserve()).toBe("");

    act(() => {
      root.unmount();
    });
  });
});
