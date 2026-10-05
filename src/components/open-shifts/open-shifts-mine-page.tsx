"use client";

import { ChevronRight, NotebookPen } from "lucide-react";
import Link from "next/link";
import { useMemo, type ReactNode } from "react";

import { ModeBandStatus, PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { modeInsetHairline, modePressable } from "@/components/mode-kit/recipes";
import { groupMine, hoursMeter, type HoursMeter } from "@/lib/open-shifts/mine";
import { formatHours, hoursBetween, type OpenShiftListing } from "@/lib/open-shifts/model";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

import { SignInAction } from "./open-shifts-sign-in";
import { OpenShiftsGate, openShiftsStatus } from "./open-shifts-states";
import {
  FlatList,
  OPEN_SHIFTS_HREF,
  SectionHeading,
  advertHref,
  formatDayShort,
  formatShiftTimes,
  formatWeekday,
  shiftTitle,
} from "./open-shifts-ui";
import { useOpenShifts } from "./use-open-shifts";

const dayMonth = (date: string) => formatDayShort(date).replace(/^\S+ /, "");

/** "5 to 18 Oct", or "28 Oct to 10 Nov" across a month end. */
function dayRange(from: string, to: string): string {
  const start = dayMonth(from);
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${start.split(" ")[0]} to ${dayMonth(to)}`
    : `${start} to ${dayMonth(to)}`;
}

function Segment({ hours, total, className }: { hours: number; total: number; className: string }) {
  if (hours <= 0 || total <= 0) return null;
  return (
    <span
      className={`h-full [forced-color-adjust:none] ${className}`}
      style={{ width: `${Math.min(100, (hours / total) * 100)}%` }}
    />
  );
}

function Key({ label, hours, swatch }: { label: string; hours: number; swatch: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className={`inline-block size-2.5 rounded-sm [forced-color-adjust:none] ${swatch}`} />
      <span>{`${label} ${formatHours(hours)}`}</span>
    </li>
  );
}

/** The "at least" hours meter for the busiest 14 days ahead. */
function Meter({ meter }: { meter: HoursMeter }) {
  const scale = Math.max(meter.limit ?? 0, meter.total, 1);
  return (
    <section
      aria-labelledby="os-meter"
      className="mx-3 mt-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-4 py-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="os-meter" className="text-2xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
          {`Busiest 14 days · ${dayRange(meter.from, meter.to)}`}
        </h2>
        <span className="text-xs text-[color:var(--text-muted)]">PsychSift roster only</span>
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-xl font-semibold nums text-[color:var(--text-heading)]">{`At least ${formatHours(meter.total)}`}</span>
        {meter.limit !== null ? (
          <span className="text-sm text-[color:var(--text-muted)]">{`of the ${meter.limit} h limit`}</span>
        ) : null}
      </p>
      <div
        role="img"
        aria-label={`Rostered ${formatHours(meter.rostered)}, approved ${formatHours(meter.approved)}, requested ${formatHours(meter.requested)}`}
        className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-subtle)] forced-colors:border forced-colors:border-[CanvasText]"
      >
        <Segment
          hours={meter.rostered}
          total={scale}
          className="bg-[color:var(--text-muted)] forced-colors:bg-[CanvasText]"
        />
        <Segment
          hours={meter.approved}
          total={scale}
          className="bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight]"
        />
        <Segment
          hours={meter.requested}
          total={scale}
          className="bg-[color:var(--mode-identity)] opacity-45 forced-colors:bg-[GrayText] forced-colors:opacity-100"
        />
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs nums text-[color:var(--text-muted)]">
        <Key
          label="Rostered"
          hours={meter.rostered}
          swatch="bg-[color:var(--text-muted)] forced-colors:bg-[CanvasText]"
        />
        <Key
          label="Approved"
          hours={meter.approved}
          swatch="bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight]"
        />
        <Key
          label="Requested"
          hours={meter.requested}
          swatch="bg-[color:var(--mode-identity)] opacity-45 forced-colors:bg-[GrayText] forced-colors:opacity-100"
        />
      </ul>
      <details className="mt-3 text-sm text-[color:var(--text-muted)]">
        <summary className="inline-flex min-h-12 cursor-pointer items-center font-medium text-[color:var(--mode-identity)]">
          How this is counted
        </summary>
        <p className="pb-1">
          Your PsychSift roster, plus the open shifts you&apos;ve asked for or been given, over the busiest 14 days
          starting from today. Work that isn&apos;t on your PsychSift roster isn&apos;t counted, so the real figure may
          be higher.
          {meter.limit === null ? " The hours limit isn't shown because the fatigue rules are switched off." : ""}
        </p>
      </details>
    </section>
  );
}

function MineRow({
  listing,
  status,
  tone = "muted",
}: {
  listing: OpenShiftListing;
  status: string;
  tone?: "muted" | "ok" | "warn";
}) {
  const date = perthDateOf(listing.startsAt);
  const statusClass =
    tone === "ok"
      ? "text-[color:var(--success-text)]"
      : tone === "warn"
        ? "text-[color:var(--warning-text)]"
        : "text-[color:var(--text-muted)]";
  return (
    <li className={modeInsetHairline}>
      <Link
        href={advertHref(listing)}
        className={`flex min-h-13 items-start gap-4 px-3 py-3.5 no-underline ${modePressable} focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--command)]`}
      >
        <span className="flex w-12 shrink-0 flex-col items-center text-center nums">
          <span className="text-2xs font-semibold uppercase text-[color:var(--text-muted)]">{formatWeekday(date)}</span>
          <span className="text-lg-minus font-semibold leading-6 text-[color:var(--text-heading)]">
            {Number(date.slice(8))}
          </span>
          <span className="text-2xs text-[color:var(--text-muted)]">{perthTimeOf(listing.startsAt)}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base-minus font-medium text-[color:var(--text-heading)]">{`${shiftTitle(listing)}, ${listing.siteName ?? listing.teamName}`}</span>
          <span className="text-sm nums text-[color:var(--text-muted)]">
            {`${formatShiftTimes(listing.startsAt, listing.endsAt)} · ${formatHours(hoursBetween(listing.startsAt, listing.endsAt))}`}
          </span>
          <span className={`text-sm font-medium ${statusClass}`}>{status}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.6}
          className="mt-3 size-icon-md shrink-0 text-[color:var(--text-soft)]"
        />
      </Link>
    </li>
  );
}

function Group({
  title,
  rows,
  render,
}: {
  title: string;
  rows: readonly OpenShiftListing[];
  render: (row: OpenShiftListing) => ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionHeading count={rows.length}>{title}</SectionHeading>
      <FlatList label={title}>{rows.map(render)}</FlatList>
    </section>
  );
}

export function OpenShiftsMinePage() {
  const state = useOpenShifts();
  const now = useMemo(() => new Date(), []);
  const groups = useMemo(() => groupMine(state.listings, now), [state.listings, now]);
  const meter = useMemo(
    () => (state.roster ? hoursMeter(state.roster, state.listings, now) : null),
    [state.roster, state.listings, now],
  );
  const nothing = groups.requested.length + groups.booked.length + groups.cancelled.length === 0;

  return (
    <div className="mx-auto w-full max-w-reading pb-10" data-mode-identity="open-shifts">
      <PageTitleUnderBand className="px-3 pt-4 text-xl font-semibold text-[color:var(--text-heading)]">
        My shifts
      </PageTitleUnderBand>
      <ModeBandStatus value={openShiftsStatus(state)} testId="open-shifts-status" />
      <OpenShiftsGate state={state}>
        {meter ? (
          <Meter meter={meter} />
        ) : (
          <p className="px-3 pt-3 text-sm text-[color:var(--text-muted)]">
            {state.rosterStatus === "loading"
              ? "Reading your roster for the hours count…"
              : "Your hours can't be counted: your roster couldn't be read."}
          </p>
        )}

        <Group
          title="Changed"
          rows={groups.cancelled}
          render={(row) => (
            <MineRow
              key={row.id}
              listing={row}
              status="Cancelled by your team. Nothing was added to your roster."
              tone="warn"
            />
          )}
        />
        <Group
          title="Requested"
          rows={groups.requested}
          render={(row) => <MineRow key={row.id} listing={row} status="Waiting for approval" />}
        />
        <Group
          title="Booked"
          rows={groups.booked}
          render={(row) => <MineRow key={row.id} listing={row} status="Approved" tone="ok" />}
        />

        {nothing && (state.failedTeams.length > 0 || state.offline) ? (
          <div className="px-3 py-6">
            <p className="text-base-minus font-medium text-[color:var(--text-heading)]">This list may be incomplete</p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              {state.offline
                ? "You're offline, so requests made since the list was read won't show."
                : `Couldn't read ${state.failedTeams.join(", ")}, so requests there won't show.`}
            </p>
            <button
              type="button"
              onClick={state.reload}
              className="mt-2 inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--mode-identity)]"
            >
              Try again
            </button>
          </div>
        ) : nothing ? (
          <div className="px-3 py-6">
            <p className="text-base-minus font-medium text-[color:var(--text-heading)]">No requests yet</p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Shifts you ask for show here until they&apos;re worked.
            </p>
            <Link
              href={OPEN_SHIFTS_HREF}
              className="mt-2 inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--mode-identity)]"
            >
              Browse open shifts
            </Link>
          </div>
        ) : null}

        <div className="mt-6 px-3">
          <Link
            href="/open-shifts/log"
            className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-[color:var(--border-strong)] px-4 text-sm font-medium text-[color:var(--text-heading)] no-underline focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
          >
            <NotebookPen aria-hidden="true" strokeWidth={1.6} className="size-icon-sm" />
            Log a shift offered to me
          </Link>
        </div>
        {state.sample === "signed-out" ? <SignInAction label="Sign in to keep your own" /> : null}
      </OpenShiftsGate>
    </div>
  );
}
