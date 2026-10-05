"use client";

import { CalendarClock, Check, ChevronRight, ExternalLink, Pencil } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeFeaturedModule } from "@/components/mode-kit/featured-module";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modePressable } from "@/components/mode-kit/recipes";
import { modeHeadingText, modeNameText, modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { perthDateKey } from "@/components/teaching/teaching-dates";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { TeachingModule } from "@/components/teaching/teaching-modules";
import { TeachingUndoBar } from "@/components/teaching/teaching-row";
import {
  NoPatientDetailsMark,
  TermAddItem,
  TermDateTile,
  TermPips,
  TermRemoveButton,
  TermRing,
} from "@/components/teaching/teaching-term-kit";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTermTrackerStore } from "@/components/teaching/use-term-tracker-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import {
  currentTerm,
  dayMonth,
  defaultMilestones,
  DEFAULT_EPA_TARGETS,
  epaLabels,
  epaNumbers,
  epaSummary,
  milestoneIds,
  milestoneLabels,
  milestoneState,
  newItemId,
  nextMilestone,
  sampleTermTracker,
  TERM_TRACKER_SOURCES,
  termWeekCount,
  termWeekOf,
  weekdayDayMonth,
  type EpaNumber,
  type MilestoneId,
  type TermRecord,
  type TermTrackerState,
} from "@/lib/teaching/term-tracker";

type Update = (change: (current: TermTrackerState) => TermTrackerState) => void;

function withTerm(state: TermTrackerState, termId: string, change: (term: TermRecord) => TermRecord): TermTrackerState {
  return { ...state, terms: state.terms.map((term) => (term.id === termId ? change(term) : term)) };
}

const externalLink = cn(
  "inline-flex min-h-12 items-center gap-1.5 text-sm font-medium text-[color:var(--primary)]",
  focusRing,
);

/* ---------- the term form: set up a term, or edit this one ---------- */

