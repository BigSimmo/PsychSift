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
});
