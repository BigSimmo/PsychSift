import type { Pathway } from "./data/types";

export function pathwayLinkedStepCount(pathway: Pick<Pathway, "steps">): number {
  return pathway.steps.filter((step) => Boolean(step.therapySlug)).length;
}

export function pathwayRowAccessibleName(pathway: Pathway, active: boolean): string {
  // Every line the row shows, in order, so voice control can say any of it (WCAG 2.5.3, A11Y-02).
  const parts = [
    pathway.name,
    pathway.clinicalProblem ?? pathway.summary ?? "Therapy workflow",
    `${pathwayLinkedStepCount(pathway)} linked steps`,
    pathwayReviewLabel(pathway),
  ];
  if (active) parts.push("currently selected");
  return parts.join(", ");
}

export function matchesPathwayFilter(pathway: Pathway, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [pathway.name, pathway.clinicalProblem, pathway.summary, pathwayReviewLabel(pathway)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function pathwayReviewLabel(pathway: Pick<Pathway, "reviewStatus" | "incomplete">): string {
  if (pathway.reviewStatus === "reviewed") return "Reviewed";
  if (pathway.incomplete) return "Incomplete";
  return "Needs review";
}

export function pathwayReviewBadgeClass(reviewed: boolean): string {
  return reviewed
    ? "border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-text)]"
    : "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]";
}
