import { normalizeSearchText, rankCatalogRecords } from "@/lib/catalog-search";
import { buildDiagnosisTitleSlugMap, buildTermLinkMap } from "@/lib/differential-diagnosis-links";
import { cleanDifferentialItem, type DifferentialDetailContext } from "@/lib/differential-detail";
import { loadDifferentialSnapshot } from "@/lib/differential-fixtures";
import { deriveGovernanceFromSnapshot } from "@/lib/differential-records";
import {
  type DifferentialPresentationMatch,
  type DifferentialRecordMatch,
} from "@/lib/differential-search-composition";
import type {
  DifferentialComparisonCandidate,
  DifferentialComparisonCriterion,
  DifferentialMapNode,
  DifferentialPresentationWorkflow,
  DifferentialRecord,
  DifferentialRedFlagFlow,
  DifferentialScenarioPreset,
  DifferentialSection,
} from "@/lib/differential-snapshot";

export type DifferentialStreamType = "presentations" | "diagnoses";

export type DifferentialLikelihood = "most-likely" | "possible" | "less-likely" | "must-not-miss";

export type DifferentialStreamCard = {
  id: string;
  title: string;
  description: string;
  examples: string[];
  href: string;
};

export type {
  DifferentialComparisonCandidate,
  DifferentialComparisonCriterion,
  DifferentialMapNode,
  DifferentialPresentationWorkflow,
  DifferentialRecord,
  DifferentialRedFlagFlow,
  DifferentialScenarioPreset,
  DifferentialSection,
};
export {
  composeDifferentialSearchResults,
  type DifferentialPresentationMatch,
  type DifferentialRecordMatch,
  type DifferentialSearchMatch,
  type DifferentialSearchResultItem,
} from "@/lib/differential-search-composition";

function catalog() {
  return loadDifferentialSnapshot();
}

export { loadDifferentialSnapshot } from "@/lib/differential-fixtures";

export const differentialRecords: DifferentialRecord[] = catalog().diagnoses;

export function differentialPresentations(): DifferentialPresentationWorkflow[] {
  return catalog().presentations;
}

export function differentialScenarioPresets(): DifferentialScenarioPreset[] {
  // The generated snapshot can carry markdown-header artifacts (e.g. "# Scenario
  // Presets") as synthetic first rows; they are not searchable presets.
  return catalog().presets.filter((preset) => !preset.query.trimStart().startsWith("#"));
}

export function differentialSearchAliases(): Record<string, string[]> {
  // The generated snapshot can leak template metadata (field name → numeric
  // weight, e.g. "tags" → ["1.1"]) into the alias map; bare-number aliases
  // would match unrelated records by substring, so drop them.
  return Object.fromEntries(
    Object.entries(catalog().searchAliases)
      .map(([token, aliases]) => [token, aliases.filter((alias) => !/^\d+(\.\d+)?$/.test(alias.trim()))] as const)
      .filter(([, aliases]) => aliases.length > 0),
  );
}

export function getPresentationWorkflow(slug: string | null | undefined) {
  const normalizedSlug = slug?.trim().toLowerCase();
  if (!normalizedSlug) return null;
  return differentialPresentations().find((presentation) => presentation.id === normalizedSlug) ?? null;
}

/** Reserved workflow id for cross-presentation compare selections. */
export const AD_HOC_DIFFERENTIAL_COMPARE_ID = "selected-differentials";

const AD_HOC_COMPARE_CRITERIA: DifferentialComparisonCriterion[] = [
  { id: "why-it-fits", title: "Why it fits", tone: "fit" },
  // Catalogue diagnoses do not ship a `what-argues-against` section; omit it so
  // ad-hoc compare rows never render an all-placeholder criterion.
  { id: "must-not-miss", title: "Must-not-miss", tone: "warning" },
  { id: "bedside-question", title: "Bedside question", tone: "question" },
  { id: "immediate-action", title: "Immediate action", tone: "action" },
  { id: "investigations", title: "Investigations", tone: "test" },
  { id: "mimics-overlap", title: "Mimics / overlap", tone: "overlap" },
];

export type DifferentialCompareSelection = {
  kind: "presentation" | "ad-hoc";
  workflow: DifferentialPresentationWorkflow;
  diagnosisIds: string[];
};

