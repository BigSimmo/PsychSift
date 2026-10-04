import type { Metadata } from "next";

import { RosterRequestsPage } from "@/components/roster/requests/roster-requests-page";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Requests | Roster | PsychSift",
  description: "Swap or give away a shift, set dates you cannot work, and plan leave.",
};

export default function RosterRequestsRoute() {
  return (
    <RosterSampleGate title="Sign in to see your requests" records="swap, leave and day-off requests">
      <RosterRequestsPage />
    </RosterSampleGate>
  );
}
