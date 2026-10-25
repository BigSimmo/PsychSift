"use client";

import {
  ArrowRight,
  Calculator,
  Clock3,
  History,
  Info,
  LayoutGrid,
  ListChecks,
  Plus,
  Rows3,
  Search,
  Send,
  Sigma,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { ShowAllChip } from "@/components/show-all-chip";
import { chatComposerInput, chatComposerShellBase, chatSendButton, cn, eyebrowText } from "@/components/ui-primitives";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";

import {
  calculators,
  domainIcons,
  domainLabels,
  domainOrder,
  plannedCalculators,
  type CalculatorDomain,
  type CalculatorFixture,
} from "./calculator-fixtures";
import {
  MetaPill,
  SeverityPill,
  deriveCalculator,
  focusRing,
  progressLabel,
  toneBar,
  type AnswerMap,
  type DerivedCalculator,
} from "./calculator-ui";
import { CalculatorSheet } from "./popup-sheet-mockup";

type DomainFilter = CalculatorDomain | "all";
type SessionAnswers = Record<string, AnswerMap>;
type Density = "comfortable" | "compact";

function MockupSuggestionChips({
  suggestions,
  onPick,
  label,
  className,
  testId,
}: {
  suggestions: string[];
  onPick: (value: string) => void;
  label: string;
  layout: "scroll";
  className?: string;
  testId?: string;
}) {
  return (
    <div aria-label={label} data-testid={testId} className={cn("flex gap-2 overflow-x-auto pb-1", className)}>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onPick(suggestion)}
          className={cn(
            "min-h-9 shrink-0 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
            focusRing,
          )}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

function MockupPrivacyInputNotice({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-2xs font-medium text-[color:var(--text-soft)]", className)}>
      <Info className="size-icon-xs" aria-hidden="true" />
      Mockup only. Nothing entered here is stored or sent.
    </p>
  );
}

function MockupSearchResultsLayout({
  testId,
  resultsLabel,
  header,
  summary,
  sidebar,
  sidebarMobile,
  children,
}: {
  testId: string;
  resultsLabel: string;
  header: ReactNode;
  summary: ReactNode;
  sidebar: ReactNode;
  sidebarMobile: ReactNode;
  children: ReactNode;
}) {
  return (
    <main data-testid={testId} className="mx-auto grid w-full max-w-7xl gap-5 px-4 pb-40 pt-5 sm:px-6 lg:px-8">
      <header
        aria-label={`${resultsLabel} search`}
        className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--e1)]"
      >
        {header}
      </header>
      {summary}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-label={`${resultsLabel} results`} className="min-w-0">
          {children}
        </section>
        <aside aria-label={`${resultsLabel} options`} className="hidden content-start gap-4 xl:grid">
          {sidebar}
        </aside>
      </div>
      {sidebarMobile}
    </main>
  );
}

function useMockupHideOnScroll() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const scrollOwner = document.querySelector<HTMLElement>("#main-content");
    if (!scrollOwner) return;

    let previousTop = scrollOwner.scrollTop;
    const onScroll = () => {
      const nextTop = scrollOwner.scrollTop;
      setHidden(nextTop > previousTop && nextTop > 48);
      previousTop = nextTop;
    };

    scrollOwner.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollOwner.removeEventListener("scroll", onScroll);
  }, []);

  return hidden;
}

/** Match context: name / indication hit, or the first matching item text. */
function matchContext(calc: CalculatorFixture, query: string): string | null {
  if (!query) return null;
  const item = calc.items.find((entry) => entry.text.toLowerCase().includes(query));
  return item ? item.text : null;
}

function matches(calc: CalculatorFixture, query: string): boolean {
  if (!query) return true;
  const haystack = [calc.abbrev, calc.name, calc.indication, calc.summary, domainLabels[calc.domain]]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query) || calc.items.some((item) => item.text.toLowerCase().includes(query));
}

/* ---------- universal-style search composer (top on desktop, docked bottom on phones) ---------- */

// Example searches shown in the composer prompt row; each filters the list.
const promptExamples = ["depression", "anxiety", "drinking", "bipolar", "suicide"];

