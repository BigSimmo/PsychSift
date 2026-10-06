import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceSegment } from "./helpers/source-contract";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("document detail loading contract", () => {
  it("uses one server-only authorized loader from both the route and page", () => {
    const loader = source("src/lib/document-detail.ts");
    const route = source("src/app/api/documents/[id]/route.ts");
    const page = source("src/app/(search-app)/documents/[id]/page.tsx");

    expect(loader).toContain('import "server-only"');
    expect(loader).toContain("loadAuthorizedDocumentDetail");
    expect(route).toContain("loadAuthorizedDocumentDetail");
    expect(page).toContain("loadAuthorizedDocumentDetail");
    expect(page).toContain("initialDetail={initialDetail}");
    expect(page).toContain("initialError={initialError}");
    // Page/chunk updates stay inside DocumentViewer via URL sync — remounting
    // on every page flip reloaded the PDF and felt like loading lag.
    expect(page).toContain("key={id}");
    expect(page).not.toContain('key={`${id}:${initialPage}:${query.chunk ?? ""}`}');
  });

  it("supports document and window asset scopes and starts independent detail reads together", () => {
    const loader = source("src/lib/document-detail.ts");

    expect(loader).toContain('assetScope: "document" | "window"');
    expect(loader).toContain("Promise.all([");
    expect(loader).toContain("pagesRequest");
    expect(loader).toContain("chunksRequest");
    expect(loader).toContain("imagesRequest");
    expect(loader).toContain("tableFactsRequest");
    expect(loader).toContain("labelsRequest");
    expect(loader).toContain("summaryRequest");
    expect(loader).toContain("selectedImageIds(selectedChunk)");
    expect(loader).toContain("imagesRequest.or(imageWindowFilter");
    expect(loader).toContain("documentViewImageVisibility");
    expect(loader).toContain(
      "or(searchable.eq.true,source_kind.eq.table_crop,metadata->>retained_for_document_view.eq.true)",
    );
    expect(loader).toContain("and(image_type.neq.logo_decorative,${documentViewImageVisibility},page_number.gte.");
    expect(loader).toContain("id.in.(${imageIds.join");
    expect(loader).toContain("tableFactsRequest.or(tableFactWindowFilter");
    expect(loader).toContain("page_number.is.null");

    const chunkGenerationFilter = loader.indexOf("const filteredChunkQuery = generationFilter");
    const chunkRange = loader.indexOf("orderedChunkQuery.range", chunkGenerationFilter);
    const tableFactGenerationFilter = loader.indexOf("tableFactsRequest = tableFactsRequest.or(generationFilter)");
    const tableFactLimit = loader.indexOf(".limit(200)", tableFactGenerationFilter);
    expect(chunkGenerationFilter).toBeGreaterThan(-1);
    expect(chunkRange).toBeGreaterThan(chunkGenerationFilter);
    expect(tableFactGenerationFilter).toBeGreaterThan(-1);
    expect(tableFactLimit).toBeGreaterThan(tableFactGenerationFilter);
  });

  it("cancels every database phase and projects only viewer fields", () => {
    const loader = source("src/lib/document-detail.ts");
    const abortAttachments = loader.match(/\.abortSignal\(args\.request\.signal\)/g) ?? [];

    expect(abortAttachments).toHaveLength(8);
    expect(loader).toContain("args.request.signal.throwIfAborted()");
    expect(loader).not.toContain('.select("*")');
    expect(loader).toContain("documentDetailProjection");
    expect(loader).toContain("tableFactDetailProjection");
    expect(loader).toContain("map(withoutMetadata)");
    expect(loader).toContain("map(withTableFactReviewMetadata)");
    expect(loader).toContain("map(withDocumentLabelReviewMetadata)");
    expect(loader).toContain("isHiddenDocumentLabel");
    expect(loader).toContain('metadataNumber(metadata, "row_count")');
    expect(loader).toContain('metadataBoolean(metadata, "rows_truncated")');
    expect(loader).toContain('metadataNumber(metadata, "crop_completeness")');
    expect(loader).toContain('metadataNumber(metadata, "structured_extraction_confidence")');
  });

  it("returns explicit demo, scope, and request-window metadata", () => {
    const loader = source("src/lib/document-detail.ts");

    expect(loader).toContain("demoMode:");
    expect(loader).toContain("assetScope:");
    expect(loader).toContain("window:");
    expect(loader).toContain("requestedPage:");
    expect(loader).toContain("effectivePage:");
  });
});

