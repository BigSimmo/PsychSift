"use client";

import Link from "next/link";
import { CalendarPlus, ExternalLink } from "lucide-react";
import { useState } from "react";

import { cmePageTitle, cmePageWidth } from "@/components/cme/cme-page-frame";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState, cn, eyebrowText, raisedCard, textMuted, toneWarning } from "@/components/ui-primitives";
import { formatCalendarDateLong, formatCalendarDateShort, perthCalendarDate } from "@/lib/cme/cpd-year";
import { canAddLearningToCalendar, learningCalendarEventIcs, learningCalendarFileName } from "@/lib/cme/calendar-event";
import {
  LEARNING_DIRECTORY_STALE_AFTER_DAYS,
  defaultLearningSpecialty,
  filterLearningItems,
  groupLearningByMonth,
  isDirectoryStale,
  learningItemLogHref,
  pastLearningItems,
  unconfirmedLearningItems,
  upcomingLearningItems,
  type LearningFormat,
} from "@/lib/cme/learning-directory-view";
import type { LearningDirectoryItem } from "@/lib/cme/learning-directory";

const KIND_LABEL: Record<LearningDirectoryItem["kind"], string> = {
  course: "Course",
  event: "Event",
  recorded: "Recorded",
};

function dateLabel(item: LearningDirectoryItem): string {
  const { startsOn, endsOn } = item;
  if (startsOn === null) return item.kind === "recorded" ? "Watch any time" : "Date not confirmed";
  if (endsOn === null || endsOn === startsOn) return formatCalendarDateLong(startsOn);
  if (startsOn.slice(0, 4) === endsOn.slice(0, 4)) {
    return `${formatCalendarDateShort(startsOn)} to ${formatCalendarDateLong(endsOn)}`;
  }
  return `${formatCalendarDateLong(startsOn)} to ${formatCalendarDateLong(endsOn)}`;
}

