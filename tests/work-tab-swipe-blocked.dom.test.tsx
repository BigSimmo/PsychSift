import { afterEach, describe, expect, it } from "vitest";

import { swipeBlocked, swipeOutcome } from "@/components/work-swipe/use-tab-swipe";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector<HTMLElement>("[data-start]")!;
}

describe("work tab swipe: where a swipe may start", () => {
  it("allows plain page content", () => {
    expect(swipeBlocked(mount("<main><p data-start>Text</p></main>"))).toBe(false);
  });

  it("blocks every touch while a sheet is open, its dimmed backdrop included", () => {
    const start = mount(
      '<main><p data-start>Behind</p></main><div class="backdrop"></div><div role="dialog" aria-modal="true">Sheet</div>',
    );
    expect(swipeBlocked(start)).toBe(true);
  });

  it("blocks drawing surfaces, fields and opted-out regions", () => {
    expect(swipeBlocked(mount("<canvas data-start></canvas>"))).toBe(true);
    expect(swipeBlocked(mount('<div style="touch-action: none"><span data-start>Sign</span></div>'))).toBe(true);
    expect(swipeBlocked(mount("<input data-start />"))).toBe(true);
    expect(swipeBlocked(mount("<div data-no-tab-swipe><span data-start>Week</span></div>"))).toBe(true);
  });

  it("leaves My Day's own panel swipe alone", () => {
    expect(swipeBlocked(mount('<div id="my-day-panel"><p data-start>Today</p></div>'))).toBe(true);
  });
});

describe("work tab swipe: a gesture that bends downward", () => {
  it("does not land when it ended up mostly vertical", () => {
    const recent = [
      { x: 300, t: 0 },
      { x: 200, t: 60 },
    ];
    expect(swipeOutcome({ dx: -100, dy: 90, width: 390, recent })).toBeNull();
    expect(swipeOutcome({ dx: -100, dy: 20, width: 390, recent })).toBe("next");
  });
});
