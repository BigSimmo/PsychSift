import { describe, expect, it } from "vitest";
import {
  resolveModeHomeCanvasClass,
  topAlignSharedHomeForAuth,
} from "@/components/clinical-dashboard/mode-home-canvas";

describe("resolveModeHomeCanvasClass", () => {
  it("centres compact shared homes without a nested mobile viewport floor", () => {
    const className = resolveModeHomeCanvasClass({
      activeModeResultKind: "answer",
      centeredModeHome: true,
      compactMobileModeHome: true,
      hasAnswer: false,
      showSharedHome: true,
    });

    expect(className).toContain("max-sm:flex max-sm:grow max-sm:shrink-0 max-sm:flex-col");
    expect(className).toContain("max-sm:items-center max-sm:justify-center");
    expect(className).not.toContain("max-sm:min-h-[calc(100dvh-12.5rem)]");
  });

  it("top-aligns the shared home for a signed-in reader so a late My Day card never lifts the composer", () => {
    for (const compactMobileModeHome of [true, false]) {
      const className = resolveModeHomeCanvasClass({
        activeModeResultKind: "answer",
        centeredModeHome: true,
        compactMobileModeHome,
        hasAnswer: false,
        showSharedHome: true,
        topAlignSharedHome: true,
      });
      expect(className).not.toContain("place-items-center");
      expect(className).not.toContain("max-sm:justify-center");
      expect(className).toContain("content-start");
    }
  });

  it("keeps compact registry homes top-aligned", () => {
    const className = resolveModeHomeCanvasClass({
      activeModeResultKind: "services",
      centeredModeHome: false,
      compactMobileModeHome: true,
      hasAnswer: false,
      showSharedHome: false,
    });

    expect(className).not.toContain("max-sm:items-center");
    expect(className).not.toContain("max-sm:justify-center");
    expect(className).toContain("max-w-6xl");
  });

  it("gives forms search results the same wide canvas as services", () => {
    for (const activeModeResultKind of ["forms", "services"] as const) {
      expect(
        resolveModeHomeCanvasClass({
          activeModeResultKind,
          centeredModeHome: false,
          compactMobileModeHome: false,
          hasAnswer: false,
          showSharedHome: false,
        }),
      ).toContain("max-w-6xl");
    }
  });
});

describe("topAlignSharedHomeForAuth", () => {
  it("top-aligns while auth resolves so the first and signed-in paints agree", () => {
    expect(topAlignSharedHomeForAuth("loading")).toBe(true);
    expect(topAlignSharedHomeForAuth("authenticated")).toBe(true);
    expect(topAlignSharedHomeForAuth("signed_out")).toBe(false);
  });
});
