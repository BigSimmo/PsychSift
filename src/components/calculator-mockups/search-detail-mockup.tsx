"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Calculator,
  Clock3,
  History,
  Info,
  ListChecks,
  Search,
  Sigma,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ShowAllChip } from "@/components/show-all-chip";
import { chatComposerInput, chatComposerShell, chatSendButton, cn, eyebrowText } from "@/components/ui-primitives";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";

import {
  calculators,
  domainLabels,
  domainOrder,
  type CalculatorDomain,
  type CalculatorFixture,
} from "./calculator-fixtures";
import {
  actionsForBand,
  relatedForBand,
  relatedKindLabels,
  type RelatedItem,
  type RelatedKind,
} from "./calculator-pathways";
import {
  BandLegend,
  CalculatorItems,
  CopyResultButton,
  MetaPill,
  ResetButton,
  ScoreBandBar,
  SeverityPill,
  deriveCalculator,
  focusRing,
  progressLabel,
  toneBar,
  type AnswerMap,
  type DerivedCalculator,
} from "./calculator-ui";

type DomainFilter = CalculatorDomain | "all";
export type SessionAnswers = Record<string, AnswerMap>;

const relatedKindChip: Record<RelatedKind, string> = {
  guideline:
    "border-[color:var(--type-document-border)] bg-[color:var(--type-document-soft)] text-[color:var(--type-document)]",
  medication:
    "border-[color:var(--type-table-border)] bg-[color:var(--type-table-soft)] text-[color:var(--type-table)]",
  differential:
    "border-[color:var(--type-source-border)] bg-[color:var(--type-source-soft)] text-[color:var(--type-source)]",
  service:
    "border-[color:var(--type-service-border)] bg-[color:var(--type-service-soft)] text-[color:var(--type-service)]",
  form: "border-[color:var(--type-search-border)] bg-[color:var(--type-search-soft)] text-[color:var(--type-search)]",
  answer: "border-[color:var(--type-search-border)] bg-[color:var(--type-search-soft)] text-[color:var(--type-search)]",
  calculator:
    "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
};

/** First item whose text matches the query — shown as match context in results. */
function matchContext(calc: CalculatorFixture, query: string): string | null {
  const matched = calc.items.find((item) => item.text.toLowerCase().includes(query));
  return matched ? matched.text : null;
}

function StartedChip({ derived }: { derived: DerivedCalculator }) {
  if (!derived.started) return null;
  return (
    <span className="inline-flex min-h-6 items-center gap-1.5 rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2 text-2xs font-bold text-[color:var(--clinical-accent)]">
      <span className="font-mono tabular-nums">{derived.score}</span>
      {derived.result.label}
    </span>
  );
}

/* ---------- search view ---------- */

function CalculatorResultCard({
  calc,
  derived,
  onOpen,
}: {
  calc: CalculatorFixture;
  derived: DerivedCalculator;
  onOpen: () => void;
}) {
  const Icon = calc.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group grid min-w-0 content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-left shadow-[var(--e2)] transition hover:-translate-y-0.5 hover:border-[color:var(--clinical-accent-border)] hover:shadow-[var(--shadow-hover)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        focusRing,
      )}
    >
      <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
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
        </span>
        <ArrowUpRight
          className="size-icon-md shrink-0 text-[color:var(--text-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
          aria-hidden="true"
        />
      </span>
      <span className="line-clamp-2 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
        {calc.indication}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <MetaPill icon={ListChecks} label={`${calc.items.length} items`} />
        <MetaPill icon={Clock3} label={calc.timeEstimate} />
        <MetaPill icon={Sigma} label={`${calc.minScore}–${calc.maxScore}`} />
        <StartedChip derived={derived} />
      </span>
    </button>
  );
}

