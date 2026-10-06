"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";

import { type DocumentDeleteResult } from "@/components/DocumentManagementActions";
import {
  answerReferencesDocument,
  applyRenamedDocumentToAnswer,
  isAbortError,
} from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import { type RefreshOptions } from "@/components/clinical-dashboard/clinical-dashboard-payloads";
import { type LabelReviewMutationBody } from "@/components/clinical-dashboard/dashboard-contracts";
import { type AnswerPayload } from "@/components/clinical-dashboard/search-utils";
import type { ClientDocumentLabel, ClientDocumentMatch, ClientSearchResult } from "@/lib/answer-client-payload";
import type { ClinicalDocument, DocumentLabel } from "@/lib/types";

type DashboardActionNotice = { tone: "success" | "warning"; message: string } | null;

type DashboardDocumentActionsOptions = {
  authBoundFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<{ response: Response; requestEpoch: number }>;
  authorizationHeader: Record<string, string> | undefined;
  canUsePrivateApis: boolean;
  clientDemoMode: boolean;
  isAuthEpochCurrent: (epoch: number) => boolean;
  markSessionExpired: () => void;
  refresh: (options?: RefreshOptions) => Promise<void>;
  setActionNotice: Dispatch<SetStateAction<DashboardActionNotice>>;
  setAnswer: Dispatch<SetStateAction<AnswerPayload | null>>;
  setDocumentMatches: Dispatch<SetStateAction<ClientDocumentMatch[]>>;
  setDocuments: Dispatch<SetStateAction<ClinicalDocument[]>>;
  setIndexingActionId: Dispatch<SetStateAction<string | null>>;
  setIndexingActive: Dispatch<SetStateAction<boolean>>;
  setSelectedDocumentIds: Dispatch<SetStateAction<string[]>>;
  setSources: Dispatch<SetStateAction<ClientSearchResult[]>>;
  setUserStartedIngestion: Dispatch<SetStateAction<boolean>>;
};

/**
 * Owns the dashboard's per-document actions: ingestion retry, reindex and
 * enrichment, and the rename, label and delete reconcilers that keep the
 * library, the current sources and the current answer in step. Moved verbatim
 * from ClinicalDashboard.tsx; the dashboard still owns the state itself.
 */