describe("document viewer latency guards", () => {
  it("server-prerenders the viewer without a setup-status round trip", () => {
    const lazy = source("src/components/document-viewer-lazy.tsx");
    const viewer = source("src/components/DocumentViewer.tsx");

    expect(lazy).not.toContain("ssr: false");
    expect(viewer).not.toContain("/api/setup-status");
  });

  it("loads window-scoped navigation details and renders one indexed-text panel", () => {
    const viewer = source("src/components/DocumentViewer.tsx");
    const routeHook = source("src/components/document-viewer/use-document-viewer-route.ts");
    const contentPanels = source("src/components/document-viewer/document-viewer-content-panels.tsx");
    const panelInstances = contentPanels.match(/<IndexedTextPanel\b/g) ?? [];
    // `useEffect` as an end marker is an arbitrary token, not a structure —
    // DocumentViewer has several. Guarded so a reorder fails loudly instead of
    // widening this window to the rest of the file.
    const retryBlock = sourceSegment(viewer, "const retryPreview", "useEffect", {
      label: "DocumentViewer retryPreview block",
    });

    expect(viewer).toContain('assetScope: "window"');
    expect(viewer).toContain("useInitialResult");
    expect(viewer).toContain("initialDetail?.document");
    expect(viewer).toContain("initialDetail?.pages");
    expect(viewer).toContain("detailRequestSequenceRef");
    expect(viewer).toContain("detailControllerRef.current?.abort()");
    expect(viewer).toContain("pageByNumber");
    expect(viewer).toContain("chunkById");
    expect(viewer).toContain("useDocumentViewerRoute");
    expect(routeHook).toContain("window.history.replaceState");
    expect(routeHook).not.toContain("window.history.pushState");
    expect(viewer).not.toContain("router.push(documentPageHref");
    expect(viewer).toContain("localProjectIdentityPromiseRef.current = null");
    expect(retryBlock).toContain("setLocalProjectReady(true)");
    expect(viewer).toContain("setPages(rowsById(detail.pages))");
    expect(viewer).not.toContain("mergeRowsById");
    expect(viewer).toContain("Never retain evidence from the previous page");
    expect(panelInstances).toHaveLength(1);
    expect(viewer).not.toMatch(/<IndexedTextPanel\b/);
  });

  it("mints preview and download URLs only from explicit actions", () => {
    const viewer = source("src/components/DocumentViewer.tsx");

    expect(viewer).toContain("openSourcePreview");
    expect(viewer).toContain("openSourceDownload");
    expect(viewer).toContain("downloadActionRef");
    expect(viewer.indexOf("?download=true")).toBeGreaterThan(viewer.indexOf("openSourceDownload"));
    expect(viewer).not.toContain("fetchSignedUrlPair");
  });

  it("keeps indexed-text search separate from answer generation and discards stale hits", () => {
    const viewer = source("src/components/DocumentViewer.tsx");
    const panels = source("src/components/document-viewer/source-panels.tsx");

    const searchComposer = source("src/components/document-viewer/document-viewer-search-composer.tsx");
    expect(viewer).toMatch(
      /const currentDocumentSearchResults =\s*documentSearchState\.query === normalizedSourceSearch/,
    );
    expect(viewer).toContain("submitSourceSearch");
    expect(viewer).toContain("sourceSearchInputRef.current?.focus()");
    expect(viewer).toContain("<DocumentViewerSearchComposer");
    expect(searchComposer).toContain("Search within this document");
    expect(viewer).toContain("documentsSearchHref({ query: tag.searchText || tag.label, run: true })");
    expect(viewer).not.toContain("Search or answer from this document");
    expect(panels).toContain("Enter at least 2 characters to search all indexed passages.");
    expect(panels).toContain("const searchEligible = normalizedSearch.length >= 2;");
    expect(panels).toContain("const displayChunks = useMemo(");
  });

  it("wires filmstrip page jumps through navigateToPage without remounting the PDF viewer", () => {
    const viewer = source("src/components/DocumentViewer.tsx");
    // The visuals panel sits in the main reading column, not the rail; the wiring
    // guarded here is the same either way.
    const visuals = source("src/components/document-viewer/document-visuals-panel.tsx");
    const filmstrip = source("src/components/document-viewer/document-image-filmstrip.tsx");
    const routeHook = source("src/components/document-viewer/use-document-viewer-route.ts");

    const contentPanels = source("src/components/document-viewer/document-viewer-content-panels.tsx");
    expect(contentPanels).toContain("onSelectPage={navigateToPage}");
    expect(viewer).toContain("navigateToPage={navigateToPage}");
    expect(viewer).toContain("activePage={activePage}");
    expect(visuals).toContain("DocumentImageFilmstrip");
    expect(visuals).toContain("onSelectPage={onSelectPage}");
    expect(filmstrip).toContain('data-testid="document-image-filmstrip"');
    expect(routeHook).toContain("window.history.replaceState");
    expect(routeHook).not.toContain("window.history.pushState");
    expect(viewer).not.toContain("router.push(documentPageHref");
    // Page must not be part of the canvas key — that remounts pdf.js on every flip.
    expect(viewer).toContain("key={documentId}");
    expect(viewer).not.toMatch(/key=\{`\$\{documentId\}.*\$\{activePage\}/);
  });
});
