import { normalizeSearchText, rankCatalogRecords } from "@/lib/catalog-search";
import { smartSearchExpansions } from "@/lib/smart-search-intent";
import { buildDiagnosisTitleSlugMap, buildTermLinkMap } from "@/lib/differential-diagnosis-links";
import { curatedEntryFor } from "@/lib/differential-curated";
import { curatedReviewFor } from "@/lib/differential-curated-review";
import {
  cleanDifferentialItem,
  withholdGeneratedBody,
  type DifferentialDetailContext,
} from "@/lib/differential-detail";
import { loadDifferentialSnapshot } from "@/lib/differential-fixtures";
import { deriveGovernanceFromSnapshot } from "@/lib/differential-records";
import {
  type DifferentialPresentationMatch,
  type DifferentialRecordMatch,
} from "@/lib/differential-search-composition";
import { diagnosisOwnSummary } from "@/lib/differential-snapshot";
import type {
  DifferentialComparisonCandidate,
  DifferentialComparisonCriterion,
  DifferentialMapNode,
  DifferentialPresentationWorkflow,
  DifferentialRecord,
  DifferentialRedFlagFlow,
  DifferentialScenarioPreset,
  DifferentialSection,
  DifferentialSnapshot,
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

const DIAGNOSIS_SCOPED_SECTION_IDS = new Set(["why-it-fits", "must-not-miss"]);

/**
 * Labels every piece of a diagnosis record with whose text it is.
 *
 * The export parser derives each diagnosis from its presentation group, so the
 * hinge, bedside question, immediate actions, investigations and mimics are
 * written about the group and then stamped onto all of its diagnoses. Measured
 * on the committed snapshot: 201 diagnoses share 31 distinct hinges, and five of
 * the seven comparison fields are byte-identical for every candidate in all 31
 * groups. Unlabelled, that makes the app assert the akathisia discriminator and
 * a tremor workup of acute dystonia.
 *
 * The parser now emits `scope` itself (see
 * `scripts/lib/parse-differentials-export.ts`), but the committed snapshot
 * predates it and cannot be regenerated without the upstream export zip. This
 * derives the same labels from the snapshot's own structure — a field identical
 * across every sibling in a group is group text — so the corpus is correct
 * before the next import and stays correct after it.
 *
 * Deliberately NOT applied in `loadDifferentialSnapshot()`: that loader also
 * feeds `buildDefaultDifferentialRows`, whose output is pinned byte-for-byte
 * against the epoch-zero bootstrap seed frozen inside an applied migration
 * (`tests/site-content-publication-route.test.ts`). Refreshing that seed edits a
 * migration that has already reached the live database, which is not this
 * change's to make. The consequence is that published canonical payloads carry
 * no scope, so {@link scopeDifferentialRecord} is exported and applied on every
 * canonical read in `src/lib/site-content/differential-page-records.ts` too.
 * Labelling has to happen on every path that reaches a clinician, not just the
 * bundled one.
 *
 * Guarded by `tests/differentials-presentation-scope.test.ts`.
 */
type PresentationScopeIndex = {
  /** Every hinge written about a presentation group, by exact text. */
  groupHinges: Set<string>;
  /** Per diagnosis slug, the comparison values shared by all of its siblings. */
  sharedBySlug: Map<string, Map<string, string>>;
};

function buildPresentationScopeIndex(snapshot: DifferentialSnapshot): PresentationScopeIndex {
  const groupHinges = new Set<string>();
  const sharedBySlug = new Map<string, Map<string, string>>();

  for (const presentation of snapshot.presentations) {
    const hinge = presentation.safetySnapshot?.summary?.trim();
    if (hinge) groupHinges.add(hinge);

    const candidates = presentation.candidates ?? [];
    const shared = new Map<string, string>();
    if (candidates.length > 1) {
      for (const criterion of presentation.criteria ?? []) {
        const values = candidates.map((candidate) => candidate.comparison?.[criterion.id]).filter(Boolean);
        if (values.length === candidates.length && new Set(values).size === 1) shared.set(criterion.id, values[0]!);
      }
    }
    for (const candidate of candidates) {
      const existing = sharedBySlug.get(candidate.slug) ?? new Map<string, string>();
      for (const [id, value] of shared) existing.set(id, value);
      sharedBySlug.set(candidate.slug, existing);
    }
  }

  return { groupHinges, sharedBySlug };
}

let bundledScopeIndex: PresentationScopeIndex | null = null;

function presentationScopeIndex(): PresentationScopeIndex {
  if (!bundledScopeIndex) bundledScopeIndex = buildPresentationScopeIndex(loadDifferentialSnapshot());
  return bundledScopeIndex;
}

function scopeRecordWith(record: DifferentialRecord, index: PresentationScopeIndex): DifferentialRecord {
  const hinge = record.clinicalHinge?.trim() ?? "";
  const hingeScope = hinge && index.groupHinges.has(hinge) ? ("presentation" as const) : ("diagnosis" as const);
  const shared = index.sharedBySlug.get(record.slug) ?? new Map<string, string>();

  return {
    ...record,
    clinicalHingeScope: hingeScope,
    safetySnapshot: {
      ...record.safetySnapshot,
      // Never the presentation hinge: that put the akathisia discriminator in
      // acute dystonia's safety summary.
      summary:
        hingeScope === "presentation" && record.safetySnapshot.summary?.trim() === hinge
          ? (record.safetySnapshot.tags ?? []).join(", ")
          : record.safetySnapshot.summary,
    },
    sections: (record.sections ?? []).map((section) => {
      const sharedValue = shared.get(section.id);
      const summary = section.summary?.trim() ?? "";
      const isGroup = DIAGNOSIS_SCOPED_SECTION_IDS.has(section.id)
        ? Boolean(sharedValue && summary && summary === sharedValue.trim())
        : true;
      const items =
        section.id === "why-it-fits" && hingeScope === "presentation" && hinge
          ? // The group hinge read as evidence for this diagnosis.
            section.items.filter((item) => item.trim() !== hinge)
          : section.items;
      return { ...section, items, scope: isGroup ? ("presentation" as const) : ("diagnosis" as const) };
    }),
  };
}

/**
 * Applies the scope labels, and the withhold, to one diagnosis record from any
 * source.
 *
 * Canonical published payloads were seeded from the deliberately unlabelled
 * snapshot, so a production read returns a record with no scope at all and the
 * UI would default it to diagnosis-specific — reinstating the exact mismatch
 * this exists to remove. Every reader of a canonical differential record must
 * pass it through here first.
 *
 * The withhold belongs here for the same reason, and the omission was a real
 * production hole: `loadDifferentialSnapshot` only feeds the SEED path, but in
 * production `site_content` is initialized, so `/api/differentials` returns the
 * live row's `finalRenderPayload` and maps it through this function alone. A
 * record whose generated body describes another diagnosis would have kept
 * reaching catalogue search from the database while every seed-backed test
 * passed. Applying it here also means the pending republish is cleanup rather
 * than the safety gate — the read path is correct whatever the row still holds.
 *
 * Withhold BEFORE scoping, matching the loader path exactly (the loader
 * withholds, then `withPresentationScope` scopes), so a seed read and a live
 * read of the same record cannot produce different output. It is idempotent and
 * returns a record with no withhold by identity, so the already-withheld
 * catalogue path pays nothing.
 */
export function scopeDifferentialRecord(record: DifferentialRecord): DifferentialRecord {
  return scopeRecordWith(withholdGeneratedBody(record, curatedEntryFor(record.slug)), presentationScopeIndex());
}

/** As {@link scopeDifferentialRecord}, for a presentation workflow's criteria. */
export function scopePresentationWorkflow(
  workflow: DifferentialPresentationWorkflow,
): DifferentialPresentationWorkflow {
  return {
    ...workflow,
    criteria: (workflow.criteria ?? []).map((criterion) => ({
      ...criterion,
      scope: DIAGNOSIS_SCOPED_SECTION_IDS.has(criterion.id) ? ("diagnosis" as const) : ("presentation" as const),
    })),
  };
}

function withPresentationScope(snapshot: DifferentialSnapshot): DifferentialSnapshot {
  const index = buildPresentationScopeIndex(snapshot);
  return {
    ...snapshot,
    presentations: snapshot.presentations.map(scopePresentationWorkflow),
    diagnoses: snapshot.diagnoses.map((record) => scopeRecordWith(record, index)),
  };
}

let scopedCatalog: DifferentialSnapshot | null = null;

function catalog(): DifferentialSnapshot {
  if (!scopedCatalog) scopedCatalog = withPresentationScope(loadDifferentialSnapshot());
  return scopedCatalog;
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

  return scopePresentationWorkflow({
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
  });
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
    description: presentation.scopeLabel ?? presentation.subtitle,
    examples: presentation.safetySnapshot.tags.slice(0, 3),
    href: `/differentials/presentations/${presentation.id}`,
  }),
);

