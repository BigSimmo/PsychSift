"use client";

import { AlertTriangle, CheckCheck, ChevronDown, ClipboardCopy, ClipboardList, NotebookPen } from "lucide-react";
import { useState } from "react";

import { cn } from "@/components/ui-primitives";

import { calculators, domainLabels, type CalculatorFixture } from "./calculator-fixtures";
import {
  CalculatorItems,
  FlagNotice,
  ScoreBandBar,
  SeverityPill,
  deriveCalculator,
  focusRing,
  formatResultSummary,
  progressLabel,
  toneBar,
  type AnswerMap,
} from "./calculator-ui";

type SessionAnswers = Record<string, AnswerMap>;

function SheetSection({
  calc,
  answers,
  open,
  onToggleOpen,
  onAnswersChange,
}: {
  calc: CalculatorFixture;
  answers: AnswerMap;
  open: boolean;
  onToggleOpen: () => void;
  onAnswersChange: (next: AnswerMap) => void;
}) {
  const derived = deriveCalculator(calc, answers);
  const Icon = calc.icon;

  return (
    <section
      id={`sheet-${calc.id}`}
      className="scroll-mt-24 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggleOpen}
        className={cn(
          "grid w-full items-center gap-3 rounded-lg p-3 text-left sm:p-4",
          derived.flags.length > 0
            ? "grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]"
            : "grid-cols-[auto_minmax(0,1fr)_auto_auto]",
          focusRing,
        )}
      >
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-md border shadow-[var(--shadow-inset)]",
            derived.started
              ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
              : "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
          )}
        >
          <Icon className="size-icon-lg" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-extrabold leading-6 text-[color:var(--text-heading)]">{calc.abbrev}</span>
            <span className="hidden text-2xs font-bold uppercase tracking-[0.06em] text-[color:var(--text-soft)] sm:inline">
              {domainLabels[calc.domain]}
            </span>
          </span>
          <span className="block truncate text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
            {calc.indication}
          </span>
        </span>
        {derived.started ? (
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-base font-extrabold tabular-nums text-[color:var(--text-heading)]">
              {derived.score}
            </span>
            <SeverityPill tone={derived.result.tone} label={derived.result.label} className="hidden sm:inline-flex" />
          </span>
        ) : (
          <span className="text-2xs font-semibold text-[color:var(--text-soft)]">{calc.items.length} items</span>
        )}
        {derived.flags.length > 0 ? (
          <span
            className="relative grid size-8 shrink-0 place-items-center rounded-md border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)] before:absolute before:-inset-2 before:content-['']"
            title="Safety flag triggered"
          >
            <AlertTriangle className="size-icon-sm" aria-hidden="true" />
          </span>
        ) : null}
        <span
          className={cn(
            "relative grid size-8 shrink-0 place-items-center rounded-md border border-[color:var(--border)] text-[color:var(--text-soft)] transition before:absolute before:-inset-2 before:content-['']",
            open && "rotate-180",
          )}
        >
          <ChevronDown className="size-icon-md" aria-hidden="true" />
        </span>
      </button>

      {open ? (
        <div className="grid gap-3 border-t border-[color:var(--border)] p-3 sm:p-4">
          <CalculatorItems calc={calc} answers={answers} onAnswersChange={onAnswersChange} dense />

          <FlagNotice flags={derived.flags} />

          <div className="grid gap-2 rounded-lg bg-[color:var(--surface-subtle)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-2xs font-semibold text-[color:var(--text-soft)]">{progressLabel(derived)}</span>
              {derived.started ? <SeverityPill tone={derived.result.tone} label={derived.result.label} /> : null}
            </div>
            <ScoreBandBar calc={calc} score={derived.score} started={derived.started} />
            {derived.started && derived.result.guidance ? (
              <p className="text-sm-minus font-medium leading-5 text-[color:var(--text)]">{derived.result.guidance}</p>
            ) : null}
            {calc.caution ? (
              <p className="text-2xs font-semibold leading-4 text-[color:var(--warning)]">{calc.caution}</p>
            ) : null}
            <p className="font-mono text-3xs font-semibold text-[color:var(--text-soft)]">
              {calc.scoringNote} · {calc.source}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function CalculatorsBedsideSheetMockup() {
  const [session, setSession] = useState<SessionAnswers>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ phq9: true });
  const [copied, setCopied] = useState(false);

  const startedCalcs = calculators
    .map((calc) => ({ calc, derived: deriveCalculator(calc, session[calc.id] ?? {}) }))
    .filter((entry) => entry.derived.started);

  const copySession = async () => {
    const lines = startedCalcs.map(({ calc, derived }) => formatResultSummary(calc, derived));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable in some embeds — mockup-safe no-op */
    }
  };

  return (
    <div className="min-h-screen bg-[color:var(--background)]">
      <header className="sticky top-0 z-20 border-b border-[color:var(--border)] bg-[color:var(--surface-glass)] backdrop-blur-md">
        <div className="mx-auto grid max-w-4xl gap-3 px-4 py-3 sm:px-6">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
              <ClipboardList className="size-icon-md" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-extrabold leading-tight text-[color:var(--text-heading)]">
                Assessment sheet
              </h1>
              <p className="truncate text-2xs font-semibold text-[color:var(--text-soft)]">
                Run several scales in one review — a summary builds as you go.
              </p>
            </div>
          </div>
          <nav
            aria-label="Jump to calculator"
            className="flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)]"
          >
            {calculators.map((calc) => {
              const derived = deriveCalculator(calc, session[calc.id] ?? {});
              return (
                <a
                  key={calc.id}
                  href={`#sheet-${calc.id}`}
                  className={cn(
                    "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-2xs font-bold",
                    derived.started
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
                    focusRing,
                  )}
                >
                  {calc.abbrev}
                  {derived.started ? <span className="font-mono tabular-nums">{derived.score}</span> : null}
                </a>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-3 px-4 py-4 pb-64 text-[color:var(--text)] sm:px-6">
        {calculators.map((calc) => (
          <SheetSection
            key={calc.id}
            calc={calc}
            answers={session[calc.id] ?? {}}
            open={openSections[calc.id] ?? false}
            onToggleOpen={() => setOpenSections((prev) => ({ ...prev, [calc.id]: !(prev[calc.id] ?? false) }))}
            onAnswersChange={(next) => setSession((prev) => ({ ...prev, [calc.id]: next }))}
          />
        ))}
      </main>

      {/* Session summary dock — floats above the site composer */}
      <div className="pointer-events-none fixed inset-x-0 bottom-32 z-20 px-3 sm:bottom-36">
        <div className="pointer-events-auto mx-auto grid max-w-4xl gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface-glass)] px-4 py-3 shadow-[var(--e2)] backdrop-blur-md sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-sm-minus font-extrabold text-[color:var(--text-heading)]">
              <NotebookPen className="size-icon-md text-[color:var(--clinical-accent)]" aria-hidden="true" />
              Session summary
            </span>
            <button
              type="button"
              onClick={copySession}
              disabled={!startedCalcs.length}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-2xs font-bold text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] disabled:pointer-events-none disabled:opacity-40",
                focusRing,
              )}
            >
              {copied ? (
                <CheckCheck className="size-icon-sm text-[color:var(--success)]" aria-hidden="true" />
              ) : (
                <ClipboardCopy className="size-icon-sm" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy summary"}
            </button>
          </div>
          {startedCalcs.length ? (
            <div className="flex gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)]">
              {startedCalcs.map(({ calc, derived }) => (
                <a
                  key={calc.id}
                  href={`#sheet-${calc.id}`}
                  className={cn(
                    "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border px-2.5 text-2xs font-bold text-[color:var(--text-heading)]",
                    derived.flags.length > 0
                      ? "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)]",
                    focusRing,
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("inline-block h-2 w-2 rounded-full", toneBar[derived.result.tone])}
                  />
                  {calc.abbrev}
                  <span className="font-mono tabular-nums">
                    {derived.score}/{calc.maxScore}
                  </span>
                  <span className="hidden text-[color:var(--text-muted)] sm:inline">{derived.result.label}</span>
                  {derived.flags.length > 0 ? (
                    <AlertTriangle className="size-icon-xs text-[color:var(--danger)]" aria-hidden="true" />
                  ) : null}
                </a>
              ))}
            </div>
          ) : (
            <p className="text-2xs font-semibold text-[color:var(--text-soft)]">
              No scales started yet — completed scores collect here for your note.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
