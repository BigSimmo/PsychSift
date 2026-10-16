"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ruleLookbackDays } from "@/components/roster/team/calendar/use-manager-calendar";
import { ruleFlags, swapRuleFlags } from "@/lib/roster/team/rule-flags";
import { RosterSwapTicket } from "@/components/roster/requests/roster-swap-ticket";
import { fetchRosterRead, postRosterAction } from "@/components/roster/use-roster-team";
import { addDaysToDate, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type {
  RosterAction,
  RosterManageOpenShift,
  RosterManageSwap,
  SwapNeedsManagerReason,
} from "@/lib/roster/team/model";

export const managerReason: Record<SwapNeedsManagerReason, string> = {
  team_setting: "Needs you because your team approves every swap",
  within_7_days: "Needs you because it's within 7 days",
  different_grade: "Needs you because they're different grades",
  team_rule: "Needs you because it breaks a team rule",
};
export type ManagerDecision = { kind: "swap"; item: RosterManageSwap } | { kind: "open"; item: RosterManageOpenShift };

export type RecheckOutcome =
  | { ok: true; current: ManagerDecision; checkedAt: Date; rules: FreshDecisionRules | null }
  | { ok: false; reason: "unreachable" | "changed" };

export type FreshDecisionRules = { checkable: boolean; warnings: string[]; fingerprint: string };

export function decisionReviewWords(rules: FreshDecisionRules | null): string[] {
  if (!rules) return [];
  return rules.checkable
    ? rules.warnings
    : ["Team rules could not be fully checked. Review the live roster before approving.", ...rules.warnings];
}

/**
 * The live recheck every manager decision goes through before it is sent:
 * reads the roster around the shift and the manager's list afresh, and finds
 * the request again in a state that can still be decided. The Review sheet,
 * the calendar's Needs you strip and the shift sheet all decide through this,
 * so no approval is ever sent from a list that has gone stale.
 */
export async function recheckDecision(serviceId: string, decision: ManagerDecision): Promise<RecheckOutcome> {
  const manage = await fetchRosterRead(serviceId, "manage");
  if (!manage.ok) return { ok: false, reason: "unreachable" };
  if (decision.kind === "swap") {
    const item = manage.data.swaps.find((row) => row.id === decision.item.id && row.status === "accepted");
    if (!item) return { ok: false, reason: "changed" };
    const overview = await fetchRosterRead(serviceId, "overview");
    const configured = overview.ok ? overview.data.settings?.rules : undefined;
    const rules = configured ?? {};
    const lookback = ruleLookbackDays(rules);
    const sides = [item.give, item.take].filter((side) => side !== null);
    const dates = sides.map((side) => perthDateOf(side.startsAt)).sort();
    const from = dates.length ? addDaysToDate(dates[0]!, -lookback) : null;
    const to = dates.length ? addDaysToDate(dates.at(-1)!, lookback) : null;
    // Never turn a truncated or over-limit read into a clean rule verdict.
    const fits = from !== null && to !== null && (Date.parse(to) - Date.parse(from)) / 86_400_000 <= 61;
    const assignments = fits ? await fetchRosterRead(serviceId, "assignments", { from, to }) : null;
    const rows = assignments?.ok ? assignments.data.assignments : [];
    const known = new Map(rows.map((row) => [row.id, row]));
    const checkable =
      configured !== undefined &&
      assignments?.ok === true &&
      sides.length > 0 &&
      sides.every((side) => {
        const row = known.get(side.id);
        return row?.userId === side.userId && row.startsAt === side.startsAt && row.endsAt === side.endsAt;
      });
    const warnings = checkable
      ? [
          ...new Set([
            ...(item.needsManagerBecause === "team_rule" ? [managerReason.team_rule] : []),
            ...ruleFlags(rows, rules)
              .filter((flag) => sides.some((side) => side.id === flag.assignmentId))
              .map((flag) => flag.words),
            ...swapRuleFlags(rows, rules, item).map((flag) => `After this swap: ${flag.words}`),
          ]),
        ].sort()
      : [];
    const fingerprint = JSON.stringify({
      item,
      configured: configured ?? null,
      checkable,
      warnings,
      rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)),
    });
    return {
      ok: true,
      current: { kind: "swap", item },
      checkedAt: assignments?.ok ? assignments.readAt : manage.readAt,
      rules: { checkable, warnings, fingerprint },
    };
  }
  const item = manage.data.openShifts.find(
    (row) => row.id === decision.item.id && ["reported", "claimed"].includes(row.status),
  );
  if (!item) return { ok: false, reason: "changed" };
  const day = perthDateOf(item.startsAt);
  const assignments = await fetchRosterRead(serviceId, "assignments", {
    from: addDaysToDate(day, -7),
    to: addDaysToDate(day, 7),
  });
  return assignments.ok
    ? { ok: true, current: { kind: "open", item }, checkedAt: assignments.readAt, rules: null }
    : { ok: false, reason: "unreachable" };
}

