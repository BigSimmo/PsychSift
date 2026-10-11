"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Search, Waypoints } from "lucide-react";

import { InteractiveRow } from "@/components/ui/interactive-row";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";

import type { Pathway } from "./data/types";
import {
  matchesPathwayFilter,
  pathwayLinkedStepCount,
  pathwayReviewBadgeClass,
  pathwayReviewLabel,
  pathwayRowAccessibleName,
} from "./pathway-review-label";

type PathwayListRailProps = {
  pathways: Pathway[];
  activeSlug: string;
  onSelect: (slug: string) => void;
};

export function PathwayListRail({ pathways, activeSlug, onSelect }: PathwayListRailProps) {
  return (
    <div className="therapy-pathway-list hidden border-r border-[color:var(--border)] p-4 sm:block">
      <div className="mb-3.5 text-base-minus font-semibold text-[color:var(--text-heading)]">Pathways</div>
      {/* Divided rows, not a stack of cards: the rail already sits inside the
          pathway card, and a card per pathway put boxes inside a box. The
          chosen pathway is a soft tint of the area colour, with no side bar. */}
      <div className="flex flex-col border-y border-[color:var(--border)]">
        {pathways.map((pathway) => {
          const active = pathway.slug === activeSlug;
          const reviewed = pathway.reviewStatus === "reviewed";
          return (
            <InteractiveRow
              key={pathway.slug}
              variant="table-row"
              className="items-start gap-3.5 px-2 py-3.5 aria-[current=true]:bg-[color:var(--clinical-accent-soft)]"
              active={active}
              aria-label={pathwayRowAccessibleName(pathway, active)}
              onClick={() => onSelect(pathway.slug)}
            >
              <span className="inline-flex size-[38px] flex-none items-center justify-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                <Waypoints aria-hidden="true" size={20} strokeWidth={1.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[color:var(--text-heading)]">{pathway.name}</span>
                <span className="mt-0.5 mb-2 block line-clamp-2 text-xs text-[color:var(--text-muted)]">
                  {pathway.clinicalProblem ?? pathway.summary ?? "Therapy workflow"}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-2xs text-[color:var(--text-muted)]">
                    {pathwayLinkedStepCount(pathway)} linked steps
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-semibold",
                      pathwayReviewBadgeClass(reviewed),
                    )}
                  >
                    {pathwayReviewLabel(pathway)}
                  </span>
                </span>
              </span>
            </InteractiveRow>
          );
        })}
      </div>
      <p className="mt-4 mb-0 text-2xs italic text-[color:var(--text-muted)]">
        Pathways are generated from imported therapy records.
      </p>
    </div>
  );
}

type PathwayPickerSheetProps = {
  pathways: Pathway[];
  activePathway: Pathway;
  onSelect: (slug: string) => void;
};

export function PathwayMobileBar({ pathways, activePathway, onSelect }: PathwayPickerSheetProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const panelId = useId();
  const filterId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reviewed = activePathway.reviewStatus === "reviewed";
  const filteredPathways = useMemo(
    () => pathways.filter((pathway) => matchesPathwayFilter(pathway, filter)),
    [pathways, filter],
  );

  const closeSheet = () => {
    setSheetOpen(false);
    setFilter("");
  };

  return (
    <div className="mb-4 sm:hidden" data-testid="therapy-pathway-picker">
      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4",
        )}
      >
        <div className="flex items-start gap-3">
          <span className="inline-flex size-10 flex-none items-center justify-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
            <Waypoints aria-hidden="true" size={20} strokeWidth={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-base font-semibold text-[color:var(--text-heading)]">{activePathway.name}</h2>
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-semibold",
                  pathwayReviewBadgeClass(reviewed),
                )}
              >
                {pathwayReviewLabel(activePathway)}
              </span>
            </div>
            <p className="mt-1 mb-0 text-xs text-[color:var(--text-muted)]">
              {activePathway.clinicalProblem ?? activePathway.summary ?? "Therapy workflow"}
            </p>
          </div>
        </div>
        <Button
          ref={triggerRef}
          type="button"
          variant="secondary"
          className="w-full min-h-tap"
          aria-expanded={sheetOpen}
          aria-haspopup="dialog"
          aria-controls={sheetOpen ? panelId : undefined}
          onClick={() => setSheetOpen(true)}
        >
          Change pathway
        </Button>
      </div>

      <Sheet
        open={sheetOpen}
        onClose={closeSheet}
        returnFocusRef={triggerRef}
        title="Choose pathway"
        descriptionContent={
          <p className="text-xs font-medium leading-5 text-[color:var(--text-muted)]">
            Select a clinical problem workflow. {pathways.length} pathways available.
          </p>
        }
        portal
        placement="responsive-right"
        id={panelId}
        testId="therapy-pathway-picker-panel"
        footer={
          <Button type="button" variant="secondary" className="w-full min-h-tap" onClick={closeSheet}>
            Done
          </Button>
        }
      >
        <label htmlFor={filterId} className="relative mb-3 flex items-center">
          <Search
            aria-hidden="true"
            size={16}
            strokeWidth={1.8}
            className="absolute left-3 text-[color:var(--decoration-soft)]"
          />
          <input
            id={filterId}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter pathways…"
            aria-label="Filter pathways"
            className="w-full min-h-tap rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] py-0 pr-3 pl-9 text-sm-minus text-[color:var(--text)]"
          />
        </label>
        <div className="flex flex-col gap-2">
          {filteredPathways.length === 0 ? (
            <p className="m-0 px-1 py-2 text-sm text-[color:var(--text-muted)]">No pathways match that filter.</p>
          ) : null}
          {filteredPathways.map((pathway) => {
            const active = pathway.slug === activePathway.slug;
            const pathwayReviewed = pathway.reviewStatus === "reviewed";
            return (
              <InteractiveRow
                key={pathway.slug}
                variant="card"
                active={active}
                aria-label={pathwayRowAccessibleName(pathway, active)}
                onClick={() => {
                  onSelect(pathway.slug);
                  closeSheet();
                }}
              >
                <span className="inline-flex size-9 flex-none items-center justify-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                  <Waypoints aria-hidden="true" size={18} strokeWidth={1.6} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[color:var(--text-heading)]">{pathway.name}</span>
                  <span className="mt-0.5 block text-xs text-[color:var(--text-muted)]">
                    {pathway.clinicalProblem ?? pathway.summary ?? "Therapy workflow"}
                  </span>
                  <span className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-2xs text-[color:var(--text-muted)]">
                      {pathwayLinkedStepCount(pathway)} linked steps
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-semibold",
                        pathwayReviewBadgeClass(pathwayReviewed),
                      )}
                    >
                      {pathwayReviewLabel(pathway)}
                    </span>
                  </span>
                </span>
              </InteractiveRow>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}
