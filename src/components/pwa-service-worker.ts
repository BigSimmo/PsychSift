import type { Dispatch, RefObject, SetStateAction } from "react";

const SERVICE_WORKER_URL = "/sw.js";
const PWA_CACHE_PREFIX = "clinical-kb-pwa-";
/**
 * How often an open app asks for a newer service worker. It was an hour, and only on a
 * tab becoming visible or the network returning, so a ward computer left on one page, or a
 * phone app resumed within the hour, kept running the old build after a release (the stale
 * PWA Josh reported, 7 October 2026). Ten minutes, checked on visibility, focus, a
 * back-forward restore and a timer while visible, costs one small no-cache fetch of sw.js.
 */
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const UPDATE_DISMISSAL_KEY = "clinical-kb-pwa-update-dismissed-at";
const UPDATE_DISMISSAL_MS = 6 * 60 * 60 * 1000;

export function wasUpdateRecentlyDismissed(token: string) {
  try {
    const key = `${UPDATE_DISMISSAL_KEY}:${token}`;
    const dismissedAt = Number(window.localStorage.getItem(key));
    if (!Number.isFinite(dismissedAt) || dismissedAt <= 0) return false;
    if (Date.now() - dismissedAt < UPDATE_DISMISSAL_MS) return true;
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private/restricted contexts. Re-offering the update is the
    // safe failure: the notice is an offer, and showing it twice costs less than never showing it.
  }
  return false;
}

export function rememberUpdateDismissal(token: string) {
  try {
    const key = `${UPDATE_DISMISSAL_KEY}:${token}`;
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    // See above: the in-session ref still suppresses it for this page view.
  }
}

/** Ask the installed worker itself; fetching /sw.js could name a later release than the waiting one. */
export async function workerUpdateToken(worker: ServiceWorker | null): Promise<string | null> {
  if (!worker?.scriptURL) return null;
  const scriptURL = worker.scriptURL;
  if (typeof MessageChannel === "undefined") return null;
  const version = await new Promise<string | null>((resolve) => {
    const channel = new MessageChannel();
    const finish = (value: string | null) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve(value);
    };
    // Workers from before the version handshake must not leave the notice waiting indefinitely.
    const timeout = window.setTimeout(() => finish(null), 1_000);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { type?: unknown; version?: unknown } | null;
      if (data?.type !== "PWA_VERSION" || typeof data.version !== "string") return;
      finish(/^[a-z0-9._-]{1,128}$/i.test(data.version) ? data.version : null);
    };
    try {
      worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
  // An unknown release must never share a persistent dismissal with every
  // subsequent release at /sw.js. Its worker object is the in-page identity.
  return version ? `${scriptURL}#${version}` : null;
}

export async function teardownLocalPwa() {
  try {
    // Exact-match the owned worker URL: a suffix check would also catch an
    // unrelated same-origin worker registered at a nested path like
    // /other-app/sw.js.
    const ownedWorkerUrl = new URL(SERVICE_WORKER_URL, window.location.origin).href;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      registrations
        .filter((registration) =>
          [registration.active, registration.waiting, registration.installing].some(
            (worker) => worker?.scriptURL === ownedWorkerUrl,
          ),
        )
        .map((registration) => registration.unregister()),
    );
    if ("caches" in window) {
      const cacheNames = await window.caches.keys();
      await Promise.allSettled(
        cacheNames.filter((name) => name.startsWith(PWA_CACHE_PREFIX)).map((name) => window.caches.delete(name)),
      );
    }
  } catch {
    // Teardown is a local-dev convenience; on failure the documented manual
    // DevTools path in docs/pwa.md still applies.
  }
}

