"use client";

import { useExampleData } from "@/lib/example-data/store";
import { useAuthSession } from "@/lib/supabase/client";
import type { WorkAreaId } from "@/lib/work-frame/areas";

/** The auth status when an `AuthProvider` is mounted; null in a bare render (unit tests). */
function useAuthStatusIfAvailable(): string | null {
  try {
    return useAuthSession().status;
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.") return null;
    throw error;
  }
}

/** Whether the reader must sign in. For real sign-in gates only, never to decide what data shows. */
export function useSignedOut(): boolean {
  const status = useAuthStatusIfAvailable();
  return status === "signed_out" || status === "expired";
}

/**
 * Whether this screen shows invented records: the one example data switch is
 * showing them in its area. Auto mode already shows examples to a signed-out
 * visitor, and an explicit off is honoured for everyone (they get the normal
 * signed-out state). Kept apart from any notice component so stores can read
 * it without importing the sign-in dialog.
 */
export function useSignedOutSample(area: WorkAreaId): boolean {
  return useExampleData(area).active;
}
