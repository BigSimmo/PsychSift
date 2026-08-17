"use client";
import { useSettingsState } from "./clinical-dashboard/SettingsStateProvider";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CircleAlert,
  BookOpen,
  Clock3,
  ExternalLink,
  FileImage,
  FileText,
  FolderOpen,
  Heart,
  ListChecks,
  Quote,
  RefreshCw,
  Search,
  ShieldAlert,
  Square,
  UploadCloud,
  Wrench,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { type DocumentDeleteResult } from "@/components/DocumentManagementActions";
import { useUploadDesktopLayout } from "@/components/clinical-dashboard/use-upload-desktop-layout";
import { extractSafetyFindings } from "@/lib/clinical-safety";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import { ownsVerticalScroll, scrollSurface } from "@/components/clinical-dashboard/scroll-surface";
import { isLocalNoAuthMode, resolveClientDemoMode, resolveUploadReadOnlyMode } from "@/lib/client-env";
import { isAdministratorUser } from "@/lib/authorization";
import { readLocalProjectIdentity, unsafeLocalProjectMessage } from "@/lib/local-project-identity";
import { isDeployedClinicalKb } from "@/lib/deployed-app";
import {
  appBackdrop,
  cn,
  EmptyState,
  floatingControl,
  InlineNotice,
  primaryControl,
  textMuted,
} from "@/components/ui-primitives";
import { useAuthSession } from "@/lib/supabase/client";
import { useEventCallback } from "@/components/clinical-dashboard/use-event-callback";
import { useScopeFilterRelax } from "@/components/clinical-dashboard/use-scope-filter-relax";
import { AuthPanel } from "@/components/clinical-dashboard/auth-panel";
import { buildMobileSectionFabState, MobileSectionFab, ToolsHub } from "@/components/clinical-dashboard/dashboard-nav";
import * as SidebarDialogs from "@/components/clinical-dashboard/lazy-sidebar-dialogs";
import { useSettingsGuideFlow } from "@/components/clinical-dashboard/use-settings-guide-flow";
import {
  deriveSidebarIdentity,
  ClinicalDesktopSidebar,
  ClinicalMobileSidebar,
} from "@/components/clinical-dashboard/ClinicalSidebar";
import {
  fallbackSetupChecks,
  hasReadyRequiredPublicSearchConfig,
  hasReadyPublicSearchSetup,
  type SetupCheck,
  type IngestionQualityReviewItem,
} from "@/components/clinical-dashboard/document-manager-contracts";
import { LibraryHealthStrip } from "@/components/clinical-dashboard/library-health-strip";
import { GuideTrigger, UtilityDrawer } from "@/components/clinical-dashboard/dashboard-shell";
import { LazyGuideDialog, loadGuideDialog } from "@/components/clinical-dashboard/lazy-guide-dialog";
import { SystemNotice, DegradedNotice } from "@/components/clinical-dashboard/dashboard-notices";
import { sanitizeAnswerDisplayText, sanitizeDisplayText } from "@/components/clinical-dashboard/display-text";
import { isPreformattedGroundedAnswer } from "@/components/clinical-dashboard/answer-content";
import {
  AnswerProgressStepper,
  AnswerSkeleton,
  SearchProgressBanner,
  SharedHomeEmptyState,
} from "@/components/clinical-dashboard/answer-status";
import {
  type AnswerProgressUpdate,
  type TimedAnswerProgressUpdate,
} from "@/components/clinical-dashboard/answer-progress";
import { evidenceMapRowsFromRenderModel } from "@/components/clinical-dashboard/evidence-map-model";
import { MasterSearchHeader } from "@/components/clinical-dashboard/master-search-header";
import { PhoneFooterLayerFrame } from "@/components/clinical-dashboard/phone-footer-layer-portal";
import {
  resolveDashboardVisibleMobileComposerReserve,
  resolveMobileComposerReserve,
} from "@/components/clinical-dashboard/mobile-composer-reserve";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import { FavouritesGuestGate } from "@/components/clinical-dashboard/favourites-guest-gate";
import { useDashboardShellActions } from "@/components/clinical-dashboard/use-dashboard-shell-actions";
import { focusComposerInput as scheduleComposerFocus } from "@/components/clinical-dashboard/focus-composer-input";
import {
  resolveDashboardHideOnScroll,
  useDashboardChromeCoordinator,
} from "@/components/clinical-dashboard/use-dashboard-chrome-coordinator";
import { SearchCommandProvider } from "@/components/clinical-dashboard/search-command-context";
import {
  answerReferencesDocument,
  answerTimedOutError,
  applyRenamedDocumentToAnswer,
  compactScopeFilters,
  hasActiveIndexingWork,
  hasNonProductionSupabaseApiKeyFallback,
  isAbortError,
  releaseOwnedAbortController,
  replaceOwnedAbortController,
  mergeDocumentRefresh,
  normalizeNavigationHash,
  setupNeedsSlowRecheck,
  setupRecheckPollMs,
  shorterPollDelay,
} from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import { answerRecovery, errorCopy } from "@/lib/ui-copy";
import { summarizeBulkReindexPayload } from "@/lib/bulk-reindex-results";
import {
  type DocumentDrawerMode,
  type DocumentDrawerStatusFilter,
  type DocumentPagination,
  type LabelReviewMutationBody,
} from "@/components/clinical-dashboard/dashboard-contracts";
import {
  activeIndexingPollFallbackMs,
  clinicalQueryModeOptions,
  documentPageSize,
  indexingWorkDetailsPollMs,
  stagedDashboardExtraction,
  type BatchesPayload,
  type DocumentsPayload,
  type IngestionQualityPayload,
  type JobsPayload,
  type RefreshOptions,
  type SearchResultModePayload,
  type SetupStatusPayload,
  type SourceLibrarySearchMode,
} from "@/components/clinical-dashboard/clinical-dashboard-payloads";
import {
  type IndexingMonitorFilter,
  type LibraryHealthTarget,
  type UploadIndexingTab,
} from "@/components/clinical-dashboard/document-admin";
import { useHomeModeSeed } from "@/components/clinical-dashboard/use-home-mode-seed";
import {
  DifferentialsHome,
  DocumentDrawer,
  DocumentSearchResultsPanel,
  FavouritesHub,
  IndexingMonitor,
  IngestionQualityConsole,
  loadStagedAnswerResultSurface,
  MedicationPrescribingWorkspace,
  RelatedDocumentsPanel,
  SetupChecklist,
  StagedAnswerResultSurface,
  UploadPanel,
} from "@/components/clinical-dashboard/clinical-dashboard-lazy";

import { clearLegacyRecentQueries, recentQueryStorageKey } from "@/lib/recent-query-storage";
import type { SearchFacets } from "@/components/clinical-dashboard/document-search-results";
import { isWeakRelevance } from "@/components/clinical-dashboard/relevance";
import {
  answerPayloadIsUsable,
  classifyAnswerError,
  createAnswerRequestWatchdog,
  generateQuerySuggestions,
  isRetryableError,
  keywordQueryFromNaturalLanguage,
  makeSearchError,
  progressForRetry,
  readAnswerStream,
  searchRetryCount,
  searchRetryDelaysMs,
  sleep,
  type AnswerErrorKind,
  type AnswerPayload,
  type SearchError,
} from "@/components/clinical-dashboard/search-utils";
import {
  appModeQueryMode,
  appModeHomeHref,
  appModeResultKind,
  appModeCanUseSourceLibraryShortcut,
  appModeSearchConfig,
  appModeSelectionHref,
  appModeSourceLibrarySearchMode,
  isAppModeId,
  isAppModeVisible,
  type AppModeId,
} from "@/lib/app-modes";
import { useLastAppMode } from "@/components/clinical-dashboard/use-last-app-mode";
import { isDashboardModeHref } from "@/lib/search-route-ownership";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import {
  privateScopeReadyForRoute,
  readSearchNavigationContext,
  routedSubmissionContextChanged,
  searchNavigationContextSignature,
  searchSubmissionSignature,
  type PrivateScopeRestorationStatus,
  type SearchNavigationContext,
} from "@/lib/search-navigation-context";
import {
  persistPrivateSearchScope,
  removePrivateScopeRefFromUrl,
  restorePrivateSearchScope,
} from "@/lib/private-search-scope";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import { answerLifecycleReducer, initialAnswerLifecycle } from "@/lib/answer-lifecycle";
import { useDeferredRegistrySearch } from "@/components/clinical-dashboard/use-deferred-registry-search";
import { buildAnswerFollowUpQuery, buildAnswerFollowUpSuggestions } from "@/lib/answer-follow-up";
import {
  clearPersistedAnswerThread,
  createAnswerThreadSnapshotMetadata,
  maxStoredAnswerTurns,
} from "@/lib/answer-thread-storage";
import { useAnswerThreadBootstrap } from "@/components/clinical-dashboard/use-answer-thread-bootstrap";
import {
  resolveDashboardAnswerThreadOwnerId,
  usePersistedAnswerThread,
  type AnswerThreadSnapshotMetadata,
} from "@/components/clinical-dashboard/use-persisted-answer-thread";
import { buildAnswerClipboardText } from "@/components/clinical-dashboard/answer-copy-payload";
import { buildAnswerRenderModel, isAnswerSourceBacked } from "@/lib/answer-render-policy";
import {
  frontendSourceGovernanceWarnings,
  groupSourceGovernanceWarnings,
  type SourceGovernanceWarning,
} from "@/lib/source-governance";
import { type SmartDocumentTag, type SmartDocumentTagFacet } from "@/lib/document-tags";
import type {
  ClinicalDocument,
  DocumentMatch,
  EvidenceRelevance,
  ImportBatch,
  IngestionJob,
  QuoteCard,
  RagAnswer,
  AnswerSection,
  SearchResult,
  SearchScopeSummary,
  ClinicalQueryMode,
  DocumentLabel,
} from "@/lib/types";
import type { SearchScopeFilters } from "@/lib/search-scope";
import { DashboardDesktopResultComposerSlot } from "@/components/clinical-dashboard/dashboard-desktop-result-composer-slot";
import {
  desktopPageComposerSlotId,
  differentialsMobileCompareAddonSlotId,
  patientDetailsAddonSlotId,
  modeHomeDesktopComposerSlotId,
} from "@/lib/mode-home-composer";
import { toolCatalogRecords } from "@/lib/tools-catalog";
import { createQuoteFollowUp, type AnswerViewMode, shouldPollForUpdates } from "@/lib/ward-output";
import {
  type AnswerTurn,
  maxVisiblePriorTurns,
  PriorAnswerTurnSurface,
} from "@/components/clinical-dashboard/answer-thread-turn";
import type { AnswerFeedbackType } from "@/lib/answer-feedback";
export type { AnswerFeedbackType } from "@/lib/answer-feedback";

/**
 * Renders the clinical search dashboard, including document search, answer generation, conversation history, source management, and ingestion controls.
 *
 * @param initialSearchMode - The mode selected when the dashboard loads.
 * @param initialQuery - The initial search or composer query.
 * @param focusSearch - Whether to focus the search input on load.
 * @param autoRunSearch - Whether to automatically submit the initial query.
 */
