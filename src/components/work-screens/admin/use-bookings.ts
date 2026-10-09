"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { useSavedBookings, type SavedActionResult } from "@/components/work-screens/admin/use-saved-bookings";
import { EXAMPLE_SELF } from "@/lib/example-data/people";
import { useExampleData } from "@/lib/example-data/store";
import { useOnlineStatus } from "@/lib/use-online-status";
import {
  bookPlace,
  cancelCourse as cancelExampleCourse,
  cancelMyBooking,
  courseById,
  editCourse,
  postCourse,
  type BookingError,
  type BookingsState,
  type CourseDraft,
  type CourseDraftErrors,
} from "@/lib/work-screens/admin/bookings";
import {
  freshBookingsId,
  readBookingsSnapshot,
  resetBookings,
  seedBookings,
  serverBookingsSnapshot,
  setBookings,
  subscribeBookings,
} from "@/lib/work-screens/admin/bookings-store";
import { zonedToday } from "@/lib/work-time/format";

/** Who posts the example courses. */
export const EXAMPLE_ORGANISER = "Medical Education";

export type BookingsPageState =
  | { readonly status: "loading" }
  /** The example did not load (examples), or the saved courses did not (signed in). */
  | { readonly status: "error"; readonly retry: () => void }
  /** The saved version is not there (the bookings tables are missing, or the demo build). */
  | { readonly status: "not-set-up" }
  /** Saved courses need an account, so a signed-out reader is asked to sign in or try the example. */
  | { readonly status: "signed-out" }
  | { readonly status: "ready"; readonly state: BookingsState };

/** Where this reader may post courses. Examples: anyone, as Medical Education. */
export interface BookingsPosting {
  /** A site administrator, who may post a course open to everyone. */
  readonly administrator: boolean;
  /** Teams this reader may post for. */
  readonly teams: readonly { readonly serviceId: string; readonly name: string }[];
}

type Refused = { readonly ok: false; readonly message: string; readonly fields?: CourseDraftErrors };
/** Example changes can be undone; saved ones are real and are reversed with the opposite action. */
type Done<T> = { readonly ok: true; readonly undo?: () => void } & T;

export type BookOutcome =
  Done<{ readonly outcome: "booked" | "waitlisted"; readonly position: number | null }> | Refused;
export type CancelBookingOutcome = Done<{ readonly left: "booked" | "waitlisted" }> | Refused;
export type SaveCourseOutcome =
  | Done<{
      readonly id: string;
      readonly calendarsUpdated: number;
      readonly promoted: number;
    }>
  | Refused;
export type CancelCourseOutcome = Done<{ readonly calendarsUpdated: number }> | Refused;

export interface SaveCourseInput {
  /** Null posts a new course. */
  readonly courseId: string | null;
  readonly draft: CourseDraft;
  /** True posts it; false keeps a new one (or a draft) as a draft. */
  readonly post: boolean;
  /** The team it is for, or null for everyone. Ignored for an edit and for the example. */
  readonly serviceId: string | null;
  /** Who posted it, as doctors see it. Ignored for the example. */
  readonly organiser: string;
}

export interface UseBookings {
  readonly page: BookingsPageState;
  /** True while the shown courses are invented examples. */
  readonly examples: boolean;
  readonly online: boolean;
  readonly today: string;
  readonly zone: string;
  /** Where this reader may post. Null until the saved courses have loaded. */
  readonly posting: BookingsPosting | null;
  /** Whether this reader may change this course. Every example course; saved ones by the server's word. */
  readonly manages: (courseId: string) => boolean;
  readonly book: (courseId: string) => Promise<BookOutcome>;
  readonly cancelBooking: (courseId: string) => Promise<CancelBookingOutcome>;
  readonly saveCourse: (input: SaveCourseInput) => Promise<SaveCourseOutcome>;
  readonly cancelCourse: (courseId: string) => Promise<CancelCourseOutcome>;
}

const EXAMPLE_POSTING: BookingsPosting = { administrator: true, teams: [] };

/**
 * Bookings for the Bookings and Courses pages, in one shape for both versions.
 *
 * With Admin's example data on, the example is seeded into page memory once and
 * every change stays while the reader moves between Bookings, a course and
 * Courses, with Undo. With it off, the courses are the saved, shared ones: each
 * action asks the server, which checks places, the waitlist and permissions under
 * a lock, then the page reads again, so what it shows is what was saved.
 *
 * With `enabled` false (the work calendar, outside the preview) it reads nothing.
 */
