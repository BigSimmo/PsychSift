"use client";

import { withUnit } from "@/components/teaching/teaching-number";
import { CalendarDays, Layers, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  T5Actions,
  T5Heading,
  T5Icon,
  T5Kicker,
  T5Link,
  T5List,
  T5Meta,
  T5Meter,
  T5Note,
  T5Page,
  T5Pair,
  T5Panel,
  T5Row,
  T5Section,
  T5Button,
} from "@/components/teaching/t5-kit";
import { mondayOf, perthDateKey } from "@/components/teaching/teaching-dates";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { TeachingUndoBar } from "@/components/teaching/teaching-row";
import { NoPatientDetailsMark, TermAddItem, TermRemoveButton } from "@/components/teaching/teaching-term-kit";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { useTeachingSignedOut } from "@/components/teaching/use-teaching-sample";
import { useExamPrepStore } from "@/lib/teaching/term-tracker-store";
import { ChoiceChip } from "@/components/ui/chip";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/components/ui-primitives";
import { KeptWhere } from "@/components/work-sync/kept-where";
import type { ResourcesForWeek } from "@/lib/teaching/model";
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
  type ExamPrepState,
  type HeatCell,
} from "@/lib/teaching/term-tracker";
import { useExampleData } from "@/lib/example-data/store";

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
      className="grid gap-3 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) {
          setError("Enter the exam's name.");
          return;
        }
        if (on <= today) {
          setError("Choose a date after today.");
          return;
        }
        update((current) => {
          // The plan starts the day it is first set and keeps that start when the date moves, but a new
          // exam after one that has passed, or a date earlier than the old start, starts a fresh plan.
          const previous = current.exam;
          const keep = previous && previous.on > today && on > previous.planStartsOn;
          return { ...current, exam: { name: name.trim(), on, planStartsOn: keep ? previous.planStartsOn : today } };
        });
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
        <T5Button type="submit" variant="primary">
          {exam ? "Save" : "Start the countdown"}
        </T5Button>
        {onDone ? (
          <T5Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </T5Button>
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
    // Work-mode redesign, owner request 6 Oct 2026: the countdown is the page's hero while the exam is ahead.
    <T5Panel hero={days >= 0} label="Your exam" testId="teaching-exam-countdown">
      <T5Kicker>{`${exam.name} · ${weekdayDayMonth(exam.on)}`}</T5Kicker>
      {days >= 0 ? (
        <>
          <T5Heading big>{days === 0 ? "Today" : `${days} ${days === 1 ? "day" : "days"}`}</T5Heading>
          <T5Pair label="Study plan" value={`Week ${withUnit(plan.week, "of")} ${plan.total}`} />
          <T5Meter
            percent={Math.round((plan.week / plan.total) * 100)}
            label={`Week ${withUnit(plan.week, "of")} ${plan.total}`}
          />
        </>
      ) : (
        <T5Heading>This date has passed</T5Heading>
      )}
      <T5Meta>
        {days >= 0 ? "The date you entered. Check it against your college." : "Set your next exam with Edit."}
      </T5Meta>
      <T5Actions>
        <T5Link onClick={onEdit} quiet label="Edit the exam name or date">
          Edit
        </T5Link>
      </T5Actions>
    </T5Panel>
  );
}

/* ---------- study log and heatmap ---------- */

const heatClass: Record<HeatCell["level"], string> = {
  // Forced colours drop backgrounds, so each level falls back to CanvasText at its own opacity.
  0: "bg-[color:var(--surface-inset)] forced-colors:border forced-colors:border-[CanvasText]",
  1: "bg-[color:var(--mode-identity)] opacity-25 forced-colors:bg-[CanvasText]",
  2: "bg-[color:var(--mode-identity)] opacity-50 forced-colors:bg-[CanvasText]",
  3: "bg-[color:var(--mode-identity)] opacity-75 forced-colors:bg-[CanvasText]",
  4: "bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]",
};

