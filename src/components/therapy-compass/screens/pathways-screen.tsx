"use client";

import { useMemo } from "react";
import { Check, Copy, FileText, Info, ListChecks, ShieldCheck, TriangleAlert, Waypoints } from "lucide-react";

import { cardSurface } from "@/components/card-recipes";
import { Chip } from "@/components/ui/chip";
import { PageHeader } from "@/components/ui/page-header";
import { cn, pageContainer } from "@/components/ui-primitives";
import { Button } from "@/components/ui/button";

import { useTcBindings } from "../bindings";
import { LoadingState } from "../ui";
import { useClipboard } from "../use-clipboard";
import { PathwayMobileBar, PathwayListRail } from "../pathway-picker-sheet";
import { PathwayDetailHeader, PathwayStepStack } from "../pathway-step-stack";
import { pathwayLinkedStepCount, pathwayReviewBadgeClass, pathwayReviewLabel } from "../pathway-review-label";

export function PathwaysScreen() {
  const b = useTcBindings();
  const bySlug = useMemo(() => new Map(b.therapies.map((t) => [t.slug, t])), [b.therapies]);
  const pathway = b.selectedPathway;
  // Counts the steps that link to a therapy record, the same count each pathway row shows.
  const linkedStepCount = useMemo(
    () => b.pathways.reduce((total, p) => total + pathwayLinkedStepCount(p), 0),
    [b.pathways],
  );
  const anyIncomplete = b.pathways.some((p) => pathwayReviewLabel(p) === "Incomplete");
  const { copied, copy } = useClipboard();

  if (b.loading || !pathway) return <LoadingState label="Loading pathways…" />;

  const firstLinkedSlug =
    pathway.steps
      .map((step) => (step.therapySlug ? bySlug.get(step.therapySlug) : undefined))
      .find((therapy) => therapy?.patientSheetAvailable)?.slug ?? null;
  const reviewed = pathway.reviewStatus === "reviewed";

  const copyPathway = () => {
    const lines = pathway.steps.map((st, i) => {
      const name = (st.therapySlug ? bySlug.get(st.therapySlug)?.name : null) ?? st.label ?? "Step";
      return `${i + 1}. ${name}${st.description ? ` — ${st.description}` : ""}`;
    });
    copy(`${pathway.name}\n\n${lines.join("\n")}`, "pathway");
  };

  return (
    <section data-screen-label="Pathways" className={pageContainer}>
      <PageHeader
        className="mb-5 sm:mb-6"
        icon={Waypoints}
        title="Clinical Pathways"
        description="Step-by-step workflows for common clinical problems."
        meta={
          <>
            <Chip appearance={{ kind: "information", tone: "accent" }} icon={Waypoints}>
              {b.pathways.length} {b.pathways.length === 1 ? "pathway" : "pathways"}
            </Chip>
            <Chip appearance={{ kind: "information", tone: "inset" }} icon={ListChecks}>
              {linkedStepCount} {linkedStepCount === 1 ? "linked step" : "linked steps"}
            </Chip>
          </>
        }
      />

      {anyIncomplete ? (
        // What the amber tag means, in the words the pathway data already uses for it
        // ("Marked incomplete until clinician review confirms sequencing").
        <p
          data-testid="therapy-pathways-incomplete-note"
          className="mb-4 flex items-start gap-2 text-sm-minus leading-snug text-[color:var(--text-muted)]"
        >
          <Info aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
          <span>
            <strong className="font-semibold text-[color:var(--text)]">Incomplete</strong> means clinician review has
            not yet confirmed the order of the steps.
          </span>
        </p>
      ) : null}

      <PathwayMobileBar pathways={b.pathways} activePathway={pathway} onSelect={b.selectPathway} />

      <div className={cn(cardSurface, "grid grid-cols-1 sm:grid-cols-[320px_minmax(0,_1fr)] gap-4")}>
        <PathwayListRail pathways={b.pathways} activeSlug={pathway.slug} onSelect={b.selectPathway} />

        <div className="min-w-0 px-4 py-1 sm:px-6 sm:py-6">
          <div className="hidden sm:block">
            <PathwayDetailHeader
              pathway={pathway}
              reviewBadge={
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold",
                    pathwayReviewBadgeClass(reviewed),
                  )}
                >
                  {reviewed ? (
                    <ShieldCheck aria-hidden="true" size={14} strokeWidth={1.8} />
                  ) : (
                    <TriangleAlert aria-hidden="true" size={14} strokeWidth={1.8} />
                  )}
                  {pathwayReviewLabel(pathway)}
                </span>
              }
            />
          </div>

          <PathwayStepStack steps={pathway.steps} bySlug={bySlug} onOpenRecord={b.open} />
        </div>
      </div>

      <div
        data-testid="therapy-pathway-caution"
        className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-5 py-4 sm:px-6"
      >
        <TriangleAlert
          aria-hidden="true"
          size={22}
          strokeWidth={1.8}
          className="flex-none text-[color:var(--warning-text)]"
        />
        <div className="min-w-[200px] flex-1">
          <div className="text-sm-minus font-semibold text-[color:var(--warning-text)]">
            Clinical caution — source-grounded therapy reference generated from imported records.
          </div>
          <div className="mt-0.5 text-xs text-[color:var(--warning-text)]">
            {pathway.cautions ??
              "Review source status, missing fields and patient-specific factors before clinical use."}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <Button
            variant="secondary"
            icon={copied === "pathway" ? Check : Copy}
            className="w-full min-h-tap sm:w-auto"
            onClick={copyPathway}
          >
            {copied === "pathway" ? "Copied" : "Copy pathway"}
          </Button>
          <Button
            variant="primary"
            icon={FileText}
            className="w-full min-h-tap sm:w-auto"
            onClick={() => firstLinkedSlug && b.openSheet(firstLinkedSlug)}
            disabled={!firstLinkedSlug}
          >
            {firstLinkedSlug ? "Patient sheet" : "Patient sheet unavailable"}
          </Button>
        </div>
      </div>
    </section>
  );
}
