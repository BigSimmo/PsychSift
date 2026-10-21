"use client";

import type { ReactNode } from "react";

import { ClinicalSignInNotice } from "@/components/mode-kit/clinical-sign-in-notice";
import { useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";
import type { ClinicalSignInCopy } from "@/lib/front-door-content";

/**
 * #3728: the medicine and differential catalogues and library search need sign-in from
 * 1 November 2026, and their APIs refuse signed-out requests on the server. A signed-out
 * reader sees the sign-in card instead of a screen whose requests would all be refused;
 * nothing renders while the session is still loading, so no refused request is sent.
 */
export function ClinicalCatalogueGate({
  copy,
  testId,
  children,
}: {
  readonly copy: ClinicalSignInCopy;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  const access = useClinicalToolAccess();
  if (access === "checking") return null;
  if (access === "sign-in-required") return <ClinicalSignInNotice copy={copy} testId={testId} />;
  return <>{children}</>;
}
