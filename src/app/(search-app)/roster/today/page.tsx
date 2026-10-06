import type { Metadata } from "next";

import { RosterTodayPage } from "@/components/roster/roster-today-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Today | Roster | PsychSift",
  description: "Your next shift, this week and your next nights and leave, from your own roster.",
};

export default function RosterTodayRoute() {
  return (
    <RosterSampleGate>
      <RosterTodayPage />
    </RosterSampleGate>
  );
}
