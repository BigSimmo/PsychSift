import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { deriveGovernanceFromSnapshot, type DifferentialRecordKind } from "@/lib/differential-records";
import type { DifferentialPresentationWorkflow, DifferentialRecord } from "@/lib/differential-snapshot";
import { loadDifferentialSnapshot } from "@/lib/differential-seed";
import {
  differentialPresentations,
  differentialRecords,
  rankDifferentialRecords,
  rankPresentationWorkflows,
  scopeDifferentialRecord,
  scopePresentationWorkflow,
  type DifferentialPresentationMatch,
  type DifferentialRecordMatch,
} from "@/lib/differentials";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { fixtureResponseHeaders } from "@/lib/fixture-response-cache";
import { jsonError } from "@/lib/http";
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
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseRequestQuery, queryInteger } from "@/lib/validation/query";

export const runtime = "nodejs";

/**
 * THE SERVER'S OWN DEADLINE IS `catalogueListFallbackBudgetMs` BELOW, NOT A ROUTE SEGMENT CONFIG.
 *
 * Until 2026-09-17 nothing bounded this route at all: the only limits in the system were the
 * browser's 45 s abort (`searchRequestTimeoutMs`) and Railway's 30 s edge kill, and neither stops
 * the SERVER working. A request the reader had already abandoned kept holding a connection and
 * burning database time, which is part of how one slow catalogue read saturated Postgres for
 * every other mode at once.
 *
 * `export const maxDuration` does NOT fix that here, and was removed after being tried. Next only
 * writes it into the build output for a deployment platform to enforce; this app ships as a
 * Dockerfile running `next start` on Railway, which never reads it. It would have looked like a
 * deadline and been a no-op — the same shape of defect as the catalogue cache that shipped on
 * 2026-09-16 and stored nothing in production for eight days. If a real per-route ceiling is
 * wanted, it has to be an AbortController in code, as `readCatalogueWithSeedFallback` already is.
 */

const differentialListQuerySchema = z.object({
  kind: z.enum(["presentation", "diagnosis"]).optional().default("diagnosis"),
  q: z
    .string()
    .trim()
    // Matches the Answer/Documents search bound (api/search), so a pasted vignette searches instead of failing.
    .max(2000)
    .optional()
    .transform((value) => (value ? value : undefined)),
  limit: queryInteger({ fallback: 100, min: 1, max: 200 }),
});

function differentialResponse(
  payload: Record<string, unknown>,
  options: { request?: Request; fixture?: boolean } = {},
) {
  return NextResponse.json(payload, { headers: fixtureResponseHeaders(options.request, options) });
}

function recordMatchesPayload(matches: DifferentialRecordMatch[]) {
  return matches.map((match) => ({ record: match.record, score: match.score, reasons: match.reasons }));
}

function presentationMatchesPayload(matches: DifferentialPresentationMatch[]) {
  return matches.map((match) => ({ workflow: match.workflow, score: match.score, reasons: match.reasons }));
}

function publicDifferentialPayload(kind: DifferentialRecordKind, q: string | undefined, limit: number) {
  const snapshot = loadDifferentialSnapshot();
  const governance = deriveGovernanceFromSnapshot(snapshot);
  if (kind === "presentation") {
    const ranked = q ? rankPresentationWorkflows(snapshot.presentations, q, limit) : null;
    return {
      presentations: ranked ? ranked.map((match) => match.workflow) : snapshot.presentations,
      matches: ranked ? presentationMatchesPayload(ranked) : undefined,
      total: snapshot.presentations.length,
      governance: { sourceStatus: governance.source_status, validationStatus: governance.validation_status },
    };
  }
  const ranked = q ? rankDifferentialRecords(differentialRecords, q, limit, [], true) : null;
  const records = ranked ? ranked.map((match) => match.record) : differentialRecords;
  return {
    records,
    matches: ranked ? recordMatchesPayload(ranked) : undefined,
    // The catalogue size, not `records.length`. With `q` present `records` holds
    // the ranked matches, so measuring it made `total` the match count — which is
    // already in `records`/`matches` — while the other three branches here report
    // the catalogue (`snapshot.presentations.length` above, `rows.length` on both
    // owner paths). A caller asking "how many differentials are there" got the
    // size of its own result set back, so the differentials filter could not
    // state the catalogue figure and had to omit it.
    total: differentialRecords.length,
    governance: { sourceStatus: governance.source_status, validationStatus: governance.validation_status },
  };
}

