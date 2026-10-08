import { describe, expect, it } from "vitest";

import { allocateRotations, cleanRanking, ordinal, type AllocationInput } from "@/lib/roster/rotations/allocate";

const terms = [
  { id: "t1", label: "Term 1", start: "2027-02-01", end: "2027-05-02" },
  { id: "t2", label: "Term 2", start: "2027-05-03", end: "2027-08-01" },
];

function input(overrides: Partial<AllocationInput> = {}): AllocationInput {
  return {
    seed: "round-1",
    terms,
    rotations: [
      { id: "cl", name: "Consultation liaison", site: "A", places: 1 },
      { id: "ed", name: "Emergency psychiatry", site: "A", places: 1 },
      { id: "cmh", name: "Community", site: "B", places: 1 },
    ],
    people: ["a", "b", "c"],
    preferences: [
      { personId: "a", ranking: ["cl", "ed", "cmh"] },
      { personId: "b", ranking: ["cl", "cmh", "ed"] },
      { personId: "c", ranking: ["ed", "cl", "cmh"] },
    ],
    ...overrides,
  };
}

function check(result: ReturnType<typeof allocateRotations>, data: AllocationInput) {
  // No person twice in a term, no rotation over its places, no repeated rotation per person.
  const seen = new Set<string>();
  const load = new Map<string, number>();
  for (const p of result.placements) {
    const personTerm = `${p.personId}:${p.termId}`;
    expect(seen.has(personTerm)).toBe(false);
    seen.add(personTerm);
    const personRotation = `${p.personId}:${p.rotationId}`;
    expect(seen.has(personRotation)).toBe(false);
    seen.add(personRotation);
    const key = `${p.rotationId}:${p.termId}`;
    load.set(key, (load.get(key) ?? 0) + 1);
  }
  for (const [key, n] of load) {
    const rotation = data.rotations.find((r) => key.startsWith(`${r.id}:`));
    expect(n).toBeLessThanOrEqual(rotation?.places ?? 0);
  }
}

describe("allocateRotations", () => {
  it("fills every term and gives as many first choices as places allow", () => {
    const data = input();
    const result = allocateRotations(data);
    check(result, data);
    expect(result.summary.placements).toBe(6);
    expect(result.summary.unfilled).toBe(0);
    // cl has 2 places over the year (a and b both rank it 1st), ed 2 places (c ranks 1st).
    expect(result.summary.byRank[0]).toBe(3);
    expect(result.summary.peopleWithFirstChoice).toBe(3);
  });

  it("is deterministic for the same seed", () => {
    expect(allocateRotations(input())).toEqual(allocateRotations(input()));
  });

  it("prefers one more first choice over any number of second choices", () => {
    const data = input({
      terms: [terms[0]],
      rotations: [
        { id: "x", name: "X", site: "A", places: 1 },
        { id: "y", name: "Y", site: "A", places: 1 },
      ],
      people: ["a", "b"],
      preferences: [
        { personId: "a", ranking: ["x", "y"] },
        { personId: "b", ranking: ["y", "x"] },
      ],
    });
    const result = allocateRotations(data);
    expect(result.placements.map((p) => [p.personId, p.rotationId])).toEqual([
      ["a", "x"],
      ["b", "y"],
    ]);
    expect(result.placements.every((p) => p.reason === "Your 1st choice")).toBe(true);
  });

  it("keeps admin locks exactly and explains them", () => {
    const data = input({ locks: [{ personId: "c", termId: "t2", rotationId: "cmh" }] });
    const result = allocateRotations(data);
    check(result, data);
    const locked = result.placements.find((p) => p.locked);
    expect(locked).toMatchObject({ personId: "c", termId: "t2", rotationId: "cmh" });
    expect(locked?.reason).toBe("Set by the rotation administrator");
    expect(result.summary.unfilled).toBe(0);
  });

  it("reports unfilled terms when there are fewer places than people", () => {
    const data = input({ people: ["a", "b", "c", "d"] });
    const result = allocateRotations(data);
    check(result, data);
    expect(result.summary.unfilled).toBe(2);
    expect(result.unfilled[0].reason).toMatch(/fewer places/);
  });

  it("explains a lower choice by naming the full rotation", () => {
    const result = allocateRotations(input({ terms: [terms[0]] }));
    const second = result.placements.find((p) => p.rank === 2);
    expect(second?.reason).toMatch(/^Your 2nd choice\. Consultation liaison was full with people who ranked it as high or higher\.$/);
    const multiTerm = allocateRotations(input());
    expect(multiTerm.placements.filter((p) => p.rank === 2).every((p) => p.reason === "Your 2nd choice")).toBe(true);
  });

  it("places people with no preferences into free places", () => {
    const data = input({ preferences: input().preferences.slice(0, 2) });
    const result = allocateRotations(data);
    check(result, data);
    expect(result.placements.filter((p) => p.personId === "c").every((p) => p.rank === null)).toBe(true);
  });

  it("schedules a larger round without clashes", () => {
    const rotations = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, site: "A", places: 2 }));
    const people = Array.from({ length: 16 }, (_, i) => `p${i}`);
    const fourTerms = [0, 1, 2, 3].map((i) => ({ id: `t${i}`, label: `Term ${i + 1}`, start: "2027-01-01", end: "2027-03-01" }));
    const preferences = people.map((personId, i) => ({
      personId,
      ranking: rotations.map((_, k) => `r${(i + k * 3) % 8}`),
    }));
    const data = { seed: "big", terms: fourTerms, rotations, people, preferences };
    const result = allocateRotations(data);
    check(result, data);
    expect(result.summary.placements).toBe(64);
    expect(result.summary.unfilled).toBe(0);
  });
});

describe("helpers", () => {
  it("cleans rankings", () => {
    expect(cleanRanking(["a", "z", "a", "b"], new Set(["a", "b"]))).toEqual(["a", "b"]);
  });
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});
