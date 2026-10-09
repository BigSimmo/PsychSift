import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

/*
 * Admin · Bookings (`/admin/bookings`) and the organiser's Courses (`/admin/courses`).
 *
 * An organiser posts a course or a work requirement with a set number of places.
 * Doctors book a place, or join the waitlist when it is full. A booked place is a
 * calendar entry; cancelling takes it off and passes the place to the next person
 * waiting. An organiser's edit to the time or place changes every booked doctor's
 * entry, and cancelling the course marks every entry cancelled.
 *
 * Everything here is pure: each action takes the state and returns the next one,
 * so the same rules serve the example version and the saved version. Dates and
 * times are wall-clock values in the work time zone (Perth by default), the same
 * shape as `CalendarEvent`, so nothing here reads the device clock.
 */

export type CourseKind = "course" | "requirement";
export type CourseStatus = "draft" | "posted" | "cancelled";
export type BookingStatus = "booked" | "waitlisted" | "cancelled" | "attended";

export interface BookingCourse {
  readonly id: string;
  readonly kind: CourseKind;
  readonly title: string;
  /** What it is, who it is for and what to bring. */
  readonly about: string;
  /** YYYY-MM-DD in the work time zone. */
  readonly date: string;
  /** HH:MM, 24 hour. */
  readonly startTime: string;
  readonly endTime: string;
  readonly location: string;
  readonly capacity: number;
  /** Last day to book, YYYY-MM-DD, or null for "until it starts". */
  readonly closesOn: string | null;
  /** Who posted it, shown to doctors ("Medical Education"). */
  readonly organiser: string;
  /** Lower-case words that tie it to a renewal, such as "basic life support". */
  readonly renewal: string | null;
  readonly waitlist: boolean;
  readonly status: CourseStatus;
  readonly updatedAt: string;
  /** The organiser's last change that moved booked doctors' entries, shown to them. */
  readonly change: CourseChange | null;
}

export interface CourseChange {
  readonly summary: string;
  readonly at: string;
}

export interface CourseBooking {
  readonly id: string;
  readonly courseId: string;
  /** Display name. The reader's own bookings carry `self`. */
  readonly person: string;
  readonly self: boolean;
  readonly status: BookingStatus;
  /** When the place was booked or the waitlist joined. Waitlist order is by this. */
  readonly at: string;
}

export interface BookingsState {
  readonly courses: readonly BookingCourse[];
  readonly bookings: readonly CourseBooking[];
  /** The example's renewals that need action, so "For your renewals" has something to match. */
  readonly renewalsDue?: readonly string[];
}

export const EMPTY_BOOKINGS: BookingsState = { courses: [], bookings: [] };

export const MAX_COURSE_PLACES = 500;
export const COURSE_TITLE_MAX = 80;
export const COURSE_ABOUT_MAX = 400;
export const COURSE_LOCATION_MAX = 80;

export const COURSE_KIND_LABELS: Readonly<Record<CourseKind, string>> = {
  course: "Course",
  requirement: "Work requirement",
};

/* ------------------------------------------------------------------ reading */

export function courseById(state: BookingsState, id: string): BookingCourse | null {
  return state.courses.find((course) => course.id === id) ?? null;
}

function courseBookings(state: BookingsState, courseId: string): CourseBooking[] {
  return state.bookings.filter((booking) => booking.courseId === courseId);
}

/** People holding a place (booked or attended), oldest booking first. */
export function bookedFor(state: BookingsState, courseId: string): CourseBooking[] {
  return courseBookings(state, courseId)
    .filter((booking) => booking.status === "booked" || booking.status === "attended")
    .sort(byAt);
}

/** The waitlist in order: first in line first. */
export function waitlistFor(state: BookingsState, courseId: string): CourseBooking[] {
  return courseBookings(state, courseId)
    .filter((booking) => booking.status === "waitlisted")
    .sort(byAt);
}

