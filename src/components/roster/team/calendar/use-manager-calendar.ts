"use client";

import { useCallback, useMemo } from "react";

import { useRosterRead } from "@/components/roster/use-roster-team";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import { coverForDay, type CoverCount } from "@/lib/roster/team/cover";
import type {
  RosterAssignment,
  RosterManageOpenShift,
  RosterManageSwap,
  RosterRules,
  RosterTeam,
} from "@/lib/roster/team/model";
import { ruleFlags, swapRuleFlags, type RuleFlag, type SwapRuleFlag } from "@/lib/roster/team/rule-flags";
import { assignmentStartDate } from "@/lib/roster/team/team-view";

export type ManagerCalendar = {
  enabled: boolean;
  /** A manager-only read (`manage` or `maker`) failed, so the manager layer is hidden. */
  unavailable: boolean;
  cover: Map<string, CoverCount[]>;
  flags: Map<string, RuleFlag[]>;
  /**
   * For each waiting swap, the rule flags the roster would gain for its two
   * people once the shifts changed hands. The server does not recheck team
   * rules when a manager approves, so this is the only check on them.
   */
  afterSwap: Map<string, SwapRuleFlag[]>;
  /** Swaps waiting on this manager; never one the manager is part of, which the server refuses. */
  pending: RosterManageSwap[];
  claimed: RosterManageOpenShift[];
  shortDays: string[];
  /**
   * Waiting swaps whose rules could really be checked: the team rules loaded,
   * and both shifts sit in the rows the flags were worked out from, with the
   * rules' full look-back behind them. "Approve all" never approves any other.
   */
  checkable: Set<string>;
  /** Read the manager's swaps and open shifts again after a decision. */
  reload: () => void;
};

const NO_RULES: RosterRules = {};
/** Kept inside `ROSTER_MAX_WINDOW_DAYS` (62) with room to spare. */
const MAX_FLAG_SPAN_DAYS = 60;

/**
 * Days of earlier roster a rule needs to judge a shift: runs of days or nights,
 * the 7 and 14 day hour limits and the minimum break, each with a day to spare
 * for an overnight shift.
 */
export function ruleLookbackDays(rules: RosterRules): number {
  const { minBreakHours, maxNightsInRow, maxDaysInRow, maxHours7d, maxHours14d } = rules;
  return Math.max(
    0,
    minBreakHours === undefined ? 0 : Math.ceil(minBreakHours / 24) + 1,
    maxNightsInRow === undefined ? 0 : maxNightsInRow + 1,
    maxDaysInRow === undefined ? 0 : maxDaysInRow + 1,
    maxHours7d === undefined ? 0 : 8,
    maxHours14d === undefined ? 0 : 15,
  );
}

const failed = (status: string) => status !== "ready" && status !== "loading";

/**
 * The manager layer of the team calendar: cover counts against the team's
 * targets, rule flags, and what is waiting on the manager's decision.
 *
 * Pass every assignment read for the window, not the filtered ones, or a
 * "Just me" view would show every day as short. A member makes no manager
 * reads at all. It is `enabled` only while both the `manage` and `maker` reads
 * have answered, so a failed read leaves the staff calendar as it was.
 *
 * Rule flags are worked out from a wider read that covers the rules' look-back
 * before the window and the same span after it, so a shift at either edge is
 * judged with its neighbours, and a swap is judged by the later shifts it
 * could push over a limit. Where that cannot be done (the rules or that read
 * failed, or the span would not fit the read limit) the swap is not `checkable`.
 */
