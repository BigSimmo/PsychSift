import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * Set up Work: the walkthrough's own model (owner request 7 Oct 2026, "a
 * simple walkthrough feature to help doctors set up").
 *
 * The walkthrough never holds a setting of its own. Each step reads and writes
 * the real setting where it already lives (stage in account preferences, time
 * zone in the shared time zone setting, roster on Roster's pages), so finishing
 * or abandoning it can never leave two answers to one question. What it keeps
 * is only where the doctor got to, so it can be skipped, closed and resumed:
 * the step, which steps were finished or skipped, and the areas they said they
 * use. That record is kept on this device for this account and cleared at
 * every account transition (`clearAccountScopedBrowserStorage`).
 */

/** The steps in order. `welcome` and `done` frame the walkthrough and are not counted. */
export const WORK_SETUP_STEPS = [
  "welcome",
  "stage",
  "areas",
  "time-zone",
  "roster",
  "rotation",
  "other-areas",
  "alerts",
  "done",
] as const;
export type WorkSetupStepId = (typeof WORK_SETUP_STEPS)[number];

/** The areas a doctor can say they use. My Day is always on, so it is not a choice. */
export const WORK_SETUP_AREAS = ["rost", "teach", "assess", "cpd", "admin", "call"] as const satisfies readonly Exclude<
  WorkAreaId,
  "day"
>[];
export type WorkSetupAreaId = (typeof WORK_SETUP_AREAS)[number];

/** Areas whose own setup sits on the "Your other areas" step. */
export const OTHER_AREA_STEP_AREAS: readonly WorkSetupAreaId[] = ["cpd", "admin", "call"];

export type WorkSetupStatus = "new" | "in-progress" | "done" | "dismissed";

export type WorkSetupProgress = {
  readonly status: WorkSetupStatus;
  /** Where to resume. */
  readonly step: WorkSetupStepId;
  readonly areas: readonly WorkSetupAreaId[];
  /** Steps the doctor moved on from with Continue. */
  readonly completed: readonly WorkSetupStepId[];
  /** Steps the doctor passed with "Skip for now". A later Continue moves a step out of here. */
  readonly skipped: readonly WorkSetupStepId[];
};

export const INITIAL_WORK_SETUP_PROGRESS: WorkSetupProgress = {
  status: "new",
  step: "welcome",
  areas: WORK_SETUP_AREAS,
  completed: [],
  skipped: [],
};

function isStep(value: unknown): value is WorkSetupStepId {
  return typeof value === "string" && (WORK_SETUP_STEPS as readonly string[]).includes(value);
}

function isArea(value: unknown): value is WorkSetupAreaId {
  return typeof value === "string" && (WORK_SETUP_AREAS as readonly string[]).includes(value);
}

const STATUSES: readonly WorkSetupStatus[] = ["new", "in-progress", "done", "dismissed"];

/** Steps in walkthrough order with no repeats, whatever order they arrived in. */
function orderedSteps(values: readonly WorkSetupStepId[]): WorkSetupStepId[] {
  return WORK_SETUP_STEPS.filter((step) => values.includes(step));
}

/**
 * Read a stored record. Anything unreadable, from an older version or edited by
 * hand comes back as a fresh start rather than a half-trusted one: the worst a
 * bad read can do is show the welcome step again.
 */
export function parseWorkSetupProgress(raw: string | null | undefined): WorkSetupProgress {
  if (!raw) return INITIAL_WORK_SETUP_PROGRESS;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== "object" || value.v !== 1) return INITIAL_WORK_SETUP_PROGRESS;
    const status = STATUSES.includes(value.status as WorkSetupStatus)
      ? (value.status as WorkSetupStatus)
      : INITIAL_WORK_SETUP_PROGRESS.status;
    const areas = Array.isArray(value.areas)
      ? WORK_SETUP_AREAS.filter((area) => (value.areas as unknown[]).some((item) => item === area && isArea(item)))
      : INITIAL_WORK_SETUP_PROGRESS.areas;
    const steps = (list: unknown) => orderedSteps(Array.isArray(list) ? list.filter(isStep) : []);
    return {
      status,
      step: isStep(value.step) ? value.step : INITIAL_WORK_SETUP_PROGRESS.step,
      areas,
      completed: steps(value.completed),
      skipped: steps(value.skipped),
    };
  } catch {
    return INITIAL_WORK_SETUP_PROGRESS;
  }
}

export function serialiseWorkSetupProgress(progress: WorkSetupProgress): string {
  return JSON.stringify({ v: 1, ...progress });
}

/**
 * The steps this doctor will see, in order. Roster appears only for someone
 * who uses Roster, and "Your other areas" only when they use CPD, Admin or
 * On Call. Rotation always shows: a new job checklist applies to everyone.
 */