function modeLabel(item: LearningDirectoryItem): string {
  const where = item.mode === "online" ? "Online" : item.mode === "in-person" ? "In person" : "Online and in person";
  return item.location && item.mode !== "online" ? `${where}, ${item.location}` : where;
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

function LearningItemCard({
  item,
  phase,
}: {
  item: LearningDirectoryItem;
  phase: "upcoming" | "past" | "unconfirmed";
}) {
  return (
    <li data-testid="cme-learning-item" className={cn(raisedCard, "p-4")}>
      <p className={cn(textMuted, "text-xs font-semibold")}>
        {KIND_LABEL[item.kind]} · {item.provider}
      </p>
      <h3 className="mt-1 text-base font-semibold text-[color:var(--text)]">{item.title}</h3>
      <dl className="mt-2 grid gap-1 text-sm text-[color:var(--text)]">
        <div className="flex gap-2">
          <dt className={textMuted}>When</dt>
          <dd>{dateLabel(item)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className={textMuted}>Where</dt>
          <dd>{modeLabel(item)}</dd>
        </div>
        {item.costNote ? (
          <div className="flex gap-2">
            <dt className={textMuted}>Cost</dt>
            <dd>{item.costNote}</dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-x-4">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-[color:var(--clinical-accent)]"
        >
          Details
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
          <span className="sr-only">(opens the organiser&apos;s page in a new tab)</span>
        </a>
        {phase === "past" || phase === "upcoming" ? (
          <Link
            href={learningItemLogHref(item)}
            className="inline-flex min-h-tap items-center text-sm font-semibold text-[color:var(--clinical-accent)]"
          >
            Log as CPD
          </Link>
        ) : null}
        {phase === "upcoming" && canAddLearningToCalendar(item) ? (
          <button
            type="button"
            onClick={() => downloadCalendarEvent(item)}
            className="inline-flex min-h-12 min-w-12 items-center gap-1.5 rounded-lg text-sm font-semibold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            <CalendarPlus aria-hidden="true" className="size-icon-sm" />
            Add to calendar
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * LEARNING — a curated list of WA courses and events. Confirmed events move to
 * Past after their end date; unconfirmed dates stay visible in their own
 * section. The component receives public directory rows only.
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
  const [specialty, setSpecialty] = useState(() => defaultLearningSpecialty(homeSource));
  const [format, setFormat] = useState<LearningFormat>("any");
  const specialties = [...new Set(["psychiatry", ...items.flatMap((item) => item.specialties ?? [])])].sort();
  const filters = { specialty, format };
  const upcoming = upcomingLearningItems(items, today);
  const past = pastLearningItems(items, today);
  const unconfirmed = unconfirmedLearningItems(items);
  const visibleUpcoming = filterLearningItems(upcoming, filters);
  const visiblePast = filterLearningItems(past, filters);
  const visibleUnconfirmed = filterLearningItems(unconfirmed, filters);
  const stale = isDirectoryStale(lastCheckedOn, today);

  return (
    <main data-testid="cme-learning" className={cn(cmePageWidth, "px-4 pb-24 pt-6 sm:px-6")}>
      <h1 className={cmePageTitle}>Learning</h1>
      <p className={cn(textMuted, "mt-1 text-sm")}>
        {view === "past"
          ? "Earlier courses and events in Western Australia."
          : "Upcoming courses and events in Western Australia."}
      </p>
      <p className={cn(textMuted, "mt-2 text-sm")}>
        This is a curated list, not an endorsement. Confirm dates, cost and CPD eligibility with the organiser.
      </p>
      <p className={cn(textMuted, "mt-2 text-sm")}>List last checked on {formatCalendarDateLong(lastCheckedOn)}.</p>
      {stale ? (
        <p
          data-testid="cme-learning-stale"
          className={cn(toneWarning, "mt-3 rounded-xl border p-3 text-sm font-medium")}
        >
          This list may be out of date. It was last checked more than {LEARNING_DIRECTORY_STALE_AFTER_DAYS} days ago, so
          check each organiser&apos;s page before planning around it.
        </p>
      ) : null}

      {/* Two short one-of-N choices over a short list: chip-sized radiogroups
          that show every option at once, not two full-width dropdowns. "All"
          is the first Specialty option, so going back to every specialty is
          one tap. */}
      <div className="mt-5 flex flex-col gap-3" data-testid="cme-learning-filters">
        <div className="flex flex-col gap-1.5">
          <p id="cme-learning-specialty-label" className={eyebrowText}>
            Specialty
          </p>
          <SegmentedControl
            ariaLabelledBy="cme-learning-specialty-label"
            value={specialty}
            onChange={setSpecialty}
            options={[
              { value: "all", label: "All" },
              ...specialties.map((name) => ({ value: name, label: name.charAt(0).toUpperCase() + name.slice(1) })),
            ]}
            className="w-auto self-start"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <p id="cme-learning-format-label" className={eyebrowText}>
            Format
          </p>
          <SegmentedControl<LearningFormat>
            ariaLabelledBy="cme-learning-format-label"
            value={format}
            onChange={setFormat}
            options={[
              { value: "any", label: "Any" },
              { value: "online", label: "Online" },
              { value: "in-person", label: "In person" },
            ]}
            className="w-auto self-start"
          />
        </div>
      </div>

      {view === "past" ? (
        <section aria-labelledby="cme-learning-past-heading" className="mt-6" data-testid="cme-learning-past">
          <h2 id="cme-learning-past-heading" className="text-base font-semibold text-[color:var(--text)]">
            Past
          </h2>
          {visiblePast.length === 0 ? (
            <div className="mt-3">
              <EmptyState title="No past events are listed yet." body="Only events with confirmed dates appear here." />
            </div>
          ) : (
            <div className="mt-3 space-y-6">
              {groupLearningByMonth(visiblePast).map((group) => (
                <section key={group.key} aria-label={group.label}>
                  <h3 className={cn(textMuted, "text-sm font-semibold")}>{group.label}</h3>
                  <ul className="mt-2 grid gap-3">
                    {group.items.map((item) => (
                      <LearningItemCard key={item.id} item={item} phase="past" />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="cme-learning-upcoming-heading" className="mt-6">
            <h2 id="cme-learning-upcoming-heading" className="text-base font-semibold text-[color:var(--text)]">
              Upcoming
            </h2>
            {visibleUpcoming.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  testId="cme-learning-empty"
                  title="No upcoming courses or events are listed right now."
                  body="The list is checked about once a month. Past events appear in Past."
                />
              </div>
            ) : (
              <div className="mt-3 space-y-6">
                {groupLearningByMonth(visibleUpcoming).map((group) => (
                  <section key={group.key} aria-label={group.label}>
                    <h3 className={cn(textMuted, "text-sm font-semibold")}>{group.label}</h3>
                    <ul className="mt-2 grid gap-3">
                      {group.items.map((item) => (
                        <LearningItemCard key={item.id} item={item} phase="upcoming" />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>

          {visibleUnconfirmed.length > 0 ? (
            <section
              data-testid="cme-learning-unconfirmed"
              aria-labelledby="cme-learning-unconfirmed-heading"
              className="mt-8"
            >
              <h2 id="cme-learning-unconfirmed-heading" className="text-base font-semibold text-[color:var(--text)]">
                Dates to confirm
              </h2>
              <p className={cn(textMuted, "mt-1 text-sm")}>
                We couldn&apos;t confirm the date for these. Check the organiser&apos;s page before planning around
                them.
              </p>
              <ul className="mt-3 grid gap-3">
                {visibleUnconfirmed.map((item) => (
                  <LearningItemCard key={item.id} item={item} phase="unconfirmed" />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      {hospitalTeachingHref ? (
        <Link
          href={hospitalTeachingHref}
          className={cn(
            raisedCard,
            "mt-6 flex min-h-12 items-center px-4 text-sm font-medium text-[color:var(--text)]",
          )}
        >
          Your hospital&apos;s teaching
        </Link>
      ) : null}
    </main>
  );
}
