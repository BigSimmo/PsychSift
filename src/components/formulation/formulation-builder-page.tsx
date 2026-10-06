"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  FileCheck2,
  Network,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Waypoints,
} from "lucide-react";
import { useMemo, useState, useDeferredValue, useEffect } from "react";
import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";

import {
  FormulationPageShell,
  FormulationSafetyNote,
  MechanismDomainChips,
  SessionPrivacyNote,
  formulationCard,
} from "@/components/formulation/formulation-ui";
import { CatalogueToolbar } from "@/components/ui/catalogue-toolbar";
import { InformationPageHeader } from "@/components/information-page-shell";
import { cn, eyebrowText, fieldControlPlain } from "@/components/ui-primitives";

import {
  findFormulationMechanismSummary,
  formulationDomains,
  formulationDraftFor,
  formulationQualityPrompts,
  formulationSectionsForTemplate,
  formulationTemplates,
  normalizeMechanismSelection,
  searchFormulationMechanismIndex,
  suggestionsForFormulationSection,
  type FormulationMechanismSummary,
} from "@/lib/formulation-mechanism-index";

const builderSteps = [
  { id: "select", label: "Select", description: "Mechanisms" },
  { id: "structure", label: "Structure", description: "Framework" },
  { id: "review", label: "Review", description: "Quality" },
  { id: "draft", label: "Draft", description: "Formulation" },
] as const;

type BuilderStepId = (typeof builderSteps)[number]["id"];

