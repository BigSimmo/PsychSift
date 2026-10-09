import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PwaLifecycle } from "@/components/pwa-lifecycle";

type MockWorker = ServiceWorker & { postMessage: ReturnType<typeof vi.fn> };

function createWorker(): MockWorker {
  const worker = new EventTarget() as MockWorker;
  Object.defineProperties(worker, {
    state: { configurable: true, value: "installed" },
    postMessage: { configurable: true, value: vi.fn() },
  });
  return worker;
}

function installServiceWorkerStub(waiting: ServiceWorker | null = null, controlled = Boolean(waiting)) {
  const registration = new EventTarget() as ServiceWorkerRegistration & {
    update: ReturnType<typeof vi.fn>;
  };
  Object.defineProperties(registration, {
    waiting: { configurable: true, value: waiting },
    installing: { configurable: true, value: null },
    update: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
  });

  const container = new EventTarget() as ServiceWorkerContainer & {
    register: ReturnType<typeof vi.fn>;
  };
  Object.defineProperties(container, {
    controller: { configurable: true, value: controlled ? {} : null },
    register: { configurable: true, value: vi.fn().mockResolvedValue(registration) },
  });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });

  return { container, registration };
}

function dispatchInstallEligibility(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
  fireEvent(window, event);
  return prompt;
}

