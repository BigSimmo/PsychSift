"use client";

import { useState } from "react";

import {
  decisionAction,
  decisionReviewWords,
  managerReason,
  recheckDecision,
  type ManagerDecision,
  type FreshDecisionRules,
} from "@/components/roster/manage/roster-decision-sheet";
import { postRosterAction } from "@/components/roster/use-roster-team";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import type { RosterAction, RosterManageOpenShift, RosterManageSwap } from "@/lib/roster/team/model";
import type { RuleFlag, SwapRuleFlag } from "@/lib/roster/team/rule-flags";

type Post = (action: RosterAction) => ReturnType<typeof postRosterAction>;
/** The live recheck of one waiting swap: the swap as it stands now, or why it cannot be decided. */
export type SwapRecheck = (
  swap: RosterManageSwap,
) => Promise<
  { ok: true; swap: RosterManageSwap; rules?: FreshDecisionRules } | { ok: false; reason: "unreachable" | "changed" }
>;
type Flags = ReadonlyMap<string, readonly RuleFlag[]>;

/**
 * What the manager layer knows about the waiting swaps' team rules. The server
 * also rechecks team rules when a manager approves a swap unless warnings are
 * explicitly acknowledged (see `rosterCommand` and `useManagerCalendar`).
 */
export type SwapChecks = {
  /** Rule flags on the roster as it is, by assignment id. */
  flags: Flags;
  /** Rule flags each waiting swap would add for its two people, by swap id. */
  afterSwap: ReadonlyMap<string, readonly SwapRuleFlag[]>;
  /** Swaps whose rules could really be checked. */
  checkable: ReadonlySet<string>;
};

export type ApproveAllResult = {
  approved: number;
  refused: { id: string; message: string }[];
  /**
   * Swaps not approved, in plain words: the server answered expired or
   * cancelled, or the live recheck found the swap changed or could not reach
   * the roster, so nothing was sent for it.
   */
  notApproved: { id: string; words: string }[];
  /** Swaps with a rule warning, left for the manager to read. */
  warned: string[];
  /** Swaps whose rules could not be checked, left for the manager to open. */
  notChecked: string[];
};

const SHORT_DAYS_SHOWN = 6;

/** The strip's id, so the Manage page's Approve tab can take the manager straight to it. */
export const NEEDS_YOU_ID = "roster-needs-you";

/** Scrolls to the Needs you strip and moves focus to its heading. */
export function goToNeedsYou() {
  const heading = document.getElementById(`${NEEDS_YOU_ID}-heading`);
  heading?.scrollIntoView({ block: "start" });
  heading?.focus({ preventScroll: true });
}

/**
 * A swap carries a warning when the server said it breaks a team rule, when
 * either shift already breaks one, or when the roster the swap would leave
 * breaks one for either person.
 */
function swapHasWarning(swap: RosterManageSwap, checks: Omit<SwapChecks, "checkable">): boolean {
  return (
    swap.needsManagerBecause === "team_rule" ||
    [swap.give, swap.take].some((side) => side !== null && (checks.flags.get(side.id)?.length ?? 0) > 0) ||
    (checks.afterSwap.get(swap.id)?.length ?? 0) > 0
  );
}

const CANCEL_WORDS: Record<string, string> = {
  withdrawn: "it was withdrawn",
  roster_changed: "the roster changed",
  member_left: "one of them left the team",
  no_longer_fits: "it no longer fits: a shift clash or a grade change",
};

/**
 * Plain words for a swap.approve the server answered without approving:
 * `swap.approve` can come back expired or cancelled instead.
 */
function notApprovedWords(subject: string, result: { status?: string; cancelReason?: string }): string {
  if (result.status === "expired") return `${subject} wasn't approved because it had expired.`;
  if (result.status === "cancelled")
    return `${subject} wasn't approved because ${CANCEL_WORDS[result.cancelReason ?? ""] ?? "it was cancelled"}.`;
  return `${subject} wasn't confirmed as approved. Check the list again.`;
}

/** Plain words for a decision the live recheck stopped before anything was sent. */
function recheckWords(subject: string, reason: "unreachable" | "changed"): string {
  return reason === "unreachable"
    ? `${subject} wasn't sent because the roster could not be rechecked. Try again.`
    : `${subject} wasn't sent because it has changed. The list has been refreshed.`;
}

