import { NextResponse, type NextRequest } from "next/server";

import { TEACHING_SAMPLE_COOKIE, teachingSampleReturnPath } from "@/lib/teaching/sample-paths";

/*
 * `/teaching/sample` is kept so old links and bookmarks land safely: it clears
 * the retired Teaching-only sample cookie and returns the reader to the Teaching
 * page they came from (`next`). Example data is now the one switch in Settings
 * and the banner under each work area's band.
 */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: teachingSampleReturnPath(params.get("next")), "Cache-Control": "no-store" },
  });
  // Nothing sets the Teaching-only sample cookie any more (the one example data
  // switch replaced it), so this only clears an old one.
  response.cookies.delete(TEACHING_SAMPLE_COOKIE);
  return response;
}
