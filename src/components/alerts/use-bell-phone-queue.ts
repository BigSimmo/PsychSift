"use client";

import { useEffect, useMemo } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { useLivePreview } from "@/components/live-version/live-version-provider";
import type { NotificationFeed } from "@/components/needs-you/use-notification-feed";
import { BELL_PHONE_QUEUE_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  bellPhoneQueueChanges,
  newBellPhoneRef,
  normalizeBellPhoneQueue,
  planBellPhoneAlerts,
  type BellPhoneQueued,
} from "@/lib/alerts/bell-phone";
import { isSharedDevice } from "@/lib/alerts/shared-device";

/**
 * Keeps the server's queue of this phone's bell reminders in step with the
 * bell. Runs wherever the bell reads its feed, so opening any work page is
 * enough. It sends only a random id, a time and this phone's alert link;
 * never a title, an area or the bell item's id. Best effort: a reminder that
 * can't be queued still shows in the bell.
 */

function readQueue(): BellPhoneQueued[] {
  try {
    const raw = window.localStorage.getItem(BELL_PHONE_QUEUE_STORAGE_KEY);
    return normalizeBellPhoneQueue(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

function writeQueue(queue: readonly BellPhoneQueued[]): void {
  try {
    if (queue.length) window.localStorage.setItem(BELL_PHONE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    else window.localStorage.removeItem(BELL_PHONE_QUEUE_STORAGE_KEY);
  } catch {
    // Storage refused: the next sync starts from what the server already holds or has sent.
  }
}

async function thisDeviceEndpoint(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager?.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

async function send(method: "POST" | "DELETE", body: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch("/api/alerts/reminders", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) return false;
    if (method === "DELETE") return true;
    return ((await response.json().catch(() => null)) as { queued?: boolean } | null)?.queued === true;
  } catch {
    return false;
  }
}

/** One sync at a time per tab, so two quick feed changes never queue the same reminder twice. */
let running: Promise<void> = Promise.resolve();

async function sync(
  wanted: ReturnType<typeof planBellPhoneAlerts>,
  complete: boolean,
  enabled: boolean,
): Promise<void> {
  const now = new Date();
  const queued = readQueue();
  if (!queued.length && !wanted.length) return;
  const endpoint = enabled ? await thisDeviceEndpoint() : null;
  // Turned off, or no alert link here (phone alerts off): queue nothing, and take off what this phone queued.
  const changes = endpoint
    ? bellPhoneQueueChanges(queued, wanted, now, complete, () => newBellPhoneRef())
    : bellPhoneQueueChanges(queued, [], now, true, () => newBellPhoneRef());
  const removedRefs = new Set<string>();
  for (const entry of changes.remove) {
    if (await send("DELETE", { ref: entry.ref })) removedRefs.add(entry.ref);
  }
  const added: BellPhoneQueued[] = [];
  if (endpoint) {
    for (const entry of changes.add) {
      if (await send("POST", { ref: entry.ref, dueAt: entry.dueAt, endpoint })) added.push(entry);
    }
  }
  const nowMs = now.getTime();
  // A removal that failed stays recorded, so the next sync tries again.
  const kept = queued.filter((entry) => !removedRefs.has(entry.ref) && Date.parse(entry.dueAt) > nowMs);
  writeQueue([...kept, ...added]);
}

export function useBellPhoneQueue(feed: NotificationFeed): void {
  const live = useLivePreview("phone-bell-alerts");
  const { preferences } = useAppPreferences();
  const settings = preferences.reminders;
  // Offline, or the bell still loading: wait, rather than mistake an unread reminder for a gone one.
  const ready = feed.status === "ready" && feed.online;
  const complete =
    ready && feed.sources.every((source) => source.status === "ready" || source.status === "unavailable");

  const sampleIds = useMemo(
    () =>
      new Set(feed.sources.filter((source) => source.sample).flatMap((source) => source.items.map((item) => item.id))),
    [feed.sources],
  );
  const enabled = live && settings.bellPhone.enabled && !isSharedDevice();
  const wanted = useMemo(
    () => (enabled ? planBellPhoneAlerts(feed.summary.visible, settings, feed.now, sampleIds) : []),
    [enabled, feed.summary.visible, settings, feed.now, sampleIds],
  );
  // Only the plan's content matters: a fresh array with the same entries does not resync.
  const signature = JSON.stringify(wanted);

  useEffect(() => {
    if (!ready || typeof fetch !== "function") return;
    const plan = JSON.parse(signature) as typeof wanted;
    running = running.then(() => sync(plan, complete, enabled)).catch(() => undefined);
  }, [ready, complete, enabled, signature]);
}
