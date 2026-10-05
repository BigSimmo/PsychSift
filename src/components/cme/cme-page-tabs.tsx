"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/components/ui-primitives";

type CmeTab = { label: string; href: string; active: boolean };

/** The old addresses stay real pages; these links make their five-page ownership visible. */
export function CmePageTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const year = searchParams.get("year");
  const withYear = (href: string) =>
    year ? `${href}${href.includes("?") ? "&" : "?"}year=${encodeURIComponent(year)}` : href;

  let label: string;
  let tabs: CmeTab[];
  if (pathname === "/cme" || pathname === "/cme/check") {
    label = "Year";
    tabs = [
      { label: "Overview", href: withYear("/cme"), active: pathname === "/cme" },
      { label: "Year check", href: withYear("/cme/check"), active: pathname === "/cme/check" },
    ];
  } else if (pathname === "/cme/log" || pathname === "/cme/routines") {
    label = "Log";
    const finish = pathname === "/cme/log" && searchParams.get("tab") === "finish";
    tabs = [
      { label: "Activities", href: withYear("/cme/log"), active: pathname === "/cme/log" && !finish },
      { label: "To finish", href: withYear("/cme/log?tab=finish"), active: finish },
      { label: "Routines", href: withYear("/cme/routines"), active: pathname === "/cme/routines" },
    ];
  } else if (pathname === "/cme/plan" || pathname === "/cme/calendar" || pathname === "/cme/training") {
    label = "Plan";
    tabs = [
      { label: "Goals", href: withYear("/cme/plan"), active: pathname === "/cme/plan" },
      { label: "Calendar", href: withYear("/cme/calendar"), active: pathname === "/cme/calendar" },
      { label: "Training", href: withYear("/cme/training"), active: pathname === "/cme/training" },
    ];
  } else if (pathname === "/cme/learning") {
    label = "Learning";
    const past = searchParams.get("view") === "past";
    tabs = [
      { label: "Upcoming", href: "/cme/learning", active: !past },
      { label: "Past", href: "/cme/learning?view=past", active: past },
    ];
  } else {
    return null;
  }

  return (
    // In page flow under the mode band, whose tabs name the page these split:
    // pinned in the top bar they would sit above that band.
    <nav aria-label={`${label} tabs`} data-testid="cme-page-tabs" data-mode-identity="cme" className="w-full pt-2">
      <div className="mx-auto flex max-w-3xl gap-1.5 overflow-x-auto px-4 sm:px-6">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className="group inline-flex min-h-tap shrink-0 items-center whitespace-nowrap text-sm font-medium focus-visible:outline-none"
          >
            <span
              className={cn(
                "rounded-full border px-3.5 py-1.5 group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[color:var(--focus)]",
                tab.active
                  ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] font-semibold text-[color:var(--clinical-accent)]"
                  : "border-[color:var(--border)] text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
              )}
            >
              {tab.label}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
