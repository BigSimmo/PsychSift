import { ChevronRight, Timer } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn } from "@/components/ui-primitives";

/**
 * The way from a shift to the Mental Health Act clock, on the Clinical side
 * (cross-links between Clinical and Work, owner decision 21 Oct 2026). The
 * clock keeps only each form's type and times, on this device.
 */
export function NowMhaClockRow() {
  return (
    <li className={modeInsetHairline}>
      {/* A literal href: the route-reachability guard reads literal hrefs only. */}
      <Link
        href="/forms/clock"
        data-testid="on-call-now-mha-clock"
        className={cn(
          modeRowHeight.double,
          modePressable,
          focusRing,
          "flex w-full min-w-0 items-center gap-3 pl-3 pr-2 text-left no-underline",
        )}
      >
        <span aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center">
          <Timer aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />
        </span>
        <span className="grid min-w-0 flex-1 gap-1 py-1">
          <span className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-heading)]")}>
            MHA clock
          </span>
          <span className={cn(modeSecondaryText, "break-words text-xs")}>Forms you are holding and their limits</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </Link>
    </li>
  );
}
