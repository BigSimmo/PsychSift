"use client";

import { ArrowUpRight, ChevronRight, Clock, ExternalLink, GraduationCap } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode, type RefObject } from "react";

import { focusRing } from "@/components/card-recipes";
import { CmeNote } from "@/components/cme/cme-flat-list";
import { CmeHint, CmeKvCard } from "@/components/cme/cme-work-kit";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkBody } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
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
import { guardExampleAction, isExampleRecord } from "@/lib/example-data/guards";

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
  // An example course never leaves the app; the real course directory is public information.
  if (isExampleRecord(item) && !guardExampleAction(true, "export")) return;
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

/** The date tile: month over day; "?" when the date is not confirmed; a clock for any time. */
function DateTile({ item }: { item: LearningDirectoryItem }) {
  if (item.startsOn === null) {
    return (
      <span aria-hidden="true" className="work-date">
        {item.kind === "recorded" ? (
          <Clock aria-hidden="true" strokeWidth={1.6} className="size-5 text-[color:var(--work-ink-muted)]" />
        ) : (
          <span className="work-date__day">?</span>
        )}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="work-date">
      <span className="work-date__month">{SHORT_MONTHS[Number(item.startsOn.slice(5, 7)) - 1]}</span>
      <span className="work-date__day">{Number(item.startsOn.slice(8, 10))}</span>
    </span>
  );
}

/** A quiet accent text link with a 48 px tap area; the external Details link opens the organiser's page. */
const actionLink = cn(
  focusRing,
  "relative z-[var(--z-raised)] inline-flex min-h-12 min-w-12 items-center gap-1 whitespace-nowrap rounded-md text-sm-minus font-semibold text-[color:var(--mode-identity)] no-underline hover:underline",
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

type Phase = "upcoming" | "past" | "unconfirmed";
type OpenCourse = (item: LearningDirectoryItem, phase: Phase, from: HTMLElement) => void;

/**
 * The course title as the row's one button: it opens the course sheet, and its
 * hit area stretches over the whole row or card, so the row is one tap without
 * nesting the other links inside a button.
 */
function CourseTitle({
  item,
  phase,
  onOpen,
  className,
}: {
  item: LearningDirectoryItem;
  phase: Phase;
  onOpen: OpenCourse;
  className?: string;
}) {
  return (
    <h3 className={cn("m-0 break-words", className)}>
      <button
        type="button"
        onClick={(event) => onOpen(item, phase, event.currentTarget)}
        className={cn(focusRing, "rounded-sm text-left after:absolute after:inset-0 after:content-['']")}
      >
        {item.title}
      </button>
    </h3>
  );
}

function metaLine(item: LearningDirectoryItem, phase: Phase, today: string): ReactNode {
  if (phase === "unconfirmed") {
    return (
      <>
        <span className="sr-only">Date not confirmed</span>
        <span className="sr-only">. </span>
        No date yet. Check the organiser&apos;s page before you plan.
      </>
    );
  }
  return whenWhereCost(item, today);
}

/**
 * One of the next two courses as a full card (mock-up cpd_learn): the date
 * tile, the copper "In N days" tag, the title, kind and organiser, When ·
 * Where · Cost, then Details, Log as CPD and Add to calendar.
 */
function LearningCard({
  item,
  countdown,
  today,
  onOpen,
}: {
  item: LearningDirectoryItem;
  countdown?: string;
  today: string;
  onOpen: OpenCourse;
}) {
  return (
    <li data-testid="cme-learning-item" className="work-card work-card--pad relative grid min-w-0 list-none gap-1">
      <div className="flex min-w-0 items-start gap-3">
        <DateTile item={item} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          {countdown ? (
            <span data-testid="cme-learning-countdown" className="work-tag justify-self-start">
              {countdown}
            </span>
          ) : null}
          <CourseTitle
            item={item}
            phase="upcoming"
            onOpen={onOpen}
            className="text-sm font-semibold leading-5 text-[color:var(--work-ink)]"
          />
          <p className="work-row__sub m-0 break-words">
            {KIND_LABEL[item.kind]} · {item.provider}
          </p>
          <p className="work-row__sub m-0 break-words">{metaLine(item, "upcoming", today)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 pl-[calc(2.125rem+0.75rem)]">
        <DetailsLink item={item} />
        <Link href={learningItemLogHref(item)} className={actionLink}>
          Log as CPD
        </Link>
        {canAddLearningToCalendar(item) ? (
          <button type="button" onClick={() => downloadCalendarEvent(item)} className={actionLink}>
            Add to calendar
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Any other course as a row: the date tile, the title, kind and organiser,
 * then When · Where · Cost. Tapping the row opens the course sheet. A past
 * course keeps Log as CPD on the row, because that is why anyone opens Past.
 * An unconfirmed date says so in words and offers only Details.
 */
function LearningRow({
  item,
  phase,
  today,
  onOpen,
}: {
  item: LearningDirectoryItem;
  phase: Phase;
  today: string;
  onOpen: OpenCourse;
}) {
  return (
    <li data-testid="cme-learning-item" className="work-row relative min-w-0 list-none items-start">
      <span className="pt-0.5">
        <DateTile item={item} />
      </span>
      <div className="work-row__text">
        <CourseTitle item={item} phase={phase} onOpen={onOpen} className="work-row__title" />
        <p className="work-row__sub m-0 break-words">
          {KIND_LABEL[item.kind]} · {item.provider}
        </p>
        <p className="work-row__sub m-0 break-words">{metaLine(item, phase, today)}</p>
      </div>
      {phase === "past" ? (
        <Link
          href={learningItemLogHref(item)}
          className="work-button relative z-[var(--z-raised)] min-h-tap shrink-0 self-center"
          data-variant="tinted"
        >
          Log as CPD
        </Link>
      ) : phase === "unconfirmed" ? (
        <span className="shrink-0 self-center">
          <DetailsLink item={item} />
        </span>
      ) : (
        <ChevronRight aria-hidden="true" className="work-row__chev self-center" />
      )}
    </li>
  );
}

/** A group: the small label with its count, then one card of rows (or the cards themselves). */
function LearningGroup({
  id,
  label,
  testId,
  cards = false,
  children,
}: {
  id: string;
  label: string;
  testId?: string;
  cards?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`cme-learning-${id}-heading`} data-testid={testId} className="grid gap-1.5">
      <h2 id={`cme-learning-${id}-heading`} className="work-label m-0">
        {label}
      </h2>
      <ul role="list" className={cn("m-0 grid min-w-0 p-0", cards ? "gap-2.5" : "work-card work-rows")}>
        {children}
      </ul>
    </section>
  );
}

/**
 * The course sheet (mock-up cpd_learnSheet): When, Where and Cost, the
 * organiser's page, a reminder that opening a course logs nothing, then Add to
 * calendar and Log as CPD. UI only: everything comes from the public row.
 */
function CourseSheet({
  open,
  today,
  onClose,
  returnFocusRef,
}: {
  open: { item: LearningDirectoryItem; phase: Phase } | null;
  today: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const item = open?.item;
  const phase = open?.phase;
  const recordedAnyTime = item?.startsOn === null && item?.kind === "recorded";
  const canCalendar = item && phase === "upcoming" && canAddLearningToCalendar(item);
  const canLog = item && phase !== "unconfirmed";
  return (
    <Sheet
      open={Boolean(open)}
      onClose={onClose}
      title={item?.title ?? "Course"}
      description={item ? `${KIND_LABEL[item.kind]} · ${item.provider}` : undefined}
      placement="responsive-right"
      mobilePlacement="bottom"
      returnFocusRef={returnFocusRef}
      testId="cme-learning-sheet"
      footerClassName="pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      footer={
        item && (canCalendar || canLog) ? (
          <div className="flex gap-2">
            {canCalendar ? (
              <button
                type="button"
                className="work-button min-h-tap flex-1"
                data-variant="secondary"
                onClick={() => downloadCalendarEvent(item)}
              >
                Add to calendar
              </button>
            ) : null}
            {canLog ? (
              <Link
                href={learningItemLogHref(item)}
                className="work-button min-h-tap flex-[1.4]"
                data-variant="primary"
                data-testid="cme-learning-sheet-log"
              >
                Log as CPD
              </Link>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {item ? (
        <div className="grid gap-3 pb-2">
          <CmeKvCard
            label="Course details"
            rows={[
              {
                label: "When",
                value:
                  phase === "unconfirmed"
                    ? "Date not confirmed"
                    : recordedAnyTime
                      ? "Watch any time"
                      : whenLabel(item, today),
              },
              { label: "Where", value: recordedAnyTime ? "Online" : whereLabel(item) },
              { label: "Cost", value: item.costNote ?? "Not listed" },
            ]}
          />
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(focusRing, "work-card work-row min-h-12")}
          >
            <span className="work-row__text">
              <span className="work-row__title">Organiser page</span>
              <span className="work-row__sub">Book and check details there</span>
            </span>
            <ExternalLink aria-hidden="true" className="work-row__chev" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <CmeHint>
            {phase === "unconfirmed"
              ? "No date yet. Check the organiser's page before you plan."
              : "Opening a course logs nothing. Log it once you attend, and it opens prefilled."}
          </CmeHint>
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * LEARNING: a curated list of WA courses and events (mock-up cpd_learn, live
 * route `/cme/learning`). Upcoming: the next two as cards with "In N days",
 * then "Later this year", "Next year and any time" and "Date not confirmed"
 * as rows under a small label with its count. Tapping a course opens its
 * sheet. Confirmed events move to Past after their end date; unconfirmed
 * dates never drop off. The component receives public directory rows only.
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
  const [openCourse, setOpenCourse] = useState<{ item: LearningDirectoryItem; phase: Phase } | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
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
  const narrowedCount = (() => {
    const all = { specialty: "all", format: "any" as const };
    const allShown =
      view === "past"
        ? filterLearningItems(past, all).length
        : filterLearningItems(upcoming, all).length + filterLearningItems(unconfirmed, all).length;
    const narrow = { specialty: defaultSpecialty, format: "any" as const };
    const narrowShown =
      view === "past"
        ? filterLearningItems(past, narrow).length
        : filterLearningItems(upcoming, narrow).length + filterLearningItems(unconfirmed, narrow).length;
    return allShown - narrowShown;
  })();
  const hiddenBySpecialty = totalCount - shownCount;
  const showSpecialtyChips = defaultSpecialty !== "all" && (hiddenBySpecialty > 0 || specialty === "all");
  const openSheet: OpenCourse = (item, phase, from) => {
    returnFocusRef.current = from;
    setOpenCourse({ item, phase });
  };

  useModeBandHeading({
    eyebrow: `Western Australia · checked ${formatCmeRowDate(lastCheckedOn, today)}`,
    title: "Learning",
  });

  return (
    <main data-testid="cme-learning" data-mode-identity="cme" className="w-full">
      <WorkBody>
        <h1 className="sr-only">Learning</h1>
        <nav aria-label="Learning pages" className="cpd-seg">
          <Link
            href="/cme/learning"
            className="cpd-seg__item min-h-tap"
            aria-current={view !== "past" ? "page" : undefined}
          >
            Upcoming ·{" "}
            <span className="nums ml-1 font-normal">{visibleUpcoming.length + visibleUnconfirmed.length}</span>
          </Link>
          <Link
            href="/cme/learning?view=past"
            className="cpd-seg__item min-h-tap"
            aria-current={view === "past" ? "page" : undefined}
          >
            Past
          </Link>
        </nav>

        {/* The RANZCP preset starts at psychiatry; one chip widens it, and says how many it hides. */}
        {showSpecialtyChips ? (
          <div role="group" aria-label="Specialty" className="work-chips flex-wrap">
            <button
              type="button"
              className="work-chip min-h-12"
              aria-pressed={specialty !== "all"}
              onClick={() => setSpecialty(defaultSpecialty)}
              data-testid="cme-learning-psychiatry-only"
            >
              Psychiatry and open to all
            </button>
            <button
              type="button"
              className="work-chip min-h-12"
              aria-pressed={specialty === "all"}
              onClick={() => setSpecialty("all")}
              data-testid="cme-learning-all-specialties"
            >
              Every specialty
              {narrowedCount > 0 ? (
                <span className="work-chip__count">
                  <span className="nums font-normal">{narrowedCount}</span> more
                </span>
              ) : null}
            </button>
          </div>
        ) : null}

        <CmeHint testId="cme-learning-checked">
          Western Australia. Checked {longDateWithWeekday(lastCheckedOn, today)}. A curated list, not an endorsement:
          confirm dates, cost and CPD eligibility with the organiser.
        </CmeHint>

        {stale ? (
          <CmeNote tone="warn" testId="cme-learning-stale" role="status" title="This list may be out of date">
            It was last checked more than {LEARNING_DIRECTORY_STALE_AFTER_DAYS} days ago, so check each organiser&apos;s
            page before planning around it.
          </CmeNote>
        ) : null}

        {view === "past" ? (
          <section aria-label="Past" className="grid gap-4" data-testid="cme-learning-past">
            {visiblePast.length === 0 ? (
              <EmptyState title="No past events are listed yet." body="Only events with confirmed dates appear here." />
            ) : (
              groupLearningByMonth(visiblePast).map((group) => (
                <LearningGroup key={group.key} id={`past-${group.key}`} label={group.label}>
                  {group.items.map((item) => (
                    <LearningRow key={item.id} item={item} phase="past" today={today} onOpen={openSheet} />
                  ))}
                </LearningGroup>
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
              <LearningGroup id="next" label="Next" testId="cme-learning-next" cards>
                {sections.next.map((item) => (
                  <LearningCard
                    key={item.id}
                    item={item}
                    today={today}
                    onOpen={openSheet}
                    countdown={item.startsOn ? learningCountdownLabel(item.startsOn, today) : undefined}
                  />
                ))}
              </LearningGroup>
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
                <LearningGroup
                  key={section.id}
                  id={section.id}
                  testId={section.testId}
                  label={`${section.title} · ${section.items.length}`}
                >
                  {section.items.map((item) => (
                    <LearningRow key={item.id} item={item} phase="upcoming" today={today} onOpen={openSheet} />
                  ))}
                </LearningGroup>
              ) : null,
            )}

            {visibleUnconfirmed.length > 0 ? (
              <LearningGroup
                id="unconfirmed"
                testId="cme-learning-unconfirmed"
                label={`Date not confirmed · ${visibleUnconfirmed.length}`}
              >
                {visibleUnconfirmed.map((item) => (
                  <LearningRow key={item.id} item={item} phase="unconfirmed" today={today} onOpen={openSheet} />
                ))}
              </LearningGroup>
            ) : null}
          </>
        )}
        {hospitalTeachingHref ? (
          <Link href={hospitalTeachingHref} className={cn(focusRing, "work-card work-row min-h-12")}>
            <span className="work-ic" aria-hidden="true">
              <GraduationCap aria-hidden="true" strokeWidth={1.8} />
            </span>
            <span className="work-row__text">
              <span className="work-row__title">Your hospital&apos;s teaching</span>
              <span className="work-row__sub">In Teaching</span>
            </span>
            <ChevronRight aria-hidden="true" className="work-row__chev" />
          </Link>
        ) : null}
      </WorkBody>
      <CourseSheet
        open={openCourse}
        today={today}
        onClose={() => setOpenCourse(null)}
        returnFocusRef={returnFocusRef}
      />
    </main>
  );
}
