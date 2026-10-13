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
  header.className = "inpage-nav-header";
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
  it("leaves the bar and the pinned rail to the page's scroll padding", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    mountChrome({ pinned: true });
    render(<Probe />);
    // mode-band.css pads the page by the bar and the pinned row, and browsers
    // add that padding to this margin, so only the breathing room remains.
    expect(anchor()).toBe("16px");
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

  it("keeps only the breathing room when the bar hides with a pinned rail", () => {
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
