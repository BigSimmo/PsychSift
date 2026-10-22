import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  document.body.innerHTML = "";
  vi.resetModules();
});

async function load() {
  return import("@/lib/pwa-early-install-prompt");
}

describe("pwa-early-install-prompt", () => {
  it("remembers an app shell that appeared and vanished before the lifecycle chunk loaded", async () => {
    const lib = await load();
    lib.watchForAppShell("#main-content");
    expect(lib.hasAppShellBeenSeen()).toBe(false);
    const main = document.createElement("main");
    main.id = "main-content";
    document.body.append(main);
    await Promise.resolve();
    main.remove();
    expect(lib.hasAppShellBeenSeen()).toBe(true);
  });

  it("holds an early install prompt until taken, and accepts it back if unused", async () => {
    const lib = await load();
    lib.startEarlyInstallPromptCapture();
    const event = new Event("beforeinstallprompt", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(lib.takeEarlyInstallPrompt()).toBe(event);
    expect(lib.takeEarlyInstallPrompt()).toBeNull();
    lib.restoreEarlyInstallPrompt(event);
    expect(lib.takeEarlyInstallPrompt()).toBe(event);
  });

  it("reports whether a scheduled idle task was still pending when cancelled", async () => {
    vi.useFakeTimers();
    try {
      const lib = await load();
      const run = vi.fn();
      const cancel = lib.scheduleIdleTask(run);
      expect(cancel()).toBe(true);
      vi.runAllTimers();
      expect(run).not.toHaveBeenCalled();
      const ran = vi.fn();
      const cancelLate = lib.scheduleIdleTask(ran);
      vi.runAllTimers();
      expect(ran).toHaveBeenCalledOnce();
      expect(cancelLate()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
