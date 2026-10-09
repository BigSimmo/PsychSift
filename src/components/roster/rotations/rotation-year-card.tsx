"use client";

import { CalendarDays, Link2, Sun } from "lucide-react";

import { WorkCard, WorkHero, WorkIconRow, WorkRing, WorkTag } from "@/components/mode-kit/work";
import { rotationById } from "@/lib/roster/rotations/model";
import type { MyRound } from "@/lib/roster/rotations/model";

import {
  currentTermId,
  formatDayWithYear,
  formatTermDates,
  rankTag,
  topChoiceCount,
  yearSummary,
} from "./rotation-format";

/**
 * A doctor's published year: one row per term with the rotation, its site,
 * the rank it was in their preferences and the reason it was given. The term
 * holding today is tinted and named. Shared by Rotations and a round's page.
 */
export function RotationYearCard({
  mine,
  today,
  testId = "rotation-year",
}: {
  readonly mine: MyRound;
  /** The work zone's date, `YYYY-MM-DD`. */
  readonly today: string;
  readonly testId?: string;
}) {
  const { round } = mine;
  const current = currentTermId(round.terms, today);
  return (
    <WorkCard as="ul" aria-label={`Your ${round.name}`} testId={testId}>
      {round.terms.map((term) => {
        const placement = mine.placements.find((entry) => entry.termId === term.id);
        const rotation = placement ? rotationById(round, placement.rotationId) : undefined;
        const tag = placement ? rankTag(placement) : null;
        const isCurrent = term.id === current;
        return (
          <li
            key={term.id}
            className={`flex min-h-12 items-start gap-3 px-3 py-2.5 ${
              isCurrent ? "bg-[color:var(--mode-identity-soft)]" : ""
            }`}
            aria-current={isCurrent ? "date" : undefined}
            data-testid={`${testId}-term`}
          >
            <span className="grid w-[4.75rem] flex-none gap-0.5 pt-0.5">
              <span className="text-3xs font-bold tracking-label text-[color:var(--mode-identity)] uppercase">
                {term.label}
                {isCurrent ? <span className="sr-only">, current term</span> : null}
              </span>
              <span className="text-2xs leading-snug font-semibold text-[color:var(--work-ink-muted)] tabular-nums">
                {formatTermDates(term.start, term.end)}
              </span>
              {isCurrent ? (
                <span aria-hidden="true" className="text-3xs font-bold text-[color:var(--mode-identity)]">
                  Now
                </span>
              ) : null}
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="work-row__title">
                {rotation?.name ?? (placement ? "Rotation removed" : "Not placed")}
              </span>
              {rotation?.site ? <span className="work-row__sub">{rotation.site}</span> : null}
              <span className="work-row__sub">
                {placement?.reason ?? "Nothing is set for this term yet. Your roster administrator will be in touch."}
              </span>
            </span>
            <span className="flex-none pt-0.5">
              {tag ? <WorkTag tone={tag.tone}>{tag.label}</WorkTag> : <WorkTag tone="neutral">Not set</WorkTag>}
            </span>
          </li>
        );
      })}
    </WorkCard>
  );
}

/** The year's one colour card: how many terms were top choices, as words and a ring. */
export function RotationYearHero({ mine, zone }: { readonly mine: MyRound; readonly zone: string }) {
  const terms = mine.round.terms.length;
  const top = topChoiceCount(mine.placements);
  const published = mine.round.publishedAt
    ? `Published ${formatDayWithYear(mine.round.publishedAt, zone)} by ${mine.round.adminName}`
    : `Published by ${mine.round.adminName}`;
  return (
    <WorkHero
      eyebrow={`Your ${mine.round.name}`}
      title={yearSummary(mine.placements, terms)}
      sub={`${published}. On your Roster month and in My Day.`}
      ring={
        terms > 0 ? (
          <WorkRing
            value={`${top}/${terms}`}
            label="top 3"
            fraction={top / terms}
            accessibleLabel={`${top} of ${terms} terms were in your top three`}
          />
        ) : undefined
      }
      testId="rotation-year-hero"
    />
  );
}

/** Where published rotations show up, with a way to each. */
export function RotationCalendarCard() {
  return (
    <WorkCard testId="rotation-calendar">
      <WorkIconRow
        icon={CalendarDays}
        title="On your Roster month"
        sub="The start and end of each rotation"
        href="/roster"
      />
      <WorkIconRow icon={Sun} leadsTo="my-day" title="In My Day" sub="Your current rotation" href="/my-day" />
      <WorkIconRow
        icon={Link2}
        title="In your phone calendar"
        sub="Through your calendar link in Settings"
        href="/roster/settings"
      />
    </WorkCard>
  );
}
