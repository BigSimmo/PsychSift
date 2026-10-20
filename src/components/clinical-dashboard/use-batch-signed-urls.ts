import { useEffect, useState } from "react";
import {
  fetchBatchSignedImageUrls,
  getUncachedImageIds,
  populateBatchSignedUrlsInCache,
} from "@/lib/batch-signed-urls";
import { useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * Hook to batch-resolve and prefetch signed URLs for an array of image IDs in
 * a single `POST /api/images/signed-urls` request (chunked in <= 100 IDs),
 * populating the client-side signed-URL LRU cache.
 *
 * Child `SignedImage` or `useSignedImageUrl` components will immediately find
 * their signed URLs synchronously in the LRU cache without firing individual N+1
 * network fetches.
 */
export function useBatchSignedImageUrls(imageIds: string[], enabled = true) {
  const { authorizationHeader, session, markSessionExpired, registerAuthRequest, isAuthEpochCurrent } =
    useAuthSession();
  const authIdentity = session?.user?.id ?? null;
  // The server refuses image links to signed-out readers, so do not ask.
  const originalsLocked = useClinicalToolAccess() === "sign-in-required";
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled || originalsLocked || !Array.isArray(imageIds) || imageIds.length === 0) {
      return;
    }

    const uncachedIds = getUncachedImageIds(imageIds);
    if (uncachedIds.length === 0) {
      return;
    }

    const controller = new AbortController();
    const authRequest = registerAuthRequest(controller);

    async function loadBatch() {
      try {
        const result = await fetchBatchSignedImageUrls(uncachedIds, {
          headers: authorizationHeader ? (authorizationHeader as HeadersInit) : undefined,
          signal: controller.signal,
          onUnauthorized: () => {
            if (authIdentity !== null) markSessionExpired();
          },
        });

        if (isAuthEpochCurrent(authRequest.epoch) && result.status === 200) {
          populateBatchSignedUrlsInCache(result.urls);
          setVersion((v) => v + 1);
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          // Silent catch for prefetch failure — individual images will fallback to single fetch
        }
      } finally {
        authRequest.release();
      }
    }

    loadBatch();

    return () => {
      controller.abort();
    };
  }, [
    enabled,
    originalsLocked,
    imageIds,
    authorizationHeader,
    authIdentity,
    markSessionExpired,
    registerAuthRequest,
    isAuthEpochCurrent,
  ]);

  return { version };
}
