"use client";

import { useId, useRef, useState } from "react";
import { Pencil, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InteractiveRow } from "@/components/ui/interactive-row";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";

import { RECOMMEND_CONSTRAINTS } from "./data/select";
import { RecommendScenarioFields, type RecommendScenarioFieldsProps } from "./recommend-scenario-fields";

type RecommendScenarioControlProps = RecommendScenarioFieldsProps & {
  loading: boolean;
  matchCount: number;
};

const PLACEHOLDER = "Describe the clinical situation…";

function truncatePreview(text: string, maxLength = 72) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function RecommendScenarioControl({
  recQuery,
  setRecQuery,
  isConstraintActive,
  isConstraintInferred,
  toggleConstraint,
  idPrefix,
  loading,
  matchCount,
}: RecommendScenarioControlProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeConstraintCount = RECOMMEND_CONSTRAINTS.filter((constraint) => isConstraintActive(constraint.key)).length;
  const preview = truncatePreview(recQuery);
  const matchLabel = loading
    ? "Ranking clinical matches…"
    : `${matchCount} ranked ${matchCount === 1 ? "match" : "matches"}`;

  return (
    <div className="mb-6 sm:hidden">
      <InteractiveRow
        ref={triggerRef}
        type="button"
        testId="therapy-recommend-scenario-trigger"
        aria-expanded={sheetOpen}
        aria-haspopup="dialog"
        aria-controls={sheetOpen ? panelId : undefined}
        onClick={() => setSheetOpen(true)}
        className="w-full gap-3 px-3 py-2.5"
      >
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color:var(--surface-subtle)] text-[color:var(--clinical-accent)]"
        >
          {preview ? (
            <Pencil aria-hidden="true" className="size-icon-md" />
          ) : (
            <Sparkles aria-hidden="true" className="size-icon-md" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-[color:var(--text-heading)]">Clinical scenario</span>
          <span
            className={cn(
              "mt-0.5 block truncate text-sm leading-snug",
              preview ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)]",
            )}
          >
            {preview || PLACEHOLDER}
          </span>
        </span>
        {activeConstraintCount > 0 ? (
          <span className="search-band-badge nums grid h-search-band-badge min-w-search-band-badge shrink-0 place-items-center rounded-full bg-[color:var(--search-band-badge-bg)] px-1 text-2xs font-bold text-[color:var(--clinical-accent)]">
            {activeConstraintCount}
          </span>
        ) : null}
        <span className="sr-only">
          {activeConstraintCount > 0
            ? `${activeConstraintCount} constraint${activeConstraintCount === 1 ? "" : "s"} active`
            : "No constraints active"}
          . Opens clinical scenario editor.
        </span>
      </InteractiveRow>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        returnFocusRef={triggerRef}
        title="Clinical scenario"
        descriptionContent={
          <p className="text-xs font-medium leading-5 text-[color:var(--text-muted)]">
            Describe the presentation and constraints. Rankings update as you type.
          </p>
        }
        headerClassName="items-start px-4 py-3 sm:px-5 sm:py-3.5"
        titleClassName="text-base sm:text-lg"
        closeButtonClassName={cn(
          "grid h-tap w-tap shrink-0 place-items-center rounded-lg text-[color:var(--text-muted)] transition hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)] motion-reduce:transition-none",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
        )}
        portal
        placement="responsive-right"
        id={panelId}
        testId="therapy-recommend-scenario-panel"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-xs font-semibold text-[color:var(--text-muted)]">{matchLabel}</span>
            <Button
              variant="primary"
              size="sm"
              testId="therapy-recommend-scenario-done"
              onClick={() => setSheetOpen(false)}
            >
              Done
            </Button>
          </div>
        }
      >
        <form data-therapy-recommend-composer className="min-w-0" onSubmit={(event) => event.preventDefault()}>
          <RecommendScenarioFields
            recQuery={recQuery}
            setRecQuery={setRecQuery}
            isConstraintActive={isConstraintActive}
            isConstraintInferred={isConstraintInferred}
            toggleConstraint={toggleConstraint}
            idPrefix={idPrefix}
          />
        </form>
      </Sheet>
    </div>
  );
}
