"use client";

import { useSyncExternalStore } from "react";

/**
 * From this width a cited source opens docked beside the answer instead of in
 * the shared `Sheet`. The same 1024px seam as the rest of the desktop layouts
 * (work-desktop-layout.tsx): phones and upright tablets keep the drawer.
 */
export const SOURCE_DOCK_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const media = window.matchMedia(SOURCE_DOCK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot() {
  return typeof window.matchMedia === "function" && window.matchMedia(SOURCE_DOCK_QUERY).matches;
}

/** False on the server and wherever `matchMedia` is missing, so those keep the drawer. */
export function useDesktopSourceDock() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
