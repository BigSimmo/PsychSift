import { addDays } from "@/lib/calendar/calendar-event";
import { EXAMPLE_PEOPLE, EXAMPLE_SELF } from "@/lib/example-data/people";
import { zonedToday } from "@/lib/work-time/format";
import {
  formatCourseDay,
  type BookingCourse,
  type BookingsState,
  type CourseBooking,
} from "@/lib/work-screens/admin/bookings";

/*
 * Example courses and bookings for Admin Bookings (`/admin/bookings`) and the organiser's Courses
 * (`/admin/courses`). Dates are counted from today in the reader's work time zone, so the example
 * always has something ahead. They show only while Admin's example data is on, live in page memory,
 * and are never saved or exported: every id starts "example:". Names come from the standard example
 * people (`people.ts`), the reader is `EXAMPLE_SELF`, and places are generic rooms with no real
 * hospital in them. Read through the registry, `loadExampleDataset("admin.bookings")`.
 */

const ORGANISER = "Medical Education";

export function exampleBookings(now: Date, zone: string): BookingsState {
  const today = zonedToday(zone, now);
  const day = (offset: number) => addDays(today, offset);
  const posted = (offset: number) => `${day(offset)}T01:00:00.000Z`;

  const course = (
    id: string,
    offset: number,
    fields: Omit<BookingCourse, "id" | "date" | "organiser" | "status" | "updatedAt" | "change"> &
      Partial<Pick<BookingCourse, "status" | "change">>,
  ): BookingCourse => ({
    id: `example:course-${id}`,
    date: day(offset),
    organiser: ORGANISER,
    status: "posted",
    updatedAt: posted(-10),
    change: null,
    ...fields,
  });

  const courses: BookingCourse[] = [
    course("fit-test", 6, {
      kind: "requirement",
      title: "Respirator fit test",
      about: "Fit testing for the N95 respirators used on the wards. Shave the day before if you can.",
      startTime: "10:00",
      endTime: "10:20",
      location: "Staff Health clinic",
      capacity: 8,
      closesOn: day(5),
      renewal: "respirator fit test",
      waitlist: true,
    }),
    course("mha-forms", 11, {
      kind: "course",
      title: "Mental Health Act forms",
      about: "A walk through the common forms, with time for questions. Bring a recent case to discuss, without names.",
      startTime: "12:30",
      endTime: "13:30",
      location: "Online",
      capacity: 6,
      closesOn: null,
      renewal: null,
      waitlist: true,
    }),
    course("bls", 14, {
      kind: "course",
      title: "Basic life support",
      about: "Hands-on adult basic life support with assessment. Bring your staff card and wear comfortable clothes.",
      startTime: "13:00",
      endTime: "16:30",
      location: "Education Centre, level 2",
      capacity: 12,
      closesOn: day(11),
      renewal: "basic life support",
      waitlist: true,
    }),
    course("restraint", 19, {
      kind: "requirement",
      title: "Safe restraint refresher",
      about: "Yearly refresher for staff working on the acute wards.",
      startTime: "08:30",
      endTime: "12:00",
      location: "Seminar room 2",
      capacity: 16,
      closesOn: day(16),
      renewal: "safe restraint",
      waitlist: false,
    }),
    course("grand-round", 34, {
      kind: "course",
      title: "Grand round presenting",
      about: "How to prepare and present a grand round. Slides and a short practice run.",
      startTime: "12:00",
      endTime: "13:00",
      location: "Lecture theatre",
      capacity: 40,
      closesOn: null,
      renewal: null,
      waitlist: true,
      change: { summary: `Day: ${formatCourseDay(day(33))} now ${formatCourseDay(day(34))}`, at: posted(-2) },
    }),
    course("ect", 26, {
      kind: "course",
      title: "ECT credentialing session",
      about: "Observed practice for doctors working towards ECT credentialing.",
      startTime: "14:00",
      endTime: "17:00",
      location: "ECT suite",
      capacity: 6,
      closesOn: day(20),
      renewal: null,
      waitlist: true,
    }),
    course("clozapine", 40, {
      kind: "course",
      title: "Clozapine prescribing",
      about: "Starting, monitoring and stopping clozapine safely.",
      startTime: "12:30",
      endTime: "13:30",
      location: "Seminar room 1",
      capacity: 20,
      closesOn: null,
      renewal: null,
      waitlist: true,
      status: "draft",
    }),
    course("manual-handling", -30, {
      kind: "requirement",
      title: "Manual handling",
      about: "Yearly manual handling update.",
      startTime: "09:00",
      endTime: "10:00",
      location: "Seminar room 2",
      capacity: 12,
      closesOn: null,
      renewal: "manual handling",
      waitlist: false,
    }),
  ];

  let n = 0;
  const booking = (
    courseId: string,
    person: string,
    status: CourseBooking["status"],
    offset: number,
  ): CourseBooking => ({
    id: `example:booking-${(n += 1)}`,
    courseId: `example:course-${courseId}`,
    person,
    self: person === EXAMPLE_SELF,
    status,
    at: `${day(offset)}T0${n % 10}:00:00.000Z`,
  });
  const people = (count: number, from = 0) => EXAMPLE_PEOPLE.slice(from, from + count);

  const bookings: CourseBooking[] = [
    ...people(6).map((person, i) => booking("fit-test", person, "booked", -9 + i)),
    ...people(6, 2).map((person, i) => booking("mha-forms", person, "booked", -8 + i)),
    ...people(3, 10).map((person, i) => booking("mha-forms", person, "waitlisted", -2 + i)),
    ...people(8, 4).map((person, i) => booking("bls", person, "booked", -7 + i)),
    ...people(7, 8).map((person, i) => booking("restraint", person, "booked", -6 + i)),
    ...people(17, 1).map((person, i) => booking("grand-round", person, "booked", -9 + (i % 6))),
    booking("grand-round", EXAMPLE_SELF, "booked", -5),
    ...people(6, 12).map((person, i) => booking("ect", person, "booked", -4 + (i % 3))),
    booking("mha-forms", EXAMPLE_SELF, "waitlisted", 0),
    booking("manual-handling", EXAMPLE_SELF, "attended", -40),
    ...people(9, 5).map((person, i) => booking("manual-handling", person, "attended", -40 + i)),
  ];

  // Admin's example renewals show Basic life support with its date passed.
  return { courses, bookings, renewalsDue: ["Basic life support"] };
}
