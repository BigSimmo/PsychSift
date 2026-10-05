"use client";

import { ArrowUpRight, Clock, GraduationCap } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { CmeFlatList, CmeFlatRow, CmeGroup, CmeNote, CmeTextLink } from "@/components/cme/cme-flat-list";
import { cmePageTitle, cmePageWidth } from "@/components/cme/cme-page-frame";
import { EmptyState, cn } from "@/components/ui-primitives";
import { formatCmeRowDate, perthCalendarDate } from "@/lib/cme/cpd-year";
import { canAddLearningToCalendar, learningCalendarEventIcs, learningCalendarFileName } from "@/lib/cme/calendar-event";
import {
  LEARNING_DIRECTORY_STALE_AFTER_DAYS,
  defaultLearningSpecialty,
  filterLearningItems,
  groupLearningByMonth,
  isDirectoryStale,
  learningCountdownLabel,
  learningItemLogHref,
  pastLearningItems,
  splitUpcomingLearning,
  unconfirmedLearningItems,
  upcomingLearningItems,
} from "@/lib/cme/learning-directory-view";
import type { LearningDirectoryItem } from "@/lib/cme/learning-directory";

const KIND_LABEL: Record<LearningDirectoryItem["kind"], string> = {
  course: "Course",
  event: "Event",
  recorded: "Recorded",
};

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Thursday 1 October", with the year only when it is not this year. */
function longDateWithWeekday(dateOnly: string, today: string): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-AU", { weekday: "long", timeZone: "UTC" }).format(date);
  const dayMonth = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", timeZone: "UTC" }).format(date);
  return dateOnly.slice(0, 4) === today.slice(0, 4)
    ? `${weekday} ${dayMonth}`
    : `${weekday} ${dayMonth} ${dateOnly.slice(0, 4)}`;
}

/**
 * When, as one phrase: every date with its weekday (the year only when it is
 * not this year), and Perth 24-hour times or "all day".
 */
function whenLabel(item: LearningDirectoryItem, today: string): string {
  const { startsOn, endsOn, startsAt, endsAt } = item;
  if (startsOn === null) return item.kind === "recorded" ? "Watch any time" : "Date not confirmed";
  const start = formatCmeRowDate(startsOn, today);
  if (endsOn !== null && endsOn !== startsOn) return `${start} to ${formatCmeRowDate(endsOn, today)}`;
  if (startsAt && endsAt) return `${start}, ${startsAt} to ${endsAt}`;
  if (startsAt) return `${start}, from ${startsAt}`;
  return `${start}, all day`;
}

/** Where: the venue for an in-person event, otherwise how to attend. */
function whereLabel(item: LearningDirectoryItem): string {
  if (item.mode === "online") return "Online";
  if (item.mode === "both") return item.location ? `Online and in person, ${item.location}` : "Online and in person";
  return item.location ?? "In person";
}

/** When · Where · Cost, the one grey line under the title. */
function whenWhereCost(item: LearningDirectoryItem, today: string): string {
  const when = item.startsOn === null && item.kind === "recorded" ? null : whenLabel(item, today);
  const where = item.startsOn === null && item.kind === "recorded" ? "Online · watch any time" : whereLabel(item);
  return [when, where, item.costNote].filter(Boolean).join(" · ");
}

function downloadCalendarEvent(item: LearningDirectoryItem): void {
  const ics = learningCalendarEventIcs(item);
  if (!ics) return;
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = learningCalendarFileName(item);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** The date column: the day large and the month small; "?" when the date is not confirmed; a clock for any time. */
function DateColumn({ item }: { item: LearningDirectoryItem }) {
  let face: ReactNode;
  if (item.startsOn === null) {
    face =
      item.kind === "recorded" ? (
        <Clock aria-hidden="true" strokeWidth={1.6} className="size-5 text-[color:var(--text-muted)]" />
      ) : (
        <span className="text-base font-semibold text-[color:var(--text-heading)]">?</span>
      );
  } else {
    face = (
      <>
        <span className="nums text-base font-normal text-[color:var(--text-heading)]">
          {Number(item.startsOn.slice(8, 10))}
        </span>
        <span className="text-2xs text-[color:var(--text-muted)]">
          {SHORT_MONTHS[Number(item.startsOn.slice(5, 7)) - 1]}
        </span>
      </>
    );
  }
  return (
    <span aria-hidden="true" className="grid w-10 shrink-0 justify-items-center pt-2.5 leading-tight">
      {face}
    </span>
  );
}

/** A quiet accent text link with a 48 px tap area; the external Details link opens the organiser's page. */
const actionLink = cn(
  focusRing,
  "inline-flex min-h-12 min-w-12 items-center gap-1 whitespace-nowrap rounded-md text-sm-minus font-medium text-[color:var(--clinical-accent)] no-underline hover:underline",
);

function DetailsLink({ item }: { item: LearningDirectoryItem }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={actionLink}>
      Details
      <ArrowUpRight aria-hidden="true" strokeWidth={1.6} className="size-4" />
      <span className="sr-only">(opens the organiser&apos;s page in a new tab)</span>
    </a>
  );
}

