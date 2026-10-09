import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const frameSource = readFileSync(
  fileURLToPath(new URL("../src/components/ui/document-frame.tsx", import.meta.url)),
  "utf8",
);
const viewerSource = readFileSync(
  fileURLToPath(new URL("../src/components/DocumentViewer.tsx", import.meta.url)),
  "utf8",
);
const pdfOwnerSource = readFileSync(
  fileURLToPath(new URL("../src/components/document-viewer/pdf-canvas-viewer.tsx", import.meta.url)),
  "utf8",
);
const imageOwnerSource = readFileSync(
  fileURLToPath(new URL("../src/components/document-viewer/non-pdf-source-preview.tsx", import.meta.url)),
  "utf8",
);
const globalStyles = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8");

describe("DocumentFrame contract", () => {
  it("hides frame controls for print while keeping source content together", () => {
    expect(frameSource).toContain("data-print-hide");
    expect(frameSource).toContain("data-print-keep-together");
    expect(frameSource).toContain("print:break-inside-avoid");
    expect(frameSource).toContain("print:bg-transparent");
    expect(frameSource).toContain("print:shadow-none");
  });

  it("keeps colour transformations out of the frame and both source-pixel owners", () => {
    const forbiddenSourcePixelTreatment = /\b(?:invert|color-scheme|backdrop-filter)\b|\bfilter\s*:/i;
    expect(frameSource).not.toMatch(forbiddenSourcePixelTreatment);
    expect(pdfOwnerSource).not.toMatch(forbiddenSourcePixelTreatment);
    expect(imageOwnerSource).not.toMatch(forbiddenSourcePixelTreatment);
  });

  it("adopts one frame that owns every viewing control, leaving source owners the pixels", () => {
    expect(viewerSource).toContain(
      'import { DocumentFrame, type DocumentFrameControls, type DocumentFrameSource } from "@/components/ui/document-frame"',
    );
    expect(viewerSource.match(/<DocumentFrame\b/g)).toHaveLength(1);
    expect(viewerSource).toContain("controls={pdfFrameControls}");
    expect(viewerSource).toContain("<PdfCanvasViewer");
    expect(viewerSource).toContain("<NonPdfSourcePreview");
    expect(viewerSource).toContain("onFitWidthChange={handlePdfFitWidthChange}");
    expect(viewerSource).toContain("onZoomChange={handlePdfZoomChange}");

    // One toolbar, one page readout, one meaning per icon. The PDF owner used to
    // ship a second toolbar with its own page number and a Maximize2 that meant
    // "fullscreen" while the frame's Maximize2 meant "fit width".
    expect(frameSource.match(/data-testid="document-frame-controls"/g)).toHaveLength(1);
    expect(pdfOwnerSource).not.toContain('data-testid="pdf-toolbar"');
    expect(pdfOwnerSource).not.toContain('role="toolbar"');
    expect(pdfOwnerSource).not.toContain("frameOwnsZoomChrome");
    expect(frameSource).toContain('"Enter fullscreen document view"');
    expect(frameSource).toContain('"Exit fullscreen document view"');
    expect(frameSource).toContain('aria-label="Fit document to width"');
    expect(frameSource).not.toContain('"Fit page width and enter fullscreen"');

    // Rapid wheel/pinch functional updates must compose against a ref, not a
    // closed-over zoom prop (Sentry 15778840). The PDF owner is fully controlled
    // now, so the ref is the only thing standing between a pinch and dropped deltas.
    expect(pdfOwnerSource).toContain("zoomRef");
    expect(pdfOwnerSource).toContain("resolveViewerZoomUpdate");
    expect(pdfOwnerSource).toContain("const clamped = resolveViewerZoomUpdate(zoomRef.current, next)");

    expect(viewerSource).toContain('from "@/components/document-viewer/viewer-zoom"');
    expect(pdfOwnerSource).toContain('from "@/components/document-viewer/viewer-zoom"');
    expect(frameSource).toContain('from "@/components/document-viewer/viewer-zoom"');
  });

  it("keeps pinch live in the default fit mode and rasters inside the canvas budget", () => {
    // Pinch must not be re-gated on `!fitWidth`: fit is the viewer's default, so
    // that gate made the default state ungesturable, against the blocking phone
    // clause in docs/design-system/COMPONENTS.md.
    expect(pdfOwnerSource).toContain("pinchZoom: pagesReady,");
    expect(pdfOwnerSource).not.toContain("pinchZoom: pagesReady && !fitWidth");
    // Drag-to-pan stays gated — fit mode needs native momentum scrolling.
    expect(pdfOwnerSource).toContain("pan: pagesReady && !fitWidth");

    // WebKit paints nothing above ~2^24 canvas pixels; a flat device-density
    // output scale asked for three times that at maximum zoom on an iPhone.
    expect(pdfOwnerSource).toContain("resolveCanvasRasterPlan");
    expect(pdfOwnerSource).not.toMatch(/Math\.min\(MAX_RENDER_SCALE, window\.devicePixelRatio/);
  });

  it("announces canvas-level PDF preview failures after the frame is already ready", () => {
    // Visible fallback stays non-live; LiveAnnouncer owns the assertive SR path (#219).
    expect(pdfOwnerSource).not.toContain('role="alert"');
    expect(pdfOwnerSource).toContain('data-preview-error="true"');
    expect(pdfOwnerSource).toContain("announce(error");
    expect(pdfOwnerSource).toContain('from "@/components/ui/live-announcer"');
    expect(imageOwnerSource).not.toContain('role="alert"');
    expect(imageOwnerSource).toContain('data-preview-error="true"');
  });

  it("removes app chrome and background scrolling from the iOS fullscreen fallback", () => {
    expect(frameSource).toContain('data-fullscreen-fallback={fullscreenFallback ? "on" : undefined}');
    expect(globalStyles).toContain('html:has([data-document-frame][data-fullscreen-fallback="on"])');
    expect(globalStyles).toContain(
      ":is(.phone-sticky-header-stack, .universal-header, [data-document-sticky-header], .document-viewer-composer)",
    );
    expect(globalStyles).toContain("overscroll-behavior: none");
  });
});

// The phone reading order is source-first: compact identity, embedded PDF,
// pinned evidence, clinical priorities, indexed text, then the context rail.
describe("document viewer phone reading order", () => {
  const landingSource = readFileSync(
    fileURLToPath(new URL("../src/components/document-viewer/document-overview-landing.tsx", import.meta.url)),
    "utf8",
  );
  const contentPanelsSource = readFileSync(
    fileURLToPath(new URL("../src/components/document-viewer/document-viewer-content-panels.tsx", import.meta.url)),
    "utf8",
  );

  it("keeps the clinical summary out of the overview landing", () => {
    expect(landingSource).not.toContain("DocumentClinicalSummary");
    expect(contentPanelsSource).toContain("<DocumentClinicalSummary");
    expect(viewerSource).toContain("<DocumentViewerContentPanels");
  });

  it("orders every phone grid child explicitly and keeps summary/text after the PDF", () => {
    // An unordered grid item defaults to `order: 0` and would sort before
    // `order-1`, so the rail in particular must carry its own late slot.
    expect(viewerSource).toContain("max-sm:order-1");
    expect(viewerSource).toContain("max-sm:order-2");
    expect(viewerSource).toContain("max-sm:order-3");
    expect(viewerSource).not.toContain("max-sm:order-4");

    const overview = viewerSource.indexOf("max-sm:order-1");
    const sourceColumn = viewerSource.indexOf("max-sm:order-2");
    const rail = viewerSource.indexOf("max-sm:order-3");
    expect(overview).toBeGreaterThan(-1);
    expect(sourceColumn).toBeGreaterThan(-1);
    expect(rail).toBeGreaterThan(-1);

    const preview = viewerSource.indexOf('id="pdf-preview-section"');
    const panels = viewerSource.indexOf("<DocumentViewerContentPanels");
    expect(preview).toBeGreaterThan(sourceColumn);
    expect(panels).toBeGreaterThan(preview);

    const summaryCard = contentPanelsSource.indexOf('id="source-summary-card"');
    const indexedText = contentPanelsSource.indexOf("<IndexedTextPanel");
    expect(summaryCard).toBeGreaterThan(-1);
    expect(indexedText).toBeGreaterThan(summaryCard);
  });
});
