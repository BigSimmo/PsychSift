import { requireSignedInClinicalAccess } from "@/lib/clinical-access";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { jsonError, PublicApiError } from "@/lib/http";
import { publicCatalogueAccessContext } from "@/lib/public-api-access";
import { buildServerTimingHeader, type ServerTimingEntry } from "@/lib/server-timing";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import {
  runUniversalSearch,
  universalSearchDomains,
  type RunUniversalSearchArgs,
  type UniversalSearchDomain,
  type UniversalSearchResponse,
} from "@/lib/universal-search";
import { parseRequestQuery, queryInteger } from "@/lib/validation/query";
import { appModeIds } from "@/lib/app-modes";
import { rejectPatientDetailQuestion } from "@/lib/clinical-question-patient-check-server";

export const runtime = "nodejs";

// Typeahead-friendly GET: cross-entity federated search over documents + the registry
// catalogues. Only an explicit demo/local deploy serves synthetic fixtures. Unlike the pure
// registry routes (which can short-circuit unauthenticated callers to an in-bundle catalogue),
// the documents domain must reach the live retrieval pipeline, so every non-demo caller runs the
// real search: anonymous callers are scoped to the public corpus (ownerId undefined ->
// allowGlobalSearch) and rate limited, and owners get their own records. Serving demo documents
// to live public callers here previously leaked the synthetic corpus (see runUniversalSearch demo
// path); it must never be reachable in production.
const universalSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: queryInteger({ fallback: 5, min: 1, max: 10 }),
  mode: z.enum(appModeIds).optional(),
  stream: z.enum(["ndjson"]).optional(),
  domains: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const requested = value
        .split(",")
        .map((domain) => domain.trim())
        .filter((domain): domain is UniversalSearchDomain => (universalSearchDomains as string[]).includes(domain));
      return requested.length ? requested : undefined;
    }),
});

function universalResponse(
  payload: Record<string, unknown> & Partial<Pick<UniversalSearchResponse, "groups" | "tookMs">>,
) {
  const headers: Record<string, string> = { "Cache-Control": "private, no-store" };
  // Per-domain + total durations for DevTools; names/durations only (no query data).
  const timingEntries: ServerTimingEntry[] = (payload.groups ?? []).map((group) => ({
    name: group.kind,
    durMs: group.latencyMs,
  }));
  if (typeof payload.tookMs === "number") timingEntries.push({ name: "total", durMs: payload.tookMs });
  const serverTiming = buildServerTimingHeader(timingEntries);
  if (serverTiming) headers["Server-Timing"] = serverTiming;
  return NextResponse.json(payload, { headers });
}

function universalStreamResponse(
  request: Request,
  searchArgs: RunUniversalSearchArgs,
  decoration: { demoMode?: true; publicAccess?: true } = {},
) {
  const encoder = new TextEncoder();
  const searchController = new AbortController();
  const abortFromRequest = () => searchController.abort(request.signal.reason);
  if (request.signal.aborted) abortFromRequest();
  else request.signal.addEventListener("abort", abortFromRequest, { once: true });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (event: Record<string, unknown>) => {
        if (!searchController.signal.aborted) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      };

      void runUniversalSearch({
        ...searchArgs,
        signal: searchController.signal,
        onGroup: (group) => enqueue({ type: "group", query: searchArgs.query, group }),
      })
        .then((response) => {
          if (searchController.signal.aborted) return;
          enqueue({ type: "complete", response: { ...response, ...decoration } });
          controller.close();
        })
        .catch(() => {
          if (searchController.signal.aborted) {
            try {
              controller.close();
            } catch {
              // The consumer may already have cancelled the stream.
            }
            return;
          }
          // Headers have already been returned, so this failure cannot become a
          // JSON 500. End the NDJSON protocol with a fixed, non-sensitive error
          // event instead of erroring the response stream (which Next reports as
          // an unhandled server request error and can leave consumers waiting).
          enqueue({ type: "error", code: "universal_search_failed" });
          controller.close();
        })
        .finally(() => request.signal.removeEventListener("abort", abortFromRequest));
    },
    cancel(reason) {
      searchController.abort(
        reason instanceof Error ? reason : new DOMException("The search stream was cancelled.", "AbortError"),
      );
      request.signal.removeEventListener("abort", abortFromRequest);
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  try {
    const { q, limit, domains, mode, stream } = parseRequestQuery(
      request,
      universalSearchQuerySchema,
      "Invalid universal query.",
    );
    // The browser hook withholds text that looks like it holds a patient detail, but this route
    // carries the query in its GET URL and runs document search on it, so refuse it here too —
    // the same server backstop /api/search applies (repository audit F-01).
    rejectPatientDetailQuestion({ query: q });

    if (isDemoMode() || isLocalNoAuthMode()) {
      const searchArgs: RunUniversalSearchArgs = {
        query: q,
        limitPerDomain: limit,
        domains,
        contextMode: mode,
        demo: true,
      };
      if (stream === "ndjson") return universalStreamResponse(request, searchArgs, { demoMode: true });
      const payload = await runUniversalSearch({ ...searchArgs, signal: request.signal });
      return universalResponse({ ...payload, demoMode: true });
    }

    const supabase = createAdminClient();
    const access = await publicCatalogueAccessContext(request, supabase);
    // #3728: signed-in health professionals only from 1 Nov 2026 (the #3696 rule).
    requireSignedInClinicalAccess(access);

    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "registry",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Universal search requests are rate limited. Try again shortly.", rateLimit);
    }

    // demo:false + supabase always run the live pipeline. An anonymous caller (ownerId
    // undefined) is scoped to the public corpus via allowGlobalSearch and the real default
    // catalogues — never the synthetic demo fixtures.
    const searchArgs: RunUniversalSearchArgs = {
      query: q,
      limitPerDomain: limit,
      domains,
      contextMode: mode,
      supabase,
      ownerId: access.ownerId,
      demo: false,
    };
    if (stream === "ndjson") {
      return universalStreamResponse(request, searchArgs, access.ownerId ? {} : { publicAccess: true });
    }
    const payload = await runUniversalSearch({ ...searchArgs, signal: request.signal });
    return universalResponse(access.ownerId ? payload : { ...payload, publicAccess: true });
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
    if (error instanceof z.ZodError) {
      return jsonError(error, 400);
    }
    if (error instanceof PublicApiError) {
      return jsonError(error, error.status);
    }
    if (error instanceof SyntaxError || error instanceof URIError || error instanceof TypeError) {
      return jsonError(new PublicApiError("Invalid universal search query.", 400, { code: "invalid_query" }), 400);
    }
    return jsonError(error);
  }
}

export async function POST() {
  return jsonError(
    new PublicApiError("Method Not Allowed. Universal search requires a GET request.", 405, {
      code: "method_not_allowed",
    }),
    405,
  );
}
