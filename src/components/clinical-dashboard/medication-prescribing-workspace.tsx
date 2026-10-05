"use client";

import {
  Activity,
  Ban,
  CalendarDays,
  CircleCheck,
  ChevronRight,
  FileSearch,
  Lock,
  Pill,
  SearchX,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { ModeHomeTemplate } from "@/components/mode-home-template";
import { appModeIcons } from "@/lib/app-mode-icons";
import { appModeHomeHref } from "@/lib/app-modes";
import { sharedHomePresentation } from "@/lib/ui-copy";
import { RetainedSnapshotNotice } from "@/components/clinical-dashboard/dashboard-notices";
import { SearchResultsHeaderBand } from "@/components/clinical-dashboard/search-results-header-band";
import {
  ResultFilterSheet,
  ResultFilterTrigger,
  resultFilterFacetGroup,
  resultFilterGroup,
} from "@/components/clinical-dashboard/result-filter-control";
import { UniversalSearchAlsoMatches } from "@/components/clinical-dashboard/universal-search-also-matches";
import {
  medicationVerdictRingClass,
  PatientVerdictSignal,
} from "@/components/clinical-dashboard/medication-considerations";
import { usePatientProfile } from "@/components/clinical-dashboard/patient-profile-context";
import { PatientDetailsDockAction } from "@/components/clinical-dashboard/patient-details-dock-action";
import { PatientProfilePanel } from "@/components/clinical-dashboard/patient-profile-panel";
import {
  useMedicationCatalog,
  type MedicationCatalogInterpretation,
} from "@/components/clinical-dashboard/use-medication-catalog";
import {
  composeMedicationVerdict,
  evaluateMedicationInteractions,
  type MedicationVerdict,
} from "@/lib/medication-interactions";
import { evaluatePatientAlerts } from "@/lib/medication-patient-alerts";
import {
  BadgeCluster,
  ClinicalBadge,
  type ClinicalBadgeItem,
  type ClinicalBadgeTone,
} from "@/components/clinical-dashboard/clinical-badge";
import { medicationIdentityBadges, type MedicationRecord } from "@/lib/medications";
import {
  medicationMatchValues,
  medicationRowMatchesFilters,
  medicationScopeValues,
  medicationSignalValues,
  type MedicationClinicalSignal,
  type MedicationMatchQuality,
  type MedicationScope,
} from "@/lib/medication-filters";
import {
  readResultFilterValue,
  readResultFilterValues,
  replaceResultFilterUrl,
  writeResultFilterValue,
  writeResultFilterValues,
} from "@/lib/result-filter-url";
import { SEMANTIC_TONE_META } from "@/lib/semantic-tone";
import { isDeployedClinicalKb } from "@/lib/deployed-app";
import { cn, EmptyState, pageContainer } from "@/components/ui-primitives";

type MedicationPrescribingWorkspaceProps = {
  query: string;
  loading: boolean;
  realDataReady: boolean;
  authUnavailable: boolean;
  apiUnavailable: boolean;
  setupWarning: string | null;
  onSuggestedSearch: (searchText: string) => void;
};

type Capability = {
  label: string;
  description: string;
  query: string;
  icon: LucideIcon;
};

type MedicationResult = {
  id: string;
  name: string;
  indication: string;
  match: string;
  dose: string;
  ceiling: string;
  action: string;
  actionTone: "danger" | "warning" | "neutral";
  tone: "teal" | "blue" | "slate";
  href?: string;
};

type MedicationRow = {
  result: MedicationResult;
  medication?: MedicationRecord;
  drugClass: string;
  badges: ClinicalBadgeItem[];
  /** Per-medication (drug-class) identity accent hex, for a subtle icon tint. */
  accent?: string;
  /** Composed patient verdict; absent when no patient profile is entered. */
  verdict?: MedicationVerdict;
};

const medicationMatchOptions: ReadonlyArray<{ value: MedicationMatchQuality; label: string }> = [
  { value: "all", label: "All qualities" },
  { value: "exact", label: "Exact clinical fit" },
  { value: "good", label: "Good clinical fit" },
  { value: "related", label: "Related match" },
];

const medicationSignalOptions: ReadonlyArray<{ value: MedicationClinicalSignal; label: string }> = [
  { value: "safety", label: "Safety" },
  { value: "monitoring", label: "Monitoring" },
];

const medicationCapabilities: Capability[] = [
  {
    label: "Dose",
    description: "Dosing and adjustment",
    query: "medication dose adjustment",
    icon: CalendarDays,
  },
  {
    label: "Safety",
    description: "Contraindications and cautions",
    query: "medication contraindications and cautions",
    icon: ShieldCheck,
  },
  {
    label: "Monitoring",
    description: "Baseline and follow-up",
    query: "medication baseline and follow-up monitoring",
    icon: Activity,
  },
  {
    label: "Access",
    description: "PBS and brand",
    query: "medication PBS access and brand availability",
    icon: Lock,
  },
];

const medicationPrompts = [
  {
    label: "acamprosate renal dose",
    description: "Check renal dosing and contraindications.",
    icon: Pill,
  },
  {
    label: "naltrexone opioid use",
    description: "Review opioid-use precautions before prescribing.",
    icon: UserRound,
  },
  {
    label: "sertraline max dose",
    description: "Check maximum dose and titration guidance.",
    icon: ShieldCheck,
  },
];

function IconTile({
  icon: Icon,
  tone = "teal",
  className,
}: {
  icon: LucideIcon;
  tone?: "teal" | "blue" | "slate" | "danger";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg border shadow-[var(--shadow-inset)]",
        tone === "teal" &&
          "border-[color:var(--clinical-accent)]/20 bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
        tone === "blue" &&
          "border-[color:var(--info-border)]/60 bg-[color:var(--info-bg)] text-[color:var(--info-text)]",
        tone === "slate" &&
          "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
        tone === "danger" &&
          "border-[color:var(--danger-border)]/70 bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]",
        className,
      )}
    >
      <Icon className="h-[54%] w-[54%]" aria-hidden="true" />
    </span>
  );
}

