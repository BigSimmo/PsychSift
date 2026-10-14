"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, FileText, Search, TriangleAlert } from "lucide-react";

import { cardSurface } from "@/components/card-recipes";
import { PageHeader } from "@/components/ui/page-header";
import { InformationPageFooter, InformationPageShell } from "@/components/information-page-shell";
import { Button } from "@/components/ui/button";
import { missingValuePhrase } from "@/components/ui/missing-value";
import { Tabs } from "@/components/ui/tabs";
import { BrowserPrintButton, PrintOutput } from "@/components/ui/print-output";
import { cn } from "@/components/ui-primitives";
import { therapyNeedsReview } from "@/lib/therapies";
import { therapyRecordHref, type TherapyBriefDuration } from "@/lib/therapy-compass-navigation";

import { useTcBindings } from "../bindings";
import { InteractiveRow } from "@/components/ui/interactive-row";
import { parseSteps, summarise } from "../data/select";
import type { Therapy } from "../data/types";
import { LoadingState } from "../ui";
import { useClipboard } from "../use-clipboard";
import { TherapyCompareAction } from "../record/compare-action";
import { TherapySaveNotice } from "../record/save-notice";
import { useTherapyFavourite } from "../use-therapy-favourite";
import { TherapyRecordNavHeader } from "../therapy-record-nav-header";

const CHECKLIST = [
  "Confirm the primary problem",
  "Check risk and acuity",
  "Review contraindications",
  "Confirm patient-facing language",
];

const BRIEF_DURATION: Record<TherapyBriefDuration, { label: string; text: (therapy: Therapy) => string | null }> = {
  "5min": { label: "5-minute", text: (therapy) => therapy.briefVersion },
  "15min": {
    label: "15-minute",
    text: (therapy) => therapy.fifteenMinuteVersion || therapy.fullSessionVersion || therapy.briefVersion,
  },
  ground: {
    label: "Grounding",
    text: (therapy) =>
      therapy.clinicianScripts.find((script) => /ground|relax|distress/i.test(`${script.scriptType} ${script.title}`))
        ?.body || therapy.briefVersion,
  },
};

export function buildBriefCopy(
  brief: Therapy | (Pick<Therapy, "name" | "reviewStatus"> & Partial<Therapy>),
  durationLabel = "5-minute",
  steps: string[] = parseSteps(brief.briefVersion ?? null, 6),
): string {
  const scripts = brief.clinicianScripts ?? [];
  return [
    `${brief.name} — ${durationLabel} intervention`,
    ...(therapyNeedsReview(brief as Therapy) ? ["[Awaiting clinical review — verify against primary guidelines]"] : []),
    "",
    ...steps.map((st, i) => `${i + 1}. ${st}`),
    ...(scripts.length
      ? [
          "",
          "Clinician script:",
          ...scripts.slice(0, 2).map((c) => (c.scriptType ? `${c.scriptType}: ${c.body ?? ""}` : (c.body ?? ""))),
        ]
      : []),
  ].join("\n");
}

