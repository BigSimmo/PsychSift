"use client";

import { ChevronRight, Clock, Send } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { modeInsetHairline, modePressable } from "@/components/mode-kit/recipes";
import { WorkCard, WorkIconRow } from "@/components/mode-kit/work";
import type { BrowseRow } from "@/lib/open-shifts/browse";
import { groupMine, hoursMeter } from "@/lib/open-shifts/mine";
import { formatHours, hoursBetween, type OpenShiftListing } from "@/lib/open-shifts/model";
import type { FatigueShift } from "@/lib/roster/fatigue-rules";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import {
  FlatList,
  SectionHeading,
  advertHref,
  formatDayShort,
  formatWeekday,
  shiftPlace,
  shiftTitle,
} from "./open-shifts-ui";

/**
 * The top of Open shifts once it became a Roster tab (12 Oct 2026): your
 * requests and hours in one strip, then the next shifts that fit your roster.
 * The full list of requests stays one tap away at /open-shifts/mine.
 */

const MINE_HREF = "/open-shifts/mine";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function OpenShiftsRequestsStrip({
  listings,
  roster,
  now,
}: {
  readonly listings: readonly OpenShiftListing[];
  readonly roster: readonly FatigueShift[] | null;
  readonly now: Date;
}) {
  const groups = useMemo(() => groupMine(listings, now), [listings, now]);
  const meter = useMemo(() => (roster ? hoursMeter(roster, listings, now) : null), [roster, listings, now]);
  const waiting = groups.requested.length;
  const booked = groups.booked.length;
  const changed = groups.cancelled.length;
  const requestsLine =
    waiting + booked + changed === 0
      ? "Nothing asked for yet"
      : [
          waiting ? `${waiting} waiting` : null,
          booked ? `${booked} booked` : null,
          changed ? plural(changed, "changed", "changed") : null,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <div className="px-3 pt-3" data-testid="open-shifts-requests-strip">
      <WorkCard>
        <WorkIconRow icon={Send} title="Your requests" sub={requestsLine} href={MINE_HREF} />
        {meter ? (
          <WorkIconRow
            icon={Clock}
            title={`At least ${formatHours(meter.total)}${meter.limit ? ` of ${formatHours(meter.limit)}` : ""}`}
            sub="Your busiest 14 days, PsychSift roster only"
            href={MINE_HREF}
          />
        ) : null}
      </WorkCard>
    </div>
  );
}

/** The next shifts with no clash and nothing flagged on your roster, soonest first. */
export function fitsYou(rows: readonly BrowseRow[], limit = 3): readonly BrowseRow[] {
  return rows
    .filter((row) => row.check.state === "ok")
    .slice()
    .sort((a, b) => Date.parse(a.listing.startsAt) - Date.parse(b.listing.startsAt))
    .slice(0, limit);
}

export function OpenShiftsFitsYou({
  rows,
  requestable,
}: {
  readonly rows: readonly BrowseRow[];
  readonly requestable: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="open-shifts-fits-you" data-testid="open-shifts-fits-you">
      <SectionHeading id="open-shifts-fits-you">Fits your roster</SectionHeading>
      <FlatList label="Shifts that fit your roster">
        {rows.map((row) => (
          <FitRow key={row.listing.id} listing={row.listing} requestable={requestable} />
        ))}
      </FlatList>
    </section>
  );
}

function FitRow({ listing, requestable }: { readonly listing: OpenShiftListing; readonly requestable: boolean }) {
  const href = advertHref(listing);
  const date = perthDateOf(listing.startsAt);
  const weekday = formatWeekday(date);
  const day = Number(date.slice(8, 10));
  return (
    <li className={`${modeInsetHairline} flex items-center gap-2 pr-3`}>
      <Link
        href={href}
        className={`flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 py-2.5 no-underline ${modePressable} focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--mode-identity)]`}
      >
        <span className="nums flex w-10 shrink-0 flex-col items-center text-center leading-tight">
          <span className="text-3xs font-bold uppercase tracking-kicker text-[color:var(--mode-identity)]">
            {weekday}
          </span>
          <span className="text-lg font-semibold text-[color:var(--text-heading)]">{day}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm-minus font-bold leading-snug text-[color:var(--text-heading)]">
            {shiftTitle(listing)}
          </span>
          <span className="nums text-2xs text-[color:var(--text-muted)]">
            {`${perthTimeOf(listing.startsAt)} to ${perthTimeOf(listing.endsAt)} · ${formatHours(hoursBetween(listing.startsAt, listing.endsAt))}`}
          </span>
          <span className="truncate text-2xs text-[color:var(--text-muted)]">{shiftPlace(listing)}</span>
        </span>
        {requestable ? null : (
          <ChevronRight
            aria-hidden="true"
            strokeWidth={2}
            className="size-3.5 shrink-0 text-[color:var(--decoration-soft)]"
          />
        )}
      </Link>
      {requestable ? (
        <Link
          href={`${href}?request=1`}
          className="inline-flex min-h-12 shrink-0 items-center rounded-full px-3.5 text-sm-minus font-semibold text-[color:var(--mode-identity)] no-underline shadow-[var(--work-edge-inset-strong)_var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--mode-identity)]"
          aria-label={`Request ${shiftTitle(listing)}, ${formatDayShort(date)}`}
        >
          Request
        </Link>
      ) : null}
    </li>
  );
}
