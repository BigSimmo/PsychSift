import type { Placement, RotationOption, RotationTerm } from "@/lib/roster/rotations/allocate";
import { ordinal } from "@/lib/roster/rotations/allocate";
import {
  placesPerTerm,
  roundSetupSchema,
  type ManagedRound,
  type RotationRound,
  type RoundSetup,
  type RoundStatus,
} from "@/lib/roster/rotations/model";
import {
  assertSetupConsistent,
  assertSetupHasNoPatientDetail,
  preferenceCounts,
  RotationRuleError,
} from "@/lib/roster/rotations/operations";
import { DEFAULT_WORK_TIME_ZONE } from "@/lib/work-time/zones";
import { zonedDateOf, zonedTimeOf, zonedWallToIso } from "@/lib/work-time/format";
import { formatClosingDay, formatDayWithYear, formatShortDate } from "@/components/roster/rotations/rotation-format";

/**
 * Pure helpers for the administrator's rotation screens: the rounds list, the
 * new-round form, and the review of an allocation. No clock of their own:
 * callers pass `now`, so the screens and the tests agree.
 *
 * A round's closing time is a team-wide deadline, so it is always set and
 * shown on Perth's wall clock, whatever the reader's own work time zone.
 */

export const ROUND_ZONE = DEFAULT_WORK_TIME_ZONE;
export const MANAGE_ROTATIONS_HREF = "/roster/manage/rotations";
export const NEW_ROUND_HREF = "/roster/manage/rotations/new";

export function manageRoundHref(roundId: string): string {
  return `${MANAGE_ROTATIONS_HREF}/${encodeURIComponent(roundId)}`;
}

