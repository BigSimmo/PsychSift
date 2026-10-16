import { useState } from "react";

import { errorCopy } from "@/lib/ui-copy";
import { summarizeBulkReindexPayload } from "@/lib/bulk-reindex-results";
import { isAbortError } from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import type { RefreshOptions } from "@/components/clinical-dashboard/clinical-dashboard-payloads";

export interface UseDashboardBulkActionsOptions {
  selectedDocumentIds: string[];
  authBoundFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<{ response: Response; requestEpoch: number }>;
  authorizationHeader: Record<string, string>;
  markSessionExpired: () => void;
  isAuthEpochCurrent: (epoch: number) => boolean;
  setUserStartedIngestion: (started: boolean) => void;
  setIndexingActive: (active: boolean) => void;
  refresh: (options: RefreshOptions) => Promise<void>;
}

export function useDashboardBulkActions({
  selectedDocumentIds,
  authBoundFetch,
  authorizationHeader,
  markSessionExpired,
  isAuthEpochCurrent,
  setUserStartedIngestion,
  setIndexingActive,
  refresh,
}: UseDashboardBulkActionsOptions) {
  const [bulkActionStatus, setBulkActionStatus] = useState<string | null>(null);
  const [bulkActionBusy, setBulkActionBusy] = useState(false);

  async function bulkReindexSelected(mode: "enrichment" | "full" | "retry_failed") {
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
  }

  async function bulkAssignCollection(collection: string) {
    if (!selectedDocumentIds.length || !collection.trim()) return;
    await bulkUpdateMetadata({ collection: collection.trim() });
  }

  async function bulkUpdateMetadata(metadata: Record<string, unknown>) {
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
  }

  return {
    bulkActionStatus,
    setBulkActionStatus,
    bulkActionBusy,
    setBulkActionBusy,
    bulkReindexSelected,
    bulkAssignCollection,
    bulkUpdateMetadata,
  };
}
