"use client";

import {
  ArrowLeftRight,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  FileUp,
  Link2,
  Moon,
  MoonStar,
  Plane,
  Phone,
  Plus,
  RefreshCw,
  Sun,
  Users,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeActionButton } from "@/components/mode-kit/action-button";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { useModeBandHeading, WithoutModeBand } from "@/components/mode-band/mode-band";
import { ModeNotice } from "@/components/mode-kit/notice";
import { WorkHero, WorkRing } from "@/components/mode-kit/work";
import { TodayShell } from "@/components/mode-kit/today/today-shell";
import { modeDot } from "@/components/mode-kit/recipes";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { summariseToday, type TodaySummary } from "@/lib/roster/today";

import { RosterSignInNotice } from "./invite/roster-sign-in-notice";
import type { RosterAddView } from "./roster-add-sheet";
import { RosterNewButton, useRosterNewButtonClearance } from "./roster-new-button";
import { RosterTodayTeam } from "./team/roster-today-team";
import { formatDateSpan, formatDuration, kindOf, shiftTimes, useRosterNow } from "./roster-format";
import { RosterNightDial } from "./roster-night-dial";
import { RosterIdentityTile, RosterPageHeader, RosterSection, RosterStat, RosterStats } from "./roster-ui";
import { RosterWeekStrip } from "./roster-week-strip";
import {
  hasFreshLink,
  refreshDueRosterLinks,
  staleRosterLink,
  useRosterLinks,
  type RosterCalendarLink,
} from "./use-roster-links";
import { useRosterSettings } from "./use-roster-settings";
import { useRosterShifts } from "./use-roster-shifts";
import { useRosterTeamRules, useRosterTeams } from "./use-roster-team";
import { RosterRestChip } from "./roster-rest-chip";
import { RosterWhoCanCover } from "./roster-who-can-cover";
import { ModeGroupedList } from "@/components/mode-kit/grouped-list";
import { restCuesByTeam, type RestCue } from "@/lib/roster/rest-cues";
import { importChangeNotices } from "@/lib/roster/what-changed";
import { RosterChangeRows } from "./roster-change-rows";
import { zonedDateOf, zonedWallToIso } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/**
 * Roster Today: where am I working, when, answered with no taps. The lead
 * comes from `summariseToday`: on now, before today's shift, a day off leading
 * with the next shift, or empty with both ways in. Between 00:00 and 06:00 on a
 * night the lead becomes the night dial.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/* The import flow and the add sheet show only on demand, so they load apart from Today, quietly once idle. */
const loadImportFlow = () => import("./roster-import-flow");
const loadAddSheet = () => import("./roster-add-sheet");
const RosterImportFlow = dynamic(() => loadImportFlow().then((m) => m.RosterImportFlow), { ssr: false });
const RosterAddSheet = dynamic(() => loadAddSheet().then((m) => m.RosterAddSheet), { ssr: false });

function preloadOnDemandParts(): () => void {
  const load = () => {
    void loadAddSheet().catch(() => undefined);
    void loadImportFlow().catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(load);
    return () => window.cancelIdleCallback(id);
  }
  const timer = window.setTimeout(load, 1500);
  return () => window.clearTimeout(timer);
}

/** A stat with nothing ahead says so in words, never a bare dash. */
function NoneYet({ children }: { readonly children: string }) {
  return <span className="text-[color:var(--text-muted)]">{children}</span>;
}

/**
 * Calendar-link freshness on Today. Green "Up to date" while any link
 * refreshed in the last six hours (one 600ms pulse when it turns fresh while
 * the page is open — never on first load, never with reduced motion). When a
 * link exists but none are fresh, a clear stale cue and the same one-tap
 * Refresh Settings already uses (`Refresh ${hostPreview}`).
 */
