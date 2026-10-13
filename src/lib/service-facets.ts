import type { CatalogServiceTags } from "@/lib/service-catalog";
import type { ServiceRecord } from "@/lib/services";

/**
 * The six dimensions that accumulate (OR within the dimension, AND across
 * dimensions) — see docs/filter-contract.md section 1.
 *
 * `substance_flags` is deliberately excluded: measured 2026-08-12 against
 * `loadServicesSnapshot()`, all 219 services carry exactly one value
 * (`general` 148 + `aod` 71 = 219) — an exact partition, not an accumulating
 * constraint. Rendering it as a facet would claim a service can be both,
 * which the data says it cannot. It is a lens instead; see
 * `substanceLensOptions` / `matchesSubstanceLens` below.
 *
 * `specialist_groups` comes from the governed canonical overlay and captures
 * pathway-specific cohorts such as child/youth, Aboriginal and Torres Strait
 * Islander, perinatal, eating-disorder and family/carer services. It is an
 * accumulating facet rather than a broad shortcut group because services can
 * legitimately carry several specialist-group values at once.
 *
 * `housing_flags` stays a facet despite being a near-partition (215 of 219
 * carry exactly one) — 4 carry two, and a lens would misrepresent those four.
 * Near-partition is not partition.
 */
export const serviceFacetDimensions = [
  "catchments",
  "age_groups",
  "setting_flags",
  "acuity_flags",
  "specialist_groups",
  "housing_flags",
] as const;

export type ServiceFacetDimension = (typeof serviceFacetDimensions)[number];

export const serviceFacetDimensionLabels: Record<ServiceFacetDimension, string> = {
  catchments: "Catchment",
  age_groups: "Age group",
  setting_flags: "Setting",
  acuity_flags: "Acuity",
  specialist_groups: "Specialist pathway",
  housing_flags: "Housing",
};

/**
 * Value labels per dimension, not one global map. `general` appears in three
 * different dimensions with three different meanings (see the module-level
 * note on `serviceFacetDimensions`), so a single value -> label table would
 * either collide or need the same disambiguating qualifier repeated for
 * every context. Catchment names (`region_catchment`-derived, e.g.
 * "NMHS/North Metro") are already human-readable and unmapped.
 */
const dimensionValueLabels: Record<Exclude<ServiceFacetDimension, "catchments">, Record<string, string>> = {
  age_groups: {
    adult: "Adult",
    older_adult: "Older adult",
    young_adult: "Young adult",
    youth: "Youth",
    mixed: "Mixed ages",
  },
  setting_flags: {
    community: "Community",
    digital_phone: "Digital / phone",
    general: "General",
    hospital_residential: "Hospital / residential",
    public: "Public",
  },
  acuity_flags: {
    crisis_high: "Crisis / urgent",
    high: "High acuity",
    moderate: "Moderate acuity",
    supportive: "Supportive",
  },
  specialist_groups: {},
  housing_flags: {
    general: "General",
    home_based: "Home-based",
    housing_support: "Housing support",
  },
};

const substanceLensValueLabels: Record<string, string> = {
  general: "General (not AOD-specific)",
  aod: "Alcohol & other drugs",
};

function humanizeToken(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Falls back to a humanized token so an unmapped catalogue value stays
 *  readable instead of breaking — the derive-from-data rule means new
 *  values can appear without a code change on the catalogue side. */
export function serviceFacetValueLabel(dimension: ServiceFacetDimension, value: string): string {
  if (dimension === "catchments") return value;
  return dimensionValueLabels[dimension][value] ?? humanizeToken(value);
}

/**
 * Plain words for a raw catalogue tag shown on its own, outside any facet
 * dimension (the service record's tag list). Returns the existing label only
 * when exactly one dimension map above carries the token; returns `null` for
 * any other machine token (snake_case, slug-style or bare lower-case words
 * such as `general`, whose meaning depends on a dimension
 * the flat list no longer carries) so the caller hides it instead of printing
 * computer wording. Human-written tags ("Regional WA") pass through unchanged.
 * No new wording is made up here — unmapped tokens such as specialist-group
 * ids are hidden, never humanised.
 */
export function serviceTagDisplayLabel(tag: string): string | null {
  const value = tag.trim();
  if (!value) return null;
  if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(value)) return value;
  const labels = Object.values(dimensionValueLabels)
    .map((map) => map[value])
    .filter((label): label is string => Boolean(label));
  return labels.length === 1 ? labels[0]! : null;
}

export function serviceSubstanceLensValueLabel(value: string): string {
  if (value === "all") return "All programs";
  return substanceLensValueLabels[value] ?? humanizeToken(value);
}

export type ServiceFacetSelection = Readonly<Record<ServiceFacetDimension, ReadonlySet<string>>>;

type NormalizedServiceCatalogTags = Omit<CatalogServiceTags, "specialist_groups"> & {
  specialist_groups: string[];
};

export function emptyServiceFacetSelection(): ServiceFacetSelection {
  return {
    catchments: new Set(),
    age_groups: new Set(),
    setting_flags: new Set(),
    acuity_flags: new Set(),
    specialist_groups: new Set(),
    housing_flags: new Set(),
  };
}

export function serviceFacetSelectionSize(selection: ServiceFacetSelection): number {
  return serviceFacetDimensions.reduce((total, dimension) => total + selection[dimension].size, 0);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => entry.length > 0);
}

/**
 * The typed tag dimensions for one service, parsed once here rather than at
 * every call site — `ServiceRecord.catalogPayload` is `Record<string,
 * unknown>` because it is shared with forms, whose payload shape is
 * unrelated. Missing/malformed data reads as "no tags in that dimension"
 * rather than throwing, matching `normalizeCatalogService`'s own tolerance
 * for a catalogue row that failed to parse.
 */
