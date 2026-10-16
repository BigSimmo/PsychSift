import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, publicErrorResponse } from "@/lib/http";
import {
  consumePublicApiRateLimit,
  EpaMagicLinkError,
  getEpaMagicLinkByToken,
  registerEpaMagicLinkRecord,
  submitEpaMagicLinkResponse,
  type CreateEpaMagicLinkInput,
  type EpaMagicLinkSubmission,
} from "@/lib/teaching/assessments/magic-link";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

/** A public error that keeps the response headers (no-store, Retry-After) the shared helper cannot set. */
function errorResponse(message: string, status: number, code: string, headers: Record<string, string>) {
  const response = publicErrorResponse(message, status, { code });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
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
      return errorResponse("Too many requests. Wait a minute and try again.", 429, "rate_limited", {
        ...noStore,
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }
    const { token } = await params;
    const lookup = getEpaMagicLinkByToken(token);
    if (!lookup.ok) {
      const status = lookup.status === "not_found" ? 404 : 410;
      return errorResponse(lookup.message, status, lookup.code, noStore);
    }
    return NextResponse.json({ request: lookup.request }, { headers: noStore });
  } catch (error) {
    if (error instanceof EpaMagicLinkError) {
      return errorResponse(error.message, error.status, error.code, noStore);
    }
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const rate = consumePublicApiRateLimit(request, "teaching-epa-magic-link-write");
    if (rate.limited) {
      return errorResponse("Too many requests. Wait a minute and try again.", 429, "rate_limited", {
        ...noStore,
        "Retry-After": String(rate.retryAfterSeconds),
      });
    }
    const { token } = await params;
    const body = (await parseJsonBody(
      request,
      registrationSchema,
      "Check the EPA magic-link details and try again.",
    )) as CreateEpaMagicLinkInput;
    const record = registerEpaMagicLinkRecord(token, body);
    return NextResponse.json({ ok: true, request: record }, { headers: noStore });
  } catch (error) {
    if (error instanceof EpaMagicLinkError) {
      return errorResponse(error.message, error.status, error.code, noStore);
    }
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const rate = consumePublicApiRateLimit(request, "teaching-epa-magic-link-write");
    if (rate.limited) {
      return errorResponse("Too many requests. Wait a minute and try again.", 429, "rate_limited", {
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
      return errorResponse(result.message, status, result.code, noStore);
    }
    return NextResponse.json({ ok: true, request: result.request }, { headers: noStore });
  } catch (error) {
    if (error instanceof EpaMagicLinkError) {
      return errorResponse(error.message, error.status, error.code, noStore);
    }
    return jsonError(error);
  }
}
