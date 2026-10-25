"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import type { RegistryRecordKind, RegistrySourceStatus, RegistryValidationStatus } from "@/lib/registry-records";
import type { ServiceRecord } from "@/lib/services";
import { authSessionFingerprint, createAuthRequestLifecycle } from "@/lib/auth-request-lifecycle";
import {
  parseRegistryListResponse,
  parseRegistryRecordResponse,
  type RegistryListView,
} from "@/lib/registry-client-contract";
import { useAuthSession } from "@/lib/supabase/client";

export type { RegistryListView } from "@/lib/registry-client-contract";

export type RegistryRequestStatus = "loading" | "refetching" | "ready" | "unauthorized" | "not_found" | "error";

export type RegistryRecordsState = {
  status: RegistryRequestStatus;
  records: ServiceRecord[];
  total: number;
  verifiedCount: number;
  demoMode: boolean;
  /** Authoritative validation status per slug from the API, so callers count
   *  reviewed records from governance rather than the copied fixture JSON. */
  governance: Record<string, RegistryValidationStatus>;
  /** The API served the in-bundle catalogue because the canonical read could
   *  not be completed. The records are real but the list may lag what was
   *  published, and the surface has to say so rather than let the reader
   *  assume it is current. */
  degraded: boolean;
};

/** Hook return: the list state plus a `refetch` that re-runs the request — e.g.
 *  from a Retry control after a transient error, since the fetch key is the kind
 *  (not a user value) and would otherwise only recover on a full page reload. */
export type RegistryRecordsResult = RegistryRecordsState & { refetch: () => void };

export type RegistryRecordGovernance = {
  sourceStatus: RegistrySourceStatus;
  validationStatus: RegistryValidationStatus;
};

export type RegistryRecordState = {
  status: RegistryRequestStatus;
  record: ServiceRecord | null;
  linkedDocuments: Array<{ id: string; title: string; file_name: string; status: string }>;
  demoMode: boolean;
  /** Authoritative governance for the record from the API (null until ready),
   *  so detail pages can render current badges rather than the fixture copy. */
  governance: RegistryRecordGovernance | null;
};

/** Hook return: the record state plus a `refetch` for Retry affordances. */
export type RegistryRecordResult = RegistryRecordState & { refetch: () => void };

const recordLoading: RegistryRecordState = {
  status: "loading",
  record: null,
  linkedDocuments: [],
  demoMode: false,
  governance: null,
};
type RegistryRecordsKeyedState = RegistryRecordsState & { kind: RegistryRecordKind; view: RegistryListView };

function recordsState(
  status: RegistryRequestStatus,
  kind: RegistryRecordKind,
  view: RegistryListView,
  extra: Partial<RegistryRecordsState> = {},
): RegistryRecordsKeyedState {
  return {
    status,
    records: [],
    total: 0,
    verifiedCount: 0,
    demoMode: false,
    governance: {},
    degraded: false,
    kind,
    view,
    ...extra,
  };
}

/** Owner-scoped registry list (Services/Forms home and search surfaces). Choose
 *  summary for counts-only homes, search for compact identity matching, and
 *  full for result rendering. Pass enabled:false until the mode is active. */
