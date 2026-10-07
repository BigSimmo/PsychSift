"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ModeBandStatus } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { RosterSignedOutSampleProvider } from "@/components/roster/roster-sample-context";
import { areaDataState, useExampleData } from "@/lib/example-data/store";
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
 * Roster's example data. While the one example data switch shows examples in
 * Roster it renders the real page answered from invented sample data built in
 * the browser (`roster-sample-fetch`, loaded only now, so it is never part of
 * anyone's first load). Otherwise it renders the page untouched; a signed-out
 * visitor with the switch off then gets each page's own signed-out state. The
 * frame's example data banner says the records are made up.
 *
 * The page's own reads are answered from memory and its writes are refused, so
 * nothing is sent to the server and nothing is kept on the device.
 */
export function RosterSampleGate({ children }: { readonly children: ReactNode }) {
  const status = useAuthStatusIfAvailable();
  const example = useExampleData("rost");
  // Signed in, auto mode waits for a real read to say the roster is empty, so it never hides real shifts.
  // `needsSampleFor` only skips that wait (a signed-out visitor has no real read); it is not an OR around the switch.
  const show = example.active && (needsSampleFor(status) || example.mode === "on" || areaDataState("rost") === "empty");
  if (!show) return <>{children}</>;
  return <SampleRoster>{children}</SampleRoster>;
}

function SampleRoster({ children }: { readonly children: ReactNode }) {
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
      {/* Hides counts; the status line itself draws nothing (the banner says it). */}
      <ModeBandStatus value={{ kind: "sample" }} />
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
