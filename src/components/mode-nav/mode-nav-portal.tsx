"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useModeBandShown } from "@/components/mode-band/mode-band-shown";
import { claimPhoneOverlayAddonReserve } from "@/components/clinical-dashboard/use-phone-overlay-chrome-reserve";
import { phoneHeaderCollapseAddonSlotId } from "@/lib/mode-home-composer";

/**
 * Moves a mode's navigation bar into the universal header's collapse track at
 * *every* width.
 *
 * This is a deliberate sibling of `PhoneHeaderCollapsePortal`, which resolves
 * the same host only below the phone breakpoint. That gate is why the Therapy
 * strip never travelled with the header on a tablet or desktop: it stayed in
 * page flow as `position: sticky; top: 0` instead.
 *
 * The header needs no change for this to work. Its addon slot is rendered with
 * no breakpoint prefix (`master-search-header.tsx`, `empty:hidden` inside
 * `universal-header-collapse`), and for the `GlobalSearchShell` host —
 * `{ strategy: "collapse", wide: "sticky" }` — the collapsing wrapper takes its
 * ungated `grid-template-rows: 1fr -> 0fr` branch at every width. Occupying the
 * slot from here therefore inherits the header's hide and reveal exactly, with
 * no second scroll listener that could drift out of step with it.
 *
 * Falls back to normal flow when no host exists — routes rendered without the
 * universal header, and the server pass — so navigation is never lost.
 *
 * Slot ownership: the addon slot holds ONE page-owned header. `DocumentViewer`
 * and the differentials detail page already claim it on phones, so a mode whose
 * routes include those pages must not also mount a bar there. That has never
 * been stated anywhere: it held because both modes had fewer than two
 * destinations so `ModeNav` rendered nothing, and now holds because every
 * claimant route is also `hasLocalInformationPageNavigation`, which
 * `PageSecondaryNavigation` returns null on before reaching the mode branch.
 * `isHeaderAddonSlotOwnedRoute` names the claimants and
 * `tests/mode-nav-addon-slot.dom.test.tsx` fails when a new one falls outside
 * that cover.
 *
 * Under a mode band the bar stays in the page, below the band, as
 * `PhoneHeaderCollapsePortal` explains.
 */
export function ModeNavHeaderPortal({ children }: { children: ReactNode }) {
  const underBand = useModeBandShown();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const sync = () => {
      const next = underBand ? null : document.getElementById(phoneHeaderCollapseAddonSlotId);
      setHost((current) => (current === next ? current : next));
    };

    sync();
    // The shell remounts its header across mode switches, so the host element's
    // identity is not stable for this component's lifetime.
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [underBand]);

  // The bar is ~49px of page flow until this portal claims it, so the phone
  // reserve must grow in the same commit that removes it. Deferring to the
  // reserve hook's quiet window left the whole page 49px too high for ~110ms,
  // and a tap that straddled the correction pressed one control and released on
  // another (#CHPC5C). Above the phone breakpoint the claim is a no-op, which
  // is what keeps this safe on the every-width host this portal deliberately
  // uses. The claim covers the cold first load too, and gives the height back
  // when the bar leaves the header — see `claimPhoneOverlayAddonReserve`.
  useLayoutEffect(() => {
    if (!host) return;
    return claimPhoneOverlayAddonReserve(host);
  }, [host]);

  return host ? createPortal(children, host) : children;
}
