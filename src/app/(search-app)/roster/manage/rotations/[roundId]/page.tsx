import type { Metadata } from "next";
import { Suspense } from "react";

import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { RotationRoundPage } from "@/components/roster/rotations/admin/round-page";
import { requireLivePreview } from "@/lib/live-version/server";

export const metadata: Metadata = {
  title: "Rotation round | Manage team | Roster | PsychSift",
  description: "Preferences coming in, the allocation to review and adjust, and publishing to calendars.",
};

type RotationRoundRouteProps = { params: Promise<{ roundId: string }> };

export default async function RotationRoundRoute({ params }: RotationRoundRouteProps) {
  await requireLivePreview("rotation-preferences");
  const { roundId } = await params;
  return (
    // The page reads `?edit=1` from the address, so it waits for the browser's search string.
    <Suspense fallback={<ModeModuleSkeleton rows={4} twoLine eyebrow />}>
      <RotationRoundPage roundId={roundId} />
    </Suspense>
  );
}
