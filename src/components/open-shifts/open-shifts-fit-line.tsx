"use client";

import { Hand } from "lucide-react";
import { useMemo } from "react";

import { WorkCard, WorkIconRow } from "@/components/mode-kit/work";
import { useRosterNow } from "@/components/roster/roster-format";
import { DEFAULT_FILTERS, summariseBrowse } from "@/lib/open-shifts/browse";
import { WINDOW_DAYS } from "@/lib/open-shifts/model";

import { fitsYou } from "./open-shifts-for-you";
import { OPEN_SHIFTS_HREF } from "./open-shifts-ui";
import { useOpenShifts } from "./use-open-shifts";

/**
 * One row on Roster's Month page (12 Oct 2026): how many open shifts fit your
 * roster, so you see them without opening the tab. Nothing shows when none do,
 * or while the list or your roster is still being read.
 */
export function OpenShiftsFitLine() {
  const state = useOpenShifts();
  const now = useRosterNow();
  const count = useMemo(
    () =>
      state.status === "ready"
        ? fitsYou(
            summariseBrowse(state.listings, state.roster, DEFAULT_FILTERS, now, state.rosterStatus).matching,
            Infinity,
          ).length
        : 0,
    [state.status, state.listings, state.roster, state.rosterStatus, now],
  );
  if (count === 0) return null;
  return (
    <WorkCard testId="roster-month-open-shifts">
      <WorkIconRow
        icon={Hand}
        title={`${count} open ${count === 1 ? "shift fits" : "shifts fit"} your roster`}
        sub={`Posted by your teams · next ${WINDOW_DAYS / 7} weeks`}
        href={OPEN_SHIFTS_HREF}
      />
    </WorkCard>
  );
}
