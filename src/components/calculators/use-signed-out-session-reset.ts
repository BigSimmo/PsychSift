"use client";

import { useEffect } from "react";

import { clinicalToolLocked, useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";

const EMPTY: Readonly<Record<string, never>> = Object.freeze({});

/**
 * Questionnaire answers live in the page that owns them, not in the open sheet. On any loss of
 * sign-in (sign-out or an expired session, with or without a calculator open) the whole session
 * is cleared, and nothing is scored from it in the meantime (and likewise while the account has
 * not made the health professional declaration, D26-07), so no earlier score stays on a
 * result card or the "Continue this session" panel for the next person at a shared workstation
 * (docs/decisions/2026-10-20-clinical-decision-tools-need-sign-in.md).
 */
export function useSignedOutSessionReset<T extends Record<string, unknown>>(
  session: T,
  setSession: (next: T) => void,
): T {
  const access = useClinicalToolAccess();
  const denied = clinicalToolLocked(access);
  const hasAnswers = Object.keys(session).length > 0;
  useEffect(() => {
    if (denied && hasAnswers) setSession({} as T);
  }, [denied, hasAnswers, setSession]);
  // Retain a draft during revalidation, without exposing scores before admission.
  return access === "allowed" ? session : (EMPTY as T);
}
