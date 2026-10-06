import type { ReactNode } from "react";

import { SharedSearchAppShell } from "@/components/clinical-dashboard/shared-search-app-shell";
import { PsychiatryVisitRecorder } from "@/components/psychiatry/psychiatry-visit-recorder";
import { clinicalAskModeEnabled } from "@/lib/clinical-ask/authority-registry";
import { projectClinicalAskAvailableModeIds } from "@/lib/clinical-ask/capabilities";

/**
 * Shared search chrome for mode homes and related routes. Keeping GlobalSearchShell
 * in this route-group layout prevents remounting the composer when navigating
 * between namespaced modes (e.g. /services ↔ /dsm ↔ /).
 */
export default function SearchAppLayout({ children }: { children: ReactNode }) {
  const clinicalAskAvailableModeIds = projectClinicalAskAvailableModeIds(clinicalAskModeEnabled);
  return (
    <SharedSearchAppShell clinicalAskAvailableModeIds={clinicalAskAvailableModeIds}>
      {children}
      <PsychiatryVisitRecorder />
    </SharedSearchAppShell>
  );
}
