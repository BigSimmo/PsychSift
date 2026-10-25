"use client";

import { AlertTriangle, Check, CheckCheck, ClipboardCopy, RotateCcw, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/components/ui-primitives";

import type { CalculatorFixture, CalculatorItem, CalculatorTone, ScoreBand } from "./calculator-fixtures";

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

/*
 * Answers hold the raw selection, not points:
 *   checkbox items — 1 ("Yes"), 0 ("No"), or undefined (not yet answered)
 *   options items  — the selected option index, or undefined
 * Points are always derived from the fixture so zero-point criterion items
 * (e.g. MDQ co-occurrence / impairment) still record their state.
 */
export type AnswerMap = Record<string, number | undefined>;

/**
 * Whether a raw answer is a response this item can actually carry.
 * Mirrors production `calculator-ui` so an out-of-range option index cannot
 * count as answered, score as 0, and publish a confident band on the mockup route.
 */
export function isValidAnswer(item: CalculatorItem, selection: number | undefined): boolean {
  if (selection === undefined) return true;
  if (typeof selection !== "number" || !Number.isInteger(selection)) return false;
  if (item.kind === "checkbox") return selection === 0 || selection === 1;
  const options = item.options ?? [];
  return selection >= 0 && selection < options.length;
}

export function itemScore(item: CalculatorItem, selection: number | undefined): number {
  if (selection === undefined) return 0;
  if (!isValidAnswer(item, selection)) return 0;
  if (item.kind === "checkbox") return selection === 1 ? (item.points ?? 0) : 0;
  return item.options?.[selection]?.points ?? 0;
}

/** True for scales whose every item is a yes/no checkbox (CAGE, SAD PERSONS). */
export function isCheckboxOnly(calc: CalculatorFixture): boolean {
  return calc.items.length > 0 && calc.items.every((item) => item.kind === "checkbox");
}

/**
 * Seed every unset checkbox item to an explicit 0 ("No"). Invoked by the
 * "Mark remaining as No" affordance — never on mount — so an all-negative
 * CAGE/SAD PERSONS screen reads as a valid 0 result (started + complete) only
 * once the user chooses to record it, not merely by opening the scale.
 */
export function seedCheckboxDefaults(calc: CalculatorFixture, answers: AnswerMap): AnswerMap {
  if (!isCheckboxOnly(calc)) return answers;
  if (calc.items.every((item) => answers[item.id] !== undefined)) return answers;
  const next: AnswerMap = { ...answers };
  for (const item of calc.items) {
    if (next[item.id] === undefined) next[item.id] = 0;
  }
  return next;
}

export type CalculatorResult = {
  label: string;
  tone: CalculatorTone;
  guidance: string;
};

export type CalculatorState = {
  answers: AnswerMap;
  score: number;
  /** Options-style items answered so far. */
  answeredCount: number;
  optionItemCount: number;
  /** Checkbox-style items currently ticked. */
  checkedCount: number;
  checkboxItemCount: number;
  checkboxAnsweredCount: number;
  /** Item ids whose recorded answer is not a response the item can carry. */
  invalidItemIds: string[];
  /** True when any answer is malformed, or the map carries an id this instrument has no item for. */
  invalid: boolean;
  complete: boolean;
  started: boolean;
  band: ScoreBand | undefined;
  result: CalculatorResult;
  flags: string[];
  toggleCheckbox: (itemId: string) => void;
  selectOption: (itemId: string, optionIndex: number) => void;
  reset: () => void;
};

function bandForScore(calc: CalculatorFixture, score: number): ScoreBand | undefined {
  return calc.bands.find((band) => score >= band.min && score <= band.max);
}

function mdqResult(answers: AnswerMap, symptomScore: number): CalculatorResult {
  const symptomsMet = symptomScore >= 7;
  const coOccurrence = answers.mco === 1;
  const impairIndex = answers.mimp;
  const impairmentMet = impairIndex !== undefined && impairIndex >= 2;

  if (symptomsMet && coOccurrence && impairmentMet) {
    return {
      label: "Positive screen",
      tone: "danger",
      guidance:
        "All three criteria met — proceed to a structured bipolar-disorder assessment before treatment changes.",
    };
  }
  if (symptomsMet) {
    const missing = [!coOccurrence ? "co-occurrence" : null, !impairmentMet ? "moderate-or-serious impairment" : null]
      .filter(Boolean)
      .join(" and ");
    return {
      label: "Symptom threshold met",
      tone: "warning",
      guidance: `≥7 symptoms endorsed but ${missing} not confirmed — complete the remaining criteria.`,
    };
  }
  return {
    label: "Negative screen",
    tone: "success",
    guidance: "Below the 7-symptom threshold. Rescreen if the history changes.",
  };
}

export type DerivedCalculator = Omit<CalculatorState, "answers" | "toggleCheckbox" | "selectOption" | "reset">;

/** Pure scoring/interpretation over an answer map — shared by every mockup. */
export function deriveCalculator(calc: CalculatorFixture, answers: AnswerMap): DerivedCalculator {
  const optionItems = calc.items.filter((item) => item.kind === "options");
  const checkboxItems = calc.items.filter((item) => item.kind === "checkbox");
  const isAnswered = (item: CalculatorItem) => answers[item.id] !== undefined && isValidAnswer(item, answers[item.id]);
  const invalidItemIds = calc.items.filter((item) => !isValidAnswer(item, answers[item.id])).map((item) => item.id);
  const itemIds = new Set(calc.items.map((item) => item.id));
  const unknownIds = Object.keys(answers).filter((id) => answers[id] !== undefined && !itemIds.has(id));
  const invalid = invalidItemIds.length > 0 || unknownIds.length > 0;

  const score = calc.items.reduce((sum, item) => sum + itemScore(item, answers[item.id]), 0);
  const answeredCount = optionItems.filter(isAnswered).length;
  const checkedCount = checkboxItems.filter((item) => isAnswered(item) && answers[item.id] === 1).length;
  const checkboxAnsweredCount = checkboxItems.filter(isAnswered).length;
  // A malformed response must never complete an instrument: a zero-scoring fallback
  // would otherwise publish a final band off values the instrument cannot carry.
  const complete = !invalid && calc.items.every(isAnswered);
  const started = invalid || calc.items.some(isAnswered);
  // Only publish a severity band for a complete, valid reading — never for OOR/malformed answers.
  const band = complete ? bandForScore(calc, score) : undefined;
  const flags = calc.items
    .filter((item) => item.flag && isValidAnswer(item, answers[item.id]) && itemScore(item, answers[item.id]) > 0)
    .map((item) => item.flag as string);

  const result: CalculatorResult = invalid
    ? {
        label: "Invalid entry",
        tone: "warning",
        guidance:
          "One or more responses are not valid for this instrument. Clear and re-enter them before interpreting a result.",
      }
    : !complete
      ? {
          label: "Incomplete",
          tone: "info",
          guidance: "Answer every item before interpreting this result.",
        }
      : calc.id === "mdq"
        ? mdqResult(answers, score)
        : {
            label: band?.label ?? "—",
            tone: band?.tone ?? "info",
            guidance: band?.guidance ?? "",
          };

  return {
    score,
    answeredCount,
    optionItemCount: optionItems.length,
    checkedCount,
    checkboxItemCount: checkboxItems.length,
    checkboxAnsweredCount,
    invalidItemIds,
    invalid,
    complete,
    started,
    band,
    result,
    flags,
  };
}

export function toggleCheckboxAnswer(answers: AnswerMap, itemId: string): AnswerMap {
  // Toggle between explicit 1 ("Yes") and 0 ("No") rather than clearing to
  // undefined, so an unticked box stays a recorded negative answer.
  return { ...answers, [itemId]: answers[itemId] === 1 ? 0 : 1 };
}

export function selectOptionAnswer(answers: AnswerMap, itemId: string, optionIndex: number): AnswerMap {
  return { ...answers, [itemId]: answers[itemId] === optionIndex ? undefined : optionIndex };
}

/* ---------- tone styling ---------- */

export const toneChip: Record<CalculatorTone, string> = {
  success: "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]",
  info: "border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-[color:var(--info)]",
  warning: "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
  danger: "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
};

export const toneBar: Record<CalculatorTone, string> = {
  success: "bg-[color:var(--success)]",
  info: "bg-[color:var(--info)]",
  warning: "bg-[color:var(--warning)]",
  danger: "bg-[color:var(--danger)]",
};

export function SeverityPill({ tone, label, className }: { tone: CalculatorTone; label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-md border px-2 text-2xs font-bold leading-4",
        toneChip[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Horizontal severity spectrum: one segment per band (width proportional to
 * its score range) with a marker at the current score.
 */
export function ScoreBandBar({
  calc,
  score,
  started,
  className,
}: {
  calc: CalculatorFixture;
  score: number;
  started: boolean;
  className?: string;
}) {
  const span = calc.maxScore - calc.minScore || 1;
  const fraction = Math.min(1, Math.max(0, (score - calc.minScore) / span));

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="relative flex h-2 overflow-hidden rounded-full border border-[color:var(--border)]">
        {calc.bands.map((band) => (
          <div
            key={`${band.min}-${band.label}`}
            className={cn(toneBar[band.tone], started ? "opacity-70" : "opacity-30")}
            style={{ width: `${((band.max - band.min + 1) / (span + 1)) * 100}%` }}
          />
        ))}
        {started ? (
          <div
            aria-hidden="true"
            className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--text-heading)] shadow-[var(--e1)]"
            style={{ left: `${fraction * 100}%` }}
          />
        ) : null}
      </div>
      <div className="flex justify-between text-3xs font-semibold leading-3 text-[color:var(--text-soft)]">
        <span>{calc.minScore}</span>
        <span>{calc.maxScore}</span>
      </div>
    </div>
  );
}

export function BandLegend({ calc, activeBand }: { calc: CalculatorFixture; activeBand?: ScoreBand }) {
  return (
    <ul className="grid gap-1">
      {calc.bands.map((band) => {
        const active = activeBand === band;
        return (
          <li
            key={`${band.min}-${band.label}`}
            className={cn(
              "grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1",
              active && "bg-[color:var(--surface-inset)]",
            )}
          >
            <span aria-hidden="true" className={cn("inline-block h-2 w-2 shrink-0 rounded-full", toneBar[band.tone])} />
            <span className="font-mono text-2xs font-bold tabular-nums leading-4 text-[color:var(--text-muted)]">
              {band.min}–{band.max}
            </span>
            <span
              className={cn(
                "truncate text-2xs font-semibold leading-4",
                active ? "text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
              )}
            >
              {band.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- interactive item controls ---------- */

export function CheckboxRow({
  item,
  checked,
  onToggle,
  index,
  dense = false,
}: {
  item: CalculatorItem;
  checked: boolean;
  onToggle: () => void;
  index?: number;
  dense?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "grid w-full min-h-tap grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border px-3 text-left transition",
        dense ? "py-2" : "py-2.5",
        checked
          ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]"
          : "border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)]",
        focusRing,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition before:absolute before:-inset-2 before:content-['']",
          checked
            ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
            : "border-[color:var(--border-strong)] bg-[color:var(--surface)]",
        )}
      >
        {checked ? <Check className="size-icon-sm" aria-hidden="true" /> : null}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block font-semibold leading-5 text-[color:var(--text-heading)]",
            dense ? "text-sm-minus" : "text-sm",
          )}
        >
          {index !== undefined ? (
            <span className="mr-1.5 font-mono text-2xs font-bold tabular-nums text-[color:var(--text-soft)]">
              {index}.
            </span>
          ) : null}
          {item.text}
        </span>
        {item.detail ? (
          <span className="mt-0.5 block text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
            {item.detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function OptionScale({
  item,
  value,
  onSelect,
  layout = "row",
}: {
  item: CalculatorItem;
  value: number | undefined;
  onSelect: (optionIndex: number) => void;
  /** row = compact single line of numbered chips; stack = full-label buttons. */
  layout?: "row" | "stack";
}) {
  const options = item.options ?? [];
  const showPoints = options.some((option) => option.points !== 0);

  if (layout === "stack") {
    return (
      <div role="group" aria-label={item.text} className="grid gap-2">
        {options.map((option, optionIndex) => {
          const active = value === optionIndex;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(optionIndex)}
              className={cn(
                "grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-3 text-left text-sm font-semibold transition",
                active
                  ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)]",
                focusRing,
              )}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {showPoints ? (
                <span
                  className={cn(
                    "font-mono text-2xs font-bold tabular-nums",
                    active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-soft)]",
                  )}
                >
                  {option.points}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="group" aria-label={item.text} className="flex flex-wrap gap-1.5">
      {options.map((option, optionIndex) => {
        const active = value === optionIndex;
        return (
          <button
            key={option.label}
            type="button"
            aria-pressed={active}
            aria-label={`${option.label} (${option.points} ${option.points === 1 ? "point" : "points"})`}
            title={option.label}
            onClick={() => onSelect(optionIndex)}
            className={cn(
              "inline-flex min-h-tap min-w-tap items-center justify-center rounded-lg border px-2.5 text-sm-minus font-bold transition",
              active
                ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)]"
                : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
              focusRing,
            )}
          >
            {option.short}
          </button>
        );
      })}
    </div>
  );
}

export function FlagNotice({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <div
      role="alert"
      className="grid gap-2 rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] p-3"
    >
      {flags.map((flag) => (
        <p
          key={flag}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-sm-minus font-bold leading-5 text-[color:var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 size-icon-md shrink-0" aria-hidden="true" />
          {flag}
        </p>
      ))}
    </div>
  );
}

export function ResetButton({ onReset, disabled }: { onReset: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm-minus font-bold text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] disabled:pointer-events-none disabled:opacity-40",
        focusRing,
      )}
    >
      <RotateCcw className="size-icon-sm" aria-hidden="true" />
      Clear
    </button>
  );
}

export function progressLabel(state: DerivedCalculator): string {
  if (state.optionItemCount === 0) return `${state.checkedCount} of ${state.checkboxItemCount} endorsed`;
  const answered = `${state.answeredCount} of ${state.optionItemCount} answered`;
  return state.checkboxItemCount > 0 ? `${answered} · ${state.checkedCount} endorsed` : answered;
}

/** Compact metadata chip: item count, time estimate, score range. */
export function MetaPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex min-h-6 items-center gap-1 rounded-md bg-[color:var(--surface-subtle)] px-2 text-2xs font-bold text-[color:var(--text-muted)]">
      <Icon className="size-icon-xs" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Copy-to-clipboard button with its own "Copied" feedback state. */
export function CopyResultButton({
  calc,
  state,
  label = "Copy result",
  className,
}: {
  calc: CalculatorFixture;
  state: DerivedCalculator;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatResultSummary(calc, state));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable in some embeds — mockup-safe no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!state.started}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-2xs font-bold text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] disabled:pointer-events-none disabled:opacity-40",
        focusRing,
        className,
      )}
    >
      {copied ? (
        <CheckCheck className="size-icon-sm text-[color:var(--success)]" aria-hidden="true" />
      ) : (
        <ClipboardCopy className="size-icon-sm" aria-hidden="true" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

/** One-line result summary used by every copy-to-clipboard affordance. */
export function formatResultSummary(calc: CalculatorFixture, state: DerivedCalculator): string {
  if (state.invalid) {
    return `${calc.abbrev} — ${state.result.label}`;
  }
  return `${calc.abbrev} ${state.score}/${calc.maxScore} — ${state.result.label}${
    state.complete ? "" : ` (${progressLabel(state)})`
  }`;
}

/**
 * The single option set shared by every options item, or null when items
 * carry bespoke option sets (then items render stacked full labels instead
 * of numbered chips plus one response key).
 */
export function sharedOptionKey(calc: CalculatorFixture) {
  const optionItems = calc.items.filter((item) => item.kind === "options");
  if (optionItems.length < 2) return null;
  const first = optionItems[0].options;
  return optionItems.every((item) => item.options === first) ? (first ?? null) : null;
}

export function ResponseKey({ calc }: { calc: CalculatorFixture }) {
  const key = sharedOptionKey(calc);
  if (!key) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label={`${calc.abbrev} response key`}>
      {key.map((option) => (
        <span
          key={option.label}
          className="inline-flex min-h-6 items-center gap-1.5 rounded-md bg-[color:var(--surface-subtle)] px-2 text-2xs font-semibold text-[color:var(--text-muted)]"
        >
          <span className="font-mono font-bold tabular-nums text-[color:var(--text-heading)]">{option.short}</span>
          {option.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Full interactive item list for a calculator: response key, stem, then a
 * CheckboxRow or OptionScale per item. Uniform scales get numbered chips
 * with one key; bespoke option sets get stacked full-label buttons.
 */
export function CalculatorItems({
  calc,
  answers,
  onAnswersChange,
  dense = false,
  showKey = true,
}: {
  calc: CalculatorFixture;
  answers: AnswerMap;
  onAnswersChange: (next: AnswerMap) => void;
  dense?: boolean;
  showKey?: boolean;
}) {
  const key = sharedOptionKey(calc);
  // Offer an explicit "all remaining negative" affordance for checkbox-only
  // scales, so an all-negative CAGE/SAD PERSONS can be completed without ticking
  // each box — but only on user action, never by merely opening the scale.
  const canMarkRemaining = isCheckboxOnly(calc) && calc.items.some((item) => answers[item.id] === undefined);

  return (
    <section aria-label={`${calc.abbrev} items`} className="grid min-w-0 content-start gap-2">
      {showKey ? <ResponseKey calc={calc} /> : null}
      {calc.stem ? (
        <p className="text-sm-minus font-bold leading-5 text-[color:var(--text-muted)]">{calc.stem}</p>
      ) : null}
      {calc.items.map((item, itemIndex) =>
        item.kind === "checkbox" ? (
          <CheckboxRow
            key={item.id}
            item={item}
            index={itemIndex + 1}
            checked={answers[item.id] === 1}
            onToggle={() => onAnswersChange(toggleCheckboxAnswer(answers, item.id))}
            dense={dense}
          />
        ) : (
          <div
            key={item.id}
            className={cn(
              "grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
              dense ? "py-2" : "py-2.5",
            )}
          >
            <div className="min-w-0">
              <p
                className={cn(
                  "font-semibold leading-5 text-[color:var(--text-heading)]",
                  dense ? "text-sm-minus" : "text-sm",
                )}
              >
                <span className="mr-1.5 font-mono text-2xs font-bold tabular-nums text-[color:var(--text-soft)]">
                  {itemIndex + 1}.
                </span>
                {item.text}
              </p>
              {item.detail ? (
                <p className="mt-0.5 text-2xs font-medium leading-4 text-[color:var(--text-soft)]">{item.detail}</p>
              ) : null}
            </div>
            <OptionScale
              item={item}
              value={answers[item.id]}
              onSelect={(optionIndex) => onAnswersChange(selectOptionAnswer(answers, item.id, optionIndex))}
              layout={key ? "row" : "stack"}
            />
          </div>
        ),
      )}
      {canMarkRemaining ? (
        <button
          type="button"
          onClick={() => onAnswersChange(seedCheckboxDefaults(calc, answers))}
          className={cn(
            "mt-1 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] px-3 text-sm-minus font-bold text-[color:var(--text-muted)] transition hover:border-[color:var(--clinical-accent-border)] hover:text-[color:var(--text)]",
            focusRing,
          )}
        >
          <Check className="size-icon-sm" aria-hidden="true" />
          Mark remaining as “No”
        </button>
      ) : null}
    </section>
  );
}
