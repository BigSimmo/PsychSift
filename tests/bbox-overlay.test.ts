import { describe, expect, it } from "vitest";
import { resolveBboxFrameGeometry, resolveBboxOverlayStyle } from "@/components/document-viewer/bbox-overlay";

describe("resolveBboxOverlayStyle", () => {
  it("converts normalized 0..1 ratio bounding box to CSS percentages", () => {
    const style = resolveBboxOverlayStyle({
      bbox: [0.1, 0.2, 0.6, 0.7],
      rotation: 0,
    });

    expect(style).toEqual({
      left: "10%",
      top: "20%",
      width: "50%",
      height: "50%",
    });
  });

  it("converts PDF point bounding box using page dimensions", () => {
    const style = resolveBboxOverlayStyle({
      bbox: [61.2, 158.4, 367.2, 554.4],
      pageGeometry: { width: 612, height: 792 },
      rotation: 0,
    });

    expect(style).toEqual({
      left: "10%",
      top: "20%",
      width: "50%",
      height: "50%",
    });
  });

  it("handles 90 degree clockwise rotation", () => {
    const style = resolveBboxOverlayStyle({
      bbox: [0.1, 0.2, 0.6, 0.7],
      rotation: 90,
    });

    // At 90 deg:
    // left = (1 - normY - normH) * 100 = (1 - 0.2 - 0.5) * 100 = 30%
    // top = normX * 100 = 10%
    // width = normH * 100 = 50%
    // height = normW * 100 = 50%
    expect(style).toEqual({
      left: "30%",
      top: "10%",
      width: "50%",
      height: "50%",
    });
  });

  it("handles 180 degree rotation", () => {
    const style = resolveBboxOverlayStyle({
      bbox: [0.1, 0.2, 0.6, 0.7],
      rotation: 180,
    });

    // At 180 deg:
    // left = (1 - normX - normW) * 100 = (1 - 0.1 - 0.5) * 100 = 40%
    // top = (1 - normY - normH) * 100 = (1 - 0.2 - 0.5) * 100 = 30%
    // width = normW * 100 = 50%
    // height = normH * 100 = 50%
    expect(style).toEqual({
      left: "40%",
      top: "30%",
      width: "50%",
      height: "50%",
    });
  });

  it("handles 270 degree rotation", () => {
    const style = resolveBboxOverlayStyle({
      bbox: [0.1, 0.2, 0.6, 0.7],
      rotation: 270,
    });

    // At 270 deg:
    // left = normY * 100 = 20%
    // top = (1 - normX - normW) * 100 = 40%
    // width = normH * 100 = 50%
    // height = normW * 100 = 50%
    expect(style).toEqual({
      left: "20%",
      top: "40%",
      width: "50%",
      height: "50%",
    });
  });

  it("safely handles inverted min/max coordinate pairs", () => {
    const style = resolveBboxOverlayStyle({
      bbox: [0.6, 0.7, 0.1, 0.2],
      rotation: 0,
    });

    expect(style).toEqual({
      left: "10%",
      top: "20%",
      width: "50%",
      height: "50%",
    });
  });

  it("returns null for malformed or missing bbox values (fail-closed)", () => {
    expect(resolveBboxOverlayStyle({ bbox: null })).toBeNull();
    expect(resolveBboxOverlayStyle({ bbox: undefined })).toBeNull();
    expect(resolveBboxOverlayStyle({ bbox: [0, 0, 0] as unknown as [number, number, number, number] })).toBeNull();
    expect(resolveBboxOverlayStyle({ bbox: [0, 0, NaN, 10] })).toBeNull();
    expect(resolveBboxOverlayStyle({ bbox: [0.5, 0.5, 0.5, 0.5] })).toBeNull(); // zero area
  });

  it("returns null when PDF point coordinates lack page geometry", () => {
    expect(
      resolveBboxOverlayStyle({
        bbox: [100, 100, 300, 400],
        pageGeometry: null,
      }),
    ).toBeNull();
  });
});

describe("resolveBboxFrameGeometry", () => {
  it("swaps a quarter-turned page's measured size back to the bbox's own frame", () => {
    // The viewer measures an A4 page after the reader's turn: 842 wide at 90°.
    expect(resolveBboxFrameGeometry({ width: 842, height: 595 }, 90)).toEqual({ width: 595, height: 842 });
    expect(resolveBboxFrameGeometry({ width: 842, height: 595 }, 270)).toEqual({ width: 595, height: 842 });
    expect(resolveBboxFrameGeometry({ width: 595, height: 842 }, 180)).toEqual({ width: 595, height: 842 });
    expect(resolveBboxFrameGeometry({ width: 595, height: 842 }, 0)).toEqual({ width: 595, height: 842 });
    expect(resolveBboxFrameGeometry(null, 90)).toBeNull();
  });

  it("places a point-space box on a page the reader rotated 90 degrees", () => {
    // A box at 10%/20% of an A4 page (595 x 842 points), half its width and height.
    const style = resolveBboxOverlayStyle({
      bbox: [59.5, 168.4, 357, 589.4],
      pageGeometry: resolveBboxFrameGeometry({ width: 842, height: 595 }, 90),
      rotation: 90,
    });

    // Same placement as the 0..1 ratio box at 90° above.
    expect(style).toEqual({
      left: "30%",
      top: "10%",
      width: "50%",
      height: "50%",
    });
  });
});
