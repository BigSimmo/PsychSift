"use client";

import { ChevronRight } from "lucide-react";

import { AnswerSuggestionChips } from "@/components/clinical-dashboard/answer-suggestion-chips";
import { controlDisabled, cn } from "@/components/ui-primitives";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";

export function AnswerFollowUpSuggestions({
  suggestions,
  onPick,
  disabled = false,
  className,
  testId = "answer-follow-up-suggestions",
  layout = "wrap",
}: {
  suggestions: string[];
  onPick: (suggestion: string) => void;
  disabled?: boolean;
  className?: string;
  testId?: string;
  /**
   * `"rows"` is the answer thread's layout (owner decision, 2026-08-26): one
   * question per full-width row rather than chips.
   *
   * Chips truncate. On a 390px phone the third suggestion sat off the right
   * edge of a horizontally scrolling strip, under an answer that already has
   * one — and a question a clinician cannot read is a question they will not
   * ask. A row gives each one the full measure and stacks them vertically, with
   * the page's own scroll.
   */
  layout?: "wrap" | "scroll" | "rows";
}) {
  if (layout !== "rows") {
    return (
      <AnswerSuggestionChips
        suggestions={suggestions}
        onPick={onPick}
        disabled={disabled}
        label="Try next"
        labelPlacement={layout === "wrap" ? "above" : "inline"}
        testId={testId}
        layout={layout}
        className={className}
      />
    );
  }
  if (!suggestions.length) return null;
  return (
    <section data-testid={testId} aria-label="Follow-up questions" className={cn("min-w-0", className)}>
      <p className="mb-1.5 text-3xs font-semibold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        Follow up
      </p>
      <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)]">
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            disabled={disabled}
            className={cn(
              controlDisabled,
              "flex min-h-12 w-full items-center gap-2 px-3 text-left text-xs font-medium leading-5 text-[color:var(--text-heading)] transition hover:bg-[color:var(--surface-subtle)]",
              index > 0 && "border-t border-[color:var(--border)]",
              focusRing,
            )}
          >
            <span className="min-w-0 flex-1">{suggestion}</span>
            <ChevronRight aria-hidden="true" className="size-icon-xs shrink-0 text-[color:var(--text-muted)]" />
          </button>
        ))}
      </div>
    </section>
  );
}