function normalizeRequestedDiagnosisIds(ids: Iterable<string>): string[] {
  const seen = new Set<string>();
  const diagnosisIds: string[] = [];
  for (const id of ids) {
    const normalized = id.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    // Drop unknown slugs so redirects never advertise IDs the catalogue cannot
    // compare. Presentation membership is decided only among real records.
    if (!getDifferentialRecord(normalized)) continue;
    seen.add(normalized);
    diagnosisIds.push(normalized);
  }
  return diagnosisIds;
}

function presentationContainsAllDiagnosisIds(
  presentation: DifferentialPresentationWorkflow,
  diagnosisIds: readonly string[],
) {
  if (!diagnosisIds.length) return false;
  const candidateIds = new Set(presentation.candidates.map((candidate) => candidate.slug));
  return diagnosisIds.every((id) => candidateIds.has(id));
}

function comparisonCellFromSection(section: DifferentialSection | undefined) {
  if (!section) return "Review locally.";
  const summary = section.summary.trim();
  if (summary) return summary;
  const items = section.items.map((item) => item.trim()).filter(Boolean);
  return items.length ? items.join("; ") : "Review locally.";
}

/** Build a presentation-shaped workflow from diagnosis records so selections
 *  that span multiple catalogue presentations still compare side by side. */
export function buildAdHocPresentationWorkflow(ids: Iterable<string>): DifferentialPresentationWorkflow | null {
  const diagnosisIds = normalizeRequestedDiagnosisIds(ids);
  if (!diagnosisIds.length) return null;

  const records = diagnosisIds
    .map((id) => getDifferentialRecord(id))
    .filter((record): record is DifferentialRecord => Boolean(record));
  if (!records.length) return null;

  const status = records.some((record) => record.status === "emergent")
    ? "emergent"
    : records.some((record) => record.status === "urgent")
      ? "urgent"
      : "routine";

  const candidates: DifferentialComparisonCandidate[] = records.map((record) => {
    const sectionsById = new Map(record.sections.map((section) => [section.id, section]));
    const comparison: Record<string, string> = {};
    for (const criterion of AD_HOC_COMPARE_CRITERIA) {
      if (criterion.id === "investigations" && !sectionsById.has("investigations")) {
        comparison[criterion.id] = record.investigations.filter(Boolean).join("; ") || "Review locally.";
        continue;
      }
      if (criterion.id === "immediate-action" && !sectionsById.has("immediate-action")) {
        comparison[criterion.id] = record.immediateActions.filter(Boolean).join("; ") || "Review locally.";
        continue;
      }
      comparison[criterion.id] = comparisonCellFromSection(sectionsById.get(criterion.id));
    }
    return { slug: record.slug, selected: true, comparison };
  });

  const safetyTags = Array.from(
    new Set(records.flatMap((record) => record.safetySnapshot.tags.map((tag) => tag.trim()).filter(Boolean))),
  ).slice(0, 6);

  return {
    id: AD_HOC_DIFFERENTIAL_COMPARE_ID,
    title: "Selected differentials",
    status,
    subtitle: "Side-by-side comparison of the diagnoses you selected from search.",
    selectedCount: candidates.length,
    totalCount: candidates.length,
    safetySnapshot: {
      summary:
        records
          .map((record) => record.safetySnapshot.summary.trim())
          .filter(Boolean)
          .join(" ") || "Review safety notes for each selected diagnosis.",
      tags: safetyTags,
    },
    criteria: AD_HOC_COMPARE_CRITERIA,
    candidates,
    reviewChecklist: [
      "Confirm each selected diagnosis still fits the current presentation",
      "Review must-not-miss risks across the selected set",
      "Choose immediate actions and investigations that discriminate",
      "Document and handoff the working differential",
    ],
    highestUrgencyNote:
      status === "emergent"
        ? "At least one selected diagnosis is emergent. Act early."
        : status === "urgent"
          ? "At least one selected diagnosis is urgent. Prioritise safety."
          : "Review selected differentials before acting.",
    sourceStatus: {
      label: "Selected from catalogue",
      version: catalog().governance.version || "Local content only",
      lastUpdated: catalog().exportedAt || "Pending review",
    },
  };
}

