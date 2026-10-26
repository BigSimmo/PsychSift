import { isLocalProjectIdentityEndpointEnabled, localProjectRequestIdentityPayload } from "@/lib/local-project-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // Local-tooling only: the deployed site answers a bare 404 so it never echoes request
  // headers or this checkout's project identity to an anonymous caller.
  if (!isLocalProjectIdentityEndpointEnabled(request)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(localProjectRequestIdentityPayload(request), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
