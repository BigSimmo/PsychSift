import { addDays } from "@/lib/calendar/calendar-event";
import {
  unloggedReviewRows,
  type CpdReviewRow,
  type FeedbackTotals,
  type ReadinessItem,
  type SessionRef,
  type SupervisionEntry,
  type SupervisionPairingView,
  type SupervisionTopic,
  type SupervisionType,
  type TeachSession,
} from "@/lib/teaching/depth-model";
import {
  DEMO_TEACHING_SERVICE_ID,
  DEMO_TEACHING_TEAM,
  demoTeachingFeedbackOwed,
  demoTeachingLogbook,
} from "@/lib/teaching/demo-programme";
import { perthInstant } from "@/lib/teaching/time";

/*
 * The depth pages' made-up demo (part 4). Demo mode never calls the depth routes; the UI reads these,
 * and a demo "save" stays in page memory. Made-up people only; ids are fixed so a re-render keeps them,
 * and they never meet the demo programme's own ids.
 */

const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const team = { serviceId: DEMO_TEACHING_SERVICE_ID, serviceName: DEMO_TEACHING_TEAM.name, readOnlyUntil: null };

function demoEntry(
  n: number,
  date: string,
  minutes: number,
  type: SupervisionType,
  topics: SupervisionTopic[],
  confirmedOn: string | null,
): SupervisionEntry {
  return {
    entryId: id(n),
    date,
    minutes,
    type,
    topics,
    status: confirmedOn ? "confirmed" : "pending",
    confirmedAt: confirmedOn ? perthInstant(confirmedOn, "09:00") : null,
    confirmedByName: confirmedOn ? "Dr Demo Supervisor" : null,
    notes: [],
  };
}

function totals(entries: readonly SupervisionEntry[]) {
  const pending = entries.filter((entry) => entry.status === "pending");
  const sum = (list: readonly SupervisionEntry[]) => list.reduce((total, entry) => total + entry.minutes, 0);
  return {
    confirmedMinutes: sum(entries) - sum(pending),
    pendingMinutes: sum(pending),
    pendingCount: pending.length,
    oldestPendingAt: null,
  };
}

/**
 * The demo reader is a registrar with Dr Demo Supervisor: 31 h confirmed towards a 50 h target, the
 * latest individual hour still waiting for the supervisor (mock-up v5, Presenting). The Supervision page
 * also gives the reader a made-up trainee to supervise, so confirming can be tried there; Presenting asks
 * for `{ supervising: false }`, the mock-up's presenter who supervises no one.
 */
export function demoSupervision(
  today: string,
  { supervising = true }: { supervising?: boolean } = {},
): SupervisionPairingView[] {
  const day = (offset: number) => addDays(today, offset);
  // Fortnightly two-hour sessions before the two latest entries, plus one 90-minute group session, so the
  // confirmed total is 31 h (24 Sep's 90 min included) and the pending 60 min is not counted.
  const earlier = Array.from({ length: 14 }, (_, fortnight) =>
    demoEntry(
      220 + fortnight,
      day(-26 - fortnight * 14),
      120,
      "individual",
      fortnight % 3 === 0 ? ["psychotherapy"] : fortnight % 3 === 1 ? ["case_review"] : ["exam_prep"],
      day(-25 - fortnight * 14),
    ),
  );
  const mine = [
    demoEntry(201, day(-5), 60, "individual", ["case_review", "psychotherapy"], null),
    demoEntry(202, day(-12), 90, "group", ["case_review", "risk"], day(-11)),
    ...earlier,
    demoEntry(203, day(-229), 90, "group", ["risk"], day(-228)),
  ];
  const theirs = [
    demoEntry(211, day(-1), 60, "individual", ["formulation", "medication"], null),
    demoEntry(212, day(-9), 30, "group", ["risk"], null),
  ];
  const dates = { startsOn: day(-250), endsOn: day(115) };
  const registrar: SupervisionPairingView = {
    ...team,
    ...dates,
    ...totals(mine),
    pairingId: id(101),
    access: "registrar",
    registrarName: "Dr Demo Registrar",
    supervisorName: "Dr Demo Supervisor",
    targetHours: 50,
    entries: mine,
  };
  if (!supervising) return [registrar];
  return [
    registrar,
    {
      ...team,
      startsOn: day(-60),
      endsOn: day(120),
      ...totals(theirs),
      pairingId: id(102),
      access: "supervisor",
      registrarName: "Dr Demo Trainee",
      supervisorName: "Dr Demo Registrar",
      targetHours: null,
      entries: theirs,
    },
  ];
}

