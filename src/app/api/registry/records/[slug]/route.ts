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
import { publicAccessContext } from "@/lib/public-api-access";
import { getFormRecord } from "@/lib/forms";
import { deriveGovernanceColumns, normalizeRegistrySlug } from "@/lib/registry-records";
import { getServiceRecord } from "@/lib/services";
import { readPublicSiteContentPartition } from "@/lib/site-content/public-site-content";
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
  return registryResponse({ error: `No registry record found for "${slug}".` }, { status: 404 });
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
    const normalizedSlug = normalizeRegistrySlug(slug);
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
      return rateLimitJsonResponse("Registry requests are rate limited. Try again shortly.", rateLimit);
    }

    // Authentication affects only rate-limit identity. The canonical public
    // record and governance metadata are identical for every reader.
    const publicSiteContent = await readPublicSiteContentPartition<Record<string, unknown>>(supabase, {
      domain: kind === "form" ? "forms" : "services",
      recordKind: kind,
      slug: normalizedSlug,
    });
    if (publicSiteContent) {
      if (publicSiteContent.state === "unavailable") {
        return registryResponse(
          {
            error: "Public site content is unavailable.",
            release: { id: null, epoch: publicSiteContent.changeEpoch, state: "unavailable" },
          },
          { request, status: 503 },
        );
      }
      const publication = publicSiteContent.records[0];
      if (!publication) return notFoundResponse(normalizedSlug);
      return registryResponse(
        {
          record: publication.payload,
          governance: publication.governance,
          linkedDocuments: [],
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
    const publicSiteContentPayload = publicRegistryDetailPayload(kind, normalizedSlug);
    if (!publicSiteContentPayload) return notFoundResponse(normalizedSlug);
    return registryResponse({ ...publicSiteContentPayload, publicAccess: true }, { request, fixture: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
