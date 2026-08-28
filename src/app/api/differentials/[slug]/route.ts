import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { deriveGovernanceFromSnapshot, normalizeDifferentialSlug } from "@/lib/differential-records";
import { loadDifferentialSnapshot } from "@/lib/differential-seed";
import { getDifferentialDetailContext, getDifferentialRecord, getPresentationWorkflow } from "@/lib/differentials";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { fixtureResponseHeaders } from "@/lib/fixture-response-cache";
import { jsonError } from "@/lib/http";
import { publicAccessContext } from "@/lib/public-api-access";
import {
  buildDifferentialDiagnosisAggregate,
  buildDifferentialPresentationAggregate,
} from "@/lib/site-content/differential-aggregate";
import {
  readPublicSiteContentPartition,
  type PublicSiteContentPartition,
} from "@/lib/site-content/public-site-content";
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
  return differentialResponse({ error: `No differential record found for "${slug}".` }, { status: 404 });
}

function unavailableReleaseResponse(
  request: Request,
  release: Pick<PublicSiteContentPartition<unknown>, "activeReleaseId" | "changeEpoch" | "state"> = {
    activeReleaseId: null,
    changeEpoch: 0,
    state: "unavailable",
  },
) {
  return differentialResponse(
    {
      error: "Public site content is unavailable.",
      release: { id: release.activeReleaseId, epoch: release.changeEpoch, state: release.state },
    },
    { request, status: 503 },
  );
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const normalizedSlug = normalizeDifferentialSlug(slug);
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

    let publicSiteContent;
    try {
      publicSiteContent = await readPublicSiteContentPartition<Record<string, unknown>>(supabase, {
        domain: "differentials",
      });
    } catch {
      return unavailableReleaseResponse(request);
    }
    if (publicSiteContent) {
      if (publicSiteContent.state === "unavailable") {
        return unavailableReleaseResponse(request, publicSiteContent);
      }
      if (kind === "diagnosis") {
        const aggregate = buildDifferentialDiagnosisAggregate(publicSiteContent, normalizedSlug);
        if (!aggregate) return unavailableReleaseResponse(request, publicSiteContent);
        return differentialResponse(
          {
            ...aggregate,
            release: {
              id: publicSiteContent.activeReleaseId,
              epoch: publicSiteContent.changeEpoch,
              state: publicSiteContent.state,
            },
          },
          { request },
        );
      }
      const aggregate = buildDifferentialPresentationAggregate(publicSiteContent, normalizedSlug);
      if (!aggregate) return unavailableReleaseResponse(request, publicSiteContent);
      return differentialResponse(
        {
          workflow: aggregate.workflow,
          governance: aggregate.governance,
          release: {
            id: publicSiteContent.activeReleaseId,
            epoch: publicSiteContent.changeEpoch,
            state: publicSiteContent.state,
          },
        },
        { request },
      );
    }
    const snapshot = loadDifferentialSnapshot();
    const governance = deriveGovernanceFromSnapshot(snapshot);
    if (kind === "presentation") {
      const workflow = getPresentationWorkflow(normalizedSlug);
      if (!workflow) return notFoundResponse(normalizedSlug);
      return differentialResponse(
        {
          workflow,
          governance: { sourceStatus: governance.source_status, validationStatus: governance.validation_status },
        },
        { request, fixture: true },
      );
    }
    const publicSiteContentRecord = getDifferentialRecord(normalizedSlug);
    if (!publicSiteContentRecord) return notFoundResponse(normalizedSlug);
    return differentialResponse(
      {
        record: publicSiteContentRecord,
        detailContext: getDifferentialDetailContext(publicSiteContentRecord),
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
