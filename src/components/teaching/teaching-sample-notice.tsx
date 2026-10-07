"use client";

import { usePathname } from "next/navigation";

import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
import { TeachingSampleBanner } from "@/components/teaching/teaching-sample-banner";
import { useTeachingSignedOut } from "@/components/teaching/use-teaching-sample";

/**
 * Above every Teaching page except the check-in landing. A visitor who is not
 * signed in sees the shared sign-in notice over the sample (so "Leave the
 * sample" never appears: there is nothing to leave). A signed-in reader who
 * still has the older sample cookie keeps the banner and its way out.
 */
export function TeachingSampleChrome({ cookieSample }: { cookieSample: boolean }) {
  const pathname = usePathname();
  const signedOut = useTeachingSignedOut();
  if (!pathname || /^\/teaching\/c(?:\/|$)/.test(pathname)) return null;
  if (signedOut)
    return (
      <div className="mx-auto w-full max-w-reading px-3 pt-4 sm:px-5 lg:px-7">
        {/* Work-mode redesign, owner request 6 Oct 2026: the spec's short banner wording. */}
        <SignedOutSampleNotice title="Sample, not your data" testId="teaching-signed-out-sample">
          Made-up sessions. Sign in to see your own.
        </SignedOutSampleNotice>
      </div>
    );
  return cookieSample ? <TeachingSampleBanner /> : null;
}
