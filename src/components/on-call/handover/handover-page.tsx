"use client";

import {
  ArrowLeft,
  BotOff,
  Bone,
  Brain,
  Check,
  CloudOff,
  FileText,
  Flag,
  Lock,
  Plus,
  Scissors,
  SearchX,
  Stethoscope,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { useOnCallCallLog } from "@/components/on-call/handover/call-log";
import { FieldLabel, OnCallLegalField } from "@/components/on-call/handover/legal-picker";
import { onCallActionLink, onCallFilledButton, onCallOutlineButton } from "@/components/on-call/kit/calm";
import { OnCallToolNavHeader } from "@/components/on-call/on-call-nav-header";
import { preloadablePanel } from "@/components/on-call/preloadable-panel";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";
import { cn, fieldControlPlain } from "@/components/ui-primitives";
import { onCallCallLogTime } from "@/lib/on-call/call-log";
import { onCallDeviceStateChangedEvent, onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";
import {
  ON_CALL_HANDOVER_FIELD_LIMITS,
  ON_CALL_HANDOVER_GONE_MESSAGE,
  ON_CALL_HANDOVER_NOT_SET_UP,
  ON_CALL_HANDOVER_TYPES,
  clearOnCallHandover,
  emptyOnCallHandoverDraft,
  onCallHandoverCallsNotIn,
  onCallHandoverShiftDates,
  onCallHandoverDraftFromCall,
  onCallHandoverDraftIsEmpty,
  onCallHandoverLastWard,
  onCallHandoverPatientLabel,
  onCallHandoverRecentLegal,
  onCallHandoverReviewCount,
  onCallHandoverStorageKey,
  removeOnCallHandoverPatient,
  saveOnCallHandoverPatient,
  visibleOnCallHandover,
  type OnCallHandoverDraft,
  type OnCallHandoverPatient,
  type OnCallHandoverReview,
  type OnCallHandoverTextField,
  type OnCallHandoverType,
} from "@/lib/on-call/handover";
import { ON_CALL_SHIFT_PICK_TTL_MS, useOnCallShiftPick } from "@/lib/on-call/shift-context";
import {
  PATIENT_LABEL_EXPIRY_STORAGE_KEY,
  PATIENT_LABELS_CLEARED_EVENT,
  startPatientLabelRetention,
} from "@/lib/patient-label-storage";

/*
 * HANDOVER: one patient at a time, then one tap for the table (mock-up v10,
 * screens 6 to 10).
 *
 * Josh's psychiatry handover. There is deliberately no name or record-number
 * field: the patient is a bed number or up to four initials, as everywhere else
 * on this phone, until the owner approves otherwise. Only Psychiatry has agreed
 * fields; the other three types say so plainly and show no form. Everything
 * here reads and writes one store on this device; nothing talks to a server.
 */

/**
 * The table only shows after "Make the table", so it stays out of first load and is
 * fetched once there is a patient to put in it, ready before the tap.
 */
const handoverTable = preloadablePanel(() =>
  import("@/components/on-call/handover/handover-table").then((module) => module.OnCallHandoverTable),
);
const OnCallHandoverTable = handoverTable.Panel;

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
function useOnCallHandover(): ReturnType<typeof visibleOnCallHandover> | null {
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

const TYPE_ICONS: Record<OnCallHandoverType, LucideIcon> = {
  psychiatry: Brain,
  "general-medicine": Stethoscope,
  "general-surgery": Scissors,
  orthopaedics: Bone,
};

/** The privacy promise, first on the page, in the reader's words rather than ours. */
function PrivacyBand({ expiresAt }: { readonly expiresAt: number | null }) {
  return (
    <section
      aria-label="Where this handover is kept"
      className="grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 forced-colors:border"
      data-testid="on-call-handover-privacy"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Lock aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]" />
        <p className="min-w-0 flex-1 text-base-minus font-semibold text-[color:var(--text-heading)]">
          Private to this phone
        </p>
        <p className="grid shrink-0 text-right leading-tight">
          <span className="text-xs font-semibold text-[color:var(--text-muted)]">Clears</span>
          <span className="nums text-lg-minus font-semibold text-[color:var(--text-heading)]">
            {expiresAt ? clockTime(expiresAt) : "Shift end"}
          </span>
        </p>
      </div>
      <ul role="list" className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Privacy">
        {(
          [
            ["Not synced", CloudOff],
            ["Not searched", SearchX],
            ["No AI", BotOff],
          ] as const
        ).map(([label, Icon]) => (
          <li key={label} className="flex items-center gap-1 text-xs font-semibold text-[color:var(--text-muted)]">
            <Icon aria-hidden="true" className="size-icon-xs shrink-0" />
            {label}
          </li>
        ))}
      </ul>
      <p className={modeSecondaryText}>
        Clears when your shift ends. Anyone who can unlock this phone can read it until then.
      </p>
    </section>
  );
}

/** Psychiatry, Gen med, Gen surg, Ortho. Only Psychiatry has a form. */
function TypePicker({
  value,
  onChange,
}: {
  readonly value: OnCallHandoverType;
  readonly onChange: (value: OnCallHandoverType) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Handover type"
      // Two to a row at large text, so "Psychiatry" fits whole.
      className="grid grid-cols-4 gap-1 rounded-lg bg-[color:var(--surface-wash)] p-1 [html[data-large-text]_&]:grid-cols-2"
      data-testid="on-call-handover-types"
    >
      {ON_CALL_HANDOVER_TYPES.map((type) => {
        const Icon = TYPE_ICONS[type.key];
        const checked = type.key === value;
        return (
          <button
            key={type.key}
            type="button"
            aria-pressed={checked}
            onClick={() => onChange(type.key)}
            className={cn(
              focusRing,
              "grid min-h-14 min-w-0 place-items-center content-center gap-1 rounded-md px-1 py-1.5 text-xs forced-colors:border",
              checked
                ? "bg-[color:var(--surface-raised)] font-semibold text-[color:var(--text-heading)] shadow-[var(--shadow-inset)] forced-colors:border-2 forced-colors:border-[Highlight]"
                : "text-[color:var(--text-muted)]",
            )}
            data-testid={`on-call-handover-type-${type.key}`}
          >
            <Icon aria-hidden="true" className="size-icon-sm" />
            <span className="max-w-full truncate">{type.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "Patient 3 of 4": a circle per patient, a small dot on anyone flagged for review, then Add. */
function PatientRail({
  patients,
  currentId,
  draftBed,
  onPick,
  onAdd,
}: {
  readonly patients: readonly OnCallHandoverPatient[];
  readonly currentId: string | null;
  readonly draftBed: string;
  readonly onPick: (patient: OnCallHandoverPatient) => void;
  readonly onAdd: () => void;
}) {
  const index = patients.findIndex((patient) => patient.id === currentId);
  const unsaved = index === -1;
  const position = unsaved ? patients.length + 1 : index + 1;
  const total = unsaved ? patients.length + 1 : patients.length;
  const forReview = onCallHandoverReviewCount(patients);
  const circle =
    "relative grid size-9 place-items-center rounded-full border bg-[color:var(--surface-raised)] forced-colors:border";
  const dot = (
    <span
      aria-hidden="true"
      className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-[color:var(--surface-raised)] bg-[color:var(--text-heading)] forced-colors:bg-[CanvasText]"
    />
  );
  const step = (key: string, content: ReactNode, label: string) => (
    <li key={key} className="relative z-[5] grid shrink-0 justify-items-center">
      {content}
      <span className="max-w-16 truncate text-xs font-semibold text-[color:var(--text-muted)]">{label}</span>
    </li>
  );
  return (
    <section className="grid min-w-0 gap-2" aria-label="Patients" data-testid="on-call-handover-rail">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p
          className="text-lg-minus font-semibold text-[color:var(--text-heading)]"
          data-testid="on-call-handover-position"
        >
          Patient {position} <span className="text-[color:var(--text-muted)]">of {total}</span>
        </p>
        <span className="sr-only" aria-live="polite">{`Patient ${position} of ${total}`}</span>
        {forReview > 0 ? <p className={cn(modeSecondaryText, "text-xs")}>{forReview} for review</p> : null}
      </div>
      <ol
        data-no-tab-swipe
        className="relative flex w-fit min-w-0 max-w-full gap-1 overflow-x-auto before:absolute before:inset-x-6 before:top-6 before:h-px before:bg-[color:var(--border)]"
        role="list"
      >
        {patients.map((patient, i) => {
          const current = patient.id === currentId;
          const label = onCallHandoverPatientLabel(patient.bed, i);
          const flagged = patient.review === "yes";
          return step(
            patient.id,
            <button
              type="button"
              onClick={() => onPick(patient)}
              aria-current={current ? "step" : undefined}
              aria-label={`${current ? "Editing" : "Edit"} ${label}${flagged ? ", flagged for review" : ""}`}
              className={cn(focusRing, "grid size-12 place-items-center rounded-full")}
              data-testid="on-call-handover-rail-patient"
            >
              <span
                className={cn(
                  circle,
                  current
                    ? "border-2 border-[color:var(--text-heading)] text-sm font-semibold text-[color:var(--text-heading)]"
                    : "border-[color:var(--border-strong)] text-[color:var(--text-muted)]",
                )}
              >
                {current ? (
                  <span className="nums">{i + 1}</span>
                ) : (
                  <Check aria-hidden="true" className="size-icon-xs" />
                )}
                {flagged ? dot : null}
              </span>
            </button>,
            label,
          );
        })}
        {unsaved
          ? step(
              "new",
              <span
                aria-current="step"
                className="grid size-12 place-items-center"
                data-testid="on-call-handover-rail-new"
              >
                <span
                  className={cn(
                    circle,
                    "border-2 border-[color:var(--text-heading)] text-sm font-semibold text-[color:var(--text-heading)]",
                  )}
                >
                  <span className="nums">{position}</span>
                </span>
              </span>,
              draftBed.trim() ? onCallHandoverPatientLabel(draftBed, position - 1) : "New",
            )
          : null}
        {step(
          "add",
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add a patient"
            className={cn(focusRing, "grid size-12 place-items-center rounded-full")}
            data-testid="on-call-handover-rail-add"
          >
            <span className={cn(circle, "border-[color:var(--border-strong)] text-[color:var(--text-muted)]")}>
              <Plus aria-hidden="true" className="size-icon-sm" />
            </span>
          </button>,
          "Add",
        )}
      </ol>
    </section>
  );
}

const inputClass = cn(fieldControlPlain, "min-h-12 text-base-minus");

function NoteArea({
  number,
  label,
  placeholder,
  value,
  maxLength,
  onChange,
  testId,
  rows = 3,
}: {
  readonly number: number;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly maxLength: number;
  readonly onChange: (value: string) => void;
  readonly testId: string;
  readonly rows?: number;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <FieldLabel number={number} htmlFor={id}>
        {label}
      </FieldLabel>
      <textarea
        id={id}
        value={value}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className={cn(fieldControlPlain, "min-h-20 py-2 text-base-minus")}
      />
    </div>
  );
}

function TextLine({
  number,
  label,
  placeholder,
  value,
  maxLength,
  onChange,
  testId,
}: {
  readonly number: number;
  readonly label: string;
  readonly placeholder?: string;
  readonly value: string;
  readonly maxLength: number;
  readonly onChange: (value: string) => void;
  readonly testId: string;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <FieldLabel number={number} htmlFor={id}>
        {label}
      </FieldLabel>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        className={inputClass}
      />
    </div>
  );
}

function ReviewChoice({
  number,
  value,
  onChange,
}: {
  readonly number: number;
  readonly value: OnCallHandoverReview;
  readonly onChange: (value: OnCallHandoverReview) => void;
}) {
  const labelId = useId();
  const option = (choice: "yes" | "no", label: string) => {
    const pressed = value === choice;
    return (
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => onChange(pressed ? "" : choice)}
        className={cn(
          focusRing,
          "inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border text-base-minus font-semibold forced-colors:border",
          pressed
            ? "border-[color:var(--text-heading)] bg-[color:var(--surface-wash)] text-[color:var(--text-heading)] forced-colors:border-2 forced-colors:border-[Highlight]"
            : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]",
        )}
        data-testid={`on-call-handover-review-${choice}`}
      >
        {choice === "yes" ? <Flag aria-hidden="true" className="size-icon-sm" /> : null}
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-labelledby={labelId} className="grid min-w-0 gap-1.5">
      <FieldLabel number={number} id={labelId}>
        Requires review
      </FieldLabel>
      <div className="flex gap-2">
        {option("yes", "Yes")}
        {option("no", "No")}
      </div>
    </div>
  );
}

/** "1 to-do in tonight's call log is not in this handover · Add": one tap brings the oldest in as a patient. */
function CallsToAdd({
  patients,
  onAdd,
}: {
  readonly patients: readonly OnCallHandoverPatient[];
  readonly onAdd: (draft: OnCallHandoverDraft) => void;
}) {
  const entries = useOnCallCallLog()?.entries ?? null;
  const open = useMemo(() => onCallHandoverCallsNotIn(entries ?? [], patients), [entries, patients]);
  if (open.length === 0) return null;
  const first = open[0]!;
  const what = [onCallCallLogTime(first.at), first.label, first.caller].filter(Boolean).join(" · ");
  return (
    <section
      aria-label="From tonight's call log"
      className="flex min-w-0 items-center gap-3 border-t border-[color:var(--border)] pt-3"
      data-testid="on-call-handover-calls"
    >
      <FileText aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
      <p className={cn(modeSecondaryText, "min-w-0 flex-1")}>
        {open.length === 1
          ? "1 to-do in tonight's call log is not in this handover"
          : `${open.length} to-dos in tonight's call log are not in this handover`}
      </p>
      <button
        type="button"
        onClick={() => onAdd(onCallHandoverDraftFromCall(first))}
        aria-label={`Add the ${what} call as a patient`}
        className={cn(onCallActionLink, focusRing)}
        data-testid="on-call-handover-add-call"
      >
        Add
      </button>
    </section>
  );
}

function useNightShift(): boolean {
  const pick = useOnCallShiftPick();
  if (!pick || pick.period !== "night") return false;
  const at = Date.parse(pick.at);
  return Number.isFinite(at) && new Date().getTime() - at < ON_CALL_SHIFT_PICK_TTL_MS;
}

export function OnCallHandoverPage() {
  const view = useOnCallHandover();
  const patients = useMemo(() => view?.patients ?? [], [view]);
  const night = useNightShift();
  const [mode, setMode] = useState<"form" | "table">("form");
  const hasPatients = patients.length > 0;
  useEffect(() => {
    // A failed prefetch is not an error: the tap that needs the table loads it again.
    if (hasPatients) void handoverTable.preload().catch(() => undefined);
  }, [hasPatients]);
  const [type, setType] = useState<OnCallHandoverType>("psychiatry");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OnCallHandoverDraft>(emptyOnCallHandoverDraft);
  const [copiedWard, setCopiedWard] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // When this shift's labels are wiped (epoch ms). Checked before every write, as the call log does,
  // so a draft left on screen past the end of the shift is cleared rather than saved under a fresh stamp.
  const [draftExpiresAt, setDraftExpiresAt] = useState<number | null>(null);

  const reset = useCallback(() => {
    setDraft(emptyOnCallHandoverDraft);
    setCurrentId(null);
    setCopiedWard("");
    setDraftExpiresAt(null);
    setMode("form");
  }, []);

  // A wipe (end of shift, sign-out, another user, another tab) also drops the half-typed record.
  useEffect(() => {
    const onCleared = () => {
      reset();
      setProblem(null);
    };
    // Another tab's wipe reaches this one only as a `storage` event: a full clear
    // (key null) or the shift's expiry stamp being removed.
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || (event.key === PATIENT_LABEL_EXPIRY_STORAGE_KEY && event.newValue === null)) {
        onCleared();
      }
    };
    window.addEventListener(PATIENT_LABELS_CLEARED_EVENT, onCleared);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PATIENT_LABELS_CLEARED_EVENT, onCleared);
      window.removeEventListener("storage", onStorage);
    };
  }, [reset]);

  // The draft's shift ends while the page is open: clear it on time, not at the next keystroke.
  useEffect(() => {
    if (draftExpiresAt === null) return;
    const check = () => {
      if (Date.now() >= draftExpiresAt) reset();
    };
    const timer = window.setTimeout(check, Math.max(0, draftExpiresAt - Date.now()));
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [draftExpiresAt, reset]);

  // The record being edited vanished (deleted in another tab, or it lapsed): start a fresh one.
  const currentGone = currentId !== null && view !== null && !patients.some((patient) => patient.id === currentId);
  useEffect(() => {
    if (!currentGone) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reset();
  }, [currentGone, reset]);

  /** Every change is kept as it is typed, so nothing is lost if the phone locks. */
  const commit = (next: OnCallHandoverDraft, id: string | null = currentId) => {
    if (draftExpiresAt !== null && Date.now() >= draftExpiresAt) {
      reset();
      setProblem("The shift has ended. This handover was cleared.");
      return;
    }
    setDraft(next);
    if (onCallHandoverDraftIsEmpty(next)) {
      setProblem(null);
      return;
    }
    let expiresAt = draftExpiresAt;
    if (expiresAt === null) {
      expiresAt = startPatientLabelRetention();
      if (expiresAt === null) {
        setProblem("The shift expiry could not be set. This handover cannot be kept on this device.");
        return;
      }
      setDraftExpiresAt(expiresAt);
    }
    const result = saveOnCallHandoverPatient(id, next);
    if (!result.ok) {
      if (result.problem === ON_CALL_HANDOVER_GONE_MESSAGE) reset();
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    if (id !== result.patient.id) setCurrentId(result.patient.id);
  };

  const update = (key: OnCallHandoverTextField) => (value: string) => commit({ ...draft, [key]: value });

  /** A fresh patient, with the ward copied from the last one typed. */
  const startNew = () => {
    const ward = onCallHandoverLastWard(patients);
    setCurrentId(null);
    setDraft({ ...emptyOnCallHandoverDraft, ward });
    setCopiedWard(ward);
    setProblem(null);
    setMode("form");
    announce(ward ? `New patient. Ward copied from the last: ${ward}.` : "New patient.");
  };

  const pick = (patient: OnCallHandoverPatient) => {
    setDraftExpiresAt(view?.expiresAt ?? null);
    setCurrentId(patient.id);
    setDraft({ ...patient });
    setCopiedWard("");
    setProblem(null);
    setMode("form");
  };

  const showTable = () => {
    setMode("table");
    setConfirmClear(false);
    window.scrollTo?.({ top: 0 });
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

  const index = patients.findIndex((patient) => patient.id === currentId);
  const bedLabel = draft.bed.trim()
    ? onCallHandoverPatientLabel(draft.bed, index === -1 ? patients.length : index)
    : "";
  const recentLegal = onCallHandoverRecentLegal(patients);
  const clearsAt = view.expiresAt ? clockTime(view.expiresAt) : null;
  const dates = view.startedAt && view.expiresAt ? onCallHandoverShiftDates(view.startedAt, view.expiresAt) : null;
  const tableOpen = mode === "table" && patients.length > 0;
  const ready = ON_CALL_HANDOVER_TYPES.find((item) => item.key === type)?.ready ?? false;
  const wardCopied = copiedWard !== "" && draft.ward === copiedWard;

  return (
    <>
      <OnCallToolNavHeader title="Handover" testIdPrefix="on-call-handover" />
      <InformationPageShell testId="on-call-handover-main" width="narrow">
        <div className="grid min-w-0 gap-5" data-mode-identity="on-call">
          {tableOpen ? (
            <div className="grid min-w-0 gap-1 print:hidden">
              <div>
                <button
                  type="button"
                  onClick={() => setMode("form")}
                  className={cn(onCallActionLink, focusRing, "gap-1.5")}
                  data-testid="on-call-handover-back"
                >
                  <ArrowLeft aria-hidden="true" className="size-icon-xs" />
                  Back to the form
                </button>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">Handover table</h1>
                <button
                  type="button"
                  onClick={() => pick(patients[Math.max(0, index)] ?? patients[0]!)}
                  className={cn(onCallActionLink, focusRing)}
                  data-testid="on-call-handover-edit"
                >
                  Edit
                </button>
              </div>
            </div>
          ) : (
            <div className="grid min-w-0 gap-2 print:hidden">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold text-[color:var(--text-heading)]">Handover</h1>
                {patients.length > 0 && !confirmClear ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className={cn(onCallActionLink, focusRing)}
                    data-testid="on-call-handover-clear"
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
              {patients.length > 0 && confirmClear ? (
                <div
                  className="grid min-w-0 gap-2 rounded-lg border border-[color:var(--border)] p-3 forced-colors:border"
                  role="group"
                  aria-label="Clear the handover"
                >
                  <p className="text-sm text-[color:var(--text-heading)]">
                    {patients.length === 1
                      ? "Clear the one patient from this phone? This cannot be undone."
                      : `Clear all ${patients.length} patients from this phone? This cannot be undone.`}
                  </p>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Button
                      variant="danger"
                      icon={Trash2}
                      onClick={() => {
                        clearOnCallHandover();
                        setConfirmClear(false);
                        reset();
                        announce("Handover cleared.");
                      }}
                      testId="on-call-handover-clear-confirm"
                    >
                      {patients.length === 1 ? "Clear the patient" : `Clear all ${patients.length} patients`}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmClear(false)}
                      testId="on-call-handover-clear-cancel"
                    >
                      Keep them
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {tableOpen ? (
            <OnCallHandoverTable
              patients={patients}
              heading={{ dates, shift: night ? "Night to day" : null }}
              clearsAt={clearsAt}
              toTeam={night ? "Day team" : null}
              onEdit={pick}
            />
          ) : (
            <>
              <PrivacyBand expiresAt={view.expiresAt} />
              <TypePicker value={type} onChange={setType} />

              {!ready ? (
                <p
                  className="rounded-lg border border-dashed border-[color:var(--border-strong)] p-3 text-sm text-[color:var(--text-heading)]"
                  role="status"
                  data-testid="on-call-handover-type-not-set-up"
                >
                  {ON_CALL_HANDOVER_NOT_SET_UP}
                </p>
              ) : (
                <>
                  <PatientRail
                    patients={patients}
                    currentId={currentId}
                    draftBed={draft.bed}
                    onPick={pick}
                    onAdd={startNew}
                  />

                  <form
                    onSubmit={(event) => event.preventDefault()}
                    noValidate
                    className="grid min-w-0 gap-5"
                    aria-labelledby="on-call-handover-form-heading"
                    data-testid="on-call-handover-form"
                  >
                    <h2
                      id="on-call-handover-form-heading"
                      className="flex min-w-0 items-center gap-2 text-base-minus font-semibold text-[color:var(--text-heading)]"
                    >
                      <Brain aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
                      Psychiatry patient
                      <span className="sr-only">{currentId ? ", editing" : ", new"}</span>
                    </h2>

                    <div className="grid min-w-0 gap-1.5">
                      <FieldLabel number={1} note={wardCopied ? "Ward copied from last" : null}>
                        Bed and ward
                      </FieldLabel>
                      <div className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                        <input
                          aria-label="Bed or initials"
                          aria-describedby="on-call-handover-bed-hint"
                          placeholder="Bed or initials"
                          value={draft.bed}
                          maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.bed}
                          onChange={(event) => update("bed")(event.target.value)}
                          autoComplete="off"
                          data-testid="on-call-handover-bed"
                          className={inputClass}
                        />
                        <input
                          aria-label="Ward"
                          placeholder="Ward"
                          value={draft.ward}
                          maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.ward}
                          onChange={(event) => update("ward")(event.target.value)}
                          autoComplete="off"
                          data-testid="on-call-handover-ward"
                          className={inputClass}
                        />
                      </div>
                      <p id="on-call-handover-bed-hint" className={cn(modeSecondaryText, "text-xs")}>
                        Bed number or up to four initials, never a name
                      </p>
                    </div>

                    <OnCallLegalField
                      number={2}
                      value={draft.legal}
                      recent={recentLegal}
                      bedLabel={bedLabel}
                      onChange={update("legal")}
                    />
                    <TextLine
                      number={3}
                      label="Impression"
                      placeholder="Working impression"
                      value={draft.impression}
                      maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.impression}
                      onChange={update("impression")}
                      testId="on-call-handover-impression"
                    />
                    <NoteArea
                      number={4}
                      label="Story"
                      placeholder="What happened overnight"
                      value={draft.story}
                      maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.story}
                      onChange={update("story")}
                      testId="on-call-handover-story"
                      rows={4}
                    />
                    <TextLine
                      number={5}
                      label="Referrals"
                      placeholder="Where to, or None"
                      value={draft.referrals}
                      maxLength={ON_CALL_HANDOVER_FIELD_LIMITS.referrals}
                      onChange={update("referrals")}
                      testId="on-call-handover-referrals"
                    />
                    <ReviewChoice number={6} value={draft.review} onChange={(review) => commit({ ...draft, review })} />
                    <NoteArea
                      number={7}
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
                    <button
                      type="button"
                      onClick={startNew}
                      className={cn(onCallOutlineButton, focusRing)}
                      data-testid="on-call-handover-next"
                    >
                      <Plus aria-hidden="true" className="size-icon-sm" />
                      Next patient
                    </button>
                    <button
                      type="button"
                      onClick={showTable}
                      disabled={patients.length === 0}
                      className={cn(
                        onCallFilledButton,
                        focusRing,
                        "disabled:cursor-not-allowed disabled:bg-[color:var(--surface-wash)] disabled:text-[color:var(--text-muted)]",
                      )}
                      data-testid="on-call-handover-make-table"
                    >
                      <Table2 aria-hidden="true" className="size-icon-sm" />
                      Make table
                      {patients.length > 0 ? (
                        <span className="nums text-sm opacity-80">
                          <span className="sr-only">of </span>
                          {patients.length}
                          <span className="sr-only">{patients.length === 1 ? " patient" : " patients"}</span>
                        </span>
                      ) : null}
                    </button>
                  </div>

                  <CallsToAdd patients={patients} onAdd={(next) => commit(next, null)} />
                </>
              )}
            </>
          )}
        </div>
      </InformationPageShell>
    </>
  );
}
