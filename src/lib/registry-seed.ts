import { formRecords } from "@/lib/forms";
import { invalidateOwnerCatalogueCache } from "@/lib/owner-catalogue-cache";
import { buildDefaultFormRows, buildDefaultServiceRows, defaultServiceRecords } from "@/lib/registry-fixtures";
import {
  deriveGovernanceColumns,
  normalizeRegistrySlug,
  rowGovernance,
  rowToServiceRecord,
  type RegistryRecordInsert,
  type RegistryRecordKind,
  type RegistryRecordRow,
} from "@/lib/registry-records";
import type { ServiceRecord } from "@/lib/services";

// Type-only reference to the admin client so this module carries no runtime
// dependency on the Supabase admin singleton — the CLI can import the row
// builders without pulling in service-role env, and callers pass their own
// client into `ensureRegistrySeeded`.
type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

type OwnerRegistryFetchOptions = {
  signal?: AbortSignal;
  select?: string;
};

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

/** The curated shared registry fixtures for a kind — the same baseline the CLI
 *  can materialize and every API caller receives automatically. */
export function defaultRegistryRecords(kind: RegistryRecordKind) {
  return kind === "form" ? formRecords : defaultServiceRecords();
}

/** Build insertable rows for an owner from the shared fixtures. Used by
 *  explicit operator seeding; GET requests do not materialize catalogue rows. */
export function buildDefaultRegistryRows(ownerId: string, kind: RegistryRecordKind): RegistryRecordInsert[] {
  return kind === "form" ? buildDefaultFormRows(ownerId) : buildDefaultServiceRows(ownerId);
}

/**
 * Merge private owner records over the reviewed shared catalogue. The bundled
 * catalogue is the baseline product content and is therefore available to
 * every caller; owner rows are optional overrides/additions, never a gate on
 * seeing the baseline. This avoids copying the same catalogue into every new
 * account while preserving existing owner-specific edits.
 */
export function mergeRegistryRecordsWithDefaults(
  kind: RegistryRecordKind,
  ownerRows: RegistryRecordRow[],
): ServiceRecord[] {
  const defaults = defaultRegistryRecords(kind);
  const ownerBySlug = new Map(ownerRows.map((row) => [normalizeRegistrySlug(row.slug), row] as const));
  const defaultSlugs = new Set(defaults.map((record) => normalizeRegistrySlug(record.slug)));
  const merged = defaults.map((record) => {
    const ownerRow = ownerBySlug.get(normalizeRegistrySlug(record.slug));
    return ownerRow ? mergeRegistryRecordWithDefault(kind, ownerRow) : record;
  });
  const ownerAdditions = ownerRows
    .filter((row) => !defaultSlugs.has(normalizeRegistrySlug(row.slug)))
    .map(rowToServiceRecord)
    .sort((left, right) => left.title.localeCompare(right.title));
  return [...merged, ...ownerAdditions];
}

/** Merge one owner row over its shared baseline using the raw database nulls.
 *  A null means the owner has not supplied that field, while explicit empty
 *  arrays remain valid overrides. Structured objects are merged so partial
 *  owner metadata cannot hide reviewed source/catalogue fields. */
