import {
  allocateRotations,
  cleanRanking,
  ordinal,
  type AllocationSummary,
  type Placement,
  type RotationLock,
} from "@/lib/roster/rotations/allocate";
import {
  roundAcceptsPreferences,
  rotationById,
  type ManagedRound,
  type MyRound,
  type PlacementMove,
  type RotationAllocation,
  type RotationPreferenceRecord,
  type RotationRound,
  type RoundSetup,
} from "@/lib/roster/rotations/model";
import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";

/**
 * The rules of a round, as pure functions over `ManagedRound`. The device
 * store (example data) and the server repository both call these, so a round
 * behaves the same whichever one holds it.
 */

export class RotationRuleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "RotationRuleError";
  }
}

function fail(message: string, code: string): never {
  throw new RotationRuleError(message, code);
}

/** Every free-text field in a setup. None may look like a patient detail. */
export function assertSetupHasNoPatientDetail(setup: RoundSetup): void {
  const texts = [
    setup.name,
    setup.note ?? "",
    ...setup.terms.map((term) => term.label),
    ...setup.rotations.flatMap((rotation) => [rotation.name, rotation.site]),
  ];
  if (texts.some((text) => text && looksLikePatientDetail(text))) {
    fail("That looks like a patient detail. Rounds hold rotation names and dates only.", "patient_detail");
  }
}

export function assertSetupConsistent(setup: RoundSetup): void {
  const termIds = new Set(setup.terms.map((term) => term.id));
  const rotationIds = new Set(setup.rotations.map((rotation) => rotation.id));
  const personIds = new Set(setup.people.map((person) => person.id));
  if (termIds.size !== setup.terms.length) fail("Two terms share an id.", "duplicate_term");
  if (rotationIds.size !== setup.rotations.length) fail("Two rotations share an id.", "duplicate_rotation");
  if (personIds.size !== setup.people.length) fail("Someone is in the round twice.", "duplicate_person");
  const sorted = [...setup.terms].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start <= sorted[i - 1].end)
      fail(`${sorted[i].label} overlaps ${sorted[i - 1].label}.`, "terms_overlap");
  }
}

export function createManagedRound(
  setup: RoundSetup,
  meta: { id: string; serviceId: string; teamName: string; adminName: string; now: Date },
): ManagedRound {
  assertSetupConsistent(setup);
  assertSetupHasNoPatientDetail(setup);
  return {
    round: {
      ...setup,
      terms: [...setup.terms].sort((a, b) => a.start.localeCompare(b.start)),
      id: meta.id,
      serviceId: meta.serviceId,
      teamName: meta.teamName,
      adminName: meta.adminName,
      status: "draft",
      createdAt: meta.now.toISOString(),
      openedAt: null,
      publishedAt: null,
      version: 1,
    },
    preferences: [],
    locks: [],
    allocation: null,
  };
}

/**
 * Edit the setup. Before publishing anything may change. After publishing, the
 * term dates, names and places can change (calendars follow through `version`);
 * removing a term or rotation that has placements is refused.
 */
export function editRoundSetup(managed: ManagedRound, setup: RoundSetup): ManagedRound {
  assertSetupConsistent(setup);
  assertSetupHasNoPatientDetail(setup);
  const { round } = managed;
  const termIds = new Set(setup.terms.map((term) => term.id));
  const rotationIds = new Set(setup.rotations.map((rotation) => rotation.id));
  const personIds = new Set(setup.people.map((person) => person.id));
  const placements = managed.allocation?.placements ?? [];
  if (round.status === "published") {
    const orphan = placements.find(
      (p) => !termIds.has(p.termId) || !rotationIds.has(p.rotationId) || !personIds.has(p.personId),
    );
    if (orphan) {
      fail("Someone is placed in a term or rotation you removed. Move them first.", "placement_orphaned");
    }
  }
  const keep = <T extends { personId: string }>(list: readonly T[]) =>
    list.filter((item) => personIds.has(item.personId));
  return {
    ...managed,
    round: {
      ...round,
      ...setup,
      terms: [...setup.terms].sort((a, b) => a.start.localeCompare(b.start)),
      version: round.version + 1,
    },
    preferences: keep(managed.preferences).map((pref) => ({
      ...pref,
      ranking: cleanRanking(pref.ranking, rotationIds),
    })),
    locks: keep(managed.locks).filter((lock) => termIds.has(lock.termId) && rotationIds.has(lock.rotationId)),
    allocation:
      managed.allocation && round.status !== "published"
        ? null // the setup changed, so the old run no longer fits. Run it again.
        : managed.allocation,
  };
}

