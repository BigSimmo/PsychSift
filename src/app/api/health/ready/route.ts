import { healthResponse } from "@/lib/health-response";
import { collectSiteContentHealthInput } from "@/lib/site-content/site-content-health-authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Railway cannot attach the authenticated deep-probe header. This endpoint is
// intentionally limited to readiness state and exposes no diagnostic details.
export async function GET(request: Request) {
  const siteContentHealthInput = await collectSiteContentHealthInput();
  const now = new Date();
  return healthResponse(request, {
    forceDeep: true,
    allowUnauthenticatedDeep: true,
    includeSlo: false,
    includeCache: false,
    includeCoalescing: false,
    siteContentHealthInput,
    siteContentNow: now,
  });
}
