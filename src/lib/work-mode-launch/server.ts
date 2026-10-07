import "server-only";

import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { PROXY_AUTH_USER_HEADER } from "@/lib/supabase/auth";
import { verifyProxyAuthHeader } from "@/lib/supabase/proxy-auth-crypto";
import {
  resolveWorkModeLaunch,
  WORK_MODE_PREFERENCE_COOKIE,
  type WorkModeLaunch,
  type WorkModeLaunchUser,
} from "@/lib/work-mode-launch/launch";

/**
 * The signed-in user as the proxy verified them for this request (id and app
 * metadata only). The proxy strips any client-sent copy of the header and signs
 * its own, so a forged header fails verification and reads as signed out.
 */
export function proxyVerifiedLaunchUser(headerValue: string | null | undefined): WorkModeLaunchUser | null {
  if (!headerValue) return null;
  try {
    const verified = verifyProxyAuthHeader(headerValue);
    if (!verified) return null;
    const parsed = JSON.parse(Buffer.from(verified, "base64").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { id, appMetadata } = parsed as { id?: unknown; appMetadata?: unknown };
    if (typeof id !== "string" || !id || !appMetadata || typeof appMetadata !== "object") return null;
    return { id, appMetadata: appMetadata as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** The launch state for this request, for server components and layouts. */
export async function getWorkModeLaunch(): Promise<WorkModeLaunch> {
  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);
  return resolveWorkModeLaunch({
    user: proxyVerifiedLaunchUser(headerStore.get(PROXY_AUTH_USER_HEADER)),
    environment: process.env,
    preference: cookieStore.get(WORK_MODE_PREFERENCE_COOKIE)?.value ?? null,
  });
}

/**
 * Belt and braces for a new-only page: the proxy already 404s it for readers on
 * the classic work mode, and this does the same from inside the page.
 */
export async function requireNewWorkMode(): Promise<void> {
  if (!(await getWorkModeLaunch()).newWorkMode) notFound();
}

/** The same for a page that runs wholly on labelled sample data. */
export async function requireSampleScreens(): Promise<void> {
  if (!(await getWorkModeLaunch()).sampleScreens) notFound();
}
