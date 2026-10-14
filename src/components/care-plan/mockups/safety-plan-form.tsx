"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorSummary } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import { EmptyState, InlineNotice, ignoreUnavailableActivation } from "@/components/ui-primitives";

import styles from "./care-plan.module.css";
import { buildPatientSnapshot, canPerformAction, getCurrentSafetyPlanVersion, getOpenSafetyPlanDraft } from "./domain";
import { PROTOTYPE_NOW } from "./fixtures";
import { useCarePlanPrototype } from "./prototype-provider";
import { getPrototypeMutationBlockReason } from "./prototype-state";
import {
  PATIENT_CONFIRMATION_EXPLANATION,
  PATIENT_CONFIRMATION_LABEL,
  PROTOTYPE_OUTCOME_TONE,
  PROTOTYPE_ROLE_LABEL,
  PlanTextArea,
  SAFETY_PLAN_SECTION_KEYS,
  SAFETY_PLAN_SECTION_LABEL,
  SAFETY_PLAN_SUPPORTS_KEY,
  SectionFrame,
  SyntheticMarker,
  formatPerthDate,
} from "./prototype-ui";
import { carePlanRoute } from "./routes";
import type {
  PatientConfirmationState,
  PersonalSafetyPlanVersion,
  PrototypeScenario,
  SafetyPlanContent,
  SafetyPlanDraftInput,
  SyntheticId,
} from "./types";

/**
 * Writing or revising a Personal Safety Plan.
 *
 * There is no approval step and no reviewer, because this document belongs to
 * the person it describes. A draft becomes their plan when they and the
 * clinician sitting with them are happy with it, and the reducer supersedes the
 * version it replaces in the same movement. The emergency department at 2am is
 * very often exactly where this gets written, so every clinical role carries the
 * action — a tool that refused it there would be useless at the moment it
 * matters most.
 *
 * The completeness rules exist so a sheet of paper is worth carrying, not so a
 * person can be marked incomplete. When the person declined, or nobody has been
 * able to ask them, their own six sections are not required at all: filling them
 * in anyway would mean a clinician inventing words and attributing them to
 * somebody who never said them. What stays required in every case is the next
 * review date, a note saying how the version came about, and the professional
 * and emergency contacts — the part of the sheet that answers "who do I ring".
 */

/** Stable field identifiers, so an error-summary link and the field it names
 *  cannot drift apart. */
export function safetyPlanFieldId(field: string): string {
  return `care-plan-safety-form-${field}`;
}

type ListKey = Exclude<keyof SafetyPlanContent, typeof SAFETY_PLAN_SUPPORTS_KEY>;

type SupportRow = { name: string; relationship: string; phone: string };

type FormValues = {
  /** `YYYY-MM-DD`, the value a date control holds. */
  reviewDate: string;
  collaborationNote: string;
  patientConfirmation: PatientConfirmationState;
  /** Each list section as the text in its own control: one point per line. */
  lists: Record<ListKey, string>;
  supports: SupportRow[];
};

type FieldEntry = { fieldId: string; label: string; message: string };

const LIST_KEYS = SAFETY_PLAN_SECTION_KEYS.filter((key): key is ListKey => key !== SAFETY_PLAN_SUPPORTS_KEY);

/** The confirmation answers, in the order the sentence "what has this person
 *  confirmed" is most naturally answered. Every one of them is a complete
 *  answer; none of them is a failure. */
const CONFIRMATION_OPTIONS = Object.keys(PATIENT_CONFIRMATION_LABEL) as readonly PatientConfirmationState[];

/**
 * The two answers that mean this person had no part in this version. Their own
 * six sections are not required then, because there is nobody whose words could
 * fill them.
 */
const WITHOUT_THIS_PERSON: readonly PatientConfirmationState[] = ["declined", "unavailable"];

const EMPTY_SUPPORT_ROW: SupportRow = { name: "", relationship: "", phone: "" };

