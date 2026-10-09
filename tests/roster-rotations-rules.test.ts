import { describe, expect, it } from "vitest";

import { allocateRotations } from "@/lib/roster/rotations/allocate";
import { roundSetupSchema, type ManagedRound, type RoundSetup } from "@/lib/roster/rotations/model";
import {
  createManagedRound,
  editRoundSetup,
  movePlacement,
  openRound,
  publishRound,
  runAllocation,
  savePreference,
} from "@/lib/roster/rotations/operations";

/**
 * The round rules in `operations.ts` and the honesty of the allocator's
 * reasons, found in review: an edit after publishing that would overfill a
 * rotation, publishing a round that is open again, two locks giving one person
 * the same rotation twice, and reasons that said something untrue.
 */

const NOW = new Date("2026-10-09T02:00:00Z");
const LATER = new Date("2026-10-20T02:00:00Z");

const terms = [
  { id: "t1", label: "Term 1", start: "2027-02-01", end: "2027-05-02" },
  { id: "t2", label: "Term 2", start: "2027-05-03", end: "2027-08-01" },
];

function setup(overrides: Partial<RoundSetup> = {}): RoundSetup {
  return {
    name: "2027 rotations",
    closesAt: "2026-10-16T09:00:00Z",
    minRanked: 1,
    terms,
    rotations: [
      { id: "cl", name: "Consultation liaison", site: "A", places: 1 },
      { id: "ed", name: "Emergency psychiatry", site: "A", places: 1 },
    ],
    people: [
      { id: "a", name: "Dr Amira Lowe" },
      { id: "b", name: "Dr Ben Ng" },
    ],
    ...overrides,
  };
}

function allocated(overrides: Partial<RoundSetup> = {}): ManagedRound {
  let round = createManagedRound(setup(overrides), {
    id: "round-1",
    serviceId: "team",
    teamName: "Team",
    adminName: "Dr Admin",
    now: NOW,
  });
  round = openRound(round, NOW);
  round = savePreference(round, "a", ["cl", "ed"], true, NOW);
  round = savePreference(round, "b", ["cl", "ed"], true, NOW);
  return runAllocation(round, LATER);
}

describe("round rules", () => {
  it("refuses an edit after publishing that leaves more people in a rotation than its places", () => {
    const published = publishRound(allocated(), LATER);
    const fewer = setup({
      rotations: [
        { id: "cl", name: "Consultation liaison", site: "A", places: 0 },
        { id: "ed", name: "Emergency psychiatry", site: "A", places: 1 },
      ],
    });
    expect(() => editRoundSetup(published, fewer)).toThrow(/Move someone out before you lower its places/);
  });

  it("works out the empty terms again when someone joins a published round", () => {
    const published = publishRound(allocated(), LATER);
    const more = setup({ people: [...setup().people, { id: "c", name: "Dr Cara Diaz" }] });
    const edited = editRoundSetup(published, more);
    expect(edited.allocation?.placements).toHaveLength(4);
    expect(edited.allocation?.unfilled.map((item) => item.personId)).toEqual(["c", "c"]);
    expect(edited.allocation?.summary).toMatchObject({ people: 3, unfilled: 2 });
  });

  it("will not publish while the round is open again", () => {
    const reopened = openRound(allocated(), NOW);
    expect(() => publishRound(reopened, NOW)).toThrow(/Close the round/);
  });

  it("refuses a hand move that repeats a rotation", () => {
    const round = allocated({
      rotations: [
        { id: "cl", name: "Consultation liaison", site: "A", places: 2 },
        { id: "ed", name: "Emergency psychiatry", site: "A", places: 2 },
      ],
    });
    const aTerm1 = round.allocation!.placements.find((p) => p.personId === "a" && p.termId === "t1")!;
    const other = aTerm1.rotationId === "cl" ? "ed" : "cl";
    // a already has `other` in Term 2, so moving them to it in Term 1 repeats it.
    expect(() => movePlacement(round, { personId: "a", termId: "t1", rotationId: other, lock: false })).toThrow(
      /already have/,
    );
  });

  it("checks people's names and grades for patient details too", () => {
    expect(() =>
      createManagedRound(setup({ people: [{ id: "a", name: "Bed 12 unit" }] }), {
        id: "round-2",
        serviceId: "team",
        teamName: "Team",
        adminName: "Dr Admin",
        now: NOW,
      }),
    ).toThrow(/patient detail/);
  });

  it("refuses ids with spaces or line breaks", () => {
    expect(roundSetupSchema.safeParse(setup()).success).toBe(true);
    const bad = setup({ terms: [{ ...terms[0], id: "t1\r\nX" }] });
    expect(roundSetupSchema.safeParse(bad).success).toBe(false);
  });
});

describe("allocation reasons and locks", () => {
  const base = {
    seed: "r",
    terms,
    rotations: [
      { id: "cl", name: "Consultation liaison", site: "A", places: 1 },
      { id: "ed", name: "Emergency psychiatry", site: "A", places: 1 },
      { id: "fx", name: "Forensic", site: "B", places: 0 },
    ],
    people: ["a"],
  };

  it("never gives one person the same rotation twice through two fixed placements", () => {
    const result = allocateRotations({
      ...base,
      preferences: [],
      locks: [
        { personId: "a", termId: "t1", rotationId: "cl" },
        { personId: "a", termId: "t2", rotationId: "cl" },
      ],
    });
    expect(result.placements.filter((p) => p.rotationId === "cl")).toHaveLength(1);
    expect(result.problems.join(" ")).toMatch(/same rotation twice/);
  });

  it("does not say every ranked rotation was full when the person got all of them", () => {
    const result = allocateRotations({ ...base, preferences: [{ personId: "a", ranking: ["cl"] }] });
    const free = result.placements.find((p) => p.rank === null)!;
    expect(free.reason).not.toMatch(/full/);
    expect(free.reason).toMatch(/You had every rotation you ranked already/);
  });

  it("names a ranked rotation that has no places rather than calling it full", () => {
    const result = allocateRotations({ ...base, preferences: [{ personId: "a", ranking: ["fx", "cl", "ed"] }] });
    const second = result.placements.find((p) => p.rank === 2)!;
    expect(second.reason).toBe("Your 2nd choice. Forensic has no places in this round.");
  });

  it("says a missed rotation went to someone who ranked it as high or higher", () => {
    const result = allocateRotations({
      seed: "r",
      terms: [terms[0]],
      rotations: base.rotations.slice(0, 2),
      people: ["a", "b"],
      preferences: [
        { personId: "a", ranking: ["cl", "ed"] },
        { personId: "b", ranking: ["cl", "ed"] },
      ],
    });
    const second = result.placements.find((p) => p.rank === 2)!;
    expect(second.reason).toBe(
      "Your 2nd choice. Consultation liaison was full with people who ranked it as high or higher.",
    );
  });
});
