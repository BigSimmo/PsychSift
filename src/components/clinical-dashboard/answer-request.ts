import type { AnswerProgressUpdate } from "@/components/clinical-dashboard/answer-progress";
import {
  answerTimedOutError,
  compactScopeFilters,
  isAbortError,
} from "@/components/clinical-dashboard/clinical-dashboard-helpers";
import {
  makeSearchError,
  readAnswerStream,
  SEARCH_SESSION_EXPIRED_MESSAGE,
} from "@/components/clinical-dashboard/search-utils";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import type { VerifiedEvidencePreviewUnit } from "@/lib/answer-stream-contract";
import type { SearchScopeFilters } from "@/lib/search-scope";
import type { ClinicalQueryMode } from "@/lib/types";

type AnswerRequestOptions = {
  queryText: string;
  filters: SearchScopeFilters;
  queryMode: ClinicalQueryMode;
  selectedDocumentIds: string[];
  clientDemoMode: boolean;
  authorizationHeader: Record<string, string>;
  onProgress: (progress: AnswerProgressUpdate) => void;
  onEvidencePreview: (preview: VerifiedEvidencePreviewUnit | null) => void;
  signal?: AbortSignal;
  onStreamActivity?: () => void;
  timedOut: () => boolean;
  onSessionExpired: () => void;
  networkFailure: () => Error;
};

/** Execute the dashboard answer-stream HTTP contract without growing the dashboard component. */
export async function requestAnswerStream({
  queryText,
  filters,
  queryMode,
  selectedDocumentIds,
  clientDemoMode,
  authorizationHeader,
  onProgress,
  onEvidencePreview,
  signal,
  onStreamActivity,
  timedOut,
  onSessionExpired,
  networkFailure,
}: AnswerRequestOptions) {
  let response: Response;
  try {
    response = await fetch("/api/answer/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(clientDemoMode ? {} : authorizationHeader),
      },
      body: JSON.stringify({
        query: queryText,
        documentIds: selectedDocumentIds.length > 0 ? selectedDocumentIds : undefined,
        filters: compactScopeFilters(filters),
        queryMode,
      }),
      signal,
    });
  } catch (error) {
    if (timedOut()) throw answerTimedOutError();
    if (isAbortError(error)) throw error;
    throw networkFailure();
  }

  if (response.status === 401) {
    onSessionExpired();
    throw makeSearchError(SEARCH_SESSION_EXPIRED_MESSAGE, 401, false);
  }
  if (!response.ok) {
    throw await parseApiErrorResponse(response);
  }

  try {
    const payload = await readAnswerStream(
      response,
      onProgress,
      undefined,
      undefined,
      onStreamActivity,
      onEvidencePreview,
    );
    return {
      kind: "answer" as const,
      query: queryText,
      payload,
    };
  } catch (error) {
    if (timedOut()) throw answerTimedOutError();
    if (isAbortError(error)) throw error;
    throw error;
  }
}
