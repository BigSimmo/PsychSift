"use client";

import type { ReactNode } from "react";
import { ChevronRight, Scale, Waypoints } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";

import type { Pathway, PathwayStep, Therapy } from "./data/types";
import { pathwayLinkedStepCount } from "./pathway-review-label";
import { StatusBadge } from "./ui";

type PathwayStepStackProps = {
  steps: PathwayStep[];
  bySlug: Map<string, Therapy>;
  onOpenRecord: (slug: string) => void;
};

function StepCard({
  step,
  index,
  last,
  therapy,
  onOpenRecord,
  layout,
}: {
  step: PathwayStep;
  index: number;
  last: boolean;
  therapy: Therapy | undefined;
  onOpenRecord: (slug: string) => void;
  layout: "mobile" | "desktop";
}) {
  const title = therapy?.name ?? step.label ?? "Therapy step";
  const description = step.description ?? therapy?.bestUsedFor ?? "Review fit, contraindications and source status.";
  const roleLabel = step.label ?? "STEP";

  if (layout === "mobile") {
    // A divided row of the pathway card, not a card of its own. The pathway
    // card is the one box; steps are separated by a hairline, and the numbered
    // timeline still runs from each step down to the next.
    return (
      <article className="relative flex flex-col gap-1.5 py-4">
        {!last ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[-1rem] left-[14px] top-[calc(1rem+1.75rem)] w-px bg-[color:var(--border)]"
          />
        ) : null}
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "inline-flex size-7 flex-none items-center justify-center rounded-full text-xs font-semibold",
              last
                ? "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                : "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
            )}
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-sm-minus font-semibold text-[color:var(--text-heading)]">{title}</h3>
              <span className="inline-flex items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-inset)] px-2 py-0.5 text-2xs font-bold tracking-eyebrow text-[color:var(--text-muted)]">
                {roleLabel}
              </span>
              {/* Only when the step resolves to a record. `description` falls
                  back to that record's `bestUsedFor`, so a linked step quotes
                  its clinical prose and owes its review state; an unlinked step
                  names no record and has none to state. */}
              {therapy ? <StatusBadge status={therapy.reviewStatus} size="compact" /> : null}
            </div>
            <p className="mt-1.5 mb-0 text-xs leading-normal text-[color:var(--text-muted)]">{description}</p>
          </div>
        </div>
        {therapy ? (
          // A quiet text action under the step's prose. The full-width bordered
          // button it replaces was a third box inside the step and the card.
          <Button
            variant="ghost"
            size="sm"
            trailingIcon={ChevronRight}
            className="ml-8 min-h-tap self-start px-2 text-[color:var(--clinical-accent)] hover:text-[color:var(--clinical-accent)]"
            onClick={() => onOpenRecord(therapy.slug)}
          >
            Open record
          </Button>
        ) : (
          <ChevronRight
            aria-hidden="true"
            size={16}
            strokeWidth={1.8}
            className="self-end text-[color:var(--decoration-soft)]"
          />
        )}
      </article>
    );
  }

  return (
    <div className="relative flex items-stretch gap-4">
      <div className="flex w-[26px] flex-none flex-col items-center">
        {/* The timeline's top stub. Rows now sit flush, so the line has to
            carry on from the step above rather than stop at a gap. */}
        <span aria-hidden="true" className={cn("mb-1 h-3 w-px flex-none", index > 0 && "bg-[color:var(--border)]")} />
        <span
          className={cn(
            "inline-flex size-[26px] flex-none items-center justify-center rounded-full text-xs font-semibold",
            last
              ? "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
              : "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
          )}
        >
          {index + 1}
        </span>
        {!last ? <span aria-hidden="true" className="mt-1 w-px flex-1 bg-[color:var(--border)]" /> : null}
      </div>
      {/* A row divided by a hairline, not a card inside the pathway card. */}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3.5 px-2 py-3.5 transition-colors duration-[var(--duration-instant)] hover:bg-[color:var(--surface-subtle)]",
          !last && "border-b border-[color:var(--border)]",
        )}
      >
        <span className="inline-flex size-[34px] flex-none items-center justify-center rounded-md bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
          <Scale aria-hidden="true" size={17} strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm-minus font-semibold text-[color:var(--text-heading)]">{title}</span>
            {therapy ? <StatusBadge status={therapy.reviewStatus} size="compact" /> : null}
          </div>
          <div className="mt-0.5 line-clamp-2 text-xs text-[color:var(--text-muted)]">{description}</div>
        </div>
        <span className="whitespace-nowrap text-3xs font-bold tracking-eyebrow text-[color:var(--text-muted)]">
          {roleLabel}
        </span>
        {therapy ? (
          <Button variant="secondary" size="sm" className="flex-none" onClick={() => onOpenRecord(therapy.slug)}>
            Open record
          </Button>
        ) : (
          <ChevronRight
            aria-hidden="true"
            size={16}
            strokeWidth={1.8}
            className="flex-none text-[color:var(--decoration-soft)]"
          />
        )}
      </div>
    </div>
  );
}

export function PathwayStepStack({ steps, bySlug, onOpenRecord }: PathwayStepStackProps) {
  return (
    <>
      <div
        data-testid="therapy-pathway-steps"
        className="flex flex-col divide-y divide-[color:var(--border)] sm:hidden"
        aria-label="Pathway steps"
      >
        {steps.map((step, index) => {
          const therapy = step.therapySlug ? bySlug.get(step.therapySlug) : undefined;
          return (
            <StepCard
              key={`${step.therapySlug ?? step.label ?? "step"}-${index}`}
              step={step}
              index={index}
              last={index === steps.length - 1}
              therapy={therapy}
              onOpenRecord={onOpenRecord}
              layout="mobile"
            />
          );
        })}
      </div>
      <div data-testid="therapy-pathway-steps-desktop" className="hidden flex-col sm:flex" aria-label="Pathway steps">
        {steps.map((step, index) => {
          const therapy = step.therapySlug ? bySlug.get(step.therapySlug) : undefined;
          return (
            <StepCard
              key={`${step.therapySlug ?? step.label ?? "step"}-desktop-${index}`}
              step={step}
              index={index}
              last={index === steps.length - 1}
              therapy={therapy}
              onOpenRecord={onOpenRecord}
              layout="desktop"
            />
          );
        })}
      </div>
    </>
  );
}

export function PathwayDetailHeader({ pathway, reviewBadge }: { pathway: Pathway; reviewBadge?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-3.5">
      <span className="inline-flex size-[46px] flex-none items-center justify-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
        <Waypoints aria-hidden="true" size={24} strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-xl font-semibold text-[color:var(--text-heading)]">{pathway.name}</h2>
          {reviewBadge}
        </div>
        <p className="mt-1.5 mb-2 text-sm-minus leading-normal text-[color:var(--text-muted)]">
          {pathway.summary ??
            "A source-linked workflow for reviewing therapy options, delivery constraints and cautions before choosing a next step."}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
          <Waypoints aria-hidden="true" size={14} strokeWidth={1.8} className="text-[color:var(--decoration-soft)]" />
          {pathwayLinkedStepCount(pathway)} linked therapy steps
        </div>
      </div>
    </div>
  );
}
