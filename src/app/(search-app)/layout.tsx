import type { ReactNode } from "react";

import { SharedSearchAppShell } from "@/components/clinical-dashboard/shared-search-app-shell";
import { LiveVersionProvider } from "@/components/live-version/live-version-provider";
import { PsychiatryVisitRecorder } from "@/components/psychiatry/psychiatry-visit-recorder";
import { WorkModeLaunchProvider } from "@/components/work-mode-launch/work-mode-launch-provider";
import { clinicalAskModeEnabled } from "@/lib/clinical-ask/authority-registry";
import { projectClinicalAskAvailableModeIds } from "@/lib/clinical-ask/capabilities";
import { getLiveVersion } from "@/lib/live-version/server";
import { getWorkModeLaunch } from "@/lib/work-mode-launch/server";

/**
 * Shared search chrome for mode homes and related routes. Keeping GlobalSearchShell
 * in this route-group layout prevents remounting the composer when navigating
 * between namespaced modes (e.g. /services ↔ /dsm ↔ /).
 *
 * Canonical URLs and MedicalWebPage JSON-LD stay on the home page only
 * (`(search-app)/page.tsx`). A layout-level canonical would point every
 * search-app route at the home URL and invite search engines to drop them.
 *
 * The work-mode launch state is resolved once here, on the server, so the frame
 * is drawn right on the first paint (no flash from the classic band to the new one).
 * The live version switch (src/lib/live-version) is resolved beside it, the same way.
 */
export default async function SearchAppLayout({ children }: { children: ReactNode }) {
  const clinicalAskAvailableModeIds = projectClinicalAskAvailableModeIds(clinicalAskModeEnabled);
  const [workModeLaunch, liveVersion] = await Promise.all([getWorkModeLaunch(), getLiveVersion()]);
  return (
    <LiveVersionProvider liveVersion={liveVersion}>
      <WorkModeLaunchProvider launch={workModeLaunch}>
        <SharedSearchAppShell clinicalAskAvailableModeIds={clinicalAskAvailableModeIds}>
          {children}
          <PsychiatryVisitRecorder />
        </SharedSearchAppShell>
      </WorkModeLaunchProvider>
    </LiveVersionProvider>
  );
}
