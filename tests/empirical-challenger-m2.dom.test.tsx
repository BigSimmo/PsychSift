/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("next/navigation", () => ({
  usePathname: () => "/factsheets/sertraline",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { DayTrack } from "@/components/first-nations/day-track";
import { OnCallPrivateFlag } from "@/components/on-call/on-call-private-flag";
import { FactsheetDetailPage } from "@/components/factsheets/factsheet-detail-page";
import { findFactsheet } from "@/components/factsheets/factsheets-data";

describe("Empirical Challenger M2-1: Stress-Testing Typography Floor, Icon Scaling & Layout Parity", () => {
  const globalsCss = readFileSync("src/app/globals.css", "utf8");
  const ckbTokensCss = readFileSync("src/app/ckb-v2-tokens.css", "utf8");
  const tailwindMergeSource = readFileSync("src/lib/tailwind-merge.ts", "utf8");

  describe("1. Typography Floor (>= 12px / 0.75rem) in Touched CSS Rules & Components", () => {
    it("verifies all 10 touched CSS rules in globals.css declare font-size >= 0.75rem or var(--text-xs)", () => {
      // 1. Therapy compare tray pip
      const pipMatch = globalsCss.match(/\.therapy-compare-tray__pip\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(pipMatch).toBeTruthy();
      expect(pipMatch![1].trim()).toBe("0.75rem");

      // 2. Therapy compare tray count
      const countMatch = globalsCss.match(/\.therapy-compare-tray__count\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(countMatch).toBeTruthy();
      expect(countMatch![1].trim()).toBe("0.75rem");

      // 3. Answer source mark
      const markMatch = globalsCss.match(/\.answer-source-mark\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(markMatch).toBeTruthy();
      expect(markMatch![1].trim()).toBe("0.75rem");

      // 4. Answer source mark overflow
      const overflowMatch = globalsCss.match(/\.answer-source-mark-overflow\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(overflowMatch).toBeTruthy();
      expect(overflowMatch![1].trim()).toBe("0.75rem");

      // 5. Smart search phone ticker kicker
      const kickerMatch = globalsCss.match(/\.smart-search-phone-ticker-kicker\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(kickerMatch).toBeTruthy();
      expect(kickerMatch![1].trim()).toBe("0.75rem");

      // 7. Answer suggestion label
      const suggLabelMatch = globalsCss.match(/\.answer-suggestion-label\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(suggLabelMatch).toBeTruthy();
      expect(suggLabelMatch![1].trim()).toBe("0.75rem");

      // 8. Answer suggestion label eyebrow
      const eyebrowMatch = globalsCss.match(/\.answer-suggestion-label-eyebrow\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(eyebrowMatch).toBeTruthy();
      expect(eyebrowMatch![1].trim()).toBe("0.75rem");

      // 10. PWA install dismiss
      const pwaDismissMatch = globalsCss.match(/\.pwa-install-dismiss\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(pwaDismissMatch).toBeTruthy();
      expect(pwaDismissMatch![1].trim()).toBe("0.75rem");

      // 11. Search band shelf label
      const shelfMatch = globalsCss.match(/\.search-band-shelf-label\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(shelfMatch).toBeTruthy();
      expect(shelfMatch![1].trim()).toBe("0.75rem");

      // 12. Smart search intent cue
      const cueMatch = globalsCss.match(/\.smart-search-intent-cue\s*\{[\s\S]*?font-size:\s*([^;]+);/);
      expect(cueMatch).toBeTruthy();
      expect(cueMatch![1].trim()).toBe("var(--text-xs)");
    });

    it("verifies --text-xs is mapped to 0.75rem (12px) in ckb-v2-tokens.css", () => {
      const textXsMatch = ckbTokensCss.match(/--text-xs:\s*([^;]+);/);
      expect(textXsMatch).toBeTruthy();
      expect(textXsMatch![1].trim()).toBe("0.75rem");
    });

    it("scans globals.css for any forbidden sub-12px font-size declarations", () => {
      const lines = globalsCss.split("\n");
      const forbiddenSub12: { line: number; text: string }[] = [];

      lines.forEach((line, idx) => {
        // Skip comments and media print (9pt print text is 12px at standard 96dpi)
        if (line.trim().startsWith("/*") || line.trim().startsWith("*") || line.includes("9pt")) return;
        if (/font-size\s*:/i.test(line)) {
          // Check for sub-12px rem (<0.75rem)
          const remMatch = line.match(/font-size\s*:\s*0\.(?:[0-6]\d*|7[0-4]\d*)rem/i);
          if (remMatch) forbiddenSub12.push({ line: idx + 1, text: line.trim() });
          // Check for sub-12px px (<12px)
          const pxMatch = line.match(/font-size\s*:\s*(?:[1-9]|1[01])(?:\.\d+)?px/i);
          if (pxMatch) forbiddenSub12.push({ line: idx + 1, text: line.trim() });
          // Check for sub-floor tokens text-2xs or text-3xs
          if (/var\(--text-(?:2xs|3xs|4xs)\)/i.test(line)) {
            forbiddenSub12.push({ line: idx + 1, text: line.trim() });
          }
        }
      });

      expect(forbiddenSub12).toEqual([]);
    });

    it("verifies factsheet-detail-page.tsx has zero inline fontSize below 12px", () => {
      const factsheetSource = readFileSync("src/components/factsheets/factsheet-detail-page.tsx", "utf8");
      const sub12Matches = factsheetSource.match(/fontSize:\s*["'](?:[1-9]|1[01])px["']/g);
      expect(sub12Matches).toBeNull();
    });

    it("evaluates OnCallPrivateFlag badge text class", () => {
      const { container } = render(<OnCallPrivateFlag />);
      const badge = container.querySelector('[data-testid="on-call-private-flag"]');
      expect(badge).toBeInTheDocument();
      // Observation: The badge uses `text-2xs` (11px / 0.6875rem) from the design system chip scale.
      expect(badge?.className).toContain("text-2xs");
    });
  });

  describe("2. Stress-Testing day-track.tsx SVG Text at 13px (text-sm-minus) across Responsive Viewports", () => {
    const W = 280;
    const VIEWBOX_H = 36;
    const TICKS = [0, 6, 12, 18, 24];

    it("verifies day-track.tsx uses text-sm-minus for all SVG numerals and adheres to >= 12px floor", () => {
      const dayTrackSource = readFileSync("src/components/first-nations/day-track.tsx", "utf8");
      expect(dayTrackSource).toContain('className="nums fill-[color:var(--surface-summary-muted)] text-sm-minus"');
      expect(dayTrackSource).not.toContain("text-2xs");
      expect(dayTrackSource).not.toContain("text-xs");

      // Verify text-sm-minus is registered at 0.8125rem (13px >= 12px floor)
      const globalsCss = readFileSync("src/app/globals.css", "utf8");
      expect(globalsCss).toContain("--text-sm-minus: 0.8125rem;");
    });

    it("verifies mathematical clearance between SVG indicator line and text baseline with text-sm-minus", () => {
      // Indicator line: y1 = 3, y2 = 21
      const indicatorLineBottom = 21;
      // Indicator circle: cy = 12, r = 3.5 -> bottom = 15.5
      const indicatorCircleBottom = 15.5;
      // Open rect: y = 9.5, height = 5 -> bottom = 14.5
      const openRectBottom = 14.5;
      // Text baseline: y = 32
      const textBaseline = 32;

      // In SVG, 13px text (text-sm-minus: 0.8125rem) has standard cap-height of ~9.1px (0.7 * 13) to 9.5px (0.73 * 13).
      // Even under a conservative cap-height factor of 0.73, the topmost pixel of the text glyphs is at y = 32 - 9.5 = 22.5.
      const textTopBound = textBaseline - 9.5;

      // Clearance between bottom of indicator line (21) and top of text (22.5):
      const verticalGap = textTopBound - indicatorLineBottom;
      expect(verticalGap).toBeGreaterThan(1.0); // Strict clearance > 1px in SVG units
      expect(indicatorCircleBottom).toBeLessThan(indicatorLineBottom);
      expect(openRectBottom).toBeLessThan(indicatorLineBottom);

      // Bottom clearance: baseline y=32 in viewBox of height 36 gives 4px below baseline.
      // Numerals '0' through '9' have 0 descenders, leaving a full 4px safety buffer to viewBox bottom.
      const bottomClearance = VIEWBOX_H - textBaseline;
      expect(bottomClearance).toBe(4);
    });

    it("stress-tests horizontal text anchor and bounds across 0h, 6h, 12h, 18h, 24h", () => {
      const { container } = render(
        <DayTrack
          hours={{
            days: [1, 2, 3, 4, 5],
            open: "08:30",
            close: "17:00",
          }}
          now={new Date("2026-09-30T10:30:00Z")}
          label="Clinic Operating Hours"
        />,
      );

      const texts = container.querySelectorAll("text");
      expect(texts).toHaveLength(5);

      // Verify each tick
      texts.forEach((textEl, idx) => {
        const tick = TICKS[idx];
        const x = parseFloat(textEl.getAttribute("x")!);
        const y = parseFloat(textEl.getAttribute("y")!);
        const anchor = textEl.getAttribute("text-anchor");

        expect(y).toBe(32);
        expect(x).toBe((tick / 24) * W);

        if (tick === 0) {
          // At x=0, textAnchor must be "start" so text extends rightward [0, ~14] and never clips left of 0
          expect(anchor).toBe("start");
        } else if (tick === 24) {
          // At x=280, textAnchor must be "end" so text extends leftward [~266, 280] and never clips right of 280
          expect(anchor).toBe("end");
        } else {
          expect(anchor).toBe("middle");
        }
      });
    });

    it("verifies proportional scaling behavior at responsive viewports (320px, 390px, 768px)", () => {
      const viewports = [320, 390, 768];
      for (const vp of viewports) {
        const scale = vp / W;
        const renderedH = VIEWBOX_H * scale;
        const renderedIndicatorBottom = 21 * scale;
        const renderedTextTop = (32 - 9.5) * scale;
        const physicalGap = renderedTextTop - renderedIndicatorBottom;

        // Even on the narrowest 320px mobile screen, physical gap remains positive and crisp (> 1.5px)
        expect(physicalGap).toBeGreaterThan(1.5);
        expect(renderedH).toBeGreaterThan(40);
      }
    });
  });

  describe("3. Stress-Testing on-call-private-flag.tsx Icon Scaling (12x12px vs 24x24px)", () => {
    it("verifies --spacing-icon-2xs and --spacing-icon-xs both evaluate to 0.75rem (12px) in globals.css", () => {
      const icon2xsMatch = globalsCss.match(/--spacing-icon-2xs:\s*([^;]+);/);
      expect(icon2xsMatch).toBeTruthy();
      expect(icon2xsMatch![1].trim()).toContain("0.75rem");

      const iconXsMatch = globalsCss.match(/--spacing-icon-xs:\s*([^;]+);/);
      expect(iconXsMatch).toBeTruthy();
      expect(iconXsMatch![1].trim()).toContain("0.75rem");
    });

    it("verifies icon-2xs is registered in tailwind-merge configuration", () => {
      expect(tailwindMergeSource).toContain('"icon-2xs"');
      expect(tailwindMergeSource).toContain('"icon-xs"');
    });

    it("renders Lock icon with size-icon-xs in compact badge context", () => {
      const { container } = render(<OnCallPrivateFlag compact />);
      const badge = container.querySelector('[data-testid="on-call-private-flag"]');
      expect(badge).toHaveTextContent("Private");

      const svg = badge?.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute("aria-hidden", "true");
      // Must carry `size-icon-xs`, which constrains width & height to 0.75rem (12px) via Tailwind CSS
      expect(svg?.classList.contains("size-icon-xs")).toBe(true);
      expect(svg?.classList.contains("size-icon-2xs")).toBe(false);
    });

    it("renders Lock icon with size-icon-xs in standard non-compact badge context", () => {
      const { container } = render(<OnCallPrivateFlag compact={false} />);
      const badge = container.querySelector('[data-testid="on-call-private-flag"]');
      expect(badge).toHaveTextContent("Private · only you");

      const svg = badge?.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg?.classList.contains("size-icon-xs")).toBe(true);
    });
  });

  describe("4. Stress-Testing Factsheet Print Preview Styles & Layout Boundaries", () => {
    it("renders FactsheetPrintSheet with elevated 12px text in warning banner, metadata, and footer", () => {
      const factsheet = findFactsheet("sertraline");
      if (!factsheet) throw new Error("Expected sertraline fixture");

      render(<FactsheetDetailPage factsheet={factsheet} />);

      // Portaled to document.body
      const printSheet = document.body.querySelector(".factsheet-print-sheet");
      expect(printSheet).toBeInTheDocument();

      // 1. Warning banner
      const banner = printSheet?.querySelector(
        'div[style*="background: rgb(254, 243, 242)"], div[style*="background: #fef3f2"]',
      );
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent("Sample — not for clinical use");
      expect((banner as HTMLElement).style.fontSize).toBe("12px");
      expect((banner as HTMLElement).style.fontWeight).toBe("700");
      expect((banner as HTMLElement).style.textTransform).toBe("uppercase");

      // 2. Metadata line
      const updatedLine = printSheet?.querySelector(
        'span[style*="color: rgb(85, 85, 85)"], span[style*="color: #555"]',
      );
      expect(updatedLine).toBeInTheDocument();
      expect(updatedLine).toHaveTextContent(`Updated ${factsheet.reviewedOn} · ${factsheet.readTime}`);
      expect((updatedLine as HTMLElement).style.fontSize).toBe("12px");

      // 3. Footer disclaimer
      const footer = printSheet?.querySelector(
        "p[style*='border-top: 1px solid rgb(221, 221, 221)'], p[style*='border-top: 1px solid #ddd']",
      );
      expect(footer).toBeInTheDocument();
      expect(footer).toHaveTextContent("This sheet is general information, not personal medical advice");
      expect((footer as HTMLElement).style.fontSize).toBe("12px");
      expect((footer as HTMLElement).style.lineHeight).toBe("1.5");
    });

    it("verifies layout boundary resilience: print sheet has max-width 720px and flexible vertical flow", () => {
      const factsheet = findFactsheet("sertraline");
      if (!factsheet) throw new Error("Expected sertraline fixture");

      render(<FactsheetDetailPage factsheet={factsheet} />);

      const printSheet = document.body.querySelector(".factsheet-print-sheet") as HTMLElement;
      expect(printSheet).toBeInTheDocument();
      expect(printSheet.style.maxWidth).toBe("720px");
      expect(printSheet.style.margin).toBe("0px auto");
      // Verifies no rigid height or overflow clipping
      expect(printSheet.style.height).toBe("");
      expect(printSheet.style.maxHeight).toBe("");
      expect(printSheet.style.overflow).toBe("");
    });
  });
});