export function useDashboardDocumentActions({
  authBoundFetch,
  authorizationHeader,
  canUsePrivateApis,
  clientDemoMode,
  isAuthEpochCurrent,
  markSessionExpired,
  refresh,
  setActionNotice,
  setAnswer,
  setDocumentMatches,
  setDocuments,
  setIndexingActionId,
  setIndexingActive,
  setSelectedDocumentIds,
  setSources,
  setUserStartedIngestion,
}: DashboardDocumentActionsOptions) {
  const retryJob = useCallback(
    async (jobId: string) => {
      setIndexingActionId(jobId);
      try {
        const { response, requestEpoch } = await authBoundFetch(`/api/ingestion/jobs/${jobId}/retry`, {
          method: "POST",
          headers: authorizationHeader,
        });
        if (response.status === 401) {
          markSessionExpired();
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!isAuthEpochCurrent(requestEpoch)) return;
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : "Job retry could not be started.");
        }
        setUserStartedIngestion(true);
        setIndexingActive(true);
        setActionNotice({
          tone: "success",
          message: "Ingestion job retry queued.",
        });
        await refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false });
      } catch (error) {
        if (isAbortError(error)) return;
        setActionNotice({
          tone: "warning",
          message: error instanceof Error ? error.message : "Job retry could not be started.",
        });
      } finally {
        setIndexingActionId(null);
      }
    },
    [
      authBoundFetch,
      authorizationHeader,
      isAuthEpochCurrent,
      markSessionExpired,
      refresh,
      setActionNotice,
      setIndexingActionId,
      setIndexingActive,
      setUserStartedIngestion,
    ],
  );

  const reindexDocument = useCallback(
    async (documentId: string, mode: "full" | "enrichment" = "full") => {
      setIndexingActionId(documentId);
      try {
        const { response, requestEpoch } = await authBoundFetch(`/api/documents/${documentId}/reindex`, {
          method: "POST",
          headers: {
            ...authorizationHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ mode }),
        });
        if (response.status === 401) {
          markSessionExpired();
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!isAuthEpochCurrent(requestEpoch)) return;
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : mode === "enrichment"
                ? "Document enrichment could not be started."
                : "Document reindex could not be started.",
          );
        }
        setUserStartedIngestion(true);
        setIndexingActive(true);
        setActionNotice({
          tone: "success",
          message: mode === "enrichment" ? "Document enrichment refreshed." : "Document reindex queued.",
        });
        await refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false });
      } catch (error) {
        if (isAbortError(error)) return;
        setActionNotice({
          tone: "warning",
          message: error instanceof Error ? error.message : "Document reindex could not be started.",
        });
      } finally {
        setIndexingActionId(null);
      }
    },
    [
      authBoundFetch,
      authorizationHeader,
      isAuthEpochCurrent,
      markSessionExpired,
      refresh,
      setActionNotice,
      setIndexingActionId,
      setIndexingActive,
      setUserStartedIngestion,
    ],
  );
  const enrichDocument = useCallback(
    (documentId: string) => reindexDocument(documentId, "enrichment"),
    [reindexDocument],
  );

  const handleDocumentRenamed = useCallback(
    (updatedDocument: ClinicalDocument) => {
      setDocuments((current) =>
        current.map((document) =>
          document.id === updatedDocument.id ? { ...document, ...updatedDocument } : document,
        ),
      );
      setSources((current) =>
        current.map((source) =>
          source.document_id === updatedDocument.id ? { ...source, title: updatedDocument.title } : source,
        ),
      );
      setDocumentMatches((current) =>
        current.map((document) =>
          document.document_id === updatedDocument.id ? { ...document, title: updatedDocument.title } : document,
        ),
      );
      setAnswer((current) => applyRenamedDocumentToAnswer(current, updatedDocument));
    },
    [setAnswer, setDocumentMatches, setDocuments, setSources],
  );

  const handleDocumentLabelsUpdated = useCallback(
    (documentId: string, labels: DocumentLabel[]) => {
      setDocuments((current) =>
        current.map((document) => (document.id === documentId ? { ...document, labels } : document)),
      );
      setDocumentMatches((current) =>
        current.map((document) => (document.document_id === documentId ? { ...document, labels } : document)),
      );
      setSources((current) =>
        current.map((source) => (source.document_id === documentId ? { ...source, document_labels: labels } : source)),
      );
    },
    [setDocumentMatches, setDocuments, setSources],
  );

  const handleDocumentLabelPatched = useCallback(
    (documentId: string, label: DocumentLabel) => {
      function mergeLabel<T extends ClientDocumentLabel>(labels: T[] | null | undefined): (T | DocumentLabel)[] {
        const current = labels ?? [];
        let replaced = false;
        const next = current.map((item) => {
          if (!("id" in item) || item.id !== label.id) return item;
          replaced = true;
          return label;
        });
        // Public answer labels have no mutation identity. The normal full-array
        // response reconciles them; this compatibility fallback must not append
        // a renamed label alongside its unidentified previous value.
        return replaced || current.some((item) => !("id" in item)) ? next : [label, ...next];
      }

      setDocuments((current) =>
        current.map((document) =>
          document.id === documentId ? { ...document, labels: mergeLabel(document.labels) } : document,
        ),
      );
      setDocumentMatches((current) =>
        current.map((document) =>
          document.document_id === documentId ? { ...document, labels: mergeLabel(document.labels) } : document,
        ),
      );
      setSources((current) =>
        current.map((source) =>
          source.document_id === documentId
            ? { ...source, document_labels: mergeLabel(source.document_labels) }
            : source,
        ),
      );
    },
    [setDocumentMatches, setDocuments, setSources],
  );

  const mutateDocumentLabel = useCallback(
    async (documentId: string, method: "POST" | "PATCH", body: LabelReviewMutationBody) => {
      if (!canUsePrivateApis) return false;
      try {
        const { response, requestEpoch } = await authBoundFetch(`/api/documents/${documentId}/labels`, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(clientDemoMode ? {} : authorizationHeader),
          },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!isAuthEpochCurrent(requestEpoch)) return false;
        if (response.status === 401) {
          markSessionExpired();
          return false;
        }
        if (!response.ok) {
          setActionNotice({
            tone: "warning",
            message: typeof payload?.error === "string" ? payload.error : "Label update failed.",
          });
          return false;
        }
        if (Array.isArray(payload.labels)) {
          handleDocumentLabelsUpdated(documentId, payload.labels as DocumentLabel[]);
        } else if (payload.label && typeof payload.label === "object") {
          handleDocumentLabelPatched(documentId, payload.label as DocumentLabel);
        }
        setActionNotice({ tone: "success", message: "Document label review updated." });
        return true;
      } catch (error) {
        if (isAbortError(error)) return false;
        setActionNotice({ tone: "warning", message: "Label update failed." });
        return false;
      }
    },
    [
      authBoundFetch,
      authorizationHeader,
      canUsePrivateApis,
      clientDemoMode,
      handleDocumentLabelPatched,
      handleDocumentLabelsUpdated,
      isAuthEpochCurrent,
      markSessionExpired,
      setActionNotice,
    ],
  );

  const handleDocumentDeleted = useCallback(
    (result: DocumentDeleteResult) => {
      setDocuments((current) => current.filter((document) => document.id !== result.documentId));
      setSelectedDocumentIds((current) => current.filter((documentId) => documentId !== result.documentId));
      setSources((current) => current.filter((source) => source.document_id !== result.documentId));
      setDocumentMatches((current) => current.filter((document) => document.document_id !== result.documentId));
      setAnswer((current) => (answerReferencesDocument(current, result.documentId) ? null : current));
      if (result.storageWarnings.length > 0) {
        setActionNotice({
          tone: "warning",
          message: `Document deleted. Storage cleanup needs review: ${result.storageWarnings.join("; ")}`,
        });
      } else {
        setActionNotice({ tone: "success", message: "Document deleted." });
      }
      void refresh({ includeSetup: false, includeDashboardData: true, includeDocumentMeta: false }).catch(
        () => undefined,
      );
    },
    [refresh, setActionNotice, setAnswer, setDocumentMatches, setDocuments, setSelectedDocumentIds, setSources],
  );

  return {
    retryJob,
    reindexDocument,
    enrichDocument,
    handleDocumentRenamed,
    mutateDocumentLabel,
    handleDocumentDeleted,
  };
}
