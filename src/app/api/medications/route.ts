import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { fixtureResponseHeaders } from "@/lib/fixture-response-cache";
import { jsonError } from "@/lib/http";
import { defaultMedicationRecords } from "@/lib/medication-seed";
import { medicationAliasesForEntity } from "@/lib/medication-entities";
import { publicMedicationGovernance } from "@/lib/medication-records";
import { medicationCatalogInterpretation, searchMedicationCatalog } from "@/lib/medication-query";
import {
  medicationBrandNames,
  medicationToSearchResult,
  normalizeSearchText,
  type MedicationRecord,
  type MedicationSearchMatch,
} from "@/lib/medications";
import { publicCatalogueAccessContext } from "@/lib/public-api-access";
import {
  catalogueListFallbackBudgetMs,
  catalogueListScope,
  readCatalogueWithSeedFallback,
} from "@/lib/site-content/catalogue-seed-fallback";
import {
  canonicalSiteContentGovernance,
  readCanonicalSiteContentRecords,
} from "@/lib/site-content/site-content-publication";
import { smartSearchExpansions } from "@/lib/smart-search-intent";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseRequestQuery, queryInteger } from "@/lib/validation/query";

export const runtime = "nodejs";

const medicationListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    // Matches the Answer/Documents search bound (api/search), so a pasted vignette searches instead of failing.
    .max(2000)
    .optional()
    .transform((value) => (value ? value : undefined)),
  limit: queryInteger({ fallback: 50, min: 1, max: 100 }),
  fields: z.enum(["index"]).optional(),
});

// `fields=index` strips the heavy per-record content (stats/sections/quick are
// ~99% of the ~3.4 MB catalog) for callers that only need identity-level
// ranking, e.g. the answer surface's cross-mode links. Brand Names rows are
// retained so prescription-name search still scores at name weight.
function brandIdentitySections(record: MedicationRecord): MedicationRecord["sections"] {
  const brands = medicationBrandNames(record);
  if (!brands.length) return [];
  return [
    {
      title: "Formulation & Access",
      type: "form",
      rows: [{ key: "Brand Names", val: brands.join(", ") }],
    },
  ];
}

function toIndexRecords(records: MedicationRecord[]): MedicationRecord[] {
  return records.map((record) => ({
    slug: record.slug,
    name: record.name,
    class: record.class,
    subclass: record.subclass,
    category: record.category,
    accent: record.accent,
    tag: record.tag,
    schedule: record.schedule,
    stats: [],
    sections: brandIdentitySections(record),
    quick: [],
  }));
}

function rankCatalogMatches(records: MedicationRecord[], q: string, limit: number, projectIndex = false) {
  const smartExpansions = smartSearchExpansions("prescribing", q);
  const { matches, analysis } = searchMedicationCatalog(records, q, limit, smartExpansions);
  // Rank on full records for vocabulary, but serialize the slim identity shape
  // when fields=index so matches do not reintroduce stats/sections/quick.
  const serialized = projectIndex
    ? matches.map((match) => ({
        ...match,
        medication: toIndexRecords([match.medication])[0]!,
      }))
    : matches;
  return {
    matches: matchesPayload(serialized, smartExpansions.length > 0, analysis.correctedQuery),
    interpretation: medicationCatalogInterpretation(analysis),
  };
}

function medicationResponse(payload: Record<string, unknown>, options: { request?: Request; fixture?: boolean } = {}) {
  return NextResponse.json(payload, { headers: fixtureResponseHeaders(options.request, options) });
}

function queryIncludesMedicationIdentity(query: string, medication: MedicationRecord) {
  const normalizedQuery = ` ${normalizeSearchText(query)} `;
  const directIdentities = [medication.name, medication.slug.replace(/-/g, " "), ...medicationBrandNames(medication)];
  const identities = [...directIdentities, ...directIdentities.flatMap(medicationAliasesForEntity)];
  return identities.some((identity) => {
    const normalizedIdentity = normalizeSearchText(identity);
    return normalizedIdentity.length > 0 && normalizedQuery.includes(` ${normalizedIdentity} `);
  });
}

