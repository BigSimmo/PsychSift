import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  adminRankTag,
  capacityCheck,
  checkDraft,
  closesInPast,
  draftFromRound,
  groupByRotation,
  groupRounds,
  halfYearTerms,
  initials,
  moveOptions,
  newRoundDraft,
  nextTermStart,
  peopleYears,
  placedIds,
  quarterTerms,
  rankMeter,
  resultHeadline,
  resultLine,
  roundIdFromParam,
  roundLine,
  roundStatusTag,
  stillToSend,
  yearSpanLabel,
  manageRoundHref,
} from "@/components/roster/rotations/admin/round-admin-model";
import { exampleRotationRounds } from "@/lib/example-data/datasets/roster-rotations";
import { closeRound, createManagedRound, movePlacement } from "@/lib/roster/rotations/operations";

const NOW = new Date("2026-10-09T02:00:00Z"); // Fri 9 Oct, 10:00 in Perth
const example = exampleRotationRounds(NOW);
const open = example.rounds.find((round) => round.round.status === "open")!;
const published = example.rounds.find((round) => round.round.status === "published")!;
const ids = (prefix: string) => (index: number) => `${prefix}${index}`;

describe("term presets", () => {
  it("makes four back-to-back terms of 13 weeks", () => {
    const terms = quarterTerms("2027-02-01", ids("t"));
    expect(terms.map((term) => [term.label, term.start, term.end])).toEqual([
      ["Term 1", "2027-02-01", "2027-05-02"],
      ["Term 2", "2027-05-03", "2027-08-01"],
      ["Term 3", "2027-08-02", "2027-10-31"],
      ["Term 4", "2027-11-01", "2028-01-30"],
    ]);
    expect(terms.map((term) => term.id)).toEqual(["t0", "t1", "t2", "t3"]);
  });

  it("makes two terms of six months that end the day before the next starts", () => {
    expect(halfYearTerms("2027-02-01", ids("h")).map((term) => [term.start, term.end])).toEqual([
      ["2027-02-01", "2027-07-31"],
      ["2027-08-01", "2028-01-31"],
    ]);
  });

  it("adds months without running off a short month", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
  });

  it("starts a new term the day after the last one ends", () => {
    expect(nextTermStart([{ end: "2027-05-02" }, { end: "2027-08-01" }], "2027-02-01")).toBe("2027-08-02");
    expect(nextTermStart([], "2027-02-01")).toBe("2027-02-01");
  });

  it("names the year the terms cover", () => {
    expect(yearSpanLabel(quarterTerms("2027-02-01", ids("t")))).toBe("1 Feb 2027 to 30 Jan 2028");
    expect(yearSpanLabel([])).toBe("No terms yet");
  });
});

describe("capacity check", () => {
  it("says when there are enough places", () => {
    expect(capacityCheck(12, 13)).toEqual({ tone: "ok", text: "12 doctors need 12 places a term. You have 13." });
    expect(capacityCheck(1, 1).text).toBe("1 doctor needs 1 place a term. You have 1.");
  });

  it("warns when places are short, with how many to add", () => {
    expect(capacityCheck(18, 13)).toEqual({
      tone: "short",
      text: "18 doctors need 18 places a term. You have 13. Add 5 more or some terms stay empty.",
    });
  });

  it("asks for people when there are none", () => {
    expect(capacityCheck(0, 4).tone).toBe("short");
  });
});

