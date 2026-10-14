import { NextResponse } from "next/server";
import { publicErrorResponse } from "@/lib/http";
import { verifyProxyAuthSecret } from "@/lib/supabase/proxy-auth-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = verifyProxyAuthSecret(request);
  if (!auth.ok) {
    return publicErrorResponse(auth.error, auth.status);
  }
  return NextResponse.json({ ok: true, message: "Proxy endpoint authenticated" });
}

export async function POST(request: Request) {
  const auth = verifyProxyAuthSecret(request);
  if (!auth.ok) {
    return publicErrorResponse(auth.error, auth.status);
  }
  return NextResponse.json({ ok: true, message: "Proxy endpoint authenticated" });
}