export function openRound(managed: ManagedRound, now: Date): ManagedRound {
  if (managed.round.status !== "draft" && managed.round.status !== "closed") {
    fail("This round is already open or published.", "not_draft");
  }
  if (Date.parse(managed.round.closesAt) <= now.getTime()) {
    fail("Set a closing time in the future first.", "closes_in_past");
  }
  return {
    ...managed,
    round: { ...managed.round, status: "open", openedAt: managed.round.openedAt ?? now.toISOString() },
  };
}

export function closeRound(managed: ManagedRound): ManagedRound {
  if (managed.round.status !== "open") fail("Only an open round can be closed.", "not_open");
  return { ...managed, round: { ...managed.round, status: "closed" } };
}

export function savePreference(
  managed: ManagedRound,
  personId: string,
  ranking: readonly string[],
  submit: boolean,
  now: Date,
): ManagedRound {
  const { round } = managed;
  if (!round.people.some((person) => person.id === personId)) fail("You are not in this round.", "not_in_round");
  if (!roundAcceptsPreferences(round, now)) fail("This round is closed to changes.", "round_closed");
  const clean = cleanRanking(ranking, new Set(round.rotations.map((rotation) => rotation.id)));
  const needed = Math.min(round.minRanked, round.rotations.length);
  if (submit && clean.length < Math.max(1, needed)) {
    fail(`Rank at least ${Math.max(1, needed)} rotations before sending.`, "too_few_ranked");
  }
  const existing = managed.preferences.find((pref) => pref.personId === personId);
  const record: RotationPreferenceRecord = {
    personId,
    ranking: clean,
    submittedAt: submit ? now.toISOString() : (existing?.submittedAt ?? null),
    updatedAt: now.toISOString(),
  };
  return {
    ...managed,
    preferences: [...managed.preferences.filter((pref) => pref.personId !== personId), record],
  };
}

/** Pull a sent preference back to a draft (the doctor changed their mind). */
export function withdrawPreference(managed: ManagedRound, personId: string, now: Date): ManagedRound {
  if (!roundAcceptsPreferences(managed.round, now)) fail("This round is closed to changes.", "round_closed");
  return {
    ...managed,
    preferences: managed.preferences.map((pref) =>
      pref.personId === personId ? { ...pref, submittedAt: null, updatedAt: now.toISOString() } : pref,
    ),
  };
}

export function runAllocation(managed: ManagedRound, now: Date): ManagedRound {
  const { round } = managed;
  if (round.status === "draft") fail("Open the round before allocating.", "still_draft");
  if (round.status === "published") fail("This round is published. Move people by hand instead.", "published");
  const result = allocateRotations({
    seed: round.id,
    terms: round.terms,
    rotations: round.rotations,
    people: round.people.map((person) => person.id),
    // Only sent preferences count. A draft is not a choice the doctor made.
    preferences: managed.preferences
      .filter((pref) => pref.submittedAt !== null)
      .map((pref) => ({ personId: pref.personId, ranking: pref.ranking })),
    locks: managed.locks,
  });
  return {
    ...managed,
    // Running the allocation closes the round to further changes.
    round: { ...round, status: "closed" },
    allocation: { runAt: now.toISOString(), ...result },
  };
}

function summarise(placements: readonly Placement[], unfilledCount: number, people: number): AllocationSummary {
  const byRank: number[] = [];
  let unranked = 0;
  for (const placement of placements) {
    if (placement.rank === null) unranked += 1;
    else byRank[placement.rank - 1] = (byRank[placement.rank - 1] ?? 0) + 1;
  }
  for (let i = 0; i < byRank.length; i += 1) byRank[i] = byRank[i] ?? 0;
  return {
    people,
    placements: placements.length,
    byRank: byRank.length ? byRank : [0],
    unranked,
    unfilled: unfilledCount,
    peopleWithFirstChoice: new Set(placements.filter((p) => p.rank === 1).map((p) => p.personId)).size,
  };
}

/**
 * Move one person in one term by hand. Checks the target has a free place that
 * term and that the person does not already have that rotation in another term.
 */
