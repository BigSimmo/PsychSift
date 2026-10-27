import * as Sentry from "@sentry/nextjs";
import { jsonError, PublicApiError } from "@/lib/http";
import {
  allowClientErrorReport,
  CLIENT_ERROR_BODY_LIMIT_BYTES,
  clientErrorReportSchema,
  clientErrorSentryEvent,
} from "@/lib/observability/client-error-intake";
import { readBoundedJson } from "@/lib/validation/body";

export const runtime = "nodejs";

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Browser error reports (see `@/lib/observability/client-error-report`). Never echoes the body. */
export async function POST(request: Request) {
  // Reports are only wanted from the live site, and only when Sentry is configured.
  if (process.env.NODE_ENV !== "production" || !process.env.SENTRY_DSN?.trim()) {
    return new Response(null, { status: 204 });
  }
  try {
    const parsed = clientErrorReportSchema.safeParse(await readBoundedJson(request, CLIENT_ERROR_BODY_LIMIT_BYTES));
    if (!parsed.success) throw new PublicApiError("Invalid request body.", 400, { code: "invalid_body" });
    if (!allowClientErrorReport(clientKey(request))) return new Response(null, { status: 429 });
    Sentry.captureEvent(clientErrorSentryEvent(parsed.data));
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(error, 400, { log: false });
  }
}