export function ClinicalDashboard({
  initialSearchMode = "answer",
  initialQuery = "",
  focusSearch = false,
  autoRunSearch = false,
}: { initialSearchMode?: AppModeId; initialQuery?: string; focusSearch?: boolean; autoRunSearch?: boolean } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [lastAppMode, setLastAppMode] = useLastAppMode();
  const [initialSearchNavigationContext] = useState(() => readSearchNavigationContext(searchParams));
  const scrollFrameRef = useRef<number | null>(null);
  const navSyncLockRef = useRef<number | null>(null);
  const autoRunSearchSignatureRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<{
    epoch: number;
    dataScope: number;
    promise: Promise<void>;
  } | null>(null);
  const dashboardDataLoadedRef = useRef(false);
  const administrationDataLoadedRef = useRef(false);
  const nextWorkStatePollRef = useRef(0);
  const urlSearchBootstrappedRef = useRef(false);
  const urlDocumentSearchBootstrappedRef = useRef(false);
  const lastSyncedSearchParamsRef = useRef(searchParams.toString());
  const modeChangeFromUiRef = useRef(false);
  const [documents, setDocuments] = useState<ClinicalDocument[]>([]);
  const documentsRef = useRef(documents);
  const [documentsPagination, setDocumentsPagination] = useState<DocumentPagination | null>(null);
  const indexedDocumentTotal = documentsPagination?.total ?? documents.length;
  const [dashboardDataLoading, setDashboardDataLoading] = useState(false);
  const [loadingMoreDocuments, setLoadingMoreDocuments] = useState(false);
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [qualityItems, setQualityItems] = useState<IngestionQualityReviewItem[]>([]);
  const jobsRef = useRef(jobs);
  const batchesRef = useRef(batches);
  const answerThreadBootstrappedRef = useRef(false);
  const activeAnswerThreadOwnerIdRef = useRef<string | null>(null);
  const [answerThreadBootstrapped, setAnswerThreadBootstrapped] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<AppModeId>(initialSearchMode);
  const {
    activeScrollOwner,
    assignMainRef,
    bottomComposerHidden,
    chromeScrollHidden,
    chromeTransitioning,
    composerInputRef,
    mainRef,
    reserveTransitioning,
    setBottomComposerHidden,
  } = useDashboardChromeCoordinator(searchMode);
  const focusComposerInput = useCallback(
    (retainTarget = false) => scheduleComposerFocus(composerInputRef, retainTarget),
    [composerInputRef],
  );
  const [modeSearchSubmitted, setModeSearchSubmitted] = useState(() =>
    Boolean(autoRunSearch && initialQuery.trim() && initialSearchMode !== "tools"),
  );
  // focus=1 means "focus on entry", not "keep the dock focused after results".
  // Suppress autofocus once a mode search/answer has been submitted so hide-on-
  // scroll can reclaim chrome on result views (Answer and other bottom docks).
  const shouldAutoFocusComposer = focusSearch && !modeSearchSubmitted;
  const [answer, setAnswer] = useState<RagAnswer | null>(null);
  const [sources, setSources] = useState<SearchResult[]>([]);
  // Answer-mode conversation thread. `priorAnswerTurns` holds completed
  // exchanges displayed above the latest answer; `latestAnswerQuery` is the
  // question that produced the current `answer` (the composer `query` is a
  // draft that clears after each successful answer). The ref mirrors the
  // latest committed turn so async search completions can archive it without
  // reading stale closure state.
  const [priorAnswerTurns, setPriorAnswerTurns] = useState<AnswerTurn[]>([]);
  const [latestAnswerQuery, setLatestAnswerQuery] = useState<string | null>(null);
  const [collapsedTurnIds, setCollapsedTurnIds] = useState<Set<string>>(() => new Set());
  const [showEarlierTurns, setShowEarlierTurns] = useState(false);
  const threadRestoreScrolledRef = useRef(false);
  const restoredThreadFromStorageRef = useRef(false);
  const latestAnswerTurnRef = useRef<Omit<AnswerTurn, "id"> | null>(null);
  const latestAnswerSnapshotMetadataRef = useRef<AnswerThreadSnapshotMetadata | null>(null);
  const answerTurnSeqRef = useRef(0);
  const [documentMatches, setDocumentMatches] = useState<DocumentMatch[]>([]);
  const [searchRelevance, setSearchRelevance] = useState<EvidenceRelevance | null>(null);
  const [searchFacets, setSearchFacets] = useState<SearchFacets | null>(null);
  const [queryMode, setQueryMode] = useState<ClinicalQueryMode>(initialSearchNavigationContext.queryMode);
  const activeModeSearch = appModeSearchConfig(searchMode);
  const activeModeResultKind = appModeResultKind(searchMode);
  const requestQueryMode = appModeQueryMode(searchMode, queryMode);
  const submittedUrlMode = searchParams.get("mode");
  const submittedUrlModeMatchesActive =
    !submittedUrlMode ||
    (isAppModeId(submittedUrlMode) && isAppModeVisible(submittedUrlMode) && submittedUrlMode === searchMode);
  const submittedUrlRunRequested = searchParams.get("run") === "1";
  const submittedUrlQuery =
    autoRunSearch && submittedUrlRunRequested && submittedUrlModeMatchesActive
      ? (searchParams.get("q") ?? searchParams.get("query") ?? "").trim()
      : "";

  useEffect(() => {
    void loadStagedAnswerResultSurface();
  }, []);

  const routedSearchContext = useMemo(() => readSearchNavigationContext(searchParams), [searchParams]);
  const routedSearchContextSignature = searchNavigationContextSignature(routedSearchContext);
  const [privateScopeStatus, setPrivateScopeStatus] = useState<PrivateScopeRestorationStatus>(
    initialSearchNavigationContext.scopeRef ? "restoring" : "none",
  );
  const [restoredPrivateScopeRef, setRestoredPrivateScopeRef] = useState<string | null>(null);

  // Record matches come from the owner-scoped registry API (mock fixtures in
  // demo mode); ranking stays client-side (deferred) so live-typing stays
  // responsive and the registry is fetched once per active mode.
  const { recordSearchMatches, recordSearchMode, recordStatus } = useDeferredRegistrySearch(searchMode, query);
  // The thread mirror ref must never outlive the answer it describes: every
  // reset path nulls `answer`, so clearing here covers them all (mode
  // switches, new chat, differentials/services clears) without each caller
  // having to remember the ref.
  useEffect(() => {
    if (!answerThreadBootstrappedRef.current) return;
    if (answer === null) latestAnswerTurnRef.current = null;
  }, [answer]);
  useEffect(() => {
    if (
      !answerThreadBootstrappedRef.current ||
      !answer ||
      !restoredThreadFromStorageRef.current ||
      threadRestoreScrolledRef.current
    ) {
      return;
    }
    threadRestoreScrolledRef.current = true;
    window.requestAnimationFrame(() => {
      scrollSurface(mainRef.current, "end");
    });
  }, [answer, mainRef]);
  const resetAnswerThread = useCallback(() => {
    setPriorAnswerTurns([]);
    setLatestAnswerQuery(null);
    setCollapsedTurnIds(new Set());
    setShowEarlierTurns(false);
    latestAnswerSnapshotMetadataRef.current = null;
    const ownerId = activeAnswerThreadOwnerIdRef.current;
    if (ownerId) clearPersistedAnswerThread(ownerId);
  }, []);
  function toggleAnswerTurnCollapsed(turnId: string) {
    setCollapsedTurnIds((current) => {
      const next = new Set(current);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  }
  // The query the current documentMatches were fetched for, so the
  // differentials results view can tell live-edited catalogue results apart
  // from evidence that belongs to a previously submitted search.
  const [differentialEvidenceQuery, setDifferentialEvidenceQuery] = useState<string | null>(null);
  const clearModeResultState = useCallback(() => {
    resetAnswerThread();
    setAnswer(null);
    setSources([]);
    setDocumentMatches([]);
    setSearchRelevance(null);
    setSearchFacets(null);
    setSearchScope(null);
    setSourceGovernanceWarnings([]);
    setError(null);
    setAnswerProgress(null);
    setDifferentialEvidenceQuery(null);
  }, [resetAnswerThread]);
  const [scopeFilters, setScopeFilters] = useState<SearchScopeFilters>(initialSearchNavigationContext.scopeFilters);
  const [searchScope, setSearchScope] = useState<SearchScopeSummary | null>(null);
  const [sourceGovernanceWarnings, setSourceGovernanceWarnings] = useState<SourceGovernanceWarning[]>([]);
  const [answerViewMode, setAnswerViewMode] = useState<AnswerViewMode>("high_yield");
  const [bulkActionStatus, setBulkActionStatus] = useState<string | null>(null);
  const [bulkActionBusy, setBulkActionBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [answerProgress, setAnswerProgress] = useState<string | null>(null);
  const [answerProgressEvents, setAnswerProgressEvents] = useState<TimedAnswerProgressUpdate[]>([]);
  const [answerProgressStartedAt, setAnswerProgressStartedAt] = useState<number | null>(null);
  const [answerLifecycle, dispatchAnswerLifecycle] = useReducer(answerLifecycleReducer, initialAnswerLifecycle);
  const [error, setError] = useState<string | null>(null);
  // Companion state for `error`, used to pick the right recovery UI (retry vs.
  // a calm no-results panel) and to re-run the exact query that failed. Only read
  // while `error` is truthy, and set alongside every `setError(<message>)` so a
  // stale value can never leak into a later, unrelated error.
  const [errorKind, setErrorKind] = useState<AnswerErrorKind | null>(null);
  const [lastFailedQuery, setLastFailedQuery] = useState<string | null>(null);
  const [setupWarning, setSetupWarning] = useState<string | null>(null);
  const [setupChecks, setSetupChecks] = useState<SetupCheck[]>(fallbackSetupChecks);
  const [demoMode, setDemoMode] = useState(false);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [localProjectReady, setLocalProjectReady] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const routedDocumentId = searchParams.get("documentId");
  const scopedDocumentIds = useMemo(
    () =>
      routedDocumentId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(routedDocumentId)
        ? [routedDocumentId]
        : [],
    [routedDocumentId],
  );
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>(scopedDocumentIds);
  useEffect(() => {
    queueMicrotask(() => setSelectedDocumentIds(scopedDocumentIds));
  }, [scopedDocumentIds]);
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const [pendingFeedback, setPendingFeedback] = useState<AnswerFeedbackType | null>(null);
  const [actionNotice, setActionNotice] = useState<{ tone: "success" | "warning"; message: string } | null>(null);
  const [activeHash, setActiveHash] = useState("#search");
  const navigateMobileSection = useCallback(
    (href: string, options: { updateHistory?: boolean } = {}) => {
      const shouldUpdateHistory = options.updateHistory ?? true;
      const main = mainRef.current;
      if (!main) return;

      if (navSyncLockRef.current !== null) {
        window.clearTimeout(navSyncLockRef.current);
      }

      if (href === "#search") {
        setActiveHash(href);
        scrollSurface(main, 0);
        if (shouldUpdateHistory) window.history.replaceState(null, "", href);
        navSyncLockRef.current = window.setTimeout(() => {
          navSyncLockRef.current = null;
        }, 350);
        return;
      }

      const target = document.querySelector<HTMLElement>(href);
      if (!target) return;
      setActiveHash(href);
      const targetTop = target.getBoundingClientRect().top;
      const top = ownsVerticalScroll(main)
        ? main.scrollTop + targetTop - main.getBoundingClientRect().top - 8
        : window.scrollY + targetTop - 8;
      scrollSurface(main, top);
      if (shouldUpdateHistory) window.history.replaceState(null, "", href);
      navSyncLockRef.current = window.setTimeout(() => {
        navSyncLockRef.current = null;
      }, 350);
    },
    [mainRef],
  );
  const settingsState = useSettingsState();
  const documentsDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const uploadUsesDesktopRegions = useUploadDesktopLayout();
  const uploadTabRefs = useRef(new Map<UploadIndexingTab, HTMLButtonElement>());
  const [documentDrawerStatusFilter, setDocumentDrawerStatusFilter] = useState<DocumentDrawerStatusFilter>("indexed");
  const [indexingMonitorFilter, setIndexingMonitorFilter] = useState<IndexingMonitorFilter>("all");
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const searchCommandContextValue = useMemo(
    () => ({
      query,
      modeId: searchMode,
    }),
    [query, searchMode],
  );
  const [indexingActionId, setIndexingActionId] = useState<string | null>(null);
  const [indexingActive, setIndexingActive] = useState(false);
  const [userStartedIngestion, setUserStartedIngestion] = useState(false);
  const [nextRefreshDelayMs, setNextRefreshDelayMs] = useState<number | null>(null);
  const auth = useAuthSession();
  const {
    status: authStatus,
    authorizationHeader,
    authEpoch,
    registerAuthRequest,
    isAuthEpochCurrent,
    markSessionExpired,
  } = auth;
  const authBoundFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const controller = new AbortController();
      const authRequest = registerAuthRequest(controller);
      try {
        const response = await fetch(input, { ...init, signal: controller.signal });
        if (!isAuthEpochCurrent(authRequest.epoch)) throw new DOMException("Stale authentication epoch", "AbortError");
        return { response, requestEpoch: authRequest.epoch };
      } finally {
        authRequest.release();
      }
    },
    [isAuthEpochCurrent, registerAuthRequest],
  );
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const scopeRef = routedSearchContext.scopeRef;
      if (!scopeRef) {
        setRestoredPrivateScopeRef(null);
        setPrivateScopeStatus("none");
        return;
      }
      if (authStatus === "loading") {
        setRestoredPrivateScopeRef(null);
        setPrivateScopeStatus("restoring");
        return;
      }
      const ownerId = auth.session?.user.id;
      if (authStatus !== "authenticated" || !ownerId) {
        setSelectedDocumentIds([]);
        setRestoredPrivateScopeRef(null);
        setPrivateScopeStatus("unavailable");
        return;
      }
      const restored = restorePrivateSearchScope(window.sessionStorage, scopeRef, ownerId);
      if (restored.kind === "restored") {
        setSelectedDocumentIds(restored.documentIds);
        setRestoredPrivateScopeRef(scopeRef);
        setPrivateScopeStatus("restored");
      } else {
        setSelectedDocumentIds([]);
        setRestoredPrivateScopeRef(null);
        setPrivateScopeStatus("unavailable");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [auth.session?.user.id, authStatus, routedSearchContext.scopeRef]);
  const prevAuthStatusRef = useRef(authStatus);
  useEffect(() => {
    const previous = prevAuthStatusRef.current;
    prevAuthStatusRef.current = authStatus;
    if ((authStatus === "signed_out" || authStatus === "expired") && previous === "authenticated") {
      searchRequestSeqRef.current += 1;
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      refreshInFlightRef.current = null;
      resetAnswerThread();
      setAnswer(null);
      setSources([]);
      setDocuments([]);
      setDocumentsPagination(null);
      setJobs([]);
      setBatches([]);
      setQualityItems([]);
      dashboardDataLoadedRef.current = false;
      administrationDataLoadedRef.current = false;
      setUserStartedIngestion(false);
      setSelectedDocumentIds([]);
      setDocumentMatches([]);
      setSearchScope(null);
      setSearchFacets(null);
      setSourceGovernanceWarnings([]);
      setActionNotice(null);
      setLoading(false);
      setAnswerProgress(null);
      dispatchAnswerLifecycle({ type: "reset" });
      latestAnswerTurnRef.current = null;
    }
  }, [authStatus, resetAnswerThread]);
  const supabaseEnvStatus = setupChecks.find((check) => check.id === "env")?.status;
  const browserAuthUnavailableDemoFallback = !auth.isConfigured && supabaseEnvStatus !== "ready";
  const localNoAuthMode = isLocalNoAuthMode();
  const explicitDemoMode = demoMode || process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const clientDemoMode = resolveClientDemoMode({
    explicitDemoMode,
    authUnavailableFallback: browserAuthUnavailableDemoFallback,
    localNoAuthMode,
  });
  const sidebarIdentity = useMemo(() => deriveSidebarIdentity(auth.session?.user.email), [auth.session?.user.email]);
  const {
    favouritesAccessible,
    accountSetupOpen,
    accountSetupIntent,
    closeAccountSetup,
    closeTransientSurfaces: closeDashboardTransientSurfaces,
    openAccountSetup,
    openGuide,
    closeGuide,
    openSettings,
    closeSettings,
    openAccountProfile,
    prefetchApplications,
  } = useDashboardShellActions({
    authenticated: auth.status === "authenticated",
    demoMode: clientDemoMode,
    signedIn: sidebarIdentity.signedIn,
    setGuideOpen: settingsState.setGuideOpen,
    setSettingsOpen: settingsState.setSettingsOpen,
    setMobileSidebarOpen: settingsState.setMobileSidebarOpen,
    setDocumentsDrawerOpen: settingsState.setDocumentsDrawerOpen,
    setUploadDrawerOpen: settingsState.setUploadDrawerOpen,
    prefetch: (href) => router.prefetch(href),
  });
  const settingsGuideFlow = useSettingsGuideFlow({
    openGuide,
    closeGuide,
    openSettings,
    openAccountProfile,
    setSettingsOpen: settingsState.setSettingsOpen,
  });
  const answerThreadOwnerId = resolveDashboardAnswerThreadOwnerId(auth.session?.user.id, clientDemoMode, authStatus);
  useAnswerThreadBootstrap({
    answerThreadOwnerId,
    authStatus,
    searchMode,
    submittedUrlQuery,
    expectedSubmissionSignature:
      searchMode === "answer" && submittedUrlQuery
        ? searchSubmissionSignature(searchMode, submittedUrlQuery, routedSearchContext)
        : undefined,
    activeAnswerThreadOwnerIdRef,
    answerThreadBootstrappedRef,
    restoredThreadFromStorageRef,
    latestAnswerTurnRef,
    latestAnswerSnapshotMetadataRef,
    answerTurnSeqRef,
    autoRunSearchSignatureRef,
    setPriorAnswerTurns,
    setLatestAnswerQuery,
    setCollapsedTurnIds,
    setShowEarlierTurns,
    setAnswer,
    setSources,
    setModeSearchSubmitted,
    setQuery,
    setAnswerThreadBootstrapped,
  });
  // Local no-auth can still exercise public-read APIs, but administration is always
  // derived separately from the immutable account role claim.
  const uploadReadOnlyMode = resolveUploadReadOnlyMode({
    explicitDemoMode,
    authUnavailableFallback: browserAuthUnavailableDemoFallback,
  });
  const localDevCanAttemptPrivateApis = process.env.NODE_ENV !== "production" && hasReadyPublicSearchSetup(setupChecks);
  const canUsePublicSearchApis = localProjectReady && hasReadyPublicSearchSetup(setupChecks);
  const canUseDegradedLocalSearchApis =
    process.env.NODE_ENV !== "production" && localProjectReady && hasReadyRequiredPublicSearchConfig(setupChecks);
  const canUseNonProductionDemoFallback = localProjectReady && hasNonProductionSupabaseApiKeyFallback(setupChecks);
  const canUsePrivateApis =
    localProjectReady && (localNoAuthMode || localDevCanAttemptPrivateApis || authStatus === "authenticated");
  const isAdministrator = isAdministratorUser(auth.session?.user);
  const canUseAdministrativeApis = localProjectReady && isAdministrator;
  const canUploadDocuments = canUseAdministrativeApis && canUsePublicSearchApis;
  const canAttemptDeployedPublicSearch = isDeployedClinicalKb() && localProjectReady;
  const canRunSearch =
    explicitDemoMode ||
    canUsePublicSearchApis ||
    canUseDegradedLocalSearchApis ||
    canUseNonProductionDemoFallback ||
    canAttemptDeployedPublicSearch;
  const openLibraryHealthTarget = useCallback(
    (target: LibraryHealthTarget) => {
      if (!canUseAdministrativeApis) {
        closeDashboardTransientSurfaces("documents");
        settingsState.setDocumentsDrawerMode("library");
        settingsState.setDocumentsDrawerOpen(true);
        setActionNotice({
          tone: "warning",
          message: "Library health and indexing controls are administrator-only.",
        });
        return;
      }

      const targetId =
        target === "documents"
          ? "dashboard-documents-drawer"
          : target === "setup"
            ? "dashboard-setup-section"
            : "dashboard-indexing-section";

      if (target === "documents") {
        closeDashboardTransientSurfaces("documents");
        setDocumentDrawerStatusFilter("indexed");
        settingsState.setDocumentsDrawerMode("admin");
        settingsState.setDocumentsDrawerOpen(true);
      } else if (target === "indexing") {
        closeDashboardTransientSurfaces("upload");
        settingsState.setUploadMobileTab("jobs");
        setIndexingMonitorFilter("active");
        settingsState.setUploadDrawerOpen(true);
      } else if (target === "failures") {
        closeDashboardTransientSurfaces("upload");
        settingsState.setUploadMobileTab("jobs");
        setIndexingMonitorFilter("failed");
        settingsState.setUploadDrawerOpen(true);
      } else {
        closeDashboardTransientSurfaces("upload");
        settingsState.setUploadMobileTab("setup");
        setIndexingMonitorFilter("all");
        settingsState.setUploadDrawerOpen(true);
      }

      window.setTimeout(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: resolveScrollBehavior(), block: "start" });
      }, 0);
    },
    [canUseAdministrativeApis, closeDashboardTransientSurfaces, settingsState],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(prefetchApplications, 250);
    return () => window.clearTimeout(timeoutId);
  }, [prefetchApplications]);

  // The dashboard renders directly on "/" without the standalone search shell,
  // so it must purge the legacy unscoped recent-queries key too (2026-07-13
  // audit, finding 4).
  useEffect(() => {
    clearLegacyRecentQueries();
  }, []);

  useEffect(() => {
    if (!answerThreadOwnerId) {
      queueMicrotask(() => setRecentQueries([]));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const stored = JSON.parse(
          window.sessionStorage.getItem(`${recentQueryStorageKey}:${answerThreadOwnerId}`) ?? "[]",
        );
        setRecentQueries(
          Array.isArray(stored)
            ? stored.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 5)
            : [],
        );
      } catch {
        setRecentQueries([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [answerThreadOwnerId]);

  const rememberRecentQuery = useCallback(
    (value: string) => {
      const trimmedValue = value.trim();
      if (!trimmedValue) return;
      setRecentQueries((current) => {
        const next = [
          trimmedValue,
          ...current.filter((item) => item.toLowerCase() !== trimmedValue.toLowerCase()),
        ].slice(0, 5);
        try {
          if (answerThreadOwnerId) {
            window.sessionStorage.setItem(`${recentQueryStorageKey}:${answerThreadOwnerId}`, JSON.stringify(next));
          }
        } catch {
          // Recent questions are a convenience only; ignore storage failures.
        }
        return next;
      });
    },
    [answerThreadOwnerId],
  );

  usePersistedAnswerThread({
    ownerId: answerThreadOwnerId,
    enabled: answerThreadBootstrapped && searchMode === "answer",
    answer,
    priorTurns: priorAnswerTurns,
    latestTurn: latestAnswerTurnRef.current,
    collapsedTurnIds,
    showEarlierTurns,
    metadata: latestAnswerSnapshotMetadataRef.current,
  });

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    batchesRef.current = batches;
  }, [batches]);

  const refresh: (options?: RefreshOptions) => Promise<void> = useCallback(
    async (options: RefreshOptions = {}) => {
      const includeDashboardData = options.includeDashboardData ?? true;
      const includeAdministrationData = options.includeAdministrationData ?? includeDashboardData;
      const requestedDataScope = (includeDashboardData ? 1 : 0) | (includeAdministrationData ? 2 : 0);
      while (refreshInFlightRef.current?.epoch === authEpoch) {
        const activeRefresh = refreshInFlightRef.current;
        const needsFollowUp = (requestedDataScope & ~activeRefresh.dataScope) !== 0;
        await activeRefresh.promise;
        // A setup-only refresh cannot satisfy a data request that arrived
        // while it was in flight. Run one follow-up request; same-scope calls
        // stay coalesced on the original promise.
        if (!needsFollowUp) return;
        // The promise is complete, so release its coalescing slot now. The
        // owning call still releases its auth request in its own finally.
        if (refreshInFlightRef.current === activeRefresh) refreshInFlightRef.current = null;
      }

      const controller = new AbortController();
      const authRequest = registerAuthRequest(controller);
      const canCommit = () => isAuthEpochCurrent(authRequest.epoch) && !controller.signal.aborted;

      const promise = (async () => {
        const trackDashboardLoading = requestedDataScope !== 0;
        await Promise.resolve();
        if (trackDashboardLoading) setDashboardDataLoading(true);

        const includeSetup = options.includeSetup ?? true;
        const includeDocumentMeta = options.includeDocumentMeta ?? true;
        let nextDemoMode = clientDemoMode;
        let routeIndexingActive = false;
        let routePollDelayMs: number | null = null;

        setApiUnavailable(false);

        const localIdentity = await readLocalProjectIdentity().catch(() => null);
        if (!canCommit()) return;
        if (!localIdentity?.localServer?.safeLocalOrigin) {
          setLocalProjectReady(false);
          setApiUnavailable(true);
          setSetupWarning(unsafeLocalProjectMessage(localIdentity));
          setDocuments([]);
          setDocumentsPagination(null);
          setJobs([]);
          setBatches([]);
          setQualityItems([]);
          setIndexingActive(false);
          setNextRefreshDelayMs(null);
          return;
        }
        setLocalProjectReady(true);

        if (includeSetup) {
          const setupResponse = await fetch("/api/setup-status", {
            cache: "no-store",
            headers: authorizationHeader,
            signal: controller.signal,
          }).catch(() => null);
          if (!canCommit()) return;

          if (!setupResponse) {
            if (isDeployedClinicalKb()) {
              setSetupWarning("Setup status could not be loaded. You can still try search.");
            } else {
              setApiUnavailable(true);
              setSetupWarning("The local API is unavailable.");
              return;
            }
          } else if (setupResponse.ok) {
            const payload = (await setupResponse.json()) as SetupStatusPayload;
            setSetupChecks(payload.checks ?? fallbackSetupChecks);
            nextDemoMode = Boolean(payload.demoMode);
            routeIndexingActive = Boolean(payload.indexingActive);
            routePollDelayMs = shorterPollDelay(routePollDelayMs, payload.pollAfterMs);
            if (nextDemoMode) setDemoMode(true);
          } else if (isDeployedClinicalKb()) {
            setSetupWarning("Setup status could not be loaded. You can still try search.");
          } else {
            setApiUnavailable(true);
            return;
          }
        }

        if (!nextDemoMode && !canUsePrivateApis) {
          setDocuments([]);
          setDocumentsPagination(null);
          setJobs([]);
          setBatches([]);
          setQualityItems([]);
          setIndexingActive(routeIndexingActive);
          setNextRefreshDelayMs(routePollDelayMs);
          return;
        }

        if (requestedDataScope === 0) {
          setIndexingActive(routeIndexingActive);
          setNextRefreshDelayMs(routePollDelayMs);
          return;
        }

        const protectedHeaders = nextDemoMode ? undefined : authorizationHeader;
        const documentParams = new URLSearchParams({ limit: String(documentPageSize) });
        if (!includeDocumentMeta) {
          documentParams.set("includeMeta", "false");
        }

        const now = Date.now();
        const shouldRefreshWorkState =
          includeAdministrationData && (!administrationDataLoadedRef.current || now >= nextWorkStatePollRef.current);
        if (shouldRefreshWorkState) nextWorkStatePollRef.current = now + indexingWorkDetailsPollMs;

        const [documentsResponse, jobsResponse, batchesResponse, qualityResponse] = await Promise.all([
          includeDashboardData
            ? fetch(`/api/documents?${documentParams.toString()}`, {
                headers: protectedHeaders,
                signal: controller.signal,
              })
            : Promise.resolve(null as Response | null),
          shouldRefreshWorkState
            ? fetch("/api/ingestion/jobs", { headers: protectedHeaders, signal: controller.signal })
            : Promise.resolve(null as Response | null),
          shouldRefreshWorkState
            ? fetch("/api/ingestion/batches", { headers: protectedHeaders, signal: controller.signal })
            : Promise.resolve(null as Response | null),
          shouldRefreshWorkState
            ? fetch("/api/ingestion/quality", { headers: protectedHeaders, signal: controller.signal })
            : Promise.resolve(null as Response | null),
        ]);
        if (!canCommit()) return;
        if (
          (documentsResponse !== null && documentsResponse.status === 401) ||
          (jobsResponse !== null && jobsResponse.status === 401) ||
          (batchesResponse !== null && batchesResponse.status === 401) ||
          (qualityResponse !== null && qualityResponse.status === 401)
        ) {
          markSessionExpired();
          setDocuments([]);
          setDocumentsPagination(null);
          setJobs([]);
          setBatches([]);
          setQualityItems([]);
          setIndexingActive(false);
          setNextRefreshDelayMs(null);
          return;
        }

        let nextDocuments: ClinicalDocument[] = includeDashboardData ? [] : documentsRef.current;
        let nextJobs: IngestionJob[] = shouldRefreshWorkState ? [] : jobsRef.current;
        let nextBatches: ImportBatch[] = shouldRefreshWorkState ? [] : batchesRef.current;

        if (documentsResponse?.ok) {
          const payload = (await documentsResponse.json()) as DocumentsPayload;
          nextDocuments = payload.documents ?? [];
          setDocuments((current) =>
            includeDocumentMeta ? nextDocuments : mergeDocumentRefresh(current, nextDocuments),
          );
          setDocumentsPagination(payload.pagination ?? null);
          dashboardDataLoadedRef.current = true;
          routeIndexingActive ||= Boolean(payload.indexing?.active);
          routePollDelayMs = shorterPollDelay(routePollDelayMs, payload.indexing?.pollAfterMs);
          if (payload.demoMode) setDemoMode(true);
          if (payload.setupRequired) setSetupWarning(payload.error ?? null);
        } else if (includeDashboardData) {
          setApiUnavailable(true);
        }

        if (shouldRefreshWorkState && jobsResponse && jobsResponse.ok) {
          const payload = (await jobsResponse.json()) as JobsPayload;
          nextJobs = payload.jobs ?? [];
          setJobs(nextJobs);
          routeIndexingActive ||= Boolean(payload.hasActiveJobs);
          routePollDelayMs = shorterPollDelay(routePollDelayMs, payload.pollAfterMs);
          if (payload.demoMode) setDemoMode(true);
          if (payload.setupRequired) setSetupWarning(payload.error ?? null);
        } else if (shouldRefreshWorkState) {
          setApiUnavailable(true);
        }

        if (shouldRefreshWorkState && batchesResponse && batchesResponse.ok) {
          const payload = (await batchesResponse.json()) as BatchesPayload;
          nextBatches = payload.batches ?? [];
          setBatches(nextBatches);
          routeIndexingActive ||= Boolean(payload.hasActiveBatches);
          routePollDelayMs = shorterPollDelay(routePollDelayMs, payload.pollAfterMs);
          if (payload.demoMode) setDemoMode(true);
        } else if (shouldRefreshWorkState) {
          setApiUnavailable(true);
        }

        if (shouldRefreshWorkState && qualityResponse && qualityResponse.ok) {
          const payload = (await qualityResponse.json()) as IngestionQualityPayload;
          setQualityItems(payload.items ?? []);
          if (payload.demoMode) setDemoMode(true);
        } else if (shouldRefreshWorkState) {
          setApiUnavailable(true);
        }

        if (jobsResponse?.ok && batchesResponse?.ok && qualityResponse?.ok) {
          administrationDataLoadedRef.current = true;
        }

        const activeWork = hasActiveIndexingWork(nextDocuments, nextJobs, nextBatches, routeIndexingActive);
        setIndexingActive(activeWork);
        setNextRefreshDelayMs(routePollDelayMs ?? (activeWork ? activeIndexingPollFallbackMs : null));
      })();

      refreshInFlightRef.current = { epoch: authRequest.epoch, dataScope: requestedDataScope, promise };
      try {
        return await promise;
      } finally {
        authRequest.release();
        if (requestedDataScope !== 0 && canCommit()) setDashboardDataLoading(false);
        if (refreshInFlightRef.current?.promise === promise) {
          refreshInFlightRef.current = null;
        }
      }
    },
    [
      authEpoch,
      authorizationHeader,
      canUsePrivateApis,
      clientDemoMode,
      isAuthEpochCurrent,
      markSessionExpired,
      registerAuthRequest,
    ],
  );

  const loadMoreDocuments = useCallback(async () => {
    if (!documentsPagination?.hasMore || loadingMoreDocuments || !canUsePrivateApis) {
      return;
    }

    setLoadingMoreDocuments(true);
    try {
      const protectedHeaders = clientDemoMode ? undefined : authorizationHeader;
      const { response, requestEpoch } = await authBoundFetch(
        `/api/documents?limit=${documentPageSize}&offset=${documentsPagination.nextOffset}`,
        { headers: protectedHeaders },
      );
      if (response.status === 401) {
        markSessionExpired();
        return;
      }
      if (!response.ok) {
        if (!isAuthEpochCurrent(requestEpoch)) return;
        setApiUnavailable(true);
        return;
      }
      const payload = await response.json();
      if (!isAuthEpochCurrent(requestEpoch)) return;
      const nextDocuments = (payload.documents ?? []) as ClinicalDocument[];
      setDocuments((current) => {
        const seen = new Set(current.map((document) => document.id));
        return [...current, ...nextDocuments.filter((document) => !seen.has(document.id))];
      });
      setDocumentsPagination(payload.pagination ?? null);
    } catch (error) {
      if (!isAbortError(error)) setApiUnavailable(true);
    } finally {
      setLoadingMoreDocuments(false);
    }
  }, [
    authorizationHeader,
    authBoundFetch,
    canUsePrivateApis,
    clientDemoMode,
    documentsPagination,
    isAuthEpochCurrent,
    loadingMoreDocuments,
    markSessionExpired,
  ]);

  const retryJob = useCallback(
    async (jobId: string) => {
      setIndexingActionId(jobId);
      try {
        const { response, requestEpoch } = await authBoundFetch(`/api/ingestion/jobs/${jobId}/retry`, {
          method: "POST",
          headers: authorizationHeader,
        });
        if (response.status === 401) {
          markSessionExpired();
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!isAuthEpochCurrent(requestEpoch)) return;
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "Job retry could not be started.");
        }
        setUserStartedIngestion(true);
        setIndexingActive(true);
        setActionNotice({
          tone: "success",
          message: "Ingestion job retry queued.",
        });
        await refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false });
      } catch (error) {
        if (isAbortError(error)) return;
        setActionNotice({
          tone: "warning",
          message: error instanceof Error ? error.message : "Job retry could not be started.",
        });
      } finally {
        setIndexingActionId(null);
      }
    },
    [authBoundFetch, authorizationHeader, isAuthEpochCurrent, markSessionExpired, refresh],
  );

  const reindexDocument = useCallback(
    async (documentId: string, mode: "full" | "enrichment" = "full") => {
      setIndexingActionId(documentId);
      try {
        const { response, requestEpoch } = await authBoundFetch(`/api/documents/${documentId}/reindex`, {
          method: "POST",
          headers: {
            ...authorizationHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mode }),
        });
        if (response.status === 401) {
          markSessionExpired();
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!isAuthEpochCurrent(requestEpoch)) return;
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : mode === "enrichment"
                ? "Document enrichment could not be started."
                : "Document reindex could not be started.",
          );
        }
        setUserStartedIngestion(true);
        setIndexingActive(true);
        setActionNotice({
          tone: "success",
          message: mode === "enrichment" ? "Document enrichment refreshed." : "Document reindex queued.",
        });
        await refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false });
      } catch (error) {
        if (isAbortError(error)) return;
        setActionNotice({
          tone: "warning",
          message: error instanceof Error ? error.message : "Document reindex could not be started.",
        });
      } finally {
        setIndexingActionId(null);
      }
    },
    [authBoundFetch, authorizationHeader, isAuthEpochCurrent, markSessionExpired, refresh],
  );
  const enrichDocument = useCallback(
    (documentId: string) => reindexDocument(documentId, "enrichment"),
    [reindexDocument],
  );

  const handleDocumentRenamed = useCallback((updatedDocument: ClinicalDocument) => {
    setDocuments((current) =>
      current.map((document) => (document.id === updatedDocument.id ? { ...document, ...updatedDocument } : document)),
    );
    setSources((current) =>
      current.map((source) =>
        source.document_id === updatedDocument.id ? { ...source, title: updatedDocument.title } : source,
      ),
    );
    setDocumentMatches((current) =>
      current.map((document) =>
        document.document_id === updatedDocument.id ? { ...document, title: updatedDocument.title } : document,
      ),
    );
    setAnswer((current) => applyRenamedDocumentToAnswer(current, updatedDocument));
  }, []);

  const handleDocumentLabelsUpdated = useCallback((documentId: string, labels: DocumentLabel[]) => {
    setDocuments((current) =>
      current.map((document) => (document.id === documentId ? { ...document, labels } : document)),
    );
    setDocumentMatches((current) =>
      current.map((document) => (document.document_id === documentId ? { ...document, labels } : document)),
    );
    setSources((current) =>
      current.map((source) => (source.document_id === documentId ? { ...source, document_labels: labels } : source)),
    );
  }, []);

  const handleDocumentLabelPatched = useCallback((documentId: string, label: DocumentLabel) => {
    function mergeLabel(labels: DocumentLabel[] | null | undefined) {
      const current = labels ?? [];
      let replaced = false;
      const next = current.map((item) => {
        if (item.id !== label.id) return item;
        replaced = true;
        return label;
      });
      return replaced ? next : [label, ...next];
    }

    setDocuments((current) =>
      current.map((document) =>
        document.id === documentId ? { ...document, labels: mergeLabel(document.labels) } : document,
      ),
    );
    setDocumentMatches((current) =>
      current.map((document) =>
        document.document_id === documentId ? { ...document, labels: mergeLabel(document.labels) } : document,
      ),
    );
    setSources((current) =>
      current.map((source) =>
        source.document_id === documentId ? { ...source, document_labels: mergeLabel(source.document_labels) } : source,
      ),
    );
  }, []);

  const mutateDocumentLabel = useCallback(
    async (documentId: string, method: "POST" | "PATCH", body: LabelReviewMutationBody) => {
      if (!canUsePrivateApis) return false;
      try {
        const { response, requestEpoch } = await authBoundFetch(`/api/documents/${documentId}/labels`, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(clientDemoMode ? {} : authorizationHeader),
          },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!isAuthEpochCurrent(requestEpoch)) return false;
        if (response.status === 401) {
          markSessionExpired();
          return false;
        }
        if (!response.ok) {
          setActionNotice({
            tone: "warning",
            message: typeof payload?.error === "string" ? payload.error : "Label update failed.",
          });
          return false;
        }
        if (Array.isArray(payload.labels)) {
          handleDocumentLabelsUpdated(documentId, payload.labels as DocumentLabel[]);
        } else if (payload.label && typeof payload.label === "object") {
          handleDocumentLabelPatched(documentId, payload.label as DocumentLabel);
        }
        setActionNotice({ tone: "success", message: "Document label review updated." });
        return true;
      } catch (error) {
        if (isAbortError(error)) return false;
        setActionNotice({ tone: "warning", message: "Label update failed." });
        return false;
      }
    },
    [
      authBoundFetch,
      authorizationHeader,
      canUsePrivateApis,
      clientDemoMode,
      handleDocumentLabelPatched,
      handleDocumentLabelsUpdated,
      isAuthEpochCurrent,
      markSessionExpired,
    ],
  );

  const handleDocumentDeleted = useCallback(
    (result: DocumentDeleteResult) => {
      setDocuments((current) => current.filter((document) => document.id !== result.documentId));
      setSelectedDocumentIds((current) => current.filter((documentId) => documentId !== result.documentId));
      setSources((current) => current.filter((source) => source.document_id !== result.documentId));
      setDocumentMatches((current) => current.filter((document) => document.document_id !== result.documentId));
      setAnswer((current) => (answerReferencesDocument(current, result.documentId) ? null : current));
      if (result.storageWarnings.length > 0) {
        setActionNotice({
          tone: "warning",
          message: `Document deleted. Storage cleanup needs review: ${result.storageWarnings.join("; ")}`,
        });
      } else {
        setActionNotice({ tone: "success", message: "Document deleted." });
      }
      void refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false }).catch(
        () => undefined,
      );
    },
    [refresh],
  );

  useEffect(() => {
    if (actionNotice?.tone !== "success") return undefined;
    const timer = window.setTimeout(() => setActionNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  const activeIndexingWork = useMemo(
    () => hasActiveIndexingWork(documents, jobs, batches, indexingActive),
    [documents, jobs, batches, indexingActive],
  );
  const needsSetupRecheck = useMemo(() => setupNeedsSlowRecheck(setupChecks), [setupChecks]);
  const dashboardDataSurfaceVisible =
    settingsState.documentScopeOpen || settingsState.documentsDrawerOpen || settingsState.uploadDrawerOpen;
  const administrationSurfaceVisible =
    canUseAdministrativeApis &&
    (settingsState.uploadDrawerOpen ||
      (settingsState.documentsDrawerOpen && settingsState.documentsDrawerMode === "admin"));

  useEffect(() => {
    dashboardDataLoadedRef.current = false;
    administrationDataLoadedRef.current = false;
  }, [authEpoch]);

  useEffect(() => {
    refresh({ includeSetup: true, includeDashboardData: false, includeDocumentMeta: false }).catch(() => undefined);
  }, [authStatus, authorizationHeader, clientDemoMode, refresh]);

  useEffect(() => {
    const includeDashboardData = dashboardDataSurfaceVisible && !dashboardDataLoadedRef.current;
    const includeAdministrationData = administrationSurfaceVisible && !administrationDataLoadedRef.current;
    if (!includeDashboardData && !includeAdministrationData) return;
    refresh({
      includeSetup: false,
      includeDashboardData,
      includeAdministrationData,
      includeDocumentMeta: includeDashboardData,
    }).catch(() => undefined);
  }, [administrationSurfaceVisible, authEpoch, dashboardDataSurfaceVisible, refresh]);

  useEffect(() => {
    if (!userStartedIngestion || !dashboardDataLoadedRef.current || activeIndexingWork) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setUserStartedIngestion(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeIndexingWork, userStartedIngestion]);

  useEffect(() => {
    const visibleSurfaceHasActiveWork = dashboardDataSurfaceVisible && activeIndexingWork;
    const userOperationHasActiveWork = userStartedIngestion && activeIndexingWork;
    const shouldPollDashboardData = visibleSurfaceHasActiveWork || userOperationHasActiveWork;
    const hasScheduledWork = shouldPollDashboardData || needsSetupRecheck;
    const pollingAllowed =
      userOperationHasActiveWork || shouldPollForUpdates(demoMode, document.visibilityState, hasScheduledWork);
    if (!pollingAllowed) {
      return;
    }

    const delay = shouldPollDashboardData ? (nextRefreshDelayMs ?? activeIndexingPollFallbackMs) : setupRecheckPollMs;
    const timeout = window.setTimeout(() => {
      const stillAllowed =
        userOperationHasActiveWork || shouldPollForUpdates(demoMode, document.visibilityState, hasScheduledWork);
      if (!stillAllowed) {
        return;
      }

      refresh({
        includeSetup: !shouldPollDashboardData,
        includeDashboardData: shouldPollDashboardData,
        includeAdministrationData: shouldPollDashboardData && (administrationSurfaceVisible || userStartedIngestion),
        includeDocumentMeta: false,
      }).catch(() => undefined);
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [
    activeIndexingWork,
    administrationSurfaceVisible,
    dashboardDataSurfaceVisible,
    demoMode,
    needsSetupRecheck,
    nextRefreshDelayMs,
    refresh,
    userStartedIngestion,
  ]);

  useEffect(() => {
    const refreshVisibleDashboard = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      refresh({
        includeSetup: true,
        includeDashboardData: dashboardDataSurfaceVisible || (userStartedIngestion && activeIndexingWork),
        includeAdministrationData: administrationSurfaceVisible || (userStartedIngestion && activeIndexingWork),
        includeDocumentMeta: false,
      }).catch(() => undefined);
    };

    document.addEventListener("visibilitychange", refreshVisibleDashboard);
    window.addEventListener("focus", refreshVisibleDashboard);
    return () => {
      document.removeEventListener("visibilitychange", refreshVisibleDashboard);
      window.removeEventListener("focus", refreshVisibleDashboard);
    };
  }, [activeIndexingWork, administrationSurfaceVisible, dashboardDataSurfaceVisible, refresh, userStartedIngestion]);

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

  useEffect(() => {
    if (!shouldAutoFocusComposer) {
      if (document.activeElement === composerInputRef.current) composerInputRef.current?.blur();
      return undefined;
    }
    focusComposerInput(true);
    const timeout = window.setTimeout(() => focusComposerInput(true), 500);
    return () => window.clearTimeout(timeout);
  }, [composerInputRef, focusComposerInput, shouldAutoFocusComposer]);

  // Abort any in-flight answer/library search if the dashboard unmounts.
  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const searchParamString = searchParams.toString();
    if (lastSyncedSearchParamsRef.current === searchParamString) return;
    lastSyncedSearchParamsRef.current = searchParamString;
    const nextSearchContext = readSearchNavigationContext(new URLSearchParams(searchParamString));
    setQueryMode(nextSearchContext.queryMode);
    setScopeFilters(nextSearchContext.scopeFilters);
    if (searchParams.get("run") === "1") return;

    const mode = searchParams.get("mode");
    if (!isAppModeId(mode) || !isAppModeVisible(mode)) return;

    if (modeChangeFromUiRef.current) {
      modeChangeFromUiRef.current = false;
      return;
    }

    const nextQuery = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim();
    const shouldFocusComposer = searchParams.get("focus") === "1";
    const hasUrlQuery = searchParams.has("q") || searchParams.has("query");
    const frame = window.requestAnimationFrame(() => {
      if (mode === "differentials") clearModeResultState();
      setSearchMode(mode);
      if (hasUrlQuery) setQuery(nextQuery);
      setModeSearchSubmitted(false);
      setLoading(false);
      setError(null);
      setAnswerProgress(null);
      if (shouldFocusComposer) focusComposerInput(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchParams, clearModeResultState, focusComposerInput]);

  useHomeModeSeed({ pathname, searchParams, lastAppMode });

  useEffect(() => {
    if (urlSearchBootstrappedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const searchText = params.get("q")?.trim();
    const shouldFocusComposer = params.get("focus") === "1";
    if (!isAppModeId(mode) || !isAppModeVisible(mode)) return;
    urlSearchBootstrappedRef.current = true;
    const targetMode = mode;
    const frame = window.requestAnimationFrame(() => {
      if (targetMode === "differentials") clearModeResultState();
      setSearchMode(targetMode);
      // run=1 URLs name the latest answered question; the composer stays empty
      // while an answer thread is active (including after localStorage restore).
      // Do not reclaim focus on result deep-links — that pins phone chrome.
      if (searchText && params.get("run") !== "1") setQuery(searchText);
      if (shouldFocusComposer && params.get("run") !== "1") focusComposerInput(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clearModeResultState, focusComposerInput]);

  const executeSearchRef = useRef(executeSearch);
  executeSearchRef.current = executeSearch;
  const scopeFiltersRef = useRef(scopeFilters);
  scopeFiltersRef.current = scopeFilters;

  useEffect(() => {
    if (urlDocumentSearchBootstrappedRef.current) return;
    if (authStatus === "loading") return;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const searchText = params.get("q")?.trim();
    if (!searchText || !isAppModeId(mode) || !isAppModeVisible(mode)) return;
    if (mode === "prescribing") return;
    const modeSearch = appModeSearchConfig(mode);
    // Answer-mode run=1 URLs are submitted by the autoRunSearch effect after
    // localStorage thread restore completes; running here would archive a
    // restored latest turn into a duplicate prior turn on reload.
    if (modeSearch.resultKind === "answer") {
      if (!answerThreadBootstrapped) return;
      urlDocumentSearchBootstrappedRef.current = true;
      return;
    }
    const shouldRun =
      params.get("run") === "1" ||
      modeSearch.kind === "documents" ||
      modeSearch.kind === "forms" ||
      modeSearch.kind === "favourites" ||
      modeSearch.kind === "differentials";
    if (!shouldRun) return;
    const isRegistryOnlyMode = mode === "services" || mode === "forms";
    if (modeSearch.kind !== "tools" && modeSearch.kind !== "favourites" && !isRegistryOnlyMode && !canRunSearch) return;
    const initialContext = readSearchNavigationContext(params);
    if (!privateScopeReadyForRoute(initialContext.scopeRef, privateScopeStatus, restoredPrivateScopeRef)) return;
    urlDocumentSearchBootstrappedRef.current = true;
    autoRunSearchSignatureRef.current = searchSubmissionSignature(mode, searchText, initialContext);
    void executeSearchRef.current(
      searchText,
      mode,
      initialContext.scopeFilters,
      initialContext.queryMode,
      false,
      initialContext.scopeRef,
    );
    // URL search intentionally runs once when the selected mode can execute.
  }, [authStatus, canRunSearch, answerThreadBootstrapped, privateScopeStatus, restoredPrivateScopeRef]);

  useEffect(() => {
    const updateHash = () => {
      const nextHash = normalizeNavigationHash(window.location.hash || "#search");
      window.requestAnimationFrame(() => navigateMobileSection(nextHash, { updateHistory: false }));
    };
    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, [navigateMobileSection]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (navSyncLockRef.current !== null) {
        window.clearTimeout(navSyncLockRef.current);
      }
    };
  }, []);

  function searchNetworkFailure(label: string) {
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    const origin = typeof window !== "undefined" ? window.location.origin : "Clinical KB";
    return makeSearchError(
      offline
        ? `${label} could not run because the browser is offline.`
        : isDeployedClinicalKb()
          ? `${label} could not reach Clinical KB at ${origin}. Check your connection and try again shortly.`
          : `${label} could not reach Clinical KB at ${origin}. The local server may still be starting or restarting; retry shortly or run npm run ensure.`,
      undefined,
      true,
    );
  }

  async function requestSourceLibrarySearch(
    queryText: string,
    mode: SourceLibrarySearchMode = "documents",
    filtersOverride?: SearchScopeFilters,
    queryModeOverride: ClinicalQueryMode = requestQueryMode,
    signal?: AbortSignal,
  ) {
    const searchLabel = mode === "differentials" ? "Differentials search" : "Document search";
    let response: Response;
    try {
      response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientDemoMode ? {} : authorizationHeader),
        },
        body: JSON.stringify({
          query: queryText,
          mode,
          documentIds: selectedDocumentIds.length > 0 ? selectedDocumentIds : undefined,
          filters: compactScopeFilters(filtersOverride ?? scopeFilters),
          queryMode: queryModeOverride,
          documentLimit: 30,
          topK: 20,
        }),
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw searchNetworkFailure(searchLabel);
    }

    if (response.status === 401) {
      markSessionExpired();
      throw makeSearchError("Search request was not authorized by the server.", 401, false);
    }
    if (!response.ok) {
      throw await parseApiErrorResponse(response);
    }
    const payload = await response.json();
    if (payload.demoMode) setDemoMode(true);

    return {
      kind: "documents" as const,
      query: queryText,
      sources: (payload.results ?? []) as SearchResult[],
      documentMatches: (payload.documentMatches ?? []) as DocumentMatch[],
      relevance: payload.relevance as EvidenceRelevance | undefined,
      facets: payload.facets as SearchFacets | undefined,
      scope: payload.scope as SearchScopeSummary | undefined,
      sourceGovernanceWarnings: payload.sourceGovernanceWarnings as SourceGovernanceWarning[] | undefined,
      demoMode: payload.demoMode,
    };
  }

  async function requestAnswer(
    queryText: string,
    filtersOverride: SearchScopeFilters = scopeFilters,
    queryModeOverride: ClinicalQueryMode = requestQueryMode,
    onProgress: (progress: AnswerProgressUpdate) => void,
    signal?: AbortSignal,
    onStreamActivity?: () => void,
  ) {
    let response: Response;
    try {
      response = await fetch("/api/answer/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientDemoMode ? {} : authorizationHeader),
        },
        body: JSON.stringify({
          query: queryText,
          documentIds: selectedDocumentIds.length > 0 ? selectedDocumentIds : undefined,
          filters: compactScopeFilters(filtersOverride),
          queryMode: queryModeOverride,
        }),
        signal,
      });
    } catch (error) {
      if (answerTimedOutRef.current) throw answerTimedOutError();
      if (isAbortError(error)) throw error;
      throw searchNetworkFailure("Answer search");
    }

    if (response.status === 401) {
      markSessionExpired();
      throw makeSearchError("Search request was not authorized by the server.", 401, false);
    }
    if (!response.ok) {
      throw await parseApiErrorResponse(response);
    }

    let payload: AnswerPayload;
    try {
      payload = await readAnswerStream(response, onProgress, onStreamActivity);
    } catch (error) {
      if (answerTimedOutRef.current) throw answerTimedOutError();
      if (isAbortError(error)) throw error;
      throw error;
    }
    return {
      kind: "answer" as const,
      query: queryText,
      payload,
    };
  }

  async function runWithRetries<T>(
    operation: () => Promise<T>,
    onProgress: (message: string) => void = setAnswerProgress,
    signal?: AbortSignal,
  ) {
    let lastError: unknown;
    for (let attempt = 0; attempt <= searchRetryCount; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error) || attempt >= searchRetryCount) break;

        const message = progressForRetry(attempt + 1);
        onProgress(message);
        const requestedDelay = (error as SearchError).retryAfterMs ?? 0;
        const defaultDelay = searchRetryDelaysMs[attempt] ?? searchRetryDelaysMs[searchRetryDelaysMs.length - 1];
        await sleep(Math.max(defaultDelay, requestedDelay), signal);
      }
    }
    throw lastError;
  }

  function resultUsable(payload: SearchResultModePayload) {
    if (payload.kind === "documents") {
      return payload.sources.length > 0 || payload.documentMatches.length > 0;
    }
    return answerPayloadIsUsable(payload.payload);
  }

  // Audit M10: monotonically increasing token identifying the latest search.
  // Concurrent searches (URL-bootstrap auto-search racing a user submit) can
  // resolve out of order; only the latest request may commit answer/sources/
  // error/loading state, or a stale response would display one query's answer
  // under another query's composer text.
  const searchRequestSeqRef = useRef(0);
  // Aborts the in-flight answer/library search when the user presses Stop, a
  // newer search supersedes the prior one, or the component unmounts.
  const searchAbortRef = useRef<AbortController | null>(null);
  // Distinguishes a timeout-driven abort from an explicit user/supersede abort.
  const answerTimedOutRef = useRef(false);

  function stopSearch() {
    searchRequestSeqRef.current += 1;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setLoading(false);
    setAnswerProgress(null);
    setAnswerProgressEvents([]);
    setAnswerProgressStartedAt(null);
    dispatchAnswerLifecycle({ type: "cancel" });
  }

  function applySearchResult(payload: SearchResultModePayload, displayQuery?: string, archivePreviousAnswer = true) {
    if (payload.kind === "documents") {
      setDocumentMatches(payload.documentMatches);
      setSources(payload.sources);
      setSearchRelevance(payload.relevance ?? null);
      setSearchFacets(payload.facets ?? null);
      setSearchScope(payload.scope ?? null);
      setSourceGovernanceWarnings((payload.sourceGovernanceWarnings ?? []) as SourceGovernanceWarning[]);
      return;
    }

    const answerData = payload.payload;
    // Archive the previous exchange before the new answer replaces it, so the
    // thread keeps every turn visible in the same window.
    const priorTurn = archivePreviousAnswer ? latestAnswerTurnRef.current : null;
    if (priorTurn) {
      const turnId = `answer-turn-${++answerTurnSeqRef.current}`;
      setPriorAnswerTurns((turns) => [...turns, { id: turnId, ...priorTurn }].slice(-(maxStoredAnswerTurns - 1)));
      setCollapsedTurnIds((current) => new Set(current).add(turnId));
    }
    const committedQuery = displayQuery ?? payload.query;
    latestAnswerTurnRef.current = {
      query: committedQuery,
      answer: answerData,
      sources: answerData.sources ?? [],
    };
    setLatestAnswerQuery(committedQuery);
    setAnswer(answerData);
    setSources(answerData.sources ?? []);
    setSearchRelevance(answerData.relevance ?? answerData.smartPanel?.relevance ?? null);
    setSearchScope(answerData.scope ?? null);
    setSourceGovernanceWarnings((answerData.sourceGovernanceWarnings ?? []) as SourceGovernanceWarning[]);
    setSearchFacets(null);
    setDocumentMatches(
      answerData.relatedDocuments?.map((document) => ({
        document_id: document.document_id,
        title: document.title,
        file_name: document.file_name,
        labels: document.labels,
        summarySnippet: document.summary,
        bestPages: document.best_pages,
        bestChunkIds: document.best_chunk_ids,
        imageCount: document.image_count,
        tableCount: document.table_count ?? 0,
        matchReason: document.match_reason,
        score: document.score,
      })) ?? [],
    );
    if (answerData.demoMode) setDemoMode(true);
  }

  async function executeSearch(
    searchText: string,
    targetMode: AppModeId = searchMode,
    filtersOverride = scopeFilters,
    queryModeOverride = queryMode,
    replaceExistingAnswer = false,
    scopeRefOverride?: string,
  ) {
    const trimmedQuery = searchText.trim();
    if (!trimmedQuery) return;
    const modeSearch = appModeSearchConfig(targetMode);
    const targetQueryMode = appModeQueryMode(targetMode, queryModeOverride);
    const privateScopeRef =
      scopeRefOverride ??
      (selectedDocumentIds.length > 0 && auth.session?.user.id
        ? (persistPrivateSearchScope(window.sessionStorage, auth.session.user.id, selectedDocumentIds) ?? undefined)
        : undefined);
    const isDifferentialsMode = modeSearch.resultKind === "differentials";
    const isAnswerRequest = modeSearch.resultKind === "answer";
    // Note: no automatic mode-default label scope for Services/Forms. Applying
    // one on every search routed resolveSearchScope's label path over the whole
    // library, whose single `document_labels.in(<all ids>)` request produces an
    // over-long PostgREST URL that fails on large corpora. Corpus search runs
    // unscoped (like Documents); users opt into label filters explicitly.
    const requestId = ++searchRequestSeqRef.current;

    setSearchMode(targetMode);
    // Answer mode keeps the composer as the draft source until a successful
    // response clears it. Syncing query here on follow-ups used to fire the
    // URL-backed autoRunSearch effect before loading flipped true, which
    // duplicated the in-flight answer request and produced extra thread turns.
    if (modeSearch.resultKind !== "answer") {
      setQuery(trimmedQuery);
    }
    if (modeSearch.kind !== "tools") setModeSearchSubmitted(true);
    if (isDifferentialsMode) clearModeResultState();

    if (modeSearch.kind === "tools") {
      setLoading(false);
      setAnswerProgress(null);
      setError(null);
      rememberRecentQuery(trimmedQuery);
      setActionNotice({ tone: "success", message: "Tools filtered from the composer." });
      return;
    }
    if (modeSearch.kind === "favourites") {
      setLoading(false);
      setAnswerProgress(null);
      setError(null);
      rememberRecentQuery(trimmedQuery);
      setActionNotice({ tone: "success", message: "Favourites filtered from the composer." });
      return;
    }
    if (modeSearch.kind === "services" || modeSearch.kind === "forms") {
      resetAnswerThread();
      setAnswer(null);
      setSources([]);
      setDocumentMatches([]);
      setSearchRelevance(null);
      setSearchFacets(null);
      setSearchScope(null);
      setSourceGovernanceWarnings([]);
      setAnswerProgress(null);
      setLoading(false);
      setError(null);
      rememberRecentQuery(trimmedQuery);
      window.requestAnimationFrame(() => scrollSurface(mainRef.current, 0, resolveScrollBehavior()));
      return;
    }
    if (!canRunSearch) {
      // requestId was already bumped above, so a superseded in-flight request's
      // finally block can no longer reset loading — reset it here or the answer
      // skeleton can stay on screen indefinitely.
      setLoading(false);
      setAnswerProgress(null);
      setError(errorCopy.searchSetupNotReady);
      setErrorKind(null);
      setLastFailedQuery(null);
      return;
    }
    // M10 (diff-review hardening): progress updates emitted by this request's
    // in-flight machinery (retry messages, keyword fallback, stream progress)
    // must also be discarded once a newer search takes over, or a slow stale
    // request repaints the progress banner under the newer query.
    let requestIsCurrent = () => requestId === searchRequestSeqRef.current;
    const onProgress = (message: string | null) => {
      if (requestIsCurrent()) setAnswerProgress(message);
    };
    const onAnswerProgress = (progress: AnswerProgressUpdate) => {
      if (!requestIsCurrent()) return;
      setAnswerProgress(progress.message);
      setAnswerProgressEvents((current) => {
        const latest = current.at(-1);
        if (
          latest?.stage === progress.stage &&
          latest.message === progress.message &&
          latest.resultCount === progress.resultCount &&
          latest.selectedContextCount === progress.selectedContextCount &&
          latest.australianSourceCount === progress.australianSourceCount &&
          latest.waSourceCount === progress.waSourceCount
        ) {
          return current;
        }
        return [...current, { ...progress, receivedAt: Date.now() }].slice(-16);
      });
    };
    const onRetryProgress = (message: string) => {
      if (isAnswerRequest) onAnswerProgress({ stage: "retrying", message });
      else onProgress(message);
    };
    // A newer search already invalidated any prior request via requestId; abort
    // its network work too so the server stops generating, then own the signal.
    const abortController = replaceOwnedAbortController(searchAbortRef);
    const authRequest = registerAuthRequest(abortController);
    requestIsCurrent = () =>
      requestId === searchRequestSeqRef.current &&
      isAuthEpochCurrent(authRequest.epoch) &&
      !abortController.signal.aborted;
    setLoading(true);
    setError(null);
    setSearchRelevance(null);
    setSearchFacets(null);
    setSearchScope(null);
    setSourceGovernanceWarnings([]);
    setAnswerViewMode("high_yield");
    if (isAnswerRequest) {
      const startedAt = Date.now();
      setAnswerProgressStartedAt(startedAt);
      setAnswerProgressEvents([
        {
          stage: "scoping",
          message: "Preparing the clinical search scope.",
          receivedAt: startedAt,
        },
      ]);
      setAnswerProgress("Preparing the clinical search scope.");
    } else {
      setAnswerProgressStartedAt(null);
      setAnswerProgressEvents([]);
      onProgress(modeSearch.progressLabel);
    }
    rememberRecentQuery(trimmedQuery);

    // Answer-mode follow-ups: the API takes a single query string, so a short
    // ambiguous follow-up ("what about renal impairment?") is wrapped with the
    // previous turn's question before retrieval. The raw text the user typed
    // is what the thread displays (via displayQuery below).
    if (isAnswerRequest) dispatchAnswerLifecycle({ type: "start", query: trimmedQuery });
    const priorTurnQuery = isAnswerRequest && !replaceExistingAnswer ? latestAnswerTurnRef.current?.query : undefined;
    const isAnswerFollowUp = isAnswerRequest && Boolean(priorTurnQuery);
    const requestQuery = isAnswerRequest ? buildAnswerFollowUpQuery(priorTurnQuery, trimmedQuery) : trimmedQuery;

    const fallbackQuery = keywordQueryFromNaturalLanguage(requestQuery);
    const queryPlan =
      fallbackQuery && fallbackQuery !== requestQuery
        ? [
            { query: requestQuery, isKeyword: false },
            { query: fallbackQuery, isKeyword: true },
          ]
        : [{ query: requestQuery, isKeyword: false }];

    // Bound this search with a stall watchdog on the shared abort controller so
    // a hung stream recovers instead of spinning forever. Answer streams reset
    // the inactivity window on every received chunk, so a slow-but-live
    // generation (fast -> strong escalation) is not aborted mid-stream; plain
    // document searches never touch the watchdog and keep the flat window.
    answerTimedOutRef.current = false;
    const answerWatchdog = createAnswerRequestWatchdog(() => {
      answerTimedOutRef.current = true;
      abortController.abort();
    });

    try {
      let successfulPayload: SearchResultModePayload | null = null;
      let lastError: SearchError | null = null;
      // An empty source-library search is a RESULT, not a failure: the payload
      // carries the `scope`/`sourceGovernanceWarnings` explaining WHY it is
      // empty, and the 404 sentinel discarded them. See `scopeFilterChips`.
      let emptySourceLibraryPayload: SearchResultModePayload | null = null;

      for (const entry of queryPlan) {
        if (entry.isKeyword) {
          if (isAnswerRequest) onAnswerProgress({ stage: "retrieving", message: "Trying keyword-based search..." });
          else onProgress("Trying keyword-based search...");
        }

        try {
          const payload =
            modeSearch.kind === "documents" || modeSearch.kind === "differentials"
              ? await runWithRetries(
                  () =>
                    requestSourceLibrarySearch(
                      entry.query,
                      modeSearch.kind,
                      filtersOverride,
                      targetQueryMode,
                      abortController.signal,
                    ),
                  onProgress,
                  abortController.signal,
                )
              : await runWithRetries(
                  () =>
                    requestAnswer(
                      entry.query,
                      filtersOverride,
                      targetQueryMode,
                      onAnswerProgress,
                      abortController.signal,
                      answerWatchdog.touch,
                    ),
                  onRetryProgress,
                  abortController.signal,
                );

          if (!resultUsable(payload)) {
            if (payload.kind === "documents") emptySourceLibraryPayload = payload;
            lastError = makeSearchError("No usable results were found.", 404, false);
            if (!entry.isKeyword) {
              continue;
            }
            break;
          }

          successfulPayload = payload;
          break;
        } catch (requestError) {
          lastError = requestError as SearchError;
          if (queryPlan.length > 1 && !entry.isKeyword) {
            continue;
          }
          throw requestError;
        }
      }

      if (!successfulPayload && emptySourceLibraryPayload) {
        successfulPayload = emptySourceLibraryPayload;
      }

      if (!successfulPayload) {
        if (lastError) throw lastError;
        throw new Error("Search did not return usable results.");
      }

      // M10: discard a stale response — a newer search owns the UI state.
      if (requestIsCurrent()) {
        if (successfulPayload.kind === "answer") {
          latestAnswerSnapshotMetadataRef.current = createAnswerThreadSnapshotMetadata(
            searchSubmissionSignature(targetMode, trimmedQuery, {
              queryMode: targetQueryMode,
              scopeFilters: filtersOverride,
              scopeRef: privateScopeRef,
            }),
          );
        }
        applySearchResult(successfulPayload, trimmedQuery, !replaceExistingAnswer);
        if (isDifferentialsMode) setDifferentialEvidenceQuery(trimmedQuery);
        if (successfulPayload.kind === "answer") {
          dispatchAnswerLifecycle({ type: "complete" });
          // Explicit composer submissions do not pass through the URL auto-run
          // effect. Seed their completed context so a later in-place route to
          // the same query with different intent/scope is recognized as a
          // replacement search instead of leaving the old answer on screen.
          autoRunSearchSignatureRef.current =
            latestAnswerSnapshotMetadataRef.current?.latestSubmissionSignature ?? null;
          // The composer is a draft box in a conversation: clear it so the
          // user can type the next follow-up immediately.
          setQuery("");
          // Keep only the latest question in the URL; the full thread lives in
          // React state until refresh or New chat.
          modeChangeFromUiRef.current = true;
          window.history.replaceState(
            null,
            "",
            appModeHomeHref(targetMode, {
              query: trimmedQuery,
              run: true,
              queryMode: queryModeOverride,
              scopeFilters: filtersOverride,
              scopeRef: privateScopeRef,
            }),
          );
          if (isAnswerFollowUp) {
            window.requestAnimationFrame(() => {
              scrollSurface(mainRef.current, "end", resolveScrollBehavior());
            });
          }
        }
      }
    } catch (requestError) {
      if (requestIsCurrent() && !isAbortError(requestError)) {
        if (isAnswerRequest) dispatchAnswerLifecycle({ type: "fail" });
        setError(requestError instanceof Error ? requestError.message : "Search failed");
        setErrorKind(classifyAnswerError(requestError));
        setLastFailedQuery(trimmedQuery);
      }
    } finally {
      answerWatchdog.cancel();
      authRequest.release();
      answerTimedOutRef.current = false;
      releaseOwnedAbortController(searchAbortRef, abortController);
      if (requestIsCurrent()) {
        setLoading(false);
        setAnswerProgress(null);
      }
    }
  }

  function setMedicationSearchQuery(searchText: string, updateUrl = true) {
    modeChangeFromUiRef.current = true;
    const trimmedSearchText = searchText.trim();
    if (!trimmedSearchText) return;
    setSearchMode("prescribing");
    setQuery(trimmedSearchText);
    setModeSearchSubmitted(true);
    setLoading(false);
    setError(null);
    setAnswerProgress(null);
    rememberRecentQuery(trimmedSearchText);
    window.requestAnimationFrame(() => scrollSurface(mainRef.current, 0, resolveScrollBehavior()));
    if (updateUrl) {
      // Include run=1 so a refresh keeps the submitted results surface instead of
      // falling back to the shared home with Medication merely preselected.
      router.replace(
        appModeHomeHref("prescribing", {
          query: trimmedSearchText,
          run: true,
          queryMode,
          scopeFilters,
        }),
      );
    }
  }

  async function ask(searchText = query, contextOverride?: SearchNavigationContext, replaceExistingAnswer = false) {
    const trimmedQuery = searchText.trim();
    const effectiveQueryMode = contextOverride?.queryMode ?? queryMode;
    const effectiveScopeFilters = contextOverride?.scopeFilters ?? scopeFilters;
    const privateScopeRef =
      contextOverride?.scopeRef ??
      (selectedDocumentIds.length > 0 && auth.session?.user.id
        ? (persistPrivateSearchScope(window.sessionStorage, auth.session.user.id, selectedDocumentIds) ?? undefined)
        : undefined);
    const navigationContext = {
      queryMode: effectiveQueryMode,
      scopeFilters: effectiveScopeFilters,
      scopeRef: privateScopeRef,
    };

    // Submitting from the shared home routes to the selected mode's own search
    // page. Only answer/prescribing (`/?mode=…`) and documents (`/documents/search`)
    // are dashboard-owned and stay here; every namespaced mode navigates out.
    // Without this, modes like DSM would silently run an in-dashboard search,
    // because `/` + a namespaced mode was unreachable before the pill stopped
    // navigating.
    const modeDestination = appModeHomeHref(searchMode, {
      query: trimmedQuery,
      run: true,
      ...navigationContext,
    });
    if (trimmedQuery && !isDashboardModeHref(modeDestination)) {
      rememberRecentQuery(trimmedQuery);
      router.push(modeDestination);
      return;
    }

    if (searchMode === "documents" && trimmedQuery) {
      rememberRecentQuery(trimmedQuery);
      autoRunSearchSignatureRef.current = searchSubmissionSignature(searchMode, trimmedQuery, navigationContext);
      window.history.pushState(
        null,
        "",
        documentsSearchHref({
          query: trimmedQuery,
          run: true,
          ...navigationContext,
        }),
      );
      await executeSearch(
        trimmedQuery,
        searchMode,
        effectiveScopeFilters,
        effectiveQueryMode,
        replaceExistingAnswer,
        privateScopeRef,
      );
      return;
    }
    if (searchMode === "prescribing") {
      setMedicationSearchQuery(searchText);
      return;
    }
    await executeSearch(
      searchText,
      searchMode,
      effectiveScopeFilters,
      effectiveQueryMode,
      replaceExistingAnswer,
      privateScopeRef,
    );
  }
  const askRef = useRef(ask);
  askRef.current = ask;

  useEffect(() => {
    const trimmedQuery = query.trim();
    const submittedSearchText = searchMode === "answer" && submittedUrlQuery ? submittedUrlQuery : trimmedQuery;
    const canAutoRunMode = searchMode === "documents" || searchMode === "prescribing" || canRunSearch;
    // Draft shared-home URLs must never auto-submit. A mode pick can update local
    // mode/query one frame before the router drops the previous run=1 URL — suppress
    // that stale frame only while the URL mode no longer matches local state.
    // Intentional run=1 arrivals (Ask-this / crossModeSearch) keep mode+run aligned,
    // so they must still submit even if modeChangeFromUiRef is still set.
    if (pathname === "/" && !submittedUrlRunRequested) return;
    if (modeChangeFromUiRef.current && !submittedUrlModeMatchesActive) return;
    if (!autoRunSearch || !submittedSearchText || !canAutoRunMode || loading) return;
    if (authStatus === "loading") return;
    if (!privateScopeReadyForRoute(routedSearchContext.scopeRef, privateScopeStatus, restoredPrivateScopeRef)) return;
    if (searchMode === "answer" && !answerThreadBootstrapped) return;
    const previousSignature = autoRunSearchSignatureRef.current;
    const signature = searchSubmissionSignature(searchMode, submittedSearchText, routedSearchContext);
    const routedContextChanged = routedSubmissionContextChanged(
      previousSignature,
      searchMode,
      submittedSearchText,
      routedSearchContext,
    );
    // Once an answer is on screen, composer edits are follow-up drafts and must
    // only run on explicit submit — not on every query keystroke while run=1
    // keeps autoRunSearch enabled from the URL.
    if (searchMode === "answer" && answer && !routedContextChanged) return;
    // After reload, the URL query matches the restored latest turn — do not
    // archive it again into a duplicate prior turn.
    if (searchMode === "answer" && latestAnswerQuery?.trim() === submittedSearchText && !routedContextChanged) {
      autoRunSearchSignatureRef.current = signature;
      return;
    }
    if (autoRunSearchSignatureRef.current === signature) return;
    autoRunSearchSignatureRef.current = signature;
    if (searchMode === "documents") {
      void executeSearchRef.current(
        submittedSearchText,
        searchMode,
        routedSearchContext.scopeFilters,
        routedSearchContext.queryMode,
        routedContextChanged,
        routedSearchContext.scopeRef,
      );
      return;
    }
    void askRef.current(submittedSearchText, routedSearchContext, routedContextChanged);
  }, [
    autoRunSearch,
    pathname,
    submittedUrlRunRequested,
    submittedUrlModeMatchesActive,
    authStatus,
    canRunSearch,
    loading,
    query,
    submittedUrlQuery,
    searchMode,
    answer,
    answerThreadBootstrapped,
    latestAnswerQuery,
    routedSearchContext,
    routedSearchContextSignature,
    privateScopeStatus,
    restoredPrivateScopeRef,
  ]);

  function pickRecentQuery(recentQuery: string) {
    if (searchMode === "prescribing") {
      setMedicationSearchQuery(recentQuery);
      return;
    }
    setQuery(recentQuery);
  }

  function crossModeSearch(mode: AppModeId, crossQuery: string) {
    if (mode === "favourites" && !favouritesAccessible) {
      openAccountSetup("favourites");
      return;
    }
    const href = appModeHomeHref(mode, {
      query: crossQuery,
      focus: true,
      run: true,
      queryMode,
      scopeFilters,
    });
    // Leaving the dashboard shell: navigate only — eager setSearchMode flipped
    // overlay/hero/dock chrome for a frame before ClinicalDashboard unmounted.
    if (!isDashboardModeHref(href)) {
      modeChangeFromUiRef.current = true;
      router.push(href);
      return;
    }
    modeChangeFromUiRef.current = true;
    if (mode === "differentials") clearModeResultState();
    setQuery(crossQuery);
    setModeSearchSubmitted(false);
    setLoading(false);
    setError(null);
    setAnswerProgress(null);
    setSearchRelevance(null);
    setSearchFacets(null);
    setSearchScope(null);
    setSourceGovernanceWarnings([]);
    setDocumentMatches([]);
    if (mode === "answer") {
      resetAnswerThread();
      setAnswer(null);
      setSources([]);
    }
    if (mode === "prescribing") {
      setMedicationSearchQuery(crossQuery);
    }
    setSearchMode(mode);
    router.push(href);
    // Submit immediately for dashboard-owned modes. Auto-run alone is racy here:
    // modeChangeFromUiRef stays set until the URL-sync effect runs, and a late or
    // suppressed auto-run leaves the run=1 pending shell with no /api/answer call
    // (Ask-this bridge). Seed the signature so a later auto-run does not double-fire.
    if (mode === "answer" || mode === "documents") {
      const navigationContext = { queryMode, scopeFilters } as const;
      autoRunSearchSignatureRef.current = searchSubmissionSignature(mode, crossQuery.trim(), navigationContext);
      void executeSearch(crossQuery, mode, scopeFilters, queryMode, false);
    }
    window.requestAnimationFrame(() => {
      scrollSurface(mainRef.current, 0, resolveScrollBehavior());
    });
  }

  async function submitAnswerFeedback(feedbackType: AnswerFeedbackType) {
    if (!answer || pendingFeedback) return;
    if (clientDemoMode) {
      setActionNotice({ tone: "warning", message: "Answer review is unavailable for synthetic demo answers." });
      return;
    }
    if (!answer.interactionId || !answer.feedbackToken) {
      setActionNotice({ tone: "warning", message: "This answer predates traceable feedback. Run the question again." });
      return;
    }

    setPendingFeedback(feedbackType);
    try {
      const sourceChunkIds = Array.from(new Set(sources.map((source) => source.id).filter(Boolean)));
      const citedChunkIds = Array.from(new Set(answer.citations.map((citation) => citation.chunk_id).filter(Boolean)));
      const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(answer.answer));
      const answerHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const response = await fetch("/api/answer-feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authorizationHeader,
        },
        body: JSON.stringify({
          interactionId: answer.interactionId,
          feedbackToken: answer.feedbackToken,
          feedbackCategory: feedbackType,
          answerHash,
          sourceIds: sourceChunkIds,
          citedSourceIds: citedChunkIds,
          route: answer.routingMode ?? null,
          model: answer.modelUsed ?? null,
          providerRequestIds: Array.from(new Set(answer.openAIRequestIds ?? [])).slice(0, 10),
        }),
      });

      if (response.status === 401) {
        markSessionExpired();
        setActionNotice({ tone: "warning", message: "The session could not be validated for feedback." });
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.error === "string" ? payload.error : "Answer review could not be saved.");
      }
      setActionNotice({
        tone: "success",
        message: feedbackType === "verified" ? "Verified answer feedback saved." : "Answer issue feedback saved.",
      });
    } catch (feedbackError) {
      setActionNotice({
        tone: "warning",
        message: feedbackError instanceof Error ? feedbackError.message : "Answer review could not be saved.",
      });
    } finally {
      setPendingFeedback(null);
    }
  }

  function toggleDocumentScope(documentId: string) {
    setSelectedDocumentIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId],
    );
  }

  function scopeOnlyDocument(documentId: string) {
    setSelectedDocumentIds([documentId]);
  }

  function answerFromDocument(documentId: string) {
    setSelectedDocumentIds([documentId]);
    setSearchMode("answer");
    window.requestAnimationFrame(() => scrollSurface(mainRef.current, 0, resolveScrollBehavior()));
  }

  function updateDocumentSearchUrl(
    searchText: string,
    mode: AppModeId = "documents",
    filtersOverride: SearchScopeFilters = scopeFilters,
  ) {
    window.history.replaceState(
      null,
      "",
      appModeHomeHref(mode, { query: searchText, queryMode, scopeFilters: filtersOverride }),
    );
  }

  async function runDocumentSearchShortcut(
    searchText: string,
    filtersOverride = scopeFilters,
    updateUrl = true,
    targetMode: AppModeId = "documents",
  ) {
    const trimmedSearchText = searchText.trim();
    if (!trimmedSearchText) return;
    if (targetMode === "documents") {
      setQuery(trimmedSearchText);
      setSearchMode("documents");
      setModeSearchSubmitted(true);
      setLoading(false);
      setError(null);
      setAnswerProgress(null);
      rememberRecentQuery(trimmedSearchText);
      window.requestAnimationFrame(() => scrollSurface(mainRef.current, 0, resolveScrollBehavior()));
      if (updateUrl) {
        router.push(
          documentsSearchHref({
            query: trimmedSearchText,
            focus: true,
            run: true,
            queryMode,
            scopeFilters: filtersOverride,
          }),
        );
      }
      return;
    }
    if (!canRunSearch) {
      setError(errorCopy.searchSetupNotReady);
      setErrorKind(null);
      setLastFailedQuery(null);
      return;
    }

    setQuery(trimmedSearchText);
    setSearchMode(targetMode);
    setModeSearchSubmitted(true);
    setLoading(true);
    setError(null);
    const targetModeSearch = appModeSearchConfig(targetMode);
    const sourceLibraryMode = appModeSourceLibrarySearchMode(targetMode);
    setAnswerProgress(targetModeSearch.progressLabel);
    setSearchRelevance(null);
    setSearchFacets(null);
    setSearchScope(null);
    setSourceGovernanceWarnings([]);
    setAnswerViewMode("high_yield");
    rememberRecentQuery(trimmedSearchText);
    window.requestAnimationFrame(() => scrollSurface(mainRef.current, 0, resolveScrollBehavior()));
    if (updateUrl) updateDocumentSearchUrl(trimmedSearchText, targetMode, filtersOverride);

    const abortController = replaceOwnedAbortController(searchAbortRef);
    const requestId = ++searchRequestSeqRef.current;
    try {
      const shortcutQueryMode = appModeQueryMode(targetMode, queryMode);
      const payload = await runWithRetries(() =>
        requestSourceLibrarySearch(
          trimmedSearchText,
          sourceLibraryMode,
          filtersOverride,
          shortcutQueryMode,
          abortController.signal,
        ),
      );
      if (requestId === searchRequestSeqRef.current) applySearchResult(payload);
    } catch (requestError) {
      if (abortController.signal.aborted || isAbortError(requestError)) return;
      if (requestId === searchRequestSeqRef.current) {
        setError(requestError instanceof Error ? requestError.message : "Document search failed");
        setErrorKind(null);
        setLastFailedQuery(null);
      }
    } finally {
      releaseOwnedAbortController(searchAbortRef, abortController);
      if (requestId === searchRequestSeqRef.current) {
        setLoading(false);
        setAnswerProgress(null);
      }
    }
  }

  function handleTagSearch(tag: SmartDocumentTag | SmartDocumentTagFacet) {
    const searchText = tag.searchText || tag.label;
    const nextFilters: SearchScopeFilters = { ...scopeFilters };
    if (tag.group === "Site") nextFilters.sites = [searchText];
    if (tag.group === "Medication") nextFilters.medications = [tag.searchText || tag.label];
    if (tag.group === "Document type") nextFilters.documentTypes = [tag.searchText || tag.label];
    if (tag.group === "Topic") nextFilters.topics = [tag.searchText || tag.label];
    if (tag.group === "Service") nextFilters.services = [searchText];
    if (tag.group === "Setting") nextFilters.settings = [searchText];
    if (tag.group === "Population") nextFilters.populations = [searchText];
    if (tag.group === "Risk") nextFilters.risks = [searchText];
    if (tag.group === "Workflow") nextFilters.workflows = [searchText];
    if (tag.group === "Clinical action") nextFilters.clinicalActions = [searchText];
    if (tag.group === "Care phase") nextFilters.carePhases = [searchText];
    if (tag.group === "Document intent") nextFilters.documentIntents = [searchText];
    if (tag.group === "Content feature") nextFilters.contentFeatures = [searchText];
    setScopeFilters(nextFilters);
    const targetMode = appModeCanUseSourceLibraryShortcut(searchMode) ? searchMode : "documents";
    void runDocumentSearchShortcut(searchText, nextFilters, true, targetMode);
  }

  async function bulkReindexSelected(mode: "enrichment" | "full" | "retry_failed") {
    if (!selectedDocumentIds.length) return;
    setBulkActionBusy(true);
    setBulkActionStatus(null);
    try {
      const { response, requestEpoch } = await authBoundFetch("/api/documents/bulk/reindex", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authorizationHeader,
        },
        body: JSON.stringify({ documentIds: selectedDocumentIds, mode }),
      });
      if (response.status === 401) {
        markSessionExpired();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!isAuthEpochCurrent(requestEpoch)) return;
      if (!response.ok) throw new Error(payload.error || errorCopy.bulkReindexFailed);
      const summary = summarizeBulkReindexPayload(payload);
      setBulkActionStatus(summary.message);
      if (!summary.hasSuccessfulWork) return;
      setUserStartedIngestion(true);
      setIndexingActive(true);
      await refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false });
    } catch (error) {
      if (isAbortError(error)) return;
      setBulkActionStatus(error instanceof Error ? error.message : errorCopy.bulkReindexFailed);
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function bulkAssignCollection(collection: string) {
    if (!selectedDocumentIds.length || !collection.trim()) return;
    await bulkUpdateMetadata({ collection: collection.trim() });
  }

  async function bulkUpdateMetadata(metadata: Record<string, unknown>) {
    if (!selectedDocumentIds.length || Object.keys(metadata).length === 0) return;
    setBulkActionBusy(true);
    setBulkActionStatus(null);
    try {
      const { response, requestEpoch } = await authBoundFetch("/api/documents/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authorizationHeader,
        },
        body: JSON.stringify({ documentIds: selectedDocumentIds, metadata }),
      });
      if (response.status === 401) {
        markSessionExpired();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!isAuthEpochCurrent(requestEpoch)) return;
      if (!response.ok) throw new Error(payload.error || errorCopy.bulkMetadataUpdateFailed);
      setBulkActionStatus(`${payload.updatedCount ?? 0} selected documents updated.`);
      await refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false });
    } catch (error) {
      if (isAbortError(error)) return;
      setBulkActionStatus(error instanceof Error ? error.message : errorCopy.bulkMetadataUpdateFailed);
    } finally {
      setBulkActionBusy(false);
    }
  }

  function selectSearchMode(mode: AppModeId) {
    if (mode === "favourites" && !favouritesAccessible) {
      openAccountSetup("favourites");
      return;
    }
    setLastAppMode(mode);

    // On the shared home the pill is NOT navigation — it only decides where the
    // composer will send you. Keep the page, the draft query and the scroll
    // position, and rewrite `?mode=` in place. replaceState (not push) means Back
    // still leaves home rather than stepping back through mode picks, and Next's
    // router syncs `useSearchParams()` from it so the render-time URL sync keeps
    // owning searchMode.
    if (showSharedHome) {
      // Deliberately NOT setting modeChangeFromUiRef: the URL sync effect must
      // pick this up and own `searchMode`. It leaves the draft query alone
      // (no `q` in the href) so switching mode mid-typing keeps what you wrote.
      window.history.replaceState(null, "", appModeSelectionHref(mode, { queryMode, scopeFilters }));
      return;
    }

    // Outside the shared home, every mode pick returns to `/`. Preserve the
    // current question as an unsubmitted draft, but never carry `run=1` into the
    // newly selected mode — only an explicit submit may open its result route.
    const carriedQuery = query.trim() || submittedUrlQuery.trim();
    const href = appModeSelectionHref(mode, {
      query: carriedQuery || undefined,
      queryMode,
      scopeFilters,
    });
    modeChangeFromUiRef.current = true;
    // Dashboard stays mounted on `/`, so an in-flight Answer/documents request
    // would still look current after this navigation. Abort and bump the seq
    // before clearing UI; otherwise a late applySearchResult can repaint the
    // old answer and replaceState a run=1 URL over the shared-home draft.
    stopSearch();
    clearModeResultState();
    setQuery(carriedQuery);
    setModeSearchSubmitted(false);
    setSearchMode(mode);
    router.push(href);
    // Dashboard-internal mode flips keep the same scroller; jump to top so
    // Answer ↔ Documents does not inherit a mid-page offset + collapsed chrome.
    window.requestAnimationFrame(() => {
      scrollSurface(mainRef.current, 0, resolveScrollBehavior());
    });
  }

  function stageAnswerFollowUpDraft(draft: string) {
    setQuery(draft);
    focusComposerInput();
  }

  function handleFollowUpQuote(quote: QuoteCard) {
    stageAnswerFollowUpDraft(createQuoteFollowUp(quote));
  }

  function handlePickFollowUpSuggestion(suggestion: string) {
    void executeSearch(suggestion);
  }

  function startNewChat() {
    modeChangeFromUiRef.current = true;
    const href = appModeHomeHref("answer", { focus: true });
    setQuery("");
    setModeSearchSubmitted(false);
    setSearchMode("answer");
    setQueryMode("auto");
    setSelectedDocumentIds([]);
    setScopeFilters({});
    resetAnswerThread();
    dispatchAnswerLifecycle({ type: "reset" });
    setAnswer(null);
    setSources([]);
    setDocumentMatches([]);
    setSearchRelevance(null);
    setSearchFacets(null);
    setSearchScope(null);
    setSourceGovernanceWarnings([]);
    setError(null);
    setAnswerProgress(null);
    setAnswerViewMode("high_yield");
    router.replace(href);
    window.requestAnimationFrame(() => {
      scrollSurface(mainRef.current, 0, resolveScrollBehavior());
    });
    focusComposerInput();
  }

  function openDocumentsDrawer(mode: DocumentDrawerMode) {
    documentsDrawerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeDashboardTransientSurfaces("documents");
    setSearchMode("documents");
    setDocumentDrawerStatusFilter("indexed");
    settingsState.setDocumentsDrawerMode(mode);
    settingsState.setDocumentsDrawerOpen(true);
  }

  function openRecentDocuments() {
    openDocumentsDrawer("recent");
  }

  function openSourceLibrary() {
    openDocumentsDrawer("library");
  }

  function openSourcePdfBrowser() {
    openDocumentsDrawer("source");
  }

  function openUploadDrawer() {
    if (!canUseAdministrativeApis) {
      openDocumentsDrawer("library");
      setActionNotice({
        tone: "warning",
        message: "Upload and indexing tools are admin-only. Use Sources to open indexed documents.",
      });
      return;
    }
    closeDashboardTransientSurfaces("upload");
    setSearchMode("documents");
    settingsState.setDocumentsDrawerMode("admin");
    settingsState.setUploadDrawerOpen(true);
    window.requestAnimationFrame(() => {
      const drawer = document.getElementById("dashboard-upload-drawer") as HTMLDetailsElement | null;
      drawer?.scrollIntoView({ block: "start", behavior: resolveScrollBehavior() });
      if (drawer && !drawer.open) {
        drawer.querySelector<HTMLElement>("summary")?.click();
      }
    });
  }

  function openEvidenceDrawer() {
    closeDashboardTransientSurfaces();
    const reviewTrigger = document.getElementById("answer-evidence-drawer-mobile-trigger") as HTMLButtonElement | null;
    if (reviewTrigger) {
      reviewTrigger.scrollIntoView({ block: "center", behavior: resolveScrollBehavior() });
      reviewTrigger.click();
      return;
    }

    setActionNotice({
      tone: "warning",
      message: "Evidence appears after a source-backed answer is generated.",
    });
  }

  const syncActiveSectionFromScroll = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    if (main.scrollLeft !== 0) main.scrollLeft = 0;
    if (navSyncLockRef.current !== null) return;

    const innerScrollOwner = ownsVerticalScroll(main);
    const offset = innerScrollOwner ? main.scrollTop : window.scrollY;
    if (offset < 120) {
      setActiveHash((current) => (current === "#search" ? current : "#search"));
      return;
    }

    const marker = (innerScrollOwner ? main.getBoundingClientRect().top : 0) + 96;
    const sections = ["#quotes", "#images", "#sources"];
    const current =
      sections
        .map((section) => {
          const target = document.querySelector<HTMLElement>(section);
          if (!target) return null;
          const rect = target.getBoundingClientRect();
          if (rect.top > marker + 220) return null;
          return { section, distance: Math.abs(rect.top - marker) };
        })
        .filter((item): item is { section: string; distance: number } => Boolean(item))
        .sort((a, b) => a.distance - b.distance)[0]?.section ?? "#search";
    setActiveHash((active) => (active === current ? active : current));
  }, [mainRef]);

  const scheduleActiveSectionSync = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncActiveSectionFromScroll();
    });
  }, [syncActiveSectionFromScroll]);

  function handleMainScroll() {
    scheduleActiveSectionSync();
  }

  useEffect(() => {
    window.addEventListener("scroll", scheduleActiveSectionSync, { passive: true });
    return () => window.removeEventListener("scroll", scheduleActiveSectionSync);
  }, [scheduleActiveSectionSync]);

  async function copyText(action: string, text: string) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textArea);
      } catch {
        copied = false;
      }
    }
    if (!copied) {
      setError(errorCopy.clipboardCopyFailed);
      setErrorKind(null);
      setLastFailedQuery(null);
      return;
    }
    setCopiedAction(action);
    window.setTimeout(() => setCopiedAction((current) => (current === action ? null : current)), 1800);
  }

  const answerRenderModel = useMemo(
    () => (answer ? buildAnswerRenderModel(answer, { sources, includeDebugReasons: true }) : null),
    [answer, sources],
  );
  const visualEvidence = useMemo(() => answerRenderModel?.visualEvidence ?? [], [answerRenderModel]);
  const relatedDocuments = useMemo(() => answerRenderModel?.relatedDocuments ?? [], [answerRenderModel]);
  const currentRelevance = answer?.relevance ?? answer?.smartPanel?.relevance ?? searchRelevance;
  const weakEvidence = answerRenderModel
    ? answerRenderModel.trust === "unsupported" || answerRenderModel.trust === "low"
    : (currentRelevance ? isWeakRelevance(currentRelevance) : answer?.grounded !== true) ||
      answer?.retrievalDiagnostics?.gateStatus === "blocked";
  const safetyFindings = useMemo(() => extractSafetyFindings(answer), [answer]);
  const bestSource = answerRenderModel?.bestSource ?? null;
  const sourceSummary = answer?.evidenceSummary ?? answer?.smartPanel?.evidenceSummary;
  const answerGrounded =
    answer?.grounded === true &&
    answer.confidence !== "unsupported" &&
    isAnswerSourceBacked(answer) &&
    answerRenderModel?.trust !== "unsupported";
  const sourceLookup = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const answerPreformatted = isPreformattedGroundedAnswer(answer);
  const safeAnswerText = useMemo(
    () => sanitizeAnswerDisplayText(answer?.answer ?? "", { preformatted: answerPreformatted }),
    [answer?.answer, answerPreformatted],
  );
  const answerFollowUpSuggestions = useMemo(() => {
    if (!answer || !latestAnswerQuery) return [];
    const priorQueries = [...priorAnswerTurns.map((turn) => turn.query), latestAnswerQuery];
    return buildAnswerFollowUpSuggestions(latestAnswerQuery, answer, priorQueries);
  }, [answer, latestAnswerQuery, priorAnswerTurns]);
  const hiddenPriorTurnCount = Math.max(0, priorAnswerTurns.length - maxVisiblePriorTurns);
  const visiblePriorTurns = useMemo(() => {
    if (showEarlierTurns || hiddenPriorTurnCount === 0) return priorAnswerTurns;
    return priorAnswerTurns.slice(-maxVisiblePriorTurns);
  }, [hiddenPriorTurnCount, priorAnswerTurns, showEarlierTurns]);
  const safeAnswerSections = useMemo(() => {
    return (answer?.answerSections ?? [])
      .map((section) => {
        const heading = sanitizeDisplayText(section.heading, { minLength: 1, minTokens: 1 });
        const body = sanitizeAnswerDisplayText(section.body, {
          minLength: 8,
          minTokens: 2,
          preformatted: answerPreformatted,
        });
        if (!heading || !body) return null;

        const citationSources: SearchResult[] = [];
        const seenCitationIds = new Set<string>();
        for (const id of section.citation_chunk_ids) {
          if (seenCitationIds.has(id)) continue;
          const source = sourceLookup.get(id);
          if (!source) continue;
          seenCitationIds.add(id);
          citationSources.push(source);
        }

        return {
          ...section,
          heading,
          body,
          citationSources,
        };
      })
      .filter((section): section is AnswerSection & { citationSources: SearchResult[] } => section !== null);
  }, [answer?.answerSections, answerPreformatted, sourceLookup]);
  const answerEvidenceMapRows = useMemo(() => {
    if (!answerRenderModel?.allowedBlocks.includes("evidenceMap")) return [];
    return evidenceMapRowsFromRenderModel(answerRenderModel).slice(0, answerRenderModel.trust === "high" ? 8 : 6);
  }, [answerRenderModel]);

  const showSystemNotice = Boolean(setupWarning && !demoMode);
  const groupedGovernanceWarningCount = useMemo(
    () =>
      groupSourceGovernanceWarnings(frontendSourceGovernanceWarnings(sourceGovernanceWarnings)).reduce(
        (total, warning) => total + warning.count,
        0,
      ),
    [sourceGovernanceWarnings],
  );
  const mobileFabState = useMemo(
    () =>
      buildMobileSectionFabState({
        hasAnswer: Boolean(answer),
        searchMode,
        sourceCount: sources.length,
        quoteCount: answerRenderModel?.quoteCards.length ?? 0,
        weakEvidence,
        governanceWarningCount: groupedGovernanceWarningCount,
      }),
    [answer, answerRenderModel, groupedGovernanceWarningCount, searchMode, sources.length, weakEvidence],
  );
  const bottomNavItems = [
    {
      label: activeModeSearch.statusLabel,
      description:
        activeModeResultKind === "tools"
          ? query.trim()
            ? "Filtered tools"
            : "Browse tools"
          : activeModeResultKind === "favourites"
            ? query.trim()
              ? "Filtered favourites"
              : "Browse favourites"
            : activeModeResultKind === "answer"
              ? answer
                ? weakEvidence
                  ? "Read synthesis carefully"
                  : "Clinical synthesis"
                : activeModeSearch.nextStep
              : documentMatches.length
                ? "Document results"
                : activeModeSearch.readyTitle,
      icon:
        activeModeResultKind === "tools"
          ? Wrench
          : activeModeResultKind === "favourites"
            ? Heart
            : activeModeResultKind === "answer"
              ? Search
              : FileText,
      href: "#search",
      count:
        activeModeResultKind === "tools"
          ? toolCatalogRecords.length
          : activeModeResultKind === "favourites"
            ? null
            : activeModeResultKind === "documents"
              ? documentMatches.length
              : null,
      empty: activeModeResultKind === "documents" && documentMatches.length === 0,
    },
    {
      label: "Quotes",
      description: answer
        ? answerRenderModel?.quoteCards.length
          ? "Exact source excerpts"
          : "No quotes yet"
        : "No quotes yet",
      icon: Quote,
      href: "#quotes",
      count: answer ? (answerRenderModel?.quoteCards.length ?? 0) : null,
      empty: !answer || (answerRenderModel?.quoteCards.length ?? 0) === 0,
    },
    {
      label: "Images",
      description: answer ? (visualEvidence.length ? "Tables and diagrams" : "No images yet") : "No images yet",
      icon: FileImage,
      href: "#images",
      count: answer ? visualEvidence.length : null,
      empty: !answer || visualEvidence.length === 0,
    },
    {
      label: "Sources",
      description: answer
        ? answerRenderModel?.reviewSources.length
          ? "Passages and documents"
          : "No sources yet"
        : "No sources yet",
      icon: FileText,
      href: "#sources",
      count: answer ? (answerRenderModel?.reviewSources.length ?? 0) : null,
      empty: !answer || (answerRenderModel?.reviewSources.length ?? 0) === 0,
    },
  ] as const;
  const showAuthPanel = false;
  const showDegradedNotice = !isOnline || (apiUnavailable && !canRunSearch);
  const submittedAnswerSearchActive =
    activeModeResultKind === "answer" && !answer && canRunSearch && (modeSearchSubmitted || Boolean(submittedUrlQuery));
  // `/` is the single home page for every mode. The mode pill retargets the
  // composer instead of navigating, so the hero must not be answer-only: picking
  // DSM on home keeps this exact surface and only swaps the placeholder. Gated on
  // the pathname (never on `searchMode`) per the hero-vs-dock rule in
  // docs/search-chrome-behaviour.md — a mode pick must not flip composer reserve.
  const isHomeRoute = pathname === "/";
  const showSharedHome =
    isHomeRoute && !submittedUrlRunRequested && !error && !answer && !loading && !submittedAnswerSearchActive;
  const showAnswerPending =
    activeModeResultKind === "answer" && !answer && (loading || (submittedAnswerSearchActive && !error));
  const answerProgressCompleted = answerProgressEvents.at(-1)?.stage === "complete";
  const showAnswerProgress =
    activeModeResultKind === "answer" &&
    answerProgressEvents.length > 0 &&
    (loading || (Boolean(answer) && answerProgressCompleted));
  const universalAlsoMatchesQuery = activeModeResultKind === "answer" ? (latestAnswerQuery ?? query) : query;
  // Answer-mode also-matches wait for a completed generation (`answer && !loading`)
  // so the panel never sits under the drafting skeleton/stepper. Tools/Favourites
  // still mount on submission. Follow-ups hide the panel while loading so stale
  // matches for the prior query do not compete with the new Drafting stepper.
  const showUniversalAlsoMatches =
    !showSharedHome &&
    Boolean(universalAlsoMatchesQuery.trim()) &&
    (activeModeResultKind === "tools" ||
      activeModeResultKind === "favourites" ||
      (activeModeResultKind === "answer" && Boolean(answer) && !loading) ||
      ((activeModeResultKind === "documents" ||
        activeModeResultKind === "services" ||
        activeModeResultKind === "forms") &&
        modeSearchSubmitted));
  const showDesktopHomeComposer =
    !error &&
    (showSharedHome ||
      activeModeResultKind === "tools" ||
      (activeModeResultKind === "favourites" && favouritesAccessible) ||
      (!loading &&
        ((searchMode === "documents" &&
          activeModeResultKind === "documents" &&
          documentMatches.length === 0 &&
          !modeSearchSubmitted) ||
          // Prescribing keeps MedicationHome (and the hero/phone composer) until
          // an explicit submit — draft keystrokes must not flip to results/dock.
          (searchMode === "prescribing" && activeModeResultKind === "documents" && !modeSearchSubmitted) ||
          // DifferentialsHome leaves ModeHomeTemplate when a draft query coincides
          // with stale evidence matches — keep the hero slot only while home mounts.
          (activeModeResultKind === "differentials" &&
            !modeSearchSubmitted &&
            !(query.trim() && documentMatches.length > 0)))));
  const desktopHomeComposerSlotId = showDesktopHomeComposer ? modeHomeDesktopComposerSlotId : undefined;
  const desktopResultComposerSlotId =
    !desktopHomeComposerSlotId && searchMode !== "answer" ? desktopPageComposerSlotId : undefined;
  // Any mounted mode home (answer, documents, prescribing, differentials, tools,
  // favourites) keeps the in-flow hero pill on phones ("all") per the
  // page-ownership contract. Only result/submitted views fall back to "sm-up"
  // so phones get the compact bottom dock.
  const heroComposerBreakpoint = showDesktopHomeComposer ? "all" : "sm-up";
  const heroOwnsPhoneComposer = Boolean(desktopHomeComposerSlotId) && heroComposerBreakpoint === "all";
  const hasMobileBottomSearch = searchMode !== "answer" && !heroOwnsPhoneComposer;
  // Favourites and Tools are content-rich hubs: they share the centred hero but
  // stay top-aligned so their lists start in a stable position.
  const centeredModeHome =
    showDesktopHomeComposer && activeModeResultKind !== "tools" && activeModeResultKind !== "favourites";
  // Short mode homes (centred homes plus the services/forms registry homes)
  // drop the large mobile bottom padding so phones don't get a scrollbar for
  // content that already fits. Result views keep the full clearance.
  const compactMobileModeHome =
    centeredModeHome ||
    ((searchMode === "services" || searchMode === "forms") && !modeSearchSubmitted && !query.trim() && !loading);
  const differentialsCompareAddonActive =
    searchMode === "differentials" && modeSearchSubmitted && Boolean(query.trim());
  // Prescribing submitted searches render here (there is no standalone results
  // route), so this is where the Patient details pill docks for that mode.
  const patientDetailsAddonActive = searchMode === "prescribing" && modeSearchSubmitted && Boolean(query.trim());
  // Hidden dock pad must stay at 0rem — Safari toolbar safe-area recreates a blank band.
  const mobileComposerReserve = resolveMobileComposerReserve(
    bottomComposerHidden,
    resolveDashboardVisibleMobileComposerReserve({
      searchMode,
      hasAnswerFollowUps: answerFollowUpSuggestions.length > 0,
      differentialsCompareAddonActive,
      patientDetailsAddonActive,
      heroOwnsPhoneComposer,
    }),
  );
  const setupReadyCount = setupChecks.filter((check) => check.status === "ready").length;
  const setupCheckCount = setupChecks.length || fallbackSetupChecks.length;
  const activeUploadWork =
    jobs.filter((job) => job.status === "pending" || job.status === "processing").length +
    batches.filter((batch) => batch.status === "queued" || batch.status === "processing").length;
  const failedUploadWork =
    jobs.filter((job) => job.status === "failed").length + batches.filter((batch) => batch.status === "failed").length;
  const uploadTabs: Array<{
    id: UploadIndexingTab;
    label: string;
    summary: string;
    tabId: string;
    panelId: string;
    icon: typeof UploadCloud;
  }> = [
    {
      id: "setup",
      label: "Setup",
      summary: `${setupReadyCount}/${setupCheckCount} ready`,
      tabId: "dashboard-upload-tab-setup",
      panelId: "dashboard-setup-section",
      icon: ListChecks,
    },
    {
      id: "upload",
      label: "Upload",
      summary: uploadReadOnlyMode || !canUploadDocuments ? "Locked" : "Ready",
      tabId: "dashboard-upload-tab-upload",
      panelId: "dashboard-upload-section",
      icon: UploadCloud,
    },
    {
      id: "jobs",
      label: "Jobs",
      summary: activeUploadWork
        ? `${activeUploadWork} active`
        : failedUploadWork
          ? `${failedUploadWork} failed`
          : "Idle",
      tabId: "dashboard-upload-tab-jobs",
      panelId: "dashboard-indexing-section",
      icon: RefreshCw,
    },
    {
      id: "quality",
      label: "Quality",
      summary: qualityItems.length ? `${qualityItems.length} review` : "Clear",
      tabId: "dashboard-upload-tab-quality",
      panelId: "dashboard-quality-section",
      icon: ShieldAlert,
    },
  ];

  function handleUploadTabKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const order = uploadTabs.map((tab) => tab.id);
    const index = order.indexOf(settingsState.uploadMobileTab);
    const next =
      event.key === "ArrowRight"
        ? order[(index + 1) % order.length]
        : event.key === "ArrowLeft"
          ? order[(index - 1 + order.length) % order.length]
          : event.key === "Home"
            ? order[0]
            : event.key === "End"
              ? order[order.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    if (next !== settingsState.uploadMobileTab) settingsState.setUploadMobileTab(next);
    uploadTabRefs.current.get(next)?.focus();
  }

  const handleUploadQueued = () => {
    setUserStartedIngestion(true);
    setIndexingActive(true);
    settingsState.setUploadMobileTab("jobs");
    void refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false });
  };
  const documentsDrawerIsAdmin = settingsState.documentsDrawerMode === "admin" && canUseAdministrativeApis;
  const documentsDrawerTitle =
    settingsState.documentsDrawerMode === "recent"
      ? "Recent documents"
      : settingsState.documentsDrawerMode === "source"
        ? "Source PDFs"
        : documentsDrawerIsAdmin
          ? "Document admin"
          : "Sources";
  const documentsDrawerSummary = dashboardDataLoading
    ? "Loading indexed document status."
    : settingsState.documentsDrawerMode === "recent"
      ? "Continue reading from recently updated sources."
      : settingsState.documentsDrawerMode === "source"
        ? "Open original PDF source documents."
        : documentsDrawerIsAdmin
          ? `${indexedDocumentTotal.toLocaleString()} indexed documents available.`
          : "Search and open indexed clinical sources.";
  const documentsDrawerMobileSummary = dashboardDataLoading
    ? "Loading sources"
    : settingsState.documentsDrawerMode === "recent"
      ? "Recent sources"
      : settingsState.documentsDrawerMode === "source"
        ? "PDF sources"
        : documentsDrawerIsAdmin
          ? "Admin"
          : "Sources";
  const DocumentsDrawerIcon =
    settingsState.documentsDrawerMode === "recent"
      ? Clock3
      : settingsState.documentsDrawerMode === "source"
        ? ExternalLink
        : documentsDrawerIsAdmin
          ? UploadCloud
          : FolderOpen;
  const drawerGroupTitle = settingsState.uploadDrawerOpen || documentsDrawerIsAdmin ? "Sources and admin" : "Sources";

  // Stable-identity handlers for the React.memo children (StagedAnswerResultSurface,
  // DocumentSearchResultsPanel). These close over the draft `query` or call the
  // intentionally-unstable executeSearch, so plain useCallback can't isolate them
  // from per-keystroke re-renders — useEventCallback keeps identity fixed while
  // always invoking the latest closure. See use-event-callback.ts.
  const handleScopeDocument = useEventCallback(scopeOnlyDocument);
  const handleAnswerFromDocument = useEventCallback(answerFromDocument);
  const handleSubmitAnswerFeedback = useEventCallback(submitAnswerFeedback);
  const handleAnswerFollowUpQuote = useEventCallback(handleFollowUpQuote);
  const handleFollowUpSuggestionPick = useEventCallback(handlePickFollowUpSuggestion);
  const handleCrossModeSearch = useEventCallback(crossModeSearch);
  const handleDocumentTagSearch = useEventCallback(handleTagSearch);
  const handleScopeFiltersChange = useScopeFilterRelax(query, queryMode, setScopeFilters, ask);
  const handleOpenRecentDocuments = useEventCallback(openRecentDocuments);
  const handleOpenSourceLibrary = useEventCallback(openSourceLibrary);
  const handleDocumentsDrawerOpenChange = useEventCallback((nextOpen: boolean) => {
    settingsState.setDocumentsDrawerOpen(nextOpen);
    if (nextOpen) return;

    const returnTarget = documentsDrawerReturnFocusRef.current;
    window.requestAnimationFrame(() => {
      const fallbackTarget = Array.from(
        document.querySelectorAll<HTMLElement>('button[aria-haspopup][aria-label$=" options"]'),
      ).find((element) => element.isConnected && element.getClientRects().length > 0);
      const focusTarget = returnTarget?.isConnected ? returnTarget : fallbackTarget;
      focusTarget?.focus({ preventScroll: true });
      // Sheet autofocus teardown and composer focus listeners can win the first
      // frame after Escape; retry once if the opener did not keep focus.
      window.setTimeout(() => {
        if (!focusTarget?.isConnected || document.activeElement === focusTarget) return;
        focusTarget.focus({ preventScroll: true });
      }, 50);
    });
  });
  const handleOpenSourcePdfBrowser = useEventCallback(openSourcePdfBrowser);
  const handleCopyAnswer = useEventCallback(() => {
    // #208: the render-policy string stays the primary payload — it carries the
    // warnings, trust line and numbered sources the UI already decided the
    // clinician must see. The composer only adds what leaves the app with it:
    // attribution, the AnswerState caveat, and the provenance audit line. A copy
    // is read in a record long after the banner is gone.
    const renderCopyText = answerRenderModel?.copyText || safeAnswerText || answer?.answer || "";
    if (!answer || !renderCopyText) {
      copyText("answer", renderCopyText);
      return;
    }
    copyText("answer", buildAnswerClipboardText({ answer, sources, weakEvidence, renderCopyText }));
  });
  // The answer thread's prior-query list, memoized so it isn't a fresh array on
  // every keystroke (it feeds two memoized surfaces below).
  const crossModeQueries = useMemo(
    () => [...priorAnswerTurns.map((turn) => turn.query), latestAnswerQuery],
    [priorAnswerTurns, latestAnswerQuery],
  );

  function reselectUnavailablePrivateScope() {
    removePrivateScopeRefFromUrl();
    setPrivateScopeStatus("none");
    setModeSearchSubmitted(false);
    openSourceLibrary();
  }

  function runWithoutUnavailablePrivateScope() {
    removePrivateScopeRefFromUrl();
    setSelectedDocumentIds([]);
    setPrivateScopeStatus("none");
    autoRunSearchSignatureRef.current = null;
    void executeSearch(submittedUrlQuery || query, searchMode, scopeFilters, queryMode, false, undefined);
  }

  return (
    <div
      className={cn(
        appBackdrop,
        // Browser phones scroll the document; installed mode keeps <main> bounded.
        "mobile-app-shell phone-viewport-shell flex flex-col text-[color:var(--text)] sm:overflow-hidden md:grid md:grid-cols-[5.25rem_minmax(0,1fr)]",
        // Sidebar collapse snaps by design (#1489): the previous
        // `motion-safe:transition-[grid-template-columns]` needed a mount-gating
        // hook in both shells to avoid animating from the default track width,
        // and animating a grid track relayouts the whole shell on every frame.
        // Restoring the animation means restoring that cost — do not re-add it
        // as a "missing transition" fix.
        settingsState.sidebarCollapsed ? "lg:grid-cols-[5.25rem_minmax(0,1fr)]" : "lg:grid-cols-[20rem_minmax(0,1fr)]",
      )}
      style={
        {
          "--clinical-sidebar-width": settingsState.sidebarCollapsed ? "5.25rem" : "20rem",
          "--clinical-sidebar-width-md": "5.25rem",
          "--mobile-composer-reserve": mobileComposerReserve,
        } as CSSProperties
      }
    >
      <ClinicalDesktopSidebar
        collapsed={settingsState.sidebarCollapsed}
        recentQueries={recentQueries}
        identity={sidebarIdentity}
        activeMode={searchMode}
        onCollapsedChange={settingsState.setSidebarCollapsed}
        onNewChat={startNewChat}
        onPickRecent={pickRecentQuery}
        onOpenSettings={settingsGuideFlow.openSettingsWithDefaultFocus}
        onOpenAccount={settingsGuideFlow.openAccountProfileWithDefaultFocus}
        onPrefetchSettings={SidebarDialogs.loadSettingsDialog}
        onPrefetchAccount={SidebarDialogs.prefetchAccountDialog}
        onPrefetchApplications={prefetchApplications}
        onOpenSearch={focusComposerInput}
        showAccountLibrary={favouritesAccessible}
      />
      <PhoneFooterLayerFrame
        className="phone-viewport-frame relative flex min-h-0 min-w-0 flex-1 flex-col md:h-full"
        scrollHidden={chromeScrollHidden}
      >
        <MasterSearchHeader
          demoMode={clientDemoMode}
          documents={documents}
          documentTotal={indexedDocumentTotal}
          query={query}
          searchMode={searchMode}
          loading={loading}
          selectedDocumentIds={selectedDocumentIds}
          queryMode={queryMode}
          scopeFilters={scopeFilters}
          realDataReady={canRunSearch}
          onQueryChange={setQuery}
          onSearchModeChange={selectSearchMode}
          canAccessFavourites={favouritesAccessible}
          onRequestAccountSetup={() => openAccountSetup("favourites")}
          onAsk={ask}
          onClearQuery={() => {
            setQuery("");
            if (!answer) setModeSearchSubmitted(false);
          }}
          onClearScope={() => setSelectedDocumentIds([])}
          onQueryModeChange={setQueryMode}
          onScopeFiltersChange={setScopeFilters}
          onScopeOpenChange={settingsState.setDocumentScopeOpen}
          onToggleScope={toggleDocumentScope}
          onOpenUpload={openUploadDrawer}
          onOpenEvidence={openEvidenceDrawer}
          onOpenRecentDocuments={openRecentDocuments}
          onOpenLibrary={openSourceLibrary}
          onOpenSourcePdf={openSourcePdfBrowser}
          onNewChat={startNewChat}
          showDesktopNewChat={false}
          onOpenMobileSidebar={() => {
            closeDashboardTransientSurfaces("mobileSidebar");
            settingsState.setMobileSidebarOpen(true);
          }}
          queryModeOptions={clinicalQueryModeOptions}
          queryInputRef={composerInputRef}
          queryInputAutoFocus={shouldAutoFocusComposer}
          recentQueries={recentQueries}
          onPickRecent={(recent) => {
            pickRecentQuery(recent);
            void ask();
          }}
          onCrossModeSearch={crossModeSearch}
          composerFollowUpSuggestions={searchMode === "answer" ? answerFollowUpSuggestions : undefined}
          onPickComposerFollowUpSuggestion={handlePickFollowUpSuggestion}
          composerFollowUpSuggestionsDisabled={loading}
          showPhoneSuggestionTickerOnHome={heroOwnsPhoneComposer}
          sharedHomeIdentity={showSharedHome}
          composerPlaceholder={searchMode === "answer" && latestAnswerQuery ? "Ask a follow-up..." : undefined}
          mobileSearchPlacement={hasMobileBottomSearch ? "bottom" : "default"}
          // Every phone dock is the compact single-row pill so content keeps
          // maximum screen space (mode homes and result views alike).
          mobileBottomSearchVariant="compact"
          mobileBottomSearchAddonSlotId={
            differentialsCompareAddonActive
              ? differentialsMobileCompareAddonSlotId
              : patientDetailsAddonActive
                ? patientDetailsAddonSlotId
                : undefined
          }
          mobileBottomSearchAddonKind={
            differentialsCompareAddonActive
              ? "differentials-compare"
              : patientDetailsAddonActive
                ? "patient-details"
                : undefined
          }
          desktopHomeComposerSlotId={desktopHomeComposerSlotId}
          desktopPageComposerSlotId={desktopResultComposerSlotId}
          // Mode homes keep the composer in the centred hero slot at every
          // breakpoint; documents, therapy, and other homes share the phone/tablet structure.
          heroComposerBreakpoint={heroComposerBreakpoint}
          hideOnScroll={resolveDashboardHideOnScroll(searchMode, chromeScrollHidden)}
          onBottomComposerHiddenChange={setBottomComposerHidden}
        />

        <main
          id="main-content"
          ref={assignMainRef}
          tabIndex={-1}
          // prettier-ignore
          onScroll={handleMainScroll}
          data-bottom-composer-hidden={bottomComposerHidden ? "true" : undefined}
          data-reserve-transitioning={reserveTransitioning ? "true" : undefined}
          data-chrome-transitioning={chromeTransitioning ? "true" : undefined}
          data-phone-scroll-owner={activeScrollOwner}
          data-phone-footer-owner={
            heroOwnsPhoneComposer ? "hero" : searchMode === "answer" || hasMobileBottomSearch ? "dashboard" : "none"
          }
          data-phone-composer-reserve={mobileComposerReserve}
          data-phone-chrome-transition={reserveTransitioning || chromeTransitioning ? "active" : "idle"}
          className={cn(
            "phone-scroll-surface min-h-0 flex-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)] sm:overflow-x-hidden sm:overflow-y-auto sm:overscroll-contain sm:[-webkit-overflow-scrolling:touch]",
            // Answer view: the glass header is absolute over this surface, so
            // <main> reserves its measured height 1:1 with #search so all the
            // section floors below keep their meaning). Padding scrolls with
            // content so it can frost beneath the bar. It stays constant when
            // scroll-hidden: the reserve is at scroll-start, already off-screen
            // whenever the header is hidden, so reclaiming it would only jump
            // the content.
            searchMode === "answer" &&
              "pt-[calc(4rem+max(0.5rem,env(safe-area-inset-top)))] [scroll-padding-top:calc(4.5rem+max(0.5rem,env(safe-area-inset-top)))]",
            // Non-answer modes overlay their phone chrome, so this surface owns
            // the clearance. Constant across hide/reveal by design.
            searchMode !== "answer" && "max-sm:pt-[var(--phone-overlay-chrome-h)]",
            searchMode === "answer"
              ? compactMobileModeHome
                ? "mb-0"
                : // Keep the phone content surface edge-to-edge and reserve the visible
                  // dock inside its scrollable content. Padding can collapse when the
                  // dock hides without exposing the app-shell background; the
                  // bottom-clamp guard in use-hide-on-scroll prevents false reveals.
                  "max-sm:pb-[var(--mobile-composer-reserve)] max-sm:[scroll-padding-bottom:var(--mobile-composer-reserve)] sm:mb-24"
              : hasMobileBottomSearch
                ? // Phone dock reserve; sm+ keeps hero/sticky composers.
                  "max-sm:pb-[var(--mobile-composer-reserve)] max-sm:[scroll-padding-bottom:var(--mobile-composer-reserve)] sm:mb-0"
                : "mb-0",
          )}
        >
          <h1 className="sr-only">Clinical Guide</h1>
          {privateScopeStatus === "unavailable" ? (
            // Lives inside <main> (not as a header sibling): in the answer view
            // the header is absolute, so a sibling alert would reflow to the
            // column top and hide behind the glass bar. Sticky so the recovery
            // actions stay reachable while the user scrolls — pinned below the
            // overlaid glass bar in answer mode, just under the in-flow header
            // otherwise. Sticky resolves against the document in a phone browser
            // and against <main> on the bounded app/tablet surfaces.
            <div
              role="alert"
              data-testid="private-scope-unavailable"
              className={cn(
                "sticky z-20 mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--text)] sm:mx-4 lg:mx-8",
                searchMode === "answer"
                  ? "top-[calc(4.5rem+max(0.5rem,env(safe-area-inset-top)))]"
                  : "top-2 max-sm:top-[calc(var(--phone-overlay-chrome-h)+0.5rem)]",
              )}
            >
              <p>
                The original private document scope is unavailable. Choose the documents again or confirm a broader
                search.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={floatingControl} onClick={reselectUnavailablePrivateScope}>
                  Reselect documents
                </button>
                <button type="button" className={floatingControl} onClick={runWithoutUnavailablePrivateScope}>
                  Run without private scope
                </button>
              </div>
            </div>
          ) : null}
          <SearchCommandProvider value={searchCommandContextValue}>
            <div
              className={cn(
                // overflow-x-CLIP, not -hidden: hidden makes this wrapper a scroll
                // container (overflow-y computes to auto), which clips the composer's
                // command dropdown mid-panel and shows a phantom inner scrollbar.
                "mx-auto max-w-7xl space-y-4 overflow-x-clip px-3 py-4 sm:space-y-5 sm:px-4 sm:py-5 lg:px-8",
                compactMobileModeHome && "max-sm:px-0",
                // Centred mode homes carry little content, so drop the large
                // mobile bottom padding (the fixed composer already has its own
                // reserved margin on <main>) to avoid a needless scrollbar.
                // sm+/lg values stay identical to the result-view treatment.
                searchMode === "answer"
                  ? compactMobileModeHome
                    ? "pb-4"
                    : // The <main> reserve already clears the fixed composer dock on
                      // phones, so the old large mobile bottom padding only floated a
                      // long answer's last line high above the dock (and padded a short
                      // answer's empty space further). Keep it small here; sm+/desktop
                      // keep the original generous padding.
                      "pb-4 sm:pb-36 lg:pb-40"
                  : hasMobileBottomSearch
                    ? // The <main> reserve clears the compact dock on phones, so
                      // content keeps only a small pad of its own.
                      compactMobileModeHome
                      ? "pb-4 sm:pb-10 lg:pb-12"
                      : "pb-8 sm:pb-10 lg:pb-12"
                    : "pb-8 sm:pb-10 lg:pb-12",
              )}
            >
              <DashboardDesktopResultComposerSlot slotId={desktopResultComposerSlotId} />
              {actionNotice && (
                <InlineNotice tone={actionNotice.tone} onDismiss={() => setActionNotice(null)} animated>
                  {actionNotice.message}
                </InlineNotice>
              )}
              {showDegradedNotice && <DegradedNotice isOnline={isOnline} />}
              {showSystemNotice && answer ? (
                <SystemNotice demoMode={demoMode} setupWarning={setupWarning} className="hidden sm:block" />
              ) : null}

              <section
                className={cn(
                  compactMobileModeHome
                    ? cn(
                        // Every breakpoint keeps a viewport-height floor so
                        // justify/place-items-center has free space to centre the
                        // home block instead of hugging the header.
                        "max-sm:flex max-sm:min-h-[calc(100dvh-12.5rem)] max-sm:flex-col sm:min-h-[calc(100dvh-11rem)]",
                        centeredModeHome && "max-sm:justify-center",
                      )
                    : // A rendered answer is content-sized and top-aligned on phones:
                      // it must NOT inherit the viewport-height floor (that floor exists
                      // to give the centred home block room). With the floor, a short
                      // answer stretches the section to ~full height and you can scroll
                      // down into a black void; content-sized keeps the answer under the
                      // question with calm space below and no phantom scroll. Other
                      // result kinds keep the floor; sm+/desktop is unchanged.
                      activeModeResultKind === "answer" && answer
                      ? "sm:min-h-[calc(100dvh-11rem)]"
                      : "min-h-[calc(100dvh-12.5rem)] sm:min-h-[calc(100dvh-11rem)]",
                  centeredModeHome || showSharedHome
                    ? // Phones centre the home block mid-screen, matching the
                      // standalone-route homes; the pop-up action surface picks
                      // its own up/down placement so it stays unclipped either way.
                      "grid w-full place-items-center max-sm:pt-2"
                    : activeModeResultKind === "tools" ||
                        activeModeResultKind === "favourites" ||
                        activeModeResultKind === "differentials"
                      ? "mx-auto w-full max-w-6xl space-y-4 overflow-x-hidden"
                      : activeModeResultKind === "documents" || activeModeResultKind === "services"
                        ? "mx-auto w-full max-w-6xl space-y-4 overflow-x-hidden"
                        : "mx-auto w-full max-w-3xl space-y-4 overflow-x-hidden",
                )}
              >
                <h2 data-testid="answer-section-heading" className="sr-only">
                  {activeModeSearch.resultHeading}
                </h2>
                {answerLifecycle.status === "cancelled" && activeModeResultKind === "answer" ? (
                  <EmptyState
                    icon={Square}
                    title="Generation stopped"
                    body="No partial clinical answer was kept. You can safely run the same question again."
                    live="polite"
                    testId="answer-cancelled"
                    actions={
                      <button
                        type="button"
                        className={cn(primaryControl, "text-xs")}
                        onClick={() => void ask(answerLifecycle.query ?? query)}
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        Run again
                      </button>
                    }
                  />
                ) : error && errorKind === "no-results" && activeModeResultKind === "answer" ? (
                  <EmptyState
                    icon={Search}
                    title={answerRecovery.noResults.heading}
                    body={`${answerRecovery.noResults.body} Suggestions: ${generateQuerySuggestions((lastFailedQuery ?? query).trim()).join("; ")}.`}
                    live="polite"
                    tone="info"
                    testId="answer-no-results"
                    actions={
                      <>
                        <button
                          type="button"
                          data-testid="answer-no-results-rephrase"
                          onClick={() => focusComposerInput()}
                          className={cn(primaryControl, "text-xs")}
                        >
                          {answerRecovery.rephrase}
                        </button>
                        <button
                          type="button"
                          data-testid="answer-no-results-search-documents"
                          onClick={() => crossModeSearch("documents", (lastFailedQuery ?? query).trim())}
                          className={cn(floatingControl, "text-xs")}
                        >
                          <FileText aria-hidden="true" className="h-4 w-4" />
                          {answerRecovery.searchDocuments}
                        </button>
                      </>
                    }
                  />
                ) : error ? (
                  <EmptyState
                    icon={CircleAlert}
                    title="Answer unavailable"
                    body={error}
                    live="assertive"
                    tone="danger"
                    testId="answer-error"
                    actions={
                      activeModeResultKind === "answer" && lastFailedQuery ? (
                        <>
                          <button
                            type="button"
                            data-testid="answer-error-retry"
                            onClick={() => {
                              const retryQuery = lastFailedQuery ?? query;
                              setError(null);
                              void ask(retryQuery);
                            }}
                            className={cn(floatingControl, "text-xs")}
                          >
                            <RefreshCw aria-hidden="true" className="h-4 w-4" />
                            {answerRecovery.retry}
                          </button>
                          <button
                            type="button"
                            data-testid="answer-error-search-documents"
                            onClick={() => crossModeSearch("documents", (lastFailedQuery ?? query).trim())}
                            className={cn(floatingControl, "text-xs")}
                          >
                            <FileText aria-hidden="true" className="h-4 w-4" />
                            {answerRecovery.searchDocuments}
                          </button>
                        </>
                      ) : undefined
                    }
                  />
                ) : null}

                {searchMode !== "prescribing" &&
                  (activeModeResultKind === "answer" ? (
                    showAnswerProgress ? (
                      <AnswerProgressStepper
                        events={answerProgressEvents}
                        startedAt={answerProgressStartedAt}
                        active={loading}
                        onStop={stopSearch}
                        density={loading && Boolean(answer) ? "compact" : "expanded"}
                      />
                    ) : null
                  ) : loading && answerProgress ? (
                    <SearchProgressBanner message={answerProgress} onStop={stopSearch} />
                  ) : null)}

                {showUniversalAlsoMatches &&
                (activeModeResultKind === "tools" ||
                  activeModeResultKind === "documents" ||
                  activeModeResultKind === "services" ||
                  activeModeResultKind === "forms") ? (
                  <UniversalSearchAlsoMatches modeId={searchMode} query={universalAlsoMatchesQuery} />
                ) : null}

                {showSharedHome ? (
                  // The one home surface, shared by all 13 modes. It sits above every
                  // mode-specific branch so picking a mode on `/` changes only its
                  // presentation and composer target; mode-owned content stays behind
                  // its own route (/tools, /favourites, /dsm, …).
                  <SharedHomeEmptyState
                    modeId={searchMode}
                    desktopComposerSlotId={desktopHomeComposerSlotId}
                    recentQueries={recentQueries}
                    onSelectRecent={(recentQuery) => {
                      setQuery(recentQuery);
                      void ask(recentQuery);
                    }}
                  />
                ) : activeModeResultKind === "differentials" ? (
                  <DifferentialsHome
                    query={query}
                    loading={loading}
                    searchSubmitted={modeSearchSubmitted}
                    evidenceQuery={differentialEvidenceQuery}
                    documentMatches={documentMatches}
                    realDataReady={canRunSearch}
                    authUnavailable={false}
                    apiUnavailable={apiUnavailable}
                    setupWarning={setupWarning}
                    onQueryChange={setQuery}
                    desktopComposerSlotId={desktopHomeComposerSlotId}
                    onSuggestedSearch={(nextQuery) => {
                      setQuery(nextQuery);
                      focusComposerInput();
                    }}
                    onRunSearch={(nextQuery) => {
                      void executeSearch(nextQuery, "differentials", scopeFilters);
                    }}
                    onOpenPresentations={(nextQuery) => {
                      const queryParams = new URLSearchParams();
                      const normalizedQuery = nextQuery.trim();
                      if (normalizedQuery) queryParams.set("q", normalizedQuery);
                      router.push(`/differentials/presentations${queryParams.toString() ? `?${queryParams}` : ""}`);
                    }}
                    onOpenDiagnoses={(nextQuery) => {
                      const queryParams = new URLSearchParams();
                      const normalizedQuery = nextQuery.trim();
                      if (normalizedQuery) queryParams.set("q", normalizedQuery);
                      router.push(`/differentials/diagnoses${queryParams.toString() ? `?${queryParams}` : ""}`);
                    }}
                  />
                ) : activeModeResultKind === "tools" ? (
                  <ToolsHub query={query} desktopComposerSlotId={desktopHomeComposerSlotId} />
                ) : activeModeResultKind === "favourites" && favouritesAccessible ? (
                  <FavouritesHub
                    query={query}
                    demoMode={clientDemoMode}
                    onClearQuery={() => {
                      setQuery("");
                      setModeSearchSubmitted(false);
                      router.replace(appModeHomeHref("favourites", { focus: true, queryMode, scopeFilters }));
                    }}
                    desktopComposerSlotId={desktopHomeComposerSlotId}
                  />
                ) : activeModeResultKind === "favourites" ? (
                  <FavouritesGuestGate onOpenAccountSetup={() => openAccountSetup("favourites")} />
                ) : activeModeResultKind === "documents" || activeModeResultKind === "services" ? (
                  searchMode === "prescribing" ? (
                    <MedicationPrescribingWorkspace
                      query={query}
                      loading={false}
                      realDataReady
                      authUnavailable={false}
                      apiUnavailable={false}
                      setupWarning={null}
                      onSuggestedSearch={setMedicationSearchQuery}
                      showHome={!modeSearchSubmitted}
                      desktopComposerSlotId={desktopHomeComposerSlotId}
                    />
                  ) : (
                    <>
                      <DocumentSearchResultsPanel
                        matches={documentMatches}
                        recordMatches={recordSearchMatches}
                        recordMode={recordSearchMode}
                        recordStatus={recordStatus}
                        showRecordMatches={searchMode === "services" || searchMode === "forms"}
                        query={query}
                        loading={loading}
                        documentCount={indexedDocumentTotal}
                        recentDocuments={documents}
                        realDataReady={searchMode === "services" || searchMode === "forms" ? true : canRunSearch}
                        authUnavailable={false}
                        apiUnavailable={apiUnavailable}
                        setupWarning={setupWarning}
                        facets={searchFacets}
                        searchScope={searchMode === "documents" ? searchScope : null}
                        onScopeDocument={handleScopeDocument}
                        onAnswerFromDocument={handleAnswerFromDocument}
                        onOpenRecentDocuments={handleOpenRecentDocuments}
                        onOpenLibrary={handleOpenSourceLibrary}
                        onOpenSourcePdf={handleOpenSourcePdfBrowser}
                        onTagSearch={handleDocumentTagSearch}
                        scopeFilters={searchMode === "documents" ? scopeFilters : null}
                        onScopeFiltersChange={searchMode === "documents" ? handleScopeFiltersChange : undefined}
                        showHome={searchMode === "documents" && !modeSearchSubmitted}
                        desktopComposerSlotId={desktopHomeComposerSlotId}
                      />
                    </>
                  )
                ) : showAnswerPending ? (
                  <AnswerSkeleton />
                ) : answer && answerRenderModel ? (
                  stagedDashboardExtraction.answerSurface ? (
                    <>
                      {hiddenPriorTurnCount > 0 && !showEarlierTurns ? (
                        <button
                          type="button"
                          data-testid="answer-thread-show-earlier"
                          onClick={() => setShowEarlierTurns(true)}
                          className="inline-flex min-h-tap items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 text-xs font-semibold text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                        >
                          Show earlier messages ({hiddenPriorTurnCount})
                        </button>
                      ) : null}
                      {visiblePriorTurns.map((turn) => (
                        <PriorAnswerTurnSurface
                          key={turn.id}
                          turn={turn}
                          copied={copiedAction === turn.id}
                          collapsed={collapsedTurnIds.has(turn.id)}
                          onToggleCollapsed={() => toggleAnswerTurnCollapsed(turn.id)}
                          onCopy={(text) => copyText(turn.id, text)}
                        />
                      ))}
                      <StagedAnswerResultSurface
                        answer={answer}
                        query={latestAnswerQuery ?? query}
                        bestSource={bestSource}
                        sourceSummary={sourceSummary}
                        renderModel={answerRenderModel}
                        weakEvidence={weakEvidence}
                        answerViewMode={answerViewMode}
                        answerEvidenceMapRows={answerEvidenceMapRows}
                        onScopeDocument={handleScopeDocument}
                        answerGrounded={answerGrounded}
                        sources={answerRenderModel.reviewSources}
                        demoMode={demoMode}
                        safeAnswerSections={safeAnswerSections}
                        safetyFindings={safetyFindings}
                        copiedAnswer={copiedAction === "answer"}
                        pendingFeedback={pendingFeedback}
                        onCopyAnswer={handleCopyAnswer}
                        onSubmitFeedback={handleSubmitAnswerFeedback}
                        onFollowUpQuote={handleAnswerFollowUpQuote}
                        followUpSuggestions={answerFollowUpSuggestions}
                        onPickFollowUpSuggestion={handleFollowUpSuggestionPick}
                        followUpSuggestionsDisabled={loading}
                        crossModeQueries={crossModeQueries}
                        onCrossModeSearch={handleCrossModeSearch}
                      />
                    </>
                  ) : null
                ) : null}

                {showUniversalAlsoMatches && activeModeResultKind === "answer" ? (
                  <UniversalSearchAlsoMatches modeId={searchMode} query={universalAlsoMatchesQuery} />
                ) : null}
              </section>

              {showSystemNotice && answer ? (
                <SystemNotice demoMode={demoMode} setupWarning={setupWarning} className="sm:hidden" />
              ) : null}

              {activeModeResultKind === "answer" && answer && (
                <RelatedDocumentsPanel
                  documents={relatedDocuments}
                  onScopeDocument={handleScopeDocument}
                  onTagSearch={handleDocumentTagSearch}
                />
              )}
              {(settingsState.documentsDrawerOpen || settingsState.uploadDrawerOpen) && (
                <section id="sources" className="mx-auto grid w-full max-w-4xl gap-3 scroll-mt-4 sm:scroll-mt-6">
                  <p className="px-1 pt-1 text-2xs font-bold uppercase tracking-kicker text-[color:var(--text-muted)]">
                    {drawerGroupTitle}
                  </p>
                  {settingsState.documentsDrawerOpen ? (
                    <UtilityDrawer
                      id="dashboard-documents-drawer"
                      icon={BookOpen}
                      title={documentsDrawerTitle}
                      summary={documentsDrawerSummary}
                      mobileSummary={documentsDrawerMobileSummary}
                      open={settingsState.documentsDrawerOpen}
                      onOpenChange={handleDocumentsDrawerOpenChange}
                      sheetBreakpoint={documentsDrawerIsAdmin ? "lg" : "all"}
                      sheetReturnFocusRef={documentsDrawerReturnFocusRef}
                      sheetHeaderLeading={
                        <span className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
                          <DocumentsDrawerIcon className="h-5 w-5" aria-hidden="true" />
                        </span>
                      }
                      sheetTitleAccessory={
                        documentsDrawerIsAdmin ? (
                          <span className="nums hidden rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2.5 py-1 text-2xs font-bold text-[color:var(--text-muted)] sm:inline-flex">
                            {indexedDocumentTotal.toLocaleString()} indexed
                          </span>
                        ) : null
                      }
                      sheetDescription={documentsDrawerSummary}
                      sheetHeaderClassName="bg-[color:var(--surface-raised)] px-4 py-3 sm:px-5 sm:py-4"
                      sheetCloseButtonClassName="grid h-tap w-tap shrink-0 place-items-center rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                      sheetContentClassName="max-h-[min(82dvh,40rem)] sm:max-h-[min(88dvh,46rem)] sm:max-w-2xl lg:max-w-3xl"
                      sheetBodyClassName="bg-[color:var(--surface-subtle)] p-3 sm:p-4"
                      sheetChildrenClassName="space-y-3"
                    >
                      {documentsDrawerIsAdmin ? (
                        <LibraryHealthStrip
                          documents={documents}
                          jobs={jobs}
                          batches={batches}
                          checks={setupChecks}
                          loading={dashboardDataLoading}
                          onSelectTarget={openLibraryHealthTarget}
                        />
                      ) : null}
                      <DocumentDrawer
                        documents={documents}
                        pagination={documentsPagination}
                        loadingMoreDocuments={loadingMoreDocuments}
                        mode={documentsDrawerIsAdmin ? "admin" : settingsState.documentsDrawerMode}
                        selectedDocumentIds={selectedDocumentIds}
                        statusFilter={documentDrawerStatusFilter}
                        onToggleScope={toggleDocumentScope}
                        onLoadMoreDocuments={loadMoreDocuments}
                        onDocumentRenamed={handleDocumentRenamed}
                        onDocumentDeleted={handleDocumentDeleted}
                        onBulkReindex={bulkReindexSelected}
                        onBulkAssignCollection={bulkAssignCollection}
                        onBulkMetadataUpdate={bulkUpdateMetadata}
                        bulkActionStatus={bulkActionStatus}
                        bulkActionBusy={bulkActionBusy}
                        canManageDocuments={canUseAdministrativeApis}
                        onTagSearch={handleTagSearch}
                        onMutateLabel={mutateDocumentLabel}
                      />
                    </UtilityDrawer>
                  ) : null}

                  {settingsState.uploadDrawerOpen ? (
                    <UtilityDrawer
                      id="dashboard-upload-drawer"
                      icon={UploadCloud}
                      title="Upload and indexing"
                      summary="Real uploads require Supabase, OpenAI keys, schema setup, and the worker."
                      mobileSummary="Setup & uploads"
                      open={settingsState.uploadDrawerOpen}
                      onOpenChange={settingsState.setUploadDrawerOpen}
                    >
                      <LibraryHealthStrip
                        documents={documents}
                        jobs={jobs}
                        batches={batches}
                        checks={setupChecks}
                        loading={dashboardDataLoading}
                        onSelectTarget={openLibraryHealthTarget}
                      />
                      <div
                        role="tablist"
                        aria-label="Upload and indexing sections"
                        onKeyDown={handleUploadTabKeyDown}
                        className="grid grid-cols-4 gap-2 lg:hidden"
                      >
                        {uploadTabs.map((tab) => {
                          const active = settingsState.uploadMobileTab === tab.id;
                          const Icon = tab.icon;
                          return (
                            <button
                              key={tab.id}
                              ref={(element) => {
                                if (element) uploadTabRefs.current.set(tab.id, element);
                                else uploadTabRefs.current.delete(tab.id);
                              }}
                              type="button"
                              role="tab"
                              id={tab.tabId}
                              aria-selected={active}
                              aria-controls={tab.panelId}
                              aria-label={tab.label}
                              aria-describedby={`${tab.tabId}-summary`}
                              tabIndex={active ? 0 : -1}
                              onClick={() => settingsState.setUploadMobileTab(tab.id)}
                              className={cn(
                                "min-h-[56px] rounded-lg border px-2.5 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] active:translate-y-px",
                                active
                                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--glow-soft)]"
                                  : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
                              )}
                            >
                              <span className="flex items-center gap-1.5 text-xs font-bold">
                                <Icon className="h-3.5 w-3.5" />
                                {tab.label}
                              </span>
                              <span
                                id={`${tab.tabId}-summary`}
                                className="mt-1 block truncate text-2xs font-semibold opacity-80"
                              >
                                {tab.summary}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div
                          id="dashboard-setup-section"
                          role={uploadUsesDesktopRegions ? "region" : "tabpanel"}
                          aria-labelledby={
                            uploadUsesDesktopRegions ? "dashboard-setup-section-heading" : "dashboard-upload-tab-setup"
                          }
                          className={cn(
                            "space-y-3 scroll-mt-4 lg:col-start-1 lg:row-start-1",
                            settingsState.uploadMobileTab !== "setup" && "hidden lg:block",
                          )}
                        >
                          <p
                            id="dashboard-setup-section-heading"
                            className={cn("text-xs font-bold uppercase tracking-eyebrow", textMuted)}
                          >
                            Developer setup status
                          </p>
                          <SetupChecklist checks={setupChecks} />
                          {showAuthPanel && <AuthPanel />}
                        </div>
                        <div
                          id="dashboard-upload-section"
                          role={uploadUsesDesktopRegions ? "region" : "tabpanel"}
                          aria-labelledby={
                            uploadUsesDesktopRegions
                              ? "dashboard-upload-section-heading"
                              : "dashboard-upload-tab-upload"
                          }
                          className={cn(
                            "space-y-3 scroll-mt-4 lg:col-start-1 lg:row-start-2",
                            settingsState.uploadMobileTab !== "upload" && "hidden lg:block",
                          )}
                        >
                          <p
                            id="dashboard-upload-section-heading"
                            className={cn("text-xs font-bold uppercase tracking-eyebrow", textMuted)}
                          >
                            Clinical upload
                          </p>
                          <UploadPanel
                            onUploaded={handleUploadQueued}
                            demoMode={uploadReadOnlyMode}
                            canUpload={canUploadDocuments}
                            authorizationHeader={authorizationHeader}
                            registerAuthRequest={registerAuthRequest}
                            isAuthEpochCurrent={isAuthEpochCurrent}
                            onSessionExpired={markSessionExpired}
                          />
                        </div>
                        <div
                          id="dashboard-indexing-section"
                          role={uploadUsesDesktopRegions ? "region" : "tabpanel"}
                          aria-labelledby={
                            uploadUsesDesktopRegions
                              ? "dashboard-indexing-section-heading"
                              : "dashboard-upload-tab-jobs"
                          }
                          className={cn(
                            "space-y-3 scroll-mt-4 lg:col-start-2 lg:row-span-2 lg:row-start-1",
                            settingsState.uploadMobileTab !== "jobs" && "hidden lg:block",
                          )}
                        >
                          <p
                            id="dashboard-indexing-section-heading"
                            className={cn("text-xs font-bold uppercase tracking-eyebrow", textMuted)}
                          >
                            Indexing progress
                          </p>
                          <IndexingMonitor
                            jobs={jobs}
                            batches={batches}
                            filter={indexingMonitorFilter}
                            actionId={indexingActionId}
                            onRetry={retryJob}
                            onReindex={reindexDocument}
                            onEnrich={enrichDocument}
                          />
                        </div>
                        <div
                          id="dashboard-quality-section"
                          role={uploadUsesDesktopRegions ? "region" : "tabpanel"}
                          aria-labelledby={
                            uploadUsesDesktopRegions
                              ? "dashboard-quality-section-heading"
                              : "dashboard-upload-tab-quality"
                          }
                          className={cn(
                            "space-y-3 scroll-mt-4 lg:col-span-2 lg:row-start-3",
                            settingsState.uploadMobileTab !== "quality" && "hidden lg:block",
                          )}
                        >
                          <p
                            id="dashboard-quality-section-heading"
                            className={cn("text-xs font-bold uppercase tracking-eyebrow", textMuted)}
                          >
                            Ingestion quality console
                          </p>
                          <IngestionQualityConsole
                            items={qualityItems}
                            actionId={indexingActionId}
                            onRetry={retryJob}
                            onReindex={reindexDocument}
                            onEnrich={enrichDocument}
                          />
                        </div>
                      </div>
                    </UtilityDrawer>
                  ) : null}
                </section>
              )}

              {(settingsState.documentsDrawerOpen || settingsState.uploadDrawerOpen) && (
                <GuideTrigger onOpen={openGuide} onPrefetch={loadGuideDialog} />
              )}
            </div>
          </SearchCommandProvider>
        </main>

        <MobileSectionFab
          items={bottomNavItems}
          activeHash={activeHash}
          state={mobileFabState}
          hidden
          onNavigate={navigateMobileSection}
        />
        <LazyGuideDialog open={settingsState.guideOpen} onClose={settingsGuideFlow.closeGuideWithRestore} />
        <SidebarDialogs.SidebarSettingsDialog
          open={settingsState.settingsOpen}
          onClose={closeSettings}
          identity={sidebarIdentity}
          onSignOut={auth.signOut}
          onOpenGuide={settingsGuideFlow.openGuideFromSettings}
          onPrefetchGuide={loadGuideDialog}
          initialFocus={settingsGuideFlow.settingsInitialFocus}
        />
        <SidebarDialogs.SidebarAccountSetupDialog
          open={accountSetupOpen}
          onClose={closeAccountSetup}
          intent={accountSetupIntent}
        />
        <ClinicalMobileSidebar
          open={settingsState.mobileSidebarOpen}
          recentQueries={recentQueries}
          identity={sidebarIdentity}
          activeMode={searchMode}
          onOpenChange={settingsState.setMobileSidebarOpen}
          onNewChat={startNewChat}
          onPickRecent={pickRecentQuery}
          onOpenSettings={settingsGuideFlow.openSettingsWithDefaultFocus}
          onOpenAccount={settingsGuideFlow.openAccountProfileWithDefaultFocus}
          onPrefetchSettings={SidebarDialogs.loadSettingsDialog}
          onPrefetchAccount={SidebarDialogs.prefetchAccountDialog}
          onPrefetchApplications={prefetchApplications}
          onOpenSearch={focusComposerInput}
          showAccountLibrary={favouritesAccessible}
        />
      </PhoneFooterLayerFrame>
    </div>
  );
}
