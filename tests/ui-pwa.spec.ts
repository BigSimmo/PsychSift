import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "playwright/test";

const PWA_ENTRY = "/?pwa-dev=1";
const WORKER_PATH = "/sw.js";
const PWA_CACHE_PREFIX = "clinical-kb-pwa-";

type ManifestIcon = {
  src: string;
  type: string;
  sizes: string;
  purpose?: string;
};

type IconProbe = {
  src: string;
  status: number;
  mime: string;
  width: number | null;
  height: number | null;
  hasPngSignature: boolean | null;
};

async function openControlledPwa(page: Page) {
  await page.goto(PWA_ENTRY, { waitUntil: "load" });

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration("/");
          return registration?.active?.state ?? "missing";
        }),
      { message: "the root-scope PWA worker should activate", timeout: 30_000 },
    )
    .toBe("activated");

  // A controlled navigation gives Chromium a stable point at which to evaluate
  // the matching worker and avoids asserting transient installability errors.
  await page.reload({ waitUntil: "load" });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ""), {
      message: "the page should be controlled by the PWA worker",
      timeout: 15_000,
    })
    .toMatch(/\/sw\.js$/);
}

async function probeManifestIcons(page: Page, icons: ManifestIcon[]): Promise<IconProbe[]> {
  return page.evaluate(async (manifestIcons) => {
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

    return Promise.all(
      manifestIcons.map(async (icon) => {
        const response = await fetch(new URL(icon.src, window.location.origin), {
          cache: "no-store",
          credentials: "omit",
        });
        const body = await response.arrayBuffer();
        const bytes = new Uint8Array(body);
        const mime = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        let width: number | null = null;
        let height: number | null = null;
        let hasPngSignature: boolean | null = null;

        if (mime === "image/png") {
          hasPngSignature = pngSignature.every((byte, index) => bytes[index] === byte);
          if (hasPngSignature && bytes.length >= 24) {
            const view = new DataView(body);
            width = view.getUint32(16);
            height = view.getUint32(20);
          }
        } else if (mime === "image/svg+xml") {
          const svg = new TextDecoder().decode(bytes);
          const viewBox = svg.match(/viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
          width = viewBox ? Number(viewBox[1]) : null;
          height = viewBox ? Number(viewBox[2]) : null;
        }

        return {
          src: icon.src,
          status: response.status,
          mime,
          width,
          height,
          hasPngSignature,
        };
      }),
    );
  }, icons);
}

async function clearPwaBrowserState(context: BrowserContext, page: Page) {
  await context.setOffline(false);
  if (page.isClosed() || !page.url().startsWith("http")) return;

  await page.evaluate(async (cachePrefix) => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => registration.active?.scriptURL.endsWith("/sw.js"))
        .map((registration) => registration.unregister()),
    );
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.filter((cacheName) => cacheName.startsWith(cachePrefix)).map((cacheName) => caches.delete(cacheName)),
    );
  }, PWA_CACHE_PREFIX);
}

function isAllowedPublicCachePath(pathname: string) {
  return (
    pathname === "/offline.html" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.svg" ||
    pathname === "/apple-icon" ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/_next/static/")
  );
}

// The suite-wide Playwright config blocks service workers (they hijack navigations
// in production builds); this spec is the one place the worker itself is under test.
test.use({ serviceWorkers: "allow" });

