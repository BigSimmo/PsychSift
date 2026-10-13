"use client";

import { usePathname } from "next/navigation";

import { SharedCompareTray } from "@/components/compare/shared-compare-tray";
import { therapyCompareAddonSlotId } from "@/lib/mode-home-composer";
import { THERAPY_MAX_COMPARE, therapyScreenHref } from "@/lib/therapy-compass-navigation";

import { useTcBindings } from "./bindings";
import type { Therapy } from "./data/types";

/**
 * Therapy's use of the shared Compare tray ("2 of 4 selected, Clear, Compare").
 *
 * On a phone it portals into the dock slot the shell claims while the URL
 * carries a compare set, so it rides above the search box and the shell's
 * static therapy reserve keeps the last row clear. The tray stays exactly one
 * row tall for that reason. Wider screens get the floating pill.
 *
 * The compare page owns selection in its own chrome, so the tray steps aside
 * there rather than splitting one set across two surfaces.
 */
export function TherapyCompareTray() {
  const b = useTcBindings();
  const pathname = usePathname();
  if (pathname === therapyScreenHref("compare")) return null;

  return (
    <SharedCompareTray
      count={b.compareTherapies.length}
      names={b.compareTherapies.map(shortTherapyName)}
      max={THERAPY_MAX_COMPARE}
      // The same URL `goCompare` pushes, as a real link.
      compareHref={b.workspaceHref(therapyScreenHref("compare"))}
      onClear={() => b.clearCompare()}
      onRemove={(index) => {
        const therapy = b.compareTherapies[index];
        if (therapy) b.removeCompare(therapy.slug);
      }}
      noun="therapies"
      phonePlacement={{ dockSlotId: therapyCompareAddonSlotId }}
      testId="therapy-compare-tray"
    />
  );
}

/**
 * The tray is one line wide, so it shows the record's own abbreviation where it
 * has a short one ("CBT", "EMDR") and the full name otherwise. Truncation is
 * left to CSS — cutting a therapy name mid-word in JS reads as a data error.
 */
export function shortTherapyName(therapy: Therapy | undefined): string {
  if (!therapy) return "";
  const alias = therapy.aliases.map((value) => value.trim()).find((value) => value.length > 0 && value.length <= 10);
  return alias ?? therapy.name;
}
