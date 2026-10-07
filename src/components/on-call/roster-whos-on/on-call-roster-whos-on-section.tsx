"use client";

import { CalendarDays, CloudOff, Repeat2, RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { flatQuietAction } from "@/components/on-call/flat-recipes";
import { OnCallDialRow } from "@/components/on-call/kit/dial-row";
import { OnCallModuleSkeleton } from "@/components/on-call/kit/module-skeleton";
import { rosterInitials } from "@/components/on-call/roster-whos-on/roster-initials";
import { RosterPersonSheet } from "@/components/on-call/roster-whos-on/roster-person-sheet";
import { WorkCard, WorkIconCircle, WorkSectionLabel, WorkTag } from "@/components/mode-kit/work";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/components/ui-primitives";
import type { HandbookItem } from "@/lib/on-call/handbook-items";
import {
  rosterDayCoverage,
  rosterNowMark,
  rosterProvenance,
  rosterRailLabel,
  rosterWhosOnChanges,
  rosterWhosOnDate,
  rosterWhosOnRange,
  rosterWhosOnRows,
  ROSTER_WHOS_ON_DAY_LABELS,
  ROSTER_WHOS_ON_DAYS,
  ROSTER_WHOS_ON_HREF,
  type RosterPublicationSummary,
  type RosterWhosOnDay,
  type RosterWhosOnRow,
} from "@/lib/on-call/roster-whos-on";
import type { RosterAssignment } from "@/lib/roster/team/model";
import { formatPerthDay, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { useOnlineStatus } from "@/lib/use-online-status";

/** A read older than this is fetched again when the page comes back into view. */
const STALE_AFTER_MS = 5 * 60_000;
/** While the page is open, visible and online, the roster is read again this often. */
const REFRESH_EVERY_MS = 2 * 60_000;

/**
 * The cover rail: where the shift sits on the day, and the now marker. The name is on the row above, never
 * inside the bar, where a short shift would clip it and the now marker would cross it.
 */
function Rail({
  row,
  nowMark,
  stale,
}: {
  readonly row: RosterWhosOnRow;
  readonly nowMark: number | null;
  readonly stale: boolean;
}) {
  const gap = row.name === null;
  return (
    <span
      role="img"
      aria-label={rosterRailLabel(row)}
      className="relative mt-2 block h-3 overflow-hidden rounded-md bg-[color:var(--surface-wash)]"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 rounded-md",
          gap
            ? "border border-dashed border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning-text)]"
            : row.isMe
              ? "bg-[color:var(--mode-identity)]"
              : "border border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)]",
        )}
        style={{ left: `${row.rail.left}%`, width: `${row.rail.width}%` }}
      />
      {nowMark !== null && !stale ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-[color:var(--text-heading)]"
          style={{ left: `${nowMark}%` }}
          data-testid="on-call-roster-now-mark"
        />
      ) : null}
    </span>
  );
}

