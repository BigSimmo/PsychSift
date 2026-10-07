"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { CmeDateField, useCmeDateChecks } from "@/components/cme/cme-date-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { TextField } from "@/components/ui/text-field";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { cn, InlineNotice, textMuted } from "@/components/ui-primitives";
import { perthCalendarDate } from "@/lib/perth-time";
import {
  confirmedSourceForHome,
  NATIONAL_GUIDE,
  RANZCP_GUIDE,
  readCpdHome,
  requirementsForCpdHome,
  type CpdHomeKind,
} from "@/lib/cme/home-choice";
import { cmeSaveErrorText } from "@/lib/cme/load-state";
import { CME_PRESET_SOURCES, CME_PRESET_VERSION, describeConfirmedSource } from "@/lib/cme/presets";
import {
  cmeCategories,
  cmeCategoryLabels,
  type CmeCategory,
  type CmeRequirement,
  type CmeRequirementSet,
  type CmeRequirementSpec,
} from "@/lib/cme/types";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkBody } from "@/components/mode-kit/work";

function replaceRequirement(
  set: CmeRequirementSet,
  id: string,
  update: (requirement: CmeRequirement) => CmeRequirement,
): CmeRequirementSet {
  return {
    ...set,
    requirements: set.requirements.map((requirement) => (requirement.id === id ? update(requirement) : requirement)),
  };
}