/**
 * Approves the waiting swaps that could be checked and carry no rule warning,
 * one at a time so each is rechecked by the server on its own. `checkable`
 * names the swaps whose rules were really checked (see `useManagerCalendar`);
 * a swap outside it is reported as not checked and never approved. A swap
 * with a warning is left for the manager to read; a swap the server refuses
 * is reported with the server's own words, and one it answers as expired or
 * cancelled is reported in plain words. Only an answer of "approved" counts.
 *
 * With `recheck`, each swap is rechecked live just before it is sent, the same
 * recheck the Review sheet runs: one that has changed, or could not be
 * rechecked, is skipped and reported, and one the server now says breaks a
 * team rule is left for the manager to read.
 */
export async function approveAllWithoutWarnings(
  pending: readonly RosterManageSwap[],
  checks: SwapChecks,
  post: Post,
  recheck?: SwapRecheck,
): Promise<ApproveAllResult> {
  const result: ApproveAllResult = { approved: 0, refused: [], notApproved: [], warned: [], notChecked: [] };
  for (const swap of pending) {
    if (!checks.checkable.has(swap.id)) {
      result.notChecked.push(swap.id);
      continue;
    }
    if (swapHasWarning(swap, checks)) {
      result.warned.push(swap.id);
      continue;
    }
    if (recheck) {
      const fresh = await recheck(swap);
      if (!fresh.ok) {
        result.notApproved.push({
          id: swap.id,
          words: recheckWords(`The swap between ${swapPeople(swap)}`, fresh.reason),
        });
        continue;
      }
      if (fresh.rules && !fresh.rules.checkable) {
        result.notChecked.push(swap.id);
        continue;
      }
      if (fresh.rules ? fresh.rules.warnings.length > 0 : swapHasWarning(fresh.swap, checks)) {
        result.warned.push(swap.id);
        continue;
      }
    }
    const sent = await post({ action: "swap.approve", swapId: swap.id });
    if (!sent.ok) result.refused.push({ id: swap.id, message: sent.message });
    else if (sent.result.status === "approved") result.approved += 1;
    else
      result.notApproved.push({
        id: swap.id,
        words: notApprovedWords(`The swap between ${swapPeople(swap)}`, sent.result),
      });
  }
  return result;
}

/**
 * Sends a manager's decisions for one team and keeps the answer to show: one
 * decision at a time, the server's words when it refuses. The strip and the
 * shift sheet both decide through this, so a swap is approved the same way
 * from either place, and every decision is first rechecked live with the same
 * recheck the Review sheet runs (`recheckDecision`). The action sent is worked
 * out from the rechecked request; one that has changed since the list loaded
 * is not sent at all.
 */
