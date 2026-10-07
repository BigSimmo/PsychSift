"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock,
  GraduationCap,
  Layers,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { CmeFlatList, CmeGroup, CmeGroupLabel, CmeNote, CmeRowMark, CmeTextLink } from "@/components/cme/cme-flat-list";
import { CmeRotationTrack, CmeTrainingTimeline } from "@/components/cme/cme-training-timeline";
import { CmeDateField, useCmeDateChecks } from "@/components/cme/cme-date-field";
import { cmeFilledButton } from "@/components/cme/cme-log-shared";
import { formatSourceMonth } from "@/components/cme/cme-plan-goal-split";
import { modeInsetHairline, modePressable } from "@/components/mode-kit/recipes";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { cn, InlineNotice, textMuted } from "@/components/ui-primitives";
import { CPD_CATEGORY_RULE_SET } from "@/lib/cme/category-rules-source";
import { CPD_STANDARD_RULE_TEXT, cpdRuleFromTraining } from "@/lib/cme/cpd-rule";
import { formatCalendarDateLong, formatCmeRowDate, perthCalendarDate } from "@/lib/cme/cpd-year";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import {
  attainedEpas,
  epaAssessmentsLogged,
  epaAssessmentsRuleLine,
  epaNextBySentence,
  epaRowDetail,
  epaSegmentsSentence,
  epasInProgress,
  experienceCell,
  experienceCount,
  milestoneSummary,
  termBars,
  termChartSentence,
  termRowDetail,
  timeUntil,
  trainingRecordSummary,
  xOfY,
  type CmeTrainingAssessments,
  type ExperienceCellState,
  type InternAssessments,
  type RegistrarAssessments,
} from "@/lib/cme/training-assessments";
import { TERM_TRACKER_SOURCES } from "@/lib/teaching/term-tracker";
import {
  currentPosition,
  formatFteMonths,
  fteMonthsAsOf,
  nextMilestone,
  trainingMilestoneInputSchema,
  trainingPeriodInputSchema,
  validateTrainingPeriods,
  type NextMilestone,
  type TrainingMilestone,
  type TrainingMilestoneDueKind,
  type TrainingPeriod,
  type TrainingPeriodKind,
  type TrainingPeriodProblem,
} from "@/lib/cme/training-timeline";
import { CmeBandHeading, CmeHint } from "@/components/cme/cme-work-kit";
import { WorkBody } from "@/components/mode-kit/work";

/**
 * TRAINING — the trainee's own record of their training: stages, rotations
 * and breaks, where they are today, the training clock, and the next
 * milestone due.
 *
 * Nothing is preloaded. The college's stage lengths and milestones are the
 * trainee's to enter from the college's current requirements; this page only
 * does arithmetic on what they wrote. It never reads or changes CPD targets.
 *
 * EPAs, WBAs, term assessments and clinical experience (A to D) are drawn as
 * the owner's approved mock-up shows them, but PsychSift stores none of them:
 * only the invented sample (signed-out sample and demo mode) carries figures,
 * and a signed-in doctor gets the headings with an honest "not recorded" line
 * and no counts. See `src/lib/cme/training-assessments.ts`.
 *
 * Every write goes through `/api/cme/training`; the server re-checks the whole
 * timeline before saving, and the same check runs here first so a problem is
 * shown beside the form rather than after a round trip.
 */

type RecordType = "period" | "milestone";

const NOT_RECORDED: CmeTrainingAssessments = { status: "not-recorded" };

const periodKindLabels: Record<TrainingPeriodKind, string> = {
  stage: "Stage",
  rotation: "Rotation",
  break: "Break",
};

type PeriodDraft = { kind: TrainingPeriodKind; label: string; startsOn: string; endsOn: string; fte: string };
type MilestoneDraft = {
  label: string;
  dueKind: TrainingMilestoneDueKind;
  dueFteMonths: string;
  dueOn: string;
  completedOn: string;
};

type FieldErrors = Record<string, string>;

const emptyPeriodDraft: PeriodDraft = { kind: "rotation", label: "", startsOn: "", endsOn: "", fte: "1" };
const emptyMilestoneDraft: MilestoneDraft = {
  label: "",
  dueKind: "fte-months",
  dueFteMonths: "",
  dueOn: "",
  completedOn: "",
};

function periodToDraft(period: TrainingPeriod): PeriodDraft {
  return {
    kind: period.kind,
    label: period.label,
    startsOn: period.startsOn,
    endsOn: period.endsOn ?? "",
    fte: String(period.fte),
  };
}

function milestoneToDraft(milestone: TrainingMilestone): MilestoneDraft {
  return {
    label: milestone.label,
    dueKind: milestone.dueKind,
    dueFteMonths: milestone.dueFteMonths === null ? "" : String(milestone.dueFteMonths),
    dueOn: milestone.dueOn ?? "",
    completedOn: milestone.completedOn ?? "",
  };
}

/** A break always counts 0 and a stage's FTE is ignored, so only a rotation's field is the trainee's. */
function periodPayload(draft: PeriodDraft) {
  const fte = draft.kind === "break" ? 0 : draft.kind === "stage" ? 1 : Number(draft.fte);
  return {
    kind: draft.kind,
    label: draft.label,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn || null,
    fte: Number.isFinite(fte) ? fte : Number.NaN,
  };
}

function milestonePayload(draft: MilestoneDraft) {
  const months = draft.dueFteMonths.trim() === "" ? null : Number(draft.dueFteMonths);
  return {
    label: draft.label,
    dueKind: draft.dueKind,
    dueFteMonths: draft.dueKind === "fte-months" ? months : null,
    dueOn: draft.dueKind === "date" ? draft.dueOn || null : null,
    completedOn: draft.completedOn || null,
  };
}

function fieldErrorsOf(issues: readonly { path: readonly PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

async function apiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.error === "string") return payload.error;
  return `${fallback} (${response.status}).`;
}

function byStartThenLabel(a: TrainingPeriod, b: TrainingPeriod) {
  return a.startsOn.localeCompare(b.startsOn) || a.label.localeCompare(b.label);
}

function periodDates(period: TrainingPeriod): string {
  const start = formatCalendarDateLong(period.startsOn);
  return period.endsOn ? `${start} to ${formatCalendarDateLong(period.endsOn)}` : `${start}, ongoing`;
}

function formatFte(fte: number): string {
  return `${Number(fte.toFixed(2))} FTE`;
}

function milestoneDueText(milestone: TrainingMilestone): string {
  if (milestone.dueKind === "date") return milestone.dueOn ? `Due ${formatCalendarDateLong(milestone.dueOn)}` : "";
  return milestone.dueFteMonths === null ? "" : `Due at ${formatFteMonths(milestone.dueFteMonths)}`;
}

function nextDueDetail(next: NextMilestone, today: string): string {
  const { milestone, projectedOn, overdue, reason } = next;
  if (!projectedOn) return reason ?? "No date can be given for this milestone yet.";
  const date = formatCalendarDateLong(projectedOn);
  if (milestone.dueKind === "date") {
    if (overdue) return `Overdue: it was due on ${date}.`;
    return projectedOn === today ? "Due today." : `Due ${date}.`;
  }
  const target = milestone.dueFteMonths === null ? "its target" : formatFteMonths(milestone.dueFteMonths);
  if (overdue) return `Overdue: your training clock reached ${target} on ${date}, and it is not marked done.`;
  if (projectedOn <= today) return `Due today: your training clock reaches ${target} today.`;
  return `Projected for ${date}, when your training clock reaches ${target} at your current FTE. This is an estimate, not a college date.`;
}

