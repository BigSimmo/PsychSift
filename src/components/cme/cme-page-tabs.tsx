"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { focusRing } from "@/components/card-recipes";
import { cmePageWidth } from "@/components/cme/cme-page-frame";
import { cn } from "@/components/ui-primitives";

export type CmeSegment = { readonly label: string; readonly href: string; readonly active: boolean };

/**
 * The 5 Oct mock-up's segmented control: a sunk track with the current page
 * raised in it. Each part is a link (these are pages, not panels), the current
 * one marked `aria-current`. The face is 40px; each link's tap area is 48px.
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
      <div className="flex gap-0.5 rounded-md bg-[color:var(--surface-inset)] p-0.75 forced-colors:border forced-colors:border-[CanvasText]">
        {segments.map((segment) => (
          <Link
            key={segment.label}
            href={segment.href}
            aria-current={segment.active ? "page" : undefined}
            className={cn(
              focusRing,
              "relative inline-flex h-10 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-sm px-1.5 text-sm-minus no-underline",
              "after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
              segment.active
                ? "bg-[color:var(--surface-raised)] font-semibold text-[color:var(--text-heading)] ring-1 ring-[color:var(--border)] forced-colors:border forced-colors:border-[Highlight]"
                : "font-medium text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
            )}
          >
            {segment.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/**
 * The switch at the top of Log and Plan, which span more than one address
 * (Log: activities, to finish, routines; Plan: goals and training). Courses
 * draws its own, because its Upcoming count comes from the page's list. Year
 * and Report have none: the mode header's tabs cover them.
 */
export function CmePageTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const year = searchParams.get("year");
  const withYear = (href: string) =>
    year ? `${href}${href.includes("?") ? "&" : "?"}year=${encodeURIComponent(year)}` : href;

  let label: string;
  let segments: CmeSegment[];
  if (pathname === "/cme/log" || pathname === "/cme/routines") {
    label = "Log";
    const finish = pathname === "/cme/log" && searchParams.get("tab") === "finish";
    segments = [
      { label: "Activities", href: withYear("/cme/log"), active: pathname === "/cme/log" && !finish },
      { label: "To finish", href: withYear("/cme/log?tab=finish"), active: finish },
      { label: "Routines", href: withYear("/cme/routines"), active: pathname === "/cme/routines" },
    ];
  } else if (pathname === "/cme/plan" || pathname === "/cme/calendar" || pathname === "/cme/training") {
    // CPD dates (`/cme/calendar`) is reached from the Year page's "CPD dates" row,
    // so the switch holds only the mock-up's two parts and marks neither there.
    label = "Plan";
    segments = [
      { label: "Goals", href: withYear("/cme/plan"), active: pathname === "/cme/plan" },
      { label: "Training", href: withYear("/cme/training"), active: pathname === "/cme/training" },
    ];
  } else {
    return null;
  }

  return (
    <CmeSegmentedTabs label={`${label} pages`} segments={segments} className={cn(cmePageWidth, "px-4 pt-4 sm:px-6")} />
  );
}
