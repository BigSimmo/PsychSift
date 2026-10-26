import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sourceFrom, sourceSegment } from "./helpers/source-contract";

const globalStylesSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const calculatorsSource = readFileSync(
  new URL("../src/components/calculators/search-page.tsx", import.meta.url),
  "utf8",
);
const scrollHideSource = readFileSync(
  new URL("../src/components/clinical-dashboard/use-hide-on-scroll.ts", import.meta.url),
  "utf8",
);

describe("mobile chrome paint baseline", () => {
  it("keeps the header opaque while the edge-to-edge footer uses localized soft glass", () => {
    const phoneStyles = sourceFrom(
      globalStylesSource,
      "@media (max-width: 639px) {\n  /* Phone baseline: a full-width opaque header.",
      {
        label: "globals.css max-width 639px phone header query",
      },
    );

    expect(phoneStyles).toMatch(
      /\.edge-glass-header,\s*\n\s*\.universal-header\s*\{[\s\S]*?background: var\(--background\);[\s\S]*?backdrop-filter: none/,
    );
    expect(phoneStyles).toMatch(/\.edge-glass-header-backdrop[\s\S]*?display: none/);
    expect(phoneStyles).toMatch(/\.answer-footer-search-dock\.answer-footer-search-edge[\s\S]*?bottom: 0;/);
    expect(phoneStyles).toMatch(
      /\.answer-footer-search-dock\.answer-footer-search-edge[\s\S]*?background: transparent;/,
    );
    expect(phoneStyles).toMatch(
      /\.answer-footer-search-dock \.answer-footer-search-backdrop[\s\S]*?display: block;[\s\S]*?position: absolute;/,
    );
    expect(phoneStyles).toMatch(
      /\.answer-footer-search-dock\.answer-footer-search-edge\[data-scroll-hidden="true"\][\s\S]*?opacity: 0;[\s\S]*?pointer-events: none/,
    );
    expect(phoneStyles).toMatch(
      /\.answer-footer-search-dock \.answer-footer-search-pill[\s\S]*?color-mix\(in srgb, var\(--surface\) 97%, transparent\)/,
    );
    expect(phoneStyles).toMatch(
      /\.answer-footer-search-dock\[data-scroll-hidden="true"\] \.answer-footer-search-backdrop[\s\S]*?opacity: 0;[\s\S]*?visibility: hidden;[\s\S]*?transition-delay: 0ms, 240ms/,
    );
  });

  it("keeps every footer-glass variant localized with a fully transparent physical edge", () => {
    const footerBackdropSource = sourceSegment(
      globalStylesSource,
      ".answer-footer-search-dock .answer-footer-search-backdrop {",
      "@supports not ((backdrop-filter: blur(1px))",
      { label: "footer backdrop rules", allowRepeatedStart: true },
    );
    const supportsFallbackSource = sourceSegment(
      globalStylesSource,
      "@supports not ((backdrop-filter: blur(1px))",
      "@media (prefers-reduced-transparency: reduce)",
      { label: "supports fallback rules", allowRepeatedStart: true },
    );
    const reducedTransparencySource = sourceSegment(
      globalStylesSource,
      "@media (prefers-reduced-transparency: reduce)",
      "@layer components {",
      { label: "reduced transparency footer backdrop rules", allowRepeatedStart: true },
    );

    expect(footerBackdropSource).toContain("color-mix(in srgb, var(--background) 28%, transparent) 58%");
    expect(supportsFallbackSource).toContain("color-mix(in srgb, var(--background) 38%, transparent) 62%");
    expect(reducedTransparencySource).toContain("color-mix(in srgb, var(--background) 52%, transparent) 62%");
    for (const variant of [footerBackdropSource, supportsFallbackSource, reducedTransparencySource]) {
      expect(variant).toContain("transparent 100%");
      expect(variant).not.toMatch(/color-mix\([^\n]+\) 100%/);
    }
  });

  it("keeps calculator results free of a second phone dock and page reserve", () => {
    expect(calculatorsSource).not.toContain("useReserveTransitionMarker");
    expect(calculatorsSource).not.toContain('reserveOwner="calculator"');
    expect(calculatorsSource).not.toContain('data-testid="calculators-phone-dock"');
    expect(calculatorsSource).not.toContain("PhoneFooterLayerPortal");
    expect(globalStylesSource).toContain('[data-reserve-owner][data-reserve-transitioning="true"]');
    expect(scrollHideSource).toContain('querySelectorAll("[data-reserve-owner]")');
    expect(scrollHideSource).toContain("dataset.reserveHiddenPad");
  });
});
