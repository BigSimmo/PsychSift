"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { universalHeaderLeadingSlotId } from "@/components/work-frame/work-frame-header";

const subscribeNothing = () => () => undefined;

/**
 * A page's own Back, drawn in the top bar's round left button in place of the
 * menu: the slot a page reached from More uses for its back button. For pages
 * that hide the band (setup, help), where the frame draws no Back of its own.
 */
export function TopBarBack({
  label,
  onBack,
  href,
  testId,
}: {
  readonly label: string;
  readonly testId: string;
} & ({ readonly onBack: () => void; readonly href?: never } | { readonly href: string; readonly onBack?: never })) {
  const host = useSyncExternalStore(
    subscribeNothing,
    () => document.getElementById(universalHeaderLeadingSlotId),
    () => null,
  );
  if (!host) return null;
  const icon = <ChevronLeft aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />;
  return createPortal(
    href ? (
      <Link
        href={href}
        className="universal-header-icon-control work-frame-back"
        aria-label={label}
        data-testid={testId}
      >
        {icon}
      </Link>
    ) : (
      <button
        type="button"
        className="universal-header-icon-control work-frame-back"
        aria-label={label}
        onClick={onBack}
        data-testid={testId}
      >
        {icon}
      </button>
    ),
    host,
  );
}
