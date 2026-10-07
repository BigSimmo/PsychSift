import "server-only";

import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { PROXY_AUTH_USER_HEADER } from "@/lib/supabase/auth";
import type { LivePreviewFeatureId } from "@/lib/live-version/features";
import { LIVE_VERSION_COOKIE, resolveLiveVersion, type LiveVersion } from "@/lib/live-version/live-version";
import { proxyVerifiedLaunchUser } from "@/lib/work-mode-launch/server";

/** The live version for this request, for server components and layouts. */
export async function getLiveVersion(): Promise<LiveVersion> {
  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);
  return resolveLiveVersion({
    user: proxyVerifiedLaunchUser(headerStore.get(PROXY_AUTH_USER_HEADER)),
    environment: process.env,
    choice: cookieStore.get(LIVE_VERSION_COOKIE)?.value ?? null,
  });
}

/**
 * True when this request gets the preview feature. Every feature shares the one
 * switch; the id ties the gate to its entry in `features.ts`.
 */
export async function isLivePreviewOn(feature: LivePreviewFeatureId): Promise<boolean> {
  void feature;
  return (await getLiveVersion()).newest;
}

/** For a page that exists only in the newest version: a 404 for everyone else. */
export async function requireLivePreview(feature: LivePreviewFeatureId): Promise<void> {
  if (!(await isLivePreviewOn(feature))) notFound();
}