function linesFrom(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Perth wall-clock date part. A `+08:00` timestamp already carries it. */
function toDateValue(iso: string | null): string {
  return iso === null ? "" : iso.slice(0, 10);
}

/**
 * A date control's value back to a Perth-local timestamp. The time of day is a
 * fixed midday, so the same date always produces the same string and nothing
 * here reads a clock.
 */
function toPerthTimestamp(dateValue: string): string {
  return dateValue === "" ? "" : `${dateValue}T12:00:00+08:00`;
}

/** A row with nothing in it is somewhere to add a person, not an empty person. */
function isBlankRow(row: SupportRow): boolean {
  return row.name.trim() === "" && row.relationship.trim() === "" && row.phone.trim() === "";
}

function valuesFrom(version: PersonalSafetyPlanVersion): FormValues {
  const lists = {} as Record<ListKey, string>;
  for (const key of LIST_KEYS) lists[key] = version.content[key].join("\n");
  return {
    reviewDate: toDateValue(version.reviewDueAt),
    collaborationNote: version.collaborationNote,
    patientConfirmation: version.patientConfirmation,
    lists,
    supports: [...version.content.personalSupports.map((support) => ({ ...support })), { ...EMPTY_SUPPORT_ROW }],
  };
}

function contentFrom(values: FormValues): SafetyPlanContent {
  const lists = {} as Record<ListKey, string[]>;
  for (const key of LIST_KEYS) lists[key] = linesFrom(values.lists[key]);
  return {
    ...lists,
    personalSupports: values.supports.filter((row) => !isBlankRow(row)).map((row) => ({ ...row })),
  } as SafetyPlanContent;
}

function draftInputFrom(values: FormValues): SafetyPlanDraftInput {
  return {
    reviewDueAt: toPerthTimestamp(values.reviewDate),
    patientConfirmation: values.patientConfirmation,
    collaborationNote: values.collaborationNote.trim(),
    content: contentFrom(values),
  };
}

/**
 * What must be true before a version becomes this person's plan. The order is
 * the order of the fields on screen, so the first entry in the summary is always
 * the first thing a reader would reach going down the form.
 */
function validate(values: FormValues): FieldEntry[] {
  const entries: FieldEntry[] = [];
  const ownWordsRequired = !WITHOUT_THIS_PERSON.includes(values.patientConfirmation);

  if (values.reviewDate.trim() === "" || Number.isNaN(Date.parse(toPerthTimestamp(values.reviewDate)))) {
    entries.push({
      fieldId: safetyPlanFieldId("reviewDueAt"),
      label: "Next review date",
      message: "Enter the date this plan should be looked at again with this person.",
    });
  }
  if (values.collaborationNote.trim() === "") {
    entries.push({
      fieldId: safetyPlanFieldId("collaborationNote"),
      label: "How this version was written",
      message:
        "Say how this version came about and what this person decided, so a later reader can tell whose words these are.",
    });
  }

  for (const key of LIST_KEYS) {
    const empty = linesFrom(values.lists[key]).length === 0;
    // The professional and emergency contacts are required whatever happened,
    // because that is the part of the sheet that answers "who do I ring".
    const required = key === "professionalAndEmergencySupport" || ownWordsRequired;
    if (empty && required) {
      entries.push({
        fieldId: safetyPlanFieldId(key),
        label: SAFETY_PLAN_SECTION_LABEL[key],
        message:
          key === "professionalAndEmergencySupport"
            ? "List at least one service this person can contact, one per line."
            : "Add at least one line in this person's own words, one per line.",
      });
    }
  }

  const filled = values.supports.filter((row) => !isBlankRow(row));
  const supportsEntry = (message: string) =>
    entries.push({
      fieldId: safetyPlanFieldId(SAFETY_PLAN_SUPPORTS_KEY),
      label: SAFETY_PLAN_SECTION_LABEL[SAFETY_PLAN_SUPPORTS_KEY],
      message,
    });

  if (filled.length === 0) {
    if (ownWordsRequired) supportsEntry("Add at least one person this person could contact.");
  } else if (filled.some((row) => row.name.trim() === "")) {
    supportsEntry("Give a name for every person listed here, or remove the row.");
  } else if (filled.some((row) => row.phone.trim() === "")) {
    // Checked whether or not the section is required. A person listed with no
    // number is a name that cannot be rung at 2am, which is worse than an empty
    // section: the sheet looks answered and is not.
    supportsEntry("Add a telephone number for every person listed here.");
  } else if (filled.some((row) => row.relationship.trim() === "")) {
    supportsEntry("Say how each person listed here is related to this person.");
  }

  return entries;
}

/** Only ever used before a draft exists, when no field is rendered. */
const EMPTY_FORM_VALUES: FormValues = {
  reviewDate: "",
  collaborationNote: "",
  patientConfirmation: "unavailable",
  lists: {
    warningSigns: "",
    saferSurroundings: "",
    reasonsForLiving: "",
    selfStrategies: "",
    connectionPeopleAndPlaces: "",
    professionalAndEmergencySupport: "",
  },
  supports: [{ ...EMPTY_SUPPORT_ROW }],
};

export function SafetyPlanFormSurface({
  patientId,
  scenario,
  navigate,
}: {
  patientId: string | null;
  scenario: PrototypeScenario;
  navigate: (href: string) => void;
}) {
  const { state, dispatch } = useCarePlanPrototype();
  const snapshot = patientId === null ? null : buildPatientSnapshot(state, patientId as SyntheticId, PROTOTYPE_NOW);
  const planId = snapshot?.patient.personalSafetyPlanId ?? null;
  const draft = planId === null ? null : getOpenSafetyPlanDraft(state.personalSafetyPlanVersions, planId);
  const current = planId === null ? null : getCurrentSafetyPlanVersion(state.personalSafetyPlanVersions, planId);

  // Seeded once per version, during render rather than in an effect: an effect
  // would leave one frame showing the previous version's text in a form that
  // already claims to be editing this one.
  const [seededFrom, setSeededFrom] = useState<string | null>(draft?.id ?? null);
  const [values, setValues] = useState<FormValues>(() => (draft === null ? EMPTY_FORM_VALUES : valuesFrom(draft)));
  const [errors, setErrors] = useState<FieldEntry[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Which control raised the errors on screen. The summary heading has to say
   *  what the reader actually asked for: saving a draft that could not be saved
   *  is a different sentence from a version that could not be made current, and
   *  the save path raises errors too. */
  const [intent, setIntent] = useState<"save" | "make-current">("make-current");

  if (draft !== null && seededFrom !== draft.id) {
    setSeededFrom(draft.id);
    setValues(valuesFrom(draft));
    setErrors([]);
  }

  const baselineValues = draft === null ? EMPTY_FORM_VALUES : valuesFrom(draft);
  const isDirty = draft !== null && JSON.stringify(values) !== JSON.stringify(baselineValues);
  useDirtyStateGuard(isDirty);

  /*
   * There is deliberately no focus effect here. `ErrorSummary` moves focus to
   * itself on a failed submit, which is the repository's behaviour for every
   * form in the product; this one does not get to be different. Task 6 tried the
   * alternative and it was reversed.
   */

  if (snapshot === null) {
    return (
      <EmptyState
        testId="care-plan-safety-form-no-patient"
        title="No patient is open."
        body="Open a synthetic patient from Home or Patients, then choose Personal Safety Plan."
      />
    );
  }

  const { patient } = snapshot;

  if (scenario === "identity-uncertain") {
    return (
      <section aria-label={`Write ${patient.fullName} Personal Safety Plan`} className={styles.workspace}>
        <p role="alert" data-testid="care-plan-identity-uncertain" className={styles.identityUncertain}>
          <strong>This record has not been confirmed as the right person.</strong> Nothing can be written against it.
          Return to search and choose the record again.
        </p>
      </section>
    );
  }

  const actor = state.users.find((user) => user.id === state.activeUserId) ?? null;
  const mayAuthor = actor !== null && canPerformAction(actor.role, "author_safety_plan");

  const identity = (
    <div data-testid="care-plan-safety-form-identity" className={styles.identityBand}>
      <SyntheticMarker />
      <h2 className={styles.patientName}>{patient.fullName}</h2>
      <p className={styles.sectionDescription}>{`${patient.mrn} — born ${formatPerthDate(patient.dateOfBirth)}`}</p>
      <Link href={carePlanRoute.safetyPlan(patient.id)} className={styles.inlineLink}>
        Back to the Personal Safety Plan
      </Link>
    </div>
  );

  const currentNotice = (
    <p data-testid="care-plan-safety-current-notice" className={styles.sectionDescription}>
      {current === null
        ? `${patient.preferredName} has no current Personal Safety Plan. Nothing written here is ${patient.preferredName}'s plan until it is made current.`
        : `Version ${current.version} stays in use until a new version is made current. Nothing on this page changes it.`}
    </p>
  );

  const outcome =
    state.lastOutcome === null ? null : (
      <div data-testid="care-plan-safety-form-outcome">
        <InlineNotice tone={PROTOTYPE_OUTCOME_TONE[state.lastOutcome.kind]}>{state.lastOutcome.message}</InlineNotice>
      </div>
    );

  // Absent, not shown unavailable: this is a role that never carries the action,
  // so a row of refused controls would say nothing a sentence cannot.
  if (!mayAuthor) {
    return (
      <section
        aria-label={`Write ${patient.fullName} Personal Safety Plan`}
        data-testid="care-plan-safety-form-surface"
        className={styles.workspace}
      >
        {identity}
        <SectionFrame id="care-plan-safety-form-unavailable" heading="Writing a Personal Safety Plan" tone="boundary">
          <p data-testid="care-plan-safety-form-unavailable" className={styles.sectionDescription}>
            {actor === null
              ? "No synthetic user is selected, so nothing written here could be attributed to anyone."
              : `${actor.displayName} is signed in with the ${PROTOTYPE_ROLE_LABEL[actor.role].toLowerCase()} role, which does not carry this action. Any clinical role can sit down and write one with this person.`}
          </p>
          {currentNotice}
        </SectionFrame>
      </section>
    );
  }

  if (draft === null) {
    const blockedReason = getPrototypeMutationBlockReason(state, {
      type: "create-safety-plan-draft",
      patientId: patient.id,
    });
    return (
      <section
        aria-label={`Write ${patient.fullName} Personal Safety Plan`}
        data-testid="care-plan-safety-form-surface"
        className={styles.workspace}
      >
        {identity}
        {outcome}
        <SectionFrame
          id="care-plan-safety-form-start"
          heading="Start a new version"
          description={
            current === null
              ? "A new version starts empty and is written with this person, in their words."
              : "A new version starts from the words already agreed, so nothing has to be typed again."
          }
        >
          {currentNotice}
          <p className={styles.sectionDescription}>
            {`It becomes ${patient.preferredName}'s plan the moment you make it current. Nobody else has to sign it off.`}
          </p>
          {blockedReason === null ? null : (
            <p
              id="care-plan-safety-form-blocked"
              role="alert"
              data-testid="care-plan-safety-form-blocked"
              className={styles.contactWarning}
            >
              {blockedReason}
            </p>
          )}
          <div className={styles.actionRow}>
            <Button
              variant="primary"
              aria-disabled={blockedReason === null ? undefined : true}
              aria-describedby={blockedReason === null ? undefined : "care-plan-safety-form-blocked"}
              onClick={
                blockedReason === null
                  ? () => dispatch({ type: "create-safety-plan-draft", patientId: patient.id })
                  : ignoreUnavailableActivation
              }
            >
              Start a new version
            </Button>
          </div>
        </SectionFrame>
      </section>
    );
  }

  const input = draftInputFrom(values);
  const saveBlockedReason = getPrototypeMutationBlockReason(state, {
    type: "save-safety-plan-draft",
    versionId: draft.id,
    input,
  });
  const errorByFieldId = new Map(errors.map((entry) => [entry.fieldId, entry.message]));

  function setList(key: ListKey, text: string) {
    setValues((previous) => ({ ...previous, lists: { ...previous.lists, [key]: text } }));
  }

  function setSupport(index: number, field: keyof SupportRow, text: string) {
    setValues((previous) => ({
      ...previous,
      supports: previous.supports.map((row, position) => (position === index ? { ...row, [field]: text } : row)),
    }));
  }

  /** Removing the last remaining row leaves one blank one, so the section never
   *  becomes a place with nothing to type into. */
  function removeSupport(index: number) {
    setValues((previous) => {
      const remaining = previous.supports.filter((_, position) => position !== index);
      return { ...previous, supports: remaining.length === 0 ? [{ ...EMPTY_SUPPORT_ROW }] : remaining };
    });
  }

  /** Saving keeps only the rule the reducer itself enforces. A draft is work in
   *  progress and must be storable while incomplete — a conversation that had to
   *  stop is the commonest reason one exists. */
  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveBlockedReason !== null || draft === null) return;
    const blocking = validate(values).filter((entry) => entry.fieldId === safetyPlanFieldId("reviewDueAt"));
    setAttempt((previous) => previous + 1);
    setIntent("save");
    setErrors(blocking);
    if (blocking.length > 0) return;
    dispatch({ type: "save-safety-plan-draft", versionId: draft.id, input });
  }

  /** Making it current is the whole decision, so it is complete or it is refused. */
  function handleMakeCurrentRequest() {
    if (saveBlockedReason !== null) return;
    const found = validate(values);
    setAttempt((previous) => previous + 1);
    setIntent("make-current");
    setErrors(found);
    if (found.length === 0) setConfirmOpen(true);
  }

  function handleConfirmMakeCurrent() {
    if (draft === null) return;
    setConfirmOpen(false);
    dispatch({ type: "save-safety-plan-draft", versionId: draft.id, input });
    dispatch({ type: "make-safety-plan-current", versionId: draft.id });
    navigate(carePlanRoute.safetyPlan(patient.id));
  }

  return (
    <section
      aria-label={`Write ${patient.fullName} Personal Safety Plan`}
      data-testid="care-plan-safety-form-surface"
      className={styles.workspace}
    >
      {identity}
      {outcome}

      <form className={styles.form} onSubmit={handleSave} noValidate>
        <ErrorSummary
          heading={intent === "save" ? "This draft could not be saved" : "This version could not be made current"}
          errors={errors}
          attempt={attempt}
          className={styles.formErrorSummary}
        />

        <SectionFrame
          id="care-plan-safety-form-version"
          heading={`Draft version ${draft.version}`}
          description="A draft is not this person's plan. It becomes one when it is made current, and it needs no sign-off from anybody else."
        >
          {currentNotice}
          <div className={styles.formGrid}>
            <TextField
              id={safetyPlanFieldId("reviewDueAt")}
              label="Next review date"
              type="date"
              required
              hint="Defaulted to twelve months. Change it whenever this plan should be looked at sooner."
              value={values.reviewDate}
              error={errorByFieldId.get(safetyPlanFieldId("reviewDueAt"))}
              onChange={(event) => setValues((previous) => ({ ...previous, reviewDate: event.target.value }))}
            />
            <Select
              id={safetyPlanFieldId("patientConfirmation")}
              label="What this person has confirmed"
              required
              hint={PATIENT_CONFIRMATION_EXPLANATION[values.patientConfirmation]}
              value={values.patientConfirmation}
              error={errorByFieldId.get(safetyPlanFieldId("patientConfirmation"))}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  patientConfirmation: event.target.value as PatientConfirmationState,
                }))
              }
              options={CONFIRMATION_OPTIONS.map((value) => ({ value, label: PATIENT_CONFIRMATION_LABEL[value] }))}
            />
          </div>
          <PlanTextArea
            id={safetyPlanFieldId("collaborationNote")}
            label="How this version was written"
            required
            rows={3}
            hint="How it came about, and what this person decided. A later reader has nothing else to tell them whose words these are."
            value={values.collaborationNote}
            error={errorByFieldId.get(safetyPlanFieldId("collaborationNote"))}
            onChange={(text) => setValues((previous) => ({ ...previous, collaborationNote: text }))}
          />
        </SectionFrame>

        <SectionFrame
          id="care-plan-safety-form-sections"
          heading={`${patient.preferredName}'s own words`}
          description="Seven parts, written the way this person would say them. One point per line."
        >
          {SAFETY_PLAN_SECTION_KEYS.map((key) =>
            key === SAFETY_PLAN_SUPPORTS_KEY ? (
              <fieldset
                key={key}
                id={safetyPlanFieldId(SAFETY_PLAN_SUPPORTS_KEY)}
                tabIndex={-1}
                className={styles.safetySupportFieldset}
              >
                <legend className={styles.safetySupportLegend}>{SAFETY_PLAN_SECTION_LABEL[key]}</legend>
                {errorByFieldId.get(safetyPlanFieldId(SAFETY_PLAN_SUPPORTS_KEY)) === undefined ? null : (
                  <p role="alert" className={styles.contactWarning}>
                    {errorByFieldId.get(safetyPlanFieldId(SAFETY_PLAN_SUPPORTS_KEY))}
                  </p>
                )}
                {values.supports.map((row, index) => {
                  const who = row.name.trim() === "" ? `person ${index + 1}` : row.name.trim();
                  return (
                    <div key={`support-${index}`} className={styles.safetySupportFields}>
                      <TextField
                        id={safetyPlanFieldId(`support-${index}-name`)}
                        label={`Name of person ${index + 1}`}
                        value={row.name}
                        onChange={(event) => setSupport(index, "name", event.target.value)}
                      />
                      {/*
                        Asked from the patient's side, not the listed person's:
                        "Relationship to Jess Sample" asks what Jess is to Jess.
                        The record holds how this person knows the patient.
                      */}
                      <TextField
                        id={safetyPlanFieldId(`support-${index}-relationship`)}
                        label={`How ${who} knows ${patient.preferredName}`}
                        value={row.relationship}
                        onChange={(event) => setSupport(index, "relationship", event.target.value)}
                      />
                      <TextField
                        id={safetyPlanFieldId(`support-${index}-phone`)}
                        label={`Telephone number for ${who}`}
                        value={row.phone}
                        onChange={(event) => setSupport(index, "phone", event.target.value)}
                      />
                      {/* A form filled in sitting beside somebody must be able
                          to take a name back off as easily as it put one on. */}
                      <div className={styles.actionRow}>
                        <Button variant="ghost" onClick={() => removeSupport(index)}>
                          {`Remove ${who}`}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                <div className={styles.actionRow}>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setValues((previous) => ({
                        ...previous,
                        supports: [...previous.supports, { ...EMPTY_SUPPORT_ROW }],
                      }))
                    }
                  >
                    Add another person
                  </Button>
                </div>
              </fieldset>
            ) : (
              <PlanTextArea
                key={key}
                id={safetyPlanFieldId(key)}
                label={SAFETY_PLAN_SECTION_LABEL[key]}
                required={
                  key === "professionalAndEmergencySupport" || !WITHOUT_THIS_PERSON.includes(values.patientConfirmation)
                }
                value={values.lists[key]}
                error={errorByFieldId.get(safetyPlanFieldId(key))}
                onChange={(text) => setList(key, text)}
              />
            ),
          )}
        </SectionFrame>

        {saveBlockedReason === null ? null : (
          <p
            id="care-plan-safety-form-blocked"
            role="alert"
            data-testid="care-plan-safety-form-blocked"
            className={styles.contactWarning}
          >
            {saveBlockedReason}
          </p>
        )}

        <div className={styles.actionRow}>
          <Button
            type="submit"
            variant="secondary"
            aria-disabled={saveBlockedReason === null ? undefined : true}
            aria-describedby={saveBlockedReason === null ? undefined : "care-plan-safety-form-blocked"}
            onClick={saveBlockedReason === null ? undefined : ignoreUnavailableActivation}
          >
            Save draft
          </Button>
          <Button
            type="button"
            variant="primary"
            aria-disabled={saveBlockedReason === null ? undefined : true}
            aria-describedby={saveBlockedReason === null ? undefined : "care-plan-safety-form-blocked"}
            onClick={saveBlockedReason === null ? handleMakeCurrentRequest : ignoreUnavailableActivation}
          >
            Make current Personal Safety Plan
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        tone="primary"
        title={`Make version ${draft.version} the current Personal Safety Plan`}
        confirmLabel="Make it the current plan"
        cancelLabel="Keep editing"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmMakeCurrent}
        description={
          <span>
            {`This becomes ${patient.preferredName}'s Personal Safety Plan straight away. `}
            {current === null
              ? "There is no earlier version to replace."
              : `Version ${current.version} is superseded and stays readable in history.`}
            {` It is recorded as: ${PATIENT_CONFIRMATION_LABEL[values.patientConfirmation].toLowerCase()}.`}
          </span>
        }
      />
    </section>
  );
}
