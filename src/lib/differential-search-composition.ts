import {
  diagnosisOwnSummary,
  type DifferentialPresentationWorkflow,
  type DifferentialRecord,
} from "@/lib/differential-snapshot";

export type DifferentialRecordMatch = {
  record: DifferentialRecord;
  score: number;
  reasons: string[];
};

/** Back-compat alias kept for the universal-search workstream naming. */
export type DifferentialSearchMatch = DifferentialRecordMatch;

export type DifferentialPresentationMatch = {
  workflow: DifferentialPresentationWorkflow;
  score: number;
  reasons: string[];
};

export type DifferentialSearchResultItem = {
  id: string;
  kind: "presentation" | "diagnosis";
  slug: string;
  title: string;
  scopeLabel?: string;
  subtitle: string;
  href: string;
  status: DifferentialRecord["status"];
  score: number;
  matchLabel: "Best match" | "High match" | "Moderate match" | "Lower match";
  tags: string[];
  clinicalCues: string[];
  nextSteps: string[];
  safety: string;
  reasons: string[];
};

const clinicalHingePrefix = /^clinical hinge:/i;

/**
 * The "Look for" cues written about this diagnosis.
 *
 * Never `currentPresentation`: the export parser fills it with the presentation
 * group's title, its candidate list and a "CLINICAL HINGE: …" line, so it is
 * group text, and showing it as cues put the akathisia hinge under Acute
 * psychosis. The diagnosis-scoped "Why it fits" items are the diagnosis's own,
 * less any group hinge and the line already shown as the subtitle.
 */
function diagnosisOwnCues(record: DifferentialRecord, subtitle: string): string[] {
  const groupHinge = record.clinicalHingeScope === "presentation" ? (record.clinicalHinge?.trim() ?? "") : "";
  const fit = (record.sections ?? []).find((section) => section.id === "why-it-fits");
  if (!fit || fit.scope === "presentation") return [];
  return fit.items
    .map((item) => item.trim())
    .filter((item) => item && item !== groupHinge && item !== subtitle.trim() && !clinicalHingePrefix.test(item))
    .slice(0, 3);
}

function diagnosisResultItem(match: DifferentialRecordMatch): Omit<DifferentialSearchResultItem, "matchLabel"> {
  const { record, score, reasons } = match;
  const subtitle = diagnosisOwnSummary(record);
  const clinicalCues = diagnosisOwnCues(record, subtitle);
  return {
    id: record.slug,
    kind: "diagnosis",
    slug: record.slug,
    title: record.title,
    subtitle,
    href: `/differentials/diagnoses/${record.slug}`,
    status: record.status,
    score,
    tags: [...clinicalCues, record.investigations[0]]
      .filter((value): value is string => Boolean(value?.trim()))
      .slice(0, 4),
    clinicalCues,
    nextSteps: record.investigations.filter((value) => value.trim()).slice(0, 2),
    safety: record.safetySnapshot.summary,
    reasons,
  };
}

function presentationResultItem(
  match: DifferentialPresentationMatch,
): Omit<DifferentialSearchResultItem, "matchLabel"> {
  const { workflow, score, reasons } = match;
  return {
    id: workflow.id,
    kind: "presentation",
    slug: workflow.id,
    title: workflow.title,
    scopeLabel: workflow.scopeLabel,
    subtitle: workflow.subtitle,
    href: `/differentials/presentations/${workflow.id}`,
    status: workflow.status,
    score,
    tags: workflow.safetySnapshot.tags.slice(0, 4),
    clinicalCues: workflow.safetySnapshot.tags.filter((value) => value.trim()).slice(0, 3),
    nextSteps: workflow.reviewChecklist.filter((value) => value.trim()).slice(0, 2),
    safety: workflow.safetySnapshot.summary,
    reasons,
  };
}

/** Compose ranked diagnosis + presentation matches into one adaptive result
 *  list: when a presentation matches about as strongly as the best diagnosis
 *  it leads (followed by its candidate diagnoses in ranked order), otherwise
 *  results interleave purely by score. Deduped by id, capped at `limit`. */
export function composeDifferentialSearchResults(
  diagnoses: DifferentialRecordMatch[],
  presentations: DifferentialPresentationMatch[],
  limit = 8,
): DifferentialSearchResultItem[] {
  const items: Array<Omit<DifferentialSearchResultItem, "matchLabel">> = [];
  const seen = new Set<string>();
  const push = (item: Omit<DifferentialSearchResultItem, "matchLabel">) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  const topPresentation = presentations[0];
  const topDiagnosisScore = diagnoses[0]?.score ?? 0;
  const presentationLeads =
    Boolean(topPresentation) && (topDiagnosisScore === 0 || topPresentation!.score >= topDiagnosisScore * 0.8);

  if (topPresentation && presentationLeads) {
    push(presentationResultItem(topPresentation));
    const candidateSlugs = new Set(topPresentation.workflow.candidates.map((candidate) => candidate.slug));
    for (const match of diagnoses) {
      if (candidateSlugs.has(match.record.slug)) push(diagnosisResultItem(match));
    }
    for (const match of diagnoses) push(diagnosisResultItem(match));
    for (const match of presentations.slice(1)) push(presentationResultItem(match));
  } else {
    const merged = [
      ...diagnoses.map((match) => ({ score: match.score, item: diagnosisResultItem(match) })),
      ...presentations.map((match) => ({ score: match.score, item: presentationResultItem(match) })),
    ].sort((left, right) => right.score - left.score);
    for (const entry of merged) push(entry.item);
  }

  return items.slice(0, limit).map((item, index) => ({
    ...item,
    matchLabel:
      index === 0 ? "Best match" : item.score >= 12 ? "High match" : item.score >= 6 ? "Moderate match" : "Lower match",
  }));
}

// These are the same compact entry queries previously derived at module load
// from the generated snapshot. Keeping only the five rendered strings avoids
// shipping the full snapshot to the client for a small "Recent work" list.
export const defaultDifferentialRecentQueries = [
  "older adult acute confusion",
  "first episode psychosis",
  "perinatal mood psychosis",
  "agitated intoxicated patient",
  "withdrawal tremor autonomic",
] as const;
