"use client";

import { ChevronRight, LogIn, Sunrise } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AccountSetupDialog } from "@/components/clinical-dashboard/account-setup-dialog";
import { InformationPageShell } from "@/components/information-page-shell";
import { focusRing } from "@/components/card-recipes";
import { ModeGroupedList } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { modeInsetHairline, modePressable } from "@/components/mode-kit/recipes";
import { ModeStateLabel } from "@/components/mode-kit/state-label";
import { modeSecondaryText } from "@/components/mode-kit/type";
import { MODE_BADGE } from "@/components/my-day/mode-badge";
import { MyDayModules } from "@/components/my-day/modules/my-day-modules";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { EmptyState } from "@/components/primitive-recipes/feedback";
import { longDayLabel } from "@/components/teaching/teaching-dates";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { appModeDefinition } from "@/lib/app-modes";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { formatMyDayDue } from "@/lib/my-day/merge";
import {
  myDayEnabledForAuth,
  myDayNeedsSignIn,
  myDaySourceModes,
  type MyDayItem,
  type MyDaySourceMode,
} from "@/lib/my-day/model";
import { useAuthSession } from "@/lib/supabase/client";

const PAGE_WIDTH = "mx-auto grid w-full max-w-2xl gap-4 sm:gap-5";
const TICK_MS = 60_000;

/** The reader's clock, re-read every minute so "Today · 14:30" stays honest and the day rolls over. */
export function useMyDayNow(nowProp?: Date): Date {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    if (nowProp) return;
    const timer = setInterval(() => setTick(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, [nowProp]);
  return nowProp ?? tick;
}

function modeLabel(mode: MyDaySourceMode): string {
  return appModeDefinition(mode).label;
}

/** One My Day row, shared by the page and the home card. */
export function MyDayItemRow({ item, now }: { readonly item: MyDayItem; readonly now: Date }) {
  const due = formatMyDayDue(item.due, now);
  const overdue = item.severity === "overdue";
  // The state word is part of the link's own text, so it never relies on colour or a dot.
  const stateWord = overdue
    ? item.mode === "my-work"
      ? "Date passed"
      : "Overdue"
    : item.severity === "soon"
      ? "Due soon"
      : "";
  const subtitle = [modeLabel(item.mode), stateWord, due].filter(Boolean).join(" · ");
  return (
    <li className={cn(modeInsetHairline, "flex min-w-0 items-center pr-2")}>
      <Link
        href={item.href}
        data-testid={`my-day-item-${item.id}`}
        className={cn(
          modePressable,
          focusRing,
          "flex min-h-14 min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 pr-1 no-underline",
        )}
      >
        <span
          aria-hidden="true"
          data-testid={`my-day-item-badge-${item.id}`}
          className={cn(
            "grid size-9.5 shrink-0 place-items-center rounded-lg font-mono text-2xs font-semibold",
            overdue
              ? "bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
              : "bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
          )}
        >
          {MODE_BADGE[item.mode]}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="break-words text-base-minus font-medium leading-5 text-[color:var(--text-heading)]">
            {item.title}
          </span>
          <span
            className={cn(
              modeSecondaryText,
              "break-words leading-5",
              overdue && "font-medium text-[color:var(--warning)]",
            )}
          >
            {subtitle}
          </span>
          {item.detail ? <span className={cn(modeSecondaryText, "break-words leading-5")}>{item.detail}</span> : null}
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </Link>
      {stateWord ? (
        <span aria-hidden="true" className="ml-1 hidden shrink-0 sm:block">
          <ModeStateLabel tone={overdue ? "warning" : "muted"}>{stateWord}</ModeStateLabel>
        </span>
      ) : null}
    </li>
  );
}

export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type NeedsSection = { readonly key: string; readonly eyebrow: string; readonly items: readonly MyDayItem[] };
type NeedsFilter = "all" | MyDaySourceMode;

/**
 * The merged list under a "Needs you" eyebrow, with a row of mode pills that
 * narrows it. The filter is local state only and nothing is stored. Items keep
 * their Needs you now / Due soon / Later groups.
 */
function MyDayNeedsYou({ sections, now }: { readonly sections: readonly NeedsSection[]; readonly now: Date }) {
  const [filter, setFilter] = useState<NeedsFilter>("all");
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const shown = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => filter === "all" || item.mode === filter),
    }))
    .filter((section) => section.items.length > 0);
  const options: readonly { key: NeedsFilter; label: string }[] = [
    { key: "all", label: "All" },
    ...myDaySourceModes.map((mode) => ({ key: mode, label: modeLabel(mode) })),
  ];
  return (
    <div className="grid gap-2" data-testid="my-day-needs-you">
      <div className="flex items-baseline justify-between gap-3 px-3">
        <p className={eyebrowText}>Needs you</p>
        <button
          type="button"
          onClick={() => setFilter("all")}
          data-testid="my-day-needs-all"
          className={cn(
            focusRing,
            "inline-flex min-h-12 items-center rounded-md px-1 text-sm-minus font-medium text-[color:var(--mode-identity)]",
          )}
        >
          {`All ${total}`}
        </button>
      </div>
      <div role="group" aria-label="Filter by mode" className="flex gap-1.5 overflow-x-auto px-1.5">
        {options.map((option) => {
          const pressed = filter === option.key;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={pressed}
              data-testid={`my-day-filter-${option.key}`}
              onClick={() => setFilter(option.key)}
              className={cn(focusRing, "inline-flex min-h-12 shrink-0 items-center rounded-full")}
            >
              <span
                className={cn(
                  "inline-flex min-h-8 items-center rounded-full border px-3 text-sm-minus font-medium",
                  pressed
                    ? "border-transparent bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]"
                    : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
                )}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p className="px-3 text-sm text-[color:var(--text-muted)]" data-testid="my-day-filter-empty">
          {`Nothing from ${modeLabel(filter as MyDaySourceMode)} needs you.`}
        </p>
      ) : (
        shown.map((section) => (
          <ModeGroupedList key={section.key} eyebrow={section.eyebrow} testId={`my-day-section-${section.key}`}>
            {section.items.map((item) => (
              <MyDayItemRow key={item.id} item={item} now={now} />
            ))}
          </ModeGroupedList>
        ))
      )}
    </div>
  );
}