/**
 * Prefer a presentation that contains every requested diagnosis. When IDs span
 * presentations (or none match), fall back to the highest partial overlap so
 * callers that only need "a related workflow" still get a useful default.
 */
export function getPresentationWorkflowForDiagnosisIds(ids: Iterable<string>) {
  const requestedIds = new Set(normalizeRequestedDiagnosisIds(ids));
  if (!requestedIds.size) return null;

  let bestMatch: DifferentialPresentationWorkflow | null = null;
  let bestMatchCount = 0;
  let fullCoverage: DifferentialPresentationWorkflow | null = null;

  for (const presentation of differentialPresentations()) {
    const matchCount = presentation.candidates.reduce(
      (count, candidate) => count + (requestedIds.has(candidate.slug) ? 1 : 0),
      0,
    );
    // First full-coverage host in catalogue order wins ties (stable with the
    // historical single-ID redirect, e.g. delirium → acute-confusion).
    if (!fullCoverage && matchCount === requestedIds.size) {
      fullCoverage = presentation;
    }
    if (matchCount > bestMatchCount) {
      bestMatch = presentation;
      bestMatchCount = matchCount;
    }
  }
  return fullCoverage ?? bestMatch;
}

/**
 * Resolve compare handoff for selected diagnosis IDs.
 * - `presentation`: every ID belongs to one catalogue presentation (keep rich cells).
 * - `ad-hoc`: IDs span presentations (or have no host); keep every valid ID.
 */
export function getPresentationWorkflowSelectionForDiagnosisIds(
  ids: Iterable<string>,
): DifferentialCompareSelection | null {
  const diagnosisIds = normalizeRequestedDiagnosisIds(ids);
  if (!diagnosisIds.length) return null;

  const fullCoverage = differentialPresentations().find((presentation) =>
    presentationContainsAllDiagnosisIds(presentation, diagnosisIds),
  );
  if (fullCoverage) {
    return { kind: "presentation", workflow: fullCoverage, diagnosisIds };
  }

  const workflow = buildAdHocPresentationWorkflow(diagnosisIds);
  if (!workflow) return null;
  return { kind: "ad-hoc", workflow, diagnosisIds };
}

