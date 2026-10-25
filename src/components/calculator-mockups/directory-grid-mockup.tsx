"use client";

import { BookOpen, Calculator, ChevronDown, Clock3, Info, ListChecks, Search, ShieldCheck, Sigma } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/components/ui-primitives";

import {
  calculators,
  domainLabels,
  domainOrder,
  plannedCalculators,
  type CalculatorDomain,
  type CalculatorFixture,
} from "./calculator-fixtures";
import {
  BandLegend,
  CalculatorItems,
  CopyResultButton,
  FlagNotice,
  MetaPill,
  ResetButton,
  ScoreBandBar,
  SeverityPill,
  deriveCalculator,
  focusRing,
  progressLabel,
  type AnswerMap,
} from "./calculator-ui";

type DomainFilter = CalculatorDomain | "all";

function ExpandedCalculator({
  calc,
  answers,
  onAnswersChange,
}: {
  calc: CalculatorFixture;
  answers: AnswerMap;
  onAnswersChange: (next: AnswerMap) => void;
}) {
  const state = deriveCalculator(calc, answers);

  return (
    <div className="grid gap-4 border-t border-[color:var(--border)] pt-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <CalculatorItems calc={calc} answers={answers} onAnswersChange={onAnswersChange} dense />

      <aside className="grid h-fit content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--shadow-inset)] lg:sticky lg:top-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-2xs font-semibold uppercase leading-4 tracking-[0.06em] text-[color:var(--text-soft)]">
              Score
            </p>
            <p className="font-mono text-2xl font-extrabold tabular-nums leading-8 text-[color:var(--text-heading)]">
              {state.started ? state.score : "—"}
              <span className="text-sm font-bold text-[color:var(--text-soft)]"> / {calc.maxScore}</span>
            </p>
          </div>
          <SeverityPill tone={state.result.tone} label={state.started ? state.result.label : "Not started"} />
        </div>
        <ScoreBandBar calc={calc} score={state.score} started={state.started} />
        <p className="text-2xs font-semibold leading-4 text-[color:var(--text-soft)]">{progressLabel(state)}</p>
        {state.started && state.result.guidance ? (
          <p className="rounded-md bg-[color:var(--surface-inset)] p-2.5 text-sm-minus font-medium leading-5 text-[color:var(--text)]">
            {state.result.guidance}
          </p>
        ) : null}
        <FlagNotice flags={state.flags} />
        <BandLegend calc={calc} activeBand={state.started ? state.band : undefined} />
        <div className="grid gap-2 border-t border-[color:var(--border)] pt-3">
          <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
            <Info className="mt-0.5 size-icon-xs shrink-0" aria-hidden="true" />
            {calc.scoringNote}
          </p>
          {calc.caution ? (
            <p className="text-2xs font-semibold leading-4 text-[color:var(--warning)]">{calc.caution}</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CopyResultButton calc={calc} state={state} />
            <ResetButton onReset={() => onAnswersChange({})} disabled={!state.started} />
          </div>
          <p className="font-mono text-3xs font-semibold text-[color:var(--text-soft)]">{calc.source}</p>
        </div>
      </aside>
    </div>
  );
}

function CalculatorCard({
  calc,
  open,
  onToggle,
  answers,
  onAnswersChange,
}: {
  calc: CalculatorFixture;
  open: boolean;
  onToggle: () => void;
  answers: AnswerMap;
  onAnswersChange: (next: AnswerMap) => void;
}) {
  const Icon = calc.icon;

  return (
    <article
      className={cn(
        "grid min-w-0 content-start gap-3 rounded-lg border bg-[color:var(--surface)] p-4 transition",
        open
          ? "col-span-full border-[color:var(--clinical-accent-border)] shadow-[var(--e2)]"
          : "border-[color:var(--border)] shadow-[var(--shadow-inset)] hover:border-[color:var(--clinical-accent-border)] hover:shadow-[var(--e2)]",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md text-left",
          focusRing,
        )}
      >
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-md border shadow-[var(--shadow-inset)]",
            open
              ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
              : "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
          )}
        >
          <Icon className="size-icon-lg" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-extrabold leading-6 text-[color:var(--text-heading)]">{calc.abbrev}</span>
            <span className="inline-flex min-h-5 items-center rounded-md bg-[color:var(--surface-subtle)] px-1.5 text-3xs font-bold uppercase tracking-[0.06em] text-[color:var(--text-soft)]">
              {domainLabels[calc.domain]}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-2xs font-semibold leading-4 text-[color:var(--text-soft)]">
            {calc.name}
          </span>
          <span className="mt-2 block text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
            {calc.indication}
          </span>
        </span>
        <span
          className={cn(
            "relative grid size-8 shrink-0 place-items-center rounded-md border transition before:absolute before:-inset-2 before:content-['']",
            open
              ? "rotate-180 border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
              : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-soft)]",
          )}
        >
          <ChevronDown className="size-icon-md" aria-hidden="true" />
        </span>
      </button>

      <div className="flex flex-wrap gap-1.5">
        <MetaPill icon={ListChecks} label={`${calc.items.length} items`} />
        <MetaPill icon={Clock3} label={calc.timeEstimate} />
        <MetaPill icon={Sigma} label={`${calc.minScore}–${calc.maxScore}`} />
      </div>

      {open ? <ExpandedCalculator calc={calc} answers={answers} onAnswersChange={onAnswersChange} /> : null}
    </article>
  );
}

