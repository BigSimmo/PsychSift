import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SharedSearchAppShell } from "@/components/clinical-dashboard/shared-search-app-shell";
import { PsychiatryVisitRecorder } from "@/components/psychiatry/psychiatry-visit-recorder";
import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";
import { clinicalAskModeEnabled } from "@/lib/clinical-ask/authority-registry";
import { projectClinicalAskAvailableModeIds } from "@/lib/clinical-ask/capabilities";

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
 */
export default function SearchAppLayout({ children }: { children: ReactNode }) {
  const clinicalAskAvailableModeIds = projectClinicalAskAvailableModeIds(clinicalAskModeEnabled);
  return (
    <>
      <link rel="canonical" href="https://psychsift.com.au" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(searchAppJsonLd) }} />
      <SharedSearchAppShell clinicalAskAvailableModeIds={clinicalAskAvailableModeIds}>
        {children}
        <PsychiatryVisitRecorder />
      </SharedSearchAppShell>
    </>
  );
}
