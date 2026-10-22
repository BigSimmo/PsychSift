"use client";

import { useRouter } from "next/navigation";

import { ClinicalSignInNotice } from "@/components/mode-kit/clinical-sign-in-notice";
import type { ClinicalSignInCopy } from "@/lib/front-door-content";

/**
 * #3738: the sign-in card a server-gated page renders for a signed-out request. Once sign-in
 * succeeds the page is fetched again from the server, which now sends the record.
 */
export function ClinicalPageSignInNotice({
  copy,
  testId,
}: {
  readonly copy: ClinicalSignInCopy;
  readonly testId: string;
}) {
  const router = useRouter();
  return <ClinicalSignInNotice copy={copy} testId={testId} onSignedIn={() => router.refresh()} />;
}
