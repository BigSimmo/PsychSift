import type { ExtrasState } from "@/lib/teaching/assessments/extras";
import type { AssessmentsState } from "@/lib/teaching/assessments/model";
import type { TraineeState } from "@/lib/work-screens/assessments/trainee";

/*
 * Page memory for the made-up Assessments story (work-mode redesign, owner
 * request 6 Oct 2026). The To do, Progress and Supervision tabs are separate
 * addresses, so moving between them unmounts the page. These two values live
 * only in this browser tab's JavaScript memory, never in any storage: a
 * reload, a new tab or signing in again starts the story afresh, as before.
 */

export type AssessRole = "doctor" | "supervisor";

let story: { key: string; state: AssessmentsState } | null = null;
/**
 * The inbox's answers and the overview's reminders, shared with each doctor's own page
 * (`/teaching/assessments/trainee/[id]`), so an answer sent from either shows on both.
 */
let extras: { key: string; state: ExtrasState } | null = null;
let role: AssessRole = "doctor";

/** The story as it was left on this account in this tab, or null. */
export function rememberedStory(key: string): AssessmentsState | null {
  return story && story.key === key ? story.state : null;
}

export function rememberStory(key: string, state: AssessmentsState): void {
  story = { key, state };
}

/** The inbox answers as they were left on this account in this tab, or null. */
export function rememberedExtras(key: string): ExtrasState | null {
  return extras && extras.key === key ? extras.state : null;
}

export function rememberExtras(key: string, state: ExtrasState): void {
  extras = { key, state };
}

/** Each doctor's page's own confirmations, asks and corrections (its answers live in `extras`). */
type TraineeOwn = Omit<TraineeState, "extras">;
let trainee: { key: string; state: TraineeOwn } | null = null;

export function rememberedTrainee(key: string): TraineeOwn | null {
  return trainee && trainee.key === key ? trainee.state : null;
}

export function rememberTrainee(key: string, state: TraineeOwn): void {
  trainee = { key, state };
}

/** Whose assessments the tabs show when the address does not say. Starts as "My training". */
export function rememberedRole(): AssessRole {
  return role;
}

export function rememberRole(next: AssessRole): void {
  role = next;
}

/** For tests: forget everything. */
export function forgetAssessMemory(): void {
  story = null;
  extras = null;
  trainee = null;
  role = "doctor";
}
