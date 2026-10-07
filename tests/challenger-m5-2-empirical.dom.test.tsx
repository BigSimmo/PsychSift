/** @vitest-environment jsdom */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/test",
}));

describe("Challenger M5-2: Empirical Verification & Hardening Harness", () => {
  /* ========================================================================
   * 1. Phone Chrome: DocumentViewer Zero-Reserve & Invariant 4 Contract
   * ======================================================================== */
  describe("1. DocumentViewer Invariant 4 Zero-Reserve Contract", () => {
    const docViewerSource = readFileSync(join(process.cwd(), "src/components/DocumentViewer.tsx"), "utf8");

    it("empirically asserts max-sm:pb-0 when composerVisible is false", () => {
      // Must NOT contain max-sm:pb-3 on scroll-hidden composer
      expect(docViewerSource).not.toMatch(/:\s*"max-sm:pb-3"/);

      // Must contain max-sm:pb-0 when hidden
      expect(docViewerSource).toMatch(/:\s*"max-sm:pb-0"/);

      // Verify the ternary branch
      const composerBranchRegex =
        /composerVisible\s*\?\s*"max-sm:pb-\[calc\(9rem\+var\(--safe-area-bottom\)\+var\(--keyboard-height,0px\)\)\]\s+max-sm:\[--phone-focus-bottom-clearance:calc\(9rem\+var\(--safe-area-bottom\)\+var\(--keyboard-height,0px\)\)\]\s+sm:pb-40"\s*:\s*"max-sm:pb-0"/;
      expect(docViewerSource).toMatch(composerBranchRegex);
    });

    it("verifies explicit documentation citing Invariant 4 (Hidden means zero reserve)", () => {
      expect(docViewerSource).toContain('Invariant 4 ("Hidden means zero reserve")');
    });
  });

  /* ========================================================================
   * 2. Phone Chrome: DSM Mobile Compare Strip Portalling & Scroll Hide
   * ======================================================================== */
  describe("2. DSM Mobile Compare Strip Portalling & Scroll Hide", () => {
    const dsmSearchSource = readFileSync(join(process.cwd(), "src/components/dsm/dsm-search-page.tsx"), "utf8");
    const globalsCssSource = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    it("verifies DSM compare strip wraps in PhoneFooterLayerPortal with client mount guard", () => {
      expect(dsmSearchSource).toContain("<PhoneFooterLayerPortal>");
      expect(dsmSearchSource).toContain("usePhoneFooterLayerScrollHidden()");
      expect(dsmSearchSource).toMatch(/if\s*\(!selected\.length\s*\|\|\s*!mounted\)\s*return\s*null;/);
    });

    it("verifies DSM compare strip sets data-scroll-hidden attribute", () => {
      expect(dsmSearchSource).toMatch(/data-scroll-hidden=\{phoneChromeHidden\s*\?\s*"true"\s*:\s*undefined\}/);
    });

    it("verifies DSM page container has zero mobile double-reserve padding", () => {
      // Should use sm:max-lg:pb-16 instead of max-lg:pb-[calc(4rem+var(--safe-area-bottom))]
      expect(dsmSearchSource).not.toContain("max-lg:pb-[calc(4rem+var(--safe-area-bottom))]");
      expect(dsmSearchSource).toContain('selected.length > 0 && "sm:max-lg:pb-16"');
    });

    it("verifies CSS rules translate compare strip offscreen and disable pointer events when hidden", () => {
      expect(globalsCssSource).toContain('.dsm-mobile-compare-strip[data-scroll-hidden="true"]');
      expect(globalsCssSource).toMatch(
        /\.dsm-mobile-compare-strip\[data-scroll-hidden="true"\]\s*\{[\s\S]*?transform:\s*translateY\(calc\(100% \+ 5\.5rem \+ var\(--safe-area-bottom, 0px\) \+ var\(--keyboard-height, 0px\) \+ 0\.5rem\)\);/,
      );
      expect(globalsCssSource).toMatch(
        /\.dsm-mobile-compare-strip\[data-scroll-hidden="true"\]\s*\{[\s\S]*?opacity:\s*0;/,
      );
      expect(globalsCssSource).toMatch(
        /\.dsm-mobile-compare-strip\[data-scroll-hidden="true"\]\s*\*\s*\{[\s\S]*?pointer-events:\s*none;/,
      );
    });
  });

  /* ========================================================================
   * 3. First Nations Design Standards v13.1 (All 34 Components)
   * ======================================================================== */
  describe("3. First Nations Design Standards v13.1 Exhaustive Audit", () => {
    const FN_DIR = "src/components/first-nations";
    const APP_DIR = "src/app/(search-app)/first-nations";
    const files = [
      ...readdirSync(FN_DIR).map((f) => ({
        f,
        text: readFileSync(join(FN_DIR, f), "utf8"),
      })),
      { f: "error.tsx", text: readFileSync(join(APP_DIR, "error.tsx"), "utf8") },
    ];

    it("confirms exactly 34 First Nations components and files are audited", () => {
      expect(files.length).toBe(34);
    });

    it("enforces no font weights heavier than semibold (font-bold/extrabold/black/700+)", () => {
      for (const { f, text } of files) {
        expect(text, `File ${f} must not contain font weights heavier than semibold`).not.toMatch(
          /\bfont-(bold|extrabold|black)\b|font-weight:\s*[7-9]00/,
        );
      }
    });

    it("enforces only approved First Nations scale size steps (no raw text-xs, text-sm, text-base, text-lg, text-[...])", () => {
      for (const { f, text } of files) {
        expect(text, `File ${f} must only use approved First Nations scale size steps`).not.toMatch(
          /\btext-(3xs|xs|sm|base|lg|xl|[2-9]xl)\b(?!-)|\btext-\[\d/,
        );
      }
    });

    it("verifies day-track.tsx SVG text elements use text-sm-minus (elevated from sub-12px floor)", () => {
      const dayTrack = files.find((item) => item.f === "day-track.tsx");
      expect(dayTrack).toBeDefined();
      expect(dayTrack!.text).toContain("text-sm-minus");
      // Must not use text-2xs or text-xs
      expect(dayTrack!.text).not.toMatch(/className="[^"]*text-2xs/);
      expect(dayTrack!.text).not.toMatch(/className="[^"]*text-xs/);
    });

    it("verifies serif accent fn-voice is restricted strictly to voice.tsx", () => {
      for (const { f, text } of files) {
        if (f !== "voice.tsx") {
          expect(text, `File ${f} must not use fn-voice`).not.toMatch(/fn-voice/);
        }
      }
      const voice = files.find((item) => item.f === "voice.tsx");
      expect(voice!.text).toContain("fn-voice");
    });

    it("verifies mode-identity is strictly restricted to allowed 4 files", () => {
      const allowed = new Set(["module-header.tsx", "day-track.tsx", "voice.tsx", "first-nations-nav-header.tsx"]);
      for (const { f, text } of files) {
        if (!allowed.has(f)) {
          expect(text, `File ${f} must not reference mode-identity`).not.toMatch(/mode-identity|modeIdentity/);
        }
      }
    });

    it("verifies no tabs carry count badges", () => {
      for (const { f, text } of files) {
        expect(text, `File ${f} tabs must not have count badges`).not.toMatch(/\b(badge|count)=\{/);
      }
    });
  });

  /* ========================================================================
   * 4. Design System Token & Scale Contracts Ratchet Verification
   * ======================================================================== */
  describe("4. Design System Token & Scale Contracts Ratchet Verification", () => {
    const baseline = JSON.parse(
      readFileSync(join(process.cwd(), "scripts/design-system-contract-baseline.json"), "utf8"),
    );

    it("verifies sub-floor interactive min-heights ceiling is 4 (tightened from 5)", () => {
      expect(baseline.metrics.interactiveTapFloorDeclarations).toBe(4);
      // Ensure dictionary-term-page was removed from debtByPath
      expect(
        baseline.debtByPath.interactiveTapFloorDeclarations["src/components/dictionary/dictionary-term-page.tsx"],
      ).toBeUndefined();
    });

    it("verifies disabledOpacityUses ceiling is tightened to 31", () => {
      expect(baseline.metrics.disabledOpacityUses).toBe(31);
    });

    it("verifies visibleLiveRegions ceiling is tightened to 20", () => {
      expect(baseline.metrics.visibleLiveRegions).toBe(20);
    });

    it("verifies patient-safety-plan shadow alias exception has been removed from baseline", () => {
      expect(baseline.debtByPath.legacyShadowAliases["src/components/patient-safety-plan.tsx"]).toBeUndefined();
    });
  });
});
