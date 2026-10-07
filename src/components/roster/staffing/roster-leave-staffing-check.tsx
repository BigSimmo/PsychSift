"use client";

import { CircleAlert, Clock, Info, Users } from "lucide-react";
import type { ReactNode } from "react";

import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { cn } from "@/components/ui-primitives";
import {
  isIsoDate,
  leaveStaffing,
  leaveStaffingWords,
  mondayOf,
  sundayOf,
  staffingWindow,
  type LeaveStaffing,
  type StaffingDay,
  type StaffingWindow,
} from "@/lib/roster/staffing/team-staffing";

import { RosterStaffingLegend, RosterStaffingStrip } from "./roster-staffing-strip";
import { useTeamStaffing } from "./use-team-staffing";

/**
 * Feature #7's staffing check, ready to mount in the Plan leave sheet:
 * `<RosterLeaveStaffingCheck serviceId actorId startsOn endsOn today />`.
 * It makes one assignments read for the weeks around the leave and shows the
 * strip and a one-line result. It never says "safe": PsychSift does not hold
 * the team's safe number, and says so.
 */

export const SAFE_NUMBER_NOTE =
  "Your team's safe number isn't set in PsychSift, so this shows how many are on, not whether that is enough. Your roster manager decides.";

export function StaffingResult({ result }: { readonly result: LeaveStaffing }) {
  const words = leaveStaffingWords(result);
  const Icon = result.kind === "unchecked" ? Clock : result.kind === "partial" ? CircleAlert : Users;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm leading-5",
        result.kind === "checked"
          ? "bg-[color:var(--mode-identity-soft)] text-[color:var(--text-heading)]"
          : "bg-[color:var(--surface-subtle)] text-[color:var(--text)]",
      )}
      data-mode-identity="roster"
      data-testid="staffing-result"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--mode-identity)]" />
      <span>
        <b className="font-semibold">{words.lead}</b> {words.rest}
      </span>
    </p>
  );
}

export function StaffingFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3">
      {children}
    </div>
  );
}

export function StaffingStatusNote({ status, message }: { readonly status: string; readonly message: string | null }) {
  if (status === "unavailable" || status === "error")
    return (
      <p role="alert" className="flex items-start gap-2 text-sm text-[color:var(--text)]">
        <Info aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]" />
        Team staffing couldn&apos;t be checked. {message ?? ""}
      </p>
    );
  if (status === "signed-out" || status === "not-confirmed")
    return <p className="text-sm text-[color:var(--text)]">{message ?? "Sign in to see your team."}</p>;
  return null;
}

export function lowestOf(result: LeaveStaffing): readonly string[] {
  return result.kind === "unchecked" ? [] : result.lowestDays;
}

export function RosterLeaveStaffingCheck({
  serviceId,
  actorId,
  startsOn,
  endsOn,
  today,
}: {
  readonly serviceId: string | null;
  readonly actorId: string | null;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly today: string;
}) {
  const valid = isIsoDate(startsOn) && isIsoDate(endsOn) && endsOn >= startsOn;
  const leave: StaffingWindow | null = valid ? { from: startsOn, to: endsOn } : null;
  const span = staffingWindow(today, leave);
  const staffing = useTeamStaffing(valid ? serviceId : null, span, actorId);
  if (!serviceId || !leave) return null;
  if (staffing.status === "loading") return <ModeModuleSkeleton rows={2} />;
  if (staffing.status !== "ready") return <StaffingStatusNote status={staffing.status} message={staffing.message} />;
  const visible: StaffingDay[] = staffing.days.filter(
    (day) => day.date >= mondayOf(leave.from) && day.date <= sundayOf(leave.to),
  );
  const result = leaveStaffing(staffing.days, leave);
  return (
    <StaffingFrame>
      <RosterStaffingStrip days={visible} leave={leave} today={today} lowestDays={lowestOf(result)} />
      <RosterStaffingLegend showYou={visible.some((day) => day.youWork)} />
      <StaffingResult result={result} />
      <p className="text-xs text-[color:var(--text-muted)]">{SAFE_NUMBER_NOTE}</p>
    </StaffingFrame>
  );
}
