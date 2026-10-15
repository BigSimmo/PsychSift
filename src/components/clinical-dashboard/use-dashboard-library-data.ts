"use client";

import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  hasActiveIndexingWork,
  isAbortError,
  mergeDocumentRefresh,
  setupNeedsSlowRecheck,
  setupRecheckPollMs,
  shorterPollDelay,
} from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import {
  activeIndexingPollFallbackMs,
  documentPageSize,
  indexingWorkDetailsPollMs,
  type BatchesPayload,
  type DocumentsPayload,
  type IngestionQualityPayload,
  type JobsPayload,
  type RefreshOptions,
  type SetupStatusPayload,
} from "@/components/clinical-dashboard/clinical-dashboard-payloads";
import { type DocumentPagination } from "@/components/clinical-dashboard/dashboard-contracts";
import {
  fallbackSetupChecks,
  type IngestionQualityReviewItem,
  type SetupCheck,
} from "@/components/clinical-dashboard/document-manager-contracts";
import { isDeployedClinicalKb } from "@/lib/deployed-app";
import { readLocalProjectIdentity, unsafeLocalProjectMessage } from "@/lib/local-project-identity";
import type { ClinicalDocument, ImportBatch, IngestionJob } from "@/lib/types";
import { shouldPollForUpdates } from "@/lib/ward-output";

/*
 * The source library behind the clinical dashboard: the document list, the
 * indexing jobs, import batches and quality items, and the setup and polling
 * loop that keeps them current. Split out of ClinicalDashboard so that screen
 * holds search and answer state only. Behaviour is unchanged.
 */

/** The library's state. Call once, early, so the sign-out reset can clear it. */
export function useDashboardLibraryState() {
  const refreshInFlightRef = useRef<{
    epoch: number;
    dataScope: number;
    promise: Promise<void>;
  } | null>(null);
  const dashboardDataLoadedRef = useRef(false);
  const administrationDataLoadedRef = useRef(false);
  const nextWorkStatePollRef = useRef(0);
  const [documents, setDocuments] = useState<ClinicalDocument[]>([]);
  const documentsRef = useRef(documents);
  const [documentsPagination, setDocumentsPagination] = useState<DocumentPagination | null>(null);
  const [dashboardDataLoading, setDashboardDataLoading] = useState(false);
  const [loadingMoreDocuments, setLoadingMoreDocuments] = useState(false);
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [qualityItems, setQualityItems] = useState<IngestionQualityReviewItem[]>([]);
  const jobsRef = useRef(jobs);
  const batchesRef = useRef(batches);
  const [indexingActive, setIndexingActive] = useState(false);
  const [userStartedIngestion, setUserStartedIngestion] = useState(false);
  const [nextRefreshDelayMs, setNextRefreshDelayMs] = useState<number | null>(null);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    batchesRef.current = batches;
  }, [batches]);

  /** Empties the document, job, batch and quality lists. */
  const clearLibraryLists = useCallback(() => {
    setDocuments([]);
    setDocumentsPagination(null);
    setJobs([]);
    setBatches([]);
    setQualityItems([]);
  }, []);

  /** Clears everything the signed-in user loaded, on sign out or expiry. */
  const resetForSignOut = useCallback(() => {
    refreshInFlightRef.current = null;
    clearLibraryLists();
    dashboardDataLoadedRef.current = false;
    administrationDataLoadedRef.current = false;
    setUserStartedIngestion(false);
  }, [clearLibraryLists]);

  return {
    refreshInFlightRef,
    dashboardDataLoadedRef,
    administrationDataLoadedRef,
    nextWorkStatePollRef,
    documents,
    setDocuments,
    documentsRef,
    documentsPagination,
    setDocumentsPagination,
    dashboardDataLoading,
    setDashboardDataLoading,
    loadingMoreDocuments,
    setLoadingMoreDocuments,
    jobs,
    setJobs,
    jobsRef,
    batches,
    setBatches,
    batchesRef,
    qualityItems,
    setQualityItems,
    indexingActive,
    setIndexingActive,
    userStartedIngestion,
    setUserStartedIngestion,
    nextRefreshDelayMs,
    setNextRefreshDelayMs,
    clearLibraryLists,
    resetForSignOut,
  };
}

