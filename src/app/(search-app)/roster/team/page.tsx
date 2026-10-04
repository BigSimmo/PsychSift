import { RosterTeamPage } from "@/components/roster/team/roster-team-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export default function Page() {
  return (
    <RosterSampleGate title="Sign in to see your team" records="team and its calendar">
      <RosterTeamPage />
    </RosterSampleGate>
  );
}
