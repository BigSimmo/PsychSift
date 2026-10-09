"use client";

import { NeedsYouButton } from "@/components/needs-you/needs-you-button";
import { WorkSearchButton } from "@/components/work-search/work-search-button";
import type { AppModeId } from "@/lib/app-modes";

/**
 * Staff-work trailing header pair: the bell, then AI Search, as two separate
 * round circles.
 * AI Search sits top right on every staff work page (Josh, 2026-10-04).
 * Declared on the mode as `workSearch`, never a mode-id branch here. The bell
 * sits just left of it on every staff work page too (Josh, 7 Oct 2026), for
 * signed-in readers, except the setup walkthrough and help centre, which draw
 * their own top bar (the bell decides that itself). The icons are all the
 * header loads; the search and the Notification centre are lazy chunks.
 */
export function StaffWorkHeaderControls({ modeId }: { modeId: AppModeId }) {
  return (
    <>
      <NeedsYouButton modeId={modeId} />
      <WorkSearchButton modeId={modeId} />
    </>
  );
}
