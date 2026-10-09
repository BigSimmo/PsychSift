import type { Metadata } from "next";
import { Suspense } from "react";

import { RosterHome } from "@/components/roster/roster-home";
import { RosterSampleGate } from "@/components/roster/roster-sample-gate";

export const metadata: Metadata = {
  title: "Roster | PsychSift",
  description: "Your month of shifts, what needs you, and your hours and rest, private to your account.",
};

export default function RosterHomeRoute() {
  return (
    <RosterSampleGate>
      <Suspense fallback={null}>
        <RosterHome />
      </Suspense>
    </RosterSampleGate>
  );
}
