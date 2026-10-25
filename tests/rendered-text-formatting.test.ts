import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guard against regressions where document-derived text is interpolated raw into
// JSX instead of being routed through a source-text formatter. Each assertion
// pins a surface that previously leaked raw extraction artifacts (stray bullets,
// ligatures, image-data blocks, page codes) into the UI.

function componentSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), "src", "components", relativePath), "utf8");
}

describe("document-derived text must route through a formatter", () => {
  const dashboard = componentSource("ClinicalDashboard.tsx");
  const documentViewer = componentSource("DocumentViewer.tsx");
  // Document-viewer render surfaces (source images/tables, pinned evidence, the
  // indexed-text panel, and the overview landing) now live in extracted modules
  // under document-viewer/. Scan them alongside the container so the raw-render
  // guards travel with the code as it moves out.
  const documentViewerSourcePanels = componentSource("document-viewer/source-panels.tsx");
  const documentViewerLanding = componentSource("document-viewer/document-overview-landing.tsx");
  const documentViewerSurfaces = `${documentViewer}\n${documentViewerSourcePanels}\n${documentViewerLanding}`;
  // Answer/evidence render surfaces (SourceImage, SourcePreviewContent,
  // NaturalLanguageAnswer, QuoteCards, EvidenceMapTable, …) now live in extracted
  // modules. Scan them alongside the monolith so the raw-render guards travel with
  // the code as it moves out — assertions check the combined dashboard surfaces.
  const answerContent = componentSource("clinical-dashboard/answer-content.tsx");
  const evidenceContent = componentSource("clinical-dashboard/evidence-panels.tsx");
  // evidenceMapRowsFromRenderModel (the evidence-map row projection) was extracted here so the
  // dashboard can import it without the heavy evidence-panels chunk; scan it so its formatter
  // guard travels with the code.
  const evidenceMapModel = componentSource("clinical-dashboard/evidence-map-model.ts");
  const outputPanel = componentSource("clinical-dashboard/output-panel.tsx");
  const visualEvidence = componentSource("clinical-dashboard/visual-evidence.tsx");
  const documentResults = componentSource("clinical-dashboard/document-results.tsx");
  const answerResultSurface = componentSource("clinical-dashboard/answer-result-surface.tsx");
  // The source rail and drawer are where cited titles, passages and snippets are
  // rendered now — the capsule preview they replaced was scanned here, so they
  // inherit the same raw-render guards rather than escaping them by moving.
  const answerSourceRail = componentSource("clinical-dashboard/answer-source-rail.tsx");
  const answerSourceDrawer = componentSource("clinical-dashboard/answer-source-drawer.tsx");
  const answerSourceRows = componentSource("clinical-dashboard/answer-source-rows.ts");
  const answerEvidencePreview = componentSource("clinical-dashboard/answer-evidence-preview.tsx");
  const dashboardSurfaces = `${dashboard}\n${answerContent}\n${evidenceContent}\n${evidenceMapModel}\n${outputPanel}\n${visualEvidence}\n${documentResults}\n${answerResultSurface}\n${answerSourceRail}\n${answerSourceDrawer}\n${answerSourceRows}\n${answerEvidencePreview}`;

  it("renders exact quotes through the verbatim cleaner, never raw", () => {
    // Allow `${quote.quote}` inside template literals (React keys, clipboard text);
    // only a bare JSX child `{quote.quote}` is a raw-render regression.
    expect(dashboardSurfaces).not.toMatch(/(?<!\$)\{quote\.quote\}/);
    expect(dashboardSurfaces).toContain("sourceTextForVerbatimQuote(quote.quote)");
  });

  it("renders document titles through cleanDisplayTitle, never raw", () => {
    expect(dashboardSurfaces).not.toMatch(/\{source\.title\}/);
    expect(dashboardSurfaces).toContain("cleanDisplayTitle(");
  });

  it("renders extracted table snippets through a compact formatter, never raw", () => {
    expect(dashboardSurfaces).not.toMatch(/>\s*\{item\.tableTextSnippet\}\s*</);
    expect(dashboardSurfaces).toContain("sourceTextForCompactDisplay(item.tableTextSnippet)");
  });

  it("renders source-card snippets through compactSourceSnippet with the card title deduped", () => {
    // The raw-render half is unconditional and is the actual regression guard.
    expect(dashboardSurfaces).not.toMatch(/(?<!\$)\{source\.snippet\}/);
    expect(dashboardSurfaces).not.toMatch(/(?<!\$)\{source\.content\}/);

    // The routing half is conditional because these surfaces no longer print a
    // snippet at all: the evidence preview was rewritten from a card grid with
    // snippets into a rail of title + page + review status, and the arrived
    // answer carries its quote in the drawer. `compactSourceSnippet` is kept as
    // the contract any reintroduced snippet must go through — the moment one of
    // these surfaces touches `source.content` again, this fails unless it is
    // formatted and the card title is deduped out of it.
    if (dashboardSurfaces.includes("source.content")) {
      expect(dashboardSurfaces).toContain("compactSourceSnippet(source.content, { dropTitle: title })");
    }
  });

  it("renders evidence-map row details through the compact formatter, never raw", () => {
    expect(dashboardSurfaces).toContain("sourceTextForCompactDisplay(row.quote || row.source.snippet");
  });

  it("renders document-viewer image captions through a formatter, never raw", () => {
    expect(documentViewerSurfaces).not.toMatch(/\{image\.caption\}/);
    expect(documentViewerSurfaces).toContain("sourceTextForCompactDisplay(image.caption)");
  });

  it("renders visual-evidence titles and alt text through formatters, never raw", () => {
    expect(dashboardSurfaces).not.toMatch(/(?<!\$)\{item\.title\}/);
    expect(dashboardSurfaces).not.toMatch(/caption=\{item\.caption\}/);
  });

  it("cleans displayed quotes through the verbatim cleaner", () => {
    // One call for the rendered blockquote. The quote-card clipboard formatter that made the
    // second call was deleted unused on 25 Oct 2026 (it had no caller outside tests).
    const cleanerCalls = dashboardSurfaces.match(/sourceTextForVerbatimQuote\(quote\.quote\)/g) ?? [];
    expect(cleanerCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("citation labels repair extraction glyphs centrally", () => {
  it("citations.ts cleans titles before building any label", () => {
    const citations = readFileSync(resolve(process.cwd(), "src", "lib", "citations.ts"), "utf8");
    expect(citations).toContain("normalizeExtractedGlyphs");
    expect(citations).toMatch(/cleanCitationTitle\(citation\.title/);
  });
});
