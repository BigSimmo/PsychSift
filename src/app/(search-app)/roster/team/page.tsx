import { RosterTeamPage } from "@/components/roster/team/roster-team-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export default function Page() {
  return (
    <RosterSampleGate>
      <RosterTeamPage />
    </RosterSampleGate>
  );
}
