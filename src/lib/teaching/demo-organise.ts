import { DEMO_TEACHING_SERVICE_ID, DEMO_TEACHING_TEAM } from "@/lib/teaching/demo-programme";
import type { GroupRow, SeriesAudience, SeriesRow, SessionSummary } from "@/lib/teaching/model";
import { perthDate, perthInstant, perthTime, perthToday } from "@/lib/teaching/time";

/**
 * The made-up organiser view for demo mode and signed-out visitors (mock-up v5, screen 07).
 *
 * Everything here is obviously made up: the service is the demo service, every title and room
 * starts "Demo", and every member is "Demo registrar n" or "Demo consultant n". Nothing is read
 * from or sent to a server. The next 48 hours are laid out around `now`, so "On now", "Today"
 * and the 48-hour window stay true whenever the demo is opened: one session running with its
 * check-ins, one later today with no room set (the one thing to check), and one ready.
 */

export type DemoSoonSession = SessionSummary & {
  /** How many have checked in to a session that is running. Demo only; the week read has no count. */
  readonly checkedIn?: number;
};

export type DemoSentChange = {
  readonly id: string;
  readonly title: string;
  /** Perth date key of the changed occurrence. */
  readonly date: string;
  readonly status: "moved" | "cancelled";
  readonly venue: string | null;
  readonly reason: string | null;
};

export type DemoOrganiseMember = {
  readonly userId: string;
  readonly name: string;
  readonly role: "doctor";
  readonly joinedAt: string;
};

export type DemoOrganise = {
  readonly service: { readonly id: string; readonly name: string };
  readonly soon: DemoSoonSession[];
  readonly read: { series: SeriesRow[]; groups: GroupRow[]; members: DemoOrganiseMember[] };
  readonly changes: DemoSentChange[];
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const HALF_HOUR = 30 * MINUTE;
const REGISTRARS = 12;
const CONSULTANTS = 6;
const GROUP_REGISTRARS = "00000000-0000-4000-b000-000000000001";
const GROUP_CONSULTANTS = "00000000-0000-4000-b000-000000000002";

const uuid = (block: string, n: number) => `00000000-0000-4000-${block}-${String(n).padStart(12, "0")}`;

function plusDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function session(
  n: number,
  title: string,
  startsAt: number,
  minutes: number,
  venue: string | null,
  checkedIn?: number,
): DemoSoonSession {
  return {
    occurrenceId: uuid("c000", n),
    serviceId: DEMO_TEACHING_SERVICE_ID,
    title,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + minutes * MINUTE).toISOString(),
    venue,
    hasJoinLink: false,
    status: "scheduled",
    isPresenter: false,
    source: "teaching",
    ...(checkedIn === undefined ? {} : { checkedIn }),
  };
}

function series(
  n: number,
  from: DemoSoonSession,
  repeat: SeriesRow["repeat"],
  audience: SeriesAudience,
  groupIds: string[],
): SeriesRow {
  const firstDate = perthDate(from.startsAt);
  return {
    seriesId: uuid("d000", n),
    title: from.title,
    kind: "lecture",
    groupIds,
    repeat,
    firstDate,
    startTime: perthTime(from.startsAt),
    minutes: Math.round((Date.parse(from.endsAt) - Date.parse(from.startsAt)) / MINUTE),
    venue: from.venue,
    joinUrl: null,
    skipDates: [],
    endDate: plusDays(firstDate, 182),
    presenterId: null,
    materials: [],
    lastConfirmedAt: null,
    audience,
  };
}

export function demoOrganise(now: Date = new Date()): DemoOrganise {
  const at = now.getTime();
  const slot = Math.floor(at / HALF_HOUR) * HALF_HOUR;
  const today = perthToday(now);
  let workshopStart = Date.parse(perthInstant(plusDays(today, 2), "12:00"));
  if (workshopStart >= at + 48 * HOUR) workshopStart -= 24 * HOUR;

  const casePresentation = session(1, "Demo case presentation", slot, 60, "Demo seminar room", 12);
  const journalClub = session(2, "Demo journal club", slot + 90 * MINUTE, 60, null);
  const workshop = session(3, "Demo clinical skills workshop", workshopStart, 120, "Demo simulation suite");

  const members: DemoOrganiseMember[] = [
    ...Array.from({ length: REGISTRARS }, (_, i) => ({
      userId: uuid("e000", i + 1),
      name: `Demo registrar ${i + 1}`,
      role: "doctor" as const,
      joinedAt: "2026-02-02T00:00:00.000Z",
    })),
    ...Array.from({ length: CONSULTANTS }, (_, i) => ({
      userId: uuid("e000", REGISTRARS + i + 1),
      name: `Demo consultant ${i + 1}`,
      role: "doctor" as const,
      joinedAt: "2026-02-02T00:00:00.000Z",
    })),
  ];

  const workshopDate = perthDate(workshop.startsAt);
  const caseDate = perthDate(casePresentation.startsAt);
  return {
    service: { id: DEMO_TEACHING_SERVICE_ID, name: DEMO_TEACHING_TEAM.name },
    soon: [casePresentation, journalClub, workshop],
    read: {
      series: [
        series(1, casePresentation, "weekly", "all_doctors", []),
        series(2, journalClub, "fortnightly", "registrars", [GROUP_REGISTRARS]),
        series(3, workshop, "monthly_nth", "registrars", [GROUP_REGISTRARS]),
      ],
      groups: [
        { groupId: GROUP_REGISTRARS, name: "Registrars", userIds: members.slice(0, REGISTRARS).map((m) => m.userId) },
        { groupId: GROUP_CONSULTANTS, name: "Consultants", userIds: members.slice(REGISTRARS).map((m) => m.userId) },
      ],
      members,
    },
    changes: [
      {
        id: "demo-change-1",
        title: workshop.title,
        date: plusDays(workshopDate, 35),
        status: "moved",
        venue: "Demo simulation suite B",
        reason: "room clash",
      },
      {
        id: "demo-change-2",
        title: casePresentation.title,
        date: plusDays(caseDate, 112),
        status: "cancelled",
        venue: null,
        reason: "public holiday",
      },
    ],
  };
}
