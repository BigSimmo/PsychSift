"use client";

import { CalendarRange, CloudOff, History, Layers, LogIn, RotateCcw, Scale, WifiOff } from "lucide-react";

import { PageTitleUnderBand, useModeBandHeading } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkEmpty,
  WorkHero,
  WorkIconRow,
  WorkSectionLabel,
} from "@/components/mode-kit/work";
import { useRosterSignIn } from "@/components/roster/invite/roster-sign-in-notice";
import { useRosterNow } from "@/components/roster/roster-format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { useExampleData } from "@/lib/example-data/store";
import { roundAcceptsPreferences, type MyRound } from "@/lib/roster/rotations/model";
import { useOnlineStatus } from "@/lib/use-online-status";
import { zonedToday } from "@/lib/work-time/format";

import {
  byYearNewest,
  formatClosing,
  formatClosingDay,
  formatDayWithYear,
  myRoundProgress,
  rotationRoundHref,
  topChoiceCount,
} from "./rotation-format";
import { RotationCalendarCard, RotationYearCard, RotationYearHero } from "./rotation-year-card";
import { useRotations, type RotationsRead } from "./use-rotations";

/**
 * Roster · Rotations (`/roster/rotations`, mockup screens `home` and `year`).
 * The doctor's side of rotation preferences: an open round to rank first (the
 * one colour card), then the year they were given in the latest published
 * round, then every other round they were in. Their roster administrator runs
 * the rounds; this page only reads them through `useRotations`.
 */
export function RotationsHomePage({ now: pinnedNow }: { readonly now?: Date } = {}) {
  const read = useRotations();
  const now = useRosterNow(pinnedNow);
  const { zone } = useWorkTimeZone();
  const today = zonedToday(zone, now);

  const mine = [...read.mine].sort(byYearNewest);
  const open = mine
    .filter((entry) => roundAcceptsPreferences(entry.round, now))
    .sort((a, b) => a.round.closesAt.localeCompare(b.round.closesAt))[0];
  const published = mine.find((entry) => entry.round.status === "published");
  const others = mine.filter((entry) => entry !== open && entry !== published);
  const pending = mine.find((entry) => entry.round.status !== "published");

  useModeBandHeading({
    title: "Rotations",
    eyebrow: open ? `${open.round.name} preferences open` : published ? `Your ${published.round.name}` : undefined,
  });

  return (
    <WorkBody testId="rotations-home">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
        Rotations
      </PageTitleUnderBand>
      {read.status !== "ready" ? (
        <RotationsReadState read={read} testId="rotations-home" />
      ) : mine.length === 0 ? (
        <WorkCard>
          <WorkEmpty
            icon={CalendarRange}
            title="No rotation rounds yet"
            body="Your roster administrator opens a round when it is time to choose rotations for the year. It will show here, and you can rank your choices."
            testId="rotations-home-empty"
          />
        </WorkCard>
      ) : (
        <>
          {open ? (
            <OpenRoundHero entry={open} zone={zone} />
          ) : published ? (
            <RotationYearHero mine={published} zone={zone} />
          ) : null}

          <WorkSectionLabel count={published ? published.round.name : undefined}>Your year</WorkSectionLabel>
          {published ? (
            <RotationYearCard mine={published} today={today} />
          ) : (
            <YearPlaceholder entry={pending} zone={zone} />
          )}

          {others.length > 0 ? (
            <>
              <WorkSectionLabel>
                {others.some((entry) => entry.round.status === "open") ? "Other rounds" : "Earlier rounds"}
              </WorkSectionLabel>
              <WorkCard>
                {others.map((entry) => (
                  <WorkIconRow
                    key={entry.round.id}
                    icon={entry.round.status === "published" ? History : Layers}
                    title={entry.round.name}
                    sub={roundLine(entry, zone, now)}
                    href={rotationRoundHref(entry.round.id)}
                    testId="rotations-home-round"
                  />
                ))}
              </WorkCard>
            </>
          ) : null}

          <WorkSectionLabel>Calendar</WorkSectionLabel>
          <RotationCalendarCard />

          <WorkSectionLabel>How it works</WorkSectionLabel>
          <WorkCard padded testId="rotations-how">
            <div className="flex gap-3">
              <Scale aria-hidden="true" className="mt-0.5 size-icon-md flex-none text-[color:var(--mode-identity)]" />
              <div className="grid gap-1.5 text-xs leading-relaxed text-[color:var(--work-ink-muted)]">
                <p>
                  You rank the rotations on offer. When the round closes, the allocation fills every term, then gives as
                  many people as it can their 1st choice, then their 2nd, and so on.
                </p>
                <p>
                  Ties are settled by a fixed draw, not by list order. Your roster administrator checks the result and
                  can adjust it before anyone sees it. Each placement says why you got it.
                </p>
              </div>
            </div>
          </WorkCard>
        </>
      )}
    </WorkBody>
  );
}

