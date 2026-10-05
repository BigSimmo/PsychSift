"use client";

import { useSyncExternalStore } from "react";

/**
 * "This is a shared computer": kept on this device only, never on the account,
 * because the same account may be signed in on a personal phone at the same
 * time. While it is on, this device takes no phone alerts and keeps no
 * Remind me notes. A failed storage read counts as "not shared", which is the
 * state the device was in before the switch existed.
 */
const STORAGE_KEY = "psychsift-shared-device";
const CHANGE_EVENT = "psychsift-shared-device-change";

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function isSharedDevice(): boolean {
  return typeof window !== "undefined" && read();
}

export function setSharedDevice(shared: boolean): void {
  try {
    if (shared) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage refused (private mode): the switch simply does not stick.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useSharedDevice(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