export function movePlacement(managed: ManagedRound, move: PlacementMove, now: Date): ManagedRound {
  const { round } = managed;
  const allocation = managed.allocation;
  if (!allocation) fail("Run the allocation first.", "no_allocation");
  if (!round.people.some((person) => person.id === move.personId))
    fail("That person is not in this round.", "not_in_round");
  if (!round.terms.some((term) => term.id === move.termId)) fail("That term is not in this round.", "unknown_term");
  const others = allocation.placements.filter((p) => !(p.personId === move.personId && p.termId === move.termId));
  let placements = others;
  let locks: readonly RotationLock[] = managed.locks.filter(
    (lock) => !(lock.personId === move.personId && lock.termId === move.termId),
  );
  if (move.rotationId !== null) {
    const rotation = rotationById(round, move.rotationId);
    if (!rotation) fail("That rotation is not in this round.", "unknown_rotation");
    const taken = others.filter((p) => p.rotationId === move.rotationId && p.termId === move.termId).length;
    if (taken >= rotation.places) fail(`${rotation.name} is full that term. Move someone out first.`, "rotation_full");
    if (others.some((p) => p.personId === move.personId && p.rotationId === move.rotationId)) {
      fail(`They already have ${rotation.name} in another term.`, "rotation_repeated");
    }
    const ranking = managed.preferences.find((pref) => pref.personId === move.personId && pref.submittedAt)?.ranking;
    const position = ranking ? ranking.indexOf(move.rotationId) : -1;
    const rank = position >= 0 ? position + 1 : null;
    const placement: Placement = {
      personId: move.personId,
      termId: move.termId,
      rotationId: move.rotationId,
      rank,
      locked: move.lock,
      reason:
        rank === null
          ? "Set by the rotation administrator"
          : `Your ${ordinal(rank)} choice, set by the rotation administrator`,
    };
    placements = [...others, placement];
    if (move.lock) locks = [...locks, { personId: move.personId, termId: move.termId, rotationId: move.rotationId }];
  }
  const termOrder = new Map(round.terms.map((term, index) => [term.id, index]));
  placements = [...placements].sort((a, b) =>
    a.personId === b.personId
      ? (termOrder.get(a.termId) ?? 0) - (termOrder.get(b.termId) ?? 0)
      : a.personId < b.personId
        ? -1
        : 1,
  );
  const filled = new Set(placements.map((p) => `${p.personId}:${p.termId}`));
  const unfilled = round.people.flatMap((person) =>
    round.terms
      .filter((term) => !filled.has(`${person.id}:${term.id}`))
      .map((term) => ({ personId: person.id, termId: term.id, reason: "No rotation set for this term" })),
  );
  const next: RotationAllocation = {
    ...allocation,
    placements,
    unfilled,
    summary: summarise(placements, unfilled.length, round.people.length),
  };
  return {
    ...managed,
    locks,
    allocation: next,
    round:
      round.status === "published" ? { ...round, version: round.version + 1, publishedAt: now.toISOString() } : round,
  };
}

/** Fix or unfix a placement as it stands, without moving it. */
export function setPlacementLock(managed: ManagedRound, personId: string, termId: string, lock: boolean): ManagedRound {
  const placement = managed.allocation?.placements.find((p) => p.personId === personId && p.termId === termId);
  if (!managed.allocation || !placement) fail("There is no placement there to fix.", "no_placement");
  const locks = managed.locks.filter((l) => !(l.personId === personId && l.termId === termId));
  return {
    ...managed,
    locks: lock ? [...locks, { personId, termId, rotationId: placement.rotationId }] : locks,
    allocation: {
      ...managed.allocation,
      placements: managed.allocation.placements.map((p) =>
        p.personId === personId && p.termId === termId ? { ...p, locked: lock } : p,
      ),
    },
  };
}

export function publishRound(managed: ManagedRound, now: Date): ManagedRound {
  if (!managed.allocation) fail("Run the allocation before publishing.", "no_allocation");
  if (managed.round.status === "published") fail("This round is already published.", "published");
  return {
    ...managed,
    round: {
      ...managed.round,
      status: "published",
      publishedAt: now.toISOString(),
      version: managed.round.version + 1,
    },
  };
}

/** One doctor's view. Placements only once published, and only their own. */
export function myRoundView(managed: ManagedRound, personId: string): MyRound {
  const pref = managed.preferences.find((p) => p.personId === personId);
  return {
    round: managed.round,
    personId,
    ranking: pref?.ranking ?? [],
    submittedAt: pref?.submittedAt ?? null,
    placements:
      managed.round.status === "published"
        ? (managed.allocation?.placements ?? []).filter((p) => p.personId === personId)
        : [],
  };
}

export function preferenceCounts(managed: ManagedRound): { sent: number; drafts: number; none: number; total: number } {
  const total = managed.round.people.length;
  const sent = managed.preferences.filter((pref) => pref.submittedAt !== null).length;
  const drafts = managed.preferences.filter((pref) => pref.submittedAt === null && pref.ranking.length > 0).length;
  return { sent, drafts, none: Math.max(0, total - sent - drafts), total };
}

export type RoundSummaryLine = Pick<RotationRound, "id" | "name" | "status" | "closesAt" | "publishedAt">;
