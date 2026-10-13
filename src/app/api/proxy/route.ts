import { NextResponse } from "next/server";
import { verifyProxyAuthSecret } from "@/lib/supabase/proxy-auth-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = verifyProxyAuthSecret(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({ ok: true, message: "Proxy endpoint authenticated" });
}

export async function POST(request: Request) {
  const auth = verifyProxyAuthSecret(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({ ok: true, message: "Proxy endpoint authenticated" });
}
