import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/components/ui-primitives";

export type OnCallShiftPage = "handover" | "calls" | "breaks";

function segmentClass(on: boolean): string {
  return cn(
    "relative isolate flex min-h-tap min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-1 text-xs font-semibold leading-none no-underline transition focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)] sm:px-3",
    on
      ? "text-[color:var(--text-heading)]"
      : "text-[color:var(--text-muted)] hover:bg-[color:var(--surface-highlight)] hover:text-[color:var(--text-heading)]",
  );
}

function SegmentFace({ on, children }: { readonly on: boolean; readonly children: ReactNode }) {
  return (
    <>
      {on ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-lux)] shadow-[var(--e1)] forced-colors:outline forced-colors:outline-2 forced-colors:[outline-color:Highlight]"
        />
      ) : null}
      <span className="relative min-w-0 truncate">{children}</span>
    </>
  );
}

/**
 * The switch at the top of every Shift page (On Call overhaul, owner approval 20 Oct 2026):
 * Handover, Call log and Breaks, side by side. Each is its own address, so the switch is a
 * row of links with the current one marked, drawn to match the app's segmented control.
 * The hrefs are written out, not mapped from a list, so the route-reachability scan sees them.
 * Everything on these pages stays on this phone, as it always has.
 */
export function OnCallShiftSwitch({ current }: { readonly current: OnCallShiftPage }) {
  const handover = current === "handover";
  const calls = current === "calls";
  const breaks = current === "breaks";
  return (
    <nav aria-label="Shift pages" data-testid="on-call-shift-switch">
      <ul
        role="list"
        className="flex w-full min-w-0 gap-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-inset)] shadow-[var(--shadow-inset)]"
      >
        <li className="flex min-w-0 flex-1">
          <Link
            href="/on-call/handover"
            aria-current={handover ? "page" : undefined}
            data-testid="on-call-shift-switch-handover"
            className={segmentClass(handover)}
          >
            <SegmentFace on={handover}>Handover</SegmentFace>
          </Link>
        </li>
        <li className="flex min-w-0 flex-1">
          <Link
            href="/on-call/calls"
            aria-current={calls ? "page" : undefined}
            data-testid="on-call-shift-switch-calls"
            className={segmentClass(calls)}
          >
            <SegmentFace on={calls}>Call log</SegmentFace>
          </Link>
        </li>
        <li className="flex min-w-0 flex-1">
          <Link
            href="/on-call/pulse"
            aria-current={breaks ? "page" : undefined}
            data-testid="on-call-shift-switch-breaks"
            className={segmentClass(breaks)}
          >
            <SegmentFace on={breaks}>Breaks</SegmentFace>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