export type ServiceWorkerLifecycleContext = {
  dismissedUpdateTokenRef: RefObject<string | null | undefined>;
  dismissedUpdateWorkerRef: RefObject<ServiceWorker | null>;
  hasSeenControllerRef: RefObject<boolean>;
  lastUpdateCheckRef: RefObject<number>;
  refreshRequestedRef: RefObject<boolean>;
  registrationRef: RefObject<ServiceWorkerRegistration | null>;
  reloadingRef: RefObject<boolean>;
  setActivatedUpdateReady: Dispatch<SetStateAction<boolean>>;
  setWaitingWorker: Dispatch<SetStateAction<ServiceWorker | null>>;
  updateTokenRef: RefObject<string | null>;
  updateWorkerRef: RefObject<ServiceWorker | null>;
  /** A controller change observed while this module was still loading. */
  missedControllerChange: boolean;
};

/** Register the worker and surface updates; returns the effect cleanup. */
export function startServiceWorkerLifecycle({
  dismissedUpdateTokenRef,
  dismissedUpdateWorkerRef,
  hasSeenControllerRef,
  lastUpdateCheckRef,
  refreshRequestedRef,
  registrationRef,
  reloadingRef,
  setActivatedUpdateReady,
  setWaitingWorker,
  updateTokenRef,
  updateWorkerRef,
  missedControllerChange,
}: ServiceWorkerLifecycleContext): () => void {
  let cancelled = false;
  let updateRequest = 0;
  let cancelScheduledRegistration: () => void = () => {};
  const registrationCleanups = new Set<() => void>();

  let broadcastChannel: BroadcastChannel | null = null;
  let pendingActivatedUpdate = false;
  try {
    broadcastChannel = new BroadcastChannel("pwa_channel");
    broadcastChannel.addEventListener("message", (event) => {
      if (event.data === "sw-updated" && !cancelled) {
        const controller = navigator.serviceWorker.controller;
        if (controller) void exposeActivatedUpdate(controller);
        else pendingActivatedUpdate = true;
      }
    });
  } catch {
    // Swallowing is correct: BroadcastChannel is unsupported in some embedded/private
    // browsing contexts; cross-tab update notices are a progressive enhancement.
  }

  const isDismissed = (worker: ServiceWorker | null, token: string | null) =>
    (worker !== null && dismissedUpdateWorkerRef.current === worker) ||
    (token !== null && (dismissedUpdateTokenRef.current === token || wasUpdateRecentlyDismissed(token)));

  const exposeUpdate = async (worker: ServiceWorker | null, activated: boolean) => {
    if (cancelled || (!worker && !activated)) return;
    const request = ++updateRequest;
    if (updateWorkerRef.current !== worker) {
      // The previous waiting worker may now be redundant. Remove its Reload
      // action while identifying the replacement, including dismissed releases.
      setWaitingWorker(null);
      setActivatedUpdateReady(false);
    }
    const token = await workerUpdateToken(worker);
    if (cancelled || request !== updateRequest) return;
    // A waiting worker can activate or be superseded during the version lookup;
    // never aim Reload at a worker that is no longer the installed, waiting one.
    if (!activated && worker?.state !== "installed") return;
    updateTokenRef.current = token;
    updateWorkerRef.current = worker;
    const dismissed = isDismissed(worker, token);
    setWaitingWorker(dismissed || activated ? null : worker);
    setActivatedUpdateReady(!dismissed && activated);
  };

  const exposeActivatedUpdate = async (controller: ServiceWorker) => {
    await exposeUpdate(controller, true);
    // A newer waiting worker supersedes the activated notice, but a waiting
    // worker the user already dismissed must not hide the activated release.
    const waiting = registrationRef.current?.waiting;
    if (cancelled || !waiting || waiting === controller) return;
    const token = await workerUpdateToken(waiting);
    if (cancelled || registrationRef.current?.waiting !== waiting) return;
    if (!isDismissed(waiting, token)) await exposeUpdate(waiting, false);
  };

  const watchInstallingWorker = (registration: ServiceWorkerRegistration) => {
    const worker = registration.installing;
    if (!worker) return;
    const handleStateChange = () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        void exposeUpdate(registration.waiting ?? worker, false);
      }
    };
    worker.addEventListener("statechange", handleStateChange);
    registrationCleanups.add(() => worker.removeEventListener("statechange", handleStateChange));
  };

  const checkForUpdates = () => {
    const registration = registrationRef.current;
    if (!registration || document.visibilityState !== "visible" || !navigator.onLine) return;
    if (Date.now() - lastUpdateCheckRef.current < UPDATE_CHECK_INTERVAL_MS) return;
    lastUpdateCheckRef.current = Date.now();
    void registration.update().catch(() => undefined);
  };

  const handleControllerChange = () => {
    if (reloadingRef.current) return;
    const wasPreviouslyControlled = hasSeenControllerRef.current;
    hasSeenControllerRef.current = true;
    if (refreshRequestedRef.current) {
      reloadingRef.current = true;
      window.location.reload();
      return;
    }
    setWaitingWorker(null);
    const controller = navigator.serviceWorker.controller;
    if (!cancelled && controller && (wasPreviouslyControlled || pendingActivatedUpdate)) {
      pendingActivatedUpdate = false;
      void exposeActivatedUpdate(controller);
      try {
        broadcastChannel?.postMessage("sw-updated");
      } catch {
        // Swallowing is correct: postMessage throws once the channel is closed during
        // teardown; the local setActivatedUpdateReady above already handled this tab.
      }
    }
  };

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
        scope: "/",
        updateViaCache: "none",
      });
      if (cancelled) return;
      registrationRef.current = registration;
      void exposeUpdate(registration.waiting, false);
      watchInstallingWorker(registration);
      const handleUpdateFound = () => watchInstallingWorker(registration);
      registration.addEventListener("updatefound", handleUpdateFound);
      registrationCleanups.add(() => registration.removeEventListener("updatefound", handleUpdateFound));
      lastUpdateCheckRef.current = Date.now();
    } catch (error) {
      if (process.env.NODE_ENV === "development") console.warn("PsychSift PWA registration failed", error);
    }
  };

  const scheduleRegistration = () => {
    const idleWindow = window as unknown as {
      cancelIdleCallback?: Window["cancelIdleCallback"];
      requestIdleCallback?: Window["requestIdleCallback"];
    };
    const requestIdle = idleWindow.requestIdleCallback?.bind(window);
    const cancelIdle = idleWindow.cancelIdleCallback?.bind(window);

    if (requestIdle && cancelIdle) {
      const idleId = requestIdle(() => void register(), { timeout: 2_000 });
      cancelScheduledRegistration = () => cancelIdle(idleId);
    } else {
      const timeoutId = window.setTimeout(() => void register(), 0);
      cancelScheduledRegistration = () => window.clearTimeout(timeoutId);
    }
  };

  const handleLoad = () => scheduleRegistration();
  if (document.readyState === "complete") scheduleRegistration();
  else window.addEventListener("load", handleLoad, { once: true });

  navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
  // Replay an activation (including one from another tab's skipWaiting) that
  // happened before these listeners existed.
  if (missedControllerChange) handleControllerChange();
  document.addEventListener("visibilitychange", checkForUpdates);
  window.addEventListener("online", checkForUpdates);
  window.addEventListener("focus", checkForUpdates);
  window.addEventListener("pageshow", checkForUpdates);
  const updateTimer = window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);

  return () => {
    cancelled = true;
    cancelScheduledRegistration();
    for (const cleanup of registrationCleanups) cleanup();
    registrationCleanups.clear();
    window.removeEventListener("load", handleLoad);
    navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    document.removeEventListener("visibilitychange", checkForUpdates);
    window.removeEventListener("online", checkForUpdates);
    window.removeEventListener("focus", checkForUpdates);
    window.removeEventListener("pageshow", checkForUpdates);
    window.clearInterval(updateTimer);
    registrationRef.current = null;
    try {
      broadcastChannel?.close();
    } catch {
      // Swallowing is correct: close() on an already-closed channel throws in some
      // browsers; there is nothing to recover during effect cleanup.
    }
  };
}
