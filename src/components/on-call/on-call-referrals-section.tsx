"use client";

import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";

import { onCallTelHref } from "@/lib/on-call/home-modules";

import { Pencil, Phone, Repeat } from "lucide-react";

import { OnCallCopyNumber } from "@/components/on-call/on-call-copy-number";
import { OnCallEntryRow } from "@/components/on-call/on-call-entry-row";
import { onCallEntryGroups } from "@/components/on-call/on-call-entry-groups";
import { OnCallFreshnessBadge } from "@/components/on-call/on-call-freshness-badge";
import { OnCallGroupSection } from "@/components/on-call/on-call-group-section";
import { OnCallVerifyButton } from "@/components/on-call/on-call-verify-button";
import { WhoCoversThis } from "@/components/on-call/who-covers-this";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { ExternalTextLink } from "@/components/ui/link";
import { Disclosure } from "@/components/ui/disclosure";
import { cn, textMuted, toolbarButton } from "@/components/ui-primitives";
import { onCallTagFacet } from "@/lib/on-call/entry-filters";
import {
  isOnCallHttpUrl,
  onCallDetailsSchemaFor,
  onCallEntryFreshness,
  type OnCallEntry,
  onCallEntryIsEditable,
} from "@/lib/on-call/entry-model";
import { recordOnCallRecent } from "@/lib/on-call/recent-storage";

export interface OnCallReferralsSectionProps {
  entries: readonly OnCallEntry[];
  /** Injectable for deterministic tests; defaults to the real clock. */
  now?: Date;
  testId?: string;
  /** Opens the entry editor for this row. Omitted when the viewer cannot edit. */
  onEditEntry?: (entry: OnCallEntry) => void;
  /** One-tap "still correct today"; shown only on a stale entry. */
  onVerified?: (entry: OnCallEntry) => void;
}

interface OnCallReferralsDetails {
  accepts: readonly string[];
  exclusions: readonly string[];
  catchment?: string;
  hours?: string;
  howToRefer?: string;
  phone?: string;
  fax?: string;
  referralFormUrl?: string;
}

function parseReferralsDetails(details: unknown): OnCallReferralsDetails | null {
  const result = onCallDetailsSchemaFor("referrals").safeParse(details);
  return result.success ? (result.data as OnCallReferralsDetails) : null;
}

/**
 * A labelled fact row — "Hours: 08:00-17:00 Mon-Fri". Plain text, never a
 * colour-coded chip standing alone: the label is always visible and always
 * read out, so the fact survives for a colourblind reader and a screen reader
 * alike.
 */
function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm">
      <span className="font-semibold text-[color:var(--text)]">{label}: </span>
      <span className={textMuted}>{value}</span>
    </p>
  );
}

/**
 * Accepts / does not accept. Rendered as labelled text lines — never a chip
 * whose colour alone carries "accepted" vs "excluded" — because that
 * distinction has to survive with no colour perception at all.
 */
function AcceptanceList({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold text-[color:var(--text)]">{label}: </span>
      <span className={textMuted}>{items.join(", ")}</span>
    </p>
  );
}

function ReferralPanel({ entry, details }: { entry: OnCallEntry; details: OnCallReferralsDetails }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2" data-testid={`on-call-referral-panel-${entry.slug}`}>
      <AcceptanceList label="Accepts" items={details.accepts} />
      <AcceptanceList label="Does not accept" items={details.exclusions} />
      {details.catchment ? <FactRow label="Catchment" value={details.catchment} /> : null}
      {details.hours ? <FactRow label="Hours" value={details.hours} /> : null}
      {details.howToRefer ? <FactRow label="How to refer" value={details.howToRefer} /> : null}
      {details.fax ? <FactRow label="Fax" value={details.fax} /> : null}
      {details.phone ? (
        <div className="flex min-w-0 items-start gap-2">
          <OnCallEntryRow
            icon={onCallTelHref(details.phone) ? Phone : undefined}
            title={
              onCallTelHref(details.phone) ? "Call to refer" : "Recorded number — use the hospital phone or switchboard"
            }
            subtitle={details.phone}
            href={onCallTelHref(details.phone)}
            onActivate={() => recordOnCallRecent({ id: entry.id, title: entry.title })}
            testId={`on-call-referral-phone-${entry.slug}`}
          />
          <OnCallCopyNumber value={details.phone} label={`Copy referral number for ${entry.title}`} />
        </div>
      ) : null}
      {isOnCallHttpUrl(details.referralFormUrl) ? (
        <ExternalTextLink href={details.referralFormUrl} className="min-h-tap items-center text-sm">
          Referral form
        </ExternalTextLink>
      ) : null}
    </div>
  );
}

