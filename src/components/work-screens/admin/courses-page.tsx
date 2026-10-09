"use client";

import { Ban, CalendarDays, Check, Pencil, Plus, RotateCcw, Save, Send, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

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
import {
  PaperworkField,
  PaperworkFootNote,
  usePaperworkHeading,
} from "@/components/work-screens/admin/paperwork-shared";
import { BookingsNotSetUp, PlacesMeter } from "@/components/work-screens/admin/bookings-shared";
import { useBookings, useCourseOrganiser } from "@/components/work-screens/admin/use-bookings";
import { guardExampleAction } from "@/lib/example-data/guards";
import {
  BLANK_COURSE_DRAFT,
  bookedFor,
  cancelCourse,
  COURSE_ABOUT_MAX,
  COURSE_KIND_LABELS,
  COURSE_LOCATION_MAX,
  COURSE_TITLE_MAX,
  courseById,
  courseDateTile,
  draftChanges,
  draftFromCourse,
  editCourse,
  formatCourseDay,
  formatCourseLength,
  hasDraftErrors,
  organiserCourses,
  postCourse,
  timeRange,
  validateCourseDraft,
  waitlistFor,
  type BookingCourse,
  type BookingsState,
  type CourseDraft,
  type CourseDraftErrors,
  type CourseKind,
} from "@/lib/work-screens/admin/bookings";
import { freshBookingsId } from "@/lib/work-screens/admin/bookings-store";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";

const EXAMPLE_ORGANISER = "Medical Education";

/**
 * Admin · Courses (`/admin/courses`), the organiser's side of Bookings. An
 * organiser posts a course or work requirement, sees who is booked and who is
 * waiting, edits it (every booked doctor's calendar follows) or cancels it.
 * `?new=1` opens the post form and `?course=<id>` one course. With Admin's
 * example data on, anyone can see this side as a labelled example.
 */
export function AdminCoursesPage() {
  usePaperworkHeading("Courses", "Post and manage bookings");
  const params = useSearchParams();
  const courseId = params.get("course");
  const posting = params.get("new") === "1";
  const bookings = useBookings();
  const { organiser, sample } = useCourseOrganiser();
  const { page } = bookings;

  return (
    <WorkBody testId="admin-courses">
      <PageTitleUnderBand className="text-2xl font-semibold text-[color:var(--text-heading)]">
        Courses
      </PageTitleUnderBand>
      {page.status === "not-set-up" ? (
        <BookingsNotSetUp organiser testId="admin-courses-not-set-up" />
      ) : page.status === "error" ? (
        <WorkCard>
          <WorkEmpty
            icon={RotateCcw}
            title="The example didn't load"
            body="Check your connection, then try again."
            action={
              <WorkButton variant="secondary" onClick={page.retry} testId="admin-courses-retry">
                Try again
              </WorkButton>
            }
            testId="admin-courses-load-error"
          />
        </WorkCard>
      ) : page.status === "loading" ? (
        <ModeModuleSkeleton rows={5} twoLine eyebrow testId="admin-courses-loading" />
      ) : (
        <>
          {sample && !organiser && !posting && !courseId ? (
            <WorkCard padded testId="admin-courses-sample">
              <p className="text-sm font-semibold text-[color:var(--text-heading)]">
                This is the organiser&apos;s side
              </p>
              <p className="mt-1 text-sm">
                Medical Education or a team manager posts courses here. You are seeing it with example courses, so you
                can try posting, editing and cancelling.
              </p>
            </WorkCard>
          ) : null}
          {posting ? (
            <CourseForm key="new" state={page.state} bookings={bookings} course={null} />
          ) : courseId ? (
            <OrganiserCourse key={courseId} state={page.state} courseId={courseId} bookings={bookings} />
          ) : (
            <CourseList state={page.state} today={bookings.today} />
          )}
        </>
      )}
    </WorkBody>
  );
}

/* ------------------------------------------------------------------ list */

function CourseList({ state, today }: { readonly state: BookingsState; readonly today: string }) {
  const { drafts, upcoming, past, full } = useMemo(() => organiserCourses(state, today), [state, today]);
  const needs = full.length + drafts.length;
  return (
    <>
      {needs ? (
        <>
          <WorkSectionLabel count={needs}>Needs you</WorkSectionLabel>
          <WorkCard testId="admin-courses-needs">
            {full.map((course) => (
              <WorkIconRow
                key={course.id}
                icon={Users}
                tone="amber"
                title={`${course.title} is full`}
                sub={`${waitlistFor(state, course.id).length} waiting. Add places or a second date.`}
                href={ADMIN_WORK_SCREEN_HREFS.organiserCourse(course.id)}
              />
            ))}
            {drafts.map((course) => (
              <WorkIconRow
                key={course.id}
                icon={Pencil}
                tone="neutral"
                title={`Draft: ${course.title}`}
                sub="Not posted yet"
                href={ADMIN_WORK_SCREEN_HREFS.organiserCourse(course.id)}
              />
            ))}
          </WorkCard>
        </>
      ) : null}
      <WorkSectionLabel count={upcoming.length}>Posted, soonest first</WorkSectionLabel>
      {upcoming.length ? (
        <WorkCard testId="admin-courses-upcoming">
          {upcoming.map((course) => (
            <OrganiserRow key={course.id} state={state} course={course} upcoming />
          ))}
        </WorkCard>
      ) : (
        <WorkCard>
          <WorkEmpty
            icon={CalendarDays}
            title="Nothing posted ahead"
            body="Post a course and doctors can book it straight away."
            testId="admin-courses-empty"
          />
        </WorkCard>
      )}
      {past.length ? (
        <>
          <WorkSectionLabel>Earlier and cancelled</WorkSectionLabel>
          <WorkCard testId="admin-courses-past">
            {past.map((course) => (
              <OrganiserRow key={course.id} state={state} course={course} />
            ))}
          </WorkCard>
        </>
      ) : null}
      <PaperworkFootNote>Doctors see the course, places and times. Never add patient details.</PaperworkFootNote>
      <WorkDock>
        <WorkButton icon={Plus} href={ADMIN_WORK_SCREEN_HREFS.postCourse} testId="admin-courses-post">
          Post a course
        </WorkButton>
      </WorkDock>
    </>
  );
}

function OrganiserRow({
  state,
  course,
  upcoming = false,
}: {
  readonly state: BookingsState;
  readonly course: BookingCourse;
  readonly upcoming?: boolean;
}) {
  const tile = courseDateTile(course.date);
  const booked = bookedFor(state, course.id).length;
  return (
    <WorkDateRow
      month={tile.month}
      day={tile.day}
      title={course.title}
      sub={
        <>
          {timeRange(course)}, {booked} booked
          {upcoming ? <PlacesMeter state={state} course={course} /> : null}
        </>
      }
      end={
        course.status === "cancelled" ? (
          <WorkTag tone="neutral">Cancelled</WorkTag>
        ) : course.status === "draft" ? (
          <WorkTag tone="neutral">Draft</WorkTag>
        ) : undefined
      }
      href={ADMIN_WORK_SCREEN_HREFS.organiserCourse(course.id)}
      testId={`admin-courses-row-${course.id}`}
    />
  );
}

/* ------------------------------------------------------------------ one course */

function OrganiserCourse({
  state,
  courseId,
  bookings,
}: {
  readonly state: BookingsState;
  readonly courseId: string;
  readonly bookings: ReturnType<typeof useBookings>;
}) {
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const toast = useWorkUndoToast();
  const course = courseById(state, courseId);

  if (!course)
    return (
      <WorkCard>
        <WorkEmpty
          icon={CalendarDays}
          title="This course isn't here"
          action={
            <WorkButton href={ADMIN_WORK_SCREEN_HREFS.courses} testId="admin-courses-missing-back">
              All courses
            </WorkButton>
          }
          testId="admin-courses-missing"
        />
      </WorkCard>
    );

  if (editing)
    return (
      <CourseForm
        state={state}
        bookings={bookings}
        course={course}
        onDone={() => setEditing(false)}
        onSaved={setNotice}
      />
    );

  const booked = bookedFor(state, course.id);
  const waiting = waitlistFor(state, course.id);
  const live = course.status !== "cancelled";

  const confirmCancel = () => {
    const previous = state;
    const result = cancelCourse(state, course.id, { at: new Date().toISOString() });
    setCancelling(false);
    if (!result) return;
    bookings.update(result.state);
    const message =
      result.calendarsUpdated > 0
        ? `Cancelled and taken off ${calendars(result.calendarsUpdated)}`
        : course.status === "draft"
          ? "Draft removed"
          : "Course cancelled";
    if (!toast) setNotice(message);
    toast?.(message, () => {
      bookings.update(previous);
      setNotice(null);
    });
  };

  return (
    <>
      <Link
        href={ADMIN_WORK_SCREEN_HREFS.courses}
        className="inline-flex min-h-12 items-center text-sm font-semibold text-[color:var(--mode-identity-deep)]"
        data-testid="admin-courses-back"
      >
        All courses
      </Link>
      <WorkCard padded testId="admin-courses-detail">
        <p className="text-xs font-bold tracking-wide text-[color:var(--text-muted)] uppercase">
          {COURSE_KIND_LABELS[course.kind]}
          {course.status === "draft" ? ", draft" : course.status === "cancelled" ? ", cancelled" : ""}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-[color:var(--text-heading)]">{course.title}</h2>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">
          {formatCourseDay(course.date)}, {timeRange(course)}, {course.location}
        </p>
        {course.status === "posted" ? <PlacesMeter state={state} course={course} /> : null}
      </WorkCard>

      {notice ? (
        <p
          role="status"
          className="text-sm font-semibold text-[color:var(--text-heading)]"
          data-testid="admin-courses-notice"
        >
          {notice}
        </p>
      ) : null}

      <WorkSectionLabel count={booked.length}>Booked</WorkSectionLabel>
      <PeopleCard
        people={booked.map((booking) => ({
          id: booking.id,
          name: booking.self ? `${booking.person} (you)` : booking.person,
          sub: booking.status === "attended" ? "Attended" : `Booked ${shortDate(booking.at)}`,
        }))}
        empty="No one has booked yet."
        testId="admin-courses-booked"
      />
      {course.waitlist ? (
        <>
          <WorkSectionLabel count={waiting.length}>Waitlist</WorkSectionLabel>
          <PeopleCard
            people={waiting.map((booking, index) => ({
              id: booking.id,
              name: booking.self ? `${booking.person} (you)` : booking.person,
              sub: `${index + 1} in line, joined ${shortDate(booking.at)}`,
            }))}
            empty="No one waiting."
            testId="admin-courses-waitlist"
          />
        </>
      ) : null}

      {live ? (
        <WorkCard>
          <WorkIconRow
            icon={Pencil}
            title={course.status === "draft" ? "Edit and post" : "Edit time, place or places"}
            sub={
              course.status === "posted" && booked.length
                ? `Changes update ${calendars(booked.length)}`
                : "Doctors see the change straight away"
            }
            onClick={() => setEditing(true)}
            testId="admin-courses-edit"
          />
          <WorkIconRow
            icon={Users}
            title="Export who is booked"
            sub="Spreadsheet of names and status"
            onClick={() => guardExampleAction(bookings.examples, "export")}
            testId="admin-courses-export"
          />
          <WorkIconRow
            icon={Ban}
            tone="red"
            title={course.status === "draft" ? "Delete this draft" : "Cancel this course"}
            sub={
              course.status === "posted" && booked.length
                ? `Takes it off ${calendars(booked.length)} and tells them`
                : "No one is booked"
            }
            onClick={() => setCancelling(true)}
            testId="admin-courses-cancel"
          />
        </WorkCard>
      ) : (
        <PaperworkFootNote>Cancelled. Booked doctors were told and it is off their calendars.</PaperworkFootNote>
      )}

      {cancelling ? (
        <Sheet
          open
          onClose={() => setCancelling(false)}
          title={course.status === "draft" ? "Delete this draft?" : "Cancel this course?"}
          description={`${course.title}, ${formatCourseDay(course.date)}`}
          testId="admin-courses-cancel-sheet"
          footer={
            <div className="grid gap-2">
              <WorkButton
                size="wide"
                variant="amber"
                icon={Ban}
                onClick={confirmCancel}
                testId="admin-courses-cancel-confirm"
              >
                {course.status === "draft"
                  ? "Delete draft"
                  : booked.length
                    ? `Cancel for ${people(booked.length)}`
                    : "Cancel course"}
              </WorkButton>
              <WorkButton
                size="wide"
                variant="quiet"
                onClick={() => setCancelling(false)}
                testId="admin-courses-cancel-keep"
              >
                Keep it
              </WorkButton>
            </div>
          }
        >
          <p className="text-sm">
            {booked.length
              ? `${people(booked.length)} booked. It comes off their calendars and they get an alert.`
              : "No one has booked, so no one is told."}
          </p>
        </Sheet>
      ) : null}
    </>
  );
}

function PeopleCard({
  people: list,
  empty,
  testId,
}: {
  readonly people: readonly { readonly id: string; readonly name: string; readonly sub: string }[];
  readonly empty: string;
  readonly testId: string;
}) {
  if (!list.length)
    return (
      <WorkCard padded testId={testId}>
        <p className="text-sm text-[color:var(--text-muted)]">{empty}</p>
      </WorkCard>
    );
  return (
    <WorkCard as="ul" testId={testId}>
      {list.map((person) => (
        <li
          key={person.id}
          className="flex min-h-12 items-center gap-3 border-t border-[color:var(--work-line)] px-4 py-2 first:border-t-0"
        >
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-[color:var(--work-wash)] text-xs font-bold text-[color:var(--text-muted)]"
          >
            {initials(person.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[color:var(--text-heading)]">{person.name}</span>
            <span className="block text-xs text-[color:var(--text-muted)]">{person.sub}</span>
          </span>
        </li>
      ))}
    </WorkCard>
  );
}

/* ------------------------------------------------------------------ post or edit */

function CourseForm({
  state,
  bookings,
  course,
  onDone,
  onSaved,
}: {
  readonly state: BookingsState;
  readonly bookings: ReturnType<typeof useBookings>;
  readonly course: BookingCourse | null;
  readonly onDone?: () => void;
  readonly onSaved?: (message: string) => void;
}) {
  const router = useRouter();
  const toast = useWorkUndoToast();
  const [draft, setDraft] = useState<CourseDraft>(() => (course ? draftFromCourse(course) : BLANK_COURSE_DRAFT));
  const [errors, setErrors] = useState<CourseDraftErrors>({});
  const [confirm, setConfirm] = useState<{ changes: readonly string[]; post: boolean } | null>(null);
  const booked = course ? bookedFor(state, course.id).length : 0;
  const set = <K extends keyof CourseDraft>(key: K, value: CourseDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const check = (): boolean => {
    const found = validateCourseDraft(draft, {
      today: bookings.today,
      booked,
      savedClosesOn: course?.closesOn ?? null,
    });
    const clean = Object.fromEntries(Object.entries(found).filter(([, value]) => value)) as CourseDraftErrors;
    setErrors(clean);
    const ok = !hasDraftErrors(clean);
    if (!ok)
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[data-testid="admin-courses-form-body"] [aria-invalid="true"]')?.focus();
      }, 0);
    return ok;
  };

  const save = (post: boolean) => {
    if (!check()) return;
    const at = new Date().toISOString();
    const previous = state;
    if (!course) {
      const id = freshBookingsId("course", bookings.examples);
      bookings.update(
        postCourse(state, draft, { id, at, organiser: EXAMPLE_ORGANISER, status: post ? "posted" : "draft" }),
      );
      toast?.(post ? "Posted. Doctors can book it now." : "Saved as a draft", () => bookings.update(previous));
      router.push(ADMIN_WORK_SCREEN_HREFS.organiserCourse(id));
      return;
    }
    const moving = course.status === "posted" && booked > 0;
    const changes = draftChanges(course, draft);
    if (moving && changes.length && !confirm) {
      setConfirm({ changes, post });
      return;
    }
    finishEdit(post);
  };

  const finishEdit = (post: boolean) => {
    if (!course) return;
    const previous = state;
    const result = editCourse(state, course.id, draft, {
      at: new Date().toISOString(),
      post: post && course.status === "draft",
    });
    setConfirm(null);
    if (!result) return;
    bookings.update(result.state);
    const parts = [
      result.calendarsUpdated ? `Saved and updated ${calendars(result.calendarsUpdated)}` : "Saved",
      result.promoted ? `${people(result.promoted)} moved off the waitlist` : null,
    ].filter(Boolean);
    const message = parts.join(". ");
    if (!toast) onSaved?.(message);
    toast?.(message, () => bookings.update(previous));
    onDone?.();
  };

  const length = formatCourseLength(draft);
  const draftCourse = course?.status === "draft";
  const preview = draft.title.trim() || "Course title";

  return (
    <div className="contents" data-testid="admin-courses-form-body">
      <WorkCard padded testId="admin-courses-form">
        <Step n={1} label="What" />
        <WorkChips label="Kind">
          {(Object.keys(COURSE_KIND_LABELS) as CourseKind[]).map((kind) => (
            <WorkChip
              key={kind}
              selected={draft.kind === kind}
              onClick={() => set("kind", kind)}
              testId={`admin-courses-kind-${kind}`}
            >
              {COURSE_KIND_LABELS[kind]}
            </WorkChip>
          ))}
        </WorkChips>
        <div className="mt-3 grid gap-3">
          <PaperworkField
            label="Title"
            value={draft.title}
            onChange={(value) => set("title", value)}
            maxLength={COURSE_TITLE_MAX}
            error={errors.title}
            checkPatient
            testId="admin-courses-title"
          />
          <PaperworkField
            label="About, optional"
            value={draft.about}
            onChange={(value) => set("about", value)}
            maxLength={COURSE_ABOUT_MAX}
            hint="Who it is for and what to bring"
            error={errors.about}
            checkPatient
            multiline
            testId="admin-courses-about"
          />
          <PaperworkField
            label="Counts for a renewal, optional"
            value={draft.renewal}
            onChange={(value) => set("renewal", value)}
            maxLength={60}
            hint="Such as Basic life support. Doctors with that renewal due see it first."
            testId="admin-courses-renewal"
          />
        </div>
      </WorkCard>

      <WorkCard padded>
        <Step n={2} label="When" extra={length || undefined} />
        <div className="mt-3 grid gap-3">
          <PaperworkField
            label="Day"
            type="date"
            value={draft.date}
            onChange={(value) => set("date", value)}
            min={bookings.today}
            error={errors.date}
            testId="admin-courses-date"
          />
          <div className="grid grid-cols-2 gap-3">
            <PaperworkField
              label="Starts"
              type="time"
              value={draft.startTime}
              onChange={(value) => set("startTime", value)}
              error={errors.startTime}
              testId="admin-courses-start"
            />
            <PaperworkField
              label="Ends"
              type="time"
              value={draft.endTime}
              onChange={(value) => set("endTime", value)}
              error={errors.endTime}
              testId="admin-courses-end"
            />
          </div>
        </div>
      </WorkCard>

      <WorkCard padded>
        <Step n={3} label="Where and places" />
        <div className="mt-3 grid gap-3">
          <PaperworkField
            label="Where"
            value={draft.location}
            onChange={(value) => set("location", value)}
            maxLength={COURSE_LOCATION_MAX}
            error={errors.location}
            checkPatient
            testId="admin-courses-location"
          />
          <div className="grid gap-3">
            <PaperworkField
              label="Places"
              type="number"
              inputMode="numeric"
              min="1"
              value={draft.capacity}
              onChange={(value) => set("capacity", value)}
              error={errors.capacity}
              hint={booked ? `${booked} booked now` : undefined}
              testId="admin-courses-capacity"
            />
            <PaperworkField
              label="Booking closes, optional"
              type="date"
              value={draft.closesOn}
              onChange={(value) => set("closesOn", value)}
              min={course?.closesOn && course.closesOn < bookings.today ? course.closesOn : bookings.today}
              max={draft.date || undefined}
              error={errors.closesOn}
              testId="admin-courses-closes"
            />
          </div>
          <label className="flex min-h-12 items-center justify-between gap-3 border-t border-[color:var(--work-line)] pt-3">
            <span>
              <span className="block text-sm font-semibold text-[color:var(--text-heading)]">Waitlist when full</span>
              <span className="block text-xs text-[color:var(--text-muted)]">
                The next person is booked when a place opens
              </span>
            </span>
            <input
              type="checkbox"
              aria-label="Waitlist when full"
              className="size-6 shrink-0 accent-[color:var(--mode-identity)]"
              checked={draft.waitlist}
              onChange={(event) => set("waitlist", event.target.checked)}
              data-testid="admin-courses-waitlist-toggle"
            />
          </label>
        </div>
      </WorkCard>

      <WorkCard padded>
        <Step n={4} label="What doctors see" />
        <div className="mt-3 rounded-[var(--work-radius-field)] border border-[color:var(--work-line)] px-3 py-2.5">
          <p className="text-3xs font-bold tracking-widest text-[color:var(--text-muted)] uppercase">
            {course?.organiser ?? EXAMPLE_ORGANISER}
          </p>
          <p className="text-sm font-semibold text-[color:var(--text-heading)]">{preview}</p>
          <p className="text-xs text-[color:var(--text-muted)]">
            {draft.date ? formatCourseDay(draft.date) : "Day"}
            {draft.startTime && draft.endTime ? `, ${timeRange(draft)}` : ""}
            {draft.capacity ? `, ${draft.capacity} places` : ""}
          </p>
          <p className="text-xs text-[color:var(--text-muted)]">Book, and it goes in their calendar</p>
        </div>
      </WorkCard>

      <WorkDock>
        {course && !draftCourse ? (
          <>
            <WorkButton icon={Save} onClick={() => save(false)} testId="admin-courses-save">
              Save changes
            </WorkButton>
            <WorkButton variant="quiet" onClick={() => onDone?.()} testId="admin-courses-form-cancel">
              Cancel
            </WorkButton>
          </>
        ) : (
          <>
            <WorkButton icon={Send} onClick={() => save(true)} testId="admin-courses-submit">
              Post course
            </WorkButton>
            <WorkButton variant="quiet" onClick={() => save(false)} testId="admin-courses-draft">
              Save draft
            </WorkButton>
          </>
        )}
      </WorkDock>

      {confirm && course ? (
        <Sheet
          open
          onClose={() => setConfirm(null)}
          title="Save changes?"
          description={course.title}
          testId="admin-courses-confirm-sheet"
          footer={
            <WorkButton
              size="wide"
              icon={Check}
              onClick={() => finishEdit(confirm.post)}
              testId="admin-courses-confirm"
            >
              Save and update {calendars(booked)}
            </WorkButton>
          }
        >
          <ul className="grid gap-2 text-sm">
            {confirm.changes.map((change) => (
              <li
                key={change}
                className="rounded-[var(--work-radius-field)] border border-[color:var(--work-line)] px-3 py-2"
              >
                {change}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            {people(booked)} booked {booked === 1 ? "has" : "have"} their calendar updated and get an alert.
          </p>
        </Sheet>
      ) : null}
    </div>
  );
}

function Step({ n, label, extra }: { readonly n: number; readonly label: string; readonly extra?: string }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-sm font-bold text-[color:var(--text-heading)]">
      <span
        aria-hidden="true"
        className="grid size-5 place-items-center rounded-full bg-[color:var(--work-wash)] text-2xs"
      >
        {n}
      </span>
      {label}
      {extra ? <span className="ml-auto text-xs font-semibold text-[color:var(--text-muted)]">{extra}</span> : null}
    </p>
  );
}

/* ------------------------------------------------------------------ words */

function calendars(count: number): string {
  return count === 1 ? "1 calendar" : `${count} calendars`;
}

function people(count: number): string {
  return count === 1 ? "1 doctor" : `${count} doctors`;
}

function initials(name: string): string {
  return name
    .replace(/^Dr\s+/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function shortDate(iso: string): string {
  return formatCourseDay(iso.slice(0, 10)).split(" ").slice(1).join(" ");
}
