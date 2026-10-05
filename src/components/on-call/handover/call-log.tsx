"use client";

import { Check, Circle, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import { onCallChipShape, onCallChipTap, onCallFilledButton, onCallOutlineButton } from "@/components/on-call/kit/calm";
import { ModeActionButton } from "@/components/mode-kit/action-button";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline } from "@/components/mode-kit/recipes";
import { modeNameText, modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { FormField } from "@/components/ui/form-field";
import { announce } from "@/components/ui/live-announcer";
import { TextField } from "@/components/ui/text-field";
import { cn, fieldControlPlain } from "@/components/ui-primitives";
import {
  ON_CALL_CALL_LOG_FIELD_LIMITS,
  addOnCallCallLogEntry,
  onCallCallLogTime,
  onCallHandoverItems,
  onCallCallLogStorageKey,
  visibleOnCallCallLog,
  removeOnCallCallLogEntry,
  setOnCallCallLogDone,
  type OnCallCallLogDraft,
  type OnCallCallLogEntry,
} from "@/lib/on-call/call-log";
import { onCallDeviceStateChangedEvent, onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";
import {
  onCallHandoverCallsNotIn,
  onCallHandoverDraftFromCall,
  onCallHandoverStorageKey,
  saveOnCallHandoverPatient,
  visibleOnCallHandover,
} from "@/lib/on-call/handover";
import {
  PATIENT_LABEL_EXPIRY_STORAGE_KEY,
  PATIENT_LABELS_CLEARED_EVENT,
  startPatientLabelRetention,
} from "@/lib/patient-label-storage";

/*
 * The quick call log (`OnCallCallLogCard`), shown in Now's "Log a call" sheet.
 * It reads one store on this device (`src/lib/on-call/call-log.ts`) and never
 * talks to a server. Open to-dos go into the handover table on this phone.
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

/**
 * The raw stored string is the snapshot, so React re-renders only when the log
 * itself changes. Read directly rather than through `readPatientLabels`, which
 * may wipe and fire an event: not something to do during render. The auth
 * provider's watcher does the end-of-shift wipe, and its event re-renders this.
 */
const SNAPSHOT_SEPARATOR = "\u0000";

/** The log and the shift's expiry stamp, joined into one primitive snapshot. */
function readRaw(): string {
  try {
    const log = window.localStorage.getItem(onCallCallLogStorageKey) ?? "";
    const stamp = window.localStorage.getItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY) ?? "";
    return `${log}${SNAPSHOT_SEPARATOR}${stamp}`;
  } catch {
    return SNAPSHOT_SEPARATOR;
  }
}

export type OnCallCallLogView = {
  readonly entries: readonly OnCallCallLogEntry[];
  /** When this shift's notes are wiped (epoch ms), or null when there are none. */
  readonly expiresAt: number | null;
};

/**
 * The notes on screen, newest first, or null before the device has been read.
 * Empty the moment the shift's expiry passes, even before the watcher wipes.
 */
export function useOnCallCallLog(): OnCallCallLogView | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => undefined);
  // A minute tick lets notes disappear on screen at the end of the shift.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return useMemo(
    () => {
      if (raw === undefined) return null;
      const [log, stamp] = raw.split(SNAPSHOT_SEPARATOR);
      return visibleOnCallCallLog(log || null, stamp || null);
    },
    // `tick` re-reads the clock; `raw` re-reads the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, tick],
  );
}

const emptyDraft: OnCallCallLogDraft = { label: "", caller: "", note: "", followUp: "" };