function RailAxis() {
  return (
    <div
      aria-hidden="true"
      className="nums flex justify-between px-3 pb-2 pl-15 pt-1 text-2xs text-[color:var(--text-muted)]"
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
  stale,
  changedAt,
  onOpen,
}: {
  readonly row: RosterWhosOnRow;
  readonly nowMark: number | null;
  readonly stale: boolean;
  readonly changedAt: Date | null;
  readonly onOpen: (row: RosterWhosOnRow, opener: HTMLButtonElement) => void;
}) {
  const gap = row.name === null;
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={(event) => onOpen(row, event.currentTarget)}
        aria-haspopup="dialog"
        data-testid={`on-call-roster-row-${row.id}`}
        className={cn(
          focusRing,
          "block min-h-13 w-full px-3 py-2.5 text-left transition-colors duration-[var(--duration-instant)] active:bg-[color:var(--surface-wash)]",
          stale && "opacity-60",
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          {gap ? (
            <WorkIconCircle icon={TriangleAlert} tone="amber" />
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
              {row.roleLabel}
              {row.site ? ` · ${row.site}` : ""}
              {row.onNow ? " · on now" : ""}
            </span>
            <span className="break-words text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
              {row.isMe ? "You" : (row.name ?? "Nobody rostered")}
            </span>
            <span className="nums break-words text-sm leading-5 text-[color:var(--text-muted)]">
              {row.span}
              {row.next ? ` · then ${row.next.name}` : ""}
            </span>
            {changedAt ? (
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--mode-identity)]"
                data-testid={`on-call-roster-changed-${row.id}`}
              >
                <Repeat2 aria-hidden="true" className="size-icon-xs" />
                {`Changed on the roster, seen ${perthTimeOf(changedAt)}`}
              </span>
            ) : null}
          </span>
          {row.isMe ? <WorkTag>You</WorkTag> : null}
        </span>
        <span className="block pl-12">
          <Rail row={row} nowMark={nowMark} stale={stale} />
        </span>
      </button>
    </li>
  );
}

function Message({
  icon,
  tone,
  title,
  body,
  action,
  testId,
  alert = false,
}: {
  readonly icon: typeof CloudOff;
  readonly tone?: "amber" | "neutral";
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
  readonly testId: string;
  readonly alert?: boolean;
}) {
  return (
    <WorkCard padded>
      <div className="flex items-start gap-3" role={alert ? "alert" : "status"} data-testid={testId}>
        <WorkIconCircle icon={icon} tone={tone} />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="text-base-minus font-medium text-[color:var(--text-heading)]">{title}</span>
          {body ? <span className="text-sm text-[color:var(--text-muted)]">{body}</span> : null}
          {action}
        </span>
      </div>
    </WorkCard>
  );
}

/** The last good read of one team's window, kept in memory only, so going offline shows it as old, never as live. */
type LastGood = {
  readonly teamId: string;
  readonly assignments: readonly RosterAssignment[];
  readonly publication: RosterPublicationSummary | null;
  readonly readAt: Date | null;
};

/** In memory only: the last good read, the first read since opening, and when each change was first seen. */
type Memory = {
  readonly key: string;
  readonly lastGood: LastGood | null;
  readonly baseline: { readonly teamId: string; readonly assignments: readonly RosterAssignment[] } | null;
  readonly changedAt: ReadonlyMap<string, Date>;
};

const EMPTY_MEMORY: Memory = { key: "", lastGood: null, baseline: null, changedAt: new Map() };

function remember(memory: Memory, fresh: LastGood & { readonly key: string }): Memory {
  const { key, ...lastGood } = fresh;
  if (!memory.baseline || memory.baseline.teamId !== fresh.teamId) {
    return { key, lastGood, baseline: { teamId: fresh.teamId, assignments: fresh.assignments }, changedAt: new Map() };
  }
  const { changedIds } = rosterWhosOnChanges(memory.baseline.assignments, fresh.assignments);
  const changedAt = new Map<string, Date>();
  for (const id of changedIds) changedAt.set(id, memory.changedAt.get(id) ?? fresh.readAt ?? new Date());
  return { key, lastGood, baseline: memory.baseline, changedAt };
}

/**
 * "From your team roster" (round 2 feature 22): who is on yesterday, today and
 * tomorrow, read straight from the team's PUBLISHED roster, so nobody keeps a
 * second list. When the roster manager changes the roster (a swap, sick cover,
 * a republish), the next read shows it with a "Changed" line and a count on
 * the source strip. Names, roles from the roster and times only; leave is
 * never shown; a shift with nobody rostered says so and guesses no one.
 * Nothing is stored on the device (Roster's offline rule): going offline keeps
 * the last read on screen, dimmed and marked "Not live".
 *
 * `variant="now"` is the compact "Right now" block for the Now tab: only who
 * is on at this moment, with a link to the full list.
 */
export function OnCallRosterWhosOnSection({
  now,
  switchboard = null,
  hospitalName = null,
  variant = "full",
  pageHeadingId,
}: {
  readonly now: Date;
  /** The hospital's switchboard, to ring when the list cannot say who is on. */
  readonly switchboard?: HandbookItem | null;
  readonly hospitalName?: string | null;
  readonly variant?: "full" | "now";
  /**
   * When the page's own h1 already names this list, its id: the small label then stays visible but is not a
   * second heading, so screen readers hear the name once.
   */
  readonly pageHeadingId?: string;
}) {
  const teams = useRosterTeams();
  const online = useOnlineStatus();
  const payload = teams.status === "ready" ? teams.data : null;
  const enabled = useMemo(
    () => (Array.isArray(payload?.teams) ? payload.teams.filter((team) => team.enabled) : []),
    [payload],
  );
  const [chosenTeam, setChosenTeam] = useState<string | null>(null);
  const team = enabled.find((candidate) => candidate.serviceId === chosenTeam) ?? enabled[0] ?? null;
  const [day, setDay] = useState<RosterWhosOnDay>("today");
  const shownDay: RosterWhosOnDay = variant === "now" ? "today" : day;
  const range = rosterWhosOnRange(now);
  const overview = useRosterRead(team?.serviceId ?? null, "overview");
  const read = useRosterRead(team?.serviceId ?? null, "assignments", range);
  const [open, setOpen] = useState<RosterWhosOnRow | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  // Kept up to date: read again every two minutes while the page is visible
  // and online, when it comes back into view after five minutes, and when the
  // connection returns after a failed read. The latest values are read through
  // a ref, so no effect re-arms on every render.
  const { reload: reloadRead, readAt, status: readStatus } = read;
  const { reload: reloadOverview } = overview;
  const { reload: reloadTeams, status: teamsStatus } = teams;
  const latest = useRef({ teamsStatus, readStatus, readAt, reloadTeams, reloadRead, reloadOverview });
  useEffect(() => {
    latest.current = { teamsStatus, readStatus, readAt, reloadTeams, reloadRead, reloadOverview };
  });
  const hasTeam = team !== null;
  useEffect(() => {
    if (!hasTeam) return undefined;
    const reloadBoth = () => {
      latest.current.reloadRead();
      latest.current.reloadOverview();
    };
    const visible = () => document.visibilityState === "visible";
    const onVisible = () => {
      if (!visible()) return;
      const at = latest.current.readAt;
      if (at && Date.now() - at.getTime() < STALE_AFTER_MS) return;
      reloadBoth();
    };
    const timer = window.setInterval(() => {
      if (visible() && navigator.onLine !== false) reloadBoth();
    }, REFRESH_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasTeam]);
  useEffect(() => {
    const back = () => {
      const current = latest.current;
      if (current.teamsStatus === "error") current.reloadTeams();
      if (current.readStatus === "error" || current.readStatus === "ready") {
        current.reloadRead();
        current.reloadOverview();
      }
    };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);

  // The last good read, and what has changed since this page first read it.
  const freshAssignments =
    read.status === "ready" && Array.isArray(read.data?.assignments) ? read.data.assignments : null;
  const freshPublication = overview.status === "ready" ? (overview.data?.latestPublication ?? null) : null;
  const teamId = team?.serviceId ?? null;
  const [memory, setMemory] = useState<Memory>(EMPTY_MEMORY);
  if (teamId && freshAssignments && overview.status === "ready") {
    const key = `${teamId}|${read.readAt?.getTime() ?? 0}`;
    // Adjusting state while rendering (React's pattern for state derived from
    // a new answer): runs once per fresh read, never in a loop.
    if (key !== memory.key) {
      setMemory(
        remember(memory, {
          key,
          teamId,
          assignments: freshAssignments,
          publication: freshPublication,
          readAt: read.readAt,
        }),
      );
    }
  }
  const { lastGood, baseline, changedAt } = memory;

  // Offline, the last read stays on screen as "as of" its time, never as live: going offline does not change
  // the read's own state, and the two-minute refresh skips itself, so the read alone cannot say it is old.
  const live = online && freshAssignments !== null && overview.status === "ready";
  const stale =
    !live &&
    lastGood !== null &&
    lastGood.teamId === teamId &&
    (!online || read.status === "error" || overview.status === "error");
  const assignments = live ? freshAssignments : stale ? lastGood.assignments : null;
  const publication = live ? freshPublication : stale ? lastGood.publication : null;
  const shownReadAt = live ? read.readAt : stale ? lastGood.readAt : null;
  const changes = baseline && assignments && live ? rosterWhosOnChanges(baseline.assignments, assignments) : null;

  const date = rosterWhosOnDate(shownDay, now);
  const actorId = payload?.actorId ?? null;
  const allRows = useMemo(
    () => (assignments ? rosterWhosOnRows(assignments, { date, now, actorId }) : []),
    [actorId, assignments, date, now],
  );
  const rows = variant === "now" ? allRows.filter((row) => row.onNow) : allRows;
  const coverage = assignments ? rosterDayCoverage(publication, date) : null;
  const nowMark = rosterNowMark(date, now);
  const sample = payload?.sample === true;
  const gaps = rows.filter((row) => row.name === null).length;

  const refresh = () => {
    reloadRead();
    reloadOverview();
  };

  const switchboardRow = switchboard ? (
    <WorkCard testId="on-call-roster-switchboard">
      <ul className="m-0 list-none p-0">
        <OnCallDialRow
          id={switchboard.id}
          source="handbook"
          title="Switchboard"
          subtitle="To confirm who is on"
          dial={switchboard.dial}
          mobileDial={switchboard.mobileDial}
          updatedAt={switchboard.updatedAt}
          lastConfirmedAt={switchboard.lastConfirmedAt}
          sources={switchboard.sources}
          hospitalName={hospitalName}
          now={now}
          testId="on-call-roster-switchboard-row"
        />
      </ul>
    </WorkCard>
  ) : null;

  let body: ReactNode;
  let needsSwitchboard = false;
  if (teams.status === "loading") {
    body = <OnCallModuleSkeleton rows={variant === "now" ? 2 : 3} twoLine />;
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
    needsSwitchboard = true;
    body = (
      <Message
        icon={CloudOff}
        tone="amber"
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
        tone="neutral"
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
  } else if (!assignments && (read.status === "loading" || overview.status === "loading")) {
    body = <OnCallModuleSkeleton rows={variant === "now" ? 2 : 3} twoLine />;
  } else if (!assignments) {
    needsSwitchboard = true;
    const message = read.status !== "ready" ? read.message : overview.message;
    body = (
      <Message
        icon={CloudOff}
        tone="amber"
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
        tone="neutral"
        title="No roster published yet"
        body={`${team.name} has not published a roster, so nobody is shown. Nobody is guessed.`}
        testId="on-call-roster-unpublished"
      />
    );
  } else if (coverage === "not-published") {
    body = (
      <Message
        icon={CalendarDays}
        tone="neutral"
        title="Not published yet"
        body={`The roster for ${formatPerthDay(date)} is not out, so nobody is shown. Nobody is guessed.${
          publication ? ` Published to ${formatPerthDay(publication.periodEnd)}.` : ""
        }`}
        testId="on-call-roster-not-out"
      />
    );
  } else if (rows.length === 0) {
    needsSwitchboard = true;
    body = (
      <Message
        icon={TriangleAlert}
        tone="amber"
        title={variant === "now" ? "Nobody on the roster right now" : "Nobody on the roster"}
        body={`Nobody is rostered for ${variant === "now" ? "this moment" : formatPerthDay(date)}, and nobody is guessed. Ring switchboard for who is covering.`}
        testId="on-call-roster-nobody"
      />
    );
  } else {
    needsSwitchboard = gaps > 0 || stale;
    body = (
      <>
        <ul
          className="work-rows"
          aria-label={`On the roster, ${ROSTER_WHOS_ON_DAY_LABELS[shownDay].toLowerCase()}`}
          data-testid="on-call-roster-list"
        >
          {rows.map((row) => (
            <PersonRow
              key={row.id}
              row={row}
              nowMark={nowMark}
              stale={stale}
              changedAt={changedAt.get(row.id) ?? null}
              onOpen={(chosen, opener) => {
                openerRef.current = opener;
                setOpen(chosen);
              }}
            />
          ))}
        </ul>
        <RailAxis />
      </>
    );
  }

  const listShown = teams.status === "ready" && team !== null && assignments !== null;
  const changeCount = changes?.count ?? 0;
  const provenance = listShown ? (
    <p
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 border-b px-3 py-2 text-sm",
        stale
          ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning-text)]"
          : "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--text)]",
      )}
      role="status"
      data-testid="on-call-roster-provenance"
    >
      {stale ? (
        <CloudOff aria-hidden="true" className="size-icon-sm shrink-0" />
      ) : (
        <CalendarDays aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--mode-identity)]" />
      )}
      <span className="min-w-0 flex-1 break-words">
        {stale ? (
          <>
            {/* Stale also covers a failed refresh while online, which is not "Offline". */}
            <strong className="font-semibold">{online ? "Could not refresh." : "Offline."}</strong>
            {` Roster as of ${shownReadAt ? perthTimeOf(shownReadAt) : "your last read"}`}
          </>
        ) : (
          <>
            {`From the ${team.name} roster`}
            {publication ? `. ${rosterProvenance(publication)}` : ""}
            {changeCount > 0 ? (
              <strong
                className="font-semibold text-[color:var(--mode-identity)]"
                data-testid="on-call-roster-change-count"
              >
                {changeCount === 1 ? " · 1 change" : ` · ${changeCount} changes`}
              </strong>
            ) : null}
          </>
        )}
      </span>
      <span className="nums whitespace-nowrap text-xs text-[color:var(--text-muted)]">
        {stale ? "Not live" : shownReadAt ? `Loaded ${perthTimeOf(shownReadAt)}` : null}
      </span>
    </p>
  ) : null;

  const daySwitch =
    variant === "full" && teams.status === "ready" && team ? (
      <div className="px-3 pb-1 pt-2.5">
        <SegmentedControl
          label="Day"
          value={day}
          onChange={setDay}
          layout="equal"
          options={ROSTER_WHOS_ON_DAYS.map((value) => ({ value, label: ROSTER_WHOS_ON_DAY_LABELS[value] }))}
        />
      </div>
    ) : null;

  // On Now the block is a glance, not a set-up page: with no team roster to read (signed out, no team in
  // PsychSift yet, or only Roster's made-up example team) it stays off the page, and the full page explains.
  if (variant === "now" && (teams.status === "signed-out" || (teams.status === "ready" && !team) || sample))
    return null;

  return (
    <section
      className="grid min-w-0 gap-2"
      aria-labelledby={pageHeadingId ?? "on-call-roster-heading"}
      data-testid={variant === "now" ? "on-call-roster-right-now" : "on-call-roster-whos-on"}
    >
      <WorkSectionLabel
        id="on-call-roster-heading"
        as={pageHeadingId ? "p" : "h2"}
        count={
          listShown && coverage === "published" ? (
            <span className="nums">
              {variant === "now" ? `${rows.length} on now` : `${rows.length} ${rows.length === 1 ? "shift" : "shifts"}`}
            </span>
          ) : undefined
        }
        action={
          variant === "now"
            ? { label: "All roles", href: ROSTER_WHOS_ON_HREF }
            : listShown && !stale
              ? { label: "Refresh", onClick: refresh }
              : undefined
        }
      >
        {pageHeadingId ? (
          <span aria-hidden="true">From your team roster</span>
        ) : variant === "now" ? (
          "Right now, from your roster"
        ) : (
          "From your team roster"
        )}
      </WorkSectionLabel>
      {sample ? (
        <WorkCard padded>
          <p className="text-sm text-[color:var(--text)]" role="note" data-testid="on-call-roster-sample">
            Example team. Every name and shift here is made up so you can see how it works.
          </p>
        </WorkCard>
      ) : null}
      {variant === "full" && enabled.length > 1 ? (
        <Select
          label="Team"
          value={team?.serviceId ?? ""}
          onChange={(event) => setChosenTeam(event.target.value)}
          options={enabled.map((candidate) => ({ value: candidate.serviceId, label: candidate.name }))}
          className="min-h-12"
          data-testid="on-call-roster-team"
        />
      ) : null}
      {listShown ? (
        <WorkCard testId="on-call-roster-card">
          {provenance}
          {daySwitch}
          {body}
        </WorkCard>
      ) : (
        <>
          {daySwitch ? <WorkCard>{daySwitch}</WorkCard> : null}
          {body}
        </>
      )}
      {stale ? (
        <Message
          icon={TriangleAlert}
          tone="amber"
          title="A later change would not show"
          body={
            online
              ? "This is the roster as it was when it was last read. Ring switchboard to confirm who is on."
              : "This is the roster as it was when you last had a connection. Ring switchboard to confirm who is on."
          }
          testId="on-call-roster-stale"
        />
      ) : null}
      {gaps > 0 && !stale ? (
        <Message
          icon={TriangleAlert}
          tone="amber"
          title={gaps === 1 ? "1 shift with nobody rostered" : `${gaps} shifts with nobody rostered`}
          body="Nobody is guessed. Ring switchboard for who is covering."
          testId="on-call-roster-gap"
        />
      ) : null}
      {needsSwitchboard ? switchboardRow : null}
      {variant === "full" && teams.status === "ready" && team ? (
        <p className="px-1 text-sm text-[color:var(--text-muted)]">
          No second list. When the roster changes, this changes. Names and shifts only, never leave or reasons.
        </p>
      ) : null}
      <RosterPersonSheet
        row={open}
        date={date}
        teamName={team?.name ?? null}
        managers={overview.status === "ready" ? (overview.data?.managers ?? []) : []}
        publication={publication}
        readAt={shownReadAt}
        changedAt={open ? (changedAt.get(open.id) ?? null) : null}
        stale={stale}
        now={now}
        onClose={() => setOpen(null)}
        returnFocusRef={openerRef}
      />
    </section>
  );
}