/**
 * One course as a flat row (mock-up screen 06): the date column, an optional
 * "In N days" above the title, the kind and organiser, then When · Where ·
 * Cost on one grey line, and the actions as spaced text links. An item whose
 * date is not confirmed says so in words and offers only Details.
 */
function LearningRow({
  item,
  phase,
  countdown,
  today,
}: {
  item: LearningDirectoryItem;
  phase: "upcoming" | "past" | "unconfirmed";
  /** "In N days" text, for the next two dated courses only. */
  countdown?: string;
  today: string;
}) {
  const unconfirmed = phase === "unconfirmed";
  return (
    <li
      data-testid="cme-learning-item"
      className="relative flex min-w-0 items-start gap-3 border-t border-[color:var(--border)] py-1 first:border-t-0"
    >
      <DateColumn item={item} />
      <div className="grid min-w-0 flex-1 gap-px pt-2">
        {countdown ? (
          <p data-testid="cme-learning-countdown" className="mb-0.5 text-xs text-[color:var(--text-muted)]">
            {countdown}
          </p>
        ) : null}
        <h3 className="break-words text-sm font-medium leading-5 text-[color:var(--text-heading)]">{item.title}</h3>
        <p className="break-words text-sm-minus text-[color:var(--text-muted)]">
          {KIND_LABEL[item.kind]} · {item.provider}
        </p>
        <p className="break-words text-sm-minus text-[color:var(--text-muted)]">
          {unconfirmed ? (
            <>
              <span className="sr-only">Date not confirmed</span>
              <span className="sr-only">. </span>
              No date yet. Check the organiser&apos;s page before you plan.
            </>
          ) : (
            whenWhereCost(item, today)
          )}
        </p>
        <div className="flex flex-wrap gap-x-5">
          <DetailsLink item={item} />
          {phase === "past" || phase === "upcoming" ? (
            <Link href={learningItemLogHref(item)} className={actionLink}>
              Log as CPD
            </Link>
          ) : null}
          {phase === "upcoming" && canAddLearningToCalendar(item) ? (
            <button type="button" onClick={() => downloadCalendarEvent(item)} className={actionLink}>
              Add to calendar
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function LearningList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul role="list" aria-label={label} className="grid min-w-0">
      {children}
    </ul>
  );
}

/**
 * COURSES — a curated list of WA courses and events (mock-up screen 06, live
 * route `/cme/learning`). Upcoming: the next two with "In N days", then
 * "Later this year", "Next year and any time" and "Date not confirmed", each a
 * flat list under a small label with its count. Confirmed events move to Past
 * after their end date; unconfirmed dates never drop off. The component
 * receives public directory rows only.
 */
export function CmeLearningPage({
  items,
  lastCheckedOn,
  nowIso,
  view = "upcoming",
  homeSource = null,
  hospitalTeachingHref,
}: {
  items: readonly LearningDirectoryItem[];
  lastCheckedOn: string;
  nowIso: string;
  view?: "upcoming" | "past";
  /** Confirmed current CPD-home source, when an owner-scoped loader supplied it. */
  homeSource?: string | null;
  /** Render only when Teaching's destination exists and is connected. */
  hospitalTeachingHref?: string;
}) {
  const today = perthCalendarDate(new Date(nowIso));
  const defaultSpecialty = defaultLearningSpecialty(homeSource);
  const [specialty, setSpecialty] = useState(defaultSpecialty);
  const filters = { specialty, format: "any" as const };
  const upcoming = upcomingLearningItems(items, today);
  const past = pastLearningItems(items, today);
  const unconfirmed = unconfirmedLearningItems(items);
  const visibleUpcoming = filterLearningItems(upcoming, filters);
  const visiblePast = filterLearningItems(past, filters);
  const visibleUnconfirmed = filterLearningItems(unconfirmed, filters);
  const sections = splitUpcomingLearning(visibleUpcoming, today);
  const stale = isDirectoryStale(lastCheckedOn, today);
  const shownCount = view === "past" ? visiblePast.length : visibleUpcoming.length + visibleUnconfirmed.length;
  const totalCount = view === "past" ? past.length : upcoming.length + unconfirmed.length;
  const hiddenBySpecialty = totalCount - shownCount;

  return (
    <main data-testid="cme-learning" data-mode-identity="cme" className={cn(cmePageWidth, "px-4 pb-24 pt-6 sm:px-6")}>
      <h1 className={cmePageTitle}>Learning</h1>
      <div className="mt-3 grid gap-6">
        <div className="grid gap-1">
          <p className="text-xs text-[color:var(--text-muted)]" data-testid="cme-learning-checked">
            Western Australia. Checked {longDateWithWeekday(lastCheckedOn, today)}. A curated list, not an endorsement:
            confirm dates, cost and CPD eligibility with the organiser.
          </p>
          {/* The RANZCP preset starts at psychiatry; one quiet link widens it, and says how many it hides. */}
          {specialty !== "all" && hiddenBySpecialty > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-[color:var(--text-muted)]">
              <span>Showing psychiatry and courses open to every specialty.</span>
              <CmeTextLink onClick={() => setSpecialty("all")} testId="cme-learning-all-specialties">
                Show {hiddenBySpecialty} from other specialties
              </CmeTextLink>
            </p>
          ) : null}
          {specialty === "all" && defaultSpecialty !== "all" ? (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-[color:var(--text-muted)]">
              <span>Showing every specialty.</span>
              <CmeTextLink onClick={() => setSpecialty(defaultSpecialty)} testId="cme-learning-psychiatry-only">
                Psychiatry only
              </CmeTextLink>
            </p>
          ) : null}
        </div>
        {stale ? (
          <CmeNote tone="warn" testId="cme-learning-stale" role="status" title="This list may be out of date">
            It was last checked more than {LEARNING_DIRECTORY_STALE_AFTER_DAYS} days ago, so check each organiser&apos;s
            page before planning around it.
          </CmeNote>
        ) : null}

        {view === "past" ? (
          <section aria-label="Past" className="grid gap-6" data-testid="cme-learning-past">
            {visiblePast.length === 0 ? (
              <EmptyState title="No past events are listed yet." body="Only events with confirmed dates appear here." />
            ) : (
              groupLearningByMonth(visiblePast).map((group) => (
                <CmeGroup key={group.key} label={group.label}>
                  <LearningList>
                    {group.items.map((item) => (
                      <LearningRow key={item.id} item={item} phase="past" today={today} />
                    ))}
                  </LearningList>
                </CmeGroup>
              ))
            )}
          </section>
        ) : (
          <>
            {visibleUpcoming.length === 0 ? (
              <EmptyState
                testId="cme-learning-empty"
                title="No upcoming courses or events are listed right now."
                body="The list is checked about once a month. Past events appear in Past."
              />
            ) : sections.next.length > 0 ? (
              <CmeGroup label="Next" testId="cme-learning-next">
                <LearningList>
                  {sections.next.map((item) => (
                    <LearningRow
                      key={item.id}
                      item={item}
                      phase="upcoming"
                      today={today}
                      countdown={item.startsOn ? learningCountdownLabel(item.startsOn, today) : undefined}
                    />
                  ))}
                </LearningList>
              </CmeGroup>
            ) : null}

            {[
              {
                id: "later-this-year",
                testId: "cme-learning-later-this-year",
                title: "Later this year",
                items: sections.laterThisYear,
              },
              {
                id: "next-year",
                testId: "cme-learning-next-year",
                title: "Next year and any time",
                items: sections.nextYearAndAnyTime,
              },
            ].map((section) =>
              section.items.length > 0 ? (
                <CmeGroup key={section.id} testId={section.testId} label={`${section.title} · ${section.items.length}`}>
                  <LearningList>
                    {section.items.map((item) => (
                      <LearningRow key={item.id} item={item} phase="upcoming" today={today} />
                    ))}
                  </LearningList>
                </CmeGroup>
              ) : null,
            )}

            {visibleUnconfirmed.length > 0 ? (
              <CmeGroup testId="cme-learning-unconfirmed" label={`Date not confirmed · ${visibleUnconfirmed.length}`}>
                <LearningList>
                  {visibleUnconfirmed.map((item) => (
                    <LearningRow key={item.id} item={item} phase="unconfirmed" today={today} />
                  ))}
                </LearningList>
              </CmeGroup>
            ) : null}
          </>
        )}
        {hospitalTeachingHref ? (
          <CmeFlatList>
            <CmeFlatRow
              href={hospitalTeachingHref}
              lead={<GraduationCap aria-hidden="true" strokeWidth={1.6} />}
              title="Your hospital's teaching"
              subtitle="In Teaching"
            />
          </CmeFlatList>
        ) : null}
      </div>
    </main>
  );
}
