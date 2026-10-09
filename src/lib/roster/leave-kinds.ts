import type { LeaveTypeId } from "@/lib/admin/leave-types";

/**
 * The leave kinds Roster can hold (owner request 8 Oct 2026, "top 20 next steps" item 13).
 *
 * The database check on `roster_leave.kind` lists exactly these. Conference leave is the
 * `pd_leave` kind: the agreement draws it from the same study and professional development
 * leave (cl 18(3) for doctors in training, cl 30 for senior practitioners). Personal leave
 * keeps no reason, only the kind, like every other kind here.
 *
 * Client safe: no figures live here. What each kind allows is in `leave-entitlements.ts`,
 * reached through the Leave wallet card each kind pairs with.
 */
export const ROSTER_LEAVE_KINDS = ["annual", "pd_leave", "exam", "personal"] as const;

export type RosterLeaveKind = (typeof ROSTER_LEAVE_KINDS)[number];

export const ROSTER_LEAVE_KIND_LABEL: Readonly<Record<RosterLeaveKind, string>> = {
  annual: "Annual leave",
  pd_leave: "Conference or PD leave",
  exam: "Exam leave",
  personal: "Personal leave",
};

/** The Leave wallet card whose signed-off figures apply to each kind. */
export const ROSTER_LEAVE_WALLET_CARD: Readonly<Record<RosterLeaveKind, LeaveTypeId>> = {
  annual: "annual",
  pd_leave: "conference",
  exam: "exam",
  personal: "personal",
};

export function isRosterLeaveKind(value: unknown): value is RosterLeaveKind {
  return typeof value === "string" && (ROSTER_LEAVE_KINDS as readonly string[]).includes(value);
}

/** The Roster kind a Leave wallet card is booked as, or null when Roster does not hold it. */
export function rosterLeaveKindForCard(card: LeaveTypeId): RosterLeaveKind | null {
  return ROSTER_LEAVE_KINDS.find((kind) => ROSTER_LEAVE_WALLET_CARD[kind] === card) ?? null;
}
