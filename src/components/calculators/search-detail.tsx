"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Clock3, History, Info, ListChecks, Search, Sigma } from "lucide-react";
import { useMemo, useState } from "react";

import { ModeHomeHero } from "@/components/mode-home-template";
import { ShowAllChip } from "@/components/show-all-chip";
import { MissingValue } from "@/components/ui/missing-value";
import { appModeIcons } from "@/lib/app-mode-icons";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import { sharedHomePresentation } from "@/lib/ui-copy";
import { chatComposerInput, chatComposerShell, chatSendButton, cn, eyebrowText } from "@/components/ui-primitives";

import {
  calculators,
  domainLabels,
  domainOrder,
  type CalculatorDomain,
  type CalculatorFixture,
} from "./calculator-fixtures";
import { partitionEvidenceSources, type CalculatorEvidenceSource } from "./calculator-evidence";
import { actionsForBand } from "./calculator-pathways";
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
  toneBar,
  type AnswerMap,
  type DerivedCalculator,
} from "./calculator-ui";

type DomainFilter = CalculatorDomain | "all";
export type SessionAnswers = Record<string, AnswerMap>;

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
            <span className="inline-flex min-h-5 items-center rounded-md bg-[color:var(--surface-subtle)] px-1.5 text-3xs font-bold uppercase tracking-label text-[color:var(--text-muted)]">
              {domainLabels[calc.domain]}
            </span>
          </span>
          <span className="mt-0.5 block text-xs font-semibold leading-5 text-[color:var(--text-muted)]">
            {calc.name}
          </span>
        </span>
        <ArrowUpRight
          className="size-icon-md shrink-0 text-[color:var(--decoration-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
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
          <span className="truncate text-2xs font-semibold text-[color:var(--text-muted)]">{calc.name}</span>
          <StartedChip derived={derived} />
        </span>
        <span className="mt-0.5 block truncate text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
          {calc.indication}
        </span>
        {context ? (
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
            <Search className="size-icon-xs shrink-0 text-[color:var(--decoration-soft)]" aria-hidden="true" />
            <span className="truncate">
              Matches item: <span className="italic">“{context}”</span>
            </span>
          </span>
        ) : null}
      </span>
      <ArrowRight
        className="size-icon-md shrink-0 text-[color:var(--decoration-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
        aria-hidden="true"
      />
    </button>
  );
}

const filterChips: { id: DomainFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...domainOrder.map((domain) => ({ id: domain as DomainFilter, label: domainLabels[domain] })),
];

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
      <ModeHomeHero
        testId="calculators-search"
        title={sharedHomePresentation.calculators.title}
        subtitle={sharedHomePresentation.calculators.subtitle}
        icon={appModeIcons.calculators}
      />

      <ShowAllChip
        href={consolidatedModeSearchPath("calculators")}
        icon={appModeIcons.calculators}
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
        <span className="grid size-tap shrink-0 place-items-center text-[color:var(--decoration-soft)]">
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
                "inline-flex min-h-tap shrink-0 items-center rounded-lg border px-3 text-sm-minus font-bold transition lg:min-h-compact-meta",
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

      <p className="text-center text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
        Calculator answers remain in this browser session and are not intentionally submitted by this calculator
        interface. The app’s usage logs, and anything you document in the clinical record, are covered separately.
      </p>
    </main>
  );
}

/* ---------- detail view: score-linked panels ---------- */

function EvidenceLinkList({ sources }: { sources: CalculatorEvidenceSource[] }) {
  return (
    <>
      {sources.map((source, sourceIndex) => (
        <span key={source.id}>
          {sourceIndex ? ", " : null}
          <a href={source.url} className="underline underline-offset-2">
            {source.title}
          </a>
        </span>
      ))}
    </>
  );
}

/**
 * The governance reference is named, not linked (owner decision 2026-09-25,
 * #XSZ4XV): its target is a private engineering record a clinician cannot open,
 * so a link would only lead to a sign-in wall.
 */
function GovernanceReferenceList({ sources }: { sources: CalculatorEvidenceSource[] }) {
  return <>{sources.map((source) => source.title).join(", ")}</>;
}

/**
 * The internal governance record rides on every instrument's `sourceIds`, so it
 * would otherwise print beside a validation study as clinical evidence. It is
 * kept, as plain text, under its own label.
 */
function ActionEvidenceLines({ sourceIds }: { sourceIds: string[] }) {
  const { clinical, governance } = partitionEvidenceSources(sourceIds);
  if (!clinical.length && !governance.length) return null;

  return (
    <>
      {clinical.length ? (
        <span className="mt-0.5 block text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
          Sources: <EvidenceLinkList sources={clinical} />
        </span>
      ) : null}
      {governance.length ? (
        <span className="mt-0.5 block text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
          Governance reference: <GovernanceReferenceList sources={governance} />
        </span>
      ) : null}
    </>
  );
}