function StepProgress({ active, onChange }: { active: BuilderStepId; onChange: (step: BuilderStepId) => void }) {
  const activeIndex = builderSteps.findIndex((step) => step.id === active);
  return (
    <ol
      aria-label="Formulation builder steps"
      className="grid grid-cols-4 gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-1.5 shadow-[var(--shadow-inset)]"
    >
      {builderSteps.map((step, index) => {
        const isActive = step.id === active;
        const isComplete = index < activeIndex;
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onChange(step.id)}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "grid min-h-[3.25rem] w-full place-items-center rounded-lg px-1 py-1.5 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:grid-cols-[1.75rem_auto] sm:justify-center sm:gap-2",
                isActive
                  ? "border border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--e1)]"
                  : "border border-transparent bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:border-[color:var(--border)]",
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
              <span>
                <span className="block text-xs font-extrabold sm:text-sm">{step.label}</span>
                <span
                  className={cn(
                    "hidden text-2xs font-semibold lg:block",
                    isActive ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)]",
                  )}
                >
                  {step.description}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function BuilderThread({
  mechanisms,
  templateId,
  completedQuality,
}: {
  mechanisms: FormulationMechanismSummary[];
  templateId: string;
  completedQuality: number;
}) {
  return (
    <aside className="grid content-start gap-4 xl:sticky xl:top-20">
      <section className="overflow-hidden rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] shadow-[var(--e2)]">
        <div className="flex items-center gap-3 border-b border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-4 py-3.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]">
            <Waypoints className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className={cn(eyebrowText, "!text-[color:var(--clinical-accent)]")}>Live formulation thread</p>
            <h2 className="text-base font-extrabold text-[color:var(--text-heading)]">From pattern to leverage</h2>
          </div>
        </div>
        <div className="grid gap-4 p-4">
          <div>
            <p className={eyebrowText}>Mechanism hypotheses</p>
            {mechanisms.length ? (
              <ol className="relative mt-3 grid gap-3 before:absolute before:bottom-3 before:left-[0.7rem] before:top-3 before:w-px before:bg-[color:var(--clinical-accent-border)]">
                {mechanisms.map((mechanism) => (
                  <li key={mechanism.id} className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2.5">
                    <span className="z-10 mt-0.5 grid h-6 w-6 place-items-center rounded-full border border-[color:var(--clinical-accent)] bg-[color:var(--surface)] text-[color:var(--clinical-accent)]">
                      <Network className="h-3 w-3" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">
                        {mechanism.name}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs font-medium leading-4 text-[color:var(--text-muted)]">
                        {mechanism.formulationUse}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                Select one or more mechanisms to start the thread.
              </p>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-2 border-t border-[color:var(--border)] pt-3">
            <div className="rounded-lg bg-[color:var(--surface-subtle)] p-3">
              <dt className="text-2xs font-bold uppercase tracking-wide text-[color:var(--text-muted)]">Framework</dt>
              <dd className="mt-1 text-sm font-extrabold text-[color:var(--text-heading)]">{templateId}</dd>
            </div>
            <div className="rounded-lg bg-[color:var(--surface-subtle)] p-3">
              <dt className="text-2xs font-bold uppercase tracking-wide text-[color:var(--text-muted)]">Review</dt>
              <dd className="nums mt-1 text-sm font-extrabold text-[color:var(--text-heading)]">
                {completedQuality}/{formulationQualityPrompts.length}
              </dd>
            </div>
          </dl>

          {mechanisms.length ? (
            <div className="border-t border-[color:var(--border)] pt-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                <p className={eyebrowText}>Treatment leverage</p>
              </div>
              <p className="mt-2 text-xs font-semibold leading-5 text-[color:var(--text-heading)]">
                {mechanisms[0].treatmentLeverage}
              </p>
            </div>
          ) : null}
        </div>
      </section>
      <section className={cn(formulationCard, "p-4")}>
        <SessionPrivacyNote />
      </section>
    </aside>
  );
}

function StepHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="border-b border-[color:var(--border)] px-4 py-4 sm:px-5">
      <p className={cn(eyebrowText, "!text-[color:var(--clinical-accent)]")}>{eyebrow}</p>
      <h2 className="mt-1 text-xl font-extrabold text-[color:var(--text-heading)]">{title}</h2>
      <p className="mt-1 text-sm font-medium leading-6 text-[color:var(--text-muted)]">{body}</p>
    </div>
  );
}

export function FormulationBuilderPage({
  initialMechanisms = [],
  initialTemplate,
}: {
  initialMechanisms?: string[];
  initialTemplate?: string;
}) {
  const validInitialTemplate = formulationTemplates.some((template) => template.id === initialTemplate)
    ? initialTemplate!
    : formulationTemplates[0].id;
  const [activeStep, setActiveStep] = useState<BuilderStepId>("select");
  const [selectedIds, setSelectedIds] = useState(() => normalizeMechanismSelection(initialMechanisms));
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [domain, setDomain] = useState("all");
  const [templateId, setTemplateId] = useState(validInitialTemplate);
  const [sectionNotes, setSectionNotes] = useState<Record<string, string>>({});
  const [qualityNotes, setQualityNotes] = useState<Record<string, string>>({});
  const [editedDraft, setEditedDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedMechanisms = useMemo(
    () =>
      selectedIds
        .map((id) => findFormulationMechanismSummary(id))
        .filter((mechanism): mechanism is FormulationMechanismSummary => Boolean(mechanism)),
    [selectedIds],
  );
  const visibleMechanisms = useMemo(() => {
    // Cleared live query should restore the full browse catalogue immediately.
    if (!query.trim()) {
      return searchFormulationMechanismIndex("", { domain }).map((result) => result.mechanism);
    }
    // Empty deferred while live query has text would score every mechanism.
    if (!deferredQuery.trim()) return [];
    return searchFormulationMechanismIndex(deferredQuery, { domain, interpretNaturalLanguage: true }).map(
      (result) => result.mechanism,
    );
  }, [domain, deferredQuery, query]);
  const activeSections = formulationSectionsForTemplate(templateId);
  const generatedDraft = formulationDraftFor({
    mechanisms: selectedMechanisms,
    templateId,
    notes: sectionNotes,
    qualityNotes,
  });
  const draft = editedDraft ?? generatedDraft;
  const completedQuality = formulationQualityPrompts.filter((prompt) => qualityNotes[prompt.id]?.trim()).length;
  const activeIndex = builderSteps.findIndex((step) => step.id === activeStep);

  const isDirty = Object.values(sectionNotes).some((n) => n.trim().length > 0) || Object.values(qualityNotes).some((n) => n.trim().length > 0) || editedDraft !== null;
  useDirtyStateGuard(isDirty);

  useEffect(() => {
    try {
      const draftStr = sessionStorage.getItem("psychsift_formulation_draft");
      if (draftStr && !isDirty) {
        const parsed = JSON.parse(draftStr);
        if (parsed.sectionNotes) setSectionNotes(parsed.sectionNotes);
        if (parsed.qualityNotes) setQualityNotes(parsed.qualityNotes);
        if (parsed.selectedIds) setSelectedIds(parsed.selectedIds);
        if (parsed.templateId) setTemplateId(parsed.templateId);
        if (parsed.editedDraft !== undefined) setEditedDraft(parsed.editedDraft);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isDirty || selectedIds.length > 0) {
      sessionStorage.setItem("psychsift_formulation_draft", JSON.stringify({ sectionNotes, qualityNotes, selectedIds, templateId, editedDraft }));
    }
  }, [isDirty, sectionNotes, qualityNotes, selectedIds, templateId, editedDraft]);

  function toggleMechanism(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : normalizeMechanismSelection([...current, id]),
    );
    setEditedDraft(null);
  }

  function clearMechanisms() {
    setSelectedIds([]);
    setEditedDraft(null);
  }

  function updateSection(id: string, value: string) {
    setSectionNotes((current) => ({ ...current, [id]: value }));
    setEditedDraft(null);
  }

  function applySuggestions(id: string) {
    const suggestions = suggestionsForFormulationSection(selectedMechanisms, id);
    if (!suggestions.length) return;
    updateSection(id, suggestions.map((item) => `- ${item}`).join("\n"));
  }

  function move(direction: -1 | 1) {
    const next = builderSteps[activeIndex + direction];
    if (!next) return;
    if (next.id === "draft") setEditedDraft(generatedDraft);
    setActiveStep(next.id);
  }

  async function copyDraft() {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <FormulationPageShell>
      <InformationPageHeader
        className="border-b border-[color:var(--border)] pb-5"
        eyebrow="Formulation builder"
        title="Build a formulation that can be tested"
        subtitle="Select candidate mechanisms, structure them with a clinical framework, challenge the hypothesis, then edit a de-identified draft."
      />

      <StepProgress active={activeStep} onChange={setActiveStep} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {activeStep === "select" ? (
            <section className={cn(formulationCard, "overflow-hidden")} data-testid="formulation-builder-select">
              <StepHeading
                eyebrow="1 · Select"
                title="Mechanism hypotheses"
                body="Search and add mechanisms that may explain the pattern. Selection is provisional: evidence and alternatives come next."
              />

              <div className="grid gap-4 p-4 sm:p-5">
                {selectedMechanisms.length ? (
                  <div className="rounded-xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]/45 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className={eyebrowText}>Selected hypotheses</p>
                        <p className="mt-1 text-sm font-bold text-[color:var(--text-heading)]">
                          {selectedMechanisms.length} {selectedMechanisms.length === 1 ? "mechanism" : "mechanisms"} in
                          the thread
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={clearMechanisms}
                        className="inline-flex min-h-tap items-center gap-2 rounded-lg px-3 text-xs font-semibold text-[color:var(--text-muted)] hover:bg-[color:var(--surface)]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        Clear
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedMechanisms.map((mechanism) => (
                        <button
                          key={mechanism.id}
                          type="button"
                          onClick={() => toggleMechanism(mechanism.id)}
                          aria-label={`Remove ${mechanism.name}`}
                          className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] px-3 text-xs font-semibold text-[color:var(--text-heading)]"
                        >
                          <Check className="h-3.5 w-3.5 text-[color:var(--clinical-accent)]" aria-hidden />
                          {mechanism.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-[color:var(--border-strong)] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:32px_32px] p-5 text-center">
                    <div className="rounded-xl bg-[color:var(--surface)]/95 px-6 py-4 shadow-[var(--e1)]">
                      <Network className="mx-auto h-6 w-6 text-[color:var(--clinical-accent)]" aria-hidden />
                      <h3 className="mt-2 text-base font-extrabold text-[color:var(--text-heading)]">
                        No mechanisms selected
                      </h3>
                      <p className="mt-1 max-w-sm text-sm font-medium leading-5 text-[color:var(--text-muted)]">
                        Search by mechanism, clinical clue, patient phrase, symptom, or domain.
                      </p>
                    </div>
                  </div>
                )}

                <CatalogueToolbar
                  search={{
                    query,
                    onQueryChange: setQuery,
                    placeholder: "Search mechanisms or patient language...",
                    label: "Search formulation mechanisms",
                  }}
                  sort={{
                    value: domain,
                    onChange: setDomain,
                    label: "Filter mechanisms by domain",
                    options: [
                      { value: "all", label: "All domains" },
                      ...formulationDomains.map((item) => ({ value: item, label: item })),
                    ],
                  }}
                  appliedFilters={
                    domain !== "all"
                      ? [{ id: "domain", groupLabel: "Domain", valueLabel: domain, onRemove: () => setDomain("all") }]
                      : []
                  }
                  onClearFilters={domain !== "all" ? () => setDomain("all") : undefined}
                  matchCount={visibleMechanisms.length}
                  noun="mechanism"
                />

                <div className="grid gap-2 sm:grid-cols-2" aria-label="Available mechanisms">
                  {visibleMechanisms.map((mechanism) => {
                    const checked = selectedIds.includes(mechanism.id);
                    return (
                      <label
                        key={mechanism.id}
                        className={cn(
                          "group grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg border p-3.5 transition",
                          checked
                            ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)]/55"
                            : "border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--surface-subtle)]",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMechanism(mechanism.id)}
                          className="peer sr-only"
                        />
                        <span
                          className={cn(
                            "mt-0.5 grid h-7 w-7 place-items-center rounded-md border text-transparent transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)]",
                            checked
                              ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                              : "border-[color:var(--border-strong)] bg-[color:var(--surface)]",
                          )}
                        >
                          <Check className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">
                            {mechanism.name}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                            {mechanism.formulationUse}
                          </span>
                          <span className="mt-2 block">
                            <MechanismDomainChips values={mechanism.domains} limit={2} />
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-4">
                  <p className={eyebrowText}>Formulation language</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[color:var(--text-heading)]">
                    {selectedMechanisms.length
                      ? selectedMechanisms.map((mechanism) => mechanism.exampleSentence).join(" ")
                      : "Select mechanisms to develop formulation language and treatment targets."}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {activeStep === "structure" ? (
            <section className={cn(formulationCard, "overflow-hidden")} data-testid="formulation-builder-structure">
              <StepHeading
                eyebrow="2 · Structure"
                title="Choose a formulation framework"
                body="Use the framework that best serves the clinical task. Mechanism-derived suggestions remain editable and should be checked against the case."
              />
              <div className="grid gap-5 p-4 sm:p-5">
                <div
                  className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
                  role="radiogroup"
                  aria-label="Formulation framework"
                >
                  {formulationTemplates.map((template) => {
                    const active = template.id === templateId;
                    const selectTemplate = () => {
                      if (template.id === templateId) return;
                      setTemplateId(template.id);
                      setEditedDraft(null);
                    };
                    return (
                      <label
                        key={template.id}
                        className={cn(
                          "grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg border p-3.5",
                          active
                            ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)]"
                            : "border-[color:var(--border)] bg-[color:var(--surface)] hover:bg-[color:var(--surface-subtle)]",
                        )}
                        // Controlled `sr-only` radios can miss native label activation after
                        // large scroll-into-view (Production UI shard flake on PR #1788). Drive
                        // selection from the label click as well as input onChange.
                        onClick={selectTemplate}
                      >
                        <input
                          type="radio"
                          name="formulation-template"
                          value={template.id}
                          checked={active}
                          onChange={selectTemplate}
                          className="peer sr-only"
                        />
                        <span
                          className={cn(
                            "grid h-7 w-7 place-items-center rounded-full border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--focus)]",
                            active
                              ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                              : "border-[color:var(--border-strong)] text-transparent",
                          )}
                        >
                          <Check className="h-4 w-4" aria-hidden />
                        </span>
                        <span>
                          <span className="block text-sm font-extrabold text-[color:var(--text-heading)]">
                            {template.label}
                          </span>
                          <span className="mt-1 block text-xs font-medium text-[color:var(--text-muted)]">
                            {formulationSectionsForTemplate(template.id).length} structured sections
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="grid gap-3">
                  {activeSections.map((section) => {
                    const suggestions = suggestionsForFormulationSection(selectedMechanisms, section.id);
                    return (
                      <article
                        key={section.id}
                        className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-extrabold text-[color:var(--text-heading)]">{section.label}</h3>
                            <p className="mt-1 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                              {section.prompt}
                            </p>
                          </div>
                          {suggestions.length ? (
                            <button
                              type="button"
                              onClick={() => applySuggestions(section.id)}
                              className="inline-flex min-h-tap items-center gap-1.5 rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 text-xs font-semibold text-[color:var(--clinical-accent)]"
                            >
                              <Sparkles className="h-3.5 w-3.5" aria-hidden />
                              Use suggestions
                            </button>
                          ) : null}
                        </div>
                        <textarea
                          value={sectionNotes[section.id] ?? ""}
                          onChange={(event) => updateSection(section.id, event.target.value)}
                          rows={3}
                          aria-label={section.label}
                          placeholder="Add de-identified case evidence..."
                          className={cn(fieldControlPlain, "mt-3 h-auto min-h-24 resize-y p-3 font-medium leading-6")}
                        />
                        {suggestions.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {suggestions.map((suggestion) => (
                              <span
                                key={suggestion}
                                className="rounded-md bg-[color:var(--surface-subtle)] px-2 py-1 text-2xs font-semibold leading-4 text-[color:var(--text-muted)]"
                              >
                                {suggestion}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {activeStep === "review" ? (
            <section className={cn(formulationCard, "overflow-hidden")} data-testid="formulation-builder-review">
              <StepHeading
                eyebrow="3 · Review"
                title="Challenge the working hypothesis"
                body="A useful formulation remains provisional. Record what supports it, what competes with it, and what would change your mind."
              />
              <div className="grid gap-3 p-4 sm:p-5 sm:grid-cols-2">
                {formulationQualityPrompts.map((prompt, index) => {
                  const starter =
                    prompt.id === "quality-evidence"
                      ? selectedMechanisms.flatMap((mechanism) => mechanism.fitIndicators).slice(0, 2)
                      : prompt.id === "quality-intervention"
                        ? selectedMechanisms.map((mechanism) => mechanism.treatmentLeverage).slice(0, 2)
                        : selectedMechanisms.flatMap((mechanism) => mechanism.poorFitIndicators).slice(0, 2);
                  return (
                    <article
                      key={prompt.id}
                      className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span className="nums grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] text-xs font-extrabold text-[color:var(--clinical-accent)]">
                          {index + 1}
                        </span>
                        <div>
                          <h3 className="text-sm font-extrabold text-[color:var(--text-heading)]">{prompt.label}</h3>
                          <p className="mt-1 text-xs font-medium leading-5 text-[color:var(--text-muted)]">
                            {prompt.prompt}
                          </p>
                        </div>
                      </div>
                      <textarea
                        value={qualityNotes[prompt.id] ?? ""}
                        onChange={(event) => {
                          setQualityNotes((current) => ({ ...current, [prompt.id]: event.target.value }));
                          setEditedDraft(null);
                        }}
                        rows={4}
                        aria-label={prompt.label}
                        placeholder="Record a concise review note..."
                        className={cn(fieldControlPlain, "mt-3 h-auto min-h-28 resize-y p-3 font-medium leading-6")}
                      />
                      {starter.length ? (
                        <div className="mt-2 rounded-lg bg-[color:var(--surface-subtle)] p-2.5">
                          <p className={eyebrowText}>Consider</p>
                          <p className="mt-1 text-2xs font-medium leading-4 text-[color:var(--text-muted)]">
                            {starter.join(" · ")}
                          </p>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
              <div className="border-t border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-muted)]">
                  <ShieldCheck className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                  <span className="nums">
                    {completedQuality}/{formulationQualityPrompts.length}
                  </span>{" "}
                  quality prompts completed
                </div>
              </div>
            </section>
          ) : null}

          {activeStep === "draft" ? (
            <section className={cn(formulationCard, "overflow-hidden")} data-testid="formulation-builder-draft">
              <StepHeading
                eyebrow="4 · Draft"
                title="Edit the formulation"
                body="The generated text combines your selected mechanisms, framework notes, and quality review. Edit it until every statement is supported by the case."
              />
              <div className="grid gap-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileCheck2 className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                    <p className={eyebrowText}>Working draft</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditedDraft(generatedDraft)}
                      className="inline-flex min-h-tap items-center gap-1.5 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 text-xs font-semibold text-[color:var(--text-muted)]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      Regenerate
                    </button>
                    <button
                      type="button"
                      onClick={copyDraft}
                      className="inline-flex min-h-tap items-center gap-1.5 rounded-md bg-[color:var(--command)] px-3 text-xs font-semibold text-[color:var(--command-contrast)]"
                    >
                      <Clipboard className="h-3.5 w-3.5" aria-hidden />
                      {copied ? "Copied" : "Copy draft"}
                    </button>
                  </div>
                </div>
                <textarea
                  value={draft}
                  onChange={(event) => setEditedDraft(event.target.value)}
                  rows={22}
                  aria-label="Formulation draft"
                  className={cn(fieldControlPlain, "h-auto min-h-[32rem] resize-y rounded-xl p-4 font-mono leading-6")}
                />
                <div className="rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-4 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
                  <p className="font-extrabold text-[color:var(--text-heading)]">Review before clinical use</p>
                  <p className="mt-1">
                    Confirm chronology, risk, strengths, cultural context, alternative explanations, and the patient’s
                    own account. Remove any unsupported mechanism language.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 shadow-[var(--shadow-inset)]">
            <button
              type="button"
              onClick={() => move(-1)}
              disabled={activeIndex === 0}
              className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-4 text-sm font-semibold text-[color:var(--text-muted)] disabled:cursor-not-allowed disabled:border-[color:var(--border)] disabled:bg-[color:var(--surface-inset)]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Previous
            </button>
            {activeIndex < builderSteps.length - 1 ? (
              <button
                type="button"
                onClick={() => move(1)}
                disabled={activeStep === "select" && selectedMechanisms.length === 0}
                className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-transparent bg-[color:var(--command)] px-4 text-sm font-semibold text-[color:var(--command-contrast)] shadow-[var(--e1)] disabled:cursor-not-allowed disabled:border-[color:var(--border)] disabled:bg-[color:var(--surface-inset)] disabled:text-[color:var(--text-muted)] disabled:shadow-none"
              >
                {activeStep === "select"
                  ? "Continue to framework"
                  : activeStep === "structure"
                    ? "Review quality"
                    : "Create draft"}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            ) : (
              <Link
                href="/formulation"
                className="inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-4 text-sm font-semibold text-[color:var(--text)]"
              >
                Search another mechanism
                <Search className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </div>
        </div>

        <BuilderThread mechanisms={selectedMechanisms} templateId={templateId} completedQuality={completedQuality} />
      </div>

      <FormulationSafetyNote />
    </FormulationPageShell>
  );
}