export function BriefScreen() {
  const b = useTcBindings();
  const t = b.selectedTherapy;
  const [filter, setFilter] = useState("");
  const { copied, copy } = useClipboard();

  const briefTherapies = useMemo(
    () =>
      b.therapies
        .filter((x) => x.briefInterventionAvailable)
        .filter((x) => !filter.trim() || x.name.toLowerCase().includes(filter.toLowerCase()))
        .slice(0, 40),
    [b.therapies, filter],
  );

  const { notice, saved, toggleFavourite } = useTherapyFavourite(t?.slug ?? null);
  if (b.loading || !t) return <LoadingState label="Loading brief interventions…" />;

  const needsReview = therapyNeedsReview(t);
  const duration = BRIEF_DURATION[b.briefTab as TherapyBriefDuration] ?? BRIEF_DURATION["5min"];
  const durationLabel = duration.label;
  const durationText = duration.text(t);
  const steps = parseSteps(durationText, 6);
  // `briefVersion` is a copy of `deliverySteps` on every catalogue record, so the
  // duration tabs can present the record's full delivery protocol as though it
  // were a version cut down to the time available. Say so rather than imply it.
  const duplicatesFullProtocol = Boolean(
    durationText && t.deliverySteps && durationText.trim() === t.deliverySteps.trim(),
  );
  const interventionText = buildBriefCopy(t, durationLabel, steps);

  return (
    <>
      <TherapyRecordNavHeader
        therapy={t}
        active="brief"
        backHref={b.workspaceHref(therapyRecordHref(t.slug))}
        backLabel={t.name}
        testIdPrefix="therapy-brief"
        saved={saved}
        onToggleSave={() => void toggleFavourite()}
      />
      <InformationPageShell testId="therapy-brief-page" gap={false}>
        <section data-screen-label="Brief">
          <TherapySaveNotice notice={notice} />
          <PageHeader
            className="mb-5"
            title="Brief Intervention"
            description="Fast scripts and steps drawn from each record’s delivery fields."
            actions={
              <>
                <BrowserPrintButton label="Print brief" />
                <Button
                  variant="secondary"
                  icon={FileText}
                  // `aria-disabled` rather than `disabled`: "no patient handout" is a
                  // reason the reader needs, and a natively disabled button leaves the
                  // tab order, so keyboard users never reach the title that carries it.
                  onClick={() => {
                    if (!t.patientSheetAvailable) return;
                    b.openSheet(t.slug);
                  }}
                  aria-disabled={t.patientSheetAvailable ? undefined : true}
                  title={t.patientSheetAvailable ? undefined : "This intervention has no patient handout"}
                >
                  {t.patientSheetAvailable ? "Create handout" : "Handout unavailable"}
                </Button>
              </>
            }
          />

          <div className="mb-5">
            <TherapyCompareAction therapy={t} />
          </div>

          <Tabs
            label="Brief intervention duration"
            value={b.briefTab}
            onChange={(value) => {
              if (value === "15min") b.set15();
              else if (value === "ground") b.setGround();
              else b.set5();
            }}
            items={[
              { id: "5min", label: "5 minutes" },
              { id: "15min", label: "15 minutes" },
              { id: "ground", label: "Grounding now" },
            ]}
          >
            <div className="grid grid-cols-1 sm:grid-cols-[300px_minmax(0,_1fr)] gap-4 items-start">
              {/* records list */}
              <div className={cn(cardSurface, "p-4")}>
                <label className="relative flex items-center mb-3">
                  <Search
                    aria-hidden="true"
                    strokeWidth={1.8}
                    className="absolute left-[12px] size-icon-md text-[color:var(--decoration-soft)]"
                  />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter records…"
                    aria-label="Filter brief-intervention records"
                    className="w-full min-h-tap pt-0 pr-3 pb-0 pl-9 border border-[color:var(--border)] rounded-md bg-[color:var(--surface)] text-[color:var(--text)] text-sm-minus"
                  />
                </label>
                <div className="flex flex-col gap-2 max-h-[520px] overflow-auto">
                  {briefTherapies.map((x) => {
                    const active = x.slug === t.slug;
                    return (
                      <InteractiveRow key={x.slug} variant="card" active={active} onClick={() => b.select(x.slug)}>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm-minus font-semibold text-[color:var(--text-heading)]">
                            {x.name}
                          </span>
                          <span className="block text-2xs text-[color:var(--text-muted)] mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                            {x.bestUsedFor ?? x.category}
                          </span>
                        </span>
                        {x.reviewStatus === "reviewed" ? (
                          <CheckCircle2
                            aria-hidden="true"
                            strokeWidth={1.8}
                            className="size-icon-sm flex-none text-[color:var(--success-text)]"
                          />
                        ) : (
                          <AlertTriangle
                            aria-hidden="true"
                            strokeWidth={1.8}
                            className="size-icon-sm flex-none text-[color:var(--warning-text)]"
                          />
                        )}
                      </InteractiveRow>
                    );
                  })}
                </div>
                <div className="text-center text-2xs text-[color:var(--text-muted)] mt-3.5">
                  Showing {briefTherapies.length} records
                </div>
              </div>

              {/* brief detail */}
              <PrintOutput
                className="flex flex-col gap-4 min-w-0"
                provenance={`Source: ${t.name} Therapy record · ${durationLabel} intervention · Review status: ${t.reviewStatus === "reviewed" ? "reviewed" : "source review required"}`}
              >
                <div className={cn(cardSurface, "py-5.5 px-6")}>
                  <div className="flex items-center justify-between gap-3 mb-4.5 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="m-0 text-lg font-semibold text-[color:var(--text-heading)]">{t.name}</h2>
                      <span className="text-2xs font-semibold py-0.5 px-2.5 rounded-sm bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent-hover)] border border-[color:var(--clinical-accent-border)]">
                        {durationLabel} mode
                      </span>
                      <span
                        data-testid="therapy-brief-review-badge"
                        className={cn(
                          "inline-flex items-center gap-1.5 text-2xs font-semibold py-0.5 px-2.5 rounded-sm border",
                          needsReview
                            ? "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)] border-[color:var(--warning-border)]"
                            : "bg-[color:var(--success-bg)] text-[color:var(--success-text)] border-[color:var(--success-border)]",
                        )}
                      >
                        {needsReview ? (
                          <AlertTriangle aria-hidden="true" className="size-icon-xs flex-none" />
                        ) : (
                          <CheckCircle2 aria-hidden="true" className="size-icon-xs flex-none" />
                        )}
                        {needsReview ? "Awaiting clinical review" : "Reviewed"}
                      </span>
                    </div>
                    {/*
                      `data-print-hide` moves to a `display: contents` wrapper: a bare
                      `data-*` attribute cannot be passed to a component (see the `testId`
                      note in `ui/button.tsx`), and the wrapper keeps the Button a direct
                      flex item of this row while the print rule still hides the subtree.
                    */}
                    <span data-print-hide className="contents">
                      <Button variant="secondary" size="sm" trailingIcon={ExternalLink} onClick={() => b.open(t.slug)}>
                        Open full record
                      </Button>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[color:var(--border)] border border-[color:var(--border)] rounded-lg overflow-hidden">
                    {/* Neither field of either pair is populated on this record, so the phrase
                        describes the record rather than one field of it. `MetaCell.text` is a
                        string, hence the primitive's string form (SPEC §11). */}
                    <MetaCell
                      eyebrow="Goal"
                      text={t.bestUsedFor || t.indications || missingValuePhrase("not_recorded")}
                    />
                    <MetaCell
                      eyebrow="First step"
                      text={steps[0] || summarise(durationText, 1) || missingValuePhrase("not_recorded")}
                    />
                    <MetaCell
                      eyebrow="Cautions"
                      tone="warning"
                      text={summarise(t.contraindicationsOrCautions, 1) || "Review cautions before use."}
                    />
                    <MetaCell
                      eyebrow="Source"
                      text={t.reviewStatus === "reviewed" ? "Reviewed record" : "Review required"}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[1.6fr_1fr] gap-4 items-start">
                  <div className={cn(cardSurface, "py-5 px-5.5 min-w-0")}>
                    <div className="text-base-minus font-semibold text-[color:var(--text-heading)] mb-4">
                      {durationLabel} delivery
                    </div>
                    {duplicatesFullProtocol ? (
                      <p className="mt-0 mb-4 text-2xs leading-normal text-[color:var(--warning-text)]">
                        This record carries no separate {durationLabel.toLowerCase()} protocol. The steps below are its
                        full delivery protocol, so judge what fits the time you have.
                      </p>
                    ) : null}
                    {steps.length ? (
                      <div className="flex flex-col gap-3.5">
                        {steps.map((step, i) => (
                          <div key={i} className="flex gap-3.5">
                            <span
                              className={`inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-[color:var(--surface-inset)] text-xs font-semibold text-[color:var(--text-muted)]${i === steps.length - 1 ? " bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]" : ""}`}
                            >
                              {i + 1}
                            </span>
                            <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                              <div className="text-sm-minus leading-normal text-[color:var(--text-muted)]">{step}</div>
                              <span data-print-hide className="contents">
                                <Button
                                  variant="toolbar"
                                  size="sm"
                                  icon={copied === `step-${i}` ? Check : Copy}
                                  className="w-tap gap-0 px-0 text-[color:var(--decoration-soft)]"
                                  onClick={() => copy(step, `step-${i}`)}
                                  title="Copy step"
                                  aria-label="Copy step"
                                >
                                  <span className="sr-only">Copy step</span>
                                </Button>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="m-0 text-sm-minus text-[color:var(--text-muted)]">
                        No structured {durationLabel.toLowerCase()} steps in this record yet.{" "}
                        {t.briefVersion
                          ? "Use the source brief version and the clinician script below."
                          : "Open the full record for delivery guidance."}
                      </p>
                    )}

                    {t.clinicianScripts.length ? (
                      <div className="mt-5 pt-4 border-t border-[color:var(--border)]">
                        <div className="text-xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)] mb-2.5">
                          Clinician script
                        </div>
                        {t.clinicianScripts.slice(0, 2).map((c, i) => (
                          <div key={i} className="mb-3">
                            {c.scriptType ? (
                              <div className="text-xs font-semibold text-[color:var(--text-heading)] mb-0.5">
                                {c.scriptType}
                              </div>
                            ) : null}
                            <p className="m-0 text-sm-minus leading-normal text-[color:var(--text-muted)]">{c.body}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className={cn(cardSurface, "py-5 px-5.5")}>
                    <div className="text-base-minus font-semibold text-[color:var(--text-heading)] mb-3.5">
                      Before use
                    </div>
                    <div className="flex flex-col gap-3.5 mb-4">
                      {CHECKLIST.map((item) => (
                        <span key={item} className="flex items-center gap-3 text-sm-minus text-[color:var(--text)]">
                          <span className="w-[19px] h-[19px] border-[1.5px] border-[color:var(--border-strong)] rounded-xs flex-none" />
                          {item}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-start gap-2.5 py-3.5 px-3.5 bg-[color:var(--warning-bg)] border border-[color:var(--warning-border)] rounded-lg">
                      <TriangleAlert
                        aria-hidden="true"
                        size={17}
                        strokeWidth={1.8}
                        className="text-[color:var(--warning-text)] flex-none mt-px"
                      />
                      <span className="text-xs font-semibold leading-normal text-[color:var(--warning-text)]">
                        Clinical review is required before saving or sharing.
                      </span>
                    </div>
                  </div>
                </div>

                <div data-print-hide className="flex gap-2.5 flex-wrap">
                  <Button
                    variant="secondary"
                    icon={copied === "intervention" ? Check : Copy}
                    onClick={() => copy(interventionText, "intervention")}
                  >
                    {copied === "intervention" ? "Copied" : "Copy intervention"}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={FileText}
                    className="ml-auto"
                    onClick={() => {
                      if (!t.patientSheetAvailable) return;
                      b.openSheet(t.slug);
                    }}
                    aria-disabled={t.patientSheetAvailable ? undefined : true}
                    title={t.patientSheetAvailable ? undefined : "This intervention has no patient sheet"}
                  >
                    {t.patientSheetAvailable ? "Open patient sheet" : "Patient sheet unavailable"}
                  </Button>
                </div>
              </PrintOutput>
            </div>
          </Tabs>
          <InformationPageFooter className="mt-6">
            Clinical review is required before saving, sharing, or using this intervention.
          </InformationPageFooter>
        </section>
      </InformationPageShell>
    </>
  );
}

function MetaCell({ eyebrow, text, tone }: { eyebrow: string; text: string; tone?: "warning" }) {
  return (
    <div
      className={`rounded-lg p-3 ${tone === "warning" ? "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]" : "bg-[color:var(--surface-inset)]"}`}
    >
      <div className="text-2xs font-bold uppercase tracking-eyebrow">{eyebrow}</div>
      <p>{text}</p>
    </div>
  );
}
