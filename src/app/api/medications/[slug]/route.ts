import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { fixtureResponseHeaders } from "@/lib/fixture-response-cache";
import { jsonError } from "@/lib/http";
import { getMedicationRecord } from "@/lib/medication-snapshot";
import { deriveGovernanceFromSections, normalizeMedicationSlug } from "@/lib/medication-records";
import { publicAccessContext } from "@/lib/public-api-access";
import { readPublicSiteContentPartition } from "@/lib/site-content/public-site-content";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";

export const runtime = "nodejs";

function medicationResponse(
  payload: Record<string, unknown>,
  init: { status?: number; request?: Request; fixture?: boolean } = {},
) {
  return NextResponse.json(payload, {
    status: init.status ?? 200,
    headers: fixtureResponseHeaders(init.request, init),
  });
}

function notFoundResponse(slug: string) {
  return medicationResponse({ error: `No medication found for "${slug}".` }, { status: 404 });
}

function publicMedicationDetailPayload(slug: string) {
  const record = getMedicationRecord(slug);
  if (!record) return null;
  const governance = deriveGovernanceFromSections(record);
  return {
    record,
    governance: {
      sourceStatus: governance.source_status,
      validationStatus: governance.validation_status,
    },
  };
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const normalizedSlug = normalizeMedicationSlug(slug);

    if (isDemoMode() || isLocalNoAuthMode()) {
      const payload = publicMedicationDetailPayload(normalizedSlug);
      if (!payload) return notFoundResponse(normalizedSlug);
      return medicationResponse(
        {
          ...payload,
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
      return rateLimitJsonResponse("Medication requests are rate limited. Try again shortly.", rateLimit);
    }

    const publicSiteContent = await readPublicSiteContentPartition<Record<string, unknown>>(supabase, {
      domain: "medications",
      slug: normalizedSlug,
    });
    if (publicSiteContent) {
      const publication = publicSiteContent.records[0];
      if (!publication) return notFoundResponse(normalizedSlug);
      return medicationResponse(
        {
          record: publication.payload,
          governance: publication.governance,
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
    const publicSiteContentPayload = publicMedicationDetailPayload(normalizedSlug);
    if (!publicSiteContentPayload) return notFoundResponse(normalizedSlug);
    return medicationResponse({ ...publicSiteContentPayload, publicAccess: true }, { request, fixture: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
