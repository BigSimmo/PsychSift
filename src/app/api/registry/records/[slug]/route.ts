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
import { publicCatalogueAccessContext } from "@/lib/public-api-access";
import { getFormRecord } from "@/lib/forms";
import { deriveGovernanceColumns, normalizeRegistrySlug } from "@/lib/registry-records";
import { projectServiceRecordForClient } from "@/lib/registry-client-contract";
import {
  canonicalSiteContentGovernance,
  readCanonicalSiteContentRecords,
} from "@/lib/site-content/site-content-publication";
import { preferBundledFormRecord, siteContentSnapshotReleaseId } from "@/lib/site-content/prefer-bundled-form-record";
import { getServiceRecord, type ServiceRecord } from "@/lib/services";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseRequestQuery } from "@/lib/validation/query";

export const runtime = "nodejs";

const registryDetailQuerySchema = z.object({
  kind: z.enum(["service", "form"]),
});

function registryResponse(
  payload: Record<string, unknown>,
  init: { status?: number; request?: Request; fixture?: boolean } = {},
) {
  return NextResponse.json(payload, {
    status: init.status ?? 200,
    headers: fixtureResponseHeaders(init.request, init),
  });
}

function notFoundResponse(slug: string) {
  return publicErrorResponse(`No registry record found for "${slug}".`, 404, { code: "registry_record_not_found" });
}

function publicRegistryDetailPayload(kind: "service" | "form", slug: string) {
  const record = kind === "form" ? getFormRecord(slug) : getServiceRecord(slug);
  if (!record) return null;
  const derived = deriveGovernanceColumns(record);
  return {
    record,
    governance: { sourceStatus: derived.source_status, validationStatus: derived.validation_status },
    linkedDocuments: [],
  };
}

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
    const normalizedSlug = normalizeRegistrySlug(parsedSlug);
    const { kind } = parseRequestQuery(request, registryDetailQuerySchema, "Invalid registry detail query.");

    if (isDemoMode() || isLocalNoAuthMode()) {
      const payload = publicRegistryDetailPayload(kind, normalizedSlug);
      if (!payload) return notFoundResponse(normalizedSlug);
      return registryResponse(
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
      return rateLimitJsonResponse("Registry requests are rate limited. Try again shortly.", rateLimit);
    }

    const seed = publicRegistryDetailPayload(kind, normalizedSlug);
    const canonical = await readCanonicalSiteContentRecords({
      supabase,
      kind,
      slug: normalizedSlug,
      seeds: seed ? [seed] : [],
      mapRecord: ({ canonicalRecord, finalRenderPayload }) => ({
        record: finalRenderPayload as unknown as ServiceRecord,
        governance: canonicalSiteContentGovernance(canonicalRecord),
        linkedDocuments: [],
      }),
    });
    const activeReleaseId = siteContentSnapshotReleaseId(canonical.snapshot);
    const payload = canonical.records.map((entry) => preferBundledFormRecord(kind, entry, { activeReleaseId }))[0];
    if (!payload) return notFoundResponse(normalizedSlug);
    return registryResponse(
      {
        ...payload,
        record: projectServiceRecordForClient(payload.record) as ServiceRecord,
        publicAccess: true,
        sharedCatalog: true,
      },
      { request, fixture: canonical.source === "seed_uninitialized" },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
