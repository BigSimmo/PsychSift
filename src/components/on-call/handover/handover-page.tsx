"use client";

import { ArrowLeft, Clipboard, ClipboardCheck, Flag, Lock, Plus, Table2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { useOnCallCallLog } from "@/components/on-call/handover/call-log";
import { OnCallToolNavHeader } from "@/components/on-call/on-call-nav-header";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modeModuleSurface } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { announce } from "@/components/ui/live-announcer";
import { BrowserPrintButton, PrintOutput } from "@/components/ui/print-output";
import { TextField } from "@/components/ui/text-field";
import { cn, eyebrowText, fieldControlPlain } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { onCallCallLogTime, onCallHandoverItems } from "@/lib/on-call/call-log";
import { onCallDeviceStateChangedEvent, onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";
import {
  ON_CALL_HANDOVER_COLUMNS,
  ON_CALL_HANDOVER_FIELD_LIMITS,
  clearOnCallHandover,
  emptyOnCallHandoverDraft,
  onCallHandoverCell,
  onCallHandoverDraftFromCall,
  onCallHandoverDraftIsEmpty,
  onCallHandoverHtmlTable,
  onCallHandoverPlainText,
  onCallHandoverStorageKey,
  onCallHandoverTitle,
  removeOnCallHandoverPatient,
  saveOnCallHandoverPatient,
  visibleOnCallHandover,
  type OnCallHandoverDraft,
  type OnCallHandoverPatient,
  type OnCallHandoverReview,
  type OnCallHandoverTextField,
} from "@/lib/on-call/handover";
import { PATIENT_LABEL_EXPIRY_STORAGE_KEY, PATIENT_LABELS_CLEARED_EVENT } from "@/lib/patient-label-storage";

/*
 * HANDOVER: one patient at a time, then one tap for the table.
 *
 * Josh's psychiatry handover, built from the parts already decided. The name
 * and record-number fields, the pick lists, Share and the other specialties
 * wait for his decisions (see `src/lib/on-call/handover.ts`). Everything here
 * reads and writes one store on this device; nothing talks to a server.
 */

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const events = [
    onCallDeviceStoreChangedEvent,
    onCallDeviceStateChangedEvent,
    PATIENT_LABELS_CLEARED_EVENT,
    "storage",
  ] as const;
  for (const name of events) window.addEventListener(name, onChange);
  return () => {
    for (const name of events) window.removeEventListener(name, onChange);
  };
}

const SNAPSHOT_SEPARATOR = "\u0000";

/** The list and the shift's expiry stamp in one primitive snapshot; read directly so render never wipes. */
function readRaw(): string {
  try {
    const list = window.localStorage.getItem(onCallHandoverStorageKey) ?? "";
    const stamp = window.localStorage.getItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY) ?? "";
    return `${list}${SNAPSHOT_SEPARATOR}${stamp}`;
  } catch {
    return SNAPSHOT_SEPARATOR;
  }
}

/** The handover on screen, oldest first, or null before the device has been read. */
function useOnCallHandover(): { readonly patients: OnCallHandoverPatient[]; readonly expiresAt: number | null } | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return useMemo(
    () => {
      if (raw === undefined) return null;
      const [list, stamp] = raw.split(SNAPSHOT_SEPARATOR);
      return visibleOnCallHandover(list || null, stamp || null);
    },
    // `tick` re-reads the clock; `raw` re-reads the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, tick],
  );
}

function clockTime(epochMs: number): string {
  return onCallCallLogTime(new Date(epochMs).toISOString());
}

function patientLabel(patient: OnCallHandoverDraft, index: number): string {
  return patient.bed || `Patient ${index + 1}`;
}

/** The privacy promise, first on the page, in the reader's words rather than ours. */
function PrivacyBand({ expiresAt }: { readonly expiresAt: number | null }) {
  return (
    <section
      aria-label="Where this handover is kept"
      className="grid gap-2 rounded-lg border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] p-3"
      data-testid="on-call-handover-privacy"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--surface-raised)] text-[color:var(--mode-identity)]"
        >
          <Lock aria-hidden="true" className="size-icon-sm" />
        </span>
        <p className={cn(modeNameText, "min-w-0 flex-1 text-[color:var(--text-heading)]")}>Private to this phone</p>
        <p className="nums shrink-0 text-right text-sm font-semibold text-[color:var(--mode-identity)]">
          {expiresAt ? `Clears ${clockTime(expiresAt)}` : "Clears at shift end"}
        </p>
      </div>
      <ul role="list" className="flex flex-wrap gap-1.5" aria-label="Privacy">
        {["Not synced", "Not searched", "Never sent to AI"].map((label) => (
          <li
            key={label}
            className="rounded-full bg-[color:var(--surface-raised)] px-2.5 py-1 text-xs font-semibold text-[color:var(--mode-identity)]"
          >
            {label}
          </li>
        ))}
      </ul>
      <p className={modeSecondaryText}>
        Wiped when your shift ends{expiresAt ? "" : " (at most 12 hours after you start)"} or you sign out. It leaves
        this phone only when you copy or print it.
      </p>
    </section>
  );
}

