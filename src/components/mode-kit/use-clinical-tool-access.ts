"use client";

import { isLocalNoAuthMode } from "@/lib/client-env";
import { useAuthSession } from "@/lib/supabase/client";

/**
 * Whether this browser may use the clinical decision tools: Answer, the medicine
 * Patient details panel and its interaction flags, therapy ranking, questionnaire
 * scoring and the original documents. They need sign-in from 1 November 2026,
 * because the amended TGA exemption covers only software for health professionals
 * (docs/decisions/2026-10-20-clinical-decision-tools-need-sign-in.md).
 *
 * "checking" while the session is still loading, so a signed-in reader never sees a
 * sign-in card flash past. The server refuses Answer and the originals to signed-out
 * requests on its own; this decides only what the page shows.
 */
export type ClinicalToolAccess = "allowed" | "checking" | "sign-in-required";

type SessionStatus = ReturnType<typeof useAuthSession>["status"];

export function clinicalToolAccessForStatus(status: SessionStatus | null): ClinicalToolAccess {
  // No auth provider (a bare render), no Supabase config (demo mode, synthetic content
  // only) and local no-auth development mode stay open; none of them can be production.
  if (status === null || status === "unconfigured" || status === "authenticated" || isLocalNoAuthMode()) {
    return "allowed";
  }
  if (status === "loading") return "checking";
  return "sign-in-required";
}

/** The session status when an `AuthProvider` is mounted; null in a bare render (unit tests). */
function useSessionStatusIfAvailable(): SessionStatus | null {
  try {
    return useAuthSession().status;
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.") return null;
    throw error;
  }
}

export function useClinicalToolAccess(): ClinicalToolAccess {
  return clinicalToolAccessForStatus(useSessionStatusIfAvailable());
}
