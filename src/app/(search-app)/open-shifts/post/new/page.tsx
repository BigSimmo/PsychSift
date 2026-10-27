import type { Metadata } from "next";

import { OpenShiftsPostPage } from "@/components/open-shifts/open-shifts-post-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Post a shift | Open shifts | PsychSift",
  description: "Advertise an extra shift to your Roster team.",
};

export default function OpenShiftsPostRoute() {
  return (
    <RosterSampleGate>
      <OpenShiftsPostPage />
    </RosterSampleGate>
  );
}
