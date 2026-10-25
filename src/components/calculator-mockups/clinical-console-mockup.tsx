"use client";

import { AlertTriangle, Info, Stethoscope } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/components/ui-primitives";

import { calculators, domainIcons, domainLabels, domainOrder, type CalculatorFixture } from "./calculator-fixtures";
import {
  CalculatorItems,
  CopyResultButton,
  FlagNotice,
  ScoreBandBar,
  SeverityPill,
  deriveCalculator,
  focusRing,
  progressLabel,
  toneBar,
  type AnswerMap,
} from "./calculator-ui";

type SessionAnswers = Record<string, AnswerMap>;

function RailEntry({
  calc,
  active,
  answers,
  onSelect,
}: {
  calc: CalculatorFixture;
  active: boolean;
  answers: AnswerMap;
  onSelect: () => void;
}) {
  const derived = deriveCalculator(calc, answers);

  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "grid w-full min-h-tap items-center gap-2 rounded-lg border px-3 py-2 text-left transition",
        derived.flags.length > 0 ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto]",
        active
          ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]"
          : "border-transparent hover:bg-[color:var(--surface-subtle)]",
        focusRing,
      )}
    >
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate text-sm-minus font-extrabold leading-5",
            active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-heading)]",
          )}
        >
          {calc.abbrev}
        </span>
        <span className="block truncate text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
          {calc.summary}
        </span>
      </span>
      {derived.started ? (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("inline-block h-2 w-2 rounded-full", toneBar[derived.result.tone])} />
          <span className="font-mono text-2xs font-bold tabular-nums text-[color:var(--text-muted)]">
            {derived.score}
          </span>
        </span>
      ) : (
        <span className="font-mono text-3xs font-semibold text-[color:var(--text-soft)]">
          {calc.items.length} items
        </span>
      )}
      {derived.flags.length > 0 ? (
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[color:var(--danger-soft)] text-[color:var(--danger)]">
          <AlertTriangle className="size-icon-xs" aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );
}

export function CalculatorsClinicalConsoleMockup() {
  const [activeId, setActiveId] = useState<string>("phq9");
  const [session, setSession] = useState<SessionAnswers>({});

  const calc = useMemo(() => calculators.find((entry) => entry.id === activeId) ?? calculators[0], [activeId]);
  const answers = session[calc.id] ?? {};
  const derived = deriveCalculator(calc, answers);

  const setAnswers = (next: AnswerMap) => setSession((prev) => ({ ...prev, [calc.id]: next }));

  return (
    <div className="min-h-screen bg-[color:var(--background)]">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
              <Stethoscope className="size-icon-lg" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold leading-tight text-[color:var(--text-heading)] sm:text-2xl">
                Calculator console
              </h1>
              <p className="text-sm-minus font-medium text-[color:var(--text-muted)]">
                Work through scales side by side — progress is kept per calculator.
              </p>
            </div>
          </div>
          <span className="inline-flex min-h-7 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2 text-2xs font-bold text-[color:var(--text-muted)]">
            Session only · nothing stored
          </span>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 pb-28 text-[color:var(--text)] sm:px-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:px-8">
        {/* Rail — horizontal chips on phones, grouped list on desktop */}
        <nav aria-label="Calculators" className="min-w-0">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {calculators.map((entry) => {
              const entryDerived = deriveCalculator(entry, session[entry.id] ?? {});
              const active = entry.id === calc.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveId(entry.id)}
                  className={cn(
                    "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-sm-minus font-bold",
                    active
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
                    focusRing,
                  )}
                >
                  {entry.abbrev}
                  {entryDerived.started ? (
                    <span
                      aria-hidden="true"
                      className={cn("inline-block h-2 w-2 rounded-full", toneBar[entryDerived.result.tone])}
                    />
                  ) : null}
                  {entryDerived.flags.length > 0 ? (
                    <AlertTriangle className="size-icon-xs text-[color:var(--danger)]" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="hidden content-start gap-4 lg:sticky lg:top-4 lg:grid">
            {domainOrder.map((domain) => {
              const entries = calculators.filter((entry) => entry.domain === domain);
              if (!entries.length) return null;
              const DomainIcon = domainIcons[domain];
              return (
                <section key={domain} className="grid gap-1">
                  <h2 className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 px-3 text-2xs font-semibold uppercase leading-4 tracking-[0.06em] text-[color:var(--text-soft)]">
                    <DomainIcon className="size-icon-xs" aria-hidden="true" />
                    {domainLabels[domain]}
                  </h2>
                  {entries.map((entry) => (
                    <RailEntry
                      key={entry.id}
                      calc={entry}
                      active={entry.id === calc.id}
                      answers={session[entry.id] ?? {}}
                      onSelect={() => setActiveId(entry.id)}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        </nav>

        {/* Workspace */}
        <main className="grid min-w-0 content-start gap-4">
          <section className="grid gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="text-lg font-extrabold text-[color:var(--text-heading)]">{calc.abbrev}</h2>
              <span className="text-sm-minus font-semibold text-[color:var(--text-soft)]">{calc.name}</span>
            </div>
            <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md border border-[color:var(--info-border)] bg-[color:var(--info-soft)] p-2.5 text-sm-minus font-semibold leading-5 text-[color:var(--info)]">
              <Info className="mt-0.5 size-icon-md shrink-0" aria-hidden="true" />
              {calc.indication}
            </p>
            {calc.caution ? (
              <p className="text-2xs font-semibold leading-4 text-[color:var(--warning)]">{calc.caution}</p>
            ) : null}
          </section>

          {/* Sticky live-score ticker */}
          <section
            aria-label="Live result"
            className="sticky top-2 z-10 grid gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface-glass)] p-3 shadow-[var(--e2)] backdrop-blur-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xl font-extrabold tabular-nums text-[color:var(--text-heading)]">
                  {derived.started ? derived.score : "—"}
                  <span className="text-sm-minus font-bold text-[color:var(--text-soft)]"> / {calc.maxScore}</span>
                </span>
                <SeverityPill
                  tone={derived.result.tone}
                  label={derived.started ? derived.result.label : "Not started"}
                />
                <span className="text-2xs font-semibold text-[color:var(--text-soft)]">{progressLabel(derived)}</span>
              </div>
              <CopyResultButton calc={calc} state={derived} />
            </div>
            <ScoreBandBar calc={calc} score={derived.score} started={derived.started} />
            {derived.started && derived.result.guidance ? (
              <p className="text-sm-minus font-medium leading-5 text-[color:var(--text)]">{derived.result.guidance}</p>
            ) : null}
          </section>

          <FlagNotice flags={derived.flags} />

          <CalculatorItems calc={calc} answers={answers} onAnswersChange={setAnswers} />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--border)] pt-3">
            <span className="text-2xs font-medium text-[color:var(--text-soft)]">
              {calc.scoringNote} <span className="font-mono">{calc.source}</span>
            </span>
            <button
              type="button"
              onClick={() => setAnswers({})}
              disabled={!derived.started}
              className={cn(
                "inline-flex min-h-9 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-2xs font-bold text-[color:var(--text-muted)] hover:text-[color:var(--text)] disabled:pointer-events-none disabled:opacity-40",
                focusRing,
              )}
            >
              Clear {calc.abbrev}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
