import type { AppModeId } from "@/lib/app-modes";
import type {
  ClinicalSourceCatalogueEntry,
  ClinicalSourceClientEntry,
  ClinicalSourceReferenceInput,
  ClinicalSourceType,
  SourceCatalogueFilters,
  SourceGeographyScope,
  SourceLifecycleStatus,
  SourceQualityBand,
} from "@/lib/sources/catalogue-types";

export type ReadableSearchParams = Pick<URLSearchParams, "get" | "getAll">;

/**
 * How many sources one catalogue page carries.
 *
 * The catalogue is sliced on the server, before the entries cross the RSC
 * boundary, for the reason `ReviewStatePageContent` records: slicing in the
 * client after the whole array has already been serialised does not reduce
 * anything that was transferred. 50 matches `REVIEW_STATE_PAGE_SIZE`, which is
 * the size this repository has already proven renders responsively.
 */
export const SOURCE_CATALOGUE_PAGE_SIZE = 50;
const BAND_ORDER = { A: 0, B: 1, C: 2, D: 3, excluded: 4 } as const;

/** Shared with `browse-facets.ts` so a facet list cannot order itself differently
    from the catalogue it links into. */
const CATALOGUE_MONTH_FORMAT = new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric" });
const BASE_COLLATOR = new Intl.Collator("en-AU", { sensitivity: "base" });
const FULL_COLLATOR = new Intl.Collator("en-AU");

export function compareText(left: string, right: string) {
  return BASE_COLLATOR.compare(left, right) || FULL_COLLATOR.compare(left, right);
}

/** The catalogue's own quality order. Exported so the browse summaries pick the
    same lead source the catalogue would list first. */
export function compareQuality(left: ClinicalSourceClientEntry, right: ClinicalSourceClientEntry) {
  return (
    BAND_ORDER[left.rating.band] - BAND_ORDER[right.rating.band] ||
    right.rating.score - left.rating.score ||
    right.rating.dimensions.australianApplicability - left.rating.dimensions.australianApplicability ||
    right.rating.dimensions.currency - left.rating.dimensions.currency ||
    compareText(left.title, right.title) ||
    compareText(left.id, right.id)
  );
}