export function visibleWorkSetupSteps(areas: readonly WorkSetupAreaId[]): readonly WorkSetupStepId[] {
  return WORK_SETUP_STEPS.filter((step) => {
    if (step === "roster") return areas.includes("rost");
    if (step === "other-areas") return OTHER_AREA_STEP_AREAS.some((area) => areas.includes(area));
    return true;
  });
}

/** The counted steps (everything between welcome and done). */
export function countedWorkSetupSteps(areas: readonly WorkSetupAreaId[]): readonly WorkSetupStepId[] {
  return visibleWorkSetupSteps(areas).filter((step) => step !== "welcome" && step !== "done");
}

/** The step a stored position resolves to now: a step hidden by a later area choice moves forward. */
export function resolveWorkSetupStep(progress: WorkSetupProgress): WorkSetupStepId {
  const visible = visibleWorkSetupSteps(progress.areas);
  if (visible.includes(progress.step)) return progress.step;
  const index = WORK_SETUP_STEPS.indexOf(progress.step);
  return visible.find((step) => WORK_SETUP_STEPS.indexOf(step) > index) ?? "done";
}

export function nextWorkSetupStep(step: WorkSetupStepId, areas: readonly WorkSetupAreaId[]): WorkSetupStepId {
  const visible = visibleWorkSetupSteps(areas);
  const index = WORK_SETUP_STEPS.indexOf(step);
  return visible.find((candidate) => WORK_SETUP_STEPS.indexOf(candidate) > index) ?? "done";
}

/** The step before, or null on the welcome step. */
export function previousWorkSetupStep(
  step: WorkSetupStepId,
  areas: readonly WorkSetupAreaId[],
): WorkSetupStepId | null {
  const visible = visibleWorkSetupSteps(areas);
  const index = WORK_SETUP_STEPS.indexOf(step);
  const earlier = visible.filter((candidate) => WORK_SETUP_STEPS.indexOf(candidate) < index);
  return earlier.at(-1) ?? null;
}

/** How many counted steps are finished or skipped, out of how many. */
/** Steps finished with Continue, out of the steps these areas ask about. A skipped step is not done. */
export function workSetupCount(progress: WorkSetupProgress): { readonly done: number; readonly total: number } {
  const counted = countedWorkSetupSteps(progress.areas);
  const done = counted.filter((step) => progress.completed.includes(step)).length;
  return { done, total: counted.length };
}

export function workSetupCountLabel(done: number, total: number): string {
  return `${done} of ${total} done`;
}

/** Continue: the step is finished (and no longer skipped), and the walkthrough moves on. */
export function completeWorkSetupStep(progress: WorkSetupProgress, step: WorkSetupStepId): WorkSetupProgress {
  const next = nextWorkSetupStep(step, progress.areas);
  const counted = step !== "welcome" && step !== "done";
  return {
    ...progress,
    status: next === "done" ? "done" : "in-progress",
    step: next,
    completed: counted ? orderedSteps([...progress.completed, step]) : progress.completed,
    skipped: progress.skipped.filter((item) => item !== step),
  };
}

/** Skip for now: the step stays open to come back to, and the walkthrough moves on. */
export function skipWorkSetupStep(progress: WorkSetupProgress, step: WorkSetupStepId): WorkSetupProgress {
  const next = nextWorkSetupStep(step, progress.areas);
  const counted = step !== "welcome" && step !== "done";
  return {
    ...progress,
    status: next === "done" ? "done" : "in-progress",
    step: next,
    skipped:
      counted && !progress.completed.includes(step) ? orderedSteps([...progress.skipped, step]) : progress.skipped,
  };
}

/** Go to any visible step (Back, or a row on the done summary). Nothing is marked. */
export function goToWorkSetupStep(progress: WorkSetupProgress, step: WorkSetupStepId): WorkSetupProgress {
  const status = progress.status === "new" || progress.status === "dismissed" ? "in-progress" : progress.status;
  return { ...progress, status: step === "done" ? progress.status : status, step };
}

export function setWorkSetupAreas(progress: WorkSetupProgress, areas: readonly WorkSetupAreaId[]): WorkSetupProgress {
  return { ...progress, areas: WORK_SETUP_AREAS.filter((area) => areas.includes(area)) };
}

/** "Not now": the prompt card goes away. Setup stays one tap away in More and Help. */
export function dismissWorkSetup(progress: WorkSetupProgress): WorkSetupProgress {
  return progress.status === "done" ? progress : { ...progress, status: "dismissed" };
}

/** Whether My Day should offer the "Set up Work" card. */
export function workSetupPromptVisible(progress: WorkSetupProgress): boolean {
  return progress.status === "new" || progress.status === "in-progress";
}

/** Start again from the welcome step, keeping the area choice. */
export function restartWorkSetup(progress: WorkSetupProgress): WorkSetupProgress {
  return { ...INITIAL_WORK_SETUP_PROGRESS, areas: progress.areas, status: "in-progress" };
}
