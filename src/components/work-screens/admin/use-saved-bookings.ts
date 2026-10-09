"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { useAuthSession } from "@/lib/supabase/client";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { BookingsState, CourseDraft, CourseDraftErrors } from "@/lib/work-screens/admin/bookings";
import type {
  ManagedCourse,
  SavedBookResult,
  SavedBookingsRead,
  SavedCancelBookingResult,
  SavedCancelCourseResult,
  SavedCourseResult,
} from "@/lib/work-screens/admin/bookings-repository";
import { zonedToday } from "@/lib/work-time/format";

/*
 * The saved (shared) version of Admin Bookings, ready for `use-bookings.ts` to switch
 * to once the bookings tables are approved. It reads `/api/work/bookings` and gives
 * the pages the same page state as the example version. Writes do not change the
 * state locally: each action asks the server (which checks places, waitlist and
 * permissions under a lock), then reads again, so what the page shows is always what
 * was saved. Nothing is kept on the device.
 *
 * Not wired into the pages yet.
 */

const BOOKINGS_URL = "/api/work/bookings";
const COURSES_URL = "/api/work/courses";

export type SavedBookingsPageState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly retry: () => void }
  /** The bookings tables are not there yet (or demo mode): the pages show "not set up". */
  | { readonly status: "not-set-up" }
  | { readonly status: "ready"; readonly state: BookingsState };

export type SavedActionResult<T> =
  | { readonly ok: true; readonly result: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
      /** Field messages when the server refused a course draft. */
      readonly fields?: CourseDraftErrors;
    };

export interface SaveCourseRequest {
  readonly courseId: string | null;
  readonly serviceId: string | null;
  readonly organiser: string;
  readonly draft: CourseDraft;
  readonly post: boolean;
}

export interface UseSavedBookings {
  readonly page: SavedBookingsPageState;
  /** Always false: these are real, saved courses. Kept for the same shape as `useBookings`. */
  readonly examples: false;
  readonly online: boolean;
  readonly today: string;
  readonly zone: string;
  /** Courses this reader organises, with the team each was posted for. */
  readonly managed: readonly ManagedCourse[];
  /** Where this reader may post, or null before the first read. */
  readonly organiser: SavedBookingsRead["organiser"] | null;
  readonly refresh: () => Promise<void>;
  readonly book: (courseId: string) => Promise<SavedActionResult<SavedBookResult>>;
  readonly cancelBooking: (courseId: string) => Promise<SavedActionResult<SavedCancelBookingResult>>;
  readonly saveCourse: (input: SaveCourseRequest) => Promise<SavedActionResult<SavedCourseResult>>;
  readonly cancelCourse: (courseId: string) => Promise<SavedActionResult<SavedCancelCourseResult>>;
}

type Loaded =
  { readonly status: "loading" } | { readonly status: "error" } | { readonly status: "not-set-up" } | SavedBookingsRead;

export function useSavedBookings(): UseSavedBookings {
  const { zone } = useWorkTimeZone();
  const online = useOnlineStatus();
  const headers = useAuthHeadersIfAvailable();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  // Only the newest read may land, so a slow answer cannot overwrite a newer one.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const response = await fetch(BOOKINGS_URL, { cache: "no-store", headers });
      const body: unknown = response.ok ? await response.json() : null;
      if (mine !== generation.current) return;
      setLoaded(readAnswer(body));
    } catch {
      if (mine === generation.current) setLoaded({ status: "error" });
    }
  }, [headers]);

  useEffect(() => {
    // Read on mount and again when the account changes; the read itself sets state after the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; setState happens after await
    void refresh();
  }, [refresh]);

  const send = useCallback(
    async <T>(url: string, payload: unknown): Promise<SavedActionResult<T>> => {
      let result: SavedActionResult<T>;
      try {
        const response = await fetch(url, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload),
        });
        const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        result = response.ok ? { ok: true, result: body as T } : refusal(response.status, body);
      } catch {
        result = { ok: false, status: 0, code: "offline", message: "Couldn't reach PsychSift. Try again." };
      }
      // Read again either way: a refusal often means the course changed under the reader.
      await refresh();
      return result;
    },
    [headers, refresh],
  );

  const book = useCallback(
    (courseId: string) => send<SavedBookResult>(BOOKINGS_URL, { action: "book", courseId }),
    [send],
  );
  const cancelBooking = useCallback(
    (courseId: string) => send<SavedCancelBookingResult>(BOOKINGS_URL, { action: "cancel", courseId }),
    [send],
  );
  const saveCourse = useCallback(
    (input: SaveCourseRequest) => send<SavedCourseResult>(COURSES_URL, { action: "save", ...input }),
    [send],
  );
  const cancelCourse = useCallback(
    (courseId: string) => send<SavedCancelCourseResult>(COURSES_URL, { action: "cancel", courseId }),
    [send],
  );

  const retry = useCallback(() => void refresh(), [refresh]);
  let page: SavedBookingsPageState;
  if (loaded.status === "ready") page = { status: "ready", state: loaded.state };
  else if (loaded.status === "error") page = { status: "error", retry };
  else page = loaded;

  return {
    page,
    examples: false,
    online,
    today: zonedToday(zone),
    zone,
    managed: loaded.status === "ready" ? loaded.managed : [],
    organiser: loaded.status === "ready" ? loaded.organiser : null,
    refresh,
    book,
    cancelBooking,
    saveCourse,
    cancelCourse,
  };
}

/** The GET answer, checked just enough to fail to the error card rather than crash. */
function readAnswer(body: unknown): Loaded {
  if (!body || typeof body !== "object") return { status: "error" };
  const answer = body as Partial<Omit<SavedBookingsRead, "status">> & { readonly status?: unknown };
  if (answer.status === "not-set-up") return { status: "not-set-up" };
  if (
    answer.status === "ready" &&
    answer.state &&
    Array.isArray(answer.state.courses) &&
    Array.isArray(answer.state.bookings) &&
    Array.isArray(answer.managed) &&
    answer.organiser
  )
    return answer as SavedBookingsRead;
  return { status: "error" };
}

function refusal<T>(status: number, body: Record<string, unknown> | null): SavedActionResult<T> {
  const code = typeof body?.code === "string" ? body.code : "request_failed";
  const message = typeof body?.message === "string" ? body.message : "That didn't save. Try again.";
  const fields = body?.fields && typeof body.fields === "object" ? (body.fields as CourseDraftErrors) : undefined;
  return { ok: false, status, code, message, ...(fields ? { fields } : {}) };
}

const NO_HEADERS: Readonly<Record<string, string>> = {};

function useAuthHeadersIfAvailable(): Readonly<Record<string, string>> {
  try {
    return useAuthSession().authorizationHeader ?? NO_HEADERS;
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.")
      return NO_HEADERS;
    throw error;
  }
}