export function NextActionsPanel({ calc, derived }: { calc: CalculatorFixture; derived: DerivedCalculator }) {
  const actions = actionsForBand(calc, derived);

  return (
    <section
      aria-label="Clinical considerations"
      className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--e2)]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className={cn(eyebrowText, "text-[color:var(--text-muted)]")}>Clinical considerations</h2>
      </div>

      <FlagNotice flags={derived.flags} provisional={!derived.complete} />

      {!derived.complete ? (
        <p className="rounded-md bg-[color:var(--surface-inset)] p-2.5 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
          Answer every item before source-linked clinical considerations are shown.
        </p>
      ) : (
        <>
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
                  <ActionEvidenceLines sourceIds={action.sourceIds} />
                </span>
              </li>
            ))}
          </ol>
          {derived.band ? (
            <p className="flex flex-wrap items-center gap-1.5 border-t border-[color:var(--border)] pt-2.5 text-2xs font-semibold text-[color:var(--text-muted)]">
              Completed result:
              <SeverityPill tone={derived.result.tone} label={derived.result.label} />— updates automatically as the
              score changes.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function ScorePanel({
  calc,
  derived,
  onReset,
}: {
  calc: CalculatorFixture & { disclaimer?: string };
  derived: DerivedCalculator;
  onReset: () => void;
}) {
  const { clinical: evidenceSources, governance: governanceSources } = partitionEvidenceSources(calc.sourceIds);

  return (
    <section
      aria-label="Score"
      className="grid content-start gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 shadow-[var(--e2)]"
    >
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className={cn(eyebrowText, "text-[color:var(--text-muted)]")}>Score</p>
          {/* Unstarted is not a missing score: no score exists yet, so the fraction has no numerator. The scale's own
              endpoints stay visible in the ScoreBandBar directly below. */}
          {derived.started ? (
            <p className="font-mono text-2xl font-extrabold tabular-nums leading-8 text-[color:var(--text-heading)]">
              {derived.score}
              <span className="text-sm font-bold text-[color:var(--text-muted)]"> / {calc.maxScore}</span>
            </p>
          ) : (
            <p>
              <MissingValue reason="not_yet_calculated" />
            </p>
          )}
        </div>
        <SeverityPill tone={derived.result.tone} label={derived.started ? derived.result.label : "Not started"} />
      </div>
      <ScoreBandBar calc={calc} score={derived.score} started={derived.started} />
      <p className="text-2xs font-semibold leading-4 text-[color:var(--text-muted)]">{progressLabel(derived)}</p>
      <BandLegend calc={calc} activeBand={derived.started ? derived.band : undefined} />
      <div className="grid gap-2 border-t border-[color:var(--border)] pt-3">
        <p className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
          <Info className="mt-0.5 size-icon-xs shrink-0 text-[color:var(--decoration-soft)]" aria-hidden="true" />
          {calc.scoringNote}
        </p>
        <div className="flex items-center justify-between gap-2">
          <CopyResultButton calc={calc} state={derived} />
          <ResetButton onReset={onReset} disabled={!derived.started} />
        </div>
        {evidenceSources.length ? (
          <p className="text-3xs font-semibold text-[color:var(--text-muted)]">
            Sources: <EvidenceLinkList sources={evidenceSources} />
          </p>
        ) : null}
        {governanceSources.length ? (
          <p className="text-3xs font-semibold text-[color:var(--text-muted)]">
            Governance reference: <GovernanceReferenceList sources={governanceSources} />
          </p>
        ) : null}
        <p className="text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
          {calc.disclaimer ??
            "Clinical reference — not validated decision support. Confirm scoring and interpretation against the source instrument."}
        </p>
      </div>
    </section>
  );
}

/* ---------- detail view ---------- */

export function CalculatorDetailHeader({ calc }: { calc: CalculatorFixture }) {
  return (
    <header className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--e2)] sm:p-5">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span className="grid size-tap shrink-0 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)] sm:size-12">
          <calc.icon className="size-icon-xl" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl-minus font-extrabold leading-7 text-[color:var(--text-heading)]">{calc.abbrev}</h1>
            <span className="inline-flex min-h-5 items-center rounded-md bg-[color:var(--surface-subtle)] px-1.5 text-3xs font-bold uppercase tracking-label text-[color:var(--text-muted)]">
              {domainLabels[calc.domain]}
            </span>
          </div>
          <p className="mt-0.5 text-sm-minus font-semibold text-[color:var(--text-muted)]">{calc.name}</p>
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
}: {
  calc: CalculatorFixture & { disclaimer?: string };
  answers: AnswerMap;
  onAnswersChange: (next: AnswerMap) => void;
  onBack: () => void;
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
          {derived.started ? (
            <span className="font-mono text-lg font-extrabold tabular-nums text-[color:var(--text-heading)]">
              {derived.score}
              <span className="text-sm-minus font-bold text-[color:var(--text-muted)]"> / {calc.maxScore}</span>
            </span>
          ) : (
            <MissingValue reason="not_yet_calculated" />
          )}
          <SeverityPill tone={derived.result.tone} label={derived.started ? derived.result.label : "Not started"} />
        </div>
        <ScoreBandBar calc={calc} score={derived.score} started={derived.started} />
        <p className="text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
          {calc.disclaimer ??
            "Clinical reference — not validated decision support. Confirm scoring and interpretation against the source instrument."}
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <CalculatorItems calc={calc} answers={answers} onAnswersChange={onAnswersChange} />
        <aside className="grid content-start gap-4 lg:sticky lg:top-4 lg:self-start">
          <ScorePanel calc={calc} derived={derived} onReset={() => onAnswersChange({})} />
          <NextActionsPanel calc={calc} derived={derived} />
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
        />
      ) : (
        <CalculatorSearchHome session={session} onOpen={openCalculator} />
      )}
    </div>
  );
}