export function mergeRegistryRecordWithDefault(kind: RegistryRecordKind, row: RegistryRecordRow): ServiceRecord {
  const ownerRecord = rowToServiceRecord(row);
  const baseline = defaultRegistryRecords(kind).find(
    (record) => normalizeRegistrySlug(record.slug) === normalizeRegistrySlug(row.slug),
  );
  if (!baseline) return ownerRecord;

  const merged: ServiceRecord = { ...baseline, slug: ownerRecord.slug, title: ownerRecord.title };
  const apply = <Key extends keyof ServiceRecord>(key: Key, value: ServiceRecord[Key], stored: unknown) => {
    if (stored !== null) merged[key] = value;
  };

  apply("subtitle", ownerRecord.subtitle, row.subtitle);
  apply("statusChips", ownerRecord.statusChips, row.status_chips);
  apply("contacts", ownerRecord.contacts, row.contacts);
  apply("route", ownerRecord.route, row.route);
  apply("eligibility", ownerRecord.eligibility, row.eligibility);
  apply("cost", ownerRecord.cost, row.cost);
  apply("referral", ownerRecord.referral, row.referral);
  apply("location", ownerRecord.location, row.location);
  // summaryCards are catalogue-derived for forms (generated from catalog data, not owner-editable).
  // Always use the baseline's cards so that catalogue updates (e.g. new condensed priority-fact
  // cards) are visible to pre-seeded owners whose stored rows carry the old full-length layout.
  if (kind !== "form") apply("summaryCards", ownerRecord.summaryCards, row.summary_cards);
  apply("referralInfo", ownerRecord.referralInfo, row.referral_info);
  apply("bestUse", ownerRecord.bestUse, row.best_use);
  apply("criteria", ownerRecord.criteria, row.criteria);
  apply("tags", ownerRecord.tags, row.tags);
  apply("catchments", ownerRecord.catchments, row.catchments);
  apply("catalogueLabel", ownerRecord.catalogueLabel, row.catalogue_label);
  apply("navigatorQuery", ownerRecord.navigatorQuery, row.navigator_query);

  if (row.primary_contact !== null) {
    merged.primaryContact = {
      ...(baseline.primaryContact ?? {}),
      ...(ownerRecord.primaryContact ?? {}),
    } as NonNullable<ServiceRecord["primaryContact"]>;
  }
  if (row.verification !== null) {
    merged.verification = { ...(baseline.verification ?? {}), ...(ownerRecord.verification ?? {}) };
  }
  if (row.source !== null) {
    merged.source = { ...(baseline.source ?? {}), ...(ownerRecord.source ?? {}) } as NonNullable<
      ServiceRecord["source"]
    >;
  }
  if (row.catalog_payload !== null) {
    const catalogPayload = { ...(baseline.catalogPayload ?? {}), ...(ownerRecord.catalogPayload ?? {}) };
    if (kind === "service") {
      const tags = catalogPayload.tags;
      merged.catalogPayload = typeof tags === "object" && tags !== null ? { tags } : {};
    } else {
      merged.catalogPayload = catalogPayload;
    }
  }

  return merged;
}

export function mergeRegistryGovernanceWithDefaults(kind: RegistryRecordKind, ownerRows: RegistryRecordRow[]) {
  const governance: Record<string, ReturnType<typeof rowGovernance>> = Object.fromEntries(
    defaultRegistryRecords(kind).map((record) => {
      const derived = deriveGovernanceColumns(record);
      return [
        normalizeRegistrySlug(record.slug),
        {
          sourceStatus: derived.source_status,
          validationStatus: derived.validation_status,
          lastReviewedAt: null,
          reviewDueAt: null,
        },
      ];
    }),
  );
  for (const row of ownerRows) governance[normalizeRegistrySlug(row.slug)] = rowGovernance(row);
  return governance;
}

/**
 * Idempotently seed the curated default registry records for an owner + kind
 * and return the stored rows. This is an explicit operator/maintenance action;
 * normal reads merge the shared fixtures in-memory and perform no seed write.
 * Safe under concurrent requests — the (owner_id, kind, slug) conflict target
 * dedupes the upsert.
 *
 * Missing-fixture helper: conflicts are ignored so a catalogue expansion can
 * add newly published forms without overwriting owner edits or reviewed
 * governance on records already present.
 */
export async function ensureRegistrySeeded(
  supabase: AdminClient,
  ownerId: string,
  kind: RegistryRecordKind,
  options: Pick<OwnerRegistryFetchOptions, "signal"> = {},
): Promise<RegistryRecordRow[]> {
  const rows = buildDefaultRegistryRows(ownerId, kind);
  let query = supabase
    .from("clinical_registry_records")
    .upsert(rows, { onConflict: "owner_id,kind,slug", ignoreDuplicates: true })
    .select("*");
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw new Error(`Registry seed failed: ${error.message}`);
  invalidateOwnerCatalogueCache({ ownerId, kind, preserveSignal: options.signal });
  throwIfAborted(options.signal);
  return (data ?? []) as RegistryRecordRow[];
}

/**
 * Fetch only an owner's private registry overrides/additions. Shared catalogue
 * defaults are merged by callers and are never materialized as a side effect
 * of a GET request.
 */
export async function fetchOwnerRegistryRows(
  supabase: AdminClient,
  ownerId: string,
  kind: RegistryRecordKind,
  maxRecords = 500,
  options: OwnerRegistryFetchOptions = {},
): Promise<RegistryRecordRow[]> {
  let query = supabase
    .from("clinical_registry_records")
    .select(options.select ?? "*")
    .eq("owner_id", ownerId)
    .eq("kind", kind)
    .order("title")
    .limit(maxRecords);
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  throwIfAborted(options.signal);
  // The optional projection is intentionally narrower than the generated
  // table Row type; callers map only the fields they requested.
  return (data ?? []) as unknown as RegistryRecordRow[];
}
