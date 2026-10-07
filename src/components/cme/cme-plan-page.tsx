"use client";

import { BookOpen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { CmeFlatList, CmeFlatRow, CmeGroup, CmeNote, CmeRowMark, CmeTextLink } from "@/components/cme/cme-flat-list";
import { CmeHint } from "@/components/cme/cme-work-kit";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkBody } from "@/components/mode-kit/work";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import { cn, controlDisabled, textMuted } from "@/components/ui-primitives";
import { CPD_CATEGORY_RULE_SET } from "@/lib/cme/category-rules-source";
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
import { CmePlanGoalSplit, formatSourceMonth } from "@/components/cme/cme-plan-goal-split";

/**
 * DEVELOPMENT PLAN — the year's goals, written once near the start of the
 * year and checked against as it goes.
 *
 * Laid out as the 5 Oct mock-up (screen 03): whether the plan is marked
 * written (with its date), then one quiet card with the goals split bar and a
 * row per goal (hours and activity count, "Not linked to a goal" grey as the
 * gap). "Add a goal" and "Edit" open the same editor, saved in one step by
 * "Save plan", the page's one filled button. Each activity names its goal on
 * its own page, so the split fills in as activities are linked. Rotations
 * live on Training, not here.
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
  // From the goals as last saved here, so a just-saved wording shows at once rather than after a refresh.
  const tally = hoursByGoal(
    savedGoals.map((goal, index) => ({ ...goal, sortOrder: index })),
    entries,
  );
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

  /** "Add a goal": opens the editor if it is closed, then adds one empty goal (up to the maximum). */
  function addGoal() {
    setEditing(true);
    setDrafts((current) =>
      current.length >= CME_PLAN_GOAL_MAX ? current : [...current, { key: nextKey(), goal: "" }],
    );
  }

  const planWrittenOn = planRequirement?.completedOn ?? null;
  const canAddGoal = !readOnly && drafts.length < CME_PLAN_GOAL_MAX;

  useModeBandHeading({
    eyebrow: `${set.year} · ${planWrittenOn ? "Plan written" : "Plan not written yet"}`,
    title: "Plan",
  });

  return (
    <main data-testid="cme-plan" data-mode-identity="cme" className="w-full">
      <WorkBody>
        <h1 className="sr-only">Development plan {set.year}</h1>
        <CmeHint>
          Three to five goals for the year, in your own words. Link each activity to the goal it served from the
          activity&rsquo;s page, and the hours add up below.
        </CmeHint>

        <div className="grid gap-5">
          {demoMode ? <CmeNote>Demo mode is read-only. The plan is shown for inspection.</CmeNote> : null}
          {set.closedAt ? <CmeNote>This CPD year is closed. Its plan is view-only.</CmeNote> : null}

          <CmeFlatList label="Plan status">
            <CmeFlatRow
              testId="cme-plan-status"
              lead={<CmeRowMark state={planWrittenOn ? "done" : "open"} />}
              title={planWrittenOn ? "Plan marked written" : "Plan not marked written yet"}
              subtitle={
                planWrittenOn
                  ? `Done ${formatCalendarDateLong(planWrittenOn)}`
                  : "Once your goals are in, record the date in Set up"
              }
              end={
                <Link
                  href="/cme/setup#cme-setup-steps"
                  data-testid="cme-plan-status-link"
                  className="work-button min-h-tap shrink-0"
                  data-variant="tinted"
                >
                  {planWrittenOn ? "Change" : "Record it"}
                </Link>
              }
            />
          </CmeFlatList>

          <CmeGroup
            testId="cme-plan-goals-group"
            label={`Goals · ${savedGoals.length}`}
            end={
              readOnly ? null : (
                <span className="flex items-baseline gap-4">
                  {!editing && savedGoals.length > 0 ? (
                    <CmeTextLink onClick={() => setEditing(true)} testId="cme-plan-edit">
                      Edit
                    </CmeTextLink>
                  ) : null}
                  {canAddGoal ? (
                    <CmeTextLink onClick={addGoal} testId="cme-plan-add-goal">
                      Add a goal
                    </CmeTextLink>
                  ) : null}
                </span>
              )
            }
          >
            <div className="work-card work-card--pad grid min-w-0 gap-3">
              {!editing ? (
                savedGoals.length > 0 ? (
                  <div data-testid="cme-plan-goals-read">
                    <CmePlanGoalSplit tally={tally} />
                  </div>
                ) : (
                  <p className={cn(textMuted, "text-sm")} data-testid="cme-plan-goals-read">
                    No goals written for {set.year}.
                  </p>
                )
              ) : (
                <ol className="grid gap-3" data-testid="cme-plan-goals">
                  {drafts.map((draft, index) => (
                    <li key={draft.key} className="flex items-start gap-2">
                      <span className={cn(textMuted, "nums mt-3 w-5 shrink-0 text-sm")}>{index + 1}.</span>
                      <label className="min-w-0 flex-1">
                        <span className="sr-only">Goal {index + 1}</span>
                        <textarea
                          value={draft.goal}
                          maxLength={CME_PLAN_GOAL_MAX_LENGTH}
                          rows={2}
                          placeholder="For example: improve how I document capacity assessments"
                          onChange={(event) =>
                            setDrafts((current) =>
                              current.map((item) =>
                                item.key === draft.key ? { ...item, goal: event.target.value } : item,
                              ),
                            )
                          }
                          className="block min-h-12 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text)]"
                        />
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove goal ${index + 1}`}
                        onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
                        className={cn(
                          focusRing,
                          "grid size-12 shrink-0 place-items-center rounded-md text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
                        )}
                      >
                        <Trash2 aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {editing && tooShort ? (
                <p className={cn(textMuted, "text-sm")}>
                  Each goal needs at least {CME_PLAN_GOAL_MIN_LENGTH} characters.
                </p>
              ) : null}
            </div>
          </CmeGroup>

          {!readOnly && editing ? (
            <div className="grid gap-1">
              <button
                type="button"
                className={cn("work-button min-h-12 w-full", controlDisabled)}
                data-variant="primary"
                disabled={saving || tooShort || saveConflict}
                onClick={() => void save()}
                data-testid="cme-plan-save"
              >
                {saving ? "Saving…" : "Save plan"}
              </button>
              {savedGoals.length > 0 ? (
                <span className="flex justify-center">
                  <CmeTextLink
                    onClick={() => {
                      if (saving) return;
                      setDrafts(savedGoals.map((goal) => ({ key: nextKey(), id: goal.id, goal: goal.goal })));
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </CmeTextLink>
                </span>
              ) : null}
            </div>
          ) : null}
          <p
            role="status"
            className="-mt-4 text-sm text-[color:var(--text)] empty:hidden"
            data-testid="cme-plan-message"
          >
            {message}
          </p>

          {offerCarry ? (
            <CmeGroup label={`Carry goals into ${set.year + 1}`}>
              <div id="cme-carry-goals" className="grid scroll-mt-24 gap-2">
                <p className={cn(textMuted, "text-sm-minus")}>
                  Choose any goal you are still working on. Nothing carries forward automatically.
                </p>
                {nextYearConfirmed === false ? (
                  <p>
                    <CmeTextLink href={`/cme/setup?year=${set.year + 1}`}>
                      Confirm {set.year + 1} targets first
                    </CmeTextLink>
                  </p>
                ) : nextYearConfirmed === null ? (
                  <p className={cn(textMuted, "text-sm-minus")}>Next year’s targets have not been checked here yet.</p>
                ) : null}
                {availableToCarry.length === 0 ? (
                  <p className={cn(textMuted, "text-sm-minus")}>No goals left to carry.</p>
                ) : (
                  <CmeFlatList label={`Goals to carry into ${set.year + 1}`}>
                    {availableToCarry.map((goal) => (
                      <CmeFlatRow
                        key={goal.id}
                        title={goal.goal}
                        end={
                          <button
                            type="button"
                            disabled={!targetReady || targetFull || carryingId !== null || demoMode}
                            onClick={() => void carryGoal(goal)}
                            className={cn(
                              focusRing,
                              "inline-flex min-h-12 items-center whitespace-nowrap text-sm-minus font-medium text-[color:var(--clinical-accent)] hover:underline disabled:cursor-not-allowed disabled:text-[color:var(--disabled)] disabled:no-underline",
                            )}
                          >
                            {carryingId === goal.id ? "Carrying…" : `Carry into ${set.year + 1}`}
                          </button>
                        }
                      />
                    ))}
                  </CmeFlatList>
                )}
                {targetFull ? (
                  <p className={cn(textMuted, "text-sm-minus")}>
                    {set.year + 1} already has the maximum of {CME_PLAN_GOAL_MAX} goals.
                  </p>
                ) : null}
                {nextYearConfirmed && !targetReady && !targetFull ? (
                  <p className={cn(textMuted, "text-sm-minus")}>
                    Carry is unavailable until next year’s goals have been loaded.
                  </p>
                ) : null}
                <p role="status" className="text-sm empty:hidden" data-testid="cme-carry-message">
                  {carryMessage}
                </p>
              </div>
            </CmeGroup>
          ) : null}

          <p className="text-xs text-[color:var(--text-muted)]" data-testid="cme-plan-source">
            Your plan is for you and your CPD home. The Medical Board asks for a written plan before you start the year.{" "}
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <BookOpen aria-hidden="true" strokeWidth={1.6} className="size-3.5" />
              {`Medical Board · checked ${formatSourceMonth(CPD_CATEGORY_RULE_SET.source.checkedOn)}`}
            </span>
          </p>
        </div>
      </WorkBody>
    </main>
  );
}
