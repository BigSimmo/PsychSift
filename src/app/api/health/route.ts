import { healthResponse } from "@/lib/health-response";
import { collectSiteContentHealthInput } from "@/lib/site-content/site-content-health-authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const siteContentHealthInput = await collectSiteContentHealthInput();
  const now = new Date();
  return healthResponse(request, {
    siteContentHealthInput,
    siteContentNow: now,
  });
}
