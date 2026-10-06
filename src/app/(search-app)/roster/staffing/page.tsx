import type { Metadata } from "next";

import { RosterSampleGate } from "@/components/roster/roster-sample-gate";
import { RosterStaffingPage } from "@/components/roster/staffing/roster-staffing-page";

export const metadata: Metadata = {
  title: "Team staffing | Roster | PsychSift",
  description: "See how many of your team are on each day before you plan leave.",
};

export default function RosterStaffingRoute() {
  return (
    <RosterSampleGate title="Sign in to see your team" records="team staffing">
      <RosterStaffingPage />
    </RosterSampleGate>
  );
}