export function useRegistryRecords(
  kind: RegistryRecordKind,
  options: { enabled?: boolean; view?: RegistryListView } = {},
): RegistryRecordsResult {
  const enabled = options.enabled ?? true;
  const view = options.view ?? "full";
  const { authorizationHeader, markSessionExpired, session, status: authStatus } = useAuthSession();
  const authIdentity = authSessionFingerprint(authStatus, session?.user.id);
  const [state, setState] = useState<RegistryRecordsKeyedState>(recordsState("loading", kind, view));
  const [attempt, setAttempt] = useState(0);
  const [lastRequestIdentity, setLastRequestIdentity] = useState({
    authIdentity,
    authorizationHeader,
    enabled,
    kind,
    view,
  });
  const [requestLifecycle] = useState(() => createAuthRequestLifecycle());

  const resourceChanged =
    lastRequestIdentity.kind !== kind || lastRequestIdentity.enabled !== enabled || lastRequestIdentity.view !== view;
  const identityChanged = lastRequestIdentity.authIdentity !== authIdentity;
  const credentialChanged = lastRequestIdentity.authorizationHeader !== authorizationHeader;
  if (resourceChanged || identityChanged || credentialChanged) {
    setLastRequestIdentity({ authIdentity, authorizationHeader, enabled, kind, view });
    setState((current) => {
      if (
        !resourceChanged &&
        !identityChanged &&
        credentialChanged &&
        current.kind === kind &&
        current.view === view &&
        (current.status === "ready" || current.status === "refetching")
      ) {
        return { ...current, status: "refetching" };
      }
      return recordsState("loading", kind, view);
    });
  }
  const visibleState: RegistryRecordsState =
    state.kind === kind && state.view === view ? state : recordsState("loading", kind, view);

  // Abort prior-identity work during commit, before paint and before passive
  // effects can start the replacement request.
  useLayoutEffect(() => {
    requestLifecycle.invalidate();
  }, [authIdentity, authorizationHeader, enabled, kind, view, requestLifecycle]);

  // A same-identity refresh keeps already-authorized rows visible. Resource or
  // identity changes clear synchronously above, before another owner can paint.
  const refetch = useCallback(() => {
    setState((current) =>
      current.kind === kind && current.view === view && (current.status === "ready" || current.status === "refetching")
        ? { ...current, status: "refetching" }
        : recordsState("loading", kind, view),
    );
    setAttempt((value) => value + 1);
  }, [kind, view]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const controller = new AbortController();
    const registration = requestLifecycle.register(controller);
    const isCurrentRequest = () => active && requestLifecycle.isCurrent(registration.epoch);
    fetch(`/api/registry/records?kind=${kind}&view=${view}`, {
      headers: authorizationHeader,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!isCurrentRequest()) return;
        if (response.status === 401) {
          // In real auth deployments the first request can race AuthProvider's
          // session load. Keep loading until the auth status changes and this
          // effect retries with a real header; never expire the session from an
          // auth-loading 401. Demo/local API responses can still resolve fast.
          if (authStatus === "loading") return;
          if (authStatus === "authenticated") {
            markSessionExpired();
            setState(recordsState("unauthorized", kind, view));
            return;
          }
          setState(recordsState("error", kind, view));
          return;
        }
        if (!response.ok) {
          setState((current) =>
            current.records.length > 0
              ? { ...current, status: "ready", degraded: true }
              : recordsState("error", kind, view),
          );
          return;
        }
        const responsePayload: unknown = await response.json().catch(() => null);
        const payload = parseRegistryListResponse(responsePayload, view);
        if (!payload) throw new Error("Registry records returned an invalid response.");
        if (!isCurrentRequest()) return;
        const governance: Record<string, RegistryValidationStatus> = {};
        for (const [slug, entry] of Object.entries(payload.governance)) {
          governance[slug] = entry.validationStatus;
        }
        setState(
          recordsState("ready", kind, view, {
            records: payload.records,
            total: payload.total,
            verifiedCount: payload.verifiedCount,
            demoMode: Boolean(payload.demoMode),
            governance,
            degraded: Boolean(payload.degraded),
          }),
        );
      })
      .catch(() => {
        if (isCurrentRequest()) {
          setState((current) =>
            current.records.length > 0
              ? { ...current, status: "ready", degraded: true }
              : recordsState("error", kind, view),
          );
        }
      });
    return () => {
      active = false;
      controller.abort();
      registration.release();
    };
  }, [enabled, kind, view, authStatus, authorizationHeader, markSessionExpired, attempt, requestLifecycle]);

  return { ...visibleState, refetch };
}

/** Single owner-scoped registry record (detail pages). */
export function useRegistryRecord(kind: RegistryRecordKind, slug: string): RegistryRecordResult {
  const { authorizationHeader, markSessionExpired, status: authStatus } = useAuthSession();
  const requestKey = `${kind}:${slug}`;
  const [state, setState] = useState<RegistryRecordState>(recordLoading);
  const [attempt, setAttempt] = useState(0);
  const refetch = useCallback(() => {
    setState(recordLoading);
    setAttempt((value) => value + 1);
  }, []);
  // Reset to loading during render when the target record changes, instead of
  // synchronously inside the effect (react-hooks/set-state-in-effect).
  const [lastRequestKey, setLastRequestKey] = useState(requestKey);
  if (lastRequestKey !== requestKey) {
    setLastRequestKey(requestKey);
    setState(recordLoading);
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch(`/api/registry/records/${encodeURIComponent(slug)}?kind=${kind}`, {
      headers: authorizationHeader,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          if (authStatus === "loading") return;
          if (authStatus === "authenticated") {
            markSessionExpired();
            setState({ status: "unauthorized", record: null, linkedDocuments: [], demoMode: false, governance: null });
            return;
          }
          setState({ status: "error", record: null, linkedDocuments: [], demoMode: false, governance: null });
          return;
        }
        if (response.status === 404) {
          setState({ status: "not_found", record: null, linkedDocuments: [], demoMode: false, governance: null });
          return;
        }
        if (!response.ok) {
          setState({ status: "error", record: null, linkedDocuments: [], demoMode: false, governance: null });
          return;
        }
        const responsePayload: unknown = await response.json().catch(() => null);
        const payload = parseRegistryRecordResponse(responsePayload);
        if (!payload) throw new Error("Registry record returned an invalid response.");
        // A body that finishes after sign-out or an identity change must not paint the prior owner's record.
        if (!active) return;
        setState({
          status: "ready",
          record: payload.record,
          linkedDocuments: payload.linkedDocuments,
          demoMode: Boolean(payload.demoMode),
          governance: payload.governance,
        });
      })
      .catch(() => {
        if (active) setState({ status: "error", record: null, linkedDocuments: [], demoMode: false, governance: null });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [kind, slug, authStatus, authorizationHeader, markSessionExpired, attempt]);

  return { ...state, refetch };
}
