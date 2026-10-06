"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useModeBandShown } from "@/components/mode-band/mode-band-shown";
import { phoneHeaderCollapseAddonSlotId } from "@/lib/mode-home-composer";

import { claimPhoneOverlayAddonReserve } from "./use-phone-overlay-chrome-reserve";

/**
 * Moves one page-owned navigation header into the universal phone collapse
 * track. The same subtree stays in normal flow at sm+ and when no shared host
 * exists, so routes never duplicate controls or lose their fallback header.
 *
 * Taking the subtree out of flow shortens the page by its height, so the reserve
 * that clears the fixed header has to grow in the SAME commit. Leaving that to
 * the reserve hook's geometry quiet window left every element 49px too high for
 * ~110ms, which is long enough for a tap to press one control and release on
 * another (#CHPC5C) — see `claimPhoneOverlayAddonReserve`.
 *
 * Under a mode band the bar stays in the page, below the band (Josh, 6 Oct
 * 2026): in the top bar it sat above the band's title and tabs, and moving it
 * there after the first paint made the page jump. The band's own tabs are the
 * page's pinned navigation there.
 */
export function PhoneHeaderCollapsePortal({ children }: { children: ReactNode }) {
  const underBand = useModeBandShown();
  const [phoneHost, setPhoneHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const phoneMedia = window.matchMedia("(max-width: 639px)");
    const sync = () => {
      const nextHost =
        phoneMedia.matches && !underBand ? document.getElementById(phoneHeaderCollapseAddonSlotId) : null;
      setPhoneHost((current) => (current === nextHost ? current : nextHost));
    };

    sync();
    phoneMedia.addEventListener("change", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      phoneMedia.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, [underBand]);

  // Runs after the commit that resolved (or dropped) the host, so the host
  // already holds this subtree and its height is the row's height. The claim
  // covers the cold first load as well as in-session navigation, and its
  // cleanup takes the row's height back off when the row leaves the header —
  // see `claimPhoneOverlayAddonReserve`.
  useLayoutEffect(() => {
    if (!phoneHost) return;
    return claimPhoneOverlayAddonReserve(phoneHost);
  }, [phoneHost]);

  return phoneHost ? createPortal(children, phoneHost) : children;
}