function differentialCompareHref(path: string, query: string, selectedIds: readonly string[]) {
  const params = new URLSearchParams();
  const trimmedQuery = query.trim();
  if (trimmedQuery) params.set("q", trimmedQuery);
  if (selectedIds.length > 0) params.set("ids", selectedIds.join(","));
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export type DifferentialCompareHandoff =
  | {
      kind: "ad-hoc";
      href: string;
      selection: DifferentialCompareSelection;
    }
  | {
      kind: "presentation";
      href: string;
      selection: DifferentialCompareSelection | null;
    };

/**
 * Resolve `/differentials/compare` handoff without a competing route handler.
 * Same-presentation (or empty/unknown) selections redirect into a catalogue
 * presentation; cross-presentation selections stay on the compare page.
 */
export function resolveDifferentialCompareHandoff(ids: Iterable<string>, query = ""): DifferentialCompareHandoff {
  const selection = getPresentationWorkflowSelectionForDiagnosisIds(ids);
  if (selection?.kind === "ad-hoc") {
    return {
      kind: "ad-hoc",
      href: differentialCompareHref("/differentials/compare", query, selection.diagnosisIds),
      selection,
    };
  }

  const workflowId =
    selection?.kind === "presentation" && selection.workflow.id !== AD_HOC_DIFFERENTIAL_COMPARE_ID
      ? selection.workflow.id
      : "acute-confusion-encephalopathy";
  const diagnosisIds = selection?.diagnosisIds ?? [];
  return {
    kind: "presentation",
    href: differentialCompareHref(`/differentials/presentations/${workflowId}`, query, diagnosisIds),
    selection,
  };
}

/**
 * Href for the Compare queue "Open comparison" CTA.
 * Catalogue-hosted selections open the presentation workflow; cross-presentation
 * selections open the ad-hoc workspace on `/differentials/compare`.
 */
export function resolveDifferentialCompareLaunchHref(ids: Iterable<string>, query = ""): string {
  const handoff = resolveDifferentialCompareHandoff(ids, query);
  if (handoff.kind === "presentation") return handoff.href;
  if (handoff.selection.diagnosisIds.length === 1) {
    return differentialCompareHref(
      "/differentials/presentations/acute-confusion-encephalopathy",
      query,
      handoff.selection.diagnosisIds,
    );
  }
  const params = new URLSearchParams();
  const trimmedQuery = query.trim();
  if (trimmedQuery) params.set("q", trimmedQuery);
  if (handoff.selection.diagnosisIds.length) params.set("ids", handoff.selection.diagnosisIds.join(","));
  params.set("workspace", "1");
  return `/differentials/compare?${params.toString()}`;
}

/** Queue rows for the Compare page (title lookup from the local catalogue). */
export function differentialCompareQueueItems(ids: Iterable<string>): Array<{ slug: string; title: string }> {
  return normalizeRequestedDiagnosisIds(ids).map((slug) => ({
    slug,
    title: getDifferentialRecord(slug)?.title ?? slug.replace(/-/g, " "),
  }));
}

export const acuteConfusionPresentationWorkflow: DifferentialPresentationWorkflow =
  getPresentationWorkflow("acute-confusion-encephalopathy") ?? differentialPresentations()[0]!;

export const differentialPresentationsCards: DifferentialStreamCard[] = differentialPresentations().map(
  (presentation) => ({
    id: `presentation-${presentation.id}`,
    title: presentation.title,
    description: presentation.subtitle,
    examples: presentation.safetySnapshot.tags.slice(0, 3),
    href: `/differentials/presentations/${presentation.id}`,
  }),
);

export const differentialDiagnosesCards: DifferentialStreamCard[] = differentialRecords.map((record) => ({
  id: `diagnosis-${record.slug}`,
  title: record.title,
  description: record.clinicalHinge,
  examples: record.related.slice(0, 3).map((node) => node.label),
  href: `/differentials/diagnoses/${record.slug}`,
}));

export function getDifferentialRecord(slug: string | null | undefined) {
  const normalizedSlug = slug?.trim().toLowerCase();
  if (!normalizedSlug) return null;
  return differentialRecords.find((record) => record.slug === normalizedSlug) ?? null;
}

export function presentationStaticParams() {
  return differentialPresentations().map((presentation) => ({ slug: presentation.id }));
}

/** Server-computed context for the diagnosis detail page. Everything the page
 *  needs from the full catalog travels in this small serializable payload so
 *  the client component never imports the generated snapshot. */
export function getDifferentialDetailContext(
  record: DifferentialRecord,
  catalog: {
    records?: DifferentialRecord[];
    presentations?: DifferentialPresentationWorkflow[];
  } = {},
): DifferentialDetailContext {
  const catalogRecords = catalog.records ?? differentialRecords;
  const catalogPresentations = catalog.presentations ?? differentialPresentations();
  const routableDiagnosisSlugs = new Set(differentialRecords.map((entry) => entry.slug));
  const routablePresentationSlugs = new Set(differentialPresentations().map((entry) => entry.id));
  const knownRelatedSlugs = [
    ...new Set(record.related.map((node) => node.id).filter((id) => routableDiagnosisSlugs.has(id))),
  ];
  const catalogRecordBySlug = new Map(catalogRecords.map((entry) => [entry.slug, entry]));
  const relatedMapDetails: DifferentialDetailContext["relatedMapDetails"] = {};
  for (const slug of knownRelatedSlugs) {
    const related = catalogRecordBySlug.get(slug);
    const title = typeof related?.title === "string" ? related.title.trim() : "";
    const clinicalHinge = typeof related?.clinicalHinge === "string" ? related.clinicalHinge.trim() : "";
    const safetySummary =
      typeof related?.safetySnapshot?.summary === "string" ? related.safetySnapshot.summary.trim() : "";
    const status = related?.status;
    if (
      !related ||
      !title ||
      !clinicalHinge ||
      !safetySummary ||
      (status !== "emergent" && status !== "urgent" && status !== "routine")
    ) {
      continue;
    }
    relatedMapDetails[slug] = {
      slug: related.slug,
      title,
      status,
      clinicalHinge,
      safetySummary,
    };
  }

  const titleMap = buildDiagnosisTitleSlugMap(catalogRecords);
  // Owner-row payloads can be partial in tests/live drift — never assume tags/items exist.
  const termLabels = [
    ...(record.safetySnapshot?.tags ?? []),
    ...(record.sections ?? []).flatMap((section) => section.items ?? []),
  ];
  const termLinks = buildTermLinkMap(termLabels, {
    excludeSlug: record.slug,
    titleMap,
    routableSlugs: routableDiagnosisSlugs,
  });

  const overlapLinks: Record<string, string> = {};
  for (const section of record.sections ?? []) {
    if (section.tone !== "overlap") continue;
    for (const item of section.items ?? []) {
      const cleaned = cleanDifferentialItem(item);
      const slug = termLinks[cleaned];
      if (slug) overlapLinks[cleaned] = slug;
    }
  }

  const presentation =
    catalogPresentations.find(
      (workflow) =>
        routablePresentationSlugs.has(workflow.id) &&
        workflow.candidates.some((candidate) => candidate.slug === record.slug),
    ) ?? null;

  const snapshot = loadDifferentialSnapshot();
  const governance = deriveGovernanceFromSnapshot(snapshot);
  return {
    knownRelatedSlugs,
    relatedMapDetails,
    termLinks,
    overlapLinks,
    comparePresentation: presentation ? { slug: presentation.id, title: presentation.title } : null,
    source: {
      version: snapshot.governance.version,
      exportedAt: snapshot.exportedAt,
      reviewStatus: snapshot.governance.reviewStatus,
      sourceTitle: snapshot.governance.sourceTitle,
      sourceStatus: governance.source_status,
      validationStatus: governance.validation_status,
    },
  };
}

export function differentialStaticParams() {
  return differentialRecords.map((record) => ({ slug: record.slug }));
}

function expandQueryTerms(terms: string[]) {
  const aliases = differentialSearchAliases();
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const alias of aliases[term] ?? []) {
      for (const aliasToken of normalizeSearchText(alias).split(/\s+/).filter(Boolean)) expanded.add(aliasToken);
      expanded.add(normalizeSearchText(alias));
    }
  }
  return [...expanded];
}

