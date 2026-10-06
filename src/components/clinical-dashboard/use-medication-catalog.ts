"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import { authSessionFingerprint, createAuthRequestLifecycle } from "@/lib/auth-request-lifecycle";
import type { MedicationRecord, MedicationSearchResult } from "@/lib/medications";
import { useAuthSession } from "@/lib/supabase/client";

type MedicationCatalogMatch = {
  medication: MedicationRecord;
  result: MedicationSearchResult;
  score: number;
  reasons: string[];
};

export type MedicationCatalogInterpretation = {
  correctedQuery?: string;
  corrections?: Array<{ from: string; to: string }>;
  appliedExpansions?: string[];
};

type MedicationCatalogResponse = {
  records: MedicationRecord[];
  matches?: MedicationCatalogMatch[];
  interpretation?: MedicationCatalogInterpretation;
  total: number;
  governance?: Record<
    string,
    { sourceStatus: string; validationStatus: string; sourceCheckedAt?: string | null; sourcesRecorded?: boolean }
  >;
  demoMode?: boolean;
  /**
   * Set when `readCatalogueWithSeedFallback` served the in-bundle catalogue because the
   * canonical read failed, timed out, or is inside its cooldown. Surfaces as a notice so a
   * possibly stale list is never read as live published content.
   */
  retainedSnapshot?: boolean;
};

type MedicationDetailResponse = {
  record: MedicationRecord;
  governance?: {
    sourceStatus: string;
    validationStatus: string;
    sourceCheckedAt?: string | null;
    sourcesRecorded?: boolean;
  };
  demoMode?: boolean;
};

type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

/** Match universal typeahead debounce so prescribing keystrokes coalesce. */
const catalogDebounceMs = 250;

type JsonRecord = Record<string, unknown>;

