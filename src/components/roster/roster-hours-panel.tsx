"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { ModeFactTile, ModeFactTiles } from "@/components/mode-kit/fact-tile";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { fortnightFor, summariseHours, type HoursExtra } from "@/lib/roster/hours";
import { isWorkedKind } from "@/lib/roster/shift-kind";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";
import { formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";

import { formatDateSpan, formatHours, kindOf } from "./roster-format";

/**
 * Hours: the fortnight as fourteen bars, extra time as a dark cap, and the
 * facts beside them. Rostered hours, not pay. There are no limits to show a
 * doctor on their own, so there is no score and no colour for "too many".
 *
 * "Stayed late" records the time from the end of the shift that just finished
 * until now, in the extra-time record Admin uses for claims. The fortnight's
 * saved records (Roster's and Admin's) are read back from that same record, so
 * extra time survives a reload. If they cannot be read, the panel says so and
 * counts only what was recorded on this visit.
 */

/** Hours and rest downloads only when the Hours view opens, never with the rest of Shifts. */
const RosterHoursRestCheck = dynamic(
  () => import("./roster-hours-rest-check").then((module) => module.RosterHoursRestCheck),
  { ssr: false, loading: () => <ModeModuleSkeleton rows={4} twoLine testId="roster-hours-rest-loading" /> },
);

/** A late finish is offered for this long after a shift ends. */
const STAYED_LATE_WINDOW_MS = 8 * 60 * 60 * 1000;

export type RosterExtraTime = HoursExtra;

/**
 * One extra-time record's identity: its kind and its start as an instant. The
 * server returns database timestamps (`+00:00`) and this visit's records use
 * `toISOString()` (`Z`), so the same start compares by instant, not spelling;
 * a call-in and a late finish may share a start and are different records.
 */
function extraKey(extra: RosterExtraTime): string {
  return `${extra.kind ?? "stayed_late"}|${Date.parse(extra.startedAt)}`;
}

/** The worked shift that finished most recently, if it ended in the last eight hours. */
export function justFinished(shifts: readonly OnCallShift[], now: Date): OnCallShift | null {
  const at = now.getTime();
  let best: OnCallShift | null = null;
  for (const shift of shifts) {
    const end = Date.parse(shift.endsAt);
    if (!isWorkedKind(kindOf(shift)) || end > at || at - end > STAYED_LATE_WINDOW_MS) continue;
    if (!best || end > Date.parse(best.endsAt)) best = shift;
  }
  return best;
}

type SavedExtras = { readonly status: "loading" | "ready" | "error"; readonly records: readonly RosterExtraTime[] };

/** The doctor's own saved extra time in the fortnight, from `GET /api/roster/extra-time`. */
function useSavedExtras(from: string, to: string, attempt: number): SavedExtras {
  const key = `${from}/${to}/${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; result: SavedExtras } | null>(null);
  useEffect(() => {
    let alive = true;
    const settle = (result: SavedExtras) => {
      if (alive) setLoaded({ key, result });
    };
    void fetch(`/api/roster/extra-time?from=${from}&to=${to}`, { cache: "no-store" })
      .then(async (response) => {
        const body = response.ok ? ((await response.json()) as { records?: RosterExtraTime[] }) : null;
        settle(
          body && Array.isArray(body.records)
            ? { status: "ready", records: body.records }
            : { status: "error", records: [] },
        );
      })
      .catch(() => settle({ status: "error", records: [] }));
    return () => {
      alive = false;
    };
  }, [from, to, key]);
  // While a new range or a retry loads, keep the last records so the figures do not flash to zero.
  return loaded?.key === key ? loaded.result : { status: "loading", records: loaded?.result.records ?? [] };
}

export function RosterHoursPanel({
  shifts,
  now,
  extras,
  onExtra,
  payFortnightAnchor = null,
}: {
  readonly shifts: readonly OnCallShift[];
  readonly now: Date;
  /** Extra time recorded in this visit. */
  readonly extras: readonly RosterExtraTime[];
  readonly onExtra: (extra: RosterExtraTime) => void;
  readonly payFortnightAnchor?: string | null;
}) {
  const today = perthDateOf(now);
  const fortnight = fortnightFor(today, payFortnightAnchor);
  const [attempt, setAttempt] = useState(0);
  const saved = useSavedExtras(fortnight.start, fortnight.end, attempt);
  // This visit's records and the saved ones, once each: a record saved now is also read back later.
  const allExtras = useMemo(() => {
    const byStart = new Map<string, RosterExtraTime>();
    for (const extra of [...saved.records, ...extras]) byStart.set(extraKey(extra), extra);
    return [...byStart.values()];
  }, [saved.records, extras]);
  const summary = useMemo(
    () =>
      summariseHours(
        shifts.map((shift) => ({ startsAt: shift.startsAt, endsAt: shift.endsAt, kind: kindOf(shift) })),
        allExtras,
        fortnightFor(today, payFortnightAnchor),
      ),
    [shifts, allExtras, today, payFortnightAnchor],
  );
  const scale = Math.max(12, ...summary.days.map((day) => day.hours + day.extraHours));
  const finished = justFinished(shifts, now);
  const alreadyLogged = finished
    ? allExtras.some(
        (extra) => extraKey(extra) === extraKey({ kind: "stayed_late", startedAt: finished.endsAt, endedAt: null }),
      )
    : false;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "neutral" | "warning"; text: string } | null>(null);

  async function stayedLate() {
    if (!finished) return;
    const extra = { kind: "stayed_late" as const, startedAt: finished.endsAt, endedAt: now.toISOString() };
    setSaving(true);
    try {
      const response = await fetch("/api/roster/extra-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extra),
      });
      if (!response.ok) setMessage({ tone: "warning", text: "Extra time could not be saved. Try again." });
      else {
        onExtra(extra);
        setMessage({ tone: "neutral", text: "Saved" });
      }
    } catch {
      setMessage({ tone: "warning", text: "Extra time could not be saved. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-5" data-testid="roster-hours">
      <section className={cn(modeModuleSurface, "grid gap-3 p-3")} aria-label="Rostered hours">
        <div className="grid gap-0.5">
          <span className={cn(modeNumberText, "text-lg-minus text-[color:var(--text-heading)]")}>
            {formatHours(summary.totalHours)} <span className={modeSecondaryText}>rostered, not pay</span>
          </span>
          <span className={modeSecondaryText}>{formatDateSpan(summary.start, summary.end)}</span>
        </div>
        <ol className="grid h-28 grid-cols-14 items-end gap-1" aria-label="Hours each day">
          {summary.days.map((day) => (
            <li
              key={day.date}
              className="flex h-full flex-col justify-end"
              aria-label={`${formatPerthDay(day.date)}: ${formatHours(day.hours)}${
                day.extraHours ? `, extra ${formatHours(day.extraHours)}` : ""
              }`}
            >
              {day.extraHours ? (
                <span
                  aria-hidden="true"
                  className="w-full rounded-t-sm bg-[color:var(--command)]"
                  style={{ height: `${(day.extraHours / scale) * 100}%` }}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "w-full bg-[color:var(--border-strong)]",
                  day.extraHours ? "" : "rounded-t-sm",
                  day.date === today && "bg-[color:var(--text-muted)]",
                )}
                style={{ height: `${(day.hours / scale) * 100}%` }}
              />
            </li>
          ))}
        </ol>
        <div className="grid grid-cols-14 gap-1" aria-hidden="true">
          {summary.days.map((day) => (
            <span key={day.date} className="nums text-center text-xs text-[color:var(--text-muted)]">
              {Number(day.date.slice(8, 10))}
            </span>
          ))}
        </div>
      </section>

      <RosterHoursRestCheck shifts={shifts} now={now} />

      <ModeGroupedList eyebrow="Each day" testId="roster-hours-ledger">
        {summary.days.map((day) => (
          <ModeRow
            key={day.date}
            title={formatPerthDay(day.date)}
            subtitle={
              day.extraHours
                ? `${formatHours(day.hours)} rostered · ${formatHours(day.extraHours)} extra`
                : day.hours
                  ? `${formatHours(day.hours)} rostered`
                  : "No rostered hours"
            }
            testId={`roster-hours-day-${day.date}`}
          />
        ))}
      </ModeGroupedList>

      <ModeFactTiles testId="roster-hours-facts">
        <ModeFactTile
          label="Shortest break"
          value={summary.shortestBreakHours === null ? "–" : formatHours(summary.shortestBreakHours)}
        />
        <ModeFactTile label="Most in any 7 days" value={formatHours(summary.maxHoursIn7Days)} />
        <ModeFactTile label="Most days in a row" value={summary.maxDaysInRow} />
        <ModeFactTile
          label={saved.status === "error" ? "Extra time recorded this visit" : "Extra time"}
          value={saved.status === "loading" ? "…" : formatHours(summary.extraHours)}
        />
      </ModeFactTiles>

      <section className="grid gap-2" aria-label="Extra time">
        <h2 className={cn(eyebrowText, "px-3")}>Extra time</h2>
        <Button
          variant="secondary"
          disabled={!finished || alreadyLogged || saving}
          busy={saving}
          busyLabel="Saving…"
          onClick={() => void stayedLate()}
        >
          Stayed late
        </Button>
        {saved.status === "error" ? (
          <div className="grid gap-2" role="alert" data-testid="roster-hours-extras-error">
            <ModeNotice tone="warning">
              Saved extra time could not be loaded, so only extra time recorded on this visit is counted here.
            </ModeNotice>
            <Button className="justify-self-start" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : (
          <p className={cn(modeSecondaryText, "px-3")}>
            Counts your saved extra time for this fortnight. You claim it in Admin.
          </p>
        )}
        {message ? <ModeNotice tone={message.tone}>{message.text}</ModeNotice> : null}
      </section>

      <ModeGroupedList testId="roster-hours-claim">
        <ModeRow title="Claim in Admin" href="/my-work" testId="roster-hours-claim-link" />
      </ModeGroupedList>
    </div>
  );
}