const filterChips: { id: DomainFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...domainOrder.map((domain) => ({ id: domain as DomainFilter, label: domainLabels[domain] })),
];

export function CalculatorsDirectoryGridMockup() {
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState<DomainFilter>("all");
  const [openId, setOpenId] = useState<string | null>("cage");
  // Answers live here, keyed by calculator id, so they survive a card collapsing
  // or another card opening (which unmounts ExpandedCalculator).
  const [session, setSession] = useState<Record<string, AnswerMap>>({});

  const visible = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return calculators.filter((calc) => {
      if (domain !== "all" && calc.domain !== domain) return false;
      if (!trimmed) return true;
      const haystack = [calc.abbrev, calc.name, calc.indication, calc.summary, domainLabels[calc.domain]]
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmed) || calc.items.some((item) => item.text.toLowerCase().includes(trimmed));
    });
  }, [domain, query]);

  return (
    <div className="min-h-screen bg-[color:var(--background)]">
      <header className="border-b border-[color:var(--border)] bg-[color:var(--surface)]">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
            <span className="grid size-11 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
              <Calculator className="size-icon-xl" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold leading-tight text-[color:var(--text-heading)] sm:text-3xl">
                Clinical calculators
              </h1>
              <p className="mt-1 max-w-2xl text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                Validated psychiatry scores with the indication, items, and interpretation in one place.
              </p>
            </div>
          </div>

          <form
            role="search"
            onSubmit={(event) => event.preventDefault()}
            className="grid min-h-12 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 shadow-[var(--e1)]"
          >
            <Search className="size-icon-lg text-[color:var(--text-soft)]" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by scale, symptom, or indication"
              aria-label="Search calculators"
              className="min-w-0 bg-transparent text-sm font-semibold text-[color:var(--text)] placeholder:text-[color:var(--text-soft)] focus:outline-none"
            />
          </form>

          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filterChips.map((chip) => {
              const active = domain === chip.id;
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDomain(chip.id)}
                  className={cn(
                    "inline-flex min-h-10 shrink-0 items-center rounded-md border px-3 text-sm-minus font-bold",
                    active
                      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
                    focusRing,
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 pb-28 text-[color:var(--text)] sm:px-6 lg:px-8">
        <section aria-label="Calculators" className="grid gap-3 lg:grid-cols-2">
          {visible.map((calc) => (
            <CalculatorCard
              key={calc.id}
              calc={calc}
              open={openId === calc.id}
              onToggle={() => setOpenId((prev) => (prev === calc.id ? null : calc.id))}
              answers={session[calc.id] ?? {}}
              onAnswersChange={(next) => setSession((prev) => ({ ...prev, [calc.id]: next }))}
            />
          ))}
          {!visible.length ? (
            <p className="col-span-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-6 text-center text-sm font-semibold text-[color:var(--text-muted)]">
              No calculators match that search.
            </p>
          ) : null}
        </section>

        <section aria-label="Planned calculators" className="grid gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="size-icon-md text-[color:var(--text-soft)]" aria-hidden="true" />
            <h2 className="text-base font-extrabold text-[color:var(--text-heading)]">Coming next</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {plannedCalculators.map((planned) => {
              const Icon = planned.icon;
              return (
                <div
                  key={planned.abbrev}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)] p-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-soft)]">
                    <Icon className="size-icon-md" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-[color:var(--text-heading)]">{planned.abbrev}</span>
                      <span className="inline-flex min-h-5 items-center rounded-md bg-[color:var(--surface)] px-1.5 text-3xs font-bold uppercase tracking-[0.06em] text-[color:var(--text-soft)]">
                        Planned
                      </span>
                    </span>
                    <span className="mt-1 block text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
                      {planned.indication}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3 text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
          <ShieldCheck className="mt-0.5 size-icon-sm shrink-0" aria-hidden="true" />
          Scores support clinical judgement — they never replace a full assessment. Nothing entered here is stored.
        </p>
      </main>
    </div>
  );
}
