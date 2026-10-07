"use client";

import { CalendarDays, ClipboardCheck, GraduationCap, ListChecks, Users, type LucideIcon } from "lucide-react";

import { cn } from "@/components/ui-primitives";
import { folderStatusWords, type FolderIcon, type FolderPart, type FolderStatus } from "@/lib/teaching/term-folder";

/*
 * The folder's own small parts, kept presentational so they can move onto the shared work kit later:
 * the segmented completeness meter with its legend, the flat status tag and the flat tinted icon circle.
 * Colour never carries meaning alone: every segment has a word in the legend and the meter has a
 * sentence for screen readers.
 */

export const FOLDER_ICONS: Record<FolderIcon, LucideIcon> = {
  term: CalendarDays,
  attendance: GraduationCap,
  supervision: Users,
  assessment: ClipboardCheck,
  epa: ListChecks,
};

/** Segment fill per status. Complete is the Teaching colour, to fix the warning colour, the rest quiet. */
const SEGMENT: Record<FolderStatus, string> = {
  complete: "bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight]",
  on_track:
    "border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] forced-colors:border-[CanvasText]",
  to_fix: "bg-[color:var(--warning)] forced-colors:bg-[Mark]",
  not_updating:
    "border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] forced-colors:border-[CanvasText]",
  // The decoration grey edge gives an empty segment, and its legend key, at least 3:1 against the card.
  not_started:
    "border border-[color:var(--decoration-soft)] bg-[color:var(--surface-inset)] forced-colors:border-[CanvasText]",
};

const LEGEND_ORDER: readonly FolderStatus[] = ["complete", "on_track", "to_fix", "not_updating", "not_started"];

/** One segment per part, complete first, so the meter fills from the left as the term does. */
export function FolderMeter({
  parts,
  counts,
  label,
}: {
  parts: readonly Pick<FolderPart, "id" | "status">[];
  counts: Record<FolderStatus, number>;
  label: string;
}) {
  const ordered = [...parts].sort((a, b) => LEGEND_ORDER.indexOf(a.status) - LEGEND_ORDER.indexOf(b.status));
  return (
    <div className="grid gap-2">
      <div
        role="img"
        aria-label={label}
        data-testid="term-folder-meter"
        className="grid auto-cols-fr grid-flow-col gap-1 forced-colors:forced-color-adjust-none"
      >
        {ordered.map((part) => (
          <i key={part.id} data-status={part.status} className={cn("block h-2 rounded-xs", SEGMENT[part.status])} />
        ))}
      </div>
      <ul aria-hidden="true" className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-[color:var(--text-muted)]">
        {LEGEND_ORDER.filter((status) => counts[status] > 0).map((status) => (
          <li key={status} className="inline-flex items-center gap-1.5">
            <i className={cn("block size-2 shrink-0 rounded-xs", SEGMENT[status])} />
            <span className="nums font-normal">{`${counts[status]} ${folderStatusWords[status]}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TAG: Record<FolderStatus, string> = {
  complete: "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
  on_track: "border border-[color:var(--border)] text-[color:var(--text-muted)]",
  to_fix: "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]",
  not_updating: "border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]",
  not_started: "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
};

const TAG_WORD: Record<FolderStatus, string> = {
  complete: "Complete",
  on_track: "On track",
  to_fix: "To fix",
  not_updating: "Not updating",
  not_started: "Not yet",
};

/** A flat word tag at the end of a part's row. */
export function FolderTag({ status }: { status: FolderStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-2xs leading-4 font-semibold whitespace-nowrap forced-colors:border",
        TAG[status],
      )}
    >
      {TAG_WORD[status]}
    </span>
  );
}

const CIRCLE: Record<FolderStatus, string> = {
  complete: "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
  on_track: "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
  to_fix: "bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]",
  not_updating: "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
  not_started: "bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
};

/** A flat tinted icon circle: no gradient, no shadow. */
export function FolderIconCircle({ icon, status }: { icon: LucideIcon; status: FolderStatus }) {
  const Icon = icon;
  return (
    <span
      aria-hidden="true"
      className={cn("grid size-9 shrink-0 place-items-center rounded-full forced-colors:border", CIRCLE[status])}
    >
      <Icon aria-hidden="true" className="size-icon-sm" strokeWidth={1.75} />
    </span>
  );
}