function numericValue(raw: string, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function updateMinimumHours(set: CmeRequirementSet, id: string, minimumHours: number): CmeRequirementSet {
  return {
    ...set,
    requirements: set.requirements.map((requirement) =>
      requirement.id === id && "minimumHours" in requirement.spec
        ? { ...requirement, spec: { ...requirement.spec, minimumHours } }
        : requirement,
    ),
  };
}

function updateMinimumPerBucket(set: CmeRequirementSet, id: string, minimumPerBucket: number): CmeRequirementSet {
  return {
    ...set,
    requirements: set.requirements.map((requirement) =>
      requirement.id === id && requirement.spec.shape === "activity-count"
        ? { ...requirement, spec: { ...requirement.spec, minimumPerBucket } }
        : requirement,
    ),
  };
}

function updateAcross(
  set: CmeRequirementSet,
  id: string,
  update: { categories?: readonly CmeCategory[]; minimumEachHours?: number },
): CmeRequirementSet {
  return {
    ...set,
    requirements: set.requirements.map((requirement) =>
      requirement.id === id && requirement.spec.shape === "hours-across-categories"
        ? { ...requirement, spec: { ...requirement.spec, ...update } }
        : requirement,
    ),
  };
}

function specForShape(shape: CmeRequirementSpec["shape"]): CmeRequirementSpec {
  switch (shape) {
    case "hours-in-category":
      return { shape, category: "educational", minimumHours: 1 };
    case "hours-across-categories":
      return { shape, categories: ["reviewing", "measuring"], minimumHours: 1, minimumEachHours: 0 };
    case "credited-hours":
      return { shape, credit: "formal-peer-review", minimumHours: 1 };
    case "activity-count":
      return { shape, buckets: ["Practice domain"], minimumPerBucket: 1 };
    case "task":
      return { shape };
  }
}

export function CmeSetupPage({
  year,
  set,
  demoMode = false,
  onConfirm,
}: {
  readonly year?: number;
  readonly set: CmeRequirementSet | null;
  readonly demoMode?: boolean;
  readonly onConfirm?: (set: CmeRequirementSet) => Promise<void>;
}) {
  const targetYear = year ?? set?.year ?? new Date().getFullYear();
  const today = perthCalendarDate(new Date());
  const [home, setHome] = useState(() =>
    readCpdHome(set?.confirmedSource ?? confirmedSourceForHome({ kind: "national", name: "", guide: NATIONAL_GUIDE })),
  );
  const [draft, setDraft] = useState<CmeRequirementSet>(
    () =>
      set ?? {
        ...requirementsForCpdHome("national", targetYear, perthCalendarDate()),
        confirmedSource: confirmedSourceForHome({ kind: "national", name: "", guide: NATIONAL_GUIDE }),
      },
  );
  const [saving, setSaving] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dateChecks = useCmeDateChecks();

  function chooseHome(kind: CpdHomeKind) {
    const next = {
      kind,
      name: kind === "other" ? (home.kind === "other" ? home.name : "") : kind === "ranzcp" ? "RANZCP" : "",
      guide:
        kind === "ranzcp"
          ? RANZCP_GUIDE
          : kind === "national"
            ? NATIONAL_GUIDE
            : home.kind === "other"
              ? home.guide
              : "",
    };
    setHome(next);
    setDraft((current) => ({
      ...current,
      ...requirementsForCpdHome(kind, targetYear, current.confirmedOn),
      confirmedSource: confirmedSourceForHome(next),
    }));
    setSavedFingerprint(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onConfirm || saving) return;
    if (dateChecks.anyInvalid) {
      setError("Fix the date before saving.");
      return;
    }
    if (home.kind === "other" && !home.name.trim()) {
      setError("Name your CPD home before saving.");
      return;
    }
    if (!home.guide.trim()) {
      setError("Enter the guide or source you checked before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm({ ...draft, confirmedSource: confirmedSourceForHome(home) });
      setSavedFingerprint(JSON.stringify(draft));
    } catch (cause) {
      setError(cmeSaveErrorText(cause, "Could not confirm these requirements."));
    } finally {
      setSaving(false);
    }
  }

  function addCollegeRequirement() {
    const id = `college-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      requirements: [
        ...current.requirements,
        {
          id,
          label: "College requirement",
          source: "college",
          completedOn: null,
          spec: { shape: "hours-in-category", category: "educational", minimumHours: 1 },
        },
      ],
    }));
  }

  useModeBandHeading({
    eyebrow: set ? `${targetYear} · editing targets` : `${targetYear} · first time`,
    title: "Targets",
  });

  return (
    <main data-testid="cme-setup-page" data-mode-identity="cme" className="w-full">
      <WorkBody>
        <h1 className="m-0 text-lg font-semibold text-[color:var(--text-heading)]">Your CPD home for {targetYear}</h1>
        <p className={cn(textMuted, "text-sm leading-relaxed")}>
          Choose the programme you use, then check and confirm its targets against your current guide. These are your
          own confirmed numbers, not targets looked up by the app.
        </p>

        <fieldset className={"work-card work-card--pad space-y-2"} data-testid="cme-home-choices">
          <legend className="sr-only">Your CPD home</legend>
          {(
            [
              ["national", "National baseline only"],
              ...(targetYear === 2026 || home.kind === "ranzcp" ? [["ranzcp", "RANZCP"]] : []),
              ["other", "Other"],
            ] as [CpdHomeKind, string][]
          ).map(([kind, label]) => (
            <label key={kind} className="flex min-h-tap items-center gap-3 text-sm text-[color:var(--text)]">
              <input
                type="radio"
                name="cme-home"
                value={kind}
                checked={home.kind === kind}
                onChange={() => chooseHome(kind)}
              />
              {label}
            </label>
          ))}
          {home.kind === "other" ? (
            <TextField
              label="CPD home name"
              id="cme-home-name"
              required
              maxLength={80}
              value={home.name}
              onChange={(event) => {
                const next = { ...home, name: event.target.value };
                setHome(next);
                setDraft((current) => ({ ...current, confirmedSource: confirmedSourceForHome(next) }));
              }}
            />
          ) : null}
        </fieldset>

        {home.kind === "ranzcp" ? (
          <section data-testid="cme-setup-preset" className={"work-card work-card--pad"}>
            <p className="text-sm font-semibold text-[color:var(--text-heading)]">
              Starting preset: {describeConfirmedSource(CME_PRESET_VERSION)}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-[color:var(--text-muted)]">
              {CME_PRESET_SOURCES.map((source) => (
                <li key={source.url}>
                  <a
                    className="inline-flex min-h-tap items-center underline underline-offset-2"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className={cn(textMuted, "mt-2 text-xs")}>
              Check your CPD-home programme structure and add any extras below before confirming.
            </p>
          </section>
        ) : null}

        {demoMode ? (
          <InlineNotice tone="neutral">
            Demo mode is read-only. The whole confirmation form stays visible so you can look through it.
          </InlineNotice>
        ) : null}
        {error ? <InlineNotice tone="neutral">{error}</InlineNotice> : null}
        {savedFingerprint === JSON.stringify(draft) ? (
          <InlineNotice tone="neutral">Requirements confirmed. The dashboard now uses this saved version.</InlineNotice>
        ) : null}
        {draft.requirements.length === 0 ? (
          <div>
            <InlineNotice tone="neutral">
              This saved year has no usable requirement set yet. Existing log entries stay in place while you repair the
              setup.
            </InlineNotice>
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setDraft({
                    ...requirementsForCpdHome(
                      home.kind,
                      targetYear,
                      draft.confirmedOn || perthCalendarDate(new Date()),
                    ),
                    confirmedSource: confirmedSourceForHome(home),
                  })
                }
              >
                Load the starting preset
              </Button>
            </div>
          </div>
        ) : null}

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-5" data-testid="cme-setup-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Total hours"
              id="cme-setup-total-hours"
              type="number"
              min="1"
              step="0.5"
              value={draft.totalHours}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  totalHours: numericValue(event.target.value, current.totalHours),
                }))
              }
            />
            <CmeDateField
              label="Confirmation date"
              id="cme-setup-confirmed-on"
              required
              allowFuture={false}
              today={today}
              value={draft.confirmedOn}
              onChange={(confirmedOn) => setDraft((current) => ({ ...current, confirmedOn }))}
            />
          </div>
          <TextField
            label="Source you checked"
            id="cme-setup-source"
            required
            maxLength={500}
            value={home.guide}
            onChange={(event) => {
              const next = { ...home, guide: event.target.value };
              setHome(next);
              setDraft((current) => ({ ...current, confirmedSource: confirmedSourceForHome(next) }));
            }}
            hint="Keep the guide title, version or URL that you personally checked."
          />

          <section
            id="cme-setup-steps"
            aria-labelledby="cme-setup-requirements-heading"
            data-testid="cme-setup-steps"
            className={inPageAnchor}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2
                  id="cme-setup-requirements-heading"
                  className="text-base font-semibold text-[color:var(--text-heading)]"
                >
                  Requirements
                </h2>
                <p className={cn(textMuted, "text-xs")}>Every progress claim comes from this saved list.</p>
              </div>
              <Button type="button" variant="secondary" icon={Plus} onClick={addCollegeRequirement}>
                Add college extra
              </Button>
            </div>
            <div className="mt-3 space-y-3">
              {draft.requirements.map((requirement) => (
                <div
                  key={requirement.id}
                  className={"work-card work-card--pad space-y-3"}
                  id={`cme-requirement-${requirement.id}`}
                  data-testid={`cme-requirement-${requirement.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <TextField
                        label="Requirement"
                        id={`cme-requirement-${requirement.id}-label`}
                        value={requirement.label}
                        onChange={(event) =>
                          setDraft((current) =>
                            replaceRequirement(current, requirement.id, (item) => ({
                              ...item,
                              label: event.target.value,
                            })),
                          )
                        }
                      />
                    </div>
                    {requirement.source === "college" ? (
                      <Button
                        type="button"
                        variant="toolbar"
                        size="sm"
                        icon={Trash2}
                        aria-label={`Remove ${requirement.label}`}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            requirements: current.requirements.filter((item) => item.id !== requirement.id),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium text-[color:var(--text)]">
                      Source
                      <select
                        value={requirement.source}
                        onChange={(event) =>
                          setDraft((current) =>
                            replaceRequirement(current, requirement.id, (item) => ({
                              ...item,
                              source: event.target.value as CmeRequirement["source"],
                            })),
                          )
                        }
                        className="mt-1 min-h-tap w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                      >
                        <option value="national">Australian baseline</option>
                        <option value="college">College extra</option>
                      </select>
                    </label>
                    <label className="text-sm font-medium text-[color:var(--text)]">
                      Requirement type
                      <select
                        value={requirement.spec.shape}
                        onChange={(event) =>
                          setDraft((current) =>
                            replaceRequirement(current, requirement.id, (item) => ({
                              ...item,
                              completedOn: null,
                              spec: specForShape(event.target.value as CmeRequirementSpec["shape"]),
                            })),
                          )
                        }
                        className="mt-1 min-h-tap w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                      >
                        <option value="hours-in-category">Hours in one category</option>
                        <option value="hours-across-categories">Combined category hours</option>
                        <option value="credited-hours">Formal peer-review credit</option>
                        <option value="activity-count">Activities across domains</option>
                        <option value="task">Completion task</option>
                      </select>
                    </label>
                  </div>
                  {requirement.spec.shape === "hours-in-category" ? (
                    <label className="block text-sm font-medium text-[color:var(--text)]">
                      Category
                      <select
                        value={requirement.spec.category}
                        onChange={(event) =>
                          setDraft((current) =>
                            replaceRequirement(current, requirement.id, (item) => ({
                              ...item,
                              spec: {
                                ...requirement.spec,
                                category: event.target.value as typeof requirement.spec.category,
                              },
                            })),
                          )
                        }
                        className="mt-1 min-h-tap w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3"
                      >
                        {cmeCategories.map((category) => (
                          <option key={category} value={category}>
                            {cmeCategoryLabels[category]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {requirement.spec.shape === "hours-across-categories" ? (
                    <div className="space-y-3">
                      <fieldset>
                        <legend className="text-sm font-medium text-[color:var(--text)]">Categories included</legend>
                        <div className="mt-1 grid gap-2 sm:grid-cols-3">
                          {cmeCategories.map((category) => (
                            <Checkbox
                              key={category}
                              label={cmeCategoryLabels[category]}
                              checked={
                                requirement.spec.shape === "hours-across-categories" &&
                                requirement.spec.categories.includes(category)
                              }
                              onChange={(event) => {
                                if (requirement.spec.shape !== "hours-across-categories") return;
                                const categories = event.target.checked
                                  ? [...requirement.spec.categories, category]
                                  : requirement.spec.categories.filter((item) => item !== category);
                                if (categories.length > 0)
                                  setDraft((current) => updateAcross(current, requirement.id, { categories }));
                              }}
                            />
                          ))}
                        </div>
                      </fieldset>
                      <TextField
                        label="Minimum in each selected category"
                        id={`cme-requirement-${requirement.id}-minimum-each`}
                        type="number"
                        min="0"
                        step="0.5"
                        value={requirement.spec.minimumEachHours}
                        onChange={(event) =>
                          setDraft((current) =>
                            updateAcross(current, requirement.id, {
                              minimumEachHours: numericValue(event.target.value, 0),
                            }),
                          )
                        }
                      />
                    </div>
                  ) : null}
                  {"minimumHours" in requirement.spec ? (
                    <TextField
                      label="Minimum hours"
                      id={`cme-requirement-${requirement.id}-hours`}
                      type="number"
                      min="0"
                      step="0.5"
                      value={requirement.spec.minimumHours}
                      onChange={(event) =>
                        setDraft((current) =>
                          updateMinimumHours(current, requirement.id, numericValue(event.target.value, 0)),
                        )
                      }
                    />
                  ) : null}
                  {requirement.spec.shape === "activity-count" ? (
                    <div className="space-y-3">
                      <TextField
                        label="Practice domains"
                        id={`cme-requirement-${requirement.id}-domains`}
                        value={requirement.spec.buckets.join(", ")}
                        onChange={(event) =>
                          setDraft((current) =>
                            replaceRequirement(current, requirement.id, (item) => ({
                              ...item,
                              spec: {
                                ...requirement.spec,
                                buckets: event.target.value
                                  .split(",")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              },
                            })),
                          )
                        }
                        hint="Comma-separated; each selected domain is tracked separately."
                      />
                      <TextField
                        label="Activities per domain"
                        id={`cme-requirement-${requirement.id}-count`}
                        type="number"
                        min="1"
                        value={requirement.spec.minimumPerBucket}
                        onChange={(event) =>
                          setDraft((current) =>
                            updateMinimumPerBucket(current, requirement.id, numericValue(event.target.value, 1)),
                          )
                        }
                      />
                    </div>
                  ) : null}
                  {requirement.spec.shape === "task" ? (
                    <CmeDateField
                      label="Completion date"
                      onInvalidChange={dateChecks.report(`completed-${requirement.id}`)}
                      id={`cme-requirement-${requirement.id}-completed`}
                      chips={false}
                      allowFuture={false}
                      today={today}
                      value={requirement.completedOn ?? ""}
                      onChange={(completedOn) =>
                        setDraft((current) =>
                          replaceRequirement(current, requirement.id, (item) => ({
                            ...item,
                            completedOn: completedOn || null,
                          })),
                        )
                      }
                      hint={`Source: ${requirement.source}. Leave blank until you have actually completed it.`}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <InlineNotice tone="neutral">
            By confirming, you are recording the requirements and source you checked. PsychSift does not independently
            certify them.
          </InlineNotice>
          {onConfirm ? (
            <Button type="submit" variant="primary" busy={saving} busyLabel="Confirming…" block>
              {set ? "Re-confirm requirements" : "Confirm requirements"}
            </Button>
          ) : null}
        </form>

        <Link
          href="/cme/routines"
          id="cme-setup-routines"
          className="inline-flex min-h-tap items-center text-sm font-semibold text-[color:var(--clinical-accent)]"
        >
          Set up your routines
        </Link>
      </WorkBody>
    </main>
  );
}