// Cross-entity link indexes: presentations and diagnoses are one logical catalogue joined
// by workflow.candidates[].slug, so each ranker also indexes the other kind's titles at low
// weight. Bundled callers use lazy static caches; release callers pass an explicit same-partition
// context so database-only edits never mix with bundled relationships.

export type DifferentialRankingContext = Readonly<{
  diagnoses: readonly DifferentialRecord[];
  presentations: readonly DifferentialPresentationWorkflow[];
}>;

function buildDiagnosisTitleBySlug(records: readonly DifferentialRecord[]): Map<string, string> {
  return new Map(records.map((record) => [record.slug, record.title]));
}

function buildPresentationTitleTextBySlug(
  presentations: readonly DifferentialPresentationWorkflow[],
): Map<string, string> {
  const titleTextBySlug = new Map<string, string>();
  for (const workflow of presentations) {
    const text = normalizeSearchText(`${workflow.title} ${workflow.id}`);
    for (const candidate of workflow.candidates) {
      const existing = titleTextBySlug.get(candidate.slug);
      titleTextBySlug.set(candidate.slug, existing ? `${existing} ${text}` : text);
    }
  }
  return titleTextBySlug;
}

let diagnosisTitleBySlugCache: Map<string, string> | null = null;

function diagnosisTitleBySlug(): Map<string, string> {
  diagnosisTitleBySlugCache ??= buildDiagnosisTitleBySlug(differentialRecords);
  return diagnosisTitleBySlugCache;
}

let presentationTitleTextBySlugCache: Map<string, string> | null = null;

/** Reverse index text: normalized titles of the snapshot presentations that list this
 *  diagnosis as a candidate, so a presentation-shaped query ("acute confusion") surfaces
 *  the differentials it works up. */
function presentationTitleTextForDiagnosis(slug: string): string {
  if (!presentationTitleTextBySlugCache) {
    presentationTitleTextBySlugCache = buildPresentationTitleTextBySlug(differentialPresentations());
  }
  return presentationTitleTextBySlugCache.get(slug) ?? "";
}

