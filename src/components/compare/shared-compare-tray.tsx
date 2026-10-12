"use client";

import { GitCompareArrows, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { mobileComposerVisibleReserve } from "@/components/clinical-dashboard/mobile-composer-reserve";
import {
  PhoneFooterLayerPortal,
  usePhoneFooterLayerScrollHidden,
} from "@/components/clinical-dashboard/phone-footer-layer-portal";
import { usePhoneMedia } from "@/components/compare/use-phone-media";
import { Button } from "@/components/ui/button";
import { buttonFaceClass } from "@/components/ui/button-face";
import { announce } from "@/components/ui/live-announcer";
import { cn, ignoreUnavailableActivation } from "@/components/ui-primitives";

/**
 * Where the tray sits on a phone (below 640px).
 *
 * - `dockSlotId`: the id of the shell's search-dock addon slot. The tray
 *   portals INTO the dock, so it rides above the bottom search box, inherits
 *   the dock's scroll-hide, and the shell's static dock reserve keeps the last
 *   list row clear. Used where the shell already claims a slot for the route
 *   (Therapy, Differentials).
 * - `"footer-layer"`: no slot exists, so the tray is a page-owned footer layer
 *   fixed directly above the dock (the old DSM strip's geometry), hidden with
 *   the footer on scroll, and the tray adds its own in-flow bottom spacer.
 *
 * At 640px and wider there is no bottom search dock, so the tray is a floating
 * pill near the bottom of the window with an in-flow spacer under the list.
 */
export type SharedCompareTrayPhonePlacement = { dockSlotId: string } | "footer-layer";

export type SharedCompareTrayProps = {
  /** How many records are ticked. Nothing renders while this is 0. */
  count: number;
  /** Short names of what is ticked, shown as one quiet second line. */
  names?: readonly string[];
  /** When set, the count reads "2 of 4 selected". */
  max?: number;
  /** Compare stays unavailable (with its reason) below this many. */
  minToCompare?: number;
  /** The existing compare result page. Preferred over `onCompare`: a real link. */
  compareHref?: string;
  /** For a compare page reached through app state rather than a URL. */
  onCompare?: () => void;
  onClear: () => void;
  /** Plural noun for announcements and the reason text, e.g. "diagnoses". */
  noun: string;
  phonePlacement: SharedCompareTrayPhonePlacement;
  testId?: string;
};

const noopSubscribe = () => () => {};

function selectionAnnouncement(count: number, minToCompare: number, noun: string) {
  if (count === 0) return "Comparison selection cleared.";
  if (count < minToCompare) {
    const more = minToCompare - count;
    return `${count} selected for comparison. Tick ${more} more to compare.`;
  }
  return `${count} ${noun} selected for comparison. Compare is ready.`;
}

/**
 * One Compare tray for every list that can tick records to compare: "N selected,
 * Clear, Compare". It exists only once something is ticked, never covers the
 * bottom search box, and Compare opens the section's existing compare page.
 */
export function SharedCompareTray({
  count,
  names,
  max,
  minToCompare = 2,
  compareHref,
  onCompare,
  onClear,
  noun,
  phonePlacement,
  testId = "shared-compare-tray",
}: SharedCompareTrayProps) {
  const phone = usePhoneMedia();
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const dockSlotId = typeof phonePlacement === "object" ? phonePlacement.dockSlotId : null;
  const dockSlot = useDockSlot(phone && dockSlotId ? dockSlotId : null);
  const footerHidden = usePhoneFooterLayerScrollHidden();
  const reasonId = useId();
  useSelectionAnnouncement(count, minToCompare, noun);

  if (!mounted || count === 0) return null;

  const ready = count >= minToCompare;
  const countLabel = max ? `${count} of ${max} selected` : `${count} selected`;
  const nameLine = names && names.length > 0 ? names.join(" · ") : null;
  const compareClass = cn(buttonFaceClass({ variant: ready ? "primary" : "secondary", size: "sm" }), "shrink-0");

  const tray = (
    <div
      data-testid={testId}
      role="region"
      aria-label="Compare selection"
      data-shared-compare-tray=""
      className={cn(
        "pointer-events-auto flex w-full items-center gap-1 rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] py-1 pr-1 pl-3 shadow-[var(--e3)]",
        // At 640px and wider the pill floats over content, so it is bounded and
        // centred in the content column (the wrapper offsets the side rail).
        !phone && "w-[min(34rem,calc(100vw-2rem))]",
      )}
    >
      <GitCompareArrows aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--clinical-accent)]" />
      <p className="m-0 min-w-0 flex-1 pl-1.5">
        <span
          data-testid={`${testId}-count`}
          className="block truncate text-sm font-semibold text-[color:var(--text-heading)]"
        >
          {countLabel}
        </span>
        {nameLine ? (
          <span className="block truncate text-xs text-[color:var(--text-muted)]" title={nameLine}>
            {nameLine}
          </span>
        ) : null}
      </p>
      <Button
        variant="ghost"
        size="sm"
        icon={X}
        // Below 360px the word moves to screen readers only, so the count is
        // never cut ("2 of 4 select…"); the X icon keeps a 48px target.
        className="min-w-tap shrink-0 justify-center px-2.5 max-[22.5rem]:px-0"
        onClick={onClear}
        testId={`${testId}-clear`}
      >
        <span className="max-[22.5rem]:sr-only">Clear</span>
      </Button>
      {ready && compareHref ? (
        <Link href={compareHref} className={compareClass} data-testid={`${testId}-compare`}>
          Compare
        </Link>
      ) : (
        <button
          type="button"
          className={compareClass}
          data-testid={`${testId}-compare`}
          onClick={ready && onCompare ? onCompare : ignoreUnavailableActivation}
          aria-disabled={ready ? undefined : true}
          aria-describedby={ready ? undefined : reasonId}
          title={ready ? undefined : `Tick at least ${minToCompare} to compare`}
        >
          Compare
        </button>
      )}
      {ready ? null : (
        <span id={reasonId} className="sr-only">
          Tick at least {minToCompare} {noun} to compare.
        </span>
      )}
    </div>
  );

  if (phone && dockSlotId) {
    // The shell claims the slot and owns the reserve; without a slot there is no
    // dock on this route, so there is nothing safe to sit above.
    return dockSlot
      ? createPortal(<div className="relative z-[var(--z-raised)] mb-2 w-full">{tray}</div>, dockSlot)
      : null;
  }

  if (phone) {
    return (
      <>
        {/* Keeps the last list row clear of the tray (the shell already reserves the search box). */}
        <div aria-hidden="true" data-testid={`${testId}-spacer`} className="h-16" />
        <PhoneFooterLayerPortal>
          <div
            className="phone-footer-layer shared-compare-tray-layer pointer-events-none inset-x-0 z-[var(--z-chrome)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
            data-scroll-hidden={footerHidden ? "true" : undefined}
            style={{ bottom: mobileComposerVisibleReserve.shellDock }}
          >
            {tray}
          </div>
        </PhoneFooterLayerPortal>
      </>
    );
  }

  return (
    <>
      <div aria-hidden="true" data-testid={`${testId}-spacer`} className="h-24" />
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[var(--z-chrome)] flex justify-center px-4 sm:pl-[5.25rem]">
          {tray}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Tracks the shell's dock addon slot, which mounts and unmounts with the dock. */
function useDockSlot(slotId: string | null): HTMLElement | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!slotId) return () => {};
      const observer = new MutationObserver(onChange);
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    [slotId],
  );
  return useSyncExternalStore(
    subscribe,
    () => (slotId ? document.getElementById(slotId) : null),
    () => null,
  );
}

/**
 * Announces selection changes through the app's one live announcer. Mount is
 * silent (a seeded selection is not news); every later change is spoken.
 */
function useSelectionAnnouncement(count: number, minToCompare: number, noun: string) {
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = count;
    if (before === null || before === count) return;
    announce(selectionAnnouncement(count, minToCompare, noun), { eventId: `compare-tray:${noun}:${count}` });
  }, [count, minToCompare, noun]);
}
