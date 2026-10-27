import type { Metadata } from "next";

import { OpenShiftsPostedPage } from "@/components/open-shifts/open-shifts-posted-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Post | Open shifts | PsychSift",
  description: "Extra shifts you have posted for your Roster teams.",
};

export default function OpenShiftsPostedRoute() {
  return (
    <RosterSampleGate>
      <OpenShiftsPostedPage />
    </RosterSampleGate>
  );
}
