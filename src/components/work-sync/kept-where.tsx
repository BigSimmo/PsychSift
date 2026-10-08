"use client";

import { useWorkSyncStatus } from "@/lib/work-sync/work-sync-client";
import type { WorkSyncSection } from "@/lib/work-sync/sections";

/**
 * True once a section matches the copy kept with the doctor's account, so it is
 * on every device they sign in on (`@/lib/work-sync`). False when signed out, in
 * the demo build, before the first read, or when the account refused it.
 */
export function useKeptWithAccount(section: WorkSyncSection): boolean {
  return useWorkSyncStatus(section) === "account";
}

/** Says where a section is kept right now: the account's words once it matches, the device's otherwise. */
export function KeptWhere({
  section,
  account,
  device,
}: {
  readonly section: WorkSyncSection;
  readonly account: string;
  readonly device: string;
}) {
  return useKeptWithAccount(section) ? account : device;
}