/**
 * The calculators search composer, matching the app's universal composer: a
 * leading "+" (new search), the query input with an inline clear, and the teal
 * send button. `variant="full"` adds the example ticker line, prompt chips, and
 * privacy notice (desktop header); `variant="compact"` shows the pill plus the
 * privacy line only (phone bottom dock).
 */
function CalculatorComposer({
  query,
  onQuery,
  onReset,
  onSubmit,
  variant,
}: {
  query: string;
  onQuery: (value: string) => void;
  onReset: () => void;
  onSubmit: () => void;
  variant: "full" | "compact";
}) {
  return (
    <div className="grid gap-2">
      {variant === "full" ? (
        <div className="search-example-ticker" aria-live="polite">
          <span>
            Try <span className="search-example-ticker-query">&ldquo;depression severity&rdquo;</span> in Calculators.
          </span>
        </div>
      ) : null}

      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className={cn(chatComposerShellBase, "answer-footer-search-pill relative z-10 w-full")}
      >
        <button
          type="button"
          onClick={onReset}
          aria-label="New search"
          title="New search"
          className={cn(
            "answer-footer-search-action grid shrink-0 place-items-center rounded-full transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--clinical-accent)]",
            focusRing,
          )}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>

        <label className="flex min-w-0 flex-1 items-center overflow-hidden">
          <input
            type="search"
            value={query}
            enterKeyHint="search"
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search calculators by scale, symptom, or indication"
            aria-label="Search calculators"
            className={cn(chatComposerInput, "answer-footer-search-input w-full min-w-0")}
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="Clear search"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <span className="answer-footer-search-divider" aria-hidden="true" />

        <button
          type="submit"
          aria-label="Search calculators"
          className={cn(chatSendButton, "answer-footer-search-send")}
        >
          <Send className="size-icon-lg" aria-hidden="true" />
        </button>
      </form>

      {variant === "full" ? (
        <MockupSuggestionChips
          suggestions={promptExamples}
          onPick={onQuery}
          label="Prompts"
          layout="scroll"
          className="smart-search-prompt-row"
          testId="calculator-prompt-row"
        />
      ) : null}

      <MockupPrivacyInputNotice className="justify-center" />
    </div>
  );
}

/* ---------- home-page-style calculator tile ---------- */

