import type { Metadata } from "next";

import { RosterSampleGate } from "@/components/roster/roster-sample-gate";
import { RosterSickPage } from "@/components/roster/sick/roster-sick-page";

export const metadata: Metadata = {
  title: "Sick for tomorrow | Roster | PsychSift",
  description: "Tell your roster managers you are sick and put the shift up for cover, with 10 seconds to undo.",
};

export default function RosterSickRoute() {
  return (
    <RosterSampleGate>
      <RosterSickPage />
    </RosterSampleGate>
  );
}