function valuesFrom(params: ReadableSearchParams, key: string) {
  return params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function uniqueKnown<T extends string>(values: readonly string[], known: ReadonlySet<T>): T[] {
  return [...new Set(values.filter((value): value is T => known.has(value as T)))];
}

function presentValues<T extends string>(values: readonly (T | null)[]) {
  return new Set(values.filter((value): value is T => Boolean(value)));
}

export function parseSourceCatalogueFilters(
  params: ReadableSearchParams,
  entries: readonly ClinicalSourceClientEntry[],
): SourceCatalogueFilters {
  const sortValue = params.get("sort");
  return {
    q: (params.get("q") ?? "").trim(),
    bands: uniqueKnown<SourceQualityBand>(
      valuesFrom(params, "band"),
      presentValues(entries.map((entry) => entry.rating.band)),
    ),
    jurisdictions: uniqueKnown<SourceGeographyScope>(
      valuesFrom(params, "jurisdiction"),
      presentValues(entries.map((entry) => entry.geography.scope)),
    ),
    sourceTypes: uniqueKnown<ClinicalSourceType>(
      valuesFrom(params, "type"),
      presentValues(entries.map((entry) => entry.sourceType)),
    ),
    publishers: uniqueKnown(valuesFrom(params, "publisher"), presentValues(entries.map((entry) => entry.publisher))),
    topics: uniqueKnown(valuesFrom(params, "topic"), presentValues(entries.flatMap((entry) => entry.topics))),
    lifecycleStatuses: uniqueKnown<SourceLifecycleStatus>(
      valuesFrom(params, "lifecycle"),
      presentValues(entries.map((entry) => entry.lifecycleStatus)),
    ),
    documentStatuses: uniqueKnown<ClinicalSourceReferenceInput["documentStatus"]>(
      valuesFrom(params, "status"),
      presentValues(entries.map((entry) => entry.documentStatus)),
    ),
    validationStatuses: uniqueKnown<ClinicalSourceReferenceInput["validationStatus"]>(
      valuesFrom(params, "validation"),
      presentValues(entries.map((entry) => entry.validationStatus)),
    ),
    usedBy: uniqueKnown<AppModeId>(
      valuesFrom(params, "usedBy"),
      presentValues(entries.flatMap((entry) => entry.usedBy.map((usage) => usage.modeId))),
    ),
    sort: sortValue === "title" || sortValue === "currency" ? sortValue : "quality",
  };
}

/**
 * Exported so the browse surfaces narrow on exactly the terms the catalogue matches.
 * Punctuation becomes a space, so "ADHD?" searches for "adhd" and "5-HT" matches "5 HT".
 */
export function normalizeSearchValue(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-AU")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether `needle` occurs in `text` starting at a word, so "tics" finds "tics" and "tic
 * disorders" but not "statistics" or "ethics". Both arguments must already be normalised.
 */
export function matchesAtWordStart(text: string, needle: string) {
  for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
    if (index === 0 || /\s/.test(text[index - 1] ?? "")) return true;
  }
  return false;
}

function matchesAny<T>(selection: readonly T[], values: readonly T[]) {
  return selection.length === 0 || values.some((value) => selection.includes(value));
}

function matchesFilters(entry: ClinicalSourceClientEntry, filters: SourceCatalogueFilters) {
  const query = normalizeSearchValue(filters.q);
  if (
    query &&
    ![entry.title, ...entry.aliases, entry.publisher ?? "", ...entry.topics]
      .map(normalizeSearchValue)
      .some((value) => matchesAtWordStart(value, query))
  ) {
    return false;
  }
  if (!matchesAny(filters.bands, [entry.rating.band])) return false;
  if (!matchesAny(filters.jurisdictions, [entry.geography.scope])) return false;
  if (!matchesAny(filters.sourceTypes, [entry.sourceType])) return false;
  if (!matchesAny(filters.publishers, entry.publisher ? [entry.publisher] : [])) return false;
  if (!matchesAny(filters.topics, entry.topics)) return false;
  if (!matchesAny(filters.lifecycleStatuses, [entry.lifecycleStatus])) return false;
  if (!matchesAny(filters.documentStatuses, [entry.documentStatus])) return false;
  if (!matchesAny(filters.validationStatuses, [entry.validationStatus])) return false;
  if (
    !matchesAny(
      filters.usedBy,
      entry.usedBy.map((usage) => usage.modeId),
    )
  )
    return false;
  return true;
}

function dateValue(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

// Expiry is not a candidate, matching latestKnownDate in browse-facets: a far-future expiry
// does not make a source more recent than one reviewed last month.
function mostRecentDate(entry: ClinicalSourceClientEntry) {
  return Math.max(dateValue(entry.publicationDate), dateValue(entry.reviewDate), dateValue(entry.lastUpdatedDate));
}

export function filterAndSortSourceCatalogue(
  entries: readonly ClinicalSourceClientEntry[],
  filters: SourceCatalogueFilters,
) {
  const filtered = entries.filter((entry) => matchesFilters(entry, filters));
  return filtered.sort((left, right) => {
    if (filters.sort === "title") {
      return compareText(left.title, right.title) || compareText(left.id, right.id);
    }
    if (filters.sort === "currency") {
      return (
        right.rating.dimensions.currency - left.rating.dimensions.currency ||
        mostRecentDate(right) - mostRecentDate(left) ||
        compareQuality(left, right)
      );
    }
    return compareQuality(left, right);
  });
}

function countValues(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => compareText(left.value, right.value));
}

/**
 * A catalogue date rendered as its own month.
 *
 * A recorded date here is a calendar date, not an instant, and `Date.parse`
 * reads a bare `YYYY-MM-DD` as UTC midnight. Formatting that in a timezone west
 * of UTC moves it back a day — `2026-01-01` renders as "Dec 2025" in
 * America/Los_Angeles, and differently in the browser than on the server that
 * rendered it. Parsing it as local midnight keeps the recorded month stable
 * wherever it is read.
 */
export function formatCatalogueMonth(value: string | null): string | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return CATALOGUE_MONTH_FORMAT.format(date);
}

/**
 * Drop the two rating fields nothing renders before the catalogue crosses to the
 * browser: `weights` is the `SOURCE_RATING_WEIGHTS` constant repeated on every
 * entry, and `reasons` restates `dimensions` as prose. Both remain on the
 * server-side record. Every other field is passed through unchanged, so nothing a
 * page displays, filters or sorts by is affected.
 */