describe("rounds list", () => {
  const draft = createManagedRound(
    { ...draftSetup(), name: "Next draft" },
    { id: "example:round:d", serviceId: "s", teamName: "Team", adminName: "Admin", now: NOW },
  );
  const closed = closeRound(open);

  it("groups rounds by what needs the administrator first, leaving out empty groups", () => {
    const groups = groupRounds([published, draft, open, closed]);
    expect(groups.map((group) => group.id)).toEqual(["open", "review", "drafts", "published"]);
    expect(groupRounds([published]).map((group) => group.label)).toEqual(["Published"]);
  });

  it("writes the progress line for an open round", () => {
    expect(roundLine(open, NOW)).toBe("8 of 12 sent · closes Thu 15 Oct");
    expect(roundLine(open, new Date("2026-11-01T00:00:00Z"))).toBe("8 of 12 sent · closing time passed");
  });

  it("writes the line for a draft, a closed round and a published one", () => {
    expect(roundLine(draft, NOW)).toBe("Draft · 4 terms · 2 rotations · 2 people");
    expect(roundLine(closed, NOW)).toBe("8 of 12 sent · ready to allocate");
    expect(roundLine(published, NOW)).toBe("Published 6 Nov 2025 · 12 people");
  });

  it("tags each status in words", () => {
    expect(roundStatusTag(open)).toEqual({ label: "Open", tone: "amber" });
    expect(roundStatusTag(draft)).toEqual({ label: "Draft", tone: "neutral" });
    expect(roundStatusTag(published)).toEqual({ label: "Published", tone: "green" });
  });

  it("round-trips a round id through the address", () => {
    const href = manageRoundHref("example:round:2027");
    expect(href).toBe("/roster/manage/rotations/example%3Around%3A2027");
    expect(roundIdFromParam(href.split("/").pop()!)).toBe("example:round:2027");
    expect(roundIdFromParam("%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("collecting preferences", () => {
  it("lists who has not sent, drafts first", () => {
    const waiting = stillToSend(open);
    expect(waiting).toHaveLength(4);
    expect(waiting[0]!.state).toBe("draft");
    expect(waiting.slice(1).every((person) => person.state === "none")).toBe(true);
  });
});

describe("reviewing an allocation", () => {
  const term = published.round.terms[0]!;

  it("groups one term by rotation with no one placed twice", () => {
    const view = groupByRotation(published, term.id);
    expect(view.groups.map((group) => group.rotation.id)).toEqual(published.round.rotations.map((r) => r.id));
    const placed = view.groups.flatMap((group) => group.people.map((entry) => entry.person.id));
    expect(new Set(placed).size).toBe(placed.length);
    for (const group of view.groups) expect(group.people.length).toBeLessThanOrEqual(group.rotation.places);
    expect(placed.length + view.unfilled.length).toBe(published.round.people.length);
  });

  it("lays out each person's year across every term", () => {
    const years = peopleYears(published);
    expect(years).toHaveLength(published.round.people.length);
    for (const year of years) expect(year.terms).toHaveLength(published.round.terms.length);
    const names = years.map((year) => year.person.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("builds the stacked meter from the summary", () => {
    const meter = rankMeter({ byRank: [6, 3, 1, 1], unranked: 1, placements: 12 });
    expect(meter.map((segment) => segment.count)).toEqual([6, 3, 1, 2]);
    expect(meter.reduce((sum, segment) => sum + segment.fraction, 0)).toBeCloseTo(1);
    expect(rankMeter({ byRank: [0], unranked: 0, placements: 0 }).every((s) => s.fraction === 0)).toBe(true);
  });

  it("writes the headline and the line", () => {
    expect(resultHeadline({ people: 12, peopleWithFirstChoice: 12, placements: 48 })).toBe(
      "Every doctor got a 1st choice",
    );
    expect(resultHeadline({ people: 12, peopleWithFirstChoice: 9, placements: 48 })).toBe("9 of 12 got a 1st choice");
    expect(resultLine({ byRank: [30, 10, 5], unranked: 3, placements: 48 })).toBe(
      "48 places · 30 1st, 10 2nd, 5 3rd, 3 lower",
    );
  });

  it("tags ranks for the administrator", () => {
    expect(adminRankTag(1)).toEqual({ label: "1st", tone: "green" });
    expect(adminRankTag(3)).toEqual({ label: "3rd", tone: "mode" });
    expect(adminRankTag(null)).toEqual({ label: "Not ranked", tone: "neutral" });
  });

  it("offers moves with full rotations and repeats blocked, ranked ones first", () => {
    const personId = published.round.people[0]!.id;
    const options = moveOptions(published, personId, term.id);
    expect(options).toHaveLength(published.round.rotations.length);
    expect(options.filter((option) => option.current)).toHaveLength(1);
    const ranked = options.filter((option) => option.rank !== null).map((option) => option.rank);
    expect(ranked).toEqual([...ranked].sort((a, b) => a! - b!));
    for (const option of options) {
      if (option.current) continue;
      const full = option.taken >= option.rotation.places;
      if (full) expect(option.blocked).toMatch(/Full|No places/);
    }
    // Something they already have in another term is blocked with that term's name.
    const elsewhere = published.allocation!.placements.find((p) => p.personId === personId && p.termId !== term.id)!;
    const repeat = options.find((option) => option.rotation.id === elsewhere.rotationId)!;
    if (!repeat.current && repeat.taken < repeat.rotation.places) {
      expect(repeat.blocked).toMatch(/^They have it in Term/);
    }
  });

  it("lets a free rotation take a move the rules accept", () => {
    const personId = published.round.people[0]!.id;
    const choice = moveOptions(published, personId, term.id).find((option) => !option.current && !option.blocked);
    if (!choice) return;
    const moved = movePlacement(
      published,
      { personId, termId: term.id, rotationId: choice.rotation.id, lock: true },
      NOW,
    );
    const placement = moved.allocation!.placements.find((p) => p.personId === personId && p.termId === term.id);
    expect(placement?.rotationId).toBe(choice.rotation.id);
    expect(placement?.locked).toBe(true);
  });

  it("holds placed terms, rotations and people once published, and nothing before", () => {
    const held = placedIds(published);
    expect(held.terms.size).toBe(published.round.terms.length);
    expect(held.people.size).toBeGreaterThan(0);
    expect(placedIds(open).terms.size).toBe(0);
  });
});

describe("initials", () => {
  it("drops a title and takes first and last names", () => {
    expect(initials("Dr Amira Lowe")).toBe("AL");
    expect(initials("Cleo")).toBe("C");
    expect(initials("  ")).toBe("?");
  });
});

describe("the round form", () => {
  it("starts a new round for next year closing in two weeks at 5 pm Perth time", () => {
    const draft = newRoundDraft({
      now: NOW,
      people: [{ id: "p1", name: "Amira Lowe" }],
      rotations: [{ id: "r1", name: "Community", site: "Clinic", places: 1 }],
      makeId: (kind, index) => `${kind}${index}`,
    });
    expect(draft.name).toBe("2027 rotations");
    expect(draft.closesDate).toBe("2026-10-23");
    expect(draft.closesTime).toBe("17:00");
    expect(draft.minRanked).toBe(1);
    expect(draft.terms).toHaveLength(4);
    expect(draft.terms[0]!.start).toBe("2027-02-01");
    expect(checkDraft(draft)).toMatchObject({ ok: true });
  });

  it("round-trips an existing round, closing time included", () => {
    const draft = draftFromRound(open.round);
    const check = checkDraft(draft);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.setup.closesAt).toBe(new Date(open.round.closesAt).toISOString());
      expect(check.setup.terms).toEqual(open.round.terms);
      expect(check.setup.rotations).toEqual(open.round.rotations);
    }
  });

  it("names the first thing to fix and the step it is on", () => {
    const base = draftFromRound(open.round);
    expect(checkDraft({ ...base, terms: [] })).toEqual({ ok: false, message: "Add at least one term.", step: "terms" });
    expect(checkDraft({ ...base, rotations: [] })).toMatchObject({ ok: false, step: "rotations" });
    expect(checkDraft({ ...base, name: "  " })).toMatchObject({ ok: false, step: "who" });
    expect(checkDraft({ ...base, people: [] })).toMatchObject({ ok: false, step: "who" });
    expect(checkDraft({ ...base, closesDate: "" })).toMatchObject({ ok: false, step: "who" });
    const backwards = base.terms.map((term, index) => (index === 0 ? { ...term, end: "2000-01-01" } : term));
    expect(checkDraft({ ...base, terms: backwards })).toMatchObject({ ok: false, step: "terms" });
  });

  it("surfaces the round rules: overlapping terms", () => {
    const base = draftFromRound(open.round);
    const overlapping = base.terms.map((term, index) => (index === 1 ? { ...term, start: base.terms[0]!.end } : term));
    expect(checkDraft({ ...base, terms: overlapping })).toEqual({
      ok: false,
      message: "Term 2 overlaps Term 1.",
      step: "terms",
    });
  });

  it("catches a patient detail and points at its step", () => {
    const base = draftFromRound(open.round);
    const result = checkDraft({
      ...base,
      rotations: base.rotations.map((rotation, index) =>
        index === 0 ? { ...rotation, name: "Bed 12 UMRN 1234567" } : rotation,
      ),
    });
    expect(result).toMatchObject({ ok: false, step: "rotations" });
    if (!result.ok) expect(result.message).toMatch(/patient detail/);
    const note = checkDraft({ ...base, note: "Pt John Smith 45M bed 4" });
    expect(note).toMatchObject({ ok: false, step: "who" });
  });

  it("knows when the closing time has passed", () => {
    expect(closesInPast({ closesDate: "2026-10-09", closesTime: "09:59" }, NOW)).toBe(true);
    expect(closesInPast({ closesDate: "2026-10-09", closesTime: "10:01" }, NOW)).toBe(false);
  });
});

function draftSetup(): Parameters<typeof createManagedRound>[0] {
  return {
    name: "Draft",
    closesAt: "2026-10-30T09:00:00.000Z",
    minRanked: 1,
    terms: quarterTerms("2027-02-01", ids("example:t")),
    rotations: [
      { id: "example:r1", name: "Community", site: "Clinic", places: 1 },
      { id: "example:r2", name: "Addictions", site: "Clinic", places: 1 },
    ],
    people: [
      { id: "example:p1", name: "Amira Lowe" },
      { id: "example:p2", name: "Ben Reyes" },
    ],
  };
}
