"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { FirstWeekProgressStrip } from "@/components/on-call/first-week/first-week-pack-card";
import { useFirstWeekPack } from "@/components/on-call/first-week/use-first-week-pack";
import { flatCard } from "@/components/on-call/flat-recipes";
import { cn } from "@/components/ui-primitives";
import {
  firstWeekEyebrow,
  firstWeekProgressLabel,
  isFirstWeekHighlighted,
  type FirstWeekPhase,
} from "@/lib/on-call/first-week-pack";

/**
 * The Today card for "Your first week": shown only while the pack is
 * highlighted (a week before the start until the end of the first week).
 * Presentational, so My Day can pass what it already holds.
 */
export function FirstWeekTodayCard({
  phase,
  progress,
  hospitalName,
}: {
  readonly phase: FirstWeekPhase;
  readonly progress: { readonly read: number; readonly total: number; readonly changed: number };
  readonly hospitalName: string | null;
}) {
  if (!isFirstWeekHighlighted(phase)) return null;
  const left = progress.total - progress.read;
  return (
    <Link
      href="/on-call/first-week"
      data-testid="on-call-first-week-today-card"
      className={cn(flatCard, focusRing, "grid gap-1 px-3 py-3 no-underline active:bg-[color:var(--surface-wash)]")}
    >
      <span className="text-2xs font-semibold uppercase tracking-widest text-[color:var(--mode-identity)]">
        {firstWeekEyebrow(phase)}
      </span>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-base-minus font-medium text-[color:var(--text-heading)]">
          Your first week pack
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </span>
      <span className="text-sm text-[color:var(--text-muted)]">
        {[hospitalName, progress.total > 0 ? (left > 0 ? `${left} to read` : firstWeekProgressLabel(progress)) : null]
          .filter(Boolean)
          .join(" · ")}
      </span>
      <FirstWeekProgressStrip progress={progress} testId="on-call-first-week-today-progress" />
    </Link>
  );
}

/**
 * The same card, reading the pack itself, for a page that holds none of it (On Call Now). The doctor's
 * "Show it on Now when it lands" choice is honoured: turned off, the card shows only when a section changed
 * since they read it, the same rule `selectFirstWeekNeedsYou` keeps. `feed` (My Day Today) leaves out
 * example records and reads the handbook only while the pack is highlighted.
 */
export function FirstWeekTodayCardLive({ now, feed = false }: { readonly now: Date; readonly feed?: boolean }) {
  const pack = useFirstWeekPack(now, { feed });
  if (pack.sample) return null;
  if (pack.landAlert === false && pack.progress.changed === 0) return null;
  return (
    <FirstWeekTodayCard
      phase={pack.phase}
      progress={pack.progress}
      hospitalName={pack.handbook.siteName ?? pack.handbook.serviceName}
    />
  );
}
