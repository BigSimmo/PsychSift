"use client";

import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";

import { BookOpen, FileText, Pencil, User } from "lucide-react";
import Link from "next/link";

import { cardInteractive, cardSurface } from "@/components/card-recipes";
import { OnCallStaleFlag } from "@/components/on-call/on-call-freshness-badge";
import { OnCallVerifyButton } from "@/components/on-call/on-call-entry-editor";
import type { OnCallLinkedDocument } from "@/components/on-call/on-call-playbook-section";
import { OnCallChecklist, type OnCallChecklistItem } from "@/components/on-call/on-call-checklist";
import { onCallEntryGroups } from "@/components/on-call/on-call-entry-groups";
import { OnCallGroupSection } from "@/components/on-call/on-call-group-section";
import {
  ON_CALL_ORIENTATION_UNFILED_LABEL,
  onCallOrientationCategoryFacet,
  sortOnCallEntries,
} from "@/components/on-call/on-call-page-sections";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { cn, eyebrowText, textMuted, toolbarButton } from "@/components/ui-primitives";
import {
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
  type OnCallEntry,
  onCallEntryIsEditable,
} from "@/lib/on-call/entry-model";
import { formatClinicalDate } from "@/lib/source-metadata";

export interface OnCallOrientationSectionProps {
  entries: readonly OnCallEntry[];
  /** The owner's own documents that `linkedDocumentIds` may point at, keyed by id. */
  documents?: Readonly<Record<string, OnCallLinkedDocument>>;
  /** True while linked documents are still being looked up; see the Playbook's prop of the same name. */
  documentsLoading?: boolean;
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: Date;
  testId?: string;
  /** Opens the entry editor for this row. Omitted when the viewer cannot edit. */
  onEditEntry?: (entry: OnCallEntry) => void;
  /** One-tap "still correct today"; shown only on a stale entry. */
  onVerified?: (entry: OnCallEntry) => void;
}

const documentLinkRow = cn(cardInteractive, "flex min-h-tap w-full items-center gap-3 rounded-lg p-3 text-left");

