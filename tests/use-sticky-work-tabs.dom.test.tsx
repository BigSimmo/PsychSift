import { act, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStickyWorkTabs } from "@/components/work-frame/use-sticky-work-tabs";

// Owner report, 10 Oct 2026: on an iPhone the whole CPD title block stayed
// pinned with the top bar gone and a blank strip above it. The hook read where
// the CSS holds the band once, at measure time; the phone reserve behind that
// offset is published later with no resize, so the stale value never matched
// and the band was never marked stuck (so it was never trimmed or slid away).

function Band() {
  const [band, setBand] = useState<HTMLElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  useStickyWorkTabs(band, navRef);
  return (
    <div ref={setBand} data-testid="band" style={{ top: "16px" }}>
      <nav ref={navRef} />
    </div>
  );
}

function rectAt(top: number): DOMRect {
  return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

afterEach(() => vi.restoreAllMocks());

describe("useStickyWorkTabs", () => {
  it("coalesces scroll bursts and does not poll geometry while a compositor animation runs", () => {
    let nextId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const flush = () => {
      const pending = [...frames.values()];
      frames.clear();
      act(() => pending.forEach((callback) => callback(0)));
    };
    const { getByTestId, unmount } = render(<Band />);
    flush();
    const band = getByTestId("band");
    const rect = vi.spyOn(band, "getBoundingClientRect").mockReturnValue(rectAt(16));
    Object.defineProperty(band, "getAnimations", {
      configurable: true,
      value: () => [{ playState: "running" }],
    });
    act(() => {
      for (let i = 0; i < 20; i++) document.dispatchEvent(new Event("scroll"));
    });
    expect(frames.size).toBe(1);
    flush();
    expect(rect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(band.hasAttribute("data-stuck")).toBe(true);

    document.dispatchEvent(new Event("scroll"));
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });

  it("follows its header owner but ignores unrelated footer visibility mutations", async () => {
    const collapse = document.createElement("div");
    collapse.dataset.testid = "universal-header-collapse";
    collapse.innerHTML = '<header class="universal-header"></header>';
    const footer = document.createElement("div");
    document.body.append(collapse, footer);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const { getByTestId, unmount } = render(<Band />);
    const band = getByTestId("band");
    const rect = vi.spyOn(band, "getBoundingClientRect").mockReturnValue(rectAt(16));
    try {
      await act(async () => {
        footer.dataset.scrollHidden = "true";
        await Promise.resolve();
      });
      expect(rect).not.toHaveBeenCalled();
      await act(async () => {
        collapse.dataset.scrollHidden = "true";
        await Promise.resolve();
      });
      expect(band.hasAttribute("data-bar-hidden")).toBe(true);
      await act(async () => {
        delete collapse.dataset.scrollHidden;
        await Promise.resolve();
      });
      expect(band.hasAttribute("data-bar-hidden")).toBe(false);
    } finally {
      unmount();
      collapse.remove();
      footer.remove();
    }
  });

  it("marks the band stuck against where the CSS holds it now, not at the last measure", () => {
    // Run each frame at once; returning 0 leaves no frame pending.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const { getByTestId } = render(<Band />);
    const band = getByTestId("band");
    expect(band.hasAttribute("data-pinned")).toBe(true);

    // The phone reserve arrives: the band now sticks at 78px, with no resize.
    band.style.top = "78px";
    vi.spyOn(band, "getBoundingClientRect").mockReturnValue(rectAt(78));
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    expect(band.hasAttribute("data-stuck")).toBe(true);

    // Back in its own place on the page, it is not stuck.
    vi.spyOn(band, "getBoundingClientRect").mockReturnValue(rectAt(300));
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    expect(band.hasAttribute("data-stuck")).toBe(false);
  });

  it("rechecks when the phone reserve lands on the root with no scroll", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const { getByTestId } = render(<Band />);
    const band = getByTestId("band");
    const rect = vi.spyOn(band, "getBoundingClientRect").mockReturnValue(rectAt(300));
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    expect(band.hasAttribute("data-stuck")).toBe(false);

    // The reserve lands and the band now sticks where it already sits.
    band.style.top = "78px";
    rect.mockReturnValue(rectAt(78));
    await act(async () => {
      document.documentElement.style.setProperty("--phone-overlay-chrome-h", "62px");
      await Promise.resolve();
    });
    expect(band.hasAttribute("data-stuck")).toBe(true);
    document.documentElement.style.removeProperty("--phone-overlay-chrome-h");
  });
});

describe("work band hide rule", () => {
  // A fixed slide lifted a band that had only just pinned off its own place on
  // the page, leaving a white hole the size of the band (found 10 Oct 2026).
  // Hidden, the band must drop its sticky offset instead, so the sticky engine
  // keeps it in place or slides it out, never further.
  it("hides the pinned band through its sticky offset, not a fixed translate", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/app/work-mode.css", "utf8");
    const hidden = css.match(/\.work-band\[data-pinned\]\[data-bar-hidden\]:not\(:focus-within\)\s*\{([^}]*)\}/)?.[1];
    expect(hidden).toContain("top: calc(-1 * (var(--work-band-tabs-top, 0px) + var(--work-tabs-h, 0px)));");
    expect(css).not.toMatch(/\.work-band\[data-(?:stuck|pinned)\][^{]*\{[^}]*\btranslate:/);
  });

  it("carries the band colour above it for the iPhone pull-down bounce", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/app/work-mode.css", "utf8");
    expect(css).toMatch(/\.work-band\s*\{\s*box-shadow: 0 -50vh 0 50vh var\(--mode-band-bg\);/);
  });
});
