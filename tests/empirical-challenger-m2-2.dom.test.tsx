/** @vitest-environment jsdom */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findDebtPathRegressions } from "../scripts/design-system-contract-utils.mjs";

describe("Empirical Challenger M2-2: Baseline Ratchets, Test Guard Exemptions & Regression Suite", () => {
  describe("1. Design System Baseline Ratchet Integrity", () => {
    const baselineRaw = readFileSync("scripts/design-system-contract-baseline.json", "utf8");
    const baseline = JSON.parse(baselineRaw);

    it("verifies exact metric counts: disabledOpacityUses (31), visibleLiveRegions (20), legacyShadowAliases (32)", () => {
      expect(baseline.metrics.disabledOpacityUses).toBe(31);
      expect(baseline.metrics.visibleLiveRegions).toBe(20);
      expect(baseline.metrics.legacyShadowAliases).toBe(32);
    });

    it("verifies zero artificial inflation: sum of debtByPath matches top-level metrics exactly", () => {
      const sumValues = (obj: Record<string, number>) => Object.values(obj).reduce((a, b) => a + b, 0);

      const sumDisabledOpacity = sumValues(baseline.debtByPath.disabledOpacityUses);
      const sumVisibleLiveRegions = sumValues(baseline.debtByPath.visibleLiveRegions);
      const sumLegacyShadowAliases = sumValues(baseline.debtByPath.legacyShadowAliases);

      expect(sumDisabledOpacity).toBe(31);
      expect(sumVisibleLiveRegions).toBe(20);
      expect(sumLegacyShadowAliases).toBe(32);

      expect(baseline.metrics.disabledOpacityUses).toBe(sumDisabledOpacity);
      expect(baseline.metrics.visibleLiveRegions).toBe(sumVisibleLiveRegions);
      expect(baseline.metrics.legacyShadowAliases).toBe(sumLegacyShadowAliases);
    });

    it("verifies debt reduction in specific audited files", () => {
      // Patient safety plan legacy shadow alias was eliminated
      expect(baseline.debtByPath.legacyShadowAliases["src/components/patient-safety-plan.tsx"]).toBeUndefined();

      // Favourites command library debt reductions
      expect(
        baseline.debtByPath.disabledOpacityUses[
          "src/components/clinical-dashboard/favourites-command-library-page.tsx"
        ],
      ).toBe(2);
      expect(
        baseline.debtByPath.visibleLiveRegions["src/components/clinical-dashboard/favourites-command-library-page.tsx"],
      ).toBe(1);
    });

    it("adversarially stress-tests ratchet oracle: findDebtPathRegressions catches regressions", () => {
      const recorded = { ...baseline.debtByPath.legacyShadowAliases, "src/components/patient-safety-plan.tsx": 1 };
      const regressions = findDebtPathRegressions(
        "legacyShadowAliases",
        recorded,
        baseline.debtByPath.legacyShadowAliases,
      );
      expect(regressions.length).toBeGreaterThan(0);
      expect(regressions[0]).toContain("patient-safety-plan.tsx");
    });
  });

  describe("2. First Nations Design Guard & Exemption Elimination", () => {
    const DIR = "src/components/first-nations";
    const APP_DIR = "src/app/(search-app)/first-nations";
    const files = [
      ...readdirSync(DIR).map((f) => ({ f, text: readFileSync(join(DIR, f), "utf8") })),
      { f: "error.tsx", text: readFileSync(join(APP_DIR, "error.tsx"), "utf8") },
    ];

    it("verifies day-track.tsx uses text-sm-minus to satisfy clinical 12px floor and standard scale", () => {
      const dayTrackSource = readFileSync(join(DIR, "day-track.tsx"), "utf8");
      expect(dayTrackSource).toContain('className="nums fill-[color:var(--surface-summary-muted)] text-sm-minus"');
      expect(dayTrackSource).not.toContain("text-2xs");
      expect(dayTrackSource).not.toContain("text-xs");

      // Verify text-sm-minus is in approved scale steps
      const testFileSource = readFileSync("tests/first-nations-design.dom.test.tsx", "utf8");
      expect(testFileSource).toContain('"text-sm-minus"');
    });

    it("verifies test guard has ZERO exemptions across all First Nations components", () => {
      const testFileSource = readFileSync("tests/first-nations-design.dom.test.tsx", "utf8");

      // Ensure day-track.tsx is NOT exempted
      expect(testFileSource).not.toContain('if (f === "day-track.tsx") continue;');

      // Ensure zero bypass/continue statements exist in the file
      const exemptionMatches = [...testFileSource.matchAll(/if\s*\(f\s*===?[^)]+\)\s*continue;/g)];
      expect(exemptionMatches).toHaveLength(0);
    });

    it("adversarially tests that ALL First Nations components (including day-track.tsx) pass the scale guard", () => {
      const forbiddenPattern = /\btext-(3xs|xs|sm|base|lg|xl|[2-9]xl)\b(?!-)|\btext-\[\d/;

      // 1. None of the files (including day-track.tsx) violate the forbidden pattern
      expect(files.length).toBeGreaterThan(25);
      for (const { f, text } of files) {
        expect(text, `${f} should not have standard scale steps`).not.toMatch(forbiddenPattern);
      }

      // 2. Adversarial mock: any prohibited token MUST be detected
      for (const token of ["text-xs", "text-sm", "text-base", "text-xl", "text-[11px]"]) {
        const testCode = `export function MockComponent() { return <div className="${token}">Text</div>; }`;
        expect(testCode).toMatch(forbiddenPattern);
      }
    });

    it("verifies day-track.tsx is still subject to all other First Nations design invariants", () => {
      const dayTrackSource = readFileSync(join(DIR, "day-track.tsx"), "utf8");

      // No heavy font weights
      expect(dayTrackSource).not.toMatch(/\bfont-(bold|extrabold|black)\b|font-weight:\s*[7-9]00/);

      // No tab count badges
      expect(dayTrackSource).not.toMatch(/\b(badge|count)=\{/);

      // No unapproved mode colour usage (day-track.tsx is in the allowed set for mode identity)
      expect(dayTrackSource).toMatch(/mode-identity/);
    });
  });

  describe("3. Design System Token, Typography & Icon Remediation Parity", () => {
    const globalsCss = readFileSync("src/app/globals.css", "utf8");

    it("verifies phantom icon token resolution in @theme and tailwind-merge", () => {
      expect(globalsCss).toContain("--spacing-icon-2xs: 0.75rem;");
      const tailwindMergeSource = readFileSync("src/lib/tailwind-merge.ts", "utf8");
      expect(tailwindMergeSource).toContain('"icon-2xs"');

      const onCallFlagSource = readFileSync("src/components/on-call/on-call-private-flag.tsx", "utf8");
      expect(onCallFlagSource).toContain('className="size-icon-xs"');
      expect(onCallFlagSource).not.toContain("size-icon-2xs");
    });

    it("verifies icon sizing domain separation in globals.css", () => {
      expect(globalsCss).toContain("width: var(--spacing-icon-xs);");
      expect(globalsCss).toContain("height: var(--spacing-icon-xs);");
      expect(globalsCss).not.toContain("width: var(--text-2xs);");
    });

    it("verifies factsheet-detail-page.tsx inline font-size elevation to 12px", () => {
      const factsheetSource = readFileSync("src/components/factsheets/factsheet-detail-page.tsx", "utf8");
      expect(factsheetSource).not.toContain('fontSize: "11px"');
      expect(factsheetSource).toContain('fontSize: "12px"');
    });

    it("verifies patient-safety-plan.tsx shadow alias replacement", () => {
      const pspSource = readFileSync("src/components/patient-safety-plan.tsx", "utf8");
      expect(pspSource).not.toContain("shadow-[var(--shadow-lux)]");
      expect(pspSource).toContain("shadow-[var(--e4)]");
    });
  });
});
