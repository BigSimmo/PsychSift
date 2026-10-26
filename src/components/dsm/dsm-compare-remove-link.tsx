"use client";

import Link from "next/link";
import type { ReactNode, MouseEvent } from "react";

/**
 * Same-route search-param navigation for DSM compare removals.
 *
 * `<Link>` soft-nav from `/dsm/compare?ids=a,b` → `/dsm/compare?ids=b` can
 * complete its click handler under Production UI load without ever updating
 * the URL (zero network, URL stuck). `router.push` was the next attempt and
 * still stalled under full-suite Chromium load on PR #1782: the remove
 * control went `[active]` while `?ids=` stayed unchanged for 15s. A full
 * assign is the durable hop for this filter change.
 */
export function DsmCompareRemoveLink({
  href,
  "aria-label": ariaLabel,
  className,
  children,
}: {
  href: string;
  "aria-label": string;
  className?: string;
  children: ReactNode;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // A modified or non-primary click opens a new tab or window: leave that to the browser.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    window.location.assign(href);
  }

  return (
    <Link href={href} aria-label={ariaLabel} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
