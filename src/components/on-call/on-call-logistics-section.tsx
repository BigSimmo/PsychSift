"use client";

import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";

import { onCallTelHref } from "@/lib/on-call/home-modules";

import { BriefcaseBusiness, FileText, Lock, MapPinned, Pencil, Phone, type LucideIcon } from "lucide-react";

import { OnCallEntryRow } from "@/components/on-call/on-call-entry-row";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { OnCallStaleFlag } from "@/components/on-call/on-call-freshness-badge";
import { allocateOnCallGroupSlug, onCallGroupAnchorId } from "@/components/on-call/on-call-page-anchors";
import { onCallAdminCategoryLabel } from "@/components/on-call/on-call-page-sections";
import { OnCallPrivateFlag } from "@/components/on-call/on-call-private-flag";
import { OnCallVerifyButton } from "@/components/on-call/on-call-entry-editor";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { ExternalTextLink } from "@/components/ui/link";
import { cn, eyebrowText, metadataPillDensity, textMuted, toolbarButton } from "@/components/ui-primitives";
import { partitionLogisticsEntries } from "@/lib/on-call/compliance";
import {
  isOnCallHttpUrl,
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
  type OnCallEntry,
  onCallEntryIsEditable,
} from "@/lib/on-call/entry-model";
import { recordOnCallRecent } from "@/lib/on-call/recent-storage";

export interface OnCallLogisticsSectionProps {
  entries: readonly OnCallEntry[];
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: Date;
  testId?: string;
  /** Opens the entry editor for this row. Omitted when the viewer cannot edit. */
  onEditEntry?: (entry: OnCallEntry) => void;
  /** One-tap "still correct today"; shown only on a stale entry. */
  onVerified?: (entry: OnCallEntry) => void;
}

interface OnCallLogisticsDetails {
  category: string;
  location?: string;
  hours?: string;
  phone?: string;
  url?: string;
}

function parseLogisticsDetails(details: unknown): OnCallLogisticsDetails | null {
  const result = onCallDetailsSchemaFor("logistics").safeParse(details);
  return result.success ? (result.data as OnCallLogisticsDetails) : null;
}

/**
 * The glyph a row wears, which follows what the row IS rather than what this
 * section used to be called.
 *
 * Every row here once got a map pin, because every row was a place — parking,
 * the call room, the after-hours door. Most admin is not a place: a leave
 * application, a roster, a pay claim and a form were all being pinned to a
 * location they do not have. The pin is now reserved for the rows that really
 * carry one, which is how the facilities notes this page was first built for
 * stay at home here rather than reading as strays.
 */
function adminRowIcon(details: OnCallLogisticsDetails | null, callable: boolean): LucideIcon {
  if (callable) return Phone;
  if (details?.location) return MapPinned;
  return FileText;
}