function OrientationCard({
  entry,
  documents,
  documentsLoading,
  now,
  onEditEntry,
  onVerified,
}: {
  entry: OnCallEntry;
  documents: Readonly<Record<string, OnCallLinkedDocument>>;
  documentsLoading: boolean;
  now: Date;
  onEditEntry?: (entry: OnCallEntry) => void;
  onVerified?: (entry: OnCallEntry) => void;
}) {
  const freshness = onCallEntryFreshness(entry, now);
  const linkedDocs = entry.linkedDocumentIds
    .map((id) => documents[id])
    .filter((doc): doc is OnCallLinkedDocument => Boolean(doc));
  const showVerify = freshness.state === "stale" && Boolean(onVerified);
  const parsedDetails = onCallDetailsSchemaFor("orientation").safeParse(entry.details);
  const checklist: OnCallChecklistItem[] = parsedDetails.success
    ? ((parsedDetails.data as { checklist?: OnCallChecklistItem[] }).checklist ?? [])
    : [];

  return (
    <article
      id={onCallEntryAnchorId(entry.id)}
      tabIndex={-1}
      // The shared recipe, not a hand-rolled copy of it: these three had every
      // class right except `forced-colors:border`, so in Windows High Contrast
      // the card edge disappeared.
      className={cn(cardSurface, "grid grid-cols-[minmax(0,1fr)] gap-3 p-4")}
      data-on-call-entry-card=""
      data-testid={`on-call-orientation-card-${entry.slug}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[color:var(--text)]">{entry.title}</h3>
          {entry.subtitle ? <p className={cn("mt-0.5 text-xs", textMuted)}>{entry.subtitle}</p> : null}
        </div>
        {/* Sibling to the card content, never inside a link: the document
            link below is its own `<a>`, and a `<button>` inside an `<a>` is
            invalid, duplicate-interactive markup. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <OnCallStaleFlag freshness={freshness} />
          {showVerify && onVerified ? <OnCallVerifyButton entry={entry} onVerified={onVerified} /> : null}
          {onEditEntry ? (
            <button
              type="button"
              onClick={() => onEditEntry(entry)}
              aria-label={`Edit ${entry.title}`}
              data-testid={`on-call-orientation-edit-${entry.slug}`}
              className={cn(toolbarButton, "shrink-0")}
            >
              <Pencil aria-hidden className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      {entry.body ? (
        // The pinned summary sits ABOVE the document link, inside a bordered
        // note, always visibly attributed to the owner — spec §7.4: it must
        // never read as the manual's own words. `pinnedSummaryIsOwnerNote` on
        // `details` exists purely so this attribution can never be forgotten;
        // the flag itself carries no other information.
        <div
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-inset)] p-3"
          data-testid={`on-call-orientation-note-${entry.slug}`}
        >
          <p className={cn(eyebrowText, "mb-1 flex items-center gap-1.5")}>
            <User className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Your note
          </p>
          <p className="text-sm text-[color:var(--text)]">{entry.body}</p>
        </div>
      ) : null}

      {checklist.length > 0 ? (
        <OnCallChecklist entryId={entry.id} slug={entry.slug} items={checklist} label={`${entry.title} checklist`} />
      ) : null}

      {linkedDocs.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {linkedDocs.map((doc) => (
            <Link key={doc.id} href={`/documents/${doc.id}`} className={documentLinkRow}>
              <FileText className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[color:var(--text)]">{doc.title}</span>
                <span className={cn("block truncate text-xs", textMuted)}>{formatClinicalDate(doc.date)}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className={cn("text-sm", textMuted)}>
          {entry.linkedDocumentIds.length
            ? documentsLoading
              ? "Loading the linked document…"
              : "Linked document unavailable. It may be offline, removed, or unavailable to your account."
            : "No document linked yet."}
        </p>
      )}
    </article>
  );
}

/**
 * The Orientation section: a shelf of manuals. The uploaded document stays
 * the source of truth (spec §2) — this component never retypes manual
 * content. Where the owner has pinned a short summary, it renders above the
 * document link inside a bordered note that is always labelled "Your note",
 * so it can never be mistaken for the manual's own words.
 */
export function OnCallOrientationSection({
  entries,
  documents = {},
  documentsLoading = false,
  now = new Date(),
  testId = "on-call-orientation-section",
  onEditEntry,
  onVerified,
}: OnCallOrientationSectionProps) {
  const allOrientation = entries.filter((entry) => entry.section === "orientation");

  if (allOrientation.length === 0) {
    return (
      <OnCallEmptyState
        icon={BookOpen}
        title="No orientation manuals yet"
        body="Manuals you add will appear here as a shelf, filed into folders you name, each optionally carrying your own pinned summary above it."
        testId="on-call-orientation-empty"
      />
    );
  }

  const sorted = sortOnCallEntries(allOrientation);
  // The shelf files into FOLDERS the owner names on the manual itself —
  // "Induction", "Manuals", "Departure" — rather than into its
  // tags, which are how they go looking for it later. Both the comparator above
  // and the facet below come from `on-call-page-sections.ts`, which declares
  // this page's jump list: same order in, same slugs out, so every row the
  // header offers is a heading that exists here.
  //
  // `category` is optional on this section, so a manual without one keeps its
  // place on the shelf under the trailing fallback heading. Fewer than two
  // folders in play and `onCallEntryGroups` reports none at all, which is what
  // leaves a short shelf as the flat list it should be.
  const groups = onCallEntryGroups(sorted, onCallOrientationCategoryFacet, ON_CALL_ORIENTATION_UNFILED_LABEL);

  const cardFor = (entry: OnCallEntry) => (
    <OrientationCard
      key={entry.id}
      entry={entry}
      documents={documents}
      documentsLoading={documentsLoading}
      now={now}
      onEditEntry={onCallEntryIsEditable(entry) ? onEditEntry : undefined}
      onVerified={onCallEntryIsEditable(entry) ? onVerified : undefined}
    />
  );

  return (
    <div data-testid={testId} className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {groups.length === 0
        ? sorted.map(cardFor)
        : groups.map((group) => (
            <OnCallGroupSection
              key={group.slug}
              label={group.label}
              slug={group.slug}
              count={group.entries.length}
              headingId={`on-call-orientation-${group.slug}-heading`}
              testId={`on-call-orientation-group-${group.slug}`}
            >
              {group.entries.map(cardFor)}
            </OnCallGroupSection>
          ))}
    </div>
  );
}
