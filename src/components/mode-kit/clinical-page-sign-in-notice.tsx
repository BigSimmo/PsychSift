"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { ClinicalSignInNotice } from "@/components/mode-kit/clinical-sign-in-notice";
import { useClinicalToolAccess } from "@/components/mode-kit/use-clinical-tool-access";
import type { ClinicalSignInCopy } from "@/lib/front-door-content";

/**
 * #3738: the sign-in card a server-gated page renders for a signed-out request. Once sign-in
 * succeeds the page is fetched again from the server, which now sends the record. A signed-in
 * account without the declaration gets the declaration card instead (D26-07), and the page is
 * fetched again once the browser sees the declaration saved: only on that change, so a server
 * that still refuses can never start a refresh loop.
 */
export function ClinicalPageSignInNotice({
  copy,
  testId,
}: {
  readonly copy: ClinicalSignInCopy;
  readonly testId: string;
}) {
  const router = useRouter();
  const access = useClinicalToolAccess();
  const previous = useRef(access);
  useEffect(() => {
    if (previous.current === "declaration-required" && access === "allowed") router.refresh();
    previous.current = access;
  }, [access, router]);
  return <ClinicalSignInNotice copy={copy} testId={testId} onSignedIn={() => router.refresh()} />;
}
