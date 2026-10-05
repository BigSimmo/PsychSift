"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { removeThisDevicePushSubscription } from "@/lib/alerts/device-push";
import { derivePhoneAlertState, deviceKindOf, type DeviceKind, type PhoneAlertState } from "@/lib/alerts/phone-state";
import { setSharedDevice, useSharedDevice } from "@/lib/alerts/shared-device";

/**
 * Phone alerts on THIS device: whether the server can send them, whether this
 * browser can take them, what the reader has allowed, and whether this device
 * is subscribed to the signed-in account. Shared by the Alerts page and
 * Roster's own switch, so both always agree.
 */

const LAST_TEST_KEY = "psychsift-last-test-alert";

function isIosNotInstalled(): boolean {
  if (typeof navigator === "undefined" || !/iPhone|iPad|iPod/i.test(navigator.userAgent)) return false;
  return !(
    (navigator as Navigator & { standalone?: boolean }).standalone ||
    window.matchMedia?.("(display-mode: standalone)").matches
  );
}

function pushSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

function currentPermission(): "default" | "granted" | "denied" | "unsupported" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

function publicKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function readLastTest(): string | null {
  try {
    return window.localStorage.getItem(LAST_TEST_KEY);
  } catch {
    return null;
  }
}

type Environment = {
  readonly ios: boolean;
  readonly supported: boolean;
  readonly device: DeviceKind;
  readonly permission: "default" | "granted" | "denied" | "unsupported";
  readonly lastTest: string | null;
};

const SERVER_ENVIRONMENT: Environment = {
  ios: false,
  supported: true,
  device: "phone",
  permission: "default",
  lastTest: null,
};
let cachedEnvironment: Environment | null = null;

/** A fresh read each call, but the same object while nothing changed, as the store contract needs. */
function readEnvironment(): Environment {
  const next: Environment = {
    ios: isIosNotInstalled(),
    supported: pushSupported(),
    device: deviceKindOf(navigator.userAgent),
    permission: currentPermission(),
    lastTest: readLastTest(),
  };
  const previous = cachedEnvironment;
  if (previous && (Object.keys(next) as (keyof Environment)[]).every((key) => previous[key] === next[key]))
    return previous;
  cachedEnvironment = next;
  return next;
}

function serverEnvironment(): Environment {
  return SERVER_ENVIRONMENT;
}

function subscribeNever() {
  return () => undefined;
}

export type PhoneAlerts = {
  readonly state: PhoneAlertState;
  readonly device: DeviceKind;
  /** The server can send phone alerts at all. */
  readonly configured: boolean;
  /** This device is subscribed to the signed-in account. */
  readonly enabled: boolean;
  readonly busy: boolean;
  readonly message: string | null;
  /** ISO time the last test alert reached this device while a PsychSift page was open. */
  readonly lastTestArrivedAt: string | null;
  readonly testSentAt: string | null;
  readonly toggle: () => Promise<void>;
  readonly sendTest: () => Promise<void>;
  readonly setShared: (shared: boolean) => Promise<void>;
};

export function usePhoneAlerts(): PhoneAlerts {
  const sharedDevice = useSharedDevice();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  // None of these change without a reload. Read through an external store so
  // the server render (which cannot know the device) and the first client
  // render agree, then the browser's real answer takes over.
  const environment = useSyncExternalStore(subscribeNever, readEnvironment, serverEnvironment);
  const [permissionAfterAsk, setPermission] = useState<"default" | "granted" | "denied" | null>(null);
  const permission = permissionAfterAsk ?? environment.permission;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastTestArrivedHere, setLastTestArrivedAt] = useState<string | null>(null);
  const lastTestArrivedAt = lastTestArrivedHere ?? environment.lastTest;
  const [testSentAt, setTestSentAt] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetch("/api/roster/alerts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check alerts");
        const payload = (await response.json()) as { configured?: boolean; publicKey?: string | null };
        if (!current) return;
        const ready = payload.configured === true && !!payload.publicKey;
        setConfigured(ready);
        setPublicKey(payload.publicKey ?? null);
        if (!ready || !pushSupported()) {
          setSubscribed(false);
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager?.getSubscription();
        if (!subscription) {
          if (current) setSubscribed(false);
          return;
        }
        const check = await fetch("/api/roster/alerts/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          cache: "no-store",
        });
        if (!check.ok) throw new Error("Could not verify alert owner");
        const ownership = (await check.json()) as { owned?: boolean };
        if (current) setSubscribed(ownership.owned === true);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);

  // The service worker tells open pages when a test arrives, so "last test
  // arrived" is what this device actually received, not what the server sent.
  useEffect(() => {
    const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (typeof worker?.addEventListener !== "function") return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; t?: string } | null;
      if (data?.type !== "psychsift-push" || data.t !== "test") return;
      const at = new Date().toISOString();
      try {
        window.localStorage.setItem(LAST_TEST_KEY, at);
      } catch {
        // Kept for this visit only.
      }
      setLastTestArrivedAt(at);
    };
    worker.addEventListener("message", onMessage);
    return () => worker.removeEventListener("message", onMessage);
  }, []);

  const turnOff = useCallback(async () => {
    await removeThisDevicePushSubscription();
    setSubscribed(false);
  }, []);

  const toggle = useCallback(async () => {
    if (!configured || !publicKey || busy) return;
    if (isIosNotInstalled()) {
      setMessage("On iPhone, add PsychSift to your Home Screen first.");
      return;
    }
    if (!pushSupported()) {
      setMessage("Phone alerts aren't available on this browser.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (subscribed) {
        await turnOff();
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      if (!registration.pushManager) throw new Error("Push unavailable");
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        if (result === "denied") setMessage("Alerts are blocked on this phone. Turn them on in the phone's settings.");
        return;
      }
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKeyBytes(publicKey),
        }));
      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys.auth) throw new Error("Missing subscription keys");
      const response = await fetch("/api/roster/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }),
      });
      if (!response.ok) throw new Error("Could not save alerts");
      setSubscribed(true);
    } catch {
      setMessage("Phone alerts couldn't be changed. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }, [busy, configured, publicKey, subscribed, turnOff]);

  const sendTest = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager?.getSubscription();
      if (!subscription) throw new Error("Not subscribed");
      const response = await fetch("/api/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as { sent?: number } | null;
      if (!response.ok) throw new Error("Test not sent");
      if (!payload?.sent) {
        setMessage("The test couldn't reach this device. Turn phone alerts off and on again.");
        return;
      }
      setTestSentAt(new Date().toISOString());
    } catch {
      setMessage("The test alert couldn't be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const setShared = useCallback(
    async (shared: boolean) => {
      setSharedDevice(shared);
      // A shared computer keeps no subscription: turning the switch on removes it.
      if (shared && subscribed) await turnOff();
    },
    [subscribed, turnOff],
  );

  const state = derivePhoneAlertState({
    configured,
    supported: environment.supported,
    iosNotInstalled: environment.ios,
    permission,
    subscribed,
    failed,
    sharedDevice,
  });

  return {
    state,
    device: environment.device,
    configured: configured === true,
    enabled: subscribed === true,
    busy,
    message,
    lastTestArrivedAt,
    testSentAt,
    toggle,
    sendTest,
    setShared,
  };
}
