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
 * requests on its own; this decides only what the page shows. Scoring and therapy
 * ranking run in the browser, so for them this is the only gate (N-03).
 */
export type ClinicalToolAccess = "allowed" | "checking" | "sign-in-required";

type SessionStatus = ReturnType<typeof useAuthSession>["status"];

/**
 * A browser with no Supabase config is a local demo build, so the tools stay open there.
 * A production build only gets that when it is a deliberate demo deploy: otherwise missing
 * config would open the tools to everyone, so they fail closed (N-03, 26 Oct 2026).
 */
function unconfiguredIsDemo(environment: string | undefined = process.env.NODE_ENV) {
  return environment !== "production" || process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export function clinicalToolAccessForStatus(
  status: SessionStatus | null,
  environment: string | undefined = process.env.NODE_ENV,
): ClinicalToolAccess {
  // No auth provider (a bare render) and local no-auth development mode stay open; neither
  // can be production.
  if (status === null || status === "authenticated" || isLocalNoAuthMode()) return "allowed";
  if (status === "unconfigured") return unconfiguredIsDemo(environment) ? "allowed" : "sign-in-required";
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
