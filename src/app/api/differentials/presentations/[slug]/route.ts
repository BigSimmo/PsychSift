import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { deriveGovernanceFromSnapshot, normalizeDifferentialSlug } from "@/lib/differential-records";
import { loadDifferentialSnapshot } from "@/lib/differential-seed";
import { getDifferentialRecord, getPresentationWorkflow } from "@/lib/differentials";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { fixtureResponseHeaders } from "@/lib/fixture-response-cache";
import { jsonError } from "@/lib/http";
import { publicAccessContext } from "@/lib/public-api-access";
import { readPublicSiteContentPartition } from "@/lib/site-content/public-site-content";
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
  return differentialResponse({ error: `No differential presentation found for "${slug}".` }, { status: 404 });
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const normalizedSlug = normalizeDifferentialSlug(slug);

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
    // publicAccessContext skips the Supabase auth round-trip when there's no session cookie/bearer,
    // but every caller must pass the registry limiter (M4/C1 — no anonymous bypass).
    const supabase = createAdminClient();
    const access = await publicAccessContext(request, supabase);

    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "registry",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Differential requests are rate limited. Try again shortly.", rateLimit);
    }

    const publicSiteContent = await readPublicSiteContentPartition<Record<string, unknown>>(supabase, {
      domain: "differentials",
      recordKind: "presentation",
      slug: normalizedSlug,
    });
    if (publicSiteContent) {
      if (publicSiteContent.state === "unavailable") {
        return differentialResponse(
          {
            error: "Public site content is unavailable.",
            release: { id: null, epoch: publicSiteContent.changeEpoch, state: "unavailable" },
          },
          { request, status: 503 },
        );
      }
      const publication = publicSiteContent.records[0];
      if (!publication) return notFoundResponse(normalizedSlug);
      return differentialResponse(
        {
          workflow: publication.payload,
          candidates: [],
          governance: publication.governance,
          release: {
            id: publicSiteContent.activeReleaseId,
            epoch: publicSiteContent.changeEpoch,
            state: publicSiteContent.state,
          },
        },
        { request },
      );
    }
    // Resolve the canonical public presentation regardless of reader identity.
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
      },
      { request, fixture: true },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