export function placesLeft(state: BookingsState, course: BookingCourse): number {
  return Math.max(0, course.capacity - bookedFor(state, course.id).length);
}

/** The reader's live booking on a course (not a cancelled one), if any. */
export function myBooking(state: BookingsState, courseId: string): CourseBooking | null {
  return courseBookings(state, courseId).find((booking) => booking.self && booking.status !== "cancelled") ?? null;
}

/** 1-based place in the waitlist for the reader, or null when not waiting. */
export function myWaitlistPosition(state: BookingsState, courseId: string): number | null {
  const index = waitlistFor(state, courseId).findIndex((booking) => booking.self);
  return index < 0 ? null : index + 1;
}

export type CourseAvailability =
  "book" | "waitlist" | "full" | "closed" | "started" | "cancelled" | "booked" | "waitlisted" | "attended";

/** What the reader can do with a course today. `today` is YYYY-MM-DD in the work time zone. */
export function courseAvailability(state: BookingsState, course: BookingCourse, today: string): CourseAvailability {
  if (course.status === "cancelled") return "cancelled";
  const mine = myBooking(state, course.id);
  if (mine?.status === "attended") return "attended";
  if (mine?.status === "booked") return "booked";
  if (mine?.status === "waitlisted") return "waitlisted";
  if (course.date <= today) return "started";
  if (course.closesOn && course.closesOn < today) return "closed";
  if (placesLeft(state, course) > 0) return "book";
  return course.waitlist ? "waitlist" : "full";
}

export type OpenFilter = "all" | "course" | "requirement" | "places";

export const OPEN_FILTERS: readonly { readonly id: OpenFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "course", label: "Courses" },
  { id: "requirement", label: "Work requirements" },
  { id: "places", label: "Places left" },
];

/** Posted courses still ahead, soonest first, after the filter. */
export function openCourses(state: BookingsState, today: string, filter: OpenFilter = "all"): BookingCourse[] {
  return state.courses
    .filter((course) => course.status === "posted" && course.date > today)
    .filter((course) => {
      if (filter === "course" || filter === "requirement") return course.kind === filter;
      if (filter === "places") return placesLeft(state, course) > 0;
      return true;
    })
    .sort(bySchedule);
}

/** Open courses that match one of the reader's renewal titles, soonest first. */
export function coursesForRenewals(
  state: BookingsState,
  today: string,
  renewalTitles: readonly string[],
): BookingCourse[] {
  const titles = renewalTitles.map(normaliseWords).filter(Boolean);
  if (!titles.length) return [];
  return openCourses(state, today).filter((course) => {
    const key = course.renewal ? normaliseWords(course.renewal) : "";
    return key !== "" && titles.some((title) => title.includes(key) || key.includes(title));
  });
}

export interface MyBookings {
  readonly booked: readonly BookingCourse[];
  readonly waitlisted: readonly BookingCourse[];
  /** Booked courses the organiser changed or cancelled, newest change first. */
  readonly changed: readonly BookingCourse[];
  /** Past, attended or cancelled, newest first. */
  readonly earlier: readonly { readonly course: BookingCourse; readonly status: BookingStatus | "course-cancelled" }[];
}

export function myBookings(state: BookingsState, today: string): MyBookings {
  const booked: BookingCourse[] = [];
  const waitlisted: BookingCourse[] = [];
  const changed: BookingCourse[] = [];
  const earlier: { course: BookingCourse; status: BookingStatus | "course-cancelled" }[] = [];
  for (const course of state.courses) {
    const mine = latestOwn(state, course.id);
    if (!mine) continue;
    const ahead = course.date > today;
    if (course.status === "cancelled") {
      if (mine.status !== "cancelled") {
        earlier.push({ course, status: "course-cancelled" });
        if (ahead && course.change) changed.push(course);
      }
      continue;
    }
    if (ahead && mine.status === "booked") {
      booked.push(course);
      if (course.change) changed.push(course);
    } else if (ahead && mine.status === "waitlisted") waitlisted.push(course);
    else if (!ahead && mine.status !== "waitlisted") earlier.push({ course, status: mine.status });
    else if (mine.status === "cancelled") earlier.push({ course, status: "cancelled" });
  }
  booked.sort(bySchedule);
  waitlisted.sort(bySchedule);
  changed.sort((a, b) => (b.change?.at ?? "").localeCompare(a.change?.at ?? ""));
  earlier.sort((a, b) => bySchedule(b.course, a.course));
  return { booked, waitlisted, changed, earlier };
}