function jsonObject(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function optionalBoolean(value: unknown) {
  return value === undefined || typeof value === "boolean";
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

/**
 * Envelope keys `/api/medications` can send. The allow-list is the load-bearing half of this
 * parser: a key the route renames or stops sending is what made the 2026-09-16 outage silent,
 * because a blind cast reports a response that no longer carries `retainedSnapshot` as a
 * perfectly healthy catalogue. Rejecting the unknown key instead surfaces as a visible fault.
 */
const catalogResponseKeys = [
  "records",
  "matches",
  "interpretation",
  "total",
  "governance",
  "demoMode",
  "publicAccess",
  "retainedSnapshot",
] as const;

const interpretationKeys = ["correctedQuery", "corrections", "appliedExpansions"] as const;

function hasOnlyKnownKeys(value: JsonRecord, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

/**
 * Records and matches are checked at identity depth only, never key-exhaustively.
 * `records` on the canonical path is the database's own `render_payload`, so a published record
 * may legitimately carry fields this client has never heard of; rejecting those would blank the
 * mode over a harmless publication. What must hold is that each entry is an object the UI can
 * key and label.
 */
function medicationRecordShape(value: unknown) {
  const candidate = jsonObject(value);
  return Boolean(candidate && typeof candidate.slug === "string" && typeof candidate.name === "string");
}

function medicationMatchShape(value: unknown) {
  const candidate = jsonObject(value);
  return Boolean(
    candidate &&
    medicationRecordShape(candidate.medication) &&
    jsonObject(candidate.result) &&
    typeof candidate.score === "number" &&
    Array.isArray(candidate.reasons),
  );
}

function governanceShape(value: unknown) {
  const candidate = jsonObject(value);
  if (!candidate) return false;
  return Object.values(candidate).every((entry) => {
    const governance = jsonObject(entry);
    return Boolean(
      governance && typeof governance.sourceStatus === "string" && typeof governance.validationStatus === "string",
    );
  });
}

function interpretationShape(value: unknown) {
  const candidate = jsonObject(value);
  if (!candidate || !hasOnlyKnownKeys(candidate, interpretationKeys)) return false;
  return (
    optionalString(candidate.correctedQuery) &&
    (candidate.corrections === undefined || Array.isArray(candidate.corrections)) &&
    (candidate.appliedExpansions === undefined ||
      (Array.isArray(candidate.appliedExpansions) &&
        candidate.appliedExpansions.every((entry) => typeof entry === "string")))
  );
}

/**
 * Fail-closed response boundary for `/api/medications`, in the spirit of
 * `parseRegistryListResponse`: an exact envelope rather than Zod, which the search shell must
 * not carry. Returns null for anything that does not match, and the caller turns that into a
 * visible error — the one outcome the old `as T` cast could never produce.
 */
export function parseMedicationCatalogResponse(value: unknown): MedicationCatalogResponse | null {
  const candidate = jsonObject(value);
  if (!candidate || !hasOnlyKnownKeys(candidate, catalogResponseKeys)) return null;
  if (!Array.isArray(candidate.records) || !candidate.records.every(medicationRecordShape)) return null;
  if (typeof candidate.total !== "number" || !Number.isFinite(candidate.total) || candidate.total < 0) return null;
  if (
    candidate.matches !== undefined &&
    (!Array.isArray(candidate.matches) || !candidate.matches.every(medicationMatchShape))
  )
    return null;
  if (candidate.interpretation !== undefined && !interpretationShape(candidate.interpretation)) return null;
  if (candidate.governance !== undefined && !governanceShape(candidate.governance)) return null;
  if (!optionalBoolean(candidate.demoMode) || !optionalBoolean(candidate.publicAccess)) return null;
  if (!optionalBoolean(candidate.retainedSnapshot)) return null;
  return candidate as unknown as MedicationCatalogResponse;
}

function parseMedicationDetailResponse(value: unknown): MedicationDetailResponse | null {
  const candidate = jsonObject(value);
  if (!candidate || !hasOnlyKnownKeys(candidate, ["record", "governance", "demoMode", "publicAccess"])) return null;
  if (!medicationRecordShape(candidate.record)) return null;
  if (candidate.governance !== undefined) {
    const governance = jsonObject(candidate.governance);
    if (!governance || typeof governance.sourceStatus !== "string" || typeof governance.validationStatus !== "string") {
      return null;
    }
  }
  return optionalBoolean(candidate.demoMode) ? (candidate as unknown as MedicationDetailResponse) : null;
}

/** A non-OK API response. Keeps the status and the API's machine-readable `code`. */
class MedicationRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Request failed (${status})`);
    this.name = "MedicationRequestError";
  }
}

async function responseErrorCode(response: Response): Promise<string | null> {
  try {
    const body = jsonObject(await response.json());
    return typeof body?.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

async function fetchJson<T>(
  url: string,
  headers: HeadersInit | undefined,
  signal: AbortSignal,
  parse: (value: unknown) => T | null,
): Promise<T> {
  // Use the default cache mode (not `no-store`) so public responses honor the
  // API's `public, max-age=300, s-maxage=3600, stale-while-revalidate` headers.
  // Owner responses are served `private, no-store` with `Vary: Authorization`,
  // so the browser never caches them across auth states — matching the sibling
  // registry/differential hooks, which also fetch with the default cache mode.
  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    throw new MedicationRequestError(response.status, await responseErrorCode(response));
  }
  const parsed = parse(await response.json());
  if (!parsed) throw new Error("The medication catalogue returned an unexpected response.");
  return parsed;
}

export function useMedicationCatalog(
  query?: string,
  options: { enabled?: boolean; fields?: "index"; debounceMs?: number } = {},
): AsyncState<MedicationCatalogResponse> {
  const enabled = options.enabled ?? true;
  const fields = options.fields;
  const debounceMs = options.debounceMs ?? catalogDebounceMs;
  const trimmed = query?.trim() ?? "";
  // Auth-aware like use-registry-records: without the header an authenticated owner was
  // silently served the public fixture catalogue instead of their seeded records.
  const { authorizationHeader, session, status: authStatus } = useAuthSession();
  const authIdentity = authSessionFingerprint(authStatus, session?.user.id);
  const [prevQuery, setPrevQuery] = useState(trimmed);
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  const [prevAuthIdentity, setPrevAuthIdentity] = useState(authIdentity);
  const [prevAuthorizationHeader, setPrevAuthorizationHeader] = useState(authorizationHeader);
  const [requestLifecycle] = useState(() => createAuthRequestLifecycle());
  const [state, setState] = useState<AsyncState<MedicationCatalogResponse>>({
    data: null,
    loading: enabled,
    error: null,
  });

  const resourceChanged = trimmed !== prevQuery || enabled !== prevEnabled;
  const identityChanged = authIdentity !== prevAuthIdentity;
  const credentialChanged = authorizationHeader !== prevAuthorizationHeader;
  if (resourceChanged || identityChanged || credentialChanged) {
    setPrevQuery(trimmed);
    setPrevEnabled(enabled);
    setPrevAuthIdentity(authIdentity);
    setPrevAuthorizationHeader(authorizationHeader);
    setState((current) =>
      !resourceChanged && !identityChanged && credentialChanged && current.data
        ? { ...current, loading: true, error: null }
        : { data: null, loading: enabled, error: null },
    );
  }

  useLayoutEffect(() => {
    requestLifecycle.invalidate();
  }, [authIdentity, authorizationHeader, enabled, fields, requestLifecycle, trimmed]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const registration = requestLifecycle.register(controller);
    const isCurrentRequest = () => requestLifecycle.isCurrent(registration.epoch);
    const params = new URLSearchParams();
    if (trimmed) params.set("q", trimmed);
    if (fields) params.set("fields", fields);
    const suffix = params.toString();
    const url = suffix ? `/api/medications?${suffix}` : "/api/medications";

    const timer = window.setTimeout(() => {
      fetchJson(url, authorizationHeader, controller.signal, parseMedicationCatalogResponse)
        .then((data) => {
          if (!controller.signal.aborted && isCurrentRequest()) setState({ data, loading: false, error: null });
        })
        .catch((error) => {
          if (
            controller.signal.aborted ||
            !isCurrentRequest() ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            return;
          const isOffline =
            (typeof navigator !== "undefined" && !navigator.onLine) ||
            (error instanceof TypeError && error.message.includes("fetch"));
          setState({
            data: null,
            loading: false,
            error: isOffline
              ? "You are offline. Connect to search the live medication registry."
              : error instanceof Error
                ? error.message
                : "Could not load medications.",
          });
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      registration.release();
    };
  }, [trimmed, enabled, fields, debounceMs, authIdentity, authorizationHeader, requestLifecycle]);

  return state;
}

export type MedicationDetailState = AsyncState<MedicationDetailResponse> & {
  /**
   * True only when the API answered `medication_not_found` for the current auth
   * header, after sign-in resolved. Any other failure (401, 429, 5xx, a bare 404)
   * stays in `error`, so an outage never reads as "that drug is not here".
   */
  notFound: boolean;
  /** Fetch the record again (the failed page's "Try again"). */
  retry: () => void;
};

// Auth states in which the request carried the credential the user will keep. While
// sign-in is loading (or errored/expired) an owner-only record can 404 for the
// anonymous fetch, which must not be reported as the record not existing.
const resolvedAuthStatuses = new Set(["authenticated", "signed_out", "unconfigured"]);

export function useMedicationDetail(slug?: string): MedicationDetailState {
  const normalized = slug?.trim().toLowerCase() ?? "";
  const { authorizationHeader, session, status: authStatus } = useAuthSession();
  // Identity, not the raw header: an hourly token refresh changes the header for the
  // same user, and resetting on it blanked an owner-only record to a skeleton. The
  // fetch effect still depends on the header, so it refetches with the new token.
  const authIdentity = authSessionFingerprint(authStatus, session?.user.id);
  const [prevSlug, setPrevSlug] = useState(normalized);
  const [prevAuthIdentity, setPrevAuthIdentity] = useState(authIdentity);
  const [state, setState] = useState<AsyncState<MedicationDetailResponse> & { notFoundCode: boolean }>(() => ({
    data: null,
    loading: !!normalized,
    error: null,
    notFoundCode: false,
  }));
  // Bumped by `retry`; the fetch effect re-runs on it.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    setAttempt((count) => count + 1);
  }, []);

  // A new slug or a new identity (including sign-in resolving) starts from a clean
  // slate: a 404 from the anonymous pre-sign-in fetch must never stand for the
  // owner's record.
  if (normalized !== prevSlug || authIdentity !== prevAuthIdentity) {
    setPrevSlug(normalized);
    setPrevAuthIdentity(authIdentity);
    setState({
      data: null,
      loading: !!normalized,
      error: null,
      notFoundCode: false,
    });
  }

  useEffect(() => {
    if (!normalized) {
      return;
    }
    const controller = new AbortController();
    fetchJson(
      `/api/medications/${encodeURIComponent(normalized)}`,
      authorizationHeader,
      controller.signal,
      parseMedicationDetailResponse,
    )
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null, notFoundCode: false });
      })
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        const isOffline =
          (typeof navigator !== "undefined" && !navigator.onLine) ||
          (error instanceof TypeError && error.message.includes("fetch"));
        setState({
          data: null,
          loading: false,
          error: isOffline
            ? "You are offline. Connect to view this medication."
            : error instanceof Error
              ? error.message
              : "Could not load medication.",
          notFoundCode:
            error instanceof MedicationRequestError && error.status === 404 && error.code === "medication_not_found",
        });
      });
    return () => {
      controller.abort();
    };
    // authIdentity: loading -> signed_out keeps the same memoised header object, so the
    // identity reset above must also restart the fetch or the page stays on its skeleton.
  }, [normalized, authorizationHeader, authIdentity, attempt]);

  const { notFoundCode, ...asyncState } = state;
  // While sign-in is still loading, a `medication_not_found` from the anonymous fetch
  // is not an answer yet: show loading, not a red error, until the identity settles.
  if (notFoundCode && authStatus === "loading") {
    return { data: null, loading: true, error: null, notFound: false, retry };
  }
  return { ...asyncState, notFound: notFoundCode && resolvedAuthStatuses.has(authStatus), retry };
}
