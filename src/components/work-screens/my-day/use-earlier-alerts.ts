"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { useSharedDevice } from "@/lib/alerts/shared-device";
import { useAuthSession } from "@/lib/supabase/client";
import {
  addArrival,
  clearAlerts,
  EARLIER_ALERTS_STORAGE_KEY,
  EMPTY_SNAPSHOT,
  isAlertCode,
  markAlertOpened,
  mergeTray,
  parseEarlierAlerts,
  removeAlert,
  serializeEarlierAlerts,
  type EarlierAlert,
  type EarlierAlertsSnapshot,
  type SeenAlert,
} from "@/lib/work-screens/my-day/earlier-alerts";

/**
 * The phone's own list of the alerts that buzzed it (see the module comment in
 * `earlier-alerts.ts` for why there is no server history). Reads what is on
 * the lock screen when the page opens, again whenever the page comes back into
 * view, and adds any alert that arrives while it is open.
 */

export type TrayRead = "reading" | "ok" | "error" | "unsupported";

export type EarlierAlertsState = {
  /** False until the stored list has been read, so the page can hold its space. */
  readonly loaded: boolean;
  readonly alerts: readonly EarlierAlert[];
  readonly tray: TrayRead;
  /** A shared device keeps no list. */
  readonly shared: boolean;
  readonly refresh: () => void;
  readonly open: (alert: EarlierAlert) => void;
  /** Removes one row; returns what to give `restore` for Undo. */
  readonly remove: (id: string) => EarlierAlertsSnapshot;
  readonly clear: () => EarlierAlertsSnapshot;
  readonly restore: (snapshot: EarlierAlertsSnapshot) => void;
};

type NotificationLike = { readonly data?: unknown; readonly timestamp?: number; close?: () => void };

async function notificationsOnLockScreen(): Promise<NotificationLike[] | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration || typeof registration.getNotifications !== "function") return null;
  return (await registration.getNotifications()) as NotificationLike[];
}

function codeOf(notification: NotificationLike): SeenAlert["code"] | null {
  const code = (notification.data as { t?: unknown } | null | undefined)?.t;
  return isAlertCode(code) ? code : null;
}

function readStored(owner: string, now: number): EarlierAlertsSnapshot {
  try {
    return parseEarlierAlerts(window.localStorage.getItem(EARLIER_ALERTS_STORAGE_KEY), owner, now);
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function forget() {
  try {
    window.localStorage.removeItem(EARLIER_ALERTS_STORAGE_KEY);
  } catch {
    // Storage refused: there is nothing kept to forget.
  }
}

export function useEarlierAlerts(): EarlierAlertsState {
  const auth = useAuthSession();
  const owner = auth.status === "authenticated" ? (auth.session?.user?.id ?? "") : "";
  const shared = useSharedDevice();
  const [snapshot, setSnapshot] = useState<EarlierAlertsSnapshot>(EMPTY_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);
  const [tray, setTray] = useState<TrayRead>("reading");
  const current = useRef<EarlierAlertsSnapshot>(EMPTY_SNAPSHOT);

  const commit = useCallback(
    (next: EarlierAlertsSnapshot) => {
      current.current = next;
      setSnapshot(next);
      if (!owner || shared) return;
      try {
        window.localStorage.setItem(EARLIER_ALERTS_STORAGE_KEY, serializeEarlierAlerts(next, owner));
      } catch {
        // Storage full or refused: the list still shows for this visit.
      }
    },
    [owner, shared],
  );

  const readTray = useCallback(async () => {
    setTray((state) => (state === "ok" ? state : "reading"));
    try {
      const shown = await notificationsOnLockScreen();
      if (!shown) {
        setTray("unsupported");
        return;
      }
      const seen = shown.flatMap((notification) => {
        const code = codeOf(notification);
        if (!code) return [];
        const at =
          typeof notification.timestamp === "number" && notification.timestamp > 0 ? notification.timestamp : null;
        return [{ code, at } satisfies SeenAlert];
      });
      if (!shared) commit(mergeTray(current.current, seen, Date.now()));
      setTray("ok");
    } catch {
      setTray("error");
    }
  }, [commit, shared]);

  // The stored list, then the lock screen, each time the account or the shared switch changes.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (shared) {
        forget();
        current.current = EMPTY_SNAPSHOT;
        setSnapshot(EMPTY_SNAPSHOT);
        setLoaded(true);
        setTray("ok");
        return;
      }
      const stored = owner ? readStored(owner, Date.now()) : EMPTY_SNAPSHOT;
      current.current = stored;
      setSnapshot(stored);
      setLoaded(true);
      if (owner) void readTray();
    });
    return () => {
      active = false;
    };
  }, [owner, shared, readTray]);

  // Read again when the page comes back into view (the phone was in a pocket), and when another tab changes the list.
  useEffect(() => {
    if (!owner || shared) return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") void readTray();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== EARLIER_ALERTS_STORAGE_KEY) return;
      const stored = readStored(owner, Date.now());
      current.current = stored;
      setSnapshot(stored);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [owner, shared, readTray]);

  // An alert that arrives while this page is open: the worker tells open pages its code.
  useEffect(() => {
    if (!owner || shared || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; t?: unknown } | null;
      if (data?.type !== "psychsift-push" || !isAlertCode(data.t)) return;
      commit(addArrival(current.current, data.t, Date.now()));
    };
    container.addEventListener("message", onMessage);
    return () => container.removeEventListener("message", onMessage);
  }, [owner, shared, commit]);

  // Sign-out, session expiry or a different account: this list is the person's, so it goes.
  useEffect(
    () =>
      subscribeAccountTransition(() => {
        forget();
        current.current = EMPTY_SNAPSHOT;
        setSnapshot(EMPTY_SNAPSHOT);
      }),
    [],
  );

  const open = useCallback(
    (alert: EarlierAlert) => {
      commit(markAlertOpened(current.current, alert.id, Date.now()));
      // Opened here, so it no longer needs to sit on the lock screen. Best effort.
      void notificationsOnLockScreen()
        .then((shown) => {
          for (const notification of shown ?? []) {
            if (codeOf(notification) !== alert.code) continue;
            if (alert.approx || notification.timestamp === alert.at) notification.close?.();
          }
        })
        .catch(() => undefined);
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      const previous = current.current;
      commit(removeAlert(previous, id));
      return previous;
    },
    [commit],
  );

  const clear = useCallback(() => {
    const previous = current.current;
    commit(clearAlerts(previous));
    return previous;
  }, [commit]);

  return {
    loaded,
    alerts: snapshot.alerts,
    tray,
    shared,
    refresh: () => void readTray(),
    open,
    remove,
    clear,
    restore: commit,
  };
}