function RosterFreshness({
  fresh,
  staleLink,
  refreshing,
  onRefresh,
}: {
  readonly fresh: boolean;
  readonly staleLink: RosterCalendarLink | null;
  readonly refreshing: boolean;
  readonly onRefresh: (id: string) => void;
}) {
  const dot = useRef<HTMLSpanElement>(null);
  const previous = useRef<boolean | null>(null);
  useEffect(() => {
    const was = previous.current;
    previous.current = fresh;
    if (!fresh || was !== false || !dot.current?.animate) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    dot.current.animate(
      [
        { boxShadow: "0 0 0 0 var(--success)", opacity: 1 },
        { boxShadow: "0 0 0 6px transparent", opacity: 1 },
      ],
      { duration: 600, easing: "ease-out", iterations: 1 },
    );
  }, [fresh]);
  if (fresh) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]" data-testid="roster-fresh">
        <span ref={dot} aria-hidden="true" className={cn(modeDot, "bg-[color:var(--success)]")} />
        Up to date
      </p>
    );
  }
  if (!staleLink) return null;
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 text-xs text-[color:var(--text-muted)]"
      data-testid="roster-stale"
    >
      <span aria-hidden="true" className={cn(modeDot, "bg-[color:var(--warning)]")} />
      <span className="min-w-0">May be out of date</span>
      <ModeActionButton
        icon={RefreshCw}
        label={`Refresh ${staleLink.hostPreview}`}
        onClick={() => onRefresh(staleLink.id)}
        disabled={refreshing}
        testId="roster-stale-refresh"
      />
    </div>
  );
}

function DayLine({ shift, now }: { readonly shift: OnCallShift; readonly now: Date }) {
  const { zone } = useWorkTimeZone();
  const today = zonedDateOf(now, zone);
  const dayStart = Date.parse(zonedWallToIso(today, "00:00", zone) ?? `${today}T00:00:00+08:00`);
  const start = Math.max(0, (Date.parse(shift.startsAt) - dayStart) / DAY_MS);
  const end = Math.min(1, (Date.parse(shift.endsAt) - dayStart) / DAY_MS);
  const at = Math.min(1, Math.max(0, (now.getTime() - dayStart) / DAY_MS));
  // The hero's 24 h track (mockup `rost_today`): what's done of today, the shift's block and a
  // marker for now. Drawn in the hero's own ink, so it reads on the gradient in light and dark.
  return (
    <div className="grid gap-1" aria-hidden="true" data-testid="roster-today-track">
      <span className="relative block h-2 rounded-full bg-[color:color-mix(in_oklab,currentColor_22%,transparent)] forced-colors:border">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[color:color-mix(in_oklab,currentColor_30%,transparent)]"
          style={{ width: `${at * 100}%` }}
        />
        {end > start ? (
          <span
            className="absolute inset-y-0 rounded-full bg-[color:color-mix(in_oklab,currentColor_78%,transparent)] forced-colors:bg-[CanvasText]"
            style={{ left: `${start * 100}%`, width: `${(end - start) * 100}%` }}
          />
        ) : null}
        <span
          className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
          style={{ left: `${at * 100}%` }}
        />
      </span>
      <span className="nums flex justify-between text-[0.625rem] opacity-90">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </span>
    </div>
  );
}

function ShiftTimes({ shift }: { readonly shift: OnCallShift }) {
  const { start, end, plusOne } = shiftTimes(shift);
  return (
    <span className="nums flex flex-wrap items-baseline gap-x-1.5 text-[1.375rem] font-bold leading-tight tracking-display">
      <span>{start}</span>
      <span className="text-sm font-semibold opacity-90">to</span>
      <span>{end}</span>
      {plusOne ? <span className="text-xs font-semibold opacity-90">+1</span> : null}
    </span>
  );
}

/** Hours with one decimal for the ring ("13", "5.5"), from milliseconds. */
function ringHours(ms: number): string {
  const hours = Math.max(0, ms) / 3_600_000;
  return hours >= 10 ? String(Math.round(hours)) : String(Math.round(hours * 10) / 10);
}

const heroButton =
  "inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[color:color-mix(in_oklab,currentColor_16%,transparent)] px-3 text-[0.8125rem] font-semibold text-current no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current forced-colors:border";