/** The reader's most recent booking row on a course, cancelled ones included. */
function latestOwn(state: BookingsState, courseId: string): CourseBooking | null {
  const own = courseBookings(state, courseId).filter((booking) => booking.self);
  return myBooking(state, courseId) ?? own.sort(byAt).at(-1) ?? null;
}

/* ------------------------------------------------------------------ doctor actions */

export type BookingError = "not-found" | "cancelled" | "started" | "closed" | "full" | "already";

export type BookResult =
  | {
      readonly ok: true;
      readonly state: BookingsState;
      readonly outcome: "booked" | "waitlisted";
      readonly position: number | null;
    }
  | { readonly ok: false; readonly error: BookingError };

/** Book a place, or join the waitlist when the course is full and has one. */
export function bookPlace(
  state: BookingsState,
  courseId: string,
  options: { readonly today: string; readonly at: string; readonly id: string; readonly person: string },
): BookResult {
  const course = courseById(state, courseId);
  if (!course || course.status === "draft") return { ok: false, error: "not-found" };
  const availability = courseAvailability(state, course, options.today);
  if (availability === "booked" || availability === "waitlisted" || availability === "attended")
    return { ok: false, error: "already" };
  if (
    availability === "cancelled" ||
    availability === "started" ||
    availability === "closed" ||
    availability === "full"
  )
    return { ok: false, error: availability };
  const outcome = availability === "book" ? "booked" : "waitlisted";
  const next: BookingsState = {
    ...state,
    bookings: [
      ...state.bookings,
      { id: options.id, courseId, person: options.person, self: true, status: outcome, at: options.at },
    ],
  };
  return {
    ok: true,
    state: next,
    outcome,
    position: outcome === "waitlisted" ? myWaitlistPosition(next, courseId) : null,
  };
}

/**
 * Cancel the reader's booking or leave the waitlist. A freed place goes to the
 * first person waiting, whose entry then goes into their calendar.
 */
export function cancelMyBooking(
  state: BookingsState,
  courseId: string,
): { readonly state: BookingsState; readonly promoted: CourseBooking | null } | null {
  const mine = myBooking(state, courseId);
  if (!mine || mine.status === "attended") return null;
  // Leaving the waitlist drops the row: the reader never held a place, so their calendar never had
  // the course, and a "cancelled" row would put a struck-out entry there it never needed.
  if (mine.status === "waitlisted") {
    return {
      state: { ...state, bookings: state.bookings.filter((booking) => booking.id !== mine.id) },
      promoted: null,
    };
  }
  return promoteWaitlist(setBookingStatus(state, mine.id, "cancelled"), courseId);
}

/** Move people off the waitlist into any free places, first in line first. */
export function promoteWaitlist(
  state: BookingsState,
  courseId: string,
): { readonly state: BookingsState; readonly promoted: CourseBooking | null } {
  const course = courseById(state, courseId);
  if (!course || course.status !== "posted") return { state, promoted: null };
  let next = state;
  let first: CourseBooking | null = null;
  for (const waiting of waitlistFor(state, courseId)) {
    if (placesLeft(next, course) <= 0) break;
    next = setBookingStatus(next, waiting.id, "booked");
    first ??= { ...waiting, status: "booked" };
  }
  return { state: next, promoted: first };
}

function setBookingStatus(state: BookingsState, bookingId: string, status: BookingStatus): BookingsState {
  return {
    ...state,
    bookings: state.bookings.map((booking) => (booking.id === bookingId ? { ...booking, status } : booking)),
  };
}

