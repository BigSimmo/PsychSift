"use client";

import { AlertCircle, Minus, Moon, Plus, Sun, Sunset, type LucideIcon } from "lucide-react";
import { useCallback, useState } from "react";
import {
  checkOptimisticLock,
  ConcurrencyConflictError,
  emptySafeNumberGrid,
  SAFE_NUMBER_KINDS,
  SAFE_NUMBER_MAX,
  safeNumberGrid,
  sameSafeNumbers,
  setSafeNumber,
  type SafeNumberGrid,
  type SafeNumberKind,
} from "@/lib/on-call/cover";

const KIND_METADATA: Readonly<Record<SafeNumberKind, { label: string; icon: LucideIcon }>> = {
  day: { label: "Day", icon: Sun },
  evening: { label: "Evening (late)", icon: Sunset },
  night: { label: "Night", icon: Moon },
};

export type SafeNumberRecord = {
  readonly id?: string;
  readonly version?: number;
  readonly updatedAt?: string;
  readonly updated_at?: string;
  readonly grid?: SafeNumberGrid;
  readonly needs?: Parameters<typeof safeNumberGrid>[0];
};

export type SafeNumberEditorProps = {
  readonly serviceId?: string;
  readonly initialRecord?: SafeNumberRecord;
  readonly onSave?: (
    grid: SafeNumberGrid,
    lock: { version?: number; updatedAt?: string },
  ) => Promise<{ ok: boolean; version?: number; updatedAt?: string; error?: string }>;
  readonly onFetchLatest?: () => Promise<SafeNumberRecord>;
  readonly onSaved?: () => void;
  readonly disabled?: boolean;
};

