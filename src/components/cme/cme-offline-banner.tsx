"use client";

import { CloudOff } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/components/ui-primitives";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

/**
 * An unobtrusive offline banner displayed on CME surfaces when the device has lost
 * connectivity. Shows that current loaded records are visible while editing and saving
 * require a restored connection.
 */
export function CmeOfflineBanner() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (isOnline) return null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6">
      <div
        data-testid="cme-offline-banner"
        className={cn(
          "flex min-h-tap items-center gap-2.5 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--surface-raised)] px-3 py-2.5 text-sm-minus text-[color:var(--text-muted)]",
        )}
      >
        <CloudOff className="size-4 shrink-0 text-[color:var(--warning)]" strokeWidth={1.6} aria-hidden="true" />
        <span>Offline — viewing loaded records. Reconnect to save new activities or changes.</span>
      </div>
      <span data-testid="cme-offline-banner-announcement" role="status" aria-live="polite" className="sr-only">
        Offline — viewing loaded records. Reconnect to save new activities or changes.
      </span>
    </div>
  );
}
