"use client";

import { Check, Clock3, FileText, ListChecks, ShieldAlert, Sparkles, Tag, Target, Users } from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildSmartDocumentTags,
  groupSmartDocumentTagsFromTags,
  type SmartDocumentTag,
  type SmartDocumentTagGroup,
} from "@/lib/document-tags";
import { documentTagGroupTone } from "@/lib/document-summary-badges";
import type { DocumentLabel } from "@/lib/types";
import { clinicalBadgeToneClass } from "@/components/clinical-dashboard/clinical-badge";
import { cn } from "@/components/ui-primitives";

type DocumentTagCloudProps = {
  labels?: Array<Pick<DocumentLabel, "label" | "label_type" | "source" | "confidence" | "metadata">> | null;
  query?: string;
  limit?: number;
  compact?: boolean;
  expandable?: boolean;
  className?: string;
  onTagClick?: (tag: SmartDocumentTag) => void;
  selectedTagKeys?: Iterable<string>;
  grouped?: boolean;
};

const groupIcon: Record<SmartDocumentTagGroup, typeof Tag> = {
  Site: FileText,
  Medication: Target,
  Risk: ShieldAlert,
  Workflow: ListChecks,
  Topic: Tag,
  Population: Users,
  Setting: FileText,
  Service: Sparkles,
  "Document type": FileText,
  "Clinical action": ListChecks,
  "Care phase": Clock3,
  "Document intent": Sparkles,
  "Content feature": FileText,
  Manual: Sparkles,
};

// Chip colours come from the canonical semantic-tone system (see
// /reference/colour-coding) via the shared group→tone map, so document tag
// chips read the same as every other clinical badge in the app.
function groupToneClass(group: SmartDocumentTagGroup): string {
  return clinicalBadgeToneClass(documentTagGroupTone[group]);
}

function confidenceTitle(tag: SmartDocumentTag) {
  return `${tag.group}: ${tag.source} tag, ${Math.round(tag.confidence * 100)}% confidence`;
}

/**
 * Renders a document tag with group-specific styling and optional search interaction.
 *
 * @param tag - The document tag to display.
 * @param compact - Whether to use compact sizing.
 * @param selected - Whether to indicate the tag as selected.
 * @param onTagClick - Optional callback invoked when the tag is clicked.
 * @returns The rendered document tag chip.
 */
function DocumentTagChip({
  tag,
  compact,
  selected,
  onTagClick,
}: {
  tag: SmartDocumentTag;
  compact: boolean;
  selected: boolean;
  onTagClick?: (tag: SmartDocumentTag) => void;
}) {
  const Icon = groupIcon[tag.group];
  // Interactive chips own real 48px targets; pseudo-element expansion steals
  // neighbouring wrapped-row taps. Static labels keep their metadata density.
  const tagClassName = cn(
    "inline-flex max-w-full items-center gap-1 rounded-md border font-semibold shadow-[var(--shadow-inset)]",
    compact ? "min-h-6 px-2 text-2xs" : "min-h-7 px-2 text-2xs",
    groupToneClass(tag.group),
    tag.queryMatched && "border-[color:var(--focus)]",
    selected && "border-[color:var(--clinical-accent)]",
    onTagClick &&
      "min-h-tap min-w-tap cursor-pointer justify-center transition-colors hover:border-[color:var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
  );
  const content = (
    <>
      <Icon aria-hidden="true" className={cn("shrink-0", compact ? "size-icon-xs" : "size-icon-sm")} />
      <span className="max-w-[18ch] truncate whitespace-nowrap sm:max-w-[32ch]">{tag.label}</span>
      {selected ? <Check aria-hidden="true" className="size-icon-xs shrink-0" /> : null}
    </>
  );

  return onTagClick ? (
    <button
      key={tag.key}
      type="button"
      title={`${confidenceTitle(tag)}. Search this tag.`}
      aria-pressed={selected}
      onClick={() => onTagClick(tag)}
      className={tagClassName}
    >
      {content}
    </button>
  ) : (
    <span key={tag.key} title={confidenceTitle(tag)} className={tagClassName}>
      {content}
    </span>
  );
}

export function DocumentTagCloud({
  labels,
  query,
  limit = 6,
  compact = false,
  expandable = true,
  className,
  onTagClick,
  selectedTagKeys,
  grouped = false,
}: DocumentTagCloudProps) {
  const tags = useMemo(() => buildSmartDocumentTags(labels, { query, includeManualGroup: true }), [labels, query]);
  const groupedTags = useMemo(() => groupSmartDocumentTagsFromTags(tags), [tags]);
  const selected = useMemo(() => new Set(selectedTagKeys ?? []), [selectedTagKeys]);
  const [expanded, setExpanded] = useState(false);
  if (tags.length === 0) return null;

  const visible = expanded ? tags : tags.slice(0, limit);
  const hiddenCount = Math.max(0, tags.length - visible.length);
  const visibleKeys = new Set(visible.map((tag) => tag.key));

  if (grouped) {
    return (
      <div className={cn("grid gap-3", className)}>
        {groupedTags.map(({ group, tags: groupTags }) => {
          const visibleGroupTags = expanded ? groupTags : groupTags.filter((tag) => visibleKeys.has(tag.key));
          if (visibleGroupTags.length === 0) return null;
          const Icon = groupIcon[group];
          return (
            <section key={group} className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
                <Icon aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--primary)]" />
                {group}
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {visibleGroupTags.map((tag) => (
                  <DocumentTagChip
                    key={tag.key}
                    tag={tag}
                    compact={compact}
                    selected={selected.has(tag.key)}
                    onTagClick={onTagClick}
                  />
                ))}
              </div>
            </section>
          );
        })}
        {hiddenCount > 0 && expandable ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={cn(
              "inline-flex min-h-tap min-w-tap w-fit items-center justify-center rounded-md border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
              "px-2 text-2xs",
            )}
            aria-label={`Show ${hiddenCount} more document tags`}
          >
            +{hiddenCount} more
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {visible.map((tag) => (
        <DocumentTagChip
          key={tag.key}
          tag={tag}
          compact={compact}
          selected={selected.has(tag.key)}
          onTagClick={onTagClick}
        />
      ))}
      {hiddenCount > 0 && expandable ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            "inline-flex min-h-tap min-w-tap items-center justify-center rounded-md border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
            "px-2 text-2xs",
          )}
          aria-label={`Show ${hiddenCount} more document tags`}
        >
          +{hiddenCount} more
        </button>
      ) : hiddenCount > 0 ? (
        <span
          className={cn(
            "inline-flex items-center rounded-md border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] font-semibold text-[color:var(--text-muted)] shadow-[var(--shadow-inset)]",
            compact ? "min-h-6 px-2 text-2xs" : "min-h-7 px-2 text-2xs",
          )}
        >
          +{hiddenCount}
        </span>
      ) : null}
    </div>
  );
}
