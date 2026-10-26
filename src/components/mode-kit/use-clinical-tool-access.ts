"use client";

import { isLocalNoAuthMode } from "@/lib/client-env";
import { TERMS_VERSION } from "@/lib/front-door-content";
import { useAuthSession } from "@/lib/supabase/client";
import { readTermsAcceptance } from "@/lib/terms-acceptance";

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
 *
 * "declaration-required" is a signed-in account that has not yet made the "I'm a health
 * professional and I accept the Terms" declaration. The owner moved that declaration to
 * first open, before any clinical tool (D26-07, 26 Oct 2026), so every tool waits on the
 * same tick. Only the account record counts, as on the server.
 */
export type ClinicalToolAccess = "allowed" | "checking" | "sign-in-required" | "declaration-required";

/** True for either locked state: the tool shows its card instead of working. */
export function clinicalToolLocked(access: ClinicalToolAccess): boolean {
  return access === "sign-in-required" || access === "declaration-required";
}

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

/**
 * Adds the declaration to the sign-in decision. A signed-in account is held at
 * "declaration-required" until its account record holds the current Terms version.
 * Local no-auth development has no account and stays open.
 */
export function clinicalToolAccessForSession(
  status: SessionStatus | null,
  userMetadata: unknown,
  environment: string | undefined = process.env.NODE_ENV,
): ClinicalToolAccess {
  const access = clinicalToolAccessForStatus(status, environment);
  if (access !== "allowed" || status !== "authenticated" || isLocalNoAuthMode()) return access;
  return readTermsAcceptance(userMetadata)?.version === TERMS_VERSION ? "allowed" : "declaration-required";
}

/** The session when an `AuthProvider` is mounted; null in a bare render (unit tests). */
function useSessionIfAvailable(): Pick<ReturnType<typeof useAuthSession>, "status" | "session"> | null {
  try {
    return useAuthSession();
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.") return null;
    throw error;
  }
}

export function useClinicalToolAccess(): ClinicalToolAccess {
  const auth = useSessionIfAvailable();
  return clinicalToolAccessForSession(auth?.status ?? null, auth?.session?.user?.user_metadata);
}
