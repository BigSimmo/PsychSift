import "server-only";

import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import { addDays } from "@/lib/calendar/calendar-event";
import { perthCalendarDate } from "@/lib/perth-time";
import { rotationById, termById } from "@/lib/roster/rotations/model";
import { fetchPublishedPlacementsFor, type FeedPlacement } from "@/lib/roster/rotations/repository";
import { rosterTeamReleaseEnabled } from "@/lib/roster/team/release";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

/** A rotation that ended more than this many days ago leaves the feed. */
export const ROTATION_FEED_DAYS_BEHIND = 14;

/**
 * The feed owner's published rotations, as two all-day events per term: the
 * day it starts and the day it ends. Narrow like every feed source, since
 * anyone holding the link can read it: the rotation's name and the term only,
 * never the site, the round's other people or anyone's preferences. Ids are
 * stable per round, person and term, so when the administrator moves someone
 * after publishing, subscribed calendars update the event instead of adding one.
 */
export function rotationCalendarEvents(placements: readonly FeedPlacement[], today: string): CalendarEvent[] {
  const oldest = addDays(today, -ROTATION_FEED_DAYS_BEHIND);
  return placements.flatMap(({ roundId, placement, round }) => {
    const term = termById(round, placement.termId);
    const rotation = rotationById(round, placement.rotationId);
    if (!term || !rotation || term.end < oldest) return [];
    // Ids reach the calendar file as event ids, so only plain characters go in.
    const base = `rotation-${roundId}-${placement.termId}`.replace(/[^A-Za-z0-9-]/g, "-");
    const notes = `${term.label}, ${round.name}`;
    return [
      {
        id: `${base}-start`,
        title: `Rotation starts: ${rotation.name}`,
        date: term.start,
        kind: "other" as const,
        notes,
        href: "/roster/rotations",
      },
      {
        id: `${base}-end`,
        title: `Rotation ends: ${rotation.name}`,
        date: term.end,
        kind: "other" as const,
        notes,
        href: "/roster/rotations",
      },
    ];
  });
}

/**
 * The calendar feed's rotation source. While the real-staff release is held,
 * or before the rotation tables exist, there is nothing to add and the feed
 * carries on without it. Any other failure throws, so the feed answers 503 and
 * calendar apps keep their last copy rather than deleting every rotation.
 */
export async function fetchRotationFeedEvents(
  client: AdminClient,
  ownerId: string,
  now: Date,
): Promise<CalendarEvent[]> {
  if (!rosterTeamReleaseEnabled()) return [];
  const placements = await fetchPublishedPlacementsFor(client, ownerId);
  return rotationCalendarEvents(placements, perthCalendarDate(now));
}
