import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStickyChromeMetrics } from "@/components/sticky-chrome-metrics";

function Probe() {
  useStickyChromeMetrics({
    collapseSelector: "[data-collapse]",
    stickyHeaderSelector: "[data-sticky]",
    phoneMediaQuery: "(max-width: 639px)",
    anchorOffsetProperty: "--probe-anchor",
    stickyHeaderHeightProperty: "--probe-header",
    scope: "document",
  });
  return null;
}

function setHeight(element: HTMLElement, height: number) {
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
}

function mountChrome({ pinned }: { pinned: boolean }) {
  const collapse = document.createElement("div");
  collapse.setAttribute("data-collapse", "");
  setHeight(collapse, 56);
  const header = document.createElement("div");
  header.setAttribute("data-sticky", "");
  header.style.setProperty("--work-band-tabs-top", "40px");
  if (pinned) header.setAttribute("data-pinned", "");
  setHeight(header, 88);
  document.body.append(collapse, header);
  return { collapse, header };
}

const anchor = () => document.documentElement.style.getPropertyValue("--probe-anchor");

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
});

describe("phone anchor offset with a pinned tab rail", () => {
  it("clears the bar and the pinned rail while the bar shows", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    mountChrome({ pinned: true });
    render(<Probe />);
    // 56 bar + (88 header - 40 above the rail) + 16 breathing room.
    expect(anchor()).toBe("120px");
  });

  it("clears only the bar when the header is not pinned", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    mountChrome({ pinned: false });
    render(<Probe />);
    expect(anchor()).toBe("72px");
  });

  it("drops the rail when the bar hides, because the rail hides with it", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const { collapse } = mountChrome({ pinned: true });
    collapse.setAttribute("data-scroll-hidden", "true");
    render(<Probe />);
    expect(anchor()).toBe("16px");
  });
});
