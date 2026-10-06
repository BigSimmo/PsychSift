import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { deriveGovernanceFromSnapshot, normalizeDifferentialSlug } from "@/lib/differential-records";
import type { DifferentialPresentationWorkflow, DifferentialRecord } from "@/lib/differential-snapshot";
import { loadDifferentialSnapshot } from "@/lib/differential-seed";
import {
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

export const runtime = "nodejs";

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
  return publicErrorResponse(`No differential presentation found for "${slug}".`, 404, {
    code: "differential_presentation_not_found",
  });
}

import { z } from "zod";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const parsedSlug = z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9_-]+$/)
      .parse(slug);
    const normalizedSlug = normalizeDifferentialSlug(parsedSlug);

    if (isDemoMode() || isLocalNoAuthMode()) {
      const snapshot = loadDifferentialSnapshot();
      const workflow = getPresentationWorkflow(normalizedSlug);
      if (!workflow) return notFoundResponse(normalizedSlug);
      const governance = deriveGovernanceFromSnapshot(snapshot);
      const candidates = workflow.candidates.flatMap((candidate) => {
        const record = getDifferentialRecord(candidate.slug);
        if (!record) return [];
        return [{ ...candidate, record }];
      });
      return differentialResponse(
        {
          workflow,
          candidates,
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
    const seedWorkflow = getPresentationWorkflow(normalizedSlug);
    const presentation = await readCanonicalSiteContentRecords({
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
      mapRecord: ({ canonicalRecord, finalRenderPayload }) => ({
        workflow: scopePresentationWorkflow(finalRenderPayload as unknown as DifferentialPresentationWorkflow),
        governance: canonicalSiteContentGovernance(canonicalRecord),
      }),
    });
    const payload = presentation.records[0];
    if (!payload) return notFoundResponse(normalizedSlug);
    const diagnosisPopulation = await readCanonicalSiteContentRecords({
      supabase,
      kind: "differential",
      slug: null,
      seeds: snapshot.diagnoses.map((record) => ({ record })),
      mapRecord: ({ finalRenderPayload }) => ({
        record: scopeDifferentialRecord(finalRenderPayload as unknown as DifferentialRecord),
      }),
    });
    const diagnosisBySlug = new Map(diagnosisPopulation.records.map(({ record }) => [record.slug, record]));
    const { workflow } = payload;
    const candidates = workflow.candidates.flatMap((candidate) => {
      const record = diagnosisBySlug.get(candidate.slug);
      if (!record) return [];
      return [{ ...candidate, record }];
    });

    return differentialResponse(
      { workflow, candidates, governance: payload.governance, publicAccess: true },
      {
        request,
        fixture: presentation.source === "seed_uninitialized" && diagnosisPopulation.source === "seed_uninitialized",
      },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
