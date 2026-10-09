/**
 * Differential Presentation Workflow Disambiguation (#HNJF5X).
 *
 * In differentials-snapshot, diagnoses are keyed by `slug` and presentations by `id`.
 * Three values collide across the two families:
 *   - "substance-intoxication"
 *   - "substance-withdrawal"
 *   - "depression"
 *
 * This module provides identifier disambiguation utilities to prefix these
 * colliding presentation IDs (e.g. "workflow-pres-...") when surfaces require
 * flat, collision-free identification across both families.
 */

export const PRESENTATION_WORKFLOW_ID_PREFIX = "workflow-pres-";

export const COLLIDING_PRESENTATION_WORKFLOW_IDS = [
  "substance-intoxication",
  "substance-withdrawal",
  "depression",
] as const;

export type CollidingPresentationWorkflowId = (typeof COLLIDING_PRESENTATION_WORKFLOW_IDS)[number];

export function isCollidingPresentationWorkflowId(id: string): id is CollidingPresentationWorkflowId {
  return (COLLIDING_PRESENTATION_WORKFLOW_IDS as readonly string[]).includes(id);
}

export function disambiguatePresentationWorkflowId(
  id: string,
  prefix: string = PRESENTATION_WORKFLOW_ID_PREFIX,
): string {
  if (isCollidingPresentationWorkflowId(id)) {
    return `${prefix}${id}`;
  }
  return id;
}

export function stripPresentationWorkflowPrefix(id: string, prefix: string = PRESENTATION_WORKFLOW_ID_PREFIX): string {
  if (id.startsWith(prefix)) {
    return id.slice(prefix.length);
  }
  return id;
}