/** "Patient 2 of 4": a round button per patient, a small amber dot on anyone flagged for review. */
function PatientRail({
  patients,
  currentId,
  onPick,
  onAdd,
}: {
  readonly patients: readonly OnCallHandoverPatient[];
  readonly currentId: string | null;
  readonly onPick: (patient: OnCallHandoverPatient) => void;
  readonly onAdd: () => void;
}) {
  const index = patients.findIndex((patient) => patient.id === currentId);
  const position = index === -1 ? patients.length + 1 : index + 1;
  const total = index === -1 ? patients.length + 1 : patients.length;
  const forReview = patients.filter((patient) => patient.review === "yes").length;
  return (
    <section
      className={cn(modeModuleSurface, "grid gap-3 p-3")}
      aria-label="Patients"
      data-testid="on-call-handover-rail"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p className="text-lg font-semibold text-[color:var(--text-heading)]">
          Patient {position} <span className="text-[color:var(--text-muted)]">of {total}</span>
        </p>
        {forReview > 0 ? <p className={modeSecondaryText}>{forReview} for review</p> : null}
      </div>
      <ol className="flex min-w-0 gap-2 overflow-x-auto pb-1" role="list">
        {patients.map((patient, i) => {
          const current = patient.id === currentId;
          const label = patientLabel(patient, i);
          return (
            <li key={patient.id} className="grid shrink-0 justify-items-center gap-1">
              <button
                type="button"
                onClick={() => onPick(patient)}
                aria-current={current ? "step" : undefined}
                aria-label={`Edit ${label}${patient.review === "yes" ? ", flagged for review" : ""}`}
                className={cn(
                  "relative grid size-11 place-items-center rounded-full border-2 text-xs font-semibold",
                  current
                    ? "border-[color:var(--mode-identity)] bg-[color:var(--surface-raised)] text-[color:var(--mode-identity)]"
                    : "border-transparent bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]",
                )}
                data-testid="on-call-handover-rail-patient"
              >
                <span className="nums">{i + 1}</span>
                {patient.review === "yes" ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-[color:var(--surface-raised)] bg-[color:var(--warning)]"
                  />
                ) : null}
              </button>
              <span className="max-w-14 truncate text-2xs font-semibold text-[color:var(--text-muted)]">{label}</span>
            </li>
          );
        })}
        <li className="grid shrink-0 justify-items-center gap-1">
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add a patient"
            className="grid size-11 place-items-center rounded-full border-2 border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]"
            data-testid="on-call-handover-rail-add"
          >
            <Plus aria-hidden="true" className="size-icon-sm" />
          </button>
          <span className="text-2xs font-semibold text-[color:var(--text-muted)]">Add</span>
        </li>
      </ol>
    </section>
  );
}

function NoteArea({
  label,
  placeholder,
  value,
  maxLength,
  onChange,
  testId,
  rows = 3,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly maxLength: number;
  readonly onChange: (value: string) => void;
  readonly testId: string;
  readonly rows?: number;
}) {
  return (
    <FormField label={label}>
      {(field) => (
        <textarea
          id={field.id}
          aria-describedby={field.describedBy}
          value={value}
          maxLength={maxLength}
          rows={rows}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck
          onChange={(event) => onChange(event.target.value)}
          data-testid={testId}
          className={cn(fieldControlPlain, "min-h-20 py-2")}
        />
      )}
    </FormField>
  );
}