/** Forward index text: the candidate differentials' titles (falling back to de-hyphenated
 *  slugs for candidates outside the snapshot, e.g. owner-edited rows), so a diagnosis-shaped
 *  query ("wernicke") surfaces the presentations that work it up. Computed from the passed
 *  workflow so owner rows ranked via the differentials API get the same treatment. */
function candidateTitlesText(
  workflow: DifferentialPresentationWorkflow,
  titles: ReadonlyMap<string, string> = diagnosisTitleBySlug(),
): string {
  return normalizeSearchText(
    workflow.candidates.map((candidate) => titles.get(candidate.slug) ?? candidate.slug.replace(/-/g, " ")).join(" "),
  );
}

const differentialStatusRank: Record<DifferentialRecord["status"], number> = {
  emergent: 0,
  urgent: 1,
  routine: 2,
};

function diagnosisHingeText(record: DifferentialRecord) {
  return normalizeSearchText(
    [record.subtitle, record.clinicalHinge, record.safetySnapshot.summary, ...record.safetySnapshot.tags].join(" "),
  );
}

export function diagnosisFullText(record: DifferentialRecord) {
  return normalizeSearchText(
    [
      record.title,
      record.slug,
      record.subtitle,
      record.clinicalHinge,
      record.safetySnapshot.summary,
      ...record.safetySnapshot.tags,
      ...record.sections.flatMap((section) => [section.title, section.summary, ...section.items]),
      ...record.related.flatMap((node) => [node.label, node.note ?? ""]),
      ...record.currentPresentation,
      ...record.investigations,
      ...record.immediateActions,
    ].join(" "),
  );
}

/** Ranked catalogue search over diagnosis records, built on the shared
 *  rankCatalogRecords primitive. Records are passed in so the API can rank
 *  live owner rows and universal search can rank the snapshot with the same
 *  scoring. Alias expansion (symptom -> diagnosis vocabulary) comes from the
 *  imported catalogue's searchAliases; urgency shapes ties only, never
 *  outranking a stronger text match. */
export function rankDifferentialRecords(
  records: DifferentialRecord[],
  query: string,
  limit = 50,
  // Low-weight synonym/acronym/alias terms (see rankMedicationRecords) composed onto the
  // catalogue's own symptom-alias expansion for the shared ranker's expanded lane.
  expansions: string[] = [],
  context?: DifferentialRankingContext,
): DifferentialRecordMatch[] {
  const releasePresentationTitles = context ? buildPresentationTitleTextBySlug(context.presentations) : null;
  return rankCatalogRecords(records, query, {
    fields: [
      { id: "title", weight: 8, text: (record) => normalizeSearchText(`${record.title} ${record.slug}`) },
      { id: "hinge", weight: 3, text: diagnosisHingeText },
      // Cross-entity lane (kept out of fullText so it never earns the phrase/content
      // double-count): weight sits well below title/hinge, so a presentation-shaped query
      // surfaces the candidates without ever outranking a direct match; equal-score
      // candidates fall to the emergent-first tie-break below.
      {
        id: "presentations",
        weight: 2,
        text: (record) =>
          releasePresentationTitles
            ? (releasePresentationTitles.get(record.slug) ?? "")
            : presentationTitleTextForDiagnosis(record.slug),
      },
    ],
    fullText: diagnosisFullText,
    contentWeight: 2,
    compactBonus: 6,
    compactExtraText: (record) => normalizeSearchText(record.title),
    phraseBonus: 4,
    exactValues: (record) => [normalizeSearchText(record.title), normalizeSearchText(record.slug)],
    exactBonus: 10,
    expandTokens: context
      ? (terms) => (expansions.length ? [...terms, ...expansions] : terms)
      : expansions.length
        ? (terms) => [...expandQueryTerms(terms), ...expansions]
        : expandQueryTerms,
    limit,
    tieBreak: (left, right) =>
      differentialStatusRank[left.status] - differentialStatusRank[right.status] ||
      left.title.localeCompare(right.title),
  }).map(({ record, score, signals }) => ({
    record,
    score,
    reasons: [
      signals.fields.title ? "title" : "",
      signals.exact || signals.compact ? "exact name" : "",
      signals.fields.hinge ? "clinical hinge/safety" : "",
      signals.fields.presentations ? "presentation link" : "",
      signals.content ? "content" : "",
      signals.expanded ? "symptom alias" : "",
    ].filter(Boolean),
  }));
}

