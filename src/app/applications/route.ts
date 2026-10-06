import { type NextRequest } from "next/server";

// "Tools" is the canonical name and /tools the canonical route (PT-11). A
// route handler redirects the incoming legacy request before React renders it.
export function GET(request: NextRequest) {
  return new Response(null, {
    status: 307,
    headers: { Location: `/tools${request.nextUrl.search}` },
  });
}

export const HEAD = GET;
