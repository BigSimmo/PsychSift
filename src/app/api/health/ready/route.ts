import { healthResponse, loadSiteContentHealthEvidence } from "@/lib/health-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Railway cannot attach the authenticated deep-probe header. This endpoint is
// intentionally limited to readiness state and exposes no diagnostic details.
export async function GET(request: Request) {
  return healthResponse(request, {
    forceDeep: true,
    allowUnauthenticatedDeep: true,
    includeSlo: false,
    includeCache: false,
    includeCoalescing: false,
    siteContentHealthInput: loadSiteContentHealthEvidence(),
  });
}
