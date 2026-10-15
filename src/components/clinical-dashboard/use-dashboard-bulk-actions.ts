"use client";

import { useCallback, useState } from "react";

import { isAbortError } from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import { type RefreshOptions } from "@/components/clinical-dashboard/clinical-dashboard-payloads";
import { summarizeBulkReindexPayload } from "@/lib/bulk-reindex-results";
import { errorCopy } from "@/lib/ui-copy";

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

  const bulkReindexSelected = useCallback(
    async (mode: "enrichment" | "full" | "retry_failed") => {
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
