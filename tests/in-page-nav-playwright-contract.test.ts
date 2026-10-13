import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sourceSegment } from "./helpers/source-contract";

/**
 * Guards the Production UI failures that blocked PR #1781:
 *
 * 1. InPageNavHeader's back control is always named `Back to ${label}` via
 *    aria-label. Asserting the bare mode label (`Medications`, exact) passes on
 *    desktop (visible text) and fails on phone (`hidden sm:inline`). An autofix
 *    that only patches the desktop prescribing smoke left shard 2 red.
 * 2. `form-detail-header` (and every `*-detail-header` from InPageNavHeader) is a
 *    #093 settlement surface: bare getByTestId trips strict mode under
 *    Production UI load when a hidden twin remains.
 */

const UI_SMOKE = "tests/ui-smoke.spec.ts";
const UI_FORMS_SECTION_NAV = "tests/ui-forms-section-nav.spec.ts";
const IN_PAGE_NAV_HEADER = "src/components/in-page-nav/in-page-nav-header.tsx";

describe("in-page-nav Playwright contract", () => {
  it("prescribing smoke asserts the aria-label back name on both desktop and phone", () => {
    const source = readFileSync(UI_SMOKE, "utf8");
    const prescribingBlock = sourceSegment(
      source,
      'test("prescribing workflow uses in-app medication routes',
      'test("tablet document chrome keeps one new-chat action',
      { label: "prescribing smoke" },
    );

    expect(prescribingBlock).toContain('name: "Back to medications"');
    expect(prescribingBlock).not.toMatch(/getByRole\(\s*["']link["']\s*,\s*\{\s*name:\s*["']Medications["']/);
    // Both the desktop and phone prescribing tests must use the aria-label form.
    expect(prescribingBlock.match(/Back to medications/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("cross-mode quick-links smoke uses the aria-label back name, not Breadcrumb/Medications", () => {
    // Production UI (2) on PR #1788 timed out waiting for Breadcrumb >
    // Medications exact inside medication-page-*; the back control lives in
    // MedicationNavHeader with aria-label "Back to medications".
    const source = readFileSync(UI_SMOKE, "utf8");
    const quickLinksBlock = sourceSegment(
      source,
      'test("answer results surface cross-mode quick links"',
      'test("answer mode keeps prior turns visible for follow-up questions"',
      { label: "answer cross-mode quick-links smoke" },
    );

    expect(quickLinksBlock).toContain('name: "Back to medications"');
    expect(quickLinksBlock).not.toMatch(/name:\s*["']Breadcrumb["']/);
    expect(quickLinksBlock).not.toMatch(/getByRole\(\s*["']link["']\s*,\s*\{\s*name:\s*["']Medications["']/);
  });

  it("forms section-nav scopes form-detail-header through visibleByTestId", () => {
    const source = readFileSync(UI_FORMS_SECTION_NAV, "utf8");
    expect(source).toMatch(/import\s*\{[^}]*\bvisibleByTestId\b[^}]*\}\s*from\s*["']\.\/playwright-settlement["']/);
    expect(source).toContain('visibleByTestId(page, "form-detail-header")');
    expect(source).not.toMatch(/getByTestId\(\s*["']form-detail-header["']\s*\)/);
  });

  it("InPageNavHeader keeps the Back to ${label} aria-label contract", () => {
    // Back is drawn in the top bar (header standard, 13 Oct 2026); WorkPageBack
    // names it `Back to ${label}`, so the label is passed lowercased.
    const source = readFileSync(IN_PAGE_NAV_HEADER, "utf8");
    expect(source).toContain("<WorkPageBack href={back.href} label={back.label.toLowerCase()}");
  });

  it("InPageNavHeader's back control is the top bar's 48px round button", () => {
    const source = readFileSync("src/components/work-frame/work-page-back.tsx", "utf8");
    expect(source).toContain('className: "universal-header-icon-control work-frame-back"');
  });
});
