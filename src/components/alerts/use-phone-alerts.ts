"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { removeThisDevicePushSubscription } from "@/lib/alerts/device-push";
import {
  derivePhoneAlertState,
  deviceKindOf,
  testAlertFailureMessage,
  type DeviceKind,
  type PhoneAlertState,
} from "@/lib/alerts/phone-state";
import { setSharedDevice, useSharedDevice } from "@/lib/alerts/shared-device";

/**
 * Phone alerts on THIS device: whether the server can send them, whether this
 * browser can take them, what the reader has allowed, and whether this device
 * is subscribed to the signed-in account. Used by the Alerts page; Roster
 * settings still has its own switch until the Roster build adopts this hook.
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
  return hasNotificationApi() && "serviceWorker" in navigator;
}

// Some embedded browsers define Notification but leave it empty; treat that as unsupported.
function hasNotificationApi(): boolean {
  return (
    typeof window !== "undefined" &&
    (typeof window.Notification === "function" ||
      (typeof window.Notification === "object" && window.Notification !== null))
  );
}

function currentPermission(): "default" | "granted" | "denied" | "unsupported" {
  return hasNotificationApi() && "permission" in window.Notification
    ? (window.Notification.permission as "default" | "granted" | "denied")
    : "unsupported";
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
  /** Re-run the device check after it failed. */
  readonly retry: () => void;
};

export function usePhoneAlerts(): PhoneAlerts {
  const sharedDevice = useSharedDevice();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
        // Not `ready`: it never settles when no service worker is registered, which would leave "Checking…" up for good.
        const registration =
          typeof navigator.serviceWorker.getRegistration === "function"
            ? await navigator.serviceWorker.getRegistration()
            : await navigator.serviceWorker.ready;
        const subscription = await registration?.pushManager?.getSubscription();
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
  }, [attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setConfigured(null);
    setSubscribed(null);
    setAttempt((value) => value + 1);
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

  const turnOff = useCallback(async (): Promise<boolean> => {
    const removed = await removeThisDevicePushSubscription();
    if (removed) setSubscribed(false);
    else setMessage("Phone alerts couldn't be turned off. Try again.");
    return removed;
  }, []);

  // "Sent. It should arrive in a few seconds." is only true for a short while.
  useEffect(() => {
    if (!testSentAt) return;
    const timer = window.setTimeout(() => setTestSentAt(null), 30_000);
    return () => window.clearTimeout(timer);
  }, [testSentAt]);

  const toggle = useCallback(async () => {
    if (!configured || !publicKey || busy) return;
    setTestSentAt(null);
    if (isIosNotInstalled()) {
      setMessage("On iPhone, add PsychSift to your home screen first.");
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
      const payload = (await response.json().catch(() => null)) as { sent?: number; reason?: string } | null;
      // A refusal (not released, signed out) is not a connection problem, so it gets the server's reason.
      if (!response.ok || !payload?.sent) {
        setMessage(testAlertFailureMessage(payload?.reason));
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
      // A shared computer keeps no subscription: the switch only turns on once
      // this device's subscription is really gone.
      // Always try, even when this account shows Off: another account's
      // subscription can still sit on this browser, and removal is a no-op when there is none.
      if (shared && !(await turnOff())) return;
      setSharedDevice(shared);
    },
    [turnOff],
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
    retry,
  };
}
