"use client";

import {
  AlertTriangle,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Check,
  ClipboardList,
  Clock,
  RotateCcw,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";

import { PageTitleUnderBand } from "@/components/mode-band/mode-band";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import {
  WorkBody,
  WorkButton,
  WorkCard,
  WorkChip,
  WorkChips,
  WorkDateRow,
  WorkDock,
  WorkEmpty,
  WorkIconRow,
  WorkSectionLabel,
  WorkTag,
  useWorkUndoToast,
} from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { PaperworkFootNote, usePaperworkHeading } from "@/components/work-screens/admin/paperwork-shared";
import {
  BookingKeyValues,
  BookingsNotSetUp,
  BookingsSignedOut,
  BookingsSegment,
  CourseChangeNote,
  PlacesMeter,
} from "@/components/work-screens/admin/bookings-shared";
import { useBookings } from "@/components/work-screens/admin/use-bookings";
import { useCourseOrganiser } from "@/components/work-screens/admin/use-course-organiser";
import { downloadTextFile } from "@/lib/admin/download-file";
import { icsFileName, toIcs } from "@/lib/calendar/ics";
import { guardExampleAction } from "@/lib/example-data/guards";
import {
  bookingCalendarEvents,
  COURSE_KIND_LABELS,
  courseAvailability,
  courseById,
  courseDateTile,
  coursesForRenewals,
  daysAway,
  formatCourseDay,
  formatCourseLength,
  myBookings,
  myWaitlistPosition,
  OPEN_FILTERS,
  openCourses,
  ordinal,
  placesLeft,
  timeRange,
  waitlistFor,
  type BookingCourse,
  type BookingsState,
  type CourseAvailability,
  type OpenFilter,
} from "@/lib/work-screens/admin/bookings";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";

/**
 * Admin · Bookings (`/admin/bookings`, mockup "Admin bookings"). Courses and
 * work requirements an organiser posts, open to book, and the reader's own
 * bookings. A booked place goes straight into the reader's calendar (Roster's
 * Month and My Day's Week); cancelling takes it off and passes the place on.
 * `?view=mine` opens the reader's bookings and `?course=<id>` one course.
 */
export function AdminBookingsPage() {
  usePaperworkHeading("Bookings", "Courses and work requirements");
  const params = useSearchParams();
  const courseId = params.get("course");
  const view = params.get("view") === "mine" ? "mine" : "open";
  const bookings = useBookings();
  const { page } = bookings;

  return (
    <WorkBody testId="admin-bookings">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
        Bookings
      </PageTitleUnderBand>
      {page.status === "signed-out" ? (
        <BookingsSignedOut testId="admin-bookings-signed-out" />
      ) : page.status === "not-set-up" ? (
        <BookingsNotSetUp testId="admin-bookings-not-set-up" />
      ) : page.status === "error" ? (
        <WorkCard>
          <WorkEmpty
            icon={RotateCcw}
            title={bookings.examples ? "The example didn't load" : "Courses didn't load"}
            body="Check your connection, then try again."
            action={
              <WorkButton variant="secondary" onClick={page.retry} testId="admin-bookings-retry">
                Try again
              </WorkButton>
            }
            testId="admin-bookings-load-error"
          />
        </WorkCard>
      ) : page.status === "loading" ? (
        <ModeModuleSkeleton rows={5} twoLine eyebrow testId="admin-bookings-loading" />
      ) : courseId ? (
        <CourseDetail state={page.state} courseId={courseId} bookings={bookings} />
      ) : (
        <>
          <BookingsSegment
            current={view}
            items={[
              { id: "open", label: "Open to book", href: ADMIN_WORK_SCREEN_HREFS.bookings },
              { id: "mine", label: "My bookings", href: ADMIN_WORK_SCREEN_HREFS.myBookings },
            ]}
            label="Bookings"
          />
          {view === "mine" ? (
            <MyBookingsView state={page.state} today={bookings.today} />
          ) : (
            <OpenView state={page.state} today={bookings.today} />
          )}
        </>
      )}
    </WorkBody>
  );
}

/* ------------------------------------------------------------------ open to book */

function OpenView({ state, today }: { readonly state: BookingsState; readonly today: string }) {
  const [filter, setFilter] = useState<OpenFilter>("all");
  const { organiser, sample } = useCourseOrganiser();
  const forRenewals = useMemo(() => coursesForRenewals(state, today, state.renewalsDue ?? []), [state, today]);
  const open = useMemo(() => openCourses(state, today, filter), [state, today, filter]);
  const anyOpen = useMemo(() => openCourses(state, today).length > 0, [state, today]);

  return (
    <>
      {forRenewals.length ? (
        <>
          <WorkSectionLabel count={forRenewals.length}>For your renewals</WorkSectionLabel>
          <WorkCard testId="admin-bookings-renewals">
            {forRenewals.map((course) => (
              <CourseRow key={course.id} state={state} course={course} today={today} />
            ))}
            <WorkIconRow
              icon={AlertTriangle}
              tone="red"
              title="Matches a renewal"
              sub="Book a place to renew it"
              href="/admin/renewals"
            />
          </WorkCard>
        </>
      ) : null}

      {anyOpen ? (
        <>
          <WorkChips label="Show">
            {OPEN_FILTERS.map((item) => (
              <WorkChip
                key={item.id}
                selected={filter === item.id}
                onClick={() => setFilter(item.id)}
                testId={`admin-bookings-filter-${item.id}`}
              >
                {item.label}
              </WorkChip>
            ))}
          </WorkChips>
          <WorkSectionLabel count={open.length}>Open to book, soonest first</WorkSectionLabel>
          {open.length ? (
            <WorkCard testId="admin-bookings-open">
              {open.map((course) => (
                <CourseRow key={course.id} state={state} course={course} today={today} />
              ))}
            </WorkCard>
          ) : (
            <WorkCard>
              <WorkEmpty
                icon={ClipboardList}
                title="None match this filter"
                action={
                  <WorkButton variant="secondary" onClick={() => setFilter("all")} testId="admin-bookings-filter-clear">
                    Show all
                  </WorkButton>
                }
                testId="admin-bookings-filter-empty"
              />
            </WorkCard>
          )}
        </>
      ) : (
        <WorkCard>
          <WorkEmpty
            icon={CalendarDays}
            title="Nothing open to book"
            body="When a course or work requirement is posted, it shows here."
            testId="admin-bookings-empty"
          />
        </WorkCard>
      )}

      <WorkCard>
        <WorkIconRow
          icon={CalendarCheck}
          title="Every booking goes in your calendar"
          sub="Roster Month and My Day Week, updated if it changes"
          href="/roster"
          leadsTo="roster"
        />
        {organiser || sample ? (
          <WorkIconRow
            icon={Users}
            title={sample ? "The organiser's side" : "Courses you post"}
            sub={sample ? "Example, to see how posting works" : "Post, edit and see who is booked"}
            href={ADMIN_WORK_SCREEN_HREFS.courses}
            testId="admin-bookings-organiser-link"
          />
        ) : null}
      </WorkCard>
      <PaperworkFootNote>Places and times come from the organiser</PaperworkFootNote>
    </>
  );
}

function CourseRow({
  state,
  course,
  today,
}: {
  readonly state: BookingsState;
  readonly course: BookingCourse;
  readonly today: string;
}) {
  const tile = courseDateTile(course.date);
  const availability = courseAvailability(state, course, today);
  return (
    <WorkDateRow
      month={tile.month}
      day={tile.day}
      title={course.title}
      sub={
        <>
          {formatCourseDay(course.date)}, {timeRange(course)}, {course.location}
          <PlacesMeter state={state} course={course} />
        </>
      }
      end={<AvailabilityTag availability={availability} state={state} course={course} />}
      href={ADMIN_WORK_SCREEN_HREFS.bookingCourse(course.id)}
      testId={`admin-bookings-course-${course.id}`}
    />
  );
}

function AvailabilityTag({
  availability,
  state,
  course,
}: {
  readonly availability: CourseAvailability;
  readonly state: BookingsState;
  readonly course: BookingCourse;
}) {
  switch (availability) {
    case "booked":
      return <WorkTag tone="green">Booked</WorkTag>;
    case "waitlisted":
      return <WorkTag tone="amber">{ordinal(myWaitlistPosition(state, course.id) ?? 1)} in line</WorkTag>;
    case "waitlist":
      return <WorkTag tone="amber">Waitlist</WorkTag>;
    case "full":
      return <WorkTag tone="neutral">Full</WorkTag>;
    case "closed":
      return <WorkTag tone="neutral">Closed</WorkTag>;
    case "book":
      return <WorkTag>Book</WorkTag>;
    case "cancelled":
      return <WorkTag tone="neutral">Cancelled</WorkTag>;
    case "started":
      return <WorkTag tone="neutral">Started</WorkTag>;
    default:
      return <WorkTag tone="neutral">Done</WorkTag>;
  }
}

/* ------------------------------------------------------------------ my bookings */

function MyBookingsView({ state, today }: { readonly state: BookingsState; readonly today: string }) {
  const mine = useMemo(() => myBookings(state, today), [state, today]);
  const nothing = !mine.booked.length && !mine.waitlisted.length && !mine.earlier.length;
  if (nothing)
    return (
      <WorkCard>
        <WorkEmpty
          icon={CalendarPlus}
          title="No bookings yet"
          body="Book a course and it shows here and in your calendar."
          action={
            <WorkButton href={ADMIN_WORK_SCREEN_HREFS.bookings} testId="admin-bookings-mine-browse">
              See what&apos;s open
            </WorkButton>
          }
          testId="admin-bookings-mine-empty"
        />
      </WorkCard>
    );
  return (
    <>
      {mine.changed.length ? (
        <>
          <WorkSectionLabel>Changed by the organiser</WorkSectionLabel>
          {mine.changed.map((course) => (
            <CourseChangeNote key={course.id} course={course} href={ADMIN_WORK_SCREEN_HREFS.bookingCourse(course.id)} />
          ))}
        </>
      ) : null}
      <WorkSectionLabel count={mine.booked.length}>Booked</WorkSectionLabel>
      {mine.booked.length ? (
        <WorkCard testId="admin-bookings-mine-booked">
          {mine.booked.map((course) => {
            const tile = courseDateTile(course.date);
            return (
              <WorkDateRow
                key={course.id}
                month={tile.month}
                day={tile.day}
                title={course.title}
                sub={`${timeRange(course)}, ${daysAway(course.date, today).toLowerCase()}`}
                end={<WorkTag tone="green">In calendar</WorkTag>}
                href={ADMIN_WORK_SCREEN_HREFS.bookingCourse(course.id)}
                testId={`admin-bookings-mine-${course.id}`}
              />
            );
          })}
        </WorkCard>
      ) : (
        <WorkCard padded>
          <p className="text-sm text-[color:var(--text-muted)]">Nothing booked ahead.</p>
        </WorkCard>
      )}
      {mine.waitlisted.length ? (
        <>
          <WorkSectionLabel count={mine.waitlisted.length}>Waitlist</WorkSectionLabel>
          <WorkCard testId="admin-bookings-mine-waitlist">
            {mine.waitlisted.map((course) => {
              const tile = courseDateTile(course.date);
              const position = myWaitlistPosition(state, course.id) ?? 1;
              return (
                <WorkDateRow
                  key={course.id}
                  month={tile.month}
                  day={tile.day}
                  title={course.title}
                  sub={`${ordinal(position)} in line, booked if a place opens`}
                  end={<WorkTag tone="amber">Waiting</WorkTag>}
                  href={ADMIN_WORK_SCREEN_HREFS.bookingCourse(course.id)}
                />
              );
            })}
          </WorkCard>
        </>
      ) : null}
      {mine.earlier.length ? (
        <>
          <WorkSectionLabel>Earlier</WorkSectionLabel>
          <WorkCard testId="admin-bookings-mine-earlier">
            {mine.earlier.map(({ course, status }) => {
              const tile = courseDateTile(course.date);
              const words =
                status === "course-cancelled"
                  ? "The organiser cancelled it"
                  : status === "cancelled"
                    ? "You cancelled"
                    : status === "attended"
                      ? "Attended"
                      : "Booked";
              return (
                <WorkDateRow
                  key={course.id}
                  month={tile.month}
                  day={tile.day}
                  title={course.title}
                  sub={words}
                  end={
                    <WorkTag tone="neutral">
                      {status === "attended" || status === "booked" ? "Done" : "Cancelled"}
                    </WorkTag>
                  }
                  href={ADMIN_WORK_SCREEN_HREFS.bookingCourse(course.id)}
                />
              );
            })}
          </WorkCard>
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ one course */

type SheetKind = "book" | "waitlist" | "cancel" | "leave" | null;

function CourseDetail({
  state,
  courseId,
  bookings,
}: {
  readonly state: BookingsState;
  readonly courseId: string;
  readonly bookings: ReturnType<typeof useBookings>;
}) {
  const { today, examples, online } = bookings;
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useWorkUndoToast();
  const course = courseById(state, courseId);

  if (!course || course.status === "draft")
    return (
      <WorkCard>
        <WorkEmpty
          icon={CalendarDays}
          title="This course isn't open"
          body="It may have been removed by the organiser."
          action={
            <WorkButton href={ADMIN_WORK_SCREEN_HREFS.bookings} testId="admin-bookings-missing-back">
              All bookings
            </WorkButton>
          }
          testId="admin-bookings-missing"
        />
      </WorkCard>
    );

  const availability = courseAvailability(state, course, today);
  const left = placesLeft(state, course);
  const waiting = waitlistFor(state, course.id).length;
  const position = myWaitlistPosition(state, course.id);
  const blocked = (!online && !examples) || busy;

  const say = (message: string, undo?: () => void) => {
    // The toast carries the message, and Undo for an example. Without one (a bare render), say it on the page.
    if (!toast) {
      setNotice(message);
      return;
    }
    setNotice(null);
    toast(
      message,
      undo
        ? () => {
            undo();
            setNotice(null);
          }
        : undefined,
    );
  };

  const confirmBook = async () => {
    setSheet(null);
    setBusy(true);
    const result = await bookings.book(course.id);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    say(
      result.outcome === "booked"
        ? "Booked and added to your calendar"
        : `On the waitlist, ${ordinal(result.position ?? 1)} in line`,
      result.undo,
    );
  };

  const confirmCancel = async () => {
    setSheet(null);
    setBusy(true);
    const result = await bookings.cancelBooking(course.id);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    say(
      result.left === "waitlisted" ? "You left the waitlist" : "Booking cancelled and taken off your calendar",
      result.undo,
    );
  };

  const addToPhone = () => {
    if (!guardExampleAction(examples, "export")) return;
    const events = bookingCalendarEvents(state, (id) => ADMIN_WORK_SCREEN_HREFS.bookingCourse(id)).filter(
      (event) => event.title === course.title && event.date === course.date,
    );
    downloadTextFile(toIcs(events, { name: course.title }), icsFileName(course.title), "text/calendar;charset=utf-8");
  };

  const inCalendar = availability === "booked" || availability === "attended";

  return (
    <>
      <Link
        href={
          availability === "booked" || availability === "waitlisted"
            ? ADMIN_WORK_SCREEN_HREFS.myBookings
            : ADMIN_WORK_SCREEN_HREFS.bookings
        }
        className="inline-flex min-h-12 items-center text-sm font-semibold text-[color:var(--mode-identity-deep)]"
        data-testid="admin-bookings-back"
      >
        All bookings
      </Link>
      <WorkCard padded testId="admin-bookings-detail">
        <p className="text-xs font-bold tracking-wide text-[color:var(--text-muted)] uppercase">
          {COURSE_KIND_LABELS[course.kind]}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-[color:var(--text-heading)]">{course.title}</h2>
        <p className="mt-1 text-base font-semibold text-[color:var(--text-heading)]">{formatCourseDay(course.date)}</p>
        <p className="text-sm text-[color:var(--text-muted)]">
          {timeRange(course)}, {formatCourseLength(course)}
        </p>
        <PlacesMeter state={state} course={course} />
        {availability === "book" ? null : (
          <div className="mt-3 flex flex-wrap gap-2">
            <AvailabilityTag availability={availability} state={state} course={course} />
          </div>
        )}
      </WorkCard>

      {course.change && (inCalendar || availability === "cancelled") ? <CourseChangeNote course={course} /> : null}

      {notice ? (
        <p
          role="status"
          className="text-sm font-semibold text-[color:var(--text-heading)]"
          data-testid="admin-bookings-notice"
        >
          {notice}
        </p>
      ) : null}

      <BookingKeyValues
        rows={[
          ["Where", course.location],
          ["Run by", course.organiser],
          ["Booking closes", course.closesOn ? formatCourseDay(course.closesOn) : "When it starts"],
          ["Places", `${course.capacity}${course.waitlist ? ", waitlist when full" : ""}`],
          ...(course.renewal ? ([["Counts for", sentenceCase(course.renewal)]] as const) : []),
        ]}
      />

      {course.about ? (
        <>
          <WorkSectionLabel>About</WorkSectionLabel>
          <WorkCard padded>
            <p className="text-sm leading-6">{course.about}</p>
          </WorkCard>
        </>
      ) : null}

      <WorkCard>
        {inCalendar ? (
          <>
            <WorkIconRow
              icon={CalendarCheck}
              tone="green"
              title="In your calendar"
              sub="Roster Month and My Day Week"
              href="/roster"
              leadsTo="roster"
            />
            <WorkIconRow
              icon={CalendarPlus}
              title="Add to your phone's calendar"
              sub="A calendar file, updated if you download again"
              onClick={addToPhone}
              testId="admin-bookings-ics"
            />
          </>
        ) : (
          <WorkIconRow
            icon={CalendarDays}
            title="Goes in your calendar"
            sub="Added when you book, taken off if you cancel"
            end={null}
          />
        )}
      </WorkCard>

      <AvailabilityNote availability={availability} position={position} waiting={waiting} left={left} />

      {availability === "book" || availability === "waitlist" ? (
        <WorkDock>
          <WorkButton
            icon={availability === "book" ? Check : UserPlus}
            disabled={blocked}
            onClick={() => setSheet(availability === "book" ? "book" : "waitlist")}
            testId="admin-bookings-book"
          >
            {availability === "book" ? "Book a place" : "Join the waitlist"}
          </WorkButton>
        </WorkDock>
      ) : availability === "booked" || availability === "waitlisted" ? (
        <WorkDock>
          <WorkButton
            variant="secondary"
            icon={X}
            disabled={blocked}
            onClick={() => setSheet(availability === "booked" ? "cancel" : "leave")}
            testId="admin-bookings-cancel"
          >
            {availability === "booked" ? "Cancel booking" : "Leave the waitlist"}
          </WorkButton>
        </WorkDock>
      ) : null}
      {blocked ? <PaperworkFootNote>Booking needs a connection</PaperworkFootNote> : null}

      {sheet === "book" ? (
        <Sheet
          open
          onClose={() => setSheet(null)}
          title="Book this place?"
          description={course.title}
          testId="admin-bookings-book-sheet"
          footer={
            <WorkButton
              size="wide"
              icon={Check}
              onClick={() => void confirmBook()}
              testId="admin-bookings-book-confirm"
            >
              Book my place
            </WorkButton>
          }
        >
          <BookingKeyValues
            rows={[
              ["When", `${formatCourseDay(course.date)}, ${timeRange(course)}`],
              ["Where", course.location],
            ]}
          />
          <SheetPoint icon={CalendarCheck}>It goes in your calendar straight away.</SheetPoint>
          <SheetPoint icon={Clock}>You can cancel any time before it starts.</SheetPoint>
        </Sheet>
      ) : null}

      {sheet === "waitlist" ? (
        <Sheet
          open
          onClose={() => setSheet(null)}
          title="Join the waitlist?"
          description={`${course.title}, ${formatCourseDay(course.date)}`}
          testId="admin-bookings-waitlist-sheet"
          footer={
            <WorkButton
              size="wide"
              icon={UserPlus}
              onClick={() => void confirmBook()}
              testId="admin-bookings-waitlist-confirm"
            >
              Join the waitlist
            </WorkButton>
          }
        >
          <p className="text-base font-semibold text-[color:var(--text-heading)]">
            You would be {ordinal(waiting + 1)}
          </p>
          <p className="text-sm text-[color:var(--text-muted)]">
            {course.capacity} places, all taken. {waiting === 1 ? "1 person is" : `${waiting} people are`} waiting.
          </p>
          <SheetPoint icon={CalendarCheck}>
            If a place opens you are booked straight away and it goes in your calendar.
          </SheetPoint>
        </Sheet>
      ) : null}

      {sheet === "cancel" || sheet === "leave" ? (
        <Sheet
          open
          onClose={() => setSheet(null)}
          title={sheet === "cancel" ? "Cancel this booking?" : "Leave the waitlist?"}
          description={`${course.title}, ${formatCourseDay(course.date)}`}
          testId="admin-bookings-cancel-sheet"
          footer={
            <div className="grid gap-2">
              <WorkButton
                size="wide"
                variant="amber"
                onClick={() => void confirmCancel()}
                testId="admin-bookings-cancel-confirm"
              >
                {sheet === "cancel" ? "Cancel booking" : "Leave the waitlist"}
              </WorkButton>
              <WorkButton
                size="wide"
                variant="quiet"
                onClick={() => setSheet(null)}
                testId="admin-bookings-cancel-keep"
              >
                Keep it
              </WorkButton>
            </div>
          }
        >
          {sheet === "cancel" ? (
            <>
              <SheetPoint icon={CalendarDays}>It comes off your calendar.</SheetPoint>
              <SheetPoint icon={Users}>
                {waiting ? "Your place goes to the next person waiting." : "Your place opens for someone else."}
              </SheetPoint>
            </>
          ) : (
            <SheetPoint icon={Users}>You lose your place in line.</SheetPoint>
          )}
        </Sheet>
      ) : null}
    </>
  );
}

function AvailabilityNote({
  availability,
  position,
  waiting,
  left,
}: {
  readonly availability: CourseAvailability;
  readonly position: number | null;
  readonly waiting: number;
  readonly left: number;
}) {
  const words: Partial<Record<CourseAvailability, string>> = {
    book: left === 1 ? "1 place left." : undefined,
    waitlist: `It's full. ${waiting ? `${waiting} waiting.` : "No one is waiting yet."}`,
    full: "It's full and has no waitlist.",
    closed: "Booking has closed.",
    started: "This has started or finished.",
    cancelled: "The organiser cancelled this. It is off your calendar.",
    waitlisted: `You're ${ordinal(position ?? 1)} in line. If a place opens you're booked and it goes in your calendar.`,
    attended: "You went to this.",
  };
  const text = words[availability];
  if (!text) return null;
  return (
    <p className="px-1 text-sm text-[color:var(--text-muted)]" data-testid="admin-bookings-availability">
      {text}
    </p>
  );
}

function SheetPoint({ icon: Icon, children }: { readonly icon: typeof Check; readonly children: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-sm">
      <Icon
        aria-hidden="true"
        strokeWidth={2}
        className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--mode-identity)]"
      />
      <span>{children}</span>
    </p>
  );
}

function sentenceCase(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
