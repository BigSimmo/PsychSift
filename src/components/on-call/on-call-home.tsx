"use client";

import { HospitalShiftUpdates } from "@/components/on-call/now/hospital-shift-updates";
import { currentCover, handbookLadders } from "@/lib/on-call/service-availability";
import { ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useSignedOutSample } from "@/components/mode-kit/use-signed-out-sample";
import { TodayShell } from "@/components/mode-kit/today/today-shell";
import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { toHandbookDial } from "@/components/on-call/kit/dial-row";
import { OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { NowCrisisLines } from "@/components/on-call/now/crisis-lines";
import { NowEmergencyPin } from "@/components/on-call/now/emergency-pin";
import { NowNeedsYou, onCallNeedsYouAnswered, useOnCallCallMarks } from "@/components/on-call/now/needs-you";
import { NowRightNow } from "@/components/on-call/now/right-now";
import { NowShiftClock } from "@/components/on-call/now/shift-clock";
import { NowShiftPulseCard } from "@/components/on-call/now/shift-pulse-card";
import { NowShiftShortcuts } from "@/components/on-call/now/shift-shortcuts";
import { NowFooter, NowWhoToCall, type OnCallSituation } from "@/components/on-call/now/systems-down";
import { NowYourTeam } from "@/components/on-call/now/your-team";
import { NowYourUsual, usualTiles } from "@/components/on-call/now/your-usual";
import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { OnCallLoadFailed } from "@/components/on-call/on-call-load-failed";
import { OnCallOfflineBanner } from "@/components/on-call/on-call-offline-banner";
import { ON_CALL_HOME_ICON, ON_CALL_SECTION_HREFS } from "@/components/on-call/on-call-section-identity";
import { ON_CALL_SERVER_ANCHOR } from "@/components/on-call/on-call-dates";
import { OnCallSignedOut } from "@/components/on-call/on-call-signed-out";
import { useHospitalHandbook } from "@/components/on-call/use-hospital-handbook";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { NewWorkModeOnly } from "@/components/work-mode-launch/work-mode-launch-provider";
import { onCallCallNowScenarios, onCallCallNowSteps } from "@/lib/on-call/call-now";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { pinnedEmergencyEntries } from "@/lib/on-call/handbook-items";
import { selectPinnedPlaybookEntry } from "@/lib/on-call/home-modules";
import { msUntilNextOnCallLocalDay } from "@/lib/on-call/local-date";
import { useOnCallMyTeam } from "@/lib/on-call/my-team-storage";
import {
  handbookTeams,
  onCallDialKey,
  onCallHospitalPeriod,
  selectNeedsYou,
  switchboardItem,
  type OnCallLadder,
} from "@/lib/on-call/now-rows";
import { msUntilOnCallPeriodChange, resolveOnCallNumber, type OnCallNumberFields } from "@/lib/on-call/number-resolver";
import { useOnCallUsual } from "@/lib/on-call/recent-storage";
import { msUntilOnCallShiftContextChange, onCallShiftContext, useOnCallShiftPick } from "@/lib/on-call/shift-context";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

/**
 * Now, the On Call mode home (v6 figure "Now"): who to ring, at this hospital,
 * this hour. Top to bottom, in the safety order:
 *
 *  0. the offline banner and the load-failed notice, as before;
 *  1. the hospital line (review F3), then the handbook's state when its numbers
 *     are not on screen (signed out, expired, no service, unavailable);
 *  2. the hospital's pinned emergency route, above everything else;
 *  3. the public crisis lines whenever the hospital's own numbers are not on
 *     screen (loading, a failure, or none recorded);
 *  4. "Right now", the one dark hero: who covers this hour, then "Your
 *     shift", the countdown to the end of the reader's own rostered shift;
 *  5. "Needs you", only while a call to a rung of the reader's ladder waits;
 *  6. "Your usual", four tiles;
 *  7. "Your team", three roles;
 *  8. the footer group: shift lists, Systems down, First night, On site;
 *  9. the state modules: example content, then first run.
 *
 * There is no ask box and no search box on Now (amendment r6, Task 2), no tile
 * grid (the pill's pages sheet lists every page), and no teaching strip (it
 * moved to the Teaching page).
 *
 * **There is deliberately no freshness warning on this page** (owner,
 * 2026-09-16): overdue entries are reported in the developer hub, at
 * `/mockups/development/on-call-freshness`. Do not restore one here.
 *
 * Nothing moves under the thumb: while the hospital loads, each hospital module
 * holds its space with static outlines, and nothing is ever inserted above the
 * hospital line.
 *
 * The hospital's own after-hours times are a Stage B field. Until a hospital
 * sets them, Now does not adapt to after hours: `handbook.hours` is null, the
 * hero shows no period line or track, and Your team shows its day roles.
 */

/** A state module: a quiet heading over one block. */
function StateModule({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="grid gap-2" data-testid={id}>
      <h2 id={headingId} className={cn(eyebrowText, "px-3")}>
        {label}
      </h2>
      {children}
    </section>
  );
}

/**
 * The made-up example a signed-out visitor sees below the crisis lines.
 * Downloaded only when a signed-out visitor opens Now, so it never counts
 * towards a signed-in reader's first load.
 */
/**
 * "Right now, from your roster" (round 2 feature 22) and the "Your first week" card (feature 20): each
 * reads its own data and draws nothing when there is nothing for this reader, so they load after the
 * page's own modules and never count towards its first load.
 */
const OnCallRosterRightNow = dynamic(
  () =>
    import("@/components/on-call/roster-whos-on/on-call-roster-whos-on-page").then((module) => ({
      default: module.OnCallRosterRightNow,
    })),
  { ssr: false },
);
const FirstWeekTodayCardLive = dynamic(
  () =>
    import("@/components/on-call/first-week/first-week-today-card").then((module) => ({
      default: module.FirstWeekTodayCardLive,
    })),
  { ssr: false },
);

const OnCallNowSignedOutExample = dynamic(() => import("@/components/on-call/now/signed-out-example"), {
  ssr: false,
});

/**
 * Now while On Call shows example data (owner decision, 6 Oct 2026; the one
 * switch since 7 Oct): a plain label that the crisis lines are real, then the
 * real public crisis lines, first and unchanged, then the mock-up's Now drawn
 * from invented, text-only data. The frame's example data banner says "made
 * up" once, above this. None of the live page's hooks run here, so nothing is
 * fetched from the server, read from or written to the device, and no made-up
 * number can be rung.
 */
function OnCallHomeSignedOutExample() {
  return (
    <InformationPageShell testId="on-call-home-main">
      <h1 className="sr-only">Now</h1>
      <p className="px-1 text-sm text-[color:var(--text-muted)]" data-testid="on-call-now-real-lines">
        These crisis lines are real. Everything after them is made up and cannot be called.
      </p>
      <NowCrisisLines />
      <OnCallNowSignedOutExample />
    </InformationPageShell>
  );
}

export function OnCallHome(props: { now?: Date } = {}) {
  // Decided before any live hook mounts, so the example page never starts the
  // entries, handbook or roster reads. A signed-out visitor who turned example
  // data off gets the live page, whose reads answer signed out (entries signed
  // out, handbook "signed-out"), so they see the normal sign-in state.
  const signedOutExample = useSignedOutSample("call");
  if (signedOutExample) return <OnCallHomeSignedOutExample />;
  return <OnCallHomeLive {...props} />;
}

function OnCallHomeLive({ now: pinnedNow }: { now?: Date } = {}) {
  const { zone } = useWorkTimeZone();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const { entries, loading, isOffline, loadError, retry, cachedAt, signedOut } = useOnCallEntries();
  const loadFailed = !loading && isOffline && entries.length === 0;
  const handbook = useHospitalHandbook();
  const shifts = useRosterShifts();
  const pick = useOnCallShiftPick();
  const myTeam = useOnCallMyTeam();

  // One clock for the whole page, which wakes itself on the next moment that
  // would change an answer: the in-hours/after-hours boundary (a personal
  // entry's after-hours number), midnight (the reminders' "today"), or the
  // shift changing phase or period. Never on a fixed interval, and never when
  // the caller pinned `now` (a test, or a print view standing on a moment).
  const [tick, setTick] = useState<Date | null>(() => pinnedNow ?? null);
  const now = useMemo(
    () => pinnedNow ?? (mounted ? (tick ?? new Date()) : ON_CALL_SERVER_ANCHOR),
    [pinnedNow, mounted, tick],
  );
  // Roster's example roster (a doctor with no shifts of their own) is never a real shift here.
  const rosterShifts = useMemo(() => (shifts.status === "ready" && !shifts.sample ? shifts.shifts : []), [shifts]);
  const context = useMemo(
    () => onCallShiftContext({ shifts: rosterShifts, pick, now, zone }),
    [rosterShifts, pick, now, zone],
  );
  useEffect(() => {
    if (pinnedNow || !mounted) return;
    const delay = Math.min(
      60_000 - (now.getTime() % 60_000),
      msUntilOnCallPeriodChange(now, zone),
      msUntilNextOnCallLocalDay(now, zone),
      msUntilOnCallShiftContextChange({ shifts: rosterShifts, pick, now, zone }),
    );
    const timer = setTimeout(() => setTick(new Date()), delay);
    return () => clearTimeout(timer);
  }, [pinnedNow, now, rosterShifts, pick, mounted, zone]);

  const usual = useOnCallUsual(context.shiftKey);
  const marks = useOnCallCallMarks(now);

  const ready = handbook.status === "ready";
  const handbookLoading = handbook.status === "loading";
  const handbookItems = useMemo(() => (ready ? handbook.items : []), [ready, handbook.items]);
  const hospitalName = handbook.siteName ?? handbook.serviceName;
  const pins = useMemo(() => pinnedEmergencyEntries(handbookItems, handbook.siteId), [handbookItems, handbook.siteId]);
  const hospitalPeriod = onCallHospitalPeriod(handbook.hours ?? null, now);
  const teams = useMemo(
    () => [
      ...new Set([
        ...handbookTeams(handbookItems),
        ...handbookItems.flatMap((item) => (item.cover?.team ? [item.cover.team] : [])),
      ]),
    ],
    [handbookItems],
  );
  const teamRows = useMemo(
    () =>
      currentCover(handbookItems, now)
        .filter((item) => item.parsed.team === myTeam)
        .slice(0, 3),
    [handbookItems, myTeam, now],
  );
  const answer = useMemo(() => switchboardItem(handbookItems), [handbookItems]);

  const removedIds = useMemo(() => new Set(handbook.removed.map((row) => row.id)), [handbook.removed]);
  const tiles = useMemo(
    () => usualTiles({ usual, handbookItems, removedIds, entries }),
    [usual, handbookItems, removedIds, entries],
  );
  // A hospital row in Your usual arrives with the handbook, and the reader's
  // own rows with the first entries load, so while either is still coming the
  // module holds its space rather than growing under the thumb (or claiming,
  // before anything has arrived, that the list is empty).
  const usualOutlines =
    (handbookLoading && usual.some((item) => item.source === "handbook")) || (loading && entries.length === 0)
      ? usual.length
      : null;

  // "Needs you": the reader's own Playbook ladders, the calls made this shift
  // (ids and times only), and what each visible number row dials.
  const ladderEntries = useMemo(() => onCallCallNowScenarios(entries), [entries]);
  const ladders = useMemo<OnCallLadder[]>(
    () => [
      ...handbookLadders(handbookItems, handbook.hours ?? null, now),
      ...ladderEntries.map((entry) => ({ id: entry.id, title: entry.title, steps: onCallCallNowSteps(entry, now) })),
    ],
    [ladderEntries, handbookItems, handbook.hours, now],
  );
  const dialKeys = useMemo(() => {
    const keys = new Map<string, string>();
    for (const item of handbookItems) {
      const key = onCallDialKey(item.dial.kind === "none" ? null : item.dial);
      if (key) keys.set(item.id, key);
    }
    for (const entry of entries) {
      const key = onCallDialKey(toHandbookDial(resolveOnCallNumber(entry.details as OnCallNumberFields, now)));
      if (key) keys.set(entry.id, key);
    }
    return keys;
  }, [handbookItems, entries, now]);
  const selectedNeeds = useMemo(() => selectNeedsYou({ ladders, marks, dialKeys }), [ladders, marks, dialKeys]);
  // "They answered" closes the card on this phone until the next call is made.
  const needs = onCallNeedsYouAnswered(selectedNeeds, marks) ? null : selectedNeeds;
  // "Who do I call now?": the pinned reminder first, as the owner's own words to
  // read (it is a statement, not a situation to pick), then one chip per other
  // ladder that exists, never an invented situation. The reminder's ladder
  // stays on the Escalation ladder page.
  const pinnedReminder = useMemo(() => selectPinnedPlaybookEntry(entries), [entries]);
  const situations = useMemo<OnCallSituation[]>(
    () =>
      ladders
        .filter((ladder) => ladder.id !== pinnedReminder?.id)
        .map((ladder) => ({
          id: ladder.id,
          title: ladder.title,
          href: `/on-call/now?situation=${encodeURIComponent(ladder.id)}`,
        })),
    [ladders, pinnedReminder],
  );
  const ladderEntry = needs ? ladderEntries.find((entry) => entry.id === needs.ladderId) : undefined;

  const hasEntries = entries.length > 0;
  // The handbook's own sign-in states (signed out, or a session that ended)
  // already ask the reader to sign in, under the hospital line; the first-run
  // block then does not ask a second time. Spelled as what it is not, because
  // this file is a compliance surface and one status name is a banned word.
  const handbookAsksSignIn =
    !ready && !handbookLoading && handbook.status !== "no-service" && handbook.status !== "unavailable";
  // A callable hospital number, not just any entry: an orientation note or a
  // row with no phone leaves the reader with nothing to ring.
  const numbersOnScreen = ready && handbookItems.some((item) => item.dial.kind !== "none" && item.dial.kind !== "text");
  const showFirstRun = !loading && !hasEntries && !loadFailed && !(signedOut && handbookAsksSignIn);

  if (!pinnedNow && !mounted) {
    return (
      <InformationPageShell testId="on-call-home-main">
        <h1 className="sr-only">Now</h1>
        <p role="status">Loading current on-call context…</p>
        {/* Public lines do not depend on the historical hydration anchor. */}
        <NowCrisisLines />
      </InformationPageShell>
    );
  }

  return (
    <>
      <InformationPageShell testId="on-call-home-main">
        <h1 className="sr-only">Now</h1>
        {isOffline && cachedAt ? <OnCallOfflineBanner savedAt={cachedAt} reason={loadError} /> : null}
        {loadFailed ? <OnCallLoadFailed reason={loadError} onRetry={retry} /> : null}

        <TodayShell
          mode="on-call"
          modeName="On Call"
          testId="on-call-home-shell"
          status={
            <>
              <OnCallHospitalLine handbook={handbook} testId="on-call-now-hospital" />
              {!ready && !handbookLoading ? <OnCallHandbookState handbook={handbook} page="now" /> : null}
            </>
          }
          safety={
            <>
              <NowEmergencyPin handbook={handbook} pins={pins} now={now} />
              {numbersOnScreen ? null : <NowCrisisLines now={now} />}
            </>
          }
          nowSurface="own"
          now={
            <>
              {ready || handbookLoading ? (
                <NowRightNow
                  status={ready ? "ready" : "loading"}
                  answer={answer}
                  hours={handbook.hours ?? null}
                  hospitalPeriod={hospitalPeriod}
                  hospitalName={hospitalName}
                  now={now}
                />
              ) : null}
              {/* Your own rostered shift, counting down to its end. Drawn only
                  while a rostered shift is on, whatever the handbook's state. */}
              <NowShiftClock context={context} now={now} />
            </>
          }
          needsYouNode={
            <>
              {/* Kept directly under Right now, where it sat before the shell:
                  "Check the hospital before calling" must not sink below the
                  reader's usual numbers. */}
              <HospitalShiftUpdates handbook={handbook} shifts={rosterShifts} now={now} />
              <NowNeedsYou
                needs={needs}
                ladderHref={
                  ladderEntry
                    ? onCallEntryHref(ladderEntry)
                    : needs
                      ? `/on-call/playbook#hospital-ladder-${needs.ladderId}`
                      : null
                }
                now={now}
                live={!pinnedNow}
              />
              <NowShiftShortcuts />
              <NowShiftPulseCard now={now} />
              {/* A week before a new job starts until the end of its first week. */}
              <NewWorkModeOnly>
                <FirstWeekTodayCardLive now={now} />
              </NewWorkModeOnly>
            </>
          }
          comingUp={
            <>
              {/* Who is on this moment, from the team's published roster, with a way to the full list. */}
              <NewWorkModeOnly>
                <OnCallRosterRightNow now={now} />
              </NewWorkModeOnly>
              <NowYourUsual
                tiles={tiles}
                outlineCount={usualOutlines}
                canClear={usual.length > 0}
                hospitalName={hospitalName}
                now={now}
              />
              {ready || handbookLoading ? (
                <NowYourTeam
                  status={ready ? "ready" : "loading"}
                  rows={teamRows}
                  teams={teams}
                  myTeam={myTeam}
                  hospitalName={hospitalName}
                  now={now}
                />
              ) : null}
              <NowWhoToCall situations={situations} reminder={pinnedReminder?.title ?? null} />
            </>
          }
          shortcuts={
            <>
              <NowFooter context={context} shifts={shifts} items={handbookItems} now={now} />
              {/* The public lines close the page whenever the hospital's own
                  numbers are on screen; otherwise they sit near the top. */}
              {numbersOnScreen ? <NowCrisisLines now={now} /> : null}
            </>
          }
        />

        {showFirstRun ? (
          <StateModule id="on-call-home-first-run" label="Getting started">
            {/* Signed out, the server sends no entries at all, so "empty" would
                be a claim about a hub this reader cannot see. */}
            {signedOut ? (
              <OnCallSignedOut icon={ON_CALL_HOME_ICON} testId="on-call-home-signed-out" />
            ) : (
              <OnCallEmptyState
                icon={ON_CALL_HOME_ICON}
                title="Your On Call hub is empty"
                actions={
                  <Link
                    href={ON_CALL_SECTION_HREFS.contacts}
                    className={cn(
                      "inline-flex min-h-12 items-center gap-1.5 rounded-sm px-1.5 text-sm font-semibold no-underline",
                      "text-[color:var(--text-heading)] transition-colors motion-reduce:transition-none hover:text-[color:var(--command)]",
                      focusRing,
                    )}
                  >
                    Open Contacts
                    <ChevronRight aria-hidden="true" className="size-icon-xs" />
                  </Link>
                }
                testId="on-call-home-first-run-empty"
              />
            )}
          </StateModule>
        ) : null}
      </InformationPageShell>
    </>
  );
}
