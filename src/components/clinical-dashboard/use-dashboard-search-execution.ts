"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import type { useRouter } from "next/navigation";

import type { AnswerProgressUpdate, TimedAnswerProgressUpdate } from "@/components/clinical-dashboard/answer-progress";
import { requestAnswerStream } from "@/components/clinical-dashboard/answer-request";
import type { AnswerTurn } from "@/components/clinical-dashboard/answer-thread-turn";
import {
  compactScopeFilters,
  isAbortError,
  releaseOwnedAbortController,
  replaceOwnedAbortController,
  resultUsable,
} from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import type {
  SearchResultModePayload,
  SourceLibrarySearchMode,
} from "@/components/clinical-dashboard/clinical-dashboard-payloads";
import type { SearchFacets } from "@/components/clinical-dashboard/document-search-results";
import { scrollSurface } from "@/components/clinical-dashboard/scroll-surface";
import {
  classifyAnswerError,
  createAnswerRequestWatchdog,
  createSearchRequestDeadline,
  keywordQueryFromNaturalLanguage,
  makeSearchError,
  progressForRetry,
  searchRetryCount,
  searchRetryDelaysMs,
  searchTimedOutMessage,
  shouldRetryFailedAttempt,
  sleep,
  type AnswerErrorKind,
  type AnswerPayload,
  type SearchError,
  SEARCH_SESSION_EXPIRED_MESSAGE,
} from "@/components/clinical-dashboard/search-utils";
import type { AnswerThreadSnapshotMetadata } from "@/components/clinical-dashboard/use-persisted-answer-thread";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import type { ClientDocumentMatch, ClientSearchResult } from "@/lib/answer-client-payload";
import { buildAnswerFollowUpQuery } from "@/lib/answer-follow-up";
import type { answerLifecycleReducer } from "@/lib/answer-lifecycle";
import type { VerifiedEvidencePreviewUnit } from "@/lib/answer-stream-contract";
import { createAnswerThreadSnapshotMetadata, maxStoredAnswerTurns } from "@/lib/answer-thread-storage";
import { appModeHomeHref, appModeQueryMode, appModeSearchConfig, type AppModeId } from "@/lib/app-modes";
import { incrementalEvidencePreviewRenderingEnabled } from "@/lib/client-env";
import { isDeployedClinicalKb } from "@/lib/deployed-app";
import { documentsSearchHref } from "@/lib/document-flow-routes";
import { persistPrivateSearchScope } from "@/lib/private-search-scope";
import { resolveScrollBehavior } from "@/lib/scroll-behavior";
import { searchSubmissionSignature, type SearchNavigationContext } from "@/lib/search-navigation-context";
import { isDashboardModeHref } from "@/lib/search-route-ownership";
import type { SearchScopeFilters } from "@/lib/search-scope";
import type { SourceGovernanceWarning } from "@/lib/source-governance";
import { errorCopy } from "@/lib/ui-copy";
import type {
  ClinicalQueryMode,
  DocumentMatch,
  EvidenceRelevance,
  SearchResult,
  SearchScopeSummary,
} from "@/lib/types";
import type { AnswerViewMode } from "@/lib/ward-output";

// Loaded on the first Answer question rather than with the page (bundle budget, 2026-10-13).
function loadClinicalQuestionPatientCheck() {
  return import("@/lib/clinical-question-patient-check");
}

// A question is never sent unchecked: when the check cannot load (a dropped connection),
// Ask stops with this and the next Ask tries the download again.
const PATIENT_CHECK_UNAVAILABLE =
  "Could not check your question for patient details. Check your connection and try again.";

type DashboardActionNotice = { tone: "success" | "warning"; message: string };

