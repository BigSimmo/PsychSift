"use client";

import dynamic from "next/dynamic";
import { startEarlyInstallPromptCapture } from "@/lib/pwa-early-install-prompt";

/*
 * Root-layout helpers that draw nothing at rest: the PWA lifecycle notices (offline /
 * update / install, all shown later and only on a trigger) and the signed-in work sync.
 * Loading them just after the page keeps their modules out of every route's first
 * evaluation and hydration. The one-shot install prompt is still captured eagerly here
 * so it is not lost while the lifecycle chunk downloads.
 */
startEarlyInstallPromptCapture();
export const PwaLifecycleDeferred = dynamic(() => import("@/components/pwa-lifecycle").then((m) => m.PwaLifecycle), {
  ssr: false,
});
export const WorkAccountSyncDeferred = dynamic(
  () => import("@/components/work-sync/work-account-sync").then((m) => m.WorkAccountSync),
  { ssr: false },
);
