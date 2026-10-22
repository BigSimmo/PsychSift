/*
 * `beforeinstallprompt` fires once per page view and cannot be replayed. The PWA
 * lifecycle UI is loaded lazily, so this tiny eager listener holds the event until
 * that UI mounts and takes it.
 */
let earlyInstallPrompt: Event | null = null;
let listening = false;

function captureInstallPrompt(event: Event) {
  event.preventDefault();
  earlyInstallPrompt = event;
}

export function startEarlyInstallPromptCapture() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", captureInstallPrompt);
  window.addEventListener("appinstalled", () => {
    earlyInstallPrompt = null;
  });
}

/** Returns the held event (if any) and stops the early listener; the caller owns it from here. */
export function takeEarlyInstallPrompt(): Event | null {
  if (typeof window !== "undefined") window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  const event = earlyInstallPrompt;
  earlyInstallPrompt = null;
  return event;
}

/** Puts back an event a lifecycle mount took but unmounted before using. */
export function restoreEarlyInstallPrompt(event: Event) {
  earlyInstallPrompt ??= event;
}

type IdleWindow = Window & {
  requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Runs `run` in an idle task; the returned cancel reports whether it was still pending. */
export function scheduleIdleTask(run: () => void, timeout = 2000): () => boolean {
  const idleWindow = window as IdleWindow;
  let pending = true;
  const task = () => {
    pending = false;
    run();
  };
  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(task, { timeout });
    return () => {
      if (pending) idleWindow.cancelIdleCallback?.(handle);
      const wasPending = pending;
      pending = false;
      return wasPending;
    };
  }
  const timer = window.setTimeout(task, 0);
  return () => {
    if (pending) window.clearTimeout(timer);
    const wasPending = pending;
    pending = false;
    return wasPending;
  };
}

/*
 * The lifecycle UI holds its notices back while `#main-content` is absent after having
 * existed (the hydration gap that restyles the stack under itself, ledger `#TYZK23`).
 * Its "has the shell ever existed" memory starts when its module evaluates, which is now
 * after the page loads — possibly inside that gap. Recording the first sighting here,
 * eagerly, keeps the gate closed through a gap the lazy chunk never saw open.
 */
let appShellSeen = false;

export function watchForAppShell(selector: string) {
  if (appShellSeen || typeof document === "undefined") return;
  if (document.querySelector(selector)) {
    appShellSeen = true;
    return;
  }
  const observer = new MutationObserver(() => {
    if (!document.querySelector(selector)) return;
    appShellSeen = true;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function hasAppShellBeenSeen(): boolean {
  return appShellSeen;
}
