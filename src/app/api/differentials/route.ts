import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { deriveGovernanceFromSnapshot, type DifferentialRecordKind } from "@/lib/differential-records";
import { loadDifferentialSnapshot } from "@/lib/differential-seed";
import {
  differentialRecords,
  rankDifferentialRecords,
  rankPresentationWorkflows,
  type DifferentialPresentationMatch,
  type DifferentialRecordMatch,
} from "@/lib/differentials";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { fixtureResponseHeaders } from "@/lib/fixture-response-cache";
import { jsonError } from "@/lib/http";
import { publicAccessContext } from "@/lib/public-api-access";
import { readPublicSiteContentPartition } from "@/lib/site-content/public-site-content";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseRequestQuery, queryInteger } from "@/lib/validation/query";

export const runtime = "nodejs";

const differentialListQuerySchema = z.object({
  kind: z.enum(["presentation", "diagnosis"]).optional().default("diagnosis"),
  q: z
    .string()
    .trim()
    .max(200)
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
  const ranked = q ? rankDifferentialRecords(differentialRecords, q, limit) : null;
  const records = ranked ? ranked.map((match) => match.record) : differentialRecords;
  return {
    records,
    matches: ranked ? recordMatchesPayload(ranked) : undefined,
    total: records.length,
    governance: { sourceStatus: governance.source_status, validationStatus: governance.validation_status },
  };
}

export async function GET(request: Request) {
  try {
    const { kind, q, limit } = parseRequestQuery(request, differentialListQuerySchema, "Invalid differential query.");

    if (isDemoMode() || isLocalNoAuthMode()) {
      return differentialResponse(
        {
          ...publicDifferentialPayload(kind, q, limit),
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
      return rateLimitJsonResponse("Differential requests are rate limited. Try again shortly.", rateLimit);
    }

    // Authentication affects only rate-limit identity. Every reader receives
    // the same canonical public differential payload.
    const publicSiteContent = await readPublicSiteContentPartition<Record<string, unknown>>(supabase, {
      domain: "differentials",
      recordKind: kind,
    });
    if (publicSiteContent) {
      const values = publicSiteContent.records.map((entry) => entry.payload);
      return differentialResponse(
        {
          [kind === "presentation" ? "presentations" : "records"]: values,
          total: values.length,
          governance: Object.fromEntries(
            publicSiteContent.records.map((entry) => [entry.logical_id, entry.governance]),
          ),
          release: {
            id: publicSiteContent.activeReleaseId,
            epoch: publicSiteContent.changeEpoch,
            state: publicSiteContent.state,
          },
        },
        { request },
      );
    }
    return differentialResponse(publicDifferentialPayload(kind, q, limit), { request, fixture: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