/* ------------------------------------------------------------------ organiser */

export interface CourseDraft {
  readonly kind: CourseKind;
  readonly title: string;
  readonly about: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly location: string;
  readonly capacity: string;
  readonly closesOn: string;
  readonly waitlist: boolean;
  readonly renewal: string;
}

export const BLANK_COURSE_DRAFT: CourseDraft = {
  kind: "course",
  title: "",
  about: "",
  date: "",
  startTime: "",
  endTime: "",
  location: "",
  capacity: "",
  closesOn: "",
  waitlist: true,
  renewal: "",
};

export function draftFromCourse(course: BookingCourse): CourseDraft {
  return {
    kind: course.kind,
    title: course.title,
    about: course.about,
    date: course.date,
    startTime: course.startTime,
    endTime: course.endTime,
    location: course.location,
    capacity: String(course.capacity),
    closesOn: course.closesOn ?? "",
    waitlist: course.waitlist,
    renewal: course.renewal ?? "",
  };
}

export type CourseDraftField =
  "title" | "about" | "date" | "startTime" | "endTime" | "location" | "capacity" | "closesOn";
export type CourseDraftErrors = Partial<Record<CourseDraftField, string>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Every problem with a draft, by field. `booked` is how many hold a place now, when editing. */
export function validateCourseDraft(
  draft: CourseDraft,
  options: { readonly today: string; readonly booked?: number; readonly savedClosesOn?: string | null },
): CourseDraftErrors {
  const errors: CourseDraftErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Add a title.";
  else if (title.length > COURSE_TITLE_MAX) errors.title = `Keep it under ${COURSE_TITLE_MAX} characters.`;
  if (draft.about.trim().length > COURSE_ABOUT_MAX) errors.about = `Keep it under ${COURSE_ABOUT_MAX} characters.`;
  if (!DATE.test(draft.date) || !isRealDate(draft.date)) errors.date = "Choose a date.";
  else if (draft.date <= options.today) errors.date = "Choose a date after today.";
  if (!TIME.test(draft.startTime)) errors.startTime = "Add a start time.";
  if (!TIME.test(draft.endTime)) errors.endTime = "Add an end time.";
  else if (TIME.test(draft.startTime) && draft.endTime <= draft.startTime) errors.endTime = "End after it starts.";
  const location = draft.location.trim();
  if (!location) errors.location = "Add where it is.";
  else if (location.length > COURSE_LOCATION_MAX) errors.location = `Keep it under ${COURSE_LOCATION_MAX} characters.`;
  const capacity = Number(draft.capacity);
  if (!/^\d+$/.test(draft.capacity.trim()) || capacity < 1) errors.capacity = "Add how many places.";
  else if (capacity > MAX_COURSE_PLACES) errors.capacity = `Up to ${MAX_COURSE_PLACES} places.`;
  else if (options.booked && capacity < options.booked)
    errors.capacity = `${options.booked} already booked. Cancel the course or keep at least ${options.booked}.`;
  if (draft.closesOn) {
    if (!DATE.test(draft.closesOn) || !isRealDate(draft.closesOn)) errors.closesOn = "Choose a date.";
    else if (draft.closesOn < options.today && draft.closesOn !== options.savedClosesOn)
      errors.closesOn = "Choose today or a later day.";
    else if (DATE.test(draft.date) && draft.closesOn > draft.date)
      errors.closesOn = "Close booking on or before the day.";
  }
  for (const field of ["title", "about", "location"] as const) {
    if (errors[field]) continue;
    const warning = checkPatientDetail(draft[field], { allowCapitals: true });
    if (!warning) continue;
    // A bare "Room 2" reads as a bed number to the shared check. Asking for the room's full name
    // keeps the check intact and gives doctors a place they can actually find.
    errors[field] =
      field === "location" && /^\s*(?:room|rm)\s*\d+\s*$/i.test(draft.location)
        ? "Name the room in full, for example Seminar room 2."
        : "This looks like patient details. Remove them before posting.";
  }
  return errors;
}

