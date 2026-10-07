"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { cmePageWidth } from "@/components/cme/cme-page-frame";
import { cn } from "@/components/ui-primitives";

export type CmeSegment = {
  readonly label: string;
  readonly href: string;
  readonly active: boolean;
  /** A count beside the label ("To finish · 2"), read out as "2 waiting". */
  readonly count?: number | null;
};

/**
 * The work-mode segmented switch (work-mode redesign, owner request 6 Oct
 * 2026): a pale pill track with the current part as a white pill. Each part is
 * a link (these are pages, not panels), the current one marked `aria-current`.
 * Each pill is the 48px production tap floor (`--spacing-tap`), drawn as its own box.
 */
export function CmeSegmentedTabs({
  label,
  segments,
  testId = "cme-page-tabs",
  className,
}: {
  readonly label: string;
  readonly segments: readonly CmeSegment[];
  readonly testId?: string;
  readonly className?: string;
}) {
  return (
    <nav aria-label={label} data-testid={testId} className={className}>
      <div className="cpd-seg">
        {segments.map((segment) => (
          <Link
            key={segment.label}
            href={segment.href}
            aria-current={segment.active ? "page" : undefined}
            className="cpd-seg__item"
          >
            {segment.label}
            {segment.count ? (
              <>
                <span aria-hidden="true" className="nums">
                  &nbsp;· {segment.count}
                </span>
                <span className="sr-only">, {segment.count} waiting</span>
              </>
            ) : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/* The "To finish" count: Log publishes it while it is open (drafts, teaching to
   log and missed sessions), so the switch never shows a count nothing on screen
   keeps current. Held in memory only. */
let finishCount: number | null = null;
const finishListeners = new Set<() => void>();

function subscribeFinish(listener: () => void) {
  finishListeners.add(listener);
  return () => {
    finishListeners.delete(listener);
  };
}

function setFinishCount(next: number | null) {
  if (finishCount === next) return;
  finishCount = next;
  finishListeners.forEach((listener) => listener());
}

/** Puts a count on "To finish" while the calling page is open. Null hides it. */
export function useCmeFinishCount(count: number | null) {
  useEffect(() => {
    setFinishCount(count);
    return () => setFinishCount(null);
  }, [count]);
}

/**
 * The switch at the top of Log, which spans three addresses: activities, to
 * finish and routines. Every other CPD page is one of the band's tabs or a
 * More page, so it has none.
 */
export function CmePageTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const count = useSyncExternalStore(
    subscribeFinish,
    () => finishCount,
    () => null,
  );
  const year = searchParams.get("year");
  const withYear = (href: string) =>
    year ? `${href}${href.includes("?") ? "&" : "?"}year=${encodeURIComponent(year)}` : href;

  if (pathname !== "/cme/log" && pathname !== "/cme/routines") return null;
  const finish = pathname === "/cme/log" && searchParams.get("tab") === "finish";
  const segments: CmeSegment[] = [
    { label: "Activities", href: withYear("/cme/log"), active: pathname === "/cme/log" && !finish },
    { label: "To finish", href: withYear("/cme/log?tab=finish"), active: finish, count },
    { label: "Routines", href: withYear("/cme/routines"), active: pathname === "/cme/routines" },
  ];

  return <CmeSegmentedTabs label="Log pages" segments={segments} className={cn(cmePageWidth, "px-3 pt-3")} />;
}
