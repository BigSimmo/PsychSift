"use client";

import { CalendarClock, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { SignedOutSampleNotice } from "@/components/mode-kit/signed-out-sample";
import { WorkButton, WorkCard, WorkChip, WorkChips } from "@/components/mode-kit/work";
import { useExampleData } from "@/lib/example-data/store";
import { placesLeft, placesWords, type BookingCourse, type BookingsState } from "@/lib/work-screens/admin/bookings";

/** The two views of a page as link chips, so each view has its own address and Back works. */
export function BookingsSegment<T extends string>({
  current,
  items,
  label,
}: {
  readonly current: T;
  readonly items: readonly { readonly id: T; readonly label: string; readonly href: string }[];
  readonly label: string;
}) {
  return (
    <WorkChips label={label}>
      {items.map((item) => (
        <WorkChip key={item.id} href={item.href} current={item.id === current} testId={`bookings-view-${item.id}`}>
          {item.label}
        </WorkChip>
      ))}
    </WorkChips>
  );
}

/** A thin bar of places taken, with "4 of 12 left" or "Full, 3 waiting". */
export function PlacesMeter({ state, course }: { readonly state: BookingsState; readonly course: BookingCourse }) {
  const left = placesLeft(state, course);
  const taken = course.capacity - left;
  const percent = course.capacity ? Math.round((taken / course.capacity) * 100) : 0;
  return (
    <span className="mt-1.5 flex items-center gap-2 text-xs font-semibold text-[color:var(--text-muted)]">
      <span
        aria-hidden="true"
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--work-wash)]"
        data-full={left === 0 ? "" : undefined}
      >
        {/* Drawn as SVG, like AdminMeter, so the width needs no inline style. */}
        <svg width="100%" height="100%" className="block">
          <rect
            x="0"
            y="0"
            width={`${percent}%`}
            height="100%"
            rx="3"
            className={left === 0 ? "fill-[color:var(--text-muted)]" : "fill-[color:var(--mode-identity)]"}
          />
        </svg>
      </span>
      <span>{placesWords(state, course)}</span>
    </span>
  );
}

/** Label and value rows on one card, like the mockup's `kv`. */
export function BookingKeyValues({ rows }: { readonly rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <WorkCard>
      <dl className="divide-y divide-[color:var(--work-line)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm">
            <dt className="text-[color:var(--text-muted)]">{label}</dt>
            <dd className="text-right font-semibold text-[color:var(--text-heading)]">{value}</dd>
          </div>
        ))}
      </dl>
    </WorkCard>
  );
}

/** What the organiser changed, as a booked doctor sees it. */
export function CourseChangeNote({ course, href }: { readonly course: BookingCourse; readonly href?: string }) {
  if (!course.change) return null;
  const cancelled = course.status === "cancelled";
  const body = (
    <>
      <span className="flex items-center gap-2 font-semibold text-[color:var(--text-heading)]">
        <CalendarClock aria-hidden="true" strokeWidth={2} className="size-icon-sm shrink-0" />
        {cancelled ? `${course.title} was cancelled` : `${course.title} changed`}
      </span>
      {cancelled ? null : <span className="mt-1 block">{course.change.summary}</span>}
      <span className="mt-1 block text-xs text-[color:var(--text-muted)]">
        {cancelled ? "It is off your calendar." : "Your calendar is already updated."}
      </span>
    </>
  );
  const className =
    "block rounded-[var(--work-radius-card)] border border-l-4 border-[color:var(--work-line)] border-l-[color:var(--mode-identity)] bg-[color:var(--work-surface)] px-4 py-3 text-sm";
  return href ? (
    <Link href={href} className={className} data-testid={`bookings-change-${course.id}`}>
      {body}
    </Link>
  ) : (
    <div className={className} data-testid={`bookings-change-${course.id}`}>
      {body}
    </div>
  );
}

/**
 * With Admin's example data off there is nothing to show yet: courses are
 * posted by organisers to a shared list, which is not switched on. Says so,
 * and offers the example so the reader can try the whole flow.
 */
export function BookingsNotSetUp({
  testId,
  organiser = false,
}: {
  readonly testId?: string;
  readonly organiser?: boolean;
}) {
  const { turnOn } = useExampleData("admin");
  return (
    <WorkCard padded testId={testId}>
      <p className="text-sm font-semibold text-[color:var(--text-heading)]">
        {organiser ? "Posting courses is not switched on yet" : "No courses are posted yet"}
      </p>
      <p className="mt-1 text-sm">
        {organiser
          ? "Courses you post will show to doctors to book, and go in their calendars. You can try it with example courses now."
          : "When Medical Education or your team posts a course or work requirement, it shows here to book, and goes in your calendar. You can try it with example courses now."}
      </p>
      <div className="mt-3 grid grid-cols-1">
        <WorkButton variant="secondary" icon={Sparkles} onClick={turnOn} testId="bookings-try-example">
          Try it with examples
        </WorkButton>
      </div>
    </WorkCard>
  );
}

/** Signed out with examples off: courses are shared records, so booking or posting needs an account. */
export function BookingsSignedOut({
  testId,
  organiser = false,
}: {
  readonly testId: string;
  readonly organiser?: boolean;
}) {
  const { turnOn } = useExampleData("admin");
  return (
    <div className="grid gap-3">
      <SignedOutSampleNotice title={organiser ? "Sign in to post courses" : "Sign in to book courses"} testId={testId}>
        {organiser
          ? "Courses you post show to doctors to book, and go in their calendars."
          : "Courses and work requirements posted for you show here to book, and go in your calendar."}{" "}
        Nothing is kept while you are signed out.
      </SignedOutSampleNotice>
      <WorkButton variant="secondary" icon={Sparkles} onClick={turnOn} testId={`${testId}-try-example`}>
        Try it with examples
      </WorkButton>
    </div>
  );
}
