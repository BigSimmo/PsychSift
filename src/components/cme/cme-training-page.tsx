"use client";

import { AlertTriangle, BookOpen, CalendarDays, ClipboardList, Clock, GraduationCap, Info, Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { cardSurface } from "@/components/card-recipes";
import { CmeFlatList, CmeGroup, CmeNote, CmeRowMark, CmeTextLink } from "@/components/cme/cme-flat-list";
import { formatSourceMonth } from "@/components/cme/cme-plan-goal-split";
import { CmeRotationTrack, CmeTrainingTimeline } from "@/components/cme/cme-training-timeline";
import { CmeDateField, useCmeDateChecks } from "@/components/cme/cme-date-field";
import { modeInsetHairline } from "@/components/mode-kit/recipes";
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
import { cmePageTitle } from "@/components/cme/cme-page-frame";

/**
 * TRAINING — the trainee's own record of their training: stages, rotations
 * and breaks, where they are today, the training clock, and the next
 * milestone due.
 *
 * Nothing is preloaded. The college's stage lengths and milestones are the
 * trainee's to enter from the college's current requirements; this page only
 * does arithmetic on what they wrote. It never reads or changes CPD targets.
 *
 * Every write goes through `/api/cme/training`; the server re-checks the whole
 * timeline before saving, and the same check runs here first so a problem is
 * shown beside the form rather than after a round trip.
 */

type RecordType = "period" | "milestone";

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
}: {
  readonly nowIso: string;
  readonly initialPeriods: readonly TrainingPeriod[];
  readonly initialMilestones: readonly TrainingMilestone[];
  readonly demoMode: boolean;
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
    setPeriodErrors({});
    setPeriodProblems([]);
    setError(null);
  }

  function openMilestone(milestone?: TrainingMilestone) {
    setMilestoneDraft(milestone ? milestoneToDraft(milestone) : emptyMilestoneDraft);
    setMilestoneEditing(milestone ? milestone.id : "new");
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
      className={cn(cardSurface, "mt-3 space-y-4 p-4")}
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
      className={cn(cardSurface, "mt-3 space-y-4 p-4")}
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
  const cpdRule = cpdRuleFromTraining(position);

  return (
    <main data-testid="cme-training" data-mode-identity="cme" className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h1 className={cmePageTitle}>Training</h1>
      <p className={cn(textMuted, "mt-1 text-sm")}>
        Your own record of your training. It is not the college&apos;s record, and nothing here changes your CPD
        targets.
      </p>

      <div className="mt-6 grid gap-6">
        {error ? (
          <CmeNote tone="warn" role="alert" icon={<AlertTriangle aria-hidden="true" strokeWidth={1.6} />}>
            {error}
          </CmeNote>
        ) : null}

        {isEmpty ? (
          <CmeNote
            testId="cme-training-empty"
            icon={<GraduationCap aria-hidden="true" strokeWidth={1.6} />}
            title="Nothing is preloaded here."
          >
            Enter your own stages, rotations, breaks and milestones from your college&apos;s current requirements. The
            page then shows where you are, your training time so far, and what is due next.
          </CmeNote>
        ) : null}

        {rotation ? (
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

        {isEmpty ? null : (
          <CmeGroup label="Your training record" testId="cme-training-position">
            <CmeFlatList label="Your training record">
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
              <RecordRow
                testId="cme-training-next"
                lead={<CalendarDays aria-hidden="true" strokeWidth={1.6} />}
                title={next ? `Next due: ${next.milestone.label}` : "Next due"}
                subtitle={
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
                }
              />
            </CmeFlatList>
          </CmeGroup>
        )}

        <CmeGroup label="EPAs and assessments" testId="cme-training-assessments">
          <div className="grid gap-3">
            <CmeNote icon={<Info aria-hidden="true" strokeWidth={1.6} />}>
              PsychSift does not record EPAs, WBAs or term assessments yet, so nothing is counted here. Keep them in
              your official record: InTrain for RANZCP trainees, Clinical Learning Australia (your e-portfolio) for
              interns and PGY2 doctors.
            </CmeNote>
            <ul role="list" aria-label="Assessment rules" className="grid gap-3">
              {TRAINING_RULE_FIGURES.map((rule) => (
                <li key={rule.id} data-testid={`cme-training-rule-${rule.id}`} className="grid gap-0.5">
                  <span className="text-sm font-medium text-[color:var(--text-heading)]">{rule.title}</span>
                  <span className="text-sm-minus text-[color:var(--text-muted)]">{rule.text}</span>
                  <RuleSource source={rule.source} checkedOn={rule.checkedOn} />
                </li>
              ))}
            </ul>
          </div>
        </CmeGroup>

        <CmeGroup
          label="Stages, rotations and breaks"
          end={
            periodEditing ? null : (
              <CmeTextLink onClick={() => openPeriod()} testId="cme-training-add-period">
                Add <span className="sr-only">stage, rotation or break</span>
              </CmeTextLink>
            )
          }
        >
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
        </CmeGroup>

        <CmeGroup
          label="Milestones"
          end={
            milestoneEditing ? null : (
              <CmeTextLink onClick={() => openMilestone()} testId="cme-training-add-milestone">
                Add <span className="sr-only">milestone</span>
              </CmeTextLink>
            )
          }
        >
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
        </CmeGroup>

        <CmeGroup
          label="Your CPD rule"
          testId="cme-training-cpd-rule"
          end={<RuleSource source="Medical Board" checkedOn={CPD_CATEGORY_RULE_SET.source.checkedOn} />}
        >
          <CmeFlatList label="Your CPD rule">
            <RecordRow
              testId="cme-training-cpd-rule-result"
              title={cpdRule.lane === "trainee" ? "Trainee in an accredited college programme" : "Everyone else"}
              subtitle={cpdRule.lane === "trainee" ? "Covered by your training" : CPD_STANDARD_RULE_TEXT}
              end={
                <CmeTextLink href="/cme/setup" testId="cme-training-cpd-rule-change">
                  Change in Set up
                </CmeTextLink>
              }
            />
          </CmeFlatList>
          <p className="text-xs text-[color:var(--text-muted)]" data-testid="cme-training-cpd-rule-basis">
            {cpdRule.basis}
          </p>
        </CmeGroup>

        <p className="text-xs text-[color:var(--text-muted)]">
          {demoMode ? "" : "Saved privately in your PsychSift account. "}Your Director of Training, term supervisor or
          medical education unit has the final word on every requirement.
        </p>
      </div>

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

/** The quiet card the mock-up puts around a drawing and its rows. */
const cardShell =
  "grid min-w-0 gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 forced-colors:border-[CanvasText]";

/**
 * One row of a record list: like `CmeFlatRow`, but the second line is never
 * cut short, because here it can carry a caveat ("This is an estimate…") or a
 * problem to fix, and the end slot can hold two text links.
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
 * Assessment rule figures shown as plain reference beside the training record.
 * The words are copied from Josh's 5 Oct mock-up; they were not checked
 * against the source for this build, so `checkedOn` stays null and the page
 * says so, and they are NOT signed off, so every one is shown with "Not
 * signed off". Nothing is counted
 * against them: PsychSift has no EPA or WBA record. Agents never sign these.
 */
const TRAINING_RULE_FIGURES = [
  {
    id: "ranzcp-epa",
    title: "RANZCP EPAs",
    text: "At least 2 for each 6-month full-time rotation, pro rata if part-time. Three WBAs do not by themselves mean an EPA is attained.",
    source: "RANZCP",
    checkedOn: null,
  },
  {
    id: "amc-epa",
    title: "Intern and PGY2 EPA assessments",
    text: "At least 10 a year and at least 2 each term. EPA 1 at least once each term; EPAs 2 to 4 at least twice a year. Set by the AMC National Framework and run in WA by PMCWA.",
    source: "AMC framework",
    checkedOn: null,
  },
] as const;

const MS_PER_DAY = 86_400_000;

/** "today", "tomorrow", "in 12 days", "in 4 weeks", "in about 17 weeks". Both dates are Perth `YYYY-MM-DD`. */
function timeUntil(today: string, date: string): string {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY);
  if (days < 0) return days === -1 ? "yesterday" : `${-days} days ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  return days % 7 === 0 ? `in ${days / 7} weeks` : `in about ${Math.round(days / 7)} weeks`;
}