export function hasDraftErrors(errors: CourseDraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Post a new course (or save it as a draft). Assumes the draft passed validation. */
export function postCourse(
  state: BookingsState,
  draft: CourseDraft,
  options: {
    readonly id: string;
    readonly at: string;
    readonly organiser: string;
    readonly status: "draft" | "posted";
  },
): BookingsState {
  const course: BookingCourse = {
    id: options.id,
    ...courseFields(draft),
    organiser: options.organiser,
    status: options.status,
    updatedAt: options.at,
    change: null,
  };
  return { ...state, courses: [...state.courses, course] };
}

export interface CourseEditResult {
  readonly state: BookingsState;
  /** Plain words for what moved, such as "Time: 13:00 to 16:30 now 14:00 to 17:30". */
  readonly changes: readonly string[];
  /** How many booked doctors' calendars this edit updates. */
  readonly calendarsUpdated: number;
  readonly promoted: number;
}

/**
 * Save an organiser's edit. When the day, time or place moves, every booked
 * doctor's entry moves with it and they are shown what changed. Extra places
 * go to the waitlist straight away.
 */
export function editCourse(
  state: BookingsState,
  courseId: string,
  draft: CourseDraft,
  options: { readonly at: string; readonly post?: boolean },
): CourseEditResult | null {
  const before = courseById(state, courseId);
  if (!before || before.status === "cancelled") return null;
  const fields = courseFields(draft);
  const changes = describeCourseChanges(before, fields);
  const moved = changes.length > 0 && before.status === "posted";
  const status: CourseStatus = options.post ? "posted" : before.status;
  const updated: BookingCourse = {
    ...before,
    ...fields,
    status,
    updatedAt: options.at,
    change: moved ? { summary: changes.join(". "), at: options.at } : before.change,
  };
  const next: BookingsState = {
    ...state,
    courses: state.courses.map((course) => (course.id === courseId ? updated : course)),
  };
  const booked = bookedFor(next, courseId).length;
  const waitingBefore = waitlistFor(next, courseId).length;
  const promoted = promoteWaitlist(next, courseId).state;
  return {
    state: promoted,
    changes,
    calendarsUpdated: moved ? booked : 0,
    promoted: waitingBefore - waitlistFor(promoted, courseId).length,
  };
}

/** The changes a doctor's calendar entry cares about: day, time and place. */
export function describeCourseChanges(before: BookingCourse, after: ReturnType<typeof courseFields>): string[] {
  const changes: string[] = [];
  if (before.date !== after.date)
    changes.push(`Day: ${formatCourseDay(before.date)} now ${formatCourseDay(after.date)}`);
  if (before.startTime !== after.startTime || before.endTime !== after.endTime)
    changes.push(`Time: ${timeRange(before)} now ${timeRange(after)}`);
  if (before.location !== after.location) changes.push(`Place: ${before.location} now ${after.location}`);
  if (before.title !== after.title) changes.push(`Name: ${before.title} now ${after.title}`);
  return changes;
}

/** What saving this draft over the course would change for booked doctors. */
export function draftChanges(course: BookingCourse, draft: CourseDraft): string[] {
  return describeCourseChanges(course, courseFields(draft));
}

/** Cancel a course. Every booked doctor's entry is marked cancelled and they are told. */
export function cancelCourse(
  state: BookingsState,
  courseId: string,
  options: { readonly at: string },
): { readonly state: BookingsState; readonly calendarsUpdated: number } | null {
  const course = courseById(state, courseId);
  if (!course || course.status === "cancelled") return null;
  const calendarsUpdated = course.status === "posted" ? bookedFor(state, courseId).length : 0;
  const cancelled: BookingCourse = {
    ...course,
    status: "cancelled",
    updatedAt: options.at,
    change: course.status === "posted" ? { summary: "Cancelled by the organiser", at: options.at } : null,
  };
  return {
    state: { ...state, courses: state.courses.map((item) => (item.id === courseId ? cancelled : item)) },
    calendarsUpdated,
  };
}

/** Courses an organiser manages, upcoming first then past, drafts at the top. */
export function organiserCourses(state: BookingsState, today: string) {
  const drafts = state.courses.filter((course) => course.status === "draft").sort(bySchedule);
  const upcoming = state.courses.filter((course) => course.status === "posted" && course.date > today).sort(bySchedule);
  const past = state.courses
    .filter((course) => course.status !== "draft" && !(course.status === "posted" && course.date > today))
    .sort((a, b) => bySchedule(b, a));
  const full = upcoming.filter((course) => placesLeft(state, course) === 0 && waitlistFor(state, course.id).length > 0);
  return { drafts, upcoming, past, full };
}

function courseFields(draft: CourseDraft) {
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    about: draft.about.trim(),
    date: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
    location: draft.location.trim(),
    capacity: Number(draft.capacity),
    closesOn: draft.closesOn || null,
    renewal: draft.renewal.trim().toLowerCase() || null,
    waitlist: draft.waitlist,
  };
}

