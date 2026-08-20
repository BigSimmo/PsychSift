"use client";

import { useRouter } from "next/navigation";
import {
  CircleAlert,
  ArrowLeft,
  ChevronDown,
  Download,
  Ellipsis,
  ExternalLink,
  FileText,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { documentDisplayTitle } from "@/components/DocumentOrganizationBadges";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { PhoneFooterLayerPortal } from "@/components/clinical-dashboard/phone-footer-layer-portal";
import { useActiveScrollOwner } from "@/components/clinical-dashboard/use-active-scroll-owner";
import { PhoneHeaderCollapsePortal } from "@/components/clinical-dashboard/phone-header-collapse-portal";
import { useDocumentViewerChromeScroll } from "@/components/clinical-dashboard/use-document-viewer-chrome-scroll";
import { AnswerProgressStepper } from "@/components/clinical-dashboard/answer-status";
import {
  appBackdrop,
  cn,
  floatingControl,
  glassOverlaySurface,
  InlineNotice,
  panel,
  PanelHeading,
  sourceCard,
  textMuted,
} from "@/components/ui-primitives";
import { NonPdfSourcePreview } from "@/components/document-viewer/non-pdf-source-preview";
import { PdfCanvasViewer } from "@/components/document-viewer/pdf-readers-lazy";
import {
  requestSignedUrlPayload,
  rowsById,
  type SignedUrlResponsePayload,
} from "@/components/document-viewer/signed-url-request";
import { useDocumentSummarize } from "@/components/document-viewer/use-document-summarize";
import { useDocumentViewerRoute } from "@/components/document-viewer/use-document-viewer-route";
import { DocumentFrame, type DocumentFrameControls, type DocumentFrameSource } from "@/components/ui/document-frame";
import {
  VIEWER_DEFAULT_ZOOM,
  VIEWER_MAX_ZOOM,
  VIEWER_MIN_ZOOM,
  VIEWER_ZOOM_STEP,
} from "@/components/document-viewer/viewer-zoom";
import { clearCachedSignedUrl, getCachedSignedUrl, setCachedSignedUrl } from "@/lib/signed-url-cache";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import { readLocalProjectIdentity, unsafeLocalProjectMessage } from "@/lib/local-project-identity";
import {
  canSkipDetailRequest,
  documentLoadKey,
  documentPageHref,
  isFullDocumentReload,
  type LoadedDetailWindow,
  nextLoadedDocumentKey,
} from "@/lib/document-viewer-navigation";
import { partitionViewerImages } from "@/lib/image-filtering";
import { isLocalNoAuthMode } from "@/lib/client-env";
import { isAdministratorUser } from "@/lib/authorization";
import { authorizationIdentity } from "@/lib/authorization-header";
import { useAuthSession } from "@/lib/supabase/client";
import { SafeBoldText } from "@/components/SafeBoldText";
import { DocumentManagementActions } from "@/components/DocumentManagementActions";
import { Sheet } from "@/components/ui/sheet";
import type { ClinicalDocument, DocumentLabel } from "@/lib/types";
import { cleanClinicalSummaryText } from "@/lib/source-text-sanitizer";
import { formatDocumentSummary } from "@/lib/document-summary-formatting";
import { buildDocumentSummaryBadges } from "@/lib/document-summary-badges";
import { documentSummaryQuestion } from "@/lib/answer-contract";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import type { DocumentDetailPayload } from "@/lib/document-detail-contract";
import type {
  ChunkRow,
  DocumentIndexHealth,
  DocumentSearchResult,
  ImageRow,
  PageRow,
  TableFactRow,
} from "@/components/document-viewer/types";
import { IndexedTextPanel, PinnedSourceEvidence } from "@/components/document-viewer/source-panels";
import { DocumentViewerRail } from "@/components/document-viewer/document-rail-panels";
import { DocumentOverviewLanding } from "@/components/document-viewer/document-overview-landing";
import { DocumentClinicalSummary } from "@/components/document-viewer/document-clinical-summary";
import { buildDocumentSectionIndex, documentOverviewSectionId } from "@/components/document-viewer/section-index";
import {
  DocumentSectionSheet,
  DocumentSectionTrack,
  jumpToDocumentSection,
} from "@/components/document-viewer/section-nav";
import { useDocumentSectionSpy } from "@/components/document-viewer/use-section-spy";
import { useDocumentChromeMetrics } from "@/components/document-viewer/use-document-chrome-metrics";
import { useDocumentViewDensity } from "@/components/document-viewer/use-document-view-density";
import { usePrintableDisclosures } from "@/components/document-viewer/use-printable-disclosures";

const emptyDocumentSearchResults: DocumentSearchResult[] = [];

const secondaryButton = floatingControl;

/**
 * Renders the clinical document viewer with source previews, extracted content, summaries, and document tools.
 *
 * @param documentId - The identifier of the document to load.
 * @param initialPage - The page to display initially in the source preview.
 * @param chunkId - An optional indexed passage to pin as a cited excerpt above the PDF.
 * @returns The document viewer interface.
 */
export function DocumentViewer({
  documentId,
  initialPage,
  chunkId,
  initialDetail,
  initialError,
}: {
  documentId: string;
  initialPage: number;
  chunkId?: string;
  initialDetail?: DocumentDetailPayload;
  initialError?: string;
}) {
  const router = useRouter();
  const { activePage, activeChunkId, navigateToPage } = useDocumentViewerRoute({
    documentId,
    initialPage,
    chunkId,
  });
  usePrintableDisclosures();
  const [document, setDocument] = useState<ClinicalDocument | null>(() => initialDetail?.document ?? null);
  const [pages, setPages] = useState<PageRow[]>(() => initialDetail?.pages ?? []);
  const [images, setImages] = useState<ImageRow[]>(() => initialDetail?.images ?? []);
  const [tableFacts, setTableFacts] = useState<TableFactRow[]>(() => initialDetail?.tableFacts ?? []);
  const [chunks, setChunks] = useState<ChunkRow[]>(() => initialDetail?.chunks ?? []);
  const [indexHealth, setIndexHealth] = useState<DocumentIndexHealth | null>(() => initialDetail?.indexHealth ?? null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [downloadSignedUrl, setDownloadSignedUrl] = useState<string | null>(null);
  const generatedSummaryRef = useRef<HTMLElement | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(() => !initialDetail && !initialError);
  const [viewerError, setViewerError] = useState<string | null>(() => initialError ?? null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingSource, setDownloadingSource] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  // Cap consecutive expired-PDF signed-URL auto-refreshes; reset on document
  // change / successful reload so only an unrecoverable URL exhausts the budget.
  const signedUrlRefreshCountRef = useRef(0);
  const sourceSearchInputRef = useRef<HTMLInputElement | null>(null);
  const documentActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const documentSearchReturnFocusRef = useRef<HTMLElement | null>(null);
  const viewerRootRef = useRef<HTMLElement | null>(null);
  const [documentSearchOpen, setDocumentSearchOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [documentSearchState, setDocumentSearchState] = useState<{
    query: string;
    results: DocumentSearchResult[];
  }>({ query: "", results: [] });
  const [searchingDocument, setSearchingDocument] = useState(false);
  const [documentSearchError, setDocumentSearchError] = useState<string | null>(null);
  const normalizedSourceSearch = sourceSearch.replace(/\s+/g, " ").trim();
  const currentDocumentSearchResults =
    documentSearchState.query === normalizedSourceSearch ? documentSearchState.results : emptyDocumentSearchResults;
  const currentDocumentSearchError = documentSearchState.query === normalizedSourceSearch ? documentSearchError : null;
  const [reviewingTableFactId, setReviewingTableFactId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [localProjectReady, setLocalProjectReady] = useState(true);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [sectionSheetOpen, setSectionSheetOpen] = useState(false);
  const [compactView, setCompactView] = useDocumentViewDensity();
  // Explicit inspect intent keyed to the current document+citation. A stale
  // reveal from a prior deep-link must not survive into the next landing.
  const citationLandingKey = `${documentId}::${activeChunkId ?? ""}`;
  const [inspectRevealKey, setInspectRevealKey] = useState<string | null>(null);
  const [prevCitationLandingKey, setPrevCitationLandingKey] = useState(citationLandingKey);
  if (citationLandingKey !== prevCitationLandingKey) {
    setPrevCitationLandingKey(citationLandingKey);
    // Chunk/document identity changed: drop any prior inspect latch so a
    // revisit to the same citation does not auto-reopen the indexed dump.
    if (inspectRevealKey !== null) setInspectRevealKey(null);
  }
  const inspectIndexedText = inspectRevealKey === citationLandingKey;
  const [composerChromeFocused, setComposerChromeFocused] = useState(false);
  const [shellScrollContainer, setShellScrollContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    // #main-content does NOT reliably mount once: the shell can remount it,
    // and a one-shot lookup then holds a detached node whose scroll events
    // never fire (the phone composer never hides). Observe for the viewer's
    // lifetime — childList mutations are infrequent and the setState dedups.
    const sync = () => {
      if (cancelled) return;
      // Track absence too: mid-remount, null falls back to window until the
      // replacement mounts (a stale detached node would never fire again).
      const main = window.document.getElementById("main-content");
      setShellScrollContainer((current) => (current === main ? current : main));
    };
    const observer = new MutationObserver(sync);
    observer.observe(window.document.body, { childList: true, subtree: true });
    sync();
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);
  const { composerScrollHidden, reserveTransitioning } = useDocumentViewerChromeScroll(
    shellScrollContainer,
    documentId,
    activePage,
    activeChunkId,
    // Either sheet holds the chrome open: hiding it under an open overlay would
    // strand the sheet over a document whose edges have already been released.
    mobileActionsOpen || sectionSheetOpen,
    composerChromeFocused,
  );
  const composerVisible = documentSearchOpen && !composerScrollHidden;
  const activeScrollOwner = useActiveScrollOwner(shellScrollContainer, documentId);
  // DocumentFrame owns every viewing control for the canvas PDF — there is one
  // reader, so there is one toolbar. Reset viewing chrome when the document
  // identity changes (render-time adjust, not an effect — avoids
  // react-hooks/set-state-in-effect).
  const [pdfViewingDocumentId, setPdfViewingDocumentId] = useState(documentId);
  const [pdfFitWidth, setPdfFitWidth] = useState(true);
  const [pdfZoom, setPdfZoom] = useState(VIEWER_DEFAULT_ZOOM);
  const [pdfViewingAid, setPdfViewingAid] = useState(false);
  const [pdfRotation, setPdfRotation] = useState(0);
  const [pdfFullscreen, setPdfFullscreen] = useState(false);
  // pdf.js is authoritative for the page count: `document.page_count` can be
  // absent or stale for a document whose indexing has not caught up.
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  if (pdfViewingDocumentId !== documentId) {
    setPdfViewingDocumentId(documentId);
    setDocumentSearchOpen(false);
    setSourceSearch("");
    setDocumentSearchState({ query: "", results: [] });
    setSearchingDocument(false);
    setDocumentSearchError(null);
    setInspectRevealKey(null);
    setPdfFitWidth(true);
    setPdfZoom(VIEWER_DEFAULT_ZOOM);
    setPdfViewingAid(false);
    setPdfRotation(0);
    setPdfFullscreen(false);
    setPdfPageCount(null);
  }
  const {
    status: authStatus,
    session,
    isConfigured,
    authorizationHeader,
    registerAuthRequest,
    isAuthEpochCurrent,
    markSessionExpired,
  } = useAuthSession();
  const localNoAuthMode = isLocalNoAuthMode();
  const [serverDemoMode, setServerDemoMode] = useState(
    () => initialDetail?.demoMode ?? process.env.NEXT_PUBLIC_DEMO_MODE === "true",
  );
  const clientDemoModeEarly = localNoAuthMode || serverDemoMode;
  const {
    summary,
    summaryQuery,
    summaryProgressEvents,
    summaryProgressStartedAt,
    loadingSummary,
    summaryError,
    summarize,
    stopSummary,
    setSummary,
    setSummaryError,
  } = useDocumentSummarize({
    documentId,
    canUsePrivateApis: localProjectReady && (clientDemoModeEarly || authStatus === "authenticated"),
    clientDemoMode: clientDemoModeEarly,
    viewerReady: Boolean(document) && !loadingDocument,
    authorizationHeader,
    registerAuthRequest,
    isAuthEpochCurrent,
    markSessionExpired,
    generatedSummaryRef,
  });
  const [authLoadingTimedOut, setAuthLoadingTimedOut] = useState(false);
  // Drop every piece of mounted, identity-bound viewer state during render when the
  // auth identity changes (sign-out / expiry / account switch). An auth-only
  // transition leaves the document load key unchanged, so `isFullDocumentReload`
  // below is false and the detail effect deliberately keeps the current window
  // visible until the replacement request settles — which on a slow, offline, or
  // denied request means user B reads user A's extracted private content. That
  // covers the signed source URLs (bearer URLs whose module LRU cache is cleared
  // separately, but whose resolved value the viewer also holds in its own state),
  // and the detail payload itself: title, pages, images, table facts, chunks, index
  // health, the generated summary, and the in-document search query + snippets.
  //
  // Keyed to the user id rather than `authorizationHeader` so a token refresh for
  // the same clinician does not blank a document they are still entitled to read.
  // Guarded on the PREVIOUS identity being non-null so the ordinary `null -> A`
  // first-mount transition (auth resolving after hydration) does not throw away
  // the server-rendered `initialDetail` on every page load; sign-out (`A -> null`)
  // and account switch (`A -> B`) both still clear.
  //
  // Deliberately clears without reissuing. Forcing a reload here (by bumping
  // `previewAttempt`) routes back through `openSourcePreview({ useCache: true })`,
  // which reads the module signed-URL LRU — so it would repaint the PREVIOUS
  // identity's URL wherever that cache had not already been cleared, which is
  // exactly the leak this reset exists to close. A blank preview that recovers
  // on reload is the conservative failure; re-showing the prior clinician's
  // document is not. The stranded-preview follow-up is tracked separately.
  const viewerAuthIdentity = session?.user?.id ?? null;
  const [seenViewerAuthIdentity, setSeenViewerAuthIdentity] = useState(viewerAuthIdentity);
  // Latched once the identity changes: `initialDetail` was server-rendered for the
  // identity that requested the page, and the detail effect's `useInitialResult`
  // branch replays it whenever the route still matches the initial one. Without
  // this the effect would re-apply user A's SSR payload to user B on the very
  // re-run the identity change triggers, undoing the clear below.
  const [initialDetailIdentityStale, setInitialDetailIdentityStale] = useState(false);
  if (viewerAuthIdentity !== seenViewerAuthIdentity) {
    setSeenViewerAuthIdentity(viewerAuthIdentity);
    setSignedUrl(null);
    setDownloadSignedUrl(null);
    if (seenViewerAuthIdentity !== null) {
      setInitialDetailIdentityStale(true);
      setDocument(null);
      setPages([]);
      setImages([]);
      setTableFacts([]);
      setChunks([]);
      setIndexHealth(null);
      setSummary(null);
      setSummaryError(null);
      setDocumentSearchOpen(false);
      setSourceSearch("");
      setDocumentSearchState({ query: "", results: [] });
      setDocumentSearchError(null);
      setViewerError(null);
      setPreviewError(null);
      setDownloadError(null);
      // The detail effect re-runs for the new identity (its deps include
      // `authorizationHeader`) and clears this in its `finally`; showing the
      // loading state meanwhile is what keeps the gap from reading as "this
      // document is empty".
      setLoadingDocument(true);
    }
  }
  const clientDemoMode = clientDemoModeEarly;
  const canViewSourceDocuments = localProjectReady;
  const canUsePrivateApis = localProjectReady && (clientDemoMode || authStatus === "authenticated");
  const documentSearchPending =
    canViewSourceDocuments &&
    normalizedSourceSearch.length >= 2 &&
    (searchingDocument || documentSearchState.query !== normalizedSourceSearch);
  const canUseAdministrativeApis =
    localProjectReady && (serverDemoMode || (authStatus === "authenticated" && isAdministratorUser(session?.user)));

  useEffect(() => {
    if (authStatus !== "loading") {
      const resetId = window.setTimeout(() => setAuthLoadingTimedOut(false), 0);
      return () => window.clearTimeout(resetId);
    }
    const timeoutId = window.setTimeout(() => setAuthLoadingTimedOut(true), 4_000);
    return () => window.clearTimeout(timeoutId);
  }, [authStatus]);

  const applyPreviewSignedUrlResult = useCallback(
    (result: PromiseSettledResult<SignedUrlResponsePayload>, endpoint: string) => {
      if (result.status === "fulfilled") {
        const payload = result.value;
        if (payload.url) setCachedSignedUrl(endpoint, { ...payload, url: payload.url });
        setSignedUrl(payload.url ?? null);
        setPreviewError(null);
        return;
      }
      setSignedUrl(null);
      setPreviewError(result.reason instanceof Error ? result.reason.message : "Source preview could not be loaded.");
    },
    [],
  );

  const openSourcePreview = useCallback(
    (options: { signal: AbortSignal; useCache: boolean }): Promise<SignedUrlResponsePayload> => {
      const endpoint = `/api/documents/${documentId}/signed-url`;
      const cached = options.useCache ? getCachedSignedUrl(endpoint) : null;
      return cached
        ? Promise.resolve(cached)
        : requestSignedUrlPayload(endpoint, {
            signal: options.signal,
            headers: clientDemoMode ? undefined : authorizationHeader,
            onUnauthorized: markSessionExpired,
            errorMessage: "Source preview could not be loaded.",
          });
    },
    [authorizationHeader, clientDemoMode, documentId, markSessionExpired],
  );

  // Re-issue only the preview URL (no document-detail or download request) when a PDF's URL
  // expires mid-session, so the viewer refreshes in place without the full
  // reload/flicker. Its AbortController is cancelled on the next refresh and on unmount.
  const refreshControllerRef = useRef<AbortController | null>(null);
  const refreshSignedUrls = useCallback(() => {
    const signedUrlEndpoint = `/api/documents/${documentId}/signed-url`;

    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    const authRequest = registerAuthRequest(controller);

    readLocalProjectIdentity()
      .then((identity) => {
        if (controller.signal.aborted || !isAuthEpochCurrent(authRequest.epoch)) {
          throw new DOMException("Stale authentication epoch", "AbortError");
        }
        if (!identity?.localServer?.safeLocalOrigin) {
          throw new Error(unsafeLocalProjectMessage(identity));
        }
        // handleSignedUrlExpired already cleared the cache, so always mint fresh.
        return openSourcePreview({ signal: controller.signal, useCache: false });
      })
      .then((payload) => {
        if (controller.signal.aborted || !isAuthEpochCurrent(authRequest.epoch)) return;
        applyPreviewSignedUrlResult({ status: "fulfilled", value: payload }, signedUrlEndpoint);
      })
      .catch((error) => {
        if (controller.signal.aborted || !isAuthEpochCurrent(authRequest.epoch)) return;
        setPreviewError(error instanceof Error ? error.message : "Source preview could not be loaded.");
      })
      .finally(() => {
        authRequest.release();
        if (refreshControllerRef.current === controller) refreshControllerRef.current = null;
      });
  }, [documentId, registerAuthRequest, isAuthEpochCurrent, openSourcePreview, applyPreviewSignedUrlResult]);

  useEffect(() => () => refreshControllerRef.current?.abort(), []);

  const downloadActionRef = useRef<Promise<void> | null>(null);
  const downloadControllerRef = useRef<AbortController | null>(null);
  const currentDocumentFileName = document?.file_name;
  const openSourceDownload = useCallback(() => {
    if (downloadActionRef.current) return downloadActionRef.current;

    const endpoint = `/api/documents/${documentId}/signed-url?download=true`;
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    const authRequest = registerAuthRequest(controller);
    const action = (async () => {
      setDownloadingSource(true);
      setDownloadError(null);
      try {
        const identity = await readLocalProjectIdentity();
        if (controller.signal.aborted || !isAuthEpochCurrent(authRequest.epoch)) return;
        if (!identity?.localServer?.safeLocalOrigin) throw new Error(unsafeLocalProjectMessage(identity));

        const cached = getCachedSignedUrl(endpoint);
        const payload =
          cached ??
          (await requestSignedUrlPayload(endpoint, {
            signal: controller.signal,
            headers: clientDemoMode ? undefined : authorizationHeader,
            onUnauthorized: markSessionExpired,
            errorMessage: "Download URL could not be loaded.",
          }));
        if (controller.signal.aborted || !isAuthEpochCurrent(authRequest.epoch) || !payload.url) return;

        setCachedSignedUrl(endpoint, { ...payload, url: payload.url });
        setDownloadSignedUrl(payload.url);
        const anchor = window.document.createElement("a");
        anchor.href = payload.url;
        anchor.rel = "noreferrer";
        anchor.download = currentDocumentFileName || "clinical-source";
        anchor.click();
      } catch (error) {
        if (controller.signal.aborted || !isAuthEpochCurrent(authRequest.epoch)) return;
        setDownloadError(error instanceof Error ? error.message : "Download URL could not be loaded.");
      } finally {
        authRequest.release();
        if (downloadControllerRef.current === controller) {
          downloadControllerRef.current = null;
          setDownloadingSource(false);
        }
      }
    })();
    downloadActionRef.current = action;
    void action.finally(() => {
      if (downloadActionRef.current === action) downloadActionRef.current = null;
    });
    return action;
  }, [
    authorizationHeader,
    clientDemoMode,
    currentDocumentFileName,
    documentId,
    isAuthEpochCurrent,
    markSessionExpired,
    registerAuthRequest,
  ]);

  useEffect(
    () => () => {
      downloadControllerRef.current?.abort();
      downloadControllerRef.current = null;
      downloadActionRef.current = null;
    },
    [documentId],
  );

  // Distinguishes a full document (re)load — a new documentId or an explicit
  // retry (previewAttempt) — from page/chunk navigation on the already-loaded
  // document. Navigation only re-windows the detail; a full load also resets the
  // preview and re-issues only its signed URL.
  const loadedKeyRef = useRef<string | null>(null);
  const detailControllerRef = useRef<AbortController | null>(null);
  const detailRequestSequenceRef = useRef(0);
  const localProjectIdentityPromiseRef = useRef<ReturnType<typeof readLocalProjectIdentity> | null>(null);
  const initialRouteRef = useRef({ documentId, initialPage, chunkId });
  const navigatedFromInitialRouteRef = useRef(false);
  // The page window already in hand, and the request identity it was loaded
  // under. A page flip inside this window needs no network at all: the server
  // returns a window of pages centred on the requested one, so the neighbours
  // arrived with it.
  const loadedWindowRef = useRef<LoadedDetailWindow | null>(null);

  // Everything the detail request depends on except the page. Callback identity
  // is deliberately excluded — a new function reference does not change what
  // would be fetched, and letting it force a refetch is what made page flips
  // look like network work.
  const detailRequestSignature = [
    documentId,
    previewAttempt,
    activeChunkId ?? "",
    authStatus,
    String(clientDemoMode),
    String(canUsePrivateApis),
    String(isConfigured),
    String(initialDetailIdentityStale),
    authorizationIdentity(authorizationHeader),
  ].join("|");

  useEffect(() => {
    if (!canViewSourceDocuments && authStatus === "loading") {
      return () => undefined;
    }
    if (!canViewSourceDocuments) {
      return () => undefined;
    }

    // Skip the round trip when the only thing that moved is the page and the new
    // page is already inside the loaded window.
    if (canSkipDetailRequest(loadedWindowRef.current, detailRequestSignature, activePage)) {
      return () => undefined;
    }

    const matchesInitialRoute =
      initialRouteRef.current.documentId === documentId &&
      initialRouteRef.current.initialPage === activePage &&
      initialRouteRef.current.chunkId === activeChunkId;
    if (!matchesInitialRoute) navigatedFromInitialRouteRef.current = true;
    const useInitialResult =
      previewAttempt === 0 &&
      matchesInitialRoute &&
      !navigatedFromInitialRouteRef.current &&
      // `initialDetail` belongs to whoever the page was server-rendered for.
      // Once the auth identity has changed it must be refetched, never replayed.
      !initialDetailIdentityStale &&
      Boolean(initialDetail || initialError);

    detailControllerRef.current?.abort();
    const controller = new AbortController();
    detailControllerRef.current = controller;
    const requestSequence = ++detailRequestSequenceRef.current;
    const authRequest = registerAuthRequest(controller);
    const loadKey = documentLoadKey(documentId, previewAttempt);
    const isFullReload = isFullDocumentReload(loadedKeyRef.current, loadKey);
    const reset = window.setTimeout(() => {
      // Skip the reset on navigation so the mounted PDF and current content stay
      // visible (no loading flash) while the new page window loads in the background.
      if (!controller.signal.aborted && isFullReload && !useInitialResult) {
        setLoadingDocument(true);
        setViewerError(null);
        setPreviewError(null);
        setDownloadError(null);
        setDownloadingSource(false);
        setSignedUrl(null);
        setDownloadSignedUrl(null);
      }
    }, 0);
    const detailParams = new URLSearchParams({
      page: String(Math.max(1, activePage || 1)),
      pageLimit: "9",
      chunkLimit: "16",
      assetScope: "window",
    });
    if (activeChunkId) detailParams.set("chunk", activeChunkId);
    const detailUrl = `/api/documents/${documentId}?${detailParams.toString()}`;
    const signedUrlEndpoint = `/api/documents/${documentId}/signed-url`;
    if (!localProjectIdentityPromiseRef.current) {
      const pendingIdentity = readLocalProjectIdentity();
      localProjectIdentityPromiseRef.current = pendingIdentity;
      void pendingIdentity.then(
        (identity) => {
          if (!identity?.localServer?.safeLocalOrigin && localProjectIdentityPromiseRef.current === pendingIdentity) {
            localProjectIdentityPromiseRef.current = null;
          }
        },
        () => {
          if (localProjectIdentityPromiseRef.current === pendingIdentity) {
            localProjectIdentityPromiseRef.current = null;
          }
        },
      );
    }
    const identityRequest = localProjectIdentityPromiseRef.current!;
    identityRequest
      .then((identity) => {
        if (
          controller.signal.aborted ||
          requestSequence !== detailRequestSequenceRef.current ||
          !isAuthEpochCurrent(authRequest.epoch)
        ) {
          throw new DOMException("Stale authentication epoch", "AbortError");
        }
        if (!identity?.localServer?.safeLocalOrigin) {
          setLocalProjectReady(false);
          throw new Error(unsafeLocalProjectMessage(identity));
        }
        setLocalProjectReady(true);

        const detailRequest: Promise<DocumentDetailPayload> = useInitialResult
          ? initialDetail
            ? Promise.resolve(initialDetail)
            : Promise.reject(new Error(initialError || "Document could not be loaded."))
          : fetch(detailUrl, {
              signal: controller.signal,
              headers: clientDemoMode ? undefined : authorizationHeader,
            }).then(async (response) => {
              const payload = await response.json();
              if (response.status === 401) markSessionExpired();
              if (!response.ok) throw new Error(payload.error || "Document details could not be loaded.");
              return payload as DocumentDetailPayload;
            });
        // Navigation keeps the current preview; a full load re-issues only the preview URL.
        const previewRequest = isFullReload
          ? Promise.allSettled([openSourcePreview({ signal: controller.signal, useCache: true })])
          : Promise.resolve(null);

        return Promise.all([Promise.allSettled([detailRequest]), previewRequest]);
      })
      .then(([[detailResult], previewResults]) => {
        if (
          controller.signal.aborted ||
          requestSequence !== detailRequestSequenceRef.current ||
          !isAuthEpochCurrent(authRequest.epoch)
        )
          return;
        const detailLoaded = detailResult.status === "fulfilled";
        // The server-rendered initial result (including a sanitized failure) is
        // already authoritative for this attempt. Mark it handled so an auth
        // state refresh cannot duplicate the initial detail/preview requests;
        // an explicit retry increments previewAttempt and gets a fresh key.
        loadedKeyRef.current = useInitialResult
          ? loadKey
          : nextLoadedDocumentKey(loadedKeyRef.current, loadKey, detailLoaded);

        if (detailLoaded) {
          const detail = detailResult.value;
          // Remember the window this payload covers so a flip inside it can skip
          // the network entirely. A chunk route is excluded: its window is centred
          // on the selected chunk, so page arithmetic does not describe it.
          loadedWindowRef.current =
            !activeChunkId && detail.pageWindow
              ? { signature: detailRequestSignature, from: detail.pageWindow.from, to: detail.pageWindow.to }
              : null;
          setDocument(detail.document ?? null);
          // Keep the previous window visible while loading, then atomically
          // replace it so client memory and mounted DOM stay bounded.
          setPages(rowsById(detail.pages));
          setImages(rowsById(detail.images));
          setTableFacts(rowsById(detail.tableFacts));
          setChunks(rowsById(detail.chunks));
          setIndexHealth(detail.indexHealth ?? null);
          setServerDemoMode(detail.demoMode);
          setViewerError(null);
        } else {
          // Never retain evidence from the previous page under a newly selected
          // route. A navigation failure becomes an explicit retryable error.
          loadedWindowRef.current = null;
          setDocument(null);
          setPages([]);
          setImages([]);
          setTableFacts([]);
          setChunks([]);
          setIndexHealth(null);
          const message =
            detailResult.reason instanceof Error ? detailResult.reason.message : "Document could not be loaded.";
          if (!canUsePrivateApis && !clientDemoMode && message === "Document not found.") {
            setViewerError(
              isConfigured
                ? "Sign in to open private source documents."
                : "Supabase browser authentication is not configured for private source documents.",
            );
          } else {
            setViewerError(message);
          }
        }

        if (previewResults) {
          const previewResult = previewResults[0];
          if (previewResult) applyPreviewSignedUrlResult(previewResult, signedUrlEndpoint);
        }
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          requestSequence !== detailRequestSequenceRef.current ||
          !isAuthEpochCurrent(authRequest.epoch)
        )
          return;
        loadedWindowRef.current = null;
        setDocument(null);
        setPages([]);
        setImages([]);
        setTableFacts([]);
        setChunks([]);
        setIndexHealth(null);
        setViewerError(error instanceof Error ? error.message : "Document could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted && requestSequence === detailRequestSequenceRef.current) {
          setLoadingDocument(false);
          if (detailControllerRef.current === controller) detailControllerRef.current = null;
        }
      });

    return () => {
      window.clearTimeout(reset);
      controller.abort();
      authRequest.release();
      if (detailControllerRef.current === controller) detailControllerRef.current = null;
    };
  }, [
    authStatus,
    authorizationHeader,
    canUsePrivateApis,
    canViewSourceDocuments,
    clientDemoMode,
    // Every primitive input above is already a dependency; this is their joined
    // form, used to decide whether an in-window page flip needs the network.
    detailRequestSignature,
    documentId,
    activeChunkId,
    activePage,
    isConfigured,
    markSessionExpired,
    registerAuthRequest,
    isAuthEpochCurrent,
    previewAttempt,
    initialDetail,
    initialError,
    initialDetailIdentityStale,
    openSourcePreview,
    applyPreviewSignedUrlResult,
  ]);

  useEffect(() => {
    const query = sourceSearch.replace(/\s+/g, " ").trim();
    if (!canViewSourceDocuments || query.length < 2) {
      const reset = window.setTimeout(() => {
        setDocumentSearchState({ query: "", results: [] });
        setSearchingDocument(false);
        setDocumentSearchError(null);
      }, 0);
      return () => window.clearTimeout(reset);
    }

    const controller = new AbortController();
    const authRequest = registerAuthRequest(controller);
    const timeout = window.setTimeout(() => {
      setSearchingDocument(true);
      setDocumentSearchError(null);
      fetch(`/api/documents/${documentId}/search?q=${encodeURIComponent(query)}&limit=30`, {
        signal: controller.signal,
        headers: clientDemoMode ? undefined : authorizationHeader,
      })
        .then(async (response) => {
          const payload = await response.json();
          if (response.status === 401) markSessionExpired();
          if (!response.ok) throw new Error(payload.error || "Document search could not be loaded.");
          return payload;
        })
        .then((payload) => {
          if (controller.signal.aborted || !isAuthEpochCurrent(authRequest.epoch)) return;
          const responseQuery = typeof payload.query === "string" ? payload.query.trim() : query;
          if (responseQuery !== query) {
            setDocumentSearchState({ query, results: [] });
            setDocumentSearchError("Document search returned an outdated response. Retry the search.");
            return;
          }
          setDocumentSearchState({ query, results: Array.isArray(payload.results) ? payload.results : [] });
          setDocumentSearchError(null);
        })
        .catch((error) => {
          if (controller.signal.aborted || !isAuthEpochCurrent(authRequest.epoch)) return;
          setDocumentSearchState({ query, results: [] });
          setDocumentSearchError(error instanceof Error ? error.message : "Document search could not be loaded.");
        })
        .finally(() => {
          authRequest.release();
          if (!controller.signal.aborted) setSearchingDocument(false);
        });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      authRequest.release();
    };
  }, [
    authorizationHeader,
    canViewSourceDocuments,
    clientDemoMode,
    documentId,
    isAuthEpochCurrent,
    markSessionExpired,
    registerAuthRequest,
    sourceSearch,
  ]);

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const authViewerError =
    !canUsePrivateApis &&
    !clientDemoMode &&
    !loadingDocument &&
    !document &&
    (authStatus !== "loading" || authLoadingTimedOut) &&
    (viewerError === "Sign in to open private source documents." ||
      viewerError === "Supabase browser authentication is not configured for private source documents.")
      ? viewerError
      : null;
  const effectiveLoadingDocument =
    !canUsePrivateApis && authStatus === "loading" && !authLoadingTimedOut && loadingDocument ? true : loadingDocument;
  const effectiveViewerError = authViewerError ?? viewerError;
  const viewerState = effectiveLoadingDocument
    ? "loading"
    : document
      ? "ready"
      : authViewerError
        ? "auth-required"
        : "error";
  const readyDocument = viewerState === "ready" ? document : null;
  const previewFrameSource: DocumentFrameSource =
    document?.file_type === "application/pdf"
      ? { kind: "pdf-page", url: signedUrl ?? undefined, page: activePage, pageCount: document.page_count ?? undefined }
      : document?.file_type?.startsWith("image/")
        ? { kind: "image", url: signedUrl ?? undefined }
        : { kind: "document", url: signedUrl ?? undefined };
  const canvasPdfReady =
    Boolean(signedUrl) &&
    document?.file_type === "application/pdf" &&
    !effectiveLoadingDocument &&
    !effectiveViewerError &&
    !previewError;
  const handlePdfFitWidth = useCallback(() => {
    setPdfFitWidth(true);
  }, []);
  const handlePdfZoomChange = useCallback((nextZoom: number) => {
    setPdfFitWidth(false);
    setPdfZoom(nextZoom);
  }, []);
  const handlePdfFitWidthChange = useCallback((nextFitWidth: boolean) => {
    setPdfFitWidth(nextFitWidth);
  }, []);
  const handlePdfRotate = useCallback(() => {
    setPdfRotation((current) => (current + 90) % 360);
  }, []);
  const effectivePdfPageCount = pdfPageCount ?? document?.page_count ?? undefined;
  const pdfFrameControls: DocumentFrameControls | undefined = canvasPdfReady
    ? {
        fitWidth: pdfFitWidth,
        onFitWidth: handlePdfFitWidth,
        zoom: pdfZoom,
        onZoomChange: handlePdfZoomChange,
        viewingAid: pdfViewingAid,
        onViewingAidChange: setPdfViewingAid,
        minZoom: VIEWER_MIN_ZOOM,
        maxZoom: VIEWER_MAX_ZOOM,
        zoomStep: VIEWER_ZOOM_STEP,
        page: activePage,
        pageCount: effectivePdfPageCount,
        onPageChange: navigateToPage,
        rotation: pdfRotation,
        onRotate: handlePdfRotate,
        fullscreen: pdfFullscreen,
        onFullscreenChange: setPdfFullscreen,
      }
    : undefined;
  const headerTitle = readyDocument
    ? documentDisplayTitle(readyDocument)
    : viewerState === "auth-required"
      ? "Sign in required"
      : viewerState === "loading"
        ? "Document"
        : "Source unavailable";
  const documentHomeHref = "/?mode=documents";
  const usefulPageHref = (page: number) => documentPageHref(documentId, page);
  const canSummarizeDocument = viewerState === "ready" && !loadingSummary && canUsePrivateApis;
  const summarizeTitle = !canUsePrivateApis
    ? "Sign in before answering from this document"
    : viewerState !== "ready" || loadingSummary
      ? "Load a source document before answering"
      : "Answer from this document";
  const pageByNumber = useMemo(() => new Map(pages.map((page) => [page.page_number, page])), [pages]);
  const chunkById = useMemo(() => new Map(chunks.map((chunk) => [chunk.id, chunk])), [chunks]);
  const selectedPage = pageByNumber.get(activePage) ?? pages[0];
  const selectedChunk = activeChunkId ? chunkById.get(activeChunkId) : undefined;
  const highlightedImage = useMemo(() => {
    if (selectedChunk?.image_ids?.length) {
      for (const id of selectedChunk.image_ids) {
        const match = images.find((img) => img.id === id && img.bbox);
        if (match) return match;
      }
    }
    return undefined;
  }, [selectedChunk, images]);
  const { clinicalImages, auditImages } = partitionViewerImages(images);
  // Built on every render rather than memoised: it is seven objects from values
  // already in hand, and `clinicalImages` is a fresh array each render, so a
  // manual dependency list would only be memoization the compiler cannot verify.
  // Consumers key off the section ids, not this array's identity.
  const documentSections = buildDocumentSectionIndex({
    hasDocument: Boolean(readyDocument),
    hasStoredSummary: Boolean(document?.summary),
    pageCount: document?.page_count ?? pages.length,
    chunkCount: chunks.length,
    visualCount: clinicalImages.length,
    hasIndexHealth: Boolean(indexHealth),
    pinnedPage: selectedChunk?.page_number ?? null,
    loading: effectiveLoadingDocument,
  });
  const {
    activeId: activeSectionId,
    activeSection,
    selectSection,
  } = useDocumentSectionSpy(documentSections, Boolean(readyDocument));
  const sectionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { headerHidden } = useDocumentChromeMetrics(viewerRootRef);
  const openSectionSheet = useCallback(() => {
    // Hide-on-scroll cannot reclaim either edge while the composer holds focus,
    // so release it before an overlay takes over the screen.
    sourceSearchInputRef.current?.blur();
    setSectionSheetOpen(true);
  }, []);
  const jumpToSection = useCallback(
    (id: string) => {
      // Condensed view keeps IndexedTextPanel React-controlled. A raw
      // `details.open = true` from the section jump would lose on the next
      // render unless we also raise the inspect reveal for this citation.
      // Jumping anywhere else must lower it again — otherwise IndexedTextPanel's
      // controlled `open` stays true and the exclusive accordion group (native
      // `name="document-viewer-section"`) closes the section this jump targets
      // right back on the next render.
      setInspectRevealKey(id === "source-text" ? `${documentId}::${activeChunkId ?? ""}` : null);
      selectSection(id);
      jumpToDocumentSection(id);
    },
    [activeChunkId, documentId, selectSection],
  );
  const generatedSummaryText = summary ? cleanClinicalSummaryText(summary.answer) : "";
  const generatedAnswerIsSummary = summaryQuery === documentSummaryQuestion;
  const storedSummaryText = document?.summary?.summary ?? null;
  const documentLabels = document?.labels;
  const formattedStoredSummary = useMemo(() => formatDocumentSummary(storedSummaryText), [storedSummaryText]);
  const summaryBadges = useMemo(
    () => buildDocumentSummaryBadges({ labels: documentLabels, summaryText: storedSummaryText }),
    [documentLabels, storedSummaryText],
  );
  const indexWarnings = Array.isArray(indexHealth?.warnings)
    ? indexHealth.warnings.map((warning) => String(warning)).filter(Boolean)
    : typeof indexHealth?.warnings === "string" && indexHealth.warnings
      ? [indexHealth.warnings]
      : [];
  const inspectIndexedTextSection = useCallback(() => {
    setInspectRevealKey(`${documentId}::${activeChunkId ?? ""}`);
    window.requestAnimationFrame(() => {
      jumpToDocumentSection("source-text");
    });
  }, [activeChunkId, documentId]);
  const retryPreview = () => {
    setViewerError(null);
    setPreviewError(null);
    setDownloadError(null);
    // Re-open the guarded load path after a transient identity failure; the
    // cleared identity promise is still revalidated before any API request.
    setLocalProjectReady(true);
    setLoadingDocument(true);
    setPreviewAttempt((current) => current + 1);
  };
  useEffect(() => {
    signedUrlRefreshCountRef.current = 0;
  }, [documentId]);
  // The PDF signed URL has a 10-min TTL and pdf.js holds a dead reference once it
  // expires. When the canvas reports an expiry, drop cached URLs and mint a fresh
  // preview only (bounded so a broken URL can't loop). Download remains click-gated.
  // Stable identity (useCallback) so the memoised PdfCanvasViewer isn't re-rendered
  // — and its page re-rastered — every time an unrelated parent state (source-search
  // keystroke, composer focus, online/offline) changes.
  const handleSignedUrlExpired = useCallback(() => {
    if (signedUrlRefreshCountRef.current >= 2) return;
    signedUrlRefreshCountRef.current += 1;
    const signedUrlEndpoint = `/api/documents/${documentId}/signed-url`;
    clearCachedSignedUrl(signedUrlEndpoint);
    clearCachedSignedUrl(`${signedUrlEndpoint}?download=true`);
    setDownloadSignedUrl(null);
    refreshSignedUrls();
  }, [documentId, refreshSignedUrls]);
  // A successful reload means the refreshed URL was accepted, so the recovery
  // worked — restore the budget for the next (unrelated) TTL expiry. A broken
  // URL never loads, so it never resets, and the cap still stops its loop.
  const handlePdfLoadSuccess = useCallback(
    (pageCount: number) => {
      signedUrlRefreshCountRef.current = 0;
      // pdf.js has opened the file, so its page count now outranks the indexed
      // metadata the toolbar fell back to.
      setPdfPageCount(pageCount > 0 ? pageCount : null);
      // Deep links / stale page_count can leave the route past the real end.
      // PdfCanvasViewer also reconciles via onPageChange; clamp here so the
      // authoritative count cannot leave the toolbar on a non-existent page.
      if (pageCount > 0 && activePage > pageCount) {
        navigateToPage(pageCount);
      }
    },
    [activePage, navigateToPage],
  );
  const handleDocumentRenamed = (updatedDocument: ClinicalDocument) => {
    setDocument((current) => (current?.id === updatedDocument.id ? { ...current, ...updatedDocument } : current));
  };
  const handleDocumentDeleted = () => {
    router.push("/?mode=documents");
  };
  const handleDocumentLabelsUpdated = (labels: DocumentLabel[]) => {
    setDocument((current) => (current ? { ...current, labels } : current));
  };
  const searchByTag = (tag: { searchText: string; label: string }) => {
    router.push(documentsSearchHref({ query: tag.searchText || tag.label, run: true }));
  };
  const submitSourceSearch = () => {
    if (normalizedSourceSearch.length < 2) return;
    setInspectRevealKey(`${documentId}::${activeChunkId ?? ""}`);
    globalThis.document.getElementById("source-text")?.scrollIntoView({
      block: "start",
      behavior: resolveScrollBehavior(),
    });
  };
  const openDocumentSearch = (returnFocusTarget?: HTMLElement | null) => {
    documentSearchReturnFocusRef.current = returnFocusTarget ?? documentActionsTriggerRef.current;
    setMobileActionsOpen(false);
    setDocumentSearchOpen(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => sourceSearchInputRef.current?.focus());
    });
  };
  const closeDocumentSearch = () => {
    const returnFocusTarget = documentSearchReturnFocusRef.current;
    setDocumentSearchOpen(false);
    setComposerChromeFocused(false);
    setSourceSearch("");
    setDocumentSearchState({ query: "", results: [] });
    setSearchingDocument(false);
    setDocumentSearchError(null);
    setInspectRevealKey(null);
    window.requestAnimationFrame(() => {
      const focusTarget = returnFocusTarget?.isConnected ? returnFocusTarget : documentActionsTriggerRef.current;
      focusTarget?.focus();
    });
  };
  async function reviewTableFact(fact: TableFactRow, reviewClass: string) {
    setReviewingTableFactId(fact.id);
    try {
      const response = await fetch(`/api/documents/${documentId}/table-facts`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(clientDemoMode ? {} : authorizationHeader),
        },
        body: JSON.stringify({ factId: fact.id, reviewClass }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) markSessionExpired();
      if (!response.ok) throw new Error(payload.error || "Table review update failed.");
      setTableFacts((current) =>
        current.map((candidate) => (candidate.id === fact.id ? (payload.tableFact as TableFactRow) : candidate)),
      );
      setImages((current) =>
        current.map((image) =>
          image.id === fact.source_image_id
            ? {
                ...image,
                clinicalUseClass: reviewClass === "clinical_useful" ? "clinical_evidence" : reviewClass,
                tableRole: reviewClass === "clinical_useful" ? "clinical" : reviewClass,
                searchable: reviewClass === "clinical_useful" || reviewClass === "reference",
              }
            : image,
        ),
      );
    } catch (error) {
      setViewerError(error instanceof Error ? error.message : "Table review update failed.");
    } finally {
      setReviewingTableFactId(null);
    }
  }

  return (
    <main
      id="document-viewer-main"
      ref={viewerRootRef}
      tabIndex={-1}
      className={cn(appBackdrop, "min-h-[100dvh] overflow-x-clip text-[color:var(--text)] focus:outline-none")}
    >
      <PhoneHeaderCollapsePortal>
        <header
          data-document-sticky-header
          className="edge-glass-header relative z-30 border-b border-[color:var(--border)] py-2 shadow-[var(--e1)] backdrop-blur-xl max-sm:pt-2 sm:sticky sm:top-0 sm:pt-[max(0.5rem,env(safe-area-inset-top))]"
        >
          <div className="mx-auto flex min-h-12 min-w-0 max-w-[1440px] items-center gap-2">
            <ContextualBackLink
              fallbackHref={documentHomeHref}
              className="inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-full pl-1.5 pr-3 text-sm font-semibold text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]"
              aria-label="Back to documents"
            >
              <ArrowLeft aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span className="hidden sm:inline">Documents</span>
            </ContextualBackLink>
            {documentSections.length > 0 ? (
              // The title is the section-list disclosure. Line two names where you
              // are, which the track can place but never label.
              <button
                type="button"
                ref={sectionTriggerRef}
                onClick={openSectionSheet}
                aria-expanded={sectionSheetOpen}
                aria-haspopup="dialog"
                data-testid="document-section-trigger"
                className="flex min-h-tap min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 text-left transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                <span className="min-w-0 flex-1">
                  <h1 className="truncate text-sm font-semibold leading-tight text-[color:var(--text)] sm:text-base">
                    {headerTitle}
                  </h1>
                  {activeSection ? (
                    <span className="mt-0.5 flex items-center gap-1.5 text-3xs font-bold text-[color:var(--clinical-accent)]">
                      <activeSection.icon aria-hidden="true" className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 truncate">{activeSection.label}</span>
                    </span>
                  ) : null}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)] transition motion-reduce:transition-none",
                    sectionSheetOpen && "rotate-180",
                  )}
                />
              </button>
            ) : (
              <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--text)] sm:text-base">
                {headerTitle}
              </h1>
            )}
            <div className="ml-auto flex shrink-0 items-center">
              <button
                type="button"
                ref={documentActionsTriggerRef}
                onClick={() => setMobileActionsOpen(true)}
                className="grid h-tap w-tap place-items-center rounded-xl border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                aria-label="Open document actions"
                aria-haspopup="dialog"
                aria-expanded={mobileActionsOpen}
                title="Document actions"
              >
                <Ellipsis aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
              </button>
            </div>
          </div>
          <DocumentSectionTrack sections={documentSections} activeId={activeSectionId} />
        </header>
      </PhoneHeaderCollapsePortal>
      <DocumentSectionSheet
        open={sectionSheetOpen}
        onClose={() => setSectionSheetOpen(false)}
        sections={documentSections}
        activeId={activeSectionId}
        onSelect={jumpToSection}
        documentTitle={headerTitle}
        returnFocusRef={sectionTriggerRef}
        compact={compactView}
        onCompactChange={setCompactView}
      />
      {readyDocument ? (
        <Sheet
          open={mobileActionsOpen}
          onClose={() => setMobileActionsOpen(false)}
          title="This document"
          description="Choose how to use this source."
          closeLabel="Close document actions"
          portal
          testId="document-actions-sheet"
          contentClassName="max-sm:min-h-[min(36rem,calc(100dvh-1rem))] sm:max-w-xl"
          headerLeading={
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
              <FileText aria-hidden="true" className="h-5 w-5" />
            </span>
          }
        >
          <div className="space-y-4 pb-1">
            <section className={cn(sourceCard, "p-4")}>
              <p className="line-clamp-2 text-sm font-semibold text-[color:var(--text)]">
                {documentDisplayTitle(readyDocument)}
              </p>
              <p className={cn("mt-1 truncate text-xs", textMuted)}>{readyDocument.file_name}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!isOnline ? <span className={cn("text-xs font-semibold", textMuted)}>Offline</span> : null}
              </div>
            </section>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <button
                type="button"
                onClick={() => openDocumentSearch(documentActionsTriggerRef.current)}
                aria-expanded={documentSearchOpen}
                aria-controls={documentSearchOpen ? "document-viewer-search" : undefined}
                className={cn(secondaryButton, "min-h-14 justify-start gap-3 px-3 text-left text-sm")}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                  <Search aria-hidden="true" className="h-4 w-4" />
                </span>
                Search document
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileActionsOpen(false);
                  void summarize();
                }}
                disabled={!canSummarizeDocument}
                title={summarizeTitle}
                className={cn(secondaryButton, "min-h-14 justify-start gap-3 px-3 text-left text-sm")}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                  {loadingSummary ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles aria-hidden="true" className="h-4 w-4" />
                  )}
                </span>
                Answer from this
              </button>
              {signedUrl ? (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setMobileActionsOpen(false)}
                  className={cn(secondaryButton, "min-h-14 justify-start gap-3 px-3 text-left text-sm")}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  </span>
                  Open original PDF
                </a>
              ) : (
                <a
                  href="#pdf-preview-section"
                  onClick={() => setMobileActionsOpen(false)}
                  className={cn(secondaryButton, "min-h-14 justify-start gap-3 px-3 text-left text-sm")}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  </span>
                  Open original PDF
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileActionsOpen(false);
                  void openSourceDownload();
                }}
                disabled={downloadingSource}
                className={cn(secondaryButton, "min-h-14 justify-start gap-3 px-3 text-left text-sm")}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]">
                  {downloadingSource ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download aria-hidden="true" className="h-4 w-4" />
                  )}
                </span>
                {downloadingSource ? "Preparing PDF" : "Download PDF"}
              </button>
            </div>
            {canUseAdministrativeApis ? (
              <details className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3">
                <summary className="cursor-pointer text-xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                  Admin controls
                </summary>
                <DocumentManagementActions
                  document={readyDocument}
                  disabled={!canUseAdministrativeApis}
                  className="mt-3 justify-start gap-2"
                  onRenamed={handleDocumentRenamed}
                  onDeleted={handleDocumentDeleted}
                />
              </details>
            ) : null}
          </div>
        </Sheet>
      ) : null}

      <section
        data-testid="document-viewer-content"
        data-scroll-hidden={documentSearchOpen && composerScrollHidden ? "true" : undefined}
        data-reserve-transitioning={documentSearchOpen && reserveTransitioning ? "true" : undefined}
        data-phone-scroll-owner={activeScrollOwner}
        data-phone-footer-owner={readyDocument && documentSearchOpen ? "document-viewer" : "none"}
        data-phone-composer-reserve={
          composerVisible ? "calc(9rem + var(--safe-area-bottom) + var(--keyboard-height, 0px))" : "0.75rem"
        }
        data-phone-chrome-transition={documentSearchOpen && reserveTransitioning ? "active" : "idle"}
        data-document-view={compactView ? "condensed" : "full"}
        // Hidden state releases the composer's own 9rem clearance, but keeps a
        // small resting gap (0.75rem — the same figure the floating pill itself
        // uses for its bottom clearance, .floating-composer-edge) so the last
        // card never paints flush against the physical bottom edge once the pill
        // is gone. Reported by a user whose last card sat with zero clearance at
        // the true end of scroll. `data-reserve-hidden-pad` keeps that baseline
        // out of the hide/reveal collapse-budget math (readChromeCollapseMetrics
        // in use-hide-on-scroll.ts), which otherwise would treat it as space the
        // hide would still release.
        data-reserve-hidden-pad="0.75rem"
        className={cn(
          // Base `grid-cols-1` for the same reason as the rail grid: without an
          // explicit track this is an implicit `auto` column sized by its items'
          // min-content, so a single child that forgets `min-w-0` can widen the
          // whole page past the viewport and get clipped by `overflow-x: clip`.
          "mx-auto grid max-w-[1440px] grid-cols-1 gap-4 px-3 py-4 sm:gap-5 sm:px-4 sm:py-5 lg:grid-cols-[minmax(0,1fr)_480px] lg:items-start lg:px-8",
          // The visible fixed composer needs endpoint clearance. Once hidden,
          // release the composer-height clearance so Safari can paint document
          // content beneath its translucent toolbar instead of showing a blank
          // band — but keep a small 0.75rem resting pad (see comment above).
          composerVisible
            ? "max-sm:pb-[calc(9rem+var(--safe-area-bottom)+var(--keyboard-height,0px))] max-sm:[--phone-focus-bottom-clearance:calc(9rem+var(--safe-area-bottom)+var(--keyboard-height,0px))] sm:pb-40"
            : "max-sm:pb-3",
        )}
      >
        {downloadError ? (
          <InlineNotice tone="warning" className="lg:col-span-2">
            {downloadError}
          </InlineNotice>
        ) : null}
        {(loadingSummary || summary || summaryError) && (
          <div className="min-w-0 space-y-3 lg:col-span-2">
            {summaryProgressStartedAt && summaryProgressEvents.length > 0 ? (
              <AnswerProgressStepper
                events={summaryProgressEvents}
                startedAt={summaryProgressStartedAt}
                active={loadingSummary}
                onStop={stopSummary}
              />
            ) : null}
            {summary && (
              <section
                ref={generatedSummaryRef}
                data-testid="generated-clinical-summary"
                className={cn(panel, "p-4 source-print")}
              >
                <PanelHeading
                  icon={Sparkles}
                  title={generatedAnswerIsSummary ? "Clinical summary" : "Answer from this document"}
                  description={
                    generatedAnswerIsSummary
                      ? "From indexed passages, cleaned for practical use."
                      : "Grounded in indexed passages from this source."
                  }
                />
                <p className="mt-3 whitespace-pre-wrap text-base-minus leading-6 text-[color:var(--text-muted)]">
                  <SafeBoldText text={generatedSummaryText} />
                </p>
              </section>
            )}
            {summaryError && (
              <section className="rounded-lg border border-[color:var(--danger)]/30 bg-[color:var(--danger-soft)] p-4 text-sm font-medium text-[color:var(--danger)]">
                <CircleAlert aria-hidden="true" className="mr-2 inline h-4 w-4" />
                {summaryError}
              </section>
            )}
          </div>
        )}

        {readyDocument ? (
          <div
            id={documentOverviewSectionId}
            className="min-w-0 scroll-mt-[var(--document-anchor-offset,6rem)] max-sm:order-1 lg:col-span-2"
          >
            <DocumentOverviewLanding
              document={readyDocument}
              signedUrl={signedUrl}
              pages={pages}
              onAskFromDocument={() => void summarize()}
              onSearchDocument={(event) => openDocumentSearch(event.currentTarget)}
              searchOpen={documentSearchOpen}
              onDownload={() => void openSourceDownload()}
              downloading={downloadingSource}
              canSummarizeDocument={canSummarizeDocument}
            />
          </div>
        ) : null}

        {/* Phone order: the title strip, then this card, then the PDF — matching
            desktop, where the card already sits directly under the title card
            (both are lg:col-span-2 ahead of the PDF column). Previously this card
            was ordered after the PDF ("source-first"); moved back ahead of it so
            a phone reader sees the clinical priorities digest before scrolling
            past the PDF. */}
        {readyDocument ? (
          <div
            id="source-summary-card"
            className="min-w-0 max-sm:order-2 lg:col-span-2 scroll-mt-[var(--document-anchor-offset,6rem)]"
          >
            <DocumentClinicalSummary
              document={readyDocument}
              pageHref={usefulPageHref}
              onPageChange={navigateToPage}
              compact={compactView}
            />
          </div>
        ) : null}

        {!readyDocument && viewerState !== "loading" ? (
          <div className="min-w-0 max-sm:order-1 lg:col-span-2">
            <section className={cn(panel, "p-4")}>
              <button type="button" disabled className={cn(secondaryButton, "min-h-tap text-xs")}>
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                Answer from this
              </button>
            </section>
          </div>
        ) : null}

        <div className="min-w-0 space-y-4 max-sm:order-3 sm:space-y-5 lg:mx-auto lg:w-full lg:max-w-4xl">
          <div
            id="pdf-preview-section"
            className={cn(panel, "scroll-mt-[var(--document-anchor-offset,6rem)] overflow-hidden")}
          >
            <div data-testid="pdf-preview">
              <DocumentFrame
                alt={`${document ? documentDisplayTitle(document) : "Source document"} preview`}
                src={previewFrameSource}
                controls={pdfFrameControls}
                {...(effectiveLoadingDocument
                  ? { state: "loading" as const, loadingLabel: "Preparing PDF preview" }
                  : effectiveViewerError || previewError
                    ? {
                        state: "error" as const,
                        errorMessage: effectiveViewerError ?? previewError ?? "Source preview could not be loaded.",
                        onRetry: retryPreview,
                      }
                    : { state: "ready" as const })}
                statusDetail={
                  effectiveLoadingDocument ? (
                    <ul className="mt-3 space-y-1 text-left text-xs font-medium text-[color:var(--text-muted)]">
                      <li>Loading source metadata</li>
                      <li>Preparing PDF preview</li>
                      <li>Loading extracted tables</li>
                    </ul>
                  ) : undefined
                }
                statusActions={
                  <>
                    {signedUrl ? (
                      <a href={signedUrl} target="_blank" rel="noreferrer" className={secondaryButton}>
                        <ExternalLink aria-hidden="true" className="h-4 w-4" />
                        Source PDF
                      </a>
                    ) : null}
                    {downloadSignedUrl ? (
                      <button
                        type="button"
                        onClick={() => void openSourceDownload()}
                        disabled={downloadingSource}
                        className={secondaryButton}
                      >
                        {downloadingSource ? (
                          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download aria-hidden="true" className="h-4 w-4" />
                        )}
                        {downloadingSource ? "Preparing PDF" : "Download PDF"}
                      </button>
                    ) : null}
                  </>
                }
              >
                {signedUrl && document?.file_type === "application/pdf" ? (
                  <PdfCanvasViewer
                    // Keyed on the document alone. The page must never enter this
                    // key — that would remount pdf.js on every flip.
                    key={documentId}
                    url={signedUrl}
                    title={documentDisplayTitle(document)}
                    initialPage={activePage}
                    onUrlExpired={handleSignedUrlExpired}
                    onLoadSuccess={handlePdfLoadSuccess}
                    onPageChange={navigateToPage}
                    fitWidth={pdfFitWidth}
                    zoom={pdfZoom}
                    rotation={pdfRotation}
                    fullscreen={pdfFullscreen}
                    highlightedBbox={highlightedImage?.bbox ?? null}
                    highlightedBboxPage={highlightedImage?.page_number ?? null}
                    onFitWidthChange={handlePdfFitWidthChange}
                    onZoomChange={handlePdfZoomChange}
                    // The same handler DocumentFrame's rotate control uses, so
                    // the keyboard reaches rotation without the viewer owning a
                    // second copy of that state.
                    onRotate={handlePdfRotate}
                  />
                ) : (
                  <NonPdfSourcePreview
                    fileType={document?.file_type}
                    title={document ? documentDisplayTitle(document) : "Source document"}
                    signedUrl={signedUrl}
                    downloadSignedUrl={downloadSignedUrl}
                  />
                )}
              </DocumentFrame>
            </div>
          </div>

          <div className="grid gap-4 sm:gap-5">
            <PinnedSourceEvidence
              loading={effectiveLoadingDocument}
              chunk={selectedChunk}
              compact
              sectionId="source-evidence"
              onInspectIndexedText={inspectIndexedTextSection}
            />
            <IndexedTextPanel
              loading={effectiveLoadingDocument}
              selectedPage={selectedPage}
              chunks={chunks}
              search={sourceSearch}
              documentSearchResults={currentDocumentSearchResults}
              searchingDocument={documentSearchPending}
              documentSearchError={currentDocumentSearchError}
              idPrefix="source-chunk"
              sectionId="source-text"
              selectedChunkId={activeChunkId}
              onSearchChange={setSourceSearch}
              compact={compactView}
              revealRequest={inspectIndexedText || normalizedSourceSearch.length >= 2}
            />
          </div>
        </div>

        <DocumentViewerRail
          className="max-sm:order-4"
          headerHidden={headerHidden}
          documentSections={documentSections}
          activeSectionId={activeSectionId}
          onSelectSection={jumpToSection}
          compact={compactView}
          onCompactChange={setCompactView}
          indexWarnings={indexWarnings}
          effectiveLoadingDocument={effectiveLoadingDocument}
          document={document}
          summaryBadges={summaryBadges}
          formattedStoredSummary={formattedStoredSummary}
          canUseAdministrativeApis={canUseAdministrativeApis}
          clientDemoMode={clientDemoMode}
          authorizationHeader={authorizationHeader}
          onLabelsUpdated={handleDocumentLabelsUpdated}
          onUnauthorized={markSessionExpired}
          onSearchByTag={searchByTag}
          clinicalImages={clinicalImages}
          auditImages={auditImages}
          tableFacts={tableFacts}
          reviewingTableFactId={reviewingTableFactId}
          onReviewTableFact={reviewTableFact}
          indexHealth={indexHealth}
          activePage={activePage}
          onSelectPage={navigateToPage}
        />
      </section>
      {readyDocument && documentSearchOpen ? (
        <PhoneFooterLayerPortal>
          <form
            id="document-viewer-search"
            onSubmit={(event) => {
              event.preventDefault();
              submitSourceSearch();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              closeDocumentSearch();
            }}
            data-scroll-hidden={composerScrollHidden ? "true" : undefined}
            onFocusCapture={() => setComposerChromeFocused(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerChromeFocused(false);
            }}
            className={cn(
              glassOverlaySurface,
              "phone-footer-layer document-viewer-composer floating-composer-edge dashboard-composer-edge z-40 mx-auto flex min-h-[56px] max-w-3xl items-center gap-2 rounded-full bg-[color:var(--surface-lux)] px-2 shadow-[var(--shadow-lux)] max-sm:transition-[transform,opacity] motion-reduce:transition-none sm:fixed",
              composerScrollHidden
                ? "max-sm:duration-[var(--duration-slow)] max-sm:ease-[var(--ease-chrome-hide)]"
                : "max-sm:duration-[var(--duration-moderate)] max-sm:ease-[var(--ease-chrome-reveal)]",
            )}
          >
            <button
              type="button"
              onClick={closeDocumentSearch}
              className="grid h-tap w-tap shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]"
              aria-label="Close document search"
              title="Close document search"
            >
              <X aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />
            </button>
            <label className="relative flex min-w-0 flex-1 items-center overflow-hidden">
              <span className="sr-only">Search within this document</span>
              <input
                ref={sourceSearchInputRef}
                value={sourceSearch}
                onChange={(event) => setSourceSearch(event.target.value)}
                placeholder="Search within this document..."
                className="min-h-tap min-w-0 flex-1 bg-transparent px-2 text-base font-medium text-[color:var(--text)] outline-none placeholder:text-[color:var(--text-placeholder)]"
              />
            </label>
            <button
              type="submit"
              disabled={!canViewSourceDocuments || normalizedSourceSearch.length < 2}
              className="grid h-tap w-tap shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] shadow-[var(--shadow-inset),var(--e1)] hover:bg-[color:var(--clinical-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Search within this document"
            >
              {documentSearchPending ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Search aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          </form>
        </PhoneFooterLayerPortal>
      ) : null}
    </main>
  );
}