function CalculatorResultRow({
  calc,
  derived,
  context,
  onOpen,
}: {
  calc: CalculatorFixture;
  derived: DerivedCalculator;
  context: string | null;
  onOpen: () => void;
}) {
  const Icon = calc.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-left shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-raised)] hover:shadow-[var(--e2)]",
        focusRing,
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--clinical-accent)]">
        <Icon className="size-icon-lg" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-base font-extrabold leading-6 text-[color:var(--text-heading)]">{calc.abbrev}</span>
          <span className="truncate text-2xs font-semibold text-[color:var(--text-soft)]">{calc.name}</span>
          <StartedChip derived={derived} />
        </span>
        <span className="mt-0.5 block truncate text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
          {calc.indication}
        </span>
        {context ? (
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
            <Search className="size-icon-xs shrink-0" aria-hidden="true" />
            <span className="truncate">
              Matches item: <span className="italic">“{context}”</span>
            </span>
          </span>
        ) : null}
      </span>
      <ArrowRight
        className="size-icon-md shrink-0 text-[color:var(--text-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
        aria-hidden="true"
      />
    </button>
  );
}

const filterChips: { id: DomainFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...domainOrder.map((domain) => ({ id: domain as DomainFilter, label: domainLabels[domain] })),
];

function CalculatorMockupHero() {
  return (
    <section data-testid="calculators-search" className="mx-auto grid max-w-3xl justify-items-center gap-3 text-center">
      <span className="grid size-14 place-items-center rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
        <Calculator className="size-7" aria-hidden="true" />
      </span>
      <div>
        <p className={cn(eyebrowText, "text-[color:var(--clinical-accent)]")}>Clinical tools</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[color:var(--text-heading)] sm:text-4xl">
          Calculators
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm font-medium leading-6 text-[color:var(--text-muted)] sm:text-base">
          Validated psychiatry scores with the indication, items, and next actions in one place.
        </p>
      </div>
    </section>
  );
}

/**
 * The calculators search home: mode-home hero, composer-pill search, domain
 * filters, continue strip, and the card grid / live results. Reused by both
 * the full-page detail flow and the popup-sheet variant.
 */
