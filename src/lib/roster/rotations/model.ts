import { z } from "zod";

import type { AllocationSummary, Placement, RotationLock, UnfilledTerm } from "@/lib/roster/rotations/allocate";

/**
 * Rotation preference rounds. A roster administrator (the team's roster
 * manager) opens a round for a team: the terms of the year, the rotations on
 * offer with places per term, a closing time and who is in it. Doctors rank
 * the rotations, the administrator runs the allocation, adjusts it, then
 * publishes. Published placements become calendar entries for each doctor.
 *
 * Names and free text are checked with the shared patient-detail check before
 * they are stored, so a round never carries patient details.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const rotationTermSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(40),
    start: isoDate,
    end: isoDate,
  })
  .refine((term) => term.start <= term.end, { message: "A term must end on or after its start" });

export const rotationOptionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  site: z.string().trim().max(80),
  places: z.number().int().min(0).max(50),
});

export const roundPersonSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  grade: z.string().trim().max(40).optional(),
});

export const ROUND_STATUSES = ["draft", "open", "closed", "published"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export const roundSetupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  closesAt: z.string().datetime({ offset: true }),
  /** Ranked choices a doctor must give before sending. 0 means any. */
  minRanked: z.number().int().min(0).max(30),
  terms: z.array(rotationTermSchema).min(1).max(12),
  rotations: z.array(rotationOptionSchema).min(1).max(60),
  people: z.array(roundPersonSchema).min(1).max(300),
  note: z.string().trim().max(400).optional(),
});
export type RoundSetup = z.infer<typeof roundSetupSchema>;

export type RotationRound = RoundSetup & {
  readonly id: string;
  readonly serviceId: string;
  readonly teamName: string;
  readonly status: RoundStatus;
  /** Who runs it, shown to doctors ("Published by Dr ..."). */
  readonly adminName: string;
  readonly createdAt: string;
  readonly openedAt: string | null;
  readonly publishedAt: string | null;
  /** Bumped on every edit after publishing, so calendars know to refresh. */
  readonly version: number;
};

export type RotationPreferenceRecord = {
  readonly personId: string;
  readonly ranking: readonly string[];
  /** Null while it is only a draft. */
  readonly submittedAt: string | null;
  readonly updatedAt: string;
};

export type RotationAllocation = {
  readonly runAt: string;
  readonly placements: readonly Placement[];
  readonly unfilled: readonly UnfilledTerm[];
  readonly summary: AllocationSummary;
  readonly problems: readonly string[];
};

/** What the administrator sees for one round. */
export type ManagedRound = {
  readonly round: RotationRound;
  readonly preferences: readonly RotationPreferenceRecord[];
  readonly locks: readonly RotationLock[];
  /** The latest run, edited by hand moves. Null until the first run. */
  readonly allocation: RotationAllocation | null;
};

/** What one doctor sees for one round. */
export type MyRound = {
  readonly round: RotationRound;
  readonly personId: string;
  readonly ranking: readonly string[];
  readonly submittedAt: string | null;
  /** Only once published. */
  readonly placements: readonly Placement[];
};

export const savePreferenceSchema = z.object({
  ranking: z.array(z.string().min(1).max(64)).max(60),
  submit: z.boolean(),
});

export const placementMoveSchema = z.object({
  personId: z.string().min(1).max(80),
  termId: z.string().min(1).max(64),
  /** Null clears the placement for that term. */
  rotationId: z.string().min(1).max(64).nullable(),
  /** Fix it so a re-run keeps it. */
  lock: z.boolean(),
});
export type PlacementMove = z.infer<typeof placementMoveSchema>;

export function rotationById(round: Pick<RotationRound, "rotations">, id: string) {
  return round.rotations.find((rotation) => rotation.id === id);
}

export function termById(round: Pick<RotationRound, "terms">, id: string) {
  return round.terms.find((term) => term.id === id);
}

/** Places per term across all rotations. */
export function placesPerTerm(round: Pick<RotationRound, "rotations">): number {
  return round.rotations.reduce((sum, rotation) => sum + rotation.places, 0);
}

/** True while doctors can still change their preferences. */
export function roundAcceptsPreferences(round: Pick<RotationRound, "status" | "closesAt">, now: Date): boolean {
  return round.status === "open" && Date.parse(round.closesAt) > now.getTime();
}
