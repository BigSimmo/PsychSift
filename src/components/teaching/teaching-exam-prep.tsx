"use client";

import { ChevronRight, Pencil, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeFeaturedModule } from "@/components/mode-kit/featured-module";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modePressable } from "@/components/mode-kit/recipes";
import {
  modeDisplayNumberText,
  modeHeadingText,
  modeNameText,
  modeNumberText,
  modeSecondaryText,
} from "@/components/mode-kit/type";
import { perthDateKey } from "@/components/teaching/teaching-dates";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { TeachingModule } from "@/components/teaching/teaching-modules";
import { TeachingUndoBar } from "@/components/teaching/teaching-row";
import {
  NoPatientDetailsMark,
  TermAddItem,
  TermDateTile,
  TermRemoveButton,
} from "@/components/teaching/teaching-term-kit";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useExamPrepStore } from "@/lib/teaching/term-tracker-store";
import { Button } from "@/components/ui/button";
import { ChoiceChip } from "@/components/ui/chip";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import {
  addDays,
  dayMonth,
  daysBetween,
  formatMinutesAsHours,
  newItemId,
  sampleExamPrep,
  studyHeatmap,
  studyMinutesSince,
  studyPlanWeek,
  studyStreak,
  weekdayDayMonth,
  weekdayShort,
  type ExamPrepState,
  type HeatCell,
} from "@/lib/teaching/term-tracker";

type Update = (change: (current: ExamPrepState) => ExamPrepState) => void;

const STUDY_STEPS = [30, 60, 90, 120] as const;
const TOPIC_STEPS = [0, 25, 50, 75, 100] as const;

/* ---------- the exam: name and date, set by the doctor ---------- */