export function MyDayPage({ now: nowProp }: { now?: Date } = {}) {
  const { status: authStatus } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  const now = useMyDayNow(nowProp);
  const state = useMyDayItems({ enabled, now });
  const [signInOpen, setSignInOpen] = useState(false);

  const failed = state.sources.filter((source) => source.status === "failed").map((source) => modeLabel(source.mode));
  const rosterUnavailable = state.sources.some((source) => source.mode === "roster" && source.status === "unavailable");
  const otherUnavailable = state.sources
    .filter((source) => source.status === "unavailable" && source.mode !== "roster")
    .map((source) => modeLabel(source.mode));
  const checked = myDaySourceModes
    .filter((mode) => state.sources.some((source) => source.mode === mode && source.status === "ready"))
    .map(modeLabel);

  const sections = [
    { key: "overdue", eyebrow: "Needs you now", items: state.items.filter((item) => item.severity === "overdue") },
    { key: "soon", eyebrow: "Due soon", items: state.items.filter((item) => item.severity === "soon") },
    { key: "later", eyebrow: "Later", items: state.items.filter((item) => item.severity === "info") },
  ].filter((section) => section.items.length > 0);

  return (
    <InformationPageShell testId="my-day-main">
      <div className={PAGE_WIDTH}>
        <header className="grid gap-0.5 px-1.5" data-testid="my-day-header">
          <p className="text-sm-minus text-[color:var(--text-muted)]" data-testid="my-day-date">
            {longDayLabel(perthCalendarDate(now))}
          </p>
          <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-heading)]">My Day</h1>
        </header>

        {authStatus === "loading" || (enabled && state.status === "loading") ? (
          <>
            <span role="status" className="sr-only">
              Loading My Day
            </span>
            <div className="grid gap-5" data-testid="my-day-loading" aria-hidden="true">
              <ModeModuleSkeleton rows={3} twoLine eyebrow />
              <ModeModuleSkeleton rows={2} twoLine eyebrow />
            </div>
          </>
        ) : null}

        {authStatus === "error" ? (
          <div className="grid gap-2" data-testid="my-day-auth-error">
            <ModeNotice tone="warning">Couldn&apos;t check your sign-in. Try again.</ModeNotice>
            <div>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        {myDayNeedsSignIn(authStatus) ? (
          <div className="grid gap-3" data-testid="my-day-signed-out">
            <EmptyState
              icon={LogIn}
              title="Sign in to see your day"
              body="My Day gathers your own On Call, Roster, CPD, Teaching and Admin records. Nothing is shared."
              actions={
                <Button variant="primary" onClick={() => setSignInOpen(true)}>
                  Sign in
                </Button>
              }
            />
            <AccountSetupDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
          </div>
        ) : null}

        {enabled && state.status === "ready" ? (
          <div className="grid gap-5" data-testid="my-day-ready">
            {state.demoMode ? (
              <ModeNotice testId="my-day-demo-notice">Demo data: these items are invented examples.</ModeNotice>
            ) : null}
            {failed.length > 0 ? (
              <div className="grid gap-2" data-testid="my-day-failed-notice">
                <ModeNotice tone="warning">{`Couldn't load: ${failed.join(", ")}.${checked.length > 0 ? " Showing the rest." : ""}`}</ModeNotice>
                {checked.length > 0 ? (
                  <div>
                    <Button variant="secondary" onClick={state.retry}>
                      Retry
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {rosterUnavailable ? (
              <ModeNotice testId="my-day-unavailable-notice">
                Roster team data isn&apos;t available yet, so swaps aren&apos;t shown.
              </ModeNotice>
            ) : null}
            {otherUnavailable.length > 0 ? (
              <ModeNotice testId="my-day-unavailable-other-notice">
                {`${listNames(otherUnavailable)} isn't available yet, so it isn't shown.`}
              </ModeNotice>
            ) : null}

            <MyDayModules now={now} items={state.items}>
              {sections.length === 0 ? (
                <div data-testid="my-day-empty">
                  {checked.length > 0 ? (
                    <EmptyState
                      icon={Sunrise}
                      title="Nothing needs you right now"
                      body={`Checked ${listNames(checked)}.`}
                    />
                  ) : (
                    <EmptyState
                      icon={Sunrise}
                      title="Couldn't check your day"
                      body="No source could be checked just now."
                      actions={
                        <Button variant="secondary" onClick={state.retry}>
                          Retry
                        </Button>
                      }
                    />
                  )}
                </div>
              ) : (
                <MyDayNeedsYou sections={sections} now={now} />
              )}
            </MyDayModules>

            <p className="px-3 text-xs text-[color:var(--text-muted)]" data-testid="my-day-footer">
              Read-only. Open an item to act on it in its own mode.
            </p>
          </div>
        ) : null}
      </div>
    </InformationPageShell>
  );
}
