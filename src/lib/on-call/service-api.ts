import "server-only";

import { NextResponse } from "next/server";
import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Service data never enters shared HTTP caches, including denied responses. */
export async function withServiceApi(
  request: Request,
  operation: (client: AdminClient, ownerId: string) => Promise<unknown>,
): Promise<Response> {
  let response: Response;
  try {
    if (isDemoMode()) {
      response = publicErrorResponse("Invited service handbooks are unavailable in synthetic demo mode.", 400, {
        code: "demo_mode_unavailable",
      });
    } else {
      const client = createAdminClient();
      const user = await requireAuthenticatedUser(request, client);
      const rate = await consumeSubjectApiRateLimit({
        supabase: client,
        subject: { kind: "owner", ownerId: user.id },
        bucket: "on_call",
        allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
      });
      response = rate.limited
        ? rateLimitJsonResponse("Service requests are rate limited. Try again shortly.", rate)
        : NextResponse.json(await operation(client, user.id));
    }
  } catch (error) {
    response = error instanceof AuthenticationError ? unauthorizedResponse() : jsonError(error);
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie, Authorization");
  return response;
}
