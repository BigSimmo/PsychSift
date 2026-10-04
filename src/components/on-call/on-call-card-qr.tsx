"use client";

import { useEffect, useState } from "react";

import { qrModulePath } from "@/components/teaching/checkin-qr";
import { cn } from "@/components/ui-primitives";

/**
 * Pocket-card QR that points at this browser's live `/on-call/card`. Drawn after
 * hydration so the origin is real. Uses the Teaching QR tokens (light quiet zone,
 * dark modules) so cameras can read it in every theme and on paper.
 */
export function OnCallCardQr({ className }: { readonly className?: string }) {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    setValue(`${window.location.origin}/on-call/card`);
  }, []);
  if (!value)
    return <div className={cn("size-20", className)} aria-hidden="true" data-testid="on-call-card-qr-pending" />;
  const drawn = qrModulePath(value);
  return (
    <svg
      role="img"
      aria-label="QR code linking to the live On Call pocket card"
      viewBox={`0 0 ${drawn.size} ${drawn.size}`}
      shapeRendering="crispEdges"
      data-testid="on-call-card-qr"
      data-mode-identity="teaching"
      data-qr-value={value}
      className={cn("block size-20 forced-color-adjust-none print:size-16", className)}
    >
      <rect width={drawn.size} height={drawn.size} className="fill-[color:var(--teaching-qr-light)]" />
      <path d={drawn.path} className="fill-[color:var(--teaching-qr-dark)]" />
    </svg>
  );
}
