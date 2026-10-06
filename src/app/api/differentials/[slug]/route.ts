import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { deriveGovernanceFromSnapshot, normalizeDifferentialSlug } from "@/lib/differential-records";
import type { DifferentialPresentationWorkflow, DifferentialRecord } from "@/lib/differential-snapshot";
import { loadDifferentialSnapshot } from "@/lib/differential-seed";
import {
  getDifferentialDetailContext,
  getDifferentialRecord,
  getPresentationWorkflow,
  scopeDifferentialRecord,
  scopePresentationWorkflow,
} from "@/lib/differentials";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { fixtureResponseHeaders } from "@/lib/fixture-response-cache";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { publicCatalogueAccessContext } from "@/lib/public-api-access";
import {
  canonicalSiteContentGovernance,
  readCanonicalSiteContentRecords,
} from "@/lib/site-content/site-content-publication";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseRequestQuery } from "@/lib/validation/query";

export const runtime = "nodejs";

const differentialDetailQuerySchema = z.object({
  kind: z.enum(["presentation", "diagnosis"]).optional().default("diagnosis"),
});

function differentialResponse(
  payload: Record<string, unknown>,
  init: { status?: number; request?: Request; fixture?: boolean } = {},
) {
  return NextResponse.json(payload, {
    status: init.status ?? 200,
    headers: fixtureResponseHeaders(init.request, init),
  });
}

function notFoundResponse(slug: string) {
  return publicErrorResponse(`No differential record found for "${slug}".`, 404, {
    code: "differential_not_found",
  });
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const parsedSlug = z.string().trim().min(1).max(120).regex(/^[a-z0-9_-]+$/).parse(slug);
    const normalizedSlug = normalizeDifferentialSlug(parsedSlug);
    const { kind } = parseRequestQuery(request, differentialDetailQuerySchema, "Invalid differential detail query.");

    if (isDemoMode() || isLocalNoAuthMode()) {
      const snapshot = loadDifferentialSnapshot();
      const governance = deriveGovernanceFromSnapshot(snapshot);
      if (kind === "presentation") {
        const workflow = getPresentationWorkflow(normalizedSlug);
        if (!workflow) return notFoundResponse(normalizedSlug);
        return differentialResponse(
          {
            workflow,
            governance: { sourceStatus: governance.source_status, validationStatus: governance.validation_status },
            demoMode: true,
          },
          { request, fixture: true },
        );
      }
      const record = getDifferentialRecord(normalizedSlug);
      if (!record) return notFoundResponse(normalizedSlug);
      return differentialResponse(
        {
          record,
          detailContext: getDifferentialDetailContext(record),
          governance: { sourceStatus: governance.source_status, validationStatus: governance.validation_status },
          demoMode: true,
        },
        { request, fixture: true },
      );
    }

    // Anonymous callers still resolve access + rate limit before we serve the seed detail:
    // publicCatalogueAccessContext skips the Supabase auth round-trip when there's no session cookie/bearer,
    // but every caller must pass the registry limiter (M4/C1 — no anonymous bypass).
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
      const seedWorkflow = getPresentationWorkflow(normalizedSlug);
      const canonical = await readCanonicalSiteContentRecords({
        supabase,
        kind: "presentation",
        slug: normalizedSlug,
        seeds: seedWorkflow
          ? [
              {
                workflow: seedWorkflow,
                governance: {
                  sourceStatus: seedGovernance.source_status,
                  validationStatus: seedGovernance.validation_status,
                  lastReviewedAt: null,
                  reviewDueAt: null,
                },
              },
            ]
          : [],
        // Canonical payloads were seeded before presentation scope existed, so
        // they are relabelled here too — see scopeDifferentialRecord.
        mapRecord: ({ canonicalRecord, finalRenderPayload }) => ({
          workflow: scopePresentationWorkflow(finalRenderPayload as unknown as DifferentialPresentationWorkflow),
          governance: canonicalSiteContentGovernance(canonicalRecord),
        }),
      });
      const payload = canonical.records[0];
      if (!payload) return notFoundResponse(normalizedSlug);
      return differentialResponse(
        { ...payload, publicAccess: true },
        { request, fixture: canonical.source === "seed_uninitialized" },
      );
    }

    const seedRecord = getDifferentialRecord(normalizedSlug);
    const canonical = await readCanonicalSiteContentRecords({
      supabase,
      kind: "differential",
      slug: normalizedSlug,
      seeds: seedRecord
        ? [
            {
              record: seedRecord,
              governance: {
                sourceStatus: seedGovernance.source_status,
                validationStatus: seedGovernance.validation_status,
                lastReviewedAt: null,
                reviewDueAt: null,
              },
            },
          ]
        : [],
      mapRecord: ({ canonicalRecord, finalRenderPayload }) => ({
        record: scopeDifferentialRecord(finalRenderPayload as unknown as DifferentialRecord),
        governance: canonicalSiteContentGovernance(canonicalRecord),
      }),
    });
    const payload = canonical.records[0];
    if (!payload) return notFoundResponse(normalizedSlug);
    return differentialResponse(
      { ...payload, detailContext: getDifferentialDetailContext(payload.record), publicAccess: true },
      { request, fixture: canonical.source === "seed_uninitialized" },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