export function serviceCatalogTags(record: ServiceRecord): NormalizedServiceCatalogTags {
  const raw = record.catalogPayload?.tags;
  const tagsSource = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    catchments: toStringArray(tagsSource.catchments),
    age_groups: toStringArray(tagsSource.age_groups),
    setting_flags: toStringArray(tagsSource.setting_flags),
    acuity_flags: toStringArray(tagsSource.acuity_flags),
    substance_flags: toStringArray(tagsSource.substance_flags),
    specialist_groups: toStringArray(tagsSource.specialist_groups),
    housing_flags: toStringArray(tagsSource.housing_flags),
  };
}

/**
 * Legacy or owner-authored records can predate the typed facet contract. With
 * no facet metadata, a selection cannot establish that the record fails, so
 * keep it visible rather than silently dropping it from the catalogue.
 */
export function serviceHasFacetMetadata(record: ServiceRecord): boolean {
  const tags = serviceCatalogTags(record);
  return serviceFacetDimensions.some((dimension) => tags[dimension].length > 0) || tags.substance_flags.length > 0;
}

/** No constraint means "no facet selection at all" — matches everything. */
export function matchesServiceFacets(record: ServiceRecord, selection: ServiceFacetSelection): boolean {
  const tags = serviceCatalogTags(record);
  if (!serviceHasFacetMetadata(record)) return true;
  return serviceFacetDimensions.every((dimension) => {
    const selected = selection[dimension];
    if (selected.size === 0) return true;
    return tags[dimension].some((value) => selected.has(value));
  });
}

/** `"all"` imposes no constraint; any other value must be carried exactly. */
export function matchesSubstanceLens(record: ServiceRecord, lens: string): boolean {
  if (lens === "all") return true;
  if (!serviceHasFacetMetadata(record)) return true;
  return serviceCatalogTags(record).substance_flags.includes(lens);
}

export function filterServicesByFacets(
  records: readonly ServiceRecord[],
  selection: ServiceFacetSelection,
  substanceLens: string,
): ServiceRecord[] {
  return records.filter(
    (record) => matchesServiceFacets(record, selection) && matchesSubstanceLens(record, substanceLens),
  );
}

/**
 * The values a dimension actually carries across `records` — never a
 * declared taxonomy. Derive, don't declare (docs/filter-contract.md section
 * 3): a value nothing in `records` carries would be a permanently empty
 * option, and the union-count contract cannot distinguish a permanently
 * empty option from a full one.
 */
export function deriveServiceFacetOptions(
  records: readonly ServiceRecord[],
  dimension: ServiceFacetDimension,
): string[] {
  const values = new Set<string>();
  for (const record of records) {
    for (const value of serviceCatalogTags(record)[dimension]) values.add(value);
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function deriveSubstanceLensOptions(records: readonly ServiceRecord[]): string[] {
  const values = new Set<string>();
  for (const record of records) {
    for (const value of serviceCatalogTags(record).substance_flags) values.add(value);
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

/**
 * "How many would I have if I ticked this as well" — the same predicate as
 * the filter, run with the candidate value added to `dimension`. Under
 * OR-within-dimension, adding a value to a dimension that already has a
 * selection WIDENS that dimension, so a count derived by narrowing the
 * current subset would disagree with what the click actually does. See
 * docs/filter-contract.md section 3 and `projectSmartTagFacetGroups` in
 * document-tags.ts, the reference implementation this mirrors.
 */
export function serviceFacetOptionCount(
  records: readonly ServiceRecord[],
  selection: ServiceFacetSelection,
  substanceLens: string,
  dimension: ServiceFacetDimension,
  value: string,
): number {
  if (selection[dimension].has(value)) {
    return filterServicesByFacets(records, selection, substanceLens).length;
  }
  const widened: ServiceFacetSelection = {
    ...selection,
    [dimension]: new Set([...selection[dimension], value]),
  };
  return filterServicesByFacets(records, widened, substanceLens).length;
}

/**
 * The lens replaces rather than accumulates, so its count is a plain
 * narrowing — "how many if this were the active lens value" — not a union.
 */
export function serviceSubstanceLensOptionCount(
  records: readonly ServiceRecord[],
  selection: ServiceFacetSelection,
  value: string,
): number {
  return filterServicesByFacets(records, selection, value).length;
}

/** Read-only slice of `URLSearchParams` — also matches Next's
 *  `ReadonlyURLSearchParams`, so a page can pass either. */
type ReadableSearchParams = { get(key: string): string | null };

/**
 * URL round-trip for facet selection, alongside services' existing `q` /
 * `group` params. Comma-joined per dimension (`?catchments=Metro-wide,Peel`)
 * rather than one param per value, matching how a reader would expect to
 * share or bookmark a filtered URL without it growing one query key per tick.
 */
export function serviceFacetSelectionFromParams(params: ReadableSearchParams): ServiceFacetSelection {
  const read = (dimension: ServiceFacetDimension) =>
    new Set(
      (params.get(dimension) ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          try {
            return decodeURIComponent(value);
          } catch {
            return value;
          }
        }),
    );
  return {
    catchments: read("catchments"),
    age_groups: read("age_groups"),
    setting_flags: read("setting_flags"),
    acuity_flags: read("acuity_flags"),
    specialist_groups: read("specialist_groups"),
    housing_flags: read("housing_flags"),
  };
}

export function writeServiceFacetSelectionToParams(params: URLSearchParams, selection: ServiceFacetSelection): void {
  for (const dimension of serviceFacetDimensions) {
    const values = [...selection[dimension]];
    if (values.length > 0) params.set(dimension, values.map((value) => encodeURIComponent(value)).join(","));
    else params.delete(dimension);
  }
}
