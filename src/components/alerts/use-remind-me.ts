"use client";

import { useCallback, useSyncExternalStore } from "react";

import { REMIND_ME_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { normalizeReminders, remindersFull, REMIND_ME_TEXT_LIMIT, type Reminder } from "@/lib/alerts/remind-me";
import { isSharedDevice, SHARED_DEVICE_CHANGE_EVENT } from "@/lib/alerts/shared-device";
import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";

/**
 * Remind me notes on this device. The words never leave it: only the due time
 * and the note's id go to the server, so the note can buzz the phone while the
 * app is closed (owner decision 1, 5 Oct 2026). A save re-runs the
 * patient-detail check (the sheet's check is not trusted alone) and is refused
 * on a device marked shared.
 */
const CHANGE_EVENT = "psychsift-remind-me-change";
const EMPTY: readonly Reminder[] = [];
let cachedRaw: string | null = null;
let cachedList: readonly Reminder[] = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(REMIND_ME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function snapshot(): readonly Reminder[] {
  if (isSharedDevice()) return EMPTY;
  const raw = readRaw();
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  let stored: unknown = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  cachedList = normalizeReminders(stored, new Date());
  // A stored note that now fails the check (or a broken value) is deleted, not just hidden.
  if (raw && (!Array.isArray(stored) || stored.length > cachedList.length)) {
    try {
      if (cachedList.length) window.localStorage.setItem(REMIND_ME_STORAGE_KEY, JSON.stringify(cachedList));
      else window.localStorage.removeItem(REMIND_ME_STORAGE_KEY);
      cachedRaw = readRaw();
    } catch {
      // Storage refused: the bad note stays hidden and is cleared at sign-out.
    }
  }
  if (!cachedList.length) cachedList = EMPTY;
  return cachedList;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener(SHARED_DEVICE_CHANGE_EVENT, onChange);
  const stop = subscribeAccountTransition(onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener(SHARED_DEVICE_CHANGE_EVENT, onChange);
    stop();
  };
}

function write(list: readonly Reminder[]): boolean {
  try {
    if (list.length) window.localStorage.setItem(REMIND_ME_STORAGE_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(REMIND_ME_STORAGE_KEY);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

/** This browser's phone-alert link, or null when phone alerts are off here. */
async function thisDeviceEndpoint(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager?.getSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

/**
 * Best effort, and never the words: a note that can't be queued (phone alerts
 * off, offline, signed out) still shows on this device at its time.
 */
async function tellServer(method: "POST" | "DELETE", ref: string, dueAt?: string): Promise<void> {
  if (typeof fetch !== "function") return;
  try {
    let body: Record<string, string> = { ref };
    if (method === "POST") {
      const endpoint = await thisDeviceEndpoint();
      if (!endpoint || !dueAt) return;
      body = { ref, dueAt, endpoint };
    }
    await fetch("/api/alerts/reminders", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    // The note is saved on this device either way.
  }
}

export type SaveReminderResult = "saved" | "unsafe" | "shared-device" | "full" | "failed";

export function useRemindMe() {
  const reminders = useSyncExternalStore(subscribe, snapshot, () => EMPTY);

  const add = useCallback((text: string, dueAt: string): SaveReminderResult => {
    const words = text.trim().slice(0, REMIND_ME_TEXT_LIMIT);
    if (!words || looksLikePatientDetail(words)) return "unsafe";
    if (isSharedDevice()) return "shared-device";
    const current = snapshot();
    if (remindersFull(current)) return "full";
    const now = new Date();
    const id = `r${now.getTime()}`;
    const next = normalizeReminders(
      [...current, { id, text: words, dueAt, createdAt: now.toISOString(), doneAt: null }],
      now,
    );
    // Only "saved" when the new note really is in what was written.
    if (!next.some((item) => item.id === id)) return "failed";
    if (!write(next)) return "failed";
    void tellServer("POST", id, dueAt);
    return "saved";
  }, []);

  const markDone = useCallback((id: string) => {
    const now = new Date().toISOString();
    write(snapshot().map((item) => (item.id === id ? { ...item, doneAt: now } : item)));
    void tellServer("DELETE", id);
  }, []);

  const remove = useCallback((id: string) => {
    write(snapshot().filter((item) => item.id !== id));
    void tellServer("DELETE", id);
  }, []);

  return { reminders, add, markDone, remove };
}