export function CalculatorSearchHome({
  session,
  onOpen,
}: {
  session: SessionAnswers;
  onOpen: (calcId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState<DomainFilter>("all");

  const trimmed = query.trim().toLowerCase();

  const results = useMemo(() => {
    return calculators
      .filter((calc) => domain === "all" || calc.domain === domain)
      .map((calc) => ({
        calc,
        context: trimmed ? matchContext(calc, trimmed) : null,
        matches:
          !trimmed ||
          [calc.abbrev, calc.name, calc.indication, calc.summary, domainLabels[calc.domain]]
            .join(" ")
            .toLowerCase()
            .includes(trimmed) ||
          calc.items.some((item) => item.text.toLowerCase().includes(trimmed)),
      }))
      .filter((entry) => entry.matches);
  }, [domain, trimmed]);

  const inProgress = calculators
    .map((calc) => ({ calc, derived: deriveCalculator(calc, session[calc.id] ?? {}) }))
    .filter((entry) => entry.derived.started);

  return (
    <main className="mx-auto grid w-full max-w-5xl content-start gap-5 px-4 pb-40 pt-[clamp(1.5rem,5vh,3rem)] text-[color:var(--text)] sm:px-6 lg:px-8">
      <CalculatorMockupHero />

      <ShowAllChip
        href={consolidatedModeSearchPath("calculators")}
        icon={Calculator}
        ariaLabel="Show all calculators"
        testId="calculators-show-all"
      />

      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (results.length === 1) onOpen(results[0].calc.id);
        }}
        className={cn(chatComposerShell, "mx-auto w-full max-w-2xl")}
      >
        <span className="grid size-tap shrink-0 place-items-center text-[color:var(--text-soft)]">
          <Search className="size-icon-lg" aria-hidden="true" />
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search scales, symptoms, or indications"
          aria-label="Search calculators"
          className={chatComposerInput}
        />
        <button type="submit" aria-label="Search calculators" className={chatSendButton}>
          <ArrowRight className="size-icon-lg" aria-hidden="true" />
        </button>
      </form>

      <nav
        aria-label="Filter calculators"
        className="flex justify-start gap-2 overflow-x-auto overscroll-x-contain pb-1 sm:flex-wrap sm:justify-center [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_2rem),transparent)] sm:[mask-image:none]"
      >
        {filterChips.map((chip) => {
          const active = domain === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={active}
              onClick={() => setDomain(chip.id)}
              className={cn(
                "inline-flex min-h-tap shrink-0 items-center rounded-lg border px-3 text-sm-minus font-bold transition lg:min-h-9",
                active
                  ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
                focusRing,
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </nav>

      {!trimmed && inProgress.length ? (
        <section aria-label="Continue this session" className="grid gap-2">
          <p className={cn(eyebrowText, "flex items-center gap-1.5 text-left")}>
            <History className="size-icon-xs" aria-hidden="true" />
            Continue this session
          </p>
          <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%_-_2rem),transparent)]">
            {inProgress.map(({ calc, derived }) => (
              <button
                key={calc.id}
                type="button"
                onClick={() => onOpen(calc.id)}
                className={cn(
                  "inline-flex min-h-tap shrink-0 items-center gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-3 text-sm-minus font-bold text-[color:var(--clinical-accent)] transition hover:bg-[color:var(--clinical-accent-soft)]/70",
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
                <span className="font-semibold text-[color:var(--text-muted)]">{progressLabel(derived)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {trimmed ? (
        <section aria-label="Search results" className="grid gap-2">
          <p className={cn(eyebrowText, "text-left")}>
            {results.length} {results.length === 1 ? "calculator" : "calculators"} for “{query.trim()}”
          </p>
          {results.map(({ calc, context }) => (
            <CalculatorResultRow
              key={calc.id}
              calc={calc}
              derived={deriveCalculator(calc, session[calc.id] ?? {})}
              context={context}
              onOpen={() => onOpen(calc.id)}
            />
          ))}
          {!results.length ? (
            <div className="grid justify-items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-6 text-center">
              <p className="text-sm font-bold text-[color:var(--text-heading)]">No calculator matches that.</p>
              <p className="text-sm-minus font-medium text-[color:var(--text-muted)]">
                Try a symptom (“hopeless”, “drinking”) or ask PsychSift below.
              </p>
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-label="All calculators" className="grid gap-2.5">
          <p className={cn(eyebrowText, "text-left")}>All calculators</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {results.map(({ calc }) => (
              <CalculatorResultCard
                key={calc.id}
                calc={calc}
                derived={deriveCalculator(calc, session[calc.id] ?? {})}
                onOpen={() => onOpen(calc.id)}
              />
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
        Scores support clinical judgement — they never replace a full assessment. Nothing entered here is stored.
      </p>
    </main>
  );
}

/* ---------- detail view: score-linked panels ---------- */

export function NextActionsPanel({ calc, derived }: { calc: CalculatorFixture; derived: DerivedCalculator }) {
  const actions = actionsForBand(calc, derived);

  return (
    <section
      aria-label="Next clinical actions"
      className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--e2)]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className={cn(eyebrowText, "text-[color:var(--text-muted)]")}>Next clinical actions</h2>
        <span className="inline-flex min-h-5 items-center gap-1 rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-1.5 text-3xs font-bold uppercase tracking-[0.06em] text-[color:var(--clinical-accent)]">
          <Sparkles className="size-icon-xs" aria-hidden="true" />
          Score-linked
        </span>
      </div>

      {!derived.started ? (
        <p className="rounded-md bg-[color:var(--surface-inset)] p-2.5 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
          Answer the items and recommendations for the scored severity band appear here.
        </p>
      ) : (
        <>
          {derived.flags.map((flag) => (
            <p
              key={flag}
              role="alert"
              className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] p-2.5 text-sm-minus font-bold leading-5 text-[color:var(--danger)]"
            >
              <AlertTriangle className="mt-0.5 size-icon-md shrink-0" aria-hidden="true" />
              {flag}
            </p>
          ))}
          <ol className="grid gap-2">
            {actions.map((action, actionIndex) => (
              <li key={action.label} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] font-mono text-2xs font-bold text-[color:var(--clinical-accent)]">
                  {actionIndex + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm-minus font-semibold leading-5 text-[color:var(--text-heading)]">
                    {action.label}
                  </span>
                  {action.detail ? (
                    <span className="mt-0.5 block text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
                      {action.detail}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          {derived.band ? (
            <p className="flex flex-wrap items-center gap-1.5 border-t border-[color:var(--border)] pt-2.5 text-2xs font-semibold text-[color:var(--text-soft)]">
              For
              <SeverityPill tone={derived.result.tone} label={derived.result.label} />— updates automatically as the
              score changes.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function RelatedContentPanel({
  calc,
  derived,
  onOpenCalculator,
}: {
  calc: CalculatorFixture;
  derived: DerivedCalculator;
  onOpenCalculator: (calcId: string) => void;
}) {
  const visible = relatedForBand(calc, derived);
  const all = relatedForBand(calc, { ...derived, band: calc.bands[calc.bands.length - 1] });
  const moreAtHigherSeverity = all.length > visible.length;

  if (!all.length) return null;

  const rowClass = cn(
    "grid w-full min-h-tap grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 py-2 text-left transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)]",
    focusRing,
  );

  const rowBody = (item: RelatedItem) => (
    <>
      <span
        className={cn(
          "inline-flex min-h-5 w-[4.75rem] items-center justify-center rounded-md border px-1.5 text-3xs font-bold uppercase tracking-[0.05em]",
          relatedKindChip[item.kind],
        )}
      >
        {relatedKindLabels[item.kind]}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm-minus font-semibold leading-5 text-[color:var(--text-heading)]">
          {item.title}
        </span>
        {item.note ? (
          <span className="block truncate text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
            {item.note}
          </span>
        ) : null}
      </span>
      <ArrowRight className="size-icon-sm shrink-0 text-[color:var(--text-soft)]" aria-hidden="true" />
    </>
  );

  return (
    <section
      aria-label="Related knowledge-base content"
      className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--e2)]"
    >
      <h2 className={cn(eyebrowText, "text-[color:var(--text-muted)]")}>From the knowledge base</h2>
      <div className="grid gap-1.5">
        {visible.map((item) =>
          item.kind === "calculator" && item.calcId ? (
            <button
              key={item.title}
              type="button"
              onClick={() => onOpenCalculator(item.calcId as string)}
              className={rowClass}
            >
              {rowBody(item)}
            </button>
          ) : (
            <Link key={item.title} href={item.href ?? "/"} className={rowClass}>
              {rowBody(item)}
            </Link>
          ),
        )}
      </div>
      {moreAtHigherSeverity ? (
        <p className="text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
          More referral and treatment content surfaces at higher severity bands.
        </p>
      ) : null}
    </section>
  );
}

export function ScorePanel({
  calc,
  derived,
  onReset,
}: {
  calc: CalculatorFixture;
  derived: DerivedCalculator;
  onReset: () => void;
}) {
  return (
    <section
      aria-label="Score"
      className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--e2)]"
    >
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className={cn(eyebrowText, "text-[color:var(--text-muted)]")}>Score</p>
          <p className="font-mono text-2xl font-extrabold tabular-nums leading-8 text-[color:var(--text-heading)]">
            {derived.started ? derived.score : "—"}
            <span className="text-sm font-bold text-[color:var(--text-soft)]"> / {calc.maxScore}</span>
          </p>
        </div>
        <SeverityPill tone={derived.result.tone} label={derived.started ? derived.result.label : "Not started"} />
      </div>
      <ScoreBandBar calc={calc} score={derived.score} started={derived.started} />
      <p className="text-2xs font-semibold leading-4 text-[color:var(--text-soft)]">{progressLabel(derived)}</p>
      <BandLegend calc={calc} activeBand={derived.started ? derived.band : undefined} />
      <div className="grid gap-2 border-t border-[color:var(--border)] pt-3">
        <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
          <Info className="mt-0.5 size-icon-xs shrink-0" aria-hidden="true" />
          {calc.scoringNote}
        </p>
        <div className="flex items-center justify-between gap-2">
          <CopyResultButton calc={calc} state={derived} />
          <ResetButton onReset={onReset} disabled={!derived.started} />
        </div>
        <p className="font-mono text-3xs font-semibold text-[color:var(--text-soft)]">{calc.source}</p>
      </div>
    </section>
  );
}

/* ---------- detail view ---------- */

export function CalculatorDetailHeader({ calc }: { calc: CalculatorFixture }) {
  return (
    <header className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--e2)] sm:p-5">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)] sm:size-12">
          <calc.icon className="size-icon-xl" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl-minus font-extrabold leading-7 text-[color:var(--text-heading)]">{calc.abbrev}</h1>
            <span className="inline-flex min-h-5 items-center rounded-md bg-[color:var(--surface-subtle)] px-1.5 text-3xs font-bold uppercase tracking-[0.06em] text-[color:var(--text-soft)]">
              {domainLabels[calc.domain]}
            </span>
          </div>
          <p className="mt-0.5 text-sm-minus font-semibold text-[color:var(--text-soft)]">{calc.name}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <MetaPill icon={ListChecks} label={`${calc.items.length} items`} />
        <MetaPill icon={Clock3} label={calc.timeEstimate} />
        <MetaPill icon={Sigma} label={`Range ${calc.minScore}–${calc.maxScore}`} />
      </div>
      <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border border-[color:var(--info-border)] bg-[color:var(--info-soft)] p-2.5 text-sm-minus font-semibold leading-5 text-[color:var(--info)]">
        <Info className="mt-0.5 size-icon-md shrink-0" aria-hidden="true" />
        {calc.indication}
      </p>
      {calc.caution ? (
        <p className="text-2xs font-semibold leading-4 text-[color:var(--warning)]">{calc.caution}</p>
      ) : null}
    </header>
  );
}

function CalculatorDetail({
  calc,
  answers,
  onAnswersChange,
  onBack,
  onOpenCalculator,
}: {
  calc: CalculatorFixture;
  answers: AnswerMap;
  onAnswersChange: (next: AnswerMap) => void;
  onBack: () => void;
  onOpenCalculator: (calcId: string) => void;
}) {
  const derived = deriveCalculator(calc, answers);

  return (
    <main className="mx-auto grid w-full max-w-6xl content-start gap-4 px-4 py-4 pb-40 text-[color:var(--text)] sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            "inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm-minus font-bold text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]",
            focusRing,
          )}
        >
          <ArrowLeft className="size-icon-sm" aria-hidden="true" />
          All calculators
        </button>
        <span className="inline-flex min-h-7 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2 text-2xs font-bold text-[color:var(--text-muted)]">
          Session only · nothing stored
        </span>
      </div>

      <CalculatorDetailHeader calc={calc} />

      {/* Compact live ticker — phones only; desktop has the sticky rail */}
      <section
        aria-label="Live score"
        className="sticky top-2 z-10 grid gap-1.5 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface-glass)] px-3 py-2.5 shadow-[var(--e2)] backdrop-blur-md lg:hidden"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-lg font-extrabold tabular-nums text-[color:var(--text-heading)]">
            {derived.started ? derived.score : "—"}
            <span className="text-sm-minus font-bold text-[color:var(--text-soft)]"> / {calc.maxScore}</span>
          </span>
          <SeverityPill tone={derived.result.tone} label={derived.started ? derived.result.label : "Not started"} />
        </div>
        <ScoreBandBar calc={calc} score={derived.score} started={derived.started} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <CalculatorItems calc={calc} answers={answers} onAnswersChange={onAnswersChange} />
        <aside className="grid content-start gap-4 lg:sticky lg:top-4 lg:self-start">
          <ScorePanel calc={calc} derived={derived} onReset={() => onAnswersChange({})} />
          <NextActionsPanel calc={calc} derived={derived} />
          <RelatedContentPanel calc={calc} derived={derived} onOpenCalculator={onOpenCalculator} />
        </aside>
      </div>
    </main>
  );
}

/* ---------- page ---------- */

/**
 * Reset scroll to the top on open/back. On phones the shell's #main-content is
 * the scroll container (max-sm:overflow-y-auto), so window.scrollTo alone leaves
 * the detail view at the prior offset — reset both the shell scroller and the
 * window (desktop) so the header/back control is always in view.
 */
function resetDetailScroll() {
  document.getElementById("main-content")?.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
}

export function CalculatorsSearchDetailMockup() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionAnswers>({});

  const openCalculator = (calcId: string) => {
    setOpenId(calcId);
    resetDetailScroll();
  };

  const activeCalc = openId ? calculators.find((calc) => calc.id === openId) : undefined;

  return (
    <div className="min-h-screen bg-[color:var(--background)]">
      {activeCalc ? (
        <CalculatorDetail
          calc={activeCalc}
          answers={session[activeCalc.id] ?? {}}
          onAnswersChange={(next) => setSession((prev) => ({ ...prev, [activeCalc.id]: next }))}
          onBack={() => {
            setOpenId(null);
            resetDetailScroll();
          }}
          onOpenCalculator={openCalculator}
        />
      ) : (
        <CalculatorSearchHome session={session} onOpen={openCalculator} />
      )}
    </div>
  );
}
