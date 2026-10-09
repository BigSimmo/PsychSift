"use client";

import {
  ArrowLeftRight,
  BookOpen,
  CalendarDays,
  CalendarOff,
  CalendarX2,
  HandHelping,
  Inbox,
  Info,
  Plane,
  Thermometer,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { WorkStateLoading, WorkStateNotice } from "@/components/mode-kit/work-state";
import { RosterStaffingEntryLink } from "@/components/roster/staffing/roster-staffing-entry";
import { useRosterNow } from "@/components/roster/roster-format";
import {
  RosterDateLead,
  RosterFootnote,
  RosterIconLead,
  RosterLinkWord,
  RosterList,
  RosterNote,
  RosterRow,
  RosterSectionHead,
} from "@/components/roster/roster-list";
import { useRosterRead, useRosterTeams } from "@/components/roster/use-roster-team";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { WEEKDAYS, addDaysToDate, formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { RosterLeave } from "@/lib/roster/leave";
import { isRosterLeaveKind, ROSTER_LEAVE_KIND_LABEL, type RosterLeaveKind } from "@/lib/roster/leave-kinds";

import { RosterSentBar, type SentReceipt } from "./roster-sent-bar";
import { RosterSignInNotice } from "@/components/roster/invite/roster-sign-in-notice";
import { RosterPageHeader, rosterField } from "@/components/roster/roster-ui";
import { RosterNewButton, useRosterNewButtonClearance } from "@/components/roster/roster-new-button";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";

/* Each sheet draws nothing while closed, so each loads only once first opened (and quietly when the page is idle). */
const loadSwapFlowSheet = () => import("@/components/roster/swaps/swap-flow-sheet");
const loadDatesSheet = () => import("./roster-dates-sheet");
const loadGiveAwaySheet = () => import("./roster-give-away-sheet");
const loadLeaveSheet = () => import("./roster-leave-sheet");
const SwapFlowSheet = dynamic(() => loadSwapFlowSheet().then((m) => m.SwapFlowSheet), { ssr: false });
const RosterDatesSheet = dynamic(() => loadDatesSheet().then((m) => m.RosterDatesSheet), { ssr: false });
const RosterGiveAwaySheet = dynamic(() => loadGiveAwaySheet().then((m) => m.RosterGiveAwaySheet), { ssr: false });
const RosterLeaveSheet = dynamic(() => loadLeaveSheet().then((m) => m.RosterLeaveSheet), { ssr: false });

function preloadSheets(): () => void {
  const load = () => {
    for (const loader of [loadLeaveSheet, loadDatesSheet, loadGiveAwaySheet, loadSwapFlowSheet]) {
      void loader().catch(() => undefined);
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(load);
    return () => window.cancelIdleCallback(id);
  }
  const timer = window.setTimeout(load, 1500);
  return () => window.clearTimeout(timer);
}

type Start = "swap" | "give_away" | "cant_make" | "dates" | "leave";
type ActiveSheet = {
  kind: Start;
  assignment?: string;
  /** A colleague to preselect in the swap sheet; only a starting point, re-weighed there. */
  person?: string;
  leaveId?: string;
  date?: string;
  to?: string;
  dateKind?: "cant" | "prefer_off";
  /** The kind a new leave entry starts on, from a Leave wallet card. */
  leaveKind?: RosterLeaveKind;
} | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const subscribeSearch = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
const searchSnapshot = () => window.location.search;
const serverSearchSnapshot = () => "";

/** What the doctor marked in the leave form; PsychSift never reads HR. */
const LEAVE_MARK: Record<RosterLeave["status"], string> = {
  planned: "not yet lodged in HR",
  applied: "applied in HR",
  approved: "approved in HR",
};
const LEAVE_KIND = ROSTER_LEAVE_KIND_LABEL;
const LEAVE_ICON: Record<RosterLeaveKind, LucideIcon> = {
  annual: Plane,
  pd_leave: CalendarDays,
  exam: BookOpen,
  personal: Thermometer,
};
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const DAY_WORDS: Record<"cant" | "prefer_off", string> = { cant: "Can't work", prefer_off: "Prefer off" };

const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/** `Wed 7 Oct · 1 day · you marked it: not yet lodged in HR`. */
function leaveLine(item: RosterLeave) {
  const days = dayCount(item.startsOn, item.endsOn);
  const span =
    item.startsOn === item.endsOn
      ? formatPerthDay(item.startsOn)
      : `${formatPerthDay(item.startsOn)} to ${formatPerthDay(item.endsOn)}`;
  return `${span} · ${days} ${days === 1 ? "day" : "days"} · you marked it: ${LEAVE_MARK[item.status]}`;
}

/** Your marked dates, with back-to-back days of the same kind joined into one row. */
function dateRuns(rows: readonly { date: string; kind: "cant" | "prefer_off" }[]) {
  const runs: { from: string; to: string; kind: "cant" | "prefer_off" }[] = [];
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = runs.at(-1);
    if (last && last.kind === row.kind && addDaysToDate(last.to, 1) === row.date) last.to = row.date;
    else runs.push({ from: row.date, to: row.date, kind: row.kind });
  }
  return runs;
}

function TryAgainNote({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return <WorkStateNotice kind="error" title={children} onRetry={onRetry} />;
}

/** Dates I can't work, leave and shifts I can't make. Swaps and open shifts live on the Swaps page. */
export function RosterRequestsPage() {
  const now = useRosterNow();
  // The band's words (mockup `rost_requests`); the page heading "Requests" stays under it.
  useModeBandHeading({ eyebrow: "Leave, dates and shift changes", title: "Leave and requests" });
  const newButtonClearance = useRosterNewButtonClearance();
  const search = useSyncExternalStore(subscribeSearch, searchSnapshot, serverSearchSnapshot);
  const [consumedSearch, setConsumedSearch] = useState<string | null>(null);
  const teams = useRosterTeams();
  const enabled = useMemo(() => teams.data?.teams.filter((team) => team.enabled) ?? [], [teams.data]);
  const actorId = teams.data?.actorId ?? null;
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const serviceId =
    enabled.length > 1
      ? (enabled.find((team) => team.serviceId === selectedServiceId)?.serviceId ?? null)
      : (enabled[0]?.serviceId ?? null);
  const today = perthDateOf(now);
  const range = useMemo(() => ({ from: addDaysToDate(today, -7), to: addDaysToDate(today, 54) }), [today]);
  const overview = useRosterRead(serviceId, "overview");
  const assignments = useRosterRead(serviceId, "assignments", range);
  // The same window the dates sheet edits: tomorrow and the 55 days after.
  const datesRange = useMemo(() => ({ from: addDaysToDate(today, 1), to: addDaysToDate(today, 56) }), [today]);
  const unavailability = useRosterRead(serviceId, "unavailability", datesRange);
  const [leave, setLeave] = useState<RosterLeave[]>([]);
  const [leaveState, setLeaveState] = useState<"loading" | "ready" | "error">("loading");
  const [sheet, setSheet] = useState<ActiveSheet>(null);
  useEffect(preloadSheets, []);
  // Once a sheet has opened it stays mounted, as all of them were before, so reopening behaves the same.
  const [opened, setOpened] = useState({ giveAway: false, dates: false, leave: false });
  const giveAwayOpen = sheet?.kind === "give_away" || sheet?.kind === "cant_make";
  if (
    (giveAwayOpen && !opened.giveAway) ||
    (sheet?.kind === "dates" && !opened.dates) ||
    (sheet?.kind === "leave" && !opened.leave)
  ) {
    setOpened({
      giveAway: opened.giveAway || giveAwayOpen,
      dates: opened.dates || sheet?.kind === "dates",
      leave: opened.leave || sheet?.kind === "leave",
    });
  }
  const [sent, setSent] = useState<SentReceipt | null>(null);
  const clearSent = useCallback(() => setSent(null), []);
  const leaveReadSequence = useRef(0);

  const reload = useCallback(() => {
    overview.reload();
    assignments.reload();
    unavailability.reload();
  }, [overview, assignments, unavailability]);
  const loadLeave = useCallback((signal?: AbortSignal) => {
    const sequence = ++leaveReadSequence.current;
    return Promise.resolve()
      .then(() => fetch("/api/roster/leave", { cache: "no-store", signal }))
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<{ leave: RosterLeave[] }>;
      })
      .then((payload) => {
        if (signal?.aborted || sequence !== leaveReadSequence.current) return;
        setLeave(payload.leave);
        setLeaveState("ready");
      })
      .catch(() => {
        if (signal?.aborted || sequence !== leaveReadSequence.current) return;
        setLeaveState("error");
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (teams.status === "ready") void loadLeave(controller.signal);
    return () => controller.abort();
  }, [teams.status, loadLeave]);
  const handoff = (() => {
    if (teams.status !== "ready" || !search || search === consumedSearch) return null;
    const params = new URLSearchParams(search);
    const start = params.get("start");
    if (!start || !["swap", "give_away", "cant_make", "dates", "leave"].includes(start)) return null;
    const assignment = params.get("assignment");
    const teamId = params.get("team");
    const date = params.get("date");
    const to = params.get("to");
    const dateKind = params.get("kind");
    // A person who is not a UUID is dropped rather than refusing the whole hand-off.
    const person = params.get("person");
    // Query parameters may prefill a sheet; they can never identify the actor.
    if ((assignment && !UUID.test(assignment)) || (date && !DATE.test(date)) || (to && !DATE.test(to))) return null;
    if (start === "dates" && dateKind && dateKind !== "cant" && dateKind !== "prefer_off") return null;
    // An unknown leave kind starts the sheet on its default rather than refusing the hand-off.
    const leaveKind = start === "leave" && isRosterLeaveKind(dateKind) ? dateKind : undefined;
    let targetServiceId = serviceId;
    if (start !== "leave" && enabled.length > 1) {
      if (teamId && (!UUID.test(teamId) || !enabled.some((team) => team.serviceId === teamId))) return null;
      targetServiceId = teamId ?? serviceId;
    }
    if (start !== "leave" && (!targetServiceId || !actorId)) return null;
    return {
      serviceId: targetServiceId,
      sheet: {
        kind: start as Start,
        assignment: assignment ?? undefined,
        person: start === "swap" && person && UUID.test(person) ? person : undefined,
        date: date ?? undefined,
        to: to ?? undefined,
        dateKind: start === "dates" && dateKind === "prefer_off" ? "prefer_off" : undefined,
        leaveKind,
      } satisfies NonNullable<ActiveSheet>,
    };
  })();
  if (handoff) {
    setConsumedSearch(search);
    setSelectedServiceId(handoff.serviceId);
    setSheet(handoff.sheet);
  }
  useEffect(() => {
    if (consumedSearch && window.location.search === consumedSearch)
      window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [consumedSearch]);

  const onSent = useCallback(
    (message: string, undo?: () => Promise<void>) => {
      setSent({
        message,
        undo: undo
          ? async () => {
              await undo();
              reload();
              void loadLeave();
            }
          : undefined,
      });
      reload();
      void loadLeave();
    },
    [reload, loadLeave],
  );

  const myAssignments = assignments.data?.assignments ?? [];
  const swapGive =
    sheet?.kind === "swap" && actorId
      ? myAssignments.find((item) => item.id === sheet.assignment && item.userId === actorId)
      : undefined;
  const currentLeave = leave.filter((item) => item.endsOn >= today);
  const earlierLeave = leave.filter((item) => item.endsOn < today);

  function leaveRow(item: RosterLeave) {
    return (
      <RosterRow
        key={item.id}
        lead={<RosterIconLead icon={LEAVE_ICON[item.kind]} />}
        title={LEAVE_KIND[item.kind]}
        sub={leaveLine(item)}
        label={`Review ${LEAVE_KIND[item.kind].toLowerCase()}, ${leaveLine(item)}`}
        onClick={() => setSheet({ kind: "leave", leaveId: item.id })}
      />
    );
  }
  const myDates =
    actorId && unavailability.status === "ready"
      ? dateRuns((unavailability.data?.unavailability ?? []).filter((row) => row.userId === actorId))
      : [];

  const canTeamAct = !!serviceId && !!actorId && overview.status === "ready";
  return (
    <InformationPageShell testId="roster-requests-page" className={newButtonClearance}>
      <RosterPageHeader
        icon={Inbox}
        eyebrow="Roster"
        title="Requests"
        subtitle="Dates you can't work, leave, and shifts you can't make."
        actions={
          <RosterNewButton
            entries={[
              ...(
                [
                  ["give_away", "Give a shift away", HandHelping],
                  ["cant_make", "I can't make my shift", CalendarX2],
                  ["dates", "Dates I can't work", CalendarOff],
                ] as const
              ).map(([kind, label, icon]) => ({
                id: kind,
                label,
                icon,
                onSelect: () => setSheet({ kind }),
                disabled: canTeamAct ? undefined : { reason: "Needs a confirmed team" },
              })),
              { id: "leave", label: "Plan leave", icon: Plane, onSelect: () => setSheet({ kind: "leave" }) },
              {
                id: "swap",
                label: "Swap a shift",
                description: "Pick the shift on the Team calendar",
                icon: ArrowLeftRight,
                href: "/roster/team?view=week",
              },
            ]}
          />
        }
      />
      <div className="grid min-w-0 gap-3" data-mode-identity="roster">
        {enabled.length > 1 ? (
          <label className="grid max-w-sm gap-1 text-sm text-[color:var(--text-muted)]">
            Team
            <select
              value={selectedServiceId ?? ""}
              onChange={(event) => setSelectedServiceId(event.target.value || null)}
              className={rosterField}
            >
              <option value="">Choose a team</option>
              {enabled.map((team) => (
                <option value={team.serviceId} key={team.serviceId}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {enabled.length > 1 && !selectedServiceId ? (
          <RosterNote icon={Info}>
            <p>Choose the team for a request before continuing.</p>
          </RosterNote>
        ) : null}
        {teams.status === "loading" ? <WorkStateLoading label="Loading your teams…" rows={2} /> : null}
        {teams.status === "signed-out" ? (
          <RosterSignInNotice testId="roster-requests-signed-out">
            Sign in to see your leave and requests.
          </RosterSignInNotice>
        ) : null}
        {teams.status === "not-confirmed" || teams.status === "unavailable" ? (
          <ModeNotice testId="roster-requests-team-pending">
            {teams.status === "not-confirmed" && teams.message
              ? teams.message
              : "Team requests aren\u2019t available yet. Try again later."}
          </ModeNotice>
        ) : null}
        {teams.status === "error" ? <TryAgainNote onRetry={teams.reload}>{teams.message}</TryAgainNote> : null}
        {teams.status === "ready" && !enabled.length ? (
          <RosterNote icon={Info}>
            <p>No confirmed team yet. You can still plan your own leave.</p>
          </RosterNote>
        ) : null}
        {serviceId && (assignments.status === "error" || overview.status === "error") ? (
          <TryAgainNote onRetry={reload}>The team roster couldn&apos;t be checked.</TryAgainNote>
        ) : null}
        {sheet?.kind === "swap" && assignments.status === "ready" && !swapGive ? (
          <RosterNote icon={Info} role="alert">
            <p>
              That shift couldn&apos;t be found. Open it from the{" "}
              <Link href="/roster/team" className="underline underline-offset-2">
                Team calendar
              </Link>{" "}
              to swap it.
            </p>
          </RosterNote>
        ) : null}
        <RosterSentBar receipt={sent} clear={clearSent} />
        <RosterList>
          <RosterRow
            href="/roster/swaps"
            lead={<RosterIconLead icon={ArrowLeftRight} />}
            title="Swaps and open shifts"
            sub="Answer a swap, follow one you sent, or take an open shift"
          />
        </RosterList>

        <section aria-labelledby="roster-requests-leave" className="grid min-w-0 gap-3">
          <RosterSectionHead
            id="roster-requests-leave"
            title="Leave"
            right={<RosterLinkWord onClick={() => setSheet({ kind: "leave" })}>Plan leave</RosterLinkWord>}
          />
          {enabled.length ? (
            <NewWorkModeOnly>
              <RosterStaffingEntryLink />
            </NewWorkModeOnly>
          ) : null}
          {currentLeave.length ? (
            <RosterList label="Leave">{currentLeave.map(leaveRow)}</RosterList>
          ) : teams.status === "loading" || (teams.status === "ready" && leaveState === "loading") ? (
            <>
              <p role="status" className="sr-only">
                Loading your leave…
              </p>
              <ModeModuleSkeleton rows={2} twoLine testId="roster-requests-leave-loading" />
            </>
          ) : teams.status === "ready" && leaveState === "ready" ? (
            <RosterList label="Leave">
              <RosterRow
                lead={<RosterIconLead icon={Plane} />}
                title="Nothing yet"
                sub="Plan leave here, then mark what HR has said"
              />
            </RosterList>
          ) : null}
          {leaveState === "error" ? (
            <TryAgainNote onRetry={() => void loadLeave()}>Your leave couldn&apos;t be loaded.</TryAgainNote>
          ) : null}
          {earlierLeave.length ? (
            <>
              <RosterSectionHead title="Earlier leave" />
              <RosterList label="Earlier leave">{earlierLeave.map(leaveRow)}</RosterList>
            </>
          ) : null}
          <RosterFootnote>HR status is what you mark yourself. PsychSift does not talk to HR.</RosterFootnote>
        </section>

        {serviceId && actorId ? (
          <section aria-labelledby="roster-requests-dates" className="grid min-w-0 gap-3">
            <RosterSectionHead
              id="roster-requests-dates"
              title="Dates I can't work"
              right={
                canTeamAct ? (
                  <RosterLinkWord label="Add dates I can't work" onClick={() => setSheet({ kind: "dates" })}>
                    Add
                  </RosterLinkWord>
                ) : null
              }
            />
            {unavailability.status === "error" ? (
              <TryAgainNote onRetry={unavailability.reload}>Your dates couldn&apos;t be loaded.</TryAgainNote>
            ) : unavailability.status !== "ready" && unavailability.status !== "loading" ? (
              <RosterNote icon={Info}>
                <p>{unavailability.message ?? "Your dates couldn't be loaded."}</p>
              </RosterNote>
            ) : unavailability.status !== "ready" ? (
              <>
                <p role="status" className="sr-only">
                  Loading your dates…
                </p>
                <ModeModuleSkeleton rows={2} twoLine testId="roster-requests-dates-loading" />
              </>
            ) : myDates.length ? (
              <RosterList label="Dates I can't work">
                {myDates.map((run) => {
                  const days = dayCount(run.from, run.to);
                  return (
                    <RosterRow
                      key={run.from}
                      lead={<RosterDateLead weekday={weekdayOf(run.from)} day={Number(run.from.slice(8, 10))} />}
                      title={DAY_WORDS[run.kind]}
                      sub={
                        days === 1
                          ? MONTH_NAMES[Number(run.from.slice(5, 7)) - 1]
                          : `${formatPerthDay(run.from)} to ${formatPerthDay(run.to)} · ${days} days`
                      }
                    />
                  );
                })}
              </RosterList>
            ) : (
              <RosterList label="Dates I can't work">
                <RosterRow
                  lead={<RosterIconLead icon={CalendarOff} />}
                  title="No dates marked"
                  sub="For the next 8 weeks"
                />
              </RosterList>
            )}
            <RosterFootnote>Your manager sees these dates. Reasons are not saved.</RosterFootnote>
          </section>
        ) : serviceId && teams.status === "ready" ? (
          // The team loaded but your place in it could not be confirmed: say so rather than hide the section.
          <TryAgainNote onRetry={teams.reload}>Your place on the team couldn&apos;t be confirmed.</TryAgainNote>
        ) : null}
      </div>
      {serviceId && actorId ? (
        <>
          {swapGive ? (
            <SwapFlowSheet
              open
              onClose={() => setSheet(null)}
              serviceId={serviceId}
              actorId={actorId}
              give={swapGive}
              mode="swap"
              onSent={onSent}
              initialColleagueId={sheet?.person}
            />
          ) : null}
          {opened.giveAway ? (
            <RosterGiveAwaySheet
              open={giveAwayOpen}
              onClose={() => setSheet(null)}
              serviceId={serviceId}
              actorId={actorId}
              initialAssignmentId={sheet?.assignment}
              urgent={sheet?.kind === "cant_make"}
              onSent={onSent}
            />
          ) : null}
          {opened.dates ? (
            <RosterDatesSheet
              open={sheet?.kind === "dates"}
              onClose={() => setSheet(null)}
              serviceId={serviceId}
              actorId={actorId}
              initialDate={sheet?.kind === "dates" ? sheet.date : undefined}
              toDate={sheet?.kind === "dates" ? sheet.to : undefined}
              initialKind={sheet?.kind === "dates" ? sheet.dateKind : undefined}
              onSent={onSent}
            />
          ) : null}
        </>
      ) : null}
      {opened.leave ? (
        <RosterLeaveSheet
          open={sheet?.kind === "leave"}
          onClose={() => setSheet(null)}
          teams={enabled}
          actorId={actorId ?? ""}
          assignments={myAssignments}
          assignmentsReady={assignments.status === "ready"}
          loadedTo={range.to}
          initialDate={sheet?.kind === "leave" ? sheet.date : undefined}
          initialTo={sheet?.kind === "leave" ? sheet.to : undefined}
          initialKind={sheet?.kind === "leave" ? sheet.leaveKind : undefined}
          existing={leave.find((item) => item.id === sheet?.leaveId)}
          onSent={onSent}
          onSaved={(entry) => setLeave((old) => [...old.filter((item) => item.id !== entry.id), entry])}
          onDeleted={(id) => setLeave((old) => old.filter((item) => item.id !== id))}
        />
      ) : null}
    </InformationPageShell>
  );
}
