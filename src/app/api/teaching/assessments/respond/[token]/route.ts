import { NextResponse } from "next/server";
import { z } from "zod";

import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import {
  consumePublicApiRateLimit,
  EpaMagicLinkError,
  getEpaMagicLinkByToken,
  registerEpaMagicLinkRecord,
  submitEpaMagicLinkResponse,
  type CreateEpaMagicLinkInput,
  type EpaMagicLinkSubmission,
} from "@/lib/teaching/assessments/magic-link";
import { DurableEpaMagicLinkRepository } from "@/lib/teaching/assessments/magic-link-repository";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * Outside synthetic demo mode a supervisor's link lives in public.teaching_epa_magic_links
 * (#MAAXAX). Demo mode keeps the process-memory story store, which is never used in production.
 */
function durableMagicLinks(): DurableEpaMagicLinkRepository | null {
  return isDemoMode() ? null : new DurableEpaMagicLinkRepository(createAdminClient());
}

function refuseEphemeralMagicLinkStore(): void {
  if (process.env.NODE_ENV === "production") {
    throw new EpaMagicLinkError(
      "EPA magic-link assessments are disabled in production until backed by a durable database store.",
      "assessment_store_unavailable",
      503,
    );
  }
}

function errorWithHeaders(
  message: string,
  status: number,
  code: string,
  headers: Record<string, string> = noStore,
): NextResponse {
  const response = publicErrorResponse(message, status, { code });
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

const submissionSchema = z
  .object({
    level: z.enum(["direct", "proximal", "minimal"]).nullable().optional(),
    entrustmentLevel: z.enum(["direct", "proximal", "minimal"]).nullable().optional(),
    complexity: z.enum(["low", "medium", "high"]).nullable().optional(),
    observed: z.enum(["direct", "team"]).nullable().optional(),
    strengths: z.string().max(1000).nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
    improvements: z.string().max(1000).nullable().optional(),
    better: z.string().max(1000).nullable().optional(),
    assessorName: z.string().max(200).nullable().optional(),
  })
  .strict();

const registrationSchema = z
  .object({
    epaCode: z.union([z.number().int().min(1).max(4), z.string().min(1).max(20)]),
    traineeName: z.string().min(1).max(200),
    supervisorName: z.string().min(1).max(200),
    supervisorRole: z.string().max(100).optional(),
    clinicalSetting: z.string().max(200).nullable().optional(),
  })
  .strict();

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const rate = consumePublicApiRateLimit(request, "teaching-epa-magic-link-read");
    if (rate.limited) {
      return errorWithHeaders("Too many requests. Wait a minute and try again.", 429, "rate_limited", {
        ...noStore,
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }
    const { token } = await params;
    const durable = durableMagicLinks();
    if (durable) {
      const found = await durable.lookup(token);
      if (!found.ok) return errorWithHeaders(found.message, found.status, found.code);
      return NextResponse.json({ request: found.request }, { headers: noStore });
    }
    refuseEphemeralMagicLinkStore();
    const lookup = getEpaMagicLinkByToken(token);
    if (!lookup.ok) {
      const status = lookup.status === "not_found" ? 404 : 410;
      return errorWithHeaders(lookup.message, status, lookup.code);
    }
    return NextResponse.json({ request: lookup.request }, { headers: noStore });
  } catch (error) {
    if (error instanceof EpaMagicLinkError) {
      return errorWithHeaders(error.message, error.status, error.code);
    }
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    refuseEphemeralMagicLinkStore();
    // Rate limit before the sign-in lookup, so bad tokens cannot hammer the auth check.
    const rate = consumePublicApiRateLimit(request, "teaching-epa-magic-link-write");
    if (rate.limited) {
      return errorWithHeaders("Too many requests. Wait a minute and try again.", 429, "rate_limited", {
        ...noStore,
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }
    const client = createAdminClient();
    await requireAuthenticatedUser(request, client);
    const { token } = await params;
    const body = (await parseJsonBody(
      request,
      registrationSchema,
      "Check the EPA magic-link details and try again.",
    )) as CreateEpaMagicLinkInput;
    const record = registerEpaMagicLinkRecord(token, body);
    return NextResponse.json({ ok: true, request: record }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse(error);
    }
    if (error instanceof EpaMagicLinkError) {
      return errorWithHeaders(error.message, error.status, error.code);
    }
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const rate = consumePublicApiRateLimit(request, "teaching-epa-magic-link-write");
    if (rate.limited) {
      return errorWithHeaders("Too many requests. Wait a minute and try again.", 429, "rate_limited", {
        ...noStore,
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }
    const { token } = await params;
    const body = (await parseJsonBody(
      request,
      submissionSchema,
      "Check the EPA response and try again.",
    )) as EpaMagicLinkSubmission;
    const durable = durableMagicLinks();
    if (durable) {
      const stored = await durable.submit(token, body);
      if (!stored.ok) return errorWithHeaders(stored.message, stored.status, stored.code);
      return NextResponse.json({ ok: true, request: stored.request }, { headers: noStore });
    }
    refuseEphemeralMagicLinkStore();
    const result = submitEpaMagicLinkResponse(token, body);
    if (!result.ok) {
      const status =
        result.status === "not_found"
          ? 404
          : result.status === "expired"
            ? 410
            : result.status === "completed"
              ? 409
              : 400;
      return errorWithHeaders(result.message, status, result.code);
    }
    return NextResponse.json({ ok: true, request: result.request }, { headers: noStore });
  } catch (error) {
    if (error instanceof EpaMagicLinkError) {
      return errorWithHeaders(error.message, error.status, error.code);
    }
    return jsonError(error);
  }
}
