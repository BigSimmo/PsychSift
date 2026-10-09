import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

const WORKER_SOURCE = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
const OFFLINE_DOCUMENT = readFileSync(resolve(process.cwd(), "public/offline.html"), "utf8");
const PRODUCTION_ORIGIN = "https://app.clinical-kb.test";

type WorkerListener = (event: unknown) => void;
type NetworkHandler = (request: Request) => Promise<Response>;

interface WorkerRequestInit extends RequestInit {
  destination?: string;
}

function basicResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "type", { configurable: true, value: "basic" });
  return response;
}

class ExtendableEventHarness {
  private readonly lifetimePromises: Promise<unknown>[] = [];

  waitUntil(promise: Promise<unknown>): void {
    this.lifetimePromises.push(Promise.resolve(promise));
  }

  async settle(): Promise<void> {
    let settledCount = 0;
    while (settledCount < this.lifetimePromises.length) {
      const pending = this.lifetimePromises.slice(settledCount);
      settledCount = this.lifetimePromises.length;
      await Promise.all(pending);
    }
  }
}

class FetchEventHarness extends ExtendableEventHarness {
  readonly preloadResponse: Promise<Response | undefined>;
  responsePromise: Promise<Response> | undefined;

  constructor(
    readonly request: Request,
    preloadResponse?: Response | Promise<Response | undefined>,
  ) {
    super();
    this.preloadResponse = Promise.resolve(preloadResponse);
  }

  respondWith(response: Response | Promise<Response>): void {
    this.responsePromise = Promise.resolve(response);
  }
}

interface StoredCacheEntry {
  request: Request;
  response: Response;
}

interface CachePut {
  cacheName: string;
  url: string;
}

class CacheHarness {
  private readonly entries = new Map<string, StoredCacheEntry>();

  constructor(
    readonly name: string,
    private readonly origin: string,
    private readonly RequestConstructor: typeof Request,
    private readonly networkFetch: (input: RequestInfo | URL) => Promise<Response>,
    private readonly putLog: CachePut[],
  ) {}

  private toRequest(input: RequestInfo | URL): Request {
    return input instanceof Request ? input : new this.RequestConstructor(input);
  }

  private toUrl(input: RequestInfo | URL): string {
    if (input instanceof Request) return input.url;
    return new URL(String(input), this.origin).href;
  }

  async add(input: RequestInfo | URL): Promise<void> {
    const request = this.toRequest(input);
    const response = await this.networkFetch(request);
    if (!response.ok) throw new TypeError(`Cache.add failed with HTTP ${response.status}`);
    await this.put(request, response);
  }

  async delete(input: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.toUrl(input));
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.values()].map(({ request }) => request);
  }

  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(this.toUrl(input))?.response.clone();
  }

  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    const request = this.toRequest(input);
    this.entries.set(request.url, { request, response: response.clone() });
    this.putLog.push({ cacheName: this.name, url: request.url });
  }

  urls(): string[] {
    return [...this.entries.keys()].sort();
  }
}

class CacheStorageHarness {
  private readonly stores = new Map<string, CacheHarness>();
  readonly deletedNames: string[] = [];
  readonly putLog: CachePut[] = [];

  constructor(
    private readonly origin: string,
    private readonly RequestConstructor: typeof Request,
    private readonly networkFetch: (input: RequestInfo | URL) => Promise<Response>,
  ) {}

  async delete(name: string): Promise<boolean> {
    this.deletedNames.push(name);
    return this.stores.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async open(name: string): Promise<CacheHarness> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new CacheHarness(name, this.origin, this.RequestConstructor, this.networkFetch, this.putLog);
      this.stores.set(name, cache);
    }
    return cache;
  }

  entryUrls(): string[] {
    return [...this.stores.values()].flatMap((cache) => cache.urls()).sort();
  }

  clearMutationLog(): void {
    this.deletedNames.length = 0;
    this.putLog.length = 0;
  }
}

interface FetchDispatchResult {
  handled: boolean;
  response?: Response;
}

