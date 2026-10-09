"use client";

import { useState } from "react";

import { PatientDetailCatch } from "@/components/admin/junior/junior-shared";
import { focusRing } from "@/components/card-recipes";
import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { formatDateEcho } from "@/lib/admin/renewal-dates";
import {
  STARTER_DATE_KINDS,
  STARTER_NAME_LIMIT,
  STARTER_REMIND_CHOICES,
  starterDateHasErrors,
  validateStarterDate,
  type StarterDateInput,
  type StarterDateKind,
} from "@/lib/admin/starter-pack";

const chipClass = (on: boolean) =>
  cn(
    focusRing,
    "inline-flex min-h-12 items-center rounded-md border px-3 text-sm font-medium",
    on
      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
      : "border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]",
  );

const EMPTY: StarterDateInput = { kind: "visa-end", name: "", date: "", leadTimeDays: 90 };

/**
 * Add one of the doctor's own dates. A visa, registration or supervision date
 * is written as the Renewals row for that requirement, so it shows in
 * Renewals and on Admin Today without a second copy. Kinds already recorded
 * are greyed out with where to change them.
 */
export function StarterDateSheet({
  open,
  today,
  recordedKinds,
  onClose,
  onSave,
}: {
  open: boolean;
  today: string;
  /** Catalogue kinds already recorded; change those in Renewals instead. */
  recordedKinds: ReadonlySet<StarterDateKind>;
  onClose: () => void;
  /** Resolves to an error message, or null when saved. */
  onSave: (input: StarterDateInput) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<StarterDateInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const firstFree = STARTER_DATE_KINDS.find((info) => !recordedKinds.has(info.kind))?.kind ?? "other";
  if (open && draft === null) setDraft({ ...EMPTY, kind: firstFree });
  if (!open && draft !== null) {
    setDraft(null);
    setFailure(null);
  }
  const value = draft ?? EMPTY;
  const errors = validateStarterDate(value, today);
  const kindTaken = value.kind !== "other" && recordedKinds.has(value.kind);
  const canSave = Boolean(value.date) && !starterDateHasErrors(errors) && !kindTaken && !busy;
  const set = (patch: Partial<StarterDateInput>) => setDraft({ ...value, ...patch });

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setFailure(null);
    const result = await onSave(value);
    setBusy(false);
    if (result) setFailure(result);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a date"
      description="Type the date from your own letter or grant"
      testId="admin-starter-date-sheet"
      footer={
        <div className="grid gap-2">
          {failure ? <InlineNotice tone="neutral">{failure}</InlineNotice> : null}
          <Button
            variant="primary"
            block
            busy={busy}
            busyLabel="Saving"
            disabled={!canSave}
            onClick={() => void save()}
            testId="admin-starter-date-save"
          >
            Save
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-1.5">
          <p id="admin-starter-kind-label" className={eyebrowText}>
            Which date
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="admin-starter-kind-label">
            {STARTER_DATE_KINDS.map((info) => (
              <button
                key={info.kind}
                type="button"
                aria-pressed={value.kind === info.kind}
                onClick={() => set({ kind: info.kind })}
                className={chipClass(value.kind === info.kind)}
                data-testid={`admin-starter-kind-${info.kind}`}
              >
                {info.label}
              </button>
            ))}
          </div>
          {kindTaken ? (
            <p className={cn(textMuted, "text-sm")} data-testid="admin-starter-kind-taken">
              Already recorded. Change it from Your dates, so there is only one copy.
            </p>
          ) : null}
        </div>
        {value.kind === "other" ? (
          <TextField
            label="Name"
            placeholder="For example, visa condition review"
            value={value.name}
            maxLength={STARTER_NAME_LIMIT + 20}
            onChange={(event) => set({ name: event.target.value })}
            error={errors.name}
            data-testid="admin-starter-date-name"
          />
        ) : null}
        {errors.nameProblem ? (
          <PatientDetailCatch
            problem={errors.nameProblem}
            onUseSuggestion={(suggestion) => set({ name: suggestion })}
            testId="admin-starter-date-name-problem"
          />
        ) : null}
        <div className="grid gap-1">
          <TextField
            type="date"
            label="Date"
            value={value.date}
            min={today}
            required
            onChange={(event) => set({ date: event.target.value })}
            error={value.date ? errors.date : undefined}
            data-testid="admin-starter-date-date"
          />
          {value.date && !errors.date ? (
            <p className={cn(textMuted, "text-sm")} data-testid="admin-starter-date-echo">
              {formatDateEcho(value.date)}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <p id="admin-starter-remind-label" className={eyebrowText}>
            Show it on Admin Today from
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="admin-starter-remind-label">
            {STARTER_REMIND_CHOICES.map((choice) => (
              <button
                key={choice.days}
                type="button"
                aria-pressed={value.leadTimeDays === choice.days}
                onClick={() => set({ leadTimeDays: choice.days })}
                className={chipClass(value.leadTimeDays === choice.days)}
                data-testid={`admin-starter-remind-${choice.days}`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
        <p className={cn(textMuted, "text-xs")}>
          Your own date, kept in your account. PsychSift does not check it with anyone.
        </p>
      </form>
    </Sheet>
  );
}