/** The action a decision sends, worked out from the rechecked request rather than the listed one. */
export function decisionAction(
  current: ManagerDecision,
  approve: boolean,
  options?: { acknowledgeRuleWarnings?: boolean },
): RosterAction {
  return current.kind === "swap"
    ? approve
      ? {
          action: "swap.approve",
          swapId: current.item.id,
          ...(options?.acknowledgeRuleWarnings ? { acknowledgeRuleWarnings: true } : {}),
        }
      : { action: "swap.decline", swapId: current.item.id }
    : current.item.status === "reported"
      ? approve
        ? { action: "open.release", openShiftId: current.item.id, urgent: true }
        : { action: "open.cancel", openShiftId: current.item.id }
      : { action: approve ? "open.approve" : "open.decline", openShiftId: current.item.id };
}

export function RosterDecisionSheet({
  serviceId,
  decision,
  onClose,
  onChanged,
}: {
  serviceId: string;
  decision: ManagerDecision;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [checked, setChecked] = useState<Date | null>(null);
  const [current, setCurrent] = useState<ManagerDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ fingerprint: string; words: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void recheckDecision(serviceId, decision).then((outcome) => {
      if (!alive) return;
      if (!outcome.ok) {
        setError(
          outcome.reason === "unreachable"
            ? "The roster could not be rechecked. Close and try again."
            : "This request has changed. Close to refresh the list.",
        );
        return;
      }
      setCurrent(outcome.current);
      setChecked(outcome.checkedAt);
    });
    return () => {
      alive = false;
    };
  }, [decision, serviceId]);
  async function act(approve: boolean, reviewedFingerprint?: string) {
    if (!current || busy) return;
    setBusy(true);
    const fresh = await recheckDecision(serviceId, current);
    if (!fresh.ok || fresh.current.item.status !== current.item.status) {
      setBusy(false);
      setReview(null);
      setCurrent(null);
      setError("This request could not be rechecked. Close to refresh the list.");
      return;
    }
    const words = decisionReviewWords(fresh.rules);
    if (approve && words.length && reviewedFingerprint !== fresh.rules?.fingerprint) {
      setBusy(false);
      setReview({ fingerprint: fresh.rules!.fingerprint, words });
      return;
    }
    setReview(null);
    const needsRuleAck = Boolean(fresh.rules && (!fresh.rules.checkable || fresh.rules.warnings.length > 0));
    const action = decisionAction(fresh.current, approve, {
      acknowledgeRuleWarnings: approve && needsRuleAck && reviewedFingerprint === fresh.rules?.fingerprint,
    });
    const result = await postRosterAction(serviceId, action);
    onChanged();
    if (!result.ok) {
      if (result.code === "roster_swap_rule_warning") {
        const refreshed = await recheckDecision(serviceId, current);
        setBusy(false);
        if (refreshed.ok) {
          const refreshedWords = decisionReviewWords(refreshed.rules);
          setCurrent(refreshed.current);
          setChecked(refreshed.checkedAt);
          setReview({
            fingerprint: refreshed.rules?.fingerprint ?? "",
            words: refreshedWords.length ? refreshedWords : [result.message],
          });
          return;
        }
      } else {
        setBusy(false);
      }
      setError(result.message);
      setCurrent(null);
      return;
    }
    setBusy(false);
    onClose();
  }
  return (
    <Sheet
      open
      onClose={() => {
        onChanged();
        onClose();
      }}
      title={decision.kind === "swap" ? "Review swap" : "Review cover"}
    >
      <div className="grid gap-4 p-4">
        <ConfirmDialog
          open={review !== null}
          tone="primary"
          title="Review fresh roster checks"
          description={review?.words.map((words) => (
            <p key={words}>{words}</p>
          ))}
          confirmLabel="Approve after review"
          onCancel={() => setReview(null)}
          onConfirm={() => void act(true, review?.fingerprint)}
          busy={busy}
        />
        {current?.kind === "swap" ? (
          <>
            {current.item.give ? <RosterSwapTicket shift={current.item.give} label="Gives" /> : null}
            {current.item.take ? <RosterSwapTicket shift={current.item.take} label="Takes" /> : null}
            {current.item.needsManagerBecause ? <p>{managerReason[current.item.needsManagerBecause]}</p> : null}
          </>
        ) : current ? (
          <p>
            {current.item.shiftCode} · {current.item.kind} · {perthTimeOf(current.item.startsAt)}–
            {perthTimeOf(current.item.endsAt)}
          </p>
        ) : null}
        {checked ? (
          <p className="text-sm text-muted-foreground">
            Rechecked {perthTimeOf(checked.toISOString())}. Eligibility is checked again when you decide.
          </p>
        ) : error ? null : (
          <p role="status">Rechecking the live roster…</p>
        )}
        {error ? <p role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={!current || busy} onClick={() => void act(false)}>
            {current?.kind === "open" && current.item.status === "reported" ? "Cancel request" : "Decline"}
          </Button>
          <Button variant="primary" disabled={!current || busy} onClick={() => void act(true)}>
            {current?.kind === "open" && current.item.status === "reported" ? "Post to team" : "Approve"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
