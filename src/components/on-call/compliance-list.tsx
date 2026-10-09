"use client";

import { cardPadding, cardSurface } from "@/components/card-recipes";
import { cn, metadataPillDensity, textMuted } from "@/components/ui-primitives";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

export interface ComplianceListProps {
  entries: readonly OnCallEntry[];
  testId?: string;
  onEditEntry?: (entry: OnCallEntry) => void;
}

export function extractComplianceCategory(entry: OnCallEntry): string | null {
  if (!entry.details || typeof entry.details !== "object") return null;
  const raw = (entry.details as { category?: unknown }).category;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return null;
}

/**
 * Compliance list displaying doctor compliance requirements.
 * #RHGAYP: When a stored compliance row is unlabelled (missing or unparseable category),
 * displays a clear fallback badge ('General Requirement') so it is never presented
 * as completely unclassified or unlabelled.
 */
export function ComplianceList({ entries, testId = "on-call-compliance-list", onEditEntry }: ComplianceListProps) {
  return (
    <div data-testid={testId} className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {entries.map((entry) => {
        const category = extractComplianceCategory(entry);
        return (
          <article
            key={entry.id}
            data-testid={`on-call-compliance-row-${entry.slug}`}
            className={cn(cardSurface, cardPadding.standard, "grid grid-cols-[minmax(0,1fr)] gap-2")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 grid gap-0.5">
                <h4 className="text-base font-semibold text-[color:var(--text-heading)]">{entry.title}</h4>
                {entry.subtitle ? <p className={cn(textMuted, "text-xs")}>{entry.subtitle}</p> : null}
              </div>
              {onEditEntry ? (
                <button
                  type="button"
                  onClick={() => {
                    onEditEntry(entry);
                  }}
                  aria-label={`Edit ${entry.title}`}
                  className="text-xs text-[color:var(--clinical-accent)] hover:underline"
                >
                  Edit
                </button>
              ) : null}
            </div>

            {entry.body ? <p className="text-sm leading-6 text-[color:var(--text)]">{entry.body}</p> : null}

            <div
              className="flex flex-wrap items-center gap-1.5"
              data-testid={`on-call-compliance-badges-${entry.slug}`}
            >
              {category ? (
                <span
                  className={cn(metadataPillDensity.standard, "rounded-full")}
                  data-testid="compliance-category-badge"
                >
                  {category}
                </span>
              ) : (
                <span
                  className={cn(metadataPillDensity.standard, "rounded-full text-[color:var(--text-muted)]")}
                  data-testid="compliance-fallback-badge"
                >
                  General Requirement
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export { ComplianceList as OnCallComplianceList };
