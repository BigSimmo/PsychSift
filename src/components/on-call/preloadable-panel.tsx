"use client";

import dynamic from "next/dynamic";
import { useState, type ComponentType } from "react";

/**
 * A panel that stays out of the route's first-load JavaScript but can be fetched
 * ahead of the tap that shows it. Once `preload()` has finished, the panel renders
 * the loaded component directly, so switching to it has no Suspense gap; before
 * then it falls back to `next/dynamic` and appears as soon as its chunk arrives.
 *
 * The component is chosen once per mount, so a preload finishing while the
 * dynamic fallback is on screen never swaps the type and resets the panel.
 */
export function preloadablePanel<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;

  function preload(): Promise<ComponentType<P>> {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        // A failed fetch (offline, a new deploy) may be retried by the next tap.
        pending = null;
        throw error;
      },
    );
    return pending;
  }

  const Lazy = dynamic<P>(() => preload(), { ssr: false });

  function PreloadablePanel(props: P) {
    const [Component] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return <Component {...props} />;
  }

  return { Panel: PreloadablePanel, preload };
}