export async function GET(request: Request) {
  try {
    const { kind, q, limit } = parseRequestQuery(request, differentialListQuerySchema, "Invalid differential query.");

    if (isDemoMode() || isLocalNoAuthMode()) {
      return differentialResponse(
        {
          publicAccess: true,
          ...publicDifferentialPayload(kind, q, limit),
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
      return rateLimitJsonResponse("Differential requests are rate limited. Try again shortly.", rateLimit);
    }

    const snapshot = loadDifferentialSnapshot();
    const seedGovernance = deriveGovernanceFromSnapshot(snapshot);
    if (kind === "presentation") {
      // `differentialPresentations()` (the scoped catalogue), NOT `snapshot.presentations` (the
      // raw loader output). The canonical branch below maps every row through
      // `scopePresentationWorkflow`, so seeding from the unscoped snapshot would let a seed read
      // and a live read of the same workflow return different criterion scopes — the exact
      // divergence `scopeDifferentialRecord` documents as the thing to prevent, and the UI
      // defaults an unscoped criterion to diagnosis-specific. It mattered little while seeds were
      // reached only by an uninitialised corpus; the fallback below makes that path routine.
      const presentationSeeds = differentialPresentations().map((workflow) => ({
        workflow,
        governance: {
          sourceStatus: seedGovernance.source_status,
          validationStatus: seedGovernance.validation_status,
        },
      }));
      const observed: { source: "canonical_public" | "seed_uninitialized" } = { source: "canonical_public" };
      const canonical = await readCatalogueWithSeedFallback({
        kind: "presentation",
        scope: catalogueListScope,
        seeds: presentationSeeds,
        signal: request.signal,
        budgetMs: catalogueListFallbackBudgetMs,
        read: async (signal) => {
          const result = await readCanonicalSiteContentRecords({
            supabase,
            kind: "presentation",
            slug: null,
            seeds: presentationSeeds,
            signal,
            cache: true,
            mapRecord: ({ canonicalRecord, finalRenderPayload }) => ({
              workflow: scopePresentationWorkflow(finalRenderPayload as unknown as DifferentialPresentationWorkflow),
              governance: canonicalSiteContentGovernance(canonicalRecord),
            }),
          });
          observed.source = result.source;
          return result.records;
        },
      });
      const presentations = canonical.records.map((entry) => entry.workflow);
      const ranked = q ? rankPresentationWorkflows(presentations, q, limit) : null;
      return differentialResponse(
        {
          publicAccess: true,
          presentations: ranked ? ranked.map((match) => match.workflow) : presentations,
          matches: ranked ? presentationMatchesPayload(ranked) : undefined,
          total: presentations.length,
          degraded: canonical.degraded,
          governance: Object.fromEntries(canonical.records.map((entry) => [entry.workflow.id, entry.governance])),
        },
        // Not widened to `canonical.degraded`: `fixture` lengthens public cacheability, which is
        // right for an uninitialised corpus and wrong for a degraded read that may heal in the
        // thirty-second cooldown. Same reasoning as the registry list route.
        { request, fixture: observed.source === "seed_uninitialized" },
      );
    }
    const differentialSeeds = differentialRecords.map((record) => ({
      record,
      governance: { sourceStatus: seedGovernance.source_status, validationStatus: seedGovernance.validation_status },
    }));
    const observed: { source: "canonical_public" | "seed_uninitialized" } = { source: "canonical_public" };
    const canonical = await readCatalogueWithSeedFallback({
      kind: "differential",
      scope: catalogueListScope,
      seeds: differentialSeeds,
      signal: request.signal,
      budgetMs: catalogueListFallbackBudgetMs,
      read: async (signal) => {
        const result = await readCanonicalSiteContentRecords({
          supabase,
          kind: "differential",
          slug: null,
          seeds: differentialSeeds,
          signal,
          cache: true,
          mapRecord: ({ canonicalRecord, finalRenderPayload }) => ({
            record: scopeDifferentialRecord(finalRenderPayload as unknown as DifferentialRecord),
            governance: canonicalSiteContentGovernance(canonicalRecord),
          }),
        });
        observed.source = result.source;
        return result.records;
      },
    });
    const records = canonical.records.map((entry) => entry.record);
    const ranked = q ? rankDifferentialRecords(records, q, limit) : null;
    return differentialResponse(
      {
        publicAccess: true,
        records: ranked ? ranked.map((match) => match.record) : records,
        matches: ranked ? recordMatchesPayload(ranked) : undefined,
        total: records.length,
        degraded: canonical.degraded,
        governance: Object.fromEntries(canonical.records.map((entry) => [entry.record.slug, entry.governance])),
      },
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
