"use client";

import { withUnit } from "@/components/teaching/teaching-number";
import { Award, CalendarDays, Check, Clock, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { modeNameText } from "@/components/mode-kit/type";
import {
  T5Actions,
  T5Check,
  T5Date,
  T5Heading,
  T5Icon,
  T5Kicker,
  T5Link,
  T5List,
  T5Meta,
  T5Note,
  T5Page,
  T5Panel,
  T5Row,
  T5Section,
  T5Sub,
} from "@/components/teaching/t5-kit";
import { perthDateKey } from "@/components/teaching/teaching-dates";
import { TeachingAccountPage } from "@/components/teaching/teaching-depth-page";
import { TeachingUndoBar } from "@/components/teaching/teaching-row";
import { NoPatientDetailsMark, TermAddItem, TermRemoveButton } from "@/components/teaching/teaching-term-kit";
import { TermFolderEntryLink } from "@/components/teaching/term-folder/term-folder-entry-link";
import { milestoneRows, overdueNote, termPanel } from "@/components/teaching/term-model";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { cn, textMuted } from "@/components/ui-primitives";
import {
  currentTerm,
  dayOfMonth,
  defaultMilestones,
  DEFAULT_EPA_TARGETS,
  epaLabels,
  epaNumbers,
  epaSummary,
  milestoneIds,
  milestoneLabels,
  monthShort,
  newItemId,
  sampleTermTracker,
  TERM_TRACKER_SOURCES,
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
      className="grid gap-3 pt-2"
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
      <div className="grid grid-cols-1 gap-2 min-[26rem]:grid-cols-2">
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
      <NoPatientDetailsMark />
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

/* ---------- the panel: which week, and what is next ---------- */

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
  const panel = termPanel(term, today);
  return (
    <T5Panel testId="teaching-term-summary">
      <T5Kicker>{panel.kicker}</T5Kicker>
      <T5Heading>{panel.heading}</T5Heading>
      <T5Meta>{panel.meta}</T5Meta>
      <ol
        aria-label={`Weeks of the term, week ${withUnit(Math.min(Math.max(panel.week, 0), panel.total), "of")} ${panel.total}`}
        className="mt-1 grid auto-cols-fr grid-flow-col gap-1"
      >
        {panel.weeks.map((state, index) => (
          <li
            key={index}
            aria-current={state === "now" ? "step" : undefined}
            className={cn(
              "h-1 rounded-full",
              state === "done" && "bg-[color:var(--mode-identity)]",
              state === "now" && "bg-[color:var(--text-heading)]",
              state === "later" && "bg-[color:var(--surface-inset)]",
            )}
          >
            <span className="sr-only">Week {index + 1}</span>
          </li>
        ))}
      </ol>
      <T5Actions className="mt-1">
        {panel.finished ? (
          <Button type="button" variant="primary" onClick={onNew}>
            Start the next term
          </Button>
        ) : null}
        <T5Link onClick={onEdit} quiet label="Edit this term">
          Edit
        </T5Link>
      </T5Actions>
    </T5Panel>
  );
}

/* ---------- term assessments ---------- */

const MILESTONE_ICONS = { done: Check, due: Clock, overdue: Clock, later: Award } as const;

function Milestones({ term, today, update }: { term: TermRecord; today: string; update: Update }) {
  const overdue = overdueNote(term, today);
  const toggle = (id: MilestoneId) =>
    update((current) =>
      withTerm(current, term.id, (t) => ({
        ...t,
        milestones: { ...t.milestones, [id]: { ...t.milestones[id], doneOn: t.milestones[id].doneOn ? null : today } },
      })),
    );
  return (
    <>
      {overdue ? (
        <T5Note tone="warning" icon="alert" className="mt-3" testId="teaching-term-overdue">
          {overdue}
        </T5Note>
      ) : null}
      <T5Section
        label="Term assessments"
        right={
          <T5Link href={TERM_TRACKER_SOURCES.pmcwaCla} external label="Open CLA ePortfolio, via PMCWA">
            Open CLA
          </T5Link>
        }
        testId="teaching-term-assessments"
      >
        <T5List ruled>
          {milestoneRows(term, today).map((row) => (
            <T5Row
              key={row.id}
              title={row.title}
              meta={
                row.state === "overdue" ? (
                  <span className="font-medium text-[color:var(--text-heading)]">{row.meta}</span>
                ) : (
                  row.meta
                )
              }
              lead={<T5Icon icon={MILESTONE_ICONS[row.state]} />}
              end={
                row.action ? (
                  <T5Link
                    onClick={() => toggle(row.id)}
                    quiet={row.action === "undo"}
                    label={`${row.action === "undo" ? "Undo" : "Mark done"}: ${milestoneLabels[row.id].long}`}
                  >
                    {row.action === "undo" ? "Undo" : "Mark done"}
                  </T5Link>
                ) : (
                  <span />
                )
              }
            />
          ))}
        </T5List>
        <T5Note className="mt-2">
          {overdue
            ? "If the meeting happened, mark it done. If it moved, change the date. Either way, the form itself is completed in your CLA ePortfolio."
            : "You mark these off here. The assessments themselves are completed and signed in your CLA ePortfolio."}
        </T5Note>
      </T5Section>
    </>
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
    <div className="grid gap-3 border-t border-[color:var(--border)] py-3">
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
        <div className="grid grid-cols-1 gap-2 min-[26rem]:grid-cols-2">
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
  const [logging, setLogging] = useState(false);
  const [lastAdded, setLastAdded] = useState<{ id: string; epa: EpaNumber } | null>(null);
  return (
    <T5Section
      label={targets || summary.year > 0 ? "EPAs this year" : "EPA target"}
      right={
        <T5Link onClick={() => setLogging((open) => !open)} label={logging ? "Stop logging EPAs" : "Log an EPA"}>
          {logging ? "Done" : "Log one"}
        </T5Link>
      }
      testId="teaching-term-epas"
    >
      <div className="grid gap-2 border-t border-[color:var(--border)] py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex items-baseline gap-1.5">
            <span className="text-xl font-normal text-[color:var(--text-heading)] tabular-nums">{summary.year}</span>
            <T5Meta>{targets ? `logged by you, of ${targets.perYear}` : "logged by you"}</T5Meta>
          </span>
          {targets ? <T5Meta>{`This term ${withUnit(summary.term, "of")} ${targets.perTerm}`}</T5Meta> : null}
        </div>
        {targets ? (
          <span aria-hidden="true" className="grid auto-cols-fr grid-flow-col gap-0.75">
            {Array.from({ length: Math.min(targets.perYear, 30) }, (_, index) => (
              <i
                key={index}
                className={cn(
                  "block h-1.5 rounded-xs",
                  index < summary.year ? "bg-[color:var(--mode-identity)]" : "bg-[color:var(--surface-inset)]",
                )}
              />
            ))}
          </span>
        ) : null}
      </div>
      {logging ? <T5Meta className="pb-1">Choose the EPA you completed in CLA today.</T5Meta> : null}
      <T5List ruled>
        {epaNumbers.map((epa) => (
          <T5Row
            key={epa}
            title={epaLabels[epa].long}
            lead={
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-full border border-[color:var(--border)] text-xs font-semibold text-[color:var(--text-muted)]"
              >
                {epa}
              </span>
            }
            end={
              logging ? (
                <T5Link
                  label={`Log one: ${epaLabels[epa].long}`}
                  onClick={() => {
                    const id = newItemId("epa");
                    update((current) => ({
                      ...current,
                      epas: [...current.epas, { id, termId: term.id, epa, on: today }],
                    }));
                    setLastAdded({ id, epa });
                  }}
                >
                  Log
                </T5Link>
              ) : (
                <span className="shrink-0 text-sm font-normal text-[color:var(--text-heading)] tabular-nums">
                  {summary.byEpa[epa]}
                  <span className="sr-only"> this year</span>
                </span>
              )
            }
          />
        ))}
      </T5List>
      {settingTarget ? (
        <EpaTargetForm update={update} onDone={() => setSettingTarget(false)} />
      ) : targets ? (
        <T5Note className="mt-2">
          {targets.perTerm === DEFAULT_EPA_TARGETS.perTerm && targets.perYear === DEFAULT_EPA_TARGETS.perYear
            ? `Targets ${targets.perTerm} a term and ${targets.perYear} a year, the National Framework PGY1 figures. `
            : `Targets ${targets.perTerm} a term and ${targets.perYear} a year: your own. `}
          <T5Link onClick={() => setSettingTarget(true)}>Change</T5Link>
        </T5Note>
      ) : (
        <div className="grid gap-1 pt-2">
          <p className="text-sm font-medium text-[color:var(--text-heading)]">No target yet</p>
          <T5Meta>
            Set it from your PMCWA term guide or the{" "}
            <T5Link href={TERM_TRACKER_SOURCES.epaSummary} external>
              National Framework PGY1 summary
            </T5Link>
            . Nothing counts against a target until you choose one.
          </T5Meta>
          <T5Actions>
            {/* Opens the form so the "check it with your Medical Education Unit" step stays before saving. */}
            <T5Link onClick={() => setSettingTarget(true)}>Choose a target</T5Link>
          </T5Actions>
        </div>
      )}
      <T5Meta className="mt-2">Log an EPA once it is done in CLA. Counts only, no case details.</T5Meta>
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
    </T5Section>
  );
}

/* ---------- supervisor meeting ---------- */

function MeetingForm({ term, update, onDone }: { term: TermRecord; update: Update; onDone: () => void }) {
  const [on, setOn] = useState(term.meeting?.on ?? "");
  const [time, setTime] = useState(term.meeting?.time ?? "");
  const [place, setPlace] = useState(term.meeting?.place ?? "");
  return (
    <form
      className="grid gap-2 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        update((current) => withTerm(current, term.id, (t) => ({ ...t, meeting: { on, time, place: place.trim() } })));
        onDone();
      }}
    >
      <div className="grid grid-cols-1 gap-2 min-[26rem]:grid-cols-2">
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
  const removeX = (label: string, onRemove: () => void) => <TermRemoveButton label={label} onRemove={onRemove} />;
  return (
    <T5Section
      label="Supervisor meeting"
      right={!editing ? <T5Link onClick={() => setEditing(true)}>{meeting ? "Reschedule" : "Add"}</T5Link> : null}
      testId="teaching-term-meeting"
    >
      {editing ? (
        <div className="border-t border-[color:var(--border)]">
          <MeetingForm term={term} update={update} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <T5List ruled>
          {meeting ? (
            <T5Row
              title={`${[weekdayDayMonth(meeting.on), meeting.time].filter(Boolean).join(", ")}${upcoming ? "" : " · past"}`}
              meta={[term.supervisor, meeting.place].filter(Boolean).join(" · ") || "Your supervisor"}
              lead={<T5Date day={String(dayOfMonth(meeting.on))} month={monthShort(meeting.on)} />}
            />
          ) : (
            <li className="py-2.5">
              <T5Meta>No meeting booked. Add one to keep the date with your goals.</T5Meta>
            </li>
          )}
        </T5List>
      )}

      <T5Sub>Goals from the start of term</T5Sub>
      {term.goals.length === 0 ? <T5Meta className="pb-1">Add the goals you agreed.</T5Meta> : null}
      <T5List ruled>
        {term.goals.map((goal) => (
          <T5Check
            key={goal.id}
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
            end={removeX(`Remove goal: ${goal.text}`, () =>
              update((current) =>
                withTerm(current, term.id, (t) => ({ ...t, goals: t.goals.filter((g) => g.id !== goal.id) })),
              ),
            )}
          />
        ))}
        <li className="py-2">
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
        </li>
      </T5List>

      <T5Sub>To raise</T5Sub>
      {term.toRaise.length === 0 ? <T5Meta className="pb-1">Jot things down as the term goes.</T5Meta> : null}
      <T5List ruled>
        {term.toRaise.map((item) => (
          <T5Row
            key={item.id}
            title={item.text}
            end={removeX(`Remove: ${item.text}`, () =>
              update((current) =>
                withTerm(current, term.id, (t) => ({ ...t, toRaise: t.toRaise.filter((r) => r.id !== item.id) })),
              ),
            )}
          />
        ))}
        <li className="py-2">
          <TermAddItem
            label="Add something to raise"
            placeholder="Add something to raise"
            disabled={term.toRaise.length >= 20}
            onAdd={(text) =>
              update((current) =>
                withTerm(current, term.id, (t) => ({
                  ...t,
                  toRaise: [...t.toRaise, { id: newItemId("raise"), text }],
                })),
              )
            }
          />
        </li>
      </T5List>
      <NoPatientDetailsMark />
    </T5Section>
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
      <>
        <T5Panel testId="teaching-term-setup">
          <T5Heading>{term ? "Next term" : "Set up your term"}</T5Heading>
          <T5Meta>Three dates, filled in from a usual 10-week term. Change any of them.</T5Meta>
          <TermForm term={null} onSave={saveTerm} onCancel={term ? () => setMode("view") : undefined} />
        </T5Panel>
        {!term ? <T5Section label="EPAs this year" right={<T5Meta>None logged</T5Meta>} /> : null}
      </>
    );
  else if (mode === "edit")
    body = (
      <T5Panel testId="teaching-term-edit">
        <T5Heading>Edit term</T5Heading>
        <TermForm term={term} onSave={saveTerm} onCancel={() => setMode("view")} />
      </T5Panel>
    );
  else
    body = (
      <>
        <TermSummary term={term} today={today} onEdit={() => setMode("edit")} onNew={() => setMode("new")} />
        <Milestones term={term} today={today} update={store.update} />
        <Epas state={state} term={term} today={today} update={store.update} />
        <Meeting term={term} today={today} update={store.update} />
        <T5List ruled className="mt-4.5">
          <T5Row
            title="My exam prep"
            meta="Countdown, study days and topics"
            lead={<T5Icon icon={CalendarDays} />}
            href="/teaching/exam-prep"
          />
        </T5List>
        <TermFolderEntryLink />
      </>
    );

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-term">
      <T5Page>
        <h1 className="sr-only">This term</h1>
        {demoMode ? (
          <T5Note className="mt-0 mb-3.5">Made-up demo. Changes stay on this page and are not saved.</T5Note>
        ) : null}
        {body}
      </T5Page>
    </InformationPageShell>
  );
}

export function TeachingTerm(props: { demoMode: boolean }) {
  return <TeachingAccountPage component={TeachingTermContent} {...props} />;
}
