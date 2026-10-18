"use client";

import { useCallback, useRef, useState } from "react";

import { isAbortError } from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import { type RefreshOptions } from "@/components/clinical-dashboard/clinical-dashboard-payloads";
import { parseRetryAfterMs } from "@/lib/api-client-error";
import { summarizeBulkReindexPayload } from "@/lib/bulk-reindex-results";
import { errorCopy } from "@/lib/ui-copy";

// The bulk_reindex bucket allows a few requests a minute, so a large selection
// waits out one rate-limit window per batch instead of failing at the 429.
const BULK_RATE_LIMIT_MAX_WAIT_MS = 60_000;

type DashboardBulkActionsOptions = {
  authBoundFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<{ response: Response; requestEpoch: number }>;
  authorizationHeader: Record<string, string> | undefined;
  isAuthEpochCurrent: (epoch: number) => boolean;
  markSessionExpired: () => void;
  refresh: (options?: RefreshOptions) => Promise<void>;
  selectedDocumentIds: string[];
  setIndexingActive: (active: boolean) => void;
  setUserStartedIngestion: (started: boolean) => void;
};

/**
 * Owns the source library's bulk actions on the selected documents: reindex,
 * collection assignment and metadata updates, plus their busy and status
 * state. Moved verbatim from ClinicalDashboard.tsx.
 */
export function useDashboardBulkActions({
  authBoundFetch,
  authorizationHeader,
  isAuthEpochCurrent,
  markSessionExpired,
  refresh,
  selectedDocumentIds,
  setIndexingActive,
  setUserStartedIngestion,
}: DashboardBulkActionsOptions) {
  const [bulkActionStatus, setBulkActionStatus] = useState<string | null>(null);
  const [bulkActionBusy, setBulkActionBusy] = useState(false);
  const activeBulkRequestsRef = useRef(0);

  const bulkReindexSelected = useCallback(
    async (mode: "enrichment" | "full" | "retry_failed") => {
      if (!selectedDocumentIds.length) return;
      activeBulkRequestsRef.current += 1;
      setBulkActionBusy(true);
      setBulkActionStatus(null);
      let succeeded = 0;
      let failed = 0;
      let submitted = 0;
      let lastEpoch: number | null = null;
      // Every batch must run under the account that started the action; a later
      // send would otherwise register under a new account with the old header.
      let startEpoch: number | null = null;
      let progressStatus = "";
      try {
        for (let offset = 0; offset < selectedDocumentIds.length; offset += 10) {
          if (startEpoch !== null && !isAuthEpochCurrent(startEpoch)) return;
          const send = () =>
            authBoundFetch("/api/documents/bulk/reindex", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authorizationHeader },
              body: JSON.stringify({ documentIds: selectedDocumentIds.slice(offset, offset + 10), mode }),
            });
          let { response, requestEpoch } = await send();
          startEpoch ??= requestEpoch;
          if (response.status === 429 && isAuthEpochCurrent(requestEpoch)) {
            const waitMs = parseRetryAfterMs(response);
            if (waitMs !== null && waitMs <= BULK_RATE_LIMIT_MAX_WAIT_MS) {
              setBulkActionStatus(
                `${progressStatus ? `${progressStatus} ` : ""}Waiting ${Math.ceil(waitMs / 1000)}s before the next batch.`,
              );
              await new Promise((resolve) => setTimeout(resolve, waitMs));
              if (!isAuthEpochCurrent(startEpoch)) return;
              ({ response, requestEpoch } = await send());
            }
          }
          if (requestEpoch !== startEpoch) return;
          lastEpoch = requestEpoch;
          if (!isAuthEpochCurrent(requestEpoch)) return;
          if (response.status === 401) {
            lastEpoch = null;
            markSessionExpired();
            return;
          }
          const payload = await response.json().catch(() => ({}));
          if (!isAuthEpochCurrent(requestEpoch)) return;
          if (!response.ok) throw new Error(payload.error || errorCopy.bulkReindexFailed);
          const summary = summarizeBulkReindexPayload(payload);
          succeeded += summary.succeeded;
          failed += summary.failed;
          submitted = Math.min(offset + 10, selectedDocumentIds.length);
          progressStatus = `Bulk reindex: ${succeeded} queue request${succeeded === 1 ? "" : "s"} succeeded; ${failed} failed.`;
          setBulkActionStatus(progressStatus);
        }
      } catch (error) {
        if (isAbortError(error)) return;
        const message = error instanceof Error ? error.message : errorCopy.bulkReindexFailed;
        // Keep earlier batch totals visible when a later batch fails.
        progressStatus =
          submitted > 0
            ? `${message} (bulk reindex: ${succeeded} succeeded; ${failed} failed; ${selectedDocumentIds.length - submitted} not queued).`
            : message;
        setBulkActionStatus(progressStatus);
      } finally {
        // Earlier batches remain queued even when a later batch fails.
        if (succeeded > 0 && lastEpoch !== null && isAuthEpochCurrent(lastEpoch)) {
          setUserStartedIngestion(true);
          setIndexingActive(true);
          try {
            await refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false });
          } catch (error) {
            // Keep the batch totals: they say what was queued and what to retry.
            if (!isAbortError(error))
              setBulkActionStatus(
                progressStatus ? `${progressStatus} The dashboard could not refresh.` : errorCopy.bulkReindexFailed,
              );
          }
        }
        activeBulkRequestsRef.current -= 1;
        if (activeBulkRequestsRef.current === 0) setBulkActionBusy(false);
      }
    },
    [
      authBoundFetch,
      authorizationHeader,
      isAuthEpochCurrent,
      markSessionExpired,
      refresh,
      selectedDocumentIds,
      setIndexingActive,
      setUserStartedIngestion,
    ],
  );

  const bulkUpdateMetadata = useCallback(
    async (metadata: Record<string, unknown>) => {
      if (!selectedDocumentIds.length || Object.keys(metadata).length === 0) return;
      activeBulkRequestsRef.current += 1;
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
        activeBulkRequestsRef.current -= 1;
        if (activeBulkRequestsRef.current === 0) setBulkActionBusy(false);
      }
    },
    [authBoundFetch, authorizationHeader, isAuthEpochCurrent, markSessionExpired, refresh, selectedDocumentIds],
  );

  const bulkAssignCollection = useCallback(
    async (collection: string) => {
      if (!selectedDocumentIds.length || !collection.trim()) return;
      await bulkUpdateMetadata({ collection: collection.trim() });
    },
    [bulkUpdateMetadata, selectedDocumentIds],
  );

  return {
    bulkActionStatus,
    bulkActionBusy,
    bulkReindexSelected,
    bulkAssignCollection,
    bulkUpdateMetadata,
  };
}
