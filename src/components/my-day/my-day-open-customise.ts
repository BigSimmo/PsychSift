"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** Goes to Today with the Customise sheet open: the page reads `?sheet=customise` once, then drops it. */
export function useOpenMyDayCustomise(): () => void {
  const router = useRouter();
  return useCallback(() => router.push("/my-day?sheet=customise"), [router]);
}
