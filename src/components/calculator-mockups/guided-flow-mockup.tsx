"use client";

import { ArrowLeft, ArrowRight, Check, ChevronRight, Clock3, ListChecks, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/components/ui-primitives";

import { calculators, domainLabels, type CalculatorFixture, type CalculatorItem } from "./calculator-fixtures";
import {
  BandLegend,
  CopyResultButton,
  FlagNotice,
  ScoreBandBar,
  SeverityPill,
  deriveCalculator,
  focusRing,
  itemScore,
  type AnswerMap,
} from "./calculator-ui";

function PickerScreen({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="mx-auto grid w-full max-w-xl content-start gap-4">
      <div className="grid gap-1 text-center">
        <h1 className="text-2xl font-extrabold leading-tight text-[color:var(--text-heading)]">Guided calculators</h1>
        <p className="text-sm font-medium leading-5 text-[color:var(--text-muted)]">
          One question at a time, sized for the ward round. Pick a scale to begin.
        </p>
      </div>
      <div className="grid gap-2">
        {calculators.map((calc) => {
          const Icon = calc.icon;
          return (
            <button
              key={calc.id}
              type="button"
              onClick={() => onPick(calc.id)}
              className={cn(
                "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-left shadow-[var(--shadow-inset)] transition hover:-translate-y-0.5 hover:border-[color:var(--clinical-accent-border)] hover:shadow-[var(--e2)]",
                focusRing,
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--clinical-accent)]">
                <Icon className="size-icon-lg" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="text-base font-extrabold leading-6 text-[color:var(--text-heading)]">
                    {calc.abbrev}
                  </span>
                  <span className="text-2xs font-bold uppercase tracking-[0.06em] text-[color:var(--text-soft)]">
                    {domainLabels[calc.domain]}
                  </span>
                </span>
                <span className="mt-0.5 block text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
                  {calc.indication}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-3 text-2xs font-semibold text-[color:var(--text-soft)]">
                  <span className="inline-flex items-center gap-1">
                    <ListChecks className="size-icon-xs" aria-hidden="true" />
                    {calc.items.length} questions
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="size-icon-xs" aria-hidden="true" />
                    {calc.timeEstimate}
                  </span>
                </span>
              </span>
              <ChevronRight className="size-icon-md shrink-0 text-[color:var(--clinical-accent)]" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuestionScreen({
  calc,
  item,
  stepIndex,
  answers,
  onAnswer,
  onBack,
  onExit,
}: {
  calc: CalculatorFixture;
  item: CalculatorItem;
  stepIndex: number;
  answers: AnswerMap;
  onAnswer: (value: number) => void;
  onBack: () => void;
  onExit: () => void;
}) {
  const derived = deriveCalculator(calc, answers);
  const total = calc.items.length;
  const value = answers[item.id];

  return (
    <div className="mx-auto grid w-full max-w-lg content-start gap-4">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <button
          type="button"
          onClick={onExit}
          aria-label={`Exit ${calc.abbrev}`}
          className={cn(
            "grid size-tap place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
            focusRing,
          )}
        >
          <X className="size-icon-md" aria-hidden="true" />
        </button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-extrabold text-[color:var(--text-heading)]">{calc.abbrev}</p>
          <p className="font-mono text-2xs font-bold tabular-nums text-[color:var(--text-soft)]">
            {stepIndex + 1} / {total}
          </p>
        </div>
        <span className="inline-flex min-h-8 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2 font-mono text-sm-minus font-extrabold tabular-nums text-[color:var(--text-heading)]">
          {derived.started ? derived.score : 0}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={stepIndex}
        aria-label={`${calc.abbrev} progress`}
        className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface-inset)]"
      >
        <div
          className="h-full rounded-full bg-[color:var(--clinical-accent)] transition-[width] duration-300"
          style={{ width: `${(stepIndex / total) * 100}%` }}
        />
      </div>

      <div className="grid gap-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--e2)] sm:p-5">
        {calc.stem ? (
          <p className="text-2xs font-semibold uppercase leading-4 tracking-[0.06em] text-[color:var(--text-soft)]">
            {calc.stem}
          </p>
        ) : null}
        <p className="text-lg-minus font-extrabold leading-6 text-[color:var(--text-heading)]">{item.text}</p>
        {item.detail ? (
          <p className="text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">{item.detail}</p>
        ) : null}

        <div className="grid gap-2">
          {item.kind === "checkbox" ? (
            <>
              <button
                type="button"
                aria-pressed={value === 1}
                onClick={() => onAnswer(1)}
                className={cn(
                  "grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border px-4 text-left text-base font-bold transition",
                  value === 1
                    ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-heading)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)]",
                  focusRing,
                )}
              >
                <Check className="size-icon-lg" aria-hidden="true" />
                Yes
              </button>
              <button
                type="button"
                aria-pressed={value === 0}
                onClick={() => onAnswer(0)}
                className={cn(
                  "grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border px-4 text-left text-base font-bold transition",
                  value === 0
                    ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-heading)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)]",
                  focusRing,
                )}
              >
                <X className="size-icon-lg" aria-hidden="true" />
                No
              </button>
            </>
          ) : (
            (item.options ?? []).map((option, optionIndex) => {
              const active = value === optionIndex;
              const showPoints = (item.options ?? []).some((entry) => entry.points !== 0);
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onAnswer(optionIndex)}
                  className={cn(
                    "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-4 text-left text-base-minus font-bold transition",
                    active
                      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-heading)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)]",
                    focusRing,
                  )}
                >
                  <span className="min-w-0">{option.label}</span>
                  {showPoints ? (
                    <span
                      className={cn(
                        "font-mono text-sm-minus font-bold tabular-nums",
                        active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-soft)]",
                      )}
                    >
                      +{option.points}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={stepIndex === 0}
          className={cn(
            "inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm-minus font-bold text-[color:var(--text-muted)] hover:text-[color:var(--text)] disabled:pointer-events-none disabled:opacity-40",
            focusRing,
          )}
        >
          <ArrowLeft className="size-icon-sm" aria-hidden="true" />
          Back
        </button>
        <span className="text-2xs font-semibold text-[color:var(--text-soft)]">Tap an answer to continue</span>
      </div>
    </div>
  );
}