function StatusNotice({
  realDataReady,
  authUnavailable,
  apiUnavailable,
  setupWarning,
  className,
}: Pick<
  MedicationPrescribingWorkspaceProps,
  "realDataReady" | "authUnavailable" | "apiUnavailable" | "setupWarning"
> & {
  className?: string;
}) {
  if (realDataReady && !authUnavailable && !apiUnavailable && !setupWarning) return null;
  const message = authUnavailable
    ? isDeployedClinicalKb()
      ? "Sign in to search your private medication library."
      : "Private medication search is waiting for sign-in."
    : apiUnavailable
      ? isDeployedClinicalKb()
        ? "Medication search is temporarily unavailable. Try again shortly."
        : "Medication search is using the local mockup while the API is unavailable."
      : setupWarning || "Medication search setup is still warming up.";

  return (
    <div
      className={cn(
        "mx-auto max-w-2xl rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 text-center text-xs font-medium text-[color:var(--text-muted)]",
        className,
      )}
    >
      {message}
    </div>
  );
}

/**
 * A misspelt medicine name (Medicines mock-up v6, screen 3; owner decision 2 of
 * 5 Oct 2026): say plainly there is no medicine by the typed name and suggest
 * the corrected one as a link, never swapping it silently, because look-alike
 * medicine names are a known error source.
 */