function NoteArea({
  label,
  hint,
  placeholder,
  value,
  maxLength,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly value: string;
  readonly maxLength: number;
  readonly onChange: (value: string) => void;
  readonly testId: string;
}) {
  return (
    <FormField label={label} hint={hint}>
      {(field) => (
        <textarea
          id={field.id}
          aria-describedby={field.describedBy}
          aria-invalid={field.invalid || undefined}
          value={value}
          maxLength={maxLength}
          rows={2}
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

/** "Mon 08:00": when the shift's notes clear. */
function clockLabel(epochMs: number): string {
  const at = new Date(epochMs);
  const day = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "Australia/Perth" }).format(at);
  return `${day} ${onCallCallLogTime(at.toISOString())}`;
}

/** The roles most calls come from, as one-tap chips; "Other" opens a short field. */
export const ON_CALL_CALLER_CHIPS = ["Ward nurse", "Emergency dept", "Registrar", "GP"] as const;

/**
 * Log a call (mock-up v10, the sheet over Now): the same four short fields as
 * before, with "Who called" as chips so most calls need one tap and one line,
 * then tonight's calls and "Add the 1 to-do to the handover".
 */
export function OnCallCallLogCard() {
  const view = useOnCallCallLog();
  const entries = view?.entries ?? null;
  const [draft, setDraft] = useState<OnCallCallLogDraft>(emptyDraft);
  const [draftExpiresAt, setDraftExpiresAt] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [otherCaller, setOtherCaller] = useState(false);

  // A wipe (end of shift, sign-out, another user) also drops a half-typed note.
  useEffect(() => {
    const onCleared = () => {
      setDraft(emptyDraft);
      setDraftExpiresAt(null);
      setProblem(null);
      setSaved("");
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
  }, []);

  useEffect(() => {
    if (draftExpiresAt === null) return;
    const check = () => {
      if (Date.now() < draftExpiresAt) return;
      setDraft(emptyDraft);
      setDraftExpiresAt(null);
      setProblem(null);
      setSaved("");
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
  }, [draftExpiresAt]);

  const update = (key: keyof OnCallCallLogDraft) => (value: string) => {
    if (draftExpiresAt !== null && Date.now() >= draftExpiresAt) {
      setDraft(emptyDraft);
      setDraftExpiresAt(null);
      return;
    }
    if (value && draftExpiresAt === null) {
      const expiresAt = startPatientLabelRetention();
      if (expiresAt === null) {
        setProblem("The shift expiry could not be set. This note cannot be kept on this device.");
        return;
      }
      setDraftExpiresAt(expiresAt);
    }
    setDraft((current) => ({ ...current, [key]: value }));
    setProblem(null);
    setSaved("");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draftExpiresAt !== null && Date.now() >= draftExpiresAt) {
      setDraft(emptyDraft);
      setDraftExpiresAt(null);
      setProblem("The shift has ended. This draft was cleared.");
      return;
    }
    const result = addOnCallCallLogEntry(draft);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setDraft(emptyDraft);
    setDraftExpiresAt(null);
    setOtherCaller(false);
    const message = `Noted at ${onCallCallLogTime(result.entry.at)}.`;
    setSaved(message);
    announce(message);
  };

  const callerChoice = ON_CALL_CALLER_CHIPS.includes(draft.caller as (typeof ON_CALL_CALLER_CHIPS)[number])
    ? draft.caller
    : draft.caller || otherCaller
      ? "Other"
      : "";

  return (
    <section className="grid min-w-0 gap-4" aria-label="Log a call" data-testid="on-call-call-log">
      <form onSubmit={onSubmit} noValidate className="grid min-w-0 gap-3" data-testid="on-call-call-log-form">
        <fieldset className="grid min-w-0 gap-1">
          <legend className="text-sm font-medium text-[color:var(--text-heading)]">Who called</legend>
          <div className="flex min-w-0 flex-wrap gap-x-2" role="radiogroup" aria-label="Who called">
            {[...ON_CALL_CALLER_CHIPS, "Other" as const].map((chip) => (
              <button
                key={chip}
                type="button"
                role="radio"
                aria-checked={callerChoice === chip}
                onClick={() => {
                  if (chip === "Other") {
                    setOtherCaller(true);
                    if (ON_CALL_CALLER_CHIPS.includes(draft.caller as (typeof ON_CALL_CALLER_CHIPS)[number])) {
                      update("caller")("");
                    }
                  } else {
                    setOtherCaller(false);
                    update("caller")(chip);
                  }
                }}
                data-testid={`on-call-call-log-caller-${chip.toLowerCase().replace(/\s+/g, "-")}`}
                className={cn(onCallChipTap, focusRing, "rounded-md")}
              >
                <span className={onCallChipShape}>{chip}</span>
              </button>
            ))}
          </div>
          {callerChoice === "Other" ? (
            <TextField
              label="Who called, in a few words"
              hint="A role, for example ED registrar"
              value={draft.caller}
              maxLength={ON_CALL_CALL_LOG_FIELD_LIMITS.caller}
              onChange={(event) => update("caller")(event.target.value)}
              autoComplete="off"
              data-testid="on-call-call-log-caller"
            />
          ) : null}
        </fieldset>
        <TextField
          label="Bed or initials"
          placeholder="For example 4B-12 or JS"
          value={draft.label}
          maxLength={ON_CALL_CALL_LOG_FIELD_LIMITS.label}
          onChange={(event) => update("label")(event.target.value)}
          autoComplete="off"
          data-testid="on-call-call-log-label"
        />
        <NoteArea
          label="What happened"
          placeholder="One line is enough"
          value={draft.note}
          maxLength={ON_CALL_CALL_LOG_FIELD_LIMITS.note}
          onChange={update("note")}
          testId="on-call-call-log-note"
        />
        <NoteArea
          label="Still to do"
          placeholder="Leave empty if nothing is outstanding"
          value={draft.followUp}
          maxLength={ON_CALL_CALL_LOG_FIELD_LIMITS.followUp}
          onChange={update("followUp")}
          testId="on-call-call-log-follow-up"
        />
        {problem ? (
          <ModeNotice tone="warning" testId="on-call-call-log-problem">
            {problem}
          </ModeNotice>
        ) : null}
        <button
          type="submit"
          data-testid="on-call-call-log-save"
          className={cn(onCallFilledButton, focusRing, "w-full")}
        >
          Save to tonight&apos;s calls
        </button>
        <p role="status" className={cn(modeSecondaryText, "empty:hidden")}>
          {saved}
        </p>
      </form>
      {entries && entries.length > 0 ? (
        <OnCallGroupedList eyebrow="Tonight" count={entries.length} testId="on-call-call-log-list">
          {entries.map((entry) => (
            <CallLogRow key={entry.id} entry={entry} />
          ))}
        </OnCallGroupedList>
      ) : null}
      {entries && entries.length > 0 ? <AddToHandover entries={entries} /> : null}
      <p className={cn(modeSecondaryText, "text-xs")} data-testid="on-call-call-log-privacy">
        Saved on this phone only. Beds or initials, never names. Clears when your shift ends
        {view?.expiresAt ? ` (${clockLabel(view.expiresAt)})` : " (at most 12 hours after the first note)"} or you sign
        out.
      </p>
    </section>
  );
}

function CallLogRow({ entry }: { readonly entry: OnCallCallLogEntry }) {
  const who = [entry.caller, entry.label].filter(Boolean).join(" · ");
  const title = [onCallCallLogTime(entry.at), who].filter(Boolean).join(" · ");
  return (
    <li
      className={cn(modeInsetHairline, "flex min-w-0 items-start gap-3 py-2 pl-3 pr-1")}
      data-testid="on-call-call-log-row"
    >
      <span className={cn(modeNumberText, "w-11 shrink-0 pt-0.5 text-sm text-[color:var(--text-muted)]")}>
        {onCallCallLogTime(entry.at)}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn(modeNameText, "break-words", entry.done && "text-[color:var(--text-muted)]")}>
          {who || "Call"}
        </p>
        {entry.note ? <p className={cn(modeSecondaryText, "break-words")}>{entry.note}</p> : null}
        {entry.followUp && !entry.done ? (
          <p className="flex min-w-0 items-center gap-1.5 break-words text-sm text-[color:var(--text)]">
            <Circle
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-icon-xs shrink-0 text-[color:var(--text-muted)]"
            />
            To do: {entry.followUp}
          </p>
        ) : null}
        {entry.done ? (
          <p className={cn(modeSecondaryText, "flex items-center gap-1.5")}>
            <Check aria-hidden="true" strokeWidth={1.75} className="size-icon-xs shrink-0" />
            Done, left out of the handover
          </p>
        ) : null}
      </div>
      <ModeActionButton
        icon={entry.done ? RotateCcw : Check}
        label={entry.done ? `Put the ${title} call back in the handover` : `Mark the ${title} call done`}
        onClick={() => setOnCallCallLogDone(entry.id, !entry.done)}
        testId="on-call-call-log-done"
      />
      <ModeActionButton
        icon={Trash2}
        label={`Delete the ${title} note`}
        onClick={() => removeOnCallCallLogEntry(entry.id)}
        testId="on-call-call-log-delete"
      />
    </li>
  );
}

/** The handover's records on this phone, re-read when either store changes. */
function readHandoverRaw(): string {
  try {
    const list = window.localStorage.getItem(onCallHandoverStorageKey) ?? "";
    const stamp = window.localStorage.getItem(PATIENT_LABEL_EXPIRY_STORAGE_KEY) ?? "";
    return `${list}${SNAPSHOT_SEPARATOR}${stamp}`;
  } catch {
    return SNAPSHOT_SEPARATOR;
  }
}

/** Patients drafted in tonight's handover, or null before the device has been read. */
export function useOnCallHandoverDraftCount(): number | null {
  const raw = useSyncExternalStore(subscribe, readHandoverRaw, () => undefined);
  return useMemo(() => {
    if (raw === undefined) return null;
    const [list, stamp] = raw.split(SNAPSHOT_SEPARATOR);
    return visibleOnCallHandover(list || null, stamp || null).patients.length;
  }, [raw]);
}

/**
 * "Add the 1 to-do to the handover" (mock-up v10): every open call with
 * something still to do goes into the handover as a patient, so the day team
 * gets one handover, the table. A call already in it is not added twice. Nothing leaves the phone.
 */
function AddToHandover({ entries }: { readonly entries: readonly OnCallCallLogEntry[] }) {
  const handoverRaw = useSyncExternalStore(subscribe, readHandoverRaw, () => undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useMemo(() => {
    const [list, stamp] = (handoverRaw ?? SNAPSHOT_SEPARATOR).split(SNAPSHOT_SEPARATOR);
    const patients = visibleOnCallHandover(list || null, stamp || null).patients;
    // The handover's own rule for "already added", so the two screens agree.
    return onCallHandoverCallsNotIn(onCallHandoverItems(entries), patients).filter((entry) => entry.followUp);
  }, [entries, handoverRaw]);
  if (pending.length === 0) return null;
  const add = () => {
    for (const entry of pending) {
      const result = saveOnCallHandoverPatient(null, onCallHandoverDraftFromCall(entry));
      if (!result.ok) {
        setProblem(result.problem);
        return;
      }
    }
    setProblem(null);
    announce(pending.length === 1 ? "Added to the handover." : `${pending.length} added to the handover.`);
  };
  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={add}
        data-testid="on-call-call-log-add-to-handover"
        className={cn(onCallOutlineButton, focusRing, "w-full")}
      >
        {pending.length === 1 ? "Add the 1 to-do to the handover" : `Add the ${pending.length} to-dos to the handover`}
      </button>
      {problem ? (
        <ModeNotice tone="warning" testId="on-call-call-log-add-problem">
          {problem}
        </ModeNotice>
      ) : null}
    </div>
  );
}
