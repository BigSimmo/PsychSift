import type { Metadata } from "next";

import { RosterTeamPage } from "@/components/roster/team/roster-team-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Team | Roster | PsychSift",
  description: "Your team's roster: who is working, who is off, and open cover.",
};

export default function Page() {
  return (
    <RosterSampleGate>
      <RosterTeamPage />
    </RosterSampleGate>
  );
}