function TermForm({
  term,
  onSave,
  onCancel,
}: {
  term: TermRecord | null;
  onSave: (term: TermRecord) => void;
  onCancel?: () => void;
}) {
  const [number, setNumber] = useState(term?.number ? String(term.number) : "");
  const [unit, setUnit] = useState(term?.unit ?? "");
  const [site, setSite] = useState(term?.site ?? "");
  const [supervisor, setSupervisor] = useState(term?.supervisor ?? "");
  const [startsOn, setStartsOn] = useState(term?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(term?.endsOn ?? "");
  // Due dates are offered from the term dates until the doctor changes one; saving confirms them.
  const [due, setDue] = useState<Partial<Record<MilestoneId, string>>>(
    term ? { start: term.milestones.start.dueOn, mid: term.milestones.mid.dueOn, end: term.milestones.end.dueOn } : {},
  );
  const datesReady = /^\d{4}-\d{2}-\d{2}$/.test(startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(endsOn) && endsOn > startsOn;
  const offered = datesReady ? defaultMilestones(startsOn, endsOn) : null;
  const dueFor = (id: MilestoneId) => due[id] ?? offered?.[id].dueOn ?? "";
  const [error, setError] = useState("");

  return (
    <form
      className="grid gap-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!datesReady || !offered) {
          setError("The last day must be after the first day.");
          return;
        }
        const milestones = Object.fromEntries(
          milestoneIds.map((id) => [id, { dueOn: dueFor(id), doneOn: term?.milestones[id].doneOn ?? null }]),
        ) as TermRecord["milestones"];
        onSave({
          id: term?.id ?? newItemId("term"),
          number: number ? Number(number) : null,
          unit: unit.trim(),
          site: site.trim(),
          supervisor: supervisor.trim(),
          startsOn,
          endsOn,
          milestones,
          goals: term?.goals ?? [],
          toRaise: term?.toRaise ?? [],
          meeting: term?.meeting ?? null,
        });
      }}
    >
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <TextField
          label="Term"
          type="number"
          inputMode="numeric"
          min="1"
          max="20"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
        />
        <TextField
          label="Unit"
          placeholder="Psychiatry"
          maxLength={120}
          required
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
        />
      </div>
      <TextField
        label="Hospital or service"
        maxLength={120}
        value={site}
        onChange={(event) => setSite(event.target.value)}
      />
      <TextField
        label="Term supervisor"
        maxLength={120}
        value={supervisor}
        onChange={(event) => setSupervisor(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="First day"
          type="date"
          required
          value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)}
        />
        <TextField
          label="Last day"
          type="date"
          required
          value={endsOn}
          onChange={(event) => setEndsOn(event.target.value)}
        />
      </div>
      {offered ? (
        <fieldset className="grid gap-2">
          <legend className={cn(modeNameText, "mb-1 text-sm text-[color:var(--text-heading)]")}>
            Assessment due dates
          </legend>
          <p className={cn("text-sm", textMuted)}>Suggested from your term dates. Change them to match your MEU.</p>
          {milestoneIds.map((id) => (
            <TextField
              key={id}
              label={milestoneLabels[id].long}
              type="date"
              required
              min={startsOn}
              max={endsOn}
              value={dueFor(id)}
              onChange={(event) => setDue((current) => ({ ...current, [id]: event.target.value }))}
            />
          ))}
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          {term ? "Save term" : "Start tracking this term"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/* ---------- the featured card: which week, and what is next ---------- */

function TermSummary({
  term,
  today,
  onEdit,
  onNew,
}: {
  term: TermRecord;
  today: string;
  onEdit: () => void;
  onNew: () => void;
}) {
  const total = termWeekCount(term);
  const week = termWeekOf(term, today);
  const next = nextMilestone(term);
  const title = [term.number ? `Term ${term.number}` : null, term.unit].filter(Boolean).join(" · ");
  let weekLine = `Week ${week} of ${total}`;
  if (week === 0) weekLine = `Starts ${weekdayDayMonth(term.startsOn)}`;
  if (week > total) weekLine = "Term finished";
  return (
    <ModeFeaturedModule mode="teaching" testId="teaching-term-summary" className="grid gap-3 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h2 className={cn(modeHeadingText, "text-lg-minus break-words text-[color:var(--text-heading)]")}>{title}</h2>
          <p className={modeSecondaryText}>
            {[term.site, `${dayMonth(term.startsOn)} to ${dayMonth(term.endsOn)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>
          Edit
        </Button>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn(modeNumberText, "text-xl text-[color:var(--text-heading)]")}>{weekLine}</p>
        {next && week <= total ? (
          <p className="text-sm font-medium text-[color:var(--mode-identity)]">
            {milestoneLabels[next].short} {term.milestones[next].dueOn < today ? "was due" : "due"}{" "}
            {dayMonth(term.milestones[next].dueOn)}
          </p>
        ) : null}
      </div>
      <ol
        aria-label={`Weeks of the term, week ${Math.min(Math.max(week, 0), total)} of ${total}`}
        className="flex gap-1"
      >
        {Array.from({ length: total }, (_, index) => {
          const n = index + 1;
          const state = n < week ? "past" : n === week ? "now" : "later";
          return (
            <li
              key={n}
              aria-current={state === "now" ? "step" : undefined}
              className={cn(
                "grid h-7 min-w-0 flex-1 place-items-center rounded-md text-2xs",
                modeNumberText,
                state === "past" && "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]",
                state === "now" &&
                  "bg-[color:var(--surface-raised)] text-[color:var(--mode-identity)] ring-2 ring-[color:var(--mode-identity)] ring-inset",
                state === "later" && "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
              )}
            >
              {n}
            </li>
          );
        })}
      </ol>
      {week > total ? (
        <Button type="button" variant="secondary" onClick={onNew}>
          Start the next term
        </Button>
      ) : null}
    </ModeFeaturedModule>
  );
}

/* ---------- term assessments ---------- */

function Milestones({ term, today, update }: { term: TermRecord; today: string; update: Update }) {
  return (
    <TeachingModule title="Term assessments" icon={CalendarClock} testId="teaching-term-assessments">
      <ul className="mt-1">
        {milestoneIds.map((id) => {
          const milestone = term.milestones[id];
          const state = milestoneState(term, id, today);
          let line = `Due ${weekdayDayMonth(milestone.dueOn)}`;
          if (state === "done" && milestone.doneOn) line = `Done ${weekdayDayMonth(milestone.doneOn)}`;
          if (state === "overdue") line = `Was due ${weekdayDayMonth(milestone.dueOn)}`;
          return (
            <li key={id} className={cn(modeInsetHairline, "flex min-h-13 items-center gap-3 py-1 pr-1 pl-3")}>
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full",
                  state === "done"
                    ? "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]"
                    : "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
                  state === "due" && "ring-2 ring-[color:var(--mode-identity)]",
                )}
              >
                {state === "done" ? (
                  <Check aria-hidden="true" className="size-icon-sm" />
                ) : (
                  <CalendarClock aria-hidden="true" className="size-icon-sm" />
                )}
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className={cn(modeNameText, "text-base-minus break-words text-[color:var(--text-heading)]")}>
                  {milestoneLabels[id].long}
                </span>
                <span className={cn("text-sm", state === "overdue" ? "text-[color:var(--warning-text)]" : textMuted)}>
                  {line}
                  {state === "due" ? " · next" : ""}
                </span>
              </span>
              <Button
                type="button"
                variant={state === "done" ? "ghost" : "secondary"}
                size="sm"
                aria-pressed={state === "done"}
                onClick={() =>
                  update((current) =>
                    withTerm(current, term.id, (t) => ({
                      ...t,
                      milestones: {
                        ...t.milestones,
                        [id]: { ...t.milestones[id], doneOn: t.milestones[id].doneOn ? null : today },
                      },
                    })),
                  )
                }
              >
                {state === "done" ? "Undo" : "Mark done"}
                <span className="sr-only"> {milestoneLabels[id].long}</span>
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-1 border-t border-[color:var(--border)] px-3 pt-2 pb-1">
        <p className={cn("text-sm", textMuted)}>
          The assessments themselves are signed in your CLA ePortfolio. This is your own checklist.
        </p>
        <a href={TERM_TRACKER_SOURCES.pmcwaCla} target="_blank" rel="noreferrer" className={externalLink}>
          CLA ePortfolio, via PMCWA
          <ExternalLink aria-hidden="true" className="size-icon-sm" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </TeachingModule>
  );
}

/* ---------- EPAs ---------- */

function EpaTargetForm({ update, onDone }: { update: Update; onDone: () => void }) {
  const [perTerm, setPerTerm] = useState("");
  const [perYear, setPerYear] = useState("");
  const save = (targets: TermTrackerState["targets"]) => {
    update((current) => ({ ...current, targets }));
    onDone();
  };
  return (
    <div className="grid gap-3 border-t border-[color:var(--border)] p-3">
      <p className="text-sm text-[color:var(--text)]">
        The National Framework summary for PGY1 sets at least {DEFAULT_EPA_TARGETS.perTerm} a term and{" "}
        {DEFAULT_EPA_TARGETS.perYear} a year. Check it with your Medical Education Unit, then confirm it or set your
        own.
      </p>
      <a href={TERM_TRACKER_SOURCES.epaSummary} target="_blank" rel="noreferrer" className={externalLink}>
        National Framework PGY1 summary
        <ExternalLink aria-hidden="true" className="size-icon-sm" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <Button type="button" variant="primary" onClick={() => save({ ...DEFAULT_EPA_TARGETS })}>
        Use {DEFAULT_EPA_TARGETS.perTerm} a term, {DEFAULT_EPA_TARGETS.perYear} a year
      </Button>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save({ perTerm: Number(perTerm), perYear: Number(perYear) });
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="A term"
            type="number"
            inputMode="numeric"
            min="1"
            max="20"
            required
            value={perTerm}
            onChange={(e) => setPerTerm(e.target.value)}
          />
          <TextField
            label="A year"
            type="number"
            inputMode="numeric"
            min="1"
            max="60"
            required
            value={perYear}
            onChange={(e) => setPerYear(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary">
            Save my own target
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function Epas({
  state,
  term,
  today,
  update,
}: {
  state: TermTrackerState;
  term: TermRecord;
  today: string;
  update: Update;
}) {
  const summary = epaSummary(state, term.id, today);
  const targets = state.targets;
  const [settingTarget, setSettingTarget] = useState(false);
  const [lastAdded, setLastAdded] = useState<{ id: string; epa: EpaNumber } | null>(null);
  const toGo = targets ? Math.max(0, targets.perYear - summary.year) : null;
  return (
    <TeachingModule
      title={`EPAs · ${today.slice(0, 4)}`}
      testId="teaching-term-epas"
      aside={
        targets ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setSettingTarget((open) => !open)}>
            Target
          </Button>
        ) : null
      }
    >
      <div className="flex items-center gap-4 p-3">
        <TermRing
          value={summary.year}
          total={targets?.perYear ?? null}
          label={targets ? `${summary.year} of ${targets.perYear} EPAs this year` : `${summary.year} EPAs this year`}
        >
          <span className={cn(modeNumberText, "text-2xl text-[color:var(--text-heading)]")}>{summary.year}</span>
          {targets ? <span className={cn("text-xs", textMuted)}>of {targets.perYear}</span> : null}
        </TermRing>
        <div className="grid min-w-0 gap-1">
          {targets ? (
            <>
              <p className={cn(modeNameText, "text-base-minus text-[color:var(--text-heading)]")}>
                {toGo === 0 ? "Year target met" : `${toGo} to go this year`}
              </p>
              <p className={cn("text-sm", textMuted)}>
                This term {summary.term} of {targets.perTerm}
                {summary.term < targets.perTerm
                  ? ` · ${targets.perTerm - summary.term} more by ${dayMonth(term.endsOn)}`
                  : ""}
              </p>
            </>
          ) : (
            <>
              <p className={cn(modeNameText, "text-base-minus text-[color:var(--text-heading)]")}>
                {summary.term} this term
              </p>
              {!settingTarget ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setSettingTarget(true)}>
                  Set a target
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {settingTarget ? <EpaTargetForm update={update} onDone={() => setSettingTarget(false)} /> : null}
      <ul>
        {epaNumbers.map((epa) => (
          <li key={epa} className={cn(modeInsetHairline, "flex min-h-13 items-center gap-3 py-1 pr-1 pl-3")}>
            <span
              aria-hidden="true"
              className={cn(
                modeNumberText,
                "grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--mode-identity-soft)] text-sm text-[color:var(--mode-identity)]",
              )}
            >
              {epa}
            </span>
            <span className="grid min-w-0 flex-1 gap-1">
              <span className={cn(modeNameText, "text-base-minus break-words text-[color:var(--text-heading)]")}>
                {epaLabels[epa].short}
              </span>
              <span className="flex items-center gap-2">
                <TermPips count={summary.byEpa[epa]} />
                <span className="sr-only">{summary.byEpa[epa]} this year</span>
              </span>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const id = newItemId("epa");
                update((current) => ({ ...current, epas: [...current.epas, { id, termId: term.id, epa, on: today }] }));
                setLastAdded({ id, epa });
              }}
            >
              Log one<span className="sr-only">: {epaLabels[epa].long}</span>
            </Button>
          </li>
        ))}
      </ul>
      <p className={cn("px-3 pt-1 pb-3 text-sm", textMuted)}>
        Log an EPA once it is done in CLA. Counts only, no case details.
      </p>
      {lastAdded ? (
        <TeachingUndoBar
          testId="teaching-term-epa-undo"
          onUndo={() => {
            update((current) => ({ ...current, epas: current.epas.filter((entry) => entry.id !== lastAdded.id) }));
            setLastAdded(null);
          }}
        >
          Logged EPA {lastAdded.epa} for today
        </TeachingUndoBar>
      ) : null}
    </TeachingModule>
  );
}

/* ---------- supervisor meeting ---------- */

function MeetingForm({ term, update, onDone }: { term: TermRecord; update: Update; onDone: () => void }) {
  const [on, setOn] = useState(term.meeting?.on ?? "");
  const [time, setTime] = useState(term.meeting?.time ?? "");
  const [place, setPlace] = useState(term.meeting?.place ?? "");
  return (
    <form
      className="grid gap-2 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        update((current) => withTerm(current, term.id, (t) => ({ ...t, meeting: { on, time, place: place.trim() } })));
        onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Date" type="date" required value={on} onChange={(event) => setOn(event.target.value)} />
        <TextField label="Time" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
      </div>
      <TextField label="Where" maxLength={120} value={place} onChange={(event) => setPlace(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          Save meeting
        </Button>
        {term.meeting ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              update((current) => withTerm(current, term.id, (t) => ({ ...t, meeting: null })));
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

function Meeting({ term, today, update }: { term: TermRecord; today: string; update: Update }) {
  const [editing, setEditing] = useState(false);
  const meeting = term.meeting;
  const upcoming = meeting && meeting.on >= today;
  return (
    <TeachingModule
      title="Supervisor meeting"
      testId="teaching-term-meeting"
      aside={
        !editing ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {meeting ? "Change" : "Add"}
          </Button>
        ) : null
      }
    >
      {editing ? (
        <MeetingForm term={term} update={update} onDone={() => setEditing(false)} />
      ) : meeting ? (
        <div className="flex items-center gap-3 p-3">
          <TermDateTile date={meeting.on} />
          <div className="grid min-w-0 gap-0.5">
            <p className={cn(modeNameText, "text-base-minus text-[color:var(--text-heading)]")}>
              {[weekdayDayMonth(meeting.on), meeting.time].filter(Boolean).join(" · ")}
              {upcoming ? "" : " · past"}
            </p>
            <p className={modeSecondaryText}>
              {[term.supervisor, meeting.place].filter(Boolean).join(" · ") || "Your supervisor"}
            </p>
          </div>
        </div>
      ) : (
        <p className={cn("p-3 text-sm", textMuted)}>No meeting booked. Add one to keep the date with your goals.</p>
      )}

      <section aria-labelledby="term-goals" className="grid gap-1 border-t border-[color:var(--border)] p-3">
        <h3 id="term-goals" className={cn(modeNameText, "text-sm text-[color:var(--text-heading)]")}>
          Goals from the start of term
        </h3>
        {term.goals.length === 0 ? <p className={cn("text-sm", textMuted)}>Add the goals you agreed.</p> : null}
        <ul className="grid">
          {term.goals.map((goal) => (
            <li key={goal.id} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <Checkbox
                  label={goal.text}
                  checked={goal.done}
                  onChange={() =>
                    update((current) =>
                      withTerm(current, term.id, (t) => ({
                        ...t,
                        goals: t.goals.map((g) => (g.id === goal.id ? { ...g, done: !g.done } : g)),
                      })),
                    )
                  }
                />
              </div>
              <TermRemoveButton
                label={`Remove goal: ${goal.text}`}
                onRemove={() =>
                  update((current) =>
                    withTerm(current, term.id, (t) => ({ ...t, goals: t.goals.filter((g) => g.id !== goal.id) })),
                  )
                }
              />
            </li>
          ))}
        </ul>
        <TermAddItem
          label="Add a goal"
          placeholder="Add a goal"
          disabled={term.goals.length >= 20}
          onAdd={(text) =>
            update((current) =>
              withTerm(current, term.id, (t) => ({
                ...t,
                goals: [...t.goals, { id: newItemId("goal"), text, done: false }],
              })),
            )
          }
        />
      </section>

      <section aria-labelledby="term-raise" className="grid gap-1 border-t border-[color:var(--border)] p-3">
        <h3 id="term-raise" className={cn(modeNameText, "text-sm text-[color:var(--text-heading)]")}>
          To raise
        </h3>
        {term.toRaise.length === 0 ? (
          <p className={cn("text-sm", textMuted)}>Jot things down as the term goes.</p>
        ) : null}
        <ul className="grid">
          {term.toRaise.map((item) => (
            <li key={item.id} className="flex min-h-12 items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-1.5 shrink-0 rounded-full bg-[color:var(--mode-identity)]"
              />
              <span className="min-w-0 flex-1 text-base-minus break-words text-[color:var(--text)]">{item.text}</span>
              <TermRemoveButton
                label={`Remove: ${item.text}`}
                onRemove={() =>
                  update((current) =>
                    withTerm(current, term.id, (t) => ({ ...t, toRaise: t.toRaise.filter((r) => r.id !== item.id) })),
                  )
                }
              />
            </li>
          ))}
        </ul>
        <TermAddItem
          label="Add something to raise"
          placeholder="Add something to raise"
          disabled={term.toRaise.length >= 20}
          onAdd={(text) =>
            update((current) =>
              withTerm(current, term.id, (t) => ({ ...t, toRaise: [...t.toRaise, { id: newItemId("raise"), text }] })),
            )
          }
        />
        <NoPatientDetailsMark />
      </section>
    </TeachingModule>
  );
}

/* ---------- the page ---------- */

function TeachingTermContent({ demoMode }: { demoMode: boolean }) {
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const sample = useMemo(() => (demoMode && today ? sampleTermTracker(today) : null), [demoMode, today]);
  const store = useTermTrackerStore(sample);
  const [mode, setMode] = useState<"view" | "edit" | "new">("view");
  const state = store.state;
  const term = state ? currentTerm(state) : null;

  const saveTerm = (saved: TermRecord) => {
    store.update((current) => {
      const exists = current.terms.some((t) => t.id === saved.id);
      // Twelve terms is three years of PGY1 and PGY2; the oldest drops off first.
      const terms = exists
        ? current.terms.map((t) => (t.id === saved.id ? saved : t))
        : [...current.terms, saved].slice(-12);
      return { ...current, terms, currentTermId: saved.id };
    });
    setMode("view");
  };

  let body;
  if (!today || !state || (demoMode && !sample)) body = <ModeModuleSkeleton rows={3} />;
  else if (!term || mode === "new")
    body = (
      <TeachingModule title={term ? "Next term" : "Set up your term"} testId="teaching-term-setup">
        {!term ? (
          <p className={cn("px-3 pt-2 text-sm", textMuted)}>
            Track your three term assessments, your EPAs and what to take to your supervisor. It stays on this device.
          </p>
        ) : null}
        <TermForm term={null} onSave={saveTerm} onCancel={term ? () => setMode("view") : undefined} />
      </TeachingModule>
    );
  else if (mode === "edit")
    body = (
      <TeachingModule title="Edit term" testId="teaching-term-edit">
        <TermForm term={term} onSave={saveTerm} onCancel={() => setMode("view")} />
      </TeachingModule>
    );
  else
    body = (
      <>
        <TermSummary term={term} today={today} onEdit={() => setMode("edit")} onNew={() => setMode("new")} />
        <Milestones term={term} today={today} update={store.update} />
        <Epas state={state} term={term} today={today} update={store.update} />
        <Meeting term={term} today={today} update={store.update} />
        <Link
          href="/teaching/exam-prep"
          className={cn(
            "flex min-h-13 items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 no-underline",
            modePressable,
            focusRing,
          )}
        >
          <span className="grid min-w-0 flex-1 gap-0.5 py-1">
            <span className={cn(modeNameText, "text-base-minus text-[color:var(--text-heading)]")}>Exam prep</span>
            <span className={modeSecondaryText}>Countdown, study days and topics</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
        </Link>
      </>
    );

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-term">
      <div data-mode-identity="teaching" className="grid gap-3">
        <h1 className="text-xl font-semibold text-[color:var(--text-heading)]">Term</h1>
        {demoMode ? <ModeNotice>Made-up demo. Changes stay on this page and are not saved.</ModeNotice> : null}
        {body}
      </div>
    </InformationPageShell>
  );
}

export function TeachingTerm(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={TeachingTermContent} {...props} />;
}
