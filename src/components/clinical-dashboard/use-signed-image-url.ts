"use client";

import { useCallback, useEffect, useState } from "react";

import { authorizationIdentity } from "@/lib/authorization-header";
import { isRetryableApiStatus, parseRetryAfterMs } from "@/lib/api-client-error";
import { clearCachedSignedUrl, getCachedSignedUrl, setCachedSignedUrl } from "@/lib/signed-url-cache";
import { useAuthSession } from "@/lib/supabase/client";
import { createClientRequestBudget } from "@/components/clinical-dashboard/client-request-budget";

type SignedUrlResponse = { status: number; data: { url?: string } | null; retryAfterMs: number | null };

export type SignedImageFailure = {
  source: "response" | "network" | "image";
  status: number | null;
  retryable: boolean;
  retryAfterMs: number | null;
};

/**
 * One in-flight request per endpoint *and identity*, shared by every consumer
 * that asks while it is running. The module LRU only helps once a response has
 * landed, so without this the first paint of a page holding several views of the
 * same image issued a signed-URL request for each of them.
 *
 * The bearer token is part of the key on purpose: a request started under one
 * identity must never be handed to another, which is the same rule the auth
 * reset below enforces for painted URLs.
 */
const inFlightSignedUrlRequests = new Map<string, Promise<SignedUrlResponse>>();

function signedUrlRequestKey(endpoint: string, headers: Record<string, string>) {
  return `${endpoint}\u0000${authorizationIdentity(headers)}`;
}

function beginSignedUrlRequest(key: string, endpoint: string, headers: Record<string, string>) {
  // Do not write the module LRU here. Cache keys are endpoint-only, while this
  // map is keyed by endpoint+identity: a superseded response that landed after
  // an account switch would repopulate the cleared cache with the prior user's
  // signed URL. Active consumers write the cache after their own identity check.
  const controller = new AbortController();
  const budget = createClientRequestBudget(controller);
  const request = budget
    .wait(fetch(endpoint, { headers, signal: controller.signal }))
    .then(async (response): Promise<SignedUrlResponse> => {
      const data = response.ok ? await budget.wait(response.json()) : null;
      return { status: response.status, data, retryAfterMs: parseRetryAfterMs(response) };
    })
    .finally(() => {
      budget.cancel();
      if (inFlightSignedUrlRequests.get(key) === request) inFlightSignedUrlRequests.delete(key);
    });
  inFlightSignedUrlRequests.set(key, request);
  return request;
}

// In-flight requests are removed automatically in .finally when they settle.
// Pending retries share the same bounded request; once it expires, eviction
// lets the next retry issue afresh without cancelling a sibling on unmount.

/**
 * Resolve a private image's signed URL through its `/signed-url` endpoint, with
 * the client LRU cache in front and the auth-session authorization header.
 *
 * Shared by `SignedImage` (which gates `enabled` behind an IntersectionObserver)
 * and the image lightbox (which enables it while open). A cached URL seeds the
 * state synchronously so an already-fetched image paints without a round-trip.
 */
export function useSignedImageUrl(endpoint: string, enabled: boolean) {
  const [url, setUrl] = useState(() => getCachedSignedUrl(endpoint)?.url ?? null);
  const [failure, setFailure] = useState<SignedImageFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { authorizationHeader, session, markSessionExpired } = useAuthSession();

  const [seenEndpoint, setSeenEndpoint] = useState(endpoint);
  if (endpoint !== seenEndpoint) {
    setSeenEndpoint(endpoint);
    setUrl(getCachedSignedUrl(endpoint)?.url ?? null);
    setFailure(null);
  }

  // Drop painted URLs during render when the auth *identity* changes (sign-out /
  // expiry / account switch). Auth also clears the module LRU; without this,
  // mounted consumers keep showing the prior user's URL until refetch settles.
  //
  // Keyed to the user id, not `authorizationHeader`: the header is a new object
  // on every access-token refresh, which would blank an image the same user is
  // still entitled to see and force a needless refetch. The id changes in the
  // same render as the header on a real identity change, so this is no later
  // than the header-keyed version was — it just ignores refreshes.
  const authIdentity = session?.user?.id ?? null;
  const [seenAuthIdentity, setSeenAuthIdentity] = useState(authIdentity);
  if (authIdentity !== seenAuthIdentity) {
    setSeenAuthIdentity(authIdentity);
    setUrl(null);
    setFailure(null);
  }

  useEffect(() => {
    if (!enabled) return () => undefined;

    const cached = getCachedSignedUrl(endpoint);
    if (cached) {
      let active = true;
      window.requestAnimationFrame(() => {
        if (!active) return;
        setUrl(cached.url);
        setFailure(null);
      });
      return () => {
        active = false;
      };
    }

    let active = true;
    // Share one request per endpoint. A document page can mount several
    // consumers of the same image at once — a figure and its lightbox, a rail
    // panel and a filmstrip — and on a cold cache each was minting its own
    // signed URL, so N components meant N round trips for one asset.
    const key = signedUrlRequestKey(endpoint, authorizationHeader);
    const request = inFlightSignedUrlRequests.get(key) ?? beginSignedUrlRequest(key, endpoint, authorizationHeader);
    request
      .then(({ status, data, retryAfterMs }) => {
        if (!active) return;
        // A request restarted after sign-out has no identity and is expected to
        // receive 401. Likewise, a request from an old identity can settle
        // after its effect was cancelled. Neither may overwrite the user's
        // deliberate signed-out state with an erroneous "session expired".
        if (status === 401 && authIdentity !== null) markSessionExpired();
        if (data?.url) {
          // Only an active consumer for this identity may populate the shared
          // endpoint-keyed cache — otherwise a late response after sign-out /
          // account switch can hand the next user the prior bearer URL.
          setCachedSignedUrl(endpoint, { ...data, url: data.url });
          setUrl(data.url);
          setFailure(null);
        } else {
          setFailure({
            source: "response",
            status,
            retryable: isRetryableApiStatus(status),
            retryAfterMs,
          });
        }
      })
      .catch(() => {
        if (active) {
          setFailure({ source: "network", status: null, retryable: true, retryAfterMs: null });
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, authIdentity, authorizationHeader, enabled, endpoint, markSessionExpired]);

  // Drop the cached URL and refetch (e.g. after a 403 on an expired URL).
  const retry = useCallback(() => {
    clearCachedSignedUrl(endpoint);
    setUrl(null);
    setFailure(null);
    setAttempt((current) => current + 1);
  }, [endpoint]);

  // Mark the current URL dead (e.g. <img> onError) so the frame shows its failure state.
  const markFailed = useCallback(() => {
    clearCachedSignedUrl(endpoint);
    setUrl(null);
    setFailure({ source: "image", status: null, retryable: true, retryAfterMs: null });
  }, [endpoint]);

  return { url, failed: failure !== null, failure, retry, markFailed };
}
