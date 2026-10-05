"use client";

import { Check, Moon, Phone, Play, RotateCcw, Sun, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { cardSurface } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { OnCallCopyNumber } from "@/components/on-call/on-call-copy-number";
import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { OnCallLoadFailed } from "@/components/on-call/on-call-load-failed";
import { OnCallSignedOut } from "@/components/on-call/on-call-signed-out";
import { OnCallToolNavHeader } from "@/components/on-call/on-call-nav-header";
import { OnCallOfflineBanner } from "@/components/on-call/on-call-offline-banner";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/text-field";
import { cn, eyebrowText, primaryControl, textMuted } from "@/components/ui-primitives";
import {
  onCallCallNowPeriod,
  onCallCallNowScenarios,
  onCallCallNowSteps,
  type OnCallCallNowStep,
} from "@/lib/on-call/call-now";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { ON_CALL_HOME_TAGS, onCallTelHref } from "@/lib/on-call/home-modules";
import { msUntilOnCallPeriodChange } from "@/lib/on-call/number-resolver";
import { ON_CALL_SERVER_ANCHOR } from "@/components/on-call/on-call-dates";

/**
 * WHO DO I CALL NOW — pick the situation, get the ladder with call buttons.
 *
 * The ladder is the playbook entry's own escalation steps, with the ones that
 * apply at this hour first. Steps for the other half of the day stay on the
 * page under "At other times": the rule for "now" is weekday hours plus WA
 * public holidays, and a hidden step would be a missed call on the day that
 * rule is wrong.
 */
export function OnCallCallNowPage({ now: nowProp }: { now?: Date } = {}) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const { entries, loading, isOffline, loadError, retry, cachedAt, signedOut } = useOnCallEntries();
  const [clock, setClock] = useState<Date | null>(() => nowProp ?? null);
  const now = useMemo(
    () => nowProp ?? (mounted ? (clock ?? new Date()) : ON_CALL_SERVER_ANCHOR),
    [nowProp, mounted, clock],
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [run, setRun] = useState<LadderRun | null>(null);

  // Re-read the clock when the in-hours period starts or ends (holidays count),
  // so a phone left open on this page does not keep offering the daytime order at night.
  useEffect(() => {
    if (nowProp || !mounted) return;
    const timer = window.setTimeout(() => setClock(new Date()), msUntilOnCallPeriodChange(now));
    return () => window.clearTimeout(timer);
  }, [now, nowProp, mounted]);

  const scenarios = useMemo(() => onCallCallNowScenarios(entries), [entries]);
  const trimmed = query.trim().toLowerCase();
  const matches = trimmed
    ? scenarios.filter((entry) =>
        [entry.title, entry.subtitle ?? "", JSON.stringify(entry.details ?? "")].some((text) =>
          text.toLowerCase().includes(trimmed),
        ),
      )
    : scenarios;
  const pinned = scenarios.find((entry) => entry.tags.includes(ON_CALL_HOME_TAGS.pinned)) ?? scenarios[0] ?? null;
  const selected = scenarios.find((entry) => entry.id === selectedId) ?? (trimmed ? (matches[0] ?? null) : pinned);
  const steps = selected ? onCallCallNowSteps(selected, now) : [];
  const period = onCallCallNowPeriod(now);
  const nowSteps = steps.filter((step) => step.appliesNow);
  const laterSteps = steps.filter((step) => !step.appliesNow);
  const PeriodIcon = period === "after-hours" ? Moon : Sun;
  const activeRun = run && selected && run.scenarioId === selected.id ? run : null;
  const markCalled = (order: number) =>
    setRun((current) => {
      if (!current) return current;
      const called = { ...current.called };
      if (called[order] === undefined) called[order] = Date.now();
      else delete called[order];
      return { ...current, called };
    });

  if (!nowProp && !mounted) {
    return (
      <>
        <OnCallToolNavHeader title="Who to call now" testIdPrefix="on-call-now" />
        <InformationPageShell testId="on-call-now-main" width="narrow">
          <p role="status">Loading current on-call context…</p>
          {/* Public lines do not depend on the historical hydration anchor. */}
          <OnCallCrisisLines />
        </InformationPageShell>
      </>
    );
  }

  return (
    <>
      <OnCallToolNavHeader title="Who to call now" testIdPrefix="on-call-now" />
      <InformationPageShell testId="on-call-now-main" width="narrow">
        <h1 className="sr-only">Who to call now</h1>
        <p
          data-testid="on-call-now-period"
          className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text)]"
        >
          <PeriodIcon aria-hidden="true" className="size-icon-sm" />
          {period === "after-hours"
            ? "After hours: after-hours steps are listed first."
            : "Working hours: working-hours steps are listed first."}
        </p>
        <p className={cn(textMuted, "mt-1 text-xs")}>
          Working hours are Monday to Friday, 8 am to 5 pm, not on a WA public holiday. Every step stays on the page.
        </p>

        {isOffline && cachedAt ? <OnCallOfflineBanner savedAt={cachedAt} reason={loadError} /> : null}

        {loading && entries.length === 0 ? (
          <>
            <OnCallCrisisLines />
            <EmptyState
              icon={Phone}
              title="Loading your playbook"
              body="Fetching your escalation steps."
              testId="on-call-now-loading"
            />
          </>
        ) : isOffline && entries.length === 0 ? (
          <OnCallLoadFailed reason={loadError} onRetry={retry} />
        ) : signedOut && entries.length === 0 ? (
          <OnCallSignedOut icon={Phone} testId="on-call-now-signed-out" />
        ) : scenarios.length === 0 ? (
          <EmptyState
            icon={Phone}
            title="No escalation steps yet"
            body="Add a scenario to your Playbook, with who to call and when, and it will appear here."
            actions={
              <Link
                href="/on-call/playbook"
                className="inline-flex min-h-tap items-center font-semibold text-[color:var(--clinical-accent)]"
              >
                Open the Playbook
              </Link>
            }
            testId="on-call-now-empty"
          />
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <SearchField
              label="What is happening?"
              placeholder="Search your playbook"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedId(null);
              }}
              onClear={() => setQuery("")}
              clearLabel="Clear the search"
            />
            <div
              role="group"
              aria-label="Situations"
              className="flex gap-2 overflow-x-auto pb-1"
              data-testid="on-call-now-scenarios"
            >
              {matches.map((entry) => {
                const pressed = selected?.id === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => {
                      setSelectedId(entry.id);
                      if (run && run.scenarioId !== entry.id) setRun(null);
                    }}
                    className={cn(
                      "inline-flex min-h-tap shrink-0 items-center rounded-lg border px-3 text-sm font-semibold",
                      pressed
                        ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                        : "border-[color:var(--border)] text-[color:var(--text)]",
                    )}
                  >
                    {entry.title}
                  </button>
                );
              })}
              {matches.length === 0 ? (
                <p className={cn(textMuted, "text-sm")}>Nothing in your playbook matches.</p>
              ) : null}
            </div>

            {selected ? (
              <section aria-labelledby="on-call-now-ladder" data-testid="on-call-now-ladder">
                <h2 id="on-call-now-ladder" className="text-lg font-semibold text-[color:var(--text)]">
                  {selected.title}
                </h2>
                {selected.subtitle ? <p className={cn(textMuted, "text-sm")}>{selected.subtitle}</p> : null}
                {steps.length === 0 ? (
                  <p className={cn(textMuted, "mt-2 text-sm")}>This scenario has no escalation steps recorded yet.</p>
                ) : (
                  <>
                    <LadderRunPanel
                      run={activeRun}
                      steps={steps}
                      onStart={() => setRun({ scenarioId: selected.id, startedAt: Date.now(), called: {} })}
                      onStop={() => setRun(null)}
                    />
                    <ol className="mt-3 flex flex-col gap-2" data-testid="on-call-now-steps">
                      {nowSteps.map((step, index) => (
                        <CallNowStep
                          key={`${step.order}-${step.whoToCall}`}
                          step={step}
                          position={index + 1}
                          run={activeRun}
                          onMark={markCalled}
                        />
                      ))}
                    </ol>
                  </>
                )}
                {laterSteps.length > 0 ? (
                  <>
                    <h3 className={cn(eyebrowText, "mt-4")}>At other times</h3>
                    <ol className="mt-2 flex flex-col gap-2" data-testid="on-call-now-other-steps">
                      {laterSteps.map((step, index) => (
                        <CallNowStep
                          key={`${step.order}-${step.whoToCall}`}
                          step={step}
                          position={nowSteps.length + index + 1}
                          muted
                          run={activeRun}
                          onMark={markCalled}
                        />
                      ))}
                    </ol>
                  </>
                ) : null}
                <Link
                  href={onCallEntryHref(selected)}
                  className="mt-3 inline-flex min-h-tap items-center text-sm font-semibold text-[color:var(--clinical-accent)]"
                >
                  Open this scenario in the Playbook
                </Link>
              </section>
            ) : null}
          </div>
        )}
      </InformationPageShell>
    </>
  );
}

