import { useState } from "react";

import type { AnswerFeedbackType } from "@/lib/answer-feedback";
import type { AnswerPayload } from "@/components/clinical-dashboard/search-utils";
import type { ClientSearchResult } from "@/lib/answer-client-payload";

export interface DashboardActionNotice {
  tone: "success" | "warning";
  message: string;
}

export interface UseDashboardAnswerFeedbackOptions {
  answer: AnswerPayload | null;
  sources: ClientSearchResult[];
  clientDemoMode: boolean;
  authorizationHeader: Record<string, string>;
  markSessionExpired: () => void;
  setActionNotice: (notice: DashboardActionNotice | null) => void;
}

export function useDashboardAnswerFeedback({
  answer,
  sources,
  clientDemoMode,
  authorizationHeader,
  markSessionExpired,
  setActionNotice,
}: UseDashboardAnswerFeedbackOptions) {
  const [pendingFeedback, setPendingFeedback] = useState<AnswerFeedbackType | null>(null);

  async function submitAnswerFeedback(feedbackType: AnswerFeedbackType, note?: string) {
    if (!answer || pendingFeedback) return;
    if (clientDemoMode) {
      setActionNotice({ tone: "warning", message: "Answer review is unavailable for synthetic demo answers." });
      return;
    }
    if (!answer.interactionId || !answer.feedbackToken) {
      setActionNotice({ tone: "warning", message: "This answer predates traceable feedback. Run the question again." });
      return;
    }

    setPendingFeedback(feedbackType);
    try {
      const sourceChunkIds = Array.from(new Set(sources.map((source) => source.id).filter(Boolean)));
      const citedChunkIds = Array.from(new Set(answer.citations.map((citation) => citation.chunk_id).filter(Boolean)));
      const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(answer.answer));
      const answerHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const response = await fetch("/api/answer-feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authorizationHeader,
        },
        body: JSON.stringify({
          interactionId: answer.interactionId,
          feedbackToken: answer.feedbackToken,
          feedbackCategory: feedbackType,
          answerHash,
          sourceIds: sourceChunkIds,
          citedSourceIds: citedChunkIds,
          route: answer.routingMode ?? null,
          model: null,
          providerRequestIds: [],
          ...(note ? { note } : {}),
        }),
      });

      if (response.status === 401) {
        markSessionExpired();
        setActionNotice({ tone: "warning", message: "The session could not be validated for feedback." });
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.error === "string" ? payload.error : "Answer review could not be saved.");
      }
      setActionNotice({
        tone: "success",
        message: feedbackType === "verified" ? "Verified answer feedback saved." : "Answer issue feedback saved.",
      });
    } catch (feedbackError) {
      setActionNotice({
        tone: "warning",
        message: feedbackError instanceof Error ? feedbackError.message : "Answer review could not be saved.",
      });
    } finally {
      setPendingFeedback(null);
    }
  }

  return {
    pendingFeedback,
    setPendingFeedback,
    submitAnswerFeedback,
  };
}