function ReviewChoice({
  value,
  onChange,
}: {
  readonly value: OnCallHandoverReview;
  readonly onChange: (value: OnCallHandoverReview) => void;
}) {
  const option = (choice: "yes" | "no", label: string) => {
    const pressed = value === choice;
    return (
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => onChange(pressed ? "" : choice)}
        className={cn(
          "inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border text-base font-semibold",
          pressed && choice === "yes"
            ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning-text)]"
            : pressed
              ? "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
              : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
        )}
        data-testid={`on-call-handover-review-${choice}`}
      >
        {choice === "yes" ? <Flag aria-hidden="true" className="size-icon-sm" /> : null}
        {label}
      </button>
    );
  };
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold text-[color:var(--text-heading)]">Requires review</legend>
      <div className="flex gap-2">
        {option("yes", "Yes")}
        {option("no", "No")}
      </div>
    </fieldset>
  );
}

type CopyState = "idle" | "copied" | "failed";

/** Copies the table as a table where the browser allows it, and as plain text everywhere. */
async function copyHandover(patients: readonly OnCallHandoverPatient[]): Promise<void> {
  const plain = onCallHandoverPlainText(patients);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([onCallHandoverHtmlTable(patients)], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Fall through to plain text.
    }
  }
  await copyTextToClipboard(plain);
}