type DashboardSearchExecutionDeps = {
  router: ReturnType<typeof useRouter>;
  auth: { session: { user: { id: string } } | null };
  query: string;
  searchMode: AppModeId;
  queryMode: ClinicalQueryMode;
  requestQueryMode: ClinicalQueryMode;
  scopeFilters: SearchScopeFilters;
  selectedDocumentIds: string[];
  clientDemoMode: boolean;
  authorizationHeader: Record<string, string>;
  canRunSearch: boolean;
  mainRef: RefObject<HTMLElement | null>;
  searchRequestSeqRef: RefObject<number>;
  searchAbortRef: RefObject<AbortController | null>;
  answerTimedOutRef: RefObject<boolean>;
  answerProgressEventsRef: RefObject<TimedAnswerProgressUpdate[]>;
  latestAnswerTurnRef: RefObject<Omit<AnswerTurn, "id"> | null>;
  latestAnswerSnapshotMetadataRef: RefObject<AnswerThreadSnapshotMetadata | null>;
  answerTurnSeqRef: RefObject<number>;
  autoRunSearchSignatureRef: RefObject<string | null>;
  modeChangeFromUiRef: RefObject<boolean>;
  markSessionExpired: () => void;
  registerAuthRequest: (controller: AbortController) => { epoch: number; release: () => void };
  isAuthEpochCurrent: (epoch: number) => boolean;
  rememberRecentQuery: (query: string) => void;
  resetAnswerThread: () => void;
  clearModeResultState: () => void;
  setModeSearchSubmitted: (submitted: boolean, query?: string) => void;
  dispatchAnswerLifecycle: Dispatch<Parameters<typeof answerLifecycleReducer>[1]>;
  setSearchMode: Dispatch<SetStateAction<AppModeId>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setAnswer: Dispatch<SetStateAction<AnswerPayload | null>>;
  setSources: Dispatch<SetStateAction<ClientSearchResult[]>>;
  setDocumentMatches: Dispatch<SetStateAction<ClientDocumentMatch[]>>;
  setPriorAnswerTurns: Dispatch<SetStateAction<AnswerTurn[]>>;
  setLatestAnswerQuery: Dispatch<SetStateAction<string | null>>;
  setSetupBlockedQuery: Dispatch<SetStateAction<string | null>>;
  setCollapsedTurnIds: Dispatch<SetStateAction<Set<string>>>;
  setSearchRelevance: Dispatch<SetStateAction<EvidenceRelevance | null>>;
  setSearchFacets: Dispatch<SetStateAction<SearchFacets | null>>;
  setSearchScope: Dispatch<SetStateAction<SearchScopeSummary | null>>;
  setSourceGovernanceWarnings: Dispatch<SetStateAction<SourceGovernanceWarning[]>>;
  setDifferentialEvidenceQuery: Dispatch<SetStateAction<string | null>>;
  setAnswerViewMode: Dispatch<SetStateAction<AnswerViewMode>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setAnswerProgress: Dispatch<SetStateAction<string | null>>;
  setAnswerProgressEvents: Dispatch<SetStateAction<TimedAnswerProgressUpdate[]>>;
  setAnswerBuildEvents: Dispatch<SetStateAction<TimedAnswerProgressUpdate[]>>;
  setAnswerProgressStartedAt: Dispatch<SetStateAction<number | null>>;
  setAnswerEvidencePreview: Dispatch<SetStateAction<VerifiedEvidencePreviewUnit | null>>;
  setRestoredAnswerSavedAt: Dispatch<SetStateAction<number | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setErrorKind: Dispatch<SetStateAction<AnswerErrorKind | null>>;
  setLastFailedQuery: Dispatch<SetStateAction<string | null>>;
  setDemoMode: Dispatch<SetStateAction<boolean>>;
  setActionNotice: Dispatch<SetStateAction<DashboardActionNotice | null>>;
};

/**
 * The dashboard's search execution: the source-library and answer requests, the retry loop, Stop,
 * the result commit and `executeSearch` itself, moved verbatim out of ClinicalDashboard. It calls no
 * React hooks. The dashboard calls it on every render with that render's state, so each returned
 * function closes over exactly the values the inline declarations did.
 */
