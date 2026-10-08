import { EXAMPLE_HOSPITALS, EXAMPLE_PEOPLE, EXAMPLE_SELF } from "@/lib/example-data/people";
import type { ManagedRound, RoundSetup } from "@/lib/roster/rotations/model";
import {
  createManagedRound,
  openRound,
  publishRound,
  runAllocation,
  savePreference,
} from "@/lib/roster/rotations/operations";

/**
 * Example rotation rounds: last year's round, already published (so the
 * reader's current rotation shows on their calendar), and next year's round,
 * open for preferences with most of the team already sent. The reader is both
 * a doctor in the rounds and their administrator, so every screen can be tried.
 */

export const EXAMPLE_ROTATION_SELF_ID = "example:rotations:me";
export const EXAMPLE_ROTATION_SERVICE_ID = "example:rotations:team";

export type ExampleRotationRounds = {
  readonly selfId: string;
  readonly rounds: readonly ManagedRound[];
};

const [MAIN, CAMPUS, UNIT] = EXAMPLE_HOSPITALS;

const ROTATIONS: RoundSetup["rotations"] = [
  { id: "example:rot:cl", name: "Consultation liaison", site: MAIN, places: 2 },
  { id: "example:rot:ed", name: "Emergency psychiatry", site: MAIN, places: 1 },
  { id: "example:rot:acute", name: "Inpatient acute", site: UNIT, places: 3 },
  { id: "example:rot:older", name: "Older adult", site: CAMPUS, places: 2 },
  { id: "example:rot:youth", name: "Youth mental health", site: CAMPUS, places: 1 },
  { id: "example:rot:community", name: "Community", site: CAMPUS, places: 2 },
  { id: "example:rot:addictions", name: "Addictions", site: MAIN, places: 1 },
  { id: "example:rot:forensic", name: "Forensic", site: UNIT, places: 1 },
];

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Four terms of about thirteen weeks from early February. */
function termsFor(year: number): RoundSetup["terms"] {
  return [
    { id: `example:term:${year}:1`, label: "Term 1", start: iso(year, 2, 1), end: iso(year, 5, 2) },
    { id: `example:term:${year}:2`, label: "Term 2", start: iso(year, 5, 3), end: iso(year, 8, 1) },
    { id: `example:term:${year}:3`, label: "Term 3", start: iso(year, 8, 2), end: iso(year, 10, 31) },
    { id: `example:term:${year}:4`, label: "Term 4", start: iso(year, 11, 1), end: iso(year + 1, 1, 31) },
  ];
}

const PEOPLE: RoundSetup["people"] = [
  { id: EXAMPLE_ROTATION_SELF_ID, name: EXAMPLE_SELF, grade: "Registrar" },
  ...EXAMPLE_PEOPLE.slice(0, 11).map((name, index) => ({
    id: `example:rotations:person:${index + 1}`,
    name,
    grade: index % 3 === 0 ? "Senior registrar" : "Registrar",
  })),
];

const ids = ROTATIONS.map((rotation) => rotation.id);
/** A spread of believable rankings: CL and ED are popular, Forensic less so. */
function rankingFor(index: number): string[] {
  const popular = [0, 1, 3, 5, 2, 4, 6, 7];
  const shift = index % 4;
  const order = [...popular.slice(shift), ...popular.slice(0, shift)];
  return order.slice(0, 6).map((i) => ids[i]);
}

export function exampleRotationRounds(now: Date): ExampleRotationRounds {
  const year = Number(now.toISOString().slice(0, 4));
  const admin = EXAMPLE_PEOPLE[11];
  const meta = (id: string, at: Date) => ({
    id,
    serviceId: EXAMPLE_ROTATION_SERVICE_ID,
    teamName: "Example registrars",
    adminName: admin,
    now: at,
  });

  // Last year's round, published the November before this year began.
  const earlierOpen = new Date(Date.UTC(year - 1, 9, 1));
  const earlierClose = new Date(Date.UTC(year - 1, 9, 30, 9));
  let published = createManagedRound(
    {
      name: `${year} rotations`,
      closesAt: earlierClose.toISOString(),
      minRanked: 4,
      terms: termsFor(year),
      rotations: ROTATIONS,
      people: PEOPLE,
    },
    meta(`example:round:${year}`, earlierOpen),
  );
  published = openRound(published, earlierOpen);
  PEOPLE.forEach((person, index) => {
    published = savePreference(
      published,
      person.id,
      rankingFor(index + 1),
      true,
      new Date(earlierOpen.getTime() + index * 3_600_000),
    );
  });
  published = runAllocation(published, new Date(earlierClose.getTime() + 86_400_000));
  published = publishRound(published, new Date(Date.UTC(year - 1, 10, 6, 1)));

  // Next year's round, open now and closing in six days.
  const openedAt = new Date(now.getTime() - 8 * 86_400_000);
  const closesAt = new Date(now.getTime() + 6 * 86_400_000);
  closesAt.setUTCHours(9, 0, 0, 0); // 17:00 in Perth
  let open = createManagedRound(
    {
      name: `${year + 1} rotations`,
      closesAt: closesAt.toISOString(),
      minRanked: 4,
      terms: termsFor(year + 1),
      rotations: ROTATIONS,
      people: PEOPLE,
      note: "Rank at least four. Places are per term.",
    },
    meta(`example:round:${year + 1}`, openedAt),
  );
  open = openRound(open, openedAt);
  PEOPLE.slice(1).forEach((person, index) => {
    if (index >= 9) return; // two people have not started
    const sent = index < 8;
    open = savePreference(
      open,
      person.id,
      rankingFor(index + 3),
      sent,
      new Date(openedAt.getTime() + (index + 1) * 7_200_000),
    );
  });

  return { selfId: EXAMPLE_ROTATION_SELF_ID, rounds: [open, published] };
}
