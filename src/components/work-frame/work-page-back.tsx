"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { ContextualBackLink } from "@/components/contextual-back-link";
import { universalHeaderLeadingSlotId } from "@/components/work-frame/universal-header-slot";
import { useClaimWorkFrameBack } from "@/components/work-frame/work-frame-store";

const subscribeNever = () => () => {};

/**
 * One way back (owner rule C8.6, and the 11 Oct 2026 audit): a page whose real
 * parent is not its area's first tab (Team staffing and Sick for tomorrow to
 * Roster, the Term folder to Term, a CPD feature page to its parent) draws its
 * Back in the top bar's round left button instead of a second "‹ Roster" link
 * under the band. It claims the slot, so the frame's own arrow steps aside and
 * the bar never shows two. With `history` it follows the tab's history when
 * there is some, so it returns to where the reader came from, and falls back
 * to `href`; without, it always goes to `href`.
 */
export function WorkPageBack({
  href,
  label,
  testId,
  history = true,
}: {
  /** The parent page, for a deep link or a new tab. */
  readonly href: string;
  /** The parent's name, read as "Back to <label>". */
  readonly label: string;
  readonly testId: string;
  /** Go back through the tab's history when it has some (default), rather than straight to `href`. */
  readonly history?: boolean;
}) {
  useClaimWorkFrameBack(true);
  const host = useSyncExternalStore(
    subscribeNever,
    () => document.getElementById(universalHeaderLeadingSlotId),
    () => null,
  );
  if (!host) return null;
  const shared = {
    className: "universal-header-icon-control work-frame-back",
    "aria-label": `Back to ${label}`,
    "data-testid": testId,
  };
  const icon = <ChevronLeft aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />;
  return createPortal(
    history ? (
      <ContextualBackLink fallbackHref={href} {...shared}>
        {icon}
      </ContextualBackLink>
    ) : (
      <Link href={href} {...shared}>
        {icon}
      </Link>
    ),
    host,
  );
}
