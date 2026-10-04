"use client";

import { useAuthSession } from "@/lib/supabase/client";

/** The auth status when an `AuthProvider` is mounted; null in a bare render (unit tests). */
function useAuthStatusIfAvailable(): string | null {
  try {
    return useAuthSession().status;
  } catch (error) {
    if (error instanceof Error && error.message === "useAuthSession must be used within AuthProvider.") return null;
    throw error;
  }
}

/**
 * True while the reader is signed out (or their session ended), i.e. while a
 * mode shows its signed-out sample. Kept apart from the notice component so
 * stores can read it without importing the sign-in dialog.
 */
export function useSignedOutSample(): boolean {
  const status = useAuthStatusIfAvailable();
  return status === "signed_out" || status === "expired";
}