const HERO_MAIN_CONTENT_SELECTOR = 'body:has(#main-content[data-phone-footer-owner="hero"])';
const ALLOWED_HERO_MAIN_CONTENT_SELECTORS = new Set([
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-notice-stack`,
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-install-native-sheet .pwa-install-grip`,
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-install-native-sheet .pwa-install-tagline`,
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-install-native-sheet .pwa-install-copy`,
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-install-native-sheet .pwa-install-support`,
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-install-native-sheet .pwa-install-benefits`,
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-install-native-sheet .pwa-install-header`,
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-install-native-sheet .pwa-install-body`,
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-install-native-sheet .pwa-install-compact-copy`,
  `${HERO_MAIN_CONTENT_SELECTOR} .pwa-install-native-sheet .pwa-install-actions`,
]);

function splitCssSelectors(prelude: string) {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of prelude) {
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current.replace(/\s+/g, " ").trim());
      current = "";
    } else {
      current += char;
    }
  }
  const last = current.replace(/\s+/g, " ").trim();
  if (last) parts.push(last);
  return parts.filter(Boolean);
}

function normalizeCssSelector(selector: string) {
  return selector
    .replace(/\s+/g, " ")
    .trim()
    .replace(/:has\(\s+/g, ":has(")
    .replace(/\s+\)/g, ")");
}

function disallowedMainContentHasSelectors(styles: string) {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  const disallowed: string[] = [];
  let token = "";
  for (const char of withoutComments) {
    if (char === "{") {
      const prelude = token.replace(/\s+/g, " ").trim();
      if (!prelude.startsWith("@")) {
        for (const selector of splitCssSelectors(prelude).map(normalizeCssSelector)) {
          if (selector.includes("body:has(#main-content") && !ALLOWED_HERO_MAIN_CONTENT_SELECTORS.has(selector)) {
            disallowed.push(selector);
          }
        }
      }
      token = "";
      continue;
    }
    if (char === "}") {
      token = "";
      continue;
    }
    token += char;
  }
  return disallowed;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  delete document.documentElement.dataset.pwaDisplayMode;
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    value: vi.fn((callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    }),
  });
  Object.defineProperty(window, "cancelIdleCallback", { configurable: true, value: vi.fn() });
});

describe("PwaLifecycle", () => {
  it("does not register a worker in a normal non-production development session", async () => {
    const { container } = installServiceWorkerStub();
    render(<PwaLifecycle />);

    await Promise.resolve();
    expect(container.register).not.toHaveBeenCalled();
  });

  it("registers the root-scoped worker only through the explicit local PWA test opt-in", async () => {
    window.history.replaceState({}, "", "/?pwa-dev=1");
    const { container } = installServiceWorkerStub();
    render(<PwaLifecycle />);

    await waitFor(() =>
      expect(container.register).toHaveBeenCalledWith("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }),
    );
  });

  it("tears down the locally registered worker and owned caches via the explicit ?pwa-dev=0 opt-out", async () => {
    window.history.replaceState({}, "", "/?pwa-dev=0");
    const { container } = installServiceWorkerStub();

    const makeRegistration = (scriptURL: string) => {
      const registration = new EventTarget() as ServiceWorkerRegistration & { unregister: ReturnType<typeof vi.fn> };
      Object.defineProperties(registration, {
        active: { configurable: true, value: { scriptURL } },
        waiting: { configurable: true, value: null },
        installing: { configurable: true, value: null },
        unregister: { configurable: true, value: vi.fn().mockResolvedValue(true) },
      });
      return registration;
    };
    const ownRegistration = makeRegistration(new URL("/sw.js", window.location.origin).href);
    // Nested path ending in /sw.js: proves teardown exact-matches the owned
    // worker URL instead of suffix-matching.
    const foreignRegistration = makeRegistration(new URL("/other-app/sw.js", window.location.origin).href);
    Object.defineProperty(container, "getRegistrations", {
      configurable: true,
      value: vi.fn().mockResolvedValue([ownRegistration, foreignRegistration]),
    });

    const cacheDelete = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: {
        delete: cacheDelete,
        keys: vi.fn().mockResolvedValue(["clinical-kb-pwa-shell-2026-07-15-v1", "unrelated-cache"]),
      } as unknown as CacheStorage,
    });

    render(<PwaLifecycle />);

    await waitFor(() => expect(ownRegistration.unregister).toHaveBeenCalledTimes(1));
    expect(foreignRegistration.unregister).not.toHaveBeenCalled();
    await waitFor(() => expect(cacheDelete).toHaveBeenCalledWith("clinical-kb-pwa-shell-2026-07-15-v1"));
    expect(cacheDelete).not.toHaveBeenCalledWith("unrelated-cache");
    expect(container.register).not.toHaveBeenCalled();
  });

  it("announces lost and restored connectivity without claiming private data is available offline", async () => {
    render(<PwaLifecycle />);

    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    fireEvent.offline(window);
    expect(await screen.findByRole("region", { name: "You’re offline" })).toBeInTheDocument();
    expect(screen.getByText("Clinical search and private features need a connection.")).toBeInTheDocument();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    fireEvent.online(window);
    expect(await screen.findByText("Connection restored")).toBeInTheDocument();
  });

  it("dismisses the offline notice per episode and re-surfaces it on the next connectivity drop", async () => {
    const user = userEvent.setup();
    render(<PwaLifecycle />);

    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    fireEvent.offline(window);
    expect(await screen.findByRole("region", { name: "You’re offline" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss offline notice" }));
    expect(screen.queryByRole("region", { name: "You’re offline" })).not.toBeInTheDocument();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    fireEvent.online(window);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    fireEvent.offline(window);
    expect(await screen.findByRole("region", { name: "You’re offline" })).toBeInTheDocument();
  });

  it("shows install UI only after browser eligibility and invokes the deferred prompt from a user action", async () => {
    const user = userEvent.setup();
    render(<PwaLifecycle />);

    expect(screen.queryByRole("region", { name: "Install PsychSift" })).not.toBeInTheDocument();
    const prompt = dispatchInstallEligibility();
    const installRegion = await screen.findByRole("region", { name: "Install PsychSift" });
    expect(installRegion).toBeInTheDocument();
    expect(installRegion).toHaveTextContent("Clinical guidelines on your home screen.");
    expect(installRegion).toHaveTextContent(
      "Open it from your device like an app. Private clinical features still require a connection.",
    );
    expect(installRegion).toHaveTextContent("Free · No app store · Takes a few seconds");
    expect(screen.getByRole("list", { name: "Install benefits" })).toHaveTextContent(
      "Quick accessApp-like launchFamiliar workspace",
    );
    expect(screen.getByRole("button", { name: "Dismiss install prompt" })).toHaveTextContent("Dismiss");

    await user.click(screen.getByRole("button", { name: "Install app" }));
    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(installRegion).not.toBeInTheDocument());
  });

  it("requires a user decision before activating a waiting update", async () => {
    window.history.replaceState({}, "", "/?pwa-dev=1");
    const waitingWorker = createWorker();
    installServiceWorkerStub(waitingWorker);
    const user = userEvent.setup();
    render(<PwaLifecycle />);

    expect(await screen.findByText("Update available")).toBeInTheDocument();
    dispatchInstallEligibility();
    expect(screen.queryByRole("region", { name: "Install PsychSift" })).not.toBeInTheDocument();
    expect(waitingWorker.postMessage).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  // The stale-PWA fix (7 October 2026): an app left open, or resumed by focus or a
  // back-forward restore, asks for a newer worker every ten minutes rather than hourly.
  it("checks for a newer build on focus, on a back-forward restore and on a ten-minute timer", async () => {
    window.history.replaceState({}, "", "/?pwa-dev=1");
    const { container, registration } = installServiceWorkerStub();
    const nowSpy = vi.spyOn(Date, "now");
    let now = 1_000_000;
    nowSpy.mockImplementation(() => now);
    const intervalSpy = vi.spyOn(window, "setInterval");
    try {
      render(<PwaLifecycle />);
      await waitFor(() => expect(container.register).toHaveBeenCalled());
      await waitFor(() => expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000));

      fireEvent(window, new Event("focus"));
      expect(registration.update).not.toHaveBeenCalled();

      now += 10 * 60 * 1000;
      fireEvent(window, new Event("focus"));
      expect(registration.update).toHaveBeenCalledTimes(1);

      now += 10 * 60 * 1000;
      fireEvent(window, new Event("pageshow"));
      expect(registration.update).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
      intervalSpy.mockRestore();
    }
  });

  it("offers a refresh when another tab activates an update instead of silently leaving stale UI", async () => {
    window.history.replaceState({}, "", "/?pwa-dev=1");
    const { container } = installServiceWorkerStub(null, true);
    render(<PwaLifecycle />);

    await waitFor(() => expect(container.register).toHaveBeenCalled());
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });

    expect(await screen.findByRole("region", { name: "Update available" })).toBeInTheDocument();
    expect(screen.getByText("Reload when convenient to use the latest version.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
  });

  /**
   * Dismissing the update notice used to set a ref and nothing else, so it returned on the next
   * page load -- and it sits over the bottom-right corner, where content and controls are. The
   * install prompt has persisted its dismissal since it was written; this is the same treatment
   * for the same reason (2026-09-17 audit, finding L4).
   */
  describe("update notice dismissal", () => {
    async function showUpdateNotice() {
      window.history.replaceState({}, "", "/?pwa-dev=1");
      const { container } = installServiceWorkerStub(createWorker(), true);
      render(<PwaLifecycle />);
      await waitFor(() => expect(container.register).toHaveBeenCalled());
      act(() => {
        container.dispatchEvent(new Event("controllerchange"));
      });
      return screen.findByRole("region", { name: "Update available" });
    }

    it("does not offer the update again after it was dismissed on an earlier page view", async () => {
      await showUpdateNotice();
      await userEvent.click(screen.getByRole("button", { name: "Later" }));
      expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument();

      // A new page load: everything in memory is gone, only storage survives.
      cleanup();
      const { container } = installServiceWorkerStub(createWorker(), true);
      render(<PwaLifecycle />);
      await waitFor(() => expect(container.register).toHaveBeenCalled());
      act(() => {
        container.dispatchEvent(new Event("controllerchange"));
      });

      expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument();
    });

    it("offers it again once the dismissal window has passed", async () => {
      // Six hours, not thirty days like the install prompt. An update is worth re-offering the
      // same day: "later" means later, not never.
      await showUpdateNotice();
      await userEvent.click(screen.getByRole("button", { name: "Later" }));

      cleanup();
      window.localStorage.setItem("clinical-kb-pwa-update-dismissed-at", String(Date.now() - 7 * 60 * 60 * 1000));
      const { container } = installServiceWorkerStub(createWorker(), true);
      render(<PwaLifecycle />);
      await waitFor(() => expect(container.register).toHaveBeenCalled());
      act(() => {
        container.dispatchEvent(new Event("controllerchange"));
      });

      expect(await screen.findByRole("region", { name: "Update available" })).toBeInTheDocument();
    });

    it("still offers the update when storage is unavailable", async () => {
      // Fail toward showing it. The notice is an offer, and offering twice costs less than a
      // clinician never being told a new version exists.
      const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });
      try {
        expect(await showUpdateNotice()).toBeInTheDocument();
      } finally {
        getItem.mockRestore();
      }
    });
  });

  it("does not misreport the first controller claim as an application update", async () => {
    window.history.replaceState({}, "", "/?pwa-dev=1");
    const { container } = installServiceWorkerStub();
    render(<PwaLifecycle />);

    await waitFor(() => expect(container.register).toHaveBeenCalled());
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });

    expect(screen.queryByRole("region", { name: "Update available" })).not.toBeInTheDocument();
  });

  it("shows the one-time iOS Add to Home Screen hint and honours its dismissal window", async () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    try {
      const user = userEvent.setup();
      const { unmount } = render(<PwaLifecycle />);

      const hint = await screen.findByRole("region", { name: "Install PsychSift" });
      expect(hint).toHaveTextContent("In Safari, tap Share, then Add to Home Screen.");
      expect(hint).toHaveTextContent("Private clinical features still require a connection.");
      expect(screen.getByRole("list", { name: "Add PsychSift to your Home Screen" })).toHaveTextContent(
        "1. Tap Share2. Add to Home Screen",
      );
      expect(screen.queryByRole("button", { name: "Install app" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Not now" }));
      await waitFor(() => expect(screen.queryByRole("region", { name: "Install PsychSift" })).not.toBeInTheDocument());
      expect(Number(window.localStorage.getItem("clinical-kb-pwa-ios-install-dismissed-at"))).toBeGreaterThan(0);

      unmount();
      render(<PwaLifecycle />);
      expect(screen.queryByRole("region", { name: "Install PsychSift" })).not.toBeInTheDocument();
    } finally {
      delete (navigator as { userAgent?: string }).userAgent;
    }
  });
});

describe("notice-stack swap settling", () => {
  // .pwa-notice-stack is position: fixed, bottom-anchored. Root-caused from a
  // downloaded Lighthouse mobile-root trace (PR #2199/#2204 CI, 2026-08-21):
  // audits["layout-shifts"] named .pwa-notice-stack as a real shift source at
  // score 0.223. scripts/measure-cls-attribution.mjs reproduced the mechanism
  // directly: when the offline card clears the same instant a different card
  // (connection-restored / the install prompt) appears — both driven by the
  // same `online` event landing in one React commit — the stack's height
  // changes while it is already on screen, moving its painted top edge. A
  // brand-new mount from an unmounted stack does not shift anything (proven
  // with the same harness: a synthetic beforeinstallprompt alone, with no
  // other card ever visible, measured 0 shift). useSettledNoticeSignature
  // forces every transition between two different non-empty card
  // combinations through one fully-unmounted frame so the swap always
  // reads as "nothing -> something" instead of "one box resizing into
  // another" while already visible.
  it("passes through an unmounted frame when the offline card is replaced by the connection-restored card", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    try {
      render(<PwaLifecycle />);
      await screen.findByRole("region", { name: "You’re offline" });

      await act(async () => {
        Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
        window.dispatchEvent(new Event("online"));
      });

      // Immediately after the commit that clears the offline card, the stack
      // must be fully empty — not already showing connection-restored — or
      // the swap resizes an already-visible fixed element.
      expect(screen.queryByRole("region", { name: "You’re offline" })).not.toBeInTheDocument();
      expect(screen.queryByText("Connection restored")).not.toBeInTheDocument();

      await screen.findByText("Connection restored");
    } finally {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });
});

describe("notice stack waits out the app-shell gap", () => {
  // `#TYZK23`, root-caused and reproduced. Every phone geometry rule for this
  // component selects on `body:has(#main-content[data-phone-footer-owner=
  // "hero"])`, and `#main-content` is not merely late — it briefly STOPS
  // EXISTING while React swaps the route in and hydrates. Measured on `/` at
  // Lighthouse's 412x823 mobile emulation, install prompt firing early on a
  // throttled connection: shell at 4726ms, gone at 7855ms, the install card
  // mounts at 9083ms inside the gap (401px tall, bottom 731), the shell returns
  // at 9930ms and the card is restyled to 161px at bottom 815 — one shift,
  // 0.2230, matching CI's mobile-root breach. With the gate the same run
  // measures 0.000 and the card mounts straight at its settled 161px.
  //
  // NOTE ON ORDER: releasing on `load` is deliberately limited to a document
  // whose shell has NEVER appeared (a 404 or error page renders no
  // `#main-content`), which the earlier cases in this file cover — they render
  // with no shell and still receive notices. These cases mount one, so they run
  // after those by declaration order.
  function mountAppShell() {
    const main = document.createElement("main");
    main.id = "main-content";
    main.setAttribute("data-phone-footer-owner", "hero");
    document.body.appendChild(main);
    return main;
  }

  it("holds the stack while the shell is momentarily absent, even after load", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const shell = mountAppShell();
    try {
      render(<PwaLifecycle />);
      await screen.findByRole("region", { name: "You\u2019re offline" });

      // The hydration gap. `document.readyState` is already "complete" here,
      // which is exactly why a bare readyState fallback does not hold: it
      // released the stack into this window and the restyle followed.
      expect(document.readyState).toBe("complete");
      await act(async () => {
        shell.remove();
      });
      expect(screen.queryByRole("region", { name: "You\u2019re offline" })).not.toBeInTheDocument();

      await act(async () => {
        mountAppShell();
      });
      await screen.findByRole("region", { name: "You\u2019re offline" });
    } finally {
      document.getElementById("main-content")?.remove();
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });
});