export function useRosterDecision(serviceId: string, onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [review, setReview] = useState<{
    decision: ManagerDecision;
    rules: FreshDecisionRules;
    words: string[];
  } | null>(null);
  const post: Post = (action) => postRosterAction(serviceId, action);
  const recheck: SwapRecheck = async (swap) => {
    const outcome = await recheckDecision(serviceId, { kind: "swap", item: swap });
    return outcome.ok && outcome.current.kind === "swap"
      ? { ok: true, swap: outcome.current.item, rules: outcome.rules ?? undefined }
      : { ok: false, reason: outcome.ok ? "changed" : outcome.reason };
  };

  async function decide(decision: ManagerDecision, approve: boolean, reviewedFingerprint?: string) {
    if (busy) return;
    setBusy(true);
    setMessage("Rechecking the live roster…");
    setErrors([]);
    const fresh = await recheckDecision(serviceId, decision);
    // A taken shift that is no longer taken (or the reverse) is a different decision.
    if (!fresh.ok || fresh.current.item.status !== decision.item.status) {
      setBusy(false);
      setMessage(null);
      setErrors([recheckWords("This decision", fresh.ok ? "changed" : fresh.reason)]);
      onChanged();
      return;
    }
    const words = decisionReviewWords(fresh.rules);
    if (approve && words.length && reviewedFingerprint !== fresh.rules?.fingerprint) {
      setBusy(false);
      setMessage(null);
      setReview({ decision: fresh.current, rules: fresh.rules!, words });
      return;
    }
    setReview(null);
    const needsRuleAck = Boolean(fresh.rules && (!fresh.rules.checkable || fresh.rules.warnings.length > 0));
    const acknowledged = approve && needsRuleAck && reviewedFingerprint === fresh.rules?.fingerprint;
    const action = decisionAction(fresh.current, approve);
    let sent = await post(action);
    if (!sent.ok && sent.code === "roster_swap_rule_warning" && acknowledged) {
      sent = await post(decisionAction(fresh.current, approve, { acknowledgeRuleWarnings: true }));
    }
    setBusy(false);
    setMessage(null);
    if (!sent.ok) setErrors([sent.message]);
    else if (action.action === "swap.approve" && sent.result.status !== "approved")
      setErrors([notApprovedWords("This swap", sent.result)]);
    onChanged();
  }

  async function approveAll(pending: readonly RosterManageSwap[], checks: SwapChecks) {
    if (busy) return;
    setBusy(true);
    setMessage("Rechecking and approving…");
    setErrors([]);
    const outcome = await approveAllWithoutWarnings(pending, checks, post, recheck);
    setBusy(false);
    setMessage(
      [
        `Approved ${outcome.approved}.`,
        outcome.warned.length
          ? `${outcome.warned.length} left for you to read because a shift has a rule warning.`
          : null,
        outcome.notChecked.length
          ? `${outcome.notChecked.length} not checked, open ${outcome.notChecked.length === 1 ? "it" : "them"} to review.`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
    setErrors([...outcome.refused.map((item) => item.message), ...outcome.notApproved.map((item) => item.words)]);
    onChanged();
  }

  const reviewDialog = (
    <ConfirmDialog
      open={review !== null}
      tone="primary"
      title="Review fresh roster checks"
      description={review?.words.map((words) => (
        <p key={words}>{words}</p>
      ))}
      confirmLabel="Approve after review"
      onCancel={() => setReview(null)}
      onConfirm={() => {
        if (review) void decide(review.decision, true, review.rules.fingerprint);
      }}
      busy={busy}
    />
  );
  return { busy, message, errors, decide, approveAll, reviewDialog };
}

const who = (name: string | null | undefined, fallback: string | null | undefined) =>
  name ?? fallback ?? "A team member";

function swapPeople(swap: RosterManageSwap): string {
  return `${who(swap.requesterName, swap.give?.name)} and ${who(swap.counterpartyName, swap.take?.name)}`;
}

function swapTitle(swap: RosterManageSwap): string {
  return `Swap · ${swapPeople(swap)}`;
}

function personName(swap: RosterManageSwap, userId: string): string {
  return userId === swap.requesterId
    ? who(swap.requesterName, swap.give?.name)
    : who(swap.counterpartyName, swap.take?.name);
}

function openTitle(shift: RosterManageOpenShift): string {
  return `${SHIFT_KIND_LABEL[shift.kind]} on ${formatPerthDay(perthDateOf(shift.startsAt))} was taken · needs your approval`;
}

/**
 * One waiting swap with Approve and Decline in place, and what it would break
 * of the team's rules. `showNotChecked` is set by the strip, where a swap that
 * could not be checked says so; the shift sheet leaves it off, since the
 * manager is already looking at the swap.
 */
export function SwapDecisionRow({
  swap,
  checks,
  showNotChecked = false,
  busy,
  onDecide,
}: {
  swap: RosterManageSwap;
  checks: SwapChecks;
  showNotChecked?: boolean;
  busy: boolean;
  onDecide: (decision: ManagerDecision, approve: boolean) => void;
}) {
  const decision: ManagerDecision = { kind: "swap", item: swap };
  // Two flags can read the same for one person (one rest rule broken by two
  // shifts); the manager needs to read each warning once.
  const afterLines = [
    ...new Set(
      (checks.afterSwap.get(swap.id) ?? []).map(
        (flag) => `After this swap, ${personName(swap, flag.userId)}: ${flag.words}`,
      ),
    ),
  ];
  const sidesFlagged = [swap.give, swap.take].some(
    (side) => side !== null && (checks.flags.get(side.id)?.length ?? 0) > 0,
  );
  return (
    <div className="grid gap-2">
      <span id={`needs-${swap.id}`}>{swapTitle(swap)}</span>
      {swap.needsManagerBecause ? (
        <span className="text-sm text-[color:var(--text-muted)]">{managerReason[swap.needsManagerBecause]}</span>
      ) : null}
      {sidesFlagged ? (
        <span className="text-sm text-[color:var(--warning-text)]">A shift in this swap has a rule warning</span>
      ) : null}
      {afterLines.map((line) => (
        <span key={line} className="text-sm text-[color:var(--warning-text)]">
          {line}
        </span>
      ))}
      {showNotChecked && !checks.checkable.has(swap.id) ? (
        <span className="text-sm text-[color:var(--text-muted)]">Not checked, open it to review</span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          className="min-h-12"
          disabled={busy}
          aria-describedby={`needs-${swap.id}`}
          onClick={() => onDecide(decision, true)}
        >
          Approve
        </Button>
        <Button
          variant="ghost"
          className="min-h-12"
          disabled={busy}
          aria-describedby={`needs-${swap.id}`}
          onClick={() => onDecide(decision, false)}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}

/** The decision's answer: what "Approve all" did, and any refusal in the server's words. */
export function DecisionAnswer({ message, errors }: { message: string | null; errors: readonly string[] }) {
  return (
    <>
      {message ? <p role="status">{message}</p> : null}
      {errors.length ? (
        <div role="alert" className="grid gap-1">
          {errors.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * What is waiting on the manager, above the calendar: swaps and taken open
 * shifts to decide, and days that are short of the team's targets.
 */
export function NeedsYouStrip({
  serviceId,
  pending,
  claimed,
  shortDays,
  checks,
  onChanged,
  onPickDay,
}: {
  serviceId: string;
  pending: readonly RosterManageSwap[];
  claimed: readonly RosterManageOpenShift[];
  shortDays: readonly string[];
  checks: SwapChecks;
  onChanged: () => void;
  onPickDay: (date: string) => void;
}) {
  const { busy, message, errors, decide, approveAll, reviewDialog } = useRosterDecision(serviceId, onChanged);
  if (!pending.length && !claimed.length && !shortDays.length) return null;

  const approvable = pending.filter((swap) => checks.checkable.has(swap.id) && !swapHasWarning(swap, checks)).length;

  return (
    <section
      id={NEEDS_YOU_ID}
      aria-label="Needs you"
      data-print-hide
      data-mode-identity="roster"
      className="grid gap-3 rounded-lg border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] p-3 shadow-[var(--e1)]"
    >
      {reviewDialog}
      <h2
        id={`${NEEDS_YOU_ID}-heading`}
        tabIndex={-1}
        className="flex items-center gap-2 rounded text-base-minus focus-visible:outline-2 focus-visible:outline-[color:var(--focus)] font-semibold text-[color:var(--text-heading)]"
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-[color:var(--mode-identity)]" />
        Needs you
      </h2>
      {pending.length || claimed.length ? (
        <ul className="grid gap-2">
          {pending.map((swap) => (
            <li key={swap.id}>
              <SwapDecisionRow
                swap={swap}
                checks={checks}
                showNotChecked
                busy={busy}
                onDecide={(decision, approve) => void decide(decision, approve)}
              />
            </li>
          ))}
          {claimed.map((shift) => (
            <li key={shift.id} className="grid gap-2">
              <span id={`needs-${shift.id}`}>{openTitle(shift)}</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  className="min-h-12"
                  disabled={busy}
                  aria-describedby={`needs-${shift.id}`}
                  onClick={() => void decide({ kind: "open", item: shift }, true)}
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-12"
                  disabled={busy}
                  aria-describedby={`needs-${shift.id}`}
                  onClick={() => void decide({ kind: "open", item: shift }, false)}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {pending.length ? (
        <Button
          className="min-h-12"
          disabled={busy || approvable === 0}
          onClick={() => void approveAll(pending, checks)}
        >
          Approve all without warnings
        </Button>
      ) : null}
      <DecisionAnswer message={message} errors={errors} />
      {shortDays.length ? (
        <div className="grid gap-1">
          <p className="text-sm text-[color:var(--text-muted)]">Short of your targets</p>
          <div className="flex flex-wrap gap-2">
            {shortDays.slice(0, SHORT_DAYS_SHOWN).map((date) => (
              <Button key={date} className="min-h-12" onClick={() => onPickDay(date)}>
                {formatPerthDay(date)}
              </Button>
            ))}
            {shortDays.length > SHORT_DAYS_SHOWN ? (
              <span className="self-center text-sm">{`and ${shortDays.length - SHORT_DAYS_SHOWN} more`}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
