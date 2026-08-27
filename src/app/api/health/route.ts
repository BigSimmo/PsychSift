import { healthResponse, loadSiteContentHealthEvidence } from "@/lib/health-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return healthResponse(request, { siteContentHealthInput: loadSiteContentHealthEvidence() });
}