export function useManagerCalendar(
  team: RosterTeam,
  window: { from: string; to: string },
  rows: RosterAssignment[],
  actorId: string | null,
): ManagerCalendar {
  const isManager = team.role === "manager";
  const serviceId = isManager ? team.serviceId : null;
  const manage = useRosterRead(serviceId, "manage");
  const maker = useRosterRead(serviceId, "maker");
  const overview = useRosterRead(serviceId, "overview");
  const enabled = isManager && manage.status === "ready" && maker.status === "ready";
  const unavailable = isManager && (failed(manage.status) || failed(maker.status));
  const needs = maker.data?.needs;
  const rulesLoaded = overview.status === "ready";
  const rules = overview.data?.settings.rules ?? NO_RULES;
  const { from, to } = window;

  // Rules look back from later shifts, so a swapped shift can break a rule on a
  // shift up to `lookback` days after it: the read reaches that far past `to`
  // as well as before `from`. The whole read stays inside the server's limit;
  // what does not fit is trimmed from the start, and swaps there are not checked.
  const lookback = rulesLoaded ? ruleLookbackDays(rules) : 0;
  const flagTo = addDaysToDate(to, lookback);
  const flagFrom = useMemo(() => {
    const wanted = addDaysToDate(from, -lookback);
    const floor = addDaysToDate(flagTo, -MAX_FLAG_SPAN_DAYS);
    return wanted < floor ? floor : wanted;
  }, [from, flagTo, lookback]);
  const wide = lookback > 0;
  const wideRead = useRosterRead(enabled && rulesLoaded && wide ? team.serviceId : null, "assignments", {
    from: flagFrom,
    to: flagTo,
  });
  const flagRows: readonly RosterAssignment[] | null = !rulesLoaded
    ? null
    : wide
      ? (wideRead.data?.assignments ?? null)
      : rows;
  // The start dates whose whole look-back and look-ahead sit inside the rows.
  const coveredFrom = addDaysToDate(flagFrom, lookback);
  const coveredTo = addDaysToDate(flagTo, -lookback);

  const cover = useMemo(() => {
    const counts = new Map<string, CoverCount[]>();
    if (!enabled || !needs?.length) return counts;
    for (let date = from; date <= to; date = addDaysToDate(date, 1)) {
      const forDay = coverForDay(date, rows, needs);
      if (forDay.length) counts.set(date, forDay);
    }
    return counts;
  }, [enabled, needs, rows, from, to]);

  const flags = useMemo(() => {
    const byShift = new Map<string, RuleFlag[]>();
    if (!enabled || !flagRows) return byShift;
    for (const flag of ruleFlags(flagRows, rules)) {
      const list = byShift.get(flag.assignmentId);
      if (list) list.push(flag);
      else byShift.set(flag.assignmentId, [flag]);
    }
    return byShift;
  }, [enabled, flagRows, rules]);

  const shortDays = useMemo(
    () =>
      [...cover.entries()]
        .filter(([, counts]) => counts.some((count) => count.state === "short"))
        .map(([date]) => date),
    [cover],
  );

  const swaps = manage.data?.swaps;
  const openShifts = manage.data?.openShifts;
  const pending = useMemo(
    () =>
      enabled
        ? (swaps ?? []).filter(
            (swap) => swap.status === "accepted" && swap.requesterId !== actorId && swap.counterpartyId !== actorId,
          )
        : [],
    [enabled, swaps, actorId],
  );
  const claimed = useMemo(
    () => (enabled ? (openShifts ?? []).filter((shift) => shift.status === "claimed") : []),
    [enabled, openShifts],
  );

  const checkable = useMemo(() => {
    const ids = new Set<string>();
    if (!flagRows) return ids;
    const known = new Map(flagRows.map((row) => [row.id, row]));
    for (const swap of pending) {
      const sides = [swap.give, swap.take].filter((side): side is RosterAssignment => side !== null);
      const covered = sides.every((side) => {
        const row = known.get(side.id);
        if (!row) return false;
        const date = assignmentStartDate(row);
        return date >= coveredFrom && date <= coveredTo;
      });
      if (sides.length && covered) ids.add(swap.id);
    }
    return ids;
  }, [flagRows, pending, coveredFrom, coveredTo]);

  const afterSwap = useMemo(() => {
    const bySwap = new Map<string, SwapRuleFlag[]>();
    if (!flagRows) return bySwap;
    for (const swap of pending) {
      const added = swapRuleFlags(flagRows, rules, swap);
      if (added.length) bySwap.set(swap.id, added);
    }
    return bySwap;
  }, [flagRows, rules, pending]);

  const reloadManage = manage.reload;
  const reloadWide = wideRead.reload;
  // The `maker` read carries the team's safe number, which the manager can change in Team settings.
  const reloadMaker = maker.reload;
  const reload = useCallback(() => {
    reloadManage();
    reloadWide();
    reloadMaker();
  }, [reloadManage, reloadWide, reloadMaker]);

  return { enabled, unavailable, cover, flags, afterSwap, pending, claimed, shortDays, checkable, reload };
}
