"use client";

import { Check, NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { cardSurface } from "@/components/card-recipes";
import { cmePageTitle, cmePageWidth } from "@/components/cme/cme-page-frame";
import { Button } from "@/components/ui/button";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import {
  cn,
  controlDisabled,
  eyebrowText,
  floatingControl,
  InlineNotice,
  primaryControl,
  textMuted,
} from "@/components/ui-primitives";
import { formatCalendarDateLong } from "@/lib/cme/cpd-year";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import {
  CME_PLAN_GOAL_MAX,
  CME_PLAN_GOAL_MAX_LENGTH,
  CME_PLAN_GOAL_MIN_LENGTH,
  hoursByGoal,
  type CmePlanGoal,
} from "@/lib/cme/plan-goals";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { canCarryCmeGoals, carryableCmeGoals } from "@/lib/cme/year-close-actions";
import { CmePlanGoalSplit } from "@/components/cme/cme-plan-goal-split";

/**
 * DEVELOPMENT PLAN — the year's goals, written once near the start of the
 * year and checked against as it goes.
 *
 * Three parts: the goals themselves (edited as a list and saved in one step),
 * whether the plan is marked written for the year's requirement, and at the
 * bottom how the year's hours have fallen across the goals. Each activity
 * names its goal on its own page, so the tally fills in as activities are
 * linked.
 *
 * The goals are the owner's own words. The app suggests nothing.
 */

type Draft = { key: string; id?: string; goal: string };

let draftKey = 0;
function nextKey(): string {
  draftKey += 1;
  return `goal-${draftKey}`;
}

export function CmePlanPage({
  set,
  goals,
  entries,
  demoMode = false,
  now = new Date(),
  nextYearConfirmed = null,
  nextYearGoals,
}: {
  set: CmeRequirementSet;
  goals: readonly CmePlanGoal[];
  entries: readonly CmeEntry[];
  demoMode?: boolean;
  now?: Date;
  /** Null means the next year's targets were not loaded. */
  nextYearConfirmed?: boolean | null;
  /** Required before enabling carry, so adding a goal cannot replace or duplicate a saved next-year goal. */
  nextYearGoals?: readonly CmePlanGoal[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    goals.length
      ? goals.map((goal) => ({ key: nextKey(), id: goal.id, goal: goal.goal }))
      : [{ key: nextKey(), goal: "" }],
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [carryingId, setCarryingId] = useState<string | null>(null);
  const [carriedIds, setCarriedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [carryMessage, setCarryMessage] = useState<string | null>(null);
  const [targetGoals, setTargetGoals] = useState<readonly CmePlanGoal[] | undefined>(nextYearGoals);
  const [savedGoals, setSavedGoals] = useState(() => goals.map((goal) => ({ id: goal.id, goal: goal.goal })));
  const [saveConflict, setSaveConflict] = useState(false);
  const readOnly = Boolean(set.closedAt) || demoMode;
  // Goals read as text until Edit. A plan with no goals yet has nothing to
  // read, so an editable year opens straight into the editor.
  const [editing, setEditing] = useState(() => !readOnly && goals.length === 0);
  const planRequirement = set.requirements.find((requirement) => requirement.id === "plan");
  const tally = hoursByGoal(goals, entries);
  const filled = drafts.filter((draft) => draft.goal.trim().length > 0);
  const tooShort = filled.some((draft) => draft.goal.trim().length < CME_PLAN_GOAL_MIN_LENGTH);
  const offerCarry = canCarryCmeGoals(set, now) && goals.length > 0;
  const availableToCarry = carryableCmeGoals(goals, targetGoals).filter((goal) => !carriedIds.has(goal.id));
  const targetReady = nextYearConfirmed === true && targetGoals !== undefined;
  const targetFull = (targetGoals?.length ?? 0) >= CME_PLAN_GOAL_MAX;

  async function carryGoal(goal: CmePlanGoal) {
    if (!targetReady || carryingId || carriedIds.has(goal.id) || targetFull) return;
    setCarryingId(goal.id);
    setCarryMessage(null);
    try {
      const response = await fetch("/api/cme/plan/carry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceYear: set.year, goalId: goal.id }),
      });
      const payload = (await response.json().catch(() => null)) as {
        goals?: CmePlanGoal[];
        message?: string;
      } | null;
      if (!response.ok || !payload?.goals) {
        throw new Error(payload?.message ?? `Could not carry this goal (${response.status}).`);
      }
      setTargetGoals(payload.goals);
      setCarriedIds((current) => new Set(current).add(goal.id));
      setCarryMessage(`Carried into ${set.year + 1}.`);
      router.refresh();
    } catch (error) {
      setCarryMessage(cmeSaveErrorText(error, "Could not carry this goal forward."));
    } finally {
      setCarryingId(null);
    }
  }

  const isDirty = useMemo(() => {
    if (savedGoals.length === 0 && drafts.length === 1 && !drafts[0].goal.trim()) return false;
    if (drafts.length !== savedGoals.length) return true;
    return drafts.some((draft, index) => {
      const original = savedGoals[index];
      return !original || draft.goal.trim() !== original.goal.trim();
    });
  }, [drafts, savedGoals]);
  useDirtyStateGuard(isDirty && !readOnly);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/cme/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: set.year,
          expectedGoals: savedGoals,
          goals: filled.map((draft) =>
            draft.id ? { id: draft.id, goal: draft.goal.trim() } : { goal: draft.goal.trim() },
          ),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        goals?: CmePlanGoal[];
        message?: string;
        code?: string;
      } | null;
      if (response.status === 409 && payload?.code === "cme_plan_conflict") {
        setSaveConflict(true);
        throw new Error("This plan changed elsewhere. Copy any unsaved edits, then reload before saving.");
      }
      if (!response.ok) throw new Error(payload?.message ?? `Could not save your plan (${response.status}).`);
      setSavedGoals((payload?.goals ?? []).map((goal) => ({ id: goal.id, goal: goal.goal })));
      setDrafts((payload?.goals ?? []).map((goal) => ({ key: nextKey(), id: goal.id, goal: goal.goal })));
      setMessage("Plan saved.");
      setEditing(false);
      router.refresh();
    } catch (error) {
      setMessage(cmeSaveErrorText(error, "Could not save your plan."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main data-testid="cme-plan" className={cn(cmePageWidth, "px-4 pb-24 pt-6 sm:px-6")}>
      <p className={eyebrowText}>{set.year}</p>
      <h1 className={cn(cmePageTitle, "mt-1")}>Development plan</h1>
      <p className={cn(textMuted, "mt-1 text-sm")}>
        Three to five goals for the year, in your own words. Link each activity to the goal it served from the
        activity&rsquo;s page, and the hours add up below.
      </p>

      {demoMode ? (
        <div className="mt-4">
          <InlineNotice tone="neutral">Demo mode is read-only; the plan is shown for inspection.</InlineNotice>
        </div>
      ) : null}
      {set.closedAt ? (
        <div className="mt-4">
          <InlineNotice tone="neutral">This CPD year is closed. Its plan is view-only.</InlineNotice>
        </div>
      ) : null}

      <section className={cn(cardSurface, "mt-5 p-4")} aria-labelledby="cme-plan-goals">
        <div className="flex items-center justify-between gap-2">
          <h2 id="cme-plan-goals" className="text-base font-semibold text-[color:var(--text)]">
            Goals
          </h2>
          {!readOnly && !editing ? (
            <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)} testId="cme-plan-edit">
              Edit goals
            </Button>
          ) : null}
        </div>
        {!editing ? (
          savedGoals.length > 0 ? (
            <ol className="mt-3 flex flex-col gap-2" data-testid="cme-plan-goals-read">
              {savedGoals.map((goal, index) => (
                <li key={goal.id} className="flex items-start gap-2 text-sm text-[color:var(--text)]">
                  <span className={cn(textMuted, "nums w-5 shrink-0 font-normal")}>{index + 1}.</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{goal.goal}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={cn(textMuted, "mt-3 text-sm")} data-testid="cme-plan-goals-read">
              No goals written for {set.year}.
            </p>
          )
        ) : null}
        {editing ? (
          <ol className="mt-3 flex flex-col gap-3" data-testid="cme-plan-goals">
            {drafts.map((draft, index) => (
              <li key={draft.key} className="flex items-start gap-2">
                <span className={cn(textMuted, "nums mt-3 w-5 shrink-0 text-sm")}>{index + 1}.</span>
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Goal {index + 1}</span>
                  <textarea
                    value={draft.goal}
                    readOnly={readOnly}
                    maxLength={CME_PLAN_GOAL_MAX_LENGTH}
                    rows={2}
                    placeholder="For example: improve how I document capacity assessments"
                    onChange={(event) =>
                      setDrafts((current) =>
                        current.map((item) => (item.key === draft.key ? { ...item, goal: event.target.value } : item)),
                      )
                    }
                    className="block min-h-tap w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text)]"
                  />
                </label>
                {!readOnly ? (
                  <button
                    type="button"
                    aria-label={`Remove goal ${index + 1}`}
                    onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
                    className="grid size-12 shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]"
                  >
                    <Trash2 aria-hidden="true" className="size-icon-sm" />
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        {!readOnly && editing ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={floatingControl}
              disabled={drafts.length >= CME_PLAN_GOAL_MAX}
              onClick={() => setDrafts((current) => [...current, { key: nextKey(), goal: "" }])}
            >
              <Plus aria-hidden="true" className="size-icon-sm" />
              Add a goal
            </button>
            <button
              type="button"
              className={primaryControl}
              disabled={saving || tooShort || saveConflict}
              onClick={() => void save()}
              data-testid="cme-plan-save"
            >
              {saving ? "Saving…" : "Save plan"}
            </button>
            {savedGoals.length > 0 ? (
              <button
                type="button"
                className={floatingControl}
                disabled={saving}
                onClick={() => {
                  setDrafts(savedGoals.map((goal) => ({ key: nextKey(), id: goal.id, goal: goal.goal })));
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}
        {tooShort ? (
          <p className={cn(textMuted, "mt-2 text-sm")}>
            Each goal needs at least {CME_PLAN_GOAL_MIN_LENGTH} characters.
          </p>
        ) : null}
        <p role="status" className="mt-2 text-sm font-semibold text-[color:var(--text)]" data-testid="cme-plan-message">
          {message}
        </p>
      </section>

      {offerCarry ? (
        <section id="cme-carry-goals" className={cn(cardSurface, "mt-4 p-4")} aria-labelledby="cme-carry-heading">
          <h2 id="cme-carry-heading" className="text-base font-semibold text-[color:var(--text)]">
            Carry goals into {set.year + 1}
          </h2>
          <p className={cn(textMuted, "mt-1 text-sm")}>
            Choose any goal you are still working on. Nothing carries forward automatically.
          </p>
          {nextYearConfirmed === false ? (
            <p className="mt-2 text-sm">
              <Link
                href={`/cme/setup?year=${set.year + 1}`}
                className="inline-flex min-h-tap items-center font-semibold underline underline-offset-2"
              >
                Confirm {set.year + 1} targets first
              </Link>
            </p>
          ) : nextYearConfirmed === null ? (
            <p className={cn(textMuted, "mt-2 text-sm")}>Next year’s targets have not been checked here yet.</p>
          ) : null}
          {availableToCarry.length === 0 ? (
            <p className={cn(textMuted, "mt-2 text-sm")}>No goals left to carry.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[color:var(--border)]">
              {availableToCarry.map((goal) => (
                <li key={goal.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 flex-1 text-sm text-[color:var(--text)]">{goal.goal}</span>
                  <button
                    type="button"
                    disabled={!targetReady || targetFull || carryingId !== null || demoMode}
                    onClick={() => void carryGoal(goal)}
                    className={cn(
                      "min-h-tap rounded-lg border border-[color:var(--border)] px-3 text-sm font-semibold text-[color:var(--text)]",
                      controlDisabled,
                    )}
                  >
                    {carryingId === goal.id ? "Carrying…" : `Carry into ${set.year + 1}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {targetFull ? (
            <p className={cn(textMuted, "mt-2 text-sm")}>
              {set.year + 1} already has the maximum of {CME_PLAN_GOAL_MAX} goals.
            </p>
          ) : null}
          {nextYearConfirmed && !targetReady && !targetFull ? (
            <p className={cn(textMuted, "mt-2 text-sm")}>
              Carry is unavailable until next year’s goals have been loaded.
            </p>
          ) : null}
          <p role="status" className="mt-2 text-sm" data-testid="cme-carry-message">
            {carryMessage}
          </p>
        </section>
      ) : null}

      <section className={cn(cardSurface, "mt-4 flex items-start gap-3 p-4")} data-testid="cme-plan-status">
        {planRequirement?.completedOn ? (
          <Check aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text)]" />
        ) : (
          <NotebookPen aria-hidden="true" className={cn("mt-0.5 size-icon-md shrink-0", textMuted)} />
        )}
        <div className="min-w-0 text-sm">
          {planRequirement?.completedOn ? (
            <p className="font-semibold text-[color:var(--text)]">
              Plan written {formatCalendarDateLong(planRequirement.completedOn)}.
            </p>
          ) : (
            <>
              <p className="font-semibold text-[color:var(--text)]">Not yet marked as written.</p>
              <p className={textMuted}>
                Once your goals are in, record the date on{" "}
                <Link
                  href="/cme/setup#cme-setup-steps"
                  className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)]"
                >
                  the setup page
                </Link>{" "}
                so the year counts it as done.
              </p>
            </>
          )}
          <Link
            href={`/cme/new?title=${encodeURIComponent("Writing my professional development plan")}`}
            className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)]"
          >
            Log the time you spent on it
          </Link>
        </div>
      </section>

      {goals.length > 0 ? (
        <section className="mt-6" aria-labelledby="cme-plan-tally">
          <h2 id="cme-plan-tally" className={cn(eyebrowText, "mb-2")}>
            Hours by goal
          </h2>
          <div className={cn(cardSurface, "p-4")}>
            <CmePlanGoalSplit tally={tally} />
          </div>
        </section>
      ) : null}
    </main>
  );
}
