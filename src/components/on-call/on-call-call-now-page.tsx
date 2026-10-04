"use client";

import { Moon, Phone, Sun } from "lucide-react";
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
                    onClick={() => setSelectedId(entry.id)}
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
                  <ol className="mt-3 flex flex-col gap-2" data-testid="on-call-now-steps">
                    {nowSteps.map((step, index) => (
                      <CallNowStep key={`${step.order}-${step.whoToCall}`} step={step} position={index + 1} />
                    ))}
                  </ol>
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
}: {
  step: OnCallCallNowStep;
  position: number;
  muted?: boolean;
}) {
  const href = onCallTelHref(step.phone);
  return (
    <li className={cn(cardSurface, "flex flex-col gap-2 p-3", muted && "opacity-80")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="nums grid size-7 shrink-0 place-items-center rounded-full bg-[color:var(--surface-subtle)] text-sm font-semibold text-[color:var(--text)]"
        >
          {position}
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
    </li>
  );
}
