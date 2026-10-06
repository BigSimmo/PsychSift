"use client";

import { CalendarDays, CloudOff, RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { flatCard, flatEyebrow, flatIconCircle, flatQuietAction, flatTag } from "@/components/on-call/flat-recipes";
import { OnCallModuleSkeleton } from "@/components/on-call/kit/module-skeleton";
import { RosterPersonSheet } from "@/components/on-call/roster-whos-on/roster-person-sheet";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/components/ui-primitives";
import {
  rosterDayCoverage,
  rosterNowMark,
  rosterProvenance,
  rosterRailLabel,
  rosterWhosOnDate,
  rosterWhosOnRange,
  rosterWhosOnRows,
  ROSTER_WHOS_ON_DAY_LABELS,
  ROSTER_WHOS_ON_DAYS,
  type RosterWhosOnDay,
  type RosterWhosOnRow,
} from "@/lib/on-call/roster-whos-on";
import { formatPerthDay, perthTimeOf } from "@/lib/roster/shifts/perth-time";

/** A read older than this is fetched again when the page comes back into view. */
const STALE_AFTER_MS = 5 * 60_000;

/** "Dr Tran Nguyen" to "TN", "Sam" to "S". Initials only, drawn from the roster's own name. */
export function rosterInitials(name: string | null): string {
  if (!name) return "";
  const words = name
    .replace(/^(dr|prof|professor|mr|mrs|ms|mx)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function Rail({ row, nowMark }: { readonly row: RosterWhosOnRow; readonly nowMark: number | null }) {
  return (
    <span
      role="img"
      aria-label={rosterRailLabel(row)}
      className="relative mt-2 block h-2 rounded-full bg-[color:var(--surface-subtle)]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 rounded-full",
          row.isMe ? "bg-[color:var(--mode-identity)]" : "bg-[color:var(--mode-identity-border)]",
        )}
        style={{ left: `${row.rail.left}%`, width: `${row.rail.width}%` }}
      />
      {nowMark !== null ? (
        <span
          aria-hidden="true"
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-[color:var(--text-heading)]"
          style={{ left: `${nowMark}%` }}
        />
      ) : null}
    </span>
  );
}

function RailAxis() {
  return (
    <div
      aria-hidden="true"
      className="nums flex justify-between px-3 pb-2 pl-15 text-2xs text-[color:var(--text-muted)]"
    >
      <span>00:00</span>
      <span>06:00</span>
      <span>12:00</span>
      <span>18:00</span>
      <span>24:00</span>
    </div>
  );
}

function PersonRow({
  row,
  nowMark,
  onOpen,
}: {
  readonly row: RosterWhosOnRow;
  readonly nowMark: number | null;
  readonly onOpen: (row: RosterWhosOnRow, opener: HTMLButtonElement) => void;
}) {
  const gap = row.name === null;
  return (
    <li className="relative before:pointer-events-none before:absolute before:left-3 before:right-0 before:top-0 before:h-px before:bg-[color:var(--border)] before:content-[''] first:before:hidden">
      <button
        type="button"
        onClick={(event) => onOpen(row, event.currentTarget)}
        aria-haspopup="dialog"
        data-testid={`on-call-roster-row-${row.id}`}
        className={cn(
          focusRing,
          "block w-full min-h-13 px-3 py-2.5 text-left transition-colors duration-[var(--duration-instant)] active:bg-[color:var(--surface-wash)]",
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          {gap ? (
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--warning-soft)] text-[color:var(--warning-text)]">
              <TriangleAlert aria-hidden="true" className="size-icon-md" />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold",
                row.isMe
                  ? "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]"
                  : "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
              )}
            >
              {rosterInitials(row.name)}
            </span>
          )}
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span
              className={cn(
                "text-2xs font-semibold uppercase tracking-widest",
                gap ? "text-[color:var(--warning-text)]" : "text-[color:var(--mode-identity)]",
              )}
            >
              {row.kindLabel}
              {row.onNow ? " · on now" : ""}
            </span>
            <span className="break-words text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
              {row.isMe ? "You" : (row.name ?? "Name not on the roster")}
            </span>
            <span className="nums break-words text-sm leading-5 text-[color:var(--text-muted)]">
              {row.span}
              {row.next ? ` · then ${row.next.name}` : ""}
            </span>
          </span>
          {row.isMe ? <span className={flatTag.mode}>You</span> : null}
        </span>
        <span className="block pl-12">
          <Rail row={row} nowMark={nowMark} />
        </span>
      </button>
    </li>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function Message({
  icon: Icon,
  title,
  body,
  action,
  testId,
  alert = false,
}: {
  readonly icon: typeof CloudOff;
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
  readonly testId: string;
  readonly alert?: boolean;
}) {
  return (
    <div className={cn(flatCard, "flex items-start gap-3 p-3")} role={alert ? "alert" : "status"} data-testid={testId}>
      <span className={flatIconCircle}>
        <Icon aria-hidden="true" className="size-icon-md" />
      </span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="text-base-minus font-medium text-[color:var(--text-heading)]">{title}</span>
        {body ? <span className="text-sm text-[color:var(--text-muted)]">{body}</span> : null}
        {action}
      </span>
    </div>
  );
}

/**
 * "From your team roster" (round 2 feature 22): who is on yesterday, today and
 * tomorrow, read straight from the team's PUBLISHED roster, so nobody keeps a
 * second list. Names, shift kind and times only; leave is never shown; a day
 * with nobody rostered says so and guesses no one. Nothing is stored on the
 * device (Roster's offline rule), so offline says so instead of showing an old
 * list as current.
 */
export function OnCallRosterWhosOnSection({ now }: { readonly now: Date }) {
  const teams = useRosterTeams();
  const online = useOnline();
  const payload = teams.status === "ready" ? teams.data : null;
  const enabled = useMemo(
    () => (Array.isArray(payload?.teams) ? payload.teams.filter((team) => team.enabled) : []),
    [payload],
  );
  const [chosenTeam, setChosenTeam] = useState<string | null>(null);
  const team = enabled.find((candidate) => candidate.serviceId === chosenTeam) ?? enabled[0] ?? null;
  const [day, setDay] = useState<RosterWhosOnDay>("today");
  const range = rosterWhosOnRange(now);
  const overview = useRosterRead(team?.serviceId ?? null, "overview");
  const read = useRosterRead(team?.serviceId ?? null, "assignments", range);
  const [open, setOpen] = useState<RosterWhosOnRow | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  // Kept up to date: a read older than five minutes is fetched again when the
  // page comes back into view, and a failed one when the connection returns.
  const { reload: reloadRead, readAt, status: readStatus } = read;
  const { reload: reloadOverview } = overview;
  const { reload: reloadTeams, status: teamsStatus } = teams;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (readAt && Date.now() - readAt.getTime() < STALE_AFTER_MS) return;
      reloadRead();
      reloadOverview();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [readAt, reloadOverview, reloadRead]);
  // Only when the connection comes back, not on every status change: the
  // latest statuses are read through a ref.
  const latest = useRef({ teamsStatus, readStatus, reloadTeams, reloadRead, reloadOverview });
  useEffect(() => {
    latest.current = { teamsStatus, readStatus, reloadTeams, reloadRead, reloadOverview };
  });
  useEffect(() => {
    if (!online) return;
    const current = latest.current;
    if (current.teamsStatus === "error") current.reloadTeams();
    if (current.readStatus === "error") {
      current.reloadRead();
      current.reloadOverview();
    }
  }, [online]);

  const date = rosterWhosOnDate(day, now);
  const assignments = read.status === "ready" ? read.data?.assignments : undefined;
  const actorId = payload?.actorId ?? null;
  const rows = useMemo(
    () => (Array.isArray(assignments) ? rosterWhosOnRows(assignments, { date, now, actorId }) : []),
    [actorId, assignments, date, now],
  );
  const publication = overview.status === "ready" ? (overview.data?.latestPublication ?? null) : null;
  const coverage = overview.status === "ready" ? rosterDayCoverage(publication, date) : null;
  const nowMark = rosterNowMark(date, now);
  const sample = payload?.sample === true;

  const refresh = () => {
    reloadRead();
    reloadOverview();
  };

  let body: ReactNode;
  if (teams.status === "loading") {
    body = <OnCallModuleSkeleton rows={3} twoLine />;
  } else if (teams.status === "signed-out") {
    body = (
      <Message
        icon={CalendarDays}
        title="Sign in to see who is on"
        body="Who is on comes from your team's published roster, for signed-in members."
        testId="on-call-roster-signed-out"
      />
    );
  } else if (teams.status !== "ready") {
    body = (
      <Message
        icon={CloudOff}
        alert
        title={online ? "Your team roster could not be loaded" : "You are offline"}
        body="Who is on needs a connection, so no old list is shown. Ring switchboard to confirm who is on."
        action={
          <button type="button" onClick={teams.reload} className={cn(flatQuietAction, focusRing, "w-fit px-0")}>
            <RotateCw aria-hidden="true" className="size-icon-sm" />
            Try again
          </button>
        }
        testId="on-call-roster-teams-failed"
      />
    );
  } else if (!team) {
    body = (
      <Message
        icon={CalendarDays}
        title="Your team roster is not in PsychSift yet"
        body="When your department publishes its roster here, who is on shows by itself. Have an invite link? Open it in Roster."
        action={
          <Link href="/roster" className={cn(flatQuietAction, focusRing, "w-fit px-0")}>
            Open Roster
          </Link>
        }
        testId="on-call-roster-no-team"
      />
    );
  } else if (read.status === "loading" || overview.status === "loading") {
    body = <OnCallModuleSkeleton rows={3} twoLine />;
  } else if (read.status !== "ready" || overview.status !== "ready") {
    const message = read.status !== "ready" ? read.message : overview.message;
    body = (
      <Message
        icon={CloudOff}
        alert
        title={
          !online
            ? "You are offline"
            : ((read.status === "not-confirmed" ? message : null) ?? "Who is on could not be loaded")
        }
        body="No old list is shown, because a later change would not show. Ring switchboard to confirm who is on."
        action={
          <button
            type="button"
            onClick={refresh}
            className={cn(flatQuietAction, focusRing, "w-fit px-0")}
            data-testid="on-call-roster-retry"
          >
            <RotateCw aria-hidden="true" className="size-icon-sm" />
            Try again
          </button>
        }
        testId="on-call-roster-failed"
      />
    );
  } else if (coverage === "none") {
    body = (
      <Message
        icon={CalendarDays}
        title="No roster published yet"
        body={`${team.name} has not published a roster, so nobody is shown. Nobody is guessed.`}
        testId="on-call-roster-unpublished"
      />
    );
  } else if (coverage === "not-published") {
    body = (
      <Message
        icon={CalendarDays}
        title="Not published yet"
        body={`The roster for ${formatPerthDay(date)} is not out, so nobody is shown. Nobody is guessed.`}
        testId="on-call-roster-not-out"
      />
    );
  } else if (rows.length === 0) {
    body = (
      <Message
        icon={TriangleAlert}
        title="Nobody on the roster"
        body={`Nobody is rostered for ${formatPerthDay(date)}, and nobody is guessed. Ring switchboard for who is covering.`}
        testId="on-call-roster-nobody"
      />
    );
  } else {
    body = (
      <ul
        role="list"
        className={flatCard}
        aria-label={`On the roster, ${ROSTER_WHOS_ON_DAY_LABELS[day].toLowerCase()}`}
        data-testid="on-call-roster-list"
      >
        {rows.map((row) => (
          <PersonRow
            key={row.id}
            row={row}
            nowMark={nowMark}
            onOpen={(chosen, opener) => {
              openerRef.current = opener;
              setOpen(chosen);
            }}
          />
        ))}
        <li aria-hidden="true">
          <RailAxis />
        </li>
      </ul>
    );
  }

  const showProvenance = teams.status === "ready" && team && overview.status === "ready";

  return (
    <section
      className="grid min-w-0 gap-2"
      aria-labelledby="on-call-roster-heading"
      data-testid="on-call-roster-whos-on"
    >
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3">
        <h2 id="on-call-roster-heading" className={flatEyebrow}>
          From your team roster
          {read.status === "ready" && coverage === "published" ? (
            <span className="nums">{` · ${rows.length}`}</span>
          ) : null}
        </h2>
        {showProvenance ? (
          <button
            type="button"
            onClick={refresh}
            className={cn(flatQuietAction, focusRing)}
            data-testid="on-call-roster-refresh"
          >
            <RotateCw aria-hidden="true" className="size-icon-sm" />
            Refresh
          </button>
        ) : null}
      </div>
      {sample ? (
        <p
          className={cn(flatCard, "p-3 text-sm text-[color:var(--text)]")}
          role="note"
          data-testid="on-call-roster-sample"
        >
          Example team. Every name and shift here is made up so you can see how it works.
        </p>
      ) : null}
      {enabled.length > 1 ? (
        <Select
          label="Team"
          value={team?.serviceId ?? ""}
          onChange={(event) => setChosenTeam(event.target.value)}
          options={enabled.map((candidate) => ({ value: candidate.serviceId, label: candidate.name }))}
          className="min-h-12"
          data-testid="on-call-roster-team"
        />
      ) : null}
      {showProvenance ? (
        <p
          className="flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] px-3 py-2 text-sm text-[color:var(--text)]"
          role="status"
          data-testid="on-call-roster-provenance"
        >
          <CalendarDays aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--mode-identity)]" />
          <span className="min-w-0 flex-1 break-words">
            {`From the ${team.name} roster`}
            {publication ? `. ${rosterProvenance(publication)}` : ""}
          </span>
          {read.readAt ? (
            <span className="nums whitespace-nowrap text-xs text-[color:var(--text-muted)]">{`Loaded ${perthTimeOf(read.readAt)}`}</span>
          ) : null}
        </p>
      ) : null}
      {teams.status === "ready" && team ? (
        <SegmentedControl
          label="Day"
          value={day}
          onChange={setDay}
          layout="equal"
          options={ROSTER_WHOS_ON_DAYS.map((value) => ({ value, label: ROSTER_WHOS_ON_DAY_LABELS[value] }))}
        />
      ) : null}
      {body}
      {teams.status === "ready" && team ? (
        <p className="px-1 text-sm text-[color:var(--text-muted)]">
          No second list. When the roster changes, this changes. Names and shifts only, never leave or reasons.
        </p>
      ) : null}
      <RosterPersonSheet
        row={open}
        date={date}
        teamName={team?.name ?? null}
        publication={publication}
        readAt={read.readAt}
        now={now}
        onClose={() => setOpen(null)}
        returnFocusRef={openerRef}
      />
    </section>
  );
}