function HandoverTable({
  patients,
  onBack,
  onEdit,
}: {
  readonly patients: readonly OnCallHandoverPatient[];
  readonly onBack: () => void;
  readonly onEdit: (patient: OnCallHandoverPatient) => void;
}) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const resetTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );
  const onCopy = useCallback(async () => {
    try {
      await copyHandover(patients);
      setCopy("copied");
      announce("Handover copied.");
    } catch {
      setCopy("failed");
      announce("Not copied. Print it, or select the table and copy it by hand.");
    }
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopy("idle"), 4000);
  }, [patients]);
  const now = new Date();
  return (
    <section
      className="grid min-w-0 gap-3"
      aria-labelledby="on-call-handover-table-heading"
      data-testid="on-call-handover-table"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack} testId="on-call-handover-back">
          Back to the form
        </Button>
      </div>
      <PrintOutput
        monochrome
        confidential
        printedAt={`Printed ${new Intl.DateTimeFormat("en-AU", {
          timeZone: "Australia/Perth",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(now)}`}
        provenance="PsychSift On Call handover. Typed by the doctor on this phone; check it before relying on it."
        testId="on-call-handover-print"
      >
        <h2
          id="on-call-handover-table-heading"
          className="mb-2 text-base font-semibold text-[color:var(--text-heading)]"
        >
          {onCallHandoverTitle(now)}
        </h2>
        <div className="max-w-full overflow-x-auto rounded-lg border border-[color:var(--border)] print:overflow-visible print:border-0">
          <table className="w-max min-w-full border-collapse text-left text-sm print:w-full print:text-xs">
            <caption className="sr-only">
              {patients.length === 1 ? "One patient" : `${patients.length} patients`}, in the order entered
            </caption>
            <thead>
              <tr className="bg-[color:var(--surface-subtle)]">
                {ON_CALL_HANDOVER_COLUMNS.map(({ key, label }) => (
                  <th
                    key={key}
                    scope="col"
                    className={cn(
                      "border-b border-[color:var(--border)] px-3 py-2 text-xs font-semibold text-[color:var(--text-heading)]",
                      key === "bed" && "sticky left-0 bg-[color:var(--surface-subtle)] print:static",
                    )}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patients.map((patient, index) => {
                const flagged = patient.review === "yes";
                return (
                  <tr
                    key={patient.id}
                    className={cn("align-top", flagged && "bg-[color:var(--warning-soft)]")}
                    data-testid="on-call-handover-table-row"
                  >
                    {ON_CALL_HANDOVER_COLUMNS.map(({ key }) => {
                      const value = onCallHandoverCell(patient, key);
                      if (key === "bed") {
                        return (
                          <th
                            key={key}
                            scope="row"
                            className={cn(
                              "sticky left-0 border-b border-[color:var(--border)] px-3 py-2 font-semibold print:static",
                              flagged ? "bg-[color:var(--warning-soft)]" : "bg-[color:var(--surface-raised)]",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => onEdit(patient)}
                              className="text-left font-semibold text-[color:var(--mode-identity)] underline-offset-2 hover:underline print:text-[color:var(--text)] print:no-underline"
                              aria-label={`Edit ${patientLabel(patient, index)}`}
                            >
                              {patientLabel(patient, index)}
                            </button>
                          </th>
                        );
                      }
                      return (
                        <td
                          key={key}
                          className={cn(
                            "border-b border-[color:var(--border)] px-3 py-2 text-[color:var(--text)]",
                            (key === "story" || key === "plan") && "min-w-56 max-w-80 whitespace-pre-wrap break-words",
                            key === "review" && flagged && "font-semibold text-[color:var(--warning-text)]",
                          )}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PrintOutput>
      <div className="flex min-w-0 flex-wrap items-center gap-3 print:hidden">
        <Button
          variant="secondary"
          icon={copy === "copied" ? ClipboardCheck : Clipboard}
          onClick={() => void onCopy()}
          testId="on-call-handover-table-copy"
        >
          {copy === "copied" ? "Copied" : "Copy as table"}
        </Button>
        <BrowserPrintButton label="Print or save as PDF" />
      </div>
      {copy === "failed" ? (
        <p className={cn(modeSecondaryText, "print:hidden")}>
          Not copied. Print it, or select the table and copy it by hand.
        </p>
      ) : null}
    </section>
  );
}

/** Open calls from tonight's log that are not in the handover yet, offered one tap away. */
function CallsToAdd({ onAdd }: { readonly onAdd: (draft: OnCallHandoverDraft) => void }) {
  const entries = useOnCallCallLog()?.entries ?? null;
  const open = useMemo(() => onCallHandoverItems(entries ?? []), [entries]);
  if (open.length === 0) return null;
  return (
    <section
      aria-labelledby="on-call-handover-calls-heading"
      className="grid min-w-0 gap-2"
      data-testid="on-call-handover-calls"
    >
      <h2 id="on-call-handover-calls-heading" className={cn(eyebrowText, "px-3")}>
        From tonight&apos;s call log
      </h2>
      <ul role="list" className={modeModuleSurface}>
        {open.map((entry) => {
          const title = [onCallCallLogTime(entry.at), entry.label, entry.caller].filter(Boolean).join(" · ");
          return (
            <li key={entry.id} className={cn(modeInsetHairline, "flex min-w-0 items-center gap-3 px-3 py-2")}>
              <div className="min-w-0 flex-1">
                <p className={cn(modeNameText, "break-words")}>{title}</p>
                {entry.note ? <p className={cn(modeSecondaryText, "line-clamp-1 break-words")}>{entry.note}</p> : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={Plus}
                onClick={() => onAdd(onCallHandoverDraftFromCall(entry))}
                aria-label={`Add the ${title} call as a patient`}
                testId="on-call-handover-add-call"
              >
                Add as patient
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function OnCallHandoverPage() {
  const view = useOnCallHandover();
  const patients = useMemo(() => view?.patients ?? [], [view]);
  const [mode, setMode] = useState<"form" | "table">("form");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OnCallHandoverDraft>(emptyOnCallHandoverDraft);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // A wipe (end of shift, sign-out, another user) also drops the half-typed record.
  useEffect(() => {
    const onCleared = () => {
      setDraft(emptyOnCallHandoverDraft);
      setCurrentId(null);
      setProblem(null);
      setMode("form");
    };
    window.addEventListener(PATIENT_LABELS_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(PATIENT_LABELS_CLEARED_EVENT, onCleared);
  }, []);

  // The record being edited vanished (deleted in another tab, or it lapsed): start a fresh one.
  const currentGone = currentId !== null && view !== null && !patients.some((patient) => patient.id === currentId);
  useEffect(() => {
    if (!currentGone) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentId(null);
    setDraft(emptyOnCallHandoverDraft);
  }, [currentGone]);

  /** Every change is kept as it is typed, so nothing is lost if the phone locks. */
  const commit = (next: OnCallHandoverDraft, id: string | null = currentId) => {
    setDraft(next);
    if (onCallHandoverDraftIsEmpty(next)) {
      setProblem(null);
      return;
    }
    const result = saveOnCallHandoverPatient(id, next);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    if (id !== result.patient.id) setCurrentId(result.patient.id);
  };

  const update = (key: OnCallHandoverTextField) => (value: string) => commit({ ...draft, [key]: value });

  const startNew = () => {
    setCurrentId(null);
    setDraft(emptyOnCallHandoverDraft);
    setProblem(null);
    setMode("form");
    announce("New patient.");
  };

  const pick = (patient: OnCallHandoverPatient) => {
    setCurrentId(patient.id);
    setDraft({ ...patient });
    setProblem(null);
    setMode("form");
  };

  if (view === null) {
    return (
      <>
        <OnCallToolNavHeader title="Handover" testIdPrefix="on-call-handover" />
        <InformationPageShell testId="on-call-handover-main" width="narrow">
          <p role="status">Opening the handover on this phone…</p>
        </InformationPageShell>
      </>
    );
  }

  return (
    <>
      <OnCallToolNavHeader title="Handover" testIdPrefix="on-call-handover" />
      <InformationPageShell testId="on-call-handover-main" width="narrow">
        <h1 className="sr-only">Handover</h1>
        <div className="grid min-w-0 gap-4" data-mode-identity="on-call">
          <div className="print:hidden">
            <PrivacyBand expiresAt={view.expiresAt} />
          </div>

          {mode === "table" && patients.length > 0 ? (
            <HandoverTable patients={patients} onBack={() => setMode("form")} onEdit={pick} />
          ) : (
            <>
              <p className={cn(eyebrowText, "px-3")}>Psychiatry handover</p>
              {patients.length > 0 ? (
                <PatientRail patients={patients} currentId={currentId} onPick={pick} onAdd={startNew} />
              ) : null}

              <form
                onSubmit={(event) => event.preventDefault()}
                noValidate
                className={cn(modeModuleSurface, "grid min-w-0 gap-4 p-3")}
                aria-label={currentId ? "Edit this patient" : "New patient"}
                data-testid="on-call-handover-form"
              >
                <div className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                  <TextField
                    label="Bed"
                    hint="Bed number or up to four initials"
                    value={draft.bed}
                    maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.bed}
                    onChange={(event) => update("bed")(event.target.value)}
                    autoComplete="off"
                    data-testid="on-call-handover-bed"
                  />
                  <TextField
                    label="Ward"
                    value={draft.ward}
                    maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.ward}
                    onChange={(event) => update("ward")(event.target.value)}
                    autoComplete="off"
                    data-testid="on-call-handover-ward"
                  />
                </div>
                <TextField
                  label="Legal"
                  value={draft.legal}
                  maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.legal}
                  onChange={(event) => update("legal")(event.target.value)}
                  autoComplete="off"
                  data-testid="on-call-handover-legal"
                />
                <TextField
                  label="Impression"
                  value={draft.impression}
                  maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.impression}
                  onChange={(event) => update("impression")(event.target.value)}
                  autoComplete="off"
                  data-testid="on-call-handover-impression"
                />
                <NoteArea
                  label="Story"
                  placeholder="What happened overnight"
                  value={draft.story}
                  maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.story}
                  onChange={update("story")}
                  testId="on-call-handover-story"
                  rows={4}
                />
                <TextField
                  label="Referrals"
                  value={draft.referrals}
                  maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.referrals}
                  onChange={(event) => update("referrals")(event.target.value)}
                  autoComplete="off"
                  data-testid="on-call-handover-referrals"
                />
                <ReviewChoice value={draft.review} onChange={(review) => commit({ ...draft, review })} />
                <NoteArea
                  label="Plan"
                  placeholder="What the day team needs to do"
                  value={draft.plan}
                  maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.plan}
                  onChange={update("plan")}
                  testId="on-call-handover-plan"
                />
                {problem ? (
                  <ModeNotice tone="warning" testId="on-call-handover-problem">
                    {problem}
                  </ModeNotice>
                ) : null}
                {currentId ? (
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() => {
                        removeOnCallHandoverPatient(currentId);
                        startNew();
                      }}
                      testId="on-call-handover-delete"
                    >
                      Delete this patient
                    </Button>
                  </div>
                ) : null}
              </form>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" icon={Plus} onClick={startNew} testId="on-call-handover-next">
                  Next patient
                </Button>
                <Button
                  variant="primary"
                  icon={Table2}
                  onClick={() => setMode("table")}
                  disabled={patients.length === 0}
                  testId="on-call-handover-make-table"
                >
                  {patients.length > 0 ? `Make table (${patients.length})` : "Make table"}
                </Button>
              </div>

              <CallsToAdd onAdd={(next) => commit(next, null)} />
            </>
          )}

          {patients.length > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-3 print:hidden">
              {confirmClear ? (
                <>
                  <Button
                    variant="danger"
                    onClick={() => {
                      clearOnCallHandover();
                      setConfirmClear(false);
                      startNew();
                    }}
                    testId="on-call-handover-clear-confirm"
                  >
                    {patients.length === 1 ? "Clear the patient" : `Clear all ${patients.length} patients`}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmClear(false)} testId="on-call-handover-clear-cancel">
                    Keep them
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  icon={Trash2}
                  onClick={() => setConfirmClear(true)}
                  testId="on-call-handover-clear"
                >
                  Clear the handover
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </InformationPageShell>
    </>
  );
}