export const differentialDiagnosesCards: DifferentialStreamCard[] = differentialRecords.map((record) => ({
  id: `diagnosis-${record.slug}`,
  title: record.title,
  description: diagnosisOwnSummary(record),
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

export const LEGACY_PRESENTATION_SLUG_ALIASES: Record<string, string> = {
  depression: "presentation-depression",
  "substance-intoxication": "presentation-substance-intoxication",
  "substance-withdrawal": "presentation-substance-withdrawal",
};

export function resolvePresentationSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  return LEGACY_PRESENTATION_SLUG_ALIASES[normalized] ?? normalized;
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
    // The subtitle is the fallback, not a nicety: a record that withheld its
    // generated body has no clinical hinge, and without a fallback every other
    // record's map would drop it, turning a reviewed link into an inert row.
    const relatedSubtitle = typeof related?.subtitle === "string" ? related.subtitle.trim() : "";
    const clinicalHinge =
      (typeof related?.clinicalHinge === "string" ? related.clinicalHinge.trim() : "") || relatedSubtitle;
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
      clinicalHingeScope: related.clinicalHingeScope,
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
    curated: withCuratedReview(record.slug),
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
// weight. Both caches are built lazily from the static snapshot (no invalidation needed).

let diagnosisTitleBySlugCache: Map<string, string> | null = null;

function diagnosisTitleBySlug(): Map<string, string> {
  diagnosisTitleBySlugCache ??= new Map(differentialRecords.map((record) => [record.slug, record.title]));
  return diagnosisTitleBySlugCache;
}

let presentationTitleTextBySlugCache: Map<string, string> | null = null;

/** Reverse index text: normalized titles of the snapshot presentations that list this
 *  diagnosis as a candidate, so a presentation-shaped query ("acute confusion") surfaces
 *  the differentials it works up. */
function presentationTitleTextForDiagnosis(slug: string): string {
  if (!presentationTitleTextBySlugCache) {
    presentationTitleTextBySlugCache = new Map();
    for (const workflow of differentialPresentations()) {
      const text = normalizeSearchText(`${workflow.title} ${workflow.id}`);
      for (const candidate of workflow.candidates) {
        const existing = presentationTitleTextBySlugCache.get(candidate.slug);
        presentationTitleTextBySlugCache.set(candidate.slug, existing ? `${existing} ${text}` : text);
      }
    }
  }
  return presentationTitleTextBySlugCache.get(slug) ?? "";
}

/** Forward index text: the candidate differentials' titles (falling back to de-hyphenated
 *  slugs for candidates outside the snapshot, e.g. owner-edited rows), so a diagnosis-shaped
 *  query ("wernicke") surfaces the presentations that work it up. Computed from the passed
 *  workflow so owner rows ranked via the differentials API get the same treatment. */
function candidateTitlesText(workflow: DifferentialPresentationWorkflow): string {
  const titles = diagnosisTitleBySlug();
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
  interpretNaturalLanguage = false,
): DifferentialRecordMatch[] {
  const interpretedExpansions = [
    ...expansions,
    ...(interpretNaturalLanguage ? smartSearchExpansions("differentials", query) : []),
  ];
  return rankCatalogRecords(records, query, {
    fields: [
      { id: "title", weight: 8, text: (record) => normalizeSearchText(`${record.title} ${record.slug}`) },
      { id: "hinge", weight: 3, text: diagnosisHingeText },
      // Cross-entity lane (kept out of fullText so it never earns the phrase/content
      // double-count): weight sits well below title/hinge, so a presentation-shaped query
      // surfaces the candidates without ever outranking a direct match; equal-score
      // candidates fall to the emergent-first tie-break below.
      { id: "presentations", weight: 2, text: (record) => presentationTitleTextForDiagnosis(record.slug) },
    ],
    fullText: diagnosisFullText,
    contentWeight: 2,
    compactBonus: 6,
    compactExtraText: (record) => normalizeSearchText(record.title),
    phraseBonus: 4,
    exactValues: (record) => [normalizeSearchText(record.title), normalizeSearchText(record.slug)],
    exactBonus: 10,
    expandTokens: interpretedExpansions.length
      ? (terms) => [...expandQueryTerms(terms), ...interpretedExpansions]
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
  return normalizeSearchText([workflow.scopeLabel, workflow.subtitle, ...workflow.safetySnapshot.tags].join(" "));
}

export function presentationFullText(workflow: DifferentialPresentationWorkflow) {
  return normalizeSearchText(
    [
      workflow.title,
      workflow.sourceTitle,
      workflow.scopeLabel,
      ...(workflow.titleAliases ?? []),
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
): DifferentialPresentationMatch[] {
  return rankCatalogRecords(workflows, query, {
    fields: [
      {
        id: "title",
        weight: 8,
        text: (workflow) =>
          normalizeSearchText(
            [workflow.title, workflow.sourceTitle, ...(workflow.titleAliases ?? []), workflow.id].join(" "),
          ),
      },
      { id: "safety", weight: 4, text: presentationSafetyText },
      // Cross-entity lane (see rankDifferentialRecords' "presentations" field): the candidate
      // differentials' titles, so a diagnosis-shaped query surfaces the presentations that
      // work it up without outranking the diagnosis's own record.
      { id: "candidates", weight: 2, text: candidateTitlesText },
    ],
    fullText: presentationFullText,
    contentWeight: 2,
    compactBonus: 6,
    compactExtraText: (workflow) =>
      normalizeSearchText([workflow.title, workflow.sourceTitle, ...(workflow.titleAliases ?? [])].join(" ")),
    phraseBonus: 4,
    exactValues: (workflow) =>
      [workflow.title, workflow.sourceTitle, ...(workflow.titleAliases ?? []), workflow.id]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(normalizeSearchText),
    exactBonus: 10,
    expandTokens: expansions.length ? (terms) => [...expandQueryTerms(terms), ...expansions] : expandQueryTerms,
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

/** The record's authored overlay with its clinician sign-off attached, when there is one. */
function withCuratedReview(slug: string) {
  const entry = curatedEntryFor(slug);
  if (!entry) return null;
  const review = curatedReviewFor(slug);
  return review ? { ...entry, review } : entry;
}
