"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { isSharedDevice, useSharedDevice } from "@/lib/alerts/shared-device";
import { useAuthSession } from "@/lib/supabase/client";
import {
  addArrival,
  baselineTray,
  clearAlerts,
  EARLIER_ALERTS_STORAGE_KEY,
  EMPTY_SNAPSHOT,
  isAlertCode,
  isSameAlertTime,
  markAlertOpened,
  mergeTray,
  parseEarlierAlerts,
  removeAlert,
  restoreAlerts,
  serializeEarlierAlerts,
  storedEarlierAlertsOwner,
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

/**
 * What an Undo puts back: the removed rows, for whom, and in which sign-in.
 * It is spent against the list as it is when Undo is pressed, so it still
 * works after leaving the page, and does nothing after a sign-out or an
 * account change.
 */
export type EarlierAlertsUndo = {
  readonly owner: string;
  readonly epoch: number;
  readonly removed: readonly EarlierAlert[];
};

export type EarlierAlertsState = {
  /** False until the stored list has been read, so the page can hold its space. */
  readonly loaded: boolean;
  readonly alerts: readonly EarlierAlert[];
  readonly tray: TrayRead;
  /** A shared device keeps no list. */
  readonly shared: boolean;
  readonly refresh: () => void;
  readonly open: (alert: EarlierAlert) => void;
  /** Removes one row. Returns what to give `restore` for Undo, or null when the row was already gone. */
  readonly remove: (id: string) => EarlierAlertsUndo | null;
  /** Removes every row, or only the given ones. Null when there was nothing to remove. */
  readonly clear: (ids?: readonly string[]) => EarlierAlertsUndo | null;
  readonly restore: (undo: EarlierAlertsUndo) => void;
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

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(EARLIER_ALERTS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readStored(owner: string, now: number): EarlierAlertsSnapshot {
  return parseEarlierAlerts(readRaw(), owner, now);
}

function writeStored(snapshot: EarlierAlertsSnapshot, owner: string) {
  try {
    window.localStorage.setItem(EARLIER_ALERTS_STORAGE_KEY, serializeEarlierAlerts(snapshot, owner));
  } catch {
    // Storage full or refused: the list still shows for this visit.
  }
}

function forget() {
  try {
    window.localStorage.removeItem(EARLIER_ALERTS_STORAGE_KEY);
  } catch {
    // Storage refused: there is nothing kept to forget.
  }
}

/**
 * Bumped at every sign-out, expiry or account change, whether or not this page
 * is open, so an Undo or a lock-screen read started before it can never write
 * one person's list after the change. The same moment forgets the kept list and
 * clears PsychSift's alerts from the lock screen (best effort), so the next
 * person never sees the last one's alerts there or here.
 */
let accountEpoch = 0;
subscribeAccountTransition(() => {
  accountEpoch += 1;
  forget();
  void notificationsOnLockScreen()
    .then((shown) => {
      for (const notification of shown ?? []) if (codeOf(notification)) notification.close?.();
    })
    .catch(() => undefined);
});

/** The current account epoch (tests and the page's Undo read it). */
export function earlierAlertsAccountEpoch(): number {
  return accountEpoch;
}

/** Same-tab word that the kept list changed outside a mounted page (the browser's storage event fires only in other tabs). */
const KEPT_CHANGED_EVENT = "psychsift-earlier-alerts-changed";

/** Undo after the page has closed: puts the rows back in the kept list, if it is still the same person's. */
function restoreKept(undo: EarlierAlertsUndo) {
  if (undo.epoch !== accountEpoch || isSharedDevice()) return;
  writeStored(restoreAlerts(readStored(undo.owner, Date.now()), undo.removed, Date.now()), undo.owner);
  window.dispatchEvent(new Event(KEPT_CHANGED_EVENT));
}

export function useEarlierAlerts(): EarlierAlertsState {
  const auth = useAuthSession();
  const owner = auth.status === "authenticated" ? (auth.session?.user?.id ?? "") : "";
  const shared = useSharedDevice();
  const [snapshot, setSnapshot] = useState<EarlierAlertsSnapshot>(EMPTY_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);
  const [tray, setTray] = useState<TrayRead>("reading");
  const current = useRef<EarlierAlertsSnapshot>(EMPTY_SNAPSHOT);
  /** The account the list on screen belongs to, and whether this page is still open. */
  const live = useRef<{ owner: string; mounted: boolean }>({ owner: "", mounted: false });
  /** True when another account used this device, so the next lock-screen read is that account's. */
  const baselineNext = useRef(false);

  const commit = useCallback(
    (next: EarlierAlertsSnapshot) => {
      current.current = next;
      setSnapshot(next);
      if (!owner || shared) return;
      writeStored(next, owner);
    },
    [owner, shared],
  );

  const readTray = useCallback(async () => {
    const epoch = accountEpoch;
    setTray((state) => (state === "ok" ? state : "reading"));
    try {
      const shown = await notificationsOnLockScreen();
      // Signed out, switched account or left the page while the phone answered: this read is not theirs.
      if (epoch !== accountEpoch || live.current.owner !== owner || !live.current.mounted) return;
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
      if (!shared) {
        const next = baselineNext.current
          ? baselineTray(current.current, seen)
          : mergeTray(current.current, seen, Date.now());
        baselineNext.current = false;
        commit(next);
      }
      setTray("ok");
    } catch {
      if (epoch === accountEpoch && live.current.mounted) setTray("error");
    }
  }, [commit, owner, shared]);

  useEffect(() => {
    const page = live.current;
    page.mounted = true;
    return () => {
      page.mounted = false;
    };
  }, []);

  // The stored list, then the lock screen, each time the account or the shared switch changes.
  useEffect(() => {
    let active = true;
    live.current.owner = owner;
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
      const raw = owner ? readRaw() : null;
      const keptFor = storedEarlierAlertsOwner(raw);
      baselineNext.current = Boolean(owner && keptFor && keptFor !== owner);
      const stored = owner ? parseEarlierAlerts(raw, owner, Date.now()) : EMPTY_SNAPSHOT;
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
    const reread = () => {
      const stored = readStored(owner, Date.now());
      current.current = stored;
      setSnapshot(stored);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === EARLIER_ALERTS_STORAGE_KEY) reread();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    window.addEventListener(KEPT_CHANGED_EVENT, reread);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(KEPT_CHANGED_EVENT, reread);
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

  // Sign-out, session expiry or a different account: this list is the person's, so it goes
  // (the module-level listener above has already forgotten the kept copy).
  useEffect(
    () =>
      subscribeAccountTransition(() => {
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
            if (isSameAlertTime(alert, notification.timestamp)) notification.close?.();
          }
        })
        .catch(() => undefined);
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      const removed = current.current.alerts.filter((alert) => alert.id === id);
      if (!removed.length || !owner) return null;
      commit(removeAlert(current.current, id));
      return { owner, epoch: accountEpoch, removed };
    },
    [commit, owner],
  );

  const clear = useCallback(
    (ids?: readonly string[]) => {
      const wanted = ids ? new Set(ids) : null;
      const removed = current.current.alerts.filter((alert) => !wanted || wanted.has(alert.id));
      if (!removed.length || !owner) return null;
      commit(clearAlerts(current.current, ids));
      return { owner, epoch: accountEpoch, removed };
    },
    [commit, owner],
  );

  const restore = useCallback(
    (undo: EarlierAlertsUndo) => {
      if (undo.epoch !== accountEpoch) return;
      if (live.current.mounted && live.current.owner === undo.owner) {
        commit(restoreAlerts(current.current, undo.removed, Date.now()));
        return;
      }
      // The page has closed (or now shows someone else): put the rows back in the kept list only.
      if (!live.current.mounted) restoreKept(undo);
    },
    [commit],
  );

  return {
    loaded,
    alerts: snapshot.alerts,
    tray,
    shared,
    refresh: () => void readTray(),
    open,
    remove,
    clear,
    restore,
  };
}