/* ------------------------------------------------------------------ calendar */

/** The calendar id for a course, stable across edits so calendars update in place. */
export function bookingCalendarId(courseId: string): string {
  return `booking-${courseId.replace(/^example:/, "example-")}`;
}

/** Minutes from start to end, for `CalendarEvent.durationMinutes`. */
export function courseMinutes(course: Pick<BookingCourse, "startTime" | "endTime">): number {
  return minutesOf(course.endTime) - minutesOf(course.startTime);
}

/**
 * The reader's calendar entries: one per booked or attended course. A booking
 * the reader cancelled, or a course the organiser cancelled, stays as a
 * cancelled entry so a subscribed calendar removes it rather than keeping a
 * stale copy. Waitlist places are not in the calendar until they become bookings.
 */
export function bookingCalendarEvents(state: BookingsState, href: (courseId: string) => string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const course of state.courses) {
    if (course.status === "draft") continue;
    const own = courseBookings(state, course.id).filter((booking) => booking.self && booking.status !== "waitlisted");
    if (!own.length) continue;
    const live = own.some((booking) => booking.status === "booked" || booking.status === "attended");
    const cancelled = course.status === "cancelled" || !live;
    events.push({
      id: bookingCalendarId(course.id),
      title: course.title,
      date: course.date,
      startTime: course.startTime,
      durationMinutes: courseMinutes(course),
      kind: course.kind === "course" ? "teaching" : "other",
      location: course.location,
      notes: `Booked in PsychSift. Posted by ${course.organiser}.`,
      href: href(course.id),
      ...(cancelled ? { status: "cancelled" as const } : {}),
    });
  }
  return events.sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
}

/**
 * The same courses in the shared work calendar's entry shape (`WorkCalendarEntry`, owned by
 * Rotation preferences in `src/lib/work-calendar/entries.ts`), typed structurally here so this file
 * does not depend on that module before it lands. Ids are `booking:<courseId>`, and an example
 * course's id starts `example:` as the shared calendar's example guard expects.
 */
export interface BookingWorkCalendarEntry {
  readonly id: string;
  readonly kind: "course";
  readonly title: string;
  readonly detail: string;
  readonly start: string;
  readonly end: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly location: string;
  readonly status: "confirmed" | "cancelled";
  readonly href: string;
  readonly updatedAt: string;
  readonly isExample: boolean;
}

export function bookingWorkCalendarId(courseId: string): string {
  return courseId.startsWith("example:") ? `example:booking:${courseId.slice(8)}` : `booking:${courseId}`;
}

