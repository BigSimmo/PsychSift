/**
 * Rotation allocation: gives as many people as possible their highest
 * preference, then schedules each person's rotations into the terms of the year.
 *
 * Deterministic and explainable. There is no AI call here: the same round and
 * the same preferences always give the same allocation, and every placement
 * carries a short reason a doctor can read.
 *
 * Stage 1 chooses WHICH rotations each person gets. It is a min-cost max-flow:
 * fill every free term first, then maximise the number of first choices, then
 * second choices, and so on (a rank-maximal allocation). Ties are broken by a
 * fixed draw seeded from the round id, so nobody is favoured by list order.
 *
 * Stage 2 places those rotations into terms. Each rotation is split into one
 * copy per place, and the person-to-copy graph is edge coloured with one colour
 * per term (bipartite graphs with maximum degree T always need only T colours),
 * so the stage-1 choice always fits unless an admin lock blocks it.
 */

export type RotationTerm = {
  readonly id: string;
  readonly label: string;
  /** Perth calendar dates, YYYY-MM-DD, inclusive. */
  readonly start: string;
  readonly end: string;
};

export type RotationOption = {
  readonly id: string;
  readonly name: string;
  readonly site: string;
  /** Places in each term. */
  readonly places: number;
};

export type RotationPreference = {
  readonly personId: string;
  /** Rotation ids, best first. Unknown ids and repeats are ignored. */
  readonly ranking: readonly string[];
};

/** A placement the admin fixed by hand. The allocator keeps it exactly. */
export type RotationLock = {
  readonly personId: string;
  readonly termId: string;
  readonly rotationId: string;
};

export type AllocationInput = {
  /** Seeds the tie-break draw, normally the round id. */
  readonly seed: string;
  readonly terms: readonly RotationTerm[];
  readonly rotations: readonly RotationOption[];
  /** Everyone in the round, whether or not they sent preferences. */
  readonly people: readonly string[];
  readonly preferences: readonly RotationPreference[];
  readonly locks?: readonly RotationLock[];
};

export type Placement = {
  readonly personId: string;
  readonly termId: string;
  readonly rotationId: string;
  /** 1 for a first choice. Null when the person did not rank it. */
  readonly rank: number | null;
  readonly locked: boolean;
  /** Plain words for the doctor, e.g. "Your 1st choice". */
  readonly reason: string;
};

export type UnfilledTerm = {
  readonly personId: string;
  readonly termId: string;
  readonly reason: string;
};

export type AllocationSummary = {
  readonly people: number;
  readonly placements: number;
  /** byRank[0] is the number of first choices given, byRank[1] second, and so on. */
  readonly byRank: readonly number[];
  readonly unranked: number;
  readonly unfilled: number;
  /** People who got their first choice in at least one term. */
  readonly peopleWithFirstChoice: number;
};