/**
 * The Referrals section: the owner's own referral list, one expandable row
 * per service. Collapsed, the row shows just the service name; expanded, it
 * reveals accepts/exclusions/catchment/hours/how-to-refer/phone — all as
 * labelled text (spec §8.4), never colour-coded chips carrying the
 * accepted/excluded distinction alone.
 */
export function OnCallReferralsSection({
  entries,
  now = new Date(),
  testId = "on-call-referrals-section",
  onEditEntry,
  onVerified,
}: OnCallReferralsSectionProps) {
  const allReferrals = entries.filter((entry) => entry.section === "referrals");

  if (allReferrals.length === 0) {
    return (
      <OnCallEmptyState
        icon={Repeat}
        title="No referral pathways yet"
        body="Services you add will appear here — who they accept, catchment, hours, and how to refer."
        testId="on-call-referrals-empty"
      />
    );
  }

  const sorted = [...allReferrals].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  // The drawing's chip row filed these by tag — "Takes tonight", "Community",
  // "Youth" — and the header's jump list now names the same tags. Two controls
  // for one idea, so the chips became headings: the whole list stays on the
  // page and the header moves you down it. Fewer than two tags in play and the
  // page is genuinely flat, which `onCallEntryGroups` reports as no groups.
  const groups = onCallEntryGroups(sorted, onCallTagFacet, "Other services");

  const disclosureFor = (entry: OnCallEntry) => (
    <ReferralDisclosure
      key={entry.id}
      entry={entry}
      now={now}
      onEditEntry={onCallEntryIsEditable(entry) ? onEditEntry : undefined}
      onVerified={onCallEntryIsEditable(entry) ? onVerified : undefined}
    />
  );

  return (
    <div data-testid={testId} className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <WhoCoversThis entries={sorted} now={now} />
      {groups.length === 0
        ? sorted.map(disclosureFor)
        : groups.map((group) => (
            <OnCallGroupSection
              key={group.slug}
              label={group.label}
              slug={group.slug}
              count={group.entries.length}
              headingId={`on-call-referrals-${group.slug}-heading`}
              testId={`on-call-referrals-group-${group.slug}`}
            >
              {group.entries.map(disclosureFor)}
            </OnCallGroupSection>
          ))}
    </div>
  );
}

/** One service: the collapsed summary, and everything it opens. */
function ReferralDisclosure({
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
  const details = parseReferralsDetails(entry.details);
  const freshness = onCallEntryFreshness(entry, now);
  const showVerify = freshness.state === "stale" && Boolean(onVerified);

  return (
    <div id={onCallEntryAnchorId(entry.id)} tabIndex={-1}>
      <Disclosure
        title={entry.title}
        description={entry.subtitle ?? undefined}
        // A WARNING belongs in the collapsed header; a reassurance does not. The
        // badge started inside the panel, so a referral nobody had confirmed in
        // over a year looked current until someone expanded it — the one surface
        // in the mode where staleness was hidden by default. Hoisting it fixed
        // that and introduced the opposite fault: "Checked 14/08/2026" on every
        // current row, a pill wider than the service's own name, so the name
        // truncated at 390px to make room for the news that nothing is wrong.
        //
        // So the collapsed row carries it only when it is stale. The date a
        // current service was last confirmed is still on the page, in the panel,
        // where a reader who wants it goes looking.
        meta={freshness.state === "stale" ? <OnCallFreshnessBadge freshness={freshness} /> : undefined}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
          {/* Sibling to the panel content, never inside the disclosure's own
            trigger `<button>` above: a button nested inside another button is
            invalid, duplicate-interactive markup. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* The reassuring half of the freshness pair. */}
            {freshness.state === "fresh" ? <OnCallFreshnessBadge freshness={freshness} /> : <span />}
            {showVerify || onEditEntry ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {showVerify && onVerified ? <OnCallVerifyButton entry={entry} onVerified={onVerified} /> : null}
                {onEditEntry ? (
                  <button
                    type="button"
                    onClick={() => onEditEntry(entry)}
                    aria-label={`Edit ${entry.title}`}
                    data-testid={`on-call-referrals-edit-${entry.slug}`}
                    className={cn(toolbarButton, "shrink-0")}
                  >
                    <Pencil aria-hidden className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {details ? (
            <ReferralPanel entry={entry} details={details} />
          ) : (
            <p className={cn("text-sm", textMuted)}>No referral details recorded yet.</p>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
