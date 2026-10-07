import type { Metadata } from "next";

import { ApplicationsPage } from "@/components/cme/applications/applications-page";
import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import { cpdYearOf } from "@/lib/cme/cpd-year";
import { DEMO_CME_INSTANT } from "@/lib/cme/demo-year";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Job applications | CPD | PsychSift",
  description:
    "Your own plan for a recruitment season: dates from the advert, referees and their replies, and a CV that fills itself from your records.",
};

/** Signed out only when the session is plainly missing; any other failure still shows the device record. */
async function signedOut(): Promise<boolean> {
  try {
    const client = await createSupabaseServerClient();
    if (!client) return false;
    const { data, error } = await client.auth.getUser();
    if (error) return error.name === "AuthSessionMissingError";
    return !data.user;
  } catch {
    return false;
  }
}

export default async function CmeApplicationsRoute() {
  // The season is kept on this device, so only the sign-in state is read here; no CPD records.
  const demoMode = isDemoMode();
  const now = demoMode ? DEMO_CME_INSTANT : new Date();
  if (!demoMode && (await signedOut())) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <CmeStateNotice state="signed-out" year={cpdYearOf(now)} heading="Job applications" />
      </main>
    );
  }
  return <ApplicationsPage demoMode={demoMode} now={now} />;
}
