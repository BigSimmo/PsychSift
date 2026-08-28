"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import { authSessionFingerprint, createAuthRequestLifecycle } from "@/lib/auth-request-lifecycle";
import type { DifferentialDetailContext } from "@/lib/differential-detail";
import type { DifferentialSourceStatus, DifferentialValidationStatus } from "@/lib/differential-records";
import type { DifferentialPresentationWorkflow, DifferentialRecord } from "@/lib/differentials";
import { useAuthSession } from "@/lib/supabase/client";

export type DifferentialSearchMatches = {
  diagnoses: Array<{ record: DifferentialRecord; score: number; reasons: string[] }>;
  presentations: Array<{ workflow: DifferentialPresentationWorkflow; score: number; reasons: string[] }>;
};

export type DifferentialSearchState = {
  status: "loading" | "refetching" | "ready" | "unauthorized" | "error";
  matches: DifferentialSearchMatches;
  demoMode: boolean;
};

const emptyDifferentialMatches: DifferentialSearchMatches = { diagnoses: [], presentations: [] };

export type DifferentialRecordGovernance = {
  sourceStatus: DifferentialSourceStatus;
  validationStatus: DifferentialValidationStatus;
};

export type DifferentialRequestStatus = "loading" | "ready" | "unauthorized" | "not_found" | "unavailable" | "error";

export type DifferentialRecordState = {
  status: DifferentialRequestStatus;
  record: DifferentialRecord | null;
  /** Catalog context computed atomically with the returned record. */
  detailContext: DifferentialDetailContext | null;
  demoMode: boolean;
  governance: DifferentialRecordGovernance | null;
};

export type DifferentialPresentationState = {
  status: DifferentialRequestStatus;
  workflow: DifferentialPresentationWorkflow | null;
  candidates: DifferentialPresentationCandidate[];
  demoMode: boolean;
  governance: DifferentialRecordGovernance | null;
};

export type DifferentialPresentationCandidate = DifferentialPresentationWorkflow["candidates"][number] & {
  record: DifferentialRecord;
};

const emptyDifferentialPresentationState: DifferentialPresentationState = {
  status: "loading",
  workflow: null,
  candidates: [],
  demoMode: false,
  governance: null,
};

/** Match universal / medication catalogue debounce so live composer follow coalesces. */
const debounceMs = 250;
const resultCacheMax = 50;
const resultCacheTtlMs = 5 * 60 * 1000;

type DifferentialSearchCacheEntry = {
  matches: DifferentialSearchMatches;
  demoMode: boolean;
  expiresAt: number;
};

// Module-scoped LRU so backspace/retype resolves instantly. Auth signature is part of
// the key so one identity's cached results are never served to another.
const differentialSearchCache = new Map<string, DifferentialSearchCacheEntry>();

function differentialCacheKey(requestKey: string, authSignature: string) {
  return JSON.stringify([authSignature, requestKey]);
}

function peekDifferentialCache(key: string): DifferentialSearchCacheEntry | undefined {
  const cached = differentialSearchCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    differentialSearchCache.delete(key);
    return undefined;
  }
  return cached;
}

function touchDifferentialCache(key: string) {
  const cached = differentialSearchCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) differentialSearchCache.delete(key);
    return;
  }
  differentialSearchCache.delete(key);
  differentialSearchCache.set(key, cached);
}

function writeDifferentialCache(key: string, value: Omit<DifferentialSearchCacheEntry, "expiresAt">) {
  differentialSearchCache.delete(key);
  differentialSearchCache.set(key, { ...value, expiresAt: Date.now() + resultCacheTtlMs });
  if (differentialSearchCache.size > resultCacheMax) {
    const oldest = differentialSearchCache.keys().next().value;
    if (oldest !== undefined) differentialSearchCache.delete(oldest);
  }
}

/** Test-only: clear the module-scoped differential search LRU between cases. */
export function clearDifferentialSearchCacheForTests() {
  differentialSearchCache.clear();
}

/** Ranked catalogue search for the Differentials search mode: fetches scored
 *  diagnosis and presentation matches in parallel from /api/differentials.
 *  Empty queries resolve immediately without a request. Debounced + abortable
 *  with an auth-keyed client LRU (parity with useUniversalSearch). */
