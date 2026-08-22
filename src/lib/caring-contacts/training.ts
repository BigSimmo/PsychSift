// src/lib/caring-contacts/training.ts
//
// Training-mode competencies and the live/training data-separation rule.
//
// Contract (spec §4.2, decision lock): a training workspace must never share data with the live
// workspace. `workspacesMayShareData` is the one predicate every future cross-workspace query or
// join is expected to consult, and it returns true only when BOTH sides are "live" -- a training
// workspace shares with nothing, including another training workspace, because two independent
// training sandboxes mixing data would itself be a silent, hard-to-notice leak of "isn't this
// production" assumptions.
import type { ActorId } from "./ids";

export type WorkspaceKind = "live" | "training";

export type TrainingCompetency =
  "identityReview" | "activation" | "withdrawal" | "deliveryFailure" | "readmission" | "downtime" | "incidentHandling";

export const TRAINING_COMPETENCIES: readonly TrainingCompetency[] = Object.freeze([
  "identityReview",
  "activation",
  "withdrawal",
  "deliveryFailure",
  "readmission",
  "downtime",
  "incidentHandling",
]);

export type TrainingRecord = {
  actorId: ActorId;
  completed: readonly TrainingCompetency[];
};

export function emptyTrainingRecord(actorId: ActorId): TrainingRecord {
  return Object.freeze({ actorId, completed: Object.freeze([]) });
}

/** Idempotent: recording an already-completed competency leaves `completed` set-equal. */
export function recordCompetency(record: TrainingRecord, competency: TrainingCompetency): TrainingRecord {
  if (record.completed.includes(competency)) return record;
  return Object.freeze({ actorId: record.actorId, completed: Object.freeze([...record.completed, competency]) });
}

export function trainingComplete(record: TrainingRecord): boolean {
  return TRAINING_COMPETENCIES.every((competency) => record.completed.includes(competency));
}

/**
 * True only when both workspaces are "live". A training workspace never shares data with
 * anything -- not the live workspace, and not another training workspace -- because training
 * sandboxes are expected to be replaced, reset, and run in parallel without ever needing to agree
 * with each other about what a synthetic identifier means.
 */
export function workspacesMayShareData(a: WorkspaceKind, b: WorkspaceKind): boolean {
  return a === "live" && b === "live";
}