export function SafeNumberEditor({
  initialRecord,
  onSave,
  onFetchLatest,
  onSaved,
  disabled = false,
}: SafeNumberEditorProps) {
  const initialGrid =
    initialRecord?.grid ?? (initialRecord?.needs ? safeNumberGrid(initialRecord.needs) : emptySafeNumberGrid());
  const [confirmed, setConfirmed] = useState<SafeNumberGrid>(initialGrid);
  const [draft, setDraft] = useState<SafeNumberGrid | null>(null);
  const [version, setVersion] = useState<number | undefined>(initialRecord?.version);
  const [updatedAt, setUpdatedAt] = useState<string | undefined>(initialRecord?.updatedAt ?? initialRecord?.updated_at);

  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const currentGrid = draft ?? confirmed;
  const isDirty = !sameSafeNumbers(currentGrid, confirmed);

  const handleStepperChange = useCallback(
    // Each row is the whole week (Monday to Sunday): the step applies to every weekday, so a
    // row never reads as "all days" while only Monday changes. Days that differ keep their
    // difference and each is clamped on its own.
    (kind: SafeNumberKind, delta: number) => {
      setSuccessMessage(null);
      setErrorMessage(null);
      setConflict(null);
      let next = currentGrid;
      currentGrid[kind].forEach((currentValue, index) => {
        const nextValue = Math.max(0, Math.min(SAFE_NUMBER_MAX, (currentValue ?? 0) + delta));
        next = setSafeNumber(next, kind, [index + 1], nextValue);
      });
      setDraft(next);
    },
    [currentGrid],
  );

  const handleRefresh = useCallback(async () => {
    if (!onFetchLatest) return;
    try {
      setSaving(true);
      const latest = await onFetchLatest();
      const latestGrid = latest.grid ?? (latest.needs ? safeNumberGrid(latest.needs) : emptySafeNumberGrid());
      setConfirmed(latestGrid);
      setDraft(null);
      setVersion(latest.version);
      setUpdatedAt(latest.updatedAt ?? latest.updated_at);
      setConflict(null);
      setErrorMessage(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to fetch latest record.");
    } finally {
      setSaving(false);
    }
  }, [onFetchLatest]);

  const handleSave = useCallback(async () => {
    if (saving || !isDirty) return;
    setSaving(true);
    setConflict(null);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      // If a fetch function is provided, verify optimistic lock before write
      if (onFetchLatest) {
        const fresh = await onFetchLatest();
        const lockCheck = checkOptimisticLock(
          {
            version: fresh.version,
            updatedAt: fresh.updatedAt ?? fresh.updated_at,
          },
          {
            expectedVersion: version,
            expectedUpdatedAt: updatedAt,
          },
        );

        if (lockCheck.conflict) {
          const reason =
            "The safe numbers were modified by another clinician. To avoid overwriting their changes, please refresh and review before saving.";
          setConflict(reason);
          setSaving(false);
          return;
        }
      }

      if (onSave) {
        const result = await onSave(currentGrid, { version, updatedAt });
        if (!result.ok) {
          if (result.error?.toLowerCase().includes("conflict")) {
            setConflict(
              "A concurrency conflict occurred. Another clinician updated the safe numbers. Please refresh and review.",
            );
          } else {
            setErrorMessage(result.error ?? "Failed to save safe numbers.");
          }
          setSaving(false);
          return;
        }

        // Successfully saved: update version and confirmed state
        if (result.version !== undefined) setVersion(result.version);
        if (result.updatedAt !== undefined) setUpdatedAt(result.updatedAt);
      }

      setConfirmed(currentGrid);
      setDraft(null);
      setSuccessMessage("Safe numbers saved successfully.");
      onSaved?.();
    } catch (err: unknown) {
      if (err instanceof ConcurrencyConflictError) {
        setConflict(err.message);
      } else {
        setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred while saving.");
      }
    } finally {
      setSaving(false);
    }
  }, [currentGrid, isDirty, onFetchLatest, onSave, onSaved, saving, updatedAt, version]);

  return (
    <div className="grid gap-4" data-testid="on-call-safe-number-editor">
      {conflict ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900"
          data-testid="safe-number-conflict-alert"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold text-red-800">Concurrency conflict detected</p>
            <p className="mt-1">{conflict}</p>
            {onFetchLatest ? (
              <button
                type="button"
                onClick={() => void handleRefresh()}
                className="mt-3 inline-flex items-center rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                data-testid="safe-number-refresh-button"
              >
                Refresh &amp; review changes
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="text-sm text-red-600" data-testid="safe-number-error-message">
          {errorMessage}
        </p>
      ) : null}

      {successMessage ? (
        <p role="status" className="text-sm text-green-700" data-testid="safe-number-status-message">
          {successMessage}
        </p>
      ) : null}

      <div className="grid gap-3">
        {SAFE_NUMBER_KINDS.map((kind) => {
          const meta = KIND_METADATA[kind];
          const Icon = meta.icon;
          const week = currentGrid[kind].map((value) => value ?? 0);
          const lowest = Math.min(...week);
          const highest = Math.max(...week);
          const weekLabel = lowest === highest ? String(lowest) : `${lowest}–${highest}`;

          return (
            <div
              key={kind}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
              data-testid={`safe-number-row-${kind}`}
            >
              <div className="flex items-center gap-3">
                <Icon className="size-5 text-gray-500" aria-hidden="true" />
                <span className="font-medium text-gray-800">{meta.label}</span>
                <span className="text-xs text-gray-500">Mon–Sun</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Decrease ${meta.label} on every day`}
                  disabled={disabled || saving || highest <= 0}
                  onClick={() => handleStepperChange(kind, -1)}
                  className="rounded-full border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                  data-testid={`stepper-minus-${kind}`}
                >
                  <Minus className="size-4" aria-hidden="true" />
                </button>
                <span
                  className="min-w-8 text-center text-sm font-semibold tabular-nums"
                  data-testid={`safe-number-value-${kind}`}
                >
                  {weekLabel}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${meta.label} on every day`}
                  disabled={disabled || saving || lowest >= SAFE_NUMBER_MAX}
                  onClick={() => handleStepperChange(kind, 1)}
                  className="rounded-full border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                  data-testid={`stepper-plus-${kind}`}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          disabled={disabled || saving || !isDirty}
          onClick={() => void handleSave()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          data-testid="safe-number-save-button"
        >
          {saving ? "Saving…" : "Save safe numbers"}
        </button>
      </div>
    </div>
  );
}

export { SafeNumberEditor as OnCallSafeNumberEditor };