export function useBookings({ enabled = true }: { readonly enabled?: boolean } = {}): UseBookings {
  const { active } = useExampleData("admin");
  const signedIn = useSignedIn();
  const { zone } = useWorkTimeZone();
  const online = useOnlineStatus();
  const read = useRegistryDataset("admin.bookings", enabled && active);
  const snapshot = useSyncExternalStore(subscribeBookings, readBookingsSnapshot, serverBookingsSnapshot);
  const saved = useSavedBookings(enabled && !active && signedIn);
  const today = zonedToday(zone);
  const source = `example:${zone}:${today}`;

  useEffect(() => {
    if (!enabled) return;
    if (!active) resetBookings();
    else if (read.status === "ready") seedBookings(source, read.data);
  }, [enabled, active, read, source]);

  const exampleState = active && snapshot.source === source ? snapshot.state : null;

  const book = useCallback(
    async (courseId: string): Promise<BookOutcome> => {
      if (!active) return fromSaved(await saved.book(courseId), (result) => result);
      if (!exampleState) return NOT_READY;
      const result = bookPlace(exampleState, courseId, {
        today,
        at: new Date().toISOString(),
        id: freshBookingsId("booking", true),
        person: EXAMPLE_SELF,
      });
      if (!result.ok) return { ok: false, message: BOOK_REFUSALS[result.error] };
      setBookings(result.state);
      return {
        ok: true,
        outcome: result.outcome,
        position: result.position ?? null,
        undo: () => setBookings(exampleState),
      };
    },
    [active, exampleState, saved, today],
  );

  const cancelBooking = useCallback(
    async (courseId: string): Promise<CancelBookingOutcome> => {
      if (!active)
        return fromSaved(await saved.cancelBooking(courseId), (result) => ({
          left: result.cancelled === "waitlisted" ? "waitlisted" : "booked",
        }));
      if (!exampleState) return NOT_READY;
      const before = exampleState.bookings.find((row) => row.courseId === courseId && row.self && live(row.status));
      const result = cancelMyBooking(exampleState, courseId);
      if (!result || !before) return { ok: false, message: "That didn't cancel. Try again." };
      setBookings(result.state);
      return {
        ok: true,
        left: before.status === "waitlisted" ? "waitlisted" : "booked",
        undo: () => setBookings(exampleState),
      };
    },
    [active, exampleState, saved],
  );

  const saveCourse = useCallback(
    async (input: SaveCourseInput): Promise<SaveCourseOutcome> => {
      if (!active)
        return fromSaved(await saved.saveCourse(input), (result) => ({
          id: result.id,
          calendarsUpdated: result.calendarsUpdated,
          promoted: result.promoted,
        }));
      if (!exampleState) return NOT_READY;
      const at = new Date().toISOString();
      if (!input.courseId) {
        const id = freshBookingsId("course", true);
        setBookings(
          postCourse(exampleState, input.draft, {
            id,
            at,
            organiser: EXAMPLE_ORGANISER,
            status: input.post ? "posted" : "draft",
          }),
        );
        return { ok: true, id, calendarsUpdated: 0, promoted: 0, undo: () => setBookings(exampleState) };
      }
      const before = courseById(exampleState, input.courseId);
      const result = editCourse(exampleState, input.courseId, input.draft, {
        at,
        post: input.post && before?.status === "draft",
      });
      if (!result) return { ok: false, message: "That didn't save. Try again." };
      setBookings(result.state);
      return {
        ok: true,
        id: input.courseId,
        calendarsUpdated: result.calendarsUpdated,
        promoted: result.promoted,
        undo: () => setBookings(exampleState),
      };
    },
    [active, exampleState, saved],
  );

  const cancelCourse = useCallback(
    async (courseId: string): Promise<CancelCourseOutcome> => {
      if (!active)
        return fromSaved(await saved.cancelCourse(courseId), (result) => ({
          calendarsUpdated: result.calendarsUpdated,
        }));
      if (!exampleState) return NOT_READY;
      const result = cancelExampleCourse(exampleState, courseId, { at: new Date().toISOString() });
      if (!result) return { ok: false, message: "That didn't cancel. Try again." };
      setBookings(result.state);
      return { ok: true, calendarsUpdated: result.calendarsUpdated, undo: () => setBookings(exampleState) };
    },
    [active, exampleState, saved],
  );

  const managed = saved.managed;
  const manages = useCallback(
    (courseId: string) => active || managed.some((course) => course.courseId === courseId),
    [active, managed],
  );

  let page: BookingsPageState;
  if (active) {
    if (read.status === "error") page = { status: "error", retry: read.retry };
    else if (!exampleState) page = { status: "loading" };
    else page = { status: "ready", state: exampleState };
  } else if (!signedIn) page = { status: "signed-out" };
  else page = saved.page;

  return {
    page,
    examples: active,
    online,
    today,
    zone,
    posting: active ? EXAMPLE_POSTING : saved.organiser,
    manages,
    book,
    cancelBooking,
    saveCourse,
    cancelCourse,
  };
}

const BOOK_REFUSALS: Readonly<Record<BookingError, string>> = {
  "not-found": "That course isn't open for booking.",
  cancelled: "This course was cancelled.",
  started: "This course has started.",
  closed: "Booking has closed.",
  full: "It filled up before you booked.",
  already: "You're already booked or waiting.",
};

const NOT_READY: Refused = { ok: false, message: "Still loading. Try again in a moment." };

function live(status: string): boolean {
  return status === "booked" || status === "waitlisted";
}

function fromSaved<T, R extends object>(
  answer: SavedActionResult<T>,
  map: (result: T) => R,
): ({ readonly ok: true } & R) | Refused {
  if (!answer.ok) return { ok: false, message: answer.message, ...(answer.fields ? { fields: answer.fields } : {}) };
  return { ok: true, ...map(answer.result) };
}