function CallNowStep({
  step,
  position,
  muted = false,
  run,
  onMark,
}: {
  step: OnCallCallNowStep;
  position: number;
  muted?: boolean;
  run: LadderRun | null;
  onMark: (order: number) => void;
}) {
  const href = onCallTelHref(step.phone);
  const calledAt = run?.called[step.order];
  return (
    <li
      className={cn(
        cardSurface,
        "flex flex-col gap-2 p-3",
        muted && calledAt === undefined && "opacity-80",
        calledAt !== undefined && "border-[color:var(--clinical-accent-border)]",
      )}
      data-testid="on-call-now-step"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "nums grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold",
            calledAt !== undefined
              ? "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
              : "bg-[color:var(--surface-subtle)] text-[color:var(--text)]",
          )}
        >
          {calledAt !== undefined ? <Check aria-hidden="true" className="size-icon-sm" /> : position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[color:var(--text)]">
            <span className="sr-only">Step {position}: </span>
            {step.whoToCall}
          </p>
          <p className={cn(textMuted, "text-sm")}>{step.when}</p>
          {step.hours !== "any" ? (
            <p className={cn(eyebrowText, "mt-0.5")}>
              {step.hours === "after-hours" ? "After hours" : "Working hours"}
            </p>
          ) : null}
        </div>
      </div>
      {step.phone ? (
        href ? (
          <a href={href} className={cn(primaryControl, "w-full")} data-testid="on-call-now-call">
            <Phone aria-hidden="true" className="size-icon-sm" />
            Call {step.phone}
          </a>
        ) : (
          <div className="flex items-center justify-between gap-2 text-sm text-[color:var(--text)]">
            <span className="nums font-semibold">{step.phone}</span>
            <OnCallCopyNumber value={step.phone} label={step.whoToCall} />
          </div>
        )
      ) : null}
      {run ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className={cn(textMuted, "nums text-sm")} data-testid="on-call-now-step-called">
            {calledAt !== undefined ? `Called ${ladderClock(calledAt)} · ${minutesAgo(calledAt)}` : "Not called yet"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            icon={calledAt !== undefined ? RotateCcw : Check}
            onClick={() => onMark(step.order)}
            aria-label={
              calledAt !== undefined ? `Undo: ${step.whoToCall} not called` : `Mark ${step.whoToCall} as called now`
            }
            testId="on-call-now-step-mark"
          >
            {calledAt !== undefined ? "Undo" : "Mark called"}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** One run up the ladder: when it started and when each step was called. Held on screen only, never saved. */
type LadderRun = {
  readonly scenarioId: string;
  readonly startedAt: number;
  /** Step order to the time it was marked called (epoch ms). */
  readonly called: Readonly<Record<number, number>>;
};

function ladderClock(epochMs: number): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(epochMs));
}

function minutesAgo(epochMs: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - epochMs) / 60_000));
  if (minutes === 0) return "just now";
  return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
}