/** A route segment back to the id it was made from (Next may hand it over encoded or not). */
export function roundIdFromParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// ---------------------------------------------------------------- dates

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** `YYYY-MM-DD` plus whole days. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` plus whole months, keeping the day where the month has it (31 Jan plus 1 is 28 or 29 Feb). */
export function addMonths(date: string, months: number): string {
  const match = DATE.exec(date);
  if (!match) return date;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1 + months;
  const day = Number(match[3]);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
}

/** "1 Feb 2027 to 30 Jan 2028" for a round's terms. */
export function yearSpanLabel(terms: readonly Pick<RotationTerm, "start" | "end">[]): string {
  if (terms.length === 0) return "No terms yet";
  const starts = terms.map((term) => term.start).sort();
  const ends = terms.map((term) => term.end).sort();
  const first = starts[0]!;
  const last = ends[ends.length - 1]!;
  return `${formatShortDate(first)} ${first.slice(0, 4)} to ${formatShortDate(last)} ${last.slice(0, 4)}`;
}

/** Whole days from now until the round closes, rounded up; 0 once it has passed. */
export function daysUntil(closesAt: string, now: Date): number {
  const left = Date.parse(closesAt) - now.getTime();
  return left <= 0 ? 0 : Math.ceil(left / 86_400_000);
}

// ---------------------------------------------------------------- term presets

export type TermDraft = { id: string; label: string; start: string; end: string };

/** Four terms of 13 weeks each, back to back from `start`. */
export function quarterTerms(start: string, makeId: (index: number) => string): TermDraft[] {
  return [0, 1, 2, 3].map((index) => ({
    id: makeId(index),
    label: `Term ${index + 1}`,
    start: addDays(start, index * 91),
    end: addDays(start, (index + 1) * 91 - 1),
  }));
}

/** Two terms of six months each, back to back from `start`. */
export function halfYearTerms(start: string, makeId: (index: number) => string): TermDraft[] {
  return [0, 1].map((index) => ({
    id: makeId(index),
    label: `Term ${index + 1}`,
    start: addMonths(start, index * 6),
    end: addDays(addMonths(start, (index + 1) * 6), -1),
  }));
}

/** The day after the last term ends, for adding one more term after it. */
export function nextTermStart(terms: readonly Pick<TermDraft, "end">[], fallback: string): string {
  const ends = terms
    .map((term) => term.end)
    .filter(isIsoDate)
    .sort();
  return ends.length ? addDays(ends[ends.length - 1]!, 1) : fallback;
}

// ---------------------------------------------------------------- capacity

export type CapacityCheck = { readonly tone: "ok" | "short"; readonly text: string };

/** Does every person have a place each term? */
export function capacityCheck(people: number, places: number): CapacityCheck {
  if (people === 0) return { tone: "short", text: "No one is in the round yet. Add people in Who and when." };
  const need = `${plural(people, "doctor")} ${people === 1 ? "needs" : "need"} ${plural(people, "place")} a term.`;
  if (places >= people) return { tone: "ok", text: `${need} You have ${places}.` };
  return {
    tone: "short",
    text: `${need} You have ${places}. Add ${people - places} more or some terms stay empty.`,
  };
}

// ---------------------------------------------------------------- rounds list

export type RoundGroupId = "open" | "review" | "drafts" | "published";

const GROUP_LABEL: Record<RoundGroupId, string> = {
  open: "Open",
  review: "To review",
  drafts: "Drafts",
  published: "Published",
};

export function roundGroupOf(managed: ManagedRound): RoundGroupId {
  switch (managed.round.status) {
    case "draft":
      return "drafts";
    case "open":
      return "open";
    case "closed":
      return "review";
    default:
      return "published";
  }
}

/** Rounds in the order an administrator acts on them: open, to review, drafts, published. Empty groups are left out. */
export function groupRounds(
  rounds: readonly ManagedRound[],
): { id: RoundGroupId; label: string; rounds: ManagedRound[] }[] {
  const order: RoundGroupId[] = ["open", "review", "drafts", "published"];
  return order
    .map((id) => ({ id, label: GROUP_LABEL[id], rounds: rounds.filter((round) => roundGroupOf(round) === id) }))
    .filter((group) => group.rounds.length > 0);
}

export type TagTone = "mode" | "green" | "amber" | "red" | "neutral";

export function roundStatusTag(managed: Pick<ManagedRound, "allocation"> & { round: Pick<RotationRound, "status"> }): {
  label: string;
  tone: TagTone;
} {
  const status: RoundStatus = managed.round.status;
  if (status === "draft") return { label: "Draft", tone: "neutral" };
  if (status === "open") return { label: "Open", tone: "amber" };
  if (status === "closed")
    return managed.allocation ? { label: "Review", tone: "mode" } : { label: "Closed", tone: "amber" };
  return { label: "Published", tone: "green" };
}

/** The line under a round's name: "8 of 12 sent · closes Fri 30 Oct". */
export function roundLine(managed: ManagedRound, now: Date): string {
  const { round } = managed;
  const counts = preferenceCounts(managed);
  switch (round.status) {
    case "draft":
      return `Draft · ${plural(round.terms.length, "term")} · ${plural(round.rotations.length, "rotation")} · ${plural(round.people.length, "person", "people")}`;
    case "open":
      return Date.parse(round.closesAt) > now.getTime()
        ? `${counts.sent} of ${counts.total} sent · closes ${formatClosingDay(round.closesAt, ROUND_ZONE)}`
        : `${counts.sent} of ${counts.total} sent · closing time passed`;
    case "closed":
      return managed.allocation
        ? `Allocated ${formatClosingDay(managed.allocation.runAt, ROUND_ZONE)} · not published yet`
        : `${counts.sent} of ${counts.total} sent · ready to allocate`;
    default:
      return [
        round.publishedAt ? `Published ${formatDayWithYear(round.publishedAt, ROUND_ZONE)}` : "Published",
        plural(round.people.length, "person", "people"),
      ].join(" · ");
  }
}

// ---------------------------------------------------------------- collecting

export type StillToSend = { id: string; name: string; state: "draft" | "none" };

/** Who has not sent yet: drafts first (they have started), then those who have not, each by name. */
export function stillToSend(managed: ManagedRound): StillToSend[] {
  const byPerson = new Map(managed.preferences.map((pref) => [pref.personId, pref]));
  return managed.round.people
    .flatMap((person): StillToSend[] => {
      const pref = byPerson.get(person.id);
      if (pref?.submittedAt) return [];
      return [{ id: person.id, name: person.name, state: pref && pref.ranking.length > 0 ? "draft" : "none" }];
    })
    .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === "draft" ? -1 : 1));
}

// ---------------------------------------------------------------- review

/** "AL" for "Dr Amira Lowe". */
export function initials(name: string): string {
  const words = name
    .replace(/^(dr|prof|professor|mr|mrs|ms|mx|a\/prof)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]![0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** The person's sent ranking, or null when they sent none (a draft is not a choice). */
export function sentRanking(managed: ManagedRound, personId: string): readonly string[] | null {
  const pref = managed.preferences.find((item) => item.personId === personId);
  return pref?.submittedAt ? pref.ranking : null;
}

/** The tag at the end of a placement for the administrator: "1st" green, "3rd" in the area colour, "Not ranked" grey. */
export function adminRankTag(rank: number | null): { label: string; tone: TagTone } {
  if (rank === null) return { label: "Not ranked", tone: "neutral" };
  return { label: ordinal(rank), tone: rank <= 2 ? "green" : "mode" };
}

/** "1st choice" or "Not ranked", with "fixed" when locked. */
export function placementWords(placement: Pick<Placement, "rank" | "locked">): string {
  const rank = placement.rank === null ? "Not ranked" : `${ordinal(placement.rank)} choice`;
  return placement.locked ? `${rank} · fixed` : rank;
}

type Person = RotationRound["people"][number];

export type RotationGroup = {
  readonly rotation: RotationOption;
  readonly people: readonly { person: Person; placement: Placement }[];
};

export type TermView = {
  readonly groups: readonly RotationGroup[];
  readonly unfilled: readonly { person: Person; reason: string }[];
};

/** One term of an allocation, grouped by rotation in the round's order, people by name. */
export function groupByRotation(managed: ManagedRound, termId: string): TermView {
  const { round, allocation } = managed;
  const people = new Map(round.people.map((person) => [person.id, person]));
  const placements = (allocation?.placements ?? []).filter((placement) => placement.termId === termId);
  const groups = round.rotations.map((rotation) => ({
    rotation,
    people: placements
      .filter((placement) => placement.rotationId === rotation.id)
      .flatMap((placement) => {
        const person = people.get(placement.personId);
        return person ? [{ person, placement }] : [];
      })
      .sort((a, b) => a.person.name.localeCompare(b.person.name)),
  }));
  const unfilled = (allocation?.unfilled ?? [])
    .filter((item) => item.termId === termId)
    .flatMap((item) => {
      const person = people.get(item.personId);
      return person ? [{ person, reason: item.reason }] : [];
    })
    .sort((a, b) => a.person.name.localeCompare(b.person.name));
  return { groups, unfilled };
}

export type PersonYear = {
  readonly person: Person;
  readonly terms: readonly { term: RotationTerm; placement: Placement | null; rotation: RotationOption | null }[];
  readonly firstChoices: number;
  readonly empty: number;
};

/** Each doctor's year across the terms, by name. */
export function peopleYears(managed: ManagedRound): PersonYear[] {
  const { round, allocation } = managed;
  const placements = allocation?.placements ?? [];
  return [...round.people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => {
      const terms = round.terms.map((term) => {
        const placement = placements.find((p) => p.personId === person.id && p.termId === term.id) ?? null;
        const rotation = placement ? (round.rotations.find((r) => r.id === placement.rotationId) ?? null) : null;
        return { term, placement, rotation };
      });
      return {
        person,
        terms,
        firstChoices: terms.filter((entry) => entry.placement?.rank === 1).length,
        empty: terms.filter((entry) => entry.placement === null).length,
      };
    });
}

export type MeterSegment = {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly fraction: number;
};

/** The stacked meter under the result: 1st, 2nd, 3rd, then everything lower or unranked. */
export function rankMeter(summary: {
  byRank: readonly number[];
  unranked: number;
  placements: number;
}): MeterSegment[] {
  const total = summary.placements;
  const first = summary.byRank[0] ?? 0;
  const second = summary.byRank[1] ?? 0;
  const third = summary.byRank[2] ?? 0;
  const lower = summary.byRank.slice(3).reduce((sum, n) => sum + n, 0) + summary.unranked;
  const segment = (key: string, label: string, count: number) => ({
    key,
    label,
    count,
    fraction: total > 0 ? count / total : 0,
  });
  return [
    segment("1", "1st", first),
    segment("2", "2nd", second),
    segment("3", "3rd", third),
    segment("lower", "Lower or not ranked", lower),
  ];
}

/** The hero's headline for an allocation. */
export function resultHeadline(summary: { people: number; peopleWithFirstChoice: number; placements: number }): string {
  if (summary.placements === 0) return "No one is placed yet";
  if (summary.people > 0 && summary.peopleWithFirstChoice === summary.people) {
    return "Every doctor got a 1st choice";
  }
  return `${summary.peopleWithFirstChoice} of ${summary.people} got a 1st choice`;
}

/** "48 places · 30 1st, 10 2nd, 5 3rd, 3 lower". */
export function resultLine(summary: { byRank: readonly number[]; unranked: number; placements: number }): string {
  const parts = rankMeter(summary)
    .filter((segment) => segment.count > 0)
    .map((segment) => `${segment.count} ${segment.key === "lower" ? "lower" : segment.label}`);
  return [plural(summary.placements, "place"), parts.join(", ")].filter(Boolean).join(" · ");
}

export type MoveOption = {
  readonly rotation: RotationOption;
  readonly taken: number;
  readonly free: number;
  readonly current: boolean;
  /** Their rank for it, from their sent ranking. */
  readonly rank: number | null;
  /** Why it cannot be chosen, or null. */
  readonly blocked: string | null;
};

/** Where one person could go in one term: their ranked rotations first, then the rest by name. */
export function moveOptions(managed: ManagedRound, personId: string, termId: string): MoveOption[] {
  const { round, allocation } = managed;
  const placements = allocation?.placements ?? [];
  const ranking = sentRanking(managed, personId) ?? [];
  const mine = placements.find((p) => p.personId === personId && p.termId === termId) ?? null;
  const termLabel = new Map(round.terms.map((term) => [term.id, term.label]));
  return round.rotations
    .map((rotation) => {
      const taken = placements.filter(
        (p) => p.termId === termId && p.rotationId === rotation.id && p.personId !== personId,
      ).length;
      const current = mine?.rotationId === rotation.id;
      const elsewhere = placements.find(
        (p) => p.personId === personId && p.rotationId === rotation.id && p.termId !== termId,
      );
      const position = ranking.indexOf(rotation.id);
      const blocked = current
        ? null
        : taken >= rotation.places
          ? rotation.places === 0
            ? "No places this term"
            : "Full this term"
          : elsewhere
            ? `They have it in ${termLabel.get(elsewhere.termId) ?? "another term"}`
            : null;
      return {
        rotation,
        taken,
        free: Math.max(0, rotation.places - taken),
        current,
        rank: position >= 0 ? position + 1 : null,
        blocked,
      };
    })
    .sort((a, b) => {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.rotation.name.localeCompare(b.rotation.name);
    });
}

/** "1 place free" or "Full", for a move option. */
export function freeWords(option: Pick<MoveOption, "free" | "current">): string {
  if (option.current) return "Where they are now";
  return option.free === 0 ? "Full" : `${plural(option.free, "place")} free`;
}

/** Ids that cannot be removed from a published round because someone is placed there. */
export function placedIds(managed: ManagedRound): { terms: Set<string>; rotations: Set<string>; people: Set<string> } {
  const placements = managed.round.status === "published" ? (managed.allocation?.placements ?? []) : [];
  return {
    terms: new Set(placements.map((p) => p.termId)),
    rotations: new Set(placements.map((p) => p.rotationId)),
    people: new Set(placements.map((p) => p.personId)),
  };
}

// ---------------------------------------------------------------- the form

export const FORM_STEPS = [
  { value: "terms", label: "Terms" },
  { value: "rotations", label: "Rotations" },
  { value: "who", label: "Who and when" },
] as const;
export type FormStep = (typeof FORM_STEPS)[number]["value"];

export type RotationDraft = { id: string; name: string; site: string; places: number };
export type PersonDraft = { id: string; name: string; grade?: string };

export type RoundDraft = {
  name: string;
  closesDate: string;
  closesTime: string;
  minRanked: number;
  terms: TermDraft[];
  rotations: RotationDraft[];
  people: PersonDraft[];
  note: string;
};

export function draftFromRound(round: RotationRound): RoundDraft {
  return {
    name: round.name,
    closesDate: zonedDateOf(round.closesAt, ROUND_ZONE),
    closesTime: zonedTimeOf(round.closesAt, ROUND_ZONE),
    minRanked: round.minRanked,
    terms: round.terms.map((term) => ({ ...term })),
    rotations: round.rotations.map((rotation) => ({ ...rotation })),
    people: round.people.map((person) => ({ ...person })),
    note: round.note ?? "",
  };
}

/**
 * A new round for next year: four 13-week terms from 1 February, closing in
 * two weeks at 5 pm Perth time, with the given people and rotations to start from.
 */
export function newRoundDraft(options: {
  now: Date;
  people: readonly PersonDraft[];
  rotations: readonly RotationDraft[];
  makeId: (kind: "term" | "rotation", index: number) => string;
}): RoundDraft {
  const today = zonedDateOf(options.now, ROUND_ZONE);
  const year = Number(today.slice(0, 4)) + 1;
  return {
    name: `${year} rotations`,
    closesDate: addDays(today, 14),
    closesTime: "17:00",
    minRanked: Math.min(4, Math.max(options.rotations.length, 1)),
    terms: quarterTerms(`${year}-02-01`, (index) => options.makeId("term", index)),
    rotations: options.rotations.map((rotation) => ({ ...rotation })),
    people: options.people.map((person) => ({ ...person })),
    note: "",
  };
}

/** Places per term in a draft. */
export function draftPlaces(draft: Pick<RoundDraft, "rotations">): number {
  return placesPerTerm(draft);
}

export type DraftCheck = { ok: true; setup: RoundSetup } | { ok: false; message: string; step: FormStep };

const STEP_FOR_CODE: Record<string, FormStep> = {
  duplicate_term: "terms",
  terms_overlap: "terms",
  duplicate_rotation: "rotations",
  duplicate_person: "who",
};

/**
 * The draft as a setup the round rules accept, or the first thing to fix and
 * the step it is on. Uses the same schema and rules the store applies.
 */
export function checkDraft(draft: RoundDraft): DraftCheck {
  const fail = (message: string, step: FormStep): DraftCheck => ({ ok: false, message, step });
  if (draft.terms.length === 0) return fail("Add at least one term.", "terms");
  for (const term of draft.terms) {
    if (!term.label.trim()) return fail("Give every term a name.", "terms");
    if (!isIsoDate(term.start) || !isIsoDate(term.end))
      return fail(`${term.label} needs a start and an end date.`, "terms");
    if (term.end < term.start) return fail(`${term.label} ends before it starts.`, "terms");
  }
  if (draft.rotations.length === 0) return fail("Add at least one rotation.", "rotations");
  if (draft.rotations.some((rotation) => !rotation.name.trim()))
    return fail("Give every rotation a name.", "rotations");
  if (!draft.name.trim()) return fail("Give the round a name.", "who");
  if (draft.people.length === 0) return fail("Add at least one person to the round.", "who");
  const closesAt = isIsoDate(draft.closesDate) ? zonedWallToIso(draft.closesDate, draft.closesTime, ROUND_ZONE) : null;
  if (!closesAt) return fail("Set a closing date and time.", "who");
  const note = draft.note.trim();
  const candidate = {
    name: draft.name.trim(),
    closesAt,
    minRanked: draft.minRanked,
    terms: draft.terms.map((term) => ({ ...term, label: term.label.trim() })),
    rotations: draft.rotations.map((rotation) => ({
      ...rotation,
      name: rotation.name.trim(),
      site: rotation.site.trim(),
    })),
    people: draft.people,
    ...(note ? { note } : {}),
  };
  const parsed = roundSetupSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? "");
    const step: FormStep = field === "terms" ? "terms" : field === "rotations" ? "rotations" : "who";
    const words: Record<string, string> = {
      name: "The round name is too long.",
      note: "The note is too long. Keep it under 400 characters.",
      minRanked: "Choose how many rotations each doctor must rank.",
      terms: "Check the terms. Up to 12, each with a short name.",
      rotations: "Check the rotations. Each needs a short name and up to 50 places.",
      people: "Check the people in the round.",
    };
    return fail(words[field] ?? "Check the round's details.", step);
  }
  try {
    assertSetupConsistent(parsed.data);
  } catch (error) {
    if (error instanceof RotationRuleError) return fail(error.message, STEP_FOR_CODE[error.code] ?? "terms");
    throw error;
  }
  try {
    assertSetupHasNoPatientDetail(parsed.data);
  } catch (error) {
    if (error instanceof RotationRuleError) return fail(error.message, patientDetailStep(parsed.data));
    throw error;
  }
  return { ok: true, setup: parsed.data };
}

function patientDetailStep(setup: RoundSetup): FormStep {
  // Point at the step whose words tripped the check: blank out the others and try again.
  const tripped = (partial: Partial<RoundSetup>) => {
    try {
      assertSetupHasNoPatientDetail({
        ...setup,
        name: "Round",
        note: undefined,
        terms: setup.terms.map((term) => ({ ...term, label: "Term" })),
        rotations: setup.rotations.map((rotation) => ({ ...rotation, name: "Rotation", site: "" })),
        ...partial,
      });
      return false;
    } catch {
      return true;
    }
  };
  if (tripped({ terms: setup.terms })) return "terms";
  if (tripped({ rotations: setup.rotations })) return "rotations";
  return "who";
}

/** True when the closing time has passed, so the round cannot open yet. */
export function closesInPast(draft: Pick<RoundDraft, "closesDate" | "closesTime">, now: Date): boolean {
  const iso = isIsoDate(draft.closesDate) ? zonedWallToIso(draft.closesDate, draft.closesTime, ROUND_ZONE) : null;
  return iso !== null && Date.parse(iso) <= now.getTime();
}