function ResultScreen({
  calc,
  answers,
  onRestart,
  onExit,
}: {
  calc: CalculatorFixture;
  answers: AnswerMap;
  onRestart: () => void;
  onExit: () => void;
}) {
  const derived = deriveCalculator(calc, answers);

  return (
    <div className="mx-auto grid w-full max-w-lg content-start gap-4">
      <div className="grid gap-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 text-center shadow-[var(--e2)]">
        <p className="text-2xs font-semibold uppercase leading-4 tracking-[0.06em] text-[color:var(--text-soft)]">
          {calc.abbrev} result
        </p>
        <p className="font-mono text-3xl-minus font-extrabold tabular-nums leading-9 text-[color:var(--text-heading)]">
          {derived.score}
          <span className="text-lg font-bold text-[color:var(--text-soft)]"> / {calc.maxScore}</span>
        </p>
        <div className="justify-self-center">
          <SeverityPill tone={derived.result.tone} label={derived.result.label} />
        </div>
        <ScoreBandBar calc={calc} score={derived.score} started />
        {derived.result.guidance ? (
          <p className="rounded-lg bg-[color:var(--surface-inset)] p-3 text-left text-sm-minus font-medium leading-5 text-[color:var(--text)]">
            {derived.result.guidance}
          </p>
        ) : null}
        <FlagNotice flags={derived.flags} />
        <div className="text-left">
          <BandLegend calc={calc} activeBand={derived.band} />
        </div>
        <div className="grid gap-1.5 border-t border-[color:var(--border)] pt-3 text-left">
          <p className="text-2xs font-semibold uppercase leading-4 tracking-[0.06em] text-[color:var(--text-soft)]">
            Answer review
          </p>
          <ul className="grid gap-1">
            {calc.items.map((item, itemIndex) => {
              const value = answers[item.id];
              const answerLabel =
                item.kind === "checkbox" ? (value === 1 ? "Yes" : "No") : (item.options?.[value ?? -1]?.label ?? "—");
              const points = itemScore(item, value);
              return (
                <li
                  key={item.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-2 text-2xs leading-4"
                >
                  <span className="font-mono font-bold tabular-nums text-[color:var(--text-soft)]">
                    {itemIndex + 1}.
                  </span>
                  <span className="truncate font-medium text-[color:var(--text-muted)]">{item.text}</span>
                  <span className="font-semibold text-[color:var(--text-heading)]">
                    {answerLabel}
                    <span className="ml-1 font-mono font-bold tabular-nums text-[color:var(--text-soft)]">
                      +{points}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="justify-self-center">
          <CopyResultButton calc={calc} state={derived} />
        </div>
        {calc.caution ? (
          <p className="text-left text-2xs font-semibold leading-4 text-[color:var(--warning)]">{calc.caution}</p>
        ) : null}
        <p className="text-left font-mono text-3xs font-semibold text-[color:var(--text-soft)]">{calc.source}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onRestart}
          className={cn(
            "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 text-sm font-bold text-[color:var(--text)] hover:border-[color:var(--border-strong)]",
            focusRing,
          )}
        >
          <RotateCcw className="size-icon-md" aria-hidden="true" />
          Start again
        </button>
        <button
          type="button"
          onClick={onExit}
          className={cn(
            "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[color:var(--clinical-accent)] px-4 text-sm font-bold text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--clinical-accent-hover)]",
            focusRing,
          )}
        >
          Another calculator
          <ArrowRight className="size-icon-md" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function CalculatorsGuidedFlowMockup() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});

  const calc = useMemo(() => calculators.find((entry) => entry.id === activeId) ?? null, [activeId]);
  const finished = calc !== null && stepIndex >= calc.items.length;

  const start = (id: string) => {
    setActiveId(id);
    setStepIndex(0);
    setAnswers({});
  };

  const exit = () => {
    setActiveId(null);
    setStepIndex(0);
    setAnswers({});
  };

  const answer = (item: CalculatorItem, value: number) => {
    setAnswers((prev) => ({ ...prev, [item.id]: value }));
    setStepIndex((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen bg-[color:var(--surface-wash)]">
      <main className="mx-auto grid min-h-screen max-w-5xl content-start gap-6 px-4 py-6 pb-28 text-[color:var(--text)] sm:px-6 lg:px-8">
        {!calc ? (
          <PickerScreen onPick={start} />
        ) : finished ? (
          <ResultScreen calc={calc} answers={answers} onRestart={() => start(calc.id)} onExit={exit} />
        ) : (
          <QuestionScreen
            calc={calc}
            item={calc.items[stepIndex]}
            stepIndex={stepIndex}
            answers={answers}
            onAnswer={(value) => answer(calc.items[stepIndex], value)}
            onBack={() => setStepIndex((prev) => Math.max(0, prev - 1))}
            onExit={exit}
          />
        )}
      </main>
    </div>
  );
}
