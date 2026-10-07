"use client";

import { CloudOff, Lock, TriangleAlert, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
import { useSignedOutSample } from "@/components/mode-kit/use-signed-out-sample";
import { WorkButton } from "@/components/mode-kit/work";
import { useOptionalToast } from "@/components/ui/toast";
import { cn, fieldControlPlain, fieldLabel } from "@/components/ui-primitives";
import { adminLoadState, selectAdminOwnEntries, type AdminLoadState } from "@/lib/admin/own-entries";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { useOnCallEntries, type OnCallEntriesState } from "@/lib/on-call/entry-store";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { markRealRecordAdded, reportAreaData, useExampleData } from "@/lib/example-data/store";
import { useOnlineStatus } from "@/lib/use-online-status";
import { emptyPaperwork, type AdminPaperwork } from "@/lib/work-screens/admin/paperwork-model";
import { adminPatientProblem, type AdminPatientProblem } from "@/lib/work-screens/admin/patient-check";
import type { PatientDetailCheckOptions } from "@/lib/work-text/patient-detail-check";
import {
  forgetAdminPaperworkOnDevice,
  useAdminPaperwork,
  type AdminPaperworkStore,
} from "@/lib/work-screens/admin/paperwork-store";

/** What the page says when an example record would be copied, sent or saved to a file. */
export const EXAMPLE_NOT_SENT = "This is an example, so nothing was copied, sent or saved. Sign in to use your own.";

/** Ten seconds to change your mind, Admin's standard for a reversible change. */
export const PAPERWORK_UNDO_MS = 10_000;

export interface PaperworkPage {
  /** Admin's own read of the personal entries store, for pages that show compliance rows. */
  readonly entries: OnCallEntriesState;
  readonly own: readonly OnCallEntry[];
  readonly entriesState: AdminLoadState;
  /** Signed out (or session ended): the page keeps nothing, and shows example records if they are on. */
  readonly signedOut: boolean;
  /** The local demo build: example records, nothing saved. */
  readonly demo: boolean;
  /**
   * True while Admin's example data switch is on for this page's records (signed out, or the demo
   * build). Exports, copies and sends then go through `guardExampleAction`, which opens the example
   * data banner's "turn it off" sheet.
   */
  readonly examplesShown: boolean;
  readonly online: boolean;
  readonly store: AdminPaperworkStore;
}

/** The registry datasets that fill Admin's own-paperwork pages with example records. */
export type AdminPaperworkDatasetKey =
  "admin.requests" | "admin.sharing" | "admin.documents" | "admin.pay" | "admin.tax";

/** Any record at all, so the page can tell the example data switch that Admin holds real data. */
function holdsRecords(record: AdminPaperwork): boolean {
  return (
    record.requests.length > 0 ||
    record.documents.length > 0 ||
    record.payslips.length > 0 ||
    record.sharing.log.length > 0 ||
    Object.values(record.tax).some((year) => year.expenses.length > 0)
  );
}

/**
 * The one wiring every own-paperwork page shares: the entries read, the
 * example records, the online hint, and the device record. Signed in, the
 * page always shows the doctor's own device record. Signed out (or in the
 * demo build) it keeps everything in page memory: the registry's example
 * records while Admin's example data is on, else an empty record. A
 * signed-out session removes the device record, so a shared computer never
 * shows the last doctor's paperwork.
 */
export function usePaperworkPage(dataset: AdminPaperworkDatasetKey): PaperworkPage {
  const entries = useOnCallEntries();
  const signedOutSample = useSignedOutSample();
  const signedOut = signedOutSample || entries.signedOut;
  const demo = entries.demoMode;
  const exampleActive = useExampleData("admin").active;
  const inMemory = signedOut || demo;
  const wantsExamples = demo || (signedOut && exampleActive);
  const examples = useRegistryDataset(dataset, wantsExamples);
  const empty = useMemo(() => emptyPaperwork(), []);
  // Examples that did not load (a file not downloaded offline) fall back to an empty page memory.
  const memoryRecord = !inMemory
    ? null
    : !wantsExamples || examples.status === "error"
      ? empty
      : examples.status === "ready"
        ? examples.data
        : null;
  // Keyed on the record, so the switch turning on or off starts the page's memory again.
  const store = useAdminPaperwork(memoryRecord, inMemory && memoryRecord === null);
  const online = useOnlineStatus();
  const own = useMemo(() => selectAdminOwnEntries(entries), [entries]);
  useEffect(() => {
    if (signedOut) forgetAdminPaperworkOnDevice();
  }, [signedOut]);
  const realRecords = !store.sample && store.state !== null && holdsRecords(store.state);
  useEffect(() => {
    // Only "has data" is reported: an empty paperwork record says nothing about Admin's renewals.
    if (realRecords) reportAreaData("admin", "has-data");
  }, [realRecords]);
  const realUpdate = store.update;
  const update = useCallback(
    (change: (current: AdminPaperwork) => AdminPaperwork): boolean => {
      const ok = realUpdate(change);
      if (ok && !store.sample) markRealRecordAdded("admin");
      return ok;
    },
    [realUpdate, store.sample],
  );
  const wrapped = useMemo(() => ({ ...store, update }), [store, update]);
  return {
    entries,
    own,
    entriesState: adminLoadState(entries),
    signedOut,
    demo,
    examplesShown: wantsExamples && exampleActive,
    online,
    store: wrapped,
  };
}

/** Sets the band's title and eyebrow for a page the work frame does not list yet. */
export function usePaperworkHeading(title: string, eyebrow?: string) {
  useModeBandHeading({ title, eyebrow });
}

/** A short toast with Undo. Falls back to nothing outside a toast provider (unit tests render without one). */
export function usePaperworkSay() {
  const toast = useOptionalToast();
  return (title: string, undo?: () => void, tone: "success" | "warning" = "success") => {
    toast?.push({
      tone,
      title,
      duration: undo ? PAPERWORK_UNDO_MS : undefined,
      action: undo ? { label: "Undo", onAction: undo } : undefined,
    });
  };
}

/* ------------------------------------------------------------ notices */

/**
 * The signed-out box above a page. The example data banner labels example records, so this says only
 * what is kept and where.
 */
export function PaperworkSampleNotice({
  what,
  testId,
  examples,
}: {
  readonly what: string;
  readonly testId: string;
  /** Whether example records show below. */
  readonly examples: boolean;
}) {
  return (
    <SignedOutSampleNotice title={`Sign in to keep your ${what}`} testId={testId}>
      {examples
        ? "You can try every control on the examples below and nothing is saved."
        : "Nothing is kept while you are signed out."}{" "}
      Signed in, your own records are kept on this phone for your account only.
    </SignedOutSampleNotice>
  );
}

/** The demo build's line: example records only. */
export function PaperworkDemoNotice({ testId }: { readonly testId: string }) {
  return (
    <p role="status" data-testid={testId} className="text-sm text-[color:var(--text-muted)]">
      Demo data. These are invented examples and nothing you change is kept.
    </p>
  );
}

/** Offline: what still works, in one line. */
export function PaperworkOfflineNote({ children, testId }: { readonly children: ReactNode; readonly testId: string }) {
  return (
    <div role="status" data-testid={testId} className="work-card work-card--pad flex items-start gap-2 text-sm">
      <CloudOff aria-hidden="true" strokeWidth={2} className="mt-0.5 size-icon-sm shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** A centred footnote with a lock: where the record lives. */
export function PaperworkFootNote({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <p
      data-testid={testId}
      className="flex items-start justify-center gap-1.5 px-2 text-center text-xs leading-5 text-[color:var(--text-muted)]"
    >
      <Lock aria-hidden="true" strokeWidth={2} className="mt-0.5 size-icon-xs shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A change that would not read back (too long, or a field out of range): nothing was saved. */
export function PaperworkUnsavedNote({ testId }: { readonly testId: string }) {
  return (
    <p role="alert" data-testid={testId} className="text-sm text-[color:var(--text)]">
      That change could not be saved. Check what you typed and try again.
    </p>
  );
}

/** The browser refused to save (storage blocked or full): changes last until the page is closed. */
export function PaperworkStorageNote({
  store,
  testId,
}: {
  readonly store: AdminPaperworkStore;
  readonly testId: string;
}) {
  if (!store.unsaved) return null;
  return (
    <p role="alert" data-testid={testId} className="text-sm text-[color:var(--text)]">
      This phone would not save your changes, so they last only until you close this page. Free some space or allow site
      storage, then try again.
    </p>
  );
}

/** A flat 48 px icon button for a row action. Glass is for floating controls only. */
export function PaperworkIconButton({
  icon: Icon,
  label,
  onClick,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onClick: () => void;
  readonly testId: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        focusRing,
        "inline-grid size-12 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)]",
      )}
    >
      <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={2} />
    </button>
  );
}

/**
 * Runs an async action once at a time, so a double tap on Copy copies once,
 * marks sent once and shows one toast.
 */
export function useSingleFlight() {
  const busy = useRef(false);
  return useCallback(async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await action();
    } finally {
      busy.current = false;
    }
  }, []);
}

/* ----------------------------------------------------------- controls */

/** A flat on and off switch in the area colour, with a 48 px tap target. */
export function PaperworkSwitch({
  on,
  label,
  onToggle,
  testId,
  disabled,
}: {
  readonly on: boolean;
  readonly label: string;
  readonly onToggle: () => void;
  readonly testId: string;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={disabled ? "true" : undefined}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      data-testid={testId}
      className={cn(
        focusRing,
        "inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full",
        disabled && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-10 items-center rounded-full border transition-colors duration-[var(--duration-instant)] motion-reduce:transition-none",
          on
            ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)]"
            : "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]",
        )}
      >
        <span
          className={cn(
            "absolute size-5 rounded-full bg-[color:var(--surface-raised)] transition-[left] duration-[var(--duration-instant)] motion-reduce:transition-none",
            on ? "left-[1.0625rem]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

/** Scrolls a focused field into view once the phone keyboard has opened. */
function keepInView(event: { currentTarget: HTMLElement }) {
  const target = event.currentTarget;
  window.setTimeout(() => {
    try {
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
      target.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    } catch {
      // Older engines: the browser's own scroll is enough.
    }
  }, 250);
}

/** The patient-detail catch: what looks wrong, a safer wording, one tap to use it. */
export function PatientDetailWarning({
  problem,
  onUse,
  testId,
}: {
  readonly problem: AdminPatientProblem;
  readonly onUse?: (text: string) => void;
  readonly testId: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex min-w-0 items-start gap-2 rounded-[var(--work-radius-field)] border border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] p-3"
    >
      <TriangleAlert aria-hidden="true" strokeWidth={2} className="mt-0.5 size-icon-sm shrink-0" />
      <span className="grid min-w-0 gap-1 text-sm">
        <span className="font-semibold text-[color:var(--text-heading)]">{problem.title}</span>
        <span>
          {problem.body}
          {problem.suggestion ? ` Try “${problem.suggestion}”.` : null}
        </span>
        {problem.suggestion && onUse ? (
          <span>
            <WorkButton variant="secondary" onClick={() => onUse(problem.suggestion!)}>
              Use this wording
            </WorkButton>
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Patient details never belong in Admin's free text. */
export function patientProblem(text: string, options?: PatientDetailCheckOptions): AdminPatientProblem | null {
  return adminPatientProblem(text, options);
}

/** A colleague's or team's name is wanted in a "To" field, so names and service capitals are allowed there. */
export const RECIPIENT_CHECK: PatientDetailCheckOptions = { allowName: true, allowCapitals: true };

export function PaperworkField({
  label,
  value,
  onChange,
  type = "text",
  inputMode,
  maxLength,
  hint,
  error,
  checkPatient = false,
  multiline = false,
  testId,
  autoComplete = "off",
  min,
  max,
  step,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: "text" | "date" | "number" | "email" | "url";
  readonly inputMode?: "decimal" | "numeric" | "email" | "url" | "text";
  readonly maxLength?: number;
  readonly hint?: string;
  readonly error?: string | null;
  readonly checkPatient?: boolean | PatientDetailCheckOptions;
  readonly multiline?: boolean;
  readonly testId: string;
  readonly autoComplete?: string;
  readonly min?: string;
  readonly max?: string;
  readonly step?: string;
}) {
  const id = useId();
  const problem = checkPatient
    ? patientProblem(value, checkPatient === true ? { allowCapitals: true } : checkPatient)
    : null;
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const shared = {
    id,
    value,
    maxLength,
    "aria-invalid": error || problem ? true : undefined,
    "aria-describedby": described,
    "data-testid": testId,
    onFocus: keepInView,
    autoComplete,
  } as const;
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...shared}
          rows={4}
          onChange={(event) => onChange(event.target.value)}
          className={cn(fieldControlPlain, "min-h-24 py-2.5 leading-6")}
        />
      ) : (
        <input
          {...shared}
          type={type}
          inputMode={inputMode}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
          className={cn(fieldControlPlain, "min-h-12")}
        />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-[color:var(--text-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-[color:var(--text)]">
          {error}
        </p>
      ) : null}
      {problem ? <PatientDetailWarning problem={problem} onUse={onChange} testId={`${testId}-patient`} /> : null}
    </div>
  );
}

/** Whether any of these texts would trip the patient-detail catch. */
export function anyPatientProblem(...texts: readonly string[]): boolean {
  return texts.some((text) => patientProblem(text, { allowCapitals: true }) !== null);
}

/** The same, for a recipient's name. */
export function recipientProblem(text: string): boolean {
  return patientProblem(text, RECIPIENT_CHECK) !== null;
}
