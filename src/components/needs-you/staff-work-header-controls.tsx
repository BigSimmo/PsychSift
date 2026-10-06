"use client";

import { NeedsYouButton } from "@/components/needs-you/needs-you-button";
import { WorkSearchButton } from "@/components/work-search/work-search-button";
import type { AppModeId } from "@/lib/app-modes";

/**
 * Staff-work trailing header pair: Needs you (homes only) then Search my work.
 * "Search my work" on the staff work modes (Josh, 2026-10-04: top right on
 * every staff page). Declared on the mode as `workSearch`, never a mode-id
 * branch here. The Needs you bell sits before it on signed-in mode homes
 * only; inner pages keep this icon alone so the row never grows a third
 * round control. The icon is all the header loads; the search itself is a
 * lazy chunk fetched on tap.
 */
export function StaffWorkHeaderControls({ modeId }: { modeId: AppModeId }) {
  return (
    <>
      <NeedsYouButton modeId={modeId} />
      <WorkSearchButton modeId={modeId} />
    </>
  );
}
