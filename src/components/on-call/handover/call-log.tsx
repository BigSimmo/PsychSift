"use client";

import { Check, Clipboard, ClipboardCheck, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { OnCallIsobarCard } from "@/components/on-call/call/isobar-card";
import { OnCallActionButton } from "@/components/on-call/kit/action-button";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { OnCallNotice } from "@/components/on-call/kit/notice";
import { onCallInsetHairline } from "@/components/on-call/kit/recipes";
import { onCallNameText, onCallSecondaryText } from "@/components/on-call/kit/type";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { announce } from "@/components/ui/live-announcer";
import { TextField } from "@/components/ui/text-field";
import { cn, eyebrowText, fieldControlPlain } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import {
  ON_CALL_CALL_LOG_FIELD_LIMITS,
  addOnCallCallLogEntry,
  clearOnCallCallLog,
  onCallCallLogTime,
  onCallHandoverItems,
  onCallHandoverText,
  onCallCallLogStorageKey,
  visibleOnCallCallLog,
  removeOnCallCallLogEntry,
  setOnCallCallLogDone,
  type OnCallCallLogDraft,
  type OnCallCallLogEntry,
} from "@/lib/on-call/call-log";
import { onCallDeviceStateChangedEvent, onCallDeviceStoreChangedEvent } from "@/lib/on-call/device-state-keys";
import { PATIENT_LABEL_EXPIRY_STORAGE_KEY, PATIENT_LABELS_CLEARED_EVENT } from "@/lib/patient-label-storage";

/*
 * Two pieces the Today layout can place on their own: the quick call log
 * (`OnCallCallLogCard`) and the handover builder (`OnCallHandoverBuilder`).
 * Both read one store on this device (`src/lib/on-call/call-log.ts`); neither
 * talks to a server. They sit on Call for now.
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
  value,
  maxLength,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly hint?: string;
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

function clockTime(epochMs: number): string {
  return onCallCallLogTime(new Date(epochMs).toISOString());
}

/** Quick call capture: a short note of each call, kept on this phone until the shift ends. */
export function OnCallCallLogCard() {
  const view = useOnCallCallLog();
  const entries = view?.entries ?? null;
  const [draft, setDraft] = useState<OnCallCallLogDraft>(emptyDraft);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState("");

  // A wipe (end of shift, sign-out, another user) also drops a half-typed note.
  useEffect(() => {
    const onCleared = () => {
      setDraft(emptyDraft);
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

  const update = (key: keyof OnCallCallLogDraft) => (value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setProblem(null);
    setSaved("");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = addOnCallCallLogEntry(draft);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setDraft(emptyDraft);
    const message = `Noted at ${onCallCallLogTime(result.entry.at)}.`;
    setSaved(message);
    announce(message);
  };

  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="on-call-call-log-heading" data-testid="on-call-call-log">
      <h2 id="on-call-call-log-heading" className={cn(eyebrowText, "px-3")}>
        Calls tonight
      </h2>
      <form
        onSubmit={onSubmit}
        noValidate
        className="grid min-w-0 gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3"
        data-testid="on-call-call-log-form"
      >
        <p className={onCallSecondaryText}>
          Kept on this phone only, and cleared when your shift ends
          {view?.expiresAt ? ` (at ${clockTime(view.expiresAt)})` : " (at most 12 hours after the first note)"} or you
          sign out. Identifiers stay on this phone and are never sent anywhere.
        </p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <TextField
            label="Bed or initials"
            hint="For example 4B-12 or JS"
            value={draft.label}
            maxLength={ON_CALL_CALL_LOG_FIELD_LIMITS.label}
            onChange={(event) => update("label")(event.target.value)}
            autoComplete="off"
            data-testid="on-call-call-log-label"
          />
          <TextField
            label="Who called"
            hint="A role, for example ED registrar"
            value={draft.caller}
            maxLength={ON_CALL_CALL_LOG_FIELD_LIMITS.caller}
            onChange={(event) => update("caller")(event.target.value)}
            autoComplete="off"
            data-testid="on-call-call-log-caller"
          />
        </div>
        <NoteArea
          label="What happened"
          value={draft.note}
          maxLength={ON_CALL_CALL_LOG_FIELD_LIMITS.note}
          onChange={update("note")}
          testId="on-call-call-log-note"
        />
        <NoteArea
          label="Still to do"
          hint="Leave empty if nothing is outstanding"
          value={draft.followUp}
          maxLength={ON_CALL_CALL_LOG_FIELD_LIMITS.followUp}
          onChange={update("followUp")}
          testId="on-call-call-log-follow-up"
        />
        {problem ? (
          <OnCallNotice tone="warning" testId="on-call-call-log-problem">
            {problem}
          </OnCallNotice>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" testId="on-call-call-log-save">
            Note this call
          </Button>
          <p className={onCallSecondaryText}>{saved}</p>
        </div>
      </form>
      {entries && entries.length > 0 ? (
        <OnCallGroupedList eyebrow="Noted" testId="on-call-call-log-list">
          {entries.map((entry) => (
            <CallLogRow key={entry.id} entry={entry} />
          ))}
        </OnCallGroupedList>
      ) : null}
    </section>
  );
}

function CallLogRow({ entry }: { readonly entry: OnCallCallLogEntry }) {
  const title = [onCallCallLogTime(entry.at), entry.label, entry.caller].filter(Boolean).join(" · ");
  return (
    <li
      className={cn(onCallInsetHairline, "flex min-w-0 items-start gap-2 px-3 py-2")}
      data-testid="on-call-call-log-row"
    >
      <div className="min-w-0 flex-1">
        <p className={cn(onCallNameText, "break-words", entry.done && "text-[color:var(--text-muted)]")}>{title}</p>
        {entry.note ? <p className={cn(onCallSecondaryText, "break-words")}>{entry.note}</p> : null}
        {entry.followUp ? (
          <p className={cn(onCallSecondaryText, "break-words", entry.done && "line-through")}>
            To do: {entry.followUp}
          </p>
        ) : null}
        {entry.done ? <p className={onCallSecondaryText}>Done, left out of the handover</p> : null}
      </div>
      <OnCallActionButton
        icon={entry.done ? RotateCcw : Check}
        label={entry.done ? `Put the ${title} call back in the handover` : `Mark the ${title} call done`}
        onClick={() => setOnCallCallLogDone(entry.id, !entry.done)}
        testId="on-call-call-log-done"
      />
      <OnCallActionButton
        icon={Trash2}
        label={`Delete the ${title} note`}
        onClick={() => removeOnCallCallLogEntry(entry.id)}
        testId="on-call-call-log-delete"
      />
    </li>
  );
}

type CopyState = "idle" | "copied" | "failed";

/**
 * The handover builder: every call note not marked done, oldest first, as
 * plain text to copy into the hospital's own handover.
 *
 * `withIsobarCard` places the existing "Calling a consultant" iSoBAR card above
 * the text, for a page that does not already show it (Call does). That card
 * renders nothing until its WA source is captured.
 */
export function OnCallHandoverBuilder({ withIsobarCard = false }: { readonly withIsobarCard?: boolean } = {}) {
  const entries = useOnCallCallLog()?.entries ?? null;
  const [copy, setCopy] = useState<CopyState>("idle");
  const [confirmClear, setConfirmClear] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const items = useMemo(() => onCallHandoverItems(entries ?? []), [entries]);
  const text = useMemo(() => onCallHandoverText(entries ?? []), [entries]);

  const copyHandover = useCallback(async () => {
    try {
      await copyTextToClipboard(text);
      setCopy("copied");
    } catch {
      setCopy("failed");
      announce("Not copied. Select the handover text and copy it by hand.");
    }
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopy("idle"), 4000);
  }, [text]);

  if (entries === null) return null;

  return (
    <section
      className="grid min-w-0 gap-3"
      aria-labelledby="on-call-handover-heading"
      data-testid="on-call-handover-builder"
    >
      <h2 id="on-call-handover-heading" className={cn(eyebrowText, "px-3")}>
        Handover
      </h2>
      {withIsobarCard ? <OnCallIsobarCard /> : null}
      {items.length === 0 ? (
        <p className={cn(onCallSecondaryText, "px-3")} data-testid="on-call-handover-empty">
          Nothing to hand over yet. Calls you note above, and have not marked done, will appear here.
        </p>
      ) : (
        <>
          <pre
            className="min-w-0 whitespace-pre-wrap break-words rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3 font-sans text-sm text-[color:var(--text)]"
            data-testid="on-call-handover-text"
          >
            {text}
          </pre>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              icon={copy === "copied" ? ClipboardCheck : Clipboard}
              onClick={() => void copyHandover()}
              testId="on-call-handover-copy"
            >
              {copy === "copied" ? "Copied" : "Copy handover"}
            </Button>
            <p className={onCallSecondaryText}>
              {copy === "failed" ? "Not copied. Select the text above and copy it by hand." : ""}
            </p>
          </div>
        </>
      )}
      {entries.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {confirmClear ? (
            <>
              <Button
                variant="danger"
                onClick={() => {
                  clearOnCallCallLog();
                  setConfirmClear(false);
                }}
                testId="on-call-handover-clear-confirm"
              >
                {entries.length === 1 ? "Clear the note" : `Clear all ${entries.length} notes`}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)} testId="on-call-handover-clear-cancel">
                Keep them
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              icon={Trash2}
              onClick={() => setConfirmClear(true)}
              testId="on-call-handover-clear"
            >
              Clear tonight&apos;s notes
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