function Hero({
  summary,
  byId,
  now,
  canEdit,
  onImport,
  onAddShift,
  cues,
}: {
  readonly cues: ReadonlyMap<string, RestCue>;
  readonly summary: TodaySummary;
  readonly canEdit: boolean;
  readonly byId: ReadonlyMap<string, OnCallShift>;
  readonly now: Date;
  readonly onImport: () => void;
  readonly onAddShift: () => void;
}) {
  const lead = summary.lead;
  if (lead.state === "empty") {
    return (
      <section className="work-card grid justify-items-start gap-3 p-5" data-testid="roster-today-empty">
        <RosterIdentityTile icon={CalendarRange} />
        <h2 className="text-lg-minus font-semibold text-[color:var(--text-heading)]">Get your shifts in</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          Import your roster file or add a shift, and Today will show where you&apos;re working and when.
        </p>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Button variant="primary" onClick={onImport} disabled={!canEdit}>
            Import a file
          </Button>
          <Button variant="secondary" onClick={onAddShift} disabled={!canEdit}>
            Add a shift
          </Button>
        </div>
        <p className="text-sm text-[color:var(--text-muted)]">
          In a hospital team? Your roster manager will invite you.
        </p>
      </section>
    );
  }

  const leadShift =
    lead.state === "day_off"
      ? lead.next
        ? (byId.get(lead.next.id) ?? null)
        : null
      : (byId.get(lead.shift.id) ?? null);

  if (lead.state === "on_now" && lead.isNight && leadShift && Number(perthTimeOf(now).slice(0, 2)) < 6) {
    return (
      <RosterNightDial
        shift={leadShift}
        now={now}
        workplace={leadShift.workplace ?? leadShift.location}
        teamShift={
          leadShift.serviceId && leadShift.assignmentId
            ? { serviceId: leadShift.serviceId, assignmentId: leadShift.assignmentId }
            : null
        }
      />
    );
  }

  const eyebrow =
    lead.state === "day_off"
      ? lead.finishedToday
        ? "Finished for today"
        : "Day off"
      : `${leadShift ? SHIFT_KIND_LABEL[kindOf(leadShift)] : "Shift"}${
          leadShift?.workplace ? ` · ${leadShift.workplace}` : ""
        }`;
  const place = leadShift?.location && leadShift.location !== leadShift.workplace ? leadShift.location : null;
  let when: string | null = null;
  if (leadShift && lead.state === "before")
    when = `Starts in ${formatDuration(Date.parse(leadShift.startsAt) - now.getTime())}`;
  if (leadShift && lead.state === "on_now")
    when = `Ends in ${formatDuration(Date.parse(leadShift.endsAt) - now.getTime())}`;

  // Only a live or upcoming shift earns a status word; a day off already says so in the eyebrow.
  const status = lead.state === "on_now" ? "On now" : lead.state === "before" ? "Later today" : null;

  // The ring (mockup "13 h / to go"): time left of the shift on now, or time until today's
  // shift starts, out of the day. Nothing is drawn on a day off.
  let ring: ReactNode = null;
  if (leadShift && lead.state === "on_now") {
    const total = Date.parse(leadShift.endsAt) - Date.parse(leadShift.startsAt);
    const left = Date.parse(leadShift.endsAt) - now.getTime();
    ring = (
      <WorkRing
        value={ringHours(left)}
        label="h left"
        fraction={total > 0 ? 1 - left / total : 0}
        accessibleLabel={`${formatDuration(left)} left of this shift`}
      />
    );
  } else if (leadShift && lead.state === "before") {
    const until = Date.parse(leadShift.startsAt) - now.getTime();
    ring = (
      <WorkRing
        value={ringHours(until)}
        label="h to go"
        fraction={1 - Math.min(1, until / DAY_MS)}
        accessibleLabel={`Starts in ${formatDuration(until)}`}
      />
    );
  }

  return (
    <div data-mode-identity="roster" className="grid">
      <WorkHero
        testId="roster-today-hero"
        aria-label="Today"
        eyebrow={[eyebrow, status].filter(Boolean).join(" · ")}
        title={
          leadShift ? (
            <span className="grid gap-0.5">
              {lead.state === "day_off" ? (
                <span className="text-[0.9375rem] font-semibold" data-testid="roster-today-next">
                  {`Next: ${SHIFT_KIND_LABEL[kindOf(leadShift)]}, `}
                  <span>{formatPerthDay(perthDateOf(leadShift.startsAt))}</span>
                </span>
              ) : null}
              <ShiftTimes shift={leadShift} />
            </span>
          ) : (
            "No more shifts in your roster."
          )
        }
        sub={
          leadShift && (when || place) ? (
            <span className="nums">{[when, place].filter(Boolean).join(" · ")}</span>
          ) : null
        }
        ring={ring}
        footer={
          <div className="grid gap-3">
            {leadShift ? <RosterRestChip cue={cues.get(leadShift.id)} testId="roster-today-rest" /> : null}
            {leadShift && lead.state !== "day_off" ? <DayLine shift={leadShift} now={now} /> : null}
            {summary.nextWeekendOff ? (
              <p className="m-0 text-xs">
                <span className="opacity-90">Weekend off · </span>
                <span className="nums font-semibold">
                  {formatDateSpan(summary.nextWeekendOff.saturday, summary.nextWeekendOff.sunday)}
                </span>
              </p>
            ) : null}
            <div className="flex gap-2" data-testid="roster-today-hero-actions">
              <Link href="/roster/team" className={heroButton}>
                <Users aria-hidden="true" strokeWidth={2} className="size-icon-sm" />
                Who is on
              </Link>
              <Link href="/on-call/contacts" className={heroButton}>
                <Phone aria-hidden="true" strokeWidth={2} className="size-icon-sm" />
                Phone numbers
              </Link>
            </div>
          </div>
        }
      />
    </div>
  );
}