function MedicationDidYouMean({
  query,
  correctedQuery,
  expansions,
}: {
  query: string;
  correctedQuery: string;
  expansions: readonly string[];
}) {
  return (
    <div className="medication-results-inset">
      <p data-testid="medication-query-interpretation" className="text-sm leading-6 text-[color:var(--text-heading)]">
        No medicine called <strong className="font-semibold">{query}</strong>. Did you mean{" "}
        <Link
          href={appModeHomeHref("prescribing", { query: correctedQuery, run: true })}
          className="font-semibold text-[color:var(--clinical-accent)] underline underline-offset-2"
        >
          {correctedQuery}
        </Link>
        ?
      </p>
      {expansions.length ? (
        <p className="mt-0.5 text-xs leading-snug text-[color:var(--text-muted)]">
          Related terms were also included: {expansions.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

function MedicationInterpretationChip({
  query,
  interpretation,
}: {
  query: string;
  interpretation?: MedicationCatalogInterpretation;
}) {
  const correctedQuery = interpretation?.correctedQuery?.trim();
  const hasCorrection = Boolean(correctedQuery) && correctedQuery?.toLowerCase() !== query.trim().toLowerCase();
  const expansions = Array.from(
    new Set(interpretation?.appliedExpansions?.map((term) => term.trim()).filter(Boolean) ?? []),
  );
  if (hasCorrection && correctedQuery) {
    return <MedicationDidYouMean query={query.trim()} correctedQuery={correctedQuery} expansions={expansions} />;
  }
  if (expansions.length === 0) return null;

  const displayTerms = expansions.slice(0, 3).join(", ");
  const hiddenExpansionCount = Math.max(0, expansions.length - 3);
  const leadingLabel = "Search also included";
  const accessibleLabel = `Search also included related terms: ${expansions.join(", ")}.`;

  return (
    <div className="medication-results-inset">
      <p
        role="note"
        aria-label={accessibleLabel}
        title={accessibleLabel}
        data-testid="medication-query-interpretation"
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 py-1 text-2xs font-semibold text-[color:var(--clinical-accent)]"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0">{leadingLabel}</span>
        <span aria-hidden="true">·</span>
        <span className="min-w-0 truncate">{displayTerms}</span>
        {hiddenExpansionCount ? <span className="shrink-0">+{hiddenExpansionCount}</span> : null}
      </p>
    </div>
  );
}

/**
 * Nothing matched (mock-up v6, screen 4): what was searched, why it may have
 * failed, and two ways forward: the reader's own PDFs, or the full list with
 * its real count. Never a dead end.
 */
function MedicationNothingFound({
  query,
  catalogueCount,
  onBrowseAll,
}: {
  query: string;
  catalogueCount: number;
  onBrowseAll: () => void;
}) {
  const trimmed = query.trim();
  const title =
    catalogueCount > 0
      ? `No medicine called \u201c${trimmed}\u201d in PsychSift\u2019s list of ${catalogueCount.toLocaleString("en-AU")}`
      : `No medicine called \u201c${trimmed}\u201d`;
  return (
    <div className="medication-results-inset grid gap-3" data-testid="medication-nothing-found">
      <EmptyState
        icon={SearchX}
        title={title}
        body="Check the spelling. It may also be in your own PDFs, or listed under a brand or generic name."
        live="polite"
      />
      <ul role="list" className="grid">
        <li className="min-w-0 border-t border-[color:var(--border)] first:border-t-0">
          <Link
            href={appModeHomeHref("documents", { query: trimmed, run: true })}
            className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg py-2 text-[color:var(--text-heading)] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <FileSearch className="size-icon-md shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
            <span className="grid min-w-0 gap-0.5">
              <span className="break-words text-sm font-semibold leading-snug">Search your PDFs for {trimmed}</span>
              <span className="text-xs leading-snug text-[color:var(--text-muted)]">Opens Documents</span>
            </span>
            <ChevronRight className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
          </Link>
        </li>
        <li className="min-w-0 border-t border-[color:var(--border)] first:border-t-0">
          <button
            type="button"
            onClick={onBrowseAll}
            data-testid="medication-browse-all"
            className="grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg py-2 text-left text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <Pill className="size-icon-md shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
            <span className="break-words text-sm font-semibold leading-snug">Browse all medicines</span>
            <span className="nums text-sm text-[color:var(--text-muted)]">
              {catalogueCount > 0 ? catalogueCount.toLocaleString("en-AU") : null}
            </span>
            <ChevronRight className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
  );
}

function MedicationHome({
  loading,
  realDataReady,
  authUnavailable,
  apiUnavailable,
  setupWarning,
  onSuggestedSearch,
  desktopComposerSlotId,
}: Omit<MedicationPrescribingWorkspaceProps, "query"> & { desktopComposerSlotId?: string }) {
  return (
    <ModeHomeTemplate
      testId="medication-home"
      title={sharedHomePresentation.prescribing.title}
      subtitle={sharedHomePresentation.prescribing.subtitle}
      icon={appModeIcons.prescribing}
      headingLevel={2}
      desktopComposerSlotId={desktopComposerSlotId}
      actionsLabel="Medication prompts"
      actions={medicationPrompts.map((prompt) => ({
        title: prompt.label,
        description: prompt.description,
        icon: prompt.icon,
        onClick: () => onSuggestedSearch(prompt.label),
        disabled: loading,
        testId: `medication-prompt-${prompt.label.split(" ")[0]}`,
      }))}
      pillsTitle="Medication checks"
      pills={medicationCapabilities.map((item) => ({
        label: item.label,
        icon: item.icon,
        onClick: () => onSuggestedSearch(item.query),
      }))}
      footer={
        <StatusNotice
          realDataReady={realDataReady}
          authUnavailable={authUnavailable}
          apiUnavailable={apiUnavailable}
          setupWarning={setupWarning}
        />
      }
    />
  );
}

function ResultToneIcon({ result, accent }: { result: MedicationResult; accent?: string }) {
  const tone = result.tone === "teal" ? "teal" : result.tone === "blue" ? "blue" : "slate";
  if (accent) {
    // Decorative per-medication (class) accent tint; a soft wash + border keeps
    // it legible in light and dark without carrying semantic meaning.
    return (
      <span
        aria-hidden="true"
        style={{
          background: `color-mix(in srgb, ${accent} 12%, var(--surface))`,
          borderColor: `color-mix(in srgb, ${accent} 34%, var(--surface))`,
          color: accent,
        }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border shadow-[var(--shadow-inset)]"
      >
        <Pill className="h-[54%] w-[54%]" aria-hidden="true" />
      </span>
    );
  }
  return <IconTile icon={Pill} tone={tone} className="h-9 w-9" />;
}

const matchBadgeTone: Record<MedicationResult["tone"], ClinicalBadgeTone> = {
  teal: "clinical",
  blue: "info",
  slate: "neutral",
};

function ResultMatchBadge({ result }: { result: MedicationResult }) {
  return <ClinicalBadge label={result.match} tone={matchBadgeTone[result.tone]} icon={CircleCheck} />;
}

// Small leading icon for the prescribing-action text: contraindication content is
// a quiet stop signal (Ban, danger colour), monitoring content a check-first
// caution (TriangleAlert, warning colour). The text itself stays heading-coloured
// so red remains reserved and readable per the badge governance guide.
function ActionToneIcon({ tone, className }: { tone: MedicationResult["actionTone"]; className?: string }) {
  if (tone === "neutral") return null;
  const Icon = tone === "danger" ? Ban : TriangleAlert;
  return (
    <>
      <span className="sr-only">{SEMANTIC_TONE_META[tone].ariaPrefix}: </span>
      <Icon
        className={cn(
          "shrink-0",
          tone === "danger" ? "text-[color:var(--danger-text)]" : "text-[color:var(--warning-text)]",
          className,
        )}
        aria-hidden="true"
      />
    </>
  );
}

// Highlight the first query token inside the medication name when it is a plain
// substring match; synonym/expanded matches simply render unhighlighted.
function HighlightedName({ text, term }: { text: string; term: string }) {
  const token = term.trim().split(/\s+/)[0] ?? "";
  if (token.length < 2) return <>{text}</>;
  const index = text.toLowerCase().indexOf(token.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-[color:var(--clinical-accent-soft)] px-0.5 text-inherit">
        {text.slice(index, index + token.length)}
      </mark>
      {text.slice(index + token.length)}
    </>
  );
}

function MaximumDose({ value }: { value: string }) {
  return (
    <span className="inline-grid min-h-6 min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-2xs font-semibold text-[color:var(--text-muted)]">
      <span className="rounded border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-1.5 py-0.5 text-2xs uppercase tracking-label text-[color:var(--text-muted)]">
        Max
      </span>
      <span className="nums min-w-0 break-words leading-5 text-[color:var(--text-heading)]">{value}</span>
    </span>
  );
}

function MedicationResults({
  query,
  realDataReady,
  authUnavailable,
  apiUnavailable,
  setupWarning,
}: Pick<
  MedicationPrescribingWorkspaceProps,
  "query" | "realDataReady" | "authUnavailable" | "apiUnavailable" | "setupWarning"
>) {
  // Debounced + aborted fetches (see useMedicationCatalog) stop keystroke storms.
  // Keep the full catalogue payload here: Safety/Monitoring chips and patient
  // alerts need sections/stats/quick that `fields=index` strips. Cross-mode
  // identity consumers still use `fields=index`.
  const catalog = useMedicationCatalog(query);
  const { profile, isEmpty: profileEmpty } = usePatientProfile();
  const searchParams = useSearchParams();
  const filterPanelId = useId();
  const [filterOpen, setFilterOpen] = useState(false);
  const { bestRows, allRows } = useMemo(() => {
    const governance = catalog.data?.governance;
    const toRow = (result: MedicationResult, medication?: MedicationRecord): MedicationRow => {
      const badges = medication ? medicationIdentityBadges(medication, governance?.[medication.slug]) : [];
      const accent = medication?.accent;
      const drugClass = medication?.class || medication?.category || "Other";
      // The dedicated patient verdict band stays separate from match quality and
      // catalogue metadata. The verdict folds BOTH engines together — physiology
      // considerations and interactions against the entered medication list —
      // and degrades a would-be green to grey whenever either engine left
      // something unassessed.
      if (medication && !profileEmpty) {
        const alerts = evaluatePatientAlerts(medication, profile);
        const interactions = evaluateMedicationInteractions(medication.slug, profile.medications ?? [], medication);
        const verdict = composeMedicationVerdict({
          considerationTone: alerts.highestTone,
          considerationCount: alerts.considerations.length,
          unassessedCount: alerts.unassessed.length,
          interactionTone: interactions.highestTone,
          interactionCount: interactions.interactions.length,
          unresolvedRowCount: interactions.unresolvedRowCount,
          unreachableCounterpartyCount: interactions.unreachableCounterparties.length,
        });
        return {
          result,
          medication,
          drugClass,
          badges,
          accent,
          verdict,
        };
      }
      return { result, medication, drugClass, badges, accent };
    };
    const ranked = catalog.data?.matches?.map((match) => toRow(match.result, match.medication)) ?? [];
    const rankedSlugs = new Set(ranked.map((row) => row.medication?.slug ?? row.result.id));
    // Widening to the full catalogue must not reshuffle the ranked query
    // matches. Keep them in provider rank order, then append catalogue-only
    // records in catalogue order.
    const complete = [
      ...ranked,
      ...(catalog.data?.records ?? [])
        .filter((record) => !rankedSlugs.has(record.slug))
        .map((record) =>
          toRow(
            {
              id: record.slug,
              name: record.name,
              indication: record.subclass || record.category,
              match: "Catalogue match",
              dose: "See reference",
              ceiling: "See reference",
              action: "Open full prescribing reference.",
              actionTone: "neutral" as const,
              tone: "slate" as const,
              href: `/medications/${record.slug}`,
            },
            record,
          ),
        ),
    ];
    return { bestRows: ranked, allRows: complete };
  }, [catalog.data, profile, profileEmpty]);

  const scope = readResultFilterValue(searchParams, "scope", medicationScopeValues, "best");
  const matchFilter = readResultFilterValue(searchParams, "match", medicationMatchValues, "all");
  const classValues = useMemo(
    () =>
      [...new Set(allRows.map((row) => row.drugClass).filter(Boolean))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [allRows],
  );
  const classValueSet = useMemo(() => new Set(classValues), [classValues]);
  const classFilters = useMemo(
    () => new Set(readResultFilterValues(searchParams, "class", classValueSet)),
    [classValueSet, searchParams],
  );
  const signalFilters = useMemo(
    () => new Set(readResultFilterValues(searchParams, "signal", medicationSignalValues)),
    [searchParams],
  );

  const { rows, scopeCounts, matchCounts, classCounts, signalCounts, totalAvailable } = useMemo(() => {
    const filters = { match: matchFilter, classes: classFilters, signals: signalFilters };
    const rowsForScope = (nextScope: MedicationScope) => (nextScope === "best" ? bestRows : allRows);
    const matches = (candidateRows: MedicationRow[], candidateFilters = filters) =>
      candidateRows.filter((row) => medicationRowMatchesFilters(row, candidateFilters));
    const baseRows = rowsForScope(scope);
    const visible = matches(baseRows);

    return {
      rows: visible,
      totalAvailable: baseRows.length,
      scopeCounts: {
        best: matches(bestRows).length,
        all: matches(allRows).length,
      } satisfies Record<MedicationScope, number>,
      matchCounts: Object.fromEntries(
        medicationMatchOptions.map((option) => [
          option.value,
          matches(baseRows, { ...filters, match: option.value }).length,
        ]),
      ) as Record<MedicationMatchQuality, number>,
      classCounts: Object.fromEntries(
        classValues.map((drugClass) => {
          const projected = classFilters.has(drugClass) ? classFilters : new Set([...classFilters, drugClass]);
          return [drugClass, matches(baseRows, { ...filters, classes: projected }).length];
        }),
      ) as Record<string, number>,
      signalCounts: Object.fromEntries(
        medicationSignalOptions.map((option) => {
          const projected = signalFilters.has(option.value) ? signalFilters : new Set([...signalFilters, option.value]);
          return [option.value, matches(baseRows, { ...filters, signals: projected }).length];
        }),
      ) as Record<MedicationClinicalSignal, number>,
    };
  }, [allRows, bestRows, classFilters, classValues, matchFilter, scope, signalFilters]);

  const setScope = (value: MedicationScope) =>
    replaceResultFilterUrl((params) => writeResultFilterValue(params, "scope", value, "best", medicationScopeValues));
  const setMatchFilter = (value: MedicationMatchQuality) =>
    replaceResultFilterUrl((params) => writeResultFilterValue(params, "match", value, "all", medicationMatchValues));
  const toggleClass = (value: string) => {
    if (classValueSet.size === 0) return;
    replaceResultFilterUrl((params) => {
      const next = new Set(readResultFilterValues(params, "class", classValueSet));
      if (!next.delete(value)) next.add(value);
      writeResultFilterValues(params, "class", next, classValueSet);
    });
  };
  const toggleSignal = (value: MedicationClinicalSignal) => {
    replaceResultFilterUrl((params) => {
      const next = new Set(readResultFilterValues(params, "signal", medicationSignalValues));
      if (!next.delete(value)) next.add(value);
      writeResultFilterValues(params, "signal", next, medicationSignalValues);
    });
  };
  const clearFilters = () =>
    replaceResultFilterUrl((params) => {
      params.delete("scope");
      params.delete("match");
      params.delete("class");
      params.delete("signal");
    });

  const resultCount = rows.length;
  const activeFilterCount =
    (scope === "best" ? 0 : 1) + (matchFilter === "all" ? 0 : 1) + classFilters.size + signalFilters.size;
  const filterGroups = [
    resultFilterGroup({
      id: "match-quality",
      label: "Match quality",
      value: matchFilter,
      options: medicationMatchOptions.map((option) => ({
        ...option,
        hint: String(matchCounts[option.value]),
        disabled: option.value !== matchFilter && matchCounts[option.value] === 0,
      })),
      onChange: setMatchFilter,
    }),
    resultFilterFacetGroup({
      id: "drug-class",
      label: "Drug class",
      selected: classFilters,
      options: classValues.map((value) => ({
        value,
        label: value,
        hint: String(classCounts[value] ?? 0),
        disabled: !classFilters.has(value) && (classCounts[value] ?? 0) === 0,
      })),
      onToggle: toggleClass,
    }),
    resultFilterFacetGroup({
      id: "clinical-signal",
      label: "Clinical signal",
      description: "Safety and monitoring are one OR group; choosing either keeps records with that signal.",
      selected: signalFilters,
      options: medicationSignalOptions.map((option) => ({
        ...option,
        hint: String(signalCounts[option.value]),
        disabled: !signalFilters.has(option.value) && signalCounts[option.value] === 0,
      })),
      onToggle: toggleSignal,
    }),
  ];
  const appliedFilters = [
    ...(scope === "all"
      ? [
          {
            id: "scope",
            groupLabel: "Search in",
            valueLabel: "All medications",
            accessibleLabel: "Search in all medications",
            onRemove: () => setScope("best"),
          },
        ]
      : []),
    ...(matchFilter === "all"
      ? []
      : [
          {
            id: "match",
            groupLabel: "Match",
            valueLabel: medicationMatchOptions.find((option) => option.value === matchFilter)?.label ?? matchFilter,
            onRemove: () => setMatchFilter("all"),
          },
        ]),
    ...[...classFilters].map((value) => ({
      id: `class-${value}`,
      groupLabel: "Class",
      valueLabel: value,
      onRemove: () => toggleClass(value),
    })),
    ...[...signalFilters].map((value) => ({
      id: `signal-${value}`,
      groupLabel: "Signal",
      valueLabel: medicationSignalOptions.find((option) => option.value === value)?.label ?? value,
      onRemove: () => toggleSignal(value),
    })),
  ];
  // The match-quality badge only earns its slot when it differentiates: hide it on
  // "Exact clinical fit" rows when every visible row says the same thing.
  const showMatchBadge = useMemo(() => new Set(rows.map((row) => row.result.match)).size > 1, [rows]);
  const initialCatalogLoading = catalog.loading && !catalog.data;
  const catalogRefetching = catalog.loading && Boolean(catalog.data);

  return (
    <div className={cn(pageContainer, "medication-results-workspace space-y-3 py-0 sm:py-2")}>
      <SearchResultsHeaderBand
        modeId="prescribing"
        query={query}
        matchCount={resultCount}
        status={
          catalog.error ? "error" : initialCatalogLoading ? "loading" : catalogRefetching ? "refetching" : "ready"
        }
        faultBody={catalog.error ?? undefined}
        // `/api/medications` reports a seed-served catalogue as `retainedSnapshot`, and until
        // now only the drawer below said so — a reader scanning the pinned count line was given
        // a confident number with nothing to say the list behind it may lag what was published.
        catalogueDegraded={Boolean(catalog.data?.retainedSnapshot)}
        filterLabel="Filter medication results"
        // A compact badged trigger, so it shares the count line.
        mobileControlsPlacement="inline"
        mobileControls={
          <ResultFilterTrigger
            panelId={filterPanelId}
            testId="medication-filter-trigger-phone"
            title="Filter medication results"
            open={filterOpen}
            activeCount={activeFilterCount}
            onToggle={() => setFilterOpen((current) => !current)}
          />
        }
        filterControls={
          <ResultFilterTrigger
            panelId={filterPanelId}
            testId="medication-filter-trigger-desktop"
            title="Filter medication results"
            open={filterOpen}
            activeCount={activeFilterCount}
            onToggle={() => setFilterOpen((current) => !current)}
          />
        }
        appliedFilters={appliedFilters}
        onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
      />

      {catalog.data?.retainedSnapshot ? <RetainedSnapshotNotice /> : null}

      <MedicationInterpretationChip query={query} interpretation={catalog.data?.interpretation} />

      <ResultFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        panelId={filterPanelId}
        testId="medication-filter-panel"
        title="Filter medication results"
        description="Narrow the ranked matches without changing prescribing content or patient safety notices."
        scope={{
          label: "Search in",
          value: scope,
          options: [
            {
              value: "best",
              label: "Best matches",
              count: scopeCounts.best,
              description: "The ranked results for this query.",
            },
            {
              value: "all",
              label: "All medications",
              count: scopeCounts.all,
              description: "The complete medication catalogue.",
            },
          ],
          onChange: (value) => setScope(value as MedicationScope),
        }}
        groups={filterGroups}
        onClearAll={activeFilterCount > 0 ? clearFilters : undefined}
        summary={{ count: resultCount, noun: resultCount === 1 ? "medication" : "medications" }}
      />

      {/* Phone gets the docked pill + sheet instead of the in-flow strip: two
          copies of one form would duplicate every `data-testid` while the sheet
          is open, and the strip is exactly the list space the pill exists to
          give back. Above the phone breakpoint the pill does not render, so the
          strip is the only entry point and must stay. */}
      <PatientProfilePanel variant="compact" className="medication-patient-strip max-sm:hidden" />
      {/* Renders only where the phone dock exposes its addon slot (the submitted
          prescribing view); a no-op elsewhere and above the phone breakpoint. */}
      <PatientDetailsDockAction />

      {/* The error branch moved into the band's fault panel, which carries the
          same message and announces it once. Loading copy stays here. */}
      {initialCatalogLoading ? (
        <div className="medication-results-inset">
          <p className="text-sm text-[color:var(--text-muted)]">Loading medication catalogue…</p>
        </div>
      ) : null}

      {!initialCatalogLoading && !catalog.error && resultCount === 0 ? (
        totalAvailable > 0 ? (
          <div className="medication-results-inset space-y-2">
            <EmptyState
              icon={SearchX}
              title="No medications match these filters"
              body="Remove a refinement to return to the ranked prescribing results."
              live="polite"
            />
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] px-3 text-xs font-semibold text-[color:var(--clinical-accent)] transition hover:bg-[color:var(--clinical-accent-soft)]/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <MedicationNothingFound
            query={query}
            catalogueCount={catalog.data?.records?.length ?? 0}
            onBrowseAll={() => setScope("all")}
          />
        )
      ) : null}

      {!initialCatalogLoading && !catalog.error && resultCount > 0 ? (
        <div className="hidden overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] shadow-[var(--e2)] lg:block">
          <div className="grid grid-cols-[minmax(12rem,1.12fr)_minmax(5.5rem,0.46fr)_minmax(7rem,0.66fr)_minmax(12rem,1.15fr)_1.5rem] gap-3 border-b border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-2.5 text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
            <span>Medication</span>
            <span>Usual dose</span>
            <span>Max dose</span>
            <span>Prescribing action</span>
            <span className="sr-only">Open</span>
          </div>
          <div className="divide-y divide-[color:var(--border)]">
            {rows.map((row, index) => {
              const result = row.result;
              const selected = index === 0 && Boolean(query.trim());
              // The verdict ring replaces the selected-row accent ring rather
              // than stacking with it: one edge mechanism, one owner, and safety
              // outranks "this is the top hit".
              const verdictRing = row.verdict ? medicationVerdictRingClass(row.verdict.tone) : null;
              const rowClassName = cn(
                "medication-desktop-result group grid w-full grid-cols-[minmax(12rem,1.12fr)_minmax(5.5rem,0.46fr)_minmax(7rem,0.66fr)_minmax(12rem,1.15fr)_1.5rem] items-start gap-3 px-4 py-3.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[color:var(--focus)]",
                selected
                  ? cn(
                      "bg-[color:var(--clinical-accent-soft)]/35 shadow-[var(--shadow-rail-active)]",
                      verdictRing ?? "ring-1 ring-inset ring-[color:var(--clinical-accent)]/35",
                    )
                  : cn(
                      result.href ? "hover:bg-[color:var(--surface-subtle)]" : "cursor-default opacity-80",
                      verdictRing,
                    ),
              );
              const rowContent = (
                <>
                  <div className="flex min-w-0 items-start gap-3">
                    <ResultToneIcon result={result} accent={row.accent} />
                    <div className="min-w-0">
                      <span className="block break-words text-base-minus font-semibold leading-5 text-[color:var(--text-heading)]">
                        <HighlightedName text={result.name} term={query} />
                      </span>
                      <span className="mt-0.5 line-clamp-1 break-words text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                        {result.indication}
                      </span>
                      {row.verdict ? <PatientVerdictSignal verdict={row.verdict} className="mt-2" /> : null}
                      {showMatchBadge || result.match !== "Exact clinical fit" || row.badges.length > 0 ? (
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                          {showMatchBadge || result.match !== "Exact clinical fit" ? (
                            <ResultMatchBadge result={result} />
                          ) : null}
                          <BadgeCluster items={row.badges} compact limit={3} showOverflowCount />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <span className="nums line-clamp-2 min-w-0 break-words pt-0.5 text-sm-minus font-semibold leading-5 text-[color:var(--text-heading)]">
                    {result.dose}
                  </span>
                  <div data-medication-cell="ceiling" className="min-w-0 pt-0.5">
                    <MaximumDose value={result.ceiling} />
                  </div>
                  <span
                    data-medication-cell="action"
                    className="flex min-w-0 items-start gap-2 pt-0.5 text-sm-minus font-medium leading-5 text-[color:var(--text-heading)]"
                  >
                    <ActionToneIcon tone={result.actionTone} className="mt-0.5 h-3.5 w-3.5" />
                    <span className="line-clamp-2 min-w-0 break-words">{result.action}</span>
                  </span>
                  {result.href ? (
                    <ChevronRight
                      className="h-4 w-4 justify-self-end text-[color:var(--decoration-soft)] group-hover:text-[color:var(--clinical-accent)] motion-safe:transition motion-safe:group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="justify-self-end text-2xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                      Soon
                    </span>
                  )}
                </>
              );

              if (result.href) {
                return (
                  <Link
                    key={result.id}
                    href={result.href}
                    data-testid={`medication-result-${result.id}-desktop`}
                    data-verdict={row.verdict?.tone}
                    className={rowClassName}
                  >
                    {rowContent}
                  </Link>
                );
              }

              return (
                <article
                  key={result.id}
                  data-testid={`medication-result-${result.id}-desktop`}
                  data-verdict={row.verdict?.tone}
                  className={rowClassName}
                >
                  {rowContent}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="medication-mobile-results grid gap-2 lg:hidden">
        {rows.map((row, index) => {
          const result = row.result;
          const selected = index === 0 && Boolean(query.trim());
          const cardClassName = cn(
            "medication-mobile-result min-w-0 w-full rounded-lg border bg-[color:var(--surface-raised)] p-2 text-left shadow-[var(--shadow-inset)] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
            selected
              ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)]/35"
              : result.href
                ? "border-[color:var(--border)] hover:border-[color:var(--border-strong)]"
                : "border-[color:var(--border)] opacity-80",
          );
          const cardContent = (
            <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-2.5">
              <ResultToneIcon result={result} accent={row.accent} />
              <div className="min-w-0 space-y-1.5">
                <div className="min-w-0">
                  <p className="line-clamp-2 break-words text-base-minus font-semibold leading-5 text-[color:var(--text-heading)]">
                    <HighlightedName text={result.name} term={query} />
                  </p>
                  <p className="line-clamp-1 break-words text-xs font-medium text-[color:var(--text-muted)]">
                    {result.indication}
                  </p>
                </div>
                {row.verdict ? <PatientVerdictSignal verdict={row.verdict} /> : null}
                {showMatchBadge || result.match !== "Exact clinical fit" || row.badges.length > 0 ? (
                  <div className="flex max-w-full flex-wrap items-center gap-1.5">
                    {showMatchBadge || result.match !== "Exact clinical fit" ? (
                      <ResultMatchBadge result={result} />
                    ) : null}
                    <BadgeCluster items={row.badges} compact limit={2} showOverflowCount />
                  </div>
                ) : null}
                <div className="flex max-w-full flex-wrap items-center gap-1.5 text-sm-minus font-semibold text-[color:var(--text-heading)]">
                  <span className="nums line-clamp-2 break-words">{result.dose}</span>
                  <MaximumDose value={result.ceiling} />
                </div>
                <p className="line-clamp-2 break-words text-pretty text-xs leading-normal text-[color:var(--text-muted)]">
                  <ActionToneIcon tone={result.actionTone} className="mr-1 inline-block h-3.5 w-3.5 align-[-0.15em]" />
                  {result.action}
                </p>
              </div>
              {result.href ? (
                <ChevronRight
                  className="mt-1 h-4 w-4 shrink-0 text-[color:var(--decoration-soft)]"
                  aria-hidden="true"
                />
              ) : (
                <span className="mt-1 shrink-0 rounded-md bg-[color:var(--surface-subtle)] px-1.5 py-0.5 text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                  Soon
                </span>
              )}
            </div>
          );

          if (result.href) {
            return (
              <Link
                key={result.id}
                href={result.href}
                data-testid={`medication-result-${result.id}-phone`}
                data-selected={selected ? "true" : "false"}
                data-verdict={row.verdict?.tone}
                className={cardClassName}
              >
                {cardContent}
              </Link>
            );
          }

          return (
            <article
              key={result.id}
              data-testid={`medication-result-${result.id}-phone`}
              data-selected={selected ? "true" : "false"}
              data-verdict={row.verdict?.tone}
              className={cardClassName}
            >
              {cardContent}
            </article>
          );
        })}
      </div>

      <UniversalSearchAlsoMatches modeId="prescribing" query={query} />

      <StatusNotice
        realDataReady={realDataReady}
        authUnavailable={authUnavailable}
        apiUnavailable={apiUnavailable}
        setupWarning={setupWarning}
        className="medication-results-inset"
      />
    </div>
  );
}
export function MedicationPrescribingWorkspace({
  query,
  loading,
  realDataReady,
  authUnavailable,
  apiUnavailable,
  setupWarning,
  onSuggestedSearch,
  showHome = false,
  desktopComposerSlotId,
}: MedicationPrescribingWorkspaceProps & { showHome?: boolean; desktopComposerSlotId?: string }) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery || showHome) {
    return (
      <MedicationHome
        loading={loading}
        realDataReady={realDataReady}
        authUnavailable={authUnavailable}
        apiUnavailable={apiUnavailable}
        setupWarning={setupWarning}
        onSuggestedSearch={onSuggestedSearch}
        desktopComposerSlotId={desktopComposerSlotId}
      />
    );
  }

  return (
    <MedicationResults
      query={trimmedQuery}
      realDataReady={realDataReady}
      authUnavailable={authUnavailable}
      apiUnavailable={apiUnavailable}
      setupWarning={setupWarning}
    />
  );
}