export type AllocationResult = {
  readonly placements: readonly Placement[];
  readonly unfilled: readonly UnfilledTerm[];
  readonly summary: AllocationSummary;
  readonly problems: readonly string[];
};

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Cleans a ranking: known rotations only, each once, in order. */
export function cleanRanking(ranking: readonly string[], rotationIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ranking) {
    if (!rotationIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// A small FNV-1a hash and xorshift draw, so ties break the same way every run.
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

function seededOrder<T>(items: readonly T[], seed: string, key: (item: T) => string): T[] {
  return [...items]
    .map((item) => ({ item, draw: hashSeed(`${seed}:${key(item)}`) }))
    .sort((a, b) => a.draw - b.draw || (key(a.item) < key(b.item) ? -1 : 1))
    .map((entry) => entry.item);
}

// ---------------------------------------------------------------- min-cost flow

type Edge = { to: number; rev: number; cap: number; cost: bigint };

class CostFlow {
  readonly graph: Edge[][];

  constructor(size: number) {
    this.graph = Array.from({ length: size }, () => []);
  }

  add(from: number, to: number, cap: number, cost: bigint): Edge {
    const forward: Edge = { to, rev: this.graph[to].length, cap, cost };
    const backward: Edge = { to: from, rev: this.graph[from].length, cap: 0, cost: -cost };
    this.graph[from].push(forward);
    this.graph[to].push(backward);
    return forward;
  }

  /**
   * Successive shortest paths with Bellman-Ford (SPFA). Sizes here are a few
   * hundred nodes, so the simple version is quick and easy to trust. Each path
   * is a minimum-cost augmentation, which gives the minimum-cost maximum flow.
   */
  run(source: number, sink: number): void {
    const size = this.graph.length;
    for (;;) {
      const dist: (bigint | null)[] = new Array(size).fill(null);
      const prevNode = new Array<number>(size).fill(-1);
      const prevEdge = new Array<number>(size).fill(-1);
      const inQueue = new Array<boolean>(size).fill(false);
      dist[source] = BigInt(0);
      const queue: number[] = [source];
      inQueue[source] = true;
      while (queue.length > 0) {
        const node = queue.shift() as number;
        inQueue[node] = false;
        const base = dist[node] as bigint;
        this.graph[node].forEach((edge, index) => {
          if (edge.cap <= 0) return;
          const next = base + edge.cost;
          const current = dist[edge.to];
          if (current === null || next < current) {
            dist[edge.to] = next;
            prevNode[edge.to] = node;
            prevEdge[edge.to] = index;
            if (!inQueue[edge.to]) {
              inQueue[edge.to] = true;
              queue.push(edge.to);
            }
          }
        });
      }
      if (dist[sink] === null) return;
      let push = Number.POSITIVE_INFINITY;
      for (let v = sink; v !== source; v = prevNode[v]) {
        push = Math.min(push, this.graph[prevNode[v]][prevEdge[v]].cap);
      }
      for (let v = sink; v !== source; v = prevNode[v]) {
        const edge = this.graph[prevNode[v]][prevEdge[v]];
        edge.cap -= push;
        this.graph[v][edge.rev].cap += push;
      }
    }
  }
}

// ---------------------------------------------------------------- allocation

export function allocateRotations(input: AllocationInput): AllocationResult {
  const problems: string[] = [];
  const terms = input.terms;
  const termCount = terms.length;
  const termIndex = new Map(terms.map((term, index) => [term.id, index]));
  const rotations = input.rotations.filter((rotation) => rotation.places > 0);
  const rotationIndex = new Map(rotations.map((rotation, index) => [rotation.id, index]));
  const rotationIds = new Set(rotationIndex.keys());
  const people = seededOrder([...new Set(input.people)], input.seed, (id) => id);

  const rankings = new Map<string, string[]>();
  for (const preference of input.preferences) {
    rankings.set(preference.personId, cleanRanking(preference.ranking, rotationIds));
  }
  const rankOf = (personId: string, rotationId: string): number | null => {
    const position = rankings.get(personId)?.indexOf(rotationId) ?? -1;
    return position >= 0 ? position + 1 : null;
  };

  // Locks first: they are kept exactly, so they come off every capacity below.
  const usedTerm = new Map<string, Set<number>>(); // person -> term indexes taken
  const lockedRotation = new Map<string, Set<string>>(); // person -> rotations taken
  const lockedLoad = new Map<string, number[]>(); // rotation -> per-term count
  const locks: RotationLock[] = [];
  for (const lock of input.locks ?? []) {
    const t = termIndex.get(lock.termId);
    const r = rotationIndex.get(lock.rotationId);
    if (t === undefined || r === undefined || !people.includes(lock.personId)) {
      problems.push("A fixed placement points at a term, rotation or person no longer in this round, so it was dropped.");
      continue;
    }
    const taken = usedTerm.get(lock.personId) ?? new Set<number>();
    const load = lockedLoad.get(lock.rotationId) ?? new Array<number>(termCount).fill(0);
    if (taken.has(t) || load[t] >= rotations[r].places) {
      problems.push("Two fixed placements clash (same person and term, or more than the places), so one was dropped.");
      continue;
    }
    taken.add(t);
    usedTerm.set(lock.personId, taken);
    load[t] += 1;
    lockedLoad.set(lock.rotationId, load);
    const mine = lockedRotation.get(lock.personId) ?? new Set<string>();
    mine.add(lock.rotationId);
    lockedRotation.set(lock.personId, mine);
    locks.push(lock);
  }

  // Stage 1: which rotations each person gets.
  // Benefit of rank r out of R is base^(R - r + 1); unranked gets 1 so a filled
  // term always beats an empty one. Base exceeds every possible count, so one
  // more first choice outweighs any number of second choices (rank-maximal).
  const maxRank = Math.max(1, ...[...rankings.values()].map((ranking) => ranking.length));
  const base = BigInt(people.length * Math.max(1, termCount) + 2);
  const benefit = (rank: number | null): bigint => (rank === null ? BigInt(1) : base ** BigInt(maxRank - rank + 1));

  const source = 0;
  const personNode = (i: number) => 1 + i;
  const rotationNode = (j: number) => 1 + people.length + j;
  const sink = 1 + people.length + rotations.length;
  const flow = new CostFlow(sink + 1);
  const choiceEdges: { personId: string; rotationId: string; edge: Edge }[] = [];

  people.forEach((personId, i) => {
    const free = termCount - (usedTerm.get(personId)?.size ?? 0);
    if (free <= 0) return;
    flow.add(source, personNode(i), free, BigInt(0));
    rotations.forEach((rotation, j) => {
      if (lockedRotation.get(personId)?.has(rotation.id)) return;
      const edge = flow.add(personNode(i), rotationNode(j), 1, -benefit(rankOf(personId, rotation.id)));
      choiceEdges.push({ personId, rotationId: rotation.id, edge });
    });
  });
  rotations.forEach((rotation, j) => {
    const lockedCount = (lockedLoad.get(rotation.id) ?? []).reduce((sum, n) => sum + n, 0);
    const capacity = rotation.places * termCount - lockedCount;
    if (capacity > 0) flow.add(rotationNode(j), sink, capacity, BigInt(0));
  });
  flow.run(source, sink);

  const chosen = new Map<string, string[]>(); // person -> rotations to schedule
  for (const { personId, rotationId, edge } of choiceEdges) {
    if (edge.cap === 0) {
      const list = chosen.get(personId) ?? [];
      list.push(rotationId);
      chosen.set(personId, list);
    }
  }

  // Stage 2: put each chosen rotation into a term. Edge colouring of the
  // person-to-place-copy graph, colours being terms.
  type Assignment = { personId: string; rotationId: string; copy: number; term: number; locked: boolean };
  const assignments: Assignment[] = [];
  // personTerm[person][term] = assignment index; copyTerm[rotation][copy][term] = assignment index
  const personTerm = new Map<string, (number | null)[]>();
  const copyTerm = new Map<string, (number | null)[][]>();
  const personSlots = (personId: string) => {
    let slots = personTerm.get(personId);
    if (!slots) {
      slots = new Array<number | null>(termCount).fill(null);
      personTerm.set(personId, slots);
    }
    return slots;
  };
  const copySlots = (rotationId: string, copy: number) => {
    let copies = copyTerm.get(rotationId);
    if (!copies) {
      const places = rotations[rotationIndex.get(rotationId) as number].places;
      copies = Array.from({ length: places }, () => new Array<number | null>(termCount).fill(null));
      copyTerm.set(rotationId, copies);
    }
    return copies[copy];
  };

  for (const lock of locks) {
    const t = termIndex.get(lock.termId) as number;
    const places = rotations[rotationIndex.get(lock.rotationId) as number].places;
    let copy = 0;
    while (copy < places && copySlots(lock.rotationId, copy)[t] !== null) copy += 1;
    const index = assignments.push({ personId: lock.personId, rotationId: lock.rotationId, copy, term: t, locked: true }) - 1;
    personSlots(lock.personId)[t] = index;
    copySlots(lock.rotationId, copy)[t] = index;
  }

  // Spread each rotation's people over its copies so no copy has more than T.
  const copyDegree = new Map<string, number[]>();
  for (const assignment of assignments) {
    const degrees = copyDegree.get(assignment.rotationId) ?? [];
    degrees[assignment.copy] = (degrees[assignment.copy] ?? 0) + 1;
    copyDegree.set(assignment.rotationId, degrees);
  }
  const pending: { personId: string; rotationId: string; copy: number }[] = [];
  for (const personId of people) {
    for (const rotationId of chosen.get(personId) ?? []) {
      const places = rotations[rotationIndex.get(rotationId) as number].places;
      const degrees = copyDegree.get(rotationId) ?? new Array<number>(places).fill(0);
      let copy = 0;
      for (let k = 1; k < places; k += 1) if ((degrees[k] ?? 0) < (degrees[copy] ?? 0)) copy = k;
      degrees[copy] = (degrees[copy] ?? 0) + 1;
      copyDegree.set(rotationId, degrees);
      pending.push({ personId, rotationId, copy });
    }
  }

  const unscheduled: { personId: string; rotationId: string }[] = [];
  for (const item of pending) {
    const mine = personSlots(item.personId);
    const theirs = copySlots(item.rotationId, item.copy);
    const freeAtPerson = [...Array(termCount).keys()].filter((t) => mine[t] === null);
    const freeAtCopy = [...Array(termCount).keys()].filter((t) => theirs[t] === null);
    const shared = freeAtPerson.find((t) => theirs[t] === null);
    const place = (term: number) => {
      const index = assignments.push({ ...item, term, locked: false }) - 1;
      mine[term] = index;
      theirs[term] = index;
    };
    if (shared !== undefined) {
      place(shared);
      continue;
    }
    // Kempe chain: a is free at the person, b is free at the copy. Starting at
    // the copy, swap the a/b path so a becomes free there too. In a bipartite
    // graph that path never reaches the person.
    let placed = false;
    for (const a of freeAtPerson) {
      for (const b of freeAtCopy) {
        if (swapChain(item.rotationId, item.copy, a, b)) {
          place(a);
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) unscheduled.push(item);
  }

  function swapChain(rotationId: string, copy: number, a: number, b: number): boolean {
    // Walk copy -(a)- person -(b)- copy -(a)- ... collecting assignments.
    const path: number[] = [];
    let atCopy = true;
    let rot = rotationId;
    let cp = copy;
    let person = "";
    let colour = a;
    for (let guard = 0; guard < assignments.length + 2; guard += 1) {
      const index = atCopy ? copySlots(rot, cp)[colour] : personSlots(person)[colour];
      if (index === null || index === undefined) break;
      const step = assignments[index];
      if (step.locked) return false;
      path.push(index);
      if (atCopy) person = step.personId;
      else {
        rot = step.rotationId;
        cp = step.copy;
      }
      atCopy = !atCopy;
      colour = colour === a ? b : a;
    }
    // Clear then re-place with the colours swapped.
    for (const index of path) {
      const step = assignments[index];
      personSlots(step.personId)[step.term] = null;
      copySlots(step.rotationId, step.copy)[step.term] = null;
    }
    for (const index of path) {
      const step = assignments[index];
      step.term = step.term === a ? b : a;
      personSlots(step.personId)[step.term] = index;
      copySlots(step.rotationId, step.copy)[step.term] = index;
    }
    return true;
  }

  if (unscheduled.length > 0) {
    problems.push("Fixed placements left no term free for some rotations. Move or unfix one and run it again.");
  }

  // Reasons and summary.
  const takenBy = new Map<string, { personId: string; rank: number | null }[]>();
  for (const assignment of assignments) {
    const list = takenBy.get(assignment.rotationId) ?? [];
    list.push({ personId: assignment.personId, rank: rankOf(assignment.personId, assignment.rotationId) });
    takenBy.set(assignment.rotationId, list);
  }
  const rotationName = (id: string) => rotations[rotationIndex.get(id) as number]?.name ?? "This rotation";
  const missedReason = (personId: string, rank: number | null): string => {
    const ranking = rankings.get(personId) ?? [];
    const better = rank === null ? ranking : ranking.slice(0, rank - 1);
    const missed = better.find((id) => !(chosen.get(personId) ?? []).includes(id) && !lockedRotation.get(personId)?.has(id));
    if (!missed) return "";
    const mine = rankOf(personId, missed) as number;
    const holders = takenBy.get(missed) ?? [];
    const higher = holders.filter((h) => h.rank !== null && h.rank <= mine).length;
    return higher >= holders.length
      ? ` ${rotationName(missed)} was full with people who ranked it as high or higher.`
      : ` ${rotationName(missed)} was full, and giving you a place there would have cost others a higher choice.`;
  };

  const placements: Placement[] = assignments
    .map((assignment) => {
      const rank = rankOf(assignment.personId, assignment.rotationId);
      let reason: string;
      if (assignment.locked) reason = "Set by the rotation administrator";
      else if (!rankings.has(assignment.personId)) reason = "No preferences were sent, so this was a free place";
      else if (rank === 1) reason = "Your 1st choice";
      else if (rank !== null) {
        const missed = missedReason(assignment.personId, rank);
        reason = missed ? `Your ${ordinal(rank)} choice.${missed}` : `Your ${ordinal(rank)} choice`;
      }
      else reason = "Not one you ranked. Every rotation you ranked was full";
      return {
        personId: assignment.personId,
        termId: terms[assignment.term].id,
        rotationId: assignment.rotationId,
        rank,
        locked: assignment.locked,
        reason: reason.trim(),
      };
    })
    .sort((x, y) =>
      x.personId === y.personId
        ? (termIndex.get(x.termId) as number) - (termIndex.get(y.termId) as number)
        : x.personId < y.personId
          ? -1
          : 1,
    );

  const unfilled: UnfilledTerm[] = [];
  for (const personId of people) {
    const slots = personSlots(personId);
    slots.forEach((slot, t) => {
      if (slot === null) {
        unfilled.push({
          personId,
          termId: terms[t].id,
          reason: unscheduled.some((u) => u.personId === personId)
            ? "Fixed placements left no free place this term"
            : "There are fewer places than people this term",
        });
      }
    });
  }

  const byRank = new Array<number>(maxRank).fill(0);
  let unranked = 0;
  for (const placement of placements) {
    if (placement.rank === null) unranked += 1;
    else byRank[placement.rank - 1] += 1;
  }
  while (byRank.length > 1 && byRank[byRank.length - 1] === 0) byRank.pop();

  return {
    placements,
    unfilled,
    problems,
    summary: {
      people: people.length,
      placements: placements.length,
      byRank,
      unranked,
      unfilled: unfilled.length,
      peopleWithFirstChoice: new Set(placements.filter((p) => p.rank === 1).map((p) => p.personId)).size,
    },
  };
}
