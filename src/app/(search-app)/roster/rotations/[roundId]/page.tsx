import type { Metadata } from "next";

import { RotationRankPage } from "@/components/roster/rotations/rotation-rank-page";
import { requireLivePreview } from "@/lib/live-version/server";

export const metadata: Metadata = {
  title: "Rotations | Roster | PsychSift",
  description: "Rank the rotations in a round, or see the year you were given.",
};

/** Round ids can hold characters a path escapes; read them back as written. */
function decodeRoundId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// No RosterSampleGate: `useRotations` reads Roster's example data itself.
export default async function RosterRotationRoundRoute({ params }: { params: Promise<{ roundId: string }> }) {
  await requireLivePreview("rotation-preferences");
  const { roundId } = await params;
  return <RotationRankPage roundId={decodeRoundId(roundId)} />;
}