export function projectSourceCatalogueForClient(
  entries: readonly ClinicalSourceCatalogueEntry[],
): ClinicalSourceClientEntry[] {
  // Built field by field rather than by omission, so adding a field to
  // `ClinicalSourceRating` fails this function's return type instead of silently
  // widening what the browser receives.
  return entries.map((entry) => ({
    ...entry,
    rating: {
      score: entry.rating.score,
      band: entry.rating.band,
      dimensions: entry.rating.dimensions,
    },
  }));
}

/** The four narrowing dimensions the filter sheet offers. */
export type SourceCatalogueFacetKey = "band" | "jurisdiction" | "topic" | "usedBy";

export type SourceCatalogueFacetOptionCount = { value: string; count: number };

export type SourceCatalogueFacetCounts = Record<SourceCatalogueFacetKey, SourceCatalogueFacetOptionCount[]>;

const FACET_SELECTION_FIELD = {
  band: "bands",
  jurisdiction: "jurisdictions",
  topic: "topics",
  usedBy: "usedBy",
} as const satisfies Record<SourceCatalogueFacetKey, keyof SourceCatalogueFilters>;

function facetValuesOf(entry: ClinicalSourceClientEntry, key: SourceCatalogueFacetKey): readonly string[] {
  if (key === "band") return [entry.rating.band];
  if (key === "jurisdiction") return [entry.geography.scope];
  if (key === "topic") return entry.topics;
  return entry.usedBy.map((usage) => usage.modeId);
}

/** Option order as the filter sheet has always shown it: base-collated, deduplicated. */
function uniqueSortedFacetValues(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => BASE_COLLATOR.compare(left, right));
}

/**
 * Every filter option, with the number of sources it would leave visible.
 *
 * This used to run in the browser, once per option per render, over all 866
 * entries — which is the other half of why the whole catalogue had to be
 * serialised to the client. The counts are derived here instead, from the full
 * catalogue the server already holds, and only the resulting `{value, count}`
 * pairs travel.
 *
 * The count is the union-widening one the sheet has always shown: "how many
 * sources would be visible if this option were ticked as well". Narrowing the
 * candidate set once per facet, rather than re-running every filter for every
 * option, is an optimisation only — `tests/source-catalogue-pagination.test.ts`
 * pins it against the naive definition.
 */
export function deriveSourceCatalogueFacetCounts(
  entries: readonly ClinicalSourceClientEntry[],
  filters: SourceCatalogueFilters,
): SourceCatalogueFacetCounts {
  const counts = {} as SourceCatalogueFacetCounts;
  for (const key of ["band", "jurisdiction", "topic", "usedBy"] as const) {
    const selected: readonly string[] = filters[FACET_SELECTION_FIELD[key]];
    // Everything the other filters admit. A facet never narrows its own option
    // counts, so this candidate set is shared by all of that facet's options.
    const withoutFacet: SourceCatalogueFilters = {
      ...filters,
      ...(key === "band"
        ? { bands: [] }
        : key === "jurisdiction"
          ? { jurisdictions: [] }
          : key === "topic"
            ? { topics: [] }
            : { usedBy: [] }),
    };
    const candidates = entries.filter((entry) => matchesFilters(entry, withoutFacet));
    counts[key] = uniqueSortedFacetValues(entries.flatMap((entry) => facetValuesOf(entry, key))).map((value) => {
      const widened = selected.includes(value) ? selected : [...selected, value];
      return {
        value,
        count: candidates.filter((entry) => matchesAny(widened, facetValuesOf(entry, key))).length,
      };
    });
  }
  return counts;
}

export function deriveSourceCatalogueFacets(entries: readonly ClinicalSourceClientEntry[]) {
  return {
    total: entries.length,
    australian: entries.filter(
      (entry) => entry.geography.scope !== "international" && entry.geography.scope !== "unknown",
    ).length,
    reviewRequired: entries.filter((entry) => entry.rating.band === "D").length,
    inactiveOrExcluded: entries.filter((entry) => entry.lifecycleStatus !== "active").length,
    topics: countValues(entries.flatMap((entry) => entry.topics)),
    publishers: countValues(entries.map((entry) => entry.publisher).filter((value): value is string => Boolean(value))),
  };
}
