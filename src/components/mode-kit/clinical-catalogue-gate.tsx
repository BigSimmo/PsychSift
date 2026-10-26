"use client";

import type { ReactNode } from "react";

import { ClinicalSignInNotice } from "@/components/mode-kit/clinical-sign-in-notice";
import { clinicalToolLocked, useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";
import type { ClinicalSignInCopy } from "@/lib/front-door-content";

/**
 * #3728: the medicine and differential catalogues and library search need sign-in from
 * 1 November 2026, and their APIs refuse signed-out requests on the server. A signed-out
 * reader sees the sign-in card instead of a screen whose requests would all be refused;
 * nothing renders while the session is still loading, so no refused request is sent.
 * `serverSignedIn` (#3738) is set by a layout that already checked sign-in on the server,
 * so its server-rendered content shows while the browser session loads. A signed-in account
 * without the health professional declaration gets the declaration card (D26-07).
 */
export function ClinicalCatalogueGate({
  copy,
  testId,
  children,
  serverSignedIn = false,
}: {
  readonly copy: ClinicalSignInCopy;
  readonly testId: string;
  readonly children: ReactNode;
  readonly serverSignedIn?: boolean;
}) {
  const access = useClinicalToolAccess();
  if (access === "checking") return serverSignedIn ? <>{children}</> : null;
  if (clinicalToolLocked(access)) return <ClinicalSignInNotice copy={copy} testId={testId} />;
  return <>{children}</>;
}
