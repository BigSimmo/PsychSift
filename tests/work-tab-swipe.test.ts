import { describe, expect, it } from "vitest";

import { SWIPE_DISTANCE_MIN, SWIPE_FLICK_DISTANCE, swipeOutcome } from "@/components/work-swipe/use-tab-swipe";

const steady = (fromX: number, toX: number, ms: number) => [
  { x: fromX, t: 0 },
  { x: toX, t: ms },
];

describe("work tab swipe outcome", () => {
  it("lands a slow deliberate drag past a fifth of the screen, either way", () => {
    expect(swipeOutcome({ dx: -90, width: 390, recent: steady(200, 196, 80) })).toBe("next");
    expect(swipeOutcome({ dx: 90, width: 390, recent: steady(200, 204, 80) })).toBe("previous");
  });

  it("never lands a drag shorter than the floor on a narrow phone", () => {
    expect(swipeOutcome({ dx: -(SWIPE_DISTANCE_MIN - 1), width: 320, recent: steady(200, 199, 80) })).toBeNull();
  });

  it("lands a short quick flick", () => {
    expect(swipeOutcome({ dx: -(SWIPE_FLICK_DISTANCE + 4), width: 390, recent: steady(240, 200, 60) })).toBe("next");
  });

  it("ignores a short slow nudge", () => {
    expect(swipeOutcome({ dx: -40, width: 390, recent: steady(240, 230, 80) })).toBeNull();
  });

  it("cancels when the finger is heading back the other way at release", () => {
    expect(swipeOutcome({ dx: -120, width: 390, recent: steady(150, 190, 60) })).toBeNull();
  });
});
