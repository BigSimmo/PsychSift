"use client";

import { RegistryModeNav } from "@/components/mode-nav/registry-mode-nav";

/**
 * The Clinical Forms tabs (Forms, Clock, Act) on the two Forms pages the shell
 * cannot draw them on.
 *
 * `/forms/clock` and `/forms/act` are information pages, so
 * `PageSecondaryNavigation` returns before the mode branch and never mounts the
 * bar there. Each page mounts it itself, exactly as the differentials
 * presentation workflow does; both routes are already header-slot claimants in
 * `isHeaderAddonSlotOwnedRoute`, so the slot keeps one occupant. `/forms/search`
 * gets the same bar from the shell.
 */
export function FormsModeNav({ current }: { readonly current: "forms-clock" | "forms-act" }) {
  return <RegistryModeNav modeId="forms" activeId={current} />;
}