function StudyHeatmap({ weeks, today, label }: { weeks: HeatCell[][]; today: string; label: string }) {
  return (
    <div className="grid gap-1.5">
      <div role="img" aria-label={label} className="grid grid-flow-col grid-cols-12 grid-rows-7 gap-0.75">
        {weeks.flat().map((cell) => (
          <span
            key={cell.date}
            title={`${weekdayDayMonth(cell.date)}: ${withUnit(cell.minutes, "min")}`}
            className={cn(
              "h-3.25 rounded-xs",
              cell.future ? "bg-transparent" : heatClass[cell.level],
              cell.date === today &&
                "outline-[1.5px] outline-offset-0 outline-[color:var(--text-heading)] outline-solid",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-2xs text-[color:var(--text-muted)]">
        <span>{dayMonth(weeks[0][0].date)}</span>
        <span aria-hidden="true" className="flex items-center gap-1">
          Less
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span key={level} className={cn("inline-block size-2.5 rounded-xs", heatClass[level])} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

/** "30 min", "1 h", "1 h 30" on a button; `spoken` adds the minutes unit ("1 h 30 min") for reading. */
function studyStepLabel(minutes: number, spoken = false): string {
  if (minutes < 60) return withUnit(minutes, "min");
  const rest = minutes % 60;
  if (!rest) return withUnit(minutes / 60, "h");
  return `${withUnit(Math.floor(minutes / 60), "h")} ${spoken ? withUnit(rest, "min") : rest}`;
}

function Study({ state, today, update }: { state: ExamPrepState; today: string; update: Update }) {
  const weeks = studyHeatmap(state.study, today);
  const total = studyMinutesSince(state.study, weeks[0][0].date, today);
  const streak = studyStreak(state.study, today);
  const todayMinutes = state.study[today] ?? 0;
  // The undo remembers the day and what was really added (a day is capped at 24 h), so an undo after
  // midnight or at the cap restores exactly what was there.
  const [undo, setUndo] = useState<{ day: string; before: number; added: number } | null>(null);
  const log = (minutes: number) => {
    const next = Math.min(24 * 60, todayMinutes + minutes);
    update((current) => ({ ...current, study: { ...current.study, [today]: next } }));
    setUndo({ day: today, before: todayMinutes, added: next - todayMinutes });
  };
  let streakLine = "Log today's study to start a run.";
  if (streak === 1) streakLine = "1 day in a row";
  if (streak > 1) streakLine = `${streak} days in a row`;
  return (
    <>
      <T5Section
        label="Add study for today"
        right={todayMinutes ? <T5Meta>{`${studyStepLabel(todayMinutes, true)} so far`}</T5Meta> : null}
        testId="teaching-exam-log"
      >
        <div
          role="group"
          aria-label="Add study for today"
          className="flex gap-2 border-t border-[color:var(--border)] pt-2.5"
        >
          {STUDY_STEPS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => log(minutes)}
              aria-label={`Add ${studyStepLabel(minutes, true)}${"\u00a0"}of study for today`}
              className={cn(
                "relative grid h-10 flex-1 place-items-center rounded-md border border-[color:var(--border-strong)] text-sm font-semibold text-[color:var(--text-heading)] after:absolute after:inset-x-0 after:top-1/2 after:h-12 after:-translate-y-1/2",
                focusRing,
              )}
            >
              {studyStepLabel(minutes)}
            </button>
          ))}
        </div>
      </T5Section>
      <T5Section label={`Last ${withUnit(12, "weeks")} · ${formatMinutesAsHours(total)}`} testId="teaching-exam-study">
        <div className="grid gap-2 border-t border-[color:var(--border)] pt-2.5">
          <p className="text-sm font-medium text-[color:var(--text-heading)]">{streakLine}</p>
          <StudyHeatmap
            weeks={weeks}
            today={today}
            label={`Study minutes per day for ${withUnit(12, "weeks")}. ${streakLine}`}
          />
        </div>
      </T5Section>
      {undo ? (
        <TeachingUndoBar
          testId="teaching-exam-study-undo"
          onUndo={() => {
            update((current) => {
              const study = { ...current.study };
              if (undo.before) study[undo.day] = undo.before;
              else delete study[undo.day];
              return { ...current, study };
            });
            setUndo(null);
          }}
        >
          {`Added ${studyStepLabel(undo.added, true)} for ${undo.day === today ? "today" : "that day"}`}
        </TeachingUndoBar>
      ) : null}
    </>
  );
}

/* ---------- topics ---------- */

function Topics({ state, update }: { state: ExamPrepState; update: Update }) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <T5Section
      label={`Your topics · ${state.topics.length}`}
      right={<T5Link onClick={() => setAdding((value) => !value)}>{adding ? "Done" : "Add topic"}</T5Link>}
      testId="teaching-exam-topics"
    >
      {state.topics.length === 0 && !adding ? (
        <T5Meta className="border-t border-[color:var(--border)] py-2.5">
          Add the topics from your college syllabus, then mark how far through each you are.
        </T5Meta>
      ) : null}
      <T5List ruled>
        {state.topics.map((topic) => (
          <li key={topic.id} className="grid min-w-0 gap-1 py-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-expanded={open === topic.id}
                onClick={() => setOpen((current) => (current === topic.id ? null : topic.id))}
                className={cn("grid min-h-12 min-w-0 flex-1 gap-1.5 rounded-sm text-left", focusRing)}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium break-words text-[color:var(--text-heading)]">{topic.name}</span>
                  <span className="shrink-0 text-sm font-normal text-[color:var(--text-heading)] tabular-nums">
                    {topic.percent}%
                  </span>
                </span>
                <T5Meter percent={topic.percent} thin />
              </button>
              {adding ? (
                <TermRemoveButton
                  label={`Remove topic: ${topic.name}`}
                  onRemove={() =>
                    update((current) => ({ ...current, topics: current.topics.filter((t) => t.id !== topic.id) }))
                  }
                />
              ) : null}
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
        {adding ? (
          <li className="grid gap-1 py-2">
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
            <T5Meta>Topic names come from your college syllabus. PsychSift adds none of its own.</T5Meta>
          </li>
        ) : null}
      </T5List>
    </T5Section>
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
      className="grid gap-2 py-3"
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
      <NoPatientDetailsMark section="teachingExamPrep" />
      <div className="flex flex-wrap gap-2">
        <T5Button type="submit" variant="primary">
          Save
        </T5Button>
        {group ? (
          <T5Button
            type="button"
            variant="ghost"
            onClick={() => {
              update((current) => ({ ...current, group: null }));
              onDone();
            }}
          >
            Clear
          </T5Button>
        ) : null}
        <T5Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </T5Button>
      </div>
    </form>
  );
}

function StudyGroup({ state, today, update }: { state: ExamPrepState; today: string; update: Update }) {
  const [editing, setEditing] = useState(false);
  const group = state.group;
  return (
    <T5Section
      label="Study group"
      right={!editing && !group ? <T5Link onClick={() => setEditing(true)}>Add</T5Link> : null}
      testId="teaching-exam-group"
    >
      {editing ? (
        <div className="border-t border-[color:var(--border)]">
          <GroupForm group={group} update={update} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <T5List ruled>
          {group ? (
            <T5Row
              title={group.title}
              meta={[
                [weekdayDayMonth(group.on), group.time].filter(Boolean).join(", "),
                group.place,
                group.on < today ? "past" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              lead={<T5Icon icon={Users} />}
              end={
                <T5Link onClick={() => setEditing(true)} label={`Change study group: ${group.title}`}>
                  Change
                </T5Link>
              }
            />
          ) : (
            <li className="py-2.5">
              <T5Meta>Keep your next study group here.</T5Meta>
            </li>
          )}
        </T5List>
      )}
    </T5Section>
  );
}

/* ---------- the organisers' exam prep collection ---------- */

/**
 * The organisers' own exam prep collection, when the doctor's service has one: "Exam prep collection · 9 items
 * from organisers". It reads the same week summary Resources reads; with none, or when that read fails, the row
 * falls back to Resources itself. This page's own records never leave the device.
 */
function useExamCollection(today: string | null) {
  const signedOut = useTeachingSignedOut();
  const read = useTeachingResource<ResourcesForWeek>(
    today && !signedOut ? `/api/teaching/resources?action=resources.read&weekStart=${mondayOf(today)}` : null,
  );
  const collections = read.data?.collections ?? [];
  return (
    collections.find((collection) => /\bexam prep\b/i.test(collection.name)) ??
    collections.find((collection) => /\bexam\b/i.test(collection.name)) ??
    null
  );
}

/* ---------- the page ---------- */

function TeachingExamPrepContent({ demoMode }: { demoMode: boolean }) {
  // The shared example banner already says the records are made up, so the demo note shows only without it.
  const { active: exampleShown } = useExampleData("teach");
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const sample = useMemo(() => (demoMode && today ? sampleExamPrep(today) : null), [demoMode, today]);
  const store = useExamPrepStore(sample);
  const [editingExam, setEditingExam] = useState(false);
  const state = store.state;
  const examCollection = useExamCollection(today);

  let body;
  if (!today || !state || (demoMode && !sample)) body = <ModeModuleSkeleton rows={3} />;
  else
    body = (
      <>
        {!state.exam || editingExam ? (
          <T5Panel testId="teaching-exam-setup">
            <T5Heading>{state.exam ? "Edit exam" : "Your exam"}</T5Heading>
            {!state.exam ? (
              <T5Meta>
                Set the exam you are sitting and its date for a countdown.{" "}
                <KeptWhere
                  section="teachingExamPrep"
                  account="Everything here is backed up to your account."
                  device="Everything here stays on this device."
                />
              </T5Meta>
            ) : null}
            <ExamForm
              exam={state.exam}
              today={today}
              update={store.update}
              onDone={state.exam ? () => setEditingExam(false) : undefined}
            />
          </T5Panel>
        ) : (
          <Countdown exam={state.exam} today={today} onEdit={() => setEditingExam(true)} />
        )}
        <Study state={state} today={today} update={store.update} />
        <Topics state={state} update={store.update} />
        <StudyGroup state={state} today={today} update={store.update} />
        <nav aria-label="Leave and materials">
          <T5List ruled className="mt-4.5">
            <T5Row
              title="Ask for study or exam leave"
              meta="In Roster, under requests"
              lead={<T5Icon icon={CalendarDays} />}
              href="/roster/requests"
            />
            {examCollection ? (
              <T5Row
                title={`${examCollection.name} collection`}
                meta={`${withUnit(examCollection.count, examCollection.count === 1 ? "item" : "items")} from organisers`}
                lead={<T5Icon icon={Layers} />}
                href={`/teaching/resources/${examCollection.collectionId}`}
                testId="teaching-exam-collection"
              />
            ) : (
              <T5Row
                title="Teaching resources"
                meta="Collections, recordings and saved items"
                lead={<T5Icon icon={Layers} />}
                href="/teaching/resources"
              />
            )}
          </T5List>
        </nav>
        <T5Note icon="shield" className="mt-3">
          Do not add patient details.{" "}
          <KeptWhere
            section="teachingExamPrep"
            account="Backed up to your account."
            device="Stays on this device and is not backed up."
          />
        </T5Note>
      </>
    );

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-exam-prep">
      <T5Page>
        <h1 className="sr-only">My exam prep</h1>
        {demoMode && !exampleShown ? (
          <T5Note className="mt-0 mb-3.5">Example data. Changes stay on this page and are not saved.</T5Note>
        ) : null}
        {body}
      </T5Page>
    </InformationPageShell>
  );
}

export function TeachingExamPrep(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={TeachingExamPrepContent} {...props} />;
}
