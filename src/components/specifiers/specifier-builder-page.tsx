"use client";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ClipboardCopy,
  FileCheck2,
  GitCompareArrows,
  ListChecks,
  RotateCcw,
  Tags,
  Waypoints,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { InformationPageHeader } from "@/components/information-page-shell";
import {
  CategoryTag,
  ReviewStatusBadge,
  SpecifierPageShell,
  SpecifierSafetyNote,
  specifierCard,
} from "@/components/specifiers/specifier-ui";
import { pairCompareHref } from "@/components/compare";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText, fieldControlPlain } from "@/components/ui-primitives";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import {
  applyBuilderGroupRules,
  builderCatalogGroups,
  relaxBuilderGroups,
  builderDiagnosisGroups,
  catalogWordingSegment,
  findBuilderDiagnosis,
  guidedBuilderDiagnoses,
  resolveInitialBuilderState,
  toggleBuilderCatalogSlug,
  type BuilderCatalogGroup,
  type BuilderDiagnosis,
} from "@/lib/specifier-builder-diagnoses";
import { SPECIFIERS_REQUIRE_OPTION_REVIEW_BADGE } from "@/lib/specifiers-governance";
import {
  findSpecifier,
  normalizeSpecifierSelection,
  specifierAppliesToBuilderDiagnosis,
  specifierRecords,
  type SpecifierBuilderDiagnosis,
  type SpecifierFamily,
  type SpecifierRecord,
} from "@/lib/specifiers";
import { copyButton, errorCopy, specifierBuilderCopy } from "@/lib/ui-copy";

// Primary buttons wear the area colour, never the shared near-black command
// fill (design pass, October 2026). Re-pointing the command tokens on the
// button itself keeps Button's hover and pressed states and leaves every other
// control on the page alone. In forced colours the accent becomes LinkText,
// which ButtonText cannot sit on, so the native button pair comes back.
const clinicalPrimaryAccent =
  "[--command:var(--clinical-accent)] [--command-hover:var(--clinical-accent-hover)] [--command-active:var(--clinical-accent-active)] [--command-contrast:var(--clinical-accent-contrast)] forced-colors:[--command:ButtonFace] forced-colors:[--command-hover:ButtonFace] forced-colors:[--command-active:ButtonFace]";

const specifierFamilyOrder: Record<SpecifierFamily, number> = {
  "episode-features": 0,
  "course-onset": 1,
  "severity-remission": 2,
};

type BuilderStepCommon = {
  id: string;
  fullLabel: string;
  shortLabel: string;
  detail: string;
  eyebrow: string;
  title: string;
  body: string;
};

type BuilderStep =
  | (BuilderStepCommon & { kind: "base" })
  | (BuilderStepCommon & { kind: "family"; family: SpecifierFamily })
  | (BuilderStepCommon & { kind: "group"; group: BuilderCatalogGroup });

type BuilderView = string;
type CopyState = "idle" | "copied" | "failed";

const baseStep: BuilderStep = {
  kind: "base",
  id: "base",
  fullLabel: "Base diagnosis",
  shortLabel: specifierBuilderCopy.steps.base.shortLabel,
  detail: specifierBuilderCopy.steps.base.detail,
  eyebrow: specifierBuilderCopy.steps.base.eyebrow,
  title: specifierBuilderCopy.steps.base.title,
  body: specifierBuilderCopy.steps.base.body,
};

// The curated mood wizard, unchanged: three hand-authored families carrying the
// fit/exclusion guidance in specifierRecords.
const guidedSteps: BuilderStep[] = [
  {
    kind: "family",
    family: "episode-features",
    id: "episode-features",
    fullLabel: "Episode features",
    ...specifierBuilderCopy.steps.episodeFeatures,
  },
  {
    kind: "family",
    family: "course-onset",
    id: "course-onset",
    fullLabel: "Course and onset",
    ...specifierBuilderCopy.steps.courseOnset,
  },
  {
    kind: "family",
    family: "severity-remission",
    id: "severity-remission",
    fullLabel: "Severity or remission",
    ...specifierBuilderCopy.steps.severityRemission,
  },
];