/** State plus a `refetch` for Retry affordances, mirroring `useRegistryRecords`.
    A failed request is never written to the cache, so re-running the effect is
    enough to re-request; no eviction is needed. */
export type DifferentialSearchResult = DifferentialSearchState & { refetch: () => void };

export function useDifferentialSearch(query: string): DifferentialSearchResult {
  const { authorizationHeader, markSessionExpired, session, status: authStatus } = useAuthSession();
  const requestKey = query.trim().toLowerCase();
  const authSignature = authSessionFingerprint(authStatus, session?.user.id);
  const cacheKey = requestKey ? differentialCacheKey(requestKey, authSignature) : null;
  const cached = cacheKey ? peekDifferentialCache(cacheKey) : undefined;

  const [state, setState] = useState<DifferentialSearchState>(() =>
    cached
      ? { status: "ready", matches: cached.matches, demoMode: cached.demoMode }
      : {
          status: requestKey ? "loading" : "ready",
          matches: emptyDifferentialMatches,
          demoMode: false,
        },
  );
  // Reset to loading during render when the query or auth identity changes
  // (repo pattern — avoids react-hooks/set-state-in-effect). Prefer a warm cache hit.
  // Auth must clear prior identity's matches immediately (parity with useUniversalSearch).
  const [lastRequestKey, setLastRequestKey] = useState(requestKey);
  const [lastAuthSignature, setLastAuthSignature] = useState(authSignature);
  const [lastAuthorizationHeader, setLastAuthorizationHeader] = useState(authorizationHeader);
  const [requestLifecycle] = useState(() => createAuthRequestLifecycle());
  const requestChanged = lastRequestKey !== requestKey;
  const identityChanged = lastAuthSignature !== authSignature;
  const credentialChanged = lastAuthorizationHeader !== authorizationHeader;
  if (requestChanged || identityChanged || credentialChanged) {
    setLastRequestKey(requestKey);
    setLastAuthSignature(authSignature);
    setLastAuthorizationHeader(authorizationHeader);
    if (!requestKey || identityChanged) {
      setState(
        requestKey
          ? { status: "loading", matches: emptyDifferentialMatches, demoMode: false }
          : { status: "ready", matches: emptyDifferentialMatches, demoMode: false },
      );
    } else if (credentialChanged && !requestChanged && (state.status === "ready" || state.status === "refetching")) {
      setState({ ...state, status: "refetching" });
    } else if (credentialChanged && !requestChanged) {
      // Error/unauthorized/loading: drop the same-identity LRU entry so the
      // render/effect cache short-circuits cannot paint stale ready matches
      // without revalidating the new Authorization header.
      if (cacheKey) differentialSearchCache.delete(cacheKey);
      setState({ status: "loading", matches: emptyDifferentialMatches, demoMode: false });
    } else if (credentialChanged && cached) {
      // Query changed in the same pulse as the credential: show the warm hit
      // but stay in refetching so the new Authorization header is revalidated.
      setState({ status: "refetching", matches: cached.matches, demoMode: cached.demoMode });
    } else if (cached) {
      setState({ status: "ready", matches: cached.matches, demoMode: cached.demoMode });
    } else {
      setState({ status: "loading", matches: emptyDifferentialMatches, demoMode: false });
    }
  }

  useLayoutEffect(() => {
    requestLifecycle.invalidate();
  }, [authSignature, authorizationHeader, requestKey, requestLifecycle]);

  // Retry bumps this so the fetch effect re-runs on an unchanged query. Without
  // it a Retry button is inert: the hook keys on query + auth identity, neither
  // of which changes when the reader asks to try again.
  const [retryAttempt, setRetryAttempt] = useState(0);
  const refetch = useCallback(() => {
    if (!requestKey) return;
    setState((current) => {
      if (current.status === "ready" || current.status === "refetching") {
        return { ...current, status: "refetching" };
      }
      // Retry after error/unauthorized must not soft-succeed from a warm LRU
      // entry that survived the failed attempt. Use refetching (not loading):
      // the render short-circuit still promotes loading+cache → ready.
      if (cacheKey) differentialSearchCache.delete(cacheKey);
      return { status: "refetching", matches: emptyDifferentialMatches, demoMode: false };
    });
    setRetryAttempt((attempt) => attempt + 1);
  }, [cacheKey, requestKey, setState]);

  useEffect(() => {
    if (!requestKey || !cacheKey) return undefined;

    // Only a settled ready hit may skip the network. loading/refetching must
    // revalidate so Retry and credential pulses cannot soft-succeed offline.
    if (state.status === "ready" && peekDifferentialCache(cacheKey)) {
      touchDifferentialCache(cacheKey);
      return undefined;
    }

    const controller = new AbortController();
    const registration = requestLifecycle.register(controller);
    const isCurrentRequest = () => requestLifecycle.isCurrent(registration.epoch);
    const timer = window.setTimeout(() => {
      const encoded = encodeURIComponent(requestKey);
      Promise.all([
        fetch(`/api/differentials?kind=diagnosis&q=${encoded}&limit=20`, {
          headers: authorizationHeader,
          signal: controller.signal,
        }),
        fetch(`/api/differentials?kind=presentation&q=${encoded}&limit=10`, {
          headers: authorizationHeader,
          signal: controller.signal,
        }),
      ])
        .then(async ([diagnosisResponse, presentationResponse]) => {
          if (controller.signal.aborted || !isCurrentRequest()) return;
          if (diagnosisResponse.status === 401 || presentationResponse.status === 401) {
            if (authStatus === "loading") return;
            if (authStatus === "authenticated") markSessionExpired();
            // Session is invalid for this client identity — drop every cached hit so
            // a later retype of any prior query cannot resurrect authorized matches.
            differentialSearchCache.clear();
            setState({ status: "unauthorized", matches: emptyDifferentialMatches, demoMode: false });
            return;
          }
          if (!diagnosisResponse.ok || !presentationResponse.ok) {
            setState({ status: "error", matches: emptyDifferentialMatches, demoMode: false });
            return;
          }
          const diagnosisPayload = (await diagnosisResponse.json()) as {
            matches?: DifferentialSearchMatches["diagnoses"];
            demoMode?: boolean;
          };
          const presentationPayload = (await presentationResponse.json()) as {
            matches?: DifferentialSearchMatches["presentations"];
            demoMode?: boolean;
          };
          if (controller.signal.aborted || !isCurrentRequest()) return;
          const matches: DifferentialSearchMatches = {
            diagnoses: diagnosisPayload.matches ?? [],
            presentations: presentationPayload.matches ?? [],
          };
          const demoMode = Boolean(diagnosisPayload.demoMode || presentationPayload.demoMode);
          writeDifferentialCache(cacheKey, { matches, demoMode });
          setState({ status: "ready", matches, demoMode });
        })
        .catch((error: unknown) => {
          if (
            controller.signal.aborted ||
            !isCurrentRequest() ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            return;
          setState({ status: "error", matches: emptyDifferentialMatches, demoMode: false });
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      registration.release();
    };
  }, [
    requestKey,
    cacheKey,
    authStatus,
    authorizationHeader,
    markSessionExpired,
    retryAttempt,
    state.status,
    requestLifecycle,
  ]);

  if (!requestKey) {
    return { status: "ready", matches: emptyDifferentialMatches, demoMode: false, refetch };
  }
  if (cached && state.status !== "unauthorized" && state.status !== "error" && state.status !== "refetching") {
    return { status: "ready", matches: cached.matches, demoMode: cached.demoMode, refetch };
  }
  return { ...state, refetch };
}

export function useDifferentialRecord(slug: string): DifferentialRecordState {
  const { authorizationHeader, markSessionExpired, session, status: authStatus } = useAuthSession();
  const requestKey = slug.trim().toLowerCase();
  const requestIdentity = JSON.stringify([
    requestKey,
    authSessionFingerprint(authStatus, session?.user.id),
    authorizationHeader.Authorization ?? "",
  ]);
  const [state, setState] = useState<DifferentialRecordState>({
    status: "loading",
    record: null,
    detailContext: null,
    demoMode: false,
    governance: null,
  });
  const [lastRequestIdentity, setLastRequestIdentity] = useState(requestIdentity);
  if (lastRequestIdentity !== requestIdentity) {
    setLastRequestIdentity(requestIdentity);
    setState({ status: "loading", record: null, detailContext: null, demoMode: false, governance: null });
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/differentials/${encodeURIComponent(requestKey)}?kind=diagnosis`, { headers: authorizationHeader })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          if (authStatus === "loading") return;
          if (authStatus === "authenticated") markSessionExpired();
          setState({ status: "unauthorized", record: null, detailContext: null, demoMode: false, governance: null });
          return;
        }
        if (response.status === 404) {
          setState({ status: "not_found", record: null, detailContext: null, demoMode: false, governance: null });
          return;
        }
        if (response.status === 503) {
          setState({ status: "unavailable", record: null, detailContext: null, demoMode: false, governance: null });
          return;
        }
        if (!response.ok) {
          setState({ status: "error", record: null, detailContext: null, demoMode: false, governance: null });
          return;
        }
        const payload = (await response.json()) as {
          record?: DifferentialRecord;
          detailContext?: DifferentialDetailContext;
          demoMode?: boolean;
          governance?: DifferentialRecordGovernance;
        };
        if (!payload.record || !payload.detailContext) {
          setState({ status: "error", record: null, detailContext: null, demoMode: false, governance: null });
          return;
        }
        setState({
          status: "ready",
          record: payload.record,
          detailContext: payload.detailContext,
          demoMode: Boolean(payload.demoMode),
          governance: payload.governance ?? null,
        });
      })
      .catch(() => {
        if (active) {
          setState({ status: "error", record: null, detailContext: null, demoMode: false, governance: null });
        }
      });
    return () => {
      active = false;
    };
  }, [requestKey, authStatus, authorizationHeader, markSessionExpired]);

  return state;
}

export function useDifferentialPresentation(slug: string): DifferentialPresentationState {
  const { authorizationHeader, markSessionExpired, session, status: authStatus } = useAuthSession();
  const requestKey = slug.trim().toLowerCase();
  const requestIdentity = JSON.stringify([
    requestKey,
    authSessionFingerprint(authStatus, session?.user.id),
    authorizationHeader.Authorization ?? "",
  ]);
  const [state, setState] = useState<DifferentialPresentationState>(emptyDifferentialPresentationState);
  const [lastRequestIdentity, setLastRequestIdentity] = useState(requestIdentity);
  if (lastRequestIdentity !== requestIdentity) {
    setLastRequestIdentity(requestIdentity);
    setState(emptyDifferentialPresentationState);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/differentials/presentations/${encodeURIComponent(requestKey)}`, { headers: authorizationHeader })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          if (authStatus === "loading") return;
          if (authStatus === "authenticated") markSessionExpired();
          setState({ ...emptyDifferentialPresentationState, status: "unauthorized" });
          return;
        }
        if (response.status === 404) {
          setState({ ...emptyDifferentialPresentationState, status: "not_found" });
          return;
        }
        if (response.status === 503) {
          setState({ ...emptyDifferentialPresentationState, status: "unavailable" });
          return;
        }
        if (!response.ok) {
          setState({ ...emptyDifferentialPresentationState, status: "error" });
          return;
        }
        const payload = (await response.json()) as {
          workflow?: DifferentialPresentationWorkflow;
          candidates?: DifferentialPresentationCandidate[];
          demoMode?: boolean;
          governance?: DifferentialRecordGovernance;
        };
        if (!active) return;
        if (!payload.workflow || !Array.isArray(payload.candidates)) {
          setState({ ...emptyDifferentialPresentationState, status: "error" });
          return;
        }
        setState({
          status: "ready",
          workflow: payload.workflow,
          candidates: payload.candidates,
          demoMode: Boolean(payload.demoMode),
          governance: payload.governance ?? null,
        });
      })
      .catch(() => {
        if (active) setState({ ...emptyDifferentialPresentationState, status: "error" });
      });
    return () => {
      active = false;
    };
  }, [requestKey, requestIdentity, authStatus, authorizationHeader, markSessionExpired]);

  return state;
}
