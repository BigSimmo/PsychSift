"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

import { desktopComposerSlotReadyAttr, desktopComposerSlotReadyValue } from "@/lib/mode-home-composer";

type DesktopComposerPortalSlotProps = {
  id: string;
} & Omit<ComponentPropsWithoutRef<"div">, "id" | "children">;

/**
 * Page-owned host for the desktop/hero search composer portal.
 *
 * The slot must stay empty through SSR and the page segment's first client
 * paint so React hydration matches. MasterSearchHeader only adopts the slot
 * after this attribute flips in useEffect (post-hydration). Adopting earlier
 * injects a `display:contents` host into still-unhydrated RSC HTML and trips
 * React #418 on mode homes.
 */
export function DesktopComposerPortalSlot({ id, className, ...rest }: DesktopComposerPortalSlotProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute(desktopComposerSlotReadyAttr, desktopComposerSlotReadyValue);
    return () => {
      el.removeAttribute(desktopComposerSlotReadyAttr);
    };
  }, []);

  return <div id={id} ref={ref} className={className} {...rest} />;
}