function lowerFirst(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function catalogStep(group: BuilderCatalogGroup, index: number): BuilderStep {
  const label = lowerFirst(group.label);
  return {
    kind: "group",
    group,
    id: group.id,
    fullLabel: group.label,
    shortLabel: group.label,
    detail: group.selection === "single" ? "Choose one" : "Choose any",
    eyebrow: `${index + 1} · ${group.label}`,
    title: group.selection === "single" ? `Choose the ${label}` : `Add ${label}`,
    body:
      group.selection === "single"
        ? "Select one option, and only when it is established. One-of is this builder's default for the group, not a verified manual rule, so reopen it if more than one applies."
        : "Select only what the current presentation supports.",
  };
}

function builderStepsFor(diagnosis: BuilderDiagnosis, catalogGroups: BuilderCatalogGroup[]): BuilderStep[] {
  if (diagnosis.kind === "guided") return [baseStep, ...guidedSteps];
  return [baseStep, ...catalogGroups.map((group, index) => catalogStep(group, index + 1))];
}

function continueLabelFor(steps: BuilderStep[], index: number) {
  const next = steps[index + 1];
  if (!next) return specifierBuilderCopy.navigation.reviewWording;
  if (next.id === "episode-features") return specifierBuilderCopy.navigation.continueToFeatures;
  if (next.id === "course-onset") return specifierBuilderCopy.navigation.continueToCourse;
  if (next.id === "severity-remission") return specifierBuilderCopy.navigation.continueToSeverity;
  return `Continue to ${lowerFirst(next.shortLabel)}`;
}

function wordingSegment(record: SpecifierRecord) {
  if (record.slug === "mild-severity") return "mild";
  if (record.slug === "with-psychotic-features") return "severe with psychotic features";
  return lowerFirst(record.name);
}

// The step bar spans base plus one step per specifier group, so 2-5 columns. Literal
// class names keep this on the design-token grid utilities rather than an inline
// gridTemplateColumns style, which the drift ratchet counts as a token bypass.
const stepColumnsClass: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

function StepProgress({
  steps,
  active,
  visited,
  onChange,
}: {
  steps: BuilderStep[];
  active: BuilderView;
  visited: string[];
  onChange: (step: string) => void;
}) {
  return (
    <ol
      aria-label="Specifier builder steps"
      className={cn(
        "grid gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-1.5",
        stepColumnsClass[steps.length] ?? "grid-cols-4",
      )}
    >
      {steps.map((step, index) => {
        const isActive = active === step.id;
        const isComplete = visited.includes(step.id) && !isActive;
        return (
          <li key={step.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onChange(step.id)}
              aria-current={isActive ? "step" : undefined}
              aria-label={`Step ${index + 1} of ${steps.length}: ${step.fullLabel}${isComplete ? ", reviewed" : ""}`}
              className={cn(
                "grid min-h-[3.25rem] w-full min-w-0 place-items-center rounded-lg border px-1 py-1.5 text-center transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:grid-cols-[1.75rem_auto] sm:justify-center sm:gap-2",
                isActive
                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--e1)]"
                  : "border-transparent bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border)] hover:text-[color:var(--text-heading)]",
              )}
            >
              <span
                className={cn(
                  "nums grid h-6 w-6 place-items-center rounded-full border text-2xs font-extrabold",
                  isActive || isComplete
                    ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                    : "border-[color:var(--border-strong)] text-[color:var(--text-muted)]",
                )}
              >
                {isComplete ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-2xs font-extrabold break-words sm:text-xs">{step.shortLabel}</span>
                <span className="hidden text-2xs font-semibold break-words lg:block">{step.detail}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepHeading({ step }: { step: BuilderStep }) {
  return (
    <div className="border-b border-[color:var(--border)] px-4 py-4 sm:px-5">
      <p className={cn(eyebrowText, "!text-[color:var(--clinical-accent)]")}>{step.eyebrow}</p>
      <h2
        id="specifier-builder-stage-heading"
        tabIndex={-1}
        className="mt-1 text-xl font-extrabold text-[color:var(--text-heading)] outline-none"
      >
        {step.title}
      </h2>
      <p className="mt-1 text-sm font-medium leading-6 text-[color:var(--text-muted)]">{step.body}</p>
    </div>
  );
}

const optionRowClass =
  "group grid min-w-0 cursor-pointer grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-[color:var(--border)] px-4 py-3.5 transition motion-reduce:transition-none hover:bg-[color:var(--surface-subtle)] sm:px-5";

export function SpecifierBuilderPage({ initialSpecifiers = [] }: { initialSpecifiers?: string[] }) {
  const initialState = useMemo(
    () =>
      resolveInitialBuilderState(initialSpecifiers, {
        normalizeSelection: normalizeSpecifierSelection,
        appliesToGuided: (slug, id) => {
          const record = findSpecifier(slug);
          return record ? specifierAppliesToBuilderDiagnosis(record, id) : false;
        },
      }),
    [initialSpecifiers],
  );

  const [diagnosisId, setDiagnosisId] = useState<string>(initialState.diagnosisId);
  const [selected, setSelected] = useState<string[]>(initialState.selected);
  const [diagnosisFilter, setDiagnosisFilter] = useState("");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  // Single-select groups the clinician has reopened because more than one option
  // applies. Keyed by group id, which already carries the diagnosis.
  const [relaxedGroupIds, setRelaxedGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const copyTimer = useRef<number | null>(null);
  const focusStageHeading = useRef(false);

  const diagnosis = findBuilderDiagnosis(diagnosisId) ?? guidedBuilderDiagnoses[0];
  const catalogGroups = useMemo(
    () => (diagnosis.kind === "catalog" ? relaxBuilderGroups(builderCatalogGroups(diagnosis.id), relaxedGroupIds) : []),
    [diagnosis, relaxedGroupIds],
  );
  const steps = useMemo(() => builderStepsFor(diagnosis, catalogGroups), [catalogGroups, diagnosis]);

  const firstStepId = useMemo(() => {
    const seeded = initialState.selected[0];
    if (!seeded) return "base";
    const record = findSpecifier(seeded);
    if (record) {
      const family = initialState.selected
        .map((slug) => findSpecifier(slug))
        .filter((item): item is SpecifierRecord => Boolean(item))
        .sort((left, right) => specifierFamilyOrder[left.family] - specifierFamilyOrder[right.family])[0]?.family;
      return family ?? "base";
    }
    const owning = builderCatalogGroups(initialState.diagnosisId).find((group) =>
      group.items.some((item) => item.slug === seeded),
    );
    return owning?.id ?? "base";
  }, [initialState]);

  const [activeView, setActiveView] = useState<BuilderView>(firstStepId);
  const [visited, setVisited] = useState<string[]>(firstStepId === "base" ? ["base"] : ["base", firstStepId]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!focusStageHeading.current) return;
    document.getElementById("specifier-builder-stage-heading")?.focus();
    focusStageHeading.current = false;
  }, [activeView]);

  const selectedRecords = useMemo(
    () =>
      diagnosis.kind === "guided"
        ? selected
            .map((slug) => findSpecifier(slug))
            .filter((record): record is SpecifierRecord => Boolean(record))
            .sort((left, right) => specifierFamilyOrder[left.family] - specifierFamilyOrder[right.family])
        : [],
    [diagnosis, selected],
  );

  const appliedItems = useMemo(() => {
    if (diagnosis.kind === "guided") {
      return selectedRecords.map((record) => ({
        slug: record.slug,
        label: record.shortName,
        segment: wordingSegment(record),
      }));
    }
    return catalogGroups.flatMap((group) =>
      group.items
        .filter((item) => selected.includes(item.slug))
        .map((item) => ({ slug: item.slug, label: item.label, segment: catalogWordingSegment(item.label) })),
    );
  }, [catalogGroups, diagnosis, selected, selectedRecords]);

  const wording = [diagnosis.label, ...appliedItems.map((item) => item.segment)].join(", ");
  const severityNotSpecified = !selectedRecords.some((record) => record.family === "severity-remission");

  const diagnosisGroups = useMemo(() => builderDiagnosisGroups(), []);
  const filteredDiagnosisGroups = useMemo(() => {
    const needle = diagnosisFilter.trim().toLowerCase();
    if (!needle) return diagnosisGroups;
    return diagnosisGroups
      .map((group) => ({
        ...group,
        // Always keep the current selection reachable, otherwise filtering would
        // silently blank the control.
        options: group.options.filter(
          (option) =>
            option.id === diagnosisId ||
            option.label.toLowerCase().includes(needle) ||
            group.categoryName.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.options.length);
  }, [diagnosisFilter, diagnosisGroups, diagnosisId]);

  function changeDiagnosis(nextId: string) {
    const next = findBuilderDiagnosis(nextId);
    if (!next) return;
    const nextGroups =
      next.kind === "catalog" ? relaxBuilderGroups(builderCatalogGroups(next.id), relaxedGroupIds) : [];
    setDiagnosisId(nextId);
    setSelected((current) => {
      // Curated selections survive a move between mood presets when they remain
      // valid; anything crossing into or out of the catalogue starts clean, because
      // the two sides do not share a specifier vocabulary.
      if (next.kind === "guided" && diagnosis.kind === "guided") {
        return current.filter((slug) => {
          const record = findSpecifier(slug);
          return record ? specifierAppliesToBuilderDiagnosis(record, next.id) : false;
        });
      }
      if (next.kind === "catalog" && diagnosis.kind === "catalog") {
        const known = new Set(nextGroups.flatMap((group) => group.items.map((item) => item.slug)));
        return applyBuilderGroupRules(
          nextGroups,
          current.filter((slug) => known.has(slug)),
        );
      }
      return [];
    });

    const nextSteps = builderStepsFor(next, nextGroups);
    setActiveView((current) => (nextSteps.some((step) => step.id === current) ? current : "base"));
    setVisited((current) => current.filter((id) => nextSteps.some((step) => step.id === id)));
    setCopyState("idle");
  }

  function toggle(slug: string) {
    setSelected((current) => {
      if (diagnosis.kind === "catalog") return toggleBuilderCatalogSlug(catalogGroups, current, slug);
      if (current.includes(slug)) return current.filter((item) => item !== slug);
      return normalizeSpecifierSelection([...current, slug]);
    });
    setCopyState("idle");
  }

  function relaxGroup(groupId: string) {
    setRelaxedGroupIds((current) => {
      if (current.has(groupId)) return current;
      const next = new Set(current);
      next.add(groupId);
      return next;
    });
    setCopyState("idle");
  }

  function chooseCatalogSingle(group: BuilderCatalogGroup, slug: string | null) {
    setSelected((current) => {
      const cleared = current.filter((item) => !group.items.some((candidate) => candidate.slug === item));
      return slug ? applyBuilderGroupRules(catalogGroups, [...cleared, slug]) : cleared;
    });
    setCopyState("idle");
  }

  function chooseSeverity(slug: string | null) {
    setSelected((current) => {
      const withoutSeverity = current.filter((item) => findSpecifier(item)?.family !== "severity-remission");
      return slug ? normalizeSpecifierSelection([...withoutSeverity, slug]) : withoutSeverity;
    });
    setCopyState("idle");
  }

  function openStep(step: string, focusHeading = false) {
    focusStageHeading.current = focusHeading;
    setActiveView(step);
    setVisited((current) => (current.includes(step) ? current : [...current, step]));
  }

  function move(direction: -1 | 1) {
    if (activeView === "review") {
      openStep(steps[steps.length - 1].id, true);
      return;
    }
    const index = steps.findIndex((step) => step.id === activeView);
    if (direction === 1 && index === steps.length - 1) {
      focusStageHeading.current = true;
      setActiveView("review");
      return;
    }
    const next = steps[index + direction];
    if (next) openStep(next.id, true);
  }

  function resetBuilder() {
    setDiagnosisId(guidedBuilderDiagnoses[0].id);
    setSelected([]);
    setDiagnosisFilter("");
    setVisited(["base"]);
    focusStageHeading.current = true;
    setActiveView("base");
    setCopyState("idle");
  }

  async function copyWording() {
    try {
      await copyTextToClipboard(wording);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 2200);
  }

  const activeStep = activeView === "review" ? null : (steps.find((step) => step.id === activeView) ?? steps[0]);
  const activeIndex = activeStep ? steps.findIndex((step) => step.id === activeStep.id) : steps.length;
  const curatedCompareSlugs = selectedRecords.map((record) => record.slug);
  // Family steps only exist for the curated presets, so this is always set while one
  // is rendered; the catalogue path never reads it.
  const guidedId: SpecifierBuilderDiagnosis = diagnosis.kind === "guided" ? diagnosis.id : guidedBuilderDiagnoses[0].id;

  return (
    <SpecifierPageShell>
      <InformationPageHeader
        className="border-b border-[color:var(--border)] pb-5"
        eyebrow={specifierBuilderCopy.hero.eyebrow}
        title={specifierBuilderCopy.hero.title}
        subtitle={specifierBuilderCopy.hero.body}
      />

      <StepProgress steps={steps} active={activeView} visited={visited} onChange={openStep} />

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0">
          {activeStep?.kind === "base" ? (
            <section className={cn(specifierCard, "min-w-0 overflow-hidden")} data-testid="specifier-builder-base">
              <StepHeading step={activeStep} />
              <div className="grid gap-4 p-4 sm:p-5">
                <label className="grid min-w-0 gap-1.5">
                  <span className="text-xs font-bold text-[color:var(--text-muted)]">Filter diagnoses</span>
                  <input
                    type="search"
                    value={diagnosisFilter}
                    onChange={(event) => setDiagnosisFilter(event.target.value)}
                    placeholder="Type a disorder or category"
                    className={cn(fieldControlPlain, "max-w-full font-medium")}
                  />
                </label>
                <label className="grid min-w-0 gap-1.5">
                  <span className="text-xs font-bold text-[color:var(--text-muted)]">Diagnostic phrase</span>
                  <select
                    value={diagnosisId}
                    onChange={(event) => changeDiagnosis(event.target.value)}
                    className={cn(fieldControlPlain, "max-w-full font-bold text-[color:var(--text-heading)]")}
                  >
                    {filteredDiagnosisGroups.map((group) => (
                      <optgroup key={group.categoryId} label={group.categoryName}>
                        {group.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <CategoryTag categoryId={diagnosis.categoryId} name={diagnosis.categoryName} />
                  <span className="text-xs font-medium text-[color:var(--text-muted)]">
                    {diagnosis.kind === "guided"
                      ? "Curated mood-episode guidance, with fit and exclusion notes on each specifier."
                      : `${catalogGroups.length} specifier ${catalogGroups.length === 1 ? "group" : "groups"} recorded for this disorder.`}
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          {activeStep?.kind === "family" ? (
            <section
              className={cn(specifierCard, "min-w-0 overflow-hidden")}
              data-testid={`specifier-builder-${activeStep.id}`}
            >
              <StepHeading step={activeStep} />
              {activeStep.family === "severity-remission" ? (
                <fieldset>
                  <legend className="sr-only">Severity or remission options</legend>
                  <div className="grid min-w-0 sm:grid-cols-2">
                    <label className={optionRowClass}>
                      <input
                        type="radio"
                        name="severity-remission"
                        aria-label={specifierBuilderCopy.review.notSpecified}
                        checked={severityNotSpecified}
                        onChange={() => chooseSeverity(null)}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "mt-0.5 grid h-7 w-7 place-items-center rounded-full border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)]",
                          severityNotSpecified
                            ? "border-[color:var(--clinical-accent)] bg-[color:var(--surface)]"
                            : "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]",
                        )}
                      >
                        {severityNotSpecified ? (
                          <span className="h-3 w-3 rounded-full bg-[color:var(--clinical-accent)]" />
                        ) : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">
                          {specifierBuilderCopy.review.notSpecified}
                        </span>
                        <span className="mt-1 block text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                          Leave severity or remission unstated when it is not established.
                        </span>
                      </span>
                    </label>
                    {specifierRecords
                      .filter((record) => record.family === "severity-remission")
                      .map((record, index) => {
                        const checked = selected.includes(record.slug);
                        const compatible = specifierAppliesToBuilderDiagnosis(record, guidedId);
                        return (
                          <label
                            key={record.slug}
                            className={cn(
                              optionRowClass,
                              index % 2 === 0 && "sm:border-l",
                              checked && "bg-[color:var(--clinical-accent-soft)]/55",
                              !compatible && "cursor-not-allowed opacity-55",
                            )}
                          >
                            <input
                              type="radio"
                              name="severity-remission"
                              aria-label={record.shortName}
                              checked={checked}
                              disabled={!compatible}
                              onChange={() => chooseSeverity(record.slug)}
                              className="peer sr-only"
                            />
                            <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-full border border-[color:var(--border-strong)] bg-[color:var(--surface)] peer-checked:border-[color:var(--clinical-accent)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)]">
                              <span
                                className={cn(
                                  "h-3 w-3 rounded-full bg-[color:var(--clinical-accent)]",
                                  checked ? "opacity-100" : "opacity-0",
                                )}
                              />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-extrabold break-words text-[color:var(--text-heading)]">
                                {record.shortName}
                              </span>
                              <span className="mt-1 block text-xs font-medium leading-5 break-words text-[color:var(--text-muted)]">
                                {compatible ? record.clinicalSignal : "Not applicable to the selected diagnosis."}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </fieldset>
              ) : (
                <fieldset>
                  <legend className="sr-only">{activeStep.fullLabel} options</legend>
                  <div className="grid min-w-0 sm:grid-cols-2">
                    {specifierRecords
                      .filter((record) => record.family === activeStep.family)
                      .map((record, index) => {
                        const checked = selected.includes(record.slug);
                        const compatible = specifierAppliesToBuilderDiagnosis(record, guidedId);
                        return (
                          <label
                            key={record.slug}
                            className={cn(
                              optionRowClass,
                              index % 2 === 1 && "sm:border-l",
                              checked && "bg-[color:var(--clinical-accent-soft)]/55",
                              !compatible && "cursor-not-allowed opacity-55",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!compatible}
                              onChange={() => toggle(record.slug)}
                              className="peer sr-only"
                            />
                            <span
                              className={cn(
                                "mt-0.5 grid h-7 w-7 place-items-center rounded-md border text-transparent transition motion-reduce:transition-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)]",
                                checked
                                  ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                                  : "border-[color:var(--border-strong)] bg-[color:var(--surface)]",
                              )}
                            >
                              <Check className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-extrabold break-words text-[color:var(--text-heading)]">
                                {record.shortName}
                              </span>
                              <span className="mt-1 block text-xs font-medium leading-5 break-words text-[color:var(--text-muted)]">
                                {compatible ? record.clinicalSignal : "Not applicable to the selected diagnosis."}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </fieldset>
              )}
            </section>
          ) : null}

          {activeStep?.kind === "group" ? (
            <section
              className={cn(specifierCard, "min-w-0 overflow-hidden")}
              data-testid="specifier-builder-catalog-group"
            >
              <StepHeading step={activeStep} />
              <fieldset>
                <legend className="sr-only">{activeStep.fullLabel} options</legend>
                <div className="grid min-w-0 sm:grid-cols-2">
                  {activeStep.group.selection === "single" ? (
                    <label className={optionRowClass}>
                      <input
                        type="radio"
                        name={activeStep.group.id}
                        aria-label={specifierBuilderCopy.review.notSpecified}
                        checked={!activeStep.group.items.some((item) => selected.includes(item.slug))}
                        onChange={() => chooseCatalogSingle(activeStep.group, null)}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "mt-0.5 grid h-7 w-7 place-items-center rounded-full border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)]",
                          activeStep.group.items.some((item) => selected.includes(item.slug))
                            ? "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]"
                            : "border-[color:var(--clinical-accent)] bg-[color:var(--surface)]",
                        )}
                      >
                        {activeStep.group.items.some((item) => selected.includes(item.slug)) ? null : (
                          <span className="h-3 w-3 rounded-full bg-[color:var(--clinical-accent)]" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">
                          {specifierBuilderCopy.review.notSpecified}
                        </span>
                        <span className="mt-1 block text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                          Leave this out when it is not established.
                        </span>
                      </span>
                    </label>
                  ) : null}
                  {activeStep.group.items.map((item, index) => {
                    const checked = selected.includes(item.slug);
                    const single = activeStep.group.selection === "single";
                    return (
                      <label
                        key={item.slug}
                        className={cn(
                          optionRowClass,
                          (single ? index % 2 === 0 : index % 2 === 1) && "sm:border-l",
                          checked && "bg-[color:var(--clinical-accent-soft)]/55",
                        )}
                      >
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={single ? activeStep.group.id : undefined}
                          aria-label={item.label}
                          aria-describedby={
                            SPECIFIERS_REQUIRE_OPTION_REVIEW_BADGE ? `${item.slug}-review-status` : undefined
                          }
                          checked={checked}
                          onChange={() =>
                            single ? chooseCatalogSingle(activeStep.group, item.slug) : toggle(item.slug)
                          }
                          className="peer sr-only"
                        />
                        <span
                          className={cn(
                            "mt-0.5 grid h-7 w-7 place-items-center border text-transparent transition motion-reduce:transition-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)]",
                            single ? "rounded-full" : "rounded-md",
                            checked
                              ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                              : "border-[color:var(--border-strong)] bg-[color:var(--surface)]",
                          )}
                        >
                          {single ? (
                            <span
                              className={cn(
                                "h-3 w-3 rounded-full bg-[color:var(--clinical-accent-contrast)]",
                                checked ? "opacity-100" : "opacity-0",
                              )}
                            />
                          ) : (
                            <Check className="h-4 w-4" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-extrabold break-words text-[color:var(--text-heading)]">
                              {item.label}
                            </span>
                            {/* The detail and reference pages already carry this badge. Carrying it here too
                                means the clinician sees an item's source-review state at the point of choosing
                                it, not only if they open its record afterwards. The input sets aria-label, which
                                overrides the label's descendant text, so the status reaches assistive tech only
                                through the aria-describedby wired to this id. */}
                            {SPECIFIERS_REQUIRE_OPTION_REVIEW_BADGE ? (
                              <span id={`${item.slug}-review-status`}>
                                <ReviewStatusBadge status={item.src} />
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-1 block text-xs font-medium leading-5 break-words text-[color:var(--text-muted)]">
                            Recorded for {item.disorder}. Confirm the wording against the current manual before
                            documenting.
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {activeStep.group.selection === "single" ? (
                <div className="border-t border-[color:var(--border)] px-4 py-3 sm:px-5">
                  <button
                    type="button"
                    onClick={() => relaxGroup(activeStep.group.id)}
                    data-testid="specifier-builder-relax-group"
                    className="min-h-12 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 text-left text-xs font-bold text-[color:var(--text-heading)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                  >
                    More than one of these applies
                  </button>
                  <p className="mt-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                    Reopens this group so every applicable option can be recorded. Use it when the manual allows the
                    combination; the one-of default is this builder&rsquo;s grouping, not a rule.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          {activeView === "review" ? (
            <section className={cn(specifierCard, "min-w-0 overflow-hidden")} data-testid="specifier-builder-review">
              <div className="border-b border-[color:var(--border)] px-4 py-4 sm:px-5">
                <p className={cn(eyebrowText, "!text-[color:var(--clinical-accent)]")}>
                  {specifierBuilderCopy.review.eyebrow}
                </p>
                <h2
                  id="specifier-builder-stage-heading"
                  tabIndex={-1}
                  className="mt-1 text-xl font-extrabold text-[color:var(--text-heading)] outline-none"
                >
                  {specifierBuilderCopy.review.title}
                </h2>
                <p className="mt-1 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                  {specifierBuilderCopy.review.body}
                </p>
              </div>
              <div className="grid gap-4 p-4 sm:p-5">
                <div className="rounded-lg bg-[color:var(--clinical-accent-soft)] p-4">
                  <p className={eyebrowText}>Completed wording</p>
                  <p
                    data-testid="specifier-completed-wording"
                    className="mt-2 text-lg font-extrabold leading-7 break-words text-[color:var(--text-heading)]"
                  >
                    {wording}
                  </p>
                </div>

                {/* One divided list bleeding to the review card's edges, not a
                    bordered card per step nested inside the review card. */}
                <div className="-mx-4 grid divide-y divide-[color:var(--border)] border-y border-[color:var(--border)] sm:-mx-5">
                  {steps.map((step) => {
                    let value: string = specifierBuilderCopy.review.notSpecified;
                    if (step.kind === "base") {
                      value = diagnosis.label;
                    } else if (step.kind === "family") {
                      const records = selectedRecords.filter((record) => record.family === step.family);
                      if (records.length) value = records.map((record) => record.shortName).join(", ");
                    } else {
                      const picks = step.group.items.filter((item) => selected.includes(item.slug));
                      if (picks.length) value = picks.map((item) => item.label).join(", ");
                    }
                    return (
                      <div
                        key={step.id}
                        className="grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:px-5"
                      >
                        <div className="min-w-0">
                          <p className="text-2xs font-bold uppercase tracking-wide text-[color:var(--text-muted)]">
                            {step.fullLabel}
                          </p>
                          <p className="mt-0.5 text-sm font-bold break-words text-[color:var(--text-heading)]">
                            {value}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openStep(step.id, true)}
                          className="inline-flex min-h-tap items-center rounded-lg px-3 text-xs font-semibold text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                        >
                          Edit
                          <span className="sr-only"> {step.fullLabel}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] pt-4">
                  <button
                    type="button"
                    onClick={resetBuilder}
                    className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-4 text-sm font-semibold text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    {specifierBuilderCopy.review.startOver}
                  </button>
                  <Button
                    type="button"
                    variant="primary"
                    className={clinicalPrimaryAccent}
                    onClick={() => void copyWording()}
                    icon={copyState === "copied" ? Check : ClipboardCopy}
                  >
                    {copyState === "copied" ? copyButton.copied : specifierBuilderCopy.review.copy}
                  </Button>
                </div>
                <p role="status" className="sr-only">
                  {copyState === "copied"
                    ? specifierBuilderCopy.review.copied
                    : copyState === "failed"
                      ? errorCopy.clipboardCopyFailed
                      : ""}
                </p>

                <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--border)] pt-4">
                  <Link
                    href="/specifiers/map"
                    className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-4 text-sm font-bold text-[color:var(--text)] motion-reduce:transition-none"
                  >
                    <Waypoints className="h-4 w-4" aria-hidden />
                    Browse the map
                  </Link>
                  <Link
                    href={
                      curatedCompareSlugs.length >= 2
                        ? pairCompareHref("/specifiers/compare", curatedCompareSlugs[0], curatedCompareSlugs[1])
                        : "/specifiers/compare"
                    }
                    className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-4 text-sm font-bold text-[color:var(--text)] motion-reduce:transition-none"
                  >
                    <GitCompareArrows className="h-4 w-4" aria-hidden />
                    Compare specifiers
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

          {activeView !== "review" ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
              <button
                type="button"
                onClick={() => move(-1)}
                disabled={activeIndex === 0}
                className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-4 text-sm font-semibold text-[color:var(--text-muted)] disabled:cursor-not-allowed disabled:border-[color:var(--border)] disabled:bg-[color:var(--surface-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                {specifierBuilderCopy.navigation.previous}
              </button>
              <Button
                type="button"
                variant="primary"
                className={clinicalPrimaryAccent}
                onClick={() => move(1)}
                trailingIcon={ArrowRight}
              >
                {continueLabelFor(steps, activeIndex)}
              </Button>
            </div>
          ) : null}
        </div>

        <aside className="grid min-w-0 content-start gap-4 xl:sticky xl:top-20">
          <section className="min-w-0 overflow-hidden rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] shadow-[var(--e2)]">
            <div className="flex min-w-0 items-center gap-3 border-b border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]">
                <FileCheck2 className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className={cn(eyebrowText, "!text-[color:var(--clinical-accent)]")}>Working diagnosis</p>
                <h2 className="text-base font-extrabold text-[color:var(--text-heading)]">Structured wording</h2>
              </div>
            </div>
            <div className="grid min-w-0 gap-4 p-4">
              <p
                data-testid="specifier-working-wording"
                className="min-w-0 text-base font-extrabold leading-7 break-words text-[color:var(--text-heading)]"
              >
                {wording}
              </p>
              <div className="grid min-w-0 gap-2 border-t border-[color:var(--border)] pt-3">
                <p className={eyebrowText}>Applied specifiers</p>
                {appliedItems.length ? (
                  <ul className="grid min-w-0 gap-2">
                    {appliedItems.map((item) => (
                      <li
                        key={item.slug}
                        className="flex min-w-0 items-center justify-between gap-2 text-sm font-semibold text-[color:var(--text-muted)]"
                      >
                        <span className="inline-flex min-w-0 items-center gap-2 break-words">
                          <Tags className="h-3.5 w-3.5 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                          {item.label}
                        </span>
                        <Link
                          href={`/specifiers/${item.slug}`}
                          aria-label={`Review ${item.label}`}
                          className="grid h-tap w-tap shrink-0 place-items-center rounded-md text-[color:var(--clinical-accent)] hover:bg-[color:var(--clinical-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                        >
                          <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                    No specifiers selected yet.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className={cn(specifierCard, "p-4")}>
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
              <p className={eyebrowText}>Before documenting</p>
            </div>
            <ul className="mt-3 grid gap-2 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
              <li>Confirm each specifier is valid for the base diagnosis.</li>
              <li>Check episode chronology and competing explanations.</li>
              <li>Use one internally consistent severity or remission descriptor.</li>
            </ul>
          </section>
        </aside>
      </div>

      <SpecifierSafetyNote />
    </SpecifierPageShell>
  );
}
