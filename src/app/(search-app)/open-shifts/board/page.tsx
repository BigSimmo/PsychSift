import type { Metadata } from "next";

import { OpenShiftsBoardPage } from "@/components/open-shifts/open-shifts-board-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Board | Open shifts | PsychSift",
  description: "Every open shift in your Roster teams at a glance.",
};

export default function OpenShiftsBoardRoute() {
  return (
    <RosterSampleGate>
      <OpenShiftsBoardPage />
    </RosterSampleGate>
  );
}
