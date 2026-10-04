"use client";

import { ModeNotice } from "@/components/mode-kit/notice";
import { useRosterSignedOutSample } from "@/components/roster/roster-sample-context";

/**
 * Shown while the real-staff team release is held and the server answers with
 * the invented sample team, so a sample is never mistaken for a real roster.
 */
export function RosterSampleNotice({ sample }: { readonly sample: boolean | undefined }) {
  // The signed-out sample has its own Sample box at the top of the page.
  const signedOutSample = useRosterSignedOutSample();
  if (!sample || signedOutSample) return null;
  return (
    <ModeNotice testId="roster-sample-notice">
      Example team. Every name and shift here is made up so you can see how it works. Team rosters aren&apos;t switched
      on for real staff yet, so nothing you do here is saved.
    </ModeNotice>
  );
}

/**
 * Shown when the reader has no shifts of their own and the server answers with
 * the sample doctor's roster. Their own first shift or import replaces it.
 */
export function RosterSampleShiftsNotice({ sample }: { readonly sample: boolean | undefined }) {
  if (!sample) return null;
  return (
    <ModeNotice testId="roster-sample-shifts-notice">
      Example roster. These shifts and the team are made up so you can see how Roster works. Add or import your own
      shifts to replace them.
    </ModeNotice>
  );
}