export function useDashboardSearchExecution(deps: DashboardSearchExecutionDeps) {
  const {
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
  } = deps;

  function searchNetworkFailure(label: string) {
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    const origin = typeof window !== "undefined" ? window.location.origin : "PsychSift";
    return makeSearchError(
      offline
        ? `${label} could not run because the browser is offline.`
        : isDeployedClinicalKb()
          ? `${label} could not reach PsychSift at ${origin}. Check your connection and try again shortly.`
          : `${label} could not reach PsychSift at ${origin}. The local server may still be starting or restarting; retry shortly or run npm run ensure.`,
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
    // Without this deadline a slow /api/search holds the "Searching…" band forever, with no
    // notice and no error, so the reader cannot tell a slow search from a broken one (#X42YJ1).
    // It stays armed through the body read, because a response that never finishes streaming
    // hangs exactly as visibly as one that never arrives.
    const slowNotice = "Still searching. This is taking longer than usual.";
    let noticed = false;
    const deadline = createSearchRequestDeadline({
      signal,
      onSlow: () => {
        noticed = true;
        setAnswerProgress(slowNotice);
      },
    });
    try {
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
          signal: deadline.signal,
        });
      } catch (error) {
        // A timeout is OUR abort, so it must surface. A caller abort is the user stopping or a
        // newer query superseding this one, which stays silent. Not retryable: three more 45 s
        // attempts against a busy service is a worse experience than one honest failure.
        if (deadline.timedOut) throw makeSearchError(searchTimedOutMessage(searchLabel), undefined, false);
        if (isAbortError(error)) throw error;
        throw searchNetworkFailure(searchLabel);
      }

      if (response.status === 401) {
        markSessionExpired();
        throw makeSearchError(SEARCH_SESSION_EXPIRED_MESSAGE, 401, false);
      }
      if (!response.ok) {
        throw await parseApiErrorResponse(response);
      }
      let payload: {
        results?: SearchResult[];
        documentMatches?: DocumentMatch[];
        relevance?: EvidenceRelevance;
        facets?: SearchFacets;
        scope?: SearchScopeSummary;
        sourceGovernanceWarnings?: SourceGovernanceWarning[];
        demoMode?: boolean;
      };
      try {
        payload = await response.json();
      } catch (error) {
        if (deadline.timedOut) throw makeSearchError(searchTimedOutMessage(searchLabel), undefined, false);
        if (isAbortError(error)) throw error;
        throw searchNetworkFailure(searchLabel);
      }
      if (payload.demoMode) setDemoMode(true);

      return {
        kind: "documents" as const,
        query: queryText,
        sources: payload.results ?? [],
        documentMatches: payload.documentMatches ?? [],
        relevance: payload.relevance,
        facets: payload.facets,
        scope: payload.scope,
        sourceGovernanceWarnings: payload.sourceGovernanceWarnings,
        demoMode: payload.demoMode,
      };
    } finally {
      deadline.cancel();
      // Clear only this request's own notice, by value. A superseded search settles its abort
      // AFTER the replacing search has installed its progress message, so an unconditional
      // clear here would blank the banner of a request that is still running. Comparing the
      // message means a newer owner of the banner keeps it.
      if (noticed) setAnswerProgress((current) => (current === slowNotice ? null : current));
    }
  }

  function requestAnswer(
    queryText: string,
    filtersOverride: SearchScopeFilters = scopeFilters,
    queryModeOverride: ClinicalQueryMode = requestQueryMode,
    onProgress: (progress: AnswerProgressUpdate) => void,
    onEvidencePreview: (preview: VerifiedEvidencePreviewUnit | null) => void,
    signal?: AbortSignal,
    onStreamActivity?: () => void,
  ) {
    return requestAnswerStream({
      queryText,
      filters: filtersOverride,
      queryMode: queryModeOverride,
      selectedDocumentIds,
      clientDemoMode,
      authorizationHeader,
      onProgress,
      onEvidencePreview,
      signal,
      onStreamActivity,
      timedOut: () => answerTimedOutRef.current,
      onSessionExpired: markSessionExpired,
      networkFailure: () => searchNetworkFailure("Answer search"),
    });
  }

  async function runWithRetries<T>(
    operation: () => Promise<T>,
    onProgress: (message: string) => void = setAnswerProgress,
    signal?: AbortSignal,
  ) {
    let lastError: unknown;
    for (let attempt = 0; attempt <= searchRetryCount; attempt += 1) {
      const attemptStartedAt = Date.now();
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!shouldRetryFailedAttempt(error, Date.now() - attemptStartedAt) || attempt >= searchRetryCount) break;

        const message = progressForRetry(attempt + 1);
        onProgress(message);
        const requestedDelay = (error as SearchError).retryAfterMs ?? 0;
        const defaultDelay = searchRetryDelaysMs[attempt] ?? searchRetryDelaysMs[searchRetryDelaysMs.length - 1];
        await sleep(Math.max(defaultDelay, requestedDelay), signal);
      }
    }
    throw lastError;
  }

  function stopSearch() {
    searchRequestSeqRef.current += 1;
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setLoading(false);
    setAnswerProgress(null);
    setAnswerProgressEvents([]);
    answerProgressEventsRef.current = [];
    setAnswerProgressStartedAt(null);
    setAnswerEvidencePreview(null);
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
      resolvedQuery: payload.query,
      answer: answerData,
      sources: answerData.sources ?? [],
    };
    setLatestAnswerQuery(committedQuery);
    setAnswer(answerData);
    setSources(answerData.sources ?? []);
    setSearchRelevance(answerData.relevance ?? null);
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
    const isDifferentialsMode = modeSearch.resultKind === "differentials";
    const isAnswerRequest = modeSearch.resultKind === "answer";
    // Document and differentials search text is embedded by the same overseas AI service as
    // Answer, so it gets the same patient-detail check (repository audit F-01). /api/search
    // refuses it again.
    const sendsQueryToProvider =
      isAnswerRequest || modeSearch.kind === "documents" || modeSearch.kind === "differentials";
    if (sendsQueryToProvider) {
      // A mode switch, Stop or newer search while the check loads makes this submission stale.
      const submittedSeq = searchRequestSeqRef.current;
      const patientCheck = await loadClinicalQuestionPatientCheck().catch(() => null);
      if (submittedSeq !== searchRequestSeqRef.current) return;
      if (!patientCheck) {
        setActionNotice({ tone: "warning", message: PATIENT_CHECK_UNAVAILABLE });
        return;
      }
      const patientDetail = patientCheck.clinicalQuestionPatientDetail(trimmedQuery);
      if (patientDetail) {
        setActionNotice({ tone: "warning", message: patientCheck.clinicalQuestionPatientDetailMessage(patientDetail) });
        return;
      }
    }
    const targetQueryMode = appModeQueryMode(targetMode, queryModeOverride);
    const privateScopeRef =
      scopeRefOverride ??
      (selectedDocumentIds.length > 0 && auth.session?.user.id
        ? (persistPrivateSearchScope(window.sessionStorage, auth.session.user.id, selectedDocumentIds) ?? undefined)
        : undefined);
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
    if (targetMode !== "tools") setModeSearchSubmitted(true, trimmedQuery);
    if (isDifferentialsMode) clearModeResultState();

    if (targetMode === "tools") {
      setLoading(false);
      setAnswerProgress(null);
      setError(null);
      rememberRecentQuery(trimmedQuery);
      setActionNotice({ tone: "success", message: "Tools filtered from the composer." });
      return;
    }
    if (modeSearch.kind === "tools") {
      const destination = appModeHomeHref(targetMode, { query: trimmedQuery, run: true });
      if (!isDashboardModeHref(destination)) {
        setLoading(false);
        setAnswerProgress(null);
        setError(null);
        rememberRecentQuery(trimmedQuery);
        router.push(destination);
        return;
      }
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
    setSetupBlockedQuery(null);
    if (!canRunSearch) {
      if (isAnswerRequest) setSetupBlockedQuery(trimmedQuery);
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
      // Work from the ref, not a lazy updater: the stream sends "complete" just before it returns
      // the final payload, and the accepted answer copies this ref before React renders again.
      const current = answerProgressEventsRef.current;
      const latest = current.at(-1);
      if (
        latest?.stage === progress.stage &&
        latest.message === progress.message &&
        latest.resultCount === progress.resultCount &&
        latest.selectedContextCount === progress.selectedContextCount &&
        latest.australianSourceCount === progress.australianSourceCount &&
        latest.waSourceCount === progress.waSourceCount
      ) {
        return;
      }
      const next = [...current, { ...progress, receivedAt: Date.now() }].slice(-16);
      answerProgressEventsRef.current = next;
      setAnswerProgressEvents(next);
    };
    const onAnswerEvidencePreview = (preview: VerifiedEvidencePreviewUnit | null) => {
      if (!requestIsCurrent()) return;
      setAnswerEvidencePreview(incrementalEvidencePreviewRenderingEnabled() ? preview : null);
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
    setAnswerEvidencePreview(null);
    setAnswerViewMode("high_yield");
    if (isAnswerRequest) {
      const startedAt = Date.now();
      setAnswerProgressStartedAt(startedAt);
      const initialProgressEvents = [
        {
          stage: "scoping" as const,
          message: "Preparing the clinical search scope.",
          receivedAt: startedAt,
        },
      ];
      answerProgressEventsRef.current = initialProgressEvents;
      setAnswerProgressEvents(initialProgressEvents);
      setAnswerProgress("Preparing the clinical search scope.");
    } else {
      setAnswerProgressStartedAt(null);
      answerProgressEventsRef.current = [];
      setAnswerProgressEvents([]);
      onProgress(modeSearch.progressLabel);
    }
    rememberRecentQuery(trimmedQuery);

    // Answer-mode follow-ups: the API takes a single query string, so a short
    // ambiguous follow-up ("what about renal impairment?") is wrapped with the
    // previous turn's question before retrieval. The raw text the user typed
    // is what the thread displays (via displayQuery below).
    if (isAnswerRequest) dispatchAnswerLifecycle({ type: "start", query: trimmedQuery });
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
      const priorTurnQuery =
        isAnswerRequest && !replaceExistingAnswer
          ? (latestAnswerTurnRef.current?.resolvedQuery ?? latestAnswerTurnRef.current?.query)
          : undefined;
      const isAnswerFollowUp = isAnswerRequest && Boolean(priorTurnQuery);
      const requestQuery = isAnswerRequest ? buildAnswerFollowUpQuery(priorTurnQuery, trimmedQuery) : trimmedQuery;

      const fallbackQuery = isAnswerRequest ? "" : keywordQueryFromNaturalLanguage(requestQuery);
      const queryPlan =
        fallbackQuery && fallbackQuery !== requestQuery
          ? [
              { query: requestQuery, isKeyword: false },
              { query: fallbackQuery, isKeyword: true },
            ]
          : [{ query: requestQuery, isKeyword: false }];

      let successfulPayload: SearchResultModePayload | null = null;
      let lastError: SearchError | null = null;
      // An empty source-library search is a RESULT, not a failure: the payload
      // carries the `scope`/`sourceGovernanceWarnings` explaining WHY it is
      // empty, and the 404 sentinel discarded them. See `scopeFilterChips`.
      let emptySourceLibraryPayload: SearchResultModePayload | null = null;

      for (const entry of queryPlan) {
        if (entry.isKeyword) {
          if (isAnswerRequest) onAnswerProgress({ stage: "retrieving", message: "Trying keyword-based search…" });
          else onProgress("Trying keyword-based search…");
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
                  () => {
                    onAnswerEvidencePreview(null);
                    return requestAnswer(
                      entry.query,
                      filtersOverride,
                      targetQueryMode,
                      onAnswerProgress,
                      onAnswerEvidencePreview,
                      abortController.signal,
                      answerWatchdog.touch,
                    );
                  },
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
          setRestoredAnswerSavedAt(null);
          latestAnswerSnapshotMetadataRef.current = createAnswerThreadSnapshotMetadata(
            searchSubmissionSignature(targetMode, trimmedQuery, {
              queryMode: targetQueryMode,
              scopeFilters: filtersOverride,
              scopeRef: privateScopeRef,
            }),
          );
        }
        if (successfulPayload.kind === "answer") {
          // Keep the history that produced the accepted answer. A later failed
          // request may replace the active progress events without replacing
          // the answer shown on screen.
          setAnswerBuildEvents(answerProgressEventsRef.current);
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
    setModeSearchSubmitted(true, trimmedSearchText);
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
    // A Clinical question goes to an overseas AI service. One that looks like it holds a patient
    // detail is not sent, saved as a recent question or written into the address bar (audit S2,
    // 2026-10-13). The composer already disables Ask for it; this covers every other way in
    // (a link with ?run=1, a recent question). The answer API refuses it again.
    if (searchMode === "answer" && trimmedQuery) {
      const submittedSeq = searchRequestSeqRef.current;
      const patientCheck = await loadClinicalQuestionPatientCheck().catch(() => null);
      if (submittedSeq !== searchRequestSeqRef.current) return;
      if (!patientCheck) {
        setActionNotice({ tone: "warning", message: PATIENT_CHECK_UNAVAILABLE });
        return;
      }
      const patientDetail = patientCheck.clinicalQuestionPatientDetail(trimmedQuery);
      if (patientDetail) {
        setActionNotice({ tone: "warning", message: patientCheck.clinicalQuestionPatientDetailMessage(patientDetail) });
        return;
      }
    }
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
      window.history[replaceExistingAnswer ? "replaceState" : "pushState"](
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

  return {
    stopSearch,
    applySearchResult,
    executeSearch,
    requestSourceLibrarySearch,
    runWithRetries,
    setMedicationSearchQuery,
    ask,
  };
}
