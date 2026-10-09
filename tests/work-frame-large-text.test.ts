import { describe, expect, it } from "vitest";

import { isLargeText } from "@/components/work-frame/use-large-text";

describe("isLargeText", () => {
  it("is off at normal text on every phone and desktop width", () => {
    expect(isLargeText(16, 320)).toBe(false);
    expect(isLargeText(16, 390)).toBe(false);
    expect(isLargeText(16, 1280)).toBe(false);
  });

  it("is on at 200% text, whatever the width", () => {
    expect(isLargeText(32, 390)).toBe(true);
    expect(isLargeText(32, 1280)).toBe(true);
  });

  it("is on from 125% text", () => {
    expect(isLargeText(19, 1280)).toBe(false);
    expect(isLargeText(20, 1280)).toBe(true);
  });

  it("is on when a page-zoomed phone leaves under 19rem of width", () => {
    expect(isLargeText(16, 300)).toBe(true);
    expect(isLargeText(16, 304)).toBe(false);
  });

  it("is off when the font size cannot be read", () => {
    expect(isLargeText(Number.NaN, 390)).toBe(false);
    expect(isLargeText(0, 390)).toBe(false);
  });
});
