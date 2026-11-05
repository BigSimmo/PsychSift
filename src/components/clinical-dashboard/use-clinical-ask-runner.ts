"use client";

import { useCallback } from "react";
import type { ClinicalAskModeId } from "@/lib/clinical-ask/contracts";
import { identifierShapeWarning } from "@/lib/clinical-ask/context";
import type { useClinicalAskSession } from "@/components/clinical-dashboard/clinical-ask-session-context";

type ClinicalAskSession = ReturnType<typeof useClinicalAskSession>;

export function useClinicalAskRunner({
  clinicalAskMode,
  clinicalAskOnline,
  clinicalAskSession,
  query,
}: {
  clinicalAskMode: ClinicalAskModeId | null;
  clinicalAskOnline: boolean;
  clinicalAskSession: ClinicalAskSession;
  query: string;
}) {
  return useCallback(
    (queryOverride?: unknown) => {
      const submittedQuery = (typeof queryOverride === "string" ? queryOverride : query).trim();
      if (!clinicalAskMode || !submittedQuery) return;

      clinicalAskSession.setDraft(submittedQuery, clinicalAskMode);
      clinicalAskSession.submit(clinicalAskMode, clinicalAskSession.confirmedContext);

      if (identifierShapeWarning(submittedQuery)) {
        clinicalAskSession.receiveEvent({
          type: "error",
          code: "identifiable_input_blocked",
          retryable: false,
          message: "Remove identifying details before using Smart mode.",
        });
        return;
      }

      if (!clinicalAskOnline) {
        clinicalAskSession.receiveEvent({
          type: "error",
          code: "provider_unavailable",
          retryable: true,
          message: "A connection is required for a Smart answer. Your question remains only in this tab.",
        });
        return;
      }

      const controller = new AbortController();
      clinicalAskSession.setAbortController(controller);
      let terminalEventDelivered = false;
      const receiveCurrentEvent = (event: Parameters<ClinicalAskSession["receiveEvent"]>[0]) => {
        if (controller.signal.aborted) return;
        if (event.type === "final" || event.type === "error") terminalEventDelivered = true;
        clinicalAskSession.receiveEvent(event);
      };
      void import("@/lib/clinical-ask/client-stream")
        .then(({ streamClinicalAsk }) => {
          if (controller.signal.aborted) return;
          return streamClinicalAsk(
            {
              mode: clinicalAskMode,
              question: submittedQuery,
              confirmedContext: clinicalAskSession.confirmedContext,
              clarificationAnswers: clinicalAskSession.clarificationAnswers,
              priorTurns: [],
              allowExternalFallback: true,
              inputTransport: "typed",
            },
            controller.signal,
            receiveCurrentEvent,
          );
        })
        .then((payload) => {
          // HTTP, parse, and network failures can return a failed payload before
          // delivering a terminal event. Close the pending state exactly once.
          if (!controller.signal.aborted && payload?.response.state === "failed" && !terminalEventDelivered) {
            receiveCurrentEvent({
              type: "error",
              code: payload.response.code,
              retryable: payload.response.retryable,
              message: payload.response.message,
            });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted && !terminalEventDelivered) {
            const isOffline =
              (typeof navigator !== "undefined" && !navigator.onLine) ||
              (error instanceof TypeError && error.message.includes("fetch"));
            receiveCurrentEvent({
              type: "error",
              code: "provider_unavailable",
              retryable: true,
              message: isOffline
                ? "A connection is required for a Smart answer. Connect to the internet and try again."
                : error instanceof Error
                  ? error.message
                  : "Could not load the answer engine.",
            });
          }
        })
        .finally(() => clinicalAskSession.releaseAbortController(controller));
    },
    [clinicalAskMode, clinicalAskOnline, clinicalAskSession, query],
  );
}