function createWorkerHarness(origin = PRODUCTION_ORIGIN) {
  const listeners = new Map<string, WorkerListener[]>();
  let networkHandler: NetworkHandler = async (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/offline.html") {
      return basicResponse(OFFLINE_DOCUMENT, {
        headers: { "Cache-Control": "public, max-age=0, must-revalidate", "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (pathname === "/icon.svg") {
      return basicResponse('<svg viewBox="0 0 64 64"></svg>', {
        headers: { "Cache-Control": "public, max-age=0", "Content-Type": "image/svg+xml" },
      });
    }
    if (pathname === "/manifest.webmanifest") {
      return basicResponse("{}", {
        headers: { "Cache-Control": "public, max-age=0", "Content-Type": "application/manifest+json" },
      });
    }
    return basicResponse(`public asset: ${pathname}`, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  };

  class WorkerRequest extends Request {
    constructor(input: RequestInfo | URL, init: WorkerRequestInit = {}) {
      const { destination, mode, ...nativeInit } = init;
      const resolvedInput = input instanceof Request ? input : new URL(String(input), origin);
      const requestInit: RequestInit = nativeInit;
      if (mode && mode !== "navigate") requestInit.mode = mode;
      super(resolvedInput, requestInit);

      if (mode === "navigate") {
        Object.defineProperty(this, "mode", { configurable: true, value: "navigate" });
      }
      Object.defineProperty(this, "destination", {
        configurable: true,
        value: destination ?? (input instanceof Request ? input.destination : ""),
      });
    }
  }

  const networkFetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new WorkerRequest(input);
    return networkHandler(request);
  });
  const cacheStorage = new CacheStorageHarness(origin, WorkerRequest, networkFetch);
  const enableNavigationPreload = vi.fn(async () => undefined);
  const claimClients = vi.fn(async () => undefined);
  const openWindow = vi.fn<(path: string) => Promise<undefined>>(async () => undefined);
  const showNotification = vi.fn<(title: string, options: unknown) => Promise<undefined>>(async () => undefined);
  const skipWaiting = vi.fn(async () => undefined);

  const workerGlobal = {
    addEventListener(type: string, listener: WorkerListener) {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    clients: { claim: claimClients, openWindow },
    location: new URL(origin),
    registration: { navigationPreload: { enable: enableNavigationPreload }, showNotification },
    skipWaiting,
  };

  runInContext(
    WORKER_SOURCE,
    createContext({
      URL,
      Headers,
      Request: WorkerRequest,
      Response,
      caches: cacheStorage,
      clearTimeout,
      console,
      fetch: networkFetch,
      self: workerGlobal,
      setTimeout,
    }),
    { filename: "public/sw.js" },
  );

  const dispatch = (type: string, event: unknown): void => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };

  return {
    Request: WorkerRequest,
    caches: cacheStorage,
    claimClients,
    openWindow,
    showNotification,
    enableNavigationPreload,
    networkFetch,
    skipWaiting,
    async activate(): Promise<void> {
      const event = new ExtendableEventHarness();
      dispatch("activate", event);
      await event.settle();
    },
    async dispatchFetch(
      request: Request,
      preloadResponse?: Response | Promise<Response | undefined>,
    ): Promise<FetchDispatchResult> {
      const event = new FetchEventHarness(request, preloadResponse);
      dispatch("fetch", event);

      if (!event.responsePromise) {
        await event.settle();
        return { handled: false };
      }

      const response = await event.responsePromise;
      await event.settle();
      return { handled: true, response };
    },
    async install(): Promise<void> {
      const event = new ExtendableEventHarness();
      dispatch("install", event);
      await event.settle();
    },
    message(data: unknown): void {
      dispatch("message", { data });
    },
    async push(data?: unknown): Promise<void> {
      const event = new ExtendableEventHarness() as ExtendableEventHarness & { data?: { json: () => unknown } };
      if (data !== undefined) event.data = { json: () => data };
      dispatch("push", event);
      await event.settle();
    },
    async clickNotification(data: unknown): Promise<void> {
      const event = new ExtendableEventHarness() as ExtendableEventHarness & {
        notification?: { data: unknown; close: () => void };
      };
      event.notification = { data, close: vi.fn() };
      dispatch("notificationclick", event);
      await event.settle();
    },
    setNetworkHandler(handler: NetworkHandler): void {
      networkHandler = handler;
    },
  };
}

describe("PWA service worker cache and lifecycle policy", () => {
  it("shows fixed Roster words for a type code and never follows a payload URL", async () => {
    const worker = createWorkerHarness();
    await worker.push({ t: "offer", url: "https://elsewhere.example/steal" });
    expect(worker.showNotification).toHaveBeenCalledWith("Roster", {
      body: "A shift is open in your team. Open Roster to see it.",
      data: { t: "offer" },
    });
    await worker.clickNotification({ t: "offer", url: "https://elsewhere.example/steal" });
    expect(worker.openWindow).toHaveBeenCalledWith("/roster/swaps");
  });

  it("shows one fixed line for a bell reminder that names nothing, and opens Notifications", async () => {
    const worker = createWorkerHarness();
    await worker.push({ t: "due", title: "Contract ends", url: "https://elsewhere.example/steal" });
    expect(worker.showNotification).toHaveBeenCalledWith("PsychSift", {
      body: "Something in My Day needs you. Open PsychSift to see it.",
      data: { t: "due" },
    });
    await worker.clickNotification({ t: "due", url: "https://elsewhere.example/steal" });
    expect(worker.openWindow).toHaveBeenCalledWith("/my-day/notifications");
  });

  it("uses generic Roster words when push data is missing or malformed", async () => {
    const worker = createWorkerHarness();
    await worker.push();
    await worker.push({ t: "unknown", url: "https://elsewhere.example/steal" });
    expect(worker.showNotification).toHaveBeenCalledTimes(2);
    for (const [, options] of worker.showNotification.mock.calls) {
      expect(options).toEqual({ body: "Your roster changed. Open Roster to see what moved.", data: { t: "changed" } });
    }
    await worker.clickNotification({ t: "unknown", url: "https://elsewhere.example/steal" });
    expect(worker.openWindow).toHaveBeenCalledWith("/roster");
  });
  it("precaches only the generic offline shell and public PWA identity assets during install", async () => {
    const worker = createWorkerHarness();

    await worker.install();

    const cacheNames = await worker.caches.keys();
    expect(cacheNames).toHaveLength(1);
    expect(cacheNames[0]).toMatch(/^clinical-kb-pwa-shell-/);
    expect(worker.caches.entryUrls()).toEqual([
      `${PRODUCTION_ORIGIN}/icon.svg`,
      `${PRODUCTION_ORIGIN}/manifest.webmanifest`,
      `${PRODUCTION_ORIGIN}/offline.html`,
    ]);

    const shellCache = await worker.caches.open(cacheNames[0]);
    const offlineResponse = await shellCache.match("/offline.html");
    expect(await offlineResponse?.text()).toBe(OFFLINE_DOCUMENT);
    expect(OFFLINE_DOCUMENT).toContain("PsychSift is offline");
    expect(OFFLINE_DOCUMENT).toMatch(/does not store or\s+replay clinical queries, answers, documents/);
    expect(worker.networkFetch).toHaveBeenCalledTimes(3);
    for (const [request] of worker.networkFetch.mock.calls) {
      expect((request as Request).credentials).toBe("omit");
    }
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it("fails installation instead of caching an unsafe required offline response", async () => {
    const worker = createWorkerHarness();
    worker.setNetworkHandler(async () =>
      basicResponse("<html>private gateway</html>", {
        headers: { "Cache-Control": "private", "Content-Type": "text/html; charset=utf-8" },
      }),
    );

    await expect(worker.install()).rejects.toThrow("Unsafe PWA precache response for /offline.html");
    expect(worker.caches.entryUrls()).toEqual([]);
  });

  it("keeps optional identity assets best-effort when one returns the wrong MIME type", async () => {
    const worker = createWorkerHarness();
    worker.setNetworkHandler(async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/offline.html") {
        return basicResponse(OFFLINE_DOCUMENT, {
          headers: { "Cache-Control": "public, max-age=0", "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === "/icon.svg") {
        return basicResponse("<svg></svg>", {
          headers: { "Cache-Control": "public, max-age=0", "Content-Type": "image/svg+xml" },
        });
      }
      return basicResponse("<html>not a manifest</html>", {
        headers: { "Cache-Control": "public, max-age=0", "Content-Type": "text/html; charset=utf-8" },
      });
    });

    await worker.install();

    expect(worker.caches.entryUrls()).toEqual([`${PRODUCTION_ORIGIN}/icon.svg`, `${PRODUCTION_ORIGIN}/offline.html`]);
  });

  it("deletes obsolete shell and older static caches while retaining two prior static versions", async () => {
    const worker = createWorkerHarness();
    await worker.install();
    const [currentShellCache] = await worker.caches.keys();
    const obsoleteShellCache = "clinical-kb-pwa-shell-2025-v1";
    const staticCaches = [
      "clinical-kb-pwa-static-2025-v1",
      "clinical-kb-pwa-static-2026-06-v1",
      "clinical-kb-pwa-static-2026-07-v1",
    ];
    const unrelatedCache = "another-product-cache-v4";

    for (const name of [obsoleteShellCache, ...staticCaches, unrelatedCache]) await worker.caches.open(name);
    worker.caches.clearMutationLog();

    await worker.activate();

    expect((await worker.caches.keys()).sort()).toEqual(
      [currentShellCache, ...staticCaches.slice(-2), unrelatedCache].sort(),
    );
    expect(worker.caches.deletedNames.sort()).toEqual([obsoleteShellCache, staticCaches[0]].sort());
    expect(worker.enableNavigationPreload).toHaveBeenCalledOnce();
    expect(worker.claimClients).toHaveBeenCalledOnce();
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it("calls skipWaiting only for an explicit SKIP_WAITING user message", async () => {
    const worker = createWorkerHarness();
    await worker.install();
    await worker.activate();

    worker.message(undefined);
    worker.message("SKIP_WAITING");
    worker.message({ type: "OTHER" });
    worker.message({ type: "skip_waiting" });
    expect(worker.skipWaiting).not.toHaveBeenCalled();

    worker.message({ type: "SKIP_WAITING" });
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it("returns the offline shell for a failed navigation without caching navigated HTML", async () => {
    const worker = createWorkerHarness();
    await worker.install();
    worker.caches.clearMutationLog();
    worker.networkFetch.mockClear();

    const onlineUrl = `${PRODUCTION_ORIGIN}/private/clinical-answer`;
    worker.setNetworkHandler(async (request) => {
      if (request.url === onlineUrl) {
        return basicResponse("<html><body>private answer</body></html>", {
          headers: { "Cache-Control": "private, no-store", "Content-Type": "text/html" },
        });
      }
      throw new TypeError("offline");
    });

    const onlineNavigation = await worker.dispatchFetch(
      new worker.Request(onlineUrl, { destination: "document", mode: "navigate" }),
    );
    expect(await onlineNavigation.response?.text()).toContain("private answer");
    expect(worker.caches.entryUrls()).not.toContain(onlineUrl);

    worker.setNetworkHandler(async () => {
      throw new TypeError("offline");
    });
    const failedUrl = `${PRODUCTION_ORIGIN}/documents/private-record`;
    const failedNavigation = await worker.dispatchFetch(
      new worker.Request(failedUrl, { destination: "document", mode: "navigate" }),
    );

    expect(failedNavigation.handled).toBe(true);
    expect(failedNavigation.response?.status).toBe(200);
    expect(await failedNavigation.response?.text()).toBe(OFFLINE_DOCUMENT);
    expect(worker.caches.entryUrls()).not.toContain(failedUrl);
    expect(worker.caches.putLog).toEqual([]);
  });

  it("serves the offline shell when navigation preload never settles", async () => {
    vi.useFakeTimers();
    try {
      const worker = createWorkerHarness();
      await worker.install();
      worker.setNetworkHandler(async () => {
        throw new TypeError("offline");
      });
      const pending = worker.dispatchFetch(
        new worker.Request(`${PRODUCTION_ORIGIN}/stalled`, { destination: "document", mode: "navigate" }),
        new Promise<Response | undefined>(() => undefined),
      );
      await vi.advanceTimersByTimeAsync(3500);
      const result = await pending;
      expect(result.handled).toBe(true);
      expect(await result.response?.text()).toBe(OFFLINE_DOCUMENT);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the in-memory emergency page when CacheStorage is unavailable offline", async () => {
    const worker = createWorkerHarness();
    worker.setNetworkHandler(async () => {
      throw new TypeError("offline");
    });
    vi.spyOn(worker.caches, "open").mockRejectedValue(new Error("CacheStorage unavailable"));

    const result = await worker.dispatchFetch(
      new worker.Request(`${PRODUCTION_ORIGIN}/cold-offline`, { mode: "navigate" }),
    );

    expect(result.handled).toBe(true);
    expect(result.response?.status).toBe(503);
    expect(await result.response?.text()).toContain("No clinical content is stored");
  });

  it("cache-first serves a production-host same-origin hashed static asset", async () => {
    const worker = createWorkerHarness();
    const assetUrl = `${PRODUCTION_ORIGIN}/_next/static/chunks/app-8f31c9a2.js`;
    worker.setNetworkHandler(async () =>
      basicResponse("self.__HASHED_CHUNK__ = true;", {
        headers: { "Cache-Control": "public, max-age=31536000, immutable", "Content-Type": "text/javascript" },
      }),
    );
    const request = new worker.Request(assetUrl, { destination: "script" });

    const first = await worker.dispatchFetch(request);
    const second = await worker.dispatchFetch(request);

    expect(first.handled).toBe(true);
    expect(second.handled).toBe(true);
    expect(await first.response?.text()).toContain("HASHED_CHUNK");
    expect(await second.response?.text()).toContain("HASHED_CHUNK");
    expect(worker.networkFetch).toHaveBeenCalledOnce();
    expect((worker.networkFetch.mock.calls[0]?.[0] as Request).credentials).toBe("omit");
    expect(worker.caches.entryUrls()).toEqual([assetUrl]);
    expect((await worker.caches.keys())[0]).toMatch(/^clinical-kb-pwa-static-/);
  });

  it("honours a reload request by bypassing an existing static-cache entry", async () => {
    const worker = createWorkerHarness();
    const assetUrl = `${PRODUCTION_ORIGIN}/_next/static/chunks/reload-8f31c9a2.js`;
    let revision = 1;
    worker.setNetworkHandler(async () =>
      basicResponse(`self.__REVISION__ = ${revision};`, {
        headers: { "Cache-Control": "public, max-age=31536000", "Content-Type": "text/javascript" },
      }),
    );

    await worker.dispatchFetch(new worker.Request(assetUrl, { destination: "script" }));
    revision = 2;
    const reloaded = await worker.dispatchFetch(
      new worker.Request(assetUrl, { cache: "reload", destination: "script" }),
    );

    expect(await reloaded.response?.text()).toContain("REVISION__ = 2");
    expect(worker.networkFetch).toHaveBeenCalledTimes(2);
  });

  it("falls through to the network when CacheStorage reads fail for an online static asset", async () => {
    const worker = createWorkerHarness();
    const assetUrl = `${PRODUCTION_ORIGIN}/_next/static/chunks/cache-failure-8f31c9a2.js`;
    vi.spyOn(worker.caches, "open").mockRejectedValue(new Error("CacheStorage unavailable"));
    worker.setNetworkHandler(async () =>
      basicResponse("self.__NETWORK_FALLBACK__ = true;", {
        headers: { "Cache-Control": "public, max-age=31536000", "Content-Type": "text/javascript" },
      }),
    );

    const result = await worker.dispatchFetch(new worker.Request(assetUrl, { destination: "script" }));

    expect(result.handled).toBe(true);
    expect(await result.response?.text()).toContain("NETWORK_FALLBACK");
    expect(worker.networkFetch).toHaveBeenCalledOnce();
  });

  it("serves a retained prior-version static chunk to an old tab after activation", async () => {
    const worker = createWorkerHarness();
    const assetUrl = `${PRODUCTION_ORIGIN}/_next/static/chunks/old-client-8f31c9a2.js`;
    const request = new worker.Request(assetUrl, { destination: "script" });
    const oldCache = await worker.caches.open("clinical-kb-pwa-static-2026-07-v0");
    await oldCache.put(
      request,
      basicResponse("self.__OLD_CLIENT_CHUNK__ = true;", {
        headers: { "Cache-Control": "public, max-age=31536000", "Content-Type": "text/javascript" },
      }),
    );
    worker.caches.clearMutationLog();
    worker.setNetworkHandler(async () => {
      throw new TypeError("old chunk no longer on origin");
    });

    await worker.activate();
    const result = await worker.dispatchFetch(request);

    expect(result.handled).toBe(true);
    expect(await result.response?.text()).toContain("OLD_CLIENT_CHUNK");
    expect(worker.networkFetch).not.toHaveBeenCalled();
  });

  it.each<{
    absoluteUrl?: string;
    cache?: RequestCache;
    destination?: string;
    headers?: Record<string, string>;
    label: string;
    method?: string;
    url?: string;
  }>([
    { label: "API", url: "/api/search" },
    { label: "auth", url: "/auth/callback" },
    { label: "private document", url: "/documents/private-record.pdf", destination: "document" },
    { label: "undefined PWA namespace", url: "/pwa/private-export.json", destination: "" },
    { label: "clinical query", url: "/search?q=lithium" },
    { label: "RSC payload", url: "/dashboard?_rsc=private-tree", headers: { RSC: "1" } },
    {
      label: "cross-origin static asset",
      absoluteUrl: "https://cdn.example.test/_next/static/chunks/app-8f31c9a2.js",
      destination: "script",
    },
    {
      label: "non-GET static request",
      url: "/_next/static/chunks/app-8f31c9a2.js",
      destination: "script",
      method: "POST",
    },
    {
      label: "authorized static request",
      url: "/_next/static/chunks/app-8f31c9a2.js",
      destination: "script",
      headers: { Authorization: "Bearer private-token" },
    },
    {
      label: "range static request",
      url: "/_next/static/media/font-8f31c9a2.woff2",
      destination: "font",
      headers: { Range: "bytes=0-99" },
    },
    {
      label: "query-string static request",
      url: "/_next/static/chunks/app-8f31c9a2.js?tenant=private",
      destination: "script",
    },
    {
      label: "no-store static request",
      url: "/_next/static/chunks/app-8f31c9a2.js",
      destination: "script",
      cache: "no-store",
    },
    // L67: the 51 same-origin /forms-pdf/*.pdf statutory forms (50 password-gated per
    // check:forms-pdf-manifest) are the largest sensitive static path on the origin, and this
    // table never exercised it. Correct by trace today (neither isImmutableNextAsset nor
    // isPublicPwaAsset matches /forms-pdf/), but unpinned until this row.
    { label: "statutory form PDF", url: "/forms-pdf/form-1a.pdf", destination: "document" },
  ])(
    "does not intercept or cache a $label request",
    async ({ absoluteUrl, cache, destination, headers, method, url }) => {
      const worker = createWorkerHarness();
      const request = new worker.Request(absoluteUrl ?? `${PRODUCTION_ORIGIN}${url}`, {
        cache,
        destination,
        headers: headers as HeadersInit | undefined,
        method,
      });

      const result = await worker.dispatchFetch(request);

      expect(result.handled).toBe(false);
      expect(worker.networkFetch).not.toHaveBeenCalled();
      expect(worker.caches.entryUrls()).toEqual([]);
      expect(worker.caches.putLog).toEqual([]);
    },
  );

  it("never prunes the required offline fallback while bounding shell assets", async () => {
    const worker = createWorkerHarness();
    await worker.install();
    worker.setNetworkHandler(async () =>
      basicResponse("png", {
        headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "image/png" },
      }),
    );

    for (let index = 0; index < 20; index += 1) {
      await worker.dispatchFetch(
        new worker.Request(`${PRODUCTION_ORIGIN}/icons/runtime-${index}`, { destination: "image" }),
      );
    }

    const shellEntries = worker.caches.entryUrls();
    expect(shellEntries).toContain(`${PRODUCTION_ORIGIN}/offline.html`);
    expect(shellEntries).toHaveLength(16);
  });

  it.each<{ headers: Record<string, string>; label: string }>([
    { label: "private", headers: { "Cache-Control": "private, max-age=31536000" } },
    { label: "no-store", headers: { "Cache-Control": "public, no-store, max-age=31536000" } },
    {
      label: "Set-Cookie",
      headers: { "Cache-Control": "public, max-age=31536000", "Set-Cookie": "session=private" },
    },
    { label: "HTML", headers: { "Content-Type": "text/html; charset=utf-8" } },
    { label: "wrong-MIME", headers: { "Content-Type": "application/json" } },
    { label: "cookie-varying", headers: { Vary: "Accept-Encoding, Cookie" } },
    { label: "authorization-varying", headers: { Vary: "Authorization" } },
    { label: "attachment", headers: { "Content-Disposition": 'attachment; filename="private.bin"' } },
    { label: "authentication-challenge", headers: { "WWW-Authenticate": 'Bearer realm="private"' } },
  ])("serves but never stores a $label response", async ({ headers, label }) => {
    const worker = createWorkerHarness();
    const assetUrl = `${PRODUCTION_ORIGIN}/_next/static/chunks/${label.toLowerCase()}-8f31c9a2.js`;
    worker.setNetworkHandler(async () =>
      basicResponse(`/* ${label} response */`, {
        headers: { "Content-Type": "text/javascript", ...headers },
      }),
    );

    const result = await worker.dispatchFetch(new worker.Request(assetUrl, { destination: "script" }));

    expect(result.handled).toBe(true);
    expect(await result.response?.text()).toContain(label);
    expect(worker.networkFetch).toHaveBeenCalledOnce();
    expect(worker.caches.entryUrls()).toEqual([]);
    expect(worker.caches.putLog).toEqual([]);
  });
});
