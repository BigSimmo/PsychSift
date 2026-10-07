import type { Metadata } from "next";

import { RosterSwapsPage } from "@/components/roster/swaps/roster-swaps-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Swaps | Roster | PsychSift",
  description: "Answer, follow and withdraw shift swaps, and take open shifts.",
};

export default function RosterSwapsRoute() {
  return (
    <RosterSampleGate>
      <RosterSwapsPage />
    </RosterSampleGate>
  );
}
