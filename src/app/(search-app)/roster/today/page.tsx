import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RosterTodayPage } from "@/components/roster/roster-today-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";
import { getWorkModeLaunch } from "@/lib/work-mode-launch/server";

export const metadata: Metadata = {
  title: "Today | Roster | PsychSift",
  description: "Your next shift, this week and your next nights and leave, from your own roster.",
};

// Today folded into Month in the current work mode (owner decision, 11 Oct 2026): Month's top card
// carries its Who is on and Phone numbers buttons. The classic work mode (the rollback) still links
// here from its own tabs, so the page stays for it.
export default async function RosterTodayRoute() {
  if ((await getWorkModeLaunch()).newWorkMode) redirect("/roster");
  return (
    <RosterSampleGate>
      <RosterTodayPage />
    </RosterSampleGate>
  );
}
