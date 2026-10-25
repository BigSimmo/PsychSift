"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { cn, textMuted } from "@/components/ui-primitives";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";

/**
 * "Which goal did this serve?" on one activity's page. Saves as soon as a
 * choice is made, says so, and puts the old choice back if the save fails.
 */
export function CmeEntryGoalPicker({
  entryId,
  goals,
  initialGoalId,
  readOnly,
}: {
  entryId: string;
  goals: readonly CmePlanGoal[];
  initialGoalId: string | null;
  readOnly: boolean;
}) {
  const [goalId, setGoalId] = useState<string | null>(initialGoalId);
  const [status, setStatus] = useState<string | null>(null);
  // The choice the server last confirmed, what a failed save puts back.
  const confirmed = useRef<string | null>(initialGoalId);
  const saving = useRef(false);
  const queued = useRef<{ readonly goalId: string | null } | null>(null);

  if (goals.length === 0) {
    return (
      <p className={cn(textMuted, "text-sm")} data-testid="cme-entry-goal-none">
        No plan goals for this year yet.{" "}
        <Link
          href="/cme/plan"
          className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)]"
        >
          Write your plan
        </Link>
      </p>
    );
  }

  async function saveGoal(next: string | null) {
    const response = await fetch(`/api/cme/entries/${entryId}/goal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalId: next }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? `Could not save the goal (${response.status}).`);
    }
  }

  async function choose(next: string | null) {
    setGoalId(next);
    setStatus("Saving…");
    // One save at a time, in order. A choice made while a save is in flight goes
    // next, so the server and the screen both end on the last choice, and an
    // earlier failure never puts back a value over a later one.
    if (saving.current) {
      queued.current = { goalId: next };
      return;
    }
    saving.current = true;
    let value = next;
    let failure: { readonly error: unknown } | null = null;
    for (;;) {
      try {
        await saveGoal(value);
        confirmed.current = value;
        failure = null;
      } catch (error) {
        failure = { error };
      }
      const pending = queued.current;
      queued.current = null;
      if (!pending) break;
      value = pending.goalId;
    }
    saving.current = false;
    if (!failure) {
      setStatus("Saved.");
    } else {
      const { error } = failure;
      const isOffline =
        (typeof navigator !== "undefined" && !navigator.onLine) ||
        (error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("network")));
      setGoalId(confirmed.current);
      setStatus(
        isOffline
          ? "You are offline. Connect to save this goal selection."
          : error instanceof Error
            ? error.message
            : "Could not save the goal.",
      );
    }
  }

  return (
    <div data-testid="cme-entry-goal">
      <label className="block text-sm font-medium text-[color:var(--text)]" htmlFor={`cme-entry-goal-${entryId}`}>
        Which goal from your plan did this serve?
      </label>
      <select
        id={`cme-entry-goal-${entryId}`}
        value={goalId ?? ""}
        disabled={readOnly}
        onChange={(event) => void choose(event.target.value || null)}
        className="mt-1 block min-h-tap w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--text)]"
      >
        <option value="">No goal</option>
        {goals.map((goal) => (
          <option key={goal.id} value={goal.id}>
            {goal.goal}
          </option>
        ))}
      </select>
      <p role="status" className={cn(textMuted, "mt-1 text-xs")}>
        {status}
      </p>
    </div>
  );
}