export function CmeTrainingPage({
  nowIso,
  initialPeriods,
  initialMilestones,
  demoMode,
  assessments = NOT_RECORDED,
}: {
  readonly nowIso: string;
  readonly initialPeriods: readonly TrainingPeriod[];
  readonly initialMilestones: readonly TrainingMilestone[];
  readonly demoMode: boolean;
  /**
   * EPAs, WBAs, term assessments and clinical experience. Only the sample
   * fixture ever carries figures; everyone signed in gets `not-recorded`,
   * because PsychSift has no storage for any of them.
   */
  readonly assessments?: CmeTrainingAssessments;
}) {
  const router = useRouter();
  const today = perthCalendarDate(new Date(nowIso));
  const [periods, setPeriods] = useState<TrainingPeriod[]>(() => [...initialPeriods]);
  const [milestones, setMilestones] = useState<TrainingMilestone[]>(() => [...initialMilestones]);

  const [periodEditing, setPeriodEditing] = useState<string | "new" | null>(null);
  const [periodDraft, setPeriodDraft] = useState<PeriodDraft>(emptyPeriodDraft);
  const [periodErrors, setPeriodErrors] = useState<FieldErrors>({});
  const [periodProblems, setPeriodProblems] = useState<TrainingPeriodProblem[]>([]);

  const [milestoneEditing, setMilestoneEditing] = useState<string | "new" | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState<MilestoneDraft>(emptyMilestoneDraft);
  const [milestoneErrors, setMilestoneErrors] = useState<FieldErrors>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateChecks = useCmeDateChecks();
  const [pendingDelete, setPendingDelete] = useState<{ type: RecordType; id: string; label: string } | null>(null);
  const [sampleMessage, setSampleMessage] = useState<string | null>(null);
  // The record's two parts open from their summary rows. A new, empty record
  // starts open so the doctor sees where to begin.
  const startsEmpty = initialPeriods.length === 0 && initialMilestones.length === 0;
  const [periodsOpen, setPeriodsOpen] = useState(startsEmpty);
  const [milestonesOpen, setMilestonesOpen] = useState(startsEmpty);
  const periodsSectionId = useId();
  const milestonesSectionId = useId();

  const periodHeadingRef = useRef<HTMLHeadingElement>(null);
  const milestoneHeadingRef = useRef<HTMLHeadingElement>(null);
  // The forms open where the add buttons are, which can be far down the page on
  // a phone; bring each into view and focus its heading when it opens.
  useEffect(() => {
    if (!periodEditing) return;
    periodHeadingRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    periodHeadingRef.current?.focus({ preventScroll: true });
  }, [periodEditing]);
  useEffect(() => {
    if (!milestoneEditing) return;
    milestoneHeadingRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    milestoneHeadingRef.current?.focus({ preventScroll: true });
  }, [milestoneEditing]);

  const orderedPeriods = [...periods].sort(byStartThenLabel);
  const storedProblems = validateTrainingPeriods(periods);
  const position = currentPosition(periods, today);
  const clock = fteMonthsAsOf(periods, today);
  const next = nextMilestone(milestones, periods, today);
  const isEmpty = periods.length === 0 && milestones.length === 0;

  function openPeriod(period?: TrainingPeriod) {
    setPeriodDraft(period ? periodToDraft(period) : emptyPeriodDraft);
    setPeriodEditing(period ? period.id : "new");
    setPeriodsOpen(true);
    setPeriodErrors({});
    setPeriodProblems([]);
    setError(null);
  }

  function openMilestone(milestone?: TrainingMilestone) {
    setMilestoneDraft(milestone ? milestoneToDraft(milestone) : emptyMilestoneDraft);
    setMilestoneEditing(milestone ? milestone.id : "new");
    setMilestonesOpen(true);
    setMilestoneErrors({});
    setError(null);
  }

  async function send(type: RecordType, id: string | "new", payload: object): Promise<Response> {
    const creating = id === "new";
    return fetch(creating ? "/api/cme/training" : `/api/cme/training/${id}`, {
      method: creating ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...payload }),
    });
  }

  async function savePeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!periodEditing || saving) return;
    setError(null);
    if (dateChecks.anyInvalid) {
      setError("Fix the date before saving.");
      return;
    }
    const parsed = trainingPeriodInputSchema.safeParse(periodPayload(periodDraft));
    if (!parsed.success) {
      setPeriodErrors(fieldErrorsOf(parsed.error.issues));
      setPeriodProblems([]);
      return;
    }
    setPeriodErrors({});
    const candidateId = periodEditing === "new" ? "__new__" : periodEditing;
    const candidate: TrainingPeriod = { id: candidateId, ...parsed.data };
    const proposed =
      periodEditing === "new" ? [...periods, candidate] : periods.map((p) => (p.id === periodEditing ? candidate : p));
    const problems = validateTrainingPeriods(proposed).filter((problem) => problem.periodIds.includes(candidateId));
    setPeriodProblems(problems);
    if (problems.length > 0) return;
    if (demoMode) {
      setError("Demo mode is read-only. Sign in to record your training.");
      return;
    }
    setSaving(true);
    try {
      const response = await send("period", periodEditing, parsed.data);
      if (!response.ok) throw new Error(await apiError(response, "Could not save this period"));
      const payload = (await response.json()) as { period: TrainingPeriod };
      setPeriods((current) =>
        periodEditing === "new"
          ? [...current, payload.period]
          : current.map((item) => (item.id === payload.period.id ? payload.period : item)),
      );
      setPeriodEditing(null);
      router.refresh();
    } catch (cause) {
      setError(cmeSaveErrorText(cause, "Could not save this period."));
    } finally {
      setSaving(false);
    }
  }

  async function saveMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!milestoneEditing || saving) return;
    setError(null);
    if (dateChecks.anyInvalid) {
      setError("Fix the date before saving.");
      return;
    }
    const parsed = trainingMilestoneInputSchema.safeParse(milestonePayload(milestoneDraft));
    if (!parsed.success) {
      setMilestoneErrors(fieldErrorsOf(parsed.error.issues));
      return;
    }
    setMilestoneErrors({});
    if (demoMode) {
      setError("Demo mode is read-only. Sign in to record your training.");
      return;
    }
    setSaving(true);
    try {
      const response = await send("milestone", milestoneEditing, parsed.data);
      if (!response.ok) throw new Error(await apiError(response, "Could not save this milestone"));
      const payload = (await response.json()) as { milestone: TrainingMilestone };
      setMilestones((current) =>
        milestoneEditing === "new"
          ? [...current, payload.milestone]
          : current.map((item) => (item.id === payload.milestone.id ? payload.milestone : item)),
      );
      setMilestoneEditing(null);
      router.refresh();
    } catch (cause) {
      setError(cmeSaveErrorText(cause, "Could not save this milestone."));
    } finally {
      setSaving(false);
    }
  }

  async function setCompleted(milestone: TrainingMilestone, completedOn: string | null) {
    if (saving) return;
    if (demoMode) {
      setError("Demo mode is read-only. Sign in to record your training.");
      return;
    }
    setSaving(true);
    setError(null);
    const { id, ...fields } = milestone;
    try {
      const response = await send("milestone", id, { ...fields, completedOn });
      if (!response.ok) throw new Error(await apiError(response, "Could not update this milestone"));
      const payload = (await response.json()) as { milestone: TrainingMilestone };
      setMilestones((current) => current.map((item) => (item.id === payload.milestone.id ? payload.milestone : item)));
      router.refresh();
    } catch (cause) {
      setError(cmeSaveErrorText(cause, "Could not update this milestone."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || saving) return;
    if (demoMode) {
      setError("Demo mode is read-only. Sign in to record your training.");
      setPendingDelete(null);
      return;
    }
    setSaving(true);
    setError(null);
    const { type, id } = pendingDelete;
    try {
      const response = await fetch(`/api/cme/training/${id}?type=${type}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await apiError(response, "Could not delete this record"));
      if (type === "period") setPeriods((current) => current.filter((item) => item.id !== id));
      else setMilestones((current) => current.filter((item) => item.id !== id));
      if (periodEditing === id) setPeriodEditing(null);
      if (milestoneEditing === id) setMilestoneEditing(null);
      router.refresh();
    } catch (cause) {
      setError(cmeSaveErrorText(cause, "Could not delete this record."));
    } finally {
      setSaving(false);
      setPendingDelete(null);
    }
  }

  const periodForm = periodEditing ? (
    <form
      onSubmit={(event) => void savePeriod(event)}
      noValidate
      className="work-card work-card--pad mt-3 space-y-4"
      data-testid="cme-training-period-form"
    >
      <h3
        ref={periodHeadingRef}
        tabIndex={-1}
        className="scroll-mt-24 text-lg font-semibold text-[color:var(--text-heading)] focus:outline-none"
      >
        {periodEditing === "new" ? "Add a stage, rotation or break" : "Edit period"}
      </h3>
      {demoMode ? <InlineNotice tone="neutral">Demo mode shows the form but cannot save it.</InlineNotice> : null}
      <Select
        label="Kind"
        id="cme-training-period-kind"
        value={periodDraft.kind}
        options={(["stage", "rotation", "break"] as const).map((kind) => ({
          value: kind,
          label: periodKindLabels[kind],
        }))}
        onChange={(event) => {
          const kind = event.target.value as TrainingPeriodKind;
          setPeriodDraft((current) => ({
            ...current,
            kind,
            fte: kind === "rotation" && (current.fte === "0" || current.fte === "") ? "1" : current.fte,
          }));
        }}
        hint="A stage holds rotations. A rotation counts toward your training clock. A break pauses it."
      />
      <TextField
        label="Label"
        id="cme-training-period-label"
        required
        value={periodDraft.label}
        error={periodErrors.label}
        onChange={(event) => setPeriodDraft((current) => ({ ...current, label: event.target.value }))}
      />
      <CmeDateField
        label="Start date"
        id="cme-training-period-start"
        chips={false}
        required
        today={today}
        value={periodDraft.startsOn}
        error={periodErrors.startsOn}
        onChange={(startsOn) => setPeriodDraft((current) => ({ ...current, startsOn }))}
      />
      <CmeDateField
        label="End date"
        onInvalidChange={dateChecks.report("periodEnd")}
        id="cme-training-period-end"
        chips={false}
        today={today}
        value={periodDraft.endsOn}
        error={periodErrors.endsOn}
        hint="Leave empty if it is still going."
        onChange={(endsOn) => setPeriodDraft((current) => ({ ...current, endsOn }))}
      />
      {periodDraft.kind === "rotation" ? (
        <TextField
          label="FTE"
          id="cme-training-period-fte"
          type="number"
          inputMode="decimal"
          min="0.01"
          max="1"
          step="0.01"
          required
          value={periodDraft.fte}
          error={periodErrors.fte}
          hint="1 for full-time, 0.5 for half-time."
          onChange={(event) => setPeriodDraft((current) => ({ ...current, fte: event.target.value }))}
        />
      ) : null}
      {periodProblems.length > 0 ? (
        <InlineNotice tone="warning">
          <span data-testid="cme-training-period-problems">
            {periodProblems.map((problem) => problem.message).join(" ")}
          </span>
        </InlineNotice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" busy={saving} busyLabel="Saving…">
          Save period
        </Button>
        <Button type="button" variant="secondary" onClick={() => setPeriodEditing(null)}>
          Cancel
        </Button>
        {periodEditing !== "new" ? (
          <CmeTextLink
            className="ml-auto"
            onClick={() => setPendingDelete({ type: "period", id: periodEditing, label: periodDraft.label })}
          >
            Delete <span className="sr-only">this period</span>
          </CmeTextLink>
        ) : null}
      </div>
    </form>
  ) : null;

  const milestoneForm = milestoneEditing ? (
    <form
      onSubmit={(event) => void saveMilestone(event)}
      noValidate
      className="work-card work-card--pad mt-3 space-y-4"
      data-testid="cme-training-milestone-form"
    >
      <h3
        ref={milestoneHeadingRef}
        tabIndex={-1}
        className="scroll-mt-24 text-lg font-semibold text-[color:var(--text-heading)] focus:outline-none"
      >
        {milestoneEditing === "new" ? "Add a milestone" : "Edit milestone"}
      </h3>
      {demoMode ? <InlineNotice tone="neutral">Demo mode shows the form but cannot save it.</InlineNotice> : null}
      <TextField
        label="Milestone"
        id="cme-training-milestone-label"
        required
        value={milestoneDraft.label}
        error={milestoneErrors.label}
        onChange={(event) => setMilestoneDraft((current) => ({ ...current, label: event.target.value }))}
      />
      <Select
        label="Due by"
        id="cme-training-milestone-due-kind"
        value={milestoneDraft.dueKind}
        options={[
          { value: "fte-months", label: "Training time (FTE months)" },
          { value: "date", label: "A date" },
        ]}
        onChange={(event) =>
          setMilestoneDraft((current) => ({ ...current, dueKind: event.target.value as TrainingMilestoneDueKind }))
        }
      />
      {milestoneDraft.dueKind === "fte-months" ? (
        <TextField
          label="FTE months"
          id="cme-training-milestone-months"
          type="number"
          inputMode="decimal"
          min="0.01"
          max="600"
          step="0.01"
          required
          value={milestoneDraft.dueFteMonths}
          error={milestoneErrors.dueFteMonths}
          hint="The training time it is due at, from your college's current requirements."
          onChange={(event) => setMilestoneDraft((current) => ({ ...current, dueFteMonths: event.target.value }))}
        />
      ) : (
        <CmeDateField
          label="Due date"
          id="cme-training-milestone-due-on"
          chips={false}
          required
          today={today}
          value={milestoneDraft.dueOn}
          error={milestoneErrors.dueOn}
          onChange={(dueOn) => setMilestoneDraft((current) => ({ ...current, dueOn }))}
        />
      )}
      <CmeDateField
        label="Completed on"
        onInvalidChange={dateChecks.report("milestoneCompleted")}
        id="cme-training-milestone-completed"
        chips={false}
        allowFuture={false}
        today={today}
        value={milestoneDraft.completedOn}
        error={milestoneErrors.completedOn}
        hint="Leave empty until it is done."
        onChange={(completedOn) => setMilestoneDraft((current) => ({ ...current, completedOn }))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" busy={saving} busyLabel="Saving…">
          Save milestone
        </Button>
        <Button type="button" variant="secondary" onClick={() => setMilestoneEditing(null)}>
          Cancel
        </Button>
        {milestoneEditing !== "new" ? (
          <CmeTextLink
            className="ml-auto"
            onClick={() => setPendingDelete({ type: "milestone", id: milestoneEditing, label: milestoneDraft.label })}
          >
            Delete <span className="sr-only">this milestone</span>
          </CmeTextLink>
        ) : null}
      </div>
    </form>
  ) : null;

  const rotation = position.rotation;
  const rotationWithEnd = rotation && rotation.endsOn ? { ...rotation, endsOn: rotation.endsOn } : null;
  // The next open milestone gets a dot on the rotation line only when its date falls inside this rotation.
  const rotationMilestone =
    rotation && next?.projectedOn && next.projectedOn >= today && next.projectedOn >= rotation.startsOn
      ? rotation.endsOn === null || next.projectedOn <= rotation.endsOn
        ? { ...next, projectedOn: next.projectedOn }
        : null
      : null;

  // Which example person the sample shows. A signed-in doctor is shown both
  // sets of headings, with nothing counted.
  const sampleView = assessments.status === "sample" ? assessments.view : null;
  const showRegistrar = sampleView !== "intern";
  const showIntern = sampleView !== "registrar";
  // An empty record is not a reading, so nothing is ticked until a period has
  // been entered. The junior doctor example has no training record of its own,
  // so its rule is never worked out from the registrar's.
  const cpdRule = cpdRuleFromTraining(periods.length && sampleView !== "intern" ? position : null);

  function sampleAction() {
    setSampleMessage(SAMPLE_ACTION_MESSAGE);
  }

  return (
    <main data-testid="cme-training" data-mode-identity="cme" className="w-full">
      <CmeBandHeading
        eyebrow={sampleView ? "Sample record" : rotation ? rotation.label : "Your own record"}
        title="Training"
      />
      <WorkBody>
        <h1 className="sr-only">Training</h1>
        <CmeHint>
          Your own record of your training. It is not the college&apos;s record, and nothing here changes your CPD
          targets.
        </CmeHint>
        {sampleView ? (
          <p className="mt-1 text-sm-minus text-[color:var(--text-muted)]" data-testid="cme-training-example-switch">
            {sampleView === "registrar" ? "A psychiatry registrar example. " : "A junior doctor example. "}
            <CmeTextLink href={sampleView === "registrar" ? "/cme/training?example=intern" : "/cme/training"}>
              {sampleView === "registrar" ? "See the junior doctor example" : "See the registrar example"}
            </CmeTextLink>
          </p>
        ) : null}

        <div className="grid gap-5">
          {error ? (
            <CmeNote tone="warn" role="alert" icon={<AlertTriangle aria-hidden="true" strokeWidth={1.6} />}>
              {error}
            </CmeNote>
          ) : null}

          {showRegistrar && isEmpty ? (
            <CmeNote
              testId="cme-training-empty"
              icon={<GraduationCap aria-hidden="true" strokeWidth={1.6} />}
              title="Nothing is preloaded here."
            >
              Enter your own stages, rotations, breaks and milestones from your college&apos;s current requirements. The
              page then shows where you are, your training time so far, and what is due next.
            </CmeNote>
          ) : null}

          {showRegistrar && rotation ? (
            <CmeGroup label={`This rotation · ${rotation.label}`} testId="cme-training-this-rotation">
              <div className={cardShell}>
                {rotationWithEnd ? (
                  <CmeRotationTrack rotation={rotationWithEnd} today={today} marker={rotationMilestone?.projectedOn} />
                ) : (
                  <p className={cn(textMuted, "text-sm-minus")}>
                    This rotation has no end date yet, so it cannot be drawn. Add one with Edit below.
                  </p>
                )}
                {rotationMilestone || rotation.endsOn ? (
                  <CmeFlatList label="Dates in this rotation">
                    {rotationMilestone ? (
                      <RecordRow
                        testId="cme-training-rotation-milestone"
                        lead={<CalendarDays aria-hidden="true" strokeWidth={1.6} />}
                        title={rotationMilestone.milestone.label}
                        subtitle={`Your milestone · ${formatCmeRowDate(rotationMilestone.projectedOn, today)}, ${timeUntil(
                          today,
                          rotationMilestone.projectedOn,
                        )}${rotationMilestone.milestone.dueKind === "fte-months" ? " (estimated from your FTE)" : ""}`}
                      />
                    ) : null}
                    {rotation.endsOn ? (
                      <RecordRow
                        testId="cme-training-rotation-end"
                        lead={<ClipboardList aria-hidden="true" strokeWidth={1.6} />}
                        title="End of rotation"
                        subtitle={`${formatCmeRowDate(rotation.endsOn, today)} · ${timeUntil(today, rotation.endsOn)}`}
                      />
                    ) : null}
                  </CmeFlatList>
                ) : null}
              </div>
            </CmeGroup>
          ) : null}

          {assessments.status === "sample" && assessments.view === "registrar" ? (
            <>
              <CmeRegistrarEpaSummary registrar={assessments.registrar} />
              <CmeRegistrarEpaList
                registrar={assessments.registrar}
                onSampleAction={sampleAction}
                sampleMessage={sampleMessage}
              />
            </>
          ) : null}
          {assessments.status === "not-recorded" ? <CmeRegistrarEpasNotRecorded /> : null}

          {showRegistrar ? (
            <CmeGroup
              label="Your training record"
              testId="cme-training-position"
              end={
                periodEditing ? null : (
                  <CmeTextLink onClick={() => openPeriod()} testId="cme-training-add-period">
                    Add <span className="sr-only">stage, rotation or break</span>
                  </CmeTextLink>
                )
              }
            >
              <CmeFlatList label="Your training record">
                <DisclosureRow
                  testId="cme-training-record-periods"
                  controls={periodsSectionId}
                  open={periodsOpen}
                  onToggle={() => setPeriodsOpen((open) => !open)}
                  lead={<Layers aria-hidden="true" strokeWidth={1.6} />}
                  title="Stages, rotations and breaks"
                  subtitle={trainingRecordSummary(periods, position, today)}
                />
                <DisclosureRow
                  testId="cme-training-record-milestones"
                  controls={milestonesSectionId}
                  open={milestonesOpen}
                  onToggle={() => setMilestonesOpen((open) => !open)}
                  lead={<CalendarDays aria-hidden="true" strokeWidth={1.6} />}
                  title="Milestones"
                  subtitle={milestoneSummary(milestones, next, today)}
                />
                <RecordLinkRow
                  testId="cme-training-portal"
                  href={TRAINING_PORTAL_HREF}
                  external
                  lead={<ArrowUpRight aria-hidden="true" strokeWidth={1.6} />}
                  title="Open your college training portal"
                  subtitle="InTrain is the official record"
                />
              </CmeFlatList>
            </CmeGroup>
          ) : null}

          {showRegistrar && periodsOpen ? (
            <section id={periodsSectionId} aria-label="Stages, rotations and breaks" className="grid min-w-0 gap-1">
              <CmeGroupLabel as="h3" label="Stages, rotations and breaks" />
              {isEmpty ? null : (
                <CmeFlatList label="Where you are">
                  <RecordRow
                    lead={<Layers aria-hidden="true" strokeWidth={1.6} />}
                    title={
                      <span data-testid="cme-training-stage">
                        {position.stage ? position.stage.label : "No stage covers today"}
                      </span>
                    }
                    subtitle={
                      position.onBreak && position.breakPeriod ? (
                        <span data-testid="cme-training-on-break">
                          On a break: {position.breakPeriod.label}. Your training clock is paused.
                        </span>
                      ) : position.rotation ? (
                        <span data-testid="cme-training-rotation">
                          {position.rotation.label}
                          {position.rotationIndex !== null && position.rotationCount !== null
                            ? `, rotation ${position.rotationIndex} of ${position.rotationCount}`
                            : ""}
                          {position.rotation.fte < 1 ? `, at ${formatFte(position.rotation.fte)}` : ""}
                        </span>
                      ) : (
                        "No rotation covers today."
                      )
                    }
                  />
                  <RecordRow
                    lead={<Clock aria-hidden="true" strokeWidth={1.6} />}
                    title="Training time so far"
                    subtitle="Only rotations count. Half-time counts half, and breaks pause the clock."
                    end={
                      <span
                        data-testid="cme-training-clock"
                        className="nums whitespace-nowrap text-sm font-normal text-[color:var(--text-heading)]"
                      >
                        {formatFteMonths(clock)}
                      </span>
                    }
                  />
                </CmeFlatList>
              )}
              {storedProblems.length > 0 ? (
                <CmeNote tone="warn" icon={<AlertTriangle aria-hidden="true" strokeWidth={1.6} />}>
                  <span data-testid="cme-training-timeline-problems">
                    Your timeline has a problem to fix: {storedProblems.map((problem) => problem.message).join(" ")}
                  </span>
                </CmeNote>
              ) : null}
              {orderedPeriods.length > 0 ? (
                <div className={cn(cardShell, "mt-1")}>
                  <CmeTrainingTimeline periods={periods} today={today} />
                </div>
              ) : null}
              {orderedPeriods.length > 0 ? (
                <CmeFlatList testId="cme-training-periods" label="Stages, rotations and breaks" className="mt-1">
                  {orderedPeriods.map((period) => {
                    const rowProblems = storedProblems.filter((problem) => problem.periodIds.includes(period.id));
                    return (
                      <RecordRow
                        key={period.id}
                        title={period.label}
                        subtitle={
                          <>
                            {`${periodKindLabels[period.kind]} · ${periodDates(period)}`}
                            {period.kind === "rotation" ? ` · ${formatFte(period.fte)}` : ""}
                            {rowProblems.length > 0 ? (
                              <span className="block font-medium text-[color:var(--warning)]">
                                Overlaps another period. Change a date to fix it.
                              </span>
                            ) : null}
                          </>
                        }
                        end={
                          <CmeTextLink onClick={() => openPeriod(period)}>
                            Edit <span className="sr-only">{period.label}</span>
                          </CmeTextLink>
                        }
                      />
                    );
                  })}
                </CmeFlatList>
              ) : (
                <p className={cn(textMuted, "text-sm-minus")}>No periods yet.</p>
              )}
              {periodForm}
            </section>
          ) : null}

          {showRegistrar && milestonesOpen ? (
            <section id={milestonesSectionId} aria-label="Milestones" className="grid min-w-0 gap-1">
              <CmeGroupLabel
                as="h3"
                label="Milestones"
                end={
                  milestoneEditing ? null : (
                    <CmeTextLink onClick={() => openMilestone()} testId="cme-training-add-milestone">
                      Add <span className="sr-only">milestone</span>
                    </CmeTextLink>
                  )
                }
              />
              {isEmpty ? null : (
                <p data-testid="cme-training-next" className="text-sm-minus text-[color:var(--text-muted)]">
                  <span className="font-medium text-[color:var(--text-heading)]">
                    {next ? `Next due: ${next.milestone.label}. ` : "Next due: "}
                  </span>
                  <span
                    data-testid="cme-training-next-detail"
                    className={next?.overdue ? "font-medium text-[color:var(--text-heading)]" : undefined}
                  >
                    {next
                      ? nextDueDetail(next, today)
                      : milestones.length === 0
                        ? "No milestones yet."
                        : "Every milestone is marked done."}
                  </span>
                </p>
              )}
              {milestones.length > 0 ? (
                <CmeFlatList testId="cme-training-milestones" label="Milestones">
                  {milestones.map((milestone) => (
                    <RecordRow
                      key={milestone.id}
                      lead={<CmeRowMark state={milestone.completedOn ? "done" : "open"} />}
                      title={milestone.label}
                      subtitle={
                        milestone.completedOn
                          ? `You marked it done on ${formatCalendarDateLong(milestone.completedOn)}`
                          : ["Your milestone", milestoneDueText(milestone)].filter(Boolean).join(" · ")
                      }
                      end={
                        <>
                          {milestone.completedOn ? (
                            <CmeTextLink onClick={() => void setCompleted(milestone, null)}>
                              Not done<span className="sr-only">: {milestone.label}</span>
                            </CmeTextLink>
                          ) : (
                            <CmeTextLink onClick={() => void setCompleted(milestone, today)}>
                              Mark done<span className="sr-only">: {milestone.label}</span>
                            </CmeTextLink>
                          )}
                          <CmeTextLink onClick={() => openMilestone(milestone)}>
                            Edit <span className="sr-only">{milestone.label}</span>
                          </CmeTextLink>
                        </>
                      }
                    />
                  ))}
                </CmeFlatList>
              ) : (
                <p className={cn(textMuted, "text-sm-minus")}>No milestones yet.</p>
              )}
              {milestoneForm}
            </section>
          ) : null}

          {assessments.status === "sample" && assessments.view === "intern" ? (
            <>
              <CmeInternThisTerm intern={assessments.intern} today={today} />
              <CmeInternEpaAssessments
                intern={assessments.intern}
                onSampleAction={sampleAction}
                sampleMessage={sampleMessage}
              />
              <CmeInternExperience intern={assessments.intern} />
            </>
          ) : null}
          {assessments.status === "not-recorded" ? <CmeInternNotRecorded /> : null}

          {sampleView === "registrar" ? null : (
            <CmeGroup
              label="Your CPD rule"
              testId="cme-training-cpd-rule"
              end={<RuleSource source="Medical Board" checkedOn={CPD_CATEGORY_RULE_SET.source.checkedOn} />}
            >
              <CmeFlatList label="Your CPD rule">
                <RecordRow
                  testId="cme-training-cpd-rule-result"
                  title={
                    cpdRule.lane === "trainee"
                      ? "Trainee in an accredited college programme"
                      : cpdRule.lane === "everyone"
                        ? "Everyone else"
                        : "Not worked out here"
                  }
                  subtitle={
                    cpdRule.lane === "trainee"
                      ? "Covered by your training"
                      : cpdRule.lane === "everyone"
                        ? CPD_STANDARD_RULE_TEXT
                        : "The Report lists each rule"
                  }
                />
              </CmeFlatList>
              <p className="text-xs text-[color:var(--text-muted)]" data-testid="cme-training-cpd-rule-basis">
                {sampleView === "intern"
                  ? "Whether an intern's or PGY2's programme covers their CPD is not worked out here yet, so no rule is ticked."
                  : cpdRule.basis}
              </p>
            </CmeGroup>
          )}

          {showIntern ? <CmeInternLinks teaching={sampleView === "intern"} /> : null}

          <p className="text-xs text-[color:var(--text-muted)]" data-testid="cme-training-footer">
            {demoMode ? "" : "Saved privately in your PsychSift account. "}
            {sampleView === "registrar"
              ? "Your Director of Training has the final word on every requirement."
              : sampleView === "intern"
                ? "Your term supervisor and medical education unit have the final word."
                : "Your Director of Training, term supervisor or medical education unit has the final word on every requirement."}
          </p>
        </div>
      </WorkBody>

      <ConfirmDialog
        open={pendingDelete !== null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={pendingDelete?.type === "milestone" ? "Delete this milestone?" : "Delete this period?"}
        description={`"${pendingDelete?.label ?? ""}" will be removed from your training record. This cannot be undone.`}
        confirmLabel={pendingDelete?.type === "milestone" ? "Delete milestone" : "Delete period"}
        busy={saving}
        busyLabel="Deleting…"
      />
    </main>
  );
}

/** A summary row that opens and closes its part of the record below the group. */
function DisclosureRow({
  lead,
  title,
  subtitle,
  open,
  onToggle,
  controls,
  testId,
}: {
  readonly lead: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly controls: string;
  readonly testId?: string;
}) {
  return (
    <li className={cn(modeInsetHairline, "flex min-w-0 items-center before:left-0")}>
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        onClick={onToggle}
        className={cn(modePressable, focusRing, "flex min-h-13 min-w-0 flex-1 items-center gap-3 text-left")}
      >
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center text-[color:var(--text-muted)] [&_svg]:size-icon-md"
        >
          {lead}
        </span>
        <span className="grid min-w-0 flex-1 gap-px py-2">
          <span className="break-words text-sm font-medium leading-5 text-[color:var(--text-heading)]">{title}</span>
          <span className="break-words text-sm-minus leading-4.5 text-[color:var(--text-muted)]">{subtitle}</span>
        </span>
        <ChevronMark open={open} />
      </button>
    </li>
  );
}

/**
 * The EPA, WBA, term and clinical-experience parts of the Training page, as the
 * owner's approved mock-up draws them (screens 04 and 05).
 *
 * PsychSift stores none of these. The parts with figures are only ever drawn
 * from the invented sample (signed-out sample and demo mode); a signed-in
 * doctor gets the same headings with `NOT_RECORDED_LINE` and no counts, and no
 * button that would look like it saves.
 */

const NOT_RECORDED_LINE = "Not recorded in PsychSift yet. Keep them in InTrain (RANZCP) or your ePortfolio (interns).";

/** What a sample button says when pressed: nothing is saved or drafted from an example. */
const SAMPLE_ACTION_MESSAGE =
  "This is an example. PsychSift does not record EPAs, WBAs or term assessments yet, so nothing is added or drafted.";

/** Where the official records live. The ePortfolio link is the one Teaching already uses. */
const TRAINING_PORTAL_HREF = "https://www.ranzcp.org/";
const EPORTFOLIO_HREF = TERM_TRACKER_SOURCES.pmcwaCla;

/**
 * Assessment rule figures shown beside the EPA parts. The words are copied
 * from Josh's 5 Oct mock-up; they were not checked against the source for this
 * build, so `checkedOn` stays null and the page says so, and they are NOT
 * signed off, so every one is shown with "Not signed off". Agents never sign
 * these.
 */
const TRAINING_RULE_FIGURES = {
  ranzcpEpa: { id: "ranzcp-epa", source: "RANZCP", checkedOn: null },
  amcEpa: {
    id: "amc-epa",
    source: "AMC framework",
    checkedOn: null,
    perEpa: "EPA 1 at least once each term. EPAs 2 to 4 at least twice a year.",
  },
} as const;

/** The quiet card the mock-up puts around a drawing and its rows. */
const cardShell = "work-card work-card--pad grid min-w-0 gap-3";

/** A rule figure's source and check month, always marked as not signed off. */
function RuleSource({ source, checkedOn }: { readonly source: string; readonly checkedOn: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs font-normal normal-case tracking-normal text-[color:var(--text-muted)]">
      <BookOpen aria-hidden="true" strokeWidth={1.6} className="size-3.5 shrink-0" />
      <span>
        {checkedOn
          ? `${source} · checked ${formatSourceMonth(checkedOn)}`
          : `${source} · not yet checked against the source`}
      </span>
      <span>· Not signed off</span>
    </span>
  );
}

/**
 * One row of a record list: like `CmeFlatRow`, but the second line is never
 * cut short, because here it can carry a caveat or a problem to fix, and the
 * end slot can hold two text links.
 */
function RecordRow({
  lead,
  title,
  subtitle,
  end,
  testId,
}: {
  readonly lead?: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly end?: ReactNode;
  readonly testId?: string;
}) {
  return (
    <li
      data-testid={testId}
      className={cn(modeInsetHairline, "flex min-h-13 min-w-0 items-center gap-3 before:left-0")}
    >
      {lead ? (
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center text-[color:var(--text-muted)] [&_svg]:size-icon-md"
        >
          {lead}
        </span>
      ) : null}
      <span className="grid min-w-0 flex-1 gap-px py-2">
        <span className="break-words text-sm font-medium leading-5 text-[color:var(--text-heading)]">{title}</span>
        {subtitle ? (
          <span className="break-words text-sm-minus leading-4.5 text-[color:var(--text-muted)]">{subtitle}</span>
        ) : null}
      </span>
      {end ? <span className="flex shrink-0 items-center gap-4">{end}</span> : null}
    </li>
  );
}

/** A row that opens something: an outside link (new tab) or an app route, ending in a chevron. */
function RecordLinkRow({
  href,
  external = false,
  lead,
  title,
  subtitle,
  testId,
}: {
  readonly href: string;
  readonly external?: boolean;
  readonly lead: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly testId?: string;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center text-[color:var(--text-muted)] [&_svg]:size-icon-md"
      >
        {lead}
      </span>
      <span className="grid min-w-0 flex-1 gap-px py-2">
        <span className="break-words text-sm font-medium leading-5 text-[color:var(--text-heading)]">{title}</span>
        <span className="break-words text-sm-minus leading-4.5 text-[color:var(--text-muted)]">{subtitle}</span>
      </span>
      {external ? <span className="sr-only">(opens in a new tab)</span> : null}
      <ChevronMark />
    </>
  );
  const classes = cn(modePressable, focusRing, "flex min-h-13 min-w-0 flex-1 items-center gap-3 no-underline");
  return (
    <li data-testid={testId} className={cn(modeInsetHairline, "flex min-w-0 items-center before:left-0")}>
      {external ? (
        <a href={href} target="_blank" rel="noreferrer" className={classes}>
          {body}
        </a>
      ) : (
        <Link href={href} className={classes}>
          {body}
        </Link>
      )}
    </li>
  );
}

/** The grey chevron at the end of a row that opens something; turned down when its part is open. */
function ChevronMark({ open = false }: { readonly open?: boolean }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn("size-icon-sm shrink-0 text-[color:var(--text-muted)]", open ? "rotate-90" : null)}
    />
  );
}

function NotRecorded({ testId }: { readonly testId?: string }) {
  return (
    <p data-testid={testId} className="text-sm-minus text-[color:var(--text-muted)]">
      {NOT_RECORDED_LINE}
    </p>
  );
}

function SampleActionStatus({ message }: { readonly message: string | null }) {
  return (
    <p role="status" className="text-sm-minus text-[color:var(--text-muted)]">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Registrar (screen 04)
// ---------------------------------------------------------------------------

/** "1 of 2 marked attained": the figure, two small segments, and what is still needed by when. */
function CmeRegistrarEpaSummary({ registrar }: { readonly registrar: RegistrarAssessments }) {
  const attained = attainedEpas(registrar).length;
  const minimum = registrar.minimumEpas;
  const filled = Math.min(attained, minimum);
  return (
    <CmeGroup
      label="EPAs this rotation"
      testId="cme-training-epas"
      end={
        <RuleSource
          source={TRAINING_RULE_FIGURES.ranzcpEpa.source}
          checkedOn={TRAINING_RULE_FIGURES.ranzcpEpa.checkedOn}
        />
      }
    >
      <div className={cardShell}>
        <p className="flex flex-wrap items-baseline gap-x-1.5" data-testid="cme-training-epas-figure">
          <span className="nums whitespace-nowrap text-xl font-normal text-[color:var(--text-heading)]">
            {xOfY(attained, minimum)}
          </span>
          <span className="text-sm-minus text-[color:var(--text-muted)]">marked attained</span>
        </p>
        <div aria-hidden="true" className="flex gap-1" data-testid="cme-training-epas-segments">
          {Array.from({ length: minimum }, (_, index) => (
            <span
              key={index}
              data-filled={index < filled ? "true" : "false"}
              className={cn(
                "h-1.5 flex-1 rounded-full border",
                index < filled
                  ? "border-[color:var(--cme-cat-1)] bg-[color:var(--cme-cat-1)] forced-colors:bg-[CanvasText]"
                  : "border-[color:var(--border)] bg-[color:var(--surface-inset)] forced-colors:border-[CanvasText]",
              )}
            />
          ))}
        </div>
        <p className="sr-only">{epaSegmentsSentence(attained, minimum)}</p>
        <p className="text-sm text-[color:var(--text)]" data-testid="cme-training-epas-next">
          {epaNextBySentence(attained, minimum, registrar.rotationEndsOn)}
        </p>
      </div>
    </CmeGroup>
  );
}

/** The EPA list: each EPA's WBAs, or the day it was marked attained. Sample only. */
function CmeRegistrarEpaList({
  registrar,
  onSampleAction,
  sampleMessage,
}: {
  readonly registrar: RegistrarAssessments;
  readonly onSampleAction: () => void;
  readonly sampleMessage: string | null;
}) {
  const inProgress = epasInProgress(registrar);
  const ordered = [...inProgress, ...attainedEpas(registrar)];
  return (
    <CmeGroup
      label={`EPAs in progress · ${inProgress.length}`}
      testId="cme-training-epa-list"
      end={
        <CmeTextLink onClick={onSampleAction} testId="cme-training-add-epa">
          Add an EPA
        </CmeTextLink>
      }
    >
      <CmeFlatList label="EPAs this rotation">
        {ordered.map((epa) => (
          <RecordRow
            key={epa.id}
            testId={`cme-training-epa-${epa.id}`}
            lead={epa.attainedOn ? <CmeRowMark state="done" /> : <Award aria-hidden="true" strokeWidth={1.6} />}
            title={epa.title}
            subtitle={epaRowDetail(epa, registrar.wbasPerEpa)}
            end={
              epa.attainedOn ? null : (
                <CmeTextLink onClick={onSampleAction} wrap>
                  Draft a WBA request<span className="sr-only">: {epa.title}</span>
                </CmeTextLink>
              )
            }
          />
        ))}
      </CmeFlatList>
      <p className="mt-1 text-xs text-[color:var(--text-muted)]" data-testid="cme-training-wba-note">
        A WBA request opens a draft for you to send. PsychSift sends nothing. Three WBAs do not by themselves mean an
        EPA is attained (RANZCP).
      </p>
      <SampleActionStatus message={sampleMessage} />
    </CmeGroup>
  );
}

/** The registrar heading with no figures: what a signed-in doctor sees. */
function CmeRegistrarEpasNotRecorded() {
  return (
    <CmeGroup
      label="EPAs this rotation"
      testId="cme-training-epas"
      end={
        <RuleSource
          source={TRAINING_RULE_FIGURES.ranzcpEpa.source}
          checkedOn={TRAINING_RULE_FIGURES.ranzcpEpa.checkedOn}
        />
      }
    >
      <p className="text-sm text-[color:var(--text)]">
        The minimum is 2 for each 6-month full-time rotation, pro rata if part-time. Three WBAs do not by themselves
        mean an EPA is attained (RANZCP).
      </p>
      <NotRecorded testId="cme-training-epas-not-recorded" />
    </CmeGroup>
  );
}

// ---------------------------------------------------------------------------
// Junior doctor (screen 05)
// ---------------------------------------------------------------------------

function CmeInternThisTerm({ intern, today }: { readonly intern: InternAssessments; readonly today: string }) {
  const term = intern.terms.find((candidate) => candidate.number === intern.currentTerm);
  return (
    <CmeGroup label={`This term · ${intern.termName}`} testId="cme-training-this-term">
      <CmeFlatList label="This term">
        <RecordRow
          testId="cme-training-mid-term"
          lead={<CalendarDays aria-hidden="true" strokeWidth={1.6} />}
          title="Mid-term assessment"
          subtitle={`With your term supervisor · ${formatCmeRowDate(intern.midTermAssessmentOn, today)}, ${timeUntil(
            today,
            intern.midTermAssessmentOn,
          )}`}
        />
        {term ? (
          <RecordRow
            testId="cme-training-term"
            lead={<Clock aria-hidden="true" strokeWidth={1.6} />}
            title={`Term ${term.number}`}
            subtitle={termRowDetail(today, term)}
          />
        ) : null}
      </CmeFlatList>
    </CmeGroup>
  );
}

const TERM_BLOCK = "h-2 w-9 rounded-sm";

function CmeInternEpaAssessments({
  intern,
  onSampleAction,
  sampleMessage,
}: {
  readonly intern: InternAssessments;
  readonly onSampleAction: () => void;
  readonly sampleMessage: string | null;
}) {
  const bars = termBars(intern);
  return (
    <CmeGroup label={`EPA assessments · ${intern.year}`} testId="cme-training-epa-assessments">
      <RuleSource source={TRAINING_RULE_FIGURES.amcEpa.source} checkedOn={TRAINING_RULE_FIGURES.amcEpa.checkedOn} />
      <div className={cardShell}>
        <p className="flex flex-wrap items-baseline gap-x-1.5" data-testid="cme-training-epa-assessments-figure">
          <span className="nums text-xl font-normal text-[color:var(--text-heading)]">
            {epaAssessmentsLogged(intern)}
          </span>
          <span className="text-sm-minus text-[color:var(--text-muted)]">{epaAssessmentsRuleLine(intern)}</span>
        </p>
        <div aria-hidden="true" className="grid grid-cols-5 gap-1 pt-2" data-testid="cme-training-term-chart">
          {bars.map((bar) => (
            <div key={bar.number} className="grid justify-items-center gap-1" data-state={bar.state}>
              <div className="flex min-h-10 flex-col-reverse items-center justify-start gap-0.5">
                {bar.state === "future"
                  ? null
                  : Array.from({ length: bar.count }, (_, index) => (
                      <span
                        key={`count-${index}`}
                        className={cn(TERM_BLOCK, "bg-[color:var(--cme-cat-1)] forced-colors:bg-[CanvasText]")}
                      />
                    ))}
                {bar.state === "current"
                  ? Array.from({ length: Math.max(0, intern.perTermMinimum - bar.count) }, (_, index) => (
                      <span
                        key={`still-${index}`}
                        className={cn(TERM_BLOCK, "border border-dashed border-[color:var(--border-strong)]")}
                      />
                    ))
                  : null}
              </div>
              <span
                className={cn(
                  "text-sm-minus font-semibold",
                  bar.state === "current" ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-heading)]",
                )}
              >
                {`T${bar.number}`}
              </span>
              <span
                className="nums text-xs text-[color:var(--text-muted)]"
                data-testid={`cme-training-term-${bar.number}`}
              >
                {bar.caption}
              </span>
            </div>
          ))}
        </div>
        <p className="sr-only" data-testid="cme-training-term-chart-words">
          {termChartSentence(bars)}
        </p>
        <p className="text-sm text-[color:var(--text)]">{TRAINING_RULE_FIGURES.amcEpa.perEpa}</p>
      </div>
      <button
        type="button"
        onClick={onSampleAction}
        data-testid="cme-training-log-epa"
        className={cn(focusRing, cmeFilledButton, "mt-2 w-full")}
      >
        <Plus aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
        Log an EPA assessment
      </button>
      <SampleActionStatus message={sampleMessage} />
    </CmeGroup>
  );
}

const CELL_WORDS: Record<ExperienceCellState, string> = {
  covered: "covered",
  current: "this term, not finished",
  open: "not covered",
};

const CELL_CLASS: Record<ExperienceCellState, string> = {
  covered: "bg-[color:var(--cme-cat-1)] forced-colors:bg-[CanvasText]",
  current: "border border-dashed border-[color:var(--border-strong)]",
  open: "border border-[color:var(--border-strong)]",
};

function CmeInternExperience({ intern }: { readonly intern: InternAssessments }) {
  const termNumbers = intern.terms.map((term) => term.number);
  return (
    <CmeGroup label="Clinical experience · terms done" testId="cme-training-experience">
      <table className="w-full border-separate border-spacing-y-1 text-sm" data-testid="cme-training-experience-grid">
        <caption className="sr-only">Clinical experience categories covered in each term</caption>
        <thead>
          <tr>
            <th scope="col" className="w-5">
              <span className="sr-only">Category</span>
            </th>
            <th scope="col">
              <span className="sr-only">Experience</span>
            </th>
            {termNumbers.map((number) => (
              <th
                key={number}
                scope="col"
                className="w-7 text-center text-xs font-normal text-[color:var(--text-muted)]"
              >{`T${number}`}</th>
            ))}
            <th scope="col">
              <span className="sr-only">Terms done</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {intern.experience.map((row) => (
            <tr key={row.category} data-testid={`cme-training-experience-${row.category}`}>
              <th scope="row" className="pr-2 text-left font-semibold text-[color:var(--text-heading)]">
                {row.category}
              </th>
              <td className="pr-2 text-[color:var(--text)]">{row.label}</td>
              {termNumbers.map((number) => {
                const state = experienceCell(row, number, intern.currentTerm);
                return (
                  <td key={number} className="text-center" data-state={state}>
                    <span
                      aria-hidden="true"
                      className={cn("inline-block size-5 rounded-sm align-middle", CELL_CLASS[state])}
                    />
                    <span className="sr-only">{`Term ${number}: ${CELL_WORDS[state]}`}</span>
                  </td>
                );
              })}
              <td className="nums whitespace-nowrap pl-2 text-right text-sm-minus text-[color:var(--text-muted)]">
                {experienceCount(row, intern.experienceTermsNeeded)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-[color:var(--text-muted)]">
        Filled: covered in that term. Dashed: this term, not finished. Category D applies to PGY1.
      </p>
    </CmeGroup>
  );
}

/** The junior doctor's headings with no figures: what a signed-in doctor sees. */
function CmeInternNotRecorded() {
  return (
    <>
      <CmeGroup label="This term" testId="cme-training-this-term">
        <NotRecorded />
      </CmeGroup>
      <CmeGroup label="EPA assessments" testId="cme-training-epa-assessments">
        <RuleSource source={TRAINING_RULE_FIGURES.amcEpa.source} checkedOn={TRAINING_RULE_FIGURES.amcEpa.checkedOn} />
        <p className="text-sm text-[color:var(--text)]">
          At least 10 a year, at least 2 each term. {TRAINING_RULE_FIGURES.amcEpa.perEpa}
        </p>
        <NotRecorded testId="cme-training-epa-assessments-not-recorded" />
      </CmeGroup>
      <CmeGroup label="Clinical experience · terms done" testId="cme-training-experience">
        <NotRecorded />
      </CmeGroup>
    </>
  );
}

/** The official record and Teaching links at the foot of the junior doctor's page. */
function CmeInternLinks({ teaching }: { readonly teaching: boolean }) {
  return (
    <CmeFlatList label="Official records" testId="cme-training-intern-links">
      <RecordLinkRow
        testId="cme-training-eportfolio"
        href={EPORTFOLIO_HREF}
        external
        lead={<ArrowUpRight aria-hidden="true" strokeWidth={1.6} />}
        title="Your ePortfolio"
        subtitle="The official record of your training"
      />
      {teaching ? (
        <RecordLinkRow
          testId="cme-training-teaching"
          href="/teaching"
          lead={<GraduationCap aria-hidden="true" strokeWidth={1.6} />}
          title="Intern teaching"
          subtitle="In Teaching"
        />
      ) : null}
    </CmeFlatList>
  );
}
