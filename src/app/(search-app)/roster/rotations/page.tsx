import type { Metadata } from "next";

import { RotationsHomePage } from "@/components/roster/rotations/rotations-home-page";
import { requireLivePreview } from "@/lib/live-version/server";

export const metadata: Metadata = {
  title: "Rotations | Roster | PsychSift",
  description: "Rank your rotations when a round opens, and see the year you were given.",
};

// No RosterSampleGate: `useRotations` reads Roster's example data itself.
export default async function RosterRotationsRoute() {
  await requireLivePreview("rotation-preferences");
  return <RotationsHomePage />;
}
