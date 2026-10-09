"use client";

import { AdminLoadAlert } from "@/components/admin/admin-kit";

/**
 * Admin's own "could not load" state (Compliance, New job, Help, Your Admin
 * records), drawn as the work kit's grey alert card (work-mode redesign, owner
 * request 6 Oct 2026). Never an empty page and never a saved list when the
 * server did not answer, in Admin's words: a doctor on an Admin page is
 * looking for their records, not their "On Call entries". Admin is online
 * only and keeps none of your records on the device (spec, "Offline"); the one
 * thing it stores is pinned row ids (`src/lib/admin/pins.ts`).
 */
export function AdminLoadFailed({
  reason,
  onRetry,
  testId,
}: {
  readonly reason: "offline" | "failed" | null;
  readonly onRetry: () => void;
  readonly testId: string;
}) {
  return (
    <AdminLoadAlert
      title="Couldn't load your Admin records"
      body={
        reason === "offline"
          ? "You appear to be offline, and Admin keeps none of your records on this device. Try again once you have signal."
          : "The server did not answer. Nothing has been lost. Try again in a moment."
      }
      offline={reason === "offline"}
      onRetry={onRetry}
      testId={testId}
    />
  );
}