function matchesPayload(matches: MedicationSearchMatch[], rankingOnly = false, query = "") {
  return matches.map((match) => {
    const hasLiteralIdentityMatch = queryIncludesMedicationIdentity(query, match.medication);
    return {
      medication: match.medication,
      // Smart aliases may improve retrieval order, but Smart-only relevance
      // must not be interpreted outwardly as evidence of medication suitability.
      result: medicationToSearchResult(rankingOnly && !hasLiteralIdentityMatch ? { ...match, score: 0 } : match),
      score: match.score,
      reasons: match.reasons,
    };
  });
}

// The anonymous payload is entirely derived from the curated snapshot, so both
// the index projection and the governance map are query-independent — rebuilding
// them per request mapped every record twice for nothing (latency audit
// 2026-07-28, L2-9). `defaultMedicationRecords()` is already memoised via
// `loadMedicationSnapshot`, so caching these two derivations introduces no
// aliasing the route did not already have. Ranking still runs per query.
function buildPublicGovernance(records: MedicationRecord[]) {
  return Object.fromEntries(records.map((record) => [record.slug, publicMedicationGovernance(record)]));
}

let cachedPublicIndexRecords: MedicationRecord[] | null = null;
let cachedPublicGovernance: ReturnType<typeof buildPublicGovernance> | null = null;
let cachedPublicGovernanceDay: string | null = null;

function publicIndexRecords() {
  cachedPublicIndexRecords ??= toIndexRecords(defaultMedicationRecords());
  return cachedPublicIndexRecords;
}

function publicGovernance(records: MedicationRecord[]) {
  // Slugs are identical for the full and index projections, so one map serves both.
  //
  // Keyed by UTC day, not cached outright. Source freshness is a function of the
  // reading clock, so a lifetime cache would re-freeze exactly what this module
  // stopped freezing: a process that started before a record aged out would keep
  // serving the pre-ageing status until it happened to restart. A day is the
  // finest granularity the status can actually change at, so this preserves the
  // per-request-mapping saving the latency audit bought while keeping the answer
  // honest across a date boundary.
  //
  // This is the tightest link, not the only one: anonymous responses go out with
  // `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`
  // (`src/lib/fixture-response-cache.ts`), so a CDN may keep serving a day-old
  // governance map for about 25 h past the flip. Immaterial against a 365-day review
  // interval, but do not read the day key as a same-day guarantee at the edge.
  const today = new Date().toISOString().slice(0, 10);
  if (cachedPublicGovernance === null || cachedPublicGovernanceDay !== today) {
    cachedPublicGovernance = buildPublicGovernance(records);
    cachedPublicGovernanceDay = today;
  }
  return cachedPublicGovernance;
}

function publicMedicationPayload(q: string | undefined, limit: number, fields?: "index") {
  // Rank against the full snapshot even for fields=index so typo/brand vocabulary
  // is complete; response records still use the slim identity projection.
  const fullRecords = defaultMedicationRecords();
  const records = fields === "index" ? publicIndexRecords() : fullRecords;
  const governance = publicGovernance(fullRecords);
  const ranked = q ? rankCatalogMatches(fullRecords, q, limit, fields === "index") : undefined;
  return {
    records,
    matches: ranked?.matches,
    interpretation: ranked?.interpretation,
    total: records.length,
    governance,
  };
}

