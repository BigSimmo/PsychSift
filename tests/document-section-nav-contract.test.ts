import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sourceSegment } from "./helpers/source-contract";

/**
 * Cheap wiring contract for document section navigation.
 *
 * Production UI on PR #1311 failed twice for the same class of drift:
 * 1. `DocumentClinicalSummary` and the DocumentViewer overview wrapper both
 *    claimed `id="document-overview"`, so `expectDomIntegrity` failed.
 * 2. ui-smoke still drove the retired in-flow "Document viewer sections" nav
 *    and required a "Tables and diagrams" sheet row for the lithium demo doc,
 *    which omits that row when `visualCount === 0`.
 *
 * Chromium proof stays in `tests/ui-smoke.spec.ts`; this file keeps the cheap
 * suite honest about the ownership and selectors that proof depends on.
 */

const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const documentViewerSource = read("src/components/DocumentViewer.tsx");
const clinicalSummarySource = read("src/components/document-viewer/document-clinical-summary.tsx");
const sectionIndexSource = read("src/components/document-viewer/section-index.ts");
const sectionNavSource = read("src/components/document-viewer/section-nav.tsx");
const uiSmokeSource = read("tests/ui-smoke.spec.ts");
const lithiumDemoSource = read("src/lib/demo-data.ts");

describe("document section navigation ownership", () => {
  it("keeps a single document-overview section id owner", () => {
    // The overview landing wrapper is the scroll target. A second id on the
    // clinical summary card duplicates the DOM id and fails ui-smoke integrity.
    expect(documentViewerSource).toContain("id={documentOverviewSectionId}");
    expect(clinicalSummarySource).not.toMatch(/\bid=["']document-overview["']/);
    expect(clinicalSummarySource).not.toContain("id={documentOverviewSectionId}");
    expect(clinicalSummarySource).toContain('data-testid="document-clinical-summary"');
  });

  it("exposes phone section navigation through the title sheet, not an in-flow nav row", () => {
    expect(documentViewerSource).toContain('data-testid="document-section-trigger"');
    expect(sectionNavSource).toContain('testId="document-section-sheet"');
    expect(documentViewerSource).not.toMatch(/Document viewer sections/);
    expect(sectionNavSource).not.toMatch(/Document viewer sections/);
  });

  it("omits Tables and diagrams from the index when a ready document has no visuals", () => {
    // The lithium demo document used by ui-smoke has image_count: 0.
    // Requiring that label in the phone sheet will red Production UI again.
    expect(sectionIndexSource).toContain("input.visualCount > 0");
    expect(lithiumDemoSource).toMatch(/id:\s*"11111111-1111-4111-8111-111111111111"[\s\S]*?image_count:\s*0/);
  });

  it("keeps document-viewer ui-smoke on the current phone section chrome", () => {
    const documentViewerSmoke = sourceSegment(
      uiSmokeSource,
      'test("document viewer puts the matching passage above the PDF preview',
      'test("answer glass header overlays main',
      { label: "document viewer phone section smoke" },
    );

    expect(documentViewerSmoke).toContain('getByTestId("document-section-trigger")');
    expect(documentViewerSmoke).toContain('getByTestId("document-section-sheet")');
    expect(documentViewerSmoke).not.toMatch(
      /getByRole\(\s*["']navigation["']\s*,\s*\{\s*name:\s*["']Document viewer sections["']/,
    );
    // Demo docs without visuals leave Tables and diagrams out entirely, so
    // the smoke proves the section is absent rather than opening it.
    expect(documentViewerSmoke).toContain("await expect(images).toHaveCount(0)");
    expect(documentViewerSmoke).toContain("openIndexingDisclosure");
  });
});
