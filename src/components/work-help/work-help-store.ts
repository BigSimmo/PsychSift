"use client";

import { useSyncExternalStore } from "react";

import type { WorkAreaId } from "@/lib/work-frame/areas";

/**
 * Which area's help sheet is open, in memory for this tab. The frame's More
 * sheet asks for it (`openWorkHelp`), and the one `WorkHelpHost` the frame
 * mounts draws it. Nothing here is stored or sent.
 */

let openArea: WorkAreaId | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openWorkHelp(area: WorkAreaId): void {
  openArea = area;
  notify();
}

export function closeWorkHelp(): void {
  if (openArea === null) return;
  openArea = null;
  notify();
}

export function useOpenWorkHelp(): WorkAreaId | null {
  return useSyncExternalStore(
    subscribe,
    () => openArea,
    () => null,
  );
}
