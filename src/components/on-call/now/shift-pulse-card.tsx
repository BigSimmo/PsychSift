"use client";

import { ChevronRight, Clock } from "lucide-react";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import { onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { modePressable } from "@/components/mode-kit/recipes";
import { modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { ON_CALL_PULSE_HOURS, onCallPulseNights, onCallPulsePeak } from "@/lib/on-call/call-counts";
import {
  onCallCallCountsStorageKey,
  onCallDeviceStateChangedEvent,
  onCallDeviceStoreChangedEvent,
} from "@/lib/on-call/device-state-keys";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const events = [onCallDeviceStoreChangedEvent, onCallDeviceStateChangedEvent, "storage"] as const;
  for (const name of events) window.addEventListener(name, onChange);
  return () => {
    for (const name of events) window.removeEventListener(name, onChange);
  };
}

function readCounts(): string {
  try {
    return window.localStorage.getItem(onCallCallCountsStorageKey) ?? "";
  } catch {
    return "";
  }
}

/** The hours inside the busiest two-hour window, e.g. [21, 22] for "21:00 to 23:00". */
function peakHours(peak: string | null): ReadonlySet<number> {
  if (!peak) return new Set();
  const start = Number(peak.slice(0, 2));
  return new Set([start, (start + 1) % 24]);
}

/**
 * The Shift pulse card on Now (mock-up v10): when calls usually bunch up, from
 * the last four nights' call counts on this phone, as a small bar per hour from
 * 17:00 to 08:00. Counts only: no bed, initials or note ever reaches it. It
 * opens the Shift pulse page.
 *
 * Breaks are noted on the Shift pulse page (start and end times on this phone),
 * so the card leads with the busy hours and points there for breaks.
 */
export function NowShiftPulseCard({ now }: { readonly now: Date }) {
  const raw = useSyncExternalStore(subscribe, readCounts, () => undefined);
  const view = useMemo(() => {
    if (raw === undefined) return null;
    // The four nights before tonight: "your last 4 nights", never tonight.
    const past = onCallPulseNights(raw || null, now).slice(1, 5);
    const totals = ON_CALL_PULSE_HOURS.map((_, index) =>
      past.reduce((sum, night) => sum + (night.counts[index] ?? 0), 0),
    );
    return { totals, peak: onCallPulsePeak(past), max: Math.max(1, ...totals) };
  }, [raw, now]);

  const peak = view?.peak ?? null;
  const highlighted = peakHours(peak);

  return (
    <Link
      href="/on-call/pulse"
      data-testid="on-call-home-pulse"
      className={cn("work-card", modePressable, focusRing, "grid min-w-0 gap-2 px-3 py-2.5 no-underline")}
    >
      <span className="flex min-w-0 items-start gap-3">
        <Clock aria-hidden="true" strokeWidth={2} className={cn(onCallLeadingIcon, "mt-3.5")} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={eyebrowText}>Shift pulse</span>
          <span className="break-words text-base-minus font-semibold text-[color:var(--text-heading)]">
            {peak ? `Busiest ${peak}` : "Calls by hour"}
          </span>
          <span className={cn(modeSecondaryText, "break-words")}>
            {view === null
              ? "Reading this phone"
              : peak
                ? "on your last 4 nights · breaks and rest are on the Shift pulse page"
                : "Too few calls logged on your last 4 nights to show a pattern yet"}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="mt-4 size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </span>
      {view && peak ? (
        <span className="grid gap-1" aria-hidden="true" data-testid="on-call-now-pulse-chart">
          <span className="flex h-8 items-end gap-0.5">
            {view.totals.map((count, index) => (
              <span
                key={ON_CALL_PULSE_HOURS[index]}
                className={cn(
                  "min-h-1 flex-1 rounded-t-sm",
                  highlighted.has(ON_CALL_PULSE_HOURS[index]!)
                    ? "bg-[color:var(--mode-identity)]"
                    : "bg-[color:var(--border-strong)]",
                )}
                style={{ height: `${Math.max(12, Math.round((count / view.max) * 100))}%` }}
              />
            ))}
          </span>
          <span
            className={cn(modeNumberText, "flex justify-between text-2xs font-semibold text-[color:var(--text-muted)]")}
          >
            <span>17:00</span>
            <span>Last 4 nights · counts only</span>
            <span>08:00</span>
          </span>
        </span>
      ) : null}
    </Link>
  );
}
