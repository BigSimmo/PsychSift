import type { Metadata } from "next";

import { OnCallRosterWhosOnPage } from "@/components/on-call/roster-whos-on/on-call-roster-whos-on-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "From your team roster | On Call | PsychSift",
  description:
    "Who is on yesterday, today and tomorrow, read straight from your team's published roster. Names and shifts only.",
};

export default function OnCallRosterWhosOnRoute() {
  // Who is on reads Roster, so signed out it shows Roster's example team.
  return (
    <RosterSampleGate>
      <OnCallRosterWhosOnPage />
    </RosterSampleGate>
  );
}
