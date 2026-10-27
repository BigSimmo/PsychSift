"use client";

import { useEffect } from "react";
import { installChunkLoadRecovery } from "@/lib/chunk-load-recovery";

/**
 * Reloads once when a lazily loaded piece of the app is missing because the site was redeployed
 * under this page (see `@/lib/chunk-load-recovery`). Rendered eagerly in the root layout on
 * purpose: if this were itself a lazy chunk, it would be the first thing a stale page failed to load.
 */
export function ChunkLoadRecovery() {
  useEffect(() => installChunkLoadRecovery(), []);
  return null;
}