function presentationSafetyText(workflow: DifferentialPresentationWorkflow) {
  return normalizeSearchText([workflow.subtitle, ...workflow.safetySnapshot.tags].join(" "));
}

export function presentationFullText(workflow: DifferentialPresentationWorkflow) {
  return normalizeSearchText(
    [
      workflow.title,
      workflow.id,
      workflow.subtitle,
      ...workflow.safetySnapshot.tags,
      workflow.safetySnapshot.summary,
      workflow.highestUrgencyNote,
      ...workflow.reviewChecklist,
      ...workflow.candidates.map((candidate) => candidate.slug.replace(/-/g, " ")),
    ].join(" "),
  );
}

/** Ranked catalogue search over presentation workflows (same scoring family
 *  as rankDifferentialRecords, weighted towards safety tags). */
export function rankPresentationWorkflows(
  workflows: DifferentialPresentationWorkflow[],
  query: string,
  limit = 20,
  // Low-weight synonym/acronym/alias terms (see rankDifferentialRecords) composed onto the
  // catalogue's own symptom-alias expansion for the shared ranker's expanded lane.
  expansions: string[] = [],
  context?: DifferentialRankingContext,
): DifferentialPresentationMatch[] {
  const releaseDiagnosisTitles = context ? buildDiagnosisTitleBySlug(context.diagnoses) : null;
  return rankCatalogRecords(workflows, query, {
    fields: [
      { id: "title", weight: 8, text: (workflow) => normalizeSearchText(`${workflow.title} ${workflow.id}`) },
      { id: "safety", weight: 4, text: presentationSafetyText },
      // Cross-entity lane (see rankDifferentialRecords' "presentations" field): the candidate
      // differentials' titles, so a diagnosis-shaped query surfaces the presentations that
      // work it up without outranking the diagnosis's own record.
      {
        id: "candidates",
        weight: 2,
        text: (workflow) =>
          releaseDiagnosisTitles
            ? candidateTitlesText(workflow, releaseDiagnosisTitles)
            : candidateTitlesText(workflow),
      },
    ],
    fullText: presentationFullText,
    contentWeight: 2,
    compactBonus: 6,
    compactExtraText: (workflow) => normalizeSearchText(workflow.title),
    phraseBonus: 4,
    exactValues: (workflow) => [normalizeSearchText(workflow.title), normalizeSearchText(workflow.id)],
    exactBonus: 10,
    expandTokens: context
      ? (terms) => (expansions.length ? [...terms, ...expansions] : terms)
      : expansions.length
        ? (terms) => [...expandQueryTerms(terms), ...expansions]
        : expandQueryTerms,
    limit,
    tieBreak: (left, right) =>
      differentialStatusRank[left.status] - differentialStatusRank[right.status] ||
      left.title.localeCompare(right.title),
  }).map(({ record, score, signals }) => ({
    workflow: record,
    score,
    reasons: [
      signals.fields.title ? "title" : "",
      signals.exact || signals.compact ? "exact name" : "",
      signals.fields.safety ? "safety focus" : "",
      signals.fields.candidates ? "candidate differential" : "",
      signals.content ? "content" : "",
      signals.expanded ? "symptom alias" : "",
    ].filter(Boolean),
  }));
}

/** Back-compat wrapper: empty query returns the full catalogue (the API route
 *  relies on this), otherwise relevance-ranked results in ranked order. */
export function searchDifferentialRecords(query: string) {
  if (!normalizeSearchText(query)) return differentialRecords;
  return rankDifferentialRecords(differentialRecords, query, differentialRecords.length).map((match) => match.record);
}

/** Back-compat wrapper: empty query returns all presentations, otherwise
 *  ranked results in ranked order. */
export function searchPresentationWorkflows(query: string) {
  const presentations = differentialPresentations();
  if (!normalizeSearchText(query)) return presentations;
  return rankPresentationWorkflows(presentations, query, presentations.length).map((match) => match.workflow);
}