/**
 * Presenting's demo talk can carry a short line under each readiness item ("Shared 2 Oct"). The live
 * read has no such detail, so live items show their label alone.
 */
export type DemoTeachSession = TeachSession & { itemNotes?: Partial<Record<ReadinessItem, string>> };

/** "2 Oct": a Perth calendar date written the way Teaching writes it. */
function shortDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${new Date(Date.UTC(year, month - 1, day)).getUTCDate()} ${months[month - 1]}`;
}

/**
 * The made-up presenter (mock-up v5, Presenting): a journal club today at 14:00 with three of four
 * items done and the patient-details check already confirmed, three later talks, and six talks given.
 * Every date is relative to today. Once 14:45 has passed (Perth), the talk moves to tomorrow so it is
 * never shown as next after it has ended.
 */
export function demoTeach(today: string, now?: Date): { upcoming: DemoTeachSession[]; taught: SessionRef[] } {
  const day = (offset: number) => addDays(today, offset);
  const over = now ? now.getTime() >= Date.parse(perthInstant(today, "14:45")) : false;
  const talkDay = over ? day(1) : today;
  const later = (
    n: number,
    title: string,
    offset: number,
    start: string,
    end: string,
    items: TeachSession["items"],
  ): DemoTeachSession => ({
    occurrenceId: id(n),
    serviceId: DEMO_TEACHING_SERVICE_ID,
    title,
    startsAt: perthInstant(day(offset), start),
    endsAt: perthInstant(day(offset), end),
    venue: "Seminar room",
    status: "scheduled",
    items,
    deidConfirmedAt: items.length > 0 ? perthInstant(day(-1), "09:00") : null,
  });
  const given = (n: number, title: string, offset: number): SessionRef => ({
    occurrenceId: id(n),
    serviceId: DEMO_TEACHING_SERVICE_ID,
    title,
    startsAt: perthInstant(day(offset), "12:30"),
    endsAt: perthInstant(day(offset), "13:30"),
  });
  return {
    upcoming: [
      {
        occurrenceId: id(301),
        serviceId: DEMO_TEACHING_SERVICE_ID,
        title: "Journal club",
        startsAt: perthInstant(talkDay, "14:00"),
        endsAt: perthInstant(talkDay, "14:45"),
        venue: "Library meeting room",
        status: "scheduled",
        items: ["reading_list", "aims", "slides_link"],
        deidConfirmedAt: perthInstant(day(-2), "18:00"),
        itemNotes: {
          reading_list: `Shared ${shortDate(day(-4))}`,
          aims: "3 aims",
          slides_link: `Added ${shortDate(day(-2))}`,
          room: "Library meeting room requested",
        },
      },
      later(305, "Registrar teaching", 28, "16:00", "17:00", ["reading_list"]),
      later(306, "Grand rounds", 70, "17:00", "18:00", []),
      later(307, "Case presentation", 126, "12:30", "13:30", []),
    ],
    taught: [
      given(302, "Case presentation", -21),
      given(303, "Journal club", -63),
      given(308, "Grand rounds", -105),
      given(309, "Registrar teaching", -147),
      given(310, "Case presentation", -189),
      given(311, "Journal club", -231),
    ],
  };
}

export function demoFeedbackTotals(): FeedbackTotals {
  return {
    released: true,
    replies: 9,
    useful: { 1: 0, 2: 0, 3: 1, 4: 3, 5: 5 },
    pace: { slow: 1, right: 7, fast: 1 },
  };
}

/** Feedback you owe in the demo: the same two sessions My record lists, read at midday on `today`. */
export function demoFeedbackOpen(today: string): SessionRef[] {
  return demoTeachingFeedbackOwed(new Date(perthInstant(today, "12:00")));
}

export function demoCpdReview(now: Date): CpdReviewRow[] {
  return unloggedReviewRows(demoTeachingLogbook(now), now);
}
