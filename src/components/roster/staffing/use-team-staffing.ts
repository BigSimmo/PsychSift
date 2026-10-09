"use client";

import { useMemo } from "react";

import { useRosterRead, type RosterTeamStatus } from "@/components/roster/use-roster-team";
import {
  staffingDays,
  type StaffingDay,
  type StaffingNeed,
  type StaffingWindow,
} from "@/lib/roster/staffing/team-staffing";

import { useStaffingNeeds } from "./use-staffing-needs";

/**
 * Who is on each day in `window`, from ONE team `assignments` read (the
 * window is at most 62 days) and the team overview (for how far the
 * published roster reaches), plus the team's safe number (its cover needs,
 * counts only). `needs` is undefined while reading and null when it couldn't
 * be read; the day counts never wait for it. Answers live in React state only:
 * no roster, shift or name data is kept on the device.
 */
export function useTeamStaffing(
  serviceId: string | null,
  span: StaffingWindow,
  actorId: string | null,
): {
  readonly status: RosterTeamStatus;
  readonly days: readonly StaffingDay[];
  readonly knownThrough: string | null;
  readonly needs: readonly StaffingNeed[] | null | undefined;
  readonly message: string | null;
  readonly readAt: Date | null;
  readonly reload: () => void;
} {
  const range = useMemo(() => ({ from: span.from, to: span.to }), [span.from, span.to]);
  const assignments = useRosterRead(serviceId, "assignments", range);
  const overview = useRosterRead(serviceId, "overview");
  const { needs, reload: reloadNeeds } = useStaffingNeeds(serviceId);
  const knownThrough = overview.data?.latestPublication?.periodEnd ?? null;
  const days = useMemo(
    () =>
      assignments.status === "ready" && overview.status === "ready"
        ? staffingDays(assignments.data?.assignments ?? [], range, { actorId, knownThrough })
        : [],
    [assignments.status, assignments.data, overview.status, range, actorId, knownThrough],
  );
  const status: RosterTeamStatus =
    assignments.status === "ready" && overview.status === "ready"
      ? "ready"
      : assignments.status === "loading" || overview.status === "loading"
        ? "loading"
        : assignments.status !== "ready"
          ? assignments.status
          : overview.status;
  const { reload: reloadAssignments } = assignments;
  const { reload: reloadOverview } = overview;
  return {
    status,
    days,
    knownThrough,
    needs,
    message: assignments.message ?? overview.message,
    readAt: assignments.readAt,
    reload: () => {
      reloadAssignments();
      reloadOverview();
      reloadNeeds();
    },
  };
}