export type DashboardLibraryState = ReturnType<typeof useDashboardLibraryState>;

type DashboardLibraryRefreshOptions = {
  library: DashboardLibraryState;
  authEpoch: number;
  authStatus: string;
  authorizationHeader: Record<string, string> | undefined;
  authBoundFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<{ response: Response; requestEpoch: number }>;
  registerAuthRequest: (controller: AbortController) => { epoch: number; release: () => void };
  isAuthEpochCurrent: (epoch: number) => boolean;
  markSessionExpired: () => void;
  canUsePrivateApis: boolean;
  clientDemoMode: boolean;
  demoMode: boolean;
  setupChecks: SetupCheck[];
  setSetupChecks: Dispatch<SetStateAction<SetupCheck[]>>;
  setSetupWarning: Dispatch<SetStateAction<string | null>>;
  setDemoMode: Dispatch<SetStateAction<boolean>>;
  setApiUnavailable: Dispatch<SetStateAction<boolean>>;
  setLocalProjectReady: Dispatch<SetStateAction<boolean>>;
  /** A drawer that shows the document list is open. */
  dashboardDataSurfaceVisible: boolean;
  /** A drawer that shows indexing jobs, batches or quality items is open, and the user may see it. */
  administrationSurfaceVisible: boolean;
};

/** Loads and polls the library. Returns the loaders and whether indexing work is still running. */
export function useDashboardLibraryRefresh({
  library,
  authEpoch,
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
}: DashboardLibraryRefreshOptions) {
  const {
    refreshInFlightRef,
    dashboardDataLoadedRef,
    administrationDataLoadedRef,
    nextWorkStatePollRef,
    documents,
    setDocuments,
    documentsRef,
    documentsPagination,
    setDocumentsPagination,
    setDashboardDataLoading,
    loadingMoreDocuments,
    setLoadingMoreDocuments,
    jobs,
    setJobs,
    jobsRef,
    batches,
    setBatches,
    batchesRef,
    setQualityItems,
    indexingActive,
    setIndexingActive,
    userStartedIngestion,
    setUserStartedIngestion,
    nextRefreshDelayMs,
    setNextRefreshDelayMs,
    clearLibraryLists,
  } = library;

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
          clearLibraryLists();
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
          clearLibraryLists();
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
          clearLibraryLists();
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
      administrationDataLoadedRef,
      authEpoch,
      authorizationHeader,
      batchesRef,
      canUsePrivateApis,
      clearLibraryLists,
      clientDemoMode,
      dashboardDataLoadedRef,
      documentsRef,
      isAuthEpochCurrent,
      jobsRef,
      markSessionExpired,
      nextWorkStatePollRef,
      refreshInFlightRef,
      registerAuthRequest,
      setApiUnavailable,
      setBatches,
      setDashboardDataLoading,
      setDemoMode,
      setDocuments,
      setDocumentsPagination,
      setIndexingActive,
      setJobs,
      setLocalProjectReady,
      setNextRefreshDelayMs,
      setQualityItems,
      setSetupChecks,
      setSetupWarning,
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
    setApiUnavailable,
    setDocuments,
    setDocumentsPagination,
    setLoadingMoreDocuments,
  ]);

  const activeIndexingWork = useMemo(
    () => hasActiveIndexingWork(documents, jobs, batches, indexingActive),
    [documents, jobs, batches, indexingActive],
  );
  const needsSetupRecheck = useMemo(() => setupNeedsSlowRecheck(setupChecks), [setupChecks]);

  useEffect(() => {
    dashboardDataLoadedRef.current = false;
    administrationDataLoadedRef.current = false;
  }, [administrationDataLoadedRef, authEpoch, dashboardDataLoadedRef]);

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
  }, [
    administrationDataLoadedRef,
    administrationSurfaceVisible,
    authEpoch,
    dashboardDataLoadedRef,
    dashboardDataSurfaceVisible,
    refresh,
  ]);

  useEffect(() => {
    if (!userStartedIngestion || !dashboardDataLoadedRef.current || activeIndexingWork) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setUserStartedIngestion(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeIndexingWork, dashboardDataLoadedRef, setUserStartedIngestion, userStartedIngestion]);

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

  return { refresh, loadMoreDocuments, activeIndexingWork };
}