/** A warm line under the date, from the Perth hour. */
function greetingFor(now: Date): { readonly text: string; readonly icon: typeof Sun } {
  const hour = Number(perthTimeOf(now).slice(0, 2));
  if (hour >= 5 && hour < 12) return { text: "Good morning", icon: Sun };
  if (hour >= 12 && hour < 18) return { text: "Good afternoon", icon: Sun };
  return { text: "Good evening", icon: Moon };
}

export function RosterTodayPage({ now: pinnedNow }: { readonly now?: Date } = {}) {
  const { zone } = useWorkTimeZone();
  const now = useRosterNow(pinnedNow);
  const shifts = useRosterShifts();
  const teams = useRosterTeams();
  const hasTeam = (Array.isArray(teams.data?.teams) ? teams.data.teams : []).some((team) => team.enabled);
  const links = useRosterLinks();
  const settings = useRosterSettings();
  const [importing, setImporting] = useState(false);
  const newButtonClearance = useRosterNewButtonClearance();
  const [addView, setAddView] = useState<RosterAddView | null>(null);
  // Once opened, the add sheet stays mounted, so its open and close behave exactly as before.
  const [addMounted, setAddMounted] = useState(false);
  if (addView !== null && !addMounted) setAddMounted(true);
  useEffect(preloadOnDemandParts, []);
  const [saved, setSaved] = useState<string | null>(null);
  const [refreshingLink, setRefreshingLink] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  // Opening Today refreshes any calendar link that is due (the server decides which). Once per visit, never retried.
  const refreshStarted = useRef(false);
  const { reload: reloadShifts } = shifts;
  const { reload: reloadLinks, refresh: refreshLink } = links;
  useEffect(() => {
    if (refreshStarted.current) return;
    refreshStarted.current = true;
    void refreshDueRosterLinks().then((results) => {
      if (!results || results.length === 0) return;
      void reloadLinks();
      if (results.some((result) => result.ok)) void reloadShifts();
    });
  }, [reloadLinks, reloadShifts]);

  async function refreshStaleLink(id: string) {
    setRefreshingLink(true);
    setRefreshWarning(null);
    const failure = await refreshLink(id);
    setRefreshingLink(false);
    if (failure) {
      setRefreshWarning(failure);
      return;
    }
    void reloadShifts();
    setSaved("Refreshed");
  }

  const today = zonedDateOf(now, zone);
  const byId = useMemo(() => new Map(shifts.shifts.map((shift) => [shift.id, shift])), [shifts.shifts]);
  // Each team's own rules judge its own shifts, the same cues the Shifts page shows. The default
  // shift read already reaches 21 days back, the longest any team rule looks.
  const rulesByTeam = useRosterTeamRules(shifts.shifts.flatMap((shift) => (shift.serviceId ? [shift.serviceId] : [])));
  const cues = useMemo(
    () => new Map(restCuesByTeam(shifts.shifts, rulesByTeam).map((cue) => [cue.shiftId, cue])),
    [shifts.shifts, rulesByTeam],
  );
  const summary = useMemo(
    () =>
      summariseToday(
        shifts.shifts.map((shift) => ({
          id: shift.id,
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          kind: kindOf(shift),
        })),
        now,
      ),
    [shifts.shifts, now],
  );
  // "Who can cover?" is offered for the next team shift still to start, never one already under
  // way, chosen on its own: the hero may be showing a shift on now or a personal shift.
  const actorId = teams.data?.actorId ?? null;
  const coverShift = useMemo(
    () =>
      shifts.shifts
        .filter(
          (shift) =>
            shift.serviceId &&
            shift.assignmentId &&
            kindOf(shift) !== "leave" &&
            Date.parse(shift.startsAt) > now.getTime(),
        )
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0],
    [shifts.shifts, now],
  );
  const workplaces = useMemo(
    () => [...new Set(shifts.shifts.flatMap((shift) => (shift.workplace ? [shift.workplace] : [])))],
    [shifts.shifts],
  );

  const leadIsNight =
    (summary.lead.state === "before" || summary.lead.state === "on_now") && summary.lead.shift.kind === "night"
      ? summary.lead.shift
      : summary.lead.state === "day_off" && summary.lead.next?.kind === "night"
        ? summary.lead.next
        : null;
  const nextNight = shifts.shifts
    .filter((shift) => kindOf(shift) === "night" && Date.parse(shift.startsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  const shownNextNight = nextNight && nextNight.id !== leadIsNight?.id ? nextNight : null;
  const canEdit = shifts.status === "ready" && !shifts.demoMode;
  // "What changed" after a re-imported roster: one line per change to a shift from today on.
  const importNotices = useMemo(
    () => (shifts.demoMode ? [] : importChangeNotices(shifts.latestImport, today)),
    [shifts.demoMode, shifts.latestImport, today],
  );
  const greeting = greetingFor(now);
  // Under the work-mode band the date and the greeting are the band's words (mockup `rost_today`).
  useModeBandHeading({ eyebrow: formatPerthDay(today), title: greeting.text });
  const fresh = hasFreshLink(links.links, now);
  const staleLink = staleRosterLink(links.links, now);

  const header = (
    <RosterPageHeader
      icon={greeting.icon}
      eyebrow={formatPerthDay(today)}
      title="Today"
      subtitle={
        <div className="grid gap-0.5">
          <WithoutModeBand>
            <span>{greeting.text}</span>
          </WithoutModeBand>
          <RosterFreshness
            fresh={fresh}
            staleLink={staleLink}
            refreshing={refreshingLink}
            onRefresh={(id) => void refreshStaleLink(id)}
          />
        </div>
      }
      actions={
        !importing && canEdit ? (
          <RosterNewButton
            entries={[
              { id: "shift", label: "Add a shift", icon: Plus, onSelect: () => setAddView("shift") },
              {
                id: "import",
                label: "Import a file",
                description: "PDF, Excel, CSV or calendar file",
                icon: FileUp,
                onSelect: () => setImporting(true),
              },
              { id: "link", label: "Add a calendar link", icon: Link2, onSelect: () => setAddView("link") },
              ...(hasTeam
                ? [
                    {
                      id: "swap",
                      label: "Swap or give away",
                      description: "Pick the shift on the Team calendar",
                      icon: ArrowLeftRight,
                      href: "/roster/team?view=week",
                    } as const,
                  ]
                : []),
              { id: "leave", label: "Plan leave", icon: Plane, href: "/roster/requests?start=leave" },
              { id: "dates", label: "Dates I can't work", icon: CalendarOff, href: "/roster/requests?start=dates" },
            ]}
          />
        ) : null
      }
      testId="roster-today-header"
    />
  );

  const ready =
    !importing && shifts.status !== "loading" && shifts.status !== "signed-out" && shifts.status !== "error";

  // Import flow, sign-in and error keep their own components (their wording differs from the shared states).
  let blocking: ReactNode = null;
  if (importing) {
    blocking = (
      <RosterImportFlow
        shifts={shifts}
        settings={settings}
        today={today}
        onClose={() => setImporting(false)}
        onSaved={() => {
          setImporting(false);
          setSaved("Saved");
        }}
      />
    );
  } else if (shifts.status === "signed-out") {
    blocking = <RosterSignInNotice testId="roster-today-signed-out">Sign in to see your roster.</RosterSignInNotice>;
  } else if (shifts.status === "error") {
    blocking = (
      <div className="grid gap-2" data-testid="roster-today-error">
        <ModeNotice tone="warning">Your shifts could not be loaded.</ModeNotice>
        <Button className="justify-self-start" onClick={() => void shifts.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  const changesNode =
    importNotices.length > 0 ? (
      <ModeGroupedList eyebrow="Needs you" mode="roster" testId="roster-today-changes">
        <RosterChangeRows
          notices={importNotices}
          onDismiss={() => void shifts.dismissChanges()}
          testId="roster-today-change"
        />
      </ModeGroupedList>
    ) : null;
  const coverNode =
    coverShift?.serviceId && coverShift.assignmentId && actorId ? (
      <ModeGroupedList testId="roster-today-cover">
        <RosterWhoCanCover
          serviceId={coverShift.serviceId}
          assignmentId={coverShift.assignmentId}
          actorId={actorId}
          startsAt={coverShift.startsAt}
        />
      </ModeGroupedList>
    ) : null;
  const teamNode = ready ? <RosterTodayTeam now={now} myShifts={shifts.shifts} /> : null;
  // The team strip may render nothing; wrapping it always is harmless because the slot is only a zero-height grid cell.
  const needsYouNode = ready ? (
    <>
      {changesNode}
      {coverNode}
      {teamNode}
    </>
  ) : null;

  const comingUp =
    ready && summary.lead.state !== "empty" ? (
      <>
        <RosterSection icon={CalendarDays} title="This week" id="roster-today-week">
          <div className="work-card px-2 py-3">
            <RosterWeekStrip week={summary.week} today={today} testId="roster-today-week-strip" />
          </div>
        </RosterSection>
        <RosterStats testId="roster-today-facts">
          {shownNextNight ? (
            <RosterStat
              icon={Moon}
              label="Next night"
              value={formatPerthDay(perthDateOf(shownNextNight.startsAt))}
              testId="roster-today-next-night"
            />
          ) : null}
          <RosterStat
            icon={MoonStar}
            label="Next nights"
            value={
              summary.nextNights ? (
                formatDateSpan(summary.nextNights.start, summary.nextNights.end)
              ) : (
                <NoneYet>None rostered</NoneYet>
              )
            }
          />
          <RosterStat
            icon={Plane}
            label="Next leave"
            value={
              summary.nextLeave ? (
                formatDateSpan(summary.nextLeave.start, summary.nextLeave.end)
              ) : (
                <NoneYet>None booked</NoneYet>
              )
            }
          />
        </RosterStats>
      </>
    ) : null;

  return (
    <InformationPageShell
      testId="roster-today-main"
      width="narrow"
      className={!importing && canEdit ? newButtonClearance : undefined}
    >
      <TodayShell
        mode="roster"
        modeName="Roster"
        status={
          <>
            {header}
            {ready && shifts.demoMode ? <ModeNotice>Example only. Sign in to add your own shifts.</ModeNotice> : null}
            {ready && saved ? <ModeNotice>{saved}</ModeNotice> : null}
            {ready && refreshWarning ? (
              <ModeNotice tone="warning" testId="roster-today-refresh-warning">
                {refreshWarning}
              </ModeNotice>
            ) : null}
            {ready && shifts.teamMessage ? <ModeNotice tone="warning">{shifts.teamMessage}</ModeNotice> : null}
          </>
        }
        now={
          ready ? (
            <Hero
              summary={summary}
              byId={byId}
              now={now}
              canEdit={canEdit}
              onImport={() => setImporting(true)}
              onAddShift={() => setAddView("shift")}
              cues={cues}
            />
          ) : null
        }
        nowSurface="own"
        needsYouNode={needsYouNode}
        comingUp={comingUp}
        state={!importing && shifts.status === "loading" ? { kind: "loading" } : null}
        loadingFallback={<ModeModuleSkeleton rows={4} testId="roster-today-loading" />}
        blocking={blocking}
      />

      <p className="px-1 pt-2 text-center text-xs text-[color:var(--text-muted)]">
        Your copy of the roster. Check official changes with your service.
      </p>

      {addMounted ? (
        <RosterAddSheet
          open={addView !== null}
          view={addView ?? "shift"}
          onViewChange={setAddView}
          onClose={() => setAddView(null)}
          today={today}
          workplaces={workplaces}
          onImportFile={() => {
            setAddView(null);
            setImporting(true);
          }}
          onAddShift={async (request) => {
            const failure = await shifts.addManual(request);
            if (!failure) {
              setAddView(null);
              setSaved("Saved");
            }
            return failure;
          }}
          onAddLink={async (url, workplace) => {
            const failure = await links.add(url, workplace);
            if (!failure) {
              void shifts.reload();
              setAddView(null);
              setSaved("Saved");
            }
            return failure;
          }}
        />
      ) : null}
    </InformationPageShell>
  );
}
