"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ModeBandStatus } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
import { RosterSignedOutSampleProvider } from "@/components/roster/roster-sample-context";
import { useAuthSession } from "@/lib/supabase/client";

/** The session when an `AuthProvider` is mounted; null in a bare render (unit tests). */
function useAuthStatusIfAvailable(): string | null {
  try {
    return useAuthSession().status;
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.") return null;
    throw error;
  }
}

/** The same test My Day uses: the reader has to sign in (again) before Roster can read anything. */
function needsSampleFor(status: string | null): boolean {
  return status === "signed_out" || status === "expired";
}

/**
 * The shared signed-out sample for a Roster page. For a signed-in reader (or
 * the local demo build) it renders the page untouched. For a visitor who is
 * not signed in it shows the Sample box above the page, then the real page
 * answered from invented sample data built in the browser (`roster-sample-fetch`,
 * loaded only now, so it is never part of anyone's first load).
 *
 * The page's own reads are answered from memory and its writes are refused, so
 * nothing is sent to the server and nothing is kept on the device.
 */
export function RosterSampleGate({
  children,
  title = "Sign in to see your roster",
  records = "shifts, team and requests",
}: {
  readonly children: ReactNode;
  readonly title?: string;
  /** What signing in shows instead, in the Sample box's sentence. */
  readonly records?: string;
}) {
  const status = useAuthStatusIfAvailable();
  if (!needsSampleFor(status)) return <>{children}</>;
  return (
    <SampleRoster title={title} records={records}>
      {children}
    </SampleRoster>
  );
}

function SampleRoster({
  children,
  title,
  records,
}: {
  readonly children: ReactNode;
  readonly title: string;
  readonly records: string;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let uninstall: (() => void) | null = null;
    let cancelled = false;
    void import("@/components/roster/roster-sample-fetch").then((module) => {
      if (cancelled) return;
      uninstall = module.installRosterSampleFetch();
      setReady(true);
    });
    return () => {
      cancelled = true;
      uninstall?.();
      setReady(false);
    };
  }, []);
  return (
    <>
      <ModeBandStatus value={{ kind: "sample" }} />
      <div className="mx-auto w-full max-w-reading px-3 pt-4 sm:px-5 lg:px-7">
        <SignedOutSampleNotice title={title} testId="roster-signed-out-sample">
          Below is a sample made of invented examples, so you can see how Roster works. Signed in, it shows your own{" "}
          {records}. The sample doesn&apos;t save, and nothing is shared.
        </SignedOutSampleNotice>
      </div>
      {ready ? (
        <RosterSignedOutSampleProvider value>{children}</RosterSignedOutSampleProvider>
      ) : (
        <div className="mx-auto w-full max-w-reading px-3 py-4 sm:px-5 lg:px-7" data-testid="roster-sample-loading">
          <ModeModuleSkeleton rows={3} twoLine eyebrow />
        </div>
      )}
    </>
  );
}
