"use client";

import { ClipboardList } from "lucide-react";
import dynamic from "next/dynamic";

import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import type { HoursSummary } from "@/lib/roster/hours";
import { WEEKDAYS, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";

import { formatSpanWords } from "@/lib/roster/shifts-overview";

import { formatHours } from "./roster-format";
import { RosterPayslipCheck } from "./roster-payslip-check";
import {
  RosterDateLead,
  RosterLinkWord,
  RosterList,
  RosterNote,
  RosterRow,
  RosterSectionHead,
  rosterOutlineButton,
} from "./roster-list";
import { extraKey, type RosterExtraTimeState } from "./use-roster-extra-time";

/**
 * Hours & rest, opened from Shifts: the signed check for the next 14 days,
 * then this fortnight's extra time. Extra time shows times only; claiming and
 * approvals stay in Admin. The signed check downloads only when this view
 * opens, never with the rest of Shifts.
 */

const RosterHoursRestCheck = dynamic(
  () => import("./roster-hours-rest-check").then((module) => module.RosterHoursRestCheck),
  { ssr: false, loading: () => <ModeModuleSkeleton rows={4} twoLine testId="roster-hours-rest-loading" /> },
);

const KIND_WORDS = { stayed_late: "Stayed late", called_in: "Called in" } as const;

function ExtraTime({ extra, summary }: { readonly extra: RosterExtraTimeState; readonly summary: HoursSummary }) {
  const records = [...extra.records]
    .filter((record) => {
      const date = perthDateOf(record.startedAt);
      return date >= summary.start && date <= summary.end;
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="roster-extra-heading" data-testid="roster-hours-extra">
      <RosterSectionHead
        id="roster-extra-heading"
        title={
          extra.status === "loading"
            ? "Extra time"
            : `Extra time · ${formatHours(summary.extraHours)} this fortnight${extra.status === "error" ? " so far" : ""}`
        }
        isNew
        right={
          extra.canAdd || extra.saving ? (
            <RosterLinkWord
              onClick={() => void extra.stayedLate()}
              label="Add the time since your last shift ended"
              disabled={extra.saving}
              testId="roster-hours-add-extra"
            >
              {extra.saving ? "Saving…" : "Add"}
            </RosterLinkWord>
          ) : null
        }
      />
      {extra.status === "error" ? (
        <div className="grid gap-2" role="alert" data-testid="roster-hours-extras-error">
          <RosterNote icon={ClipboardList} role="note">
            <p>Saved extra time could not be loaded, so only extra time recorded on this visit is counted here.</p>
          </RosterNote>
          <button type="button" className={rosterOutlineButton} onClick={extra.retry}>
            Try again
          </button>
        </div>
      ) : null}
      {extra.message ? (
        <p role="status" className="mx-1 text-sm text-[color:var(--text)]">
          {extra.message.text}
        </p>
      ) : null}
      <RosterList label="Extra time this fortnight">
        {records.map((record) => {
          const date = perthDateOf(record.startedAt);
          const hours = record.endedAt ? (Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 3_600_000 : null;
          return (
            <RosterRow
              key={extraKey(record)}
              lead={
                <RosterDateLead
                  weekday={WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!}
                  day={Number(date.slice(8, 10))}
                />
              }
              title={`${perthTimeOf(record.startedAt)} to ${record.endedAt ? perthTimeOf(record.endedAt) : "now"}`}
              sub={KIND_WORDS[record.kind ?? "stayed_late"]}
              trail={hours === null ? "Running" : formatHours(Math.round(hours * 100) / 100)}
              testId="roster-hours-extra-row"
            />
          );
        })}
        {extra.status === "ready" && records.length === 0 ? (
          <RosterRow title="No extra time this fortnight" dim />
        ) : null}
      </RosterList>
    </section>
  );
}

export function RosterHoursPanel({
  shifts,
  now,
  summary,
  extra,
  partial,
  payAnchored,
  onCallExcluded = false,
  onRetry,
}: {
  readonly shifts: readonly OnCallShift[];
  readonly now: Date;
  readonly summary: HoursSummary;
  readonly extra: RosterExtraTimeState;
  readonly partial: boolean;
  readonly payAnchored: boolean;
  /** On-call shifts fall in the fortnight but are not rostered hours, so the total says so. */
  readonly onCallExcluded?: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-3" data-testid="roster-hours">
      <RosterHoursRestCheck
        shifts={shifts}
        now={now}
        partial={partial}
        onRetry={onRetry}
        offSummary={
          <section className="grid gap-3" aria-labelledby="roster-hours-off-fortnight">
            <RosterSectionHead
              id="roster-hours-off-fortnight"
              title={payAnchored ? "This pay fortnight" : "This fortnight"}
              right={
                <span className="nums text-sm text-[color:var(--text-muted)]">
                  {formatSpanWords(summary.start, summary.end)}
                </span>
              }
            />
            <p className={cn(modeModuleSurface, "flex flex-wrap items-baseline gap-x-2 p-4 shadow-none")}>
              <span className="nums text-lg font-semibold text-[color:var(--text-heading)]">
                {partial ? "at least " : ""}
                {formatHours(summary.totalHours)}
              </span>
              <span className="text-sm text-[color:var(--text-muted)]">rostered</span>
              {summary.extraHours > 0 ? (
                <span className="nums ml-auto text-xs text-[color:var(--text-muted)]">
                  plus {formatHours(summary.extraHours)} extra
                </span>
              ) : extra.status === "error" ? (
                <span className="ml-auto text-xs text-[color:var(--text-muted)]">extra time not loaded</span>
              ) : null}
              {onCallExcluded ? (
                <span
                  className="basis-full text-xs text-[color:var(--text-muted)]"
                  data-testid="roster-hours-on-call-note"
                >
                  On call isn&apos;t counted here.
                </span>
              ) : null}
            </p>
          </section>
        }
      >
        <ExtraTime extra={extra} summary={summary} />
      </RosterHoursRestCheck>
      <RosterPayslipCheck
        shifts={shifts}
        summary={summary}
        extraLoaded={extra.status === "ready"}
        partial={partial}
        payAnchored={payAnchored}
      />
    </div>
  );
}
