import type { FatigueShift } from "@/lib/roster/fatigue-rules";
import { addDaysToDate, perthDateOf, perthWallToIso } from "@/lib/roster/shifts/perth-time";
import { demoMyShifts } from "@/lib/roster/team/demo-team-core";

import type { OpenShiftListing } from "./model";

/**
 * Made-up example records for a signed-out reader (and for the screenshots).
 * Every hospital, ward and time is invented. Dates are built from today so the
 * example always looks current. Nothing here is ever sent or saved.
 */

const TEAM_NORTH = "00000000-0000-4000-8000-00000000a001";
const TEAM_RIVER = "00000000-0000-4000-8000-00000000a002";
const SITE_NORTHGATE = "00000000-0000-4000-8000-00000000b001";
const SITE_RIVERSIDE = "00000000-0000-4000-8000-00000000b002";
const SITE_LAKESIDE = "00000000-0000-4000-8000-00000000b003";

type SampleRow = {
  readonly day: number;
  readonly start: string;
  readonly end: string;
  readonly kind: OpenShiftListing["kind"];
  readonly code: string;
  readonly site: "northgate" | "riverside" | "lakeside";
  readonly urgent?: boolean;
  readonly minGrade?: OpenShiftListing["minGrade"];
  /** The example doctor has asked for it ("claimed") or been given it ("approved"). */
  readonly claim?: "claimed" | "approved";
};

const SITES = {
  northgate: {
    siteId: SITE_NORTHGATE,
    siteName: "Example Hospital · Ward A",
    serviceId: TEAM_NORTH,
    teamName: "Example Psychiatry Team",
  },
  riverside: {
    siteId: SITE_RIVERSIDE,
    siteName: "Example Health Campus · ED liaison",
    serviceId: TEAM_RIVER,
    teamName: "Example Mental Health Team",
  },
  lakeside: {
    siteId: SITE_LAKESIDE,
    siteName: "Example Mental Health Unit · Older adult",
    serviceId: TEAM_NORTH,
    teamName: "Example Psychiatry Team",
  },
} as const;

// Per-day counts follow the approved mock-up's signed-out example (v10), within the 14-day window.
const ROWS: readonly SampleRow[] = [
  { day: 0, start: "17:00", end: "23:00", kind: "evening", code: "E", site: "northgate" },
  { day: 1, start: "08:00", end: "16:30", kind: "day", code: "D", site: "northgate", urgent: true },
  { day: 1, start: "14:00", end: "22:30", kind: "evening", code: "E", site: "riverside" },
  { day: 1, start: "21:30", end: "08:00", kind: "night", code: "N", site: "riverside", urgent: true },
  { day: 2, start: "08:00", end: "16:30", kind: "day", code: "D", site: "northgate" },
  { day: 2, start: "14:00", end: "22:30", kind: "evening", code: "E", site: "riverside" },
  { day: 2, start: "21:30", end: "08:00", kind: "night", code: "N", site: "riverside" },
  { day: 2, start: "08:00", end: "16:30", kind: "day", code: "D", site: "lakeside", minGrade: "resident" },
  { day: 3, start: "08:00", end: "18:00", kind: "day", code: "L", site: "northgate" },
  { day: 3, start: "16:00", end: "22:00", kind: "evening", code: "E", site: "lakeside" },
  { day: 4, start: "08:00", end: "16:30", kind: "day", code: "D", site: "riverside" },
  { day: 4, start: "08:00", end: "16:30", kind: "day", code: "D", site: "lakeside", minGrade: "resident" },
  { day: 4, start: "14:00", end: "22:30", kind: "evening", code: "E", site: "riverside" },
  { day: 4, start: "17:00", end: "23:00", kind: "evening", code: "E", site: "northgate" },
  { day: 4, start: "21:30", end: "08:00", kind: "night", code: "N", site: "riverside" },
  { day: 5, start: "08:00", end: "18:00", kind: "day", code: "L", site: "riverside" },
  { day: 7, start: "08:00", end: "16:30", kind: "day", code: "D", site: "lakeside" },
  { day: 7, start: "17:00", end: "23:00", kind: "evening", code: "E", site: "northgate" },
  { day: 8, start: "08:00", end: "16:30", kind: "day", code: "D", site: "northgate" },
  { day: 9, start: "08:00", end: "18:00", kind: "day", code: "L", site: "riverside" },
  { day: 9, start: "16:00", end: "22:00", kind: "evening", code: "E", site: "lakeside" },
  { day: 9, start: "21:30", end: "08:00", kind: "night", code: "N", site: "riverside" },
  { day: 10, start: "08:00", end: "16:30", kind: "day", code: "D", site: "northgate" },
  { day: 11, start: "08:00", end: "16:30", kind: "day", code: "D", site: "lakeside", minGrade: "resident" },
  { day: 11, start: "14:00", end: "22:30", kind: "evening", code: "E", site: "riverside" },
  { day: 11, start: "17:00", end: "23:00", kind: "evening", code: "E", site: "northgate" },
  { day: 11, start: "21:30", end: "08:00", kind: "night", code: "N", site: "riverside" },
  { day: 12, start: "08:00", end: "18:00", kind: "day", code: "L", site: "northgate" },
  { day: 5, start: "17:00", end: "23:00", kind: "evening", code: "E", site: "riverside", claim: "claimed" },
  { day: 9, start: "08:00", end: "16:30", kind: "day", code: "D", site: "northgate", claim: "approved" },
  // A second shift for today that ends before the example doctor's on call
  // tonight, so the first view shows one shift to ask for and one hidden as a clash.
  { day: 0, start: "12:00", end: "16:30", kind: "day", code: "D", site: "lakeside" },
];

function instant(date: string, time: string): string {
  return perthWallToIso(date, time) ?? `${date}T00:00:00.000Z`;
}

function span(today: string, day: number, start: string, end: string): { startsAt: string; endsAt: string } {
  const date = addDaysToDate(today, day);
  const endDate = end <= start ? addDaysToDate(date, 1) : date;
  return { startsAt: instant(date, start), endsAt: instant(endDate, end) };
}

export function sampleListings(now: Date): OpenShiftListing[] {
  const today = perthDateOf(now);
  return ROWS.map((row, index) => {
    const site = SITES[row.site];
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      status: row.claim ?? "open",
      urgent: row.urgent ?? false,
      ...span(today, row.day, row.start, row.end),
      shiftCode: row.code,
      kind: row.kind,
      minGrade: row.minGrade ?? "registrar",
      siteId: site.siteId,
      siteName: site.siteName,
      serviceId: site.serviceId,
      teamName: site.teamName,
      mine: false,
      claimedByMe: row.claim !== undefined,
      myGrade: "registrar",
    };
  });
}

/**
 * The example doctor's own roster: the shifts the roster check compares with.
 * It is the one example roster (`demoMyShifts`), so the days Open shifts marks
 * "You're rostered" are the days Roster, My Day and On Call show.
 */
export function sampleRoster(now: Date): FatigueShift[] {
  return demoMyShifts(now).map((shift) => ({
    id: shift.id,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    kind: shift.kind ?? "other",
  }));
}