function CalculatorTile({
  calc,
  derived,
  context,
  compact,
  onOpen,
}: {
  calc: CalculatorFixture;
  derived: DerivedCalculator;
  context: string | null;
  compact: boolean;
  onOpen: () => void;
}) {
  const Icon = calc.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${calc.abbrev} — ${calc.name}`}
      className={cn(
        "group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-left shadow-[var(--e2)] transition hover:-translate-y-0.5 hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-raised)] hover:shadow-[var(--shadow-hover)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        focusRing,
      )}
    >
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]",
          compact ? "size-10" : "size-11",
        )}
      >
        <Icon className={compact ? "size-icon-lg" : "size-icon-xl"} aria-hidden="true" />
      </span>

      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-extrabold leading-6 text-[color:var(--text-heading)]">{calc.abbrev}</span>
          <span className="inline-flex min-h-5 items-center rounded-md bg-[color:var(--surface-subtle)] px-1.5 text-3xs font-bold uppercase tracking-[0.06em] text-[color:var(--text-soft)]">
            {domainLabels[calc.domain]}
          </span>
          {derived.started ? (
            <SeverityPill tone={derived.result.tone} label={`${derived.score} · ${derived.result.label}`} />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-2xs font-semibold leading-4 text-[color:var(--text-soft)]">
          {calc.name}
        </span>
        {compact ? null : (
          <span className="mt-2 line-clamp-2 block text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
            {calc.indication}
          </span>
        )}
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <MetaPill icon={ListChecks} label={`${calc.items.length} items`} />
          <MetaPill icon={Clock3} label={calc.timeEstimate} />
          {compact ? null : <MetaPill icon={Sigma} label={`${calc.minScore}–${calc.maxScore}`} />}
        </span>
        {context ? (
          <span className="mt-2 flex min-w-0 items-center gap-1.5 text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
            <Search className="size-icon-xs shrink-0" aria-hidden="true" />
            <span className="truncate">
              Matches item: <span className="italic">“{context}”</span>
            </span>
          </span>
        ) : null}
      </span>

      <ArrowRight
        className="size-icon-md shrink-0 self-center text-[color:var(--text-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
        aria-hidden="true"
      />
    </button>
  );
}

/* ---------- results header band (count + eyebrow + controls) ---------- */

function ResultsHeaderBand({
  count,
  query,
  density,
  onDensity,
}: {
  count: number;
  query: string;
  density: Density;
  onDensity: (next: Density) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--e1)]">
      <div className="flex items-start justify-between gap-3 bg-[color:var(--surface-chrome)] p-3 sm:p-4">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-start gap-3 sm:grid-cols-[3.25rem_minmax(0,1fr)]">
          <span className="hidden size-12 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)] sm:grid">
            <span className="font-mono text-xl font-extrabold leading-none tabular-nums">{count}</span>
          </span>
          <div className="min-w-0">
            <p className={cn(eyebrowText, "hidden text-[color:var(--clinical-accent)] sm:block")}>
              Clinical calculators
            </p>
            <h1 className="text-2xl-minus font-extrabold leading-tight tracking-tight text-[color:var(--text-heading)] sm:mt-0.5 sm:text-3xl">
              {count} {count === 1 ? "calculator" : "calculators"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm font-medium leading-5 text-[color:var(--text-muted)]">
              {query ? (
                <>
                  Matching “<span className="font-semibold text-[color:var(--text)]">{query}</span>”. Open one to score
                  it and see next actions.
                </>
              ) : (
                "Validated psychiatry scores. Open one to score it and see score-linked next actions."
              )}
            </p>
          </div>
        </div>
        <div className="hidden shrink-0 items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-0.5 shadow-[var(--shadow-inset)] sm:inline-flex">
          {(
            [
              ["comfortable", LayoutGrid, "Comfortable"],
              ["compact", Rows3, "Compact"],
            ] as const
          ).map(([value, DensityIcon, label]) => {
            const active = density === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                aria-label={label}
                onClick={() => onDensity(value)}
                className={cn(
                  "grid size-9 place-items-center rounded-md transition",
                  active
                    ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "text-[color:var(--text-soft)] hover:text-[color:var(--text)]",
                  focusRing,
                )}
              >
                <DensityIcon className="size-icon-md" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- right rail ---------- */

function DomainNav({
  domain,
  counts,
  onSelect,
}: {
  domain: DomainFilter;
  counts: Record<string, number>;
  onSelect: (next: DomainFilter) => void;
}) {
  const rows: { id: DomainFilter; label: string; icon: typeof Calculator }[] = [
    { id: "all", label: "All calculators", icon: Calculator },
    ...domainOrder.map((entry) => ({
      id: entry as DomainFilter,
      label: domainLabels[entry],
      icon: domainIcons[entry],
    })),
  ];

  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3 shadow-[var(--e1)]">
      <h2 className={cn(eyebrowText, "px-1 pb-2 text-[color:var(--text-muted)]")}>Browse by domain</h2>
      <div className="grid gap-1">
        {rows.map((row) => {
          const active = domain === row.id;
          const RowIcon = row.icon;
          const count = row.id === "all" ? calculators.length : (counts[row.id] ?? 0);
          return (
            <button
              key={row.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(row.id)}
              className={cn(
                "grid min-h-tap grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border px-2.5 text-left transition",
                active
                  ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]"
                  : "border-transparent hover:bg-[color:var(--surface-subtle)]",
                focusRing,
              )}
            >
              <RowIcon
                className={cn(
                  "size-icon-md",
                  active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-soft)]",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "truncate text-sm-minus font-bold",
                  active ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-heading)]",
                )}
              >
                {row.label}
              </span>
              <span className="font-mono text-2xs font-bold tabular-nums text-[color:var(--text-soft)]">{count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ContinuePanel({
  inProgress,
  onOpen,
}: {
  inProgress: { calc: CalculatorFixture; derived: DerivedCalculator }[];
  onOpen: (calcId: string) => void;
}) {
  if (!inProgress.length) return null;
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--e1)]">
      <h2 className={cn(eyebrowText, "flex items-center gap-1.5 pb-3 text-[color:var(--text-muted)]")}>
        <History className="size-icon-xs" aria-hidden="true" />
        Continue this session
      </h2>
      <div className="grid gap-2">
        {inProgress.map(({ calc, derived }) => (
          <button
            key={calc.id}
            type="button"
            onClick={() => onOpen(calc.id)}
            className={cn(
              "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-left transition hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)]",
              focusRing,
            )}
          >
            <span aria-hidden="true" className={cn("inline-block size-2 rounded-full", toneBar[derived.result.tone])} />
            <span className="min-w-0">
              <span className="block truncate text-sm-minus font-bold text-[color:var(--text-heading)]">
                {calc.abbrev}
                <span className="ml-1.5 font-mono tabular-nums text-[color:var(--text-soft)]">
                  {derived.score}/{calc.maxScore}
                </span>
              </span>
              <span className="block truncate text-2xs font-semibold text-[color:var(--text-soft)]">
                {progressLabel(derived)} · {derived.result.label}
              </span>
            </span>
            <ArrowRight className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function AboutPanel() {
  return (
    <section className="grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-4">
      <h2 className="flex items-center gap-1.5 text-sm-minus font-extrabold text-[color:var(--text-heading)]">
        <Info className="size-icon-sm text-[color:var(--clinical-accent)]" aria-hidden="true" />
        About these tools
      </h2>
      <p className="text-2xs font-medium leading-4 text-[color:var(--text-soft)]">
        Scores support clinical judgement — they never replace a full assessment. Every calculator cites its source and
        maps its result to next clinical actions. Nothing you enter is stored.
      </p>
      <p className="text-2xs font-semibold leading-4 text-[color:var(--text-soft)]">
        {plannedCalculators.length} more calculators (CIWA-Ar, EPDS, COWS) are coming next.
      </p>
    </section>
  );
}

/* ---------- page ---------- */

const filterChips: { id: DomainFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...domainOrder.map((domain) => ({ id: domain as DomainFilter, label: domainLabels[domain] })),
];

export function CalculatorsSearchPageMockup() {
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState<DomainFilter>("all");
  const [density, setDensity] = useState<Density>("comfortable");
  const [session, setSession] = useState<SessionAnswers>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const trimmed = query.trim().toLowerCase();

  const domainCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const calc of calculators) counts[calc.domain] = (counts[calc.domain] ?? 0) + 1;
    return counts;
  }, []);

  const results = useMemo(
    () =>
      calculators
        .filter((calc) => (domain === "all" || calc.domain === domain) && matches(calc, trimmed))
        .map((calc) => ({ calc, context: matchContext(calc, trimmed) })),
    [domain, trimmed],
  );

  const inProgress = useMemo(
    () =>
      calculators
        .map((calc) => ({ calc, derived: deriveCalculator(calc, session[calc.id] ?? {}) }))
        .filter((entry) => entry.derived.started),
    [session],
  );

  const activeCalc = openId ? calculators.find((calc) => calc.id === openId) : undefined;

  useEffect(() => {
    if (!activeCalc) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [activeCalc]);

  // Hide the bottom composer dock on scroll-down in lockstep with the shell's
  // top header, using the same hook (identical thresholds, phone-only, inert on
  // desktop). On phones the shell's #main-content owns vertical scroll
  // (max-sm:overflow-y-auto) and drives the header hide; the inner
  // searchPageShell <main> has no vertical overflow, so it never scrolls. Point
  // the hook at #main-content so the dock reacts to the same scroll events. The
  // hook polls the ref until the shell element resolves.
  const footerHidden = useMockupHideOnScroll();
  // Keep the phone dock visible while focused so scroll-hide cannot slide a
  // focused input off-screen or mark it aria-hidden while still tabbable.
  const [dockFocused, setDockFocused] = useState(false);
  const dockHidden = footerHidden && !dockFocused;

  const compact = density === "compact";

  const submitSearch = () => {
    if (results.length === 1) setOpenId(results[0].calc.id);
  };

  const resetSearch = () => {
    setQuery("");
    setDomain("all");
  };

  return (
    <>
      <MockupSearchResultsLayout
        testId="calculators-search-page"
        resultsLabel="Calculators"
        header={
          <div className="grid gap-3">
            {/* Desktop: universal-style composer at the top, matching the site-wide
                search header. Phones get the docked bottom composer below. */}
            <div className="hidden sm:block">
              <CalculatorComposer
                query={query}
                onQuery={setQuery}
                onReset={resetSearch}
                onSubmit={submitSearch}
                variant="full"
              />
            </div>

            <div className="flex items-center gap-2">
              <div
                className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                aria-label="Filter by domain"
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
                        "inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-xs font-bold transition",
                        active
                          ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)]"
                          : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
                        focusRing,
                      )}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled
                title="Advanced filters are not available in this mockup"
                aria-label="Filters"
                className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-bold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]"
              >
                <SlidersHorizontal className="size-icon-sm" aria-hidden="true" />
                <span className="hidden sm:inline">Filters</span>
              </button>
            </div>
          </div>
        }
        summary={
          <div className="grid gap-3">
            <ShowAllChip
              href={consolidatedModeSearchPath("calculators")}
              icon={Calculator}
              ariaLabel="Show all calculators"
              testId="calculators-show-all"
            />
            <ResultsHeaderBand count={results.length} query={query.trim()} density={density} onDensity={setDensity} />
          </div>
        }
        sidebar={
          <>
            <DomainNav domain={domain} counts={domainCounts} onSelect={setDomain} />
            <ContinuePanel inProgress={inProgress} onOpen={setOpenId} />
            <AboutPanel />
          </>
        }
        sidebarMobile={
          <div className="xl:hidden">
            <AboutPanel />
          </div>
        }
      >
        {results.length ? (
          <div className={cn("grid gap-3", compact ? "sm:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2")}>
            {results.map(({ calc, context }) => (
              <CalculatorTile
                key={calc.id}
                calc={calc}
                derived={deriveCalculator(calc, session[calc.id] ?? {})}
                context={context}
                compact={compact}
                onOpen={() => setOpenId(calc.id)}
              />
            ))}
          </div>
        ) : (
          <div className="grid justify-items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-8 text-center">
            <span className="grid size-11 place-items-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-soft)]">
              <Search className="size-icon-lg" aria-hidden="true" />
            </span>
            <p className="text-base font-bold text-[color:var(--text-heading)]">
              No calculators match “{query.trim()}”.
            </p>
            <p className="max-w-sm text-sm-minus font-medium text-[color:var(--text-muted)]">
              Try a symptom (“hopeless”, “drinking”, “worry”) or clear the filters.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setDomain("all");
              }}
              className={cn(
                "mt-1 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[color:var(--clinical-accent)] px-4 text-sm-minus font-bold text-[color:var(--clinical-accent-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--clinical-accent-hover)]",
                focusRing,
              )}
            >
              Reset search
            </button>
          </div>
        )}
      </MockupSearchResultsLayout>

      {/* Phones: composer docks at the bottom, matching the site-wide composer
          placement, and slides away on scroll-down in lockstep with the header.
          Hidden while a calculator sheet is open. */}
      {activeCalc ? null : (
        <div
          data-testid="calculators-phone-dock"
          onFocusCapture={() => setDockFocused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDockFocused(false);
          }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--border)] bg-[color:var(--surface-glass)] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md transition-transform duration-200 ease-out motion-reduce:transition-none sm:hidden",
            dockHidden ? "translate-y-full" : "translate-y-0",
          )}
          aria-hidden={dockHidden}
          inert={dockHidden || undefined}
        >
          <CalculatorComposer
            query={query}
            onQuery={setQuery}
            onReset={resetSearch}
            onSubmit={submitSearch}
            variant="compact"
          />
        </div>
      )}

      {activeCalc ? (
        <CalculatorSheet
          calc={activeCalc}
          answers={session[activeCalc.id] ?? {}}
          onAnswersChange={(next) => setSession((prev) => ({ ...prev, [activeCalc.id]: next }))}
          onClose={() => setOpenId(null)}
          onOpenCalculator={setOpenId}
        />
      ) : null}
    </>
  );
}
