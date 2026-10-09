"use client";

import { CalendarRange, Info, MapPin, Minus, Plus, Send, Trash2, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkCheckRow,
  WorkDock,
  WorkEmpty,
  WorkSectionLabel,
  useWorkUndoToast,
} from "@/components/mode-kit/work";
import { useRosterNow } from "@/components/roster/roster-format";
import { rosterField } from "@/components/roster/roster-ui";
import { formatTermDates } from "@/components/roster/rotations/rotation-format";
import { useRotations, type RotationsRead } from "@/components/roster/rotations/use-rotations";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { announce } from "@/components/ui/live-announcer";
import { cn, controlDisabled } from "@/components/ui-primitives";
import type { ManagedRound } from "@/lib/roster/rotations/model";
import { zonedDateOf } from "@/lib/work-time/format";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

import {
  capacityCheck,
  checkDraft,
  closesInPast,
  draftFromRound,
  draftPlaces,
  FORM_STEPS,
  halfYearTerms,
  isIsoDate,
  MANAGE_ROTATIONS_HREF,
  manageRoundHref,
  newRoundDraft,
  nextTermStart,
  placedIds,
  plural,
  quarterTerms,
  ROUND_ZONE,
  yearSpanLabel,
  addDays,
  type FormStep,
  type PersonDraft,
  type RotationDraft,
  type RoundDraft,
} from "./round-admin-model";
import { AvatarRow, RotationsAdminGate } from "./rounds-page";

/**
 * The round form (mockup `S.newround`): three steps on one page, Terms,
 * Rotations, and Who and when, picked with a segmented control. Used for a
 * new round (`/roster/manage/rotations/new`) and to edit one
 * (`/roster/manage/rotations/<round>?edit=1`).
 *
 * The same schema and rules the store applies run here first, so a problem is
 * named on the step it belongs to before anything is sent. After publishing,
 * dates, names and places can still change and doctors' calendars follow; a
 * term, rotation or person someone is placed in cannot be removed.
 */

const label = "text-sm font-semibold text-[color:var(--text-heading)]";
const hint = "text-xs text-[color:var(--work-ink-muted)]";
const iconButton =
  "inline-grid min-h-12 min-w-12 shrink-0 place-items-center rounded-full text-[color:var(--work-ink-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--mode-identity)] disabled:cursor-not-allowed " +
  controlDisabled;

// ---------------------------------------------------------------- new round page

export function NewRotationRoundPage() {
  const read = useRotations();
  const router = useRouter();
  const [chosen, setChosen] = useState<string | null>(null);
  const team = read.teams.find((candidate) => candidate.serviceId === chosen) ?? read.team;
  useModeBandHeading({ eyebrow: team?.name ?? "Manage team", title: "New round" });
  return (
    <main className="min-w-0">
      <WorkBody testId="rotation-new-round">
        <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
          New rotation round
        </PageTitleUnderBand>
        <RotationsAdminGate read={read} what="rotation rounds">
          <NewRoundStart
            read={read}
            team={team}
            onChooseTeam={setChosen}
            onDone={(roundId) => router.replace(roundId ? manageRoundHref(roundId) : MANAGE_ROTATIONS_HREF)}
            onCancel={() => router.push(MANAGE_ROTATIONS_HREF)}
          />
        </RotationsAdminGate>
      </WorkBody>
    </main>
  );
}

/**
 * Starts a new round with everyone in the chosen team (`team.people`), whether real or the example.
 * Someone who runs more than one team (Medical Workforce, say) picks the team first.
 */
