import type { AssessmentsState } from "@/lib/teaching/assessments/model";

/*
 * Page memory for the made-up Assessments story (work-mode redesign, owner
 * request 6 Oct 2026). The To do, Progress and Supervision tabs are separate
 * addresses, so moving between them unmounts the page. These two values live
 * only in this browser tab's JavaScript memory, never in any storage: a
 * reload, a new tab or signing in again starts the story afresh, as before.
 */

export type AssessRole = "doctor" | "supervisor";

let story: { key: string; state: AssessmentsState } | null = null;
let role: AssessRole = "doctor";

/** The story as it was left on this account in this tab, or null. */
export function rememberedStory(key: string): AssessmentsState | null {
  return story && story.key === key ? story.state : null;
}

export function rememberStory(key: string, state: AssessmentsState): void {
  story = { key, state };
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
  role = "doctor";
}
