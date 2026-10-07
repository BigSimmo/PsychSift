"use client";

import { BookOpen, Check, Copy, ExternalLink, Phone } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { modeCallDiscShape, modeDot, modeTapArea } from "@/components/mode-kit/recipes";
import { modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { useOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import {
  onCallActionLink,
  onCallChipShape,
  onCallChipTap,
  onCallLeadingIcon,
  onCallOutlineButton,
  onCallOutlineDisc,
  onCallTrack,
} from "@/components/on-call/kit/calm";
import { OnCallDialSheet, onCallCallRoute } from "@/components/on-call/kit/dial-sheet";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { onCallLadderAnsweredMarkId, useOnCallCallMarks } from "@/components/on-call/now/needs-you";
import { OnCallCopyNumber } from "@/components/on-call/on-call-copy-number";
import { ON_CALL_SERVER_ANCHOR } from "@/components/on-call/on-call-dates";
import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { OnCallLoadFailed } from "@/components/on-call/on-call-load-failed";
import { OnCallToolNavHeader } from "@/components/on-call/on-call-nav-header";
import { OnCallOfflineBanner } from "@/components/on-call/on-call-offline-banner";
import { OnCallSignedOut } from "@/components/on-call/on-call-signed-out";
import { useHospitalHandbook, type HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { rememberOnCallYouCalled, type OnCallYouCalled } from "@/lib/on-call/call-marks";
import {
  onCallCallNowPeriod,
  onCallCallNowScenarios,
  onCallCallNowSteps,
  type OnCallCallNowStep,
} from "@/lib/on-call/call-now";
import { formatOnCallTime, onCallAgo } from "@/lib/on-call/display-dates";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { pinnedEmergencyEntries, type HandbookItem } from "@/lib/on-call/handbook-items";
import { ON_CALL_HOME_TAGS, onCallTelHref } from "@/lib/on-call/home-modules";
import {
  msUntilOnCallPeriodChange,
  resolveHandbookPhone,
  spokenOnCallNumber,
  type HandbookDial,
  type OnCallPeriod,
} from "@/lib/on-call/number-resolver";
import { ISOBAR_HEADINGS, ISOBAR_SOURCE } from "@/lib/on-call/isobar-source";
import { onCallHospitalPeriod, onCallLadderStepMarkId } from "@/lib/on-call/now-rows";
import { recordOnCallRecent } from "@/lib/on-call/recent-storage";
import { handbookLadders } from "@/lib/on-call/service-availability";

/**
 * ESCALATE (mock-up v10 s-13): the escalation ladder as a live step-by-step.
 *
 * Pick the situation, call the next rung, and see the hospital-set wait run.
 * The situations are the hospital's own published ladders, then the reader's
 * own Playbook ladders. The page shows routes, never decisions: every "when"
 * is the ladder's own text, unchanged, and no wait is shown unless the
 * hospital recorded one.
 *
 * A rung counts as called from the "You called" marks (an id and a time, kept
 * 12 hours on this phone), so a call made here also moves Now's "Needs you"
 * row on, and a call made from "Needs you" shows here.
 *
 * Steps for the other half of the day stay on the page under "At other times":
 * the rule for "now" can be wrong, and a hidden step would be a missed call.
 */

type EscalateLadder = {
  readonly id: string;
  readonly title: string;
  readonly source: "hospital" | "personal";
  /** Steps for this hour first, then the rest, each group in the ladder's own order. */
  readonly steps: readonly OnCallCallNowStep[];
  /** The period the steps were arranged for; null when the hospital has not set its times. */
  readonly period: OnCallPeriod | null;
  /** "Checked" only from a real confirmation date; otherwise the date it was last changed. */
  readonly age: { readonly word: "Checked" | "Updated"; readonly at: string } | null;
  readonly item?: HandbookItem;
  readonly href?: string;
};

function nowFirst(steps: readonly OnCallCallNowStep[]): OnCallCallNowStep[] {
  return [...steps.filter((step) => step.appliesNow), ...steps.filter((step) => !step.appliesNow)];
}

/** The rungs' marks for one ladder, by step order, newer than the reader's last "They answered" or Stop. */
function ladderMarks(
  ladder: EscalateLadder,
  marks: readonly OnCallYouCalled[],
  stoppedAt: number | undefined,
): Map<number, string> {
  const called = new Map<number, string>();
  for (const step of ladder.steps) {
    const id = onCallLadderStepMarkId(ladder.id, step.order);
    const mark = marks.find((candidate) => candidate.entryId === id);
    if (mark && (stoppedAt === undefined || Date.parse(mark.calledAt) > stoppedAt))
      called.set(step.order, mark.calledAt);
  }
  return called;
}

function minutesBetween(fromIso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 60_000));
}

export function OnCallCallNowPage({ now: nowProp }: { now?: Date } = {}) {
  const [mounted, setMounted] = useState(false);
  /** `?situation=<ladder id>` from Now's "Who do I call now?" chips; ignored when it matches nothing. */
  const [situation, setSituation] = useState<string | null>(null);
  useEffect(() => {
    // Read once the page is in the browser, so the server and first paint agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    try {
      setSituation(new URLSearchParams(window.location.search).get("situation"));
    } catch {
      setSituation(null);
    }
  }, []);

  const { entries, loading, isOffline, loadError, retry, cachedAt, signedOut } = useOnCallEntries();
  const handbook = useHospitalHandbook();
  const hospitalPhone = useOnCallHospitalPhone();
  const [clock, setClock] = useState<Date | null>(() => nowProp ?? null);
  const now = useMemo(
    () => nowProp ?? (mounted ? (clock ?? new Date()) : ON_CALL_SERVER_ANCHOR),
    [nowProp, mounted, clock],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A minute clock while the page is open, so the wait and "Next step" stay
  // true; it also crosses the in-hours boundary (holidays count).
  useEffect(() => {
    if (nowProp || !mounted) return;
    const delay = Math.min(60_000 - (now.getTime() % 60_000), msUntilOnCallPeriodChange(now));
    const timer = window.setTimeout(() => setClock(new Date()), delay);
    return () => window.clearTimeout(timer);
  }, [now, nowProp, mounted]);

  const marks = useOnCallCallMarks(now);
  const ready = handbook.status === "ready";
  const hospitalName = handbook.siteName ?? handbook.serviceName;
  const scenarios = useMemo(() => onCallCallNowScenarios(entries), [entries]);

  const ladders = useMemo<EscalateLadder[]>(() => {
    const hours = handbook.hours ?? null;
    const hospital: EscalateLadder[] = ready
      ? handbookLadders(handbook.items, hours, now).map((ladder) => {
          const item = handbook.items.find((candidate) => candidate.id === ladder.id);
          const confirmed = item?.lastConfirmedAt ?? null;
          return {
            id: ladder.id,
            title: ladder.title,
            source: "hospital",
            steps: nowFirst(ladder.steps),
            period: onCallHospitalPeriod(hours, now),
            age: confirmed
              ? { word: "Checked", at: confirmed }
              : item?.updatedAt
                ? { word: "Updated", at: item.updatedAt }
                : null,
            item,
          };
        })
      : [];
    const personal: EscalateLadder[] = scenarios.map((entry) => ({
      id: entry.id,
      title: entry.title,
      source: "personal",
      steps: onCallCallNowSteps(entry, now),
      period: onCallCallNowPeriod(now),
      age: entry.lastVerifiedAt ? { word: "Checked", at: entry.lastVerifiedAt } : null,
      href: onCallEntryHref(entry),
    }));
    return [...hospital, ...personal];
  }, [ready, handbook.items, handbook.hours, scenarios, now]);

  // With nothing picked: the situation Now linked to, then the ladder the
  // reader last called a rung of, then the hospital's first ladder, then the
  // reader's pinned scenario.
  const fallbackId = useMemo(() => {
    if (situation && ladders.some((ladder) => ladder.id === situation)) return situation;
    const newest = [...marks].sort((a, b) => b.calledAt.localeCompare(a.calledAt));
    for (const mark of newest) {
      const hit = ladders.find((ladder) =>
        ladder.steps.some((step) => onCallLadderStepMarkId(ladder.id, step.order) === mark.entryId),
      );
      if (hit) return hit.id;
    }
    const pinned = scenarios.find((entry) => entry.tags.includes(ON_CALL_HOME_TAGS.pinned));
    return ladders.find((ladder) => ladder.source === "hospital")?.id ?? pinned?.id ?? ladders[0]?.id ?? null;
  }, [situation, marks, ladders, scenarios]);
  const selected = ladders.find((ladder) => ladder.id === (selectedId ?? fallbackId)) ?? ladders[0] ?? null;
  // "They answered" and Stop leave Now's own `answered:<ladder>` mark, so Now's
  // Escalating card and this page close together; a later call starts afresh.
  const answeredAt = selected
    ? marks.find((mark) => mark.entryId === onCallLadderAnsweredMarkId(selected.id))?.calledAt
    : undefined;
  const called = selected
    ? ladderMarks(selected, marks, answeredAt ? Date.parse(answeredAt) : undefined)
    : new Map<number, string>();
  const pins = ready ? pinnedEmergencyEntries(handbook.items, handbook.siteId) : [];
  // The public crisis lines whenever the hospital's own emergency route is not on screen.
  const showCrisisLines = !ready || pins.length === 0;

  const header = <OnCallToolNavHeader title="Escalate" testIdPrefix="on-call-now" />;

  if (!nowProp && !mounted) {
    return (
      <>
        {header}
        <InformationPageShell testId="on-call-now-main" width="narrow">
          <p role="status">Loading current on-call context…</p>
          {/* Public lines do not depend on the historical hydration anchor. */}
          <OnCallCrisisLines />
        </InformationPageShell>
      </>
    );
  }

  const stillLoading = (loading && entries.length === 0) || handbook.status === "loading";
  let body: ReactNode;
  if (ladders.length === 0 && stillLoading) {
    body = (
      <OnCallEmptyState
        icon={Phone}
        title="Loading your ladders"
        body="Fetching the hospital's escalation steps and your own."
        testId="on-call-now-loading"
      />
    );
  } else if (ladders.length === 0 && isOffline && entries.length === 0) {
    body = <OnCallLoadFailed reason={loadError} onRetry={retry} />;
  } else if (ladders.length === 0 && signedOut && entries.length === 0) {
    body = <OnCallSignedOut icon={Phone} testId="on-call-now-signed-out" />;
  } else if (ladders.length === 0) {
    body = (
      <>
        <OnCallHandbookState handbook={handbook} page="now" />
        <OnCallEmptyState
          icon={Phone}
          title="No escalation steps yet"
          body="Your hospital has not published a ladder here. Add a scenario to your Playbook, with who to call and when, and it will appear here."
          actions={
            <Link
              href="/on-call/playbook"
              className="inline-flex min-h-tap items-center font-semibold text-[color:var(--mode-identity)]"
            >
              Open the Playbook
            </Link>
          }
          testId="on-call-now-empty"
        />
      </>
    );
  } else {
    body = (
      <>
        <div
          role="group"
          aria-label="Situations"
          data-no-tab-swipe
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1"
          data-testid="on-call-now-scenarios"
        >
          {ladders.map((ladder) => (
            <button
              key={ladder.id}
              type="button"
              aria-pressed={selected?.id === ladder.id}
              onClick={() => setSelectedId(ladder.id)}
              className={cn(onCallChipTap, focusRing, "shrink-0 rounded-md")}
            >
              <span className={cn(onCallChipShape, "whitespace-nowrap")}>{ladder.title}</span>
            </button>
          ))}
        </div>
        {handbook.status === "unavailable" ? (
          <p className={cn(modeSecondaryText, "px-1")} data-testid="on-call-now-hospital-failed">
            The hospital&apos;s ladders could not be loaded. Your own ladders are shown.
          </p>
        ) : null}
        {selected ? (
          <Ladder
            ladder={selected}
            called={called}
            now={now}
            live={!nowProp}
            pins={pins}
            handbookReady={ready}
            handbook={handbook}
            hospitalName={hospitalName}
            hospitalPhone={hospitalPhone}
            onStop={() =>
              // A pinned clock (a test, a print view) records on that moment; otherwise the real time.
              rememberOnCallYouCalled(onCallLadderAnsweredMarkId(selected.id), nowProp ?? new Date())
            }
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      {header}
      <InformationPageShell testId="on-call-now-main" width="narrow">
        <h1 className="sr-only">Escalate</h1>
        {isOffline && cachedAt ? <OnCallOfflineBanner savedAt={cachedAt} reason={loadError} /> : null}
        <div className="mt-2 grid min-w-0 gap-4">
          {body}
          {showCrisisLines ? <OnCallCrisisLines now={now} /> : null}
          {/* Only once the WA source is captured: until then People has nothing to show. */}
          {ISOBAR_SOURCE && ISOBAR_HEADINGS.length > 0 ? (
            <OnCallGroupedList testId="on-call-now-related">
              <OnCallRow
                title="Calling a consultant"
                subtitle="The handover headings · in People"
                leading={<BookOpen aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />}
                href="/on-call/call"
                testId="on-call-now-consultant-link"
              />
            </OnCallGroupedList>
          ) : null}
          {selected ? <SourceLine ladder={selected} hospitalName={hospitalName} /> : null}
        </div>
      </InformationPageShell>
    </>
  );
}

function SourceLine({ ladder, hospitalName }: { ladder: EscalateLadder; hospitalName: string | null }) {
  const sources = ladder.item?.sources ?? [];
  return (
    <p
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 px-1 text-xs text-[color:var(--text-muted)]"
      data-testid="on-call-now-source"
    >
      {ladder.source === "hospital" ? (
        <>
          <span>
            {hospitalName ? `Ladder from ${hospitalName}'s handbook` : "Ladder from your hospital's handbook"}
          </span>
          {sources.map((source) => (
            <span key={`${source.url}:${source.label}`} className="inline-flex min-w-0 items-center">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  focusRing,
                  "inline-flex min-h-12 items-center gap-1 rounded-sm text-[color:var(--mode-identity)]",
                )}
              >
                <ExternalLink aria-hidden="true" className="size-icon-xs shrink-0" />
                <span className="break-words">{source.label}</span>
              </a>
            </span>
          ))}
        </>
      ) : (
        <>
          <span>Ladder from your Playbook</span>
          {ladder.href ? (
            <>
              <span aria-hidden="true">·</span>
              <Link href={ladder.href} className={cn(onCallActionLink, focusRing, "text-xs")}>
                Open in the Playbook
              </Link>
            </>
          ) : null}
        </>
      )}
    </p>
  );
}

function periodWords(period: OnCallPeriod | null): string {
  if (period === "after-hours") return "After hours ladder";
  if (period === "in-hours") return "Working hours ladder";
  return "Ladder";
}

function Ladder({
  ladder,
  called,
  now,
  live,
  pins,
  handbookReady,
  handbook,
  hospitalName,
  hospitalPhone,
  onStop,
}: {
  ladder: EscalateLadder;
  called: ReadonlyMap<number, string>;
  now: Date;
  live: boolean;
  pins: readonly HandbookItem[];
  handbookReady: boolean;
  handbook: HospitalHandbookState;
  hospitalName: string | null;
  hospitalPhone: boolean;
  onStop: () => void;
}) {
  const nowSteps = ladder.steps.filter((step) => step.appliesNow);
  const laterSteps = ladder.steps.filter((step) => !step.appliesNow);
  // The rung rung last is the one the wait runs from.
  let current: OnCallCallNowStep | null = null;
  for (const step of ladder.steps) {
    const at = called.get(step.order);
    if (at && (!current || at > called.get(current.order)!)) current = step;
  }
  const position = (step: OnCallCallNowStep) => ladder.steps.indexOf(step) + 1;
  const rung = (step: OnCallCallNowStep, muted: boolean, last: boolean) => (
    <Rung
      key={`${step.order}-${step.whoToCall}`}
      ladder={ladder}
      step={step}
      position={position(step)}
      calledAt={called.get(step.order) ?? null}
      current={current === step}
      muted={muted}
      last={last}
      now={now}
      hospitalName={hospitalName}
      hospitalPhone={hospitalPhone}
    />
  );
  const startedAt = [...called.values()].sort()[0] ?? null;

  return (
    <section aria-labelledby="on-call-now-ladder-title" className="grid min-w-0 gap-2" data-testid="on-call-now-ladder">
      <h2 id="on-call-now-ladder-title" className="sr-only">
        {ladder.title}
      </h2>
      {current && startedAt ? (
        <RunPanel
          step={current}
          position={position(current)}
          calledAt={called.get(current.order)!}
          startedAt={startedAt}
          now={now}
          live={live}
          onStop={onStop}
        />
      ) : null}

      <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-3 px-1">
        <p className={eyebrowText} data-testid="on-call-now-period">
          {periodWords(ladder.period)}
        </p>
        {ladder.age ? (
          <p className="nums text-xs font-semibold text-[color:var(--text-muted)]" data-testid="on-call-now-age">
            {`${ladder.age.word} ${onCallAgo(ladder.age.at, now)}`}
          </p>
        ) : null}
      </div>

      {ladder.steps.length === 0 ? (
        <p className={cn(modeSecondaryText, "px-1")}>This ladder has no steps recorded yet.</p>
      ) : (
        <ol role="list" className="grid min-w-0" data-testid="on-call-now-steps">
          {nowSteps.map((step, index) => rung(step, false, index === nowSteps.length - 1 && !handbookReady))}
        </ol>
      )}

      {handbookReady ? (
        <ul role="list" className="grid min-w-0" data-testid="on-call-now-emergency-rungs">
          {pins.length > 0 ? (
            pins.map((item, index) => (
              <EmergencyRung
                key={item.id}
                item={item}
                last={index === pins.length - 1}
                now={now}
                hospitalName={hospitalName}
                hospitalPhone={hospitalPhone}
              />
            ))
          ) : (
            <RungFrame marker={<EmergencyMarker />} last testId="on-call-now-emergency-not-set-up">
              <p className="text-base-minus font-semibold text-[color:var(--text-heading)]">
                Emergency number not set up for this hospital
              </p>
              <p className={modeSecondaryText}>
                {handbook.services.find((service) => service.id === handbook.serviceId)?.role === "editor" ||
                handbook.services.find((service) => service.id === handbook.serviceId)?.role === "admin"
                  ? "Add it in Service. Until then, use your hospital's own emergency process."
                  : "Ask a service editor to add it. Until then, use your hospital's own emergency process."}
              </p>
            </RungFrame>
          )}
        </ul>
      ) : null}

      {laterSteps.length > 0 ? (
        <>
          <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-3 px-1">
            <h3 className={eyebrowText}>At other times</h3>
            <p className="text-xs text-[color:var(--text-muted)]">
              {ladder.source === "personal"
                ? "Working hours: Mon to Fri, 8 am to 5 pm, not a WA public holiday"
                : handbook.hours
                  ? `After hours here: ${handbook.hours.afterHoursFrom} to ${handbook.hours.afterHoursUntil}`
                  : null}
            </p>
          </div>
          <ol role="list" className="grid min-w-0" data-testid="on-call-now-other-steps">
            {laterSteps.map((step, index) => rung(step, true, index === laterSteps.length - 1))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

/** A timeline marker in the left column, and the rung's card beside it. */
function RungFrame({
  marker,
  last,
  emphasis = false,
  muted = false,
  testId,
  children,
}: {
  marker: ReactNode;
  last: boolean;
  emphasis?: boolean;
  muted?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <li className="relative flex min-w-0 gap-3 pb-3" data-testid={testId}>
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[1.125rem] top-10 w-px bg-[color:var(--border-strong)] forced-colors:bg-[CanvasText]"
        />
      )}
      <span className="flex w-9 shrink-0 justify-center pt-2">{marker}</span>
      <div
        className={cn(
          "grid min-w-0 flex-1 gap-1 rounded-lg border bg-[color:var(--surface-raised)] py-2.5 pl-3 pr-1.5 forced-colors:border",
          emphasis ? "border-2 border-[color:var(--text-heading)]" : "border-[color:var(--border)]",
          muted && "opacity-80",
        )}
      >
        {children}
      </div>
    </li>
  );
}

function EmergencyMarker() {
  return (
    <span
      aria-hidden="true"
      className="grid size-9 place-items-center rounded-full border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-sm font-semibold text-[color:var(--danger)] forced-colors:border"
    >
      !
    </span>
  );
}

function StepMarker({ position, done, current }: { position: number; done: boolean; current: boolean }) {
  if (done && !current) {
    return (
      <span aria-hidden="true" className={cn(onCallOutlineDisc, "text-[color:var(--text-muted)]")}>
        <Check aria-hidden="true" strokeWidth={1.75} className="size-icon-sm" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "nums grid size-9 place-items-center rounded-full text-sm font-semibold forced-colors:border",
        current
          ? "border-2 border-[color:var(--text-heading)] bg-[color:var(--surface-raised)] text-[color:var(--text-heading)]"
          : "border border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]",
      )}
    >
      {position}
    </span>
  );
}

function Rung({
  ladder,
  step,
  position,
  calledAt,
  current,
  muted,
  last,
  now,
  hospitalName,
  hospitalPhone,
}: {
  ladder: EscalateLadder;
  step: OnCallCallNowStep;
  position: number;
  calledAt: string | null;
  current: boolean;
  muted: boolean;
  last: boolean;
  now: Date;
  hospitalName: string | null;
  hospitalPhone: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const markId = onCallLadderStepMarkId(ladder.id, step.order);
  const mark = () => rememberOnCallYouCalled(markId);
  const hospital = ladder.source === "hospital";
  // Hospital numbers resolve as every hospital row does; the reader's own keep `onCallTelHref` (plan ruling).
  const dial: HandbookDial | null = hospital && step.phone ? resolveHandbookPhone(step.phone) : null;
  const usableDial = dial && dial.kind !== "none" ? dial : null;
  const route = usableDial ? onCallCallRoute(usableDial, null, hospitalPhone) : null;
  const tel = hospital ? (route?.tel ?? null) : step.phone ? onCallTelHref(step.phone) : null;
  const display = usableDial?.display ?? step.phone ?? "";
  const hoursWord = step.hours === "any" ? null : step.hours === "after-hours" ? "After hours" : "Working hours";
  const waitLeft =
    current && calledAt && step.waitMinutes ? step.waitMinutes - minutesBetween(calledAt, now.getTime()) : null;

  return (
    <RungFrame
      marker={<StepMarker position={position} done={calledAt !== null} current={current} />}
      last={last}
      emphasis={current}
      muted={muted && calledAt === null}
      testId="on-call-now-step"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="break-words text-base-minus font-semibold leading-5 text-[color:var(--text-heading)]">
            <span className="sr-only">{`Step ${position}: `}</span>
            {step.whoToCall}
          </p>
          {calledAt ? (
            <p className={cn(modeSecondaryText, modeNumberText)} data-testid="on-call-now-step-called">
              {step.phone
                ? `${display} · called ${formatOnCallTime(calledAt)}`
                : `${formatOnCallTime(calledAt)} · done`}
            </p>
          ) : step.phone && !tel ? (
            <p className={cn(modeSecondaryText, modeNumberText)}>{display}</p>
          ) : null}
          <p className={cn(modeSecondaryText, "break-words")}>
            {step.when}
            {hoursWord ? ` · ${hoursWord}` : ""}
          </p>
          {step.waitMinutes && !current ? (
            <p className={cn(modeSecondaryText, "nums")}>{`Hospital-set wait · ${step.waitMinutes} min`}</p>
          ) : null}
        </div>
        <span className="flex shrink-0 items-center">
          {tel ? (
            <a
              href={tel}
              onClick={mark}
              aria-label={`Call ${step.whoToCall}, ${spokenOnCallNumber(display)}`}
              data-testid="on-call-now-call"
              className={cn(modeTapArea, focusRing, "rounded-full")}
            >
              <span aria-hidden="true" className={onCallOutlineDisc}>
                <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
              </span>
            </a>
          ) : usableDial ? (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`Copy ${step.whoToCall}, ${usableDial.display}`}
              onClick={() => setSheetOpen(true)}
              className={cn(modeTapArea, focusRing, "rounded-full")}
            >
              <span aria-hidden="true" className={onCallOutlineDisc}>
                <Copy aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
              </span>
            </button>
          ) : step.phone ? (
            <OnCallCopyNumber value={step.phone} label={step.whoToCall} />
          ) : null}
          {!tel && calledAt === null ? (
            <button
              type="button"
              onClick={mark}
              aria-label={`Mark ${step.whoToCall} as ${step.phone ? "called" : "done"} now`}
              data-testid="on-call-now-step-mark"
              className={cn(modeTapArea, focusRing, "rounded-full")}
            >
              <span aria-hidden="true" className={onCallOutlineDisc}>
                <Check aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
              </span>
            </button>
          ) : null}
        </span>
      </div>
      {waitLeft !== null && step.waitMinutes ? <WaitBar left={waitLeft} wait={step.waitMinutes} /> : null}
      {usableDial && !tel ? (
        <OnCallDialSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={step.whoToCall}
          hospitalName={hospitalName}
          dial={usableDial}
          updatedAt={ladder.item?.updatedAt}
          sources={ladder.item?.sources}
          lastConfirmedAt={ladder.item?.lastConfirmedAt}
          now={now}
          onCall={mark}
          hospitalPhone={hospitalPhone}
          testId={`on-call-now-step-sheet-${step.order}`}
        />
      ) : null}
    </RungFrame>
  );
}

/** "Hospital-set wait ▬ 9 min left": the hospital's own wait, never one of ours. */
function WaitBar({ left, wait }: { left: number; wait: number }) {
  const shown = Math.max(0, left);
  const fill = Math.round((shown / wait) * 100);
  return (
    <div className="flex min-w-0 items-center gap-2 pr-1.5" data-testid="on-call-now-wait">
      <span className="shrink-0 text-sm font-semibold text-[color:var(--text-heading)]">Hospital-set wait</span>
      <span aria-hidden="true" className={cn(onCallTrack, "min-w-8 flex-1")}>
        {/* SVG width rather than an inline style: the bar's length is data, not a token. */}
        <svg className="block h-full w-full" preserveAspectRatio="none">
          <rect x="0" y="0" width={`${fill}%`} height="100%" className="fill-[color:var(--mode-identity)]" />
        </svg>
      </span>
      <span className="nums shrink-0 text-sm font-semibold text-[color:var(--text-heading)]">
        {left > 0 ? `${shown} min left` : "Wait has passed"}
      </span>
    </div>
  );
}

function EmergencyRung({
  item,
  last,
  now,
  hospitalName,
  hospitalPhone,
}: {
  item: HandbookItem;
  last: boolean;
  now: Date;
  hospitalName: string | null;
  hospitalPhone: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const dial = item.dial.kind === "none" ? null : item.dial;
  const route = dial ? onCallCallRoute(dial, item.mobileDial, hospitalPhone) : null;
  const title = item.parsed.label;
  const recordCall = () => {
    recordOnCallRecent({ id: item.id, source: "handbook" });
    rememberOnCallYouCalled(item.id);
  };
  return (
    <RungFrame marker={<EmergencyMarker />} last={last} testId={`on-call-now-emergency-${item.id}`}>
      <div className="flex min-w-0 items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              data-testid={`on-call-now-emergency-${item.id}-dot`}
              className={cn(modeDot, "bg-[color:var(--danger)]")}
            />
            <span className="break-words text-base-minus font-semibold leading-5 text-[color:var(--text-heading)]">
              {title}
            </span>
          </p>
          {dial ? <p className={cn(modeSecondaryText, modeNumberText)}>{dial.display}</p> : null}
          <p className={modeSecondaryText}>At any step, if calling criteria are met</p>
        </div>
        <span className="flex shrink-0 items-center">
          {route?.tel ? (
            <a
              href={route.tel}
              onClick={recordCall}
              aria-label={`Call ${title}, emergency, ${spokenOnCallNumber(route.display)}`}
              data-testid="on-call-now-emergency-call"
              className={cn(modeTapArea, focusRing, "rounded-full")}
            >
              <span aria-hidden="true" className={modeCallDiscShape.emergency}>
                <Phone aria-hidden="true" strokeWidth={1.5} className="size-icon-md" />
              </span>
            </a>
          ) : dial ? (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`Dial ${dial.display} from a ward phone. Dialling details for ${title}`}
              onClick={() => setSheetOpen(true)}
              className={cn(modeTapArea, focusRing, "rounded-full")}
            >
              <span aria-hidden="true" className={modeCallDiscShape.emergency}>
                <Copy aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
              </span>
            </button>
          ) : null}
        </span>
      </div>
      <p className={modeSecondaryText} data-testid="on-call-now-criteria">
        Calling criteria: the hospital&apos;s existing guidance, shown unchanged
      </p>
      {dial ? (
        <OnCallDialSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={title}
          hospitalName={hospitalName}
          dial={dial}
          mobileDial={item.mobileDial}
          updatedAt={item.updatedAt}
          sources={item.sources}
          lastConfirmedAt={item.lastConfirmedAt}
          now={now}
          onCall={recordCall}
          hospitalPhone={hospitalPhone}
          testId={`on-call-now-emergency-${item.id}-sheet`}
        />
      ) : null}
    </RungFrame>
  );
}

/**
 * The live panel, once a rung is marked called: when the run started, which
 * step was called last, and, only when the hospital recorded a wait for that
 * step, when the next step is suggested and how many minutes are left. It adds
 * no wait of its own and no advice.
 */
function RunPanel({
  step,
  position,
  calledAt,
  startedAt,
  now: pageNow,
  live,
  onStop,
}: {
  step: OnCallCallNowStep;
  position: number;
  calledAt: string;
  startedAt: string;
  now: Date;
  live: boolean;
  onStop: () => void;
}) {
  // A 30-second clock while the panel shows, so "min left" stays true between page ticks.
  const [tick, setTick] = useState<Date | null>(null);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setTick(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [live]);
  const now = live && tick && tick > pageNow ? tick : pageNow;
  const elapsed = minutesBetween(calledAt, now.getTime());
  const wait = step.waitMinutes ?? null;
  const left = wait === null ? null : wait - elapsed;
  const nextAt = wait === null ? null : formatOnCallTime(Date.parse(calledAt) + wait * 60_000);

  return (
    <section aria-label="This escalation" className="grid min-w-0 gap-3 pb-1" data-testid="on-call-now-ladder-run">
      <div className="flex min-w-0 items-center gap-3">
        <MinutesRing left={left} wait={wait} elapsed={elapsed} />
        <div className="grid min-w-0 gap-0.5">
          <p className={cn(eyebrowText, "nums")}>{`Started ${formatOnCallTime(startedAt)}`}</p>
          <p className="break-words text-lg-minus font-semibold leading-6 text-[color:var(--text-heading)]">
            {`Step ${position}: ${step.whoToCall} ${step.phone ? "called" : "done"}`}
          </p>
          <span className="sr-only" aria-live="polite">
            {`Step ${position}: ${step.whoToCall} ${step.phone ? "called" : "done"}`}
          </span>
          {nextAt ? (
            <p className={cn(modeSecondaryText, "nums")} data-testid="on-call-now-next-at">
              {`Next step suggested at ${nextAt}`}
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-[color:var(--text)]">You can call any step, or the emergency team, at any time.</p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStop}
          className={cn(onCallOutlineButton, focusRing, "min-w-40")}
          data-testid="on-call-now-ladder-answered"
        >
          They answered
        </button>
        <button
          type="button"
          onClick={onStop}
          className={cn(onCallActionLink, focusRing, "px-4 text-base-minus")}
          data-testid="on-call-now-ladder-stop"
        >
          Stop
        </button>
      </div>
    </section>
  );
}

/** The minutes ring: minutes left of the hospital's wait, or, with no wait recorded, minutes since the call. */
function MinutesRing({ left, wait, elapsed }: { left: number | null; wait: number | null; elapsed: number }) {
  const r = 26;
  const circumference = 2 * Math.PI * r;
  const shown = left === null ? elapsed : Math.max(0, left);
  const fraction = left === null || wait === null ? 0 : Math.max(0, Math.min(1, left / wait));
  return (
    <span className="relative grid size-16 shrink-0 place-items-center" data-testid="on-call-now-ring">
      <svg aria-hidden="true" viewBox="0 0 64 64" className="absolute inset-0 size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} strokeWidth="4" fill="none" className="stroke-[color:var(--surface-wash)]" />
        {fraction > 0 ? (
          <circle
            cx="32"
            cy="32"
            r={r}
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference * fraction} ${circumference}`}
            className="stroke-[color:var(--mode-identity)]"
          />
        ) : null}
      </svg>
      <span className="relative grid justify-items-center leading-none">
        <span className="nums text-lg-minus font-semibold text-[color:var(--text-heading)]">{shown}</span>
        <span className="text-2xs text-[color:var(--text-muted)]">{left === null ? "min ago" : "min left"}</span>
      </span>
    </span>
  );
}
