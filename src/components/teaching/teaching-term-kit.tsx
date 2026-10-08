"use client";

import { Plus, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { modeTapArea } from "@/components/mode-kit/recipes";
import { modeNumberText } from "@/components/mode-kit/type";
import { cn, textMuted } from "@/components/ui-primitives";
import { T5Note } from "@/components/teaching/t5-kit";
import { dayOfMonth, monthShort } from "@/lib/teaching/term-tracker";
import { checkPatientDetail, type PatientDetailProblem } from "@/lib/work-text/patient-detail-check";
import { KeptWhere } from "@/components/work-sync/kept-where";

/*
 * Small shared pieces for Teaching's Term and Exam prep pages: a calendar date tile, a segmented ring
 * against a real total, the "no patient details" mark, and a list you add to and remove from. Each is
 * drawn from tokens only, and reads the Teaching identity colour from the page's `data-mode-identity`.
 */

/** A small calendar tile: month above, day number below. */
export function TermDateTile({ date }: { date: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid w-12 shrink-0 overflow-hidden rounded-md border border-[color:var(--mode-identity-border)] bg-[color:var(--surface-raised)] text-center"
    >
      <span className="bg-[color:var(--mode-identity)] py-0.5 text-2xs font-medium tracking-wide text-[color:var(--mode-identity-contrast)] uppercase">
        {monthShort(date)}
      </span>
      <span className={cn(modeNumberText, "py-1 text-lg-minus text-[color:var(--text-heading)]")}>
        {dayOfMonth(date)}
      </span>
    </span>
  );
}

/**
 * A ring of `total` segments with `value` filled (an over-target count fills every segment). With no
 * total it draws one quiet track, so a count with no target never looks like a fraction of something.
 */
export function TermRing({
  value,
  total,
  children,
  label,
}: {
  value: number;
  total: number | null;
  children: ReactNode;
  label: string;
}) {
  const size = 96;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = total && total > 0 ? Math.min(total, 30) : 0;
  const gap = segments > 1 ? 4 : 0;
  const segment = segments > 0 ? circumference / segments - gap : circumference;
  return (
    <div role="img" aria-label={label} className="relative grid size-24 shrink-0 place-items-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        {segments > 0 ? (
          Array.from({ length: segments }, (_, index) => (
            <circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={`${segment} ${circumference - segment}`}
              strokeDashoffset={-index * (segment + gap)}
              className={
                index < Math.min(value, segments)
                  ? "stroke-[color:var(--mode-identity)]"
                  : "stroke-[color:var(--surface-inset)]"
              }
            />
          ))
        ) : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-[color:var(--surface-inset)]"
          />
        )}
      </svg>
      <span className="relative grid text-center leading-tight">{children}</span>
    </div>
  );
}

/** The quiet reminder beside every free-text field on these pages. */
export function NoPatientDetailsMark({ section }: { readonly section: "teachingTermTracker" | "teachingExamPrep" }) {
  return (
    <T5Note icon="shield" className="mt-3">
      Do not add patient details.{" "}
      <KeptWhere
        section={section}
        account="Backed up to your account."
        device="Stays on this device and is not backed up."
      />{" "}
      You choose what to share.
    </T5Note>
  );
}

/** Pips for a count: up to `max` dots, then "+n". */
export function TermPips({ count, max = 8 }: { count: number; max?: number }) {
  const shown = Math.min(count, max);
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {Array.from({ length: shown }, (_, index) => (
        <span key={index} className="inline-block size-2 rounded-full bg-[color:var(--mode-identity)]" />
      ))}
      {count === 0 ? (
        <span className="inline-block size-2 rounded-full border border-[color:var(--border-strong)]" />
      ) : null}
      {count > max ? <span className={cn(modeNumberText, "text-xs", textMuted)}>+{count - max}</span> : null}
    </span>
  );
}

/** A one-line add box: a text field and a round add button, inside its own form. */
export function TermAddItem({
  label,
  placeholder,
  onAdd,
  disabled,
}: {
  label: string;
  placeholder: string;
  onAdd: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<PatientDetailProblem | null>(null);
  const errorId = useId();
  return (
    <form
      className="grid gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const value = text.trim();
        if (!value) return;
        // What is added here is kept on the device and shown again, so the shared patient-detail check reads it.
        const found = checkPatientDetail(value, { allowCapitals: true });
        setProblem(found);
        if (found) return;
        onAdd(value);
        setText("");
      }}
    >
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{label}</span>
          <input
            type="text"
            value={text}
            maxLength={160}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? errorId : undefined}
            onChange={(event) => {
              setText(event.target.value);
              if (problem) setProblem(null);
            }}
            className={cn(
              "h-12 w-full rounded-md bg-[color:var(--surface-inset)] px-3 text-sm text-[color:var(--text-heading)] placeholder:text-[color:var(--text-muted)]",
              focusRing,
            )}
          />
        </label>
        <button type="submit" disabled={disabled} className={cn(modeTapArea, "rounded-full", focusRing)}>
          <span className="grid size-10 place-items-center rounded-md border border-[color:var(--border-strong)] text-[color:var(--text-heading)]">
            <Plus aria-hidden="true" className="size-icon-md" />
          </span>
          <span className="sr-only">{label}</span>
        </button>
      </div>
      {problem ? (
        <p id={errorId} role="alert" className="text-xs text-[color:var(--danger-text)]">
          {`${problem.title}. Take out the patient details to add it.`}
        </p>
      ) : null}
    </form>
  );
}

/** A small round remove button for a list row. */
export function TermRemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" onClick={onRemove} className={cn(modeTapArea, "rounded-full", focusRing)}>
      <X aria-hidden="true" className="size-icon-sm text-[color:var(--text-muted)]" />
      <span className="sr-only">{label}</span>
    </button>
  );
}
