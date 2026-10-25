"use client";

import { BookOpen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { CmeFlatList, CmeFlatRow, CmeGroup, CmeNote, CmeRowMark, CmeTextLink } from "@/components/cme/cme-flat-list";
import { CmeHint } from "@/components/cme/cme-work-kit";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkBody } from "@/components/mode-kit/work";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import { cn, controlDisabled, textMuted } from "@/components/ui-primitives";
import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { CPD_CATEGORY_RULE_SET } from "@/lib/cme/category-rules-source";
import { cmeCarryConfirmHref } from "@/lib/cme/carry-return";
import { formatCalendarDateLong } from "@/lib/cme/cpd-year";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import { cpdTextPatientProblem } from "@/lib/cme/patient-detail-check";
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

type PersistedCmePlanDraft = {
  version: 1;
  year: number;
  expectedGoals?: Array<{ id?: string; goal: string }>;
  drafts: Array<{ id?: string; goal: string }>;
};

let draftKey = 0;
function nextKey(): string {
  draftKey += 1;
  return `goal-${draftKey}`;
}

export function cmePlanDraftStorageKey(year: number, ownerId = "demo"): string {
  return `psychsift:cme:plan-draft:v1:${ownerId}:${year}`;
}

function draftsDifferFromSaved(
  drafts: readonly Pick<Draft, "id" | "goal">[],
  savedGoals: readonly { id: string; goal: string }[],
): boolean {
  const filledDrafts = drafts.filter((draft) => draft.goal.trim().length > 0);
  if (filledDrafts.length !== savedGoals.length) return true;
  return filledDrafts.some((draft, index) => {
    const original = savedGoals[index];
    return !original || draft.id !== original.id || draft.goal.trim() !== original.goal.trim();
  });
}

function readPersistedCmePlanDraft(
  year: number,
  ownerId: string,
  savedGoals: readonly { id: string; goal: string }[],
): Draft[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(cmePlanDraftStorageKey(year, ownerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedCmePlanDraft> | null;
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || parsed.year !== year) {
      return null;
    }
    if (!Array.isArray(parsed.drafts)) return null;
    if (Array.isArray(parsed.expectedGoals)) {
      if (parsed.expectedGoals.length !== savedGoals.length) return null;
      const matchesSaved = parsed.expectedGoals.every((expected, index) => {
        const current = savedGoals[index];
        return (
          Boolean(current) &&
          typeof expected?.goal === "string" &&
          (expected.id ?? undefined) === current!.id &&
          expected.goal.trim() === current!.goal.trim()
        );
      });
      if (!matchesSaved) return null;
    }
    const restored: Draft[] = parsed.drafts
      .filter((item): item is { id?: string; goal: string } => Boolean(item) && typeof item.goal === "string")
      .slice(0, CME_PLAN_GOAL_MAX)
      .map((item) => ({
        key: nextKey(),
        ...(typeof item.id === "string" && item.id ? { id: item.id } : {}),
        goal: item.goal.slice(0, CME_PLAN_GOAL_MAX_LENGTH),
      }));
    const normalized = restored.length > 0 ? restored : [{ key: nextKey(), goal: "" }];
    return draftsDifferFromSaved(normalized, savedGoals) ? normalized : null;
  } catch {
    return null;
  }
}

function writePersistedCmePlanDraft(
  year: number,
  ownerId: string,
  savedGoals: readonly { id: string; goal: string }[],
  drafts: readonly Draft[],
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedCmePlanDraft = {
      version: 1,
      year,
      expectedGoals: savedGoals.map((goal) => ({ id: goal.id, goal: goal.goal })),
      drafts: drafts.map((draft) => (draft.id ? { id: draft.id, goal: draft.goal } : { goal: draft.goal })),
    };
    window.sessionStorage.setItem(cmePlanDraftStorageKey(year, ownerId), JSON.stringify(payload));
  } catch {
    // Ignore storage quota or privacy-mode errors.
  }
}

function clearPersistedCmePlanDraft(year: number, ownerId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(cmePlanDraftStorageKey(year, ownerId));
  } catch {
    // Ignore storage errors.
  }
}

