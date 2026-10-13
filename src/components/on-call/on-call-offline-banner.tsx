"use client";

import { CloudOff, WifiOff } from "lucide-react";

import { cn } from "@/components/ui-primitives";
import { savedLine } from "@/lib/offline-line";

export interface OnCallOfflineBannerProps {
  /** ISO timestamp of when the shown copy was cached, or `null` if unknown. */
  savedAt: string | null;
  /** Why the live copy could not be fetched. A server error is not the
   *  reader's lost signal, so it is not called "offline". */
  reason?: "offline" | "failed" | null;
  testId?: string;
}

/**
 * Shown when contacts render from the offline cache rather than a live fetch
 * (spec §6, §8.5). Names when the saved copy was taken, in the one wording the
 * whole app uses for a saved copy ("Offline, showing what was saved at 19:02";
 * an earlier day is named too).
 *
 * The visible banner is deliberately NOT itself a live region — no `role`,
 * no `aria-live` on this element — because the page can mount it already
 * visible on first paint, and an always-on live region announces its own
 * mount as if it just changed. The announcement instead goes through a
 * paired `sr-only` `aria-live="polite"` node, which is the one channel a
 * screen-reader user actually needs: a spoken heads-up that this is not
 * live data.
 */
export function OnCallOfflineBanner({
  savedAt,
  reason = "offline",
  testId = "on-call-offline-banner",
}: OnCallOfflineBannerProps) {
  const message = savedLine({ reason, savedAt });
  const Icon = reason === "failed" ? CloudOff : WifiOff;

  return (
    <>
      <div
        data-testid={testId}
        className={cn(
          "flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm font-semibold text-[color:var(--warning)]",
        )}
      >
        <Icon className="size-icon-sm shrink-0" aria-hidden />
        <span>{message}</span>
      </div>
      <span data-testid={`${testId}-announcement`} role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </>
  );
}