export async function GET(request: Request) {
  try {
    const { q, limit, fields } = parseRequestQuery(request, medicationListQuerySchema, "Invalid medication query.");

    if (isDemoMode() || isLocalNoAuthMode()) {
      return medicationResponse(
        {
          ...publicMedicationPayload(q, limit, fields),
          demoMode: true,
        },
        { request, fixture: true },
      );
    }

    // Anonymous callers still resolve access + rate limit: publicCatalogueAccessContext skips the
    // Supabase auth round-trip for requests with no session cookie/bearer, but every caller
    // (authenticated or not) must pass the registry limiter before we serve the full catalog.
    const supabase = createAdminClient();
    const access = await publicCatalogueAccessContext(request, supabase);

    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "registry",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Medication requests are rate limited. Try again shortly.", rateLimit);
    }

    const seedRecords = defaultMedicationRecords();
    const seeds = seedRecords.map((record) => ({
      record,
      governance: publicMedicationGovernance(record),
    }));
    // Bounded, and degrades to the in-bundle catalogue rather than hanging — the same treatment
    // the registry list route gets, and for the same reason: this read had no budget at all, so
    // the 2026-09-09 outage left the mode surfaces waiting indefinitely rather than showing
    // anything. See src/lib/site-content/catalogue-seed-fallback.ts.
    const observed: { source: "canonical_public" | "seed_uninitialized" } = { source: "canonical_public" };
    const canonical = await readCatalogueWithSeedFallback({
      kind: "medication",
      // Its own cooldown scope. Sharing one with search meant a search giving up at 1200 ms sent
      // this route straight to seeds for thirty seconds without ever trying the longer read it is
      // budgeted for.
      scope: catalogueListScope,
      seeds,
      budgetMs: catalogueListFallbackBudgetMs,
      read: async (signal) => {
        const result = await readCanonicalSiteContentRecords({
          supabase,
          kind: "medication",
          slug: null,
          seeds,
          signal,
          cache: true,
          mapRecord: ({ canonicalRecord, finalRenderPayload }) => ({
            record: finalRenderPayload as unknown as MedicationRecord,
            governance: {
              ...publicMedicationGovernance(finalRenderPayload as unknown as MedicationRecord),
              ...canonicalSiteContentGovernance(canonicalRecord),
            },
          }),
        });
        observed.source = result.source;
        return result.records;
      },
    });
    const fullRecords = canonical.records.map((entry) => entry.record);
    const records = fields === "index" ? toIndexRecords(fullRecords) : fullRecords;
    const governanceBySlug = Object.fromEntries(
      canonical.records.map((entry) => [entry.record.slug, entry.governance]),
    );
    const ranked = q ? rankCatalogMatches(fullRecords, q, limit, fields === "index") : undefined;

    return medicationResponse(
      {
        publicAccess: true,
        records,
        matches: ranked?.matches,
        interpretation: ranked?.interpretation,
        total: fullRecords.length,
        governance: governanceBySlug,
        // `catalogue-seed-fallback` is explicit that `degraded` must never be dropped on the
        // floor: seeds can lag anything published since the last release, so the reader has to be
        // told the list may be stale. This route was still dropping it. `MedicationResultsView`
        // turns it into the "Retained copy" notice.
        ...(canonical.degraded ? { retainedSnapshot: true as const } : {}),
      },
      // Not widened to cover `canonical.degraded`: `fixture` lengthens public caching, which would
      // pin a stale seed list in front of a database that may recover in thirty seconds.
      { request, fixture: observed.source === "seed_uninitialized" },
    );
  } catch (error) {
    // A cancelled request is not a fault: answer 499, exactly as the catch in /api/search does.
    // Deliberately NARROWER than the shared isAbortError helper, which also matches TimeoutError.
    // Nothing on these paths produces a TimeoutError with the client still connected today — the
    // catalogue budget and the per-domain search budget each absorb their own expiry — but that
    // containment lives in modules this file does not own. If it ever changed, the wider predicate
    // would report a genuine server deadline as a client cancellation: empty body, no error log,
    // and invisible in the error rate. Pinned by the TimeoutError cases in tests/api-client-abort.
    if ((error instanceof DOMException && error.name === "AbortError") || request.signal?.aborted) {
      return new Response(null, { status: 499 });
    }
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