function OpenRoundHero({ entry, zone }: { readonly entry: MyRound; readonly zone: string }) {
  const { round } = entry;
  const progress = myRoundProgress(entry);
  const title =
    progress === "sent" ? "Preferences sent" : progress === "draft" ? "Finish your ranking" : "Rank your rotations";
  const action = progress === "sent" ? "Review or change" : progress === "draft" ? "Carry on ranking" : "Rank now";
  const status =
    progress === "sent"
      ? "Sent. You can change it until it closes"
      : progress === "draft"
        ? `Draft saved with ${entry.ranking.length} ranked`
        : "Not started";
  return (
    <WorkHero
      href={rotationRoundHref(round.id)}
      aria-label={`${round.name} preferences. ${title}. Closes ${formatClosing(round.closesAt, zone)}. ${status}.`}
      eyebrow={`${round.name} preferences`}
      title={title}
      sub={`Closes ${formatClosing(round.closesAt, zone)} · ${round.rotations.length} rotations · ${round.terms.length} ${
        round.terms.length === 1 ? "term" : "terms"
      }`}
      footer={
        <div className="grid gap-2.5">
          <p className="m-0 text-xs font-semibold">{status}</p>
          <span
            aria-hidden="true"
            className="inline-flex min-h-10 items-center gap-1.5 justify-self-start rounded-full bg-[color:var(--work-surface)] px-4 text-sm font-semibold text-[color:var(--mode-identity)]"
          >
            <Layers aria-hidden="true" className="size-icon-sm" strokeWidth={2.2} />
            {action}
          </span>
        </div>
      }
      testId="rotations-open-hero"
    />
  );
}

function YearPlaceholder({ entry, zone }: { readonly entry: MyRound | undefined; readonly zone: string }) {
  const closed = entry && entry.round.status === "closed";
  const admin = entry?.round.adminName ?? "your roster administrator";
  return (
    <WorkCard padded testId="rotations-year-placeholder">
      <p className="m-0 text-sm font-semibold text-[color:var(--work-ink)]">
        {entry
          ? closed
            ? "Allocation is in progress"
            : `Results come out after ${formatClosingDay(entry.round.closesAt, zone)}`
          : "No published rotations yet"}
      </p>
      <p className="mt-1 mb-0 text-xs leading-relaxed text-[color:var(--work-ink-muted)]">
        Once {admin} publishes them, your rotations show here and on your calendar.
      </p>
    </WorkCard>
  );
}

function roundLine(entry: MyRound, zone: string, now: Date): string {
  const { round } = entry;
  if (round.status === "published") {
    const top = topChoiceCount(entry.placements, 2);
    const when = round.publishedAt ? `Published ${formatDayWithYear(round.publishedAt, zone)}` : "Published";
    return entry.placements.length > 0
      ? `${when} · ${top} of ${entry.placements.length} were 1st or 2nd choice`
      : `${when} · no placements for you`;
  }
  if (roundAcceptsPreferences(round, now)) {
    const progress = myRoundProgress(entry);
    const words = progress === "sent" ? "sent" : progress === "draft" ? "draft saved" : "not started";
    return `Open until ${formatClosing(round.closesAt, zone)} · ${words}`;
  }
  return "Closed · allocation in progress";
}

/**
 * Every not-ready answer from `useRotations`, shared by both doctor screens:
 * loading keeps the page's shape, and each other state says what happened and
 * offers the one way on.
 */
export function RotationsReadState({ read, testId }: { readonly read: RotationsRead; readonly testId: string }) {
  const online = useOnlineStatus();
  const example = useExampleData("rost");
  const signIn = useRosterSignIn();

  if (read.status === "loading") return <ModeModuleSkeleton rows={4} twoLine eyebrow testId={`${testId}-loading`} />;

  if (read.status === "signed-out") {
    return (
      <WorkCard>
        <WorkEmpty
          icon={LogIn}
          title="Sign in to see your rotations"
          body="Your rounds and your year come from your team, so they need you signed in."
          action={
            <WorkButton variant="secondary" onClick={signIn.open} icon={LogIn} testId={`${testId}-sign-in`}>
              Sign in
            </WorkButton>
          }
          testId={`${testId}-signed-out`}
        />
        {signIn.dialog}
      </WorkCard>
    );
  }

  if (read.status === "unavailable") {
    return (
      <WorkCard>
        <WorkEmpty
          icon={CloudOff}
          title="Rotations are not live for real teams yet"
          body="Rotation rounds for your team are coming. You can try every part of it now with the example data."
          action={
            <WorkButton variant="secondary" onClick={example.turnOn} icon={Layers} testId={`${testId}-show-example`}>
              Show the example
            </WorkButton>
          }
          testId={`${testId}-unavailable`}
        />
      </WorkCard>
    );
  }

  return (
    <WorkCard>
      <WorkEmpty
        icon={online ? RotateCcw : WifiOff}
        title={online ? "Your rotations didn't load" : "You're offline"}
        body={
          online
            ? "Nothing was changed. Try again in a moment."
            : "Your rotations need a connection. Try again when you are back online."
        }
        action={
          <WorkButton variant="secondary" onClick={read.retry} icon={RotateCcw} testId={`${testId}-retry`}>
            Try again
          </WorkButton>
        }
        testId={online ? `${testId}-error` : `${testId}-offline`}
      />
    </WorkCard>
  );
}