function NewRoundStart({
  read,
  team,
  onChooseTeam,
  onDone,
  onCancel,
}: {
  readonly read: RotationsRead;
  readonly team: RotationsRead["team"];
  readonly onChooseTeam: (serviceId: string) => void;
  readonly onDone: (roundId: string | undefined) => void;
  readonly onCancel: () => void;
}) {
  const now = useRosterNow();
  const makeId = useIdMaker(read.source);
  const latest = read.managed.find((round) => round.round.serviceId === team?.serviceId)?.round;

  if (!team) {
    return (
      <WorkCard testId="rotation-new-round-no-team">
        <WorkEmpty
          icon={Users}
          title="No team to run a round for"
          body="Rounds are for the team you manage in Roster."
          action={
            <WorkButton variant="secondary" href="/roster/manage" testId="rotation-new-round-manage">
              Back to Manage team
            </WorkButton>
          }
        />
      </WorkCard>
    );
  }
  const people = team.people.map((person) => ({ ...person }));
  const initial = newRoundDraft({
    now,
    people,
    // The team's last round's rotations are the usual start; each one can be changed or removed.
    rotations: (latest?.rotations ?? []).map((rotation, index) => ({ ...rotation, id: makeId("rotation", index) })),
    makeId,
  });
  return (
    <div className="grid gap-4">
      {read.teams.length > 1 ? (
        <label className="grid max-w-sm gap-1 text-sm text-[color:var(--text-muted)]">
          Team
          <select
            value={team.serviceId}
            onChange={(event) => onChooseTeam(event.target.value)}
            className={rosterField}
            data-testid="rotation-new-round-team"
          >
            {read.teams.map((candidate) => (
              <option value={candidate.serviceId} key={candidate.serviceId}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {/* A new team starts a fresh form, with that team's people. */}
      <RoundForm
        key={team.serviceId}
        read={read}
        initial={initial}
        roster={people}
        serviceId={team.serviceId}
        carriedFrom={latest?.name ?? null}
        onDone={onDone}
        onCancel={onCancel}
      />
    </div>
  );
}

/** New ids for terms and rotations. Example ids carry the example prefix, so nothing bleeds into real records. */
function useIdMaker(source: "example" | "live") {
  const counter = useRef(0);
  const stamp = useRef<string | null>(null);
  return (kind: "term" | "rotation", index = 0) => {
    stamp.current ??= Date.now().toString(36);
    counter.current += 1;
    return `${source === "example" ? "example:" : ""}${kind}:${stamp.current}:${counter.current}:${index}`;
  };
}

// ---------------------------------------------------------------- the form

export type RoundFormProps = {
  readonly read: RotationsRead;
  readonly initial: RoundDraft;
  /** Everyone who can be in the round, so a removed person can be added back. */
  readonly roster: readonly PersonDraft[];
  /** The round being edited; absent for a new one. */
  readonly editing?: ManagedRound;
  /** The round whose rotations a new round started from, to say so. */
  readonly carriedFrom?: string | null;
  /** The team a new round is for. */
  readonly serviceId?: string;
  readonly onDone: (roundId: string | undefined) => void;
  readonly onCancel: () => void;
};

export function RoundForm({
  read,
  initial,
  roster,
  editing,
  carriedFrom,
  serviceId,
  onDone,
  onCancel,
}: RoundFormProps) {
  const [draft, setDraft] = useState<RoundDraft>(initial);
  const [step, setStep] = useState<FormStep>("terms");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useRosterNow();
  const toast = useWorkUndoToast();
  const makeId = useIdMaker(read.source);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const status = editing?.round.status ?? "draft";
  const asDraft = status === "draft";
  const locked = useMemo(
    () =>
      editing
        ? placedIds(editing)
        : { terms: new Set<string>(), rotations: new Set<string>(), people: new Set<string>() },
    [editing],
  );

  // Move focus to the step's heading when the step changes, not on first load.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepHeading.current?.focus();
  }, [step]);

  const update = (change: (current: RoundDraft) => RoundDraft) => {
    setProblem(null);
    setDraft(change);
  };
  const stepIndex = FORM_STEPS.findIndex((item) => item.value === step);
  const capacity = capacityCheck(draft.people.length, draftPlaces(draft));

  function fail(message: string) {
    setBusy(false);
    setProblem(message);
    announce(message, { priority: "assertive" });
  }

  async function save(open: boolean) {
    const check = checkDraft(draft);
    if (!check.ok) {
      setProblem(check.message);
      setStep(check.step);
      announce(check.message, { priority: "assertive" });
      return;
    }
    if (open && closesInPast(draft, now)) {
      const message = "Set a closing time in the future before you open the round.";
      setProblem(message);
      setStep("who");
      announce(message, { priority: "assertive" });
      return;
    }
    setBusy(true);
    let roundId = editing?.round.id;
    if (editing) {
      const saved = await read.actions.editRound(editing.round.id, check.setup);
      if (!saved.ok) return fail(saved.message);
    } else {
      const created = await read.actions.createRound(check.setup, serviceId);
      if (!created.ok) return fail(created.message);
      roundId = created.roundId;
    }
    let words = editing
      ? status === "published"
        ? "Saved. Calendars updated"
        : "Changes saved"
      : "Round saved as a draft";
    if (open && roundId) {
      const opened = await read.actions.openRound(roundId);
      words = opened.ok ? "Round open. Your team can rank now" : `Saved as a draft. ${opened.message}`;
    }
    toast?.(words);
    announce(words);
    setBusy(false);
    onDone(roundId);
  }

  const goTo = (next: FormStep) => {
    setProblem(null);
    setStep(next);
  };

  const dock = (() => {
    if (!asDraft) {
      return (
        <WorkDock aria-label="Save changes">
          <WorkButton variant="secondary" onClick={onCancel} disabled={busy} testId="rotation-form-cancel">
            Cancel
          </WorkButton>
          <WorkButton onClick={() => void save(false)} disabled={busy} testId="rotation-form-save">
            {busy ? "Saving" : "Save changes"}
          </WorkButton>
        </WorkDock>
      );
    }
    if (step !== "who") {
      const next = FORM_STEPS[stepIndex + 1]!.value;
      return (
        <WorkDock aria-label="Steps">
          {stepIndex > 0 ? (
            <WorkButton
              variant="secondary"
              onClick={() => goTo(FORM_STEPS[stepIndex - 1]!.value)}
              testId="rotation-form-back"
            >
              Back
            </WorkButton>
          ) : (
            <WorkButton variant="secondary" onClick={onCancel} testId="rotation-form-cancel">
              Cancel
            </WorkButton>
          )}
          <WorkButton onClick={() => goTo(next)} testId="rotation-form-next">
            Next
          </WorkButton>
        </WorkDock>
      );
    }
    return (
      <WorkDock aria-label="Save the round">
        <WorkButton
          variant="secondary"
          onClick={() => void save(false)}
          disabled={busy}
          testId="rotation-form-save-draft"
        >
          {editing ? "Save draft" : "Save as draft"}
        </WorkButton>
        <WorkButton icon={Send} onClick={() => void save(true)} disabled={busy} testId="rotation-form-save-open">
          {busy ? "Saving" : "Save and open"}
        </WorkButton>
      </WorkDock>
    );
  })();

  return (
    <div className="grid min-w-0 gap-2.25" data-testid="rotation-round-form">
      <SegmentedControl
        label="Round setup steps"
        layout="equal"
        value={step}
        onChange={goTo}
        options={FORM_STEPS.map((item) => ({ value: item.value, label: item.label }))}
      />

      {editing ? <EditNote managed={editing} /> : null}

      {problem ? (
        <div role="alert" className="work-card work-card--pad" data-testid="rotation-form-problem">
          <WorkCheckRow tone="warn">{problem}</WorkCheckRow>
        </div>
      ) : null}

      <h2 ref={stepHeading} tabIndex={-1} className="sr-only">
        {`Step ${stepIndex + 1} of 3: ${FORM_STEPS[stepIndex]!.label}`}
      </h2>

      {step === "terms" ? (
        <TermsStep
          draft={draft}
          update={update}
          makeId={makeId}
          locked={locked.terms}
          published={status === "published"}
          now={now}
        />
      ) : step === "rotations" ? (
        <RotationsStep
          draft={draft}
          update={update}
          makeId={makeId}
          locked={locked.rotations}
          capacityText={capacity}
          carriedFrom={editing ? null : (carriedFrom ?? null)}
        />
      ) : (
        <WhoStep draft={draft} update={update} roster={roster} locked={locked.people} capacityText={capacity} />
      )}

      {dock}
    </div>
  );
}

function EditNote({ managed }: { readonly managed: ManagedRound }) {
  const { status } = managed.round;
  if (status === "draft") return null;
  const text =
    status === "published"
      ? "Doctors' calendars update when you save. Anyone placed in a term or rotation keeps it, so move them before you remove it."
      : status === "closed" && managed.allocation
        ? "Saving clears this allocation, because it no longer fits. Run it again after."
        : "Doctors see changes straight away. A rotation you remove comes off their rankings.";
  return (
    <div className="work-card work-card--pad" data-testid="rotation-form-edit-note">
      <WorkCheckRow tone={status === "closed" && managed.allocation ? "warn" : "ok"}>{text}</WorkCheckRow>
    </div>
  );
}

// ---------------------------------------------------------------- steps

type StepProps = {
  readonly draft: RoundDraft;
  readonly update: (change: (current: RoundDraft) => RoundDraft) => void;
};

function TermsStep({
  draft,
  update,
  makeId,
  locked,
  published,
  now,
}: StepProps & {
  readonly makeId: (kind: "term" | "rotation", index?: number) => string;
  readonly locked: ReadonlySet<string>;
  readonly published: boolean;
  readonly now: Date;
}) {
  const fallbackStart = draft.terms[0]?.start ?? `${Number(zonedDateOf(now, ROUND_ZONE).slice(0, 4)) + 1}-02-01`;
  const [presetStart, setPresetStart] = useState(fallbackStart);
  const presetId = useId();
  const setTerm = (id: string, change: Partial<RoundDraft["terms"][number]>) =>
    update((current) => ({
      ...current,
      terms: current.terms.map((term) => (term.id === id ? { ...term, ...change } : term)),
    }));
  // A preset keeps the existing terms' ids where it can, so rankings and fixed placements still match.
  const applyPreset = (kind: "quarters" | "halves") =>
    update((current) => {
      const ids = (index: number) => current.terms[index]?.id ?? makeId("term", index);
      const terms = kind === "quarters" ? quarterTerms(presetStart, ids) : halfYearTerms(presetStart, ids);
      announce(`${terms.length} terms set from ${formatTermDates(presetStart, presetStart)}`);
      return { ...current, terms };
    });
  const addTerm = () =>
    update((current) => {
      const start = nextTermStart(current.terms, fallbackStart);
      const term = {
        id: makeId("term", current.terms.length),
        label: `Term ${current.terms.length + 1}`,
        start,
        end: addDays(start, 90),
      };
      announce(`${term.label} added`);
      return { ...current, terms: [...current.terms, term] };
    });
  const removeTerm = (id: string, name: string) => {
    update((current) => ({ ...current, terms: current.terms.filter((term) => term.id !== id) }));
    announce(`${name} removed`);
  };

  return (
    <>
      {published ? null : (
        <>
          <WorkSectionLabel>Quick start</WorkSectionLabel>
          <WorkCard padded testId="rotation-form-presets">
            <div className="grid gap-3">
              <label htmlFor={presetId} className="grid gap-1.5">
                <span className={label}>The year starts on</span>
                <input
                  id={presetId}
                  type="date"
                  className={rosterField}
                  value={presetStart}
                  onChange={(event) => setPresetStart(event.target.value)}
                  data-testid="rotation-form-preset-start"
                />
              </label>
              <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                <WorkButton
                  variant="tinted"
                  onClick={() => applyPreset("quarters")}
                  disabled={!isIsoDate(presetStart)}
                  testId="rotation-form-preset-quarters"
                >
                  4 terms of 13 weeks
                </WorkButton>
                <WorkButton
                  variant="tinted"
                  onClick={() => applyPreset("halves")}
                  disabled={!isIsoDate(presetStart)}
                  testId="rotation-form-preset-halves"
                >
                  2 terms of 6 months
                </WorkButton>
              </div>
              <p className={hint}>This replaces the terms below. You can change any date after.</p>
            </div>
          </WorkCard>
        </>
      )}

      <WorkSectionLabel
        count={draft.terms.length ? yearSpanLabel(draft.terms) : undefined}
        action={{ label: "Add term", onClick: addTerm }}
      >
        {plural(draft.terms.length, "term")}
      </WorkSectionLabel>
      {draft.terms.length === 0 ? (
        <WorkCard>
          <WorkEmpty icon={CalendarRange} title="No terms yet" body="Use a quick start above, or add a term." />
        </WorkCard>
      ) : (
        <WorkCard testId="rotation-form-terms">
          {draft.terms.map((term, index) => {
            const name = term.label.trim() || `Term ${index + 1}`;
            const backwards = isIsoDate(term.start) && isIsoDate(term.end) && term.end < term.start;
            const weeks =
              isIsoDate(term.start) && isIsoDate(term.end) && !backwards
                ? Math.round((Date.parse(term.end) - Date.parse(term.start) + 86_400_000) / (7 * 86_400_000))
                : null;
            const held = locked.has(term.id);
            return (
              <fieldset
                key={term.id}
                className="m-0 grid min-w-0 gap-2 border-0 border-t border-solid border-[color:var(--work-line)] p-3 first:border-t-0"
                data-testid={`rotation-form-term-${index}`}
              >
                <legend className="sr-only">{name}</legend>
                <div className="flex min-w-0 items-end gap-1">
                  <Field label="Name" className="flex-1">
                    {(id) => (
                      <input
                        id={id}
                        className={rosterField}
                        value={term.label}
                        maxLength={40}
                        onChange={(event) => setTerm(term.id, { label: event.target.value })}
                      />
                    )}
                  </Field>
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={held ? `${name} can't be removed, people are placed in it` : `Remove ${name}`}
                    disabled={held}
                    onClick={() => removeTerm(term.id, name)}
                    data-testid={`rotation-form-term-remove-${index}`}
                  >
                    <Trash2 aria-hidden="true" className="size-icon-md" strokeWidth={2} />
                  </button>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                  <Field label="Starts">
                    {(id) => (
                      <input
                        id={id}
                        type="date"
                        className={rosterField}
                        value={term.start}
                        onChange={(event) => setTerm(term.id, { start: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Ends">
                    {(id) => (
                      <input
                        id={id}
                        type="date"
                        className={rosterField}
                        value={term.end}
                        min={term.start || undefined}
                        onChange={(event) => setTerm(term.id, { end: event.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <p className={cn(hint, backwards && "font-semibold text-[color:var(--warning-text)]")}>
                  {backwards
                    ? "Ends before it starts"
                    : weeks !== null
                      ? `${plural(weeks, "week")}${held ? " · people are placed here" : ""}`
                      : "Set both dates"}
                </p>
              </fieldset>
            );
          })}
        </WorkCard>
      )}
    </>
  );
}

function RotationsStep({
  draft,
  update,
  makeId,
  locked,
  capacityText,
  carriedFrom,
}: StepProps & {
  readonly makeId: (kind: "term" | "rotation", index?: number) => string;
  readonly locked: ReadonlySet<string>;
  readonly capacityText: ReturnType<typeof capacityCheck>;
  readonly carriedFrom: string | null;
}) {
  const setRotation = (id: string, change: Partial<RotationDraft>) =>
    update((current) => ({
      ...current,
      rotations: current.rotations.map((rotation) => (rotation.id === id ? { ...rotation, ...change } : rotation)),
    }));
  const addRotation = () => {
    update((current) => ({
      ...current,
      rotations: [
        ...current.rotations,
        { id: makeId("rotation", current.rotations.length), name: "", site: "", places: 1 },
      ],
    }));
    announce("Rotation added");
  };
  const removeRotation = (id: string, name: string) => {
    update((current) => ({
      ...current,
      rotations: current.rotations.filter((rotation) => rotation.id !== id),
      minRanked: Math.min(current.minRanked, Math.max(current.rotations.length - 1, 0)),
    }));
    announce(`${name} removed`);
  };
  return (
    <>
      <WorkSectionLabel
        count={`${plural(draftPlaces(draft), "place")} a term`}
        action={{ label: "Add rotation", onClick: addRotation }}
      >
        {plural(draft.rotations.length, "rotation")}
      </WorkSectionLabel>
      {carriedFrom && draft.rotations.length > 0 ? (
        <p className={cn(hint, "px-1")}>{`Started from ${carriedFrom}. Change or remove any of them.`}</p>
      ) : null}
      {draft.rotations.length === 0 ? (
        <WorkCard>
          <WorkEmpty
            icon={MapPin}
            title="No rotations yet"
            body="Add each rotation on offer, with its site and places each term."
            action={
              <WorkButton icon={Plus} onClick={addRotation} testId="rotation-form-add-first-rotation">
                Add a rotation
              </WorkButton>
            }
          />
        </WorkCard>
      ) : (
        <WorkCard testId="rotation-form-rotations">
          {draft.rotations.map((rotation, index) => {
            const name = rotation.name.trim() || `Rotation ${index + 1}`;
            const held = locked.has(rotation.id);
            return (
              <fieldset
                key={rotation.id}
                className="m-0 grid min-w-0 gap-2 border-0 border-t border-solid border-[color:var(--work-line)] p-3 first:border-t-0"
                data-testid={`rotation-form-rotation-${index}`}
              >
                <legend className="sr-only">{name}</legend>
                <div className="flex min-w-0 items-end gap-1">
                  <Field label="Rotation" className="flex-1">
                    {(id) => (
                      <input
                        id={id}
                        className={rosterField}
                        value={rotation.name}
                        maxLength={80}
                        placeholder="Consultation liaison"
                        onChange={(event) => setRotation(rotation.id, { name: event.target.value })}
                      />
                    )}
                  </Field>
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={held ? `${name} can't be removed, people are placed in it` : `Remove ${name}`}
                    disabled={held}
                    onClick={() => removeRotation(rotation.id, name)}
                    data-testid={`rotation-form-rotation-remove-${index}`}
                  >
                    <Trash2 aria-hidden="true" className="size-icon-md" strokeWidth={2} />
                  </button>
                </div>
                <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
                  <Field label="Site" className="min-w-40 flex-1">
                    {(id) => (
                      <input
                        id={id}
                        className={rosterField}
                        value={rotation.site}
                        maxLength={80}
                        onChange={(event) => setRotation(rotation.id, { site: event.target.value })}
                      />
                    )}
                  </Field>
                  <div className="grid gap-1.5">
                    <span className={label} aria-hidden="true">
                      Places a term
                    </span>
                    <Stepper
                      value={rotation.places}
                      min={0}
                      max={50}
                      label={`Places a term in ${name}`}
                      onChange={(places) => setRotation(rotation.id, { places })}
                      testId={`rotation-form-places-${index}`}
                    />
                  </div>
                </div>
              </fieldset>
            );
          })}
        </WorkCard>
      )}
      <CapacityNote check={capacityText} />
    </>
  );
}

function WhoStep({
  draft,
  update,
  roster,
  locked,
  capacityText,
}: StepProps & {
  readonly roster: readonly PersonDraft[];
  readonly locked: ReadonlySet<string>;
  readonly capacityText: ReturnType<typeof capacityCheck>;
}) {
  // The same check, with the same settings, the round rules apply on save.
  const noteProblem = checkPatientDetail(draft.note);
  const nameProblem = checkPatientDetail(draft.name);
  const inRound = new Set(draft.people.map((person) => person.id));
  const removed = roster.filter((person) => !inRound.has(person.id));
  const maxRanked = draft.rotations.length;
  const remove = (person: PersonDraft) => {
    update((current) => ({ ...current, people: current.people.filter((item) => item.id !== person.id) }));
    announce(`${person.name} taken out of the round`);
  };
  const addBack = (person: PersonDraft) => {
    update((current) => ({ ...current, people: [...current.people, person] }));
    announce(`${person.name} added back`);
  };
  return (
    <>
      <WorkSectionLabel>Round</WorkSectionLabel>
      <WorkCard padded testId="rotation-form-round">
        <div className="grid gap-3">
          <Field label="Name of round" problem={nameProblem?.body}>
            {(id, describedBy) => (
              <input
                id={id}
                className={rosterField}
                value={draft.name}
                maxLength={80}
                aria-describedby={describedBy}
                onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
                data-testid="rotation-form-name"
              />
            )}
          </Field>
          <div className="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <Field label="Closes on">
              {(id) => (
                <input
                  id={id}
                  type="date"
                  className={rosterField}
                  value={draft.closesDate}
                  onChange={(event) => update((current) => ({ ...current, closesDate: event.target.value }))}
                  data-testid="rotation-form-closes-date"
                />
              )}
            </Field>
            <Field label="At, Perth time">
              {(id) => (
                <input
                  id={id}
                  type="time"
                  className={rosterField}
                  value={draft.closesTime}
                  onChange={(event) => update((current) => ({ ...current, closesTime: event.target.value }))}
                  data-testid="rotation-form-closes-time"
                />
              )}
            </Field>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className={label} aria-hidden="true">
                Each doctor ranks at least
              </span>
              <span className={hint}>
                {draft.minRanked === 0
                  ? "Any number, at least one"
                  : `${plural(draft.minRanked, "rotation")} before sending`}
              </span>
            </span>
            <Stepper
              value={Math.min(draft.minRanked, maxRanked)}
              min={0}
              max={maxRanked}
              label="Rotations each doctor must rank"
              onChange={(minRanked) => update((current) => ({ ...current, minRanked }))}
              testId="rotation-form-min-ranked"
            />
          </div>
          <Field
            label="Note to your team"
            hintText="Optional. Shown with the round. No patient details."
            problem={noteProblem?.body}
          >
            {(id, describedBy) => (
              <textarea
                id={id}
                rows={3}
                maxLength={400}
                className={cn(rosterField, "min-h-24 py-2.5 leading-6")}
                value={draft.note}
                aria-describedby={describedBy}
                onChange={(event) => update((current) => ({ ...current, note: event.target.value }))}
                data-testid="rotation-form-note"
              />
            )}
          </Field>
        </div>
      </WorkCard>

      <WorkSectionLabel count={plural(draft.people.length, "person", "people")}>In this round</WorkSectionLabel>
      {draft.people.length === 0 ? (
        <WorkCard>
          <WorkEmpty icon={Users} title="No one in the round" body="Add people back from the list below." />
        </WorkCard>
      ) : (
        <WorkCard testId="rotation-form-people">
          {[...draft.people]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((person) => {
              const held = locked.has(person.id);
              return (
                <AvatarRow
                  key={person.id}
                  name={person.name}
                  sub={held ? `${person.grade ? `${person.grade} · ` : ""}placed in this round` : person.grade}
                  end={
                    <button
                      type="button"
                      className={iconButton}
                      disabled={held}
                      aria-label={
                        held
                          ? `${person.name} is placed, so stays in the round`
                          : `Take ${person.name} out of the round`
                      }
                      onClick={() => remove(person)}
                      data-testid={`rotation-form-person-remove-${person.id}`}
                    >
                      <Minus aria-hidden="true" className="size-icon-md" strokeWidth={2.2} />
                    </button>
                  }
                />
              );
            })}
        </WorkCard>
      )}
      {removed.length > 0 ? (
        <>
          <WorkSectionLabel count={removed.length}>Not in this round</WorkSectionLabel>
          <WorkCard testId="rotation-form-removed">
            {removed.map((person) => (
              <AvatarRow
                key={person.id}
                name={person.name}
                sub={person.grade}
                end={
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={`Add ${person.name} to the round`}
                    onClick={() => addBack(person)}
                    data-testid={`rotation-form-person-add-${person.id}`}
                  >
                    <UserPlus aria-hidden="true" className="size-icon-md" strokeWidth={2} />
                  </button>
                }
              />
            ))}
          </WorkCard>
        </>
      ) : null}
      <CapacityNote check={capacityText} />
    </>
  );
}

// ---------------------------------------------------------------- small parts

function CapacityNote({ check }: { readonly check: ReturnType<typeof capacityCheck> }) {
  return (
    <>
      <div className="work-card work-card--pad" data-testid="rotation-form-capacity">
        <WorkCheckRow tone={check.tone === "ok" ? "ok" : "warn"}>{check.text}</WorkCheckRow>
      </div>
      <p className="sr-only" aria-live="polite">
        {check.text}
      </p>
    </>
  );
}

function Field({
  label: text,
  hintText,
  problem,
  className,
  children,
}: {
  readonly label: string;
  readonly hintText?: string;
  readonly problem?: string | null;
  readonly className?: string;
  readonly children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const describedBy =
    [hintText ? `${id}-hint` : null, problem ? `${id}-problem` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {children(id, describedBy)}
      {hintText ? (
        <p id={`${id}-hint`} className={hint}>
          {hintText}
        </p>
      ) : null}
      {problem ? (
        <p
          id={`${id}-problem`}
          className="flex items-start gap-1.5 text-xs font-semibold text-[color:var(--warning-text)]"
        >
          <Info aria-hidden="true" className="mt-px size-icon-xs shrink-0" strokeWidth={2.2} />
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** A minus, the number, a plus. Each tap is a 48px target; the number is announced as it changes. */
export function Stepper({
  value,
  min,
  max,
  label: name,
  onChange,
  testId,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly testId?: string;
}) {
  const circle = "grid size-8 place-items-center rounded-full bg-[color:var(--work-wash)] text-[color:var(--work-ink)]";
  const button =
    "inline-grid min-h-12 min-w-12 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--mode-identity)] disabled:cursor-not-allowed " +
    controlDisabled;
  return (
    <div role="group" aria-label={name} className="flex items-center" data-testid={testId}>
      <button
        type="button"
        className={button}
        aria-label={`Fewer, ${name}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <span className={circle}>
          <Minus aria-hidden="true" className="size-icon-sm" strokeWidth={2.4} />
        </span>
      </button>
      <span className="sr-only" aria-live="polite">{`${name} ${value}`}</span>
      <output
        aria-hidden="true"
        className="min-w-6 text-center text-base font-semibold tabular-nums text-[color:var(--work-ink)]"
      >
        {value}
      </output>
      <button
        type="button"
        className={button}
        aria-label={`More, ${name}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <span className={circle}>
          <Plus aria-hidden="true" className="size-icon-sm" strokeWidth={2.4} />
        </span>
      </button>
    </div>
  );
}

/** The form for an existing round, from its current setup. */
export function EditRoundForm({
  read,
  managed,
  onDone,
  onCancel,
}: {
  readonly read: RotationsRead;
  readonly managed: ManagedRound;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}) {
  const teamPeople = read.teams.find((team) => team.serviceId === managed.round.serviceId)?.people;
  const roster = useMemo(() => {
    // Everyone in the round, plus the rest of the team, so a removed person can come back.
    const inRound = managed.round.people.map((person) => ({ ...person }));
    const known = new Set(inRound.map((person) => person.id));
    const others = (teamPeople ?? []).filter((person) => !known.has(person.id)).map((person) => ({ ...person }));
    return [...inRound, ...others];
  }, [managed.round.people, teamPeople]);
  return (
    <RoundForm
      read={read}
      initial={draftFromRound(managed.round)}
      roster={roster}
      editing={managed}
      onDone={() => onDone()}
      onCancel={onCancel}
    />
  );
}