test.describe("PsychSift PWA", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ browserName, context }) => {
    test.skip(browserName !== "chromium", "The installability protocol and focused PWA gate are Chromium-only.");

    // This gate validates the public application shell only. Block every local
    // API and provider request so browser QA cannot consume credentials, touch
    // live data, or make a clinical workflow look available offline.
    await context.route("**/api/**", (route) => route.abort("blockedbyclient"));
    await context.route(/^https:\/\/[^/]*\.supabase\.co\//i, (route) => route.abort("blockedbyclient"));
    await context.route(/^https:\/\/api\.openai\.com\//i, (route) => route.abort("blockedbyclient"));
  });

  test.afterEach(async ({ browserName, context, page }) => {
    if (browserName === "chromium") await clearPwaBrowserState(context, page);
  });

  test("has a browser-valid manifest, installable icons, and a root worker", async ({
    baseURL,
    channel,
    contextOptions,
    headless,
    launchOptions,
    viewport,
  }) => {
    if (!baseURL) throw new Error("PWA installability requires the configured Playwright baseURL");
    // Page.getInstallabilityErrors reports in-incognito for Playwright's usual
    // per-test context even when the manifest, icons, and worker are valid.
    const profileDir = await mkdtemp(join(tmpdir(), "psychsift-pwa-installability-"));
    let persistentContext: BrowserContext | null = null;
    try {
      persistentContext = await chromium.launchPersistentContext(profileDir, {
        ...launchOptions,
        ...contextOptions,
        channel,
        headless,
        viewport,
        baseURL,
        serviceWorkers: "allow",
      });
      const context = persistentContext;
      await context.route("**/api/**", (route) => route.abort("blockedbyclient"));
      await context.route(/^https:\/\/[^/]*\.supabase\.co\//i, (route) => route.abort("blockedbyclient"));
      await context.route(/^https:\/\/api\.openai\.com\//i, (route) => route.abort("blockedbyclient"));
      const page = context.pages()[0] ?? (await context.newPage());
      await openControlledPwa(page);

      const session = await context.newCDPSession(page);
      const appManifest = await session.send("Page.getAppManifest");
      expect(new URL(appManifest.url).pathname).toBe("/manifest.webmanifest");
      expect(appManifest.errors, JSON.stringify(appManifest.errors)).toEqual([]);
      expect(appManifest.data).toBeTruthy();

      const manifest = JSON.parse(appManifest.data ?? "{}") as {
        id?: string;
        start_url?: string;
        scope?: string;
        display?: string;
        icons?: ManifestIcon[];
      };
      expect(manifest).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone" });

      const icons = manifest.icons ?? [];
      expect(icons.length).toBeGreaterThanOrEqual(5);
      const probes = await probeManifestIcons(page, icons);
      const probesBySource = new Map(probes.map((probe) => [probe.src, probe]));

      for (const icon of icons) {
        const probe = probesBySource.get(icon.src);
        if (!probe) throw new Error(`Manifest icon was not probed: ${icon.src}`);

        expect(probe.status, icon.src).toBe(200);
        expect(probe.mime, icon.src).toBe(icon.type);
        expect(probe.width, icon.src).toBeGreaterThan(0);
        expect(probe.height, icon.src).toBeGreaterThan(0);

        if (icon.sizes !== "any") {
          const size = icon.sizes.match(/^(\d+)x(\d+)$/);
          expect(size, `${icon.src} should declare concrete dimensions`).not.toBeNull();
          expect(probe.width, icon.src).toBe(Number(size?.[1]));
          expect(probe.height, icon.src).toBe(Number(size?.[2]));
          expect(probe.hasPngSignature, icon.src).toBe(true);
        }
      }

      const workerResponse = await context.request.get(new URL(WORKER_PATH, page.url()).toString());
      expect(workerResponse.status()).toBe(200);
      const workerHeaders = workerResponse.headers();
      expect(workerHeaders["content-type"]).toMatch(/^application\/javascript\b/i);
      expect(workerHeaders["cache-control"]).toContain("no-cache");
      expect(workerHeaders["cache-control"]).toContain("no-store");
      expect(workerHeaders["service-worker-allowed"]).toBe("/");
      expect(workerHeaders["cross-origin-resource-policy"]).toBe("same-origin");
      expect(workerHeaders["content-security-policy"]).toContain("default-src 'self'");
      expect(workerHeaders["content-security-policy"]).toContain("script-src 'self'");
      expect(workerHeaders["set-cookie"]).toBeUndefined();

      const manifestResponse = await context.request.get(new URL("/manifest.webmanifest", page.url()).toString());
      expect(manifestResponse.status()).toBe(200);
      expect(manifestResponse.headers()["content-type"]).toMatch(/^application\/manifest\+json\b/i);
      expect(manifestResponse.headers()["cache-control"]).toContain("must-revalidate");
      expect(manifestResponse.headers()["set-cookie"]).toBeUndefined();

      const offlineDocumentResponse = await context.request.get(new URL("/offline.html", page.url()).toString());
      expect(offlineDocumentResponse.status()).toBe(200);
      expect(offlineDocumentResponse.headers()["content-security-policy"]).toContain("default-src 'none'");
      expect(offlineDocumentResponse.headers()["x-robots-tag"]).toBe("noindex, nofollow");
      expect(offlineDocumentResponse.headers()["set-cookie"]).toBeUndefined();

      const svgIconResponse = await context.request.get(new URL("/icon.svg", page.url()).toString());
      expect(svgIconResponse.status()).toBe(200);
      expect(svgIconResponse.headers()["content-type"]).toMatch(/^image\/svg\+xml\b/i);
      expect(svgIconResponse.headers()["set-cookie"]).toBeUndefined();

      const workerState = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return {
          origin: window.location.origin,
          scope: registration?.scope ?? null,
          scriptURL: registration?.active?.scriptURL ?? null,
          activeState: registration?.active?.state ?? null,
          updateViaCache: registration?.updateViaCache ?? null,
          controllerURL: navigator.serviceWorker.controller?.scriptURL ?? null,
        };
      });
      expect(workerState).toEqual({
        origin: workerState.origin,
        scope: `${workerState.origin}/`,
        scriptURL: `${workerState.origin}/sw.js`,
        activeState: "activated",
        updateViaCache: "none",
        controllerURL: `${workerState.origin}/sw.js`,
      });

      const workerVersion = await page.evaluate(
        () =>
          new Promise<unknown>((resolve, reject) => {
            const channel = new MessageChannel();
            const timeout = setTimeout(() => {
              channel.port1.close();
              channel.port2.close();
              reject(new Error("The active worker did not identify its release"));
            }, 5_000);
            channel.port1.onmessage = (event) => {
              clearTimeout(timeout);
              channel.port1.close();
              channel.port2.close();
              resolve(event.data);
            };
            navigator.serviceWorker.controller!.postMessage({ type: "GET_VERSION" }, [channel.port2]);
          }),
      );
      expect(workerVersion).toEqual({ type: "PWA_VERSION", version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}-v\d+/) });

      await expect
        .poll(
          async () => {
            const { installabilityErrors } = await session.send("Page.getInstallabilityErrors");
            return installabilityErrors.map((error) => error.errorId);
          },
          {
            message: "Chromium should report no stable installability errors after the root worker controls the page",
            timeout: 15_000,
          },
        )
        .toEqual([]);
    } finally {
      try {
        await persistentContext?.close();
      } finally {
        await rm(profileDir, { recursive: true, force: true });
      }
    }
  });

  test("keeps the install surface polished, reachable, and clear of search at every target width", async ({ page }) => {
    const viewports = [
      { name: "compact phone", width: 320, height: 720 },
      { name: "phone", width: 390, height: 844 },
      { name: "wide phone", width: 639, height: 900 },
      { name: "small tablet", width: 768, height: 1024 },
      { name: "tablet", width: 820, height: 1180 },
      { name: "desktop", width: 1440, height: 1000 },
      { name: "wide desktop", width: 1920, height: 1080 },
    ] as const;

    for (const viewport of viewports) {
      await test.step(viewport.name, async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto("/?mode=answer&pwa-dev=0", { waitUntil: "domcontentloaded" });
        await expect(page.locator("header#search").first()).toBeVisible({ timeout: 20_000 });
        await page.waitForFunction(() => document.documentElement.dataset.pwaDisplayMode === "browser");

        await page.evaluate(() => {
          (window as typeof window & { __pwaPromptLayoutShift?: number }).__pwaPromptLayoutShift = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
              if (!shift.hadRecentInput) {
                (window as typeof window & { __pwaPromptLayoutShift?: number }).__pwaPromptLayoutShift! += shift.value;
              }
            }
          }).observe({ type: "layout-shift" });

          const event = new Event("beforeinstallprompt", { cancelable: true });
          Object.assign(event, {
            prompt: () => Promise.resolve(),
            userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
          });
          window.dispatchEvent(event);
        });

        const install = page.getByRole("region", { name: "Install PsychSift" });
        await expect(install).toBeVisible();
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
        );
        await expect(install).toContainText("Clinical guidelines on your home screen.");
        await expect(install).toContainText(
          "Open it from your device like an app. Private clinical features still require a connection.",
        );
        await expect(install).toContainText("Free · No app store · Takes a few seconds");
        if (viewport.width < 640) {
          await expect(install.getByText("Quick access · No app store")).toBeVisible();
        } else {
          await expect(install.getByRole("list", { name: "Install benefits" })).toContainText(
            "Quick accessApp-like launchFamiliar workspace",
          );
        }

        const geometry = await install.evaluate((surface) => {
          const rect = surface.getBoundingClientRect();
          const installAction = surface.querySelector<HTMLElement>(".pwa-install-primary")?.getBoundingClientRect();
          const secondaryAction = surface.querySelector<HTMLElement>(".pwa-install-secondary")?.getBoundingClientRect();
          const dismissAction = surface.querySelector<HTMLElement>(".pwa-install-dismiss")?.getBoundingClientRect();
          const visibleSearch = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="global-search-input"]'),
          ).find((node) => {
            const candidate = node.getBoundingClientRect();
            return candidate.width > 0 && candidate.height > 0;
          });
          const searchRect =
            visibleSearch?.closest<HTMLElement>(".chat-composer-shell-base")?.getBoundingClientRect() ??
            visibleSearch?.getBoundingClientRect();
          const overlap = searchRect
            ? Math.max(0, Math.min(rect.right, searchRect.right) - Math.max(rect.left, searchRect.left)) *
              Math.max(0, Math.min(rect.bottom, searchRect.bottom) - Math.max(rect.top, searchRect.top))
            : 0;

          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            installActionHeight: installAction?.height ?? 0,
            secondaryActionHeight: secondaryAction?.height ?? 0,
            dismissActionHeight: dismissAction?.height ?? 0,
            overlap,
            hasInternalScroll: surface.scrollHeight > surface.clientHeight + 1,
            pageScrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            promptLayoutShift:
              (window as typeof window & { __pwaPromptLayoutShift?: number }).__pwaPromptLayoutShift ?? 0,
          };
        });

        expect(geometry.left, `${viewport.name}: left inset`).toBeGreaterThanOrEqual(7);
        expect(geometry.right, `${viewport.name}: right inset`).toBeLessThanOrEqual(viewport.width - 7);
        expect(geometry.top, `${viewport.name}: top clearance`).toBeGreaterThanOrEqual(8);
        expect(geometry.bottom, `${viewport.name}: bottom clearance`).toBeLessThanOrEqual(viewport.height - 8);
        expect(geometry.installActionHeight, `${viewport.name}: Install app target`).toBeGreaterThanOrEqual(48);
        expect(geometry.secondaryActionHeight, `${viewport.name}: Not now target`).toBeGreaterThanOrEqual(48);
        expect(geometry.dismissActionHeight, `${viewport.name}: Dismiss target`).toBeGreaterThanOrEqual(48);
        expect(geometry.overlap, `${viewport.name}: install surface must not overlap search`).toBe(0);
        expect(geometry.promptLayoutShift, `${viewport.name}: prompt must not shift page content`).toBeLessThanOrEqual(
          0.02,
        );
        expect(geometry.hasInternalScroll, `${viewport.name}: complete value proposition should fit`).toBe(false);
        expect(geometry.pageScrollWidth, `${viewport.name}: no horizontal overflow`).toBeLessThanOrEqual(
          geometry.viewportWidth,
        );

        if (viewport.width >= 640) {
          expect(geometry.width, `${viewport.name}: restrained card width`).toBeGreaterThanOrEqual(380);
          expect(geometry.width, `${viewport.name}: restrained card width`).toBeLessThanOrEqual(440);
          expect(geometry.right, `${viewport.name}: right-corner anchor`).toBeGreaterThanOrEqual(viewport.width - 32);
        } else {
          expect(geometry.height, `${viewport.name}: compact phone sheet`).toBeLessThan(viewport.height * 0.7);
        }
      });
    }
  });

  test("keeps constrained install actions reachable in a short phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 400 });
    await page.goto("/?mode=answer&pwa-dev=0", { waitUntil: "domcontentloaded" });
    await expect(page.locator("header#search").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => document.documentElement.dataset.pwaDisplayMode === "browser");

    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: () => Promise.resolve(),
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      });
      window.dispatchEvent(event);
    });

    const install = page.getByRole("region", { name: "Install PsychSift" });
    await expect(install).toBeVisible();
    const scrollState = await install.evaluate((surface) => ({
      clientHeight: surface.clientHeight,
      scrollHeight: surface.scrollHeight,
      overflowY: getComputedStyle(surface).overflowY,
    }));
    expect(scrollState.scrollHeight).toBeLessThanOrEqual(scrollState.clientHeight + 1);
    expect(scrollState.overflowY).toMatch(/auto|scroll/);
    await expect(install.getByRole("button", { name: "Install app" })).toBeInViewport();
    await expect(install.getByRole("button", { name: "Not now" })).toBeInViewport();
  });

  test("keeps the install surface clear of the submitted answer composer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?mode=answer&q=lithium&run=1&pwa-dev=0", { waitUntil: "domcontentloaded" });
    await expect(page.locator("header#search").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => document.documentElement.dataset.pwaDisplayMode === "browser");

    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: () => Promise.resolve(),
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      });
      window.dispatchEvent(event);
    });

    const install = page.getByRole("region", { name: "Install PsychSift" });
    const composer = page.locator("form.answer-footer-search-edge:visible").first();
    await expect(install).toBeVisible();
    await expect(composer).toBeVisible();

    const overlap = await install.evaluate((surface, selector) => {
      const composerSurface = document.querySelector<HTMLElement>(selector);
      if (!composerSurface) return -1;
      const card = surface.getBoundingClientRect();
      const dock = composerSurface.getBoundingClientRect();
      return (
        Math.max(0, Math.min(card.right, dock.right) - Math.max(card.left, dock.left)) *
        Math.max(0, Math.min(card.bottom, dock.bottom) - Math.max(card.top, dock.top))
      );
    }, "form.answer-footer-search-edge");
    expect(overlap).toBe(0);
  });

  test("keeps the notice stack itself click-through on a mode with no bottom composer", async ({ page }) => {
    // #E6142T, and the reason this guard is narrow. The 2026-09-17 audit reported the notice
    // intercepting clicks on non-answer modes, and attributed it to the stack being moved out of
    // the corner only under `body:has(form.answer-footer-search-edge)`. Measured on 2026-09-18,
    // that attribution is wrong: Documents, Tools and Differentials have NO fixed bottom composer
    // at desktop width at all, so there was never a composer collision for that selector to avoid.
    //
    // What IS true is that the cards inside the stack are solid, and in the bottom-right corner
    // they land on page content. Repositioning does not fix it -- moving the stack to the top on
    // every wide view was measured too, and it merely traded one set of covered controls for
    // another. The real question is whether a floating notice may cover content at all, which is a
    // design decision and is recorded as such rather than guessed at here.
    //
    // So this pins the one invariant that must hold either way: the CONTAINER never takes the
    // pointer. It is what keeps the gaps between cards click-through, and it is a single CSS
    // declaration away from silently regressing.
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/?mode=tools&pwa-dev=0", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#main-content").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => document.documentElement.dataset.pwaDisplayMode === "browser");

    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: () => Promise.resolve(),
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      });
      window.dispatchEvent(event);
    });

    const stack = page.locator(".pwa-notice-stack");
    await expect(stack).toBeVisible();
    await expect(stack).toHaveCSS("pointer-events", "none");
  });

  test("shows the saved On Call essentials offline, and nothing personal", async ({ context, page }) => {
    await openControlledPwa(page);
    // The shape src/lib/on-call/entry-store.ts writes: shared rows only, saved now.
    await page.evaluate(() => {
      const base = {
        subtitle: null,
        body: null,
        linkedDocumentIds: [],
        tags: [],
        lastVerifiedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        sortOrder: 0,
      };
      window.localStorage.setItem(
        "clinical-kb-on-call-entries-cache-v2",
        JSON.stringify({
          savedAt: new Date().toISOString(),
          entries: [
            {
              ...base,
              id: crypto.randomUUID(),
              section: "contacts",
              slug: "ward",
              title: "Ward 5",
              isPersonal: false,
              includeOnCard: true,
              details: { role: "Nurse in charge", phone: "9224 0001" },
            },
            {
              ...base,
              id: crypto.randomUUID(),
              section: "contacts",
              slug: "sb",
              title: "Main switchboard",
              isPersonal: false,
              includeOnCard: false,
              details: { role: "Switchboard", phone: "(08) 9224 2244" },
            },
            {
              ...base,
              id: crypto.randomUUID(),
              section: "contacts",
              slug: "me",
              title: "My own mobile",
              isPersonal: true,
              includeOnCard: false,
              details: { role: "Personal", phone: "0400 000 000" },
            },
          ],
        }),
      );
    });
    const cspViolations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
    });

    await context.setOffline(true);
    await page.goto(`/pwa-offline-on-call-${Date.now()}`, { waitUntil: "domcontentloaded" });
    const essentials = page.getByRole("region", { name: "On Call, saved on this phone" });
    await expect(essentials).toBeVisible();
    await expect(essentials.getByText(/^Saved copy from .+ call switchboard\.$/)).toBeVisible();
    await expect(essentials.locator(".name").first()).toHaveText("Main switchboard");
    await expect(essentials.getByRole("link", { name: "Call (08) 9224 2244" })).toHaveAttribute(
      "href",
      "tel:0892242244",
    );
    await expect(essentials.getByText("My own mobile")).toHaveCount(0);
    expect(cspViolations).toEqual([]);

    await context.setOffline(false);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.localStorage.removeItem("clinical-kb-on-call-entries-cache-v2"));
  });

  test("serves a cold offline fallback, recovers online, and keeps private URLs out of CacheStorage", async ({
    context,
    page,
  }) => {
    await openControlledPwa(page);

    await context.setOffline(true);
    const coldPath = `/pwa-offline-cold-${Date.now()}`;
    const offlineResponse = await page.goto(coldPath, { waitUntil: "domcontentloaded" });
    expect(offlineResponse?.status()).toBe(200);
    expect(offlineResponse?.fromServiceWorker()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`${coldPath}$`));
    await expect(page.getByRole("heading", { name: "PsychSift is offline" })).toBeVisible();
    await expect(page.getByText("does not store or replay clinical queries", { exact: false })).toBeVisible();

    await context.setOffline(false);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/" && url.search === "", { waitUntil: "domcontentloaded" }),
      page.getByRole("link", { name: "Try again" }).click(),
    ]);
    await expect(page).toHaveTitle("Clinical Answers | PsychSift");
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.getByRole("heading", { name: "PsychSift is offline" })).toHaveCount(0);

    const privateProbePath = `/api/pwa-private-probe-${Date.now()}`;
    await context.route(`**${privateProbePath}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({ private: true }),
      }),
    );
    const privateProbe = await page.evaluate(async (path) => {
      const response = await fetch(path, { credentials: "include" });
      return { status: response.status, body: await response.json() };
    }, privateProbePath);
    expect(privateProbe).toEqual({ status: 200, body: { private: true } });
    const privateProbeUrl = new URL(privateProbePath, page.url()).href;

    const inventory = await page.evaluate(async () => {
      const entries: Array<{ cacheName: string; url: string }> = [];
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) entries.push({ cacheName, url: request.url });
      }
      return entries;
    });

    expect(inventory.length).toBeGreaterThan(0);
    expect(inventory.map((entry) => entry.url)).not.toContain(privateProbeUrl);
    const origin = new URL(page.url()).origin;
    const sensitivePath = /\/(?:api|auth|login|account|documents?|search|answers?|uploads?)(?:\/|$)/i;
    for (const entry of inventory) {
      const cachedUrl = new URL(entry.url);
      expect(entry.cacheName).toMatch(new RegExp(`^${PWA_CACHE_PREFIX}`));
      expect(cachedUrl.origin, entry.url).toBe(origin);
      if (cachedUrl.search) {
        expect(cachedUrl.pathname, entry.url).toMatch(/^\/_next\/static\//);
        expect([...cachedUrl.searchParams.keys()], entry.url).toEqual(["dpl"]);
        expect(cachedUrl.searchParams.get("dpl"), entry.url).toMatch(/^[a-f0-9]{40}$/i);
      }
      expect(cachedUrl.pathname, entry.url).not.toMatch(sensitivePath);
      expect(isAllowedPublicCachePath(cachedUrl.pathname), entry.url).toBe(true);
    }
  });
});

// The two iPhone projects start with the iOS "Add to Home Screen" hint already dismissed (see
// `iosInstallHintDismissed` in playwright.config.ts), because on a fresh context the sheet covers
// the home composer and every unrelated journey would have to dismiss it first. This is the one
// place that starts from a first visit instead, so hiding it elsewhere cannot hide it breaking.
test.describe("PsychSift iOS install hint", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows once on an iPhone, dismisses, and stays dismissed after a reload", async ({ page }) => {
    test.skip(
      !["mobile-webkit", "mobile-pwa-standalone"].includes(test.info().project.name),
      "Only an iPhone user agent is offered the manual Add to Home Screen hint.",
    );
    await page.route("**/api/**", (route) => route.abort("blockedbyclient"));

    await page.goto("/?mode=answer&pwa-dev=0", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.pwaDisplayMode === "browser");

    const hint = page.getByRole("region", { name: "Install PsychSift" });
    await expect(hint).toBeVisible({ timeout: 20_000 });
    await expect(hint).toContainText("Add to Home Screen");

    await hint.getByRole("button", { name: "Dismiss install hint" }).click();
    await expect(hint).toBeHidden();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.pwaDisplayMode === "browser");
    // The hint is deferred a tick after hydration; give it the chance to (wrongly) return.
    await page.waitForTimeout(1_000);
    await expect(page.getByRole("region", { name: "Install PsychSift" })).toHaveCount(0);
  });
});
