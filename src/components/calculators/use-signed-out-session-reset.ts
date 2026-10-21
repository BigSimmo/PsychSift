"use client";

import { useEffect } from "react";

import { useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";

const EMPTY: Readonly<Record<string, never>> = Object.freeze({});

/**
 * Questionnaire answers live in the page that owns them, not in the open sheet. On any loss of
 * sign-in (sign-out or an expired session, with or without a calculator open) the whole session
 * is cleared, and nothing is scored from it in the meantime, so no earlier score stays on a
 * result card or the "Continue this session" panel for the next person at a shared workstation
 * (docs/decisions/2026-10-20-clinical-decision-tools-need-sign-in.md).
 */
export function useSignedOutSessionReset<T extends Record<string, unknown>>(
  session: T,
  setSession: (next: T) => void,
): T {
  const locked = useClinicalToolAccess() === "sign-in-required";
  const hasAnswers = Object.keys(session).length > 0;
  useEffect(() => {
    if (locked && hasAnswers) setSession({} as T);
  }, [locked, hasAnswers, setSession]);
  return locked ? (EMPTY as T) : session;
}