export function bookingWorkCalendarEntries(
  state: BookingsState,
  href: (courseId: string) => string,
): BookingWorkCalendarEntry[] {
  return bookingCalendarEvents(state, href).flatMap((event) => {
    const course = state.courses.find((item) => bookingCalendarId(item.id) === event.id);
    if (!course) return [];
    return [
      {
        id: bookingWorkCalendarId(course.id),
        kind: "course" as const,
        title: course.title,
        detail: `${COURSE_KIND_LABELS[course.kind]} · ${course.organiser}`,
        start: course.date,
        end: course.date,
        startTime: course.startTime,
        endTime: course.endTime,
        location: course.location,
        status: event.status === "cancelled" ? ("cancelled" as const) : ("confirmed" as const),
        href: event.href ?? href(course.id),
        updatedAt: course.change?.at ?? course.updatedAt,
        isExample: course.id.startsWith("example:"),
      },
    ];
  });
}

/* ------------------------------------------------------------------ words */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 22 Oct" from YYYY-MM-DD, read as a plain date (no time zone shift). */
export function formatCourseDay(date: string): string {
  const parsed = parseDate(date);
  if (!parsed) return date;
  return `${WEEKDAYS[parsed.getUTCDay()]} ${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]}`;
}

/** The month ("Oct") and day ("22") for a date row; the tile draws the month in small caps. */
export function courseDateTile(date: string): { readonly month: string; readonly day: string } {
  const parsed = parseDate(date);
  if (!parsed) return { month: "", day: "" };
  return { month: MONTHS[parsed.getUTCMonth()], day: String(parsed.getUTCDate()).padStart(2, "0") };
}

export function timeRange(course: Pick<BookingCourse, "startTime" | "endTime">): string {
  return `${course.startTime} to ${course.endTime}`;
}

/** "3 h 30 min", "45 min" */
export function formatCourseLength(course: Pick<BookingCourse, "startTime" | "endTime">): string {
  const minutes = courseMinutes(course);
  if (minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "In 14 days", "Tomorrow", "Today" between two YYYY-MM-DD dates. */
export function daysAway(date: string, today: string): string {
  const a = parseDate(today);
  const b = parseDate(date);
  if (!a || !b) return "";
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  if (days === -1) return "Yesterday";
  return `${-days} days ago`;
}

/** "4 of 12 left", "Full, 3 waiting", "Full" */
export function placesWords(state: BookingsState, course: BookingCourse): string {
  const left = placesLeft(state, course);
  if (left > 0) return `${left} of ${course.capacity} left`;
  const waiting = waitlistFor(state, course.id).length;
  return waiting ? `Full, ${waiting} waiting` : "Full";
}

export function ordinal(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${position}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[position % 10] ?? "th";
  return `${position}${suffix}`;
}

/* ------------------------------------------------------------------ helpers */

function byAt(a: CourseBooking, b: CourseBooking): number {
  return a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
}

function bySchedule(a: BookingCourse, b: BookingCourse): number {
  return `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`) || a.title.localeCompare(b.title);
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function parseDate(date: string): Date | null {
  if (!DATE.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRealDate(date: string): boolean {
  const parsed = parseDate(date);
  return parsed !== null && parsed.toISOString().slice(0, 10) === date;
}

function normaliseWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ organiser export */

/**
 * Who is booked and waiting on one course, as a spreadsheet file. Excel reads it as
 * UTF-8 only with the byte order mark, and a cell that starts like a formula is
 * quoted so it never runs.
 */
export function courseBookingsCsv(state: BookingsState, courseId: string): string {
  const cell = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const day = (at: string) => at.slice(0, 10);
  const rows = [
    ...bookedFor(state, courseId).map((booking) => [
      booking.person,
      booking.status === "attended" ? "Attended" : "Booked",
      day(booking.at),
    ]),
    ...waitlistFor(state, courseId).map((booking, index) => [
      booking.person,
      `Waiting, ${index + 1} in line`,
      day(booking.at),
    ]),
  ];
  return `﻿${[["Name", "Status", "Since"], ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function courseBookingsFileName(course: Pick<BookingCourse, "title" | "date">): string {
  const slug = course.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug || "course"}-${course.date}-bookings.csv`;
}
