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
import { medicationSourceStatus, medicationValidationStatus } from "@/lib/medication-records";
import { medicationCatalogInterpretation, searchMedicationCatalog } from "@/lib/medication-query";
import {
  medicationBrandNames,
  medicationToSearchResult,
  type MedicationRecord,
  type MedicationSearchMatch,
} from "@/lib/medications";
import { publicAccessContext } from "@/lib/public-api-access";
import { readPublicSiteContentPartition } from "@/lib/site-content/public-site-content";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseRequestQuery, queryInteger } from "@/lib/validation/query";

export const runtime = "nodejs";

const medicationListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(200)
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
  const { matches, analysis } = searchMedicationCatalog(records, q, limit);
  // Rank on full records for vocabulary, but serialize the slim identity shape
  // when fields=index so matches do not reintroduce stats/sections/quick.
  const serialized = projectIndex
    ? matches.map((match) => ({
        ...match,
        medication: toIndexRecords([match.medication])[0]!,
      }))
    : matches;
  return {
    matches: matchesPayload(serialized),
    interpretation: medicationCatalogInterpretation(analysis),
  };
}

function medicationResponse(payload: Record<string, unknown>, options: { request?: Request; fixture?: boolean } = {}) {
  return NextResponse.json(payload, { headers: fixtureResponseHeaders(options.request, options) });
}

function matchesPayload(matches: MedicationSearchMatch[]) {
  return matches.map((match) => ({
    medication: match.medication,
    result: medicationToSearchResult(match),
    score: match.score,
    reasons: match.reasons,
  }));
}

// The anonymous payload is entirely derived from the curated snapshot, so both
// the index projection and the governance map are query-independent — rebuilding
// them per request mapped every record twice for nothing (latency audit
// 2026-07-28, L2-9). `defaultMedicationRecords()` is already memoised via
// `loadMedicationSnapshot`, so caching these two derivations introduces no
// aliasing the route did not already have. Ranking still runs per query.
function buildPublicGovernance(records: MedicationRecord[]) {
  return Object.fromEntries(
    records.map((record) => [
      record.slug,
      {
        sourceStatus: medicationSourceStatus("current"),
        validationStatus: medicationValidationStatus("locally_reviewed"),
      },
    ]),
  );
}

let cachedPublicIndexRecords: MedicationRecord[] | null = null;
let cachedPublicGovernance: ReturnType<typeof buildPublicGovernance> | null = null;

function publicIndexRecords() {
  cachedPublicIndexRecords ??= toIndexRecords(defaultMedicationRecords());
  return cachedPublicIndexRecords;
}

function publicGovernance(records: MedicationRecord[]) {
  // Slugs are identical for the full and index projections, so one map serves both.
  cachedPublicGovernance ??= buildPublicGovernance(records);
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

    // Anonymous callers still resolve access + rate limit: publicAccessContext skips the
    // Supabase auth round-trip for requests with no session cookie/bearer, but every caller
    // (authenticated or not) must pass the registry limiter before we serve the full catalog.
    const supabase = createAdminClient();
    const access = await publicAccessContext(request, supabase);

    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "registry",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Medication requests are rate limited. Try again shortly.", rateLimit);
    }

    // Canonical public site-content is identity-independent; actor-owned legacy
    // rows cannot override the published medication catalogue.
    const publicSiteContent = await readPublicSiteContentPartition<MedicationRecord>(supabase, {
      domain: "medications",
    });
    if (publicSiteContent) {
      const fullRecords = publicSiteContent.records.map((entry) => entry.payload);
      const records = fields === "index" ? toIndexRecords(fullRecords) : fullRecords;
      const ranked = q ? rankCatalogMatches(fullRecords, q, limit, fields === "index") : undefined;
      return medicationResponse(
        {
          records,
          matches: ranked?.matches,
          interpretation: ranked?.interpretation,
          total: records.length,
          governance: Object.fromEntries(
            publicSiteContent.records.map((entry) => [entry.payload.slug, entry.governance]),
          ),
          release: {
            id: publicSiteContent.activeReleaseId,
            epoch: publicSiteContent.changeEpoch,
            state: publicSiteContent.state,
          },
          publicAccess: true,
        },
        { request },
      );
    }
    return medicationResponse(
      { ...publicMedicationPayload(q, limit, fields), publicAccess: true },
      { request, fixture: true },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
