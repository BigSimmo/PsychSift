"use client";

import { isPdfDocument } from "@/lib/pdf-documents";
import { useSubmittedModeSearch } from "@/components/clinical-dashboard/use-submitted-mode-search";
import { useSettingsState } from "./clinical-dashboard/SettingsStateProvider";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Clock3, ExternalLink, FolderOpen, Activity } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useSharedHomeDocumentTitle } from "@/components/clinical-dashboard/use-shared-home-document-title";
import { useDashboardBulkActions } from "@/components/clinical-dashboard/use-dashboard-bulk-actions";
import { useDashboardDocumentActions } from "@/components/clinical-dashboard/use-dashboard-document-actions";
import {
  useDashboardLibraryRefresh,
  useDashboardLibraryState,
} from "@/components/clinical-dashboard/use-dashboard-library-data";
import { useIndexingAdminDesktopLayout } from "@/components/clinical-dashboard/use-indexing-admin-desktop-layout";
import { extractSafetyFindings } from "@/lib/clinical-safety";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import { scrollSurface } from "@/components/clinical-dashboard/scroll-surface";
import { isLocalNoAuthMode, resolveClientDemoMode } from "@/lib/client-env";
import { isAdministratorUser } from "@/lib/authorization";
import { isDeployedClinicalKb } from "@/lib/deployed-app";
import { appBackdrop, cn, InlineNotice } from "@/components/ui-primitives";
import { useAuthSession } from "@/lib/supabase/client";
import {
  clinicalAskWorkspaceVisible,
  type ClinicalDashboardProps,
  useClinicalAskDashboardChrome,
} from "@/components/clinical-dashboard/use-clinical-ask-shell-state";
import { ModeClinicalAskSurface } from "@/components/clinical-dashboard/mode-clinical-ask-surface";
import { ClinicalAskDashboardBoundary } from "@/components/clinical-dashboard/clinical-ask-dashboard-boundary";
import { useEventCallback } from "@/components/clinical-dashboard/use-event-callback";
import { useScopeFilterRelax } from "@/components/clinical-dashboard/use-scope-filter-relax";
import { useApplyFilters } from "@/components/clinical-dashboard/use-apply-filters";
import { buildMobileSectionFabState, MobileSectionFab, ToolsHub } from "@/components/clinical-dashboard/dashboard-nav";
import {
  buildDashboardBottomNavItems,
  resolveDashboardModeSurface,
} from "@/components/clinical-dashboard/dashboard-mode-surface";
import * as SidebarDialogs from "@/components/clinical-dashboard/lazy-sidebar-dialogs";
import { TWO_PANE_SIDE_MENU } from "@/lib/work-frame/side-menu-choice";
import { prefetchTwoPaneSideMenu, TwoPaneSideMenuHost } from "@/components/work-frame/lazy-work-side-nav";
import { TwoPaneSideRail, type TwoPaneMenuPane } from "@/components/work-frame/two-pane-side-strip";
import { useNewWorkMode } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useSettingsGuideFlow } from "@/components/clinical-dashboard/use-settings-guide-flow";
import {
  deriveSidebarIdentity,
  ClinicalDesktopSidebar,
  ClinicalMobileSidebar,
} from "@/components/clinical-dashboard/ClinicalSidebar";
import {
  canRunDashboardSearch,
  fallbackSetupChecks,
  hasReadyRequiredPublicSearchConfig,
  hasReadyPublicSearchSetup,
  type SetupCheck,
} from "@/components/clinical-dashboard/document-manager-contracts";
import { GuideTrigger } from "@/components/clinical-dashboard/dashboard-shell";
import { loadGuideDialog } from "@/components/clinical-dashboard/lazy-guide-dialog";
import { SystemNotice, DegradedNoticeFrame } from "@/components/clinical-dashboard/dashboard-notices";
import { resolveModeHomeCanvasClass } from "@/components/clinical-dashboard/mode-home-canvas";
import { sanitizeAnswerDisplayText } from "@/components/clinical-dashboard/display-text";
import { AnswerCancelledNotice } from "@/components/clinical-dashboard/answer-cancelled-notice";
import {
  AnswerProviderNotice,
  AnswerSummaryUnavailableNotice,
} from "@/components/clinical-dashboard/answer-provider-notice";
import { isPreformattedGroundedAnswer } from "@/components/clinical-dashboard/answer-content";
import {
  AnswerProgress,
  AnswerSkeleton,
  SearchProgressBanner,
  SharedHomeEmptyState,
} from "@/components/clinical-dashboard/answer-status";
import { type TimedAnswerProgressUpdate } from "@/components/clinical-dashboard/answer-progress";
import { AnswerCrisisBanner } from "@/components/clinical-dashboard/answer-crisis-banner";
import { EmergencyProtocolBanner } from "@/components/clinical-dashboard/emergency-protocol-banner";
import { selectEmergencyProtocolsForSurface } from "@/lib/emergency-protocols";
import { RegistryModeNav } from "@/components/mode-nav/registry-mode-nav";
import { MasterSearchHeader } from "@/components/clinical-dashboard/master-search-header";
import { PhoneFooterLayerFrame } from "@/components/clinical-dashboard/phone-footer-layer-portal";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import { FavouritesGuestGate } from "@/components/clinical-dashboard/favourites-guest-gate";
import { PrivateScopeUnavailableAlert } from "@/components/clinical-dashboard/private-scope-unavailable-alert";
import { DashboardSearchErrorState } from "@/components/clinical-dashboard/dashboard-search-error-state";
import { useDashboardShellActions } from "@/components/clinical-dashboard/use-dashboard-shell-actions";
import { useDashboardSearchExecution } from "@/components/clinical-dashboard/use-dashboard-search-execution";
import { notNowDocumentsSearch } from "@/components/front-door/ask-terms-not-now";
import { useAskTermsGate } from "@/components/front-door/use-ask-terms-gate";
import { Button } from "@/components/ui/button";
import { ClinicalSignInNotice } from "@/components/mode-kit/clinical-sign-in-notice";
import { ClinicalCatalogueGate } from "@/components/mode-kit/clinical-catalogue-gate";
import { useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";
import { ASK_TERMS_DECLINED_NOTICE, ASK_TERMS_REVIEW_LABEL, CLINICAL_SIGN_IN_COPY } from "@/lib/front-door-content";
import { focusComposerInput as scheduleComposerFocus } from "@/components/clinical-dashboard/focus-composer-input";
import {
  resolveDashboardHideOnScroll,
  useDashboardChromeCoordinator,
} from "@/components/clinical-dashboard/use-dashboard-chrome-coordinator";
import { SearchCommandProvider } from "@/components/clinical-dashboard/search-command-context";
import {
  hasNonProductionSupabaseApiKeyFallback,
  isAbortError,
  releaseOwnedAbortController,
  replaceOwnedAbortController,
  normalizeNavigationHash,
} from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import { errorCopy } from "@/lib/ui-copy";
import { useDashboardAnswerFeedback } from "@/components/clinical-dashboard/dashboard-answer-feedback";
import { buildTagSearchScopeFilters } from "@/components/clinical-dashboard/dashboard-tag-search";
import {
  useDashboardScrollSync,
  useDashboardSectionNavigation,
} from "@/components/clinical-dashboard/dashboard-scroll-sync";
import { useDashboardRecentQueries } from "@/components/clinical-dashboard/dashboard-recent-queries";
import { DashboardSidebarDialogs } from "@/components/clinical-dashboard/dashboard-sidebar-dialogs";
import { useDashboardDrawerOpeners } from "@/components/clinical-dashboard/dashboard-drawer-openers";
import { useDashboardClipboard } from "@/components/clinical-dashboard/dashboard-clipboard";
import { type DocumentDrawerStatusFilter } from "@/components/clinical-dashboard/dashboard-contracts";
import {
  clinicalQueryModeOptions,
  stagedDashboardExtraction,
} from "@/components/clinical-dashboard/clinical-dashboard-payloads";
import { type IndexingMonitorFilter, type LibraryHealthTarget } from "@/components/clinical-dashboard/document-admin";
import { useIdlePreload } from "@/components/clinical-dashboard/idle-preload";
import {
  IndexingAdminDrawer,
  loadIndexingAdminDrawer,
} from "@/components/clinical-dashboard/indexing-admin-drawer-lazy";
import { DashboardDocumentsDrawer } from "@/components/clinical-dashboard/dashboard-documents-drawer";
import { useHomeModeSeed } from "@/components/clinical-dashboard/use-home-mode-seed";
import {
  AskTermsStep,
  DifferentialsHome,
  DocumentSearchResultsPanel,
  FavouritesHub,
  loadStagedAnswerResultSurface,
  MedicationPrescribingWorkspace,
  RelatedDocumentsPanel,
  StagedAnswerResultSurface,
} from "@/components/clinical-dashboard/clinical-dashboard-lazy";

import { clearLegacyRecentQueries } from "@/lib/recent-query-storage";
import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import type { SearchFacets } from "@/components/clinical-dashboard/document-search-results";
import { isWeakRelevance } from "@/components/clinical-dashboard/relevance";
import { type AnswerPayload, type AnswerErrorKind } from "@/components/clinical-dashboard/search-utils";
import {
  appModeDefinition,
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
import { isDashboardModeHref, ownPageModeHomeHref } from "@/lib/search-route-ownership";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import {
  privateScopeReadyForRoute,
  readSearchNavigationContext,
  routedSubmissionContextChanged,
  searchNavigationContextSignature,
  searchSubmissionSignature,
  type PrivateScopeRestorationStatus,
} from "@/lib/search-navigation-context";
import { removePrivateScopeRefFromUrl, restorePrivateSearchScope } from "@/lib/private-search-scope";
import { answerLifecycleReducer, initialAnswerLifecycle } from "@/lib/answer-lifecycle";
import { hasCrisisWording, hasOverdoseWording } from "@/lib/crisis-wording";
import { useDeferredRegistrySearch } from "@/components/clinical-dashboard/use-deferred-registry-search";
import { buildAnswerFollowUpSuggestions } from "@/lib/answer-follow-up";
import { clearPersistedAnswerThread } from "@/lib/answer-thread-storage";
import { useAnswerThreadBootstrap } from "@/components/clinical-dashboard/use-answer-thread-bootstrap";
import {
  resolveDashboardAnswerThreadOwnerId,
  usePersistedAnswerThread,
  type AnswerThreadSnapshotMetadata,
} from "@/components/clinical-dashboard/use-persisted-answer-thread";
import { buildAnswerClipboardText } from "@/components/clinical-dashboard/answer-copy-payload";
import { buildAnswerRenderModel } from "@/lib/answer-render-policy";
import type { ClientDocumentMatch, ClientQuoteCard, ClientSearchResult } from "@/lib/answer-client-payload";
import type { VerifiedEvidencePreviewUnit } from "@/lib/answer-stream-contract";
import {
  frontendSourceGovernanceWarnings,
  groupSourceGovernanceWarnings,
  type SourceGovernanceWarning,
} from "@/lib/source-governance";

import { type SmartDocumentTag, type SmartDocumentTagFacet } from "@/lib/document-tags";
import type { EvidenceRelevance, SearchScopeSummary, ClinicalQueryMode } from "@/lib/types";
import type { SearchScopeFilters } from "@/lib/search-scope";
import { DashboardDesktopResultComposerSlot } from "@/components/clinical-dashboard/dashboard-desktop-result-composer-slot";
import { useDifferentialsCompareHasSelection } from "@/components/differentials/compare-presence";
import { differentialsMobileCompareAddonSlotId, patientDetailsAddonSlotId } from "@/lib/mode-home-composer";
import { toolCatalogRecords } from "@/lib/tools-catalog";
import { createQuoteFollowUp, type AnswerViewMode } from "@/lib/ward-output";
import {
  type AnswerTurn,
  maxVisiblePriorTurns,
  PriorAnswerTurnSurface,
} from "@/components/clinical-dashboard/answer-thread-turn";
export type { AnswerFeedbackType } from "@/lib/answer-feedback";
export function ClinicalDashboard(props: ClinicalDashboardProps = {}) {
  return (
    <ClinicalAskDashboardBoundary>
      <ClinicalDashboardContent {...props} />
    </ClinicalAskDashboardBoundary>
  );
}

function ClinicalDashboardContent({
  initialSearchMode = "answer",
  initialQuery = "",
  focusSearch = false,
  autoRunSearch = false,
  clinicalAskAvailableModeIds = [],
}: ClinicalDashboardProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [lastAppMode, setLastAppMode] = useLastAppMode();
  const [initialSearchNavigationContext] = useState(() => readSearchNavigationContext(searchParams));
  const scrollFrameRef = useRef<number | null>(null);
  const navSyncLockRef = useRef<number | null>(null);
  const autoRunSearchSignatureRef = useRef<string | null>(null);
  const urlSearchBootstrappedRef = useRef(false);
  const urlDocumentSearchBootstrappedRef = useRef(false);
  const lastSyncedSearchParamsRef = useRef(searchParams.toString());
  const modeChangeFromUiRef = useRef(false);
  const library = useDashboardLibraryState();
  const {
    documents,
    setDocuments,
    documentsPagination,
    dashboardDataLoading,
    loadingMoreDocuments,
    jobs,
    batches,
    qualityItems,
    setIndexingActive,
    setUserStartedIngestion,
    resetForSignOut: resetLibraryForSignOut,
  } = library;
  const indexedDocumentTotal = documentsPagination?.total ?? documents.length;
  // Recent and library views list PDFs only; the admin view still lists every file.
  const libraryPdfDocuments = useMemo(() => documents.filter(isPdfDocument), [documents]);
  const answerThreadBootstrappedRef = useRef(false);
  const activeAnswerThreadOwnerIdRef = useRef<string | null>(null);
  const [answerThreadBootstrapped, setAnswerThreadBootstrapped] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
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
  const { modeSearchSubmitted, submittedModeQuery, setModeSearchSubmitted } = useSubmittedModeSearch({
    autoRunSearch,
    initialQuery,
    initialSearchMode,
  });
  // focus=1 means "focus on entry", not "keep the dock focused after results".
  // Suppress autofocus once a mode search/answer has been submitted so hide-on-
  // scroll can reclaim chrome on result views (Answer and other bottom docks).
  const shouldAutoFocusComposer = focusSearch && !modeSearchSubmitted;
  const [answer, setAnswer] = useState<AnswerPayload | null>(null);
  const [sources, setSources] = useState<ClientSearchResult[]>([]);
  // Answer-mode conversation thread. `priorAnswerTurns` holds completed
  // exchanges displayed above the latest answer; `latestAnswerQuery` is the
  // question that produced the current `answer` (the composer `query` is a
  // draft that clears after each successful answer). The ref mirrors the
  // latest committed turn so async search completions can archive it without
  // reading stale closure state.
  const [priorAnswerTurns, setPriorAnswerTurns] = useState<AnswerTurn[]>([]);
  const [latestAnswerQuery, setLatestAnswerQuery] = useState<string | null>(null);
  const [setupBlockedQuery, setSetupBlockedQuery] = useState<string | null>(null);
  const [collapsedTurnIds, setCollapsedTurnIds] = useState<Set<string>>(() => new Set());
  const [showEarlierTurns, setShowEarlierTurns] = useState(false);
  const threadRestoreScrolledRef = useRef(false);
  const restoredThreadFromStorageRef = useRef(false);
  const latestAnswerTurnRef = useRef<Omit<AnswerTurn, "id"> | null>(null);
  const latestAnswerSnapshotMetadataRef = useRef<AnswerThreadSnapshotMetadata | null>(null);
  const answerTurnSeqRef = useRef(0);
  const [documentMatches, setDocumentMatches] = useState<ClientDocumentMatch[]>([]);
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
  const { recordSearchMatches, recordSearchMode, recordStatus, recordsDegraded } = useDeferredRegistrySearch(
    searchMode,
    query,
  );
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
  const [restoredAnswerSavedAt, setRestoredAnswerSavedAt] = useState<number | null>(null);
  // React Compiler lint only reached this component once the search execution functions, which
  // the compiler skipped, moved to useDashboardSearchExecution. It now reports the setter
  // omitted from these dependency lists; setters are stable, so the lists stay as they were.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- see above
  const resetAnswerThread = useCallback(() => {
    setPriorAnswerTurns([]);
    setLatestAnswerQuery(null);
    setCollapsedTurnIds(new Set());
    setShowEarlierTurns(false);
    setRestoredAnswerSavedAt(null);
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
  const [scopeFilters, setScopeFilters] = useState<SearchScopeFilters>(initialSearchNavigationContext.scopeFilters);
  const [searchScope, setSearchScope] = useState<SearchScopeSummary | null>(null);
  const [sourceGovernanceWarnings, setSourceGovernanceWarnings] = useState<SourceGovernanceWarning[]>([]);
  // Write-only for now: the clinical-notes panel was its only reader and the source
  // drawer replaced that panel. The state and its resets stay until the panel itself
  // is removed (handover §8), so re-wiring a view mode does not have to be rebuilt.
  const [, setAnswerViewMode] = useState<AnswerViewMode>("high_yield");
  const [loading, setLoading] = useState(false);
  const [answerProgress, setAnswerProgress] = useState<string | null>(null);
  const [answerProgressEvents, setAnswerProgressEvents] = useState<TimedAnswerProgressUpdate[]>([]);
  const [answerBuildEvents, setAnswerBuildEvents] = useState<TimedAnswerProgressUpdate[]>([]);
  const answerProgressEventsRef = useRef<TimedAnswerProgressUpdate[]>([]);
  const [answerProgressStartedAt, setAnswerProgressStartedAt] = useState<number | null>(null);
  const [answerEvidencePreview, setAnswerEvidencePreview] = useState<VerifiedEvidencePreviewUnit | null>(null);
  const [answerLifecycle, dispatchAnswerLifecycle] = useReducer(answerLifecycleReducer, initialAnswerLifecycle);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- see resetAnswerThread
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
    setAnswerBuildEvents([]);
    setAnswerEvidencePreview(null);
    setDifferentialEvidenceQuery(null);
  }, [
    resetAnswerThread,
    setAnswer,
    setSources,
    setDocumentMatches,
    setSearchRelevance,
    setSearchFacets,
    setSearchScope,
    setSourceGovernanceWarnings,
    setError,
    setAnswerProgress,
    setAnswerEvidencePreview,
    setDifferentialEvidenceQuery,
  ]);
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
  const [actionNotice, setActionNotice] = useState<{ tone: "success" | "warning"; message: string } | null>(null);
  const [activeHash, setActiveHash] = useState("#search");
  const { navigateMobileSection } = useDashboardSectionNavigation({
    mainRef,
    navSyncLockRef,
    setActiveHash,
  });
  const settingsState = useSettingsState();
  const documentsDrawerReturnFocusRef = useRef<HTMLElement | null>(null);
  // Same contract as the documents drawer above: UtilityDrawer's default return target is its own
  // mobile trigger, which unmounts with the drawer on phone layouts, leaving focus with nowhere to
  // go. Capture the real opener before opening instead.
  const indexingAdminReturnFocusRef = useRef<HTMLElement | null>(null);
  const indexingAdminUsesDesktopRegions = useIndexingAdminDesktopLayout();
  const [documentDrawerStatusFilter, setDocumentDrawerStatusFilter] = useState<DocumentDrawerStatusFilter>("indexed");
  const [indexingMonitorFilter, setIndexingMonitorFilter] = useState<IndexingMonitorFilter>("all");
  const searchCommandContextValue = useMemo(
    () => ({
      query: deferredQuery,
      modeId: searchMode,
    }),
    [deferredQuery, searchMode],
  );
  const [indexingActionId, setIndexingActionId] = useState<string | null>(null);
  const auth = useAuthSession();
  // #3728: library search, medicines and differentials need sign-in (server-enforced).
  const clinicalToolAccess = useClinicalToolAccess();
  const { clinicalAskSession, clinicalAskMode, runModeClinicalAsk } = useClinicalAskDashboardChrome({
    accountId: auth.session?.user.id,
    searchMode,
    query,
    clinicalAskAvailableModeIds,
  });
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

  const prevAuthStatusRef = useRef(authStatus);
  useEffect(() => {
    const previous = prevAuthStatusRef.current;
    prevAuthStatusRef.current = authStatus;
    if ((authStatus === "signed_out" || authStatus === "expired") && previous === "authenticated") {
      searchRequestSeqRef.current += 1;
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      resetLibraryForSignOut();
      resetAnswerThread();
      setAnswer(null);
      setSources([]);
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
  }, [authStatus, resetAnswerThread, resetLibraryForSignOut]);
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
  // The two-pane side menu (owner pick 8 Oct 2026) is off again; the classic phone menu shows (10 Oct 2026).
  const twoPaneSideMenu = TWO_PANE_SIDE_MENU;
  const newWorkMode = useNewWorkMode();
  // From 768 px the two-pane menu's strip stays on screen as a rail (1024 px up
  // keeps the full sidebar). A rail button opens the menu on its own pane.
  const [menuPane, setMenuPane] = useState<TwoPaneMenuPane | null>(null);
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
    setIndexingAdminDrawerOpen: settingsState.setIndexingAdminDrawerOpen,
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
    setRestoredAnswerSavedAt,
  });
  // Local no-auth can still exercise public-read APIs, but administration is always
  // derived separately from the immutable account role claim.
  const localDevCanAttemptPrivateApis = process.env.NODE_ENV !== "production" && hasReadyPublicSearchSetup(setupChecks);
  const canUsePublicSearchApis = localProjectReady && hasReadyPublicSearchSetup(setupChecks);
  const canUseDegradedLocalSearchApis =
    process.env.NODE_ENV !== "production" && localProjectReady && hasReadyRequiredPublicSearchConfig(setupChecks);
  const canUseNonProductionDemoFallback = localProjectReady && hasNonProductionSupabaseApiKeyFallback(setupChecks);
  const canUsePrivateApis =
    localProjectReady && (localNoAuthMode || localDevCanAttemptPrivateApis || authStatus === "authenticated");
  const isAdministrator = isAdministratorUser(auth.session?.user);
  const canUseAdministrativeApis = localProjectReady && isAdministrator;
  useIdlePreload(loadIndexingAdminDrawer, canUseAdministrativeApis);
  const canAttemptDeployedPublicSearch = isDeployedClinicalKb() && localProjectReady;
  const canRunSearch = canRunDashboardSearch({
    localProjectReady,
    explicitDemoMode,
    canUsePublicSearchApis,
    canUseDegradedLocalSearchApis,
    canUseNonProductionDemoFallback,
    canAttemptDeployedPublicSearch,
  });
  const openLibraryHealthTarget = useCallback(
    (target: LibraryHealthTarget) => {
      indexingAdminReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
        closeDashboardTransientSurfaces("indexingAdmin");
        settingsState.setIndexingAdminMobileTab("jobs");
        setIndexingMonitorFilter("active");
        settingsState.setIndexingAdminDrawerOpen(true);
      } else if (target === "failures") {
        closeDashboardTransientSurfaces("indexingAdmin");
        settingsState.setIndexingAdminMobileTab("jobs");
        setIndexingMonitorFilter("failed");
        settingsState.setIndexingAdminDrawerOpen(true);
      } else {
        closeDashboardTransientSurfaces("indexingAdmin");
        settingsState.setIndexingAdminMobileTab("setup");
        setIndexingMonitorFilter("all");
        settingsState.setIndexingAdminDrawerOpen(true);
      }

      window.setTimeout(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: resolveScrollBehavior(), block: "start" });
      }, 0);
    },
    [
      canUseAdministrativeApis,
      closeDashboardTransientSurfaces,
      settingsState,
      setActionNotice,
      setDocumentDrawerStatusFilter,
      setIndexingMonitorFilter,
    ],
  );

  // The dashboard renders directly on "/" without the standalone search shell,
  // so it must purge the legacy unscoped recent-queries key too (2026-07-13
  // audit, finding 4).
  useEffect(() => {
    clearLegacyRecentQueries();
  }, []);

  // Authenticated account preference bootstrap + recent-search recording gate.
  // canRecordRecentSearches stays false until bootstrap settles, so we never
  // leak queries against a remote opt-out while local defaults still say on.
  const { canRecordRecentSearches } = useAppPreferences();

  const { recentQueries, rememberRecentQuery } = useDashboardRecentQueries({
    answerThreadOwnerId,
    canRecordRecentSearches,
  });

  usePersistedAnswerThread({
    ownerId: answerThreadOwnerId,
    enabled: answerThreadBootstrapped && searchMode === "answer",
    answer,
    priorTurns: priorAnswerTurns,
    latestTurnRef: latestAnswerTurnRef,
    collapsedTurnIds,
    showEarlierTurns,
    metadataRef: latestAnswerSnapshotMetadataRef,
  });

  const dashboardDataSurfaceVisible =
    settingsState.documentScopeOpen || settingsState.documentsDrawerOpen || settingsState.indexingAdminDrawerOpen;
  const administrationSurfaceVisible =
    canUseAdministrativeApis &&
    (settingsState.indexingAdminDrawerOpen ||
      (settingsState.documentsDrawerOpen && settingsState.documentsDrawerMode === "admin"));

  const { refresh, loadMoreDocuments } = useDashboardLibraryRefresh({
    library,
    authEpoch,
    ownerId: auth.session?.user.id ?? null,
    authStatus,
    authorizationHeader,
    authBoundFetch,
    registerAuthRequest,
    isAuthEpochCurrent,
    markSessionExpired,
    canUsePrivateApis,
    clientDemoMode,
    demoMode,
    setupChecks,
    setSetupChecks,
    setSetupWarning,
    setDemoMode,
    setApiUnavailable,
    setLocalProjectReady,
    dashboardDataSurfaceVisible,
    administrationSurfaceVisible,
  });

  const {
    retryJob,
    reindexDocument,
    enrichDocument,
    handleDocumentRenamed,
    mutateDocumentLabel,
    handleDocumentDeleted,
  } = useDashboardDocumentActions({
    authBoundFetch,
    authorizationHeader,
    canUsePrivateApis,
    clientDemoMode,
    isAuthEpochCurrent,
    markSessionExpired,
    refresh,
    setActionNotice,
    setAnswer,
    setDocumentMatches,
    setDocuments,
    setIndexingActionId,
    setIndexingActive,
    setSelectedDocumentIds,
    setSources,
    setUserStartedIngestion,
  });
  const { bulkActionStatus, bulkActionBusy, bulkReindexSelected, bulkAssignCollection, bulkUpdateMetadata } =
    useDashboardBulkActions({
      authBoundFetch,
      authorizationHeader,
      isAuthEpochCurrent,
      markSessionExpired,
      refresh,
      selectedDocumentIds,
      setIndexingActive,
      setUserStartedIngestion,
    });

  useEffect(() => {
    if (actionNotice?.tone !== "success") return undefined;
    const timer = window.setTimeout(() => setActionNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  // Losing administrator access must not leave jobs, batches and quality data on screen. The render
  // guard on the drawer stops painting immediately; this clears the state behind it too, so
  // re-acquiring access does not silently reopen a surface the user never asked for.
  //
  // Corrected during render rather than in an effect: `react-hooks/set-state-in-effect` forbids the
  // effect form, and this is React's documented "adjust state while rendering" case — the condition
  // is false immediately after the setter runs, so it settles in one extra pass and never loops.
  if (!canUseAdministrativeApis && settingsState.indexingAdminDrawerOpen) {
    settingsState.setIndexingAdminDrawerOpen(false);
    setIndexingMonitorFilter("all");
  }

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

  const {
    stopSearch,
    applySearchResult,
    executeSearch,
    requestSourceLibrarySearch,
    runWithRetries,
    setMedicationSearchQuery,
    ask: sendAsk,
  } = useDashboardSearchExecution({
    router,
    auth,
    query,
    searchMode,
    queryMode,
    requestQueryMode,
    scopeFilters,
    selectedDocumentIds,
    clientDemoMode,
    authorizationHeader,
    canRunSearch,
    mainRef,
    searchRequestSeqRef,
    searchAbortRef,
    answerTimedOutRef,
    answerProgressEventsRef,
    latestAnswerTurnRef,
    latestAnswerSnapshotMetadataRef,
    answerTurnSeqRef,
    autoRunSearchSignatureRef,
    modeChangeFromUiRef,
    markSessionExpired,
    registerAuthRequest,
    isAuthEpochCurrent,
    rememberRecentQuery,
    resetAnswerThread,
    clearModeResultState,
    setModeSearchSubmitted,
    dispatchAnswerLifecycle,
    setSearchMode,
    setQuery,
    setAnswer,
    setSources,
    setDocumentMatches,
    setPriorAnswerTurns,
    setLatestAnswerQuery,
    setSetupBlockedQuery,
    setCollapsedTurnIds,
    setSearchRelevance,
    setSearchFacets,
    setSearchScope,
    setSourceGovernanceWarnings,
    setDifferentialEvidenceQuery,
    setAnswerViewMode,
    setLoading,
    setAnswerProgress,
    setAnswerProgressEvents,
    setAnswerBuildEvents,
    setAnswerProgressStartedAt,
    setAnswerEvidencePreview,
    setRestoredAnswerSavedAt,
    setError,
    setErrorKind,
    setLastFailedQuery,
    setDemoMode,
    setActionNotice,
  });

  // The Terms step at the first Ask (audit F-13). An Answer question waits here,
  // unsent, until the current Terms are accepted. Not now runs the same question
  // as a Documents search instead, through the cross-mode path the results use.
  const askTermsGate = useAskTermsGate({
    onNotNow: async (heldQuery, isCurrent) => {
      // Review from the documents notice, then Not now again: those documents are already shown.
      if (searchMode === "documents" && query.trim() === heldQuery) return;
      const fallback = await notNowDocumentsSearch(heldQuery);
      // Another Ask arrived while the check was loading: leave the dashboard to it.
      if (!isCurrent()) return;
      if ("notice" in fallback) {
        setActionNotice({ tone: "warning", message: fallback.notice });
        return;
      }
      crossModeSearch("documents", fallback.query);
    },
    onSaveFailed: (message) => setActionNotice({ tone: "warning", message }),
  });
  // Every way into an Answer request in this dashboard goes through `ask`: the
  // composer, a ?run=1 link, a recent question, retry and the filter relaxers.
  // A held question is sent later by the latest render's `sendAsk`, unchanged.
  const sendAskRef = useRef(sendAsk);
  useLayoutEffect(() => {
    sendAskRef.current = sendAsk;
  });
  const ask: typeof sendAsk = async (searchText = query, contextOverride, replaceExistingAnswer = false) => {
    if (searchMode !== "answer" || !searchText.trim()) {
      return sendAsk(searchText, contextOverride, replaceExistingAnswer);
    }
    return askTermsGate.guard(searchText, () => sendAskRef.current(searchText, contextOverride, replaceExistingAnswer));
  };

  // The URL sync reads the current mode to tell a stale UI-change flag from a
  // genuine one, without the mode becoming one of its dependencies.
  // Refreshed in a layout effect, which runs before any effect that reads it.
  const searchModeRef = useRef(searchMode);
  useLayoutEffect(() => {
    searchModeRef.current = searchMode;
  });
  useHomeModeSeed({
    pathname,
    searchParams,
    lastAppMode,
    setSearchMode,
    searchModeRef,
    setQuery,
    setQueryMode,
    setScopeFilters,
    setModeSearchSubmitted,
    setLoading,
    setError,
    setAnswerProgress,
    clearModeResultState,
    focusComposerInput,
    stopSearch,
    modeChangeFromUiRef,
    lastSyncedSearchParamsRef,
  });

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
  const scopeFiltersRef = useRef(scopeFilters);
  useLayoutEffect(() => {
    executeSearchRef.current = executeSearch;
    scopeFiltersRef.current = scopeFilters;
  });

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
      modeSearch.kind === "services" ||
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

  const askRef = useRef(ask);
  useLayoutEffect(() => {
    askRef.current = ask;
  });

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
    // An Answer cross-search reaches executeSearch, which holds back patient details,
    // after the Terms step has had its say.
    if (mode === "answer" && crossQuery.trim()) {
      askTermsGate.guard(crossQuery, () => latestCrossModeSearchAfterTerms(mode, crossQuery));
      return;
    }
    crossModeSearchAfterTerms(mode, crossQuery);
  }

  function crossModeSearchAfterTerms(mode: AppModeId, crossQuery: string) {
    // The navigation below writes the text into the address bar, history and a request line
    // before executeSearch could refuse it, so a mode whose search reaches the overseas AI
    // service holds back a patient detail first (audit S2/D-03). The Not now fallback's check
    // is the same one: a patient detail, or a check that cannot load, stops the search.
    const targetModeSearch = appModeSearchConfig(mode);
    const sendsQueryToProvider =
      targetModeSearch.resultKind === "answer" ||
      targetModeSearch.kind === "documents" ||
      targetModeSearch.kind === "differentials";
    if (sendsQueryToProvider && crossQuery.trim()) {
      const submittedSeq = searchRequestSeqRef.current;
      void notNowDocumentsSearch(crossQuery.trim()).then((checked) => {
        // A mode switch, Stop or newer search while the check loads makes this one stale.
        if (submittedSeq !== searchRequestSeqRef.current) return;
        if ("notice" in checked) {
          setActionNotice({ tone: "warning", message: checked.notice });
          return;
        }
        latestNavigateCrossModeSearch(mode, crossQuery);
      });
      return;
    }
    navigateCrossModeSearch(mode, crossQuery);
  }

  function navigateCrossModeSearch(mode: AppModeId, crossQuery: string) {
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

  const { pendingFeedback, submitAnswerFeedback } = useDashboardAnswerFeedback({
    answer,
    sources,
    clientDemoMode,
    authorizationHeader,
    markSessionExpired,
    setActionNotice,
  });

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
      setModeSearchSubmitted(true, trimmedSearchText);
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
    setModeSearchSubmitted(true, trimmedSearchText);
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
    const { searchText, nextFilters } = buildTagSearchScopeFilters(scopeFilters, tag);
    setScopeFilters(nextFilters);
    const targetMode = appModeCanUseSourceLibraryShortcut(searchMode) ? searchMode : "documents";
    void runDocumentSearchShortcut(searchText, nextFilters, true, targetMode);
  }

  function selectSearchMode(mode: AppModeId) {
    if (mode === "favourites" && !favouritesAccessible) {
      openAccountSetup("favourites");
      return;
    }
    setLastAppMode(mode);

    // A mode with nothing to search lives on its own page. Pointing the shared
    // home's composer at it would show an empty search box whose query goes
    // nowhere, so open the page instead, wherever the switch came from.
    const ownPage = ownPageModeHomeHref(mode);
    if (ownPage) {
      stopSearch();
      router.push(ownPage);
      return;
    }

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

  function handleFollowUpQuote(quote: ClientQuoteCard) {
    stageAnswerFollowUpDraft(createQuoteFollowUp(quote));
  }

  function handlePickFollowUpSuggestion(suggestion: string) {
    askTermsGate.guard(suggestion, () => void executeSearchRef.current(suggestion));
  }

  function startNewChat() {
    clinicalAskSession.clear();
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

  const { openRecentDocuments, openSourceLibrary, openSourcePdfBrowser, openEvidenceDrawer } =
    useDashboardDrawerOpeners({
      documentsDrawerReturnFocusRef,
      closeDashboardTransientSurfaces,
      setSearchMode,
      setDocumentDrawerStatusFilter,
      setDocumentsDrawerMode: settingsState.setDocumentsDrawerMode,
      setDocumentsDrawerOpen: settingsState.setDocumentsDrawerOpen,
      setActionNotice,
    });

  const { handleMainScroll } = useDashboardScrollSync({
    mainRef,
    navSyncLockRef,
    scrollFrameRef,
    setActiveHash,
  });

  const { copiedAction, copyText } = useDashboardClipboard({
    setError,
    setErrorKind,
    setLastFailedQuery,
  });

  const answerRenderModel = useMemo(
    () => (answer ? buildAnswerRenderModel(answer, { sources, includeDebugReasons: true }) : null),
    [answer, sources],
  );
  const visualEvidence = useMemo(() => answerRenderModel?.visualEvidence ?? [], [answerRenderModel]);
  const relatedDocuments = useMemo(() => answerRenderModel?.relatedDocuments ?? [], [answerRenderModel]);
  const currentRelevance = answer?.relevance ?? searchRelevance;
  const weakEvidence = answerRenderModel
    ? answerRenderModel.trust === "unsupported" || answerRenderModel.trust === "low"
    : (currentRelevance ? isWeakRelevance(currentRelevance) : answer?.grounded !== true) ||
      answer?.retrievalGateBlocked === true;
  const safetyFindings = useMemo(() => extractSafetyFindings(answer), [answer]);
  const bestSource = answerRenderModel?.bestSource ?? null;
  const sourceSummary = answer?.evidenceSummary;
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
  const bottomNavItems = useMemo(
    () =>
      buildDashboardBottomNavItems({
        activeModeResultKind,
        activeModeSearch,
        answer,
        documentMatchCount: documentMatches.length,
        query: deferredQuery,
        quoteCount: answerRenderModel?.quoteCards.length ?? 0,
        reviewSourceCount: answerRenderModel?.reviewSources.length ?? 0,
        toolCatalogCount: toolCatalogRecords.length,
        visualEvidenceCount: visualEvidence.length,
        weakEvidence,
      }),
    [
      activeModeResultKind,
      activeModeSearch,
      answer,
      documentMatches.length,
      deferredQuery,
      answerRenderModel?.quoteCards.length,
      answerRenderModel?.reviewSources,
      visualEvidence.length,
      weakEvidence,
    ],
  );
  const answerProgressCompleted = answerProgressEvents.at(-1)?.stage === "complete";
  // A failed documents search with nothing listed. The documents results own that
  // message (one calm "not a reliable nothing found" state with Retry and Browse), so the
  // generic red "Search unavailable" box is not stacked on top. When earlier matches are
  // still listed they belong to the previous query, so the red box stays and says so.
  const documentsSearchFailed = searchMode === "documents" && Boolean(error) && errorKind !== "no-results";
  const documentsResultsOwnError =
    documentsSearchFailed &&
    activeModeResultKind === "documents" &&
    modeSearchSubmitted &&
    Boolean(query.trim()) &&
    documentMatches.length === 0;
  const differentialsCompareHasSelection = useDifferentialsCompareHasSelection();
  const {
    showAuthPanel,
    showDegradedNotice,
    showSharedHome,
    showAnswerCancelledNotice,
    showAnswerPending,
    showAnswerProgress,
    universalAlsoMatchesQuery,
    showUniversalAlsoMatches,
    toolsDirectoryWithoutComposer,
    desktopHomeComposerSlotId,
    desktopResultComposerSlotId,
    heroComposerBreakpoint,
    heroOwnsPhoneComposer,
    hasMobileBottomSearch,
    openSidebarSearch,
    centeredModeHome,
    compactMobileModeHome,
    differentialsCompareAddonActive,
    patientDetailsAddonActive,
    mobileComposerReserve,
    // focusComposerInput and startNewChat read refs only when called, never during render. Lint
    // reports this only since the compiler stopped bailing on executeSearch; see resetAnswerThread.
    // eslint-disable-next-line react-hooks/refs -- callbacks, not ref reads
  } = resolveDashboardModeSurface({
    activeModeResultKind,
    answer,
    answerFollowUpSuggestionCount: answerFollowUpSuggestions.length,
    differentialsCompareHasSelection,
    answerLifecycleStatus: answerLifecycle.status,
    answerProgressCompleted,
    answerProgressEventCount: answerProgressEvents.length,
    apiUnavailable,
    bottomComposerHidden,
    canRunSearch,
    documentMatchCount: documentMatches.length,
    error,
    favouritesAccessible,
    focusComposerInput,
    isOnline,
    latestAnswerQuery,
    loading,
    modeSearchSubmitted,
    pathname,
    query,
    searchMode,
    startNewChat,
    submittedModeQuery,
    submittedUrlMode: searchParams.get("mode"),
    submittedUrlQuery,
    submittedUrlRunRequested,
  });
  // The mode pill rewrites the shared-home URL with history.replaceState rather
  // than asking Next to navigate. Server metadata therefore cannot update after
  // an in-place mode choice; keep the accessible browser title aligned with the
  // visible mode heading on that client-only path as well — and give the title
  // back when the shared home stops owning it, or the last mode title written
  // here strands itself on the next route (#3CJPX5).
  useSharedHomeDocumentTitle(showSharedHome, searchMode);
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
          ? Activity
          : FolderOpen;
  const drawerGroupTitle =
    settingsState.indexingAdminDrawerOpen || documentsDrawerIsAdmin ? "Sources and admin" : "Sources";

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
  const handleRecheckRestoredAnswer = useEventCallback(() => {
    const queryToRerun = (latestAnswerQuery ?? deferredQuery).trim();
    if (!queryToRerun) return;
    askTermsGate.guard(
      queryToRerun,
      () => void executeSearchRef.current(queryToRerun, "answer", scopeFilters, queryMode, true),
    );
  });
  const handleCrossModeSearch = useEventCallback(crossModeSearch);
  const latestCrossModeSearchAfterTerms = useEventCallback(crossModeSearchAfterTerms);
  const latestNavigateCrossModeSearch = useEventCallback(navigateCrossModeSearch);
  const handleDocumentTagSearch = useEventCallback(handleTagSearch);
  const handleScopeFiltersChange = useScopeFilterRelax(query, queryMode, setScopeFilters, ask);
  const handleDocumentFiltersApply = useApplyFilters(query, queryMode, setScopeFilters, setSelectedDocumentIds, askRef);
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
    const rerunQuery = submittedUrlQuery || query;
    const rerun = () =>
      void executeSearchRef.current(rerunQuery, searchMode, scopeFilters, queryMode, false, undefined);
    if (searchMode === "answer") askTermsGate.guard(rerunQuery, rerun);
    else rerun();
  }

  // The card is local and provider-independent, so it also shows for a submitted answer
  // query that never reached the backend (setup not ready) via `setupBlockedQuery`.
  const matchedEmergencyProtocols = selectEmergencyProtocolsForSurface({
    isAnswerSurface: activeModeResultKind === "answer",
    hasResultSurface: Boolean(loading || answer),
    resultQuery: answerLifecycle.query ?? latestAnswerQuery ?? query,
    setupBlockedQuery,
  });

  const desktopSidebar = (
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
      onOpenSearch={openSidebarSearch}
      onSelectMode={selectSearchMode}
      showAccountLibrary={favouritesAccessible}
    />
  );

  return (
    <div
      className={cn(
        appBackdrop,
        // Browser phones scroll the document; installed mode keeps <main> bounded.
        "mobile-app-shell phone-viewport-shell flex flex-col text-[color:var(--text)] sm:overflow-hidden md:grid md:grid-cols-[4rem_minmax(0,1fr)]",
        // Sidebar collapse snaps by design (#1489): the previous
        // `motion-safe:transition-[grid-template-columns]` needed a mount-gating
        // hook in both shells to avoid animating from the default track width,
        // and animating a grid track relayouts the whole shell on every frame.
        // Restoring the animation means restoring that cost — do not re-add it
        // as a "missing transition" fix.
        settingsState.sidebarCollapsed ? "lg:grid-cols-[4rem_minmax(0,1fr)]" : "lg:grid-cols-[16.5rem_minmax(0,1fr)]",
      )}
      style={
        {
          "--clinical-sidebar-width": settingsState.sidebarCollapsed ? "4rem" : "16.5rem",
          "--clinical-sidebar-width-md": "4rem",
          "--mobile-composer-reserve": mobileComposerReserve,
        } as CSSProperties
      }
    >
      {twoPaneSideMenu ? (
        <>
          <TwoPaneSideRail
            identity={sidebarIdentity}
            side="clinical"
            workAvailable={newWorkMode}
            showAccountLibrary={favouritesAccessible}
            hideOnDesktop
            onOpenMenu={(pane) => {
              closeDashboardTransientSurfaces("mobileSidebar");
              setMenuPane(pane);
              settingsState.setMobileSidebarOpen(true);
            }}
            onPrefetchMenu={prefetchTwoPaneSideMenu}
            onOpenSettings={settingsGuideFlow.openSettingsWithDefaultFocus}
          />
          <div className="hidden lg:contents">{desktopSidebar}</div>
        </>
      ) : (
        desktopSidebar
      )}
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
          loading={loading || (clinicalAskSession.mode === clinicalAskMode && clinicalAskSession.submitted)}
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
            if (answer) return;
            // Clearing an initial Answer request must invalidate and abort it
            // before navigation. Otherwise its late result can repaint the
            // answer and restore the submitted URL after the shared home opens.
            if (loading) stopSearch();
            setModeSearchSubmitted(false);
            // Clear the URL too, or `showSharedHome` (which reads `run=1` off the URL)
            // stays suppressed while the mode branch, now query-less, falls back to the
            // retired home its route was consolidated away from — `medication-home` and
            // `document-search-empty-state`, both pinned by browser cases.
            // `appModeSelectionHref`, not `appModeHomeHref`: these modes are all
            // dashboard-owned, and `appModeHomeHref("prescribing")` answers
            // `/medications`, which only 307s back here.
            if (submittedUrlRunRequested) {
              router.replace(appModeSelectionHref(searchMode, { focus: true, queryMode, scopeFilters }), {
                scroll: false,
              });
            }
          }}
          onClearScope={() => setSelectedDocumentIds([])}
          onQueryModeChange={setQueryMode}
          onScopeFiltersChange={setScopeFilters}
          onScopeOpenChange={settingsState.setDocumentScopeOpen}
          onToggleScope={toggleDocumentScope}
          onOpenEvidence={openEvidenceDrawer}
          onOpenRecentDocuments={openRecentDocuments}
          onOpenLibrary={openSourceLibrary}
          // Restores the administrator's cold-load route to document management: the
          // indexing drawer's only other openers sit inside surfaces that require it to
          // be open already.
          canManageDocuments={canUseAdministrativeApis}
          onOpenDocumentAdmin={() => openLibraryHealthTarget("documents")}
          onOpenSourcePdf={openSourcePdfBrowser}
          onNewChat={startNewChat}
          showDesktopNewChat={false}
          onOpenMobileSidebar={() => {
            closeDashboardTransientSurfaces("mobileSidebar");
            setMenuPane(null);
            settingsState.setMobileSidebarOpen(true);
          }}
          queryModeOptions={clinicalQueryModeOptions}
          queryInputRef={composerInputRef}
          queryInputAutoFocus={shouldAutoFocusComposer}
          recentQueries={recentQueries}
          onPickRecent={(recent) => {
            pickRecentQuery(recent);
            // setQuery has not landed yet, so the picked text is passed on; prescribing
            // already ran its medication search in pickRecentQuery.
            if (searchMode !== "prescribing") void ask(recent);
          }}
          onCrossModeSearch={crossModeSearch}
          /* The answer thread owns the follow-up questions now, as full-width
             rows above its library line (owner decision, 2026-08-26,
             "direction B"). The composer strip showed the same three questions
             again, a few hundred pixels lower and truncated to whatever fitted
             one scrolling line — which is the defect that argued for rows in
             the first place. One place, readable, not two. */
          composerFollowUpSuggestions={undefined}
          onPickComposerFollowUpSuggestion={handlePickFollowUpSuggestion}
          composerFollowUpSuggestionsDisabled={loading}
          showPhoneSuggestionTickerOnHome={heroOwnsPhoneComposer}
          sharedHomeIdentity={showSharedHome}
          searchComposerVisible={!toolsDirectoryWithoutComposer}
          composerPlaceholder={searchMode === "answer" && latestAnswerQuery ? "Ask a follow-up…" : undefined}
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
            // Idle phone homes stretch a column through this surface so the
            // cluster can flex-center in leftover space. Result views stay a
            // normal block scrollport.
            compactMobileModeHome && "max-sm:flex max-sm:flex-col",
            // Answer *results* keep the glass-header overlay pad at every width.
            // Answer *home* on phones uses the measured overlay token so it
            // cannot disagree with --phone-overlay-chrome-h after the stack
            // is published. sm+ answer home still uses the glass pad because
            // answer overlay is all-breakpoint.
            searchMode === "answer" && compactMobileModeHome
              ? "max-sm:pt-[var(--phone-overlay-chrome-h)] sm:pt-[calc(4rem+max(0.5rem,env(safe-area-inset-top)))] sm:[scroll-padding-top:calc(4.5rem+max(0.5rem,env(safe-area-inset-top)))]"
              : searchMode === "answer"
                ? "pt-[calc(4rem+max(0.5rem,env(safe-area-inset-top)))] [scroll-padding-top:calc(4.5rem+max(0.5rem,env(safe-area-inset-top)))]"
                : "max-sm:pt-[var(--phone-overlay-chrome-h)]",
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
          <h1 className="sr-only">{appModeDefinition(searchMode).label}</h1>
          {privateScopeStatus === "unavailable" ? (
            <PrivateScopeUnavailableAlert
              answerMode={searchMode === "answer"}
              onReselect={reselectUnavailablePrivateScope}
              onRunWithout={runWithoutUnavailablePrivateScope}
            />
          ) : null}
          <SearchCommandProvider value={searchCommandContextValue}>
            <div
              className={cn(
                // overflow-x-CLIP, not -hidden: hidden makes this wrapper a scroll
                // container (overflow-y computes to auto), which clips the composer's
                // command dropdown mid-panel and shows a phantom inner scrollbar.
                //
                // `sm:flex sm:min-h-full sm:flex-col` makes this the box the mode-home
                // canvas grows into. `#main-content` is a bounded scrollport with a
                // definite height at `sm`+, so `min-h-full` resolves against it exactly
                // — border-box, so this wrapper's own padding is inside the 100% and
                // cannot push the column past the scrollport. That is what lets the
                // canvas drop its `calc(100dvh - <estimate>)` floor (see
                // mode-home-canvas.ts) instead of guessing this padding, the desktop
                // composer slot and the space-y gap in one hard-coded number.
                "mx-auto max-w-7xl space-y-4 overflow-x-clip px-3 py-4 sm:flex sm:min-h-full sm:flex-col sm:space-y-5 sm:px-4 sm:py-5 lg:px-8",
                // Idle phone homes fill the already-padded <main> and centre
                // in that box. Extra py/space-y here double-counted overlay
                // chrome and manufactured a scrollbar.
                compactMobileModeHome &&
                  // Grow to fill leftover <main> space so the canvas can centre.
                  // `flex-1` (`1 1 0%`) still shrinks. Keep grow without shrink so
                  // a taller sibling (PWA scroll runway, late notices) overflows
                  // the standalone #main-content scrollport instead of collapsing.
                  "max-sm:flex max-sm:grow max-sm:shrink-0 max-sm:flex-col max-sm:space-y-0 max-sm:px-0 max-sm:py-0",
                searchMode === "answer"
                  ? compactMobileModeHome
                    ? "sm:pb-4"
                    : // The <main> reserve already clears the fixed composer dock on
                      // phones, so the old large mobile bottom padding only floated a
                      // long answer's last line high above the dock (and padded a short
                      // answer's empty space further). This stays far below that, but
                      // `pb-4` was the smallest tail in the app and left the last card
                      // sitting almost on the bottom edge once the dock scroll-hides
                      // and its reserve releases to zero. `pb-10` matches the
                      // `sm:pb-10` every other mode wrapper already uses. sm+/desktop
                      // keep the original generous padding.
                      "pb-10 sm:pb-36 lg:pb-40"
                  : hasMobileBottomSearch
                    ? compactMobileModeHome
                      ? "sm:pb-10 lg:pb-12"
                      : "pb-8 sm:pb-10 lg:pb-12"
                    : "pb-8 sm:pb-10 lg:pb-12",
              )}
            >
              <DashboardDesktopResultComposerSlot slotId={desktopResultComposerSlotId} />
              {showAnswerCancelledNotice ? (
                <AnswerCancelledNotice onRunAgain={() => void ask(answerLifecycle.query ?? query)} />
              ) : null}
              {actionNotice && (
                <InlineNotice tone={actionNotice.tone} onDismiss={() => setActionNotice(null)} animated>
                  {actionNotice.message}
                </InlineNotice>
              )}
              {searchMode === "documents" &&
              askTermsGate.declinedQuery &&
              askTermsGate.declinedQuery === query.trim() ? (
                <InlineNotice tone="info" onDismiss={askTermsGate.clearDeclined} animated>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="ask-terms-declined">
                    <span>{ASK_TERMS_DECLINED_NOTICE}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const declined = askTermsGate.declinedQuery;
                        if (declined) crossModeSearch("answer", declined);
                      }}
                    >
                      {ASK_TERMS_REVIEW_LABEL}
                    </Button>
                  </span>
                </InlineNotice>
              ) : null}
              {searchMode === "documents" && askTermsGate.signInQuery && askTermsGate.signInQuery === query.trim() ? (
                // Answer needs sign-in; its stillOpen line covers library search too, so the library card is skipped (#3728).
                <ClinicalSignInNotice
                  copy={CLINICAL_SIGN_IN_COPY.answer}
                  testId="answer-sign-in"
                  onSignedIn={() => {
                    const asked = askTermsGate.signInQuery;
                    askTermsGate.clearSignIn();
                    if (asked) crossModeSearch("answer", asked);
                  }}
                />
              ) : null}
              {askTermsGate.heldQuery !== null ? (
                <AskTermsStep
                  open
                  saving={askTermsGate.saving}
                  signedIn={askTermsGate.signedIn}
                  onAccept={() => void askTermsGate.accept()}
                  onNotNow={askTermsGate.notNow}
                />
              ) : null}
              <DegradedNoticeFrame visible={showDegradedNotice} isOnline={isOnline} reserveSpace={centeredModeHome} />
              {showSystemNotice && answer ? (
                <SystemNotice demoMode={demoMode} setupWarning={setupWarning} className="hidden sm:block" />
              ) : null}

              <section
                // Constrained 640–1919 first-paint top-align hook in globals.css.
                // Tall desktop canvases keep their default optical centring. Do
                // not restyle this from body:has(.pwa-notice-stack) — that caused CLS.
                data-mode-home-canvas={centeredModeHome || showSharedHome ? "true" : undefined}
                className={resolveModeHomeCanvasClass({
                  activeModeResultKind,
                  centeredModeHome,
                  compactMobileModeHome,
                  hasAnswer: Boolean(answer),
                  showSharedHome,
                })}
              >
                <h2 data-testid="answer-section-heading" className="sr-only">
                  {activeModeSearch.resultHeading}
                </h2>
                {/* Rendered above, at the top of the content column — see
                    `showAnswerCancelledNotice`. The condition stays here so the
                    chain below still short-circuits exactly as it did: a stopped
                    generation must not fall through into the no-results or error
                    empty states. */}
                {showAnswerCancelledNotice ? null : (
                  <DashboardSearchErrorState
                    error={error}
                    errorKind={errorKind}
                    activeModeResultKind={activeModeResultKind}
                    documentsResultsOwnError={documentsResultsOwnError}
                    lastFailedQuery={lastFailedQuery}
                    query={query}
                    onRephrase={() => focusComposerInput()}
                    onRetry={() => {
                      const retryQuery = lastFailedQuery ?? query;
                      setError(null);
                      void ask(retryQuery);
                    }}
                    onSearchDocuments={() => crossModeSearch("documents", (lastFailedQuery ?? query).trim())}
                  />
                )}

                {activeModeResultKind === "answer" &&
                (loading || answer) &&
                (hasCrisisWording(answerLifecycle.query ?? latestAnswerQuery) ||
                  hasOverdoseWording(answerLifecycle.query ?? latestAnswerQuery)) ? (
                  <AnswerCrisisBanner query={answerLifecycle.query ?? latestAnswerQuery} />
                ) : null}

                {matchedEmergencyProtocols.map((protocol) => (
                  <EmergencyProtocolBanner key={protocol.id} protocol={protocol} />
                ))}

                {searchMode !== "prescribing" &&
                  (activeModeResultKind === "answer" ? (
                    showAnswerProgress ? (
                      // The evidence preview is rendered by AnswerProgress rather than
                      // as a sibling panel below it. Two separate blocks in the answer's
                      // own position — a progress panel and an evidence panel — both
                      // vanished when the answer arrived; as one unit the rail simply
                      // stays and takes its numbers.
                      <AnswerProgress
                        events={answerProgressEvents}
                        startedAt={answerProgressStartedAt}
                        active={loading}
                        onStop={stopSearch}
                        evidencePreview={loading ? answerEvidencePreview : null}
                        question={loading ? (answerLifecycle.query ?? latestAnswerQuery) : null}
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

                {clinicalAskWorkspaceVisible(clinicalAskSession, clinicalAskMode) ? (
                  <ModeClinicalAskSurface
                    session={clinicalAskSession}
                    activeMode={clinicalAskMode}
                    searchMode={searchMode}
                    queryMode={queryMode}
                    scopeFilters={scopeFilters}
                    setDraft={setQuery}
                    setSearchSubmitted={setModeSearchSubmitted}
                    focusSearch={focusComposerInput}
                    onRun={runModeClinicalAsk}
                  />
                ) : showSharedHome ? (
                  // The one home surface, shared by every registered mode. It sits above every
                  // mode-specific branch so picking a mode on `/` changes only its
                  // presentation and composer target; mode-owned content stays behind
                  // its own route (/tools, /favourites, /dsm, …).
                  // One grid item, so a tall canvas cannot split the home and its line into two rows.
                  <div className="relative w-full">
                    {searchMode === "therapy-compass" ? (
                      <RegistryModeNav
                        modeId="therapy-compass"
                        activeId="search"
                        searchParamString={searchParams.toString()}
                      />
                    ) : null}
                    <SharedHomeEmptyState
                      modeId={searchMode}
                      desktopComposerSlotId={desktopHomeComposerSlotId}
                      recentQueries={recentQueries}
                      onSelectRecent={(recentQuery) => {
                        setQuery(recentQuery);
                        void ask(recentQuery);
                      }}
                    />
                    {/* Before the first question is sent: where an Answer question goes. Centred on the
                        Answer home (owner decision, 17 Oct 2026); PR #3605 centres the line under each
                        answer to match. It hangs below the home without taking layout space, so the
                        centred home and its composer sit in the same place in every mode. */}
                    {searchMode === "answer" && !clientDemoMode ? (
                      <AnswerProviderNotice className="absolute inset-x-0 top-full mt-2 justify-center px-4 text-center" />
                    ) : null}
                  </div>
                ) : activeModeResultKind === "differentials" ? (
                  <ClinicalCatalogueGate copy={CLINICAL_SIGN_IN_COPY.differentials} testId="differentials-sign-in">
                    <DifferentialsHome
                      // The results belong to the submitted search, not the unsent draft: the
                      // catalogue lookup would otherwise send every draft edit, unchecked for
                      // patient details, to /api/differentials.
                      query={submittedModeQuery ?? deferredQuery}
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
                  </ClinicalCatalogueGate>
                ) : searchMode === "tools" ? (
                  <ToolsHub query={deferredQuery} desktopComposerSlotId={desktopHomeComposerSlotId} />
                ) : activeModeResultKind === "favourites" && favouritesAccessible ? (
                  <FavouritesHub
                    query={deferredQuery}
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
                ) : activeModeResultKind === "documents" ||
                  activeModeResultKind === "services" ||
                  activeModeResultKind === "forms" ? (
                  searchMode === "prescribing" ? (
                    <ClinicalCatalogueGate copy={CLINICAL_SIGN_IN_COPY.medicines} testId="medications-sign-in">
                      <MedicationPrescribingWorkspace
                        query={deferredQuery}
                        loading={false}
                        realDataReady
                        authUnavailable={false}
                        apiUnavailable={false}
                        setupWarning={null}
                        onSuggestedSearch={setMedicationSearchQuery}
                        showHome={!modeSearchSubmitted}
                        desktopComposerSlotId={desktopHomeComposerSlotId}
                      />
                    </ClinicalCatalogueGate>
                  ) : (
                    <>
                      {searchMode === "documents" && clinicalToolAccess === "sign-in-required" ? (
                        askTermsGate.signInQuery && askTermsGate.signInQuery === query.trim() ? null : (
                          <ClinicalSignInNotice copy={CLINICAL_SIGN_IN_COPY.library} testId="library-sign-in" />
                        )
                      ) : (
                        <>
                          <DocumentSearchResultsPanel
                            matches={documentMatches}
                            recordMatches={recordSearchMatches}
                            recordMode={recordSearchMode}
                            recordStatus={recordStatus}
                            recordDegraded={recordsDegraded}
                            showRecordMatches={searchMode === "services" || searchMode === "forms"}
                            query={deferredQuery}
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
                            selectedDocumentIds={searchMode === "documents" ? selectedDocumentIds : []}
                            onDocumentFiltersApply={searchMode === "documents" ? handleDocumentFiltersApply : undefined}
                            showHome={searchMode === "documents" && !modeSearchSubmitted}
                            desktopComposerSlotId={desktopHomeComposerSlotId}
                            searchFailed={documentsSearchFailed}
                            searchFailureReason={documentsSearchFailed ? error : null}
                            onRetrySearch={
                              searchMode === "documents" && query.trim()
                                ? () => {
                                    setError(null);
                                    void ask(documentsSearchFailed ? (lastFailedQuery ?? query) : query);
                                  }
                                : undefined
                            }
                          />
                        </>
                      )}
                    </>
                  )
                ) : showAnswerPending ? (
                  // Only until the first progress event. From there AnswerProgress owns
                  // the whole wait — line, prose placeholder, sources, in the order the
                  // arrived answer uses — and rendering the skeleton here as well would
                  // put a second prose placeholder below its sources.
                  showAnswerProgress ? null : (
                    <AnswerSkeleton />
                  )
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
                        query={latestAnswerQuery ?? deferredQuery}
                        bestSource={bestSource}
                        sourceSummary={sourceSummary}
                        renderModel={answerRenderModel}
                        weakEvidence={weakEvidence}
                        sources={answerRenderModel.reviewSources}
                        demoMode={demoMode}
                        safetyFindings={safetyFindings}
                        copiedAnswer={copiedAction === "answer"}
                        pendingFeedback={pendingFeedback}
                        onCopyAnswer={handleCopyAnswer}
                        onSubmitFeedback={handleSubmitAnswerFeedback}
                        onFollowUpQuote={handleAnswerFollowUpQuote}
                        crossModeQueries={crossModeQueries}
                        onCrossModeSearch={handleCrossModeSearch}
                        followUpSuggestions={answerFollowUpSuggestions}
                        onPickFollowUpSuggestion={handleFollowUpSuggestionPick}
                        followUpSuggestionsDisabled={loading}
                        generating={loading}
                        onScopeDocument={handleScopeDocument}
                        restoredSavedAt={restoredAnswerSavedAt}
                        onRecheckAnswer={handleRecheckRestoredAnswer}
                        buildEvents={answerBuildEvents}
                      />
                      {/* Once per page, under the latest answer: where a question goes (audit S3). */}
                      {explicitDemoMode ||
                      answer.demoMode === true ||
                      answer.fallbackMode === "non_production_demo" ? null : (
                        <AnswerProviderNotice className="mt-1 justify-center text-center" />
                      )}
                      {/* Directly under it: the model could not write this answer (owner decision, 17 Oct 2026). */}
                      <AnswerSummaryUnavailableNotice answer={answer} />
                    </>
                  ) : null
                ) : null}

                {/* No mode-level "Also matches" under an answer. It sat directly
                    beneath the answer surface's own "Also in your library" and
                    asked the same question — where else does this appear — one
                    panel less specifically: this one names modes, that one names
                    the actual medication, factsheet or form inside them. Two
                    near-identical panels under one answer is what the owner
                    photographed on 2026-08-26. The mode-level view is still
                    reachable from mode navigation and still renders on the
                    tools, documents, services and forms result kinds above. */}
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
              {(settingsState.documentsDrawerOpen || settingsState.indexingAdminDrawerOpen) && (
                <section id="sources" className="mx-auto grid w-full max-w-4xl gap-3 scroll-mt-4 sm:scroll-mt-6">
                  <p className="px-1 pt-1 text-2xs font-bold uppercase tracking-kicker text-[color:var(--text-muted)]">
                    {drawerGroupTitle}
                  </p>
                  <DashboardDocumentsDrawer
                    open={settingsState.documentsDrawerOpen}
                    onOpenChange={handleDocumentsDrawerOpenChange}
                    title={documentsDrawerTitle}
                    summary={documentsDrawerSummary}
                    mobileSummary={documentsDrawerMobileSummary}
                    isAdmin={documentsDrawerIsAdmin}
                    returnFocusRef={documentsDrawerReturnFocusRef}
                    icon={DocumentsDrawerIcon}
                    indexedDocumentTotal={indexedDocumentTotal}
                    documents={documents}
                    libraryPdfDocuments={libraryPdfDocuments}
                    jobs={jobs}
                    batches={batches}
                    setupChecks={setupChecks}
                    dashboardDataLoading={dashboardDataLoading}
                    openLibraryHealthTarget={openLibraryHealthTarget}
                    documentsPagination={documentsPagination}
                    loadingMoreDocuments={loadingMoreDocuments}
                    documentsDrawerMode={settingsState.documentsDrawerMode}
                    selectedDocumentIds={selectedDocumentIds}
                    documentDrawerStatusFilter={documentDrawerStatusFilter}
                    toggleDocumentScope={toggleDocumentScope}
                    loadMoreDocuments={loadMoreDocuments}
                    handleDocumentRenamed={handleDocumentRenamed}
                    handleDocumentDeleted={handleDocumentDeleted}
                    bulkReindexSelected={bulkReindexSelected}
                    bulkAssignCollection={bulkAssignCollection}
                    bulkUpdateMetadata={bulkUpdateMetadata}
                    bulkActionStatus={bulkActionStatus}
                    bulkActionBusy={bulkActionBusy}
                    canManageDocuments={canUseAdministrativeApis}
                    handleTagSearch={handleTagSearch}
                    mutateDocumentLabel={mutateDocumentLabel}
                  />

                  {settingsState.indexingAdminDrawerOpen && canUseAdministrativeApis ? (
                    <IndexingAdminDrawer
                      open={settingsState.indexingAdminDrawerOpen}
                      onOpenChange={settingsState.setIndexingAdminDrawerOpen}
                      returnFocusRef={indexingAdminReturnFocusRef}
                      documents={documents}
                      jobs={jobs}
                      batches={batches}
                      setupChecks={setupChecks}
                      qualityItems={qualityItems}
                      dashboardDataLoading={dashboardDataLoading}
                      settingsState={settingsState}
                      indexingAdminUsesDesktopRegions={indexingAdminUsesDesktopRegions}
                      indexingMonitorFilter={indexingMonitorFilter}
                      indexingActionId={indexingActionId}
                      retryJob={retryJob}
                      reindexDocument={reindexDocument}
                      enrichDocument={enrichDocument}
                      openLibraryHealthTarget={openLibraryHealthTarget}
                      showAuthPanel={showAuthPanel}
                    />
                  ) : null}
                </section>
              )}

              {(settingsState.documentsDrawerOpen || settingsState.indexingAdminDrawerOpen) && (
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
        <DashboardSidebarDialogs
          guideOpen={settingsState.guideOpen}
          onCloseGuide={settingsGuideFlow.closeGuideWithRestore}
          settingsOpen={settingsState.settingsOpen}
          onCloseSettings={closeSettings}
          sidebarIdentity={sidebarIdentity}
          onSignOut={async () => {
            clinicalAskSession.clear();
            await auth.signOut();
          }}
          onOpenGuideFromSettings={settingsGuideFlow.openGuideFromSettings}
          onPrefetchGuide={loadGuideDialog}
          settingsInitialFocus={settingsGuideFlow.settingsInitialFocus}
          accountSetupOpen={accountSetupOpen}
          onCloseAccountSetup={closeAccountSetup}
          accountSetupIntent={accountSetupIntent}
        />
        {twoPaneSideMenu ? (
          <TwoPaneSideMenuHost
            open={settingsState.mobileSidebarOpen}
            onOpenChange={settingsState.setMobileSidebarOpen}
            identity={sidebarIdentity}
            startSide="clinical"
            openPane={menuPane}
            workAvailable={newWorkMode}
            currentArea={null}
            activeMode={searchMode}
            recentQueries={recentQueries}
            showAccountLibrary={favouritesAccessible}
            onNewChat={startNewChat}
            onPickRecent={pickRecentQuery}
            onSelectMode={selectSearchMode}
            onPrefetchApplications={prefetchApplications}
            onOpenSettings={settingsGuideFlow.openSettingsWithDefaultFocus}
            onOpenAccount={settingsGuideFlow.openAccountProfileWithDefaultFocus}
            onSignOut={async () => {
              clinicalAskSession.clear();
              await auth.signOut();
            }}
          />
        ) : (
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
            onOpenSearch={openSidebarSearch}
            onSelectMode={selectSearchMode}
            showAccountLibrary={favouritesAccessible}
          />
        )}
      </PhoneFooterLayerFrame>
    </div>
  );
}
