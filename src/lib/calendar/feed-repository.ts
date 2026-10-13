import "server-only";

import { calendarFeedPath, generateCalendarFeedToken, hashCalendarFeedToken } from "@/lib/calendar/feed-token";
import { cmeDeadlineEvents, cmeRoutineEvents } from "@/lib/cme/calendar-events";
import { cpdYearOf, perthCalendarDate } from "@/lib/cme/cpd-year";
import { fetchOwnerCmeRoutines, fetchOwnerCmeYear } from "@/lib/cme/repository";
import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import { onCallTeachingEvents } from "@/lib/on-call/calendar-events";
import { fetchVisibleOnCallEntries } from "@/lib/on-call/repository";
import { teachingCalendarEvents } from "@/lib/teaching/calendar-events";
import { fetchTeachingFeedSessions } from "@/lib/teaching/feed-repository";
import { fetchRotationFeedEvents } from "@/lib/calendar/rotation-feed-source";
import { bookingCalendarEvents } from "@/lib/work-screens/admin/bookings-calendar";
import { readSavedBookings } from "@/lib/work-screens/admin/bookings-repository";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import { logger } from "@/lib/logger";
import {
  applyReminderAlarms,
  DEFAULT_REMINDER_SETTINGS,
  normalizeReminderSettings,
  type ReminderSettings,
} from "@/lib/reminders/settings";
import { inferShiftKind, SHIFT_KIND_LABEL } from "@/lib/roster/shift-kind";
import type { RosterDisplayShift as OnCallShift } from "@/lib/roster/team/team-view";
import { calendarRosterShifts } from "@/lib/roster/team/calendar-shifts";
import { perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";
import { fetchOwnerShifts } from "@/lib/roster/shifts/repository";
import { DEFAULT_ROSTER_SETTINGS, fetchRosterSettings, type RosterSettings } from "@/lib/roster/settings";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/**
 * The private calendar subscription behind `/api/calendar/feed/<token>.ics`.
 *
 * What a feed carries is deliberately narrow, because anyone holding the link
 * can read it: CME year deadlines and routines coming due, the owner's own On
 * Call teaching list (now shown in Teaching's Week, and linking there), and
 * Teaching sessions from the teams where the owner turned on "Add to my
 * calendar". Teaching sessions carry the title, time and place only: never a
 * join link, a presenter or anyone's attendance. A cancelled Teaching session
 * stays in the feed marked cancelled, with "Cancelled:" in its title and never
 * an alarm, so subscribed calendars update it instead of keeping it.
 *
 * Courses the owner booked (Admin, Bookings) are on it too, with the title,
 * time and place only: never the organiser's name or anyone else's booking.
 * A course cancelled, or a place the owner gave up, stays marked cancelled,
 * the same as a Teaching session.
 *
 * Never logged CME activities (the owner's own learning, and already in the
 * past), never personal On Call entries, never compliance expiry dates (not
 * stored centrally), never anything about patients.
 *
 * Events carry a calendar alarm only when the owner turned one on in Settings,
 * Notifications, Reminders. Their settings are read from their own preferences
 * row; if that read fails the feed is still served, just without alarms.
 */

/**
 * The feed owner's reminder settings, from their own preferences row only.
 * A failed read returns the defaults (no alarms) rather than failing the feed:
 * a missing alarm is the conservative way for this to go wrong.
 */
export async function fetchOwnerReminderSettings(supabase: AdminClient, ownerId: string): Promise<ReminderSettings> {
  if (!ownerId) throw new Error("Missing calendar feed owner.");
  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("preferences")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const preferences = data?.preferences as { reminders?: unknown } | null | undefined;
    return normalizeReminderSettings(preferences?.reminders);
  } catch (error) {
    logger.warn("calendar feed reminder settings unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_REMINDER_SETTINGS;
  }
}

/**
 * The feed owner's Roster settings, for deciding whether shifts belong on the
 * feed. A failed read serves the feed without Roster shifts rather than
 * failing it, the same conservative fallback as the reminder settings above:
 * a shift that fails to appear on the feed the owner can still open the app
 * and see, whereas a broken feed is a broken phone alert.
 */
async function fetchOwnerRosterSettingsForFeed(supabase: AdminClient, ownerId: string): Promise<RosterSettings> {
  try {
    return await fetchRosterSettings(supabase, ownerId);
  } catch (error) {
    logger.warn("calendar feed roster settings unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return DEFAULT_ROSTER_SETTINGS;
  }
}

export async function ownerHasCalendarFeed(supabase: AdminClient, ownerId: string): Promise<boolean> {
  if (!ownerId) throw new Error("Missing calendar feed owner.");
  const { data, error } = await supabase
    .from("calendar_feed_tokens")
    .select("owner_id")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Make a new link, replacing any old one. Returns the path; the token is never stored. */
export async function rotateOwnerCalendarFeed(supabase: AdminClient, ownerId: string): Promise<string> {
  if (!ownerId) throw new Error("Missing calendar feed owner.");
  const token = generateCalendarFeedToken();
  const { error } = await supabase.rpc("calendar_feed_rotate", {
    p_owner_id: ownerId,
    p_token_hash: hashCalendarFeedToken(token),
  });
  if (error) throw error;
  return calendarFeedPath(token);
}

export async function revokeOwnerCalendarFeed(supabase: AdminClient, ownerId: string): Promise<void> {
  if (!ownerId) throw new Error("Missing calendar feed owner.");
  const { error } = await supabase.rpc("calendar_feed_revoke", { p_owner_id: ownerId });
  if (error) throw error;
}

/** The owner a presented token belongs to, or null (unknown and turned-off look the same). */
export async function calendarFeedOwner(supabase: AdminClient, token: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("calendar_feed_owner", {
    p_token_hash: hashCalendarFeedToken(token),
  });
  if (error) throw error;
  return typeof data === "string" ? data : null;
}

/** How far ahead Roster shifts reach into the feed: enough to be useful, never a doctor's whole roster history. */
const ROSTER_FEED_WINDOW_DAYS = 60;

/**
 * Upcoming shifts as calendar events, only once the doctor has turned on
 * "Shifts on my calendar link" in Roster Settings. Deliberately narrow, like
 * every other feed source: no workplace and no location, since anyone
 * holding the link can read it.
 */
function rosterShiftEvents(shifts: readonly OnCallShift[]): CalendarEvent[] {
  // A shift stored without a kind (an older calendar-link refresh) is given one from its times, never dropped.
  return shifts.map((shift) => ({
    id: `roster-shift-${shift.id}`,
    title: `Roster: ${SHIFT_KIND_LABEL[shift.kind ?? inferShiftKind(shift)]}`,
    date: perthDateOf(shift.startsAt),
    startTime: perthTimeOf(shift.startsAt),
    durationMinutes: Math.max(1, Math.round((Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / 60_000)),
    kind: "other" as const,
    reminderType: "shifts" as const,
  }));
}

/** How far back booked courses stay on the feed: long enough for a calendar to see a late cancellation. */
const BOOKING_FEED_PAST_DAYS = 30;

/**
 * The owner's booked courses for the feed. A failed or not-yet-set-up read
 * serves the feed without them rather than failing it, like the settings reads
 * above. Notes are dropped: they name the organiser, and anyone holding the
 * link can read the feed.
 */
async function fetchOwnerBookingEvents(supabase: AdminClient, ownerId: string, now: Date): Promise<CalendarEvent[]> {
  try {
    const read = await readSavedBookings(supabase, ownerId);
    if (read.status !== "ready") return [];
    const from = perthCalendarDate(new Date(now.getTime() - BOOKING_FEED_PAST_DAYS * 24 * 60 * 60 * 1000));
    return bookingCalendarEvents(read.state, (courseId) => ADMIN_WORK_SCREEN_HREFS.bookingCourse(courseId))
      .filter((event) => event.date >= from)
      .map((event): CalendarEvent => ({ ...event, notes: undefined }));
  } catch (error) {
    logger.warn("calendar feed bookings unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function calendarFeedEvents(supabase: AdminClient, ownerId: string, now: Date): Promise<CalendarEvent[]> {
  const year = cpdYearOf(now);
  const [thisYear, nextYear, routines, teaching, teachingSessions, reminders, rosterSettings, rotations, bookings] =
    await Promise.all([
      fetchOwnerCmeYear(supabase, ownerId, year),
      fetchOwnerCmeYear(supabase, ownerId, year + 1),
      fetchOwnerCmeRoutines(supabase, ownerId),
      fetchVisibleOnCallEntries(supabase, ownerId, { section: "education" }),
      fetchTeachingFeedSessions(supabase, ownerId, now),
      fetchOwnerReminderSettings(supabase, ownerId),
      fetchOwnerRosterSettingsForFeed(supabase, ownerId),
      fetchRotationFeedEvents(supabase, ownerId, now),
      fetchOwnerBookingEvents(supabase, ownerId, now),
    ]);
  let rosterShifts: CalendarEvent[] = [];
  if (rosterSettings.calendarShifts) {
    const own = await fetchOwnerShifts(supabase, ownerId, now);
    const shifts = await calendarRosterShifts(supabase, ownerId, own, now);
    const windowEndMillis = now.getTime() + ROSTER_FEED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    rosterShifts = rosterShiftEvents(shifts.filter((shift) => Date.parse(shift.startsAt) <= windowEndMillis));
  }
  const events = [
    ...(thisYear ? cmeDeadlineEvents(thisYear) : []),
    ...(nextYear ? cmeDeadlineEvents(nextYear) : []),
    ...cmeRoutineEvents(routines),
    ...onCallTeachingEvents(
      teaching.filter((entry) => !entry.isPersonal),
      perthCalendarDate(now),
    ),
    ...teachingCalendarEvents(teachingSessions),
    ...rosterShifts,
    ...rotations,
    ...bookings,
  ];
  return applyReminderAlarms(events, reminders, now);
}