function ExamForm({
  exam,
  today,
  update,
  onDone,
}: {
  exam: ExamPrepState["exam"];
  today: string;
  update: Update;
  onDone?: () => void;
}) {
  const [name, setName] = useState(exam?.name ?? "");
  const [on, setOn] = useState(exam?.on ?? "");
  const [error, setError] = useState("");
  return (
    <form
      className="grid gap-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (on <= today) {
          setError("Choose a date after today.");
          return;
        }
        update((current) => ({
          ...current,
          // The plan starts the day it is first set, and keeps that start when the date moves.
          exam: { name: name.trim(), on, planStartsOn: current.exam?.planStartsOn ?? today },
        }));
        onDone?.();
      }}
    >
      <TextField
        label="Exam"
        placeholder="Written exam"
        maxLength={120}
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label="Date"
        type="date"
        required
        min={addDays(today, 1)}
        hint="The date you were given. PsychSift does not look up college dates."
        value={on}
        onChange={(event) => setOn(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          {exam ? "Save" : "Start the countdown"}
        </Button>
        {onDone ? (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Countdown({
  exam,
  today,
  onEdit,
}: {
  exam: NonNullable<ExamPrepState["exam"]>;
  today: string;
  onEdit: () => void;
}) {
  const days = daysBetween(today, exam.on);
  const plan = studyPlanWeek(exam, today);
  return (
    <ModeFeaturedModule mode="teaching" testId="teaching-exam-countdown" className="grid gap-3 p-3">
      <div className="flex items-center gap-3">
        <TermDateTile date={exam.on} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className={cn(modeHeadingText, "text-lg-minus break-words text-[color:var(--text-heading)]")}>
            {exam.name}
          </h2>
          <p className={modeSecondaryText}>{weekdayDayMonth(exam.on)} · set by you</p>
        </div>
        <Button type="button" variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>
          Edit
        </Button>
      </div>
      {days >= 0 ? (
        <p className="flex items-baseline gap-2">
          <span className={cn(modeDisplayNumberText, "text-4xl text-[color:var(--mode-identity)]")}>{days}</span>
          <span className="text-base-minus text-[color:var(--text)]">{days === 1 ? "day to go" : "days to go"}</span>
        </p>
      ) : (
        <p className="text-base-minus text-[color:var(--text)]">This date has passed. Set your next exam with Edit.</p>
      )}
      {days >= 0 ? (
        <div className="grid gap-1.5">
          <p className={cn("text-sm", textMuted)}>
            Study plan · week {plan.week} of {plan.total}
          </p>
          <div aria-hidden="true" className="flex gap-0.5">
            {Array.from({ length: plan.total }, (_, index) => (
              <span
                key={index}
                className={cn(
                  "h-1.5 min-w-0 flex-1 rounded-full",
                  index < plan.week ? "bg-[color:var(--mode-identity)]" : "bg-[color:var(--surface-inset)]",
                )}
              />
            ))}
          </div>
        </div>
      ) : null}
    </ModeFeaturedModule>
  );
}

/* ---------- study log and heatmap ---------- */

const heatClass: Record<HeatCell["level"], string> = {
  0: "bg-[color:var(--surface-inset)]",
  1: "bg-[color:var(--mode-identity)] opacity-25",
  2: "bg-[color:var(--mode-identity)] opacity-50",
  3: "bg-[color:var(--mode-identity)] opacity-75",
  4: "bg-[color:var(--mode-identity)]",
};

function StudyHeatmap({ weeks, today }: { weeks: HeatCell[][]; today: string }) {
  return (
    <div className="grid gap-1.5">
      <div role="img" aria-label="Study by day, last 12 weeks" className="grid grid-flow-col grid-rows-7 gap-1">
        {weeks.flat().map((cell) => (
          <span
            key={cell.date}
            title={`${weekdayDayMonth(cell.date)}: ${cell.minutes} min`}
            className={cn(
              "aspect-square w-full rounded-sm",
              cell.future ? "bg-transparent" : heatClass[cell.level],
              cell.date === today &&
                "ring-2 ring-[color:var(--text-heading)] ring-offset-1 ring-offset-[color:var(--surface-raised)]",
            )}
          />
        ))}
      </div>
      <div className={cn("flex items-center justify-between text-xs", textMuted)}>
        <span>{dayMonth(weeks[0][0].date)}</span>
        <span aria-hidden="true" className="flex items-center gap-1">
          Less
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span key={level} className={cn("inline-block size-2.5 rounded-sm", heatClass[level])} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

function Study({ state, today, update }: { state: ExamPrepState; today: string; update: Update }) {
  const weeks = studyHeatmap(state.study, today);
  const total = studyMinutesSince(state.study, weeks[0][0].date, today);
  const streak = studyStreak(state.study, today);
  const todayMinutes = state.study[today] ?? 0;
  const [undo, setUndo] = useState<{ before: number; added: number } | null>(null);
  const log = (minutes: number) => {
    update((current) => {
      const next = Math.min(24 * 60, (current.study[today] ?? 0) + minutes);
      return { ...current, study: { ...current.study, [today]: next } };
    });
    setUndo({ before: todayMinutes, added: minutes });
  };
  let streakLine = "Log today's study to start a run.";
  if (streak === 1) streakLine = "1 day in a row.";
  if (streak > 1) streakLine = `${streak} days in a row.`;
  return (
    <TeachingModule title="Last 12 weeks" testId="teaching-exam-study">
      <div className="grid gap-3 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex items-baseline gap-1.5">
            <span className={cn(modeNumberText, "text-2xl text-[color:var(--text-heading)]")}>
              {formatMinutesAsHours(total)}
            </span>
            <span className={cn("text-sm", textMuted)}>logged</span>
          </p>
          <p className="text-sm text-[color:var(--text)]">{streakLine}</p>
        </div>
        <StudyHeatmap weeks={weeks} today={today} />
        <fieldset className="grid gap-2">
          <legend className={cn(modeNameText, "mb-1 text-sm text-[color:var(--text-heading)]")}>
            Log study for today{todayMinutes ? ` · ${todayMinutes} min so far` : ""}
          </legend>
          <div className="flex flex-wrap gap-2">
            {STUDY_STEPS.map((minutes) => (
              <ChoiceChip key={minutes} pressed={false} onPressedChange={() => log(minutes)}>
                + {minutes} min
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
      </div>
      {undo ? (
        <TeachingUndoBar
          testId="teaching-exam-study-undo"
          onUndo={() => {
            update((current) => {
              const study = { ...current.study };
              if (undo.before) study[today] = undo.before;
              else delete study[today];
              return { ...current, study };
            });
            setUndo(null);
          }}
        >
          Added {undo.added} min for today
        </TeachingUndoBar>
      ) : null}
    </TeachingModule>
  );
}

/* ---------- topics ---------- */

function Topics({ state, update }: { state: ExamPrepState; update: Update }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <TeachingModule title="Topics · your list" testId="teaching-exam-topics">
      {state.topics.length === 0 ? (
        <p className={cn("px-3 pt-2 text-sm", textMuted)}>
          Add the topics from your college syllabus, then mark how far through each you are.
        </p>
      ) : null}
      <ul className="mt-1">
        {state.topics.map((topic) => (
          <li key={topic.id} className={cn(modeInsetHairline, "grid gap-2 py-2 pr-1 pl-3")}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-expanded={open === topic.id}
                onClick={() => setOpen((current) => (current === topic.id ? null : topic.id))}
                className={cn("grid min-h-12 min-w-0 flex-1 gap-1.5 text-left", modePressable, focusRing)}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn(modeNameText, "text-base-minus break-words text-[color:var(--text-heading)]")}>
                    {topic.name}
                  </span>
                  <span className={cn(modeNumberText, "shrink-0 text-sm", textMuted)}>{topic.percent}%</span>
                </span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 100 6"
                  preserveAspectRatio="none"
                  className="h-1.5 w-full overflow-hidden rounded-full"
                >
                  <rect width="100" height="6" rx="3" className="fill-[color:var(--surface-inset)]" />
                  <rect width={topic.percent} height="6" rx="3" className="fill-[color:var(--mode-identity)]" />
                </svg>
              </button>
              <TermRemoveButton
                label={`Remove topic: ${topic.name}`}
                onRemove={() =>
                  update((current) => ({ ...current, topics: current.topics.filter((t) => t.id !== topic.id) }))
                }
              />
            </div>
            {open === topic.id ? (
              <div role="group" aria-label={`How far through ${topic.name}`} className="flex flex-wrap gap-2 pb-1">
                {TOPIC_STEPS.map((percent) => (
                  <ChoiceChip
                    key={percent}
                    size="compact"
                    pressed={topic.percent === percent}
                    onPressedChange={() =>
                      update((current) => ({
                        ...current,
                        topics: current.topics.map((t) => (t.id === topic.id ? { ...t, percent } : t)),
                      }))
                    }
                  >
                    {percent}%
                  </ChoiceChip>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="grid gap-1 p-3">
        <TermAddItem
          label="Add a topic"
          placeholder="Add a topic"
          disabled={state.topics.length >= 40}
          onAdd={(name) =>
            update((current) => ({
              ...current,
              topics: [...current.topics, { id: newItemId("topic"), name, percent: 0 }],
            }))
          }
        />
        <p className={cn("text-xs", textMuted)}>
          Topic names come from your college syllabus. PsychSift adds none of its own.
        </p>
      </div>
    </TeachingModule>
  );
}

/* ---------- study group ---------- */

function GroupForm({ group, update, onDone }: { group: ExamPrepState["group"]; update: Update; onDone: () => void }) {
  const [title, setTitle] = useState(group?.title ?? "");
  const [on, setOn] = useState(group?.on ?? "");
  const [time, setTime] = useState(group?.time ?? "");
  const [place, setPlace] = useState(group?.place ?? "");
  return (
    <form
      className="grid gap-2 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        update((current) => ({ ...current, group: { title: title.trim(), on, time, place: place.trim() } }));
        onDone();
      }}
    >
      <TextField
        label="What"
        placeholder="Practice questions"
        maxLength={120}
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Date" type="date" required value={on} onChange={(event) => setOn(event.target.value)} />
        <TextField label="Time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
      </div>
      <TextField label="Where" maxLength={120} value={place} onChange={(event) => setPlace(event.target.value)} />
      <NoPatientDetailsMark />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          Save
        </Button>
        {group ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              update((current) => ({ ...current, group: null }));
              onDone();
            }}
          >
            Clear
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StudyGroup({ state, today, update }: { state: ExamPrepState; today: string; update: Update }) {
  const [editing, setEditing] = useState(false);
  const group = state.group;
  return (
    <TeachingModule
      title="Study group"
      icon={Users}
      testId="teaching-exam-group"
      aside={
        !editing ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {group ? "Change" : "Add"}
          </Button>
        ) : null
      }
    >
      {editing ? (
        <GroupForm group={group} update={update} onDone={() => setEditing(false)} />
      ) : group ? (
        <div className="flex items-center gap-3 p-3">
          <TermDateTile date={group.on} />
          <div className="grid min-w-0 gap-0.5">
            <p className={cn(modeNameText, "text-base-minus break-words text-[color:var(--text-heading)]")}>
              {group.title}
            </p>
            <p className={modeSecondaryText}>
              {[`${weekdayShort(group.on)} ${group.time}`.trim(), group.place, group.on < today ? "past" : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      ) : (
        <p className={cn("p-3 text-sm", textMuted)}>Keep your next study group here.</p>
      )}
    </TeachingModule>
  );
}

/* ---------- the page ---------- */

function TeachingExamPrepContent({ demoMode }: { demoMode: boolean }) {
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const sample = useMemo(() => (demoMode && today ? sampleExamPrep(today) : null), [demoMode, today]);
  const store = useExamPrepStore(sample);
  const [editingExam, setEditingExam] = useState(false);
  const state = store.state;

  let body;
  if (!today || !state || (demoMode && !sample)) body = <ModeModuleSkeleton rows={3} />;
  else
    body = (
      <>
        {!state.exam || editingExam ? (
          <TeachingModule title={state.exam ? "Edit exam" : "Your exam"} testId="teaching-exam-setup">
            {!state.exam ? (
              <p className={cn("px-3 pt-2 text-sm", textMuted)}>
                Set the exam you are sitting and its date for a countdown. Everything here stays on this device.
              </p>
            ) : null}
            <ExamForm
              exam={state.exam}
              today={today}
              update={store.update}
              onDone={state.exam ? () => setEditingExam(false) : undefined}
            />
          </TeachingModule>
        ) : (
          <Countdown exam={state.exam} today={today} onEdit={() => setEditingExam(true)} />
        )}
        <Study state={state} today={today} update={store.update} />
        <Topics state={state} update={store.update} />
        <StudyGroup state={state} today={today} update={store.update} />
        <nav aria-label="Leave and materials" className="grid gap-3">
          <Link
            href="/roster/requests"
            className={cn(
              "flex min-h-13 items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 no-underline",
              modePressable,
              focusRing,
            )}
          >
            <span className="grid min-w-0 flex-1 gap-0.5 py-1">
              <span className={cn(modeNameText, "text-base-minus text-[color:var(--text-heading)]")}>
                Study and exam leave
              </span>
              <span className={modeSecondaryText}>Plan it in Roster requests</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
          </Link>
          <Link
            href="/teaching/resources"
            className={cn(
              "flex min-h-13 items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 no-underline",
              modePressable,
              focusRing,
            )}
          >
            <span className="grid min-w-0 flex-1 gap-0.5 py-1">
              <span className={cn(modeNameText, "text-base-minus text-[color:var(--text-heading)]")}>
                Teaching resources
              </span>
              <span className={modeSecondaryText}>Collections, recordings and saved items</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
          </Link>
        </nav>
      </>
    );

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-exam-prep">
      <div data-mode-identity="teaching" className="grid gap-3">
        <h1 className="text-xl font-semibold text-[color:var(--text-heading)]">Exam prep</h1>
        {demoMode ? <ModeNotice>Made-up demo. Changes stay on this page and are not saved.</ModeNotice> : null}
        {body}
      </div>
    </InformationPageShell>
  );
}

export function TeachingExamPrep(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={TeachingExamPrepContent} {...props} />;
}