describe("notice stack positioning", () => {
  it("does not gate the mobile-home stack position on an asynchronously mounted install card", () => {
    const styles = readFileSync(join(import.meta.dirname, "..", "src", "app", "globals.css"), "utf8");

    expect(styles).toContain('body:has(#main-content[data-phone-footer-owner="hero"]) .pwa-notice-stack');
    expect(styles).not.toContain(
      'body:has(#main-content[data-phone-footer-owner="hero"]):has(.pwa-install-native-sheet) .pwa-notice-stack',
    );
  });
});

describe("notice entrance animation", () => {
  it("keeps the asynchronously mounted notice geometry stable", () => {
    const styles = readFileSync(join(import.meta.dirname, "..", "src", "app", "globals.css"), "utf8");
    const start = styles.indexOf("@keyframes pwa-notice-in");
    const end = styles.indexOf("@media (min-width: 640px)", start);
    const keyframes = styles.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(keyframes).toContain("opacity");
    expect(keyframes).not.toMatch(
      /\b(?:transform|translate|scale|top|right|bottom|left|margin|padding|width|height)\b/,
    );
  });
});

describe("notice-stack hero-compact geometry selectors", () => {
  // The phone-hero compacting rules for the native install card each gate on
  // ONE :has() (hero-composer ownership on #main-content, a static per-route
  // render prop that never changes after first paint) plus a plain descendant
  // combinator off .pwa-install-native-sheet. A rule chaining a SECOND
  // :has(.pwa-install-native-sheet) instead re-derives, via ancestor-existence
  // matching, a fact the DOM tree already guarantees through containment —
  // the exact pattern root-caused for .pwa-notice-stack's own bottom-gap rule
  // (mobile-root Lighthouse CLS 0.223, layout-shifts audit naming
  // .pwa-notice-stack; see docs/outstanding-issues.md "bistable"). Guard every
  // rule in the block, not just one, so a future edit cannot silently
  // reintroduce the two-:has() shape on a sibling selector.
  it("never re-gates the native install card's compacting rules on a second :has(.pwa-install-native-sheet)", () => {
    const styles = readFileSync(join(import.meta.dirname, "..", "src", "app", "globals.css"), "utf8");
    const start = styles.indexOf(
      '@media (max-width: 639.98px) {\n  body:has(#main-content[data-phone-footer-owner="hero"])',
    );
    const end = styles.indexOf("\n}", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = styles.slice(start, end);

    expect(block).not.toContain(':has(#main-content[data-phone-footer-owner="hero"]):has(.pwa-install-native-sheet)');
    for (const selector of [
      ".pwa-notice-stack",
      ".pwa-install-grip",
      ".pwa-install-tagline",
      ".pwa-install-copy",
      ".pwa-install-support",
      ".pwa-install-benefits",
      ".pwa-install-header",
      ".pwa-install-body",
      ".pwa-install-compact-copy",
      ".pwa-install-actions",
    ]) {
      expect(block).toContain(
        `body:has(#main-content[data-phone-footer-owner="hero"]) ${selector === ".pwa-notice-stack" ? selector : `.pwa-install-native-sheet ${selector}`}`,
      );
    }
  });

  it("rejects every unguarded body:has(#main-content...) geometry consumer", () => {
    const styles = readFileSync(join(import.meta.dirname, "..", "src", "app", "globals.css"), "utf8");

    expect(disallowedMainContentHasSelectors(styles)).toEqual([]);

    const unsafeFixture = `${styles}\nbody:has(#main-content[data-phone-footer-owner="hero"]) .future-overlay { bottom: 0; }`;
    expect(disallowedMainContentHasSelectors(unsafeFixture)).toEqual([
      'body:has(#main-content[data-phone-footer-owner="hero"]) .future-overlay',
    ]);

    const multilineUnsafeFixture = `${styles}
body:has(#main-content[data-phone-footer-owner="hero"])
  .future-overlay {
  bottom: 0;
}`;
    expect(disallowedMainContentHasSelectors(multilineUnsafeFixture)).toEqual([
      'body:has(#main-content[data-phone-footer-owner="hero"]) .future-overlay',
    ]);

    const spacedHasFixture = `${styles}
body:has(
  #main-content[data-phone-footer-owner="hero"]
) .future-overlay {
  bottom: 0;
}`;
    expect(disallowedMainContentHasSelectors(spacedHasFixture)).toEqual([
      'body:has(#main-content[data-phone-footer-owner="hero"]) .future-overlay',
    ]);
  });

  it("top-aligns only constrained sm+ hero canvases so tall desktops remain centred", () => {
    const styles = readFileSync(join(import.meta.dirname, "..", "src", "app", "globals.css"), "utf8");
    expect(styles).toContain("@media (min-width: 640px) and (max-width: 1919.98px) and (max-height: 1279.98px)");
    expect(styles).toContain(
      '#main-content[data-phone-footer-owner="hero"] [data-mode-home-canvas] {\n    place-items: start center;\n    align-content: start;',
    );
    expect(styles).not.toMatch(
      /@media \(min-width: 640px\) and \(max-width: 1919\.98px\) \{\s*#main-content\[data-phone-footer-owner="hero"\] \[data-mode-home-canvas\] \{/,
    );
    expect(styles).not.toContain("body:has(.pwa-notice-stack) #main-content");
    expect(styles).not.toMatch(
      /@media \(min-width: 640px\) \{\s*#main-content\[data-phone-footer-owner="hero"\] \[data-mode-home-canvas\] \{/,
    );
    expect(styles).not.toMatch(
      /@media \(min-width: 640px\) and \(max-width: 1279\.98px\) \{\s*body:has\(#main-content\[data-phone-footer-owner="hero"\]\) \.pwa-notice-stack \{/,
    );
  });
});
