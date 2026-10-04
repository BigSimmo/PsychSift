import type { Metadata } from "next";

import { RosterShiftsPage } from "@/components/roster/roster-shifts-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Shifts | Roster | PsychSift",
  description: "Your shifts by week and month, and your rostered hours, private to your account.",
};

export default function RosterShiftsRoute() {
  return (
    <RosterSampleGate>
      <RosterShiftsPage />
    </RosterSampleGate>
  );
}
