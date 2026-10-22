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
