/* PsychSift service worker.
 *
 * Privacy is the primary cache rule: navigations, RSC payloads, APIs, auth,
 * documents, queries, uploads, signed URLs, range requests, and cross-origin
 * traffic are always network-only. CacheStorage is limited to the generic
 * offline page and explicitly allow-listed public application assets.
 */

const CACHE_PREFIX = "clinical-kb-pwa-";
const CACHE_VERSION = "2026-09-28-v2";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`;
const STATIC_CACHE_PREFIX = `${CACHE_PREFIX}static-`;
const CURRENT_CACHES = new Set([SHELL_CACHE, STATIC_CACHE]);
const OFFLINE_URL = "/offline.html";
const MAX_STATIC_ENTRIES = 128;
const MAX_SHELL_ENTRIES = 16;
const MAX_RETAINED_STATIC_CACHES = 2;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function hasSensitiveRequestSignals(request, url) {
  return (
    request.method !== "GET" ||
    !isSameOrigin(url) ||
    url.search !== "" ||
    request.cache === "no-store" ||
    request.headers.get("cache-control")?.toLowerCase().includes("no-store") ||
    request.headers.has("authorization") ||
    request.headers.has("range")
  );
}

function isImmutableNextAsset(request, url) {
  if (hasSensitiveRequestSignals(request, url)) return false;
  if (!url.pathname.startsWith("/_next/static/")) return false;
  return ["font", "script", "style", "worker"].includes(request.destination);
}

function isPublicPwaAsset(request, url) {
  if (hasSensitiveRequestSignals(request, url)) return false;
  return (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/apple-icon" ||
    url.pathname.startsWith("/icons/")
  );
}

function responseHasSafePublicMetadata(request, response) {
  if (!response || response.status !== 200 || response.type !== "basic" || response.redirected) return false;

  if (response.url) {
    const requestUrl = new URL(request.url);
    const responseUrl = new URL(response.url);
    if (!isSameOrigin(responseUrl) || responseUrl.pathname !== requestUrl.pathname || responseUrl.search !== "") {
      return false;
    }
  }

  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  const contentDisposition = response.headers.get("content-disposition")?.toLowerCase() ?? "";
  const vary =
    response.headers
      .get("vary")
      ?.toLowerCase()
      .split(",")
      .map((value) => value.trim()) ?? [];

  return (
    !cacheControl.includes("no-store") &&
    !cacheControl.includes("private") &&
    !contentDisposition.startsWith("attachment") &&
    !vary.some((value) => value === "*" || value === "cookie" || value === "authorization") &&
    !response.headers.has("set-cookie") &&
    !response.headers.has("www-authenticate")
  );
}

function responseMatchesExpectedRuntimeType(request, response) {
  const pathname = new URL(request.url).pathname;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  if (pathname.startsWith("/_next/static/")) {
    if (request.destination === "style") return contentType === "text/css";
    if (request.destination === "font") {
      return (
        contentType.startsWith("font/") ||
        contentType.startsWith("application/font-") ||
        contentType === "application/vnd.ms-fontobject" ||
        contentType === "application/octet-stream"
      );
    }
    return [
      "application/ecmascript",
      "application/javascript",
      "application/x-javascript",
      "text/ecmascript",
      "text/javascript",
    ].includes(contentType);
  }

  if (pathname === "/manifest.webmanifest") {
    return contentType === "application/manifest+json" || contentType === "application/json";
  }
  if (pathname === "/icon.svg") return contentType === "image/svg+xml";
  if (pathname === "/apple-icon" || pathname.startsWith("/icons/")) return contentType === "image/png";
  return false;
}

function responseCanBeStored(request, response) {
  if (!responseHasSafePublicMetadata(request, response)) return false;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return (
    !contentType.startsWith("text/html") &&
    !contentType.startsWith("application/xhtml+xml") &&
    responseMatchesExpectedRuntimeType(request, response)
  );
}

function responseCanBePrecached(request, response, allowedContentTypes) {
  if (!responseHasSafePublicMetadata(request, response)) return false;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return allowedContentTypes.includes(contentType);
}

function withoutCredentials(request) {
  return new Request(request, { credentials: "omit" });
}

function shouldBypassCacheRead(request) {
  const requestCacheControl = request.headers.get("cache-control")?.toLowerCase() ?? "";
  return (
    request.cache === "reload" ||
    request.cache === "no-cache" ||
    requestCacheControl.includes("no-cache") ||
    requestCacheControl.includes("max-age=0")
  );
}

async function safeCacheNames() {
  try {
    return await caches.keys();
  } catch {
    return [];
  }
}

async function safeCacheMatch(cacheName, request) {
  try {
    const cache = await caches.open(cacheName);
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

async function matchOwnedStatic(request) {
  const current = await safeCacheMatch(STATIC_CACHE, request);
  if (current) return current;

  const retainedNames = (await safeCacheNames())
    .filter((name) => name.startsWith(STATIC_CACHE_PREFIX) && name !== STATIC_CACHE)
    .slice(-MAX_RETAINED_STATIC_CACHES)
    .reverse();
  for (const cacheName of retainedNames) {
    const retained = await safeCacheMatch(cacheName, request);
    if (retained) return retained;
  }
  return undefined;
}

async function putBounded(cacheName, request, response, maxEntries, protectedPathnames = []) {
  const cache = await caches.open(cacheName);
  await cache.delete(request);
  await cache.put(request, response);
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  if (excess > 0) {
    const protectedPaths = new Set(protectedPathnames);
    const removable = keys.filter((key) => !protectedPaths.has(new URL(key.url).pathname));
    await Promise.all(removable.slice(0, excess).map((key) => cache.delete(key)));
  }
}

async function cacheFirst(event) {
  const cached = shouldBypassCacheRead(event.request) ? undefined : await matchOwnedStatic(event.request);
  if (cached) return cached;

  const publicRequest = withoutCredentials(event.request);
  const response = await fetch(publicRequest);
  if (responseCanBeStored(publicRequest, response)) {
    event.waitUntil(
      putBounded(STATIC_CACHE, event.request, response.clone(), MAX_STATIC_ENTRIES).catch(() => undefined),
    );
  }
  return response;
}

async function staleWhileRevalidate(event, cacheName, maxEntries) {
  const cached = shouldBypassCacheRead(event.request) ? undefined : await safeCacheMatch(cacheName, event.request);
  const publicRequest = withoutCredentials(event.request);
  const network = fetch(publicRequest).then((response) => {
    if (responseCanBeStored(publicRequest, response)) {
      event.waitUntil(
        putBounded(cacheName, event.request, response.clone(), maxEntries, [OFFLINE_URL]).catch(() => undefined),
      );
    }
    return response;
  });

  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  return network;
}

function emergencyOfflineResponse() {
  return new Response(
    '<!doctype html><html lang="en-AU"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PsychSift is offline</title><body><main><h1>PsychSift is offline</h1><p>Reconnect to continue. No clinical content is stored in the offline fallback.</p><p><a href="/">Try again</a></p></main></body></html>',
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'self'",
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

const NAVIGATION_TIMEOUT_MS = 3500;

function withNavigationTimeout(promise) {
  if (typeof setTimeout === "undefined") return promise;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Navigation network timeout")), NAVIGATION_TIMEOUT_MS);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (typeof clearTimeout !== "undefined") clearTimeout(timer);
  });
}

async function handleNavigation(event) {
  try {
    // One deadline covers navigation preload as well as the network fetch: a preload that never
    // settles on a dead or captive connection must still fall back to the offline page.
    return await withNavigationTimeout(
      (async () => {
        const preloaded = event.preloadResponse ? await event.preloadResponse.catch(() => null) : null;
        return preloaded ?? fetch(event.request);
      })(),
    );
  } catch {
    return (await safeCacheMatch(SHELL_CACHE, OFFLINE_URL)) ?? emergencyOfflineResponse();
  }
}

async function precachePublicAsset(cache, path, allowedContentTypes) {
  const request = new Request(path, { cache: "reload", credentials: "omit" });
  const response = await fetch(request);
  if (!responseCanBePrecached(request, response, allowedContentTypes)) {
    throw new TypeError(`Unsafe PWA precache response for ${path}`);
  }
  await cache.put(request, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await precachePublicAsset(cache, OFFLINE_URL, ["text/html"]);
      await Promise.allSettled([
        precachePublicAsset(cache, "/icon.svg", ["image/svg+xml"]),
        precachePublicAsset(cache, "/manifest.webmanifest", ["application/manifest+json", "application/json"]),
      ]);
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await safeCacheNames();
      const retainedStaticCaches = new Set(
        names
          .filter((name) => name.startsWith(STATIC_CACHE_PREFIX) && name !== STATIC_CACHE)
          .sort()
          .slice(-MAX_RETAINED_STATIC_CACHES),
      );
      await Promise.allSettled(
        names
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(name) && !retainedStaticCaches.has(name),
          )
          .map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Navigation preload is an optimization; activation must remain usable
          // when a browser exposes the API but rejects enabling it.
        }
      }
      try {
        await self.clients.claim();
      } catch {
        // A later navigation can still become controlled. Do not strand the
        // update in activation because immediate claiming was unavailable.
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Push payloads carry one type code only. The worker owns every word and click
// destination, so a server response can never put a name or arbitrary URL on
// the lock screen.
const ROSTER_PUSH = {
  changed: { body: "Your roster changed. Open Roster to see what moved.", path: "/roster" },
  request: { body: "Something in Roster is waiting for you.", path: "/roster/swaps" },
  offer: { body: "A shift is open in your team. Open Roster to see it.", path: "/roster/swaps" },
  manage: { body: "Something in Manage is waiting for you.", path: "/roster/manage" },
  test: { title: "PsychSift", body: "Test alert. Phone alerts are working on this device.", path: "/my-day/alerts" },
  // The timed sender. A reminder's words stay on the phone, so the lock screen never shows them.
  brief: { title: "PsychSift", body: "Your morning brief is ready.", path: "/my-day" },
  reminder: {
    title: "PsychSift",
    body: "A reminder you set is due. Open PsychSift to see it.",
    path: "/my-day/alerts",
  },
};

// Open PsychSift pages hear which kind of alert arrived (the code only), so the
// Alerts page can say a test reached this device.
async function tellOpenPages(code) {
  try {
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const page of pages) page.postMessage({ type: "psychsift-push", t: code });
  } catch {
    // Telling the page is a courtesy; the notification still shows.
  }
}

self.addEventListener("push", (event) => {
  let code = "changed";
  try {
    const candidate = event.data?.json()?.t;
    if (Object.hasOwn(ROSTER_PUSH, candidate)) code = candidate;
  } catch {
    // A malformed push still shows a generic notification.
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(ROSTER_PUSH[code].title ?? "Roster", {
        body: ROSTER_PUSH[code].body,
        data: { t: code },
      }),
      tellOpenPages(code),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const candidate = event.notification.data?.t;
  const code = Object.hasOwn(ROSTER_PUSH, candidate) ? candidate : "changed";
  event.waitUntil(self.clients.openWindow(ROSTER_PUSH[code].path));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  // A normal dev session never persists HMR/chunk responses. The `?pwa-dev=1`
  // browser test still exercises registration and the offline navigation shell.
  if (LOCAL_HOSTS.has(self.location.hostname)) return;

  if (isImmutableNextAsset(request, url)) {
    event.respondWith(cacheFirst(event));
    return;
  }

  if (isPublicPwaAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(event, SHELL_CACHE, MAX_SHELL_ENTRIES));
  }
});