function LogisticsRow({
  entry,
  now,
  onEditEntry,
  onVerified,
}: {
  entry: OnCallEntry;
  now: Date;
  onEditEntry?: (entry: OnCallEntry) => void;
  onVerified?: (entry: OnCallEntry) => void;
}) {
  const details = parseLogisticsDetails(entry.details);
  const freshness = onCallEntryFreshness(entry, now);
  const href = onCallTelHref(details?.phone);
  const showVerify = freshness.state === "stale" && Boolean(onVerified);

  return (
    <div className="grid gap-1.5" id={onCallEntryAnchorId(entry.id)} tabIndex={-1}>
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <OnCallEntryRow
            icon={adminRowIcon(details, Boolean(href))}
            title={entry.title}
            subtitle={details?.location}
            href={href}
            onActivate={() => recordOnCallRecent({ id: entry.id, title: entry.title })}
            testId={`on-call-logistics-row-${entry.slug}`}
          >
            {details?.hours ? (
              <span className={cn(metadataPillDensity.standard, "rounded-full")}>{details.hours}</span>
            ) : null}
            {/* Printed whether or not the row dials it. Until 2026-09-24 a
                dialable number turned the row into a call link and was never
                shown, so a tap rang a number the reader had not seen. */}
            {details?.phone ? (
              <span className={cn(metadataPillDensity.standard, "rounded-full tabular-nums")}>{details.phone}</span>
            ) : null}
            {entry.isPersonal ? <OnCallPrivateFlag compact /> : null}
            <OnCallStaleFlag freshness={freshness} />
          </OnCallEntryRow>
        </div>
        {/* Sibling to the row, never nested inside it: the row above can
            itself be a `tel:` link, and a `<button>` inside an `<a>` is
            invalid, duplicate-interactive markup. */}
        {onEditEntry || showVerify ? (
          <div className="flex shrink-0 flex-col items-stretch justify-center gap-1.5">
            {showVerify && onVerified ? <OnCallVerifyButton entry={entry} onVerified={onVerified} /> : null}
            {onEditEntry ? (
              <button
                type="button"
                onClick={() => onEditEntry(entry)}
                aria-label={`Edit ${entry.title}`}
                data-testid={`on-call-logistics-edit-${entry.slug}`}
                className={cn(toolbarButton, "shrink-0")}
              >
                <Pencil aria-hidden className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {isOnCallHttpUrl(details?.url) ? (
        // Rendered as a sibling, never nested inside the row above: when the
        // row itself is a `tel:` anchor, an interactive link inside it would
        // be invalid markup (an anchor inside an anchor) and unreachable by
        // keyboard in a predictable order.
        <ExternalTextLink href={details.url} className="ml-1 inline-flex min-h-tap items-center text-xs">
          More info
        </ExternalTextLink>
      ) : null}
    </div>
  );
}

/**
 * The Admin section: the work admin a doctor does for themselves — leave, both
 * sick and professional development; rosters and hours; pay and claims; forms;
 * IT and access. Facilities keep a folder of their own, so the parking, food
 * and call-room notes this page was first built for are still at home in it
 * rather than being orphaned by the change of purpose.
 *
 * Compliance rows never reach this list. They are stored in the same section
 * behind `details.kind`, because `section` is a database CHECK constraint and a
 * seventh value costs a migration that reaches the live clinical database, and
 * `partitionLogisticsEntries` is the single place the two are told apart. A
 * registration whose expiry can stop someone working has no business filed
 * among forms and rosters, where nothing is expected to run out — that is the
 * one hazard `src/lib/on-call/compliance.ts` documents, and this filter is half
 * of what closes it.
 *
 * Grouped by `details.category`, which the schema requires on every row, so the
 * grouping key can never be missing the way Contacts' `tags`-derived area can.
 * The label itself comes from `onCallAdminCategoryLabel`, shared with the jump
 * list this page's header draws, so a heading and the row that jumps to it
 * cannot drift apart.
 *
 * Only the label and the contents changed. The section id, the route segment
 * and the stored value all stay `logistics`; renaming them would be a migration
 * for no functional gain.
 */
export function OnCallLogisticsSection({
  entries,
  now = new Date(),
  testId = "on-call-logistics-section",
  onEditEntry,
  onVerified,
}: OnCallLogisticsSectionProps) {
  const adminEntries = partitionLogisticsEntries(entries).admin;

  if (adminEntries.length === 0) {
    return (
      <OnCallEmptyState
        icon={BriefcaseBusiness}
        title="No admin entries yet"
        body="Leave, rosters, pay, forms, access and facilities will appear here, filed into folders. Compliance requirements live on their own page."
        testId="on-call-logistics-empty"
      />
    );
  }

  const byCategory = new Map<string, OnCallEntry[]>();
  for (const entry of adminEntries) {
    const category = onCallAdminCategoryLabel(entry);
    const existing = byCategory.get(category);
    if (existing) existing.push(entry);
    else byCategory.set(category, [entry]);
  }

  const sortEntries = (list: OnCallEntry[]) =>
    [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));

  const takenSlugs = new Set<string>();
  const groups = Array.from(byCategory.entries())
    .map(([category, list]) => ({
      category,
      entries: sortEntries(list),
      // Every row withheld, not merely one. A note on a mixed group would
      // claim the visible rows beside it are private too.
      allPrivate: list.every((entry) => entry.isPersonal),
    }))
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((group) => ({ ...group, slug: allocateOnCallGroupSlug(group.category, takenSlugs) }));

  return (
    <div data-testid={testId} className="grid gap-5">
      {groups.map((group) => {
        const slug = group.slug;
        const headingId = `on-call-logistics-category-${slug}-heading`;
        return (
          <section
            key={group.category}
            id={onCallGroupAnchorId(slug)}
            aria-labelledby={headingId}
            className={cn(inPageAnchor, "grid gap-2")}
          >
            <div className="flex items-center gap-1.5">
              {group.allPrivate ? (
                <Lock aria-hidden="true" className="size-icon-xs shrink-0 text-[color:var(--text-muted)]" />
              ) : null}
              <h3 id={headingId} className={eyebrowText}>
                {group.category}
              </h3>
              <span aria-hidden="true" className="nums text-2xs font-medium text-[color:var(--text-muted)]">
                {group.entries.length}
              </span>
            </div>
            {group.allPrivate ? (
              // The rule lives where it applies, not in a settings screen —
              // board 11's own note. Stated for a group only when the whole
              // group is private, so it can never imply that the visible rows
              // beside it are withheld too.
              <p
                data-testid="on-call-logistics-private-note"
                className={cn(
                  "flex items-start gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-inset)] p-3 text-xs leading-5",
                  textMuted,
                )}
              >
                <Lock aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
                <span>
                  <b className="text-[color:var(--text-heading)]">Only you can see this group.</b> Your own leave, pay
                  and access detail stays off the page everyone else reads.
                </span>
              </p>
            ) : null}
            <div
              data-on-call-list=""
              className="grid grid-cols-[minmax(0,1fr)] gap-2"
              data-testid={`on-call-logistics-group-${slug}`}
            >
              {group.entries.map((entry) => (
                <LogisticsRow
                  key={entry.id}
                  entry={entry}
                  now={now}
                  onEditEntry={onCallEntryIsEditable(entry) ? onEditEntry : undefined}
                  onVerified={onCallEntryIsEditable(entry) ? onVerified : undefined}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
