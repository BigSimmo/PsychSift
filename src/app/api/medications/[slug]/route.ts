import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { fixtureResponseHeaders } from "@/lib/fixture-response-cache";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { getMedicationRecord } from "@/lib/medication-snapshot";
import { publicMedicationGovernance, normalizeMedicationSlug } from "@/lib/medication-records";
import { publicCatalogueAccessContext } from "@/lib/public-api-access";
import {
  canonicalSiteContentGovernance,
  readCanonicalSiteContentRecords,
} from "@/lib/site-content/site-content-publication";
import type { MedicationRecord } from "@/lib/medications";
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
  return publicErrorResponse(`No medication found for "${slug}".`, 404, { code: "medication_not_found" });
}

function publicMedicationDetailPayload(slug: string) {
  const record = getMedicationRecord(slug);
  if (!record) return null;
  return {
    record,
    governance: publicMedicationGovernance(record),
  };
}

const medicationSlugSchema = z.string().trim().min(1).max(128);

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const parsedSlug = medicationSlugSchema.safeParse(slug);
    if (!parsedSlug.success) {
      return publicErrorResponse("Invalid medication slug parameter.", 400, {
        code: "invalid_medication_slug",
      });
    }
    const normalizedSlug = normalizeMedicationSlug(parsedSlug.data);
    if (!normalizedSlug || !/^[a-z0-9_-]+$/.test(normalizedSlug) || normalizedSlug.length > 120) {
      return notFoundResponse(normalizedSlug || "unknown");
    }

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
      return rateLimitJsonResponse("Medication requests are rate limited. Try again shortly.", rateLimit);
    }

    const seed = publicMedicationDetailPayload(normalizedSlug);
    const canonical = await readCanonicalSiteContentRecords({
      supabase,
      kind: "medication",
      slug: normalizedSlug,
      seeds: seed ? [seed] : [],
      mapRecord: ({ canonicalRecord, finalRenderPayload }) => ({
        record: finalRenderPayload as unknown as MedicationRecord,
        governance: {
          ...publicMedicationGovernance(finalRenderPayload as unknown as MedicationRecord),
          ...canonicalSiteContentGovernance(canonicalRecord),
        },
      }),
    });
    const payload = canonical.records[0];
    if (!payload) return notFoundResponse(normalizedSlug);
    return medicationResponse(
      { ...payload, publicAccess: true },
      { request, fixture: canonical.source === "seed_uninitialized" },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