/**
 * Start the ladder: a clock for the night's worst moment. It records when it
 * started and when each step was called, so "how long since I rang the
 * registrar" is on screen rather than in memory. It adds no wait of its own and
 * no advice: every step and its "when" stay exactly as the Playbook says.
 */
function LadderRunPanel({
  run,
  steps,
  onStart,
  onStop,
}: {
  run: LadderRun | null;
  steps: readonly OnCallCallNowStep[];
  onStart: () => void;
  onStop: () => void;
}) {
  // Re-render every 30 seconds while running, so "6 min ago" stays true.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!run) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [run]);

  if (!run) {
    return (
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-3" data-testid="on-call-now-ladder-start">
        <Button variant="secondary" icon={Play} onClick={onStart} testId="on-call-now-ladder-start-button">
          Start the ladder
        </Button>
        <p className={cn(textMuted, "text-sm")}>Keeps the time of each call on screen. Nothing is saved.</p>
      </div>
    );
  }
  const calledSteps = steps.filter((step) => run.called[step.order] !== undefined);
  const latest = calledSteps.reduce<OnCallCallNowStep | null>(
    (best, step) => (best === null || run.called[step.order]! > run.called[best.order]! ? step : best),
    null,
  );
  return (
    <div
      role="status"
      className="mt-3 grid gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] p-3"
      data-testid="on-call-now-ladder-run"
    >
      <p className={cn(eyebrowText, "text-[color:var(--clinical-accent)]")}>Started {ladderClock(run.startedAt)}</p>
      <p className="text-base font-semibold text-[color:var(--text-heading)]">
        {latest ? `${latest.whoToCall} called ${minutesAgo(run.called[latest.order]!)}` : "No one called yet"}
      </p>
      <p className={cn(textMuted, "text-sm")}>
        {calledSteps.length} of {steps.length} {steps.length === 1 ? "step" : "steps"} called
      </p>
      <div>
        <Button variant="ghost" size="sm" icon={X} onClick={onStop} testId="on-call-now-ladder-stop">
          Stop the ladder
        </Button>
      </div>
    </div>
  );
}
