import type { Metadata } from "next";

import { RosterManagePage } from "@/components/roster/manage/roster-manage-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Manage team | Roster | PsychSift",
  description: "For roster managers: cover needs, swap and leave decisions, and your team's shifts.",
};

export default function Page() {
  return (
    <RosterSampleGate>
      <RosterManagePage />
    </RosterSampleGate>
  );
}
