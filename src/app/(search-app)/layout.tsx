import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SharedSearchAppShell } from "@/components/clinical-dashboard/shared-search-app-shell";
import { LiveVersionProvider } from "@/components/live-version/live-version-provider";
import { PsychiatryVisitRecorder } from "@/components/psychiatry/psychiatry-visit-recorder";
import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";
import { WorkModeLaunchProvider } from "@/components/work-mode-launch/work-mode-launch-provider";
import { clinicalAskModeEnabled } from "@/lib/clinical-ask/authority-registry";
import { projectClinicalAskAvailableModeIds } from "@/lib/clinical-ask/capabilities";
import { getLiveVersion } from "@/lib/live-version/server";
import { getWorkModeLaunch } from "@/lib/work-mode-launch/server";

export const metadata: Metadata = {
  alternates: {
    canonical: "https://psychsift.com.au",
  },
};

const searchAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "MedicalWebPage",
  name: `${BRAND_NAME} Clinical Reference`,
  url: "https://psychsift.com.au",
  description: BRAND_DESCRIPTION,
  audience: {
    "@type": "MedicalAudience",
    audienceType: "Clinician",
  },
};

/**
 * Shared search chrome for mode homes and related routes. Keeping GlobalSearchShell
 * in this route-group layout prevents remounting the composer when navigating
 * between namespaced modes (e.g. /services ↔ /dsm ↔ /).
 *
 * The work-mode launch state is resolved once here, on the server, so the frame
 * is drawn right on the first paint (no flash from the classic band to the new one).
 * The live version switch (src/lib/live-version) is resolved beside it, the same way.
 */
export default async function SearchAppLayout({ children }: { children: ReactNode }) {
  const clinicalAskAvailableModeIds = projectClinicalAskAvailableModeIds(clinicalAskModeEnabled);
  const [workModeLaunch, liveVersion] = await Promise.all([getWorkModeLaunch(), getLiveVersion()]);
  return (
    <>
      <link rel="canonical" href="https://psychsift.com.au" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(searchAppJsonLd) }} />
      <LiveVersionProvider liveVersion={liveVersion}>
        <WorkModeLaunchProvider launch={workModeLaunch}>
          <SharedSearchAppShell clinicalAskAvailableModeIds={clinicalAskAvailableModeIds}>
            {children}
            <PsychiatryVisitRecorder />
          </SharedSearchAppShell>
        </WorkModeLaunchProvider>
      </LiveVersionProvider>
    </>
  );
}