export function CmePlanPage({
  set,
  goals,
  entries,
  demoMode = false,
  now = new Date(),
  nextYearConfirmed = null,
  nextYearGoals,
  ownerId,
  resumeCarryGoalId = null,
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
  ownerId?: string;
  /** The goal a doctor chose to carry before confirming next year's targets, back from set-up. */
  resumeCarryGoalId?: string | null;
}) {
  const draftOwnerId = ownerId ?? "demo";
  const router = useRouter();
  const readOnly = Boolean(set.closedAt) || demoMode;
  const [savedGoals, setSavedGoals] = useState(() => goals.map((goal) => ({ id: goal.id, goal: goal.goal })));
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
  const [saveConflict, setSaveConflict] = useState(false);
  // Goals read as text until Edit. A plan with no goals yet has nothing to
  // read, so an editable year opens straight into the editor. Restored
  // unsaved drafts reopen in the editor inside the post-mount effect so SSR
  // and initial client hydration render identical HTML.
  const [editing, setEditing] = useState(() => !readOnly && goals.length === 0);
  const planRequirement = set.requirements.find((requirement) => requirement.id === "plan");
  // From the goals as last saved here, so a just-saved wording shows at once rather than after a refresh.
  const tally = hoursByGoal(
    savedGoals.map((goal, index) => ({ ...goal, sortOrder: index })),
    entries,
  );
  const filled = drafts.filter((draft) => draft.goal.trim().length > 0);
  const tooShort = filled.some((draft) => draft.goal.trim().length < CME_PLAN_GOAL_MIN_LENGTH);
  // Goals are stored with the account and printed in the plan, so the one shared patient-detail check reads them.
  const patientGoal = filled.findIndex((draft) => cpdTextPatientProblem(draft.goal) !== null);
  const offerCarry = canCarryCmeGoals(set, now) && goals.length > 0;
  const availableToCarry = carryableCmeGoals(goals, targetGoals).filter((goal) => !carriedIds.has(goal.id));
  const targetReady = nextYearConfirmed === true && targetGoals !== undefined;
  const targetFull = (targetGoals?.length ?? 0) >= CME_PLAN_GOAL_MAX;
  // Back from confirming next year's targets: the chosen goal is named and its Carry button
  // focused, but nothing is carried until the doctor taps it.
  const resumeGoal =
    offerCarry && targetReady && !targetFull && resumeCarryGoalId
      ? (availableToCarry.find((goal) => goal.id === resumeCarryGoalId) ?? null)
      : null;
  const resumeButtonRef = useRef<HTMLButtonElement | null>(null);
  const resumeGoalId = resumeGoal?.id ?? null;
  useEffect(() => {
    if (resumeGoalId) resumeButtonRef.current?.focus();
  }, [resumeGoalId]);

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

  const isDirty = useMemo(() => draftsDifferFromSaved(drafts, savedGoals), [drafts, savedGoals]);
  useDirtyStateGuard(isDirty && !readOnly);
  const hydratedTargetRef = useRef<string | null>(null);
  const accountGenerationRef = useRef(0);

  useEffect(() => {
    const targetKey = `${draftOwnerId}:${set.year}`;
    if (hydratedTargetRef.current !== targetKey) {
      const isInitialMount = hydratedTargetRef.current === null;
      if (!isInitialMount) {
        accountGenerationRef.current += 1;
      }
      hydratedTargetRef.current = targetKey;
      const nextSaved = goals.map((goal) => ({ id: goal.id, goal: goal.goal }));
      const restored = readOnly ? null : readPersistedCmePlanDraft(set.year, draftOwnerId, nextSaved);
      if (!isInitialMount || restored !== null) {
        setSavedGoals(nextSaved);
        setDrafts(
          restored
            ? restored
            : nextSaved.length > 0
              ? nextSaved.map((goal) => ({ key: nextKey(), id: goal.id, goal: goal.goal }))
              : [{ key: nextKey(), goal: "" }],
        );
        setEditing(!readOnly && (nextSaved.length === 0 || restored !== null));
        setSaveConflict(false);
        setMessage(null);
      }
      return;
    }
    if (readOnly) return;
    if (isDirty) {
      writePersistedCmePlanDraft(set.year, draftOwnerId, savedGoals, drafts);
    } else {
      clearPersistedCmePlanDraft(set.year, draftOwnerId);
    }
  }, [draftOwnerId, drafts, goals, isDirty, readOnly, savedGoals, set.year]);

  useEffect(() => {
    return subscribeAccountTransition(() => {
      accountGenerationRef.current += 1;
      clearPersistedCmePlanDraft(set.year, draftOwnerId);
      const nextSaved = goals.map((goal) => ({ id: goal.id, goal: goal.goal }));
      setSavedGoals(nextSaved);
      setDrafts(
        nextSaved.length > 0
          ? nextSaved.map((goal) => ({ key: nextKey(), id: goal.id, goal: goal.goal }))
          : [{ key: nextKey(), goal: "" }],
      );
      setEditing(!readOnly && nextSaved.length === 0);
      setSaveConflict(false);
      setMessage(null);
    });
  }, [draftOwnerId, goals, readOnly, set.year]);

  async function save() {
    const saveGeneration = accountGenerationRef.current;
    const saveOwnerId = draftOwnerId;
    const saveYear = set.year;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/cme/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: saveYear,
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
      if (accountGenerationRef.current !== saveGeneration || draftOwnerId !== saveOwnerId || set.year !== saveYear) {
        return;
      }
      if (response.status === 409 && payload?.code === "cme_plan_conflict") {
        setSaveConflict(true);
        throw new Error("This plan changed elsewhere. Copy any unsaved edits, then reload before saving.");
      }
      if (!response.ok) throw new Error(payload?.message ?? `Could not save your plan (${response.status}).`);
      const nextSavedGoals = (payload?.goals ?? []).map((goal) => ({ id: goal.id, goal: goal.goal }));
      clearPersistedCmePlanDraft(saveYear, saveOwnerId);
      setSavedGoals(nextSavedGoals);
      setDrafts(
        nextSavedGoals.length > 0
          ? nextSavedGoals.map((goal) => ({ key: nextKey(), id: goal.id, goal: goal.goal }))
          : [{ key: nextKey(), goal: "" }],
      );
      setMessage("Plan saved.");
      setEditing(false);
      router.refresh();
    } catch (error) {
      if (accountGenerationRef.current !== saveGeneration || draftOwnerId !== saveOwnerId || set.year !== saveYear) {
        return;
      }
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
                  href={`/cme/setup?year=${set.year}&edit=1#cme-setup-steps`}
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
              {editing && patientGoal >= 0 ? (
                <p role="alert" className="text-sm text-[color:var(--text)]" data-testid="cme-plan-patient-detail">
                  {`Goal ${drafts.indexOf(filled[patientGoal]!) + 1} may hold patient details. Take them out to save the plan.`}
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
                disabled={saving || tooShort || saveConflict || patientGoal >= 0}
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
                      clearPersistedCmePlanDraft(set.year, draftOwnerId);
                      setDrafts(savedGoals.map((goal) => ({ key: nextKey(), id: goal.id, goal: goal.goal })));
                      setSaveConflict(false);
                      setMessage(null);
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
                  // The link keeps its 48 px tap target; the negative margin keeps the card's text rhythm.
                  <p className="-my-2">
                    <CmeTextLink href={cmeCarryConfirmHref(set.year)}>Confirm {set.year + 1} targets first</CmeTextLink>
                  </p>
                ) : nextYearConfirmed === null ? (
                  <p className={cn(textMuted, "text-sm-minus")}>Next year’s targets have not been checked here yet.</p>
                ) : null}
                {resumeGoal && !carriedIds.has(resumeGoal.id) ? (
                  <p className="text-sm-minus" data-testid="cme-carry-resume">
                    {set.year + 1} targets confirmed. Tap Carry to bring “{resumeGoal.goal}” forward.
                  </p>
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
                          nextYearConfirmed === false ? (
                            // Confirming comes first; set-up sends the doctor back here with this goal ready.
                            <Link
                              href={cmeCarryConfirmHref(set.year, goal.id)}
                              className={cn(
                                focusRing,
                                "inline-flex min-h-12 items-center whitespace-nowrap text-sm-minus font-medium text-[color:var(--clinical-accent)] hover:underline",
                              )}
                            >
                              Confirm, then carry
                            </Link>
                          ) : (
                            <button
                              ref={goal.id === resumeGoalId ? resumeButtonRef : undefined}
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
                          )
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
